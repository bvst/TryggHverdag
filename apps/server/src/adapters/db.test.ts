// The connection budget, which is shared and small enough to run out.
//
// Clever Cloud's free DEV plan allows five connections in total (Section 8) and
// the API and the worker are two processes spending from that one budget. The
// first version of createPool defaulted to `max: 5`, which is the entire budget
// each and twice the budget between them — while the plan had already written
// down "API 2, worker 2". Nothing compared the two, so nothing noticed.
//
// A pool that exhausts the ceiling takes the watchdog with it, and the watchdog
// is what turns a silent phone into an alert. So the arithmetic is a test.
import { WORKER_STALE_AFTER_MS } from '@trygghverdag/contracts';
import { fakeLog, syntheticCredential, syntheticUuid } from '@trygghverdag/test-kit';
import { sql } from 'drizzle-orm';
import { setTimeout as realDelay } from 'node:timers/promises';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { describe, expect, test, vi } from 'vitest';
import { sqlstateOf } from '../domain/sqlstate.ts';
import {
  IDLE_IN_TRANSACTION_LIMIT_MS,
  LOCK_WAIT_LIMIT_MS,
  WATCHDOG_INTERVAL_MS,
} from '../domain/watchdog.ts';
import {
  HANG_CEILING_MS,
  NEVER_ANSWERED,
  STILL_WAITING,
  eventually,
  listeningFakePostgres,
  listeningHungPostgres,
  listeningSilentPostgres,
  sessionSetting,
  settledWithin,
  watchingKeepAlive,
} from '../fake-postgres-server.test.ts';
import {
  CONNECT_TIMEOUT_MS,
  DEV_PLAN_CONNECTION_LIMIT,
  POOL_SIZE,
  QUERY_TIMEOUT_MS,
  STATEMENT_TIMEOUT_MS,
  createDatabase,
  createPool,
  type PoolOptions,
} from './db.ts';

describe('the connection budget', () => {
  test('the two processes and the spare fit inside what the plan allows', () => {
    const claimed = POOL_SIZE.api + POOL_SIZE.worker + POOL_SIZE.spare;

    expect(claimed).toBeLessThanOrEqual(DEV_PLAN_CONNECTION_LIMIT);
  });

  test('something is left over, so a migration or a person is not locked out', () => {
    // Filling the ceiling exactly would mean the next `psql` — run by whoever
    // is working out why the worker stopped — cannot connect at all.
    expect(POOL_SIZE.spare).toBeGreaterThan(0);
  });

  test('each process gets more than one, so one slow query does not block it', () => {
    expect(POOL_SIZE.api).toBeGreaterThan(1);
    expect(POOL_SIZE.worker).toBeGreaterThan(1);
  });

  test('the ceiling is the number the plan documents', () => {
    // If Clever Cloud's limit changes, this is the line to change, and the
    // first test above then re-checks the budget against it.
    expect(DEV_PLAN_CONNECTION_LIMIT).toBe(5);
  });
});

// LOST-02 (approach item 8, D-068): each process pool gets an `error`
// listener and a `connect` listener when it is made, before anything else
// sees it; the migrations' pool gets none, so a connection lost during a
// deploy still fails that deploy loudly. Nothing here connects: listeners are
// counted, which is all createPool can have done by the time it returns.
describe('the pool listeners, where each pool is made', () => {
  test.each(['api', 'worker'] as const)(
    'LOST-02-AC18: a pool made for the %s process, with its name and a log, has an error listener and a connect listener when createPool returns',
    async (name) => {
      const pool = createPool('postgres://synthetic@127.0.0.1:1/synthetic', 1, {
        name,
        log: fakeLog(),
      });

      try {
        expect(pool.listenerCount('error')).toBeGreaterThan(0);
        expect(pool.listenerCount('connect')).toBeGreaterThan(0);
      } finally {
        await pool.end();
      }
    },
  );

  test('LOST-02-AC18: the migrations’ pool, made with neither a name nor a log, gets no listener', async () => {
    const pool = createPool('postgres://synthetic@127.0.0.1:1/synthetic', 1);

    try {
      expect(pool.listenerCount('error')).toBe(0);
      expect(pool.listenerCount('connect')).toBe(0);
    } finally {
      await pool.end();
    }
  });
});

// LOST-02, after the pull request opened (spec item 17a; safety-reviewer):
// PostgreSQL reads an idle_in_transaction_session_timeout or a lock_timeout
// of 0 as no limit at all, so a pool asked for 0 would hold rows with no
// bound while its read-back called the limit in force. createPool takes each
// limit only as lock_timeout does: a whole number of milliseconds from 1 to
// 2147483647. A refusal throws as the pool is made, which stops a process at
// start: loud. Nothing here connects.
describe('the session limits a pool is made with', () => {
  const SYNTHETIC_URL = 'postgres://synthetic@127.0.0.1:1/synthetic';

  // RG-03 (BUG-51, review loop 1, test-auditor's F18): D-132 adds a third
  // session limit, statementTimeoutMs, which createPool checks as it checks
  // the two before it, and nothing tested that check: removing it passed
  // every test. So the loop now runs over all three options, and the name
  // says so. Every value and assertion it held for the two is held as before.
  test('LOST-02-AC17: createPool refuses an idleInTransactionMs, lockTimeoutMs or statementTimeoutMs (BUG-51) that is not a whole number from 1 to 2147483647 (0, -1, 0.5, 1.5, NaN, 2147483648), naming the option, and takes 1 and 2147483647', async () => {
    const made: ReturnType<typeof createPool>[] = [];
    const limit = (
      option: 'idleInTransactionMs' | 'lockTimeoutMs' | 'statementTimeoutMs',
      value: number,
    ): PoolOptions =>
      option === 'idleInTransactionMs'
        ? { idleInTransactionMs: value }
        : option === 'lockTimeoutMs'
          ? { lockTimeoutMs: value }
          : { statementTimeoutMs: value };
    try {
      for (const option of [
        'idleInTransactionMs',
        'lockTimeoutMs',
        'statementTimeoutMs',
      ] as const) {
        // 1.5 is there for the whole-number rule alone: it is inside the range.
        for (const value of [0, -1, 0.5, 1.5, Number.NaN, 2_147_483_648]) {
          expect(
            () => {
              made.push(createPool(SYNTHETIC_URL, 1, limit(option, value)));
            },
            `${option}: ${String(value)}`,
          ).toThrow(new RegExp(`\\b${option}\\b`));
        }
        // The bounds themselves are taken.
        for (const value of [1, 2_147_483_647]) {
          expect(
            () => {
              made.push(createPool(SYNTHETIC_URL, 1, limit(option, value)));
            },
            `${option}: ${String(value)}`,
          ).not.toThrow();
        }
      }
    } finally {
      await Promise.all(made.map((pool) => pool.end()));
    }
  });
});

// BUG-34 (safety-reviewer, on BUG-32): createPool set no connection timeout,
// so a database that accepts the connection and never answers held a pool's
// first connection for ever. The worker's start waited on it with nothing
// written, and a worker stuck there watches nobody: no sweep, no beat. The
// API's pool and the migrations' are made here too, so each of the three
// pools is shown: a first query rejects once CONNECT_TIMEOUT_MS have passed,
// and not before, and the connection it opened is closed, not left half open.
//
// pg's timer is the global setTimeout, so Vitest's fake one drives it: the
// bound is exact, whatever the machine's load. The tests' own waits are real
// and generous (settledWithin, HANG_CEILING_MS), so only a hang reaches them.
// The rejection is the loud part: a connection that never connected raises no
// `error` event, so no `database_error` line is expected. Its caller says it:
// the worker as "worker failed: …" (worker.test.ts), the API as a 500, a
// migration as a failed deploy.
describe('BUG-34: a pool against a database that accepts the connection and never answers', () => {
  /** How long a check that something has not happened yet waits, in real ms. */
  const NOT_YET_MS = 100;

  const pools: [string, PoolOptions][] = [
    [
      'the API’s',
      {
        name: 'api',
        log: fakeLog(),
        idleInTransactionMs: IDLE_IN_TRANSACTION_LIMIT_MS,
        lockTimeoutMs: LOCK_WAIT_LIMIT_MS,
      },
    ],
    [
      'the worker’s',
      { name: 'worker', log: fakeLog(), idleInTransactionMs: IDLE_IN_TRANSACTION_LIMIT_MS },
    ],
    ['the migrations’', {}],
  ];

  test.each(pools)(
    'BUG-34: %s pool rejects its first query once CONNECT_TIMEOUT_MS have passed, not before and not never, and closes the connection it opened',
    async (_which, options) => {
      const database = await listeningSilentPostgres();
      // RG-03 (BUG-34, review loop 1, code-reviewer): the fake timers and the
      // pool are now made inside the try, so a throw cannot leave fake timers
      // or the silent server behind. No assertion changed.
      let pool: ReturnType<typeof createPool> | undefined;
      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pool = createPool(database.url, 1, options);
        const query = pool.query('select 1').then(
          () => 'answered',
          (error: unknown) => error,
        );
        expect(await settledWithin(database.heard(), HANG_CEILING_MS)).toBeUndefined();

        await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS - 1);
        expect(await settledWithin(query, NOT_YET_MS)).toBe(STILL_WAITING);

        await vi.advanceTimersByTimeAsync(1);
        vi.useRealTimers();
        expect(await settledWithin(query, HANG_CEILING_MS)).toBeInstanceOf(Error);
        expect(await settledWithin(database.allClosed(), HANG_CEILING_MS)).toBeUndefined();
      } finally {
        vi.useRealTimers();
        // The server first: a connection still waiting would hold pool.end().
        await database.close();
        await pool?.end();
      }
    },
  );

  test('BUG-34: guard: with the timeout in force, a pool against a database that answers connects and answers, and a query answered later than CONNECT_TIMEOUT_MS is not cut short', async () => {
    // Passes today and after: the timeout bounds the connection's start, not
    // a query. A client-side query_timeout in its place would fail the held
    // query below. (A statement_timeout would not: it travels as a startup
    // parameter, and this fake database ignores those.)
    //
    // RG-03 (BUG-34, review loop 1): that sentence said "a query_timeout or
    // statement-wide limit"; test-auditor planted statement_timeout and this
    // test passed, so the comment now says only what the test catches. And
    // (code-reviewer) the fake timers and the pool are made inside the try.
    // No assertion changed.
    const database = await listeningFakePostgres(() => ({ columns: ['answer'], rows: [['42']] }));
    let pool: ReturnType<typeof createPool> | undefined;
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      pool = createPool(database.url, 1, {
        name: 'worker',
        log: fakeLog(),
        idleInTransactionMs: IDLE_IN_TRANSACTION_LIMIT_MS,
      });
      expect(await settledWithin(pool.query('select 42 as answer'), HANG_CEILING_MS)).toMatchObject(
        { rows: [{ answer: '42' }] },
      );

      const held = database.holdAnswer(/slow/);
      const slow = pool.query('select 42 as answer from slow').then(
        (result) => result,
        (error: unknown) => error,
      );
      // Real 1 ms turns: the faked setTimeout would never fire here.
      for (let turn = 0; turn < 1_000 && !held.arrived(); turn += 1) {
        await realDelay(1);
      }
      expect(held.arrived()).toBe(true);
      await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
      held.release();
      vi.useRealTimers();

      expect(await settledWithin(slow, HANG_CEILING_MS)).toMatchObject({
        rows: [{ answer: '42' }],
      });
    } finally {
      vi.useRealTimers();
      await pool?.end();
      await database.close();
    }
  });

  // BUG-34, review loop 1 (safety-reviewer and test-auditor): the timeout is
  // the client's handshake timer, never pg-pool's own connectionTimeoutMillis.
  // pg-pool would also time out a wait for a free client in a full pool, and
  // in the worker that waiter can be Graphile Worker's completeJob, which
  // Graphile does not await (dist/worker.js), so its rejection would end the
  // process. Graphile holds one of the worker's two connections for LISTEN,
  // and a sweep may hold the other up to LOCK_WAIT_LIMIT_MS for a row, so a
  // queue is ordinary. pg-pool hands its options to every client, so the
  // tests above pass with the timeout on the pool too: only a full pool tells
  // the two apart.
  test('BUG-34: a full pool’s waiter is never timed out: a pool.connect() queued behind a checked-out client is still waiting 3 × CONNECT_TIMEOUT_MS later and gets that client once it is released, so no wait for a free client can fail Graphile Worker’s unawaited completeJob', async () => {
    const database = await listeningFakePostgres(() => ({ columns: [], rows: [] }));
    let pool: ReturnType<typeof createPool> | undefined;
    let held: PoolClient | undefined;
    let queued: Promise<PoolClient | Error> | undefined;
    try {
      pool = createPool(database.url, 1, {
        name: 'worker',
        log: fakeLog(),
        idleInTransactionMs: IDLE_IN_TRANSACTION_LIMIT_MS,
      });
      held = await pool.connect();
      const first = held;

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      queued = pool.connect().then(
        (client) => client,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
      );
      await vi.advanceTimersByTimeAsync(3 * CONNECT_TIMEOUT_MS);
      expect(
        await settledWithin(queued, NOT_YET_MS),
        `a wait for a free client gave up ${String(3 * CONNECT_TIMEOUT_MS)} ms in`,
      ).toBe(STILL_WAITING);

      vi.useRealTimers();
      held.release();
      held = undefined;
      expect(await settledWithin(queued, HANG_CEILING_MS)).toBe(first);
    } finally {
      vi.useRealTimers();
      // Both clients go back, whatever failed, or pool.end() waits for them.
      held?.release();
      const late = queued === undefined ? undefined : await settledWithin(queued, HANG_CEILING_MS);
      if (late !== undefined && late !== STILL_WAITING && !(late instanceof Error)) {
        late.release();
      }
      await pool?.end();
      await database.close();
    }
  });
});

// BUG-51 (safety-reviewer, on BUG-34): BUG-34 bounded a connection's
// handshake, and nothing bounded a query once the connection was up. A query
// the database never answers held its caller for ever: a sweep, whose loop
// then never ran again; a Graphile Worker query; or the API's read-back of
// its session limits, which the API's stop() awaits. D-132 bounds a query on
// the API's and the worker's pools in three layers: statement_timeout
// (STATEMENT_TIMEOUT_MS) as a startup parameter, a client-side limit
// (QUERY_TIMEOUT_MS) after which the connection is destroyed rather than
// handed back to the pool, and TCP keepalive. The migrations' pool gets none
// of them, so a long migration is not cut off.
//
// The process pools below are made as the BUG-34 tests above make them, and
// as database.integration.test.ts makes "a pool made as the worker makes it":
// with the process's name, a log and the session limits that process asks
// for. A pool made with a name is a process's pool; the migrations' pool is
// made with neither (migrations.ts). Which startup parameters each process's
// own pool sends is shown where the process makes it: api-process.test.ts
// and worker.test.ts.
//
// The limit is driven with Vitest's fake setTimeout, as pg's own timers are,
// so the bound is exact whatever the machine's load. The tests' own waits are
// real and generous (settledWithin, HANG_CEILING_MS), so only a hang reaches
// them.
describe('BUG-51: the bounds on a query, against the limits beside them', () => {
  test('BUG-51: STATEMENT_TIMEOUT_MS is 10 000 ms and QUERY_TIMEOUT_MS is 15 000 ms, the values D-132 chose', () => {
    expect({ STATEMENT_TIMEOUT_MS, QUERY_TIMEOUT_MS }).toEqual({
      STATEMENT_TIMEOUT_MS: 10_000,
      QUERY_TIMEOUT_MS: 15_000,
    });
  });

  test('BUG-51: STATEMENT_TIMEOUT_MS is longer than LOCK_WAIT_LIMIT_MS, so a wait for a row that gives up on time, with 55P03, is never cut off first by the statement limit', () => {
    expect(STATEMENT_TIMEOUT_MS).toBeGreaterThan(LOCK_WAIT_LIMIT_MS);
  });

  test('BUG-51: QUERY_TIMEOUT_MS is longer than STATEMENT_TIMEOUT_MS, so on a database that answers, PostgreSQL cancels a slow statement first and the connection stays usable', () => {
    expect(QUERY_TIMEOUT_MS).toBeGreaterThan(STATEMENT_TIMEOUT_MS);
  });

  test('BUG-51: QUERY_TIMEOUT_MS plus one WATCHDOG_INTERVAL_MS is shorter than WORKER_STALE_AFTER_MS, so a sweep a hung query held runs again before the worker reads as stale', () => {
    expect(QUERY_TIMEOUT_MS + WATCHDOG_INTERVAL_MS).toBeLessThan(WORKER_STALE_AFTER_MS);
  });
});

/** The two process pools' options, made fresh for each test, as api-process.ts and worker.ts make them. */
function processPoolOptions(name: 'api' | 'worker'): PoolOptions {
  return name === 'api'
    ? {
        name,
        log: fakeLog(),
        idleInTransactionMs: IDLE_IN_TRANSACTION_LIMIT_MS,
        lockTimeoutMs: LOCK_WAIT_LIMIT_MS,
      }
    : { name, log: fakeLog(), idleInTransactionMs: IDLE_IN_TRANSACTION_LIMIT_MS };
}

/** What a database that answers again answers: one row, `answer` 42. */
const ANSWER = { columns: ['answer'], rows: [['42']] };

/**
 * Ends a test's pool, giving up after HANG_CEILING_MS: pg-pool's end() waits
 * for every client it handed out to come back, and a client a failing fix
 * never takes back would hold the test until it timed out. Its sockets are
 * closed by then, with the server.
 */
async function endWithin(pool: ReturnType<typeof createPool> | undefined): Promise<void> {
  if (pool !== undefined) {
    await settledWithin(pool.end(), HANG_CEILING_MS);
  }
}

/** What a query settled with: its rows, or what it rejected with. */
function rowsOrError<T extends QueryResultRow>(query: Promise<QueryResult<T>>): Promise<unknown> {
  return query.then(
    (result) => result.rows,
    (error: unknown) => error,
  );
}

/** A client from pool.connect(), or a throw when none came back within HANG_CEILING_MS. */
async function checkedOut(pool: ReturnType<typeof createPool>): Promise<PoolClient> {
  const client = await settledWithin(pool.connect(), HANG_CEILING_MS);
  if (client === STILL_WAITING) {
    throw new Error('no client came back from pool.connect()');
  }
  return client;
}

/**
 * A client's query method as pg receives it, any argument at all. A call
 * through it keeps the client as `this`, as a call made in the code would.
 */
interface AnyQuery {
  query: (...args: unknown[]) => unknown;
}

/** The rows pg gives for ANSWER. */
const ANSWERED = [{ answer: '42' }];

/**
 * When safety-reviewer's probe on BUG-51 checks its client out again, after
 * the query pg refused: before pg-pool closes an idle client (10 s), and
 * before QUERY_TIMEOUT_MS.
 */
const REUSED_AFTER_MS = 8_000;

describe('BUG-51: a process’s pool against a database that completes the startup and never answers a query', () => {
  /** How long a check that something has not happened yet waits, in real ms. */
  const NOT_YET_MS = 100;

  const processes: [string, 'api' | 'worker'][] = [
    ['the API’s', 'api'],
    ['the worker’s', 'worker'],
  ];

  test.each(processes)(
    'BUG-51: %s pool rejects a query the database never answers once QUERY_TIMEOUT_MS have passed, not before and not never, and closes the connection it hung on',
    async (_which, name) => {
      const database = await listeningHungPostgres();
      let pool: ReturnType<typeof createPool> | undefined;
      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pool = createPool(database.url, 1, processPoolOptions(name));
        const query = pool.query('select 1').then(
          () => 'answered',
          (error: unknown) => error,
        );
        expect(
          await settledWithin(database.hanging(), HANG_CEILING_MS),
          'the query never reached the database',
        ).toBeUndefined();

        await vi.advanceTimersByTimeAsync(QUERY_TIMEOUT_MS - 1);
        expect(await settledWithin(query, NOT_YET_MS)).toBe(STILL_WAITING);

        await vi.advanceTimersByTimeAsync(1);
        vi.useRealTimers();
        expect(
          await settledWithin(query, HANG_CEILING_MS),
          `the query was still waiting ${String(QUERY_TIMEOUT_MS)} ms after the database stopped answering it`,
        ).toBeInstanceOf(Error);
        expect(
          await eventually(() => database.closed().length === 1),
          'the connection the query hung on was left open',
        ).toBe(true);
      } finally {
        vi.useRealTimers();
        // The server first: a connection still waiting would hold pool.end().
        await database.close();
        await endWithin(pool);
      }
    },
  );

  test.each(processes)(
    'BUG-51: after that, %s pool’s next query gets a new connection, and the database, answering again, answers it there',
    async (_which, name) => {
      let answering = false;
      const database = await listeningHungPostgres(() => (answering ? ANSWER : NEVER_ANSWERED));
      let pool: ReturnType<typeof createPool> | undefined;
      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pool = createPool(database.url, 1, processPoolOptions(name));
        const first = pool.query('select 1').then(
          () => 'answered',
          (error: unknown) => error,
        );
        expect(await settledWithin(database.hanging(), HANG_CEILING_MS)).toBeUndefined();
        await vi.advanceTimersByTimeAsync(QUERY_TIMEOUT_MS);
        vi.useRealTimers();
        expect(
          await settledWithin(first, HANG_CEILING_MS),
          `the query was still waiting ${String(QUERY_TIMEOUT_MS)} ms after the database stopped answering it`,
        ).toBeInstanceOf(Error);

        answering = true;
        const next = pool.query<{ answer: string }>('select 42 as answer').then(
          (result) => result.rows,
          (error: unknown) => error,
        );
        expect(
          await settledWithin(next, HANG_CEILING_MS),
          'the next query was not answered',
        ).toEqual([{ answer: '42' }]);
        const [hung, fresh] = database.connections();
        expect(database.connections()).toHaveLength(2);
        expect(hung?.queries.map(({ text }) => text)).toEqual(['select 1']);
        expect(fresh?.queries.map(({ text }) => text)).toEqual(['select 42 as answer']);
      } finally {
        vi.useRealTimers();
        await database.close();
        await endWithin(pool);
      }
    },
  );

  // Released without an error, a client goes back to the pool unless pg
  // already counts it unusable (pg-pool's _release). pg's own query_timeout
  // rejects the caller and leaves the query it sent holding the connection
  // (pg 8.23, client.js, the read timeout), so a client released that way
  // would be handed out again, and every query on it would wait behind the
  // one never answered. Graphile Worker's withPgClient releases in a
  // `finally`, without an error, in the turn its query rejects
  // (graphile-worker 0.18, dist/helpers.js): so does this test.
  test.each(processes)(
    'BUG-51: %s pool: a client checked out with pool.connect(), whose query the database never answers, rejects once QUERY_TIMEOUT_MS have passed; released without an error in that same turn, as Graphile Worker’s withPgClient releases it, it is never handed out again: its connection is closed, and the next pool.connect() gets a new client, which the database, answering again, answers',
    async (_which, name) => {
      let answering = false;
      const database = await listeningHungPostgres(() => (answering ? ANSWER : NEVER_ANSWERED));
      let pool: ReturnType<typeof createPool> | undefined;
      let next: PoolClient | undefined;
      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pool = createPool(database.url, 1, processPoolOptions(name));
        const checkedOut = await settledWithin(pool.connect(), HANG_CEILING_MS);
        if (checkedOut === STILL_WAITING) {
          throw new Error('the pool never connected');
        }
        const first = checkedOut;
        const query = first.query('select 1').then(
          () => {
            first.release();
            return 'answered';
          },
          (error: unknown) => {
            first.release();
            return error;
          },
        );
        expect(await settledWithin(database.hanging(), HANG_CEILING_MS)).toBeUndefined();
        await vi.advanceTimersByTimeAsync(QUERY_TIMEOUT_MS);
        vi.useRealTimers();
        expect(
          await settledWithin(query, HANG_CEILING_MS),
          `the query was still waiting ${String(QUERY_TIMEOUT_MS)} ms after the database stopped answering it`,
        ).toBeInstanceOf(Error);

        answering = true;
        const again = await settledWithin(pool.connect(), HANG_CEILING_MS);
        expect(again, 'no client came back from pool.connect()').not.toBe(STILL_WAITING);
        if (again === STILL_WAITING) {
          return;
        }
        next = again;
        expect(
          next,
          'the pool handed out again the client whose query was never answered',
        ).not.toBe(first);
        const answered = next.query<{ answer: string }>('select 42 as answer').then(
          (result) => result.rows,
          (error: unknown) => error,
        );
        expect(await settledWithin(answered, HANG_CEILING_MS)).toEqual([{ answer: '42' }]);
        const [hung] = database.connections();
        expect(database.connections()).toHaveLength(2);
        expect(
          await eventually(() => hung !== undefined && database.closed().includes(hung)),
          'the connection the query hung on was left open',
        ).toBe(true);
      } finally {
        vi.useRealTimers();
        next?.release();
        await database.close();
        await endWithin(pool);
      }
    },
  );

  // Drizzle's transaction (drizzle-orm 0.45, node-postgres/session.js) sends
  // begin, then the work; on an error it sends rollback, and then, in a
  // `finally`, releases the client without an error. A rollback queued
  // behind a statement never answered would wait a whole limit more.
  test.each(processes)(
    'BUG-51: %s pool: a Drizzle transaction whose statement the database never answers rejects once QUERY_TIMEOUT_MS have passed, its rollback included; its connection is closed, and the next query gets a new connection, which the database, answering again, answers',
    async (_which, name) => {
      let answering = false;
      const database = await listeningHungPostgres((query) =>
        answering
          ? ANSWER
          : /^\s*begin\b/i.test(query.text)
            ? { columns: [], rows: [] }
            : NEVER_ANSWERED,
      );
      let pool: ReturnType<typeof createPool> | undefined;
      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pool = createPool(database.url, 1, processPoolOptions(name));
        const transaction = createDatabase(pool)
          .transaction(async (tx) => {
            await tx.execute(sql`select 'held' as answer`);
          })
          .then(
            () => 'committed',
            (error: unknown) => error,
          );
        expect(await settledWithin(database.hanging(), HANG_CEILING_MS)).toBeUndefined();
        await vi.advanceTimersByTimeAsync(QUERY_TIMEOUT_MS);
        vi.useRealTimers();
        expect(
          await settledWithin(transaction, HANG_CEILING_MS),
          `the transaction was still waiting ${String(QUERY_TIMEOUT_MS)} ms after the database stopped answering it`,
        ).toBeInstanceOf(Error);

        answering = true;
        const next = pool.query<{ answer: string }>('select 42 as answer').then(
          (result) => result.rows,
          (error: unknown) => error,
        );
        expect(await settledWithin(next, HANG_CEILING_MS)).toEqual([{ answer: '42' }]);
        const [hung] = database.hung();
        expect(database.connections().at(-1)).not.toBe(hung);
        expect(
          await eventually(() => hung !== undefined && database.closed().includes(hung)),
          'the connection the transaction hung on was left open',
        ).toBe(true);
      } finally {
        vi.useRealTimers();
        await database.close();
        await endWithin(pool);
      }
    },
  );

  // Drizzle's transaction awaits its begin before the `try` whose `finally`
  // releases the client (drizzle-orm 0.45, node-postgres/session.js), so a
  // begin that rejects leaves its client checked out for ever, and pg-pool
  // counts a client it handed out until it comes back. Destroying the
  // connection does not give the pool its place back. With as many such
  // transactions as the pool has connections, every later query would wait
  // for a free client for ever: the hang this bug is about, one step on.
  test.each(processes)(
    'BUG-51: %s pool, at its full size: Drizzle transactions whose begin the database never answers reject once QUERY_TIMEOUT_MS have passed, and do not keep their places in the pool: the next query gets a new connection, which the database, answering again, answers',
    async (_which, name) => {
      let answering = false;
      const database = await listeningHungPostgres(() => (answering ? ANSWER : NEVER_ANSWERED));
      const size = POOL_SIZE[name];
      let pool: ReturnType<typeof createPool> | undefined;
      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pool = createPool(database.url, size, processPoolOptions(name));
        const db = createDatabase(pool);
        const transactions = Array.from({ length: size }, () =>
          db
            .transaction(async (tx) => {
              await tx.execute(sql`select 1`);
            })
            .then(
              () => 'committed',
              (error: unknown) => error,
            ),
        );
        expect(
          await settledWithin(database.hanging(size), HANG_CEILING_MS),
          `the ${String(size)} begins never reached the database`,
        ).toBeUndefined();
        await vi.advanceTimersByTimeAsync(QUERY_TIMEOUT_MS);
        vi.useRealTimers();
        const settled = await settledWithin(Promise.all(transactions), HANG_CEILING_MS);
        expect(
          settled,
          `a transaction was still waiting ${String(QUERY_TIMEOUT_MS)} ms after the database stopped answering its begin`,
        ).not.toBe(STILL_WAITING);
        for (const outcome of settled === STILL_WAITING ? [] : settled) {
          expect(outcome).toBeInstanceOf(Error);
        }

        answering = true;
        const next = pool.query<{ answer: string }>('select 42 as answer').then(
          (result) => result.rows,
          (error: unknown) => error,
        );
        expect(
          await settledWithin(next, HANG_CEILING_MS),
          'the next query was still waiting for a place in the pool',
        ).toEqual([{ answer: '42' }]);
        expect(database.connections()).toHaveLength(size + 1);
      } finally {
        vi.useRealTimers();
        await database.close();
        await endWithin(pool);
      }
    },
  );

  test.each(processes)(
    'BUG-51: %s pool turns TCP keepalive on for every connection it makes',
    async (_which, name) => {
      const database = await listeningFakePostgres(() => ({ columns: [], rows: [] }));
      const keepAlive = watchingKeepAlive();
      let pool: ReturnType<typeof createPool> | undefined;
      try {
        pool = createPool(database.url, 2, processPoolOptions(name));
        const first = await pool.connect();
        const second = await pool.connect();
        first.release();
        second.release();

        expect(database.connections()).toHaveLength(2);
        expect(keepAlive.socketsTo(database.url), 'connections made with no TCP keepalive').toBe(2);
      } finally {
        keepAlive.restore();
        await pool?.end();
        await database.close();
      }
    },
  );

  // D-132, amended: keepalive's first probe comes after 10 s idle. pg's
  // default delay, 0, keeps the operating system's own, about two hours on
  // Linux, so a vanished peer on an idle connection would go unnoticed for
  // that long.
  test.each(processes)(
    'BUG-51: %s pool turns TCP keepalive on with its first probe after 10 000 ms idle, on every connection it makes',
    async (_which, name) => {
      const database = await listeningFakePostgres(() => ({ columns: [], rows: [] }));
      const keepAlive = watchingKeepAlive();
      let pool: ReturnType<typeof createPool> | undefined;
      try {
        pool = createPool(database.url, 2, processPoolOptions(name));
        const first = await pool.connect();
        const second = await pool.connect();
        first.release();
        second.release();

        expect(database.connections()).toHaveLength(2);
        expect(
          keepAlive.delaysTo(database.url),
          'the delay before the first keepalive probe, for each connection',
        ).toEqual([10_000, 10_000]);
      } finally {
        keepAlive.restore();
        await pool?.end();
        await database.close();
      }
    },
  );

  // BUG-51, review loop 1 (test-auditor, BLOCK): the limit's healthy side.
  // Every test above starts from a database that never answers, so none ran
  // a query that was answered and then waited past the limit. A limit never
  // disarmed, disarmed on only one of pg's two ways of answering (pg-pool's
  // pool.query takes a callback; a checked-out client's query returns a
  // promise), or armed on each hand-out rather than on each query, would end
  // every healthy connection QUERY_TIMEOUT_MS after it was used, Graphile
  // Worker's LISTEN connection with it, and it passed every test above.
  //
  // Here the database answers. Each test runs one answered query, holds the
  // client, lets 2 × QUERY_TIMEOUT_MS pass on the fake clock, and asks the same
  // client again: it answers, on the one connection the pool made. The client
  // is held, not left idle in the pool, while the time passes, because
  // pg-pool closes a client left idle for 10 s (idleTimeoutMillis), which is
  // not the limit. Each hand-out happens on the fake clock, so a limit armed
  // per hand-out would fire too. These pass today and must still pass after.
  test.each(processes)(
    'BUG-51: guard: %s pool disarms the limit when pool.query is answered: the client that answered it, checked out and held for 2 × QUERY_TIMEOUT_MS, answers again on the same connection',
    async (_which, name) => {
      const database = await listeningFakePostgres(() => ANSWER);
      let pool: ReturnType<typeof createPool> | undefined;
      let held: PoolClient | undefined;
      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pool = createPool(database.url, 1, processPoolOptions(name));
        expect(
          await settledWithin(rowsOrError(pool.query('select 42 as answer')), HANG_CEILING_MS),
        ).toEqual(ANSWERED);
        held = await checkedOut(pool);

        await vi.advanceTimersByTimeAsync(2 * QUERY_TIMEOUT_MS);
        expect(
          await settledWithin(rowsOrError(held.query('select 42 as answer')), HANG_CEILING_MS),
          'a limit armed for a query that was answered ended its connection later',
        ).toEqual(ANSWERED);
        expect(database.connections()).toHaveLength(1);
        expect(database.closed(), 'the connection was closed').toHaveLength(0);
      } finally {
        vi.useRealTimers();
        held?.release();
        await endWithin(pool);
        await database.close();
      }
    },
  );

  test.each(processes)(
    'BUG-51: guard: %s pool disarms the limit when a checked-out client’s query is answered: the client, held idle for 2 × QUERY_TIMEOUT_MS after it, as Graphile Worker holds its LISTEN connection, answers again on the same connection',
    async (_which, name) => {
      const database = await listeningFakePostgres(() => ANSWER);
      let pool: ReturnType<typeof createPool> | undefined;
      let held: PoolClient | undefined;
      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pool = createPool(database.url, 1, processPoolOptions(name));
        held = await checkedOut(pool);
        expect(
          await settledWithin(rowsOrError(held.query('select 42 as answer')), HANG_CEILING_MS),
        ).toEqual(ANSWERED);

        await vi.advanceTimersByTimeAsync(2 * QUERY_TIMEOUT_MS);
        expect(
          await settledWithin(rowsOrError(held.query('select 42 as answer')), HANG_CEILING_MS),
          'a limit armed for a query that was answered, or for the hand-out, ended the held connection',
        ).toEqual(ANSWERED);
        expect(database.connections()).toHaveLength(1);
        expect(database.closed(), 'the connection was closed').toHaveLength(0);
      } finally {
        vi.useRealTimers();
        held?.release();
        await endWithin(pool);
        await database.close();
      }
    },
  );

  // BUG-51, review loop 1 (code-reviewer, safety-reviewer; D-132 amended
  // again): pg throws at once, before sending anything, for a null query
  // (pg 8.23, client.js, query()). A limit armed before that throw is never
  // disarmed, and QUERY_TIMEOUT_MS later it ends a client that is healthy. If
  // the client is still held, its holder's next query fails. If it went back
  // to the pool, it ends there unseen, and the next hand-out of it fails and
  // its release is swallowed, so the pool loses that place for good:
  // safety-reviewer's probe, the second test below, on a pool of one.
  test.each(processes)(
    'BUG-51: %s pool: a query pg refuses at once (a null query) on a checked-out client throws and leaves no limit behind: 2 × QUERY_TIMEOUT_MS later the client still answers, and once released the pool hands out a client that answers, on the same connection',
    async (_which, name) => {
      const database = await listeningFakePostgres(() => ANSWER);
      let pool: ReturnType<typeof createPool> | undefined;
      let held: PoolClient | undefined;
      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pool = createPool(database.url, 1, processPoolOptions(name));
        held = await checkedOut(pool);
        const client = held as unknown as AnyQuery;
        expect(() => client.query(null)).toThrow(TypeError);

        await vi.advanceTimersByTimeAsync(2 * QUERY_TIMEOUT_MS);
        expect(
          await settledWithin(rowsOrError(held.query('select 42 as answer')), HANG_CEILING_MS),
          'a limit armed for the query pg refused ended the client later',
        ).toEqual(ANSWERED);
        held.release();
        held = await checkedOut(pool);
        expect(
          await settledWithin(rowsOrError(held.query('select 42 as answer')), HANG_CEILING_MS),
        ).toEqual(ANSWERED);
        expect(database.connections()).toHaveLength(1);
      } finally {
        vi.useRealTimers();
        held?.release();
        await endWithin(pool);
        await database.close();
      }
    },
  );

  test.each(processes)(
    'BUG-51: %s pool of one: a query pg refuses at once, on a client then released, reused 8 000 ms later and released again, leaves no limit behind: at QUERY_TIMEOUT_MS nothing ends the idle client, and pool.connect() then still gets a client that answers, on the same connection',
    async (_which, name) => {
      const database = await listeningFakePostgres(() => ANSWER);
      let pool: ReturnType<typeof createPool> | undefined;
      let held: PoolClient | undefined;
      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pool = createPool(database.url, 1, processPoolOptions(name));
        const first = await checkedOut(pool);
        expect(() => (first as unknown as AnyQuery).query(null)).toThrow(TypeError);
        first.release();

        // Reused before pg-pool's 10 s idle limit, which this hand-out resets.
        await vi.advanceTimersByTimeAsync(REUSED_AFTER_MS);
        const reused = await checkedOut(pool);
        expect(reused, 'the pool of one made a new client rather than reuse its idle one').toBe(
          first,
        );
        expect(
          await settledWithin(rowsOrError(reused.query('select 42 as answer')), HANG_CEILING_MS),
        ).toEqual(ANSWERED);
        reused.release();

        // QUERY_TIMEOUT_MS after the refused query, and 7 000 ms after the
        // release, so pg-pool's own idle limit has not come yet.
        await vi.advanceTimersByTimeAsync(QUERY_TIMEOUT_MS - REUSED_AFTER_MS);
        await realDelay(NOT_YET_MS);
        const closedAtTheLimit = database.closed().length;

        const next = await settledWithin(pool.connect(), HANG_CEILING_MS);
        expect(next, 'the pool of one had lost its place').not.toBe(STILL_WAITING);
        if (next === STILL_WAITING) {
          return;
        }
        held = next;
        expect(
          await settledWithin(rowsOrError(held.query('select 42 as answer')), HANG_CEILING_MS),
          'the pool handed out a client a limit armed for the refused query had ended',
        ).toEqual(ANSWERED);
        expect(
          closedAtTheLimit,
          'a limit armed for the refused query closed the idle connection at QUERY_TIMEOUT_MS',
        ).toBe(0);
        expect(database.connections()).toHaveLength(1);
      } finally {
        vi.useRealTimers();
        held?.release();
        await endWithin(pool);
        await database.close();
      }
    },
  );

  // BUG-51, review loop 1 (safety-reviewer; D-132 amended again): a query
  // config that carries its own `callback` gets no promise back from pg, and
  // the limit could not see it settle, so it is refused, before anything is
  // sent, as a submittable query is. None is sent on these pools.
  test.each(processes)(
    'BUG-51: %s pool refuses, with a TypeError, a query whose config carries its own callback, before anything is sent: the database receives no query, and 2 × QUERY_TIMEOUT_MS later the client still answers on the same connection',
    async (_which, name) => {
      const database = await listeningFakePostgres(() => ANSWER);
      let pool: ReturnType<typeof createPool> | undefined;
      let held: PoolClient | undefined;
      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pool = createPool(database.url, 1, processPoolOptions(name));
        held = await checkedOut(pool);
        let calledBack = false;
        const withItsOwnCallback = {
          text: 'select 42 as answer from refused',
          callback: () => {
            calledBack = true;
          },
        };
        expect(
          () => (held as unknown as AnyQuery).query(withItsOwnCallback),
          'a query config with its own callback was not refused',
        ).toThrow(TypeError);
        await realDelay(NOT_YET_MS);
        expect(
          database.queries.map(({ text }) => text),
          'the query was sent',
        ).toEqual([]);
        expect(calledBack).toBe(false);

        await vi.advanceTimersByTimeAsync(2 * QUERY_TIMEOUT_MS);
        expect(
          await settledWithin(rowsOrError(held.query('select 42 as answer')), HANG_CEILING_MS),
          'a limit armed for the refused query ended the client later',
        ).toEqual(ANSWERED);
        expect(database.connections()).toHaveLength(1);
      } finally {
        vi.useRealTimers();
        held?.release();
        await endWithin(pool);
        await database.close();
      }
    },
  );

  // BUG-51, review loop 1 (test-auditor, safety-reviewer): the submittable
  // refusal had no test. A submittable (a cursor or a stream) settles through
  // methods of its own, which the limit cannot see; pg sends it by calling its
  // submit(). Without the refusal, pg would take this one as its active query,
  // and the client would answer nothing after it. Passes today.
  test.each(processes)(
    'BUG-51: guard: %s pool refuses a submittable query with a TypeError before anything is sent: its submit() is never called, the database receives no query, and 2 × QUERY_TIMEOUT_MS later the client still answers on the same connection',
    async (_which, name) => {
      const database = await listeningFakePostgres(() => ANSWER);
      let pool: ReturnType<typeof createPool> | undefined;
      let held: PoolClient | undefined;
      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pool = createPool(database.url, 1, processPoolOptions(name));
        held = await checkedOut(pool);
        let submitted = false;
        const submittable = {
          submit: () => {
            submitted = true;
          },
        };
        expect(
          () => (held as unknown as AnyQuery).query(submittable),
          'a submittable query was not refused',
        ).toThrow(TypeError);
        await realDelay(NOT_YET_MS);
        expect(submitted, 'pg was handed the submittable and sent it').toBe(false);
        expect(database.queries.map(({ text }) => text)).toEqual([]);

        await vi.advanceTimersByTimeAsync(2 * QUERY_TIMEOUT_MS);
        expect(
          await settledWithin(rowsOrError(held.query('select 42 as answer')), HANG_CEILING_MS),
          'the client no longer answered after the submittable',
        ).toEqual(ANSWERED);
        expect(database.connections()).toHaveLength(1);
      } finally {
        vi.useRealTimers();
        held?.release();
        await endWithin(pool);
        await database.close();
      }
    },
  );

  // BUG-51, review loop 1 (safety-reviewer; D-132 amended again): the limit's
  // rejection carries code ETIMEDOUT. Graphile Worker 0.18 completes and fails
  // a job with a call nobody awaits, and its retry wrapper retries only a few
  // codes, ETIMEDOUT among them (dist/lib.js, RETRYABLE_ERROR_CODES): pg's
  // plain "Connection terminated" there was an unhandled rejection, which
  // ended the worker. Its message names the limit and holds nothing of the
  // query, and sqlstateOf reads no SQLSTATE in it, so the lines that log one
  // still say null. Each query below names a synthetic table and sends a
  // synthetic parameter, so a message holding either is caught.
  //
  // Graphile's own retry over this rejection is not tested here:
  // makeEnhancedWithPgClient and makeWithPgClientFromPool are not exported
  // (graphile-worker 0.18's exports map holds dist/index.js alone), and
  // makeWorkerUtils, which is, installs Graphile's schema first.

  /** A query's text naming a synthetic table, and its synthetic parameter. */
  function markedQuery(): { table: string; text: string; parameter: string } {
    const table = `bug51_${syntheticUuid().replaceAll('-', '')}`;
    return {
      table,
      text: `select $1::text as answer from ${table}`,
      parameter: syntheticCredential(),
    };
  }

  /**
   * What `ask` settled with, on a pool of one over a database that never
   * answers, once QUERY_TIMEOUT_MS have passed; or STILL_WAITING.
   */
  async function settledAtTheLimit(
    name: 'api' | 'worker',
    ask: (pool: ReturnType<typeof createPool>) => Promise<unknown>,
  ): Promise<unknown> {
    const database = await listeningHungPostgres();
    let pool: ReturnType<typeof createPool> | undefined;
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      pool = createPool(database.url, 1, processPoolOptions(name));
      const asked = ask(pool).then(
        () => 'answered',
        (error: unknown) => error,
      );
      expect(
        await settledWithin(database.hanging(), HANG_CEILING_MS),
        'the query never reached the database',
      ).toBeUndefined();
      await vi.advanceTimersByTimeAsync(QUERY_TIMEOUT_MS);
      vi.useRealTimers();
      return await settledWithin(asked, HANG_CEILING_MS);
    } finally {
      vi.useRealTimers();
      await database.close();
      await endWithin(pool);
    }
  }

  /** Holds what D-132 says of the limit's rejection. */
  function expectTheLimitsRejection(
    rejection: unknown,
    { table, text, parameter }: ReturnType<typeof markedQuery>,
  ): void {
    expect(
      rejection,
      `the query was still waiting ${String(QUERY_TIMEOUT_MS)} ms after the database stopped answering it`,
    ).toBeInstanceOf(Error);
    const { code, message } = rejection as Error & { code?: unknown };
    expect(
      code,
      'the limit’s rejection has no code ETIMEDOUT, which Graphile Worker’s retry wrapper retries',
    ).toBe('ETIMEDOUT');
    expect(message, 'the limit’s message does not name QUERY_TIMEOUT_MS').toMatch(
      /\bQUERY_TIMEOUT_MS\b/,
    );
    expect(message).not.toContain(text);
    expect(message).not.toContain(table);
    expect(message).not.toContain(parameter);
    expect(sqlstateOf(rejection)).toBeNull();
  }

  test.each(processes)(
    'BUG-51: %s pool: pool.query given up at QUERY_TIMEOUT_MS rejects with code ETIMEDOUT, which Graphile Worker retries, and a message that names QUERY_TIMEOUT_MS and holds neither the SQL nor its parameter; sqlstateOf reads no SQLSTATE in it',
    async (_which, name) => {
      const marked = markedQuery();
      const rejection = await settledAtTheLimit(name, (pool) =>
        pool.query(marked.text, [marked.parameter]),
      );

      expectTheLimitsRejection(rejection, marked);
    },
  );

  test.each(processes)(
    'BUG-51: %s pool: a checked-out client’s query, given up at QUERY_TIMEOUT_MS, rejects with code ETIMEDOUT, which Graphile Worker retries, and a message that names QUERY_TIMEOUT_MS and holds neither the SQL nor its parameter; sqlstateOf reads no SQLSTATE in it',
    async (_which, name) => {
      const marked = markedQuery();
      const rejection = await settledAtTheLimit(name, async (pool) => {
        // As Graphile Worker's withPgClient: released in a `finally`.
        const client = await pool.connect();
        try {
          return await client.query(marked.text, [marked.parameter]);
        } finally {
          client.release();
        }
      });

      expectTheLimitsRejection(rejection, marked);
    },
  );

  // Drizzle wraps what pg rejects with in a DrizzleQueryError, whose own
  // message holds the SQL and its parameters (drizzle-orm 0.45.3), and which
  // carries pg's rejection as its cause. Every caller logs only sqlstateOf of
  // it (privacy-security-reviewer), so the cause is what is held here.
  test.each(processes)(
    'BUG-51: %s pool: a Drizzle query given up at QUERY_TIMEOUT_MS rejects with the limit’s rejection as its cause: code ETIMEDOUT, a message that names QUERY_TIMEOUT_MS and holds neither the SQL nor its parameter; sqlstateOf reads no SQLSTATE in the whole chain',
    async (_which, name) => {
      const marked = markedQuery();
      const rejection = await settledAtTheLimit(name, (pool) =>
        createDatabase(pool).execute(
          sql`select ${marked.parameter}::text as answer from ${sql.raw(marked.table)}`,
        ),
      );

      expect(rejection).toBeInstanceOf(Error);
      expect(sqlstateOf(rejection)).toBeNull();
      expectTheLimitsRejection((rejection as { cause?: unknown }).cause, marked);
    },
  );

  // BUG-51, review loop 1 (safety-reviewer; D-132 amended again): only the
  // given-up hand-out's own release is swallowed. A swallow kept anywhere
  // wider than that one client (on the pool, or for the module) would leave
  // the next client's release doing nothing: its place lost, and a double
  // release unseen. Passes today: the swallow is the given-up client's own.
  test.each(processes)(
    'BUG-51: guard: %s pool: after the limit gives up on one client, whose holder’s release then does nothing, a different client the pool hands out later is released normally, back to the pool, and a second release of it still throws pg-pool’s double-release error',
    async (_which, name) => {
      let answering = false;
      const database = await listeningHungPostgres(() => (answering ? ANSWER : NEVER_ANSWERED));
      let pool: ReturnType<typeof createPool> | undefined;
      let held: PoolClient | undefined;
      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pool = createPool(database.url, 1, processPoolOptions(name));
        const givenUp = await checkedOut(pool);
        const hung = rowsOrError(givenUp.query('select 1'));
        expect(await settledWithin(database.hanging(), HANG_CEILING_MS)).toBeUndefined();
        await vi.advanceTimersByTimeAsync(QUERY_TIMEOUT_MS);
        vi.useRealTimers();
        expect(await settledWithin(hung, HANG_CEILING_MS)).toBeInstanceOf(Error);
        expect(() => {
          givenUp.release();
        }, 'the given-up client’s release reached pg-pool').not.toThrow();

        answering = true;
        const later = await checkedOut(pool);
        held = later;
        expect(later).not.toBe(givenUp);
        expect(
          await settledWithin(rowsOrError(later.query('select 42 as answer')), HANG_CEILING_MS),
        ).toEqual(ANSWERED);
        later.release();
        held = undefined;
        expect(pool.idleCount, 'the later client’s release did not give it back').toBe(1);
        expect(() => {
          later.release();
        }).toThrow('Release called on client which has already been released to the pool.');
        held = await checkedOut(pool);
        expect(held, 'the pool did not hand the released client out again').toBe(later);
      } finally {
        vi.useRealTimers();
        held?.release();
        await database.close();
        await endWithin(pool);
      }
    },
  );

  // BUG-51, review loop 1 (test-auditor; D-132 amended again): no
  // database_error line when the limit ends a connection, by choice. pg raises
  // no `error` for a client it was asked to end, and the query's caller fails
  // loudly instead. A limit that destroyed the socket with an error, or
  // emitted one, would write a line for each give-up. Passes today.
  test.each(processes)(
    'BUG-51: guard: %s pool, made with a log, writes nothing to it when the limit ends a connection: the query rejects and its connection closes, with no database_error line',
    async (_which, name) => {
      const database = await listeningHungPostgres();
      const log = fakeLog();
      let pool: ReturnType<typeof createPool> | undefined;
      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pool = createPool(database.url, 1, { ...processPoolOptions(name), log });
        const query = rowsOrError(pool.query('select 1'));
        expect(await settledWithin(database.hanging(), HANG_CEILING_MS)).toBeUndefined();
        await vi.advanceTimersByTimeAsync(QUERY_TIMEOUT_MS);
        vi.useRealTimers();
        expect(await settledWithin(query, HANG_CEILING_MS)).toBeInstanceOf(Error);
        expect(await eventually(() => database.closed().length === 1)).toBe(true);
        // A line written a moment late is still a line.
        await realDelay(NOT_YET_MS);

        expect(log.events).toEqual([]);
      } finally {
        vi.useRealTimers();
        await database.close();
        await endWithin(pool);
      }
    },
  );
});

// BUG-51, guards: D-132 leaves the migrations' pool without either limit, so
// a long migration is not cut off. The pool is made as migrations.ts makes
// it: a connection string and 1, nothing else. These pass today and must
// still pass after: they fail a fix that bounds every pool.
describe('BUG-51: guards: the migrations’ pool gets no bound on a query', () => {
  test('BUG-51: guard: the migrations’ pool asks for no statement_timeout', async () => {
    const database = await listeningFakePostgres(() => ({ columns: [], rows: [] }));
    const pool = createPool(database.url, 1);
    try {
      await pool.query('select 1');

      const connections = database.connections();
      expect(connections).toHaveLength(1);
      for (const connection of connections) {
        expect(sessionSetting(connection, 'statement_timeout')).toBeUndefined();
      }
    } finally {
      await pool.end();
      await database.close();
    }
  });

  test('BUG-51: guard: the migrations’ pool does not cut short a statement answered WORKER_STALE_AFTER_MS later, which is longer than QUERY_TIMEOUT_MS', async () => {
    const database = await listeningFakePostgres(() => ANSWER);
    let pool: ReturnType<typeof createPool> | undefined;
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      pool = createPool(database.url, 1);
      const held = database.holdAnswer(/\bslow\b/);
      const slow = pool.query<{ answer: string }>('select 42 as answer from slow').then(
        (result) => result.rows,
        (error: unknown) => error,
      );
      // Real 1 ms turns: the faked setTimeout would never fire here.
      for (let turn = 0; turn < 1_000 && !held.arrived(); turn += 1) {
        await realDelay(1);
      }
      expect(held.arrived()).toBe(true);
      await vi.advanceTimersByTimeAsync(WORKER_STALE_AFTER_MS);
      held.release();
      vi.useRealTimers();

      expect(await settledWithin(slow, HANG_CEILING_MS)).toEqual([{ answer: '42' }]);
    } finally {
      vi.useRealTimers();
      await pool?.end();
      await database.close();
    }
  });
});
