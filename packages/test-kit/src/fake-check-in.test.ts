// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The worker's tests prove "no check-in without a recorded beat" by counting
// what this fake was asked for. A fake that miscounted, or that could not fail,
// would not go red: it would make those tests pass whatever the worker did.
import { describe, expect, test } from 'vitest';
import {
  CHECKED_IN,
  CHECK_IN_ABORTED,
  fakeCheckIn,
  type AbortSignalLike,
} from './fake-check-in.ts';
import * as kit from './index.ts';

describe('fakeCheckIn', () => {
  test('succeeds by default, and has been asked for nothing yet', async () => {
    const checkIn = fakeCheckIn();

    expect(checkIn.calls).toBe(0);
    await expect(checkIn.checkIn()).resolves.toBeUndefined();
    expect(checkIn.calls).toBe(1);
  });

  test('counts every check-in asked for', async () => {
    const checkIn = fakeCheckIn();

    await checkIn.checkIn();
    await checkIn.checkIn();
    await checkIn.checkIn();

    expect(checkIn.calls).toBe(3);
  });

  test('fails with exactly the error it was given, and still counts the attempt', async () => {
    const checkIn = fakeCheckIn();
    const error = new Error('Healthchecks.io answered 500');
    checkIn.failWith(error);

    await expect(checkIn.checkIn()).rejects.toBe(error);
    await expect(checkIn.checkIn()).rejects.toBe(error);
    expect(checkIn.calls).toBe(2);
  });

  test('succeeds again after recovering', async () => {
    const checkIn = fakeCheckIn();
    checkIn.failWith(new Error('timed out'));
    await expect(checkIn.checkIn()).rejects.toThrow('timed out');

    checkIn.recover();

    await expect(checkIn.checkIn()).resolves.toBeUndefined();
    expect(checkIn.calls).toBe(2);
  });

  test('writes each call, failed or not, into the events it shares', async () => {
    const events: string[] = [];
    const checkIn = fakeCheckIn({ events });

    await checkIn.checkIn();
    checkIn.failWith(new Error('no connection'));
    await checkIn.checkIn().catch(() => undefined);

    expect(events).toEqual([CHECKED_IN, CHECKED_IN]);
  });

  test('records the call when it is made, before it settles', () => {
    const events: string[] = [];

    void fakeCheckIn({ events }).checkIn();

    expect(events).toEqual([CHECKED_IN]);
  });
});

// LOST-02 (D-079's second follow-up): the worker hands Graphile's
// `helpers.abortSignal` to the check-in, so a stop no longer waits for a
// Healthchecks.io that never answers. The worker's tests prove that by the
// signal this fake was given, and by a hung check-in that only its signal can
// end. A fake that lost the signal, or ended a hang on its own, would make
// those tests pass whatever the worker handed on.
/**
 * An abort signal by shape, which the test aborts by hand. The test kit has
 * no DOM or Node types, so AbortController is not to hand here; the worker's
 * own tests use the real one.
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

/** Lets pending promise callbacks run: more turns of the microtask queue than any answer takes. */
async function aWhile(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) {
    await Promise.resolve();
  }
}

describe('fakeCheckIn: the abort signal, and a check-in that hangs (LOST-02)', () => {
  test('records the signal each check-in was given, in order, and undefined where it was given none', async () => {
    const checkIn = fakeCheckIn();
    const first = abortable().signal;
    const second = abortable().signal;

    await checkIn.checkIn(first);
    await checkIn.checkIn();
    await checkIn.checkIn(second);

    expect(checkIn.signals).toHaveLength(3);
    expect(checkIn.signals[0]).toBe(first);
    expect(checkIn.signals[1]).toBeUndefined();
    expect(checkIn.signals[2]).toBe(second);
  });

  test('a hung check-in settles only when its signal aborts, rejecting, and says so in the shared events', async () => {
    const events: string[] = [];
    const checkIn = fakeCheckIn({ events });
    checkIn.hang();
    const controller = abortable();
    const settled: string[] = [];

    const hung = checkIn.checkIn(controller.signal).then(
      () => settled.push('resolved'),
      () => settled.push('rejected'),
    );
    await aWhile();
    expect(settled).toEqual([]);

    controller.abort();
    await hung;

    expect(settled).toEqual(['rejected']);
    expect(events).toEqual([CHECKED_IN, CHECK_IN_ABORTED]);
  });

  test('a hung check-in given a signal already aborted rejects at once', async () => {
    const checkIn = fakeCheckIn();
    checkIn.hang();
    const controller = abortable();
    controller.abort();

    await expect(checkIn.checkIn(controller.signal)).rejects.toThrow(/aborted/);
  });

  test('a hung check-in given no signal never settles: nothing else can end it', async () => {
    const checkIn = fakeCheckIn();
    checkIn.hang();
    const settled: string[] = [];

    void checkIn.checkIn().then(
      () => settled.push('resolved'),
      () => settled.push('rejected'),
    );
    await aWhile();

    expect(settled).toEqual([]);
    expect(checkIn.calls).toBe(1);
  });

  test('after recovering, check-ins succeed again instead of hanging', async () => {
    const checkIn = fakeCheckIn();
    checkIn.hang();
    checkIn.recover();

    await expect(checkIn.checkIn(abortable().signal)).resolves.toBeUndefined();
  });

  test('the test kit hands out the entry an aborted check-in writes', () => {
    expect(kit.CHECK_IN_ABORTED).toBe(CHECK_IN_ABORTED);
    expect(CHECK_IN_ABORTED).not.toBe(CHECKED_IN);
  });
});
