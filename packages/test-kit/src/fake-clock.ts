/**
 * Time a test states rather than waits for (AR-03).
 *
 * Every safety rule in this project is about elapsed time, so "five minutes
 * later" has to be something a test can say in a microsecond. A test that
 * actually waited would be slow, flaky, and — worst — would quietly stop
 * proving the thing it was written for when someone shortened the timeout.
 *
 * Matches the server's Clock port by shape, so the test kit needs no import
 * from the server.
 */

export interface FakeClock {
  now(): Promise<Date>;
  /** Jump to an exact moment. */
  set(at: Date): void;
  /** Move forward. Refuses to go backwards, which no real clock does either. */
  advance(ms: number): void;
  /**
   * From now on every reading fails with this error, as the database clock
   * does when the database cannot be reached. Time still moves while it fails.
   */
  failWith(error: Error): void;
  /** Readings succeed again. */
  recover(): void;
}

export function fakeClock(startAt: Date): FakeClock {
  let current = startAt.getTime();
  let failure: Error | null = null;

  return {
    now(): Promise<Date> {
      if (failure !== null) {
        return Promise.reject(failure);
      }
      return Promise.resolve(new Date(current));
    },
    set(at: Date): void {
      current = at.getTime();
    },
    advance(ms: number): void {
      if (ms < 0) {
        throw new Error(
          `fakeClock.advance(${String(ms)}): time does not go backwards. Use set() if a test ` +
            'really means to jump back, so that intent is visible in the test.',
        );
      }
      current += ms;
    },
    failWith(error: Error): void {
      failure = error;
    },
    recover(): void {
      failure = null;
    },
  };
}
