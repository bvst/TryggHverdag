/**
 * The senders (LOST-02, LOST-07, AR-05): deliver the outbox's messages, each
 * to its own channel's port, at least once each, and count one as sent only
 * when the port accepted it. The push sender claims the push kinds only and
 * hands them to the push port; the SMS sender claims the SMS kinds only and
 * hands them to the SMS port. The worker runs each on a loop of its own, so a
 * push provider that never answers never delays an SMS, nor the reverse.
 *
 * Claim, send, mark, and no network call inside a transaction:
 *   1. claim, in one statement, at most CLAIM_BATCH due messages, each with one
 *      attempt more and leased for CLAIM_LEASE_MS, so no other sender takes
 *      them meanwhile;
 *   2. send each, outside any transaction, one at a time;
 *   3. mark each: sent when the port accepted it; otherwise its reason, one
 *      `push_failed` (or `sms_failed`) line, and due again after
 *      `retryDelayMs(attempts)`.
 *
 * A sender that stops between sending and marking loses nothing: once the
 * lease has passed, the message is claimed and sent again with the same
 * message ID, which the push platform collapses; an SMS may go twice, the
 * safe direction. A port that throws counts as UNAVAILABLE. A message is
 * handed to the port with exactly its ID, its recipient and its kind: nothing
 * personal (D-086), and no text, name, number or location for an SMS.
 *
 * Failures are logged as their stage and SQLSTATE, or the port's reason and
 * the message's opaque ID, and never an error's message (PRIV-07). It reads
 * no clock: every due time is the database's (AR-03).
 */
import { sqlstateOf } from '../../domain/sqlstate.ts';
import { CLAIM_BATCH, CLAIM_LEASE_MS, retryDelayMs } from '../../domain/watchdog.ts';
import type {
  AlertMessage,
  ClaimedMessage,
  ClaimedMessages,
  Log,
  LogEvent,
  OutboxStore,
  Push,
  PushFailureReason,
  PushResult,
  Sms,
} from '../../ports.ts';

/** What one delivery came to: messages the port accepted, and messages it did not. */
export interface DeliveryResult {
  sent: number;
  failed: number;
}

export interface Sender {
  deliverDue(): Promise<DeliveryResult>;
}

export type PushSender = Sender;
export type SmsSender = Sender;

/** One channel: how its messages are claimed, the port they go to, and its lines. */
interface Channel {
  claim(request: { limit: number; leaseMs: number }): Promise<ClaimedMessages>;
  port: { send(message: AlertMessage): Promise<PushResult> };
  notAccepted(reason: PushFailureReason, messageId: string): LogEvent;
  failed(stage: 'claim' | 'mark', code: string | null): LogEvent;
}

function createSender(outbox: OutboxStore, log: Log, channel: Channel): Sender {
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
      const result = await channel.port.send({ messageId, recipientId, kind });
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
      log.write(channel.failed('mark', sqlstateOf(error)));
    }
  };

  return {
    async deliverDue(): Promise<DeliveryResult> {
      let claim;
      try {
        claim = await channel.claim({ limit: CLAIM_BATCH, leaseMs: CLAIM_LEASE_MS });
      } catch (error) {
        log.write(channel.failed('claim', sqlstateOf(error)));
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
        log.write(channel.notAccepted(reason, message.messageId));
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

/** The push sender: the push kinds, to the push port. */
export function createPushSender({
  outbox,
  push,
  log,
}: {
  outbox: OutboxStore;
  push: Push;
  log: Log;
}): PushSender {
  return createSender(outbox, log, {
    claim: (request) => outbox.claimDue(request),
    port: push,
    notAccepted: (reason, messageId) => ({ event: 'push_failed', reason, messageId }),
    failed: (stage, code) => ({ event: 'delivery_failed', stage, code }),
  });
}

/** The SMS sender (LOST-07): the SMS kinds, to the SMS port, with the push sender's retries. */
export function createSmsSender({
  outbox,
  sms,
  log,
}: {
  outbox: OutboxStore;
  sms: Sms;
  log: Log;
}): SmsSender {
  return createSender(outbox, log, {
    claim: (request) => outbox.claimDueSms(request),
    port: sms,
    notAccepted: (reason, messageId) => ({ event: 'sms_failed', reason, messageId }),
    failed: (stage, code) => ({ event: 'sms_delivery_failed', stage, code }),
  });
}
