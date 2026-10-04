// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// (The marker came with LOST-02's review loop 1, as its siblings carry it:
// the LOST-02 names below are the fake's abilities that task added, not
// proofs of its criteria, so req:coverage must not count them.)
//
// The fake PostgreSQL server, checked byte by byte against the protocol's
// own message layouts (PostgreSQL's "Message Formats" chapter). The test that
// matters more is the one where a real `pg` client talks to it, through the
// API process: apps/server/src/api-process.test.ts. This one holds the
// framing, so that a failure there is never the fake misreading a message.
import { describe, expect, test } from 'vitest';
import {
  fakePostgres,
  pgSettingsAnswer,
  type FakePostgresHandler,
  type FakePostgresQuery,
} from './fake-postgres.ts';

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

  // Test audit, test-auditor: Bind's result-format codes were read past
  // unchecked, so a client asking for binary results would have been sent
  // text, and would have decoded it wrong without either side saying so.
  // Format codes: 0 is text, 1 is binary. Bind carries the parameters' codes,
  // the parameters, then the results' codes; pg sends one result code, 0,
  // which stands for every column.

  /** A Bind of `select $1` with these format codes and one text parameter. */
  const bind = (parameterFormats: number[], resultFormats: number[]): number[] => [
    ...frame('P', [...cstring(''), ...cstring('select $1'), ...int16(0)]),
    ...frame('B', [
      ...cstring(''),
      ...cstring(''),
      ...int16(parameterFormats.length),
      ...parameterFormats.flatMap(int16),
      ...int16(1),
      ...int32(1),
      ...bytesOf('a'),
      ...int16(resultFormats.length),
      ...resultFormats.flatMap(int16),
    ]),
    ...frame('D', [...bytesOf('P'), ...cstring('')]),
    ...frame('E', [...cstring(''), ...int32(0)]),
    ...frame('S', []),
  ];

  test('BUG-12: results asked for as text, one code for every column as pg sends it, are answered', () => {
    const { database, connection } = started(() => ({ columns: ['id'], rows: [['a']] }));

    const reply = connection.receive(Uint8Array.from(bind([0], [0])));

    expect(typesOf(reply)).toEqual(['1', '2', 'T', 'D', 'C', 'Z']);
    expect(database.queries).toEqual([{ text: 'select $1', values: ['a'] }]);
  });

  test.each([
    ['for every column', [1], '[1]'],
    ['for one column of two', [0, 1], '[0,1]'],
  ])(
    'BUG-12: results asked for in binary %s throw, naming the codes and the query, and nothing is recorded as asked',
    (_, resultFormats, named) => {
      const { database, connection } = started(() => ({ columns: ['id'], rows: [['a']] }));

      expect(() => connection.receive(Uint8Array.from(bind([0], resultFormats)))).toThrow(
        `result format codes ${named}`,
      );
      expect(() =>
        started(noRows).connection.receive(Uint8Array.from(bind([0], resultFormats))),
      ).toThrow('select $1');
      expect(database.queries).toEqual([]);
    },
  );

  test('BUG-12: a parameter sent in binary throws, naming the codes and the query', () => {
    const { database, connection } = started(noRows);

    expect(() => connection.receive(Uint8Array.from(bind([1], [0])))).toThrow(
      'parameter format codes [1]',
    );
    expect(() => started(noRows).connection.receive(Uint8Array.from(bind([1], [0])))).toThrow(
      'select $1',
    );
    expect(database.queries).toEqual([]);
  });
});

// LOST-02: the startup parameters a pool asks for (AC17: the session limits
// travel there), and a session ended the way PostgreSQL ends one (AC18: a
// FATAL error with a SQLSTATE, then nothing). The process tests read the
// first and use the second; a fake that dropped a parameter, or ended a
// connection with an ERROR the client survives, would make them pass whatever
// the pool did.
describe('fakePostgres: startup parameters and a fatal end (LOST-02)', () => {
  /** A startup holding these parameters, as pg sends one: name, value, …, then a zero byte. */
  function startupWith(parameters: Record<string, string>): number[] {
    const body = [
      ...int32(196_608),
      ...Object.entries(parameters).flatMap(([name, value]) => [
        ...cstring(name),
        ...cstring(value),
      ]),
      0,
    ];
    return [...int32(body.length + 4), ...body];
  }

  test('records each connection’s startup parameters, by name, as text', () => {
    const database = fakePostgres(noRows);
    const connection = database.connect();
    expect(connection.parameters).toEqual({});

    connection.receive(
      Uint8Array.from(
        startupWith({
          user: 'synthetic',
          database: 'synthetic',
          idle_in_transaction_session_timeout: '10000',
          lock_timeout: '5000',
        }),
      ),
    );

    expect(connection.parameters).toEqual({
      user: 'synthetic',
      database: 'synthetic',
      idle_in_transaction_session_timeout: '10000',
      lock_timeout: '5000',
    });
  });

  test('lists every connection made, in order, each with only its own queries', () => {
    const database = fakePostgres(noRows);
    const first = database.connect();
    const second = database.connect();
    first.receive(Uint8Array.from(STARTUP));
    second.receive(Uint8Array.from(STARTUP));

    first.receive(Uint8Array.from(frame('Q', cstring('select 1'))));
    second.receive(Uint8Array.from(frame('Q', cstring('select 2'))));

    expect(database.connections).toEqual([first, second]);
    expect(first.queries).toEqual([{ text: 'select 1', values: [] }]);
    expect(second.queries).toEqual([{ text: 'select 2', values: [] }]);
    expect(database.queries).toHaveLength(2);
  });

  test('ends a connection with one ErrorResponse of severity FATAL, carrying the SQLSTATE and the message, and answers nothing after it', () => {
    const { connection } = started(noRows);

    const fatal = connection.end({ code: '57P01', message: 'terminating connection' });

    expect(connection.ended).toBe(true);
    const [error, ...rest] = messages(fatal);
    expect(rest).toEqual([]);
    expect(error?.type).toBe('E');
    expect(error?.body).toEqual([
      ...bytesOf('S'),
      ...cstring('FATAL'),
      ...bytesOf('V'),
      ...cstring('FATAL'),
      ...bytesOf('C'),
      ...cstring('57P01'),
      ...bytesOf('M'),
      ...cstring('terminating connection'),
      0,
    ]);
    expect(connection.receive(Uint8Array.from(frame('Q', cstring('select 1'))))).toEqual(
      new Uint8Array(0),
    );
    expect(connection.queries).toEqual([]);
  });

  test('a connection not ended says so', () => {
    expect(started(noRows).connection.ended).toBe(false);
  });

  test('a handler that throws an error with a SQLSTATE as its code answers with that SQLSTATE; one with none, or with a code that is not one, answers XX000', () => {
    const codes: unknown[] = ['57014', undefined, 'not a sqlstate', 57014];
    let call = 0;
    const { connection } = started(() => {
      const code = codes[call];
      call += 1;
      throw Object.assign(new Error('synthetic refusal'), { code });
    });

    const sent = codes.map((_code, n) =>
      messages(connection.receive(Uint8Array.from(frame('Q', cstring(`query ${String(n)}`))))),
    );

    const sqlstates = sent.map((answer) => {
      const body = answer.find(({ type }) => type === 'E')?.body ?? [];
      const at = body.indexOf('C'.charCodeAt(0));
      return String.fromCharCode(...body.slice(at + 1, body.indexOf(0, at)));
    });
    expect(sqlstates).toEqual(['57014', 'XX000', 'XX000', 'XX000']);
  });
});

describe('pgSettingsAnswer (LOST-02, review loop 1)', () => {
  const query = (text: string, values: readonly (string | null)[] = []): FakePostgresQuery => ({
    text,
    values,
  });
  const SETTINGS = {
    idle_in_transaction_session_timeout: { setting: '10000', unit: 'ms' },
    lock_timeout: { setting: '0', unit: 'ms' },
  } as const;

  test('answers a read of pg_settings with one row per setting it names, in the columns and the order it asks for', () => {
    expect(
      pgSettingsAnswer(
        query(
          "select name, setting, unit from pg_settings where name in ('idle_in_transaction_session_timeout', 'lock_timeout')",
        ),
        SETTINGS,
      ),
    ).toEqual({
      columns: ['name', 'setting', 'unit'],
      rows: [
        ['idle_in_transaction_session_timeout', '10000', 'ms'],
        ['lock_timeout', '0', 'ms'],
      ],
    });
    expect(
      pgSettingsAnswer(
        query('select "unit", "setting", "name" from "pg_settings" where "name" = any($1)', [
          '{lock_timeout}',
        ]),
        SETTINGS,
      ),
    ).toEqual({ columns: ['unit', 'setting', 'name'], rows: [['ms', '0', 'lock_timeout']] });
  });

  test('names given as parameters count; a setting the test chose no value for is no row; any other query is left to the handler', () => {
    expect(
      pgSettingsAnswer(
        query('select name, setting, unit from pg_settings where name = $1', [
          'idle_in_transaction_session_timeout',
        ]),
        { lock_timeout: { setting: '5000', unit: 'ms' } },
      ),
    ).toEqual({ columns: ['name', 'setting', 'unit'], rows: [] });
    expect(pgSettingsAnswer(query('select now()'), SETTINGS)).toBeUndefined();
  });

  test('a read asking for a column it does not answer throws, rather than guessing', () => {
    expect(() =>
      pgSettingsAnswer(query('select name, setting, source from pg_settings'), SETTINGS),
    ).toThrow(/source/);
  });
});
