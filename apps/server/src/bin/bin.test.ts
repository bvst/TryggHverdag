// The three entry files, run the way Clever Cloud runs them: as plain `node`
// processes, with nothing but environment variables to go on.
//
// Everything else in this package is tested through Vitest, which compiles
// TypeScript itself. Production does not: Node strips the types and runs the
// files directly. A construct Node cannot strip, an import that only resolves
// inside Vitest, a server that binds to localhost — each would pass every other
// test and fail on the first deploy. This is the one place that runs the real
// thing.
import {
  SYNTHETIC_CHECK_UUID as CHECK,
  SYNTHETIC_PING_URL as PING_URL,
} from '@trygghverdag/test-kit';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, onTestFinished, test } from 'vitest';

/** Stands in for a database password. Short and plainly fake, so no scanner mistakes it. */
const SENTINEL = 'sentinel-pw-7';

/** Nothing listens on port 1, so a connection is refused at once, with no network involved. */
const UNREACHABLE = `postgres://staging:${SENTINEL}@127.0.0.1:1/app`;

/** The node flags Clever Cloud's run commands use (infra/staging). */
const NODE_ARGS = ['--experimental-strip-types'];

function start(file: string, env: Record<string, string>) {
  // Only what is given: the test must not inherit a DATABASE_URL from the machine.
  // The one exception is Stryker's: it chooses which planted bug is live through
  // this variable, and a child that never saw it would run the unmutated code —
  // so every mutant these tests exist to catch would survive unexamined.
  const mutant = process.env['__STRYKER_ACTIVE_MUTANT__'];
  const child = spawn(process.execPath, [...NODE_ARGS, path.join(import.meta.dirname, file)], {
    env: {
      PATH: process.env['PATH'] ?? '',
      ...(mutant === undefined ? {} : { __STRYKER_ACTIVE_MUTANT__: mutant }),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
  // BUG-5: whatever the verdict, no child outlives its test. A test waits for
  // its child to end, or stops it, and asserts on how it ended; this acts only
  // after the verdict, on a child still running — because the test failed or
  // timed out before the child ended, or the child ignored SIGTERM.
  onTestFinished(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  });
  return { child, exited, output: () => output };
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  server.close();
  await once(server, 'close');
  if (address === null || typeof address === 'string') {
    throw new Error('The operating system did not hand out a port.');
  }
  return address.port;
}

/**
 * Retries until the process answers, because it takes a moment to start: up to
 * 15 seconds, counted in attempts rather than read off a clock.
 */
async function firstResponse(url: string, attempts = 150): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url);
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/**
 * Waits until a child has written `text`, or has ended, because it takes a
 * moment to start: up to 15 seconds, counted in attempts rather than read off
 * a clock. Ended means an exit code or a signal: a child killed by a signal
 * has no exit code, and would otherwise be waited on for the full 15 s.
 * Asserts nothing itself; the test's own assertions say what went wrong if the
 * text never came.
 */
async function waitForOutput(
  started: ReturnType<typeof start>,
  text: string,
  attempts = 150,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { exitCode, signalCode } = started.child;
    if (started.output().includes(text) || exitCode !== null || signalCode !== null) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('bin/api.ts', () => {
  test('starts under plain node, answers on PORT, and exits with 0 on SIGTERM', async () => {
    const port = await freePort();
    const api = start('api.ts', { PORT: String(port), DATABASE_URL: UNREACHABLE });

    try {
      const response = await firstResponse(`http://127.0.0.1:${String(port)}/v1/health`);
      // The database is unreachable, so the health check cannot answer — but the
      // process did, which is what this test is about.
      expect(response.status).toBe(500);
    } finally {
      api.child.kill('SIGTERM');
    }

    const [code, signal] = await api.exited;
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(api.output()).not.toContain(SENTINEL);
  });

  test('refuses to start without a database, and says which setting is missing', async () => {
    const api = start('api.ts', { PORT: String(await freePort()) });

    const [code] = await api.exited;

    expect(code).toBe(1);
    expect(api.output()).toContain('API failed:');
    expect(api.output()).toContain('DATABASE_URL');
  });
});

describe('bin/worker.ts', () => {
  test('a worker that cannot reach its database exits with 1 and says why', async () => {
    // That the password stays out of what it says is proven in redact.test.ts:
    // the errors this produces never contain the connection string, so a
    // redaction check here could not fail. test-auditor pointed that out.
    const worker = start('worker.ts', { DATABASE_URL: UNREACHABLE });

    const [code] = await worker.exited;

    expect(code).toBe(1);
    // The whole phrase, not just "worker": Node's own "Cannot find module
    // …/worker.ts" contains that word too, and passed this test before the file
    // existed.
    expect(worker.output()).toContain('worker failed:');
    // And the reason, which proves it got as far as the database: without it,
    // a worker started with no DATABASE_URL at all passed this test too.
    expect(worker.output()).toContain('ECONNREFUSED');
    expect(worker.output()).not.toContain(SENTINEL);
  });

  test("BUG-3: on Clever Cloud's build machine it never reaches for the database, and waits to be stopped", async () => {
    // "Never" is proven in-process, in worker.test.ts ("BUG-3: it never starts
    // a runner there"). This runs the entry file under plain node and proves
    // less: it says why it started nothing, makes no attempt on the
    // unreachable database in the 1.5 s after saying so — a worker that tried
    // would fail with ECONNREFUSED within milliseconds — and exits with 0 on
    // SIGTERM.
    //
    // The 1.5 s is counted from that line, not from the spawn. Counted from
    // the spawn, a machine busy enough — Stryker's, running every test per
    // mutant — had not yet printed the line when the test looked, and failed
    // here for no fault of the worker's. That counted as a killed mutant.
    const worker = start('worker.ts', { DATABASE_URL: UNREACHABLE, INSTANCE_TYPE: 'build' });

    try {
      await waitForOutput(worker, 'INSTANCE_TYPE=build');
      // BUG-5: output can arrive after the exit, so a worker that crashed at
      // start may show nothing yet, and read like one that was slow to start.
      // The message says which it was.
      const ended = worker.child.exitCode ?? worker.child.signalCode;
      expect(
        worker.output(),
        ended === null ? 'the worker is still running' : `the worker exited with ${String(ended)}`,
      ).toContain('INSTANCE_TYPE=build');

      // Cut short by an exit, so a worker that does reach for the database
      // fails here at once rather than 1.5 s later.
      await Promise.race([worker.exited, new Promise((resolve) => setTimeout(resolve, 1500))]);
      expect(worker.child.exitCode, worker.output()).toBeNull();
      expect(worker.output()).not.toContain('ECONNREFUSED');
    } finally {
      // BUG-5: stopped even when an assertion fails, the way the API test
      // stops the API. On the build machine the worker never ends by itself,
      // so one left behind by a failed run stayed up for good.
      worker.child.kill('SIGTERM');
    }

    const [code, signal] = await worker.exited;
    expect({ code, signal }).toEqual({ code: 0, signal: null });
  });
});

describe('bin/migrate.ts', () => {
  test('a migration that cannot reach the database fails the deploy, and says why', async () => {
    // It runs as Clever Cloud's pre-run hook, and a non-zero exit there stops
    // the deploy — which is the point: new code must not start against an old
    // schema.
    const migration = start('migrate.ts', { DATABASE_URL: UNREACHABLE });

    const [code] = await migration.exited;

    expect(code).toBe(1);
    expect(migration.output()).toContain('migration failed:');
    // Drizzle reads the migration files before it connects, so reaching the
    // database also proves the files were found under plain node — the kind
    // of path that resolves inside Vitest and nowhere else.
    expect(migration.output()).toContain('ECONNREFUSED');
    expect(migration.output()).not.toContain(SENTINEL);
  });
});

describe('REL-08: bin/worker.ts and HEALTHCHECKS_WORKER_URL', () => {
  // INF-08. The real process, to prove the entry file hands the setting to the
  // worker at all: everything past that is tested in-process in worker.test.ts.
  // The database is unreachable, so each run ends in milliseconds — and ends
  // for that reason, not because of the setting. CHECK, the ping URL's UUID,
  // is all zeros, so it names no real check.

  test('INF-08-AC6: with it unset, the worker says it is not checking in and why, and fails only for want of its database', async () => {
    const worker = start('worker.ts', { DATABASE_URL: UNREACHABLE });

    const [code] = await worker.exited;

    expect(code).toBe(1);
    expect(worker.output()).toMatch(
      /^worker: not checking in with Healthchecks\.io\b.*HEALTHCHECKS_WORKER_URL/m,
    );
    expect(worker.output()).toContain('ECONNREFUSED');
  });

  test('INF-08-AC5: with a usable address, it says it is checking in, and never where', async () => {
    // https, so the worker accepts it. Port 1 on the loopback address, which
    // fetch refuses to connect to, so nothing could leave this machine
    // whatever the worker did with it.
    const worker = start('worker.ts', {
      DATABASE_URL: UNREACHABLE,
      HEALTHCHECKS_WORKER_URL: PING_URL,
    });

    const [code] = await worker.exited;

    expect(code).toBe(1);
    expect(worker.output()).toMatch(/^worker: checking in with Healthchecks\.io\b/m);
    expect(worker.output()).not.toContain(CHECK);
    expect(worker.output()).toContain('ECONNREFUSED');
  });
});
