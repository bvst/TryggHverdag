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
import { fakeLog } from '@trygghverdag/test-kit';
import { setTimeout as realDelay } from 'node:timers/promises';
import { describe, expect, test, vi } from 'vitest';
import { IDLE_IN_TRANSACTION_LIMIT_MS, LOCK_WAIT_LIMIT_MS } from '../domain/watchdog.ts';
import {
  HANG_CEILING_MS,
  STILL_WAITING,
  listeningFakePostgres,
  listeningSilentPostgres,
  settledWithin,
} from '../fake-postgres-server.test.ts';
import {
  CONNECT_TIMEOUT_MS,
  DEV_PLAN_CONNECTION_LIMIT,
  POOL_SIZE,
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
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const pool = createPool(database.url, 1, options);
      try {
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
        await pool.end();
      }
    },
  );

  test('BUG-34: guard: with the timeout in force, a pool against a database that answers connects and answers, and a query answered later than CONNECT_TIMEOUT_MS is not cut short', async () => {
    // Passes today and after: the timeout bounds the connection's start, not
    // a query. A query_timeout or statement-wide limit in its place would
    // fail the held query below.
    const database = await listeningFakePostgres(() => ({ columns: ['answer'], rows: [['42']] }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pool = createPool(database.url, 1, {
      name: 'worker',
      log: fakeLog(),
      idleInTransactionMs: IDLE_IN_TRANSACTION_LIMIT_MS,
    });
    try {
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
      await pool.end();
      await database.close();
    }
  });
});
