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
 *   5. escalates to SMS every alert nobody has acknowledged within two
 *      minutes (LOST-07, `escalation.ts`), whatever steps 1 to 4 came to, its
 *      read included: a read of journeys that fails says nothing of the
 *      alerts already open, whose two minutes go on, and an SMS never waits
 *      on an open that failed (D-116);
 *   6. records the worker's beat at the now() its read returned, if all of
 *      it succeeded (D-108: the watchdog feeds the beat).
 *
 * A sweep fails when its read fails, when an alert fails to open, or when it
 * finds a stuck journey: a journey past STUCK_AFTER_MS that it could not move,
 * because its row was held through the wait, or because its open failed. Each
 * stuck journey is one `watchdog_overdue` line naming it. It fails too when
 * the escalation fails or finds a stuck alert. A failed sweep records no beat,
 * so the minute check-in stops and `/v1/health` goes degraded: a watchdog
 * that cannot work pages the owner, never silently.
 *
 * Failures are logged as their stage and SQLSTATE only (PRIV-07): the
 * watchdog sees journey and user IDs and nothing else, and never writes an
 * error's message. It reads no clock (AR-03).
 */
import { LOST_CONTACT_AFTER_MS, transition } from '../../domain/journey.ts';
import { sqlstateOf } from '../../domain/sqlstate.ts';
import { LOCK_WAIT_LIMIT_MS, isStuck } from '../../domain/watchdog.ts';
import type { Log, OverdueJourney, WatchdogStore, WorkerHeartbeats } from '../../ports.ts';
import { createEscalation } from './escalation.ts';

/**
 * What one sweep came to: whether it succeeded, how many alerts it opened and
 * escalated, and how many journeys and alerts it could not move.
 */
export interface SweepResult {
  ok: boolean;
  opened: number;
  escalated: number;
  stuck: number;
}

export interface Watchdog {
  sweep(): Promise<SweepResult>;
}

/** What steps 1 to 4 came to: the read's now() when all of them succeeded, how many opened, and how many are stuck. */
type Opens =
  | { ok: true; now: Date; opened: number; stuck: number }
  | { ok: false; opened: number; stuck: number };

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
  const escalation = createEscalation({ journeys, log });

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

  /** Steps 1 to 4: every overdue journey's alert opened, or the journey said to be stuck. */
  const openDue = async (): Promise<Opens> => {
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
    return failed || stuck.length > 0
      ? { ok: false, opened, stuck: stuck.length }
      : { ok: true, now, opened, stuck: 0 };
  };

  return {
    async sweep(): Promise<SweepResult> {
      const opens = await openDue();
      // The watchdog's second job (LOST-07), whatever the opens came to: an
      // escalation that cannot be done fails the sweep, as an open does.
      const escalations = await escalation.escalateDue();
      const result = {
        opened: opens.opened,
        escalated: escalations.escalated,
        stuck: opens.stuck + escalations.stuck,
      };
      if (!opens.ok || !escalations.ok) {
        return { ok: false, ...result };
      }

      try {
        // The database's now() as the read returned it: the API compares the
        // beat with its own reading of the same clock (REL-01).
        await beats.record(opens.now);
      } catch (error) {
        log.write({ event: 'watchdog_failed', stage: 'beat', code: sqlstateOf(error) });
        return { ok: false, ...result };
      }
      return { ok: true, ...result };
    },
  };
}
