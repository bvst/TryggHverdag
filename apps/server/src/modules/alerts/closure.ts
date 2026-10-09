/**
 * "They're safe": the responder on an alert closes it, the journey ends, and
 * every other responder is told (LOST-08, SM-06, D-126).
 *
 * Read the alert, ask the close rule, and only then write. The read is a
 * plain one, without a lock: a refusal (no such alert for the sender, or a
 * sender who is not the alert's current acknowledger) and an alert already
 * over are answered from it, so neither a stranger nor a late close ever
 * holds a journey's row. A close the rule allows goes to the store, which
 * takes the journey's row first, asks the same rule again under that lock
 * (AR-04), and writes the end, the resolution and its stand-downs in one
 * transaction (AR-05). Its answer is mapped as the read's would have been.
 *
 * A repeat is answered as an alert already over, ALERT_RESOLVED, as "I'm
 * home"'s repeat is (D-110, D-112): a 200 and a 409 both mean it is over.
 *
 * The module reads no clock: the end's time is the database's now(), in the
 * store's transaction (AR-03, REL-01).
 *
 * The log takes closed events only (PRIV-07): one line naming the alert and
 * the reason when the alert is already over, and one naming the stage and the
 * SQLSTATE when a call fails. Nothing else writes a line: a refusal is the
 * caller's answer, and a close is the alert's and the journey's own record.
 * No user's ID is logged.
 */
import { alertTransition, type CloseRefusal } from '../../domain/journey.ts';
import { sqlstateOf } from '../../domain/sqlstate.ts';
import type { ClosureStore, Log } from '../../ports.ts';

/** "They're safe", as the API hands it over: the responder is the device's own user. */
export interface CloseCall {
  responderId: string;
  alertId: string;
}

/** Closed now; or not, and why. */
export type CloseResult = { type: 'closed' } | CloseRefusal;

export interface ClosureService {
  close(call: CloseCall): Promise<CloseResult>;
}

export function createClosureService({
  alerts,
  log,
}: {
  alerts: ClosureStore;
  log: Log;
}): ClosureService {
  /**
   * Runs one stage. A failure is written as one line naming the stage and its
   * SQLSTATE, and never its message, which can hold anything; then it is
   * thrown on, so the API answers 500: never a 2xx, and never a 401.
   */
  async function stage<T>(name: 'read' | 'store', run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      log.write({ event: 'closure_failed', stage: name, code: sqlstateOf(error) });
      throw error;
    }
  }

  return {
    async close({ responderId, alertId }: CloseCall): Promise<CloseResult> {
      /** What the caller is told when nothing is closed now, and the one line an alert already over gets. */
      const answer = (decision: CloseRefusal): CloseResult => {
        if (decision.type === 'ignored') {
          log.write({ event: 'closure_ignored', reason: decision.reason, alertId });
        }
        return decision;
      };

      const alert = await stage('read', () => alerts.alertForClosure(alertId));
      const decision = alertTransition(alert, { type: 'close', responderId });
      if (decision.type !== 'closed') {
        return answer(decision);
      }

      // The store asks the same rule again under the journey's row, and
      // writes what it decides: whatever committed between the read and the
      // lock, contact back, "I'm home", a removal, another close or the
      // 24-hour end, wins.
      const stored = await stage('store', () => alerts.recordClosure({ alertId, responderId }));
      return stored.outcome === 'closed' ? { type: 'closed' } : answer(stored.decision);
    },
  };
}
