/**
 * The PostgreSQL connection, and Drizzle on top of it.
 *
 * One pool per process, capped low: the staging database is Clever Cloud's free
 * DEV plan, which allows very few connections, and a pool that quietly exhausts
 * it would take the watchdog down with it (Section 8).
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../db/schema.ts';
import { sqlstateOf } from '../domain/sqlstate.ts';
import type { Log } from '../ports.ts';

export type Database = ReturnType<typeof createDatabase>;

/**
 * How many connections each process may hold, and what is left over.
 *
 * Two each leaves one spare on the DEV plan — for a migration, or for a person
 * with `psql` working out why the worker stopped. That spare is why the numbers
 * do not add up to five.
 */
export const POOL_SIZE = { api: 2, worker: 2, spare: 1 } as const;

/** What the DEV plan allows in total (Section 8). The budget above must fit inside it. */
export const DEV_PLAN_CONNECTION_LIMIT = 5;

/** What a process pool is told about itself, and the session limits it asks for. */
export interface PoolOptions {
  /** Which process's pool this is: the name its `database_error` lines carry. */
  name?: 'api' | 'worker';
  /** Where a connection's error is written. With `name`, the pool gets its listeners. */
  log?: Log;
  /** PostgreSQL's idle_in_transaction_session_timeout for every connection, in ms. */
  idleInTransactionMs?: number;
  /** PostgreSQL's lock_timeout for every connection, in ms. */
  lockTimeoutMs?: number;
}

/**
 * The connection pool. Close it with `pool.end()` when a process shuts down.
 *
 * Every pool in production code is made here (D-108: an import rule keeps
 * `pg` and Drizzle's node-postgres driver to this file), so the budget above,
 * the session limits and the listeners hold for all of them.
 *
 * The session limits (D-108) bound how long a journey's row can be held. Both
 * process pools take that row: the API for every heartbeat, the worker for
 * every alert it opens. A frozen holder would hide the journey from every
 * sweep's `skip locked`. So `idleInTransactionMs` has PostgreSQL end a
 * session left idle inside a transaction, and `lockTimeoutMs` refuses a wait
 * for a row that lasts longer, with SQLSTATE 55P03. They travel as startup
 * parameters, so every connection has them before its first statement. A
 * limit not given is not sent, and the server's own setting stands.
 *
 * The listeners (D-068), given a `name` and a `log`, both attached before
 * the pool is returned, so nothing that is handed the pool, Graphile Worker
 * included, ever sees it without them:
 *   - an `error` listener, for a connection that fails while idle in the pool;
 *   - a `connect` listener that gives each new connection an `error`
 *     listener of its own, which stays for its life, so one that fails while
 *     checked out is heard too. pg-pool takes its own listener off a
 *     connection it hands out, and an `error` with nobody listening would end
 *     the process.
 * Each lost connection is one `database_error` line, with the pool's name and
 * the SQLSTATE, or null: never the message, the error or the connection
 * string, which holds the password. A connection reports once, however many
 * errors it raises as it goes (the FATAL, then the closed socket). Then the
 * process carries on: pg drops the dead connection, and a query on one that
 * was checked out rejects, so its caller fails loudly, as a 500 or a failed
 * sweep. A crash would restart the worker, and a worker that restarts stops
 * sweeping.
 *
 * The migrations' pool is made with neither, so a connection lost during a
 * deploy fails that deploy, loudly.
 */
export function createPool(
  connectionString: string,
  max: number,
  { name, log, idleInTransactionMs, lockTimeoutMs }: PoolOptions = {},
): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    ...(idleInTransactionMs === undefined
      ? {}
      : { idle_in_transaction_session_timeout: idleInTransactionMs }),
    ...(lockTimeoutMs === undefined ? {} : { lock_timeout: lockTimeoutMs }),
  });
  if (name !== undefined && log !== undefined) {
    const reported = new WeakSet<object>();
    const report = (error: unknown, client: object): void => {
      if (reported.has(client)) {
        return;
      }
      reported.add(client);
      log.write({ event: 'database_error', pool: name, code: sqlstateOf(error) });
    };
    pool.on('error', (error, client) => {
      report(error, client);
    });
    pool.on('connect', (client) => {
      client.on('error', (error) => {
        report(error, client);
      });
    });
  }
  return pool;
}

export function createDatabase(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

/**
 * Each session limit a process pool can ask for: PostgreSQL's name for it,
 * the option that asks, and what goes wrong while it is not in force.
 */
const SESSION_LIMITS = [
  {
    setting: 'idle_in_transaction_session_timeout',
    option: 'idleInTransactionMs',
    without: 'a stalled transaction will not be ended',
  },
  {
    setting: 'lock_timeout',
    option: 'lockTimeoutMs',
    without: 'a heartbeat may wait for a lock without end',
  },
] as const;

/** How many milliseconds one of pg_settings' units holds: the units a time limit is reported in. */
const MS_PER_UNIT: Readonly<Record<string, number>> = { ms: 1, s: 1_000, min: 60_000 };

/**
 * A setting's value as pg_settings reported it, in its text and in
 * milliseconds, or null when it is not digits with one of those units: it is
 * then written as `unreadable`, never echoed.
 */
function durationOf(setting: unknown, unit: unknown): { text: string; ms: number } | null {
  const perUnit = typeof unit === 'string' ? MS_PER_UNIT[unit] : undefined;
  if (typeof setting !== 'string' || !/^\d+$/.test(setting) || perUnit === undefined) {
    return null;
  }
  return { text: `${setting}${String(unit)}`, ms: Number(setting) * perUnit };
}

/**
 * Asking is not getting (D-109). Reads back once, on one of the pool's
 * connections, the session limits the pool asked for, and says on one line
 * which are in force, or, one line each, which are not. A connection pooler
 * that silently dropped the startup parameters would otherwise leave the
 * limits absent with every check green. The read-back line, not the absence
 * of an error, is what shows they are in force.
 *
 * Never rejects: the process starts whatever it reads (D-109). A worker that
 * refused would watch nobody, and the watchdog's stuck check pages for the
 * harm a missing limit can cause. A read that fails is said with its
 * SQLSTATE, or `none`. No line holds the connection string, a host, a user,
 * a password or an error's message: only the process's name, the settings'
 * names, digits with a unit, and a SQLSTATE.
 */
export async function sessionLimitsLines(
  pool: pg.Pool,
  {
    name,
    ...asked
  }: {
    /** The process whose pool it is: the word each line starts with. */
    name: 'api' | 'worker';
    /** What the pool asked for, as it was given to createPool. */
    idleInTransactionMs?: number;
    lockTimeoutMs?: number;
  },
): Promise<string[]> {
  const limits = SESSION_LIMITS.flatMap((limit) => {
    const ms = asked[limit.option];
    return ms === undefined ? [] : [{ ...limit, ms }];
  });
  if (limits.length === 0) {
    return [];
  }
  let rows: { name: unknown; setting: unknown; unit: unknown }[];
  try {
    ({ rows } = await pool.query<{ name: unknown; setting: unknown; unit: unknown }>(
      'select name, setting, unit from pg_settings where name = any($1)',
      [limits.map(({ setting }) => setting)],
    ));
  } catch (error) {
    return [`${name}: session limits could not be read (${sqlstateOf(error) ?? 'none'}).`];
  }
  const read = limits.map((limit) => {
    const row = rows.find((candidate) => candidate.name === limit.setting);
    return { ...limit, value: row === undefined ? null : durationOf(row.setting, row.unit) };
  });
  const inForce = read.flatMap(({ setting, ms, value }) =>
    value?.ms === ms ? [`${setting}=${value.text}`] : [],
  );
  if (inForce.length === read.length) {
    return [
      `${name}: session ${read.length === 1 ? 'limit' : 'limits'} in force: ${inForce.join(' ')}`,
    ];
  }
  // One line for each limit not in force, and none for those that are.
  return read.flatMap(({ setting, ms, value, without }) =>
    value?.ms === ms
      ? []
      : [
          `${name}: session limit ${setting} is ${value?.text ?? 'unreadable'}, not ${String(ms)}ms: ${without}.`,
        ],
  );
}
