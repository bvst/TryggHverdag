// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// BUG-45 (D-129): the worker's loop tests and the canary's system tests rest on
// this bound to fail in milliseconds where a loop that no longer waits would
// otherwise starve every timer and hang the run. A bound that never reset
// would fail correct loops; one that reset on a microtask, or on a faked timer
// that never fires, would let the starving chain run on, and the test hang as
// before.
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as kit from './index.ts';
import { turnBound } from './turn-bound.ts';

/**
 * The event loop's own turn, taken before any test fakes the timers. Typed by
 * shape: the test kit has no Node types (see fake-wait.ts).
 */
const realSetImmediate = (globalThis as unknown as { setImmediate: (run: () => void) => unknown })
  .setImmediate;
const aRealTurn = () =>
  new Promise<void>((resolve) => {
    realSetImmediate(resolve);
  });

/** A real timer of 0 ms, taken the same way. */
const realSetTimeout = (
  globalThis as unknown as { setTimeout: (run: () => void, ms: number) => unknown }
).setTimeout;
const realSetTimeoutOf = (run: () => void) => realSetTimeout(run, 0);

afterEach(() => {
  vi.useRealTimers();
});

describe('turnBound', () => {
  test('BUG-45-AC12: up to `most` calls in one turn pass; the next throws at once, naming the work and the count, and is recorded once for the turn', () => {
    const bound = turnBound({ what: 'the synthetic sweep', most: 3 });

    bound.call();
    bound.call();
    bound.call();
    expect(bound.passed).toEqual([]);
    expect(() => {
      bound.call();
    }).toThrow(/the synthetic sweep was called 4 times with no turn of the event loop between/);
    expect(() => {
      bound.call();
    }).toThrow(/the synthetic sweep was called 5 times/);
    expect(bound.passed).toHaveLength(1);
    expect(bound.passed[0]).toContain('the synthetic sweep');
    expect(bound.passed[0]).toContain('BUG-45');
    expect(bound.highest).toBe(5);
  });

  test('BUG-45-AC12: after a turn of the event loop the count starts again, so a loop that waits between its runs is never stopped', async () => {
    const bound = turnBound({ what: 'the synthetic delivery', most: 1 });

    for (let run = 0; run < 20; run += 1) {
      bound.call();
      await aRealTurn();
    }

    expect(bound.passed).toEqual([]);
    expect(bound.highest).toBe(1);
  });

  test('BUG-45-AC12: a loop of promise callbacks that never lets the event loop turn is stopped at `most` + 1 calls, and the test goes on', async () => {
    // The shape of the worker's mutants: each run starts the next in a
    // promise callback. Without the bound this test would never end.
    const bound = turnBound({ what: 'the synthetic read', most: 10 });
    let runs = 0;
    const spin = async (): Promise<void> => {
      for (;;) {
        bound.call();
        runs += 1;
        await Promise.resolve();
      }
    };

    await expect(spin()).rejects.toThrow(/the synthetic read was called 11 times/);
    expect(runs).toBe(10);
    expect(bound.passed).toHaveLength(1);
  });

  test('BUG-45-AC12: answer() answers at once within the bound, and past it only on the next turn of the event loop, recording that it was passed', async () => {
    const bound = turnBound({ what: 'the synthetic sweep', most: 2 });
    const answered: number[] = [];

    for (let run = 1; run <= 3; run += 1) {
      void bound.answer(() => run).then((value) => answered.push(value));
    }
    await Promise.resolve();
    await Promise.resolve();

    expect(answered).toEqual([1, 2]);
    expect(bound.passed).toHaveLength(1);
    expect(bound.passed[0]).toMatch(/the synthetic sweep was called 3 times/);
    await aRealTurn();
    expect(answered).toEqual([1, 2, 3]);
  });

  test('BUG-45-AC12: a loop that catches every error and starts again at once, as the worker’s do, lets the event loop turn once it passes the bound, so a timer fires and stops it', async () => {
    // The shape of worker.ts under its two mutants: a rejected run is only
    // written about, and the next starts at once. Throwing would not break
    // this chain; answering a turn later does.
    const bound = turnBound({ what: 'the synthetic sweep', most: 3 });
    let stopping = false;
    let runs = 0;
    realSetTimeoutOf(() => {
      stopping = true;
    });
    const spin = async (): Promise<void> => {
      while (!stopping) {
        runs += 1;
        try {
          await bound.answer(() => undefined);
        } catch {
          // Written about, and the next run starts at once.
        }
      }
    };

    await spin();

    expect(stopping).toBe(true);
    expect(runs).toBeGreaterThan(3);
    expect(bound.passed.length).toBeGreaterThanOrEqual(1);
    expect(bound.passed.length).toBeLessThanOrEqual(10);
  });

  test('BUG-45-AC12: a test that fakes the timers, setImmediate included, does not stop the count from starting again on the real event loop', async () => {
    const bound = turnBound({ what: 'the synthetic SMS delivery', most: 1 });
    vi.useFakeTimers();

    bound.call();
    await aRealTurn();
    bound.call();
    await aRealTurn();
    bound.call();

    expect(bound.passed).toEqual([]);
  });

  test.each([[0], [-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'BUG-45-AC12: a bound of %s calls is refused, naming it',
    (most) => {
      expect(() => turnBound({ what: 'anything', most })).toThrow(/most must be a whole number/);
    },
  );

  test('BUG-45-AC12: the test kit hands it out beside the other fakes', () => {
    expect(kit.turnBound).toBe(turnBound);
  });
});
