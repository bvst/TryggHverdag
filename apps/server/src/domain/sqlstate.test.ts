// L2: the SQLSTATE a failure carries, wherever on it the code sits
// (LOST-01-AC13; PRIV-07).
//
// A heartbeat that cannot be stored is logged as one `heartbeat_failed` line
// with the failure's SQLSTATE, and never its message: PostgreSQL's message can
// hold the row it refused, and Drizzle's names the query's parameters. Drizzle
// does not put the code on the error it throws. Its DrizzleQueryError carries
// PostgreSQL's error as its `cause`, so a code read from the error itself is
// null exactly when the database had something to say. `sqlstateOf` walks the
// cause chain for the first code that is a SQLSTATE, five of 0-9 and A-Z, and
// reads nothing else: not a message, not a detail.
//
// The walk must end on any input. An error's cause is any value, and a chain
// that loops back on itself is one a careless wrapper can make. A walk that
// never ends would hang the request that was failing, and with it every
// request after it. The looping chains below are built from getters that
// count how often they are read, and stop answering after far more reads than
// any finite walk needs, so a walk with no end fails here instead of hanging
// the test run.
import { fc } from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import { sqlstateOf } from './sqlstate.ts';

/** An error with this code, as node-postgres's DatabaseError carries one. */
function withCode(code: unknown, message = 'a database error'): Error {
  return Object.assign(new Error(message), { code });
}

/** An error wrapping another, as Drizzle's DrizzleQueryError wraps PostgreSQL's. */
function wrapping(cause: unknown, message = 'Failed query: insert into "positions" …'): Error {
  return Object.assign(new Error(message, { cause }), {
    query: 'insert into "positions" ("heartbeat_id", "latitude") values ($1, $2)',
    params: ['1', '0.1234567'],
  });
}

/**
 * Two errors whose causes point at each other, read through getters that
 * count each read. After `limit` reads a getter answers undefined, which ends
 * any walk: a walk that never ends shows as a read count at the limit.
 */
function loopingPair(limit: number): { first: Error; reads: () => number } {
  let reads = 0;
  const first = new Error('the first of a looping pair');
  const second = new Error('the second of a looping pair');
  const causing = (target: object, next: Error) => {
    Object.defineProperty(target, 'cause', {
      configurable: true,
      enumerable: false,
      get() {
        reads += 1;
        return reads > limit ? undefined : next;
      },
    });
  };
  causing(first, second);
  causing(second, first);
  return { first, reads: () => reads };
}

/** The same, for one error that is its own cause. */
function ownCause(limit: number): { error: Error; reads: () => number } {
  let reads = 0;
  const error = new Error('an error that is its own cause');
  Object.defineProperty(error, 'cause', {
    configurable: true,
    enumerable: false,
    get() {
      reads += 1;
      return reads > limit ? undefined : error;
    },
  });
  return { error, reads: () => reads };
}

/** Far more reads than a walk that ends needs, and few enough to fail fast. */
const READ_LIMIT = 1_000;

describe('LOST-01-AC13: sqlstateOf finds the SQLSTATE on a failure or on its causes, and nothing else', () => {
  test('LOST-01-AC13: a SQLSTATE on the error itself is returned', () => {
    expect(sqlstateOf(withCode('23514'))).toBe('23514');
    expect(sqlstateOf(withCode('57P01'))).toBe('57P01');
  });

  test('LOST-01-AC13: a SQLSTATE one cause down is returned, as Drizzle’s DrizzleQueryError carries PostgreSQL’s error', () => {
    const failure = wrapping(withCode('23514', 'new row violates check constraint'));

    expect((failure as { code?: unknown }).code).toBeUndefined();
    expect(sqlstateOf(failure)).toBe('23514');
  });

  test('LOST-01-AC13: a SQLSTATE two causes down is returned', () => {
    expect(sqlstateOf(new Error('the store failed', { cause: wrapping(withCode('40001')) }))).toBe(
      '40001',
    );
  });

  test('LOST-01-AC13: the first SQLSTATE on the way down is the one returned', () => {
    expect(sqlstateOf(Object.assign(wrapping(withCode('23505')), { code: '57P01' }))).toBe('57P01');
  });

  test.each([
    { what: 'a Node error code', code: 'ECONNREFUSED' },
    { what: 'four characters', code: '2350' },
    { what: 'six characters', code: '235140' },
    { what: 'lower case', code: '57p01' },
    { what: 'a space in it', code: '2351 ' },
    { what: 'empty text', code: '' },
    { what: 'a number that prints as one', code: 23505 },
    { what: 'a list that prints as one', code: ['23505'] },
  ])(
    'LOST-01-AC13: a code that is not a SQLSTATE is skipped, and the walk goes on to the cause — $what',
    ({ code }) => {
      const failure = Object.assign(wrapping(withCode('57P01')), { code });

      expect(sqlstateOf(failure)).toBe('57P01');
      expect(sqlstateOf(withCode(code))).toBeNull();
    },
  );

  test('LOST-01-AC13: a SQLSTATE in a message, or in a detail, is never read: only a code is', () => {
    const failure = Object.assign(new Error('error 23505: duplicate key'), {
      detail: 'SQLSTATE 23514',
      hint: '40001',
    });

    expect(sqlstateOf(failure)).toBeNull();
    expect(sqlstateOf(wrapping(failure))).toBeNull();
  });

  test('LOST-01-AC13: an error with no code anywhere on its chain gives null', () => {
    expect(sqlstateOf(new Error('the clock did not answer'))).toBeNull();
    expect(sqlstateOf(wrapping(new Error('connection terminated unexpectedly')))).toBeNull();
  });

  test.each([
    { what: 'null', value: null },
    { what: 'undefined', value: undefined },
    { what: 'text', value: 'the store failed' },
    { what: 'text that is a SQLSTATE', value: '23505' },
    { what: 'a number', value: 23505 },
    { what: 'true', value: true },
  ])('LOST-01-AC13: $what, which is not an object, gives null and does not throw', ({ value }) => {
    expect(sqlstateOf(value)).toBeNull();
  });

  test('LOST-01-AC13: a cause chain that loops back on itself ends, and gives null', () => {
    const pair = loopingPair(READ_LIMIT);
    const own = ownCause(READ_LIMIT);

    expect(sqlstateOf(pair.first)).toBeNull();
    expect(sqlstateOf(own.error)).toBeNull();

    // A walk that ends reads each cause a bounded number of times; one that
    // does not reads until the getters stop answering.
    expect(pair.reads(), 'causes read on the looping pair').toBeLessThan(READ_LIMIT);
    expect(own.reads(), 'causes read on the error that is its own cause').toBeLessThan(READ_LIMIT);
  });

  test('LOST-01-AC13: a SQLSTATE on a looping chain is still found', () => {
    const pair = loopingPair(READ_LIMIT);
    Object.assign(pair.first, { code: 'XX000' });

    expect(sqlstateOf(pair.first)).toBe('XX000');
    expect(pair.reads()).toBeLessThan(READ_LIMIT);
  });

  test('LOST-01-AC13: for any code, sqlstateOf returns it exactly when it is five of 0-9 and A-Z', () => {
    const sqlstate = fc.stringMatching(/^[0-9A-Z]{5}$/);
    fc.assert(
      fc.property(fc.oneof(sqlstate, fc.string(), fc.anything()), (code) => {
        const isSqlstate = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code);

        expect(sqlstateOf(withCode(code))).toBe(isSqlstate ? code : null);
        expect(sqlstateOf(wrapping(withCode(code)))).toBe(isSqlstate ? code : null);
      }),
    );
  });
});
