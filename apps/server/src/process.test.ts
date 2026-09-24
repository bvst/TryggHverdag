// How a server process ends: on the platform's signal, cleanly, and on any
// failure, loudly — without printing the database password on the way out.
// What it prints is redact.ts's, tested in redact.test.ts; these tests hold
// that the process uses it, and how it exits.
import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'vitest';
import { exitOnSignal, runMain } from './process.ts';

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
    expect(out.written.join('')).toContain('worker failed while stopping:');
    expect(out.written.join('')).not.toContain(SENTINEL);
  });
});
