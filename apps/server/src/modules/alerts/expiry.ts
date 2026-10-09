/**
 * The 24-hour end (SM-06, LOST-08, D-126): a lost-contact journey whose alert
 * opened 24 hours ago or more ends, its alert resolved, and every responder is
 * told. The watchdog's third job, run by its sweep after the escalation, so an
 * end that cannot be done fails the sweep and stops the beat, which pages the
 * owner (D-108, D-116). It is the only automatic end there is, and it never
 * ends a journey still in contact, nor a lost-contact one early (SM-05).
 *
 * One run:
 *   1. reads the alerts due (unresolved, and opened 24 hours or more before
 *      the database's now()), without locking, and that now() from the same
 *      statement;
 *   2. asks the domain's 24-hour rule about each one's journey, and goes on
 *      only for one it ends (defence in depth: the read is checked again);
 *   3. ends each in a transaction of its own, so one alert's failure holds up
 *      no other. A journey's row someone else holds is skipped, not waited
 *      for: a heartbeat, "I'm home", a close, a removal, or another sweeper;
 *   4. then, for each alert skipped there whose 24 hours passed
 *      STUCK_AFTER_MS ago or more, tries once more, waiting at most
 *      LOCK_WAIT_LIMIT_MS for the row. A healthy holder lets go within
 *      milliseconds, and the journey is then ended, or skipped because the
 *      holder resolved its alert. One held through the wait, or failed in
 *      it, is stuck, and so is one whose first attempt failed when its 24
 *      hours had passed STUCK_AFTER_MS ago or more (never waited for, as
 *      the escalation's is not): one `expiry_overdue` line naming it.
 * A run fails when its read fails, when an end fails (one `expiry_failed`
 * line each, whichever attempt it was), or when it finds a stuck alert. A
 * successful end writes no line: the rows are its record.
 *
 * Failures are logged as their stage and SQLSTATE only (PRIV-07): the 24-hour
 * end sees alert and journey IDs and nothing else, and never writes an
 * error's message. It reads no clock (AR-03).
 */
import { ALERT_EXPIRES_AFTER_MS, transition } from '../../domain/journey.ts';
import { sqlstateOf } from '../../domain/sqlstate.ts';
import { LOCK_WAIT_LIMIT_MS, isStuckPast } from '../../domain/watchdog.ts';
import type { ExpiringAlert, Log, WatchdogStore } from '../../ports.ts';

/** What one run came to: whether it succeeded, how many journeys it ended, and how many alerts it could not. */
export interface ExpiryResult {
  ok: boolean;
  expired: number;
  stuck: number;
}

export interface Expiry {
  expireDue(): Promise<ExpiryResult>;
}

/** What one attempt to end an alert's journey came to; `failed` was logged where it happened. */
type Attempt = 'expired' | 'skipped' | 'held' | 'failed';

export function createExpiry({ journeys, log }: { journeys: WatchdogStore; log: Log }): Expiry {
  const attempt = async (alertId: string, lockWaitMs?: number): Promise<Attempt> => {
    try {
      const result = await journeys.expireAlert({ alertId, lockWaitMs });
      return result.outcome;
    } catch (error) {
      log.write({ event: 'expiry_failed', stage: 'expire', code: sqlstateOf(error) });
      return 'failed';
    }
  };

  return {
    async expireDue(): Promise<ExpiryResult> {
      let read;
      try {
        read = await journeys.alertsDueForExpiry();
      } catch (error) {
        log.write({ event: 'expiry_failed', stage: 'read', code: sqlstateOf(error) });
        return { ok: false, expired: 0, stuck: 0 };
      }
      const { now } = read;
      // The read is checked again by the rule (defence in depth, as the
      // escalation's read is), with the database's times it returned.
      const due = read.alerts.filter(
        ({ journeyId, journeyState, openedAt }) =>
          transition(
            { id: journeyId, state: journeyState },
            { type: 'expire', alertOpenedAt: openedAt, now },
          ).type === 'expired',
      );
      const pastStuck = ({ openedAt }: ExpiringAlert) =>
        isStuckPast({ since: openedAt, dueAfterMs: ALERT_EXPIRES_AFTER_MS, now });

      let expired = 0;
      let failed = false;
      const stuck: string[] = [];
      const waitFor: string[] = [];

      // Every alert's first attempt, before any waits for a row. One that
      // failed fails the run, with its line, and past the stuck threshold is
      // stuck; only one skipped is waited for.
      for (const alert of due) {
        const outcome = await attempt(alert.id);
        if (outcome === 'expired') {
          expired += 1;
        } else if (outcome === 'failed') {
          failed = true;
          if (pastStuck(alert)) {
            stuck.push(alert.id);
          }
        } else if (pastStuck(alert)) {
          waitFor.push(alert.id);
        }
      }

      // Past the stuck threshold, a skipped alert is asked about once more,
      // waiting for its holder: skipped then means its holder dealt with it.
      // Held through the wait, or failed, it is stuck, which fails the run.
      for (const alertId of waitFor) {
        const outcome = await attempt(alertId, LOCK_WAIT_LIMIT_MS);
        if (outcome === 'expired') {
          expired += 1;
        } else if (outcome !== 'skipped') {
          stuck.push(alertId);
        }
      }

      for (const alertId of stuck) {
        log.write({ event: 'expiry_overdue', alertId });
      }
      return { ok: !failed && stuck.length === 0, expired, stuck: stuck.length };
    },
  };
}
