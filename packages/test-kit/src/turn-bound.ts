/**
 * A bound on work that is called again and again with no turn of the event
 * loop between (BUG-45, D-129).
 *
 * The worker's loops wait for a timer between runs, and the canary waits on
 * its Wait between reads. A bug that drops that wait turns the loop into a
 * chain of promise callbacks: each run starts the next before the event loop
 * can turn, so no timer ever fires again, Vitest's own per-test timeout among
 * them. A test over fakes that answer at once then hangs, rather than fails,
 * until something outside it kills the run: Stryker scored six such mutants
 * as "timed out" after about 40 s each, and a timeout is not a caught mutant
 * (D-098).
 *
 * A fake that answers at once counts each call here. Up to `most` calls in
 * one turn of the event loop are allowed, which is more than a correct loop
 * makes. Past that, the bound is recorded in `passed`, which a test checks,
 * and the chain is broken in one of two ways:
 *   - `call()` throws at once, naming the work: for a caller that ends on the
 *     error, such as the canary, whose failed read ends its run;
 *   - `answer(make)` answers only on the next turn of the event loop: for a
 *     caller that catches every error and calls again at once, such as the
 *     worker's loops, which write a line about a failed run and start the
 *     next. The timers run again, Vitest's timeout and a stop included, so the
 *     test ends, and fails on what it checks.
 * A turn is what lets a setImmediate callback run, taken from the event loop
 * when this module loads, so a test that fakes the timers afterwards does not
 * stop the count from starting again.
 *
 * The test kit has no Node types, so the event loop's functions are typed by
 * what is used (see fake-wait.ts).
 */

export interface TurnBound {
  /**
   * Counts one call of the work. Throws, naming the work and how often it was
   * called, while more than `most` calls have come with no turn of the event
   * loop between them.
   */
  call(): void;
  /**
   * Counts one call of the work, and answers with what `make` makes: at once
   * within the bound, and past it only on the next turn of the event loop.
   */
  answer<T>(make: () => T): Promise<T>;
  /**
   * Each turn in which the bound was passed, the first ten: the message it
   * gave. Copies.
   */
  readonly passed: readonly string[];
  /** The most calls seen in one turn so far. */
  readonly highest: number;
}

const loop = globalThis as unknown as {
  setImmediate?: (run: () => void) => unknown;
  setTimeout: (run: () => void, ms: number) => unknown;
};

/** The event loop's own turn, taken now: a timer faked later is not this one. */
const realSetImmediate = loop.setImmediate;
const realSetTimeout = loop.setTimeout;

function onTheNextTurn(run: () => void): void {
  if (realSetImmediate === undefined) {
    realSetTimeout.call(globalThis, run, 0);
  } else {
    realSetImmediate.call(globalThis, run);
  }
}

/** How many of the turns that passed the bound are kept: enough to fail on, not a log that grows for as long as a broken loop runs. */
const KEPT = 10;

export function turnBound({ what, most }: { what: string; most: number }): TurnBound {
  if (!Number.isInteger(most) || most < 1) {
    throw new Error(
      `turnBound: most must be a whole number of calls, 1 or more, not ${String(most)}.`,
    );
  }
  const passed: string[] = [];
  let calls = 0;
  let highest = 0;
  let turnAsked = false;

  /** Counts one call; the message when it passes the bound, or null within it. */
  const count = (): string | null => {
    calls += 1;
    highest = Math.max(highest, calls);
    if (!turnAsked) {
      turnAsked = true;
      onTheNextTurn(() => {
        calls = 0;
        turnAsked = false;
      });
    }
    if (calls <= most) {
      return null;
    }
    const message =
      `${what} was called ${String(calls)} times with no turn of the event loop between, ` +
      `more than the ${String(most)} a loop that waits between its runs can make. A loop ` +
      'that no longer waits starves every timer, Vitest’s timeout among them (BUG-45).';
    if (calls === most + 1 && passed.length < KEPT) {
      passed.push(message);
    }
    return message;
  };

  return {
    call(): void {
      const message = count();
      if (message !== null) {
        throw new Error(message);
      }
    },
    answer<T>(make: () => T): Promise<T> {
      if (count() === null) {
        return Promise.resolve(make());
      }
      return new Promise<T>((resolve) => {
        onTheNextTurn(() => {
          resolve(make());
        });
      });
    },
    get passed(): readonly string[] {
      return [...passed];
    },
    get highest(): number {
      return highest;
    },
  };
}
