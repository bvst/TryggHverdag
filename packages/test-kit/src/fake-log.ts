/**
 * The log, recording (PRIV-07, LOST-01).
 *
 * Stands in for the server's log adapter (`apps/server/src/log.ts`), which
 * writes one JSON line per event to stdout. A system test hands this to the
 * journey module and reads back exactly which events were written, in order,
 * and with what in them. That is how "logged without location" (SM-07) and
 * "one heartbeat_failed line, naming the stage" are checked: by what the
 * module chose to log, before any adapter could tidy it up.
 *
 * The events are a closed union, as the server's `LogEvent` is. Nothing
 * free-form can be written: a location or a phone number has no field to
 * travel in. Written out here because the test kit does not import the
 * server; an event added there is added here when its tests are written.
 *
 * It records each event as given, every field of it, so an event that carried
 * more than its type allows still shows in what a test reads back. It never
 * writes anywhere itself. Matches the server's Log port by shape.
 */

/**
 * Every event the server may log, and nothing else. LOST-02 adds the
 * watchdog's and the sender's failures, a journey the watchdog cannot move,
 * and a connection's error, each with a stage, a reason, a pool or a
 * SQLSTATE, and never a message. LOST-03 adds three: an "I'm home" for a
 * journey already ended (SM-07), an "I'm home" that failed, and a journey
 * brought back in contact with no alert to resolve. LOST-06 adds the last
 * two: an "I'm on it" for an alert already resolved, naming the alert and the
 * reason only, and an "I'm on it" that failed, with its stage and SQLSTATE.
 * Neither names a user (PRIV-07). LOST-07 adds six: an escalation that failed
 * and one that is overdue, an SMS the port did not accept and an SMS delivery
 * that failed, the count of SMS failing, and an SMS check that failed. None
 * has a field a phone number, a name or a location could travel in, and none
 * names a user. SM-10 adds three: a removal for a journey already ended,
 * naming the journey and the reason; a removal that failed, with its stage
 * and SQLSTATE; and the count of unresolved alerts whose journey has no
 * responder (D-122, item 3). None names the removed responder or the walker.
 */
export type FakeLogEvent =
  | { event: 'heartbeat_ignored'; reason: 'JOURNEY_ENDED'; journeyId: string }
  | { event: 'heartbeat_failed'; stage: 'clock' | 'read' | 'store'; code: string | null }
  | { event: 'watchdog_failed'; stage: 'read' | 'open' | 'beat'; code: string | null }
  | { event: 'watchdog_overdue'; journeyId: string }
  | {
      event: 'push_failed';
      reason: 'NO_TARGET' | 'REFUSED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
      messageId: string;
    }
  | { event: 'delivery_failed'; stage: 'claim' | 'mark'; code: string | null }
  | { event: 'database_error'; pool: 'api' | 'worker'; code: string | null }
  | { event: 'home_ignored'; reason: 'JOURNEY_ENDED'; journeyId: string }
  | { event: 'home_failed'; stage: 'read' | 'store'; code: string | null }
  | { event: 'alert_missing'; journeyId: string }
  | { event: 'acknowledgement_ignored'; reason: 'ALERT_RESOLVED'; alertId: string }
  | { event: 'acknowledgement_failed'; stage: 'read' | 'store'; code: string | null }
  | { event: 'escalation_failed'; stage: 'read' | 'escalate'; code: string | null }
  | { event: 'escalation_overdue'; alertId: string }
  | {
      event: 'sms_failed';
      reason: 'NO_TARGET' | 'REFUSED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
      messageId: string;
    }
  | { event: 'sms_delivery_failed'; stage: 'claim' | 'mark'; code: string | null }
  | { event: 'sms_unsent'; count: number }
  | { event: 'sms_check_failed'; stage: 'read' | 'report'; code: string | null }
  | { event: 'removal_ignored'; reason: 'JOURNEY_ENDED'; journeyId: string }
  | { event: 'removal_failed'; stage: 'read' | 'store'; code: string | null }
  | { event: 'unheard_alerts'; count: number };

export interface FakeLog {
  /** Records the event. */
  write(event: FakeLogEvent): void;
  /** Every event written so far, in order. Copies: changing them changes nothing. */
  readonly events: readonly FakeLogEvent[];
}

export function fakeLog(): FakeLog {
  const events: FakeLogEvent[] = [];

  return {
    write(event) {
      events.push({ ...event });
    },
    get events() {
      return events.map((event) => ({ ...event }));
    },
  };
}
