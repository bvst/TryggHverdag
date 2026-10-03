/**
 * The SQLSTATE a failure carries, wherever on it the code sits (LOST-01,
 * PRIV-07).
 *
 * A heartbeat that cannot be stored is reported by its SQLSTATE and never its
 * message: PostgreSQL's message can hold the row it refused ("Failing row
 * contains (…)"), and Drizzle's names the query's parameters. Drizzle does not
 * put the code on the error it throws: its DrizzleQueryError carries
 * PostgreSQL's error as its `cause`. So the code is looked for on the error
 * and then down its cause chain, and the first one that is a SQLSTATE wins.
 *
 * Only a `code` is read, never a message or a `detail`. A code that is not a
 * SQLSTATE (a Node code such as ECONNREFUSED, a number, anything else) is
 * skipped, and the walk goes on.
 *
 * The walk is bounded. A cause is any value, and a chain that loops back on
 * itself, or a getter that makes a new cause on every read, is one a careless
 * wrapper can make. A walk with no end would hang the failing request, and
 * every request after it.
 *
 * One pattern, one function: the store's error, the module's log line and the
 * log adapter all read the code through this.
 */

/** PostgreSQL's error codes: exactly five of 0-9 and A-Z. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * How many links of a cause chain are read, the error itself included.
 * Drizzle wraps PostgreSQL's error once; the rest is room for a wrapper or
 * two more, and the bound that ends a loop.
 */
const MAX_LINKS = 8;

/** The first SQLSTATE on this error or down its causes, or null. Never throws for a value that is not an object. */
export function sqlstateOf(error: unknown): string | null {
  let current = error;
  for (let link = 0; link < MAX_LINKS; link += 1) {
    if (typeof current !== 'object' || current === null) {
      return null;
    }
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && SQLSTATE.test(code)) {
      return code;
    }
    current = cause;
  }
  return null;
}
