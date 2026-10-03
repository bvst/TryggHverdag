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
