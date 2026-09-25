// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The worker's tests prove "no check-in without a recorded beat" by counting
// what this fake was asked for. A fake that miscounted, or that could not fail,
// would not go red: it would make those tests pass whatever the worker did.
import { describe, expect, test } from 'vitest';
import { CHECKED_IN, fakeCheckIn } from './fake-check-in.ts';

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
