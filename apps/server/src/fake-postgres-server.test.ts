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
import {
  fakePostgres,
  syntheticCredential,
  type FakePostgres,
  type FakePostgresConnection,
  type FakePostgresFatal,
  type FakePostgresHandler,
  type FakePostgresQuery,
} from '@trygghverdag/test-kit';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import pg from 'pg';
import { describe, expect, test } from 'vitest';

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
