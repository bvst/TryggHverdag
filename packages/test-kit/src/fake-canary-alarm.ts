/**
 * The staging canary's report to the owner's monitor, in memory (REL-10,
 * D-079, D-128, AR-02).
 *
 * Stands in for the adapter that tells the canary's own Healthchecks.io
 * check, `staging-canary`, how each run went: `ok` after a run whose alert
 * reached the push port on time, `failing` (the check's `/fail` address, which
 * pages at once) after any other reported outcome. So no test ever reports to
 * a real check. It records every report in order with its status and the
 * abort signal it was given, can fail the way the adapter fails (a non-2xx
 * answer, no connection, a timeout), and can hang the way a Healthchecks.io
 * that never answers does: a hung report settles only when its signal aborts,
 * and never when it was given none. Each report, and each abort of a hung one,
 * is added to an `events` list it can share with the other fakes, so a test
 * can say what came first.
 *
 * Its own fake, apart from the SMS check's (`fakeSmsAlarm`), with entries of
 * its own in the shared list: the canary's page is its own and must never
 * touch the others (REL-10-AC12), so a test that hands both to one worker
 * reads which check each report reached.
 *
 * Matches the server's CanaryAlarm port by shape, so the test kit needs no
 * import from the server.
 */
import type { AbortSignalLike } from './fake-check-in.ts';

/** What a report tells the monitor: the run passed, or it did not. */
export type CanaryAlarmStatus = 'ok' | 'failing';

/** The entry a report adds to a shared `events` list, whether it succeeds or not. */
export const CANARY_ALARM_REPORTED = 'canary alarm reported';

/** The entry a hung report adds to a shared `events` list when its signal aborts it. */
export const CANARY_ALARM_ABORTED = 'canary alarm aborted';

/** One report as it was asked for: its status, and its signal, `undefined` where none was given. */
export interface CanaryAlarmReport {
  status: CanaryAlarmStatus;
  signal: AbortSignalLike | undefined;
}

export interface FakeCanaryAlarm {
  report(status: CanaryAlarmStatus, signal?: AbortSignalLike): Promise<void>;
  /** Every report asked for, successful or not, in order, with its signal. Copies. */
  readonly reports: readonly CanaryAlarmReport[];
  /** The statuses alone, in order: a shorthand for `reports`. */
  readonly statuses: readonly CanaryAlarmStatus[];
  /** From now on every report fails with this error. */
  failWith(error: Error): void;
  /**
   * From now on every report hangs: it settles only when its signal aborts,
   * rejecting with an error that says so, and never if it was given no signal.
   */
  hang(): void;
  /** Reports succeed again. One already hung stays hung until its signal aborts. */
  recover(): void;
}

/** Why a hung report ended: its signal aborted. Never the signal's own reason, which could be anything. */
function abortedError(): Error {
  return new Error('The canary’s report was aborted before the monitor answered.');
}

export function fakeCanaryAlarm({ events }: { events?: string[] } = {}): FakeCanaryAlarm {
  const reports: CanaryAlarmReport[] = [];
  let failure: Error | null = null;
  let hanging = false;

  return {
    report(status: CanaryAlarmStatus, signal?: AbortSignalLike): Promise<void> {
      reports.push({ status, signal });
      events?.push(`${CANARY_ALARM_REPORTED}: ${status}`);
      if (hanging) {
        return new Promise<void>((_resolve, reject) => {
          if (signal === undefined) {
            return;
          }
          const abort = () => {
            events?.push(CANARY_ALARM_ABORTED);
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
    get reports(): readonly CanaryAlarmReport[] {
      return reports.map((report) => ({ ...report }));
    },
    get statuses(): readonly CanaryAlarmStatus[] {
      return reports.map(({ status }) => status);
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
