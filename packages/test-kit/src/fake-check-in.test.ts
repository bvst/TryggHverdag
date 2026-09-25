// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The worker's tests prove "no check-in without a recorded beat" by counting
// what this fake was asked for. A fake that miscounted, or that could not fail,
// would not go red: it would make those tests pass whatever the worker did.
import { describe, expect, test } from 'vitest';
import { CHECKED_IN, fakeCheckIn } from './fake-check-in.ts';
import { BEAT_RECORDED, fakeWorkerHeartbeats } from './fake-worker-heartbeats.ts';
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

describe('fakeWorkerHeartbeats', () => {
  test('a recorded beat is the last beat, and joins the shared events', async () => {
    const events: string[] = [];
    const heartbeats = fakeWorkerHeartbeats(null, { events });
    const at = new Date('2026-09-23T22:15:00.000Z');

    await heartbeats.record(at);

    expect(await heartbeats.lastBeat()).toEqual(at);
    expect(events).toEqual([BEAT_RECORDED]);
  });

  test('counts as recorded only once the write has settled, not when it is asked for', async () => {
    // A worker that asked for the write and did not wait for it must not look,
    // to a test, like one that waited.
    const events: string[] = [];
    const heartbeats = fakeWorkerHeartbeats(null, { events });

    const writing = heartbeats.record(new Date('2026-09-23T22:15:00.000Z'));
    expect(events).toEqual([]);

    await writing;
    expect(events).toEqual([BEAT_RECORDED]);
  });

  test('a failing write fails with the error given, and records nothing', async () => {
    const events: string[] = [];
    const before = new Date('2026-09-23T22:14:00.000Z');
    const heartbeats = fakeWorkerHeartbeats(before, { events });
    const error = new Error('the database went away');
    heartbeats.failWith(error);

    await expect(heartbeats.record(new Date('2026-09-23T22:15:00.000Z'))).rejects.toBe(error);

    expect(await heartbeats.lastBeat()).toEqual(before);
    expect(events).toEqual([]);
  });

  test('records again after recovering', async () => {
    const heartbeats = fakeWorkerHeartbeats(null);
    const at = new Date('2026-09-23T22:15:00.000Z');
    heartbeats.failWith(new Error('the database went away'));
    await heartbeats.record(at).catch(() => undefined);

    heartbeats.recover();
    await heartbeats.record(at);

    expect(await heartbeats.lastBeat()).toEqual(at);
  });

  test('shares one ordered list with the check-in fake', async () => {
    const events: string[] = [];
    const heartbeats = fakeWorkerHeartbeats(null, { events });
    const checkIn = fakeCheckIn({ events });

    await heartbeats.record(new Date('2026-09-23T22:15:00.000Z'));
    await checkIn.checkIn();

    expect(events).toEqual([BEAT_RECORDED, CHECKED_IN]);
  });
});

describe('the test kit', () => {
  test('hands out the check-in fake and fast-check beside the others', () => {
    expect(kit.fakeCheckIn).toBe(fakeCheckIn);
    expect(typeof kit.fc.assert).toBe('function');
    expect(typeof kit.fc.asyncProperty).toBe('function');
  });
});
