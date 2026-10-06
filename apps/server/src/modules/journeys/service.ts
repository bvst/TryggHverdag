/**
 * Starting a journey, the heartbeats that keep it in contact, and "I'm home":
 * read the situation, ask the state machine, write what it decided (SM-01,
 * SM-02, LOST-01, LOST-03, SM-04).
 *
 * Thin on purpose, like every module. The decision is the domain's, where it
 * is tested in milliseconds; the one-unended-journey rule, the heartbeat
 * stored once and last contact never moving backwards are also the
 * database's, where racing requests meet. What is left here is the order of
 * the calls, and what the store's answers mean to the caller.
 *
 * The time comes from the injected clock, which in the API is the database
 * clock, never from this process (AR-03, REL-01).
 *
 * "I'm home" reads no clock: it ends the journey at the database's now(), in
 * the store's transaction (REL-01).
 *
 * The log takes closed events only, and the lines this module writes name the
 * journey and the reason, or the stage and the SQLSTATE, never anything a
 * request held (PRIV-07).
 */
import type { HeartbeatRequest, StartJourneyResponse } from '@trygghverdag/contracts';
import { transition, type HeartbeatRefusal, type StartRefusal } from '../../domain/journey.ts';
import { sqlstateOf } from '../../domain/sqlstate.ts';
import type { Clock, JourneyStore, Log, LogEvent } from '../../ports.ts';

/** A start, as the API hands it over: the walker is the device's own user, and the device is the one that sent it. */
export interface StartRequest {
  walkerId: string;
  deviceId: string;
  responderIds: readonly string[];
}

export type StartResult = { type: 'started'; journey: StartJourneyResponse } | StartRefusal;

/** A heartbeat, as the API hands it over: the walker is the device's own user, and the device is the one that sent it. */
export interface HeartbeatCall {
  walkerId: string;
  deviceId: string;
  heartbeat: HeartbeatRequest;
}

/** Stored now; already stored, so nothing changed (SM-08); or not stored, and why. */
export type HeartbeatResult = { type: 'recorded' } | { type: 'duplicate' } | HeartbeatRefusal;

/** "I'm home", as the API hands it over: the walker is the device's own user, and the device is the one that sent it (D-110). */
export interface HomeCall {
  walkerId: string;
  deviceId: string;
  journeyId: string;
}

/** Ended now; or not, and why, as for a heartbeat. */
export type HomeResult = { type: 'ended' } | HeartbeatRefusal;

export interface JourneyService {
  start(request: StartRequest): Promise<StartResult>;
  heartbeat(call: HeartbeatCall): Promise<HeartbeatResult>;
  home(call: HomeCall): Promise<HomeResult>;
}

/** Where a heartbeat or an "I'm home" failed, as its failure line names it, without the code. */
type Failure =
  | Omit<Extract<LogEvent, { event: 'heartbeat_failed' }>, 'code'>
  | Omit<Extract<LogEvent, { event: 'home_failed' }>, 'code'>;

export function createJourneyService({
  clock,
  journeys,
  log,
}: {
  clock: Clock;
  journeys: JourneyStore;
  log: Log;
}): JourneyService {
  /**
   * Runs one stage of a heartbeat or an "I'm home". A failure is written as
   * one line naming the stage and its SQLSTATE, found on the error or down
   * its causes as Drizzle wraps PostgreSQL's, and never its message, which
   * can hold what the request held. Then it is thrown on, so the API answers
   * 500: never a 2xx, and never a 401.
   */
  async function stage<T>(failure: Failure, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      log.write({ ...failure, code: sqlstateOf(error) });
      throw error;
    }
  }

  /**
   * A LOST_CONTACT journey moved with no unresolved alert to resolve: a state
   * nothing in the code makes, met in the safe direction, and said out loud
   * rather than passed over (LOST-03, reading 11).
   */
  function alertMissing(journeyId: string, resolved: { alertId: string | null }): void {
    if (resolved.alertId === null) {
      log.write({ event: 'alert_missing', journeyId });
    }
  }

  return {
    async start({ walkerId, deviceId, responderIds }: StartRequest): Promise<StartResult> {
      const current = await journeys.unendedJourneyOf(walkerId);
      const existingUserIds = await journeys.existingUsers(responderIds);

      const decision = transition(current, {
        type: 'start',
        walkerId,
        responderIds,
        existingUserIds,
      });
      if (decision.type === 'refused') {
        return decision;
      }

      const startedAt = await clock.now();
      const stored = await journeys.insertStarted({
        walkerId,
        deviceId,
        responderIds: decision.responderIds,
        startedAt,
      });
      if (!stored.inserted) {
        // Another start for this walker got past the read above at the same
        // moment and won at the database. To the caller that is the same
        // refusal the read would have given, with the journey that won.
        return {
          type: 'refused',
          reason: 'ALREADY_ON_A_JOURNEY',
          journeyId: stored.unendedJourneyId,
        };
      }

      return {
        type: 'started',
        journey: {
          journeyId: stored.journeyId,
          state: decision.state,
          startedAt: startedAt.toISOString(),
        },
      };
    },

    async heartbeat({ walkerId, deviceId, heartbeat }: HeartbeatCall): Promise<HeartbeatResult> {
      // SM-07: one line, naming the journey and the reason, and nothing else.
      const ended = (): HeartbeatResult => {
        log.write({
          event: 'heartbeat_ignored',
          reason: 'JOURNEY_ENDED',
          journeyId: heartbeat.journeyId,
        });
        return { type: 'ignored', reason: 'JOURNEY_ENDED' };
      };

      // The moment it arrived, read first: a slow read of the journey must
      // not make a heartbeat look later than it came (SM-09).
      const receivedAt = await stage({ event: 'heartbeat_failed', stage: 'clock' }, () =>
        clock.now(),
      );
      const journey = await stage({ event: 'heartbeat_failed', stage: 'read' }, () =>
        journeys.journeyForHeartbeat(heartbeat.journeyId),
      );

      const decision = transition(journey, { type: 'heartbeat', walkerId, deviceId });
      if (decision.type !== 'recorded') {
        return decision.type === 'ignored' ? ended() : decision;
      }

      const { position } = heartbeat;
      const stored = await stage({ event: 'heartbeat_failed', stage: 'store' }, () =>
        journeys.recordHeartbeat({
          journeyId: heartbeat.journeyId,
          eventId: heartbeat.eventId,
          receivedAt,
          batteryLevel: heartbeat.batteryLevel,
          position:
            position === null
              ? null
              : {
                  latitude: position.latitude,
                  longitude: position.longitude,
                  accuracyMeters: position.accuracyMeters,
                  // The phone's own time, kept as the position's label only.
                  recordedAt: new Date(position.recordedAt),
                },
        }),
      );
      // The journey ended between the read above and the write: the same
      // answer, and the same line, as an ended journey read above.
      if (stored.outcome === 'ended') {
        return ended();
      }
      // Back in contact (LOST-03) is a stored heartbeat to the phone: the
      // journey moved, the alert resolved and the stand-downs written are the
      // store's record, and need no line, unless there was no alert at all.
      if (stored.outcome === 'back_in_contact') {
        alertMissing(heartbeat.journeyId, stored);
        return { type: 'recorded' };
      }
      return { type: stored.outcome };
    },

    async home({ walkerId, deviceId, journeyId }: HomeCall): Promise<HomeResult> {
      // SM-07: one line, naming the journey and the reason, and nothing else.
      const ended = (): HomeResult => {
        log.write({ event: 'home_ignored', reason: 'JOURNEY_ENDED', journeyId });
        return { type: 'ignored', reason: 'JOURNEY_ENDED' };
      };

      const journey = await stage({ event: 'home_failed', stage: 'read' }, () =>
        journeys.journeyForHeartbeat(journeyId),
      );
      const decision = transition(journey, { type: 'home', walkerId, deviceId });
      if (decision.type !== 'ended') {
        return decision.type === 'ignored' ? ended() : decision;
      }

      // The store asks the same rule again under the row's lock, with the same
      // walker and device, and writes what it decides (AR-04).
      const stored = await stage({ event: 'home_failed', stage: 'store' }, () =>
        journeys.recordHome({ journeyId, walkerId, deviceId }),
      );
      // The journey ended between the read above and the write: the same
      // answer, and the same line, as an ended journey read above.
      if (stored.outcome === 'already_ended') {
        return ended();
      }
      // The store ended it from the state its row was in, which decides
      // whether there was an alert to resolve, not the read above.
      if (stored.from === 'LOST_CONTACT') {
        alertMissing(journeyId, stored);
      }
      return { type: 'ended' };
    },
  };
}
