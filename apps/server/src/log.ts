/**
 * The server's log: one JSON line per event, through pino (D-032), and only
 * the closed events `LogEvent` lists (PRIV-07, LOST-01).
 *
 * Nothing free-form can be written. No event has a field a location, a phone
 * number or an error's message could travel in, so this file has nothing to
 * scrub: each line is built from the event's own fields, named one by one,
 * so even a caller that got past the type with more cannot have it written.
 * A `code` is written only when it is a SQLSTATE, five of 0-9 and A-Z, so no
 * message can travel as a code either.
 *
 * Each line is the event and nothing more: no level, time, process ID or host
 * name. Each event is its own pino level, written as `event`. pino builds a
 * line as its level, then its time, then each field after a comma, so a line
 * with neither a level nor a time would start "{," and not be JSON; the event's
 * own name in the level's place is what makes it a line that parses to exactly
 * the event. The platform stamps each line with its own time.
 *
 * Its destination is an injected writer that defaults to
 * `process.stdout.write`, looked up each time a line is written. pino's own
 * default destination writes to file descriptor 1 directly, past anything that
 * captures `process.stdout.write`, so a test that found nothing written would
 * prove nothing; with this, the capture sees every line (LOST-01-AC14).
 *
 * Only `api-process.ts` and tests import this file. Modules get the `Log` port.
 * Changing it needs the owner's approval (D-102).
 */
import process from 'node:process';
import pino from 'pino';
import type { Log, LogEvent } from './ports.ts';

/** PostgreSQL's error codes: exactly five of 0-9 and A-Z. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/** Each event's name, as the level it is written at. Failures rank above an ignored heartbeat. */
const EVENT_LEVELS = {
  heartbeat_ignored: 30,
  heartbeat_failed: 50,
} as const satisfies Record<LogEvent['event'], number>;

/** Where a line goes: given whole, newline included. */
export type LogWriter = (line: string) => unknown;

export function createLog({
  write = (line) => process.stdout.write(line),
}: { write?: LogWriter } = {}): Log {
  const logger = pino(
    {
      customLevels: EVENT_LEVELS,
      useOnlyCustomLevels: true,
      level: 'heartbeat_ignored',
      base: null,
      timestamp: false,
      formatters: { level: (label) => ({ event: label }) },
    },
    {
      write(line: string) {
        write(line);
      },
    },
  );

  return {
    write(event: LogEvent): void {
      switch (event.event) {
        case 'heartbeat_ignored':
          logger.heartbeat_ignored({ reason: event.reason, journeyId: event.journeyId });
          return;
        case 'heartbeat_failed':
          logger.heartbeat_failed({
            stage: event.stage,
            code: event.code !== null && SQLSTATE.test(event.code) ? event.code : null,
          });
          return;
      }
    },
  };
}
