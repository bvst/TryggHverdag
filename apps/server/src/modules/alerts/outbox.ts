/**
 * The sender (LOST-02, AR-05): delivers the outbox's messages to the push
 * port, at least once each, and counts one as sent only when the port
 * accepted it.
 *
 * Claim, send, mark, and no network call inside a transaction:
 *   1. claim, in one statement, at most CLAIM_BATCH due messages, each with one
 *      attempt more and leased for CLAIM_LEASE_MS, so no other sender takes
 *      them meanwhile;
 *   2. send each, outside any transaction, one at a time;
 *   3. mark each: sent when the port accepted it; otherwise its reason, one
 *      `push_failed` line, and due again after `retryDelayMs(attempts)`.
 *
 * A sender that stops between sending and marking loses nothing: once the
 * lease has passed, the message is claimed and sent again with the same
 * message ID, which the platform collapses. A port that throws counts as
 * UNAVAILABLE. A message is handed to the port with exactly its ID, its
 * recipient and its kind: nothing personal (D-086).
 *
 * Failures are logged as their stage and SQLSTATE, or the port's reason and
 * the message's opaque ID, and never an error's message (PRIV-07). It reads
 * no clock: every due time is the database's (AR-03).
 */
import { sqlstateOf } from '../../domain/sqlstate.ts';
import { CLAIM_BATCH, CLAIM_LEASE_MS, retryDelayMs } from '../../domain/watchdog.ts';
import type { ClaimedMessage, Log, OutboxStore, Push, PushFailureReason } from '../../ports.ts';

/** What one delivery came to: messages the port accepted, and messages it did not. */
export interface DeliveryResult {
  sent: number;
  failed: number;
}

export interface PushSender {
  deliverDue(): Promise<DeliveryResult>;
}

export function createPushSender({
  outbox,
  push,
  log,
}: {
  outbox: OutboxStore;
  push: Push;
  log: Log;
}): PushSender {
  /**
   * Hands the message to the port: null when the port accepted it, else why
   * not, a throw counted as UNAVAILABLE. Only what the message may carry is
   * handed over.
   */
  const notAcceptedBecause = async ({
    messageId,
    recipientId,
    kind,
  }: ClaimedMessage): Promise<PushFailureReason | null> => {
    try {
      const result = await push.send({ messageId, recipientId, kind });
      return result.outcome === 'accepted' ? null : result.reason;
    } catch {
      return 'UNAVAILABLE';
    }
  };

  /** Runs a mark, and says so in one line if it failed: the lease brings the message back. */
  const mark = async (marking: () => Promise<void>): Promise<void> => {
    try {
      await marking();
    } catch (error) {
      log.write({ event: 'delivery_failed', stage: 'mark', code: sqlstateOf(error) });
    }
  };

  return {
    async deliverDue(): Promise<DeliveryResult> {
      let claim;
      try {
        claim = await outbox.claimDue({ limit: CLAIM_BATCH, leaseMs: CLAIM_LEASE_MS });
      } catch (error) {
        log.write({ event: 'delivery_failed', stage: 'claim', code: sqlstateOf(error) });
        return { sent: 0, failed: 0 };
      }

      let sent = 0;
      let failed = 0;
      for (const message of claim.messages) {
        const reason = await notAcceptedBecause(message);
        if (reason === null) {
          sent += 1;
          await mark(() => outbox.markSent(message.messageId));
          continue;
        }
        failed += 1;
        log.write({ event: 'push_failed', reason, messageId: message.messageId });
        await mark(() =>
          outbox.markFailed({
            messageId: message.messageId,
            reason,
            retryAfterMs: retryDelayMs(message.attempts),
          }),
        );
      }
      return { sent, failed };
    },
  };
}
