/**
 * The SMS check (LOST-07, D-115): "if an SMS can't be sent, the owner is
 * alerted". Run once a minute by the worker, apart from the sweep, it reads
 * from the database how many escalation SMS are failing, and tells the
 * owner's monitor: `failing` while any is, `ok` while none is.
 *
 * Failing is unsent, not withdrawn, and written SMS_UNSENT_LIMIT_MS or more
 * ago, whatever the cause: the port refused it, has no number for the
 * recipient, threw, never answered or is not configured, or the SMS loop
 * stopped. Read from the database each minute, rather than reported by the
 * sender on each failure, so it survives a restart, repeats until it is true,
 * clears itself, and sees the failures a sender never sees. A failure a retry
 * fixes within the limit is no page: that SMS was sent.
 *
 * It also pages while an alert is unheard (SM-10, D-122 item 3): unresolved,
 * its journey left with no responder row, so nobody can be told of it. Such
 * an alert opens and stays OPEN with no message, and the owner is the only
 * one left who can act. One failing report covers both causes; each minute's
 * lines say which, with a count each.
 *
 * It fails toward paging. A read that fails, of either count, reports
 * nothing, so the monitor's silence pages; a report that fails is one line,
 * never a thrown task that Graphile retries in a loop. It does not depend on
 * the watchdog's beat: the two say different things, and each has its own
 * check.
 *
 * Its lines hold a count, a stage and a SQLSTATE, nothing else (PRIV-07). It
 * reads no clock: the limit is counted by the database's now() (AR-03).
 */
import { sqlstateOf } from '../../domain/sqlstate.ts';
import { SMS_UNSENT_LIMIT_MS } from '../../domain/watchdog.ts';
import type { Log, OutboxStore, SmsAlarm } from '../../ports.ts';

/** What one check came to: reported ok, reported failing, or, the read failing, reported nothing. */
export type SmsCheckResult = 'ok' | 'failing' | 'unread';

export interface SmsCheck {
  /** Never rejects. `signal` is handed to the monitor's report, so a stop ends one in flight. */
  check(signal?: AbortSignal): Promise<SmsCheckResult>;
}

export function createSmsCheck({
  outbox,
  alarm,
  log,
}: {
  outbox: Pick<OutboxStore, 'unsentSmsCount' | 'unheardAlertCount'>;
  alarm: SmsAlarm;
  log: Log;
}): SmsCheck {
  return {
    async check(signal?: AbortSignal): Promise<SmsCheckResult> {
      let unsent;
      let unheard;
      try {
        ({ count: unsent } = await outbox.unsentSmsCount(SMS_UNSENT_LIMIT_MS));
        ({ count: unheard } = await outbox.unheardAlertCount());
      } catch (error) {
        log.write({ event: 'sms_check_failed', stage: 'read', code: sqlstateOf(error) });
        return 'unread';
      }
      if (unsent > 0) {
        log.write({ event: 'sms_unsent', count: unsent });
      }
      if (unheard > 0) {
        log.write({ event: 'unheard_alerts', count: unheard });
      }
      const status = unsent > 0 || unheard > 0 ? 'failing' : 'ok';
      try {
        await alarm.report(status, signal);
      } catch {
        // The monitor is not the database: its failures have no SQLSTATE.
        log.write({ event: 'sms_check_failed', stage: 'report', code: null });
      }
      return status;
    },
  };
}
