// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The SMS check's tests prove "a failed SMS pages the owner" by what this fake
// was told, in order. A fake that dropped a report, merged two, could not
// fail, or settled a hung report without its signal would make those tests
// pass whatever the check did.
import { describe, expect, test } from 'vitest';
import type { AbortSignalLike } from './fake-check-in.ts';
import {
  SMS_ALARM_ABORTED,
  SMS_ALARM_REPORTED,
  fakeSmsAlarm,
  type SmsAlarmStatus,
} from './fake-sms-alarm.ts';
import * as kit from './index.ts';

/**
 * An abort signal by shape, which the test aborts by hand. The test kit has
 * no DOM or Node types, so AbortController is not to hand here, as
 * fake-check-in.test.ts says; the server's own tests use the real one.
 */
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

describe('fakeSmsAlarm', () => {
  test('records nothing until a report is made', () => {
    expect(fakeSmsAlarm().reports).toEqual([]);
  });

  test('records every report, in order, with its status and the signal it was given, and adds each to the shared events', async () => {
    const events: string[] = [];
    const alarm = fakeSmsAlarm({ events });
    const { signal } = abortable();
    const statuses: SmsAlarmStatus[] = ['ok', 'failing', 'failing', 'ok'];

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
    expect(events).toEqual(statuses.map((status) => `${SMS_ALARM_REPORTED}: ${status}`));
  });

  test('fails with exactly the error given, still recording the report, and recovers', async () => {
    const alarm = fakeSmsAlarm();
    const error = new Error('the monitor answered 500');
    alarm.failWith(error);

    await expect(alarm.report('failing')).rejects.toBe(error);
    expect(alarm.statuses).toEqual(['failing']);

    alarm.recover();
    await expect(alarm.report('ok')).resolves.toBeUndefined();
  });

  test('a hung report settles only when its signal aborts, saying so in the events; with no signal, never', async () => {
    const events: string[] = [];
    const alarm = fakeSmsAlarm({ events });
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
    expect(events).toContain(SMS_ALARM_ABORTED);
  });

  test('a report handed a signal already aborted, while hanging, rejects at once', async () => {
    const alarm = fakeSmsAlarm();
    alarm.hang();
    const controller = abortable();
    controller.abort();

    await expect(alarm.report('ok', controller.signal)).rejects.toThrow(/aborted/);
  });

  test('what it hands back cannot change what it recorded', async () => {
    const alarm = fakeSmsAlarm();
    await alarm.report('ok');

    const [handedOut] = alarm.reports;
    if (handedOut !== undefined) {
      (handedOut as { status: SmsAlarmStatus }).status = 'failing';
    }

    expect(alarm.statuses).toEqual(['ok']);
  });

  test('the test kit hands it out', () => {
    expect(kit.fakeSmsAlarm).toBe(fakeSmsAlarm);
    expect(kit.SMS_ALARM_REPORTED).toBe(SMS_ALARM_REPORTED);
    expect(kit.SMS_ALARM_ABORTED).toBe(SMS_ALARM_ABORTED);
  });
});
