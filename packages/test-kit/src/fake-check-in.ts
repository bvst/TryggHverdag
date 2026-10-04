/**
 * The worker's check-in with Healthchecks.io, in memory (INF-08, AR-02).
 *
 * Stands in for the adapter that pings the real check, so no test ever sends
 * one: a ping from a test would tell a real check that the worker is alive.
 * It counts every check-in it is asked for, can fail the way the adapter
 * fails (a non-2xx answer, no connection, a timeout), and writes each call
 * into an `events` list it can share with the other fakes — which is how a
 * test proves that a check-in only ever follows a fresh beat.
 *
 * LOST-02 (D-079's second follow-up): it records the abort signal each
 * check-in was given, and it can hang the way a Healthchecks.io that never
 * answers does. A hung check-in settles only when its signal aborts, as the
 * real adapter's fetch does, and never when it was given none: that is how a
 * test tells a worker that hands Graphile's `helpers.abortSignal` on from one
 * that does not. When its signal aborts it adds CHECK_IN_ABORTED to the shared
 * `events`, so a test can say which came first: the abort, or the pool's end.
 *
 * Matches the server's CheckIn port by shape, so the test kit needs no import
 * from the server. The signal is typed by shape too: the test kit has no DOM
 * or Node types (see synthetic-ids.ts).
 */

/** The entry a check-in adds to a shared `events` list, whether it succeeds or not. */
export const CHECKED_IN = 'check-in';

/** The entry a hung check-in adds to a shared `events` list when its signal aborts it. */
export const CHECK_IN_ABORTED = 'check-in aborted';

/** What a check-in needs of an AbortSignal, by shape. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: 'abort', listener: () => void): void;
}

export interface FakeCheckIn {
  checkIn(signal?: AbortSignalLike): Promise<void>;
  /** How many check-ins were asked for, successful or not. */
  readonly calls: number;
  /** The signal each check-in was given, in order: `undefined` where none was. */
  readonly signals: readonly (AbortSignalLike | undefined)[];
  /** From now on every check-in fails with this error. */
  failWith(error: Error): void;
  /**
   * From now on every check-in hangs: it settles only when its signal aborts,
   * rejecting with an error that says so, and never if it was given no signal.
   */
  hang(): void;
  /** Check-ins succeed again. One already hung stays hung until its signal aborts. */
  recover(): void;
}

/** Why a hung check-in ended: its signal aborted. Never the signal's own reason, which could be anything. */
function abortedError(): Error {
  return new Error('The check-in was aborted before Healthchecks.io answered.');
}

export function fakeCheckIn({ events }: { events?: string[] } = {}): FakeCheckIn {
  let calls = 0;
  const signals: (AbortSignalLike | undefined)[] = [];
  let failure: Error | null = null;
  let hanging = false;

  return {
    checkIn(signal?: AbortSignalLike): Promise<void> {
      calls += 1;
      signals.push(signal);
      events?.push(CHECKED_IN);
      if (hanging) {
        return new Promise<void>((_resolve, reject) => {
          if (signal === undefined) {
            return;
          }
          const abort = () => {
            events?.push(CHECK_IN_ABORTED);
            reject(abortedError());
          };
          if (signal.aborted) {
            abort();
            return;
          }
          signal.addEventListener('abort', abort);
        });
      }
      return failure === null ? Promise.resolve() : Promise.reject(failure);
    },
    get calls(): number {
      return calls;
    },
    get signals(): readonly (AbortSignalLike | undefined)[] {
      return [...signals];
    },
    failWith(error: Error): void {
      failure = error;
    },
    hang(): void {
      hanging = true;
    },
    recover(): void {
      failure = null;
      hanging = false;
    },
  };
}
