/**
 * The watchdog's sweep (LOST-02, AR-06): every journey silent for five
 * minutes or more is moved to LOST_CONTACT, with its alert and a message for
 * each responder, by the server, on the database's clock (REL-01), whatever
 * the phone is doing.
 *
 * One sweep:
 *   1. reads the overdue journeys, without locking, and the database's now()
 *      from the same statement;
 *   2. asks the state machine about each one's silence, and goes on only for
 *      a journey it says is lost;
 *   3. opens each one's alert in a transaction of its own, so one journey's
 *      failure holds up no other. A row someone else holds is skipped, not
 *      waited for: a heartbeat being written, or another sweeper;
 *   4. then, for each journey skipped there that is silent STUCK_AFTER_MS
 *      past the five minutes or more, tries once more, waiting at most
 *      LOCK_WAIT_LIMIT_MS for the row. A healthy holder lets go within
 *      milliseconds, and the journey is then opened, or skipped because the
 *      holder alerted it or heard from it. Only one that holds through the
 *      wait is stuck;
 *   5. records the worker's beat at the now() its read returned, if it
 *      succeeded (D-108: the watchdog feeds the beat).
 *
 * A sweep fails when its read fails, when an alert fails to open, or when it
 * finds a stuck journey: a journey past STUCK_AFTER_MS that it could not move,
 * because its row was held through the wait, or because its open failed. Each
 * stuck journey is one `watchdog_overdue` line naming it. A failed sweep
 * records no beat, so the minute check-in stops and `/v1/health` goes
 * degraded: a watchdog that cannot work pages the owner, never silently.
 *
 * Failures are logged as their stage and SQLSTATE only (PRIV-07): the
 * watchdog sees journey and user IDs and nothing else, and never writes an
 * error's message. It reads no clock (AR-03).
 */
import { LOST_CONTACT_AFTER_MS, transition } from '../../domain/journey.ts';
import { sqlstateOf } from '../../domain/sqlstate.ts';
import { LOCK_WAIT_LIMIT_MS, isStuck } from '../../domain/watchdog.ts';
import type { Log, OverdueJourney, WatchdogStore, WorkerHeartbeats } from '../../ports.ts';

/** What one sweep came to: whether it succeeded, how many alerts it opened, and how many journeys it could not move. */
export interface SweepResult {
  ok: boolean;
  opened: number;
  stuck: number;
}

export interface Watchdog {
  sweep(): Promise<SweepResult>;
}

/** What one attempt to open a journey's alert came to; `failed` was logged where it happened. */
type Attempt = 'opened' | 'skipped' | 'held' | 'failed';

export function createWatchdog({
  journeys,
  beats,
  log,
}: {
  journeys: WatchdogStore;
  beats: WorkerHeartbeats;
  log: Log;
}): Watchdog {
  const attempt = async (journeyId: string, lockWaitMs?: number): Promise<Attempt> => {
    try {
      const result = await journeys.openLostContactAlert({
        journeyId,
        afterMs: LOST_CONTACT_AFTER_MS,
        lockWaitMs,
      });
      return result.outcome;
    } catch (error) {
      log.write({ event: 'watchdog_failed', stage: 'open', code: sqlstateOf(error) });
      return 'failed';
    }
  };

  return {
    async sweep(): Promise<SweepResult> {
      let read;
      try {
        read = await journeys.overdueJourneys(LOST_CONTACT_AFTER_MS);
      } catch (error) {
        log.write({ event: 'watchdog_failed', stage: 'read', code: sqlstateOf(error) });
        return { ok: false, opened: 0, stuck: 0 };
      }
      const { now } = read;
      const lost = read.journeys.filter(
        ({ id, state, silentSince }) =>
          transition({ id, state }, { type: 'silence', silentSince, now }).type === 'lost_contact',
      );
      const pastStuck = ({ silentSince }: OverdueJourney) => isStuck({ silentSince, now });

      let opened = 0;
      let failed = false;
      const stuck: string[] = [];
      const waitFor: string[] = [];

      // Every journey's first attempt, before any waits for a row.
      for (const journey of lost) {
        const outcome = await attempt(journey.id);
        if (outcome === 'opened') {
          opened += 1;
        } else if (outcome === 'failed') {
          failed = true;
          if (pastStuck(journey)) {
            stuck.push(journey.id);
          }
        } else if (pastStuck(journey)) {
          waitFor.push(journey.id);
        }
      }

      // Past the stuck threshold, a skipped journey is asked about once more,
      // waiting for its holder: skipped then means its holder dealt with it.
      // Held through the wait, or failed, it is stuck, which fails the sweep.
      for (const journeyId of waitFor) {
        const outcome = await attempt(journeyId, LOCK_WAIT_LIMIT_MS);
        if (outcome === 'opened') {
          opened += 1;
        } else if (outcome !== 'skipped') {
          stuck.push(journeyId);
        }
      }

      for (const journeyId of stuck) {
        log.write({ event: 'watchdog_overdue', journeyId });
      }
      if (failed || stuck.length > 0) {
        return { ok: false, opened, stuck: stuck.length };
      }

      try {
        // The database's now() as the read returned it: the API compares the
        // beat with its own reading of the same clock (REL-01).
        await beats.record(now);
      } catch (error) {
        log.write({ event: 'watchdog_failed', stage: 'beat', code: sqlstateOf(error) });
        return { ok: false, opened, stuck: 0 };
      }
      return { ok: true, opened, stuck: 0 };
    },
  };
}
