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
import { describe, expect, test } from 'vitest';
import { DEV_PLAN_CONNECTION_LIMIT, POOL_SIZE, createPool } from './db.ts';

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
