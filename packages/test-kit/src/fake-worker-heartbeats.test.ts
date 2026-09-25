// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The worker's tests prove "no check-in without a recorded beat" by the order
// this fake and the check-in fake write into one shared list. A fake that
// counted a beat as recorded before its write settled would make those tests
// pass whatever the worker did.
import { describe, expect, test } from 'vitest';
import { CHECKED_IN, fakeCheckIn } from './fake-check-in.ts';
import { BEAT_RECORDED, fakeWorkerHeartbeats } from './fake-worker-heartbeats.ts';

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
