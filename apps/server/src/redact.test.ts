// What a server process may print when it fails: what went wrong and why,
// never the database password.
//
// Not hypothetical. `pg` and `graphile-worker` errors can carry the connection
// string, and the connection string carries the password (D-068). The cases
// below the first few are the ones privacy-security-reviewer got through the
// first version of this, on INF-07 — each ran against real input first.
import { describe, expect, test } from 'vitest';
import { describeFailure, redactCredentials } from './redact.ts';

/** Stands in for a database password. Short and plainly fake, so no scanner mistakes it. */
const SENTINEL = 'sentinel-pw-7';

describe('redactCredentials', () => {
  test('SEC-03: hides the password in a connection string', () => {
    const text = `connect failed: postgres://staging:${SENTINEL}@db.example.invalid:5432/app`;

    const redacted = redactCredentials(text);

    expect(redacted).not.toContain(SENTINEL);
    expect(redacted).toContain('postgres://staging:***@db.example.invalid:5432/app');
  });

  test('hides every connection string in the text, not only the first', () => {
    const text = `a postgres://u:${SENTINEL}@one/db b postgresql://v:${SENTINEL}@two/db`;

    expect(redactCredentials(text)).not.toContain(SENTINEL);
  });

  test('hides a password given as a keyword, the other way libpq accepts one', () => {
    const text = `host=db.example.invalid password=${SENTINEL} dbname=app`;

    const redacted = redactCredentials(text);

    expect(redacted).not.toContain(SENTINEL);
    expect(redacted).toContain('password=***');
  });

  test('leaves text with no credentials in it alone', () => {
    const text = 'connect ECONNREFUSED 127.0.0.1:5432 (postgres://db.example.invalid/app)';

    expect(redactCredentials(text)).toBe(text);
  });

  test.each([
    ['an @ inside the password', `postgres://u:pre@${SENTINEL}@db.example.invalid/app`],
    ['a scheme after an underscore', `url=x_postgres://u:${SENTINEL}@db/app`],
    ['a scheme after a digit', `1postgres://u:${SENTINEL}@db/app`],
    ["libpq's environment variable", `PGPASSWORD=${SENTINEL}`],
    ['the variable Clever Cloud sets', `POSTGRESQL_ADDON_PASSWORD=${SENTINEL}`],
    ['a prefixed variable', `DB_PASSWORD=${SENTINEL}`],
    ['a quoted value with a space', `password="${SENTINEL} x"`],
    ['a quoted value with an escaped quote', `password='it\\'s ${SENTINEL}'`],
    ['the colon form', `password: '${SENTINEL}'`],
    ['JSON', `{"password":"${SENTINEL}"}`],
  ])('SEC-03: hides a password in %s', (_what, text) => {
    expect(redactCredentials(text)).not.toContain(SENTINEL);
  });
});

describe('describeFailure', () => {
  test('names the kind of error and what it said', () => {
    expect(describeFailure(new TypeError('boom'))).toBe('TypeError: boom');
  });

  test('SEC-03: never repeats a password the error carried', () => {
    const error = new Error(`could not connect to postgres://u:${SENTINEL}@db/app`);

    expect(describeFailure(error)).not.toContain(SENTINEL);
  });

  test('describes something thrown that is not an Error at all', () => {
    expect(describeFailure(`postgres://u:${SENTINEL}@db/app`)).not.toContain(SENTINEL);
    expect(describeFailure(42)).toBe('42');
  });

  test('SEC-03: a thrown object is described without the password it holds', () => {
    // What inspect() prints for it is `{ config: { password: '…' } }` — the
    // colon form, which the first version of this let through.
    expect(describeFailure({ config: { password: SENTINEL } })).not.toContain(SENTINEL);
  });

  test('says what caused it, because a wrapping error alone does not say why', () => {
    // Found by running the migration against a database that was not there:
    // Drizzle reported "Failed query: CREATE SCHEMA …" and kept the reason —
    // the refused connection — in `cause`, where nobody reading the deploy log
    // would see it.
    const error = new Error('Failed query: CREATE SCHEMA', {
      cause: new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    });

    expect(describeFailure(error)).toBe(
      'Error: Failed query: CREATE SCHEMA ← Error: connect ECONNREFUSED 127.0.0.1:5432',
    );
  });

  test('SEC-03: keeps a password out of the cause, too', () => {
    const error = new Error('Failed query', {
      cause: new Error(`postgres://u:${SENTINEL}@db/app refused`),
    });

    expect(describeFailure(error)).not.toContain(SENTINEL);
  });

  test('stops following causes that loop back on themselves', () => {
    const first = new Error('first');
    const second = new Error('second', { cause: first });
    first.cause = second;

    expect(describeFailure(first)).toBe('Error: first ← Error: second');
  });

  test('is one line, whatever the error spans', () => {
    // Drizzle's message puts "params:" on a line of its own. A failure that
    // spans lines reads as several log entries, and a line that starts with
    // something plausible can be mistaken for one the process never wrote.
    const error = new Error('Failed query: CREATE SCHEMA "drizzle"\nparams: ');

    expect(describeFailure(error)).not.toContain('\n');
    expect(describeFailure(error)).toContain('Failed query: CREATE SCHEMA "drizzle" params:');
  });
});
