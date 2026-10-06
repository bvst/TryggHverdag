// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The lost-contact system tests prove "every responder was alerted, once,
// with nothing personal" by what this fake recorded and accepted. A fake that
// dropped a message, counted one as accepted before its answer settled,
// tidied what it was handed, or could not fail would make those tests pass
// whatever the sender did.
import { describe, expect, test } from 'vitest';
import { MESSAGE_KINDS, PUSH_FAILURE_REASONS, fakePush, type PushMessage } from './fake-push.ts';
import * as kit from './index.ts';
import { syntheticUuid } from './synthetic-ids.ts';

function message(recipientId = syntheticUuid()): PushMessage {
  return { messageId: syntheticUuid(), recipientId, kind: 'LOST_CONTACT' };
}

/**
 * Lets pending promise callbacks run: a few turns of the microtask queue,
 * more than any answer of the fake takes. The test kit has no Node types.
 */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await Promise.resolve();
  }
}

describe('fakePush', () => {
  test('accepts every message by default, and records each in order, as given', async () => {
    const push = fakePush();
    const sent = [message(), message(), message()];

    for (const each of sent) {
      expect(await push.send(each)).toEqual({ outcome: 'accepted' });
    }

    expect(push.messages).toEqual(sent);
    expect(push.accepted).toEqual(sent);
  });

  test('records every key a message was given, so one that carried more than its type allows still shows', async () => {
    const push = fakePush();
    const carrying = { ...message(), latitude: 0.5 } as unknown as PushMessage;

    await push.send(carrying);

    expect(push.messages).toEqual([carrying]);
    expect(Object.keys(push.messages[0] ?? {})).toContain('latitude');
  });

  test('answers one recipient with the reason it was told, every other one accepted, and records both', async () => {
    const push = fakePush();
    const silent = syntheticUuid();
    push.failFor(silent, 'NO_TARGET');
    const toSilent = message(silent);
    const toOther = message();

    expect(await push.send(toSilent)).toEqual({ outcome: 'failed', reason: 'NO_TARGET' });
    expect(await push.send(toOther)).toEqual({ outcome: 'accepted' });

    expect(push.messages).toEqual([toSilent, toOther]);
    expect(push.accepted).toEqual([toOther]);
  });

  test.each(PUSH_FAILURE_REASONS)(
    'answers every recipient with %s when told to, and accepts nothing',
    async (reason) => {
      const push = fakePush();
      push.failAll(reason);

      expect(await push.send(message())).toEqual({ outcome: 'failed', reason });
      expect(push.accepted).toEqual([]);
    },
  );

  test('a recipient’s own reason comes before the reason for all, matched in either case', async () => {
    const push = fakePush();
    const recipient = syntheticUuid();
    push.failAll('UNAVAILABLE');
    push.failFor(recipient.toUpperCase(), 'REFUSED');

    expect(await push.send(message(recipient))).toEqual({ outcome: 'failed', reason: 'REFUSED' });
    expect(await push.send(message())).toEqual({ outcome: 'failed', reason: 'UNAVAILABLE' });
  });

  test('throws exactly the error given, for one recipient or for all, and still records the message', async () => {
    const push = fakePush();
    const recipient = syntheticUuid();
    const forOne = new Error('the provider fell over for one');
    const forAll = new Error('the provider fell over');
    push.throwWith(forOne, recipient);

    await expect(push.send(message(recipient))).rejects.toBe(forOne);
    expect(await push.send(message())).toEqual({ outcome: 'accepted' });

    push.throwWith(forAll);
    await expect(push.send(message())).rejects.toBe(forAll);
    expect(push.messages).toHaveLength(3);
    expect(push.accepted).toHaveLength(1);
  });

  test('accepts again after recovering', async () => {
    const push = fakePush();
    push.failAll('NOT_CONFIGURED');
    push.throwWith(new Error('down'));

    push.recover();

    expect(await push.send(message())).toEqual({ outcome: 'accepted' });
  });

  test('a message counts as accepted only once its answer has settled, not when it is handed in', async () => {
    const push = fakePush();
    const one = message();

    const answering = push.send(one);
    expect(push.messages).toEqual([one]);
    expect(push.accepted).toEqual([]);
    await answering;
    expect(push.accepted).toEqual([one]);
  });

  test('held answers wait until released, as a provider that is slow or never answers; then each is answered', async () => {
    const push = fakePush();
    push.holdAnswers();
    const answers: unknown[] = [];

    const first = push.send(message()).then((answer) => answers.push(answer));
    const second = push.send(message()).then((answer) => answers.push(answer));
    await settled();
    expect(answers).toEqual([]);
    expect(push.messages).toHaveLength(2);
    expect(push.accepted).toEqual([]);

    push.releaseAnswers();
    await Promise.all([first, second]);

    expect(answers).toEqual([{ outcome: 'accepted' }, { outcome: 'accepted' }]);
    expect(push.accepted).toHaveLength(2);
    expect(await push.send(message())).toEqual({ outcome: 'accepted' });
  });

  test('what it hands back, and what it was given, cannot change what it recorded', async () => {
    const push = fakePush();
    const given = message();
    const original = { ...given };
    await push.send(given);

    given.recipientId = syntheticUuid();
    const handedOut = push.messages[0];
    if (handedOut !== undefined) {
      handedOut.messageId = syntheticUuid();
    }

    expect(push.messages).toEqual([original]);
    expect(push.accepted).toEqual([original]);
  });

  test('records and accepts a message of every kind, the two stand-downs included, each exactly as given (LOST-03)', async () => {
    const push = fakePush();
    const sent = MESSAGE_KINDS.map((kind) => ({ ...message(), kind }));

    for (const each of sent) {
      expect(await push.send(each)).toEqual({ outcome: 'accepted' });
    }

    expect(MESSAGE_KINDS).toEqual(['LOST_CONTACT', 'BACK_IN_CONTACT', 'HOME']);
    expect(push.messages).toEqual(sent);
    expect(push.accepted).toEqual(sent);
    expect(kit.MESSAGE_KINDS).toBe(MESSAGE_KINDS);
  });

  test('the reasons are the push port’s four, and the test kit hands the fake out', () => {
    expect(PUSH_FAILURE_REASONS).toEqual(['NO_TARGET', 'REFUSED', 'UNAVAILABLE', 'NOT_CONFIGURED']);
    expect(kit.fakePush).toBe(fakePush);
    expect(kit.PUSH_FAILURE_REASONS).toBe(PUSH_FAILURE_REASONS);
  });
});
