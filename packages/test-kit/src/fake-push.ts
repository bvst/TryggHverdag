/**
 * The push port, recording (LOST-02, D-086, D-087).
 *
 * Stands in for APNs and FCM, which M3's adapter will reach. A system test
 * hands this to the sender and reads back exactly which messages reached the
 * port, in order, and with what in them: "every responder was alerted" is
 * proven by what was accepted here, and "content-free" by the keys each
 * message carried.
 *
 * It records every message it is handed, as given, whatever it answers, so a
 * message that carried more than its type allows still shows. It accepts
 * every message unless told otherwise. It can be told to answer one of the
 * port's reasons for one recipient or for all, to throw, to recover, and to
 * hold its answers until released: a provider that is slow, or one that
 * never answers, for a sender that stops between sending and marking.
 *
 * It answers a turn later, as the other fakes do, and counts a message as
 * accepted only once that answer has settled, so a sender that forgot to wait
 * for the port cannot look, to a test, as though it had waited.
 *
 * Matches the server's Push port by shape, so the test kit needs no import
 * from the server.
 */

/** Why the port did not accept a message: the push port's closed set of reasons. */
export type PushFailureReason = 'NO_TARGET' | 'REFUSED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';

/** Every reason the port may give, in the spec's order. */
export const PUSH_FAILURE_REASONS: readonly PushFailureReason[] = [
  'NO_TARGET',
  'REFUSED',
  'UNAVAILABLE',
  'NOT_CONFIGURED',
];

/** The kinds of message there are. Only the lost-contact alert, for now. */
export type MessageKind = 'LOST_CONTACT';

/** A message as the sender hands it to the port: no personal detail, only who and what kind. */
export interface PushMessage {
  messageId: string;
  recipientId: string;
  kind: MessageKind;
}

export type PushResult = { outcome: 'accepted' } | { outcome: 'failed'; reason: PushFailureReason };

export interface FakePush {
  send(message: PushMessage): Promise<PushResult>;
  /** Every message handed to `send`, in order, as given, whatever it was answered. Copies. */
  readonly messages: readonly PushMessage[];
  /** The messages it accepted, in the order their answers settled. Copies. */
  readonly accepted: readonly PushMessage[];
  /** From now on, every message for this recipient is answered with this reason. */
  failFor(recipientId: string, reason: PushFailureReason): void;
  /** From now on, every message is answered with this reason, unless its recipient has one of its own. */
  failAll(reason: PushFailureReason): void;
  /** From now on, `send` rejects with this error: for this recipient only, or for every one. */
  throwWith(error: Error, recipientId?: string): void;
  /** Accepts every message again. Answers held are not released by this. */
  recover(): void;
  /** From now on, every answer waits until `releaseAnswers()`. */
  holdAnswers(): void;
  /** Lets every held answer go, and answers at once again from now on. */
  releaseAnswers(): void;
}

/** A recipient ID as the store hands it out: lower-case, as a uuid column returns it. */
function keyOf(recipientId: string): string {
  return recipientId.toLowerCase();
}

export function fakePush(): FakePush {
  const messages: PushMessage[] = [];
  const accepted: PushMessage[] = [];
  const reasonFor = new Map<string, PushFailureReason>();
  const errorFor = new Map<string, Error>();
  let reasonForAll: PushFailureReason | null = null;
  let errorForAll: Error | null = null;
  let held: (() => void)[] | null = null;

  /** What the port answers this message with, decided when the answer is given. */
  const decide = (message: PushMessage): PushResult => {
    const key = keyOf(message.recipientId);
    const error = errorFor.get(key) ?? errorForAll;
    if (error !== null) {
      throw error;
    }
    const reason = reasonFor.get(key) ?? reasonForAll;
    if (reason !== null) {
      return { outcome: 'failed', reason };
    }
    accepted.push({ ...message });
    return { outcome: 'accepted' };
  };

  return {
    send(message) {
      messages.push({ ...message });
      const wait =
        held === null
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              held?.push(resolve);
            });
      return wait.then(() => decide(message));
    },
    get messages() {
      return messages.map((message) => ({ ...message }));
    },
    get accepted() {
      return accepted.map((message) => ({ ...message }));
    },
    failFor(recipientId, reason) {
      reasonFor.set(keyOf(recipientId), reason);
    },
    failAll(reason) {
      reasonForAll = reason;
    },
    throwWith(error, recipientId) {
      if (recipientId === undefined) {
        errorForAll = error;
      } else {
        errorFor.set(keyOf(recipientId), error);
      }
    },
    recover() {
      reasonFor.clear();
      errorFor.clear();
      reasonForAll = null;
      errorForAll = null;
    },
    holdAnswers() {
      held ??= [];
    },
    releaseAnswers() {
      const waiting = held ?? [];
      held = null;
      for (const release of waiting) {
        release();
      }
    },
  };
}
