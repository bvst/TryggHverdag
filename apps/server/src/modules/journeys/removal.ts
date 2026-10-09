/**
 * Removing a responder from a journey (SM-10, and the last-responder half of
 * SM-02; D-122, D-123). A removed responder is left out of everything that
 * follows; the alert they were on goes back to unacknowledged, so escalation
 * resumes; whatever of theirs is not yet sent is withdrawn; and when they
 * were the last, the walker is warned at once.
 *
 * Written as "I'm on it" is. Read the journey and its responders, ask the
 * removal rule, and only then write. The read is a plain one, without a lock:
 * an answer that writes nothing (no such journey, a journey already ENDED, or
 * someone who is not one of its responders) is given from it, so none of them
 * ever holds a journey's row. A removal the rule would make goes to the store,
 * which takes the journey's row first, asks the same rule again under that
 * lock (AR-04), and writes the removal, the reset, the withdrawals and the
 * warning in one transaction (AR-05). Its answer is mapped as the read's
 * would have been. No event ID: a repeat finds no responder row, and is
 * answered unchanged (D-103's reading).
 *
 * The module reads no clock: every time written is the database's now(), in
 * the store's transaction (AR-03, REL-01).
 *
 * The log takes closed events only (PRIV-07): one line naming the journey and
 * the reason when the journey is over (SM-07), and one naming the stage and
 * the SQLSTATE when a call fails. Nothing else writes a line: a refusal is the
 * caller's answer, and a removal is the journey's own record. No user's ID is
 * logged, neither the removed responder's nor the walker's.
 *
 * No route calls this in M2 (D-122, item 5): only tests construct it. M3's
 * route wires it into the API, with who may remove whom.
 */
import { transition, type RemoveOutcome } from '../../domain/journey.ts';
import { sqlstateOf } from '../../domain/sqlstate.ts';
import type { Log, ResponderStore } from '../../ports.ts';

/** A removal, as a caller hands it over: the journey, and the responder to remove from it. */
export interface RemovalCall {
  journeyId: string;
  responderId: string;
}

/** The rule's outcomes other than "removed now", as the read or the store gave them. */
type NotRemoved = Exclude<RemoveOutcome, { type: 'removed' }>;

/** Removed now; or not, and why. */
export type RemovalResult = { type: 'removed' } | NotRemoved;

export interface RemovalService {
  remove(call: RemovalCall): Promise<RemovalResult>;
}

export function createRemovalService({
  journeys,
  log,
}: {
  journeys: ResponderStore;
  log: Log;
}): RemovalService {
  /**
   * Runs one stage. A failure is written as one line naming the stage and its
   * SQLSTATE, and never its message, which can hold anything; then it is
   * thrown on, so a caller answers it as a failure: never a 2xx.
   */
  async function stage<T>(name: 'read' | 'store', run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      log.write({ event: 'removal_failed', stage: name, code: sqlstateOf(error) });
      throw error;
    }
  }

  return {
    async remove({ journeyId, responderId }: RemovalCall): Promise<RemovalResult> {
      /** What the caller is told when nothing is removed now, and the one line an ended journey gets. */
      const answer = (decision: NotRemoved): RemovalResult => {
        if (decision.type === 'ignored') {
          log.write({ event: 'removal_ignored', reason: decision.reason, journeyId });
        }
        return decision;
      };

      const journey = await stage('read', () => journeys.journeyForRemoval(journeyId));
      const decision = transition(journey, { type: 'remove', responderId });
      if (decision.type !== 'removed') {
        return answer(decision);
      }

      // The store asks the same rule again under the journey's row, and
      // writes what it decides: whatever committed between the read and the
      // lock, a removal of the same responder or the journey's end, wins.
      const stored = await stage('store', () =>
        journeys.removeResponder({ journeyId, responderId }),
      );
      return stored.outcome === 'removed' ? { type: 'removed' } : answer(stored.decision);
    },
  };
}
