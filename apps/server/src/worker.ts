/**
 * The worker (AR-01: the second of the two processes).
 *
 * It owns everything that happens because time passed rather than because
 * somebody made a request: the watchdog that notices a silent phone, the outbox
 * sender that delivers alerts, retention, and the canary. Those arrive with the
 * safety loop in M2.
 *
 * What it does today is check in, once a minute, so that the API can tell
 * whether it is running at all. That is the smallest useful thing a worker can
 * do, and it is the thing that makes "the system is healthy" mean something
 * more than "this web process answered".
 */
import { run, type Runner, type TaskList } from 'graphile-worker';
import { databaseClock } from './adapters/clock.ts';
import { POOL_SIZE, createDatabase, createPool } from './adapters/db.ts';
import { databaseWorkerHeartbeats } from './adapters/worker-heartbeats.ts';
import type { Clock, WorkerHeartbeats } from './ports.ts';

/** Once a minute. Graphile Worker's cron does not go finer than that. */
export const HEARTBEAT_CRONTAB = '* * * * * heartbeat';

export function createTaskList({
  clock,
  heartbeats,
}: {
  clock: Clock;
  heartbeats: WorkerHeartbeats;
}): TaskList {
  return {
    heartbeat: async () => {
      // The database clock, not this machine's (REL-01): the API compares this
      // stamp with its own reading of now, and they must be the same clock.
      await heartbeats.record(await clock.now());
    },
  };
}

/**
 * The runner, injected so that the wiring can be asserted rather than only
 * run. Everything below is in a safety path (AR-06), which means a test has to
 * be able to reach it — otherwise the mutation gate is quite right to say the
 * lines are unprotected.
 */
export type RunWorker = typeof run;

export interface Worker {
  runner: Runner;
  /**
   * Stops the runner, then ends the connection pool. Graphile Worker only ends
   * pools it created itself, and this one was handed to it — left open, every
   * restart would leak connections against a database that allows five
   * (D-068).
   */
  stop: () => Promise<void>;
  /**
   * Settles when the runner does: quietly after `stop()`, and as a failure if
   * it ended any other way. A worker process that exits with 0 is one the
   * platform does not restart, and a worker that is not running is a watchdog
   * that is not watching.
   */
  untilStopped: () => Promise<void>;
}

export async function startWorker(
  connectionString: string,
  runWorker: RunWorker = run,
): Promise<Worker> {
  const pool = createPool(connectionString, POOL_SIZE.worker);
  const db = createDatabase(pool);

  let runner: Runner;
  try {
    runner = await runWorker({
      pgPool: pool,
      concurrency: 2,
      crontab: HEARTBEAT_CRONTAB,
      taskList: createTaskList({
        clock: databaseClock(db),
        heartbeats: databaseWorkerHeartbeats(db),
      }),
    });
  } catch (error) {
    await pool.end();
    throw error;
  }

  let stopRequested = false;
  return {
    runner,
    async stop() {
      stopRequested = true;
      await runner.stop();
      await pool.end();
    },
    async untilStopped() {
      await runner.promise;
      if (!stopRequested) {
        throw new Error('The worker stopped without being asked to, so nothing is watching.');
      }
    },
  };
}
