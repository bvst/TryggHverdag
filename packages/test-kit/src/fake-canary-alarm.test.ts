// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The canary's tests prove "a late alert pages the owner at once, and an ok
// is sent only after a run on time" by what this fake was told, in order. A
// fake that dropped a report, merged two, could not fail, settled a hung
// report without its signal, or shared its record with the SMS check's fake
// would make those tests pass whatever the canary did.
import { describe, expect, test } from 'vitest';
import type { AbortSignalLike } from './fake-check-in.ts';
import {
  CANARY_ALARM_ABORTED,
  CANARY_ALARM_REPORTED,
  fakeCanaryAlarm,
  type CanaryAlarmStatus,
} from './fake-canary-alarm.ts';
import { SMS_ALARM_REPORTED, fakeSmsAlarm } from './fake-sms-alarm.ts';
import * as kit from './index.ts';

/** An abort signal by shape, which the test aborts by hand (see fake-sms-alarm.test.ts). */
function abortable(): { signal: AbortSignalLike; abort: () => void } {
  const listeners: (() => void)[] = [];
  const signal = {
    aborted: false,
    reason: undefined as unknown,
    addEventListener(_type: 'abort', listener: () => void) {
      listeners.push(listener);
    },
  };
  return {
    signal,
    abort: () => {
      signal.aborted = true;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

/** Lets pending promise callbacks run: a few turns of the microtask queue. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) {
    await Promise.resolve();
  }
}

describe('fakeCanaryAlarm', () => {
  test('records nothing until a report is made', () => {
    expect(fakeCanaryAlarm().reports).toEqual([]);
  });

  test('records every report, in order, with its status and the signal it was given, and adds each to the shared events', async () => {
    const events: string[] = [];
    const alarm = fakeCanaryAlarm({ events });
    const { signal } = abortable();
    const statuses: CanaryAlarmStatus[] = ['ok', 'failing', 'failing', 'ok'];

    for (const status of statuses) {
      await alarm.report(status, status === 'failing' ? signal : undefined);
    }

    expect(alarm.statuses).toEqual(statuses);
    expect(alarm.reports.map(({ signal: given }) => given)).toEqual([
      undefined,
      signal,
      signal,
      undefined,
    ]);
    expect(events).toEqual(statuses.map((status) => `${CANARY_ALARM_REPORTED}: ${status}`));
  });

  test('keeps a record of its own, apart from the SMS check’s fake, and says which check each shared event is', async () => {
    // The canary's page is its own (REL-10-AC12): a test that hands both to
    // one worker must read which check each report reached.
    const events: string[] = [];
    const canary = fakeCanaryAlarm({ events });
    const sms = fakeSmsAlarm({ events });

    await canary.report('failing');
    await sms.report('ok');

    expect(canary.statuses).toEqual(['failing']);
    expect(sms.statuses).toEqual(['ok']);
    expect(events).toEqual([`${CANARY_ALARM_REPORTED}: failing`, `${SMS_ALARM_REPORTED}: ok`]);
    expect(CANARY_ALARM_REPORTED).not.toBe(SMS_ALARM_REPORTED);
  });

  test('fails with exactly the error given, still recording the report, and recovers', async () => {
    const alarm = fakeCanaryAlarm();
    const error = new Error('the monitor answered 500');
    alarm.failWith(error);

    await expect(alarm.report('failing')).rejects.toBe(error);
    expect(alarm.statuses).toEqual(['failing']);

    alarm.recover();
    await expect(alarm.report('ok')).resolves.toBeUndefined();
  });

  test('a hung report settles only when its signal aborts, saying so in the events; with no signal, never', async () => {
    const events: string[] = [];
    const alarm = fakeCanaryAlarm({ events });
    alarm.hang();
    const controller = abortable();
    const settledWith: string[] = [];

    const withSignal = alarm.report('failing', controller.signal).then(
      () => settledWith.push('resolved'),
      () => settledWith.push('rejected'),
    );
    void alarm.report('failing').then(
      () => settledWith.push('no signal: resolved'),
      () => settledWith.push('no signal: rejected'),
    );
    await settled();
    expect(settledWith).toEqual([]);

    controller.abort();
    await withSignal;
    await settled();
    expect(settledWith).toEqual(['rejected']);
    expect(events).toContain(CANARY_ALARM_ABORTED);
  });

  test('a report handed a signal already aborted, while hanging, rejects at once', async () => {
    const alarm = fakeCanaryAlarm();
    alarm.hang();
    const controller = abortable();
    controller.abort();

    await expect(alarm.report('ok', controller.signal)).rejects.toThrow(/aborted/);
  });

  test('what it hands back cannot change what it recorded', async () => {
    const alarm = fakeCanaryAlarm();
    await alarm.report('ok');

    const [handedOut] = alarm.reports;
    if (handedOut !== undefined) {
      (handedOut as { status: CanaryAlarmStatus }).status = 'failing';
    }

    expect(alarm.statuses).toEqual(['ok']);
  });

  test('the test kit hands it out', () => {
    expect(kit.fakeCanaryAlarm).toBe(fakeCanaryAlarm);
    expect(kit.CANARY_ALARM_REPORTED).toBe(CANARY_ALARM_REPORTED);
    expect(kit.CANARY_ALARM_ABORTED).toBe(CANARY_ALARM_ABORTED);
  });
});
