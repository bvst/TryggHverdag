/**
 * The escalation to SMS (LOST-07, REL-07, D-019, D-116): an alert nobody has
 * acknowledged within two minutes of its opening is escalated, and every
 * responder of its journey gets an SMS. The watchdog's second job, run by
 * its sweep after the opens, so an escalation that cannot be done fails the
 * sweep and stops the beat, which pages the owner (D-108).
 *
 * One run:
 *   1. reads the alerts due (unresolved, never escalated, not acknowledged in
 *      D-114's sense, and opened two minutes or more before the database's
 *      now()), without locking, and that now() from the same statement;
 *   2. asks the domain's escalation rule about each, and goes on only for one
 *      it escalates;
 *   3. escalates each in a transaction of its own, so one alert's failure
 *      holds up no other. A journey's row someone else holds is skipped, not
 *      waited for: "I'm on it", a heartbeat, or another sweeper;
 *   4. then, for each alert skipped there whose two minutes passed
 *      STUCK_AFTER_MS ago or more, tries once more, waiting at most
 *      LOCK_WAIT_LIMIT_MS for the row. A healthy holder lets go within
 *      milliseconds, and the alert is then escalated, or skipped because the
 *      holder acknowledged or resolved it. Only one held through the wait, or
 *      failed, is stuck: one `escalation_overdue` line naming it.
 * A run fails when its read fails, when an escalation fails, or when it finds
 * a stuck alert. A successful escalation writes no line: the alert's row is
 * its record.
 *
 * Failures are logged as their stage and SQLSTATE only (PRIV-07): the
 * escalation sees alert and journey IDs and nothing else, and never writes an
 * error's message. It reads no clock (AR-03).
 */
import { ESCALATE_AFTER_MS, alertTransition } from '../../domain/journey.ts';
import { sqlstateOf } from '../../domain/sqlstate.ts';
import { LOCK_WAIT_LIMIT_MS, isStuckPast } from '../../domain/watchdog.ts';
import type { DueAlert, Log, WatchdogStore } from '../../ports.ts';

/** What one run came to: whether it succeeded, how many alerts it escalated, and how many it could not. */
export interface EscalationResult {
  ok: boolean;
  escalated: number;
  stuck: number;
}

export interface Escalation {
  escalateDue(): Promise<EscalationResult>;
}

/** What one attempt to escalate an alert came to; `failed` was logged where it happened. */
type Attempt = 'escalated' | 'skipped' | 'held' | 'failed';

export function createEscalation({
  journeys,
  log,
}: {
  journeys: WatchdogStore;
  log: Log;
}): Escalation {
  const attempt = async (alertId: string, lockWaitMs?: number): Promise<Attempt> => {
    try {
      const result = await journeys.escalateAlert({ alertId, lockWaitMs });
      return result.outcome;
    } catch (error) {
      log.write({ event: 'escalation_failed', stage: 'escalate', code: sqlstateOf(error) });
      return 'failed';
    }
  };

  return {
    async escalateDue(): Promise<EscalationResult> {
      let read;
      try {
        read = await journeys.alertsDueForEscalation(ESCALATE_AFTER_MS);
      } catch (error) {
        log.write({ event: 'escalation_failed', stage: 'read', code: sqlstateOf(error) });
        return { ok: false, escalated: 0, stuck: 0 };
      }
      const { now } = read;
      // The read is checked again by the rule (defence in depth, as the
      // open's read is), with the database's times it returned.
      const due = read.alerts.filter(
        ({ id, state, acknowledgedBy, smsRaisedAt, openedAt }) =>
          alertTransition(
            { id, state, acknowledgedBy, smsRaisedAt },
            { type: 'escalate', openedAt, now },
          ).type === 'escalated',
      );
      const pastStuck = ({ openedAt }: DueAlert) =>
        isStuckPast({ since: openedAt, dueAfterMs: ESCALATE_AFTER_MS, now });

      let escalated = 0;
      let failed = false;
      const stuck: string[] = [];
      const waitFor: string[] = [];

      // Every alert's first attempt, before any waits for a row.
      for (const alert of due) {
        const outcome = await attempt(alert.id);
        if (outcome === 'escalated') {
          escalated += 1;
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
        if (outcome === 'escalated') {
          escalated += 1;
        } else if (outcome !== 'skipped') {
          stuck.push(alertId);
        }
      }

      for (const alertId of stuck) {
        log.write({ event: 'escalation_overdue', alertId });
      }
      return { ok: !failed && stuck.length === 0, escalated, stuck: stuck.length };
    },
  };
}
