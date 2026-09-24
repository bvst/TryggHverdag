// L3: the sequence a staging deploy runs, against the PostgreSQL version
// staging actually has.
//
// Clever Cloud's free DEV plan runs PostgreSQL 15 (15.18 when this was
// written), while the other integration tests use 17. A migration that relied
// on something newer than 15 would pass there and fail on the first deploy, so
// this file pins the version staging runs. Change it when staging's changes.
//
// The order is the platform's: the pre-run hook migrates, then the API and the
// worker start. Nothing is faked — the migrations, Graphile Worker's own schema,
// the heartbeat task and the health check all run for real.
//
// Needs Docker, like every *.integration.test.ts: CI runs it, a cloud session
// cannot.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { addJobAdhoc } from 'graphile-worker';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startApiProcess } from './api-process.ts';
import { migrateDatabase } from './adapters/migrations.ts';
import { startWorker } from './worker.ts';

/** What Clever Cloud's DEV plan runs. See the note above before changing it. */
const STAGING_POSTGRES = 'postgres:15-alpine';

let container: StartedPostgreSqlContainer | undefined;

beforeAll(async () => {
  container = await new PostgreSqlContainer(STAGING_POSTGRES).start();
}, 180_000);

afterAll(async () => {
  await container?.stop();
});

function databaseUrl(): string {
  if (container === undefined) {
    throw new Error('The container did not start, so there is nothing to deploy against.');
  }
  return container.getConnectionUri();
}

async function health(port: number): Promise<{ status: string }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/v1/health`);
  expect(response.status).toBe(200);
  return (await response.json()) as { status: string };
}

describe('a staging deploy, in order', () => {
  test('the migrations apply to an empty database', async () => {
    await expect(migrateDatabase(databaseUrl())).resolves.toBeUndefined();
  });

  test('and apply again without harm, because every deploy runs them', async () => {
    await expect(migrateDatabase(databaseUrl())).resolves.toBeUndefined();
  });

  test('the API then answers, and says degraded until the worker has checked in', async () => {
    const api = await startApiProcess({ databaseUrl: databaseUrl(), port: 0 });

    try {
      expect((await health(api.port)).status).toBe('degraded');
    } finally {
      await api.stop();
    }
  });

  test('once the worker has beaten, the API reports the system ok', async () => {
    // The heartbeat is a cron task, and the next minute boundary can be a
    // minute away. Queuing the same task by hand runs the real task list
    // through the real runner now, which is what this test is about.
    const api = await startApiProcess({ databaseUrl: databaseUrl(), port: 0 });
    const worker = await startWorker(databaseUrl());

    try {
      await addJobAdhoc({ connectionString: databaseUrl() }, 'heartbeat', {});

      // Up to 30 seconds, counted in attempts rather than read off a clock.
      let status = (await health(api.port)).status;
      for (let attempt = 0; status !== 'ok' && attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        status = (await health(api.port)).status;
      }

      expect(status).toBe('ok');
    } finally {
      await worker.stop();
      await api.stop();
    }
  }, 60_000);
});

/** Waits, in attempts rather than by a clock, until `check` holds or the attempts run out. */
async function eventually(check: () => Promise<boolean>, attempts = 120): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return check();
}

describe('stopping the worker process', () => {
  test('D-068: on SIGTERM the real worker exits with 0 and leaves no connection behind', async () => {
    // The unit tests prove this against a fake runner. safety-reviewer ran the
    // real one and found Graphile Worker's own signal handler killing the
    // process first — so this runs bin/worker.ts itself, as the platform does.
    // Its connections are tagged so they can be counted apart from this test's.
    const tag = 'deploy-test-worker';
    const workerUrl = `${databaseUrl()}?application_name=${tag}`;
    const probe = new pg.Client({ connectionString: databaseUrl() });
    await probe.connect();
    const connections = async () =>
      Number(
        (
          await probe.query<{ n: string }>(
            'select count(*) as n from pg_stat_activity where application_name = $1',
            [tag],
          )
        ).rows[0]?.n,
      );

    const worker = spawn(
      process.execPath,
      ['--experimental-strip-types', path.join(import.meta.dirname, 'bin', 'worker.ts')],
      {
        // Only what is given: the child must not inherit the runner's environment.
        env: { PATH: process.env['PATH'] ?? '', DATABASE_URL: workerUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    worker.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    worker.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const exited = once(worker, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;

    try {
      expect(await eventually(async () => (await connections()) > 0)).toBe(true);

      worker.kill('SIGTERM');
      const [code, signal] = await exited;

      expect({ code, signal }).toEqual({ code: 0, signal: null });
      expect(output).not.toContain('worker failed');
      expect(await eventually(async () => (await connections()) === 0)).toBe(true);
    } finally {
      worker.kill('SIGKILL');
      await probe.end();
    }
  }, 90_000);
});
