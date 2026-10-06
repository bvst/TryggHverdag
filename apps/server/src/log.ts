/**
 * The server's log: one JSON line per event, through pino (D-032), and only
 * the closed events `LogEvent` lists (PRIV-07, LOST-01).
 *
 * Nothing free-form can be written. No event has a field a location, a phone
 * number or an error's message could travel in, so this file has nothing to
 * scrub. pino's built-in redaction, which the library table behind D-032
 * names, is not used here: it removes the keys it is told about, and this
 * adapter allows no free field instead. Each line is built from the event's
 * own fields, named one by one, and each field is written only when its value
 * is one the field allows, and as null otherwise. So even a caller that got
 * past the type, with a cast or with data typed `any`, cannot have anything
 * else written:
 *   - `journeyId` and `messageId` only as a lower-case canonical UUID;
 *   - `reason` only from its event's set: JOURNEY_ENDED for an ignored
 *     heartbeat or "I'm home", the push port's four for a failed push;
 *   - `stage` only from its event's set: clock, read or store for a
 *     heartbeat; read or store for "I'm home"; read, open or beat for the
 *     watchdog; claim or mark for the sender;
 *   - `pool` only as api or worker;
 *   - `code` only as text that is a SQLSTATE, read by `sqlstateOf`, so no
 *     message can travel as a code.
 * An event the log does not list is a fault in the caller: `write` throws,
 * writes nothing, and its error names nothing of what it was handed.
 *
 * Each line is the event and nothing more: no level, time, process ID or host
 * name. Each event is its own pino level, written as `event`. pino builds a
 * line from its level's cached text with the closing brace cut off
 * (lib/levels.js, genLsCache: `JSON.stringify(level).slice(0, -1)`), then the
 * time, then each field as `,"key":value` (lib/tools.js, _asJson). So a line
 * with neither a level nor a time would start "{," and not be JSON; the
 * event's own name in the level's place is what makes it a line that parses
 * to exactly the event. The platform stamps each line with its own time.
 *
 * Its destination is an injected writer that defaults to
 * `process.stdout.write`, looked up each time a line is written. pino's own
 * default destination writes to file descriptor 1 directly, past anything that
 * captures `process.stdout.write`, so a test that found nothing written would
 * prove nothing; with this, the capture sees every line (LOST-01-AC14).
 *
 * Only the two processes, `api-process.ts` and `worker.ts`, and tests import
 * this file. Modules get the `Log` port.
 * Changing it needs the owner's approval (D-102).
 */
import process from 'node:process';
import pino from 'pino';
import { PUSH_FAILURE_REASONS } from './domain/journey.ts';
import { sqlstateOf } from './domain/sqlstate.ts';
import type { Log, LogEvent } from './ports.ts';

type EventName = LogEvent['event'];

/**
 * Each event's name, as the pino level it is written at. The numbers exist
 * only for pino, which ranks its levels by number; nothing of ours reads
 * them, no line holds them, and failures rank above an ignored heartbeat only
 * so the order reads sensibly. Each number must be unique: pino finds a
 * level's name by its number, so two events sharing one would be written
 * under the same name.
 */
const EVENT_LEVELS = {
  heartbeat_ignored: 30,
  home_ignored: 31,
  alert_missing: 40,
  heartbeat_failed: 50,
  push_failed: 51,
  delivery_failed: 52,
  watchdog_failed: 53,
  watchdog_overdue: 54,
  database_error: 55,
  home_failed: 56,
} as const satisfies Record<EventName, number>;

/**
 * The level pino writes from: the lowest-ranked event. pino turns every level
 * below its threshold into a no-op that writes nothing and says nothing
 * (lib/levels.js, setLevel), so the threshold is taken from the ranks rather
 * than named, and an event ranked lower later is still written.
 */
const [THRESHOLD] = (Object.keys(EVENT_LEVELS) as [EventName, ...EventName[]]).sort(
  (a, b) => EVENT_LEVELS[a] - EVENT_LEVELS[b],
);

/** A UUID as the database writes one: lower-case hex, in groups of 8, 4, 4, 4 and 12. */
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The reasons `heartbeat_ignored` and `home_ignored` may give. */
const REASONS: readonly unknown[] = ['JOURNEY_ENDED'] satisfies Extract<
  LogEvent,
  { event: 'heartbeat_ignored' | 'home_ignored' }
>['reason'][];

/** The stages `heartbeat_failed` may name. */
const STAGES: readonly unknown[] = ['clock', 'read', 'store'] satisfies Extract<
  LogEvent,
  { event: 'heartbeat_failed' }
>['stage'][];

/** The stages `home_failed` may name. */
const HOME_STAGES: readonly unknown[] = ['read', 'store'] satisfies Extract<
  LogEvent,
  { event: 'home_failed' }
>['stage'][];

/** The stages `watchdog_failed` may name. */
const WATCHDOG_STAGES: readonly unknown[] = ['read', 'open', 'beat'] satisfies Extract<
  LogEvent,
  { event: 'watchdog_failed' }
>['stage'][];

/** The stages `delivery_failed` may name. */
const DELIVERY_STAGES: readonly unknown[] = ['claim', 'mark'] satisfies Extract<
  LogEvent,
  { event: 'delivery_failed' }
>['stage'][];

/** The pools `database_error` may name: each process's own. */
const POOLS: readonly unknown[] = ['api', 'worker'] satisfies Extract<
  LogEvent,
  { event: 'database_error' }
>['pool'][];

/**
 * Each field's value as it is written: the value when it is one the field
 * allows, else null. Each takes `unknown`, because a caller that got past the
 * type can hand in anything.
 */
function oneOf(allowed: readonly unknown[], value: unknown): string | null {
  return allowed.includes(value) ? (value as string) : null;
}

/** A journey's or a message's ID, as the database writes one. */
function uuidOf(value: unknown): string | null {
  return typeof value === 'string' && CANONICAL_UUID.test(value) ? value : null;
}

/** Only text that is a SQLSTATE, read as the store's error is read. */
function codeOf(value: unknown): string | null {
  return sqlstateOf({ code: value });
}

/** Where a line goes: given whole, newline included. */
export type LogWriter = (line: string) => unknown;

export function createLog({
  write = (line) => process.stdout.write(line),
}: { write?: LogWriter } = {}): Log {
  const logger = pino(
    {
      customLevels: EVENT_LEVELS,
      useOnlyCustomLevels: true,
      level: THRESHOLD,
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
          logger.heartbeat_ignored({
            reason: oneOf(REASONS, event.reason),
            journeyId: uuidOf(event.journeyId),
          });
          return;
        case 'heartbeat_failed':
          logger.heartbeat_failed({ stage: oneOf(STAGES, event.stage), code: codeOf(event.code) });
          return;
        case 'watchdog_failed':
          logger.watchdog_failed({
            stage: oneOf(WATCHDOG_STAGES, event.stage),
            code: codeOf(event.code),
          });
          return;
        case 'watchdog_overdue':
          logger.watchdog_overdue({ journeyId: uuidOf(event.journeyId) });
          return;
        case 'push_failed':
          logger.push_failed({
            reason: oneOf(PUSH_FAILURE_REASONS, event.reason),
            messageId: uuidOf(event.messageId),
          });
          return;
        case 'delivery_failed':
          logger.delivery_failed({
            stage: oneOf(DELIVERY_STAGES, event.stage),
            code: codeOf(event.code),
          });
          return;
        case 'database_error':
          logger.database_error({ pool: oneOf(POOLS, event.pool), code: codeOf(event.code) });
          return;
        case 'home_ignored':
          logger.home_ignored({
            reason: oneOf(REASONS, event.reason),
            journeyId: uuidOf(event.journeyId),
          });
          return;
        case 'home_failed':
          logger.home_failed({
            stage: oneOf(HOME_STAGES, event.stage),
            code: codeOf(event.code),
          });
          return;
        case 'alert_missing':
          logger.alert_missing({ journeyId: uuidOf(event.journeyId) });
          return;
        default:
          // A type error the day an event joins LogEvent without a case. And
          // a throw, never a quiet nothing: the line that says a heartbeat
          // failed is exactly the one that must not go missing. The error
          // names nothing of what it was handed, which may be anything, and
          // whoever catches it may print it.
          event satisfies never;
          throw new Error('The log was handed an event it does not list.');
      }
    },
  };
}
