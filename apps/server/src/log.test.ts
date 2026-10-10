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
import { syntheticCoordinate, syntheticCredential, syntheticUuid } from '@trygghverdag/test-kit';
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
  // LOST-06 (the spec's "Added to, not changed"): "I'm on it" for an alert
  // already over, and an "I'm on it" that failed.
  { event: 'acknowledgement_ignored', reason: 'ALERT_RESOLVED', alertId: syntheticUuid() },
  { event: 'acknowledgement_failed', stage: 'store', code: '40001' },
  // LOST-07 (the spec's "Added to, not changed"): the escalation's, the SMS
  // sender's and the SMS check's six.
  { event: 'escalation_failed', stage: 'escalate', code: '40001' },
  { event: 'escalation_overdue', alertId: syntheticUuid() },
  { event: 'sms_failed', reason: 'NO_TARGET', messageId: syntheticUuid() },
  { event: 'sms_delivery_failed', stage: 'claim', code: '57P01' },
  { event: 'sms_unsent', count: 3 },
  { event: 'sms_check_failed', stage: 'report', code: null },
  // SM-10 (the spec's "Added to, not changed"): the removal's two, and the
  // count of unheard alerts.
  { event: 'removal_ignored', reason: 'JOURNEY_ENDED', journeyId: syntheticUuid() },
  { event: 'removal_failed', stage: 'store', code: '55P03' },
  { event: 'unheard_alerts', count: 1 },
  // LOST-08 (the spec's "Added to, not changed"): the close's two and the
  // 24-hour end's two.
  { event: 'closure_ignored', reason: 'ALERT_RESOLVED', alertId: syntheticUuid() },
  { event: 'closure_failed', stage: 'store', code: '40001' },
  { event: 'expiry_failed', stage: 'expire', code: '55P03' },
  { event: 'expiry_overdue', alertId: syntheticUuid() },
  // REL-10 (the spec's "Added to, not changed"): the staging canary's four.
  {
    event: 'canary_run',
    outcome: 'ON_TIME',
    alertMs: 301_250,
    openedAfterMs: 300_000,
    status: null,
    code: null,
  },
  { event: 'canary_skipped', reason: 'RUN_IN_FLIGHT' },
  { event: 'canary_leftover_ended', journeyId: syntheticUuid() },
  { event: 'canary_report_failed' },
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

// ===========================================================================
// LOST-06's two events (its spec's approach item 11): an "I'm on it" for an
// alert already over, naming the alert and the reason, and an "I'm on it"
// that failed, with its stage and SQLSTATE. Closed, like the rest: an alert's
// ID only as a canonical UUID, a reason and a stage only from their sets, a
// code only as a SQLSTATE, and no user's ID, no location and no message.
// ===========================================================================

const LOST_06_EVENTS: LogEvent[] = [
  { event: 'acknowledgement_ignored', reason: 'ALERT_RESOLVED', alertId: syntheticUuid() },
  { event: 'acknowledgement_failed', stage: 'read', code: '57P01' },
  { event: 'acknowledgement_failed', stage: 'store', code: null },
];

describe('PRIV-07 and LOST-06: the two new events are closed, at the type and at run time', () => {
  test('LOST-06-AC16: (L1) each of the two is exactly its fields, no more and no fewer: a field added to one, an optional one included, or a set widened, fails typecheck', () => {
    // As LOST-03-AC19's pin: each entry is `true` only when each type is
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
        EventOf<'acknowledgement_ignored'>,
        { event: 'acknowledgement_ignored'; reason: 'ALERT_RESOLVED'; alertId: string }
      >,
      Exactly<
        EventOf<'acknowledgement_failed'>,
        { event: 'acknowledgement_failed'; stage: 'read' | 'store'; code: string | null }
      >,
    ] = [true, true];

    expect(pinned).toEqual([true, true]);
  });

  test('LOST-06-AC16: (L1) neither holds another field: a latitude, a message, a position, the responder, or another reason or stage does not type-check', () => {
    // Each @ts-expect-error fails the type check (gate:static) the day the
    // property under it stops being an error. Values only; none is handed to
    // the log.
    const alertId = syntheticUuid();
    const refused: unknown[] = [
      {
        event: 'acknowledgement_ignored',
        reason: 'ALERT_RESOLVED',
        alertId,
        // @ts-expect-error -- a latitude has no field to travel in
        latitude: 0,
      } satisfies LogEvent,
      {
        event: 'acknowledgement_ignored',
        // @ts-expect-error -- nor a reason the route answers but does not log
        reason: 'ALREADY_ACKNOWLEDGED',
        alertId,
      } satisfies LogEvent,
      {
        event: 'acknowledgement_ignored',
        reason: 'ALERT_RESOLVED',
        alertId,
        // @ts-expect-error -- nor who sent it: no user's ID is logged
        responderId: alertId,
      } satisfies LogEvent,
      {
        event: 'acknowledgement_failed',
        stage: 'store',
        code: null,
        // @ts-expect-error -- nor an error's message
        message: 'Failing row contains (…)',
      } satisfies LogEvent,
      {
        event: 'acknowledgement_failed',
        // @ts-expect-error -- nor a stage "I'm on it" does not have
        stage: 'clock',
        code: null,
      } satisfies LogEvent,
      {
        event: 'acknowledgement_failed',
        stage: 'read',
        code: null,
        // @ts-expect-error -- nor a position
        position: { latitude: 0, longitude: 0 },
      } satisfies LogEvent,
    ];

    expect(refused).toHaveLength(6);
  });

  test.each(LOST_06_EVENTS)(
    'LOST-06-AC16: createLog writes $event as one JSON line, holding exactly that event’s fields',
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
      what: 'an acknowledgement_ignored reason',
      event: {
        event: 'acknowledgement_ignored',
        reason: 'ALERT_RESOLVED',
        alertId: syntheticUuid(),
      },
      field: 'reason',
      outside: [
        'ALERT_NOT_FOUND',
        'ALREADY_ACKNOWLEDGED',
        'JOURNEY_ENDED',
        'alert_resolved',
        '',
        409,
      ],
    },
    {
      what: 'an acknowledgement_failed stage',
      event: { event: 'acknowledgement_failed', stage: 'read', code: '57P01' },
      field: 'stage',
      outside: ['clock', 'open', 'claim', 'STORE', '', ['store']],
    },
  ])(
    'LOST-06-AC16: $what outside its set is written as null, and none of it is written; inside it, as it is',
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

  test('LOST-06-AC16: the stages read and store are each written as they are, so the null above is the value’s doing', () => {
    for (const stage of ['read', 'store']) {
      const event = { event: 'acknowledgement_failed', stage, code: null };
      expect(writtenThroughACast(event).line, stage).toEqual(event);
    }
  });

  test('LOST-06-AC16: in the acknowledgement_ignored line, an alertId that is not a lower-case canonical UUID is written as null, and none of it is written', () => {
    const event = {
      event: 'acknowledgement_ignored',
      reason: 'ALERT_RESOLVED',
      alertId: syntheticUuid(),
    };

    for (const { what, journeyId: value, markers } of NOT_JOURNEY_IDS) {
      const { line, text } = writtenThroughACast({ ...event, alertId: value() });

      expect(line, what).toEqual({ ...event, alertId: null });
      expect(markersIn(text, markers()), what).toEqual([]);
    }
    expect(writtenThroughACast(event).line).toEqual(event);
  });

  test('LOST-06-AC16: an acknowledgement_failed code that is not a SQLSTATE is written as null, and a SQLSTATE as it is', () => {
    const event = { event: 'acknowledgement_failed', stage: 'store', code: '23505' };

    for (const { what, code } of [...NOT_SQLSTATES, ...CODES_NOT_TEXT]) {
      const { line, text } = writtenThroughACast({ ...event, code });

      expect(line, what).toEqual({ ...event, code: null });
      if (typeof code === 'string' && code !== '') {
        expect(text, what).not.toContain(code);
      }
    }
    expect(writtenThroughACast(event).line).toEqual(event);
  });

  test('LOST-06-AC16: fields the two events do not have, got past the type, are not written: a position, a message, an error, the responder, a credential', () => {
    const latitude = String(syntheticCoordinate());
    const longitude = String(syntheticCoordinate());
    const responderId = syntheticUuid();
    const credential = syntheticCredential();
    const extra = {
      latitude: Number(latitude),
      longitude: Number(longitude),
      position: { latitude: Number(latitude), longitude: Number(longitude) },
      message: `Failing row contains (${latitude}, ${longitude})`,
      err: new Error(`Failing row contains (${latitude}, ${longitude}) for ${responderId}`),
      responderId,
      credential,
    };

    for (const event of LOST_06_EVENTS) {
      const { line, text } = writtenThroughACast({ ...event, ...extra });

      expect(line, event.event).toEqual(event);
      expect(
        markersIn(text, [latitude, longitude, 'Failing row', responderId, credential]),
        event.event,
      ).toEqual([]);
    }
  });
});

// ===========================================================================
// LOST-07's six events (its spec's approach item 12): the escalation that
// failed or is overdue, the SMS not accepted, the SMS delivery and the SMS
// check that failed, and the count of SMS waiting. Closed, like the rest: an
// alert's or a message's ID only as a canonical UUID, a reason and a stage
// only from their sets, a code only as a SQLSTATE, a count only as a
// non-negative safe integer, and no field a phone number, a name, a location
// or a message could travel in.
// ===========================================================================

const LOST_07_EVENTS: LogEvent[] = [
  { event: 'escalation_failed', stage: 'read', code: '57P01' },
  { event: 'escalation_failed', stage: 'escalate', code: null },
  { event: 'escalation_overdue', alertId: syntheticUuid() },
  { event: 'sms_failed', reason: 'NO_TARGET', messageId: syntheticUuid() },
  { event: 'sms_failed', reason: 'REFUSED', messageId: syntheticUuid() },
  { event: 'sms_failed', reason: 'UNAVAILABLE', messageId: syntheticUuid() },
  { event: 'sms_failed', reason: 'NOT_CONFIGURED', messageId: syntheticUuid() },
  { event: 'sms_delivery_failed', stage: 'claim', code: '08006' },
  { event: 'sms_delivery_failed', stage: 'mark', code: null },
  { event: 'sms_unsent', count: 0 },
  { event: 'sms_unsent', count: 3 },
  { event: 'sms_unsent', count: Number.MAX_SAFE_INTEGER },
  { event: 'sms_check_failed', stage: 'read', code: '53300' },
  { event: 'sms_check_failed', stage: 'report', code: null },
];

/** For each new event with a field closed to a set: a valid event, the field, and values outside the set. */
const LOST_07_CLOSED_SETS: {
  what: string;
  event: Record<string, unknown>;
  field: string;
  outside: unknown[];
}[] = [
  {
    what: 'an escalation_failed stage',
    event: { event: 'escalation_failed', stage: 'read', code: '57P01' },
    field: 'stage',
    outside: ['open', 'beat', 'claim', 'store', 'ESCALATE', '', ['read'], 3],
  },
  {
    what: 'an sms_failed reason',
    event: { event: 'sms_failed', reason: 'NO_TARGET', messageId: syntheticUuid() },
    field: 'reason',
    outside: ['TIMEOUT', 'BLOCKED', 'no_target', '', ['NO_TARGET'], 500],
  },
  {
    what: 'an sms_delivery_failed stage',
    event: { event: 'sms_delivery_failed', stage: 'claim', code: '57P01' },
    field: 'stage',
    outside: ['send', 'read', 'report', 'CLAIM', '', ['mark']],
  },
  {
    what: 'an sms_check_failed stage',
    event: { event: 'sms_check_failed', stage: 'read', code: '57P01' },
    field: 'stage',
    outside: ['count', 'claim', 'escalate', 'REPORT', '', ['report']],
  },
];

/** Counts that are not a non-negative safe integer: each is written as null. */
const NOT_COUNTS: { what: string; count: unknown }[] = [
  { what: 'a negative number', count: -1 },
  { what: 'a fraction', count: 1.5 },
  { what: 'not a number', count: Number.NaN },
  { what: 'infinity', count: Number.POSITIVE_INFINITY },
  { what: 'past the safe integers', count: Number.MAX_SAFE_INTEGER + 1 },
  { what: 'a numeral in text', count: '3' },
  { what: 'a count in a list', count: [3] },
  { what: 'null', count: null },
  { what: 'a coordinate', count: syntheticCoordinate() },
];

describe('PRIV-07 and LOST-07: the six new events are closed, at the type and at run time', () => {
  test('LOST-07-AC18: (L1) each of the six is exactly its fields, no more and no fewer: a field added to one, an optional one included, or a set widened, fails typecheck', () => {
    // As LOST-06-AC16's pin: each entry is `true` only when each type is
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
        EventOf<'escalation_failed'>,
        { event: 'escalation_failed'; stage: 'read' | 'escalate'; code: string | null }
      >,
      Exactly<EventOf<'escalation_overdue'>, { event: 'escalation_overdue'; alertId: string }>,
      Exactly<
        EventOf<'sms_failed'>,
        {
          event: 'sms_failed';
          reason: 'NO_TARGET' | 'REFUSED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
          messageId: string;
        }
      >,
      Exactly<
        EventOf<'sms_delivery_failed'>,
        { event: 'sms_delivery_failed'; stage: 'claim' | 'mark'; code: string | null }
      >,
      Exactly<EventOf<'sms_unsent'>, { event: 'sms_unsent'; count: number }>,
      Exactly<
        EventOf<'sms_check_failed'>,
        { event: 'sms_check_failed'; stage: 'read' | 'report'; code: string | null }
      >,
    ] = [true, true, true, true, true, true];

    expect(pinned).toEqual([true, true, true, true, true, true]);
  });

  test('LOST-07-AC18: (L1) none of the six holds another field: a phone number, a latitude, a message, a recipient, a name, or another stage or reason does not type-check', () => {
    // Each @ts-expect-error fails the type check (gate:static) the day the
    // property under it stops being an error. Values only; none is handed to
    // the log, and none is a phone number: the field's name is what is tried.
    const alertId = syntheticUuid();
    const messageId = syntheticUuid();
    const refused: unknown[] = [
      {
        event: 'escalation_failed',
        stage: 'escalate',
        code: null,
        // @ts-expect-error -- an error's message has no field to travel in
        message: 'Failing row contains (…)',
      } satisfies LogEvent,
      {
        event: 'escalation_failed',
        // @ts-expect-error -- nor a stage the escalation does not have
        stage: 'open',
        code: null,
      } satisfies LogEvent,
      {
        event: 'escalation_overdue',
        alertId,
        // @ts-expect-error -- nor a latitude
        latitude: 0,
      } satisfies LogEvent,
      {
        event: 'escalation_overdue',
        alertId,
        // @ts-expect-error -- nor the journey's responders
        responderIds: [alertId],
      } satisfies LogEvent,
      {
        event: 'sms_failed',
        reason: 'NO_TARGET',
        messageId,
        // @ts-expect-error -- nor a phone number
        phoneNumber: '',
      } satisfies LogEvent,
      {
        event: 'sms_failed',
        reason: 'NO_TARGET',
        messageId,
        // @ts-expect-error -- nor who the message was for
        recipientId: alertId,
      } satisfies LogEvent,
      {
        event: 'sms_failed',
        // @ts-expect-error -- nor a reason the SMS port does not give
        reason: 'TIMEOUT',
        messageId,
      } satisfies LogEvent,
      {
        event: 'sms_delivery_failed',
        stage: 'mark',
        code: null,
        // @ts-expect-error -- nor the message's text
        text: '',
      } satisfies LogEvent,
      {
        event: 'sms_delivery_failed',
        // @ts-expect-error -- nor another stage
        stage: 'send',
        code: null,
      } satisfies LogEvent,
      {
        event: 'sms_unsent',
        count: 3,
        // @ts-expect-error -- nor which SMS, or for whom
        messageIds: [messageId],
      } satisfies LogEvent,
      {
        event: 'sms_unsent',
        // @ts-expect-error -- and a count is a number, never text
        count: '3',
      } satisfies LogEvent,
      {
        event: 'sms_check_failed',
        stage: 'report',
        code: null,
        // @ts-expect-error -- nor the check's ping URL
        url: '',
      } satisfies LogEvent,
      {
        event: 'sms_check_failed',
        stage: 'read',
        code: null,
        // @ts-expect-error -- nor a name
        name: '',
      } satisfies LogEvent,
      {
        event: 'sms_check_failed',
        // @ts-expect-error -- nor another stage
        stage: 'count',
        code: null,
      } satisfies LogEvent,
    ];

    expect(refused).toHaveLength(14);
  });

  test.each(LOST_07_EVENTS)(
    'LOST-07-AC18: createLog writes $event as one JSON line, holding exactly that event’s fields',
    (event) => {
      const writer = recordingWriter();

      createLog({ write: writer.write }).write(event);

      const lines = writer.lines();
      expect(lines).toHaveLength(1);
      expect(writer.chunks.join('').endsWith('\n')).toBe(true);
      expect(JSON.parse(lines[0] ?? 'null')).toEqual(event);
    },
  );

  test.each(LOST_07_CLOSED_SETS)(
    'LOST-07-AC18: $what outside its set is written as null, and none of it is written; inside it, as it is',
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

  test('LOST-07-AC18: every stage and reason in its set is written as it is, so the nulls above are the value’s doing', () => {
    const inside: Record<string, unknown>[] = [
      { event: 'escalation_failed', stage: 'read', code: null },
      { event: 'escalation_failed', stage: 'escalate', code: null },
      { event: 'sms_delivery_failed', stage: 'claim', code: null },
      { event: 'sms_delivery_failed', stage: 'mark', code: null },
      { event: 'sms_check_failed', stage: 'read', code: null },
      { event: 'sms_check_failed', stage: 'report', code: null },
      ...['NO_TARGET', 'REFUSED', 'UNAVAILABLE', 'NOT_CONFIGURED'].map((reason) => ({
        event: 'sms_failed',
        reason,
        messageId: syntheticUuid(),
      })),
    ];
    for (const event of inside) {
      expect(writtenThroughACast(event).line, JSON.stringify(event)).toEqual(event);
    }
  });

  test.each([
    { event: { event: 'escalation_overdue', alertId: syntheticUuid() }, field: 'alertId' },
    {
      event: { event: 'sms_failed', reason: 'REFUSED', messageId: syntheticUuid() },
      field: 'messageId',
    },
  ])(
    'LOST-07-AC18: a $event.event $field that is not a lower-case canonical UUID is written as null, and none of it is written',
    ({ event, field }) => {
      for (const { what, journeyId: value, markers } of NOT_JOURNEY_IDS) {
        const { line, text } = writtenThroughACast({ ...event, [field]: value() });

        expect(line, what).toEqual({ ...event, [field]: null });
        expect(markersIn(text, markers()), what).toEqual([]);
      }
      expect(writtenThroughACast(event).line).toEqual(event);
    },
  );

  test.each([
    { event: 'escalation_failed', stage: 'escalate', code: '23505' },
    { event: 'sms_delivery_failed', stage: 'mark', code: '23505' },
    { event: 'sms_check_failed', stage: 'read', code: '23505' },
  ])(
    'LOST-07-AC18: a $event code that is not a SQLSTATE is written as null, and a SQLSTATE as it is',
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

  test('LOST-07-AC18: an sms_unsent count that is not a non-negative safe integer is written as null; 0, 3 and the largest safe integer as they are', () => {
    const event = { event: 'sms_unsent', count: 3 };

    for (const { what, count } of NOT_COUNTS) {
      const { line, text } = writtenThroughACast({ ...event, count });

      expect(line, what).toEqual({ ...event, count: null });
      if (typeof count === 'number' && Number.isFinite(count) && count !== -1) {
        expect(text, what).not.toContain(String(count));
      }
    }
    for (const count of [0, 3, Number.MAX_SAFE_INTEGER]) {
      expect(writtenThroughACast({ ...event, count }).line, String(count)).toEqual({
        ...event,
        count,
      });
    }
  });

  test('LOST-07-AC18: fields the six events do not have, got past the type, are not written: a position, a message, an error, a recipient, a phone-number-shaped value, a credential, the ping URL', () => {
    const latitude = String(syntheticCoordinate());
    const longitude = String(syntheticCoordinate());
    const recipientId = syntheticUuid();
    const credential = syntheticCredential();
    // Phone-number-shaped, made at run time and never in +47 form: what an
    // SMS provider's error could carry (the spec's synthetic-data note).
    const numberShaped = `0${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
    const pingUrl = `https://127.0.0.1:1/${syntheticUuid()}/fail`;
    const extra = {
      latitude: Number(latitude),
      longitude: Number(longitude),
      position: { latitude: Number(latitude), longitude: Number(longitude) },
      message: `Failing row contains (${latitude}, ${longitude})`,
      err: new Error(`could not send to ${numberShaped} for ${recipientId}`),
      recipientId,
      phoneNumber: numberShaped,
      credential,
      url: pingUrl,
    };

    for (const event of LOST_07_EVENTS) {
      const { line, text } = writtenThroughACast({ ...event, ...extra });

      expect(line, event.event).toEqual(event);
      expect(
        markersIn(text, [
          latitude,
          longitude,
          'Failing row',
          recipientId,
          numberShaped,
          credential,
          pingUrl,
        ]),
        event.event,
      ).toEqual([]);
    }
  });
});

// ===========================================================================
// SM-10: the removal's two events, an ignored removal and a failed one, and
// the SMS check's count of unheard alerts (its spec's approach item 11).
// Closed, like the rest: a journey's ID only as a canonical UUID, a reason
// and a stage only from their sets, a code only as a SQLSTATE, a count only
// as a non-negative safe integer, and no field a user's ID, a phone number, a
// location or a message could travel in. No event names the removed
// responder or the walker (PRIV-07).
// ===========================================================================

const SM_10_EVENTS: LogEvent[] = [
  { event: 'removal_ignored', reason: 'JOURNEY_ENDED', journeyId: syntheticUuid() },
  { event: 'removal_failed', stage: 'read', code: '57P01' },
  { event: 'removal_failed', stage: 'store', code: '55P03' },
  { event: 'removal_failed', stage: 'store', code: null },
  { event: 'unheard_alerts', count: 0 },
  { event: 'unheard_alerts', count: 1 },
  { event: 'unheard_alerts', count: Number.MAX_SAFE_INTEGER },
];

/** For each new event with a field closed to a set: a valid event, the field, and values outside the set. */
const SM_10_CLOSED_SETS: {
  what: string;
  event: Record<string, unknown>;
  field: string;
  outside: unknown[];
}[] = [
  {
    what: 'a removal_ignored reason',
    event: { event: 'removal_ignored', reason: 'JOURNEY_ENDED', journeyId: syntheticUuid() },
    field: 'reason',
    outside: ['NOT_A_RESPONDER', 'JOURNEY_NOT_FOUND', 'journey_ended', '', ['JOURNEY_ENDED'], 409],
  },
  {
    what: 'a removal_failed stage',
    event: { event: 'removal_failed', stage: 'store', code: '57P01' },
    field: 'stage',
    outside: ['clock', 'remove', 'open', 'escalate', 'STORE', '', ['read'], 3],
  },
];

describe('PRIV-07 and SM-10: the three new events are closed, at the type and at run time', () => {
  test('SM-10-AC20: (L1) each of the three is exactly its fields, no more and no fewer: a field added to one, an optional one included, or a set widened, fails typecheck', () => {
    // As LOST-07-AC18's pin: each entry is `true` only when each type is
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
        EventOf<'removal_ignored'>,
        { event: 'removal_ignored'; reason: 'JOURNEY_ENDED'; journeyId: string }
      >,
      Exactly<
        EventOf<'removal_failed'>,
        { event: 'removal_failed'; stage: 'read' | 'store'; code: string | null }
      >,
      Exactly<EventOf<'unheard_alerts'>, { event: 'unheard_alerts'; count: number }>,
    ] = [true, true, true];

    expect(pinned).toEqual([true, true, true]);
  });

  test('SM-10-AC20: (L1) none of the three holds another field: a phone number, a latitude, a user’s ID, a message, or another reason or stage does not type-check', () => {
    // Each @ts-expect-error fails the type check (gate:static) the day the
    // property under it stops being an error. Values only; none is handed to
    // the log, and none is a phone number: the field's name is what is tried.
    const journeyId = syntheticUuid();
    const someone = syntheticUuid();
    const refused: unknown[] = [
      {
        event: 'removal_ignored',
        reason: 'JOURNEY_ENDED',
        journeyId,
        // @ts-expect-error -- not the removed responder
        responderId: someone,
      } satisfies LogEvent,
      {
        event: 'removal_ignored',
        reason: 'JOURNEY_ENDED',
        journeyId,
        // @ts-expect-error -- nor the walker
        walkerId: someone,
      } satisfies LogEvent,
      {
        event: 'removal_ignored',
        // @ts-expect-error -- nor a reason the removal does not log
        reason: 'NOT_A_RESPONDER',
        journeyId,
      } satisfies LogEvent,
      {
        event: 'removal_failed',
        stage: 'store',
        code: null,
        // @ts-expect-error -- nor an error's message
        message: 'Failing row contains (…)',
      } satisfies LogEvent,
      {
        event: 'removal_failed',
        stage: 'read',
        code: null,
        // @ts-expect-error -- nor a latitude
        latitude: 0,
      } satisfies LogEvent,
      {
        event: 'removal_failed',
        // @ts-expect-error -- nor another stage
        stage: 'clock',
        code: null,
      } satisfies LogEvent,
      {
        event: 'unheard_alerts',
        count: 1,
        // @ts-expect-error -- nor a phone number
        phoneNumber: '',
      } satisfies LogEvent,
      {
        event: 'unheard_alerts',
        count: 1,
        // @ts-expect-error -- nor which alerts, or whose
        alertIds: [someone],
      } satisfies LogEvent,
      {
        event: 'unheard_alerts',
        // @ts-expect-error -- and a count is a number, never text
        count: '1',
      } satisfies LogEvent,
    ];

    expect(refused).toHaveLength(9);
  });

  test.each(SM_10_EVENTS)(
    'SM-10-AC20: createLog writes $event as one JSON line, holding exactly that event’s fields',
    (event) => {
      const writer = recordingWriter();

      createLog({ write: writer.write }).write(event);

      const lines = writer.lines();
      expect(lines).toHaveLength(1);
      expect(writer.chunks.join('').endsWith('\n')).toBe(true);
      expect(JSON.parse(lines[0] ?? 'null')).toEqual(event);
    },
  );

  test.each(SM_10_CLOSED_SETS)(
    'SM-10-AC20: $what outside its set is written as null, and none of it is written; inside it, as it is',
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

  test('SM-10-AC20: the stages read and store, and the reason JOURNEY_ENDED, are each written as they are, so the nulls above are the value’s doing', () => {
    for (const event of [
      { event: 'removal_failed', stage: 'read', code: null },
      { event: 'removal_failed', stage: 'store', code: null },
      { event: 'removal_ignored', reason: 'JOURNEY_ENDED', journeyId: syntheticUuid() },
    ]) {
      expect(writtenThroughACast(event).line, JSON.stringify(event)).toEqual(event);
    }
  });

  test('SM-10-AC20: in the removal_ignored line, a journeyId that is not a lower-case canonical UUID is written as null, and none of it is written', () => {
    const event = { event: 'removal_ignored', reason: 'JOURNEY_ENDED', journeyId: syntheticUuid() };

    for (const { what, journeyId, markers } of NOT_JOURNEY_IDS) {
      const { line, text } = writtenThroughACast({ ...event, journeyId: journeyId() });

      expect(line, what).toEqual({ ...event, journeyId: null });
      expect(markersIn(text, markers()), what).toEqual([]);
    }
    expect(writtenThroughACast(event).line).toEqual(event);
  });

  test('SM-10-AC20: a removal_failed code that is not a SQLSTATE is written as null, and a SQLSTATE as it is', () => {
    const event = { event: 'removal_failed', stage: 'store', code: '23505' };

    for (const { what, code } of [...NOT_SQLSTATES, ...CODES_NOT_TEXT]) {
      const { line, text } = writtenThroughACast({ ...event, code });

      expect(line, what).toEqual({ ...event, code: null });
      if (typeof code === 'string' && code !== '') {
        expect(text, what).not.toContain(code);
      }
    }
    expect(writtenThroughACast(event).line).toEqual(event);
  });

  test('SM-10-AC20: an unheard_alerts count that is not a non-negative safe integer is written as null; 0, 1 and the largest safe integer as they are', () => {
    const event = { event: 'unheard_alerts', count: 1 };

    for (const { what, count } of NOT_COUNTS) {
      const { line, text } = writtenThroughACast({ ...event, count });

      expect(line, what).toEqual({ ...event, count: null });
      if (typeof count === 'number' && Number.isFinite(count) && count !== -1) {
        expect(text, what).not.toContain(String(count));
      }
    }
    for (const count of [0, 1, Number.MAX_SAFE_INTEGER]) {
      expect(writtenThroughACast({ ...event, count }).line, String(count)).toEqual({
        ...event,
        count,
      });
    }
  });

  test('SM-10-AC20: fields the three events do not have, got past the type, are not written: a position, a message, an error, the removed responder’s ID, the walker’s ID, a phone-number-shaped value, a credential', () => {
    const latitude = String(syntheticCoordinate());
    const longitude = String(syntheticCoordinate());
    const responderId = syntheticUuid();
    const walkerId = syntheticUuid();
    const credential = syntheticCredential();
    // Phone-number-shaped, made at run time and never in +47 form: eight
    // digits with a leading 0, which no Norwegian subscriber number has.
    const numberShaped = `0${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
    const extra = {
      latitude: Number(latitude),
      longitude: Number(longitude),
      position: { latitude: Number(latitude), longitude: Number(longitude) },
      message: `Failing row contains (${latitude}, ${longitude})`,
      err: new Error(`could not remove ${responderId} from ${walkerId}'s journey`),
      responderId,
      walkerId,
      phoneNumber: numberShaped,
      credential,
    };

    for (const event of SM_10_EVENTS) {
      const { line, text } = writtenThroughACast({ ...event, ...extra });

      expect(line, event.event).toEqual(event);
      expect(
        markersIn(text, [
          latitude,
          longitude,
          'Failing row',
          responderId,
          walkerId,
          numberShaped,
          credential,
        ]),
        event.event,
      ).toEqual([]);
    }
  });
});

// ===========================================================================
// LOST-08-AC18: the close's and the 24-hour end's four events. Each is closed
// as the earlier ones are: an alert's ID written only as a lower-case
// canonical UUID, a reason and a stage only from their sets, a code only as a
// SQLSTATE, and no field a user's ID, a phone number, a location or a message
// could travel in. No event names the closer, another responder or the
// walker (PRIV-07).
// ===========================================================================

const LOST_08_EVENTS: LogEvent[] = [
  { event: 'closure_ignored', reason: 'ALERT_RESOLVED', alertId: syntheticUuid() },
  { event: 'closure_failed', stage: 'read', code: '57P01' },
  { event: 'closure_failed', stage: 'store', code: '40001' },
  { event: 'closure_failed', stage: 'store', code: null },
  { event: 'expiry_failed', stage: 'read', code: '57P01' },
  { event: 'expiry_failed', stage: 'expire', code: '55P03' },
  { event: 'expiry_failed', stage: 'expire', code: null },
  { event: 'expiry_overdue', alertId: syntheticUuid() },
];

/** For each new event with a field closed to a set: a valid event, the field, and values outside the set. */
const LOST_08_CLOSED_SETS: {
  what: string;
  event: Record<string, unknown>;
  field: string;
  outside: unknown[];
}[] = [
  {
    what: 'a closure_ignored reason',
    event: { event: 'closure_ignored', reason: 'ALERT_RESOLVED', alertId: syntheticUuid() },
    field: 'reason',
    outside: [
      'NOT_THE_ACKNOWLEDGER',
      'ALERT_NOT_FOUND',
      'JOURNEY_ENDED',
      'alert_resolved',
      '',
      ['ALERT_RESOLVED'],
      409,
    ],
  },
  {
    what: 'a closure_failed stage',
    event: { event: 'closure_failed', stage: 'store', code: '57P01' },
    field: 'stage',
    outside: ['clock', 'close', 'expire', 'escalate', 'STORE', '', ['read'], 3],
  },
  {
    what: 'an expiry_failed stage',
    event: { event: 'expiry_failed', stage: 'expire', code: '57P01' },
    field: 'stage',
    outside: ['store', 'escalate', 'open', 'clock', 'EXPIRE', '', ['read'], 3],
  },
];

describe('PRIV-07 and LOST-08: the four new events are closed, at the type and at run time', () => {
  test('LOST-08-AC18: (L1) each of the four is exactly its fields, no more and no fewer: a field added to one, an optional one included, or a set widened, fails typecheck', () => {
    // As SM-10-AC20's pin: each entry is `true` only when each type is
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
        EventOf<'closure_ignored'>,
        { event: 'closure_ignored'; reason: 'ALERT_RESOLVED'; alertId: string }
      >,
      Exactly<
        EventOf<'closure_failed'>,
        { event: 'closure_failed'; stage: 'read' | 'store'; code: string | null }
      >,
      Exactly<
        EventOf<'expiry_failed'>,
        { event: 'expiry_failed'; stage: 'read' | 'expire'; code: string | null }
      >,
      Exactly<EventOf<'expiry_overdue'>, { event: 'expiry_overdue'; alertId: string }>,
    ] = [true, true, true, true];

    expect(pinned).toEqual([true, true, true, true]);
  });

  test('LOST-08-AC18: (L1) none of the four holds another field: a phone number, a latitude, a user’s ID, a message, or another reason or stage does not type-check', () => {
    // Each @ts-expect-error fails the type check (gate:static) the day the
    // property under it stops being an error. Values only; none is handed to
    // the log, and none is a phone number: the field's name is what is tried.
    const alertId = syntheticUuid();
    const someone = syntheticUuid();
    const refused: unknown[] = [
      {
        event: 'closure_ignored',
        reason: 'ALERT_RESOLVED',
        alertId,
        // @ts-expect-error -- not the responder who closed it, or tried to
        responderId: someone,
      } satisfies LogEvent,
      {
        event: 'closure_ignored',
        reason: 'ALERT_RESOLVED',
        alertId,
        // @ts-expect-error -- nor the walker
        walkerId: someone,
      } satisfies LogEvent,
      {
        event: 'closure_ignored',
        // @ts-expect-error -- nor a refusal: refusals are not logged
        reason: 'NOT_THE_ACKNOWLEDGER',
        alertId,
      } satisfies LogEvent,
      {
        event: 'closure_failed',
        stage: 'store',
        code: null,
        // @ts-expect-error -- nor an error's message
        message: 'Failing row contains (…)',
      } satisfies LogEvent,
      {
        event: 'closure_failed',
        stage: 'read',
        code: null,
        // @ts-expect-error -- nor a phone number
        phoneNumber: '',
      } satisfies LogEvent,
      {
        event: 'closure_failed',
        // @ts-expect-error -- nor another stage
        stage: 'close',
        code: null,
      } satisfies LogEvent,
      {
        event: 'expiry_failed',
        stage: 'expire',
        code: null,
        // @ts-expect-error -- nor a latitude
        latitude: 0,
      } satisfies LogEvent,
      {
        event: 'expiry_failed',
        stage: 'read',
        code: null,
        // @ts-expect-error -- nor which alert's responders were told
        responderIds: [someone],
      } satisfies LogEvent,
      {
        event: 'expiry_failed',
        // @ts-expect-error -- nor another stage
        stage: 'store',
        code: null,
      } satisfies LogEvent,
      {
        event: 'expiry_overdue',
        alertId,
        // @ts-expect-error -- nor the acknowledger
        acknowledgedBy: someone,
      } satisfies LogEvent,
      {
        event: 'expiry_overdue',
        alertId,
        // @ts-expect-error -- nor an error's message
        message: 'canceling statement due to lock timeout',
      } satisfies LogEvent,
    ];

    expect(refused).toHaveLength(11);
  });

  test.each(LOST_08_EVENTS)(
    'LOST-08-AC18: createLog writes $event as one JSON line, holding exactly that event’s fields',
    (event) => {
      const writer = recordingWriter();

      createLog({ write: writer.write }).write(event);

      const lines = writer.lines();
      expect(lines).toHaveLength(1);
      expect(writer.chunks.join('').endsWith('\n')).toBe(true);
      expect(JSON.parse(lines[0] ?? 'null')).toEqual(event);
    },
  );

  test.each(LOST_08_CLOSED_SETS)(
    'LOST-08-AC18: $what outside its set is written as null, and none of it is written; inside it, as it is',
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

  test('LOST-08-AC18: the stages read, store and expire, and the reason ALERT_RESOLVED, are each written as they are, so the nulls above are the value’s doing', () => {
    for (const event of [
      { event: 'closure_failed', stage: 'read', code: null },
      { event: 'closure_failed', stage: 'store', code: null },
      { event: 'expiry_failed', stage: 'read', code: null },
      { event: 'expiry_failed', stage: 'expire', code: null },
      { event: 'closure_ignored', reason: 'ALERT_RESOLVED', alertId: syntheticUuid() },
    ]) {
      expect(writtenThroughACast(event).line, JSON.stringify(event)).toEqual(event);
    }
  });

  test.each([
    { event: { event: 'closure_ignored', reason: 'ALERT_RESOLVED', alertId: syntheticUuid() } },
    { event: { event: 'expiry_overdue', alertId: syntheticUuid() } },
  ])(
    'LOST-08-AC18: in the $event.event line, an alertId that is not a lower-case canonical UUID is written as null, and none of it is written',
    ({ event }) => {
      for (const { what, journeyId: value, markers } of NOT_JOURNEY_IDS) {
        const { line, text } = writtenThroughACast({ ...event, alertId: value() });

        expect(line, what).toEqual({ ...event, alertId: null });
        expect(markersIn(text, markers()), what).toEqual([]);
      }
      expect(writtenThroughACast(event).line).toEqual(event);
    },
  );

  test.each([
    { event: { event: 'closure_failed', stage: 'store', code: '23505' } },
    { event: { event: 'expiry_failed', stage: 'expire', code: '23505' } },
  ])(
    'LOST-08-AC18: in the $event.event line, a code that is not a SQLSTATE is written as null, and a SQLSTATE as it is',
    ({ event }) => {
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

  test('LOST-08-AC18: fields the four events do not have, got past the type, are not written: a position, a message, an error, the closer’s ID, the walker’s ID, a phone-number-shaped value, a credential', () => {
    const latitude = String(syntheticCoordinate());
    const longitude = String(syntheticCoordinate());
    const responderId = syntheticUuid();
    const walkerId = syntheticUuid();
    const credential = syntheticCredential();
    // Phone-number-shaped, made at run time and never in +47 form: eight
    // digits with a leading 0, which no Norwegian subscriber number has.
    const numberShaped = `0${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
    const extra = {
      latitude: Number(latitude),
      longitude: Number(longitude),
      position: { latitude: Number(latitude), longitude: Number(longitude) },
      message: `Failing row contains (${latitude}, ${longitude})`,
      err: new Error(`could not close ${walkerId}'s alert for ${responderId}`),
      responderId,
      acknowledgedBy: responderId,
      walkerId,
      phoneNumber: numberShaped,
      credential,
    };

    for (const event of LOST_08_EVENTS) {
      const { line, text } = writtenThroughACast({ ...event, ...extra });

      expect(line, event.event).toEqual(event);
      expect(
        markersIn(text, [
          latitude,
          longitude,
          'Failing row',
          responderId,
          walkerId,
          numberShaped,
          credential,
        ]),
        event.event,
      ).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// REL-10: the staging canary's four events (the spec's approach item 11).
// One line per run, with its outcome, the alert's two durations from last
// contact, an HTTP status and a SQLSTATE; a run skipped because another is in
// flight; a leftover journey of the canary's ended, naming it; and a report to
// the canary's own check that failed. No user's ID, no credential and no URL
// has a field to travel in, and each field is written only when its value is
// one the field allows: an outcome from the list, a whole non-negative number
// of milliseconds, an HTTP status from 100 to 599, a SQLSTATE, a canonical
// UUID (PRIV-07).
// ---------------------------------------------------------------------------

const REL_10_EVENTS: LogEvent[] = [
  {
    event: 'canary_run',
    outcome: 'ON_TIME',
    alertMs: 301_250,
    openedAfterMs: 300_000,
    status: null,
    code: null,
  },
  {
    event: 'canary_run',
    outcome: 'START_FAILED',
    alertMs: null,
    openedAfterMs: null,
    status: 401,
    code: null,
  },
  {
    event: 'canary_run',
    outcome: 'READ_FAILED',
    alertMs: null,
    openedAfterMs: null,
    status: null,
    code: '57P01',
  },
  {
    event: 'canary_run',
    outcome: 'NOT_HANDED_OVER',
    alertMs: null,
    openedAfterMs: 0,
    status: 599,
    code: null,
  },
  {
    event: 'canary_run',
    outcome: 'INTERRUPTED',
    alertMs: 0,
    openedAfterMs: Number.MAX_SAFE_INTEGER,
    status: 100,
    code: 'XX000',
  },
  { event: 'canary_skipped', reason: 'RUN_IN_FLIGHT' },
  { event: 'canary_leftover_ended', journeyId: syntheticUuid() },
  { event: 'canary_report_failed' },
];

/** Every outcome a canary run can come to, as the interfaces list them. */
const CANARY_OUTCOME_LIST = [
  'ON_TIME',
  'NOT_CONFIGURED',
  'REGISTER_FAILED',
  'START_FAILED',
  'HEARTBEAT_FAILED',
  'READ_FAILED',
  'OPENED_EARLY',
  'NOT_OPENED',
  'NOT_HANDED_OVER',
  'HOME_FAILED',
  'NOT_RESOLVED',
  'ESCALATED',
  'STAND_DOWN_NOT_HANDED_OVER',
  'RUN_LIMIT',
  'INTERRUPTED',
] as const;

/** A canary_run line the other tests vary one field of. */
const A_RUN = {
  event: 'canary_run',
  outcome: 'ON_TIME',
  alertMs: 305_000,
  openedAfterMs: 300_000,
  status: null,
  code: null,
};

/** Durations that are not a whole non-negative number of milliseconds: each written as null. */
const NOT_DURATIONS: { what: string; value: unknown }[] = [
  { what: 'a negative number', value: -1 },
  { what: 'a fraction', value: 300_000.5 },
  { what: 'not a number', value: Number.NaN },
  { what: 'infinity', value: Number.POSITIVE_INFINITY },
  { what: 'beyond the largest safe integer', value: Number.MAX_SAFE_INTEGER + 2 },
  { what: 'text holding a number', value: '300000' },
  { what: 'a coordinate', value: syntheticCoordinate() },
];

/** Statuses that are not an HTTP status from 100 to 599: each written as null. */
const NOT_STATUSES: { what: string; value: unknown }[] = [
  { what: 'just under 100', value: 99 },
  { what: 'just over 599', value: 600 },
  { what: 'zero', value: 0 },
  { what: 'a negative number', value: -401 },
  { what: 'a fraction', value: 200.5 },
  { what: 'text holding a status', value: '401' },
  { what: 'not a number', value: Number.NaN },
];

describe('PRIV-07 and REL-10: the canary’s four events are closed, at the type and at run time', () => {
  test('REL-10-AC15: (L1) PRIV-07: each of the four is exactly its fields, no more and no fewer: a field added to one, an optional one included, or a set widened, fails typecheck', () => {
    // As LOST-08-AC18's pin: each entry is `true` only when each type is
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
        EventOf<'canary_run'>,
        {
          event: 'canary_run';
          outcome: (typeof CANARY_OUTCOME_LIST)[number];
          alertMs: number | null;
          openedAfterMs: number | null;
          status: number | null;
          code: string | null;
        }
      >,
      Exactly<EventOf<'canary_skipped'>, { event: 'canary_skipped'; reason: 'RUN_IN_FLIGHT' }>,
      Exactly<
        EventOf<'canary_leftover_ended'>,
        { event: 'canary_leftover_ended'; journeyId: string }
      >,
      Exactly<EventOf<'canary_report_failed'>, { event: 'canary_report_failed' }>,
    ] = [true, true, true, true];

    expect(pinned).toEqual([true, true, true, true]);
  });

  test('REL-10-AC15: (L1) PRIV-07: none of the four holds another field: a credential, a URL, a user’s ID, a latitude, a message, or another outcome or reason does not type-check', () => {
    // Each @ts-expect-error fails the type check (gate:static) the day the
    // property under it stops being an error. Values only; none is handed to
    // the log. The credential is the test kit's, made at run time (RG-07).
    const credential = syntheticCredential();
    const someone = syntheticUuid();
    const refused: unknown[] = [
      {
        event: 'canary_run',
        outcome: 'ON_TIME',
        alertMs: 305_000,
        openedAfterMs: 300_000,
        status: null,
        code: null,
        // @ts-expect-error -- not the canary's credential
        credential,
      } satisfies LogEvent,
      {
        event: 'canary_run',
        outcome: 'START_FAILED',
        alertMs: null,
        openedAfterMs: null,
        status: 401,
        code: null,
        // @ts-expect-error -- nor the API's URL
        url: 'https://canary-api.invalid/v1/journeys',
      } satisfies LogEvent,
      {
        event: 'canary_run',
        outcome: 'ON_TIME',
        alertMs: 305_000,
        openedAfterMs: 300_000,
        status: null,
        code: null,
        // @ts-expect-error -- nor the walker's ID
        walkerId: someone,
      } satisfies LogEvent,
      {
        event: 'canary_run',
        // @ts-expect-error -- nor an outcome outside the list
        outcome: 'LATE',
        alertMs: null,
        openedAfterMs: null,
        status: null,
        code: null,
      } satisfies LogEvent,
      {
        event: 'canary_skipped',
        reason: 'RUN_IN_FLIGHT',
        // @ts-expect-error -- nor a latitude
        latitude: 0,
      } satisfies LogEvent,
      {
        event: 'canary_skipped',
        // @ts-expect-error -- nor another reason
        reason: 'LEFTOVER',
      } satisfies LogEvent,
      {
        event: 'canary_leftover_ended',
        journeyId: someone,
        // @ts-expect-error -- nor the responder's ID
        responderId: someone,
      } satisfies LogEvent,
      {
        event: 'canary_report_failed',
        // @ts-expect-error -- nor the report's error message
        message: 'Healthchecks.io answered 500.',
      } satisfies LogEvent,
      {
        event: 'canary_report_failed',
        // @ts-expect-error -- nor the ping URL
        url: 'https://hc-ping.com/00000000-0000-0000-0000-000000000000',
      } satisfies LogEvent,
    ];

    expect(refused).toHaveLength(9);
  });

  test.each(REL_10_EVENTS)(
    'REL-10-AC15: PRIV-07: createLog writes $event as one JSON line, holding exactly that event’s fields',
    (event) => {
      const writer = recordingWriter();

      createLog({ write: writer.write }).write(event);

      const lines = writer.lines();
      expect(lines).toHaveLength(1);
      expect(writer.chunks.join('').endsWith('\n')).toBe(true);
      expect(JSON.parse(lines[0] ?? 'null')).toEqual(event);
    },
  );

  test('REL-10-AC15: PRIV-07: every outcome in the list is written as it is', () => {
    for (const outcome of CANARY_OUTCOME_LIST) {
      expect(writtenThroughACast({ ...A_RUN, outcome }).line, outcome).toEqual({
        ...A_RUN,
        outcome,
      });
    }
  });

  test('REL-10-AC15: PRIV-07: an outcome outside the list is written as null, and none of it is written', () => {
    for (const value of [
      'LATE',
      'on_time',
      '',
      ['ON_TIME'],
      3,
      ...freeText().map(({ value: text }) => text),
    ]) {
      const { line, text } = writtenThroughACast({ ...A_RUN, outcome: value });

      expect(line, JSON.stringify(value)).toEqual({ ...A_RUN, outcome: null });
      if (typeof value === 'string' && value !== '') {
        expect(text, value).not.toContain(`"${value}"`);
      }
    }
  });

  test.each(['alertMs', 'openedAfterMs'])(
    'REL-10-AC15: PRIV-07: a canary_run %s that is not a whole non-negative number of milliseconds is written as null; 0 and the largest safe integer as they are',
    (field) => {
      for (const { what, value } of NOT_DURATIONS) {
        expect(writtenThroughACast({ ...A_RUN, [field]: value }).line, what).toEqual({
          ...A_RUN,
          [field]: null,
        });
      }
      for (const value of [0, 360_000, Number.MAX_SAFE_INTEGER]) {
        expect(writtenThroughACast({ ...A_RUN, [field]: value }).line).toEqual({
          ...A_RUN,
          [field]: value,
        });
      }
    },
  );

  test('REL-10-AC15: PRIV-07: a canary_run status outside 100 to 599 is written as null; 100, 302, 401 and 599 as they are', () => {
    for (const { what, value } of NOT_STATUSES) {
      expect(writtenThroughACast({ ...A_RUN, status: value }).line, what).toEqual({
        ...A_RUN,
        status: null,
      });
    }
    for (const status of [100, 302, 401, 599]) {
      expect(writtenThroughACast({ ...A_RUN, status }).line).toEqual({ ...A_RUN, status });
    }
  });

  test('REL-10-AC15: PRIV-07: a canary_run code that is not a SQLSTATE is written as null, and a SQLSTATE as it is', () => {
    for (const { what, code } of [...NOT_SQLSTATES, ...CODES_NOT_TEXT]) {
      const { line, text } = writtenThroughACast({ ...A_RUN, code });

      expect(line, what).toEqual({ ...A_RUN, code: null });
      if (typeof code === 'string' && code !== '') {
        expect(text, what).not.toContain(code);
      }
    }
    expect(writtenThroughACast({ ...A_RUN, code: '57P01' }).line).toEqual({
      ...A_RUN,
      code: '57P01',
    });
  });

  test('REL-10-AC15: PRIV-07: in the canary_leftover_ended line, a journeyId that is not a lower-case canonical UUID is written as null, and none of it is written', () => {
    const event = { event: 'canary_leftover_ended', journeyId: syntheticUuid() };
    for (const { what, journeyId: value, markers } of NOT_JOURNEY_IDS) {
      const { line, text } = writtenThroughACast({ ...event, journeyId: value() });

      expect(line, what).toEqual({ ...event, journeyId: null });
      expect(markersIn(text, markers()), what).toEqual([]);
    }
    expect(writtenThroughACast(event).line).toEqual(event);
  });

  test('REL-10-AC15: PRIV-07: a canary_skipped reason other than RUN_IN_FLIGHT is written as null, and none of it is written', () => {
    const event = { event: 'canary_skipped', reason: 'RUN_IN_FLIGHT' };
    for (const value of ['LEFTOVER', 'run_in_flight', '', ['RUN_IN_FLIGHT'], 409]) {
      const { line, text } = writtenThroughACast({ ...event, reason: value });

      expect(line, JSON.stringify(value)).toEqual({ ...event, reason: null });
      if (typeof value === 'string' && value !== '') {
        expect(text, value).not.toContain(`"${value}"`);
      }
    }
    expect(writtenThroughACast(event).line).toEqual(event);
  });

  test('REL-10-AC15: PRIV-07: fields the four events do not have, got past the type, are not written: a credential, a URL, the walker’s, responder’s and device’s IDs, a position, a message, a phone-number-shaped value', () => {
    const latitude = String(syntheticCoordinate());
    const longitude = String(syntheticCoordinate());
    const credential = syntheticCredential();
    const [walkerId, responderId, deviceId] = [syntheticUuid(), syntheticUuid(), syntheticUuid()];
    const url = `https://canary-api-${syntheticUuid()}.invalid`;
    // Phone-number-shaped, made at run time and never in +47 form: eight
    // digits with a leading 0, which no Norwegian subscriber number has.
    const numberShaped = `0${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
    const extra = {
      credential,
      authorization: `Bearer ${credential}`,
      url,
      apiUrl: url,
      walkerId,
      responderId,
      deviceId,
      latitude: Number(latitude),
      position: { latitude: Number(latitude), longitude: Number(longitude) },
      message: `could not reach ${url} for ${walkerId} at ${latitude}, ${longitude}`,
      err: new Error(`fetch failed: ${url} ${credential}`),
      phoneNumber: numberShaped,
    };

    for (const event of REL_10_EVENTS) {
      const { line, text } = writtenThroughACast({ ...event, ...extra });

      expect(line, event.event).toEqual(event);
      expect(
        markersIn(text, [
          credential,
          url,
          walkerId,
          responderId,
          deviceId,
          latitude,
          longitude,
          numberShaped,
        ]),
        event.event,
      ).toEqual([]);
    }
  });
});
