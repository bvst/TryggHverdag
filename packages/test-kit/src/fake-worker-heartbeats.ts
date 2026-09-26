/**
 * The worker's check-ins, in memory. Stands in for the table the real adapter
 * writes to, so a system test can put the worker in any state — including the
 * two that matter most and are hardest to arrange for real: never started, and
 * stopped an hour ago.
 *
 * It can also fail, and it can write what it did into a list shared with other
 * fakes, so a test can say what happened in which order (INF-08: a check-in
 * with Healthchecks.io only ever follows a recorded beat).
 */

/** The entry a recorded beat adds to a shared `events` list. */
export const BEAT_RECORDED = 'beat recorded';

export interface FakeWorkerHeartbeats {
  lastBeat(): Promise<Date | null>;
  record(at: Date): Promise<void>;
  /** From now on every `record` fails with this error and records nothing. */
  failWith(error: Error): void;
  /** `record` succeeds again. */
  recover(): void;
}

export function fakeWorkerHeartbeats(
  lastBeatAt: Date | null = null,
  { events }: { events?: string[] } = {},
): FakeWorkerHeartbeats {
  let beat = lastBeatAt;
  let failure: Error | null = null;

  return {
    lastBeat(): Promise<Date | null> {
      return Promise.resolve(beat);
    },
    record(at: Date): Promise<void> {
      // Settles a turn later, as a real write does, and only then counts as
      // recorded. Recording on the call itself would let code that forgot to
      // wait for the write look, to a test, as though it had waited.
      return Promise.resolve().then(() => {
        if (failure !== null) {
          throw failure;
        }
        beat = at;
        events?.push(BEAT_RECORDED);
      });
    },
    failWith(error: Error): void {
      failure = error;
    },
    recover(): void {
      failure = null;
    },
  };
}
