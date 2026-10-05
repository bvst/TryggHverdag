/**
 * Closing an L3 test's connection pool before its container stops.
 *
 * pg-pool's `end()` resolves once it has asked each idle client to close, not
 * once their sockets have closed: it calls `client.end()` without waiting for
 * it. Stopping the PostgreSQL container straight after shuts the database
 * down fast (the image's stop signal), which terminates every session still
 * open with 57P01, "terminating connection due to administrator command". A
 * client still closing hears that as an error, and the pool re-emits it as
 * its own `error` event. A pool with no `error` listener makes Node throw it,
 * and Vitest then fails the run as an unhandled error, with every test
 * passed.
 *
 * So a test pool gets a listener that expects exactly that and nothing else:
 * 57P01 goes no further, and any other error is thrown, as loud as it was
 * with no listener at all. It is attached in the teardown, after every test
 * has run, so it hides nothing from a test.
 *
 * Tests only. A pool made by `createPool` without a name and a log, as most
 * tests' pools are, has no `error` listener. The process pools are made with
 * both (LOST-02, approach item 8): there, a connection's error is one
 * `database_error` line, and this listener only joins it at teardown.
 */

/** The part of a `pg.Pool` this needs, by shape: the test kit does not depend on pg. */
export interface EndablePool {
  end(): Promise<void>;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/** PostgreSQL's `admin_shutdown`: the session was ended because the server is going down. */
export const ADMIN_SHUTDOWN = '57P01';

function codeOf(error: Error): unknown {
  return (error as Error & { code?: unknown }).code;
}

/**
 * Ends the pool, ready for its container to stop. Accepts the `undefined` a
 * test's pool is when its container never started, so a teardown can call
 * it either way.
 */
export async function endTestPool(pool: EndablePool | undefined): Promise<void> {
  if (pool === undefined) {
    return;
  }
  pool.on('error', (error) => {
    if (codeOf(error) !== ADMIN_SHUTDOWN) {
      throw error;
    }
  });
  await pool.end();
}
