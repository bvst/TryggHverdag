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
import process from 'node:process';
import { databaseClock } from './adapters/clock.ts';
import { POOL_SIZE, createDatabase, createPool } from './adapters/db.ts';
import { healthchecksCheckIn } from './adapters/healthchecks.ts';
import { databaseWorkerHeartbeats } from './adapters/worker-heartbeats.ts';
import { readHealthchecksSetting, type HealthchecksSetting } from './config.ts';
import type { CheckIn, Clock, WorkerHeartbeats } from './ports.ts';
import { exitOnSignal, type Reporting, type Signals } from './process.ts';
import { describeFailure } from './redact.ts';

/** Once a minute. Graphile Worker's cron does not go finer than that. */
export const HEARTBEAT_CRONTAB = '* * * * * heartbeat';

/** Where the platform keeps what the worker says: Clever Cloud's log. */
function writeToStderr(text: string): void {
  process.stderr.write(text);
}

export function createTaskList({
  clock,
  heartbeats,
  checkIn,
  write = writeToStderr,
}: {
  clock: Clock;
  heartbeats: WorkerHeartbeats;
  checkIn?: CheckIn | undefined;
  write?: ((text: string) => void) | undefined;
}): TaskList {
  return {
    heartbeat: async () => {
      // The database clock, not this machine's (REL-01): the API compares this
      // stamp with its own reading of now, and they must be the same clock.
      await heartbeats.record(await clock.now());
      // Only after the beat is recorded (INF-08): a ping without a beat would
      // tell Healthchecks.io that a worker recording nothing is alive.
      if (checkIn !== undefined) {
        try {
          await checkIn.checkIn();
        } catch (error: unknown) {
          // Said, not thrown: a failed task is retried, and would stamp the
          // beat again. The loud channel is Healthchecks.io's own alert for
          // the missing ping.
          write(`worker: Healthchecks.io check-in failed: ${describeFailure(error)}\n`);
        }
      }
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
  { checkIn, write }: { checkIn?: CheckIn | undefined; write?: (text: string) => void } = {},
): Promise<Worker> {
  const pool = createPool(connectionString, POOL_SIZE.worker);
  const db = createDatabase(pool);

  let runner: Runner;
  try {
    runner = await runWorker({
      pgPool: pool,
      // Graphile would otherwise install its own SIGTERM handler, finish its
      // jobs and kill the process with the same signal — before our stop has
      // ended the pool or chosen the exit code. runWorkerProcess owns the
      // signals instead.
      noHandleSignals: true,
      concurrency: 2,
      crontab: HEARTBEAT_CRONTAB,
      taskList: createTaskList({
        clock: databaseClock(db),
        heartbeats: databaseWorkerHeartbeats(db),
        checkIn,
        write,
      }),
    });
  } catch (error) {
    await pool.end();
    throw error;
  }

  let stopRequested = false;
  return {
    async stop() {
      stopRequested = true;
      await runner.stop();
      await pool.end();
    },
    async untilStopped() {
      // With Graphile Worker 0.18 this promise never rejects: a runner that
      // loses its database resolves it, and says why only in its own log
      // ("Runner stopping (reason: …)"). So a crash lands in the branch below,
      // as "stopped without being asked" — loud, if not specific.
      await runner.promise;
      if (!stopRequested) {
        throw new Error('The worker stopped without being asked to, so nothing is watching.');
      }
    },
  };
}

/**
 * Clever Cloud's INSTANCE_TYPE on the machine that builds a deploy. The one
 * that runs the app says "production" (Clever Cloud's environment variable
 * reference).
 */
export const BUILD_INSTANCE = 'build';

/** Keeps Node running with nothing to do: a signal listener alone does not. */
function keepProcessAlive(): void {
  setInterval(() => undefined, 60_000);
}

/**
 * The worker process: start the runner, stop it cleanly on the platform's
 * signal, and fail if it ends any other way. Here rather than in bin/worker.ts
 * so that the part deciding whether a dead worker is restarted is tested
 * in-process, under the mutation gate.
 *
 * Except on the build machine (BUG-3). Clever Cloud starts CC_WORKER_COMMAND
 * there too, where it would run the new code against the database before the
 * migration has, beside the old app's worker, and past the connection budget.
 * So there it starts nothing and waits to be stopped. It does not exit:
 * CC_WORKER_RESTART is "always", and an exit would be restarted every few
 * seconds for as long as the build lasts.
 *
 * It checks in with Healthchecks.io after each recorded beat when
 * HEALTHCHECKS_WORKER_URL allows it (INF-08), and says at start whether it
 * does and, if not, why. Never where: the ping URL is a secret. Left out, the
 * setting counts as unset.
 */
export async function runWorkerProcess(
  connectionString: string,
  {
    runWorker = run,
    signals = process,
    instanceType,
    keepAlive = keepProcessAlive,
    healthchecks = readHealthchecksSetting({}),
    createCheckIn = (url) => healthchecksCheckIn({ url }),
    ...reporting
  }: {
    runWorker?: RunWorker;
    signals?: Signals;
    instanceType?: string | undefined;
    keepAlive?: () => void;
    healthchecks?: HealthchecksSetting;
    createCheckIn?: (url: string) => CheckIn;
  } & Reporting = {},
): Promise<void> {
  const write = reporting.write ?? writeToStderr;
  if (instanceType === BUILD_INSTANCE) {
    write(
      `worker: not started on Clever Cloud's build machine (INSTANCE_TYPE=${BUILD_INSTANCE}); ` +
        'the machine that runs the app starts its own.\n',
    );
    keepAlive();
    exitOnSignal({ name: 'worker', signals, stop: () => Promise.resolve(), ...reporting });
    return;
  }
  let checkIn: CheckIn | undefined;
  if (healthchecks.checkingIn) {
    write('worker: checking in with Healthchecks.io after every recorded beat.\n');
    checkIn = createCheckIn(healthchecks.url);
  } else {
    write(`worker: not checking in with Healthchecks.io: ${healthchecks.reason}\n`);
  }
  const worker = await startWorker(connectionString, runWorker, { checkIn, write });
  exitOnSignal({ name: 'worker', signals, stop: worker.stop, ...reporting });
  await worker.untilStopped();
}
