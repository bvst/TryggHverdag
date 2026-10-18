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
import { fakeLog } from '@trygghverdag/test-kit';
import { sql } from 'drizzle-orm';
import { setTimeout as realDelay } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import { describe, expect, test, vi } from 'vitest';
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

  test('LOST-02-AC17: createPool refuses an idleInTransactionMs or lockTimeoutMs that is not a whole number from 1 to 2147483647 (0, -1, 0.5, 1.5, NaN, 2147483648), naming the option, and takes 1 and 2147483647', async () => {
    const made: ReturnType<typeof createPool>[] = [];
    const limit = (option: 'idleInTransactionMs' | 'lockTimeoutMs', value: number) =>
      option === 'idleInTransactionMs' ? { idleInTransactionMs: value } : { lockTimeoutMs: value };
    try {
      for (const option of ['idleInTransactionMs', 'lockTimeoutMs'] as const) {
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
