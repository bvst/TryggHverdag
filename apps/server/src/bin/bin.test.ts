// The three entry files, run the way Clever Cloud runs them: as plain `node`
// processes, with nothing but environment variables to go on.
//
// Everything else in this package is tested through Vitest, which compiles
// TypeScript itself. Production does not: Node strips the types and runs the
// files directly. A construct Node cannot strip, an import that only resolves
// inside Vitest, a server that binds to localhost — each would pass every other
// test and fail on the first deploy. This is the one place that runs the real
// thing.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, test } from 'vitest';

/** Stands in for a database password. Short and plainly fake, so no scanner mistakes it. */
const SENTINEL = 'sentinel-pw-7';

/** Nothing listens on port 1, so a connection is refused at once, with no network involved. */
const UNREACHABLE = `postgres://staging:${SENTINEL}@127.0.0.1:1/app`;

/** The node flags Clever Cloud's run commands use (infra/staging). */
const NODE_ARGS = ['--experimental-strip-types'];

function start(file: string, env: Record<string, string>) {
  // Only what is given: the test must not inherit a DATABASE_URL from the machine.
  const child = spawn(process.execPath, [...NODE_ARGS, path.join(import.meta.dirname, file)], {
    env: { PATH: process.env['PATH'] ?? '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
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
  test('SEC-03: a worker that cannot reach its database exits with 1 and does not print the password', async () => {
    const worker = start('worker.ts', { DATABASE_URL: UNREACHABLE });

    const [code] = await worker.exited;

    expect(code).toBe(1);
    // The whole phrase, not just "worker": Node's own "Cannot find module
    // …/worker.ts" contains that word too, and passed this test before the file
    // existed.
    expect(worker.output()).toContain('worker failed:');
    expect(worker.output()).not.toContain(SENTINEL);
  });
});

describe('bin/migrate.ts', () => {
  test('SEC-03: a migration that cannot reach the database fails the deploy, without the password', async () => {
    // It runs as Clever Cloud's pre-run hook, and a non-zero exit there stops
    // the deploy — which is the point: new code must not start against an old
    // schema.
    const migration = start('migrate.ts', { DATABASE_URL: UNREACHABLE });

    const [code] = await migration.exited;

    expect(code).toBe(1);
    expect(migration.output()).toContain('migration failed:');
    expect(migration.output()).not.toContain(SENTINEL);
  });
});
