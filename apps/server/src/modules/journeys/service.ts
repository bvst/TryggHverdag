/**
 * Starting a journey, and the heartbeats that keep it in contact: read the
 * situation, ask the state machine, write what it decided (SM-01, SM-02,
 * LOST-01).
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
 * The log takes closed events only, and the one line about a heartbeat that
 * this module writes names the journey and the reason, nothing of what the
 * heartbeat held (PRIV-07).
 */
import type { HeartbeatRequest, StartJourneyResponse } from '@trygghverdag/contracts';
import { transition, type HeartbeatRefusal, type StartRefusal } from '../../domain/journey.ts';
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

export interface JourneyService {
  start(request: StartRequest): Promise<StartResult>;
  heartbeat(call: HeartbeatCall): Promise<HeartbeatResult>;
}

/** Where a heartbeat failed, as `heartbeat_failed` names it. */
type Stage = Extract<LogEvent, { event: 'heartbeat_failed' }>['stage'];

/**
 * The code a failure carries, for the log: the error's own `code` when it is
 * text, else null. Never its message, which can hold what the request held.
 * The log writes a code only when it is a SQLSTATE.
 */
function codeOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : null;
}

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
   * Runs one stage of a heartbeat. A failure is written as one line naming
   * the stage, then thrown on, so the API answers 500: never a 2xx, and never
   * a 401.
   */
  async function stage<T>(name: Stage, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      log.write({ event: 'heartbeat_failed', stage: name, code: codeOf(error) });
      throw error;
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
      const receivedAt = await stage('clock', () => clock.now());
      const journey = await stage('read', () => journeys.journeyForHeartbeat(heartbeat.journeyId));

      const decision = transition(journey, { type: 'heartbeat', walkerId, deviceId });
      if (decision.type !== 'recorded') {
        return decision.type === 'ignored' ? ended() : decision;
      }

      const { position } = heartbeat;
      const stored = await stage('store', () =>
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
      return { type: stored.outcome };
    },
  };
}
