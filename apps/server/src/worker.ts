/**
 * The worker (AR-01: the second of the two processes).
 *
 * It owns everything that happens because time passed rather than because
 * somebody made a request: the watchdog that notices a silent phone, the outbox
 * sender that delivers alerts, and later retention and the canary.
 *
 * Two loops (LOST-02), each running again WATCHDOG_INTERVAL_MS after its
 * previous run finished, so a run never overlaps itself, and both running
 * once at start:
 *   - the sweep loop runs the watchdog, which moves every journey silent for
 *     five minutes to LOST_CONTACT with its alert and messages, and records
 *     the worker's beat when it succeeds (D-108);
 *   - the delivery loop runs the sender, which hands those messages to the
 *     push port. A sweep that opened an alert wakes it at once, so the first
 *     push does not wait for the interval.
 * Two loops, not one, so a push provider that never answers stalls delivery
 * only, and no sweep waits behind it. A run that throws is said in one line,
 * and the next run happens: nothing that goes wrong in a run stops a loop,
 * and a loop that stopped anyway would show as a beat that stopped. The loops
 * keep time with timers here, in the process, and every due time stays in the
 * database, so a restart loses nothing.
 *
 * And a minute task, on Graphile Worker's cron, that checks in with
 * Healthchecks.io when the watchdog's beat is fresh: at most BEAT_FRESH_MS old
 * by the database clock. A watchdog that cannot sweep records no beat, so the
 * check-in stops, and the owner is paged (D-079), as `/v1/health` goes
 * degraded for the API's monitor.
 *
 * Until M3 brings APNs and FCM, the worker's push answers NOT_CONFIGURED to
 * every message, so no message ever counts as sent, and the worker says so at
 * start.
 */
import { run, type Runner, type TaskList } from 'graphile-worker';
import process from 'node:process';
import { databaseClock } from './adapters/clock.ts';
import { POOL_SIZE, createDatabase, createPool } from './adapters/db.ts';
import { healthchecksCheckIn } from './adapters/healthchecks.ts';
import { databaseJourneyStore } from './adapters/journeys.ts';
import { databaseWorkerHeartbeats } from './adapters/worker-heartbeats.ts';
import { readHealthchecksSetting, type HealthchecksSetting } from './config.ts';
import {
  BEAT_FRESH_MS,
  IDLE_IN_TRANSACTION_LIMIT_MS,
  WATCHDOG_INTERVAL_MS,
} from './domain/watchdog.ts';
import { createLog } from './log.ts';
import { createPushSender, type PushSender } from './modules/alerts/outbox.ts';
import { createWatchdog, type Watchdog } from './modules/alerts/watchdog.ts';
import type { CheckIn, Clock, Log, Push, WorkerHeartbeats } from './ports.ts';
import { exitOnSignal, type Reporting, type Signals } from './process.ts';
import { describeFailure } from './redact.ts';

/** Once a minute. Graphile Worker's cron does not go finer than that. */
export const HEARTBEAT_CRONTAB = '* * * * * heartbeat';

/**
 * The worker's push until M3 brings a provider (A-11): every message is
 * answered NOT_CONFIGURED, so none is ever counted as sent, and each is tried
 * again, loudly, one `push_failed` line at a time. A default that answered
 * `accepted` would be a silent miss.
 */
export const UNCONFIGURED_PUSH: Push = {
  send: () => Promise.resolve({ outcome: 'failed', reason: 'NOT_CONFIGURED' }),
};

/** Where the platform keeps what the worker says: Clever Cloud's log. */
function writeToStderr(text: string): void {
  process.stderr.write(text);
}

/** Why a beat is not fresh enough to check in on, or null when it is. Both times are the database's. */
function staleBeat(now: Date, lastBeat: Date | null): string | null {
  if (lastBeat === null) {
    return 'the watchdog has recorded no beat, so nothing says it is sweeping.';
  }
  const ageMs = now.getTime() - lastBeat.getTime();
  return ageMs > BEAT_FRESH_MS
    ? `the watchdog's last beat is ${String(ageMs)} ms old, more than ${String(BEAT_FRESH_MS)} ms, so its sweeps are not succeeding.`
    : null;
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
    heartbeat: async (_payload, helpers) => {
      // The database clock, not this machine's (REL-01): the beat is the
      // database's time too, so its age is read on one clock. The task
      // records no beat of its own: only a sweep that succeeded does (D-108).
      const now = await clock.now();
      const stale = staleBeat(now, await heartbeats.lastBeat());
      if (stale !== null) {
        // A ping now would tell Healthchecks.io that a watchdog that is not
        // sweeping is alive (INF-08). Its silence is what pages the owner.
        write(`worker: not checking in with Healthchecks.io: ${stale}\n`);
        return;
      }
      if (checkIn !== undefined) {
        try {
          // Graphile's signal, which it aborts when the worker stops: a
          // Healthchecks.io that never answers no longer holds up a stop.
          await checkIn.checkIn(helpers.abortSignal);
        } catch (error: unknown) {
          // Said, not thrown: a failed task is retried. The loud channel is
          // Healthchecks.io's own alert for the missing ping.
          write(`worker: Healthchecks.io check-in failed: ${describeFailure(error)}\n`);
        }
      }
    },
  };
}

/** The two loops, started. */
interface Loops {
  /** Starts no further run, and settles once the runs in flight have. */
  stop: () => Promise<void>;
}

/**
 * Starts the sweep loop and the delivery loop. Each runs at once, and then
 * again `intervalMs` after its previous run finished. A sweep that opened an
 * alert wakes the delivery loop: at once, or, with a delivery in flight, as
 * soon as that one finishes.
 */
function startLoops({
  watchdog,
  sender,
  write,
  intervalMs = WATCHDOG_INTERVAL_MS,
}: {
  watchdog: Watchdog;
  sender: PushSender;
  write: (text: string) => void;
  intervalMs?: number;
}): Loops {
  let stopping = false;
  const inFlight = new Set<Promise<void>>();

  /**
   * One loop: `runNow` starts a run unless one is in flight, in which case
   * another follows it at once. Once stopping, a run that finishes starts
   * nothing and sets no timer, and `stop` has cleared the one that was set.
   */
  const loop = (what: string, work: () => Promise<unknown>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let again = false;
    const runNow = (): void => {
      if (running) {
        again = true;
        return;
      }
      clearTimeout(timer);
      running = true;
      again = false;
      const run: Promise<void> = work()
        .then(
          () => undefined,
          (error: unknown) => {
            write(
              `worker: the ${what} failed, and runs again in ${String(intervalMs)} ms: ` +
                `${describeFailure(error)}\n`,
            );
          },
        )
        .finally(() => {
          running = false;
          inFlight.delete(run);
          if (stopping) {
            return;
          }
          if (again) {
            runNow();
          } else {
            timer = setTimeout(runNow, intervalMs);
          }
        });
      inFlight.add(run);
    };
    return {
      runNow,
      cancel: () => {
        clearTimeout(timer);
      },
    };
  };

  const deliveries = loop('delivery', () => sender.deliverDue());
  const sweeps = loop('sweep', async () => {
    const { opened } = await watchdog.sweep();
    // Not once stopping: a stop starts no further run.
    if (opened > 0 && !stopping) {
      deliveries.runNow();
    }
  });
  sweeps.runNow();
  deliveries.runNow();

  return {
    async stop() {
      stopping = true;
      sweeps.cancel();
      deliveries.cancel();
      await Promise.all([...inFlight]);
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
   * Starts no further sweep or delivery, waits for the ones in flight, stops
   * the runner, which aborts a check-in in flight, then ends the connection
   * pool. Graphile Worker only ends pools it created itself, and this one was
   * handed to it — left open, every restart would leak connections against a
   * database that allows five (D-068).
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

/** What a worker is started with. Each is injectable for tests; production takes the defaults. */
export interface WorkerOptions {
  /** The check-in with Healthchecks.io, when the setting allows one. */
  checkIn?: CheckIn | undefined;
  /** Where the worker says what it does: stderr by default. */
  write?: ((text: string) => void) | undefined;
  /** The push port: UNCONFIGURED_PUSH until M3. */
  push?: Push | undefined;
  /** Where the watchdog, the sender and the pool log their closed events: stdout by default. */
  log?: Log | undefined;
  /** The sweep loop's work: the watchdog over this worker's pool by default. */
  watchdog?: Watchdog | undefined;
  /** The delivery loop's work: the sender over this worker's pool by default. */
  sender?: PushSender | undefined;
}

export async function startWorker(
  connectionString: string,
  runWorker: RunWorker = run,
  {
    checkIn,
    write = writeToStderr,
    push = UNCONFIGURED_PUSH,
    // The one place the worker's real log is made: the modules get the Log
    // port (AR-10). It writes to this process's stdout.
    log = createLog(),
    watchdog,
    sender,
  }: WorkerOptions = {},
): Promise<Worker> {
  // The idle limit (D-108): a sweep holds a journey's row for milliseconds,
  // and a session frozen with one is ended. No lock limit: the sweep and the
  // claim take rows with `skip locked`, the one waiting attempt sets its own
  // for its transaction, and Graphile Worker's statements share this pool.
  // The listeners are on the pool before Graphile Worker is handed it.
  const pool = createPool(connectionString, POOL_SIZE.worker, {
    name: 'worker',
    log,
    idleInTransactionMs: IDLE_IN_TRANSACTION_LIMIT_MS,
  });
  const db = createDatabase(pool);
  const heartbeats = databaseWorkerHeartbeats(db);
  const journeys = databaseJourneyStore(db);

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
      // On stop, a job's abort signal fires at once rather than after
      // Graphile's default 5 s. The minute check-in is the only job, and it
      // ends on that signal, so a stop never waits for Healthchecks.io.
      gracefulShutdownAbortTimeout: 0,
      crontab: HEARTBEAT_CRONTAB,
      taskList: createTaskList({ clock: databaseClock(db), heartbeats, checkIn, write }),
    });
  } catch (error) {
    await pool.end();
    throw error;
  }

  const loops = startLoops({
    watchdog: watchdog ?? createWatchdog({ journeys, beats: heartbeats, log }),
    sender: sender ?? createPushSender({ outbox: journeys, push, log }),
    write,
  });

  let stopRequested = false;
  return {
    async stop() {
      stopRequested = true;
      await loops.stop();
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
 * The worker process: start the runner and the loops, stop them cleanly on
 * the platform's signal, and fail if the runner ends any other way. Here
 * rather than in bin/worker.ts so that the part deciding whether a dead worker
 * is restarted is tested in-process, under the mutation gate.
 *
 * Except on the build machine (BUG-3). Clever Cloud starts CC_WORKER_COMMAND
 * there too, where it would run the new code against the database before the
 * migration has, beside the old app's worker, and past the connection budget.
 * So there it starts nothing, no loop included, and waits to be stopped. It
 * does not exit: CC_WORKER_RESTART is "always", and an exit would be
 * restarted every few seconds for as long as the build lasts.
 *
 * It checks in with Healthchecks.io after each fresh beat when
 * HEALTHCHECKS_WORKER_URL allows it (INF-08), and says at start whether it
 * does and, if not, why. Never where: the ping URL is a secret. Left out, the
 * setting counts as unset. It also says at start that no push provider is
 * configured: its push is UNCONFIGURED_PUSH until M3.
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
    log,
    watchdog,
    sender,
    ...reporting
  }: {
    runWorker?: RunWorker;
    signals?: Signals;
    instanceType?: string | undefined;
    keepAlive?: () => void;
    healthchecks?: HealthchecksSetting;
    createCheckIn?: (url: string) => CheckIn;
  } & Pick<WorkerOptions, 'log' | 'watchdog' | 'sender'> &
    Reporting = {},
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
    write('worker: checking in with Healthchecks.io after every fresh beat.\n');
    checkIn = createCheckIn(healthchecks.url);
  } else {
    write(`worker: not checking in with Healthchecks.io: ${healthchecks.reason}\n`);
  }
  // No push provider can be configured until M3 brings one (A-11), with its
  // setting; until then the worker's push is UNCONFIGURED_PUSH, and it says so.
  write(
    'worker: no push provider is configured, so no alert can reach a phone: every message ' +
      'is answered NOT_CONFIGURED, stays unsent, and is tried again.\n',
  );
  const worker = await startWorker(connectionString, runWorker, {
    checkIn,
    write,
    push: UNCONFIGURED_PUSH,
    log,
    watchdog,
    sender,
  });
  exitOnSignal({ name: 'worker', signals, stop: worker.stop, ...reporting });
  await worker.untilStopped();
}
