// req-coverage: fixtures-only — a test helper and the controls that prove it; it covers no requirement itself.
//
// The test kit's fake PostgreSQL server, on a local port, for a process to
// connect to by URL: one copy, used by api-process.test.ts and worker.test.ts.
// It lived in api-process.test.ts until the lost-contact task, whose worker
// tests need it too: the worker's pool asks for its session limits at
// startup, and its listeners must survive a connection PostgreSQL ends.
//
// The test kit cannot hold it: it has no Node types, and the socket lives
// here. Named like a test because it is one: the controls below run in every
// file that imports it, so each file that relies on it proves it in its own
// run, as capture.test.ts does.
//
// It records what it is asked and answers through `handler`. No password is
// ever asked for: the fake lets anyone in, so a password in the URL is only
// ever a marker a test looks for in what was written.
//
// The fake throws on anything it would otherwise have to guess at (a message
// it does not speak, an answer it cannot encode). Thrown inside the socket's
// data handler, that was an uncaught exception, and the request waited for a
// reply until the test timed out (test audit, test-auditor). So the throw is
// caught, the connection is closed, which fails the request at once, and
// `close()` rejects with what the fake said. Every test awaits `close()` in
// its `finally`, so it fails with the fake's own message, in place of
// whatever the failed request made it assert, and even when the request
// somehow succeeded.
//
// BUG-34 adds a second stand-in beside it, used by db.test.ts and
// worker.test.ts: a database that accepts the connection and never answers
// (listeningSilentPostgres), as safety-reviewer showed on BUG-32 with a TCP
// listener as DATABASE_URL. And a wait bounded in real time (settledWithin),
// so a test can drive pg's own timers with Vitest's fake ones and still say
// "it hung" rather than time out.
//
// BUG-51 adds a third, used by db.test.ts, worker.test.ts and
// api-process.test.ts: a database that completes the startup and then never
// answers a query (listeningHungPostgres). That is what a backend stuck for
// ever, or a peer that vanished without a reset, looks like to a client whose
// connection is already up, and BUG-34's bound on the handshake no longer
// reaches it.
import {
  fakePostgres,
  syntheticCredential,
  type FakePostgres,
  type FakePostgresAnswer,
  type FakePostgresConnection,
  type FakePostgresFatal,
  type FakePostgresHandler,
  type FakePostgresQuery,
} from '@trygghverdag/test-kit';
import { Socket, connect, createServer, type AddressInfo } from 'node:net';
import { setTimeout as realDelay } from 'node:timers/promises';
import pg from 'pg';
import { describe, expect, test, vi } from 'vitest';

export interface ListeningFakePostgres {
  /** Where to connect: the loopback address, the user `synthetic`, and the password if one was given. */
  url: string;
  /** Every query any connection sent, in order. */
  queries: readonly FakePostgresQuery[];
  /** Every connection made, in order, with its startup parameters and its own queries. */
  connections: () => readonly FakePostgresConnection[];
  /**
   * Ends this connection as PostgreSQL ends a session it terminates: one
   * FATAL error with this SQLSTATE and message, then the socket is closed.
   */
  end: (connection: FakePostgresConnection, fatal: FakePostgresFatal) => void;
  /**
   * From now on, the first time a query matching `pattern` is answered, its
   * connection is ended right after the answer: between two queries, while
   * the client still holds it.
   */
  endAfter: (pattern: RegExp, fatal: FakePostgresFatal) => void;
  /**
   * From now on, the answer to the first query matching `pattern` is held
   * back (LOST-02, review loop 2): the query is recorded and answered, but
   * the bytes reach the client only once `release()` is called, with
   * everything else its connection was answered meanwhile, in order. So a
   * test can do something while a process waits for that answer.
   */
  holdAnswer: (pattern: RegExp) => { arrived: () => boolean; release: () => void };
  /** The connections whose sockets have closed, in the order they closed. */
  closed: () => readonly FakePostgresConnection[];
  /** Resolves once every socket is closed; rejects if the fake threw. */
  close: () => Promise<void>;
  /** The fake behind it. */
  database: FakePostgres;
}

export async function listeningFakePostgres(
  handler: FakePostgresHandler,
  { password }: { password?: string } = {},
): Promise<ListeningFakePostgres> {
  const database = fakePostgres(handler);
  const sockets = new Map<FakePostgresConnection, Socket>();
  const thrown: unknown[] = [];
  const pending: { pattern: RegExp; fatal: FakePostgresFatal }[] = [];
  const holds: { pattern: RegExp; socket: Socket | undefined }[] = [];
  const heldBack = new Map<Socket, Uint8Array[]>();
  const closed: FakePostgresConnection[] = [];

  const end = (connection: FakePostgresConnection, fatal: FakePostgresFatal) => {
    const socket = sockets.get(connection);
    const bytes = connection.end(fatal);
    if (socket !== undefined && !socket.destroyed) {
      socket.end(bytes);
    }
  };

  const server = createServer((socket) => {
    const connection = database.connect();
    sockets.set(connection, socket);
    socket.on('close', () => {
      sockets.delete(connection);
      closed.push(connection);
    });
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      const before = connection.queries.length;
      let reply: Uint8Array;
      try {
        reply = connection.receive(chunk);
      } catch (error) {
        thrown.push(error);
        socket.destroy();
        return;
      }
      const answered = connection.queries.slice(before);
      const hold = holds.find(
        (each) => each.socket === undefined && answered.some(({ text }) => each.pattern.test(text)),
      );
      if (hold !== undefined) {
        hold.socket = socket;
        heldBack.set(socket, []);
      }
      const waiting = heldBack.get(socket);
      if (waiting !== undefined) {
        waiting.push(reply);
      } else if (reply.length > 0) {
        socket.write(reply);
      }
      const due = pending.findIndex(({ pattern }) =>
        answered.some(({ text }) => pattern.test(text)),
      );
      const [ending] = due === -1 ? [] : pending.splice(due, 1);
      if (ending !== undefined) {
        end(connection, ending.fatal);
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  const credentials = password === undefined ? 'synthetic' : `synthetic:${password}`;
  return {
    url: `postgres://${credentials}@127.0.0.1:${String(port)}/synthetic`,
    queries: database.queries,
    connections: () => database.connections,
    end,
    endAfter: (pattern, fatal) => {
      pending.push({ pattern, fatal });
    },
    holdAnswer: (pattern) => {
      const hold: { pattern: RegExp; socket: Socket | undefined } = { pattern, socket: undefined };
      holds.push(hold);
      return {
        arrived: () => hold.socket !== undefined,
        release: () => {
          const { socket } = hold;
          const waiting = socket === undefined ? undefined : heldBack.get(socket);
          if (socket === undefined || waiting === undefined) {
            return;
          }
          heldBack.delete(socket);
          for (const bytes of waiting) {
            if (bytes.length > 0 && !socket.destroyed) {
              socket.write(bytes);
            }
          }
        },
      };
    },
    closed: () => [...closed],
    database,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets.values()) socket.destroy();
        server.close(() => {
          if (thrown.length === 0) {
            resolve();
            return;
          }
          const said = thrown.map((error) =>
            error instanceof Error ? error.message : String(error),
          );
          reject(
            new Error(
              `The fake PostgreSQL server threw, and closed the connection: ${said.join(' | ')}`,
              { cause: thrown[0] },
            ),
          );
        });
      }),
  };
}

/**
 * The column names a select or a returning clause asks for, in order, as
 * PostgreSQL names its answer's columns: an alias if there is one, else the
 * column. Drizzle reads a select's row by position, so a fake answers by
 * name, in the order asked, whatever order the adapter lists its fields in.
 */
export function askedFor(text: string): string[] {
  const list =
    /^\s*select\s+([\s\S]+?)\s+from\s/i.exec(text)?.[1] ??
    /\sreturning\s+([\s\S]+)$/i.exec(text)?.[1];
  if (list === undefined) {
    return [];
  }
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of list) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      items.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  items.push(current);
  return items.map((item) => {
    const named = /("?)(\w+)\1\s*$/.exec(item.trim());
    return named?.[2] ?? item.trim();
  });
}

/** A setting's value as PostgreSQL reads it, in milliseconds: a bare number is milliseconds. */
function milliseconds(value: string): number {
  const match = /^\s*(\d+)\s*(ms|s|min)?\s*$/i.exec(value);
  if (match === null) {
    return Number.NaN;
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'ms').toLowerCase();
  return unit === 'min' ? amount * 60_000 : unit === 's' ? amount * 1_000 : amount;
}

/**
 * A session setting a pool asked this connection for, in milliseconds, or
 * undefined when it asked for none. The spec leaves the means to the
 * implementer (approach item 7): node-postgres's own connection options,
 * which travel in the startup message, or a SET on connect. So both are read:
 * the startup parameter first, then a `SET name = value`, `SET name TO value`
 * or `set_config('name', 'value', …)` the connection sent.
 */
export function sessionSetting(
  connection: FakePostgresConnection,
  name: string,
): number | undefined {
  const atStartup = connection.parameters[name];
  if (atStartup !== undefined) {
    return milliseconds(atStartup);
  }
  for (const { text, values } of connection.queries) {
    const set = new RegExp(
      `^\\s*set\\s+(?:session\\s+)?${name}\\s*(?:=|to)\\s*'?([^';]+?)'?\\s*;?\\s*$`,
      'i',
    ).exec(text);
    if (set?.[1] !== undefined) {
      return milliseconds(set[1]);
    }
    const configured = new RegExp(`set_config\\(\\s*'${name}'\\s*,\\s*'([^']+)'`, 'i').exec(text);
    if (configured?.[1] !== undefined) {
      return milliseconds(configured[1]);
    }
    if (/set_config\(/i.test(text) && values[0] === name && typeof values[1] === 'string') {
      return milliseconds(values[1]);
    }
  }
  return undefined;
}

/**
 * Answers what a pool may send on connect, a SET or a set_config, and any
 * other query with no rows: a database that is there and holds nothing.
 */
export const quietDatabase: FakePostgresHandler = ({ text }) =>
  /set_config\(/i.test(text)
    ? { columns: ['set_config'], rows: [['']] }
    : { columns: [], rows: [] };

/** Waits, in short timers rather than one long one, until `check` holds or the turns run out. */
export async function eventually(check: () => boolean, turns = 500): Promise<boolean> {
  for (let turn = 0; turn < turns && !check(); turn += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 2);
    });
  }
  return check();
}

/** What settledWithin gives when the promise had not settled in time. */
export const STILL_WAITING = Symbol(
  'still waiting: it had not settled within the real-time ceiling',
);

/**
 * BUG-34: what `promise` settles with, or STILL_WAITING if it has not settled
 * `ms` real milliseconds from now. Real under vi.useFakeTimers too: Vitest
 * fakes the global setTimeout, not node:timers/promises, so a test can move
 * pg's timers by hand and still bound its own wait. A rejection rejects.
 */
export async function settledWithin<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof STILL_WAITING> {
  const ceiling = new AbortController();
  try {
    return await Promise.race([
      promise,
      realDelay(ms, STILL_WAITING, { signal: ceiling.signal, ref: false }),
    ]);
  } finally {
    ceiling.abort();
  }
}

/**
 * BUG-34: the real-time ceiling on a wait that only a hang reaches. Once pg's
 * timer has fired, its query rejected 0.2 ms later here (measured), and the
 * real Graphile Worker's start 7 ms later. Five seconds is thousands of times
 * that, so a slow machine does not fail a correct fix (BUG-21's lesson), and
 * it is well inside the unit run's 60 s test timeout, so a hang fails with
 * the test's own message rather than as a timeout.
 */
export const HANG_CEILING_MS = 5_000;

export interface ListeningSilentPostgres {
  /** Where to connect: the loopback address, the user `synthetic`, and the password if one was given. */
  url: string;
  /** Resolves once a client has connected and sent its first bytes: the startup message it then waits on. */
  heard: () => Promise<void>;
  /** How many bytes the server has written back: always 0, which is the point. */
  written: () => number;
  /** How many connections are open now. */
  open: () => number;
  /** Resolves once a connection was made and every one made has closed: the client gave up on it. */
  allClosed: () => Promise<void>;
  /** Destroys every socket still open, then closes the server. */
  close: () => Promise<void>;
}

/**
 * BUG-34: a database that accepts the connection and never answers. It
 * reads what a client sends and writes nothing back, and never closes a
 * connection on its own, so a client with no connection timeout waits for
 * ever. safety-reviewer's stand-in on BUG-32 was a TCP listener like it.
 */
export async function listeningSilentPostgres({
  password,
}: { password?: string } = {}): Promise<ListeningSilentPostgres> {
  const sockets = new Set<Socket>();
  let made = 0;
  let wasHeard = false;
  const hearing: (() => void)[] = [];
  const closing: (() => void)[] = [];
  const allGone = () => made > 0 && sockets.size === 0;

  const server = createServer((socket) => {
    made += 1;
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('data', () => {
      wasHeard = true;
      for (const resolve of hearing.splice(0)) resolve();
    });
    socket.on('close', () => {
      sockets.delete(socket);
      if (allGone()) {
        for (const resolve of closing.splice(0)) resolve();
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  const credentials = password === undefined ? 'synthetic' : `synthetic:${password}`;
  return {
    url: `postgres://${credentials}@127.0.0.1:${String(port)}/synthetic`,
    heard: () =>
      wasHeard
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            hearing.push(resolve);
          }),
    written: () => [...sockets].reduce((sum, socket) => sum + socket.bytesWritten, 0),
    open: () => sockets.size,
    allClosed: () =>
      allGone()
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            closing.push(resolve);
          }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** What a hung server's handler gives for a query the database never answers. */
export const NEVER_ANSWERED = Symbol(
  'never answered: from this query on, its connection gets nothing back',
);

/**
 * BUG-51: answers a query as a FakePostgresHandler does (an answer, or a
 * throw for an error), or gives NEVER_ANSWERED to leave it unanswered.
 */
export type HungPostgresHandler = (
  query: FakePostgresQuery,
) => FakePostgresAnswer | typeof NEVER_ANSWERED;

export interface ListeningHungPostgres {
  /** Where to connect: the loopback address, the user `synthetic`, and the password if one was given. */
  url: string;
  /** Every connection made, in order: its startup parameters, and every query it sent, answered or not. */
  connections: () => readonly FakePostgresConnection[];
  /**
   * The connections that hang, in the order they began to: one of their
   * queries went unanswered, and nothing has been written to them since.
   */
  hung: () => readonly FakePostgresConnection[];
  /** Resolves once `count` connections hang (1 by default). */
  hanging: (count?: number) => Promise<void>;
  /** The connections whose sockets have closed, in the order they closed. */
  closed: () => readonly FakePostgresConnection[];
  /**
   * How many cancel requests arrived. Each comes on a socket of its own, as
   * PostgreSQL takes them, is closed at once, and is no connection.
   */
  cancelRequests: () => number;
  /** Destroys every socket still open, then closes the server; rejects if the fake threw. */
  close: () => Promise<void>;
}

/** PostgreSQL's code for a cancel request, where a startup message has its protocol. */
const CANCEL_REQUEST_CODE = 80_877_102;

/** The secret every hung connection's key carries: synthetic, and only ever compared by a client. */
const SYNTHETIC_SECRET_KEY = 0x5eed;

/** One message from the server, as PostgreSQL frames it: its type, its length, its body. */
function serverMessage(type: string, body: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(5);
  head.write(type, 0, 'ascii');
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
}

/** Two 32-bit integers, as PostgreSQL writes them. */
function int32s(...values: number[]): Buffer {
  const out = Buffer.alloc(4 * values.length);
  values.forEach((value, at) => out.writeInt32BE(value, 4 * at));
  return out;
}

/**
 * What PostgreSQL answers a startup with: AuthenticationOk, the session's
 * key for a cancel (BackendKeyData), and ReadyForQuery, idle. No
 * ParameterStatus: neither pg nor Drizzle needs one.
 */
function startupAnswer(processId: number): Buffer {
  return Buffer.concat([
    serverMessage('R', int32s(0)),
    serverMessage('K', int32s(processId, SYNTHETIC_SECRET_KEY)),
    serverMessage('Z', Buffer.from('I', 'ascii')),
  ]);
}

/**
 * BUG-51: a database that completes the startup and then never answers a
 * query. Each connection's startup is answered at once, and its startup
 * parameters are kept (so a test can read statement_timeout). Each query is
 * recorded and put to `handler`: one it answers is answered, as the test
 * kit's fake answers it; at the first it gives NEVER_ANSWERED for, the
 * connection hangs, and nothing is written to it again, as a backend stuck
 * for ever, or a peer gone without a reset, writes nothing. The server never
 * closes a connection on its own, so a client with no bound on a query waits
 * for ever. By default every query is never answered.
 *
 * A handler that answers once the test says so is a database that came
 * back: a connection made after that is answered, and one that hangs stays
 * hung, so a pool that hands a hung connection out again is caught.
 *
 * BUG-51, review loop 1 (privacy-security-reviewer): a password given is put
 * in the URL, as the two servers above put it, and is never asked for, so a
 * test can look for it in what a process wrote while the limit cut a query off.
 */
export async function listeningHungPostgres(
  handler: HungPostgresHandler = () => NEVER_ANSWERED,
  { password }: { password?: string } = {},
): Promise<ListeningHungPostgres> {
  const hung: FakePostgresConnection[] = [];
  const waiting: { count: number; resolve: () => void }[] = [];
  let receiving: FakePostgresConnection | undefined;
  const database = fakePostgres((query) => {
    const answer = handler(query);
    if (answer !== NEVER_ANSWERED) {
      return answer;
    }
    if (receiving !== undefined && !hung.includes(receiving)) {
      hung.push(receiving);
      for (const waiter of waiting.filter(({ count }) => hung.length >= count)) {
        waiting.splice(waiting.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
    // Encoded by the fake, and never sent.
    return { columns: [], rows: [] };
  });
  const sockets = new Set<Socket>();
  const closed: FakePostgresConnection[] = [];
  const thrown: unknown[] = [];
  let cancels = 0;
  let processIds = 0;

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => {
      sockets.delete(socket);
    });
    let first = Buffer.alloc(0);
    let connection: FakePostgresConnection | undefined;
    socket.on('data', (chunk: Buffer) => {
      let bytes = chunk;
      if (connection === undefined) {
        // A startup and a cancel request both start with a length and a
        // code: read both before deciding which this socket is.
        first = Buffer.concat([first, chunk]);
        if (first.length < 8) {
          return;
        }
        if (first.readInt32BE(4) === CANCEL_REQUEST_CODE) {
          cancels += 1;
          socket.destroy();
          return;
        }
        const made = database.connect();
        connection = made;
        socket.on('close', () => {
          closed.push(made);
        });
        bytes = first;
      }
      const starting = Object.keys(connection.parameters).length === 0;
      let reply: Uint8Array;
      receiving = connection;
      try {
        reply = connection.receive(bytes);
      } catch (error) {
        thrown.push(error);
        socket.destroy();
        return;
      } finally {
        receiving = undefined;
      }
      if (hung.includes(connection)) {
        return;
      }
      if (starting && Object.keys(connection.parameters).length > 0) {
        processIds += 1;
        socket.write(startupAnswer(processIds));
        return;
      }
      if (reply.length > 0) {
        socket.write(reply);
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  const credentials = password === undefined ? 'synthetic' : `synthetic:${password}`;
  return {
    url: `postgres://${credentials}@127.0.0.1:${String(port)}/synthetic`,
    connections: () => [...database.connections],
    hung: () => [...hung],
    hanging: (count = 1) =>
      hung.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiting.push({ count, resolve });
          }),
    closed: () => [...closed],
    cancelRequests: () => cancels,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          if (thrown.length === 0) {
            resolve();
            return;
          }
          const said = thrown.map((error) =>
            error instanceof Error ? error.message : String(error),
          );
          reject(
            new Error(
              `The hung PostgreSQL server threw, and closed the connection: ${said.join(' | ')}`,
              { cause: thrown[0] },
            ),
          );
        });
      }),
  };
}

export interface WatchingKeepAlive {
  /**
   * How many sockets connected to the server at `url`, and open now, had TCP
   * keepalive turned on. Read before the pool ends: a closed socket no longer
   * says where it was connected.
   */
  socketsTo: (url: string) => number;
  /**
   * The delay before the first probe, in ms, that each of those sockets was
   * last given with keepalive turned on, in the order they were first given
   * one: the second argument to setKeepAlive.
   */
  delaysTo: (url: string) => unknown[];
  /** Stops watching. */
  restore: () => void;
}

/**
 * BUG-51: watches every socket TCP keepalive is turned on for, through
 * Socket's own setKeepAlive, which is how pg turns it on once its socket
 * connects (pg/lib/connection.js). The method still runs: this only counts.
 */
export function watchingKeepAlive(): WatchingKeepAlive {
  const spy = vi.spyOn(Socket.prototype, 'setKeepAlive');
  /** Each socket to `url` with keepalive turned on, and the delay it was last given. */
  const turnedOn = (url: string): Map<Socket, unknown> => {
    const port = Number(new URL(url).port);
    const delays = new Map<Socket, unknown>();
    spy.mock.calls.forEach(([enable, initialDelay], at) => {
      const socket = spy.mock.contexts[at] as Socket | undefined;
      if (enable === true && socket?.remotePort === port) {
        delays.set(socket, initialDelay);
      }
    });
    return delays;
  };
  return {
    socketsTo: (url) => turnedOn(url).size,
    delaysTo: (url) => [...turnedOn(url).values()],
    restore: () => {
      spy.mockRestore();
    },
  };
}

// ---------------------------------------------------------------------------
// The controls: without them, a process test that found nothing could mean
// only that the helper was blind.
// ---------------------------------------------------------------------------

describe('the fake PostgreSQL server on a port', () => {
  test('a real pg client connects through it: its query is answered and recorded, and its startup parameters are kept', async () => {
    const server = await listeningFakePostgres(() => ({ columns: ['answer'], rows: [['42']] }));
    const client = new pg.Client({ connectionString: server.url, application_name: 'control' });
    try {
      await client.connect();
      const result = await client.query<{ answer: string }>('select 42 as answer');

      expect(result.rows).toEqual([{ answer: '42' }]);
      expect(server.queries.map(({ text }) => text)).toEqual(['select 42 as answer']);
      expect(server.connections()[0]?.parameters).toMatchObject({
        user: 'synthetic',
        database: 'synthetic',
        application_name: 'control',
      });
    } finally {
      await client.end();
      await server.close();
    }
  });

  test('end() ends a connection with a FATAL error the client hears, with its SQLSTATE, and its next query rejects', async () => {
    const server = await listeningFakePostgres(() => ({ columns: [], rows: [] }));
    const client = new pg.Client({ connectionString: server.url });
    const heard: unknown[] = [];
    client.on('error', (error) => heard.push(error));
    try {
      await client.connect();
      await client.query('select 1');
      const [connection] = server.connections();
      if (connection === undefined) {
        throw new Error('no connection was made');
      }

      server.end(connection, { code: '57P01', message: 'terminating connection' });

      expect(await eventually(() => heard.length > 0)).toBe(true);
      expect(heard[0]).toMatchObject({ code: '57P01', severity: 'FATAL' });
      await expect(client.query('select 1')).rejects.toThrow();
    } finally {
      await client.end().catch(() => undefined);
      await server.close();
    }
  });

  test('endAfter() ends the connection right after the matching query is answered, while the client holds it', async () => {
    const server = await listeningFakePostgres(() => ({ columns: [], rows: [] }));
    server.endAfter(/for update/, { code: '25P03', message: 'idle in transaction' });
    const client = new pg.Client({ connectionString: server.url });
    const heard: unknown[] = [];
    client.on('error', (error) => heard.push(error));
    try {
      await client.connect();
      await client.query('begin');
      await client.query('select 1 for update');

      expect(await eventually(() => heard.length > 0)).toBe(true);
      expect(heard[0]).toMatchObject({ code: '25P03' });
      await expect(client.query('commit')).rejects.toThrow();
    } finally {
      await client.end().catch(() => undefined);
      await server.close();
    }
  });

  test('holdAnswer() keeps the matching query’s answer from the client until release(), records the query meanwhile, and closed() lists a connection once its socket closes', async () => {
    const server = await listeningFakePostgres(() => ({ columns: ['answer'], rows: [['42']] }));
    const held = server.holdAnswer(/pg_settings/);
    const client = new pg.Client({ connectionString: server.url });
    try {
      await client.connect();
      let answered = false;
      const asking = client
        .query<{ answer: string }>('select 42 as answer from pg_settings')
        .then((result) => {
          answered = true;
          return result.rows;
        });

      expect(await eventually(() => held.arrived())).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(answered).toBe(false);
      expect(server.queries.map(({ text }) => text)).toEqual([
        'select 42 as answer from pg_settings',
      ]);

      held.release();
      expect(await asking).toEqual([{ answer: '42' }]);
      expect(await client.query('select 1')).toMatchObject({ rows: [{ answer: '42' }] });
      expect(server.closed()).toEqual([]);
    } finally {
      await client.end();
    }
    expect(await eventually(() => server.closed().length === 1)).toBe(true);
    await server.close();
  });

  test('a password given is in the URL and nowhere on the wire: the fake never asks for one', async () => {
    const marker = syntheticCredential();
    const server = await listeningFakePostgres(() => ({ columns: [], rows: [] }), {
      password: marker,
    });
    const client = new pg.Client({ connectionString: server.url });
    try {
      await client.connect();
      await client.query('select 1');

      expect(server.url).toContain(`:${marker}@`);
      expect(
        JSON.stringify(server.connections().map(({ parameters }) => parameters)),
      ).not.toContain(marker);
    } finally {
      await client.end();
      await server.close();
    }
  });

  test('a throw in the fake closes the connection, and close() rejects with what the fake said', async () => {
    const server = await listeningFakePostgres(() => ({ columns: ['bad'], rows: [['ø']] }));
    const client = new pg.Client({ connectionString: server.url });
    client.on('error', () => undefined);
    await client.connect();

    await expect(client.query('select 1')).rejects.toThrow();
    await client.end().catch(() => undefined);
    await expect(server.close()).rejects.toThrow(/ASCII/);
  });

  // BUG-34: the silent server's control. Were it to answer, or to close a
  // connection on its own, a pool with no connection timeout would fail
  // rather than wait, and the BUG-34 tests would pass on the bug.
  test('the silent server accepts a connection, hears its first bytes, writes nothing back and closes nothing, and allClosed() resolves once the client lets go', async () => {
    const server = await listeningSilentPostgres();
    const { port } = new URL(server.url);
    const client = connect(Number(port), '127.0.0.1');
    client.on('error', () => undefined);
    let answered = 0;
    let ended = false;
    client.on('data', (chunk: Buffer) => {
      answered += chunk.length;
    });
    client.on('close', () => {
      ended = true;
    });
    try {
      await new Promise<void>((resolve) => client.once('connect', resolve));
      client.write('a startup message');

      expect(await settledWithin(server.heard(), HANG_CEILING_MS)).toBeUndefined();
      // A database answers a startup message in milliseconds: this one waits.
      expect(await settledWithin(server.allClosed(), 100)).toBe(STILL_WAITING);
      expect({ answered, ended, written: server.written(), open: server.open() }).toEqual({
        answered: 0,
        ended: false,
        written: 0,
        open: 1,
      });

      client.destroy();
      expect(await settledWithin(server.allClosed(), HANG_CEILING_MS)).toBeUndefined();
      expect(server.open()).toBe(0);
    } finally {
      client.destroy();
      await server.close();
    }
  });

  test('settledWithin gives what the promise settled with, or STILL_WAITING once the real-time ceiling passed', async () => {
    expect(await settledWithin(Promise.resolve('answered'), HANG_CEILING_MS)).toBe('answered');
    expect(await settledWithin(new Promise(() => undefined), 10)).toBe(STILL_WAITING);
    await expect(settledWithin(Promise.reject(new Error('refused')), 10)).rejects.toThrow(
      'refused',
    );
  });

  // BUG-51: the hung server's controls. Were it to answer a query it should
  // not, or to close a connection on its own, a pool with no bound on a
  // query would fail rather than wait, and the BUG-51 tests would pass on the
  // bug. Were it to fail the startup, they would be BUG-34's tests again.
  test('the hung server completes a real pg client’s startup, with the key a cancel needs, keeps its startup parameters, records a query and never answers it, and closes nothing; closed() lists the connection once the client lets go', async () => {
    const server = await listeningHungPostgres();
    const client = new pg.Client({
      connectionString: server.url,
      application_name: 'control',
      statement_timeout: 1_234,
    });
    client.on('error', () => undefined);
    try {
      const connected = client.connect().then(() => 'connected');
      expect(await settledWithin(connected, HANG_CEILING_MS)).toBe('connected');
      const query = client.query('select 42 as answer').then(
        () => 'answered',
        (error: unknown) => error,
      );

      expect(await settledWithin(server.hanging(), HANG_CEILING_MS)).toBeUndefined();
      // A database answers a query in milliseconds: this one waits.
      expect(await settledWithin(query, 100)).toBe(STILL_WAITING);
      const [connection] = server.connections();
      expect(server.connections()).toHaveLength(1);
      expect(connection?.queries.map(({ text }) => text)).toEqual(['select 42 as answer']);
      expect(connection?.parameters).toMatchObject({
        user: 'synthetic',
        database: 'synthetic',
        application_name: 'control',
        statement_timeout: '1234',
      });
      expect(server.hung()).toEqual(server.connections());
      expect(server.closed()).toEqual([]);

      await client.end();
      expect(await eventually(() => server.closed().length === 1)).toBe(true);
      expect(server.closed()).toEqual(server.connections());
    } finally {
      await client.end().catch(() => undefined);
      await server.close();
    }
  });

  test('the hung server’s handler decides each query: one it answers is answered, at one it gives NEVER_ANSWERED for its connection hangs, and a connection made later is answered', async () => {
    const server = await listeningHungPostgres((query) =>
      /\bnever\b/.test(query.text) ? NEVER_ANSWERED : { columns: ['answer'], rows: [['42']] },
    );
    const first = new pg.Client({ connectionString: server.url });
    const second = new pg.Client({ connectionString: server.url });
    first.on('error', () => undefined);
    second.on('error', () => undefined);
    try {
      await first.connect();
      expect((await first.query<{ answer: string }>('select 42 as answer')).rows).toEqual([
        { answer: '42' },
      ]);
      const never = first.query("select 'never' as answer").then(
        () => 'answered',
        (error: unknown) => error,
      );
      expect(await settledWithin(server.hanging(), HANG_CEILING_MS)).toBeUndefined();
      expect(await settledWithin(never, 100)).toBe(STILL_WAITING);

      await second.connect();
      expect((await second.query<{ answer: string }>('select 42 as answer')).rows).toEqual([
        { answer: '42' },
      ]);
      expect(server.hung()).toEqual([server.connections()[0]]);
      expect(server.connections()).toHaveLength(2);
    } finally {
      await first.end().catch(() => undefined);
      await second.end().catch(() => undefined);
      await server.close();
    }
  });

  test('the hung server answers a startup with AuthenticationOk, BackendKeyData and ReadyForQuery, in that order; it takes a cancel request on a socket of its own, counts it, closes that socket, and counts no connection for it', async () => {
    const server = await listeningHungPostgres();
    const { port } = new URL(server.url);
    const session = connect(Number(port), '127.0.0.1');
    const sessionUp = new Promise<void>((resolve) => session.once('connect', resolve));
    session.on('error', () => undefined);
    let answer = Buffer.alloc(0);
    session.on('data', (chunk: Buffer) => {
      answer = Buffer.concat([answer, chunk]);
    });
    let cancel: Socket | undefined;
    try {
      await sessionUp;
      // A startup message: its length, protocol 3.0, then the user and the
      // database as pairs ended by a zero byte, and one more zero.
      const pairs = Buffer.from('user\0synthetic\0database\0synthetic\0\0', 'ascii');
      session.write(Buffer.concat([int32s(8 + pairs.length, 196_608), pairs]));
      expect(await eventually(() => answer.length >= 9 + 13 + 6)).toBe(true);
      const types: string[] = [];
      for (let at = 0; at < answer.length; at += 1 + answer.readInt32BE(at + 1)) {
        types.push(String.fromCharCode(answer[at] ?? 0));
      }
      expect(types).toEqual(['R', 'K', 'Z']);

      const canceller = connect(Number(port), '127.0.0.1');
      cancel = canceller;
      canceller.on('error', () => undefined);
      const cancelClosed = new Promise<void>((resolve) => {
        canceller.once('close', () => {
          resolve();
        });
      });
      await new Promise<void>((resolve) => canceller.once('connect', resolve));
      // Length 16, the cancel request code, a process ID and its secret.
      canceller.write(int32s(16, CANCEL_REQUEST_CODE, 1, SYNTHETIC_SECRET_KEY));

      expect(await settledWithin(cancelClosed, HANG_CEILING_MS)).toBeUndefined();
      expect(server.cancelRequests()).toBe(1);
      expect(server.connections()).toHaveLength(1);
      expect(server.closed()).toEqual([]);
    } finally {
      session.destroy();
      cancel?.destroy();
      await server.close();
    }
  });

  // BUG-51, review loop 1 (privacy-security-reviewer): the hung server's
  // password, as the first server's above. Were it to need the password, or to
  // drop it from the URL, a test that found no marker in what was written
  // would prove nothing.
  test('a password given to the hung server is in its URL and nowhere on the wire: it never asks for one, and a real pg client connects and is answered', async () => {
    const marker = syntheticCredential();
    const server = await listeningHungPostgres(() => ({ columns: ['answer'], rows: [['42']] }), {
      password: marker,
    });
    const client = new pg.Client({ connectionString: server.url });
    client.on('error', () => undefined);
    try {
      await client.connect();
      expect((await client.query<{ answer: string }>('select 42 as answer')).rows).toEqual([
        { answer: '42' },
      ]);

      expect(server.url).toContain(`:${marker}@`);
      expect(
        JSON.stringify(server.connections().map(({ parameters }) => parameters)),
      ).not.toContain(marker);
    } finally {
      await client.end().catch(() => undefined);
      await server.close();
    }
  });

  // BUG-51: the keepalive watcher's control. Were it blind, a pool with no
  // keepalive and one with it would both read 0, and a test that wanted 0
  // would pass either way.
  test('watchingKeepAlive counts a pg client made with keepAlive, and not one made without it, nor a socket to another server', async () => {
    const server = await listeningFakePostgres(() => ({ columns: [], rows: [] }));
    const other = await listeningFakePostgres(() => ({ columns: [], rows: [] }));
    const keepAlive = watchingKeepAlive();
    const plain = new pg.Client({ connectionString: server.url });
    const kept = new pg.Client({
      connectionString: server.url,
      keepAlive: true,
      keepAliveInitialDelayMillis: 1_234,
    });
    const elsewhere = new pg.Client({ connectionString: other.url, keepAlive: true });
    try {
      await plain.connect();
      expect(keepAlive.socketsTo(server.url)).toBe(0);
      await kept.connect();
      await elsewhere.connect();

      expect(keepAlive.socketsTo(server.url)).toBe(1);
      expect(keepAlive.socketsTo(other.url)).toBe(1);
      // BUG-51 (D-132, amended): the delay before the first probe is read too.
      expect(keepAlive.delaysTo(server.url)).toEqual([1_234]);
    } finally {
      keepAlive.restore();
      await plain.end();
      await kept.end();
      await elsewhere.end();
      await server.close();
      await other.close();
    }
  });

  test('askedFor names the columns a select or a returning clause asks for, aliases first', () => {
    expect(askedFor('select "id", "state" from "journeys" where "id" = $1')).toEqual([
      'id',
      'state',
    ]);
    expect(askedFor('select now() as now')).toEqual([]);
    expect(askedFor('insert into "outbox" ("id") values ($1) returning "id", "kind"')).toEqual([
      'id',
      'kind',
    ]);
  });
});
