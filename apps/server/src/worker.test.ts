// The worker is a safety path (AR-06): what it does, and how often, is what
// turns silence from a phone into an alert. So its wiring is asserted here
// rather than left to be discovered in production.
//
// LOST-02 changes what the worker's beat means (D-079's first follow-up, the
// spec's approach item 6): the watchdog's sweep records it, at the now() its
// read returned, and only a sweep that succeeded does. The minute task no
// longer writes the beat. It checks in with Healthchecks.io only when the
// beat is at most 30 s old by the database clock, and otherwise says why in
// one line. So the minute task's tests below changed by design (RG-03, the
// spec's "Existing assertions that change by design"): every property they
// held is held again. The beat is the database's time (REL-01: now proved
// for the sweep, in alerts.system.test.ts, and for the task's judgement of
// the beat's age, below), and there is no check-in without a fresh beat
// (INF-08-AC2 and AC3, below).
//
// LOST-02 also adds the worker's two loops, the sweep and the delivery, each
// run again 10 s after its last run finished (D-107); its default push, which
// answers NOT_CONFIGURED until M3; its pool's session limit and listeners;
// and a stop that waits for a run in flight and no longer waits for a
// Healthchecks.io that never answers (D-079's second follow-up).
import {
  BEAT_RECORDED,
  CHECKED_IN,
  CHECK_IN_ABORTED,
  SYNTHETIC_CHECK_UUID as CHECK,
  SYNTHETIC_PING_URL as PING_URL,
  fakeCheckIn,
  fakeClock,
  fakeLog,
  fakeWorkerHeartbeats,
  fc,
  pgSettingsAnswer,
  syntheticCredential,
  syntheticUuid,
  type FakeLog,
  type FakePgSetting,
  type FakePostgresHandler,
} from '@trygghverdag/test-kit';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { healthchecksCheckIn } from './adapters/healthchecks.ts';
import { captured, markersIn } from './capture.test.ts';
import { readHealthchecksSetting, type HealthchecksSetting } from './config.ts';
import {
  askedFor,
  eventually,
  listeningFakePostgres,
  quietDatabase,
  sessionSetting,
} from './fake-postgres-server.test.ts';
import type { CheckIn } from './ports.ts';
import {
  HEARTBEAT_CRONTAB,
  UNCONFIGURED_PUSH,
  createTaskList,
  runWorkerProcess,
  startWorker,
  type RunWorker,
} from './worker.ts';

const NOW = new Date('2026-09-23T22:15:00.000Z');
const SECOND = 1_000;
/** A beat at most this old is fresh: three sweeps (LOST-02, approach item 6). */
const BEAT_FRESH = 30 * SECOND;

/** What a sweep and a delivery resolve to (the spec's interfaces). */
interface SweepResult {
  ok: boolean;
  opened: number;
  stuck: number;
}
interface DeliveryResult {
  sent: number;
  failed: number;
}

/**
 * A loop's work, driven by the test: each run waits until the test settles
 * it, and counts. `finish` and `fail` settle the latest run.
 */
function stubRuns<T>(fallback: T) {
  const runs: { resolve: (result: T) => void; reject: (error: Error) => void }[] = [];
  return {
    run: () =>
      new Promise<T>((resolve, reject) => {
        runs.push({ resolve, reject });
      }),
    get count() {
      return runs.length;
    },
    finish(result: T = fallback) {
      runs.at(-1)?.resolve(result);
    },
    fail(error = new Error('the run threw')) {
      runs.at(-1)?.reject(error);
    },
  };
}

/** A watchdog whose sweeps the test settles by hand. */
function stubWatchdog() {
  const runs = stubRuns<SweepResult>({ ok: true, opened: 0, stuck: 0 });
  return Object.assign(runs, { sweep: runs.run });
}

/** A sender whose deliveries the test settles by hand. */
function stubSender() {
  const runs = stubRuns<DeliveryResult>({ sent: 0, failed: 0 });
  return Object.assign(runs, { deliverDue: runs.run });
}

/**
 * Loops that do nothing and succeed at once: for the tests about something
 * else, so the real watchdog and sender never reach for a database there.
 */
function quietLoops(): {
  watchdog: { sweep: () => Promise<SweepResult> };
  sender: { deliverDue: () => Promise<DeliveryResult> };
  log: FakeLog;
} {
  return {
    watchdog: { sweep: () => Promise.resolve({ ok: true, opened: 0, stuck: 0 }) },
    sender: { deliverDue: () => Promise.resolve({ sent: 0, failed: 0 }) },
    log: fakeLog(),
  };
}

/** The minute task's Graphile helpers, as far as the task reads them: the abort signal. */
function helpersWith(signal: AbortSignal = new AbortController().signal) {
  return { abortSignal: signal } as never;
}

describe('createTaskList', () => {
  test('REL-01: the minute task judges the beat’s age by the time the database gave, not this process', async () => {
    // RG-03 (LOST-02): this test said "the heartbeat records the time the
    // database gave". The minute task no longer records the beat; the sweep
    // does, at its read's now(), proved in alerts.system.test.ts
    // (LOST-02-AC4, AC19). What this task still decides on a clock is whether
    // the beat is fresh, so the same rule is held here: NOW is days before
    // this machine's clock, and a beat 20 s before NOW is fresh only on the
    // database's time.
    const clock = fakeClock(NOW);
    const heartbeats = fakeWorkerHeartbeats(new Date(NOW.getTime() - 20 * SECOND));
    const checkIn = fakeCheckIn();
    const { heartbeat } = createTaskList({ clock, heartbeats, checkIn, write: () => undefined });

    await heartbeat?.(null, helpersWith());

    expect(checkIn.calls).toBe(1);
    expect((await heartbeats.lastBeat())?.toISOString()).toBe(
      new Date(NOW.getTime() - 20 * SECOND).toISOString(),
    );
  });

  test('the minute task records no beat: a minute later, with no new beat from a sweep, it does not check in again', async () => {
    // RG-03 (LOST-02): this test said "beating twice moves the recorded time
    // forward". The task no longer beats. Its replacement holds the other
    // side: a minute on, the beat it was given is 80 s old, and the task
    // neither moves it nor checks in on it.
    const events: string[] = [];
    const clock = fakeClock(NOW);
    const heartbeats = fakeWorkerHeartbeats(new Date(NOW.getTime() - 20 * SECOND), { events });
    const checkIn = fakeCheckIn({ events });
    const { heartbeat } = createTaskList({ clock, heartbeats, checkIn, write: () => undefined });

    await heartbeat?.(null, helpersWith());
    clock.advance(60_000);
    await heartbeat?.(null, helpersWith());

    expect(events).toEqual([CHECKED_IN]);
    expect(events).not.toContain(BEAT_RECORDED);
    expect((await heartbeats.lastBeat())?.getTime()).toBe(NOW.getTime() - 20 * SECOND);
  });
});

describe('startWorker', () => {
  test('runs the heartbeat on a schedule, with a task to answer it', async () => {
    // A crontab naming a task that does not exist is a worker that starts
    // cleanly and then never beats — and the only symptom would be the API
    // reporting the system degraded for reasons nobody could see.
    let options: Parameters<Parameters<typeof startWorker>[1] & object>[0] | undefined;
    const fakeRunner = ((given: typeof options) => {
      options = given;
      return Promise.resolve({} as never);
    }) as Parameters<typeof startWorker>[1];

    // RG-03 (LOST-02, review loop 1, safety-reviewer): quiet loops. LOST-02 starts a watchdog
    // and a sender with the worker; left real here, they swept a database that does not exist
    // every 10 s for as long as the file ran, as nothing stops this worker, printing closed
    // watchdog_failed and delivery_failed lines into the unit run's output. This test is not
    // about the loops: it asserts what it did before.
    await startWorker('postgres://example/db', fakeRunner, { ...quietLoops() });

    expect(options?.crontab).toBe(HEARTBEAT_CRONTAB);
    expect(HEARTBEAT_CRONTAB).toContain('heartbeat');
    expect(Object.keys(options?.taskList ?? {})).toContain('heartbeat');
  });

  test('AR-06: the heartbeat it schedules is wired to the database, not to nothing', async () => {
    // Having a task named `heartbeat` is not the same as that task being able
    // to beat. Mutation testing made the difference concrete: replacing the
    // whole dependency object with `{}` left a task list that still had a
    // `heartbeat` key, and every assertion above still passed — a worker that
    // starts, schedules, and then fails every beat, with the only symptom being
    // the API reporting the system degraded for reasons nobody could see.
    //
    // So the task is invoked. The socket directory does not exist, so the
    // attempt fails in milliseconds with no network involved — and *how* it
    // fails is the assertion: reaching the query means the real database clock
    // was wired in. With the dependencies missing it throws a TypeError for
    // reading 'now' of undefined, long before any query is built.
    let options: Parameters<Parameters<typeof startWorker>[1] & object>[0] | undefined;
    const fakeRunner = ((given: typeof options) => {
      options = given;
      return Promise.resolve({} as never);
    }) as Parameters<typeof startWorker>[1];

    // RG-03 (LOST-02, review loop 1, safety-reviewer): quiet loops. LOST-02 starts a watchdog
    // and a sender with the worker; left real here, they swept a database that does not exist
    // every 10 s for as long as the file ran, as nothing stops this worker, printing closed
    // watchdog_failed and delivery_failed lines into the unit run's output. This test is not
    // about the loops: it asserts what it did before.
    await startWorker('postgres:///db?host=/nonexistent-socket-dir', fakeRunner, {
      ...quietLoops(),
    });
    const { heartbeat } = options?.taskList ?? {};

    await expect(heartbeat?.(null, {} as never)).rejects.toThrow(/select now\(\)/);
  });
});

type RunnerOptions = Parameters<Parameters<typeof startWorker>[1] & object>[0];

/**
 * Graphile Worker 0.18's default `gracefulShutdownAbortTimeout`: how long its
 * graceful shutdown waits before it aborts the `helpers.abortSignal` of the
 * jobs still running (read in its dist/config.js, line 53, and dist/main.js,
 * lines 662–666: the abort comes on a timer after the shutdown begins).
 */
const GRAPHILE_ABORT_TIMEOUT_MS = 5_000;

/**
 * A runner that records what happens to it. `ends` settles the promise that
 * Graphile Worker's own runner settles when it stops or crashes.
 *
 * LOST-02: it runs a task as Graphile does, with `helpers.abortSignal`, and
 * its stop does what Graphile's graceful shutdown does with running jobs: it
 * waits for them, and aborts their signal once `gracefulShutdownAbortTimeout`
 * has passed (Graphile's default unless the worker sets it). It also notes
 * how many `error` and `connect` listeners the pool had when it was handed in.
 */
function recordingRunner(events: string[] = []) {
  let options: RunnerOptions | undefined;
  let listenersAtStart: { error: number; connect: number } | undefined;
  let settle: { resolve: () => void; reject: (error: Error) => void } = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  const promise = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const controller = new AbortController();
  const running = new Set<Promise<unknown>>();
  const run = ((given: RunnerOptions) => {
    options = given;
    const pool = given.pgPool;
    if (pool !== undefined) {
      listenersAtStart = {
        error: pool.listenerCount('error'),
        connect: pool.listenerCount('connect'),
      };
      const end = pool.end.bind(pool);
      pool.end = () => {
        events.push('pool ended');
        return end();
      };
    }
    return Promise.resolve({
      promise,
      stop: async () => {
        const abortAfter =
          (given as { gracefulShutdownAbortTimeout?: number }).gracefulShutdownAbortTimeout ??
          GRAPHILE_ABORT_TIMEOUT_MS;
        const timer = setTimeout(() => {
          controller.abort();
        }, abortAfter);
        await Promise.allSettled([...running]);
        clearTimeout(timer);
        events.push('runner stopped');
        settle.resolve();
      },
    } as never);
  }) as RunWorker;
  return {
    run,
    events,
    options: () => options,
    listenersAtStart: () => listenersAtStart,
    /** Runs the named task as Graphile Worker would: with its abort signal, tracked until it settles. */
    runTask: (name: string): Promise<void> => {
      const task = options?.taskList?.[name];
      if (task === undefined) {
        return Promise.reject(new Error(`No ${name} task was scheduled.`));
      }
      const job = Promise.resolve(task(null, { abortSignal: controller.signal } as never)).then(
        () => undefined,
      );
      running.add(job);
      void job.finally(() => running.delete(job)).catch(() => undefined);
      return job;
    },
    endsOnItsOwn: () => {
      settle.resolve();
    },
    crashes: (error: Error) => {
      settle.reject(error);
    },
  };
}

describe('stopping the worker', () => {
  test('D-068: stopping ends the connection pool it opened, after the runner has stopped', async () => {
    // The pool is handed to Graphile Worker, which only ends pools it created
    // itself. Left open, every restart of the process would leak connections
    // against a database that allows five in total.
    const runner = recordingRunner();
    // RG-03 (LOST-02, review loop 1, safety-reviewer): quiet loops. LOST-02 starts a watchdog
    // and a sender with the worker; left real here, they swept a database that does not exist
    // every 10 s, and stop() waited for the one in flight, printing closed watchdog_failed and
    // delivery_failed lines into the unit run's output. This test is not about the loops: it
    // asserts what it did before.
    const worker = await startWorker('postgres://example/db', runner.run, { ...quietLoops() });

    await worker.stop();

    expect(runner.events).toEqual(['runner stopped', 'pool ended']);
    expect(runner.options()?.pgPool?.ended).toBe(true);
  });

  test('a runner that fails to start does not leave its pool open', async () => {
    let options: RunnerOptions | undefined;
    const failing = ((given: RunnerOptions) => {
      options = given;
      return Promise.reject(new Error('cannot start'));
    }) as Parameters<typeof startWorker>[1];

    await expect(startWorker('postgres://example/db', failing)).rejects.toThrow('cannot start');
    expect(options?.pgPool?.ended).toBe(true);
  });

  test('stopping on request ends quietly', async () => {
    const runner = recordingRunner();
    // RG-03 (LOST-02, review loop 1, safety-reviewer): quiet loops. LOST-02 starts a watchdog
    // and a sender with the worker; left real here, they swept a database that does not exist
    // every 10 s, and stop() waited for the one in flight, printing closed watchdog_failed and
    // delivery_failed lines into the unit run's output. This test is not about the loops: it
    // asserts what it did before.
    const worker = await startWorker('postgres://example/db', runner.run, { ...quietLoops() });

    const stopped = worker.untilStopped();
    await worker.stop();

    await expect(stopped).resolves.toBeUndefined();
  });

  test('AR-06: a runner that ends without being asked to is a failure, not a quiet exit', async () => {
    // A worker process that exits with 0 is one the platform does not restart,
    // and a worker that is not running is a watchdog that is not watching.
    const runner = recordingRunner();
    // RG-03 (LOST-02, review loop 1, safety-reviewer): quiet loops. LOST-02 starts a watchdog
    // and a sender with the worker; left real here, they swept a database that does not exist
    // every 10 s for as long as the file ran, as nothing stops this worker, printing closed
    // watchdog_failed and delivery_failed lines into the unit run's output. This test is not
    // about the loops: it asserts what it did before.
    const worker = await startWorker('postgres://example/db', runner.run, { ...quietLoops() });

    runner.endsOnItsOwn();

    await expect(worker.untilStopped()).rejects.toThrow(/without being asked/);
  });

  test('a runner that crashes passes the crash on, so the process can say what happened', async () => {
    const runner = recordingRunner();
    // RG-03 (LOST-02, review loop 1, safety-reviewer): quiet loops. LOST-02 starts a watchdog
    // and a sender with the worker; left real here, they swept a database that does not exist
    // every 10 s for as long as the file ran, as nothing stops this worker, printing closed
    // watchdog_failed and delivery_failed lines into the unit run's output. This test is not
    // about the loops: it asserts what it did before.
    const worker = await startWorker('postgres://example/db', runner.run, { ...quietLoops() });

    runner.crashes(new Error('lost the database'));

    await expect(worker.untilStopped()).rejects.toThrow('lost the database');
  });
});

describe('who owns the stop signal', () => {
  test('D-068: Graphile Worker is told not to handle signals, so ours closes the pool and exits with 0', async () => {
    // Left to itself, Graphile installs its own SIGTERM handler, finishes its
    // jobs and then kills the process with the same signal — before our stop
    // has ended the pool or chosen the exit code. safety-reviewer watched that
    // happen against a real PostgreSQL on INF-07.
    const runner = recordingRunner();

    // RG-03 (LOST-02, review loop 1, safety-reviewer): quiet loops. LOST-02 starts a watchdog
    // and a sender with the worker; left real here, they swept a database that does not exist
    // every 10 s for as long as the file ran, as nothing stops this worker, printing closed
    // watchdog_failed and delivery_failed lines into the unit run's output. This test is not
    // about the loops: it asserts what it did before.
    await startWorker('postgres://example/db', runner.run, { ...quietLoops() });

    expect(runner.options()?.noHandleSignals).toBe(true);
  });
});

/** Lets pending promise callbacks run, so a test can look at what they did. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('runWorkerProcess', () => {
  test('on SIGTERM it stops the runner, ends the pool, and exits with 0', async () => {
    const runner = recordingRunner();
    const signals = new EventEmitter();
    const exits: number[] = [];

    const running = runWorkerProcess('postgres://example/db', {
      runWorker: runner.run,
      signals,
      write: () => undefined,
      exit: (code) => {
        exits.push(code);
      },
      // RG-03 (LOST-02, review loop 1, safety-reviewer): quiet loops. LOST-02 starts a watchdog
      // and a sender with the worker; left real here, they swept a database that does not exist
      // every 10 s, and stop() waited for the one in flight, printing closed watchdog_failed
      // and delivery_failed lines into the unit run's output. This test is not about the loops:
      // it asserts what it did before.
      ...quietLoops(),
    });
    await settle();
    signals.emit('SIGTERM');

    await expect(running).resolves.toBeUndefined();
    await settle();
    expect(runner.events).toEqual(['runner stopped', 'pool ended']);
    expect(exits).toEqual([0]);
  });

  test('AR-06: a runner that ends on its own fails the process, so the platform restarts it', async () => {
    const runner = recordingRunner();
    const signals = new EventEmitter();

    const running = runWorkerProcess('postgres://example/db', {
      runWorker: runner.run,
      signals,
      write: () => undefined,
      exit: () => undefined,
      // RG-03 (LOST-02, review loop 1, safety-reviewer): quiet loops. LOST-02 starts a watchdog
      // and a sender with the worker; left real here, they swept a database that does not exist
      // every 10 s for as long as the file ran, as nothing stops this worker once its runner
      // ends, printing closed watchdog_failed and delivery_failed lines into the unit run's
      // output. This test is not about the loops: it asserts what it did before.
      ...quietLoops(),
    });
    await settle();
    runner.endsOnItsOwn();

    await expect(running).rejects.toThrow(/without being asked/);
  });
});

describe("runWorkerProcess on Clever Cloud's build machine", () => {
  // BUG-3: Clever Cloud also starts CC_WORKER_COMMAND on the machine that
  // builds a deploy, which it marks INSTANCE_TYPE=build. Staging's first two
  // deploys show that worker connecting to the database 21 and 36 seconds
  // before the migration ran, beside the old app's own worker.
  test('BUG-3: it never starts a runner there, and says why', async () => {
    const runner = recordingRunner();
    const written: string[] = [];

    const running = runWorkerProcess('postgres://example/db', {
      runWorker: runner.run,
      signals: new EventEmitter(),
      instanceType: 'build',
      keepAlive: () => undefined,
      write: (text) => {
        written.push(text);
      },
      exit: () => undefined,
    });
    await settle();

    expect(runner.options()).toBeUndefined();
    expect(written.join('')).toContain('INSTANCE_TYPE=build');
    await running;
  });

  test('BUG-3: it stays up without working until the platform stops it, then exits with 0', async () => {
    // Exiting at once would not do: CC_WORKER_RESTART is "always", so systemd
    // would start it again every five seconds for as long as the build lasts.
    const signals = new EventEmitter();
    const kept: string[] = [];
    const exits: number[] = [];

    const running = runWorkerProcess('postgres://example/db', {
      runWorker: recordingRunner().run,
      signals,
      instanceType: 'build',
      keepAlive: () => {
        kept.push('kept alive');
      },
      write: () => undefined,
      exit: (code) => {
        exits.push(code);
      },
    });
    await settle();
    expect(kept).toEqual(['kept alive']);
    expect(exits).toEqual([]);

    signals.emit('SIGTERM');
    await settle();

    expect(exits).toEqual([0]);
    await running;
  });

  test('BUG-3: by default it says so on stderr and holds a timer, which is what keeps Node up', async () => {
    // The two defaults production uses. bin/bin.test.ts runs them for real, in a
    // child process that coverage cannot see; this runs them here. Only the
    // interval is faked, so nothing is left running after the test.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await runWorkerProcess('postgres://example/db', {
        signals: new EventEmitter(),
        instanceType: 'build',
        exit: () => undefined,
      });

      expect(vi.getTimerCount()).toBe(1);
      expect(stderr.mock.calls.map(([text]) => String(text)).join('')).toContain(
        'INSTANCE_TYPE=build',
      );
    } finally {
      stderr.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  test('BUG-3: on the machine that runs the app it starts, as before', async () => {
    const runner = recordingRunner();

    const running = runWorkerProcess('postgres://example/db', {
      runWorker: runner.run,
      signals: new EventEmitter(),
      instanceType: 'production',
      write: () => undefined,
      exit: () => undefined,
      // RG-03 (LOST-02, review loop 1, safety-reviewer): quiet loops. LOST-02 starts a watchdog
      // and a sender with the worker; left real here, they swept a database that does not exist
      // every 10 s for as long as the file ran, as nothing stops this worker once its runner
      // ends, printing closed watchdog_failed and delivery_failed lines into the unit run's
      // output. This test is not about the loops: it asserts what it did before.
      ...quietLoops(),
    });
    await settle();

    expect(runner.options()).toBeDefined();
    runner.endsOnItsOwn();
    await expect(running).rejects.toThrow(/without being asked/);
  });
});

describe('runWorkerProcess, when stopping fails', () => {
  test('says the worker failed while stopping, and exits with 1', async () => {
    const signals = new EventEmitter();
    const written: string[] = [];
    const exits: number[] = [];
    const brokenStop = (() =>
      Promise.resolve({
        promise: new Promise<void>(() => undefined),
        stop: () => Promise.reject(new Error('could not stop')),
      } as never)) as RunWorker;

    void runWorkerProcess('postgres://example/db', {
      runWorker: brokenStop,
      signals,
      write: (text) => {
        written.push(text);
      },
      exit: (code) => {
        exits.push(code);
      },
      // RG-03 (LOST-02): quiet loops, as the other runWorkerProcess tests
      // have. LOST-02 starts a watchdog and a sender with the worker, and
      // stop() waits for a sweep in flight before it stops the runner (AC21).
      // Left real, the first sweep looks up the host "example" and fails a
      // few milliseconds later, after this test has asserted. This test is
      // about a stop that fails, not about the loops: it asserts the same
      // exit code and the same line as before, and only keeps the loops it
      // is not about from starting.
      ...quietLoops(),
    });
    await settle();
    signals.emit('SIGTERM');
    await settle();

    expect(exits).toEqual([1]);
    expect(written.join('')).toContain('worker failed while stopping: Error: could not stop');
  });
});

// INF-08, serving REL-08: the worker checks in with Healthchecks.io, and a
// check that stops getting pings pages the owner. So the one thing that must
// never happen is a ping without a fresh beat: Healthchecks.io would report a
// worker alive whose watchdog is not sweeping, and nobody would be paged.
// And the ping URL must never be written anywhere: anyone who has it can keep
// the check green while the worker is dead.
//
// Since LOST-02 the beat is the watchdog's (D-079: "the watchdog feeds the
// beat"), so "only after a recorded beat" became "only when the beat is at
// most 30 s old by the database clock" (RG-03, by design, the spec's
// "Existing assertions that change by design"). The tests below held the
// first; they hold the second, with the same strength: every way a minute
// can go, and the order of what happens in it.
//
// Nothing below sends anything to hc-ping.com, and nothing could, even in a
// worker that ignored the fake it was handed: a ping from a test would tell a
// real check that the worker is alive.

// CHECK is the UUID of a ping URL: all zeros, so it names no real check.
// PING_URL is a usable setting: https, so the worker accepts it. On the
// loopback address and on port 1, which fetch refuses to connect to at all, so
// whatever reaches for it — a fake, a fetch that sends nothing, or the real
// adapter — nothing leaves this machine. Both come from the test kit.

const CHECKING_IN = /^worker: checking in with Healthchecks\.io\b/;
const NOT_CHECKING_IN = /^worker: not checking in with Healthchecks\.io\b/;
const CHECK_IN_FAILED = 'worker: Healthchecks.io check-in failed: ';
/** The line the worker says at start until M3 brings a push provider (LOST-02, approach item 5). */
const NO_PUSH = /^worker: .*\bno push provider\b/i;

/** What the fake database adds to `events` when the minute task reads its time. */
const TIME_READ = 'time read';
/** What the fake database adds to `events` when the minute task reads the beat. */
const BEAT_READ = 'beat read';

/** What was written, as lines. */
const linesOf = (written: string[]) =>
  written
    .join('')
    .split('\n')
    .filter((line) => line !== '');

/** The lines about Healthchecks.io: the start line, and each check-in that failed or did not happen. */
const healthchecksLines = (written: string[]) =>
  linesOf(written).filter((line) => line.includes('Healthchecks.io'));

/** The reason a setting gives for not checking in. Fails the test if it would check in. */
function reasonOf(setting: HealthchecksSetting): string {
  expect(setting.checkingIn).toBe(false);
  return setting.checkingIn ? '' : setting.reason;
}

/** The URL a fetch was asked for, however it was handed over. */
function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

/**
 * A fetch that fails the way Node's own does when it cannot parse an address:
 * with the whole address in the message, and again in the cause. Nothing is
 * sent anywhere.
 */
const fetchThatRepeatsTheUrl: typeof fetch = (input) =>
  Promise.reject(
    new TypeError(`Failed to parse URL from ${urlOf(input)}`, {
      cause: Object.assign(new TypeError(`Invalid URL: ${urlOf(input)}`), {
        code: 'ERR_INVALID_URL',
        input: urlOf(input),
      }),
    }),
  );

/** `select now()` as PostgreSQL writes it, and as Drizzle hands it back from a raw query. */
const NOW_AS_POSTGRES_WRITES_IT = '2026-09-23 22:15:00+00';
/** A beat 20 s before that, as the worker_heartbeat row holds it: fresh. */
const FRESH_BEAT_AS_POSTGRES_WRITES_IT = '2026-09-23 22:14:40+00';

/**
 * Makes the pool startWorker handed to the runner answer the minute task's
 * two reads as PostgreSQL would: the time, and the watchdog's beat. So the
 * task startWorker built — with the real database clock and the real
 * heartbeat table behind it — can run to the end with no database. Each read
 * joins `events` only once it has been answered. Set `failing` to make one of
 * them fail, and `beatAt` to the beat's time as text, or null for none. Any
 * other query fails: the minute task writes nothing (LOST-02).
 */
function answerLikePostgres(runner: ReturnType<typeof recordingRunner>, events: string[]) {
  const pool = runner.options()?.pgPool;
  if (pool === undefined) {
    throw new Error('The runner was never given a pool.');
  }
  const database: { failing: 'time' | 'beat' | null; beatAt: string | null } = {
    failing: null,
    beatAt: FRESH_BEAT_AS_POSTGRES_WRITES_IT,
  };
  const answer = (config: string | { text: string }) => {
    const text = typeof config === 'string' ? config : config.text;
    return Promise.resolve().then(() => {
      if (text.startsWith('select now()')) {
        if (database.failing === 'time') {
          throw new Error('Connection terminated unexpectedly');
        }
        events.push(TIME_READ);
        return { rows: [{ now: NOW_AS_POSTGRES_WRITES_IT }], rowCount: 1 };
      }
      if (/^select\b[\s\S]*\bfrom "worker_heartbeat"/.test(text)) {
        if (database.failing === 'beat') {
          throw new Error('Connection terminated unexpectedly');
        }
        events.push(BEAT_READ);
        const rows = database.beatAt === null ? [] : [[database.beatAt]];
        return { rows, rowCount: rows.length };
      }
      throw new Error(`The minute task asked the database something unexpected: ${text}`);
    });
  };
  pool.query = answer as never;
  return database;
}

/** Runs the heartbeat task the runner was given, as Graphile Worker's cron would. */
function runHeartbeat(runner: ReturnType<typeof recordingRunner>): Promise<void> {
  return runner.runTask('heartbeat');
}

/**
 * runWorkerProcess with everything it reaches replaced: a recording runner,
 * signals the test sends, loops that do nothing, and — unless `createCheckIn`
 * is 'default' — a check-in the test owns. Returns what it wrote, how it
 * exited, and every URL it asked a check-in to be made for.
 */
function workerProcess({
  healthchecks,
  instanceType,
  createCheckIn,
}: {
  healthchecks: HealthchecksSetting;
  instanceType?: string;
  createCheckIn?: ((url: string) => CheckIn) | 'default';
}) {
  const runner = recordingRunner();
  const signals = new EventEmitter();
  const events: string[] = [];
  const written: string[] = [];
  const exits: number[] = [];
  const created: string[] = [];
  const checkIn = fakeCheckIn({ events });
  const make = createCheckIn ?? (() => checkIn);
  const running = runWorkerProcess('postgres://example/db', {
    runWorker: runner.run,
    signals,
    instanceType,
    healthchecks,
    ...quietLoops(),
    ...(make === 'default'
      ? {}
      : {
          createCheckIn: (url: string) => {
            created.push(url);
            return make(url);
          },
        }),
    keepAlive: () => undefined,
    write: (text) => {
      written.push(text);
    },
    exit: (code) => {
      exits.push(code);
    },
  });
  return { runner, signals, events, written, exits, created, checkIn, running };
}

/** Stops a worker the way the platform does, and checks it ended cleanly. */
async function stopCleanly(worker: ReturnType<typeof workerProcess>) {
  worker.signals.emit('SIGTERM');
  await expect(worker.running).resolves.toBeUndefined();
  await settle();
  expect(worker.exits).toEqual([0]);
}

describe('REL-08: the minute task checks in with Healthchecks.io only after a fresh beat', () => {
  /** A task list over fakes that share one list of what happened, in order; the beat `ageMs` old, or none. */
  function heartbeatOverFakes(ageMs: number | null = 20 * SECOND) {
    const events: string[] = [];
    const written: string[] = [];
    const clock = fakeClock(NOW);
    const heartbeats = fakeWorkerHeartbeats(
      ageMs === null ? null : new Date(NOW.getTime() - ageMs),
      { events },
    );
    const checkIn = fakeCheckIn({ events });
    const { heartbeat } = createTaskList({
      clock,
      heartbeats,
      checkIn,
      write: (text) => {
        written.push(text);
      },
    });
    const run = (signal?: AbortSignal) => Promise.resolve(heartbeat?.(null, helpersWith(signal)));
    return { events, written, clock, heartbeats, checkIn, run };
  }

  test('INF-08-AC2: a fresh beat is followed by exactly one check-in, and nothing is written', async () => {
    // RG-03 (LOST-02): "a recorded beat" became "a fresh beat", and the task
    // records none of its own: the events hold the check-in alone.
    const { events, written, checkIn, run } = heartbeatOverFakes();

    await expect(run()).resolves.toBeUndefined();

    expect(events).toEqual([CHECKED_IN]);
    expect(checkIn.calls).toBe(1);
    expect(written).toEqual([]);
  });

  test('INF-08-AC2: for any run of minutes, check-ins equal the minutes whose beat was fresh, and each comes after its own minute’s reads', async () => {
    // RG-03 (LOST-02): the ordering rule, over every mix of outcomes a minute
    // can have, now that the sweep, not this task, records the beat. A
    // minute's beat is set by recording it, as a sweep would, before the
    // task runs; the fake adds to `events` only once the beat is recorded,
    // and the check-in comes after it or not at all.
    const OUTCOMES = [
      'a fresh beat',
      'a stale beat',
      'the clock fails',
      'the check-in fails',
    ] as const;

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...OUTCOMES), { maxLength: 25 }),
        fc.integer({ min: 0, max: BEAT_FRESH }),
        fc.integer({ min: BEAT_FRESH + 1, max: 10 * BEAT_FRESH }),
        async (outcomes, freshAgeMs, staleAgeMs) => {
          const { events, written, clock, heartbeats, checkIn, run } = heartbeatOverFakes(null);
          const expected: string[] = [];
          let failedCheckIns = 0;
          let staleMinutes = 0;

          for (const outcome of outcomes) {
            clock.recover();
            checkIn.recover();
            const now = (await clock.now()).getTime();
            await heartbeats.record(
              new Date(now - (outcome === 'a stale beat' ? staleAgeMs : freshAgeMs)),
            );
            expected.push(BEAT_RECORDED);
            const failure = new Error(`${outcome}, on purpose`);
            if (outcome === 'the clock fails') {
              clock.failWith(failure);
            } else if (outcome === 'the check-in fails') {
              checkIn.failWith(failure);
            }

            if (outcome === 'the clock fails') {
              await expect(run()).rejects.toBe(failure);
            } else {
              await expect(run()).resolves.toBeUndefined();
              if (outcome === 'a stale beat') {
                staleMinutes += 1;
              } else {
                expected.push(CHECKED_IN);
                if (outcome === 'the check-in fails') {
                  failedCheckIns += 1;
                }
              }
            }
            clock.recover();
            clock.advance(60_000);
          }

          expect(events).toEqual(expected);
          expect(checkIn.calls).toBe(expected.filter((event) => event === CHECKED_IN).length);
          expect(linesOf(written)).toHaveLength(failedCheckIns + staleMinutes);
          expect(linesOf(written).filter((line) => line.startsWith(CHECK_IN_FAILED))).toHaveLength(
            failedCheckIns,
          );
          expect(linesOf(written).filter((line) => NOT_CHECKING_IN.test(line))).toHaveLength(
            staleMinutes,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  test('INF-08-AC3: when the database time cannot be read, there is no check-in, and the task fails as before', async () => {
    const { events, written, clock, checkIn, run } = heartbeatOverFakes();
    const failure = new Error('The database did not return a time, so nothing can be timed');
    clock.failWith(failure);

    await expect(run()).rejects.toBe(failure);

    expect(checkIn.calls).toBe(0);
    expect(events).toEqual([]);
    expect(written).toEqual([]);

    // The same task checks in once the time can be read again, so the zero
    // above is the failure's doing and not a check-in that was never wired.
    clock.recover();
    await run();
    expect(events).toEqual([CHECKED_IN]);
  });

  test('INF-08-AC3: when the beat is more than 30 s old, there is no check-in, and one line says so, naming the beat; a fresh beat then checks in', async () => {
    // RG-03 (LOST-02): this test was "when the beat cannot be recorded".
    // The task no longer records it; a sweep that failed records none, which
    // leaves the beat to age. So a stale beat is that case now.
    const { events, written, heartbeats, checkIn, run } = heartbeatOverFakes(BEAT_FRESH + 1);

    await expect(run()).resolves.toBeUndefined();

    expect(checkIn.calls).toBe(0);
    expect(events).toEqual([]);
    expect(linesOf(written)).toHaveLength(1);
    expect(linesOf(written)[0]).toMatch(NOT_CHECKING_IN);
    expect(linesOf(written)[0]).toMatch(/\bbeat\b/);

    await heartbeats.record(NOW);
    await run();
    expect(events).toEqual([BEAT_RECORDED, CHECKED_IN]);
  });

  test.each([
    ['a non-2xx answer', 'Healthchecks.io answered 500'],
    ['no answer in time', 'The operation was aborted due to timeout'],
    ['no connection', 'fetch failed'],
  ])(
    'INF-08-AC4: a check-in that fails with %s does not fail the task: one line with the reason',
    async (_what, reason) => {
      // RG-03 (LOST-02): the task records no beat, so the events hold the
      // check-in alone, and the beat it was given is unchanged.
      const { events, written, heartbeats, checkIn, run } = heartbeatOverFakes();
      checkIn.failWith(new Error(reason));

      await expect(run()).resolves.toBeUndefined();

      expect(events).toEqual([CHECKED_IN]);
      expect((await heartbeats.lastBeat())?.getTime()).toBe(NOW.getTime() - 20 * SECOND);
      const text = written.join('');
      expect(text.startsWith(CHECK_IN_FAILED)).toBe(true);
      expect(text).toContain(reason);
      expect(text.endsWith('\n')).toBe(true);
      expect(linesOf(written)).toHaveLength(1);
    },
  );

  test('INF-08-AC4: a failed check-in is written again every minute it fails, one line each', async () => {
    // The line is the only trace in the platform's log of a check that is
    // not being pinged, so it must not be written once and then fall silent.
    const { written, checkIn, clock, heartbeats, run } = heartbeatOverFakes();
    checkIn.failWith(new Error('Healthchecks.io answered 500'));

    await run();
    clock.advance(60_000);
    // A sweep in between keeps the beat fresh (LOST-02).
    await heartbeats.record(await clock.now());
    await run();

    expect(checkIn.calls).toBe(2);
    expect(linesOf(written)).toHaveLength(2);
  });

  test('INF-08-AC4: by default a failed check-in is said on stderr, where the platform keeps it', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const checkIn = fakeCheckIn();
      checkIn.failWith(new Error('Healthchecks.io answered 500'));
      const { heartbeat } = createTaskList({
        clock: fakeClock(NOW),
        heartbeats: fakeWorkerHeartbeats(new Date(NOW.getTime() - 20 * SECOND)),
        checkIn,
      });

      await heartbeat?.(null, helpersWith());

      const lines = linesOf(stderr.mock.calls.map(([text]) => String(text)));
      expect(lines.filter((line) => line.startsWith(CHECK_IN_FAILED))).toHaveLength(1);
      expect(lines.join('\n')).toContain('Healthchecks.io answered 500');
    } finally {
      stderr.mockRestore();
    }
  });

  test('LOST-02-AC19: by the database clock, a beat exactly 30 s old is checked in on, and one 30.001 s old is not: one line says the beat is too old', async () => {
    const atLimit = heartbeatOverFakes(BEAT_FRESH);
    await atLimit.run();
    expect(atLimit.checkIn.calls).toBe(1);
    expect(atLimit.written).toEqual([]);

    const pastIt = heartbeatOverFakes(BEAT_FRESH + 1);
    await pastIt.run();
    expect(pastIt.checkIn.calls).toBe(0);
    expect(linesOf(pastIt.written)).toHaveLength(1);
    expect(linesOf(pastIt.written)[0]).toMatch(NOT_CHECKING_IN);
  });

  test('LOST-02-AC19: with no beat at all, there is no check-in, and one line says so', async () => {
    const { checkIn, written, run } = heartbeatOverFakes(null);

    await expect(run()).resolves.toBeUndefined();

    expect(checkIn.calls).toBe(0);
    expect(linesOf(written)).toHaveLength(1);
    expect(linesOf(written)[0]).toMatch(NOT_CHECKING_IN);
    expect(linesOf(written)[0]).toMatch(/\bbeat\b/);
  });

  test('LOST-02-AC19: for any age of the beat, the task checks in exactly when it is at most 30 s old, and otherwise writes one line; it never records a beat', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 10 * 60 * SECOND }), async (ageMs) => {
        const { events, checkIn, written, run } = heartbeatOverFakes(ageMs);

        await run();

        expect(checkIn.calls).toBe(ageMs <= BEAT_FRESH ? 1 : 0);
        expect(linesOf(written)).toHaveLength(ageMs <= BEAT_FRESH ? 0 : 1);
        expect(events).not.toContain(BEAT_RECORDED);
      }),
    );
  });

  test('LOST-02-AC21: the minute task hands Graphile’s abort signal to the check-in, the very one it was given', async () => {
    const { checkIn, run } = heartbeatOverFakes();
    const controller = new AbortController();

    await run(controller.signal);

    expect(checkIn.signals).toHaveLength(1);
    expect(checkIn.signals[0]).toBe(controller.signal);
  });

  test('LOST-02-AC21: a check-in that hangs ends when that signal aborts: the task completes, and says the check-in failed in one line', async () => {
    const { events, checkIn, written, run } = heartbeatOverFakes();
    checkIn.hang();
    const controller = new AbortController();
    const settled: string[] = [];

    const task = run(controller.signal).then(
      () => settled.push('completed'),
      () => settled.push('failed'),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toEqual([]);

    controller.abort();
    // A task that never handed the signal on would hang here for good: a
    // second is far longer than an abort takes.
    await Promise.race([task, new Promise((resolve) => setTimeout(resolve, 1_000))]);

    expect(settled).toEqual(['completed']);
    expect(events).toEqual([CHECKED_IN, CHECK_IN_ABORTED]);
    expect(linesOf(written)).toHaveLength(1);
    expect(linesOf(written)[0]?.startsWith(CHECK_IN_FAILED)).toBe(true);
  });
});

describe('REL-08: the minute task startWorker schedules checks in through the check-in it was given', () => {
  test('INF-08-AC2: it reads the database time and the beat, and only then checks in; it writes nothing', async () => {
    // RG-03 (LOST-02): it "reads the database time, records the beat, and
    // only then checks in". The beat is the sweep's now, so the task reads
    // it instead of writing it; answerLikePostgres refuses any write.
    const events: string[] = [];
    const runner = recordingRunner();
    const checkIn = fakeCheckIn({ events });
    await startWorker('postgres://example/db', runner.run, {
      checkIn,
      write: () => undefined,
      ...quietLoops(),
    });
    answerLikePostgres(runner, events);

    await expect(runHeartbeat(runner)).resolves.toBeUndefined();

    // RG-03 (LOST-02, review loop 1, test-auditor): the order, pinned whole
    // now that the code exists: the database time, then the beat, then the
    // check-in. It held the three in any order, with the check-in last; it
    // holds that still, and the reads' order besides.
    expect(events).toEqual([TIME_READ, BEAT_READ, CHECKED_IN]);
  });

  test('INF-08-AC3: when the beat cannot be read, it does not check in, and fails as before', async () => {
    // RG-03 (LOST-02): this was "when recording the beat fails". Reading it is
    // what the task does with the beat now.
    const events: string[] = [];
    const runner = recordingRunner();
    const checkIn = fakeCheckIn({ events });
    await startWorker('postgres://example/db', runner.run, {
      checkIn,
      write: () => undefined,
      ...quietLoops(),
    });
    const database = answerLikePostgres(runner, events);
    database.failing = 'beat';

    await expect(runHeartbeat(runner)).rejects.toThrow(/"worker_heartbeat"/);
    expect(events).not.toContain(CHECKED_IN);
    expect(checkIn.calls).toBe(0);

    database.failing = null;
    await runHeartbeat(runner);
    expect(events.filter((event) => event === CHECKED_IN)).toHaveLength(1);
    expect(events.at(-1)).toBe(CHECKED_IN);
  });

  test('INF-08-AC3: when the database time cannot be read, it does not check in', async () => {
    const events: string[] = [];
    const runner = recordingRunner();
    const checkIn = fakeCheckIn({ events });
    await startWorker('postgres://example/db', runner.run, {
      checkIn,
      write: () => undefined,
      ...quietLoops(),
    });
    const database = answerLikePostgres(runner, events);
    database.failing = 'time';

    await expect(runHeartbeat(runner)).rejects.toThrow(/select now\(\)/);
    expect(events).not.toContain(CHECKED_IN);
    expect(checkIn.calls).toBe(0);

    database.failing = null;
    await runHeartbeat(runner);
    expect(events.at(-1)).toBe(CHECKED_IN);
    expect(events).toContain(TIME_READ);
  });

  test('INF-08-AC3: a minute task wired to a database it cannot reach sends no check-in', async () => {
    // The same unreachable database as the AR-06 wiring test above: the
    // attempt fails in milliseconds, with no network involved.
    const events: string[] = [];
    const runner = recordingRunner();
    const checkIn = fakeCheckIn({ events });
    await startWorker('postgres:///db?host=/nonexistent-socket-dir', runner.run, {
      checkIn,
      write: () => undefined,
      ...quietLoops(),
    });

    await expect(runHeartbeat(runner)).rejects.toThrow(/select now\(\)|"worker_heartbeat"/);
    expect(checkIn.calls).toBe(0);

    answerLikePostgres(runner, events);
    await runHeartbeat(runner);
    expect(checkIn.calls).toBe(1);
  });

  test('INF-08-AC4: a failed check-in completes the task, and is said through the write it was given', async () => {
    const events: string[] = [];
    const written: string[] = [];
    const runner = recordingRunner();
    const checkIn = fakeCheckIn({ events });
    checkIn.failWith(new Error('Healthchecks.io answered 429'));
    await startWorker('postgres://example/db', runner.run, {
      checkIn,
      write: (text) => {
        written.push(text);
      },
      ...quietLoops(),
    });
    answerLikePostgres(runner, events);

    await expect(runHeartbeat(runner)).resolves.toBeUndefined();

    expect(events.at(-1)).toBe(CHECKED_IN);
    expect(linesOf(written)).toHaveLength(1);
    expect(linesOf(written)[0]?.startsWith(CHECK_IN_FAILED)).toBe(true);
    expect(linesOf(written)[0]).toContain('Healthchecks.io answered 429');
  });

  test('LOST-02-AC19: with the watchdog’s beat older than 30 s in the table, the minute task startWorker schedules does not check in, and says so in one line', async () => {
    const events: string[] = [];
    const written: string[] = [];
    const runner = recordingRunner();
    const checkIn = fakeCheckIn({ events });
    await startWorker('postgres://example/db', runner.run, {
      checkIn,
      write: (text) => {
        written.push(text);
      },
      ...quietLoops(),
    });
    const database = answerLikePostgres(runner, events);
    database.beatAt = '2026-09-23 22:14:29.999+00';

    await expect(runHeartbeat(runner)).resolves.toBeUndefined();

    expect(checkIn.calls).toBe(0);
    expect(linesOf(written)).toHaveLength(1);
    expect(linesOf(written)[0]).toMatch(NOT_CHECKING_IN);
  });
});

describe('REL-08: runWorkerProcess and HEALTHCHECKS_WORKER_URL', () => {
  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['an http: address', `http://127.0.0.1:1/${CHECK}`],
    ['not an address at all', `hc-ping.com/${CHECK}`],
  ])(
    'INF-08-AC6: with HEALTHCHECKS_WORKER_URL %s it starts, runs its minute task and stays up, never checks in, and says why once',
    async (_what, value) => {
      // A monitoring setting must never stop the watchdog it watches, or put
      // it in a crash loop.
      //
      // RG-03 (LOST-02): the beat is the sweep's, so the minute task no longer
      // writes one here, and the worker's start lines now include one about
      // push (approach item 5). So the Healthchecks.io lines are counted
      // apart, and that one is still said exactly once.
      const healthchecks = readHealthchecksSetting(
        value === undefined ? {} : { HEALTHCHECKS_WORKER_URL: value },
      );
      const worker = workerProcess({ healthchecks });
      await settle();

      expect(worker.runner.options()?.crontab).toBe(HEARTBEAT_CRONTAB);
      answerLikePostgres(worker.runner, worker.events);
      await expect(runHeartbeat(worker.runner)).resolves.toBeUndefined();
      expect(worker.events).not.toContain(CHECKED_IN);
      expect(worker.events).not.toContain(BEAT_RECORDED);
      expect(worker.created).toEqual([]);

      const lines = healthchecksLines(worker.written);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(NOT_CHECKING_IN);
      expect(lines[0]).toContain('HEALTHCHECKS_WORKER_URL');
      expect(lines[0]).toContain(reasonOf(healthchecks));
      expect(worker.written.join('')).not.toContain(CHECK);
      expect(worker.exits).toEqual([]);

      await stopCleanly(worker);
    },
  );

  test('INF-08-AC6: with a usable https: address it says it is checking in, without saying where, and checks in after each fresh beat', async () => {
    const worker = workerProcess({
      healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: PING_URL }),
    });
    await settle();

    expect(worker.created).toEqual([PING_URL]);
    expect(healthchecksLines(worker.written)).toHaveLength(1);
    expect(healthchecksLines(worker.written)[0]).toMatch(CHECKING_IN);

    answerLikePostgres(worker.runner, worker.events);
    await expect(runHeartbeat(worker.runner)).resolves.toBeUndefined();

    expect(worker.events.at(-1)).toBe(CHECKED_IN);
    expect(worker.checkIn.calls).toBe(1);
    expect(healthchecksLines(worker.written)).toHaveLength(1);
    expect(worker.written.join('')).not.toContain(CHECK);
    expect(worker.exits).toEqual([]);

    await stopCleanly(worker);
  });

  test('INF-08-AC5: when a check-in fails with the URL in its error, nothing the worker writes contains it', async () => {
    // The real adapter, run inside the real worker, over a fetch that fails the
    // way Node's does when it cannot parse an address: with that address in
    // the message and in the cause.
    const worker = workerProcess({
      healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: PING_URL }),
      createCheckIn: (url) => healthchecksCheckIn({ url, fetch: fetchThatRepeatsTheUrl }),
    });
    await settle();
    answerLikePostgres(worker.runner, worker.events);

    await expect(runHeartbeat(worker.runner)).resolves.toBeUndefined();

    const lines = healthchecksLines(worker.written);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(CHECKING_IN);
    expect(lines[1]?.startsWith(CHECK_IN_FAILED)).toBe(true);
    expect(worker.written.join('')).not.toContain(PING_URL);
    expect(worker.written.join('')).not.toContain(CHECK);

    await stopCleanly(worker);
  });

  test('INF-08-AC4: by default it checks in through the Healthchecks.io adapter, and a check-in that fails is one line, not a failed task', async () => {
    // No check-in is injected here, so this is the adapter production uses,
    // and PING_URL's port 1 is what makes its fetch fail.
    const worker = workerProcess({
      healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: PING_URL }),
      createCheckIn: 'default',
    });
    await settle();
    answerLikePostgres(worker.runner, worker.events);

    await expect(runHeartbeat(worker.runner)).resolves.toBeUndefined();

    expect([...worker.events].sort()).toEqual([BEAT_READ, TIME_READ].sort());
    const lines = healthchecksLines(worker.written);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(CHECKING_IN);
    // The whole line, not its start: fetch refuses port 1 with a "bad port"
    // that carries no code, so this reason is PING_URL's own. A check-in built
    // without the URL fails too, but with ERR_INVALID_URL in its reason — and
    // only this line tells the two apart.
    expect(lines[1]).toBe(`${CHECK_IN_FAILED}Error: Healthchecks.io could not be reached.`);
    expect(worker.written.join('')).not.toContain(CHECK);
    expect(worker.exits).toEqual([]);

    await stopCleanly(worker);
  });

  test('INF-08-AC6: given no setting at all, it runs as though HEALTHCHECKS_WORKER_URL were unset', async () => {
    const runner = recordingRunner();
    const signals = new EventEmitter();
    const written: string[] = [];

    const running = runWorkerProcess('postgres://example/db', {
      runWorker: runner.run,
      signals,
      ...quietLoops(),
      write: (text) => {
        written.push(text);
      },
      exit: () => undefined,
    });
    await settle();

    expect(runner.options()?.crontab).toBe(HEARTBEAT_CRONTAB);
    expect(healthchecksLines(written)).toHaveLength(1);
    expect(healthchecksLines(written)[0]).toMatch(NOT_CHECKING_IN);
    expect(healthchecksLines(written)[0]).toContain('HEALTHCHECKS_WORKER_URL');

    signals.emit('SIGTERM');
    await expect(running).resolves.toBeUndefined();
  });

  test('INF-08-AC6: by default the start line, and a failed check-in, are said on stderr', async () => {
    // The default production uses. The platform keeps stderr; a line written
    // anywhere else would be a line nobody can find.
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const runner = recordingRunner();
      const signals = new EventEmitter();
      const events: string[] = [];
      const checkIn = fakeCheckIn({ events });
      checkIn.failWith(new Error('Healthchecks.io answered 500'));

      const running = runWorkerProcess('postgres://example/db', {
        runWorker: runner.run,
        signals,
        healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: PING_URL }),
        createCheckIn: () => checkIn,
        ...quietLoops(),
        exit: () => undefined,
      });
      await settle();
      answerLikePostgres(runner, events);
      await runHeartbeat(runner);

      const lines = linesOf(stderr.mock.calls.map(([text]) => String(text)));
      expect(lines.filter((line) => CHECKING_IN.test(line))).toHaveLength(1);
      expect(lines.filter((line) => line.startsWith(CHECK_IN_FAILED))).toHaveLength(1);
      expect(lines.join('\n')).not.toContain(CHECK);

      signals.emit('SIGTERM');
      await expect(running).resolves.toBeUndefined();
    } finally {
      stderr.mockRestore();
    }
  });
});

describe("REL-08: runWorkerProcess on Clever Cloud's build machine, with Healthchecks.io set", () => {
  test('INF-08-AC7: BUG-3: no runner starts there and nothing checks in, where the app machine with the same setting does', async () => {
    const healthchecks = readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: PING_URL });

    // The machine that runs the app first, as the control: the same setting
    // checks in after a fresh beat there. Without it, "nothing checked in"
    // below would pass just as well for a worker that never checks in anywhere.
    const app = workerProcess({ healthchecks, instanceType: 'production' });
    await settle();
    answerLikePostgres(app.runner, app.events);
    await runHeartbeat(app.runner);
    expect(app.created).toEqual([PING_URL]);
    expect(app.checkIn.calls).toBe(1);
    await stopCleanly(app);

    const build = workerProcess({ healthchecks, instanceType: 'build' });
    await settle();

    expect(build.runner.options()).toBeUndefined();
    // Not only never sent: never even built. A check-in that exists on the
    // build machine is one a later change could send from there.
    expect(build.created).toEqual([]);
    expect(build.checkIn.calls).toBe(0);
    expect(build.written.join('')).toContain('INSTANCE_TYPE=build');
    expect(build.written.join('')).not.toContain(CHECK);
    await stopCleanly(build);
    expect(build.created).toEqual([]);
    expect(build.checkIn.calls).toBe(0);
  });
});

// ===========================================================================
// LOST-02: the loops, the default push, the pool, and a stop that no longer
// waits for Healthchecks.io.
// ===========================================================================

describe('REL-08 and LOST-02: the sweep loop and the delivery loop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A worker whose loops run the stubs, on fake timers: only setTimeout, which the loops keep time with. */
  async function looping() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const watchdog = stubWatchdog();
    const sender = stubSender();
    const written: string[] = [];
    const runner = recordingRunner();
    const worker = await startWorker('postgres://example/db', runner.run, {
      watchdog,
      sender,
      log: fakeLog(),
      write: (text) => {
        written.push(text);
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    return { watchdog, sender, written, runner, worker };
  }

  test('LOST-02-AC21: a sweep and a delivery run at start, and again 10 s after each previous run finished; a run that takes longer than that is never overlapped', async () => {
    const { watchdog, sender } = await looping();

    expect(watchdog.count).toBe(1);
    expect(sender.count).toBe(1);

    // The first sweep takes a minute: nothing else starts meanwhile.
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(watchdog.count).toBe(1);
    watchdog.finish();
    await vi.advanceTimersByTimeAsync(10 * SECOND - 1);
    expect(watchdog.count).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(watchdog.count).toBe(2);

    // The first delivery, still running all this time, is not overlapped either.
    expect(sender.count).toBe(1);
    sender.finish();
    await vi.advanceTimersByTimeAsync(10 * SECOND - 1);
    expect(sender.count).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sender.count).toBe(2);
  });

  test('LOST-02-AC21: a sweep that throws, and a delivery that throws, are each written as one line, and the next run still happens 10 s later', async () => {
    const { watchdog, sender, written } = await looping();

    watchdog.fail(new Error('the sweep threw'));
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(written)).toHaveLength(1);
    expect(linesOf(written)[0]).toMatch(/^worker: /);
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(watchdog.count).toBe(2);

    sender.fail(new Error('the delivery threw'));
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(written)).toHaveLength(2);
    expect(linesOf(written)[1]).toMatch(/^worker: /);
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(sender.count).toBe(2);
  });

  test('LOST-02-AC21: a sweep that opened an alert starts a delivery at once, without waiting for the interval; one that opened none does not', async () => {
    const { watchdog, sender } = await looping();
    sender.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.count).toBe(1);

    watchdog.finish({ ok: true, opened: 1, stuck: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.count).toBe(2);
    sender.finish();

    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(watchdog.count).toBe(2);
    const deliveries = sender.count;
    sender.finish();
    watchdog.finish({ ok: true, opened: 0, stuck: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.count).toBe(deliveries);
  });

  test('LOST-02-AC21: a sweep that opens an alert while a delivery is in flight gets a delivery as soon as that one finishes, not 10 s later', async () => {
    const { watchdog, sender } = await looping();

    watchdog.finish({ ok: true, opened: 2, stuck: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.count).toBe(1);

    sender.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.count).toBe(2);
  });

  test('LOST-02-AC21: a delivery that never settles delays no sweep', async () => {
    const { watchdog, sender } = await looping();

    for (let sweep = 1; sweep <= 3; sweep += 1) {
      expect(watchdog.count).toBe(sweep);
      watchdog.finish();
      await vi.advanceTimersByTimeAsync(10 * SECOND);
    }
    expect(watchdog.count).toBe(4);
    expect(sender.count).toBe(1);
  });

  test('LOST-02-AC21: stop() starts no further run, waits for the one in flight, and only then stops the runner and ends the pool', async () => {
    const { watchdog, sender, runner, worker } = await looping();
    sender.finish();
    await vi.advanceTimersByTimeAsync(0);
    const stopped: string[] = [];

    const stopping = worker.stop().then(() => stopped.push('stopped'));
    await vi.advanceTimersByTimeAsync(60 * SECOND);

    expect(stopped).toEqual([]);
    expect(runner.events).toEqual([]);
    expect(watchdog.count).toBe(1);
    expect(sender.count).toBe(1);

    watchdog.finish();
    await vi.advanceTimersByTimeAsync(0);
    await stopping;

    expect(stopped).toEqual(['stopped']);
    expect(runner.events).toEqual(['runner stopped', 'pool ended']);
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(watchdog.count).toBe(1);
    expect(sender.count).toBe(1);
  });

  test('LOST-02-AC21: a run that throws is said in one line naming its loop: the sweep’s names the sweep, and the delivery’s the delivery', async () => {
    // RG-03 (LOST-02, review loop 1): the errors said "synthetic sweep
    // failure" and "synthetic delivery failure", so each line held its loop's
    // name through the error text alone, and a failure line that named no loop
    // still passed (the implementer's mutants survived). The errors now name
    // neither loop, and the name must stand before the error, in the line's
    // own words: the same two lines, held more tightly.
    const { watchdog, sender, written } = await looping();
    const firstError = 'synthetic failure number one';
    const secondError = 'synthetic failure number two';

    watchdog.fail(new Error(firstError));
    await vi.advanceTimersByTimeAsync(0);
    sender.fail(new Error(secondError));
    await vi.advanceTimersByTimeAsync(0);

    const [sweepLine = '', deliveryLine = ''] = linesOf(written);
    expect(linesOf(written)).toHaveLength(2);
    // Each line: the worker, the loop it is about, and only then the error.
    const ownWords = (line: string, error: string) => line.slice(0, line.indexOf(error));
    expect(sweepLine).toContain(firstError);
    expect(ownWords(sweepLine, firstError)).toMatch(/^worker: .*\bsweep\b/);
    expect(sweepLine).not.toMatch(/\bdelivery\b/);
    expect(deliveryLine).toContain(secondError);
    expect(ownWords(deliveryLine, secondError)).toMatch(/^worker: .*\bdelivery\b/);
    expect(deliveryLine).not.toMatch(/\bsweep\b/);
  });

  test('LOST-02-AC21: stop() while a sweep that will open an alert is in flight: no delivery starts after stop() began, and no timer is left set', async () => {
    const { watchdog, sender, worker } = await looping();
    sender.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.count).toBe(1);

    const stopping = worker.stop();
    watchdog.finish({ ok: true, opened: 1, stuck: 0 });
    await vi.advanceTimersByTimeAsync(0);
    await stopping;

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(sender.count).toBe(1);
    expect(watchdog.count).toBe(1);
  });

  test('LOST-02-AC21: stop() while a delivery is in flight with another run pending: it does not run again, and no timer is left set', async () => {
    const { watchdog, sender, worker } = await looping();
    // A sweep that opened an alert while the first delivery is in flight
    // leaves another delivery pending, to follow it at once.
    watchdog.finish({ ok: true, opened: 1, stuck: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.count).toBe(1);

    const stopping = worker.stop();
    sender.finish();
    await vi.advanceTimersByTimeAsync(0);
    await stopping;

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(sender.count).toBe(1);
    expect(watchdog.count).toBe(1);
  });

  test('LOST-02-AC21: stop() while both loops are in flight: neither starts another run', async () => {
    const { watchdog, sender, worker } = await looping();

    const stopping = worker.stop();
    watchdog.finish({ ok: true, opened: 1, stuck: 0 });
    await vi.advanceTimersByTimeAsync(0);
    sender.finish();
    await vi.advanceTimersByTimeAsync(0);
    await stopping;

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(watchdog.count).toBe(1);
    expect(sender.count).toBe(1);
  });

  test('LOST-02-AC21: runNow on either loop after stop() began starts nothing', async () => {
    // Every way a loop is asked to run, after stop() began: the delivery's
    // timer comes due, the sweep in flight finishes having opened an alert
    // (which asks the delivery loop to run now), and the sweep's own timer
    // would come due after it.
    const { watchdog, sender, worker } = await looping();
    sender.finish();
    await vi.advanceTimersByTimeAsync(0);

    const stopping = worker.stop();
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(sender.count).toBe(1);
    watchdog.finish({ ok: true, opened: 3, stuck: 0 });
    await vi.advanceTimersByTimeAsync(0);
    await stopping;
    await vi.advanceTimersByTimeAsync(60 * SECOND);

    expect(watchdog.count).toBe(1);
    expect(sender.count).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('LOST-02-AC21: on the build machine no loop runs (BUG-3)', async () => {
    const watchdog = stubWatchdog();
    const sender = stubSender();

    const running = runWorkerProcess('postgres://example/db', {
      runWorker: recordingRunner().run,
      signals: new EventEmitter(),
      instanceType: 'build',
      keepAlive: () => undefined,
      watchdog,
      sender,
      log: fakeLog(),
      write: () => undefined,
      exit: () => undefined,
    });
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(watchdog.count).toBe(0);
    expect(sender.count).toBe(0);
    await running;
  });
});

describe('REL-08 and LOST-02: a stop that no longer waits for Healthchecks.io (D-079)', () => {
  test('LOST-02-AC21: on SIGTERM with a check-in hung, the worker exits with 0 within a second: the check-in’s signal is aborted, then the runner stops, then the pool ends', async () => {
    // Before LOST-02 the check-in had no signal, and a Healthchecks.io that
    // never answered held the stop for its 10 s timeout (safety-reviewer
    // measured an exit 6.8 s after SIGTERM). The runner here does what
    // Graphile does on stop: it waits for running jobs and aborts their
    // signal after its gracefulShutdownAbortTimeout. A hung check-in that was
    // never handed that signal, or a signal aborted only after Graphile's
    // default 5 s, would hold the exit past a second.
    const events: string[] = [];
    const runner = recordingRunner(events);
    const signals = new EventEmitter();
    const checkIn = fakeCheckIn({ events });
    checkIn.hang();

    const running = runWorkerProcess('postgres://example/db', {
      runWorker: runner.run,
      signals,
      healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: PING_URL }),
      createCheckIn: () => checkIn,
      ...quietLoops(),
      write: () => undefined,
      exit: (code) => {
        events.push(`exit ${String(code)}`);
      },
    });
    await settle();
    answerLikePostgres(runner, []);
    void runHeartbeat(runner).catch(() => undefined);
    expect(await eventually(() => checkIn.calls === 1)).toBe(true);

    const signalled = performance.now();
    signals.emit('SIGTERM');
    const exited = await eventually(() => events.includes('exit 0'), 500);

    expect(exited).toBe(true);
    expect(performance.now() - signalled).toBeLessThan(1_000);
    expect(events.filter((event) => event !== CHECKED_IN)).toEqual([
      CHECK_IN_ABORTED,
      'runner stopped',
      'pool ended',
      'exit 0',
    ]);
    await running;
  });
});

describe('REL-08 and LOST-02: a check-in the stop cancelled says so', () => {
  test('LOST-02-AC21: stopping the worker during a hung check-in writes the cancelled message, not “could not be reached”', async () => {
    const events: string[] = [];
    const runner = recordingRunner(events);
    const signals = new EventEmitter();
    const written: string[] = [];
    let requests = 0;
    // A Healthchecks.io that never answers, through the real adapter: the
    // request ends only when its signal aborts, as Node's fetch does.
    const neverAnswers: typeof fetch = async (_input, init) => {
      requests += 1;
      const signal = init?.signal;
      if (!signal) {
        throw new Error('the adapter sent no signal, so nothing could ever end this request');
      }
      await once(signal, 'abort');
      throw signal.reason;
    };

    const running = runWorkerProcess('postgres://example/db', {
      runWorker: runner.run,
      signals,
      healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: PING_URL }),
      createCheckIn: (url) => healthchecksCheckIn({ url, fetch: neverAnswers }),
      ...quietLoops(),
      write: (text) => {
        written.push(text);
      },
      exit: (code) => {
        events.push(`exit ${String(code)}`);
      },
    });
    await settle();
    answerLikePostgres(runner, []);
    void runHeartbeat(runner).catch(() => undefined);
    expect(await eventually(() => requests === 1)).toBe(true);

    signals.emit('SIGTERM');
    expect(await eventually(() => events.includes('exit 0'), 500)).toBe(true);

    const failed = linesOf(written).filter((line) => line.includes('check-in failed'));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain('Healthchecks.io check-in cancelled: the worker is stopping.');
    expect(written.join('')).not.toContain('could not be reached');
    await running;
  });
});

describe('LOST-02: the worker’s push until M3', () => {
  test('LOST-02-AC15: the worker’s default push answers NOT_CONFIGURED to every message, and accepts none', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), async (messageId, recipientId) => {
        expect(
          await UNCONFIGURED_PUSH.send({ messageId, recipientId, kind: 'LOST_CONTACT' }),
        ).toEqual({ outcome: 'failed', reason: 'NOT_CONFIGURED' });
      }),
    );
  });

  test('LOST-02-AC15: the worker says once at start that no push provider is configured, through the write it was given, beside its Healthchecks.io line', async () => {
    const worker = workerProcess({ healthchecks: readHealthchecksSetting({}) });
    await settle();

    expect(linesOf(worker.written).filter((line) => NO_PUSH.test(line))).toHaveLength(1);
    expect(healthchecksLines(worker.written)).toHaveLength(1);

    await stopCleanly(worker);
    expect(linesOf(worker.written).filter((line) => NO_PUSH.test(line))).toHaveLength(1);
  });

  test('LOST-02-AC15: by default the worker says on stderr that no push provider is configured', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const signals = new EventEmitter();
      const running = runWorkerProcess('postgres://example/db', {
        runWorker: recordingRunner().run,
        signals,
        ...quietLoops(),
        exit: () => undefined,
      });
      await settle();

      const lines = linesOf(stderr.mock.calls.map(([text]) => String(text)));
      expect(lines.filter((line) => NO_PUSH.test(line))).toHaveLength(1);

      signals.emit('SIGTERM');
      await expect(running).resolves.toBeUndefined();
    } finally {
      stderr.mockRestore();
    }
  });
});

describe('SEC-03 and LOST-02: the worker’s pool, seen from the database', () => {
  test('LOST-02-AC17: the worker’s pool asks every connection for idle_in_transaction_session_timeout 10 000 ms, and for no lock_timeout', async () => {
    const database = await listeningFakePostgres(quietDatabase);
    const runner = recordingRunner();
    const worker = await startWorker(database.url, runner.run, {
      ...quietLoops(),
      write: () => undefined,
    });

    try {
      await runner.options()?.pgPool?.query('select 1');

      const connections = database.connections();
      expect(connections.length).toBeGreaterThan(0);
      for (const connection of connections) {
        expect(sessionSetting(connection, 'idle_in_transaction_session_timeout')).toBe(10_000);
        expect(sessionSetting(connection, 'lock_timeout')).toBeUndefined();
      }
    } finally {
      await worker.stop();
      await database.close();
    }
  });

  test('LOST-02-AC18: the pool has its error listener and its connect listener before the runner is handed it, so graphile-worker neither warns nor installs its own', async () => {
    const runner = recordingRunner();
    const worker = await startWorker('postgres://example/db', runner.run, {
      ...quietLoops(),
      write: () => undefined,
    });

    try {
      expect(runner.listenersAtStart()?.error).toBeGreaterThan(0);
      expect(runner.listenersAtStart()?.connect).toBeGreaterThan(0);
    } finally {
      await worker.stop();
    }
  });

  test('LOST-02-AC18: an idle connection ended with a fatal error is exactly one database_error event, pool worker and its SQLSTATE; nothing written holds the password, the URL or the message; nothing is thrown, and the pool serves the next query', async () => {
    const marker = syntheticCredential();
    const database = await listeningFakePostgres(quietDatabase, { password: marker });
    const message = `terminating connection due to administrator command for ${database.url}`;
    const loops = quietLoops();
    const runner = recordingRunner();
    const worker = await startWorker(database.url, runner.run, {
      ...loops,
      write: () => undefined,
    });
    const pool = runner.options()?.pgPool;

    try {
      const { result, written } = await captured(async () => {
        await pool?.query('select 1');
        const [connection] = database.connections();
        if (connection === undefined) {
          throw new Error('the query made no connection');
        }
        database.end(connection, { code: '57P01', message });
        await eventually(() => loops.log.events.length > 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return (await pool?.query('select 1'))?.rows;
      });

      expect(result).toEqual([]);
      expect(loops.log.events).toEqual([
        { event: 'database_error', pool: 'worker', code: '57P01' },
      ]);
      expect(
        markersIn(`${written}\n${JSON.stringify(loops.log.events)}`, [
          marker,
          database.url,
          message,
          'administrator command',
        ]),
      ).toEqual([]);
    } finally {
      await worker.stop();
      await database.close();
    }
  });

  test('LOST-02-AC18: a checked-out connection ended between two queries is exactly one database_error event too; the client’s next query rejects, and the pool serves the next query', async () => {
    const marker = syntheticCredential();
    const database = await listeningFakePostgres(quietDatabase, { password: marker });
    const message = `terminating connection due to idle-in-transaction timeout ${marker}`;
    const loops = quietLoops();
    const runner = recordingRunner();
    const worker = await startWorker(database.url, runner.run, {
      ...loops,
      write: () => undefined,
    });
    const pool = runner.options()?.pgPool;
    if (pool === undefined) {
      throw new Error('the runner was never given a pool');
    }

    try {
      const { written } = await captured(async () => {
        const client = await pool.connect();
        await client.query('begin');
        const connection = database.connections().at(-1);
        if (connection === undefined) {
          throw new Error('the client made no connection');
        }
        database.end(connection, { code: '25P03', message });
        await eventually(() => loops.log.events.length > 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
        await expect(client.query('select 1')).rejects.toThrow();
        client.release(true);
        expect((await pool.query('select 1')).rows).toEqual([]);
      });

      expect(loops.log.events).toEqual([
        { event: 'database_error', pool: 'worker', code: '25P03' },
      ]);
      expect(
        markersIn(`${written}\n${JSON.stringify(loops.log.events)}`, [
          marker,
          database.url,
          message,
        ]),
      ).toEqual([]);
    } finally {
      await worker.stop();
      await database.close();
    }
  });
});

describe('SEC-03 and LOST-02: every connection of a pool has its listener', () => {
  test('LOST-02-AC18: two idle connections of the worker’s pool, each ended with a fatal error, are two database_error events, one each, so a listener added once for the pool fails here; the pool then serves the next query', async () => {
    const database = await listeningFakePostgres(quietDatabase);
    const loops = quietLoops();
    const runner = recordingRunner();
    const worker = await startWorker(database.url, runner.run, {
      ...loops,
      write: () => undefined,
    });
    const pool = runner.options()?.pgPool;
    if (pool === undefined) {
      throw new Error('the runner was never given a pool');
    }

    try {
      const first = await pool.connect();
      const second = await pool.connect();
      first.release();
      second.release();
      const connections = database.connections().filter((connection) => !connection.ended);
      expect(connections).toHaveLength(2);
      for (const connection of connections) {
        database.end(connection, {
          code: '57P01',
          message: 'terminating connection due to administrator command',
        });
      }
      await eventually(() => loops.log.events.length >= 2);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(loops.log.events).toEqual([
        { event: 'database_error', pool: 'worker', code: '57P01' },
        { event: 'database_error', pool: 'worker', code: '57P01' },
      ]);
      expect((await pool.query('select 1')).rows).toEqual([]);
    } finally {
      await worker.stop();
      await database.close();
    }
  });
});

describe('REL-08 and LOST-02: by default, the real watchdog and sender, and the real log', () => {
  test('LOST-02-AC19: by default the worker sweeps and delivers at once, with the real watchdog and sender over its own pool, and their failures reach stdout through the production log, as closed events naming the stage and the SQLSTATE only', async () => {
    const refusal = 'this synthetic database answers nothing';
    const database = await listeningFakePostgres((query) => {
      if (/^\s*set\s/i.test(query.text) || /set_config\(/i.test(query.text)) {
        return quietDatabase(query);
      }
      throw new Error(refusal);
    });
    const runner = recordingRunner();

    try {
      const { written } = await captured(async () => {
        const worker = await startWorker(database.url, runner.run, { write: () => undefined });
        await eventually(
          () =>
            database.queries.some(({ text }) => /\bjourneys\b/.test(text)) &&
            database.queries.some(({ text }) => /\boutbox\b/.test(text)),
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        await worker.stop();
      });

      const lines = written
        .split('\n')
        .filter((line) => line.includes('"event":'))
        .map((line) => JSON.parse(line.slice(line.indexOf('{'))) as unknown);
      expect(lines).toEqual(
        expect.arrayContaining([
          { event: 'watchdog_failed', stage: 'read', code: 'XX000' },
          { event: 'delivery_failed', stage: 'claim', code: 'XX000' },
        ]),
      );
      expect(markersIn(written, [refusal])).toEqual([]);
    } finally {
      await database.close();
    }
  });
});

// ---------------------------------------------------------------------------
// LOST-02, review loop 1: the worker reads its session limit back at start
// (approach item 7, D-109), and the running worker's push is the
// unconfigured one (privacy-security-reviewer).
// ---------------------------------------------------------------------------

/** What the worker asks for, as pg_settings reports it when the startup parameter arrived. */
const IDLE_AS_ASKED: Record<string, FakePgSetting> = {
  idle_in_transaction_session_timeout: { setting: '10000', unit: 'ms' },
};

/** The lines a worker wrote about its session limits. */
const limitLines = (written: string[]) =>
  linesOf(written).filter((line) => /\bsession limits?\b/.test(line));

/**
 * The worker process over the fake PostgreSQL server, answering the start-up
 * read of pg_settings through `settings`, with loops that count their runs.
 * Resolves once a line about the session limits has been written, or the
 * wait ran out; then stops it.
 */
async function workerReadingBack(
  handler: FakePostgresHandler,
  { password }: { password?: string } = {},
) {
  const database = await listeningFakePostgres(handler, password === undefined ? {} : { password });
  const signals = new EventEmitter();
  const written: string[] = [];
  const watchdog = stubWatchdog();
  const sender = stubSender();
  const running = runWorkerProcess(database.url, {
    runWorker: recordingRunner().run,
    signals,
    watchdog,
    sender,
    log: fakeLog(),
    write: (text) => {
      written.push(text);
    },
    exit: () => undefined,
  });
  await eventually(() => limitLines(written).length > 0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  watchdog.finish();
  sender.finish();
  signals.emit('SIGTERM');
  await running;
  await database.close();
  return { database, written, watchdog };
}

describe('SEC-03 and LOST-02: the worker reads its session limit back at start (D-109)', () => {
  // LOST-02, review loop 2 (approach item 7): the read-back's own edges.

  /** The line the worker writes when its idle limit is anything but a duration it can read. */
  const IDLE_UNREADABLE =
    'worker: session limit idle_in_transaction_session_timeout is unreadable, not 10000ms: a stalled transaction will not be ended.';

  test('LOST-02-AC17: stop() waits for a read-back still in flight: its line is written before stop() resolves, and the pool ends after it', async () => {
    const database = await listeningFakePostgres(
      (query) => pgSettingsAnswer(query, IDLE_AS_ASKED) ?? quietDatabase(query),
    );
    const read = database.holdAnswer(/\bpg_settings\b/);
    const events: string[] = [];
    const runner = recordingRunner(events);
    const signals = new EventEmitter();
    const running = runWorkerProcess(database.url, {
      runWorker: runner.run,
      signals,
      ...quietLoops(),
      write: (text) => {
        if (/\bsession limits?\b/.test(text)) {
          events.push(`line, with ${String(database.closed().length)} connections closed`);
        }
      },
      exit: (code) => {
        events.push(`exit ${String(code)}`);
      },
    });
    try {
      expect(await eventually(() => read.arrived())).toBe(true);
      // A query meanwhile, on the pool's other connection, which is then
      // idle: a pool ended before the read's line would close it then.
      await runner.options()?.pgPool?.query('select 1');
      expect(database.connections()).toHaveLength(2);

      signals.emit('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Still waiting for the read: nothing written, the pool open, no exit.
      expect(events.filter((event) => event !== 'runner stopped')).toEqual([]);
      read.release();
      expect(await eventually(() => events.includes('exit 0'))).toBe(true);
      await running;

      expect(events.filter((event) => event !== 'runner stopped')).toEqual([
        'line, with 0 connections closed',
        'pool ended',
        'exit 0',
      ]);
    } finally {
      read.release();
      await database.close();
    }
  });

  test('LOST-02-AC17: the read-back lines go to stderr and nothing goes to stdout, through the writer bin/worker.ts gives it', async () => {
    // bin/worker.ts gives the worker no writer of its own, so the worker
    // writes through its default, which is what this test runs.
    const entry = readFileSync(new URL('bin/worker.ts', import.meta.url), 'utf8');
    expect(entry).toMatch(/runWorkerProcess\(/);
    expect(entry).not.toMatch(/\bwrite\s*[:,]/);

    const database = await listeningFakePostgres(
      (query) => pgSettingsAnswer(query, IDLE_AS_ASKED) ?? quietDatabase(query),
    );
    const toStdout: string[] = [];
    const toStderr: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      toStdout.push(String(chunk));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      toStderr.push(String(chunk));
      return true;
    });
    const signals = new EventEmitter();
    try {
      const running = runWorkerProcess(database.url, {
        runWorker: recordingRunner().run,
        signals,
        ...quietLoops(),
        exit: () => undefined,
      });
      await eventually(() => toStderr.join('').includes('session limit'));
      signals.emit('SIGTERM');
      await running;
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      await database.close();
    }

    expect(limitLines(toStderr)).toEqual([
      'worker: session limit in force: idle_in_transaction_session_timeout=10000ms',
    ]);
    expect(toStdout.join('')).not.toMatch(/\bsession limits?\b/);
  });

  test('LOST-02-AC17: a limit pg_settings returns no row for is written as unreadable, not in force', async () => {
    const { written } = await workerReadingBack(
      (query) => pgSettingsAnswer(query, {}) ?? quietDatabase(query),
    );

    expect(limitLines(written)).toEqual([IDLE_UNREADABLE]);
  });

  test.each(['10000x', 'x10000', '10 000'])(
    'LOST-02-AC17: a setting with anything around its digits (10000x, x10000, 10 000) is written as unreadable — %s',
    async (setting) => {
      const { written } = await workerReadingBack(
        (query) =>
          pgSettingsAnswer(query, {
            idle_in_transaction_session_timeout: { setting, unit: 'ms' },
          }) ?? quietDatabase(query),
      );

      expect(limitLines(written)).toEqual([IDLE_UNREADABLE]);
      expect(written.join('')).not.toContain(setting);
    },
  );

  test.each(['h', 'us', 'constructor', 'toString', '__proto__'])(
    'LOST-02-AC17: a unit other than ms, s and min, including names every object has (constructor, toString, __proto__), is written as unreadable — %s',
    async (unit) => {
      const { written } = await workerReadingBack(
        (query) =>
          pgSettingsAnswer(query, {
            idle_in_transaction_session_timeout: { setting: '10000', unit },
          }) ?? quietDatabase(query),
      );

      expect(limitLines(written)).toEqual([IDLE_UNREADABLE]);
      expect(written.join('')).not.toContain(`10000${unit}`);
    },
  );

  test('LOST-02-AC17: at start the worker reads idle_in_transaction_session_timeout back from pg_settings and writes exactly one line: worker: session limit in force: idle_in_transaction_session_timeout=10000ms', async () => {
    const { database, written } = await workerReadingBack(
      (query) => pgSettingsAnswer(query, IDLE_AS_ASKED) ?? quietDatabase(query),
    );

    expect(
      database.queries.filter(
        ({ text, values }) =>
          /\bpg_settings\b/.test(text) &&
          `${text} ${values.join(' ')}`.includes('idle_in_transaction_session_timeout'),
      ),
    ).toHaveLength(1);
    expect(limitLines(written)).toEqual([
      'worker: session limit in force: idle_in_transaction_session_timeout=10000ms',
    ]);
  });

  test('LOST-02-AC17: when the database reports an idle limit other than the one asked for, as a pooler that dropped the startup parameters would, the worker writes the fixed mismatch line, and still sweeps', async () => {
    const { written, watchdog } = await workerReadingBack(
      (query) =>
        pgSettingsAnswer(query, {
          idle_in_transaction_session_timeout: { setting: '0', unit: 'ms' },
        }) ?? quietDatabase(query),
    );

    expect(limitLines(written)).toEqual([
      'worker: session limit idle_in_transaction_session_timeout is 0ms, not 10000ms: a stalled transaction will not be ended.',
    ]);
    expect(watchdog.count).toBeGreaterThan(0);
  });

  test('LOST-02-AC17: a limit that is not digits and a unit is written as unreadable, a failed read gives one line with its SQLSTATE, and no start-up line holds the connection URL, its password marker or an error message', async () => {
    const marker = syntheticCredential();
    const unreadable = await workerReadingBack(
      (query) =>
        pgSettingsAnswer(query, {
          idle_in_transaction_session_timeout: { setting: 'eleventy', unit: 'fortnights' },
        }) ?? quietDatabase(query),
      { password: marker },
    );
    const refusal = `the settings are not for you, ${marker}`;
    const failed = await workerReadingBack(
      (query) => {
        if (/\bpg_settings\b/.test(query.text)) {
          throw Object.assign(new Error(refusal), { code: '57014' });
        }
        return quietDatabase(query);
      },
      { password: marker },
    );

    const [line] = limitLines(unreadable.written);
    expect(limitLines(unreadable.written)).toHaveLength(1);
    expect(line).toContain('idle_in_transaction_session_timeout');
    expect(line).toContain('unreadable');
    expect(limitLines(failed.written)).toEqual([
      'worker: session limits could not be read (57014).',
    ]);
    const startLines = [...unreadable.written, ...failed.written].join('');
    expect(
      markersIn(startLines, [
        'eleventy',
        'fortnights',
        marker,
        unreadable.database.url,
        failed.database.url,
        refusal,
      ]),
    ).toEqual([]);
  });
});

describe('LOST-02: the running worker pushes through the unconfigured push', () => {
  const DATABASE_NOW = '2031-02-03 04:05:06.789+00';

  /**
   * A database holding one due message and nothing overdue. It answers the
   * worker's own statements as the adapter shapes them (their column names
   * are the adapter's), and records the rest: the claim hands out the
   * message once, and a mark answers with its ID.
   */
  function oneDueMessage(messageId: string, recipientId: string): FakePostgresHandler {
    let claimed = false;
    return (query) => {
      const settings = pgSettingsAnswer(query, IDLE_AS_ASKED);
      if (settings !== undefined) {
        return settings;
      }
      if (/\bleft join "?journeys"?/i.test(query.text)) {
        return {
          columns: ['now', 'id', 'state', 'silent_since'],
          rows: [[DATABASE_NOW, null, null, null]],
        };
      }
      if (/"?outbox"?[\s\S]*for update skip locked/i.test(query.text)) {
        const rows = claimed
          ? [[DATABASE_NOW, null, null, null, null]]
          : [[DATABASE_NOW, messageId, recipientId, 'LOST_CONTACT', '1']];
        claimed = true;
        return { columns: ['now', 'id', 'recipient_id', 'kind', 'attempts'], rows };
      }
      if (/^\s*update "?outbox"?/i.test(query.text)) {
        return { columns: askedFor(query.text), rows: [[messageId]] };
      }
      return quietDatabase(query);
    };
  }

  test.each(['runWorkerProcess', 'startWorker with no push'] as const)(
    'LOST-02-AC15: the running worker, started by %s, answers a claimed message NOT_CONFIGURED: the mark sets last_failure NOT_CONFIGURED and never sent_at, and one push_failed line names the reason and the message',
    async (how) => {
      const messageId = syntheticUuid();
      const recipientId = syntheticUuid();
      const database = await listeningFakePostgres(oneDueMessage(messageId, recipientId));
      const log = fakeLog();
      const signals = new EventEmitter();
      let stop: () => Promise<void>;
      if (how === 'runWorkerProcess') {
        const running = runWorkerProcess(database.url, {
          runWorker: recordingRunner().run,
          signals,
          log,
          write: () => undefined,
          exit: () => undefined,
        });
        stop = async () => {
          signals.emit('SIGTERM');
          await running;
        };
      } else {
        const worker = await startWorker(database.url, recordingRunner().run, {
          log,
          write: () => undefined,
        });
        stop = () => worker.stop();
      }

      const marks = () =>
        database.queries.filter(({ text }) => /^\s*update "?outbox"?/i.test(text));
      try {
        expect(await eventually(() => marks().length > 0)).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } finally {
        await stop();
        await database.close();
      }

      expect(marks()).toHaveLength(1);
      const [mark] = marks();
      expect(mark?.text).toMatch(/\blast_failure\b/);
      expect(mark?.values).toContain('NOT_CONFIGURED');
      expect(mark?.values).toContain(messageId);
      expect(
        database.queries.filter(
          ({ text }) => /\boutbox\b/i.test(text) && /\bsent_at"?\s*=/i.test(text),
        ),
      ).toEqual([]);
      expect(log.events.filter(({ event }) => event === 'push_failed')).toEqual([
        { event: 'push_failed', reason: 'NOT_CONFIGURED', messageId },
      ]);
    },
  );
});
