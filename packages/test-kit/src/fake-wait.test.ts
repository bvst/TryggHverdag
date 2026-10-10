// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The canary's system tests prove "the alert reached the push port within
// 360 s of last contact, by the database's clock" with this fake moving that
// clock. A fake that moved the clock before the work was idle, settled a wait
// early or late, ran the worker's loops at the wrong moments or in the wrong
// order against a wait, kept an aborted wait, or let a stuck run hang the
// test would make those tests pass, or time out, whatever the canary did.
import { describe, expect, test } from 'vitest';
import type { AbortSignalLike } from './fake-check-in.ts';
import { fakeClock } from './fake-clock.ts';
import { fakeWait } from './fake-wait.ts';
import * as kit from './index.ts';

const START = new Date('2026-10-01T21:00:00.000Z');
const SECOND = 1_000;

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

/** A signal that never aborts. */
const never = (): AbortSignalLike => abortable().signal;

/** Lets pending promise callbacks run: a few turns of the microtask queue. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) {
    await Promise.resolve();
  }
}

/** Milliseconds since START on this clock. */
const sinceStart = async (clock: { now(): Promise<Date> }) =>
  (await clock.now()).getTime() - START.getTime();

describe('fakeWait', () => {
  test('a wait settles when the clock reaches its time, not before, and asking does not move the clock', async () => {
    const clock = fakeClock(START);
    const waits = fakeWait({ clock });
    let done = false;

    void waits.wait(15 * SECOND, never()).then(() => {
      done = true;
    });
    await settled();
    expect(done).toBe(false);
    expect(await sinceStart(clock)).toBe(0);
    expect(waits.pending).toBe(1);

    await waits.advance(15 * SECOND - 1);
    expect(done).toBe(false);

    await waits.advance(1);
    expect(done).toBe(true);
    expect(waits.pending).toBe(0);
    expect(waits.asked).toEqual([15 * SECOND]);
  });

  test('every 10 s of the clock it runs the interval’s work, awaited, with the clock at that moment, counted from its first use', async () => {
    const clock = fakeClock(START);
    const seen: number[] = [];
    const waits = fakeWait({
      clock,
      onInterval: async (at) => {
        await settled();
        seen.push(at.getTime() - START.getTime());
        expect(await sinceStart(clock)).toBe(at.getTime() - START.getTime());
      },
    });

    await waits.advance(35 * SECOND);

    expect(seen).toEqual([10 * SECOND, 20 * SECOND, 30 * SECOND]);
    expect(await sinceStart(clock)).toBe(35 * SECOND);

    await waits.advance(5 * SECOND);
    expect(seen).toEqual([10 * SECOND, 20 * SECOND, 30 * SECOND, 40 * SECOND]);
  });

  test('takes events in time order: a wait due before a boundary settles before its work, and one due at a boundary after it', async () => {
    const clock = fakeClock(START);
    const order: string[] = [];
    const waits = fakeWait({
      clock,
      onInterval: (at) => {
        order.push(`loops at ${String((at.getTime() - START.getTime()) / SECOND)} s`);
      },
    });
    void waits.wait(10 * SECOND, never()).then(() => order.push('wait due at 10 s'));
    void waits.wait(9 * SECOND, never()).then(() => order.push('wait due at 9 s'));
    void waits.wait(10 * SECOND, never()).then(() => order.push('second wait due at 10 s'));
    await settled();

    await waits.advance(10 * SECOND);

    expect(order).toEqual([
      'wait due at 9 s',
      'loops at 10 s',
      'wait due at 10 s',
      'second wait due at 10 s',
    ]);
  });

  test('an aborted wait rejects at once with an AbortError and is no longer pending; one asked with a signal already aborted rejects at once', async () => {
    const clock = fakeClock(START);
    const waits = fakeWait({ clock });
    const controller = abortable();

    const waiting = waits.wait(60 * SECOND, controller.signal);
    await settled();
    expect(waits.pending).toBe(1);
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(waits.pending).toBe(0);
    expect(await sinceStart(clock)).toBe(0);

    await expect(waits.wait(SECOND, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  test('run lets the work go as far as it can before moving the clock, then moves it to the earliest wait, and so on, and settles as the work does', async () => {
    const clock = fakeClock(START);
    const waits = fakeWait({ clock });
    const readAt: number[] = [];

    const result = await waits.run(async () => {
      readAt.push(await sinceStart(clock));
      await waits.wait(290 * SECOND, never());
      for (let poll = 0; poll < 3; poll += 1) {
        readAt.push(await sinceStart(clock));
        await waits.wait(2 * SECOND, never());
      }
      return 'done';
    });

    expect(result).toBe('done');
    expect(readAt).toEqual([0, 290 * SECOND, 292 * SECOND, 294 * SECOND]);
    expect(await sinceStart(clock)).toBe(296 * SECOND);
  });

  test('run settles each of several waits held at once in time order: a poll before the run limit that races it', async () => {
    const clock = fakeClock(START);
    const waits = fakeWait({ clock });
    const limit = abortable();

    const outcome = await waits.run(async () => {
      const limitReached = waits.wait(600 * SECOND, limit.signal).then(() => 'limit' as const);
      const polled = (async () => {
        for (let poll = 0; poll < 5; poll += 1) {
          await waits.wait(2 * SECOND, never());
        }
        return 'polled' as const;
      })();
      const first = await Promise.race([limitReached, polled]);
      limit.abort();
      await limitReached.catch(() => undefined);
      return first;
    });

    expect(outcome).toBe('polled');
    expect(await sinceStart(clock)).toBe(10 * SECOND);
    expect(waits.pending).toBe(0);
  });

  test('run stops the clock at the event the work settled after: a wait aborted at a boundary ends the run there, not at the timer it no longer waits for', async () => {
    const clock = fakeClock(START);
    const stop = abortable();
    const waits = fakeWait({
      clock,
      onInterval: (at) => {
        if (at.getTime() - START.getTime() === 100 * SECOND) {
          stop.abort();
        }
      },
    });

    const outcome = await waits.run(async () => {
      try {
        await waits.wait(290 * SECOND, stop.signal);
        return 'waited';
      } catch {
        await waits.wait(5 * SECOND, never());
        return 'stopped';
      }
    });

    expect(outcome).toBe('stopped');
    expect(await sinceStart(clock)).toBe(105 * SECOND);
    expect(waits.pending).toBe(0);
  });

  test('run rejects as the work does', async () => {
    const waits = fakeWait({ clock: fakeClock(START) });
    const error = new Error('the work threw');

    await expect(
      waits.run(async () => {
        await waits.wait(SECOND, never());
        throw error;
      }),
    ).rejects.toBe(error);
  });

  test('run rejects, saying so, when the work waits on something no wait can end', async () => {
    const waits = fakeWait({ clock: fakeClock(START) });

    await expect(waits.run(() => new Promise<never>(() => undefined))).rejects.toThrow(
      /no wait can end/,
    );
  });

  test('run rejects, saying so, when the work is still going after its limit of the clock’s time', async () => {
    const clock = fakeClock(START);
    const waits = fakeWait({ clock });

    await expect(
      waits.run(
        async () => {
          for (;;) {
            await waits.wait(2 * SECOND, never());
          }
        },
        { limitMs: 60 * SECOND },
      ),
    ).rejects.toThrow(/still going 60000 ms/);
    expect(await sinceStart(clock)).toBeLessThanOrEqual(60 * SECOND);
  });

  test('time only moves forward, and the interval is a whole number of milliseconds above 0', async () => {
    const waits = fakeWait({ clock: fakeClock(START) });

    await expect(waits.advance(-1)).rejects.toThrow(/forward/);
    expect(() => fakeWait({ clock: fakeClock(START), intervalMs: 0 })).toThrow(/intervalMs/);
  });

  test('the test kit hands it out', () => {
    expect(kit.fakeWait).toBe(fakeWait);
  });
});
