// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// Every L3 file closes its pool with this before stopping its container. A
// helper that swallowed every error would hide a real one; one that heard
// nothing would leave the run failing on an unhandled 57P01 with every test
// passed. Both halves are pinned here, against a pool that behaves as an
// EventEmitter does: an `error` event with no listener is thrown.
import { describe, expect, test } from 'vitest';
import { ADMIN_SHUTDOWN, endTestPool, type EndablePool } from './end-test-pool.ts';
import * as kit from './index.ts';

function fakePool() {
  const steps: string[] = [];
  const listeners: ((error: Error) => void)[] = [];
  const pool: EndablePool = {
    end() {
      steps.push('end');
      return Promise.resolve();
    },
    on(_event, listener) {
      steps.push('listen');
      listeners.push(listener);
    },
  };
  return {
    pool,
    steps,
    /** As EventEmitter emits `error`: thrown when nobody listens. */
    emit: (error: Error): void => {
      if (listeners.length === 0) {
        throw error;
      }
      for (const listener of listeners) {
        listener(error);
      }
    },
  };
}

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('endTestPool', () => {
  test('ADMIN_SHUTDOWN is the code PostgreSQL ends sessions with when it shuts down fast', () => {
    expect(ADMIN_SHUTDOWN).toBe('57P01');
  });

  test('listens for errors, then ends the pool, once', async () => {
    const { pool, steps } = fakePool();

    await endTestPool(pool);

    expect(steps).toEqual(['listen', 'end']);
  });

  test('the database terminating a closing session as it stops goes no further', async () => {
    const { pool, emit } = fakePool();
    await endTestPool(pool);

    expect(() => {
      emit(withCode('terminating connection due to administrator command', ADMIN_SHUTDOWN));
    }).not.toThrow();
  });

  test('any other error is thrown, as it would be with no listener', async () => {
    const { pool, emit } = fakePool();
    await endTestPool(pool);
    const other = withCode('the connection was reset', 'ECONNRESET');
    const plain = new Error('no code at all');

    expect(() => {
      emit(other);
    }).toThrow(other);
    expect(() => {
      emit(plain);
    }).toThrow(plain);
  });

  test('without it, the same shutdown error is thrown: the fake pool is as loud as a real one', () => {
    const { emit } = fakePool();

    expect(() => {
      emit(withCode('terminating connection due to administrator command', ADMIN_SHUTDOWN));
    }).toThrow(/administrator command/);
  });

  test('a pool that never started is nothing to end', async () => {
    await expect(endTestPool(undefined)).resolves.toBeUndefined();
  });

  test('the test kit hands it out', () => {
    expect(kit.endTestPool).toBe(endTestPool);
    expect(kit.ADMIN_SHUTDOWN).toBe(ADMIN_SHUTDOWN);
  });
});
