// How a server process ends: on the platform's signal, cleanly, and on any
// failure, loudly — without printing the database password on the way out.
//
// The last part is not hypothetical. `pg` and `graphile-worker` errors can carry
// the connection string, and the connection string carries the password
// (D-068). A process that crashes by printing its error object puts that
// password in the platform's logs.
import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'vitest';
import { describeFailure, exitOnSignal, redactCredentials, runMain } from './process.ts';

/** Stands in for a database password. Short and plainly fake, so no scanner mistakes it. */
const SENTINEL = 'sentinel-pw-7';

/** Everything a process reports and how it ends, as a test can see it. */
function recorder() {
  const written: string[] = [];
  const exits: number[] = [];
  return {
    written,
    exits,
    write: (text: string) => {
      written.push(text);
    },
    exit: (code: number) => {
      exits.push(code);
    },
  };
}

/** Lets pending promise callbacks run, so a test can look at what they did. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

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
});

describe('runMain', () => {
  test('a start that succeeds ends nothing — the process keeps running', async () => {
    const out = recorder();

    runMain('API', () => Promise.resolve(), out);
    await settle();

    expect(out.exits).toEqual([]);
    expect(out.written).toEqual([]);
  });

  test('a start that fails exits with 1, so the platform sees it and restarts it', async () => {
    const out = recorder();

    runMain('worker', () => Promise.reject(new Error('no database')), out);
    await settle();

    expect(out.exits).toEqual([1]);
    expect(out.written.join('')).toContain('worker failed: Error: no database');
  });

  test('SEC-03: the failure it reports does not carry the password', async () => {
    const out = recorder();

    runMain('migration', () => Promise.reject(new Error(`postgres://u:${SENTINEL}@db/app`)), out);
    await settle();

    expect(out.written.join('')).not.toContain(SENTINEL);
  });
});

describe('exitOnSignal', () => {
  test.each(['SIGTERM', 'SIGINT'])('on %s it stops, then exits with 0', async (signal) => {
    const signals = new EventEmitter();
    const out = recorder();
    let stops = 0;

    exitOnSignal({
      name: 'API',
      signals,
      stop: () => {
        stops += 1;
        return Promise.resolve();
      },
      ...out,
    });
    signals.emit(signal);
    await settle();

    expect(stops).toBe(1);
    expect(out.exits).toEqual([0]);
  });

  test('does not exit before stopping has finished', async () => {
    // Exiting first would cut off the connections mid-query — the thing a
    // graceful stop exists to avoid.
    const signals = new EventEmitter();
    const out = recorder();
    let finish: () => void = () => undefined;

    exitOnSignal({
      name: 'worker',
      signals,
      stop: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      ...out,
    });
    signals.emit('SIGTERM');
    await settle();
    expect(out.exits).toEqual([]);

    finish();
    await settle();
    expect(out.exits).toEqual([0]);
  });

  test('a second signal while stopping does not stop twice', async () => {
    // Ending a connection pool twice throws, and the platform often sends
    // SIGTERM and then SIGINT.
    const signals = new EventEmitter();
    const out = recorder();
    let stops = 0;

    exitOnSignal({
      name: 'API',
      signals,
      stop: () => {
        stops += 1;
        return Promise.resolve();
      },
      ...out,
    });
    signals.emit('SIGTERM');
    signals.emit('SIGINT');
    await settle();

    expect(stops).toBe(1);
    expect(out.exits).toEqual([0]);
  });

  test('a stop that fails exits with 1 and says what failed, without the password', async () => {
    const signals = new EventEmitter();
    const out = recorder();

    exitOnSignal({
      name: 'worker',
      signals,
      stop: () => Promise.reject(new Error(`postgres://u:${SENTINEL}@db/app went away`)),
      ...out,
    });
    signals.emit('SIGTERM');
    await settle();

    expect(out.exits).toEqual([1]);
    expect(out.written.join('')).toContain('worker');
    expect(out.written.join('')).not.toContain(SENTINEL);
  });
});
