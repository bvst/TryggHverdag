// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The escalation system tests prove "every responder got an SMS, once, with
// nothing personal" by what this fake recorded and accepted. A fake that
// dropped a message, counted one as accepted before its answer settled,
// tidied what it was handed, shared its record with the push fake, or could
// not fail would make those tests pass whatever the SMS sender did.
import { describe, expect, test } from 'vitest';
import { fakePush, PUSH_FAILURE_REASONS } from './fake-push.ts';
import { fakeSms, type SmsMessage } from './fake-sms.ts';
import * as kit from './index.ts';
import { syntheticUuid } from './synthetic-ids.ts';

function message(recipientId = syntheticUuid()): SmsMessage {
  return { messageId: syntheticUuid(), recipientId, kind: 'LOST_CONTACT_SMS' };
}

/** Lets pending promise callbacks run: a few turns of the microtask queue. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await Promise.resolve();
  }
}

describe('fakeSms', () => {
  test('accepts every message by default, and records each in order, exactly as given', async () => {
    const sms = fakeSms();
    const sent = [message(), message(), message()];

    for (const each of sent) {
      expect(await sms.send(each)).toEqual({ outcome: 'accepted' });
    }

    expect(sms.messages).toEqual(sent);
    expect(sms.accepted).toEqual(sent);
  });

  test('records every key a message was given, so one that carried more than its type allows still shows', async () => {
    const sms = fakeSms();
    const carrying = { ...message(), text: 'not for an SMS port' } as unknown as SmsMessage;

    await sms.send(carrying);

    expect(Object.keys(sms.messages[0] ?? {})).toContain('text');
  });

  test('answers one recipient with its reason, and every recipient with the reason for all, each of the four; throws for one or for all; recovers', async () => {
    const sms = fakeSms();
    const noNumber = syntheticUuid();
    sms.failFor(noNumber, 'NO_TARGET');

    expect(await sms.send(message(noNumber))).toEqual({ outcome: 'failed', reason: 'NO_TARGET' });
    expect(await sms.send(message())).toEqual({ outcome: 'accepted' });

    for (const reason of PUSH_FAILURE_REASONS) {
      const all = fakeSms();
      all.failAll(reason);
      expect(await all.send(message()), reason).toEqual({ outcome: 'failed', reason });
      expect(all.accepted, reason).toEqual([]);
    }

    const thrown = new Error('the provider fell over');
    sms.throwWith(thrown);
    await expect(sms.send(message())).rejects.toBe(thrown);
    sms.recover();
    expect(await sms.send(message(noNumber))).toEqual({ outcome: 'accepted' });
  });

  test('held answers wait until released, and a message counts as accepted only once its answer has settled', async () => {
    const sms = fakeSms();
    sms.holdAnswers();
    const answers: unknown[] = [];

    const answering = sms.send(message()).then((answer) => answers.push(answer));
    await settled();
    expect(answers).toEqual([]);
    expect(sms.messages).toHaveLength(1);
    expect(sms.accepted).toEqual([]);

    sms.releaseAnswers();
    await answering;
    expect(answers).toEqual([{ outcome: 'accepted' }]);
    expect(sms.accepted).toHaveLength(1);
  });

  test('keeps a record of its own: what an SMS fake is handed never shows in a push fake, nor the reverse', async () => {
    const sms = fakeSms();
    const push = fakePush();
    const toSms = message();
    const toPush = { ...message(), kind: 'LOST_CONTACT' as const };

    await sms.send(toSms);
    await push.send(toPush);
    sms.failAll('NOT_CONFIGURED');

    expect(sms.messages).toEqual([toSms]);
    expect(push.messages).toEqual([toPush]);
    expect(await push.send(toPush)).toEqual({ outcome: 'accepted' });
  });

  test('what it hands back, and what it was given, cannot change what it recorded', async () => {
    const sms = fakeSms();
    const given = message();
    const original = { ...given };
    await sms.send(given);

    given.recipientId = syntheticUuid();
    const handedOut = sms.messages[0];
    if (handedOut !== undefined) {
      handedOut.messageId = syntheticUuid();
    }

    expect(sms.messages).toEqual([original]);
    expect(sms.accepted).toEqual([original]);
  });

  test('the test kit hands it out', () => {
    expect(kit.fakeSms).toBe(fakeSms);
  });
});
