// The fake PostgreSQL server, checked byte by byte against the protocol's
// own message layouts (PostgreSQL's "Message Formats" chapter). The test that
// matters more is the one where a real `pg` client talks to it, through the
// API process: apps/server/src/api-process.test.ts. This one holds the
// framing, so that a failure there is never the fake misreading a message.
import { describe, expect, test } from 'vitest';
import { fakePostgres, type FakePostgresHandler } from './fake-postgres.ts';

const bytesOf = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));
const int16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff];
const int32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];
const cstring = (text: string): number[] => [...bytesOf(text), 0];

/** A message from the client: type byte, length, body. */
const frame = (type: string, body: number[]): number[] => [
  ...bytesOf(type),
  ...int32(body.length + 4),
  ...body,
];

const STARTUP = [...int32(8 + 'user\0synthetic\0\0'.length), ...int32(196_608)].concat(
  cstring('user'),
  cstring('synthetic'),
  [0],
);

/** The server's messages, split into their type and body. */
function messages(bytes: Uint8Array): { type: string; body: number[] }[] {
  const out = [];
  let at = 0;
  while (at < bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + at + 1, 4);
    const length = view.getInt32(0);
    out.push({
      type: String.fromCharCode(bytes[at] ?? 0),
      body: Array.from(bytes.subarray(at + 5, at + 1 + length)),
    });
    at += 1 + length;
  }
  return out;
}

const typesOf = (bytes: Uint8Array): string[] => messages(bytes).map((message) => message.type);

function started(handler: FakePostgresHandler) {
  const database = fakePostgres(handler);
  const connection = database.connect();
  const greeting = connection.receive(Uint8Array.from(STARTUP));
  return { database, connection, greeting };
}

const noRows: FakePostgresHandler = () => ({ columns: [], rows: [] });

describe('fakePostgres', () => {
  test('a startup with no password is let in: authentication OK, then ready for a query', () => {
    const { greeting } = started(noRows);

    expect(messages(greeting)).toEqual([
      { type: 'R', body: int32(0) },
      { type: 'Z', body: bytesOf('I') },
    ]);
  });

  test('BUG-12: a TLS request throws: pg sends one only when TLS is configured, so declining it would be a guess', () => {
    // Review loop 1, code-reviewer: this was answered with N, which only
    // this file's own test used.
    const connection = fakePostgres(noRows).connect();

    expect(() => connection.receive(Uint8Array.from([...int32(8), ...int32(80_877_103)]))).toThrow(
      /protocol 80877103/,
    );
  });

  test('a simple query is recorded, and answered with its columns, its rows as text, its tag and ready', () => {
    const { database, connection } = started(() => ({
      columns: ['now'],
      rows: [['2031-02-03 04:05:06+00']],
    }));

    const reply = connection.receive(Uint8Array.from(frame('Q', cstring('select now() as now'))));

    expect(database.queries).toEqual([{ text: 'select now() as now', values: [] }]);
    const [description, row, tag, ready] = messages(reply);
    expect([description?.type, row?.type, tag?.type, ready?.type]).toEqual(['T', 'D', 'C', 'Z']);
    expect(description?.body.slice(0, 2)).toEqual(int16(1));
    expect(description?.body.slice(2, 6)).toEqual(cstring('now'));
    expect(row?.body).toEqual([
      ...int16(1),
      ...int32('2031-02-03 04:05:06+00'.length),
      ...bytesOf('2031-02-03 04:05:06+00'),
    ]);
    expect(tag?.body).toEqual(cstring('SELECT 1'));
  });

  test('an extended query is recorded with its parameters, null included, and answered in protocol order', () => {
    const { database, connection } = started(() => ({ columns: ['id'], rows: [['a'], [null]] }));

    const reply = connection.receive(
      Uint8Array.from([
        ...frame('P', [...cstring(''), ...cstring('select $1, $2'), ...int16(0)]),
        ...frame('B', [
          ...cstring(''),
          ...cstring(''),
          ...int16(0),
          ...int16(2),
          ...int32(2),
          ...bytesOf('ab'),
          ...int32(-1),
          ...int16(0),
        ]),
        ...frame('D', [...bytesOf('P'), ...cstring('')]),
        ...frame('E', [...cstring(''), ...int32(0)]),
        ...frame('S', []),
      ]),
    );

    expect(database.queries).toEqual([{ text: 'select $1, $2', values: ['ab', null] }]);
    expect(typesOf(reply)).toEqual(['1', '2', 'T', 'D', 'D', 'C', 'Z']);
    expect(messages(reply)[4]?.body).toEqual([...int16(1), ...int32(-1)]);
  });

  test('a query with no columns to describe gets NoData, and the tag SELECT 0', () => {
    // Review loop 1, code-reviewer: a handler could name its own tag, which
    // only this test used, so the option is gone. pg and Drizzle do not read
    // the tag for these queries.
    const { connection } = started(() => ({ columns: [], rows: [] }));

    const reply = connection.receive(
      Uint8Array.from([
        ...frame('P', [...cstring(''), ...cstring('insert'), ...int16(0)]),
        ...frame('B', [...cstring(''), ...cstring(''), ...int16(0), ...int16(0), ...int16(0)]),
        ...frame('D', [...bytesOf('P'), ...cstring('')]),
        ...frame('E', [...cstring(''), ...int32(0)]),
        ...frame('S', []),
      ]),
    );

    expect(typesOf(reply)).toEqual(['1', '2', 'n', 'C', 'Z']);
    expect(messages(reply)[3]?.body).toEqual(cstring('SELECT 0'));
  });

  test('a handler that throws is an error to the client, carrying its message, and the next query is answered', () => {
    let calls = 0;
    const { database, connection } = started(() => {
      calls += 1;
      if (calls === 1) throw new Error('synthetic refusal');
      return { columns: [], rows: [] };
    });

    const refused = connection.receive(
      Uint8Array.from([
        ...frame('P', [...cstring(''), ...cstring('first'), ...int16(0)]),
        ...frame('B', [...cstring(''), ...cstring(''), ...int16(0), ...int16(0), ...int16(0)]),
        ...frame('D', [...bytesOf('P'), ...cstring('')]),
        ...frame('E', [...cstring(''), ...int32(0)]),
        ...frame('S', []),
      ]),
    );
    const answered = connection.receive(Uint8Array.from(frame('Q', cstring('second'))));

    // After the error, nothing until Sync, as PostgreSQL does.
    expect(typesOf(refused)).toEqual(['1', '2', 'E', 'Z']);
    expect(String.fromCharCode(...(messages(refused)[2]?.body ?? []))).toContain(
      'synthetic refusal',
    );
    expect(typesOf(answered)).toEqual(['C', 'Z']);
    expect(database.queries.map((query) => query.text)).toEqual(['first', 'second']);
  });

  test('a message split across chunks is answered once it is whole, and not before', () => {
    const { database, connection } = started(noRows);
    const whole = frame('Q', cstring('select 1'));

    const early = connection.receive(Uint8Array.from(whole.slice(0, 3)));
    const late = connection.receive(Uint8Array.from(whole.slice(3)));

    expect(early.length).toBe(0);
    expect(typesOf(late)).toEqual(['C', 'Z']);
    expect(database.queries).toEqual([{ text: 'select 1', values: [] }]);
  });

  test('an answer it cannot send as ASCII throws, rather than garbling it', () => {
    const { connection } = started(() => ({ columns: ['name'], rows: [['syntetisk-æøå']] }));

    expect(() => connection.receive(Uint8Array.from(frame('Q', cstring('select 1'))))).toThrow(
      /ASCII/,
    );
  });

  test('a message it does not understand throws, rather than being answered with a guess', () => {
    const { connection } = started(noRows);

    expect(() => connection.receive(Uint8Array.from(frame('F', [])))).toThrow(/"F"/);
  });

  // Review loop 1, code-reviewer: three messages were answered with a guess,
  // against this file's own promise that anything unknown throws. pg sends
  // Close only when a bind throws, Flush only for a query with `rows` set,
  // and always describes a portal before it executes it.
  const PARSED_AND_BOUND = [
    ...frame('P', [...cstring(''), ...cstring('select 1'), ...int16(0)]),
    ...frame('B', [...cstring(''), ...cstring(''), ...int16(0), ...int16(0), ...int16(0)]),
  ];

  test('BUG-12: Close throws, rather than answering that it closed what it did not', () => {
    const { connection } = started(noRows);

    expect(() =>
      connection.receive(
        Uint8Array.from([...PARSED_AND_BOUND, ...frame('C', [...bytesOf('P'), ...cstring('')])]),
      ),
    ).toThrow(/"C"/);
  });

  test('BUG-12: Flush throws: no adapter sends it', () => {
    const { connection } = started(noRows);

    expect(() => connection.receive(Uint8Array.from(frame('H', [])))).toThrow(/"H"/);
  });

  test('BUG-12: an Execute with no Describe before it throws, and nothing is recorded as asked', () => {
    const { database, connection } = started(noRows);

    expect(() =>
      connection.receive(
        Uint8Array.from([...PARSED_AND_BOUND, ...frame('E', [...cstring(''), ...int32(0)])]),
      ),
    ).toThrow(/describe/i);
    expect(database.queries).toEqual([]);
  });
});
