/**
 * PostgreSQL's side of the wire, in memory: a stand-in database that a real
 * `pg` client can talk to. It records every query it is sent and answers each
 * one as the test says.
 *
 * Why it exists (BUG-12): the API process builds its own connection pool from
 * a URL, and its adapters build on that. A test that gives it no database at
 * all sees only that a request failed. It cannot see what the process asked
 * the database first, and "asked the database what time it is" is the wiring
 * REL-01 rests on. Three mutants of `api-process.ts` that hand the API its
 * services empty fail the same way a missing database does, so they survived
 * every in-process test. With this, a test listens on a port, hands the
 * process that URL, and reads what arrived.
 *
 * It speaks only what node-postgres sends for the queries the adapters make:
 * a startup with no password, the simple query, the extended query (Parse,
 * Bind, Describe of a portal, then Execute, then Sync), and Terminate, which
 * `pool.end()` sends. Every column goes back as text, and every command tag
 * is `SELECT <number of rows>`, which neither pg nor Drizzle reads for these
 * queries. Anything else it is sent throws, loudly, rather than being
 * answered with a guess: a TLS request, Close and Flush (pg sends them only
 * when TLS is configured, when a bind fails, or for a query with `rows` set,
 * and none of that is in use), a Describe of a statement, an Execute with no
 * Describe before it, and a Bind that sends a parameter in binary or asks for
 * results in binary, naming the format codes it was sent.
 *
 * ASCII only. Synthetic data needs nothing else (RG-07), and a fake that
 * garbled a character would be wrong without saying so, so it refuses
 * instead. The test kit has no Node types (it is meant to stay usable from the
 * app), so the socket lives in the test that needs one, and this file works
 * on bytes alone.
 */

/** A query as the database received it. */
export interface FakePostgresQuery {
  /** The SQL, as the client sent it. */
  readonly text: string;
  /** Its parameters, as text and in order; `null` is SQL's NULL. */
  readonly values: readonly (string | null)[];
}

/** What the database answers a query with. Every column is text. */
export interface FakePostgresAnswer {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | null)[])[];
}

/** Answers a query, or throws to make the database answer it with an error. */
export type FakePostgresHandler = (query: FakePostgresQuery) => FakePostgresAnswer;

/** One client connection: the bytes the client sent in, the bytes to send back. */
export interface FakePostgresConnection {
  receive(chunk: Uint8Array): Uint8Array;
}

export interface FakePostgres {
  /** Every query any connection sent, in the order they arrived. */
  readonly queries: readonly FakePostgresQuery[];
  /** A new connection's protocol state, for a socket the test accepted. */
  connect(): FakePostgresConnection;
}

/** Protocol 3.0, which every current client asks for at startup. */
const PROTOCOL_3 = 196_608;
/** PostgreSQL's type ID for `text`. */
const TEXT_TYPE = 25;

function ascii(text: string): number[] {
  const codes: number[] = [];
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (code > 0x7f) {
      throw new Error(
        `The fake PostgreSQL server speaks ASCII only, and was asked to send ${JSON.stringify(text)}. ` +
          'Synthetic data needs nothing else (RG-07).',
      );
    }
    codes.push(code);
  }
  return codes;
}

function fromAscii(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    if (byte > 0x7f) {
      throw new Error(
        'The fake PostgreSQL server reads ASCII only, and was sent a byte outside it. ' +
          'Synthetic data needs nothing else (RG-07).',
      );
    }
    text += String.fromCharCode(byte);
  }
  return text;
}

const int16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff];
const int32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];
const cstring = (text: string): number[] => [...ascii(text), 0];

/** One message from the server: its type, its length, its body. */
function message(type: string, body: readonly number[] = []): number[] {
  return [...ascii(type), ...int32(body.length + 4), ...body];
}

function rowDescription(columns: readonly string[]): number[] {
  return message('T', [
    ...int16(columns.length),
    ...columns.flatMap((name) => [
      ...cstring(name),
      ...int32(0), // no table
      ...int16(0), // no column number
      ...int32(TEXT_TYPE),
      ...int16(-1), // variable length
      ...int32(-1), // no type modifier
      ...int16(0), // text format
    ]),
  ]);
}

function rowsAndTag(answer: FakePostgresAnswer): number[] {
  const rows = answer.rows.flatMap((row) =>
    message('D', [
      ...int16(row.length),
      ...row.flatMap((value) =>
        value === null ? int32(-1) : [...int32(value.length), ...ascii(value)],
      ),
    ]),
  );
  return [...rows, ...message('C', cstring(`SELECT ${String(answer.rows.length)}`))];
}

function errorResponse(text: string): number[] {
  return message('E', [
    ...ascii('S'),
    ...cstring('ERROR'),
    ...ascii('V'),
    ...cstring('ERROR'),
    ...ascii('C'),
    ...cstring('XX000'),
    ...ascii('M'),
    ...cstring(text),
    0,
  ]);
}

const readyForQuery = (): number[] => message('Z', ascii('I'));

/** Reads a message body front to back. */
function reader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  return {
    int16(): number {
      const value = view.getInt16(at);
      at += 2;
      return value;
    },
    int32(): number {
      const value = view.getInt32(at);
      at += 4;
      return value;
    },
    text(length: number): string {
      const value = fromAscii(bytes.subarray(at, at + length));
      at += length;
      return value;
    },
    cstring(): string {
      const end = bytes.indexOf(0, at);
      if (end === -1) {
        throw new Error('The fake PostgreSQL server was sent a string with no end.');
      }
      const value = fromAscii(bytes.subarray(at, end));
      at = end + 1;
      return value;
    },
  };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

type Outcome = { answer: FakePostgresAnswer } | { error: string };

interface Portal {
  query: FakePostgresQuery;
  answer?: FakePostgresAnswer;
}

export function fakePostgres(handler: FakePostgresHandler): FakePostgres {
  const queries: FakePostgresQuery[] = [];

  function ask(query: FakePostgresQuery): Outcome {
    queries.push(query);
    try {
      return { answer: handler(query) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  function connect(): FakePostgresConnection {
    let pending: Uint8Array = new Uint8Array(0);
    let started = false;
    // After an error in an extended query, PostgreSQL ignores every message
    // up to the next Sync, and so does this.
    let skippingToSync = false;
    const statements = new Map<string, string>();
    const portals = new Map<string, Portal>();

    function portalNamed(name: string): Portal {
      const portal = portals.get(name);
      if (portal === undefined) {
        throw new Error(
          `The fake PostgreSQL server has no portal "${name}"; nothing was bound to it.`,
        );
      }
      return portal;
    }

    function startup(code: number): number[] {
      if (code !== PROTOCOL_3) {
        throw new Error(`The fake PostgreSQL server does not speak protocol ${String(code)}.`);
      }
      started = true;
      // Trust: no password asked for, so none is ever written in a test.
      return [...message('R', int32(0)), ...readyForQuery()];
    }

    function handle(type: string, body: Uint8Array): number[] {
      const read = reader(body);
      switch (type) {
        case 'Q': {
          const outcome = ask({ text: read.cstring(), values: [] });
          if ('error' in outcome) {
            return [...errorResponse(outcome.error), ...readyForQuery()];
          }
          const { answer } = outcome;
          return [
            ...(answer.columns.length > 0 ? rowDescription(answer.columns) : []),
            ...rowsAndTag(answer),
            ...readyForQuery(),
          ];
        }
        case 'P': {
          if (skippingToSync) return [];
          const name = read.cstring();
          statements.set(name, read.cstring());
          return message('1');
        }
        case 'B': {
          if (skippingToSync) return [];
          const portal = read.cstring();
          const statement = read.cstring();
          const text = statements.get(statement);
          if (text === undefined) {
            throw new Error(`The fake PostgreSQL server was never sent statement "${statement}".`);
          }
          // Format codes: 0 is text, 1 is binary. Parameters' codes come
          // first, then the parameters, then the results' codes.
          const parameterFormats = Array.from({ length: read.int16() }, () => read.int16());
          if (parameterFormats.some((format) => format !== 0)) {
            throw new Error(
              'The fake PostgreSQL server takes parameters as text only (format code 0), and was ' +
                `sent parameter format codes ${JSON.stringify(parameterFormats)} for: ${text}`,
            );
          }
          const values = Array.from({ length: read.int16() }, () => {
            const length = read.int32();
            return length === -1 ? null : read.text(length);
          });
          const resultFormats = Array.from({ length: read.int16() }, () => read.int16());
          if (resultFormats.some((format) => format !== 0)) {
            // Answered anyway, the rows would go back as text to a client
            // that decodes them as binary, and neither side would say so.
            throw new Error(
              'The fake PostgreSQL server sends results as text only (format code 0), and was ' +
                `asked for result format codes ${JSON.stringify(resultFormats)} for: ${text}`,
            );
          }
          portals.set(portal, { query: { text, values } });
          return message('2');
        }
        case 'D': {
          if (skippingToSync) return [];
          const kind = read.text(1);
          if (kind !== 'P') {
            throw new Error('The fake PostgreSQL server describes portals only, not statements.');
          }
          const portal = portalNamed(read.cstring());
          const outcome = ask(portal.query);
          if ('error' in outcome) {
            skippingToSync = true;
            return errorResponse(outcome.error);
          }
          portal.answer = outcome.answer;
          return outcome.answer.columns.length > 0
            ? rowDescription(outcome.answer.columns)
            : message('n');
        }
        case 'E': {
          if (skippingToSync) return [];
          const portal = portalNamed(read.cstring());
          if (portal.answer === undefined) {
            // pg always describes a portal before it executes it, so this is
            // not what it sent, and answering would be a guess.
            throw new Error(
              'The fake PostgreSQL server was asked to execute a portal it was never asked to describe.',
            );
          }
          return rowsAndTag(portal.answer);
        }
        case 'S':
          skippingToSync = false;
          portals.delete('');
          return readyForQuery();
        case 'X': // Terminate, from pool.end(): the client closes the socket itself.
          return [];
        default:
          throw new Error(`The fake PostgreSQL server does not understand message "${type}".`);
      }
    }

    return {
      receive(chunk: Uint8Array): Uint8Array {
        pending = concat([pending, chunk]);
        const out: number[] = [];
        for (;;) {
          const view = new DataView(pending.buffer, pending.byteOffset, pending.byteLength);
          if (pending.length < (started ? 5 : 8)) break;
          // A startup message has no type byte; every later one has one.
          const length = started ? view.getInt32(1) + 1 : view.getInt32(0);
          if (pending.length < length) break;
          const frame = pending.subarray(0, length);
          pending = pending.subarray(length);
          const reply = started
            ? handle(String.fromCharCode(frame[0] ?? 0), frame.subarray(5))
            : startup(view.getInt32(4));
          for (const byte of reply) out.push(byte);
        }
        return Uint8Array.from(out);
      },
    };
  }

  return { queries, connect };
}
