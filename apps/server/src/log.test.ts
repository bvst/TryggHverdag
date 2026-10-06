// L1 and L2: the log adapter, the first log lines this server writes about a
// request (PRIV-07, LOST-01-AC16).
//
// The log takes a closed union of events and nothing free-form: no event has a
// field a location, a phone number or an error's message could travel in. The
// type check holds that (L1, the @ts-expect-error lines below, checked by tsc
// in gate:static); these tests hold the adapter to writing exactly the event,
// one JSON line each, and to writing a code only when it is a SQLSTATE, so no
// message can travel as a code either.
//
// Its destination is an injected writer, defaulting to process.stdout.write
// looked up when a line is written. pino's own default destination writes to
// file descriptor 1 directly, which a capture of process.stdout.write cannot
// see: then every "nothing was written" test would pass while proving nothing.
import { syntheticCoordinate, syntheticUuid } from '@trygghverdag/test-kit';
import process from 'node:process';
import { inspect } from 'node:util';
import { describe, expect, test, vi } from 'vitest';
import { createLog } from './log.ts';
import type { Log, LogEvent } from './ports.ts';

/** A writer that keeps every chunk it is handed, as text. */
function recordingWriter() {
  const chunks: string[] = [];
  return {
    chunks,
    write: (chunk: string): boolean => {
      chunks.push(chunk);
      return true;
    },
    /** Everything written, split into lines, the empty end of the last line left out. */
    lines: (): string[] =>
      chunks
        .join('')
        .split('\n')
        .filter((line, index, all) => {
          return !(line === '' && index === all.length - 1);
        }),
  };
}

const EVENTS: LogEvent[] = [
  { event: 'heartbeat_ignored', reason: 'JOURNEY_ENDED', journeyId: syntheticUuid() },
  { event: 'heartbeat_failed', stage: 'clock', code: null },
  { event: 'heartbeat_failed', stage: 'read', code: '57P01' },
  { event: 'heartbeat_failed', stage: 'store', code: '23514' },
];

/** Codes that are not a SQLSTATE: each is written as null, so no message can travel as a code. */
const NOT_SQLSTATES = [
  { what: 'a Node error code', code: 'ECONNREFUSED' },
  { what: 'four characters', code: '2350' },
  { what: 'six characters', code: '235140' },
  { what: 'lower case', code: '57p01' },
  { what: 'a space in it', code: '2351 ' },
  { what: 'empty', code: '' },
  {
    what: 'a message',
    code: `invalid input syntax for type double precision: "${String(syntheticCoordinate())}"`,
  },
  { what: 'a coordinate', code: String(syntheticCoordinate()) },
];

describe('PRIV-07: the log writes closed events, one JSON line each', () => {
  test.each(EVENTS)(
    'LOST-01-AC16: createLog writes $event as one JSON line, holding exactly that event’s fields',
    (event) => {
      const writer = recordingWriter();

      createLog({ write: writer.write }).write(event);

      const lines = writer.lines();
      expect(lines).toHaveLength(1);
      expect(writer.chunks.join('').endsWith('\n')).toBe(true);
      expect(JSON.parse(lines[0] ?? 'null')).toEqual(event);
    },
  );

  test('LOST-01-AC16: several events are several lines, in the order written', () => {
    const writer = recordingWriter();
    const log = createLog({ write: writer.write });

    for (const event of EVENTS) {
      log.write(event);
    }

    expect(writer.lines().map((line) => JSON.parse(line) as unknown)).toEqual(EVENTS);
  });

  test.each(NOT_SQLSTATES)(
    'LOST-01-AC16: a code that is not five of 0–9A–Z is written as null — $what',
    ({ code }) => {
      const writer = recordingWriter();

      createLog({ write: writer.write }).write({ event: 'heartbeat_failed', stage: 'store', code });

      expect(JSON.parse(writer.lines()[0] ?? 'null')).toEqual({
        event: 'heartbeat_failed',
        stage: 'store',
        code: null,
      });
      if (code !== '') {
        expect(writer.chunks.join('')).not.toContain(code);
      }
    },
  );

  test.each(['00000', '23502', '23505', '23514', '40001', '57P01', 'XX000'])(
    'LOST-01-AC16: a SQLSTATE, %s, is written as it is',
    (code) => {
      const writer = recordingWriter();

      createLog({ write: writer.write }).write({ event: 'heartbeat_failed', stage: 'store', code });

      expect(JSON.parse(writer.lines()[0] ?? 'null')).toEqual({
        event: 'heartbeat_failed',
        stage: 'store',
        code,
      });
    },
  );

  test('LOST-01-AC16: (L1) a LogEvent holding any other field, a latitude among them, does not type-check', () => {
    // tsc reports each of these on the property marked, and @ts-expect-error
    // fails the type check (gate:static) the day one stops being an error.
    // Each literal stays on several lines, so the directive stays directly
    // above the property it is about. They are values only: none is handed
    // to the log.
    const journeyId = syntheticUuid();
    const refused: unknown[] = [
      {
        event: 'heartbeat_ignored',
        reason: 'JOURNEY_ENDED',
        journeyId,
        // @ts-expect-error -- a latitude has no field to travel in
        latitude: 0,
      } satisfies LogEvent,
      {
        event: 'heartbeat_ignored',
        reason: 'JOURNEY_ENDED',
        journeyId,
        // @ts-expect-error -- nor a position
        position: { latitude: 0, longitude: 0 },
      } satisfies LogEvent,
      {
        event: 'heartbeat_failed',
        stage: 'store',
        code: null,
        // @ts-expect-error -- nor an error's message
        message: 'Failing row contains (…)',
      } satisfies LogEvent,
      {
        // @ts-expect-error -- nor a free-form event
        event: 'something_happened',
      } satisfies LogEvent,
      {
        event: 'heartbeat_ignored',
        // @ts-expect-error -- nor another reason
        reason: 'ANYTHING',
        journeyId,
      } satisfies LogEvent,
      {
        event: 'heartbeat_failed',
        // @ts-expect-error -- nor another stage
        stage: 'anywhere',
        code: null,
      } satisfies LogEvent,
      {
        event: 'heartbeat_failed',
        stage: 'store',
        // @ts-expect-error -- and a code is text or null, never an object
        code: { detail: 'Failing row contains (…)' },
      } satisfies LogEvent,
    ];
    const port = (log: Log): void => {
      log.write({
        event: 'heartbeat_failed',
        stage: 'store',
        code: null,
        // @ts-expect-error -- the port takes a LogEvent and nothing more
        latitude: 0,
      });
    };

    expect(refused).toHaveLength(7);
    expect(typeof port).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Closed fields, at run time too (privacy and code reviews, LOST-01).
//
// The type keeps a caller from handing the log anything else (L1, above). A
// caller that got past the type, with a cast or with data typed `any`, must
// still get nothing of it written: each field is written only when its value
// is one the field allows, and as null otherwise. The free text below is
// what such a caller could hold: a coordinate, a pair of them, and a message
// that quotes them. All of it is synthetic, generated at run time (RG-07).
// ---------------------------------------------------------------------------

/** Free text a caller might hand the log in a field not meant for it. */
function freeText(): { what: string; value: string; markers: string[] }[] {
  const latitude = String(syntheticCoordinate());
  const longitude = String(syntheticCoordinate());
  return [
    { what: 'a coordinate', value: latitude, markers: [latitude] },
    {
      what: 'a coordinate pair',
      value: `${latitude}, ${longitude}`,
      markers: [latitude, longitude],
    },
    {
      what: 'a message quoting the position',
      value: `Failing row contains (${latitude}, ${longitude})`,
      markers: [latitude, longitude, 'Failing row'],
    },
  ];
}

const UPPER_UUID = syntheticUuid().toUpperCase();
const BRACED_UUID = syntheticUuid();
const TRAILED_UUID = syntheticUuid();
const TRAILING_COORDINATE = String(syntheticCoordinate());
const UNHYPHENATED_UUID = syntheticUuid().replaceAll('-', '');
const LISTED_UUID = syntheticUuid();
const SPACED_UUID = syntheticUuid();
const LED_UUID = syntheticUuid();
const LEADING_COORDINATE = String(syntheticCoordinate());
const MESSAGED_UUID = syntheticUuid();
const MESSAGE_LATITUDE = String(syntheticCoordinate());
const MESSAGE_LONGITUDE = String(syntheticCoordinate());

/**
 * Values that are not a journey ID as the log writes one: a UUID, in lower case.
 *
 * Text after a UUID and text before one each have rows, so dropping either
 * anchor of the log's pattern turns a row red: without its `^`, a value that
 * only ends in a UUID would be written whole, and whatever came before the
 * UUID with it (test-auditor, LOST-01 loop 1).
 */
const NOT_JOURNEY_IDS: { what: string; journeyId: () => unknown; markers: () => string[] }[] = [
  ...freeText().map(({ what, value, markers }) => ({
    what,
    journeyId: () => value,
    markers: () => markers,
  })),
  {
    what: 'a UUID in upper case',
    journeyId: () => UPPER_UUID,
    markers: () => [UPPER_UUID],
  },
  {
    what: 'a UUID in braces',
    journeyId: () => `{${BRACED_UUID}}`,
    markers: () => [BRACED_UUID],
  },
  {
    what: 'a UUID followed by a coordinate',
    journeyId: () => `${TRAILED_UUID} ${TRAILING_COORDINATE}`,
    markers: () => [TRAILED_UUID, TRAILING_COORDINATE],
  },
  {
    what: 'a UUID after a space',
    journeyId: () => ` ${SPACED_UUID}`,
    markers: () => [SPACED_UUID],
  },
  {
    what: 'a coordinate followed by a UUID',
    journeyId: () => `${LEADING_COORDINATE} ${LED_UUID}`,
    markers: () => [LEADING_COORDINATE, LED_UUID],
  },
  {
    what: 'a failing-row message followed by a UUID',
    journeyId: () =>
      `Failing row contains (${MESSAGE_LATITUDE}, ${MESSAGE_LONGITUDE}): ${MESSAGED_UUID}`,
    markers: () => [MESSAGE_LATITUDE, MESSAGE_LONGITUDE, 'Failing row', MESSAGED_UUID],
  },
  {
    what: 'a UUID without its hyphens',
    journeyId: () => UNHYPHENATED_UUID,
    markers: () => [UNHYPHENATED_UUID],
  },
  { what: 'empty text', journeyId: () => '', markers: () => [] },
  {
    what: 'a list holding a UUID, which prints as one',
    journeyId: () => [LISTED_UUID],
    markers: () => [LISTED_UUID],
  },
  { what: 'a number', journeyId: () => 1234567, markers: () => ['1234567'] },
];

/** Values that are not the reason heartbeat_ignored allows: JOURNEY_ENDED, as written. */
const NOT_REASONS: { what: string; reason: unknown; markers: string[] }[] = [
  ...freeText().map(({ what, value, markers }) => ({ what, reason: value, markers })),
  {
    what: 'another code of the route',
    reason: 'JOURNEY_NOT_FOUND',
    markers: ['JOURNEY_NOT_FOUND'],
  },
  { what: 'the reason in lower case', reason: 'journey_ended', markers: ['journey_ended'] },
  { what: 'empty text', reason: '', markers: [] },
  { what: 'a number', reason: 409, markers: ['409'] },
];

/** Values that are not a stage heartbeat_failed allows: clock, read or store, as written. */
const NOT_STAGES: { what: string; stage: unknown; markers: string[] }[] = [
  ...freeText().map(({ what, value, markers }) => ({ what, stage: value, markers })),
  { what: 'a stage in upper case', stage: 'STORE', markers: ['STORE'] },
  { what: 'another word', stage: 'database', markers: ['database'] },
  { what: 'empty text', stage: '', markers: [] },
  { what: 'a list holding a stage, which prints as one', stage: ['clock'], markers: ['clock'] },
];

/** Codes that are not text but print as a SQLSTATE: each is written as null all the same. */
const CODES_NOT_TEXT: { what: string; code: unknown }[] = [
  { what: 'a number', code: 23505 },
  { what: 'a list holding a SQLSTATE', code: ['23505'] },
];

/** Writes this one value, got past the type, and returns the line, parsed, and the text written. */
function writtenThroughACast(event: Record<string, unknown>): { line: unknown; text: string } {
  const writer = recordingWriter();
  createLog({ write: writer.write }).write(event as unknown as LogEvent);
  const lines = writer.lines();
  expect(lines, 'one line, whatever the event held').toHaveLength(1);
  return { line: JSON.parse(lines[0] ?? 'null'), text: writer.chunks.join('') };
}

/** The markers found in this text: none, if nothing of them was written. */
function markersIn(text: string, markers: readonly string[]): string[] {
  return markers.filter((marker) => text.includes(marker));
}

describe('PRIV-07: each field of a line is written only when its value is one the field allows', () => {
  test.each(NOT_JOURNEY_IDS)(
    'LOST-01-AC16: a heartbeat_ignored journeyId that is not a lower-case UUID is written as null, and none of it is written — $what',
    ({ journeyId, markers }) => {
      const given = journeyId();

      const { line, text } = writtenThroughACast({
        event: 'heartbeat_ignored',
        reason: 'JOURNEY_ENDED',
        journeyId: given,
      });

      expect(line).toEqual({
        event: 'heartbeat_ignored',
        reason: 'JOURNEY_ENDED',
        journeyId: null,
      });
      expect(markersIn(text, markers())).toEqual([]);
    },
  );

  test('LOST-01-AC16: a lower-case UUID is written as it is, so the null above is the value’s doing', () => {
    const journeyId = syntheticUuid();

    const { line } = writtenThroughACast({
      event: 'heartbeat_ignored',
      reason: 'JOURNEY_ENDED',
      journeyId,
    });

    expect(journeyId).toBe(journeyId.toLowerCase());
    expect(line).toEqual({ event: 'heartbeat_ignored', reason: 'JOURNEY_ENDED', journeyId });
  });

  test.each(NOT_REASONS)(
    'LOST-01-AC16: a heartbeat_ignored reason outside its closed set is written as null, and none of it is written — $what',
    ({ reason, markers }) => {
      const journeyId = syntheticUuid();

      const { line, text } = writtenThroughACast({ event: 'heartbeat_ignored', reason, journeyId });

      expect(line).toEqual({ event: 'heartbeat_ignored', reason: null, journeyId });
      // Searched with the journey ID taken out. The ID is random hex, so it
      // holds a short marker by chance: "409" in about one run in 110. The
      // line above already holds it to exactly the ID given, which nothing
      // of the reason went into (RG-03, LOST-01).
      expect(markersIn(text.replaceAll(journeyId, ''), markers)).toEqual([]);
    },
  );

  test.each(NOT_STAGES)(
    'LOST-01-AC16: a heartbeat_failed stage outside its closed set is written as null, and none of it is written — $what',
    ({ stage, markers }) => {
      const { line, text } = writtenThroughACast({
        event: 'heartbeat_failed',
        stage,
        code: '57P01',
      });

      expect(line).toEqual({ event: 'heartbeat_failed', stage: null, code: '57P01' });
      expect(markersIn(text, markers)).toEqual([]);
    },
  );

  test.each(['clock', 'read', 'store'])(
    'LOST-01-AC16: the stage %s is written as it is, so the null above is the value’s doing',
    (stage) => {
      const { line } = writtenThroughACast({ event: 'heartbeat_failed', stage, code: null });

      expect(line).toEqual({ event: 'heartbeat_failed', stage, code: null });
    },
  );

  test.each(CODES_NOT_TEXT)(
    'LOST-01-AC16: a code that is not text is written as null, though it prints as a SQLSTATE — $what',
    ({ code }) => {
      const { line } = writtenThroughACast({ event: 'heartbeat_failed', stage: 'store', code });

      expect(line).toEqual({ event: 'heartbeat_failed', stage: 'store', code: null });
    },
  );

  test('LOST-01-AC16: fields the event does not have, got past the type, are not written: a position, a message, an error', () => {
    const latitude = String(syntheticCoordinate());
    const longitude = String(syntheticCoordinate());
    const journeyId = syntheticUuid();
    const extra = {
      latitude: Number(latitude),
      longitude: Number(longitude),
      position: { latitude: Number(latitude), longitude: Number(longitude) },
      message: `Failing row contains (${latitude}, ${longitude})`,
      err: new Error(`Failing row contains (${latitude}, ${longitude})`),
      msg: latitude,
    };

    const ignored = writtenThroughACast({
      event: 'heartbeat_ignored',
      reason: 'JOURNEY_ENDED',
      journeyId,
      ...extra,
    });
    const failed = writtenThroughACast({
      event: 'heartbeat_failed',
      stage: 'store',
      code: '23514',
      ...extra,
    });

    expect(ignored.line).toEqual({
      event: 'heartbeat_ignored',
      reason: 'JOURNEY_ENDED',
      journeyId,
    });
    expect(failed.line).toEqual({ event: 'heartbeat_failed', stage: 'store', code: '23514' });
    expect(
      markersIn(`${ignored.text}${failed.text}`, [latitude, longitude, 'Failing row']),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Loud, not silent (code review, LOST-01): an event the log does not list is
// a fault in the caller. Writing nothing would hide it, and the one line that
// says a heartbeat failed is exactly the line that must not go missing. So
// `write` throws, writes nothing, and its error holds nothing of what it was
// handed, which may be anything (PRIV-07): whoever catches it may print it.
// ---------------------------------------------------------------------------

const UNLISTED_LATITUDE = String(syntheticCoordinate());
const UNLISTED_LONGITUDE = String(syntheticCoordinate());

/** Values handed to `write` past the type, none of them an event LogEvent lists. */
const UNLISTED_EVENTS: { what: string; event: unknown; markers: string[] }[] = [
  {
    what: 'an event of another name, holding a position',
    event: {
      event: 'position_seen',
      latitude: Number(UNLISTED_LATITUDE),
      longitude: Number(UNLISTED_LONGITUDE),
    },
    markers: [UNLISTED_LATITUDE, UNLISTED_LONGITUDE],
  },
  {
    what: 'an event whose name holds a coordinate',
    event: { event: `moved to ${UNLISTED_LATITUDE}` },
    markers: [UNLISTED_LATITUDE],
  },
  {
    what: 'a listed event’s name in upper case',
    event: { event: 'HEARTBEAT_FAILED', stage: 'store', code: null },
    markers: [],
  },
  {
    what: 'an object with no event',
    event: { reason: 'JOURNEY_ENDED', latitude: Number(UNLISTED_LATITUDE) },
    markers: [UNLISTED_LATITUDE],
  },
  {
    what: 'a bare listed name, as text',
    event: 'heartbeat_failed',
    markers: [],
  },
  {
    what: 'text holding a coordinate pair',
    event: `${UNLISTED_LATITUDE}, ${UNLISTED_LONGITUDE}`,
    markers: [UNLISTED_LATITUDE, UNLISTED_LONGITUDE],
  },
];

describe('PRIV-07: an event the log does not list is a loud fault, never a silent nothing', () => {
  test.each(UNLISTED_EVENTS)(
    'LOST-01-AC16: write throws for $what, writes nothing, and its error holds nothing of what it was handed',
    ({ event, markers }) => {
      const writer = recordingWriter();
      const log = createLog({ write: writer.write });

      let thrown: unknown;
      try {
        log.write(event as LogEvent);
      } catch (error) {
        thrown = error;
      }

      expect(thrown, 'write threw').toBeInstanceOf(Error);
      expect(writer.chunks).toEqual([]);
      const failure = thrown as Error;
      const everything = [
        String(failure),
        failure.stack ?? '',
        inspect(failure, { depth: Infinity, showHidden: true }),
      ].join('\n');
      expect(markersIn(everything, markers)).toEqual([]);
    },
  );

  test('LOST-01-AC16: (control) a listed event is written, not thrown on, by the same log', () => {
    const writer = recordingWriter();
    const log = createLog({ write: writer.write });

    expect(() => {
      log.write({ event: 'heartbeat_failed', stage: 'store', code: null });
    }).not.toThrow();
    expect(writer.lines()).toHaveLength(1);
  });
});

describe('PRIV-07: the log’s default destination is one a capture can see', () => {
  test('LOST-01-AC14: (control) with no writer given, createLog writes to process.stdout.write, looked up when it writes, so a capture installed after the log was made sees the line', () => {
    // As api-process.ts makes it: once, at start-up, with no writer.
    const log = createLog();
    const journeyId = syntheticUuid();
    const seen: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      seen.push(String(chunk));
      return true;
    });

    try {
      log.write({ event: 'heartbeat_ignored', reason: 'JOURNEY_ENDED', journeyId });
    } finally {
      spy.mockRestore();
    }

    const written = seen.join('');
    expect(written).toContain(journeyId);
    expect(
      JSON.parse(written.split('\n').find((line) => line.includes(journeyId)) ?? 'null'),
    ).toEqual({ event: 'heartbeat_ignored', reason: 'JOURNEY_ENDED', journeyId });
  });

  test('LOST-01-AC16: writing to the injected writer writes nothing to stdout or stderr itself', () => {
    const writer = recordingWriter();
    const log = createLog({ write: writer.write });
    const seen: string[] = [];
    const spies = [process.stdout, process.stderr].map((stream) =>
      vi.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
        seen.push(String(chunk));
        return true;
      }),
    );

    try {
      log.write({ event: 'heartbeat_failed', stage: 'clock', code: null });
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }

    expect(writer.lines()).toHaveLength(1);
    expect(seen).toEqual([]);
  });
});

// ===========================================================================
// LOST-02: the watchdog's, the sender's and the pools' five events (approach
// item 10). Closed, like the first two: a stage, a reason or a pool from its
// set, a UUID, or a SQLSTATE, and nothing a location, a phone number, an
// error's message or the connection string could travel in.
// ===========================================================================

const LOST_02_EVENTS: LogEvent[] = [
  { event: 'watchdog_failed', stage: 'read', code: '57P01' },
  { event: 'watchdog_failed', stage: 'open', code: null },
  { event: 'watchdog_failed', stage: 'beat', code: '53300' },
  { event: 'watchdog_overdue', journeyId: syntheticUuid() },
  { event: 'push_failed', reason: 'NO_TARGET', messageId: syntheticUuid() },
  { event: 'push_failed', reason: 'REFUSED', messageId: syntheticUuid() },
  { event: 'push_failed', reason: 'UNAVAILABLE', messageId: syntheticUuid() },
  { event: 'push_failed', reason: 'NOT_CONFIGURED', messageId: syntheticUuid() },
  { event: 'delivery_failed', stage: 'claim', code: '08006' },
  { event: 'delivery_failed', stage: 'mark', code: null },
  { event: 'database_error', pool: 'api', code: '25P03' },
  { event: 'database_error', pool: 'worker', code: null },
];

/** For each new event with a field closed to a set: a valid event, the field, and values outside the set. */
const CLOSED_SETS: {
  what: string;
  event: Record<string, unknown>;
  field: string;
  outside: unknown[];
}[] = [
  {
    what: 'a watchdog_failed stage',
    event: { event: 'watchdog_failed', stage: 'read', code: '57P01' },
    field: 'stage',
    outside: ['claim', 'mark', 'store', 'clock', 'READ', '', ['read'], 3],
  },
  {
    what: 'a delivery_failed stage',
    event: { event: 'delivery_failed', stage: 'claim', code: '57P01' },
    field: 'stage',
    outside: ['read', 'open', 'beat', 'send', 'CLAIM', '', ['claim']],
  },
  {
    what: 'a push_failed reason',
    event: { event: 'push_failed', reason: 'NO_TARGET', messageId: syntheticUuid() },
    field: 'reason',
    outside: ['JOURNEY_ENDED', 'TIMEOUT', 'no_target', '', ['NO_TARGET'], 500],
  },
  {
    what: 'a database_error pool',
    event: { event: 'database_error', pool: 'api', code: '57P01' },
    field: 'pool',
    outside: ['migrations', 'API', 'graphile', '', ['worker']],
  },
];

/** The new events with a field that holds an ID: written only as a lower-case canonical UUID. */
const ID_FIELDS: { event: Record<string, unknown>; field: string }[] = [
  { event: { event: 'watchdog_overdue', journeyId: syntheticUuid() }, field: 'journeyId' },
  {
    event: { event: 'push_failed', reason: 'REFUSED', messageId: syntheticUuid() },
    field: 'messageId',
  },
];

/** The new events with a code: written only as a SQLSTATE. */
const CODED_EVENTS: Record<string, unknown>[] = [
  { event: 'watchdog_failed', stage: 'open', code: '23505' },
  { event: 'delivery_failed', stage: 'mark', code: '23505' },
  { event: 'database_error', pool: 'worker', code: '23505' },
];

describe('PRIV-07 and LOST-02: the five new events are closed, at the type and at run time', () => {
  test('LOST-02-AC22: (L1) each of the five is exactly its fields, no more and no fewer: a field added to one, an optional one included, or a set widened, fails typecheck', () => {
    // An exact pin per event (review loop 1, test-auditor). The test below
    // tries fields one at a time; this holds the whole shape, so even
    // `watchdog_overdue` gaining an optional `latitude?` fails `tsc`. The
    // check is the compiler's: each entry below is `true` only when each type
    // is assignable to the other and both have the same keys, an optional
    // one included, and the array is typed to hold only `true`.
    type Exactly<A, B> = [A] extends [B]
      ? [B] extends [A]
        ? [keyof A] extends [keyof B]
          ? [keyof B] extends [keyof A]
            ? true
            : false
          : false
        : false
      : false;
    type EventOf<Name extends LogEvent['event']> = Extract<LogEvent, { event: Name }>;
    const pinned: [
      Exactly<
        EventOf<'watchdog_failed'>,
        { event: 'watchdog_failed'; stage: 'read' | 'open' | 'beat'; code: string | null }
      >,
      Exactly<EventOf<'watchdog_overdue'>, { event: 'watchdog_overdue'; journeyId: string }>,
      Exactly<
        EventOf<'push_failed'>,
        {
          event: 'push_failed';
          reason: 'NO_TARGET' | 'REFUSED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
          messageId: string;
        }
      >,
      Exactly<
        EventOf<'delivery_failed'>,
        { event: 'delivery_failed'; stage: 'claim' | 'mark'; code: string | null }
      >,
      Exactly<
        EventOf<'database_error'>,
        { event: 'database_error'; pool: 'api' | 'worker'; code: string | null }
      >,
    ] = [true, true, true, true, true];

    expect(pinned).toEqual([true, true, true, true, true]);
  });

  test('LOST-02-AC22: (L1) none of the five holds another field: a latitude, a message, the recipient, the connection string, or another stage, reason or pool does not type-check', () => {
    // As above: each @ts-expect-error fails the type check (gate:static) the
    // day the property under it stops being an error. Values only; none is
    // handed to the log.
    const journeyId = syntheticUuid();
    const messageId = syntheticUuid();
    const refused: unknown[] = [
      {
        event: 'watchdog_failed',
        stage: 'read',
        code: null,
        // @ts-expect-error -- a latitude has no field to travel in
        latitude: 0,
      } satisfies LogEvent,
      {
        event: 'watchdog_failed',
        stage: 'open',
        code: null,
        // @ts-expect-error -- nor an error's message
        message: 'Failing row contains (…)',
      } satisfies LogEvent,
      {
        event: 'watchdog_failed',
        // @ts-expect-error -- nor a stage of another event
        stage: 'store',
        code: null,
      } satisfies LogEvent,
      {
        event: 'watchdog_overdue',
        journeyId,
        // @ts-expect-error -- nor a position
        position: { latitude: 0, longitude: 0 },
      } satisfies LogEvent,
      {
        event: 'push_failed',
        reason: 'NO_TARGET',
        messageId,
        // @ts-expect-error -- nor who the message was for
        recipientId: journeyId,
      } satisfies LogEvent,
      {
        event: 'push_failed',
        // @ts-expect-error -- nor a reason the push port does not give
        reason: 'TIMEOUT',
        messageId,
      } satisfies LogEvent,
      {
        event: 'delivery_failed',
        stage: 'claim',
        code: null,
        // @ts-expect-error -- nor a message
        message: 'connection refused',
      } satisfies LogEvent,
      {
        event: 'delivery_failed',
        // @ts-expect-error -- nor another stage
        stage: 'send',
        code: null,
      } satisfies LogEvent,
      {
        event: 'database_error',
        pool: 'api',
        code: null,
        // @ts-expect-error -- nor the connection string
        connectionString: 'postgres://synthetic@127.0.0.1:1/synthetic',
      } satisfies LogEvent,
      {
        event: 'database_error',
        // @ts-expect-error -- nor a pool that is neither process's
        pool: 'migrations',
        code: null,
      } satisfies LogEvent,
      {
        event: 'database_error',
        pool: 'worker',
        // @ts-expect-error -- and a code is text or null, never the error itself
        code: new Error('terminating connection'),
      } satisfies LogEvent,
    ];

    expect(refused).toHaveLength(11);
  });

  test.each(LOST_02_EVENTS)(
    'LOST-02-AC22: createLog writes $event as one JSON line, holding exactly that event’s fields',
    (event) => {
      const writer = recordingWriter();

      createLog({ write: writer.write }).write(event);

      const lines = writer.lines();
      expect(lines).toHaveLength(1);
      expect(writer.chunks.join('').endsWith('\n')).toBe(true);
      expect(JSON.parse(lines[0] ?? 'null')).toEqual(event);
    },
  );

  test.each(CLOSED_SETS)(
    'LOST-02-AC22: $what outside its set is written as null, and none of it is written',
    ({ event, field, outside }) => {
      for (const value of outside) {
        const { line, text } = writtenThroughACast({ ...event, [field]: value });

        expect(line, JSON.stringify(value)).toEqual({ ...event, [field]: null });
        if (typeof value === 'string' && value !== '') {
          expect(text, value).not.toContain(`"${value}"`);
        }
      }
    },
  );

  test.each(CLOSED_SETS)(
    'LOST-02-AC22: $what inside its set is written as it is, so the null above is the value’s doing',
    ({ event }) => {
      expect(writtenThroughACast(event).line).toEqual(event);
    },
  );

  test.each(ID_FIELDS)(
    'LOST-02-AC22: a $event.event $field that is not a lower-case UUID is written as null, and none of it is written',
    ({ event, field }) => {
      for (const { what, journeyId: value, markers } of NOT_JOURNEY_IDS) {
        const given = value();
        const { line, text } = writtenThroughACast({ ...event, [field]: given });

        expect(line, what).toEqual({ ...event, [field]: null });
        expect(markersIn(text, markers()), what).toEqual([]);
      }
      expect(writtenThroughACast(event).line).toEqual(event);
    },
  );

  test.each(CODED_EVENTS)(
    'LOST-02-AC22: a $event code that is not a SQLSTATE is written as null, and a SQLSTATE as it is',
    (event) => {
      for (const { what, code } of [...NOT_SQLSTATES, ...CODES_NOT_TEXT]) {
        const { line, text } = writtenThroughACast({ ...event, code });

        expect(line, what).toEqual({ ...event, code: null });
        if (typeof code === 'string' && code !== '') {
          expect(text, what).not.toContain(code);
        }
      }
      expect(writtenThroughACast(event).line).toEqual(event);
    },
  );

  test('LOST-02-AC22: fields the five events do not have, got past the type, are not written: a position, a message, an error, a recipient, a connection string', () => {
    const latitude = String(syntheticCoordinate());
    const longitude = String(syntheticCoordinate());
    const recipientId = syntheticUuid();
    const connectionString = `postgres://synthetic:${syntheticUuid()}@127.0.0.1:1/synthetic`;
    const extra = {
      latitude: Number(latitude),
      longitude: Number(longitude),
      position: { latitude: Number(latitude), longitude: Number(longitude) },
      message: `Failing row contains (${latitude}, ${longitude})`,
      err: new Error(`could not connect to ${connectionString}`),
      recipientId,
      connectionString,
    };

    for (const event of LOST_02_EVENTS) {
      const { line, text } = writtenThroughACast({ ...event, ...extra });

      expect(line, event.event).toEqual(event);
      expect(
        markersIn(text, [latitude, longitude, 'Failing row', recipientId, connectionString]),
        event.event,
      ).toEqual([]);
    }
  });
});

// ===========================================================================
// LOST-03: "I'm home"'s two events and the missing alert (approach item 10).
// Closed, like the rest: a journey ID only as a canonical UUID, a reason and
// a stage only from their sets, a code only as a SQLSTATE, and nothing a
// location, a phone number or an error's message could travel in.
// ===========================================================================

const LOST_03_EVENTS: LogEvent[] = [
  { event: 'home_ignored', reason: 'JOURNEY_ENDED', journeyId: syntheticUuid() },
  { event: 'home_failed', stage: 'read', code: '57P01' },
  { event: 'home_failed', stage: 'store', code: null },
  { event: 'alert_missing', journeyId: syntheticUuid() },
];

describe('PRIV-07 and LOST-03: the three new events are closed, at the type and at run time', () => {
  test('LOST-03-AC19: (L1) each of the three is exactly its fields, no more and no fewer: a field added to one, an optional one included, or a set widened, fails typecheck', () => {
    // As LOST-02-AC22's pin: each entry is `true` only when each type is
    // assignable to the other and both have the same keys.
    type Exactly<A, B> = [A] extends [B]
      ? [B] extends [A]
        ? [keyof A] extends [keyof B]
          ? [keyof B] extends [keyof A]
            ? true
            : false
          : false
        : false
      : false;
    type EventOf<Name extends LogEvent['event']> = Extract<LogEvent, { event: Name }>;
    const pinned: [
      Exactly<
        EventOf<'home_ignored'>,
        { event: 'home_ignored'; reason: 'JOURNEY_ENDED'; journeyId: string }
      >,
      Exactly<
        EventOf<'home_failed'>,
        { event: 'home_failed'; stage: 'read' | 'store'; code: string | null }
      >,
      Exactly<EventOf<'alert_missing'>, { event: 'alert_missing'; journeyId: string }>,
    ] = [true, true, true];

    expect(pinned).toEqual([true, true, true]);
  });

  test('LOST-03-AC19: (L1) none of the three holds another field: a latitude, a message, a position, the walker, or another reason or stage does not type-check', () => {
    // Each @ts-expect-error fails the type check (gate:static) the day the
    // property under it stops being an error. Values only; none is handed to
    // the log.
    const journeyId = syntheticUuid();
    const refused: unknown[] = [
      {
        event: 'home_ignored',
        reason: 'JOURNEY_ENDED',
        journeyId,
        // @ts-expect-error -- a latitude has no field to travel in
        latitude: 0,
      } satisfies LogEvent,
      {
        event: 'home_ignored',
        // @ts-expect-error -- nor a reason the rule does not give
        reason: 'NOT_THE_JOURNEYS_DEVICE',
        journeyId,
      } satisfies LogEvent,
      {
        event: 'home_failed',
        stage: 'store',
        code: null,
        // @ts-expect-error -- nor an error's message
        message: 'Failing row contains (…)',
      } satisfies LogEvent,
      {
        event: 'home_failed',
        // @ts-expect-error -- nor a stage "I'm home" does not have
        stage: 'clock',
        code: null,
      } satisfies LogEvent,
      {
        event: 'alert_missing',
        journeyId,
        // @ts-expect-error -- nor a position
        position: { latitude: 0, longitude: 0 },
      } satisfies LogEvent,
      {
        event: 'alert_missing',
        journeyId,
        // @ts-expect-error -- nor who was walking
        walkerId: journeyId,
      } satisfies LogEvent,
    ];

    expect(refused).toHaveLength(6);
  });

  test.each(LOST_03_EVENTS)(
    'LOST-03-AC19: createLog writes $event as one JSON line, holding exactly that event’s fields',
    (event) => {
      const writer = recordingWriter();

      createLog({ write: writer.write }).write(event);

      const lines = writer.lines();
      expect(lines).toHaveLength(1);
      expect(writer.chunks.join('').endsWith('\n')).toBe(true);
      expect(JSON.parse(lines[0] ?? 'null')).toEqual(event);
    },
  );

  test.each([
    {
      what: 'a home_ignored reason',
      event: { event: 'home_ignored', reason: 'JOURNEY_ENDED', journeyId: syntheticUuid() },
      field: 'reason',
      outside: ['JOURNEY_NOT_FOUND', 'NOT_THE_JOURNEYS_DEVICE', 'journey_ended', '', 409],
    },
    {
      what: 'a home_failed stage',
      event: { event: 'home_failed', stage: 'read', code: '57P01' },
      field: 'stage',
      outside: ['clock', 'open', 'claim', 'STORE', '', ['store']],
    },
  ])(
    'LOST-03-AC19: $what outside its set is written as null, and none of it is written; inside it, as it is',
    ({ event, field, outside }) => {
      for (const value of [...outside, ...freeText().map(({ value: text }) => text)]) {
        const { line, text } = writtenThroughACast({ ...event, [field]: value });

        expect(line, JSON.stringify(value)).toEqual({ ...event, [field]: null });
        if (typeof value === 'string' && value !== '') {
          expect(text, value).not.toContain(`"${value}"`);
        }
      }
      expect(writtenThroughACast(event).line).toEqual(event);
    },
  );

  test.each([
    { event: { event: 'home_ignored', reason: 'JOURNEY_ENDED', journeyId: syntheticUuid() } },
    { event: { event: 'alert_missing', journeyId: syntheticUuid() } },
  ])(
    'LOST-03-AC19: in the $event.event line, a journeyId that is not a lower-case canonical UUID is written as null, and none of it is written',
    ({ event }) => {
      for (const { what, journeyId: value, markers } of NOT_JOURNEY_IDS) {
        const { line, text } = writtenThroughACast({ ...event, journeyId: value() });

        expect(line, what).toEqual({ ...event, journeyId: null });
        expect(markersIn(text, markers()), what).toEqual([]);
      }
      expect(writtenThroughACast(event).line).toEqual(event);
    },
  );

  test('LOST-03-AC19: a home_failed code that is not a SQLSTATE is written as null, and a SQLSTATE as it is', () => {
    const event = { event: 'home_failed', stage: 'store', code: '23505' };

    for (const { what, code } of [...NOT_SQLSTATES, ...CODES_NOT_TEXT]) {
      const { line, text } = writtenThroughACast({ ...event, code });

      expect(line, what).toEqual({ ...event, code: null });
      if (typeof code === 'string' && code !== '') {
        expect(text, what).not.toContain(code);
      }
    }
    expect(writtenThroughACast(event).line).toEqual(event);
  });

  test('LOST-03-AC19: fields the three events do not have, got past the type, are not written: a position, a message, an error, a walker', () => {
    const latitude = String(syntheticCoordinate());
    const longitude = String(syntheticCoordinate());
    const walkerId = syntheticUuid();
    const extra = {
      latitude: Number(latitude),
      longitude: Number(longitude),
      position: { latitude: Number(latitude), longitude: Number(longitude) },
      message: `Failing row contains (${latitude}, ${longitude})`,
      err: new Error(`Failing row contains (${latitude}, ${longitude})`),
      walkerId,
    };

    for (const event of LOST_03_EVENTS) {
      const { line, text } = writtenThroughACast({ ...event, ...extra });

      expect(line, event.event).toEqual(event);
      expect(markersIn(text, [latitude, longitude, 'Failing row', walkerId]), event.event).toEqual(
        [],
      );
    }
  });
});
