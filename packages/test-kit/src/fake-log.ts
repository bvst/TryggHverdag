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

/** Every event the server may log, and nothing else. */
export type FakeLogEvent =
  | { event: 'heartbeat_ignored'; reason: 'JOURNEY_ENDED'; journeyId: string }
  | { event: 'heartbeat_failed'; stage: 'clock' | 'read' | 'store'; code: string | null };

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
