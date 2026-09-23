/**
 * The worker's check-ins, in memory. Stands in for the table the real adapter
 * writes to, so a system test can put the worker in any state — including the
 * two that matter most and are hardest to arrange for real: never started, and
 * stopped an hour ago.
 */

export interface FakeWorkerHeartbeats {
  lastBeat(): Promise<Date | null>;
  record(at: Date): Promise<void>;
}

export function fakeWorkerHeartbeats(lastBeatAt: Date | null = null): FakeWorkerHeartbeats {
  let beat = lastBeatAt;

  return {
    lastBeat(): Promise<Date | null> {
      return Promise.resolve(beat);
    },
    record(at: Date): Promise<void> {
      beat = at;
      return Promise.resolve();
    },
  };
}
