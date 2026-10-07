/**
 * The SMS check's report to the owner's monitor, in memory (LOST-07, D-079,
 * D-115 item 2, AR-02).
 *
 * Stands in for the adapter that tells the second Healthchecks.io check, once
 * a minute, whether any escalation SMS is failing: `ok`, or `failing` while
 * any SMS has waited 60 s or more without being accepted. So no test ever
 * reports to a real check. It records every report in order with its status
 * and the abort signal it was given, can fail the way the adapter fails (a
 * non-2xx answer, no connection, a timeout), and can hang the way a
 * Healthchecks.io that never answers does: a hung report settles only when its
 * signal aborts, and never when it was given none. Each report, and each abort
 * of a hung one, is added to an `events` list it can share with the other
 * fakes, so a test can say what came first.
 *
 * Matches the server's SmsAlarm port by shape, so the test kit needs no import
 * from the server.
 */
import type { AbortSignalLike } from './fake-check-in.ts';

/** What a report tells the monitor: no SMS is failing, or some is. */
export type SmsAlarmStatus = 'ok' | 'failing';

/** The entry a report adds to a shared `events` list, whether it succeeds or not. */
export const SMS_ALARM_REPORTED = 'sms alarm reported';

/** The entry a hung report adds to a shared `events` list when its signal aborts it. */
export const SMS_ALARM_ABORTED = 'sms alarm aborted';

/** One report as it was asked for: its status, and its signal, `undefined` where none was given. */
export interface SmsAlarmReport {
  status: SmsAlarmStatus;
  signal: AbortSignalLike | undefined;
}

export interface FakeSmsAlarm {
  report(status: SmsAlarmStatus, signal?: AbortSignalLike): Promise<void>;
  /** Every report asked for, successful or not, in order, with its signal. Copies. */
  readonly reports: readonly SmsAlarmReport[];
  /** The statuses alone, in order: a shorthand for `reports`. */
  readonly statuses: readonly SmsAlarmStatus[];
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
  return new Error('The SMS check’s report was aborted before the monitor answered.');
}

export function fakeSmsAlarm({ events }: { events?: string[] } = {}): FakeSmsAlarm {
  const reports: SmsAlarmReport[] = [];
  let failure: Error | null = null;
  let hanging = false;

  return {
    report(status: SmsAlarmStatus, signal?: AbortSignalLike): Promise<void> {
      reports.push({ status, signal });
      events?.push(`${SMS_ALARM_REPORTED}: ${status}`);
      if (hanging) {
        return new Promise<void>((_resolve, reject) => {
          if (signal === undefined) {
            return;
          }
          const abort = () => {
            events?.push(SMS_ALARM_ABORTED);
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
    get reports(): readonly SmsAlarmReport[] {
      return reports.map((report) => ({ ...report }));
    },
    get statuses(): readonly SmsAlarmStatus[] {
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
