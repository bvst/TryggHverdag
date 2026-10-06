/**
 * "I'm on it": a responder acknowledges an open alert, it is recorded on the
 * alert, and every other responder is told (LOST-06, D-113, D-114).
 *
 * Read the alert, ask the alert rule, and only then write. The read is a
 * plain one, without a lock: a refusal that cannot change (no such alert for
 * the sender, or an alert already RESOLVED, which is final) is answered from
 * it, so neither a stranger nor a late acknowledgement ever holds a journey's
 * row. An acknowledgement the rule would record goes to the store, which takes
 * the journey's row first, asks the same rule again under that lock (AR-04),
 * and writes the acknowledgement and its notices in one transaction (AR-05).
 * Its answer is mapped as the read's would have been.
 *
 * The module reads no clock: the time recorded is the database's now(), in
 * the store's transaction (AR-03, SM-09).
 *
 * The log takes closed events only (PRIV-07): one line naming the alert and
 * the reason when the alert is over, and one naming the stage and the
 * SQLSTATE when a call fails. Nothing else writes a line: a refusal is the
 * caller's answer, and a recorded acknowledgement is the alert's own record.
 * No user's ID is logged.
 */
import {
  alertTransition,
  type AcknowledgeOutcome,
  type AcknowledgeRefusal,
} from '../../domain/journey.ts';
import { sqlstateOf } from '../../domain/sqlstate.ts';
import type { AlertStore, Log } from '../../ports.ts';

/** "I'm on it", as the API hands it over: the responder is the device's own user. */
export interface AcknowledgeCall {
  responderId: string;
  alertId: string;
}

/** The rule's outcomes other than "recorded now", as the read or the store gave them. */
type NotRecorded = Exclude<AcknowledgeOutcome, { type: 'acknowledged' }>;

/** On it: recorded now, or already the caller's; or not, and why. */
export type AcknowledgeResult = { type: 'acknowledged' } | AcknowledgeRefusal;

export interface AcknowledgementService {
  acknowledge(call: AcknowledgeCall): Promise<AcknowledgeResult>;
}

export function createAcknowledgementService({
  alerts,
  log,
}: {
  alerts: AlertStore;
  log: Log;
}): AcknowledgementService {
  /**
   * Runs one stage. A failure is written as one line naming the stage and its
   * SQLSTATE, and never its message, which can hold anything; then it is
   * thrown on, so the API answers 500: never a 2xx, and never a 401.
   */
  async function stage<T>(name: 'read' | 'store', run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      log.write({ event: 'acknowledgement_failed', stage: name, code: sqlstateOf(error) });
      throw error;
    }
  }

  return {
    async acknowledge({ responderId, alertId }: AcknowledgeCall): Promise<AcknowledgeResult> {
      /** What the caller is told when nothing is recorded now, and the one line an alert already over gets. */
      const answer = (decision: NotRecorded): AcknowledgeResult => {
        switch (decision.type) {
          case 'unchanged':
            // ALREADY_YOURS: a repeat whose first answer was lost (SM-08).
            return { type: 'acknowledged' };
          case 'ignored':
            log.write({ event: 'acknowledgement_ignored', reason: decision.reason, alertId });
            return decision;
          case 'refused':
            return decision;
        }
      };

      const alert = await stage('read', () => alerts.alertForAcknowledgement(alertId));
      const decision = alertTransition(alert, { type: 'acknowledge', responderId });
      if (decision.type !== 'acknowledged') {
        return answer(decision);
      }

      // The store asks the same rule again under the journey's row, and
      // writes what it decides: whatever committed between the read and the
      // lock, another responder's acknowledgement or a resolution, wins.
      const stored = await stage('store', () =>
        alerts.recordAcknowledgement({ alertId, responderId }),
      );
      return stored.outcome === 'acknowledged' ? { type: 'acknowledged' } : answer(stored.decision);
    },
  };
}
