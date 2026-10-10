/**
 * The canary's waits, on the fake clock (REL-10, AR-03, AR-06).
 *
 * The staging canary waits about five minutes for its alert, then polls every
 * 2 s, and bounds its whole run at 10 minutes. Its module keeps no time of its
 * own: it is handed a `Wait`, `(ms, signal) => Promise<void>`, and decides
 * everything on the database's times (the spec's approach item 5). A system
 * test that waited for real would take six minutes a run; this fake lets it
 * take milliseconds, and keeps the worker's loops running as they would.
 *
 * It is a queue of virtual timers on the fake clock that stands in for the
 * database's now():
 *   - `wait(ms, signal)` asks for a timer due `ms` after the clock's now. It
 *     settles when the clock reaches that time, and rejects with an error
 *     named AbortError as soon as its signal aborts (at once if it already
 *     has), as `node:timers/promises`' setTimeout does. A module may hold
 *     several at once, such as a poll and its run limit;
 *   - the clock moves only through `advance` and `run`. Every `intervalMs`
 *     (10 s, D-107) of the clock's time, counted from the clock's time when the
 *     fake is first used, `onInterval` runs, awaited, with the clock at that
 *     moment: the worker's sweep, its push and SMS deliveries, its minute
 *     tasks, as the test wires them. Events are taken in time order: a timer
 *     due before a boundary settles before that boundary's work, and one due
 *     at a boundary settles after it, so a read at the boundary sees what the
 *     loops did there;
 *   - `run(work)` starts the work and lets it go as far as it can by itself:
 *     a few turns of the event loop, enough for every fake here, which answer
 *     a turn later at most. Then, only if it has not settled, the clock moves
 *     on to the next event, a boundary or the earliest pending timer, and so
 *     on, one event at a time; once the work has settled the clock stays at
 *     the event it settled after, so a run's end is read off the clock. Work
 *     that waits on something
 *     no timer can end (a request nobody answers, with no timer racing it)
 *     makes `run` reject, saying so, rather than hang the test; so does work
 *     still going after `limitMs` of the clock's time.
 *
 * No real timer is set for any wait: a system test runs no real timer (the
 * spec's test plan). Matches the server's Wait port by shape; the signal is
 * typed by shape too (see fake-check-in.ts), since the test kit has no DOM or
 * Node types.
 */
import type { AbortSignalLike } from './fake-check-in.ts';
import type { FakeClock } from './fake-clock.ts';

export interface FakeWait {
  /** The server's Wait port: settles `ms` of the clock's time from now, or rejects when `signal` aborts. */
  readonly wait: (ms: number, signal: AbortSignalLike) => Promise<void>;
  /** Every wait asked for, in order, with its length as given. Copies. */
  readonly asked: readonly number[];
  /** How many waits are pending: asked for, and neither settled nor aborted. */
  readonly pending: number;
  /**
   * Moves the clock `ms` on, running `onInterval` at every boundary on the way
   * and settling every wait that falls due, in time order.
   */
  advance(ms: number): Promise<void>;
  /**
   * Runs `work` to its end, moving the clock only when nothing else can
   * happen, and settles as it does. Rejects, naming the reason, when the work
   * waits on something no timer can end, or is still going `limitMs` (one
   * hour, unless given) of the clock's time after it started.
   */
  run<T>(work: () => Promise<T>, options?: { limitMs?: number }): Promise<T>;
}

/** One wait asked for: when it is due, the order it was asked in, and how it settles. */
interface Timer {
  due: number;
  order: number;
  resolve: () => void;
}

/** The timers the event loop offers, typed by what is used: the test kit has no Node types. */
const loop = globalThis as unknown as {
  setImmediate?: (run: () => void) => unknown;
  setTimeout: (run: () => void, ms: number) => unknown;
};

/** One turn of the event loop: every promise callback queued so far has run. */
function aTurn(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (loop.setImmediate === undefined) {
      loop.setTimeout(resolve, 0);
    } else {
      loop.setImmediate(resolve);
    }
  });
}

/** How many turns `run` lets work go on by itself before it moves the clock. */
const TURNS = 25;

/** How long `run` lets work go on in the clock's time unless told otherwise: an hour, six canary run limits. */
const RUN_LIMIT_MS = 3_600_000;

/** What a wait rejects with when its signal aborts: named as Node names it, and holding nothing of the signal's reason. */
function abortError(): Error {
  const error = new Error('The wait was aborted.');
  error.name = 'AbortError';
  return error;
}

export function fakeWait({
  clock,
  intervalMs = 10_000,
  onInterval,
}: {
  clock: FakeClock;
  intervalMs?: number;
  onInterval?: (at: Date) => unknown;
}): FakeWait {
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new Error(
      `fakeWait: intervalMs must be a whole number of milliseconds above 0, not ${String(intervalMs)}.`,
    );
  }
  const asked: number[] = [];
  const timers: Timer[] = [];
  let order = 0;
  /** The next interval boundary, in the clock's time; set when the fake is first used. */
  let nextBoundary: number | null = null;

  const nowMs = async (): Promise<number> => (await clock.now()).getTime();

  const boundaryAfter = async (): Promise<number> => {
    nextBoundary ??= (await nowMs()) + intervalMs;
    return nextBoundary;
  };

  /** Settles every timer due at or before `at`, earliest first, then in the order asked. */
  const settleDue = (at: number): void => {
    const due = timers
      .filter((timer) => timer.due <= at)
      .sort((a, b) => a.due - b.due || a.order - b.order);
    for (const timer of due) {
      timers.splice(timers.indexOf(timer), 1);
      timer.resolve();
    }
  };

  const moveClockTo = async (at: number): Promise<void> => {
    const now = await nowMs();
    if (at > now) {
      clock.advance(at - now);
    }
  };

  /**
   * Moves the clock to `target`, taking each boundary and each due timer in
   * time order, and letting what each set going run before the next. With
   * `done`, it stops after the first event that leaves `done` true, with the
   * clock at that event's time: a run that ended there is not carried on to
   * a later timer it no longer waits for.
   */
  const advanceTo = async (target: number, done?: () => boolean): Promise<void> => {
    for (;;) {
      const boundary = await boundaryAfter();
      const earliestTimer = timers.reduce<number | null>(
        (earliest, timer) => (earliest === null || timer.due < earliest ? timer.due : earliest),
        null,
      );
      const nextTimer = earliestTimer !== null && earliestTimer <= target ? earliestTimer : null;
      const nextEdge = boundary <= target ? boundary : null;
      if (nextTimer === null && nextEdge === null) {
        break;
      }
      const at = Math.min(
        nextTimer ?? Number.POSITIVE_INFINITY,
        nextEdge ?? Number.POSITIVE_INFINITY,
      );
      await moveClockTo(at);
      if (nextEdge === at) {
        nextBoundary = boundary + intervalMs;
        await onInterval?.(new Date(at));
      }
      settleDue(at);
      for (let turn = 0; turn < TURNS; turn += 1) {
        await aTurn();
      }
      if (done?.() === true) {
        return;
      }
    }
    await moveClockTo(target);
  };

  return {
    wait(ms: number, signal: AbortSignalLike): Promise<void> {
      asked.push(ms);
      if (signal.aborted) {
        return Promise.reject(abortError());
      }
      return nowMs().then(
        (now) =>
          new Promise<void>((resolve, reject) => {
            if (signal.aborted) {
              reject(abortError());
              return;
            }
            const length = Number.isFinite(ms) && ms > 0 ? ms : 0;
            const timer: Timer = { due: now + length, order: (order += 1), resolve };
            timers.push(timer);
            signal.addEventListener('abort', () => {
              const at = timers.indexOf(timer);
              if (at !== -1) {
                timers.splice(at, 1);
                reject(abortError());
              }
            });
          }),
      );
    },
    get asked(): readonly number[] {
      return [...asked];
    },
    get pending(): number {
      return timers.length;
    },
    async advance(ms: number): Promise<void> {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new Error(
          `fakeWait.advance(${String(ms)}): time only moves forward, by a finite amount.`,
        );
      }
      await advanceTo((await nowMs()) + ms);
    },
    async run<T>(
      work: () => Promise<T>,
      { limitMs = RUN_LIMIT_MS }: { limitMs?: number } = {},
    ): Promise<T> {
      const startedAt = await nowMs();
      await boundaryAfter();
      // Kept in an object, read through a function, so the checks below read
      // what the callbacks wrote, not what they held when the loop began.
      const state: { settled: boolean; failed: boolean; value?: T; error?: unknown } = {
        settled: false,
        failed: false,
      };
      const settled = (): boolean => state.settled;
      work().then(
        (value) => {
          Object.assign(state, { settled: true, value });
        },
        (error: unknown) => {
          Object.assign(state, { settled: true, failed: true, error });
        },
      );
      for (;;) {
        for (let turn = 0; turn < TURNS && !settled(); turn += 1) {
          await aTurn();
        }
        if (settled()) {
          if (state.failed) {
            throw state.error;
          }
          return state.value as T;
        }
        const next = timers.reduce<number | null>(
          (earliest, timer) => (earliest === null || timer.due < earliest ? timer.due : earliest),
          null,
        );
        if (next === null) {
          throw new Error(
            'fakeWait.run: the work is waiting for something no wait can end, such as a request ' +
              'nobody answers with no timer racing it, so it would never finish.',
          );
        }
        if (next - startedAt > limitMs) {
          throw new Error(
            `fakeWait.run: the work was still going ${String(limitMs)} ms of the clock’s time ` +
              'after it started.',
          );
        }
        await advanceTo(next, settled);
      }
    },
  };
}
