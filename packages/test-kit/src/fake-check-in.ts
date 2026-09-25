/**
 * The worker's check-in with Healthchecks.io, in memory (INF-08, AR-02).
 *
 * Stands in for the adapter that pings the real check, so no test ever sends
 * one: a ping from a test would tell a real check that the worker is alive.
 * It counts every check-in it is asked for, can fail the way the adapter
 * fails (a non-2xx answer, no connection, a timeout), and writes each call
 * into an `events` list it can share with the other fakes — which is how a
 * test proves that a check-in only ever follows a recorded beat.
 *
 * Matches the server's CheckIn port by shape, so the test kit needs no import
 * from the server.
 */

/** The entry a check-in adds to a shared `events` list, whether it succeeds or not. */
export const CHECKED_IN = 'check-in';

export interface FakeCheckIn {
  checkIn(): Promise<void>;
  /** How many check-ins were asked for, successful or not. */
  readonly calls: number;
  /** From now on every check-in fails with this error. */
  failWith(error: Error): void;
  /** Check-ins succeed again. */
  recover(): void;
}

export function fakeCheckIn({ events }: { events?: string[] } = {}): FakeCheckIn {
  let calls = 0;
  let failure: Error | null = null;

  return {
    checkIn(): Promise<void> {
      calls += 1;
      events?.push(CHECKED_IN);
      return failure === null ? Promise.resolve() : Promise.reject(failure);
    },
    get calls(): number {
      return calls;
    },
    failWith(error: Error): void {
      failure = error;
    },
    recover(): void {
      failure = null;
    },
  };
}
