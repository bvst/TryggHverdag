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
//
// LOST-07 adds a third loop, the SMS sender's, apart from the push loop and
// woken by a sweep that escalated (AC1, AC9); the worker's SMS port, which
// answers NOT_CONFIGURED until M3, said once at start (AC12); and the SMS
// check, a second minute task that reports to its own Healthchecks.io check,
// with its own setting and start line (AC10, AC11).
import {
  BEAT_RECORDED,
  CANARY_ALARM_ABORTED,
  CANARY_IDS,
  CHECKED_IN,
  CHECK_IN_ABORTED,
  MESSAGE_KINDS,
  PUSH_KINDS,
  SYNTHETIC_CHECK_UUID as CHECK,
  SYNTHETIC_PING_URL as PING_URL,
  fakeCanaryAlarm,
  fakeCheckIn,
  fakeClock,
  fakeLog,
  fakePush,
  fakeSms,
  fakeSmsAlarm,
  fakeWorkerHeartbeats,
  fc,
  pgSettingsAnswer,
  syntheticCredential,
  syntheticPingUrl,
  syntheticUuid,
  turnBound,
  type FakeLog,
  type FakePgSetting,
  type FakePostgresHandler,
  type FakePostgresQuery,
  type TurnBound,
} from '@trygghverdag/test-kit';
import { parseCrontab, run as graphileRun } from 'graphile-worker';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import process from 'node:process';
import { setTimeout as realDelay } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CONNECT_TIMEOUT_MS, POOL_SIZE, QUERY_TIMEOUT_MS, createDatabase } from './adapters/db.ts';
import { hashCredential } from './adapters/device-credentials.ts';
import { healthchecksCheckIn } from './adapters/healthchecks.ts';
import { databaseJourneyStore } from './adapters/journeys.ts';
import { databaseWorkerHeartbeats } from './adapters/worker-heartbeats.ts';
import { captured, markersIn } from './capture.test.ts';
import {
  readCanarySetting,
  readHealthchecksCanarySetting,
  readHealthchecksSetting,
  readHealthchecksSmsSetting,
  type HealthchecksSetting,
} from './config.ts';
import { WATCHDOG_INTERVAL_MS } from './domain/watchdog.ts';
import {
  HANG_CEILING_MS,
  NEVER_ANSWERED,
  STILL_WAITING,
  askedFor,
  eventually,
  listeningFakePostgres,
  listeningHungPostgres,
  listeningSilentPostgres,
  quietDatabase,
  sessionSetting,
  settledWithin,
  watchingKeepAlive,
} from './fake-postgres-server.test.ts';
import { createWatchdog, type Watchdog } from './modules/alerts/watchdog.ts';
import type { CheckIn } from './ports.ts';
import { runMain } from './process.ts';
import {
  CANARY_CRONTAB,
  CANARY_WAIT,
  HEARTBEAT_CRONTAB,
  START_LIMIT_MS as WORKER_START_LIMIT_MS,
  UNCONFIGURED_PUSH,
  UNCONFIGURED_SMS,
  createTaskList,
  runWorkerProcess,
  startWorker,
  type RunWorker,
} from './worker.ts';

const NOW = new Date('2026-09-23T22:15:00.000Z');
const SECOND = 1_000;
/** A beat at most this old is fresh: three sweeps (LOST-02, approach item 6). */
const BEAT_FRESH = 30 * SECOND;

/**
 * What a sweep and a delivery resolve to (the spec's interfaces).
 *
 * RG-03 (LOST-07, the spec's "Every exact sweep result" and its
 * `worker.test.ts` item): the sweep's result gains `escalated`, the alerts it
 * escalated, so every sweep result this file writes gains it too: the stand-
 * ins' and each `finish(…)` below, `escalated: 0` where the test is about
 * opening. What each of those tests asserts is unchanged.
 */
interface SweepResult {
  ok: boolean;
  opened: number;
  escalated: number;
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
  const runs = stubRuns<SweepResult>({ ok: true, opened: 0, escalated: 0, stuck: 0 });
  return Object.assign(runs, { sweep: runs.run });
}

/** A sender whose deliveries the test settles by hand. */
function stubSender() {
  const runs = stubRuns<DeliveryResult>({ sent: 0, failed: 0 });
  return Object.assign(runs, { deliverDue: runs.run });
}

/**
 * BUG-45 (D-129): how many runs of one loop may start with no turn of the
 * event loop between them. A loop runs again only on its WATCHDOG_INTERVAL_MS
 * timer, or at once after a run that a sweep woke while it was in flight, so a
 * correct worker starts each loop's work at most twice in a turn.
 */
const RUNS_PER_TURN = 3;

/**
 * BUG-45 (D-129): the bounds on every stand-in loop work that succeeds at
 * once, made in the running test, checked after it. Two mutants of worker.ts
 * that start a loop's next run at once rather than on its timer (271:15,
 * `again = false` made `true`; 288:15, `if (again)` made `if (true)`) turn
 * such work into a chain of promise callbacks that starves every timer,
 * Vitest's timeout included: the first test to start a worker hung, and
 * Stryker stopped it about 40 s later, as a timeout, which is not a caught
 * mutant (D-098). Bounded, the work answers only on the next turn of the
 * event loop once it passes the bound, so the timers run again, the test
 * ends, a stop included, and the check below names it, whatever the test
 * itself expected.
 */
const loopBounds: TurnBound[] = [];

afterEach(() => {
  const passed = loopBounds.splice(0).flatMap((bound) => bound.passed);
  expect(
    passed,
    'a loop of the worker started its work again and again with no turn of the event loop between (BUG-45)',
  ).toEqual([]);
});

/**
 * One loop's work that succeeds at once with what `result` makes, bounded by
 * RUNS_PER_TURN (BUG-45). Past the bound it answers a turn later, never with
 * an error: a rejected run is one the loop only writes a line about before it
 * starts the next, so an error would not break the chain.
 */
function quietWork<T>(what: string, result: () => T): () => Promise<T> {
  const bound = turnBound({ what, most: RUNS_PER_TURN });
  loopBounds.push(bound);
  return () => bound.answer(result);
}

/**
 * Loops that do nothing and succeed at once: for the tests about something
 * else, so the real watchdog and sender never reach for a database there.
 *
 * RG-03 (LOST-07, the spec's `worker.test.ts` item): the sweep's result gains
 * `escalated: 0`, and quiet stand-ins join for the SMS sender and the SMS
 * check's alarm, so that no test's worker runs a real SMS loop against a
 * database that does not exist, for the reason LOST-02's review loop 1 gave
 * for the quiet loops. Nothing any test asserts through them changes.
 *
 * RG-03 (BUG-45, D-129): each of the three works is bounded (quietWork), and
 * answers exactly as before. A worker whose loops wait between their runs
 * never reaches the bound, so nothing any test asserts through them changes.
 */
function quietLoops(): {
  watchdog: { sweep: () => Promise<SweepResult> };
  sender: { deliverDue: () => Promise<DeliveryResult> };
  smsSender: { deliverDue: () => Promise<DeliveryResult> };
  smsAlarm: { report: () => Promise<void> };
  log: FakeLog;
} {
  return {
    watchdog: {
      sweep: quietWork('the quiet sweep', () => ({ ok: true, opened: 0, escalated: 0, stuck: 0 })),
    },
    sender: { deliverDue: quietWork('the quiet delivery', () => ({ sent: 0, failed: 0 })) },
    smsSender: { deliverDue: quietWork('the quiet SMS delivery', () => ({ sent: 0, failed: 0 })) },
    smsAlarm: { report: () => Promise.resolve() },
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

/**
 * BUG-32: a runner whose start the test holds, as Graphile Worker's `run()`
 * holds its own while it opens the pool's first connections. `release` lets
 * it start as recordingRunner's does, so what then happens to it is recorded
 * the same way; `fail` makes the start reject, as one that cannot connect
 * does. Either fails the test, loudly, if the worker never asked it to start.
 */
function heldRunner() {
  const recording = recordingRunner();
  let start: { release: () => void; fail: (error: Error) => void } | undefined;
  const run = ((given: RunnerOptions) =>
    new Promise<Awaited<ReturnType<RunWorker>>>((resolve, reject) => {
      start = {
        release: () => {
          resolve(recording.run(given));
        },
        fail: reject,
      };
    })) as RunWorker;
  const asked = () => {
    if (start === undefined) {
      throw new Error('The worker never asked the runner to start.');
    }
    return start;
  };
  return {
    run,
    events: recording.events,
    /** Whether the worker has called the runner, so its start is under way. */
    starting: () => start !== undefined,
    release: () => {
      asked().release();
    },
    fail: (error: Error) => {
      asked().fail(error);
    },
  };
}

// BUG-32: CI's `integration` check on #70 (job 113295132594) saw the real
// worker, sent SIGTERM once it held a connection, die by the signal
// (`{ code: null, signal: 'SIGTERM' }`) rather than stop and exit with 0
// (D-068). runWorkerProcess put its handler on the signals only once
// startWorker had returned, and Graphile Worker's run() opens connections
// before it returns. A process with no listener for a signal takes the
// signal's default action and dies by it, so whether anything listens while
// the runner is starting is what decides it, and the first test looks at
// that before it sends the signal. On Clever Cloud this is a quick redeploy's
// SIGTERM ending a worker that is still starting: no stop, no pool ended, no
// exit with 0.
const STOP_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * BUG-32, review loop 1 (safety-reviewer, CI's blocking review of 33e27ac,
 * should-fix): how long a stop signal that came during the start waits for
 * the start to return, in ms, counted from the signal. The fix made the stop
 * wait for the start with no limit, and a start that never returns (a
 * database that accepts the connection and never answers) then held the
 * SIGTERM in silence: the real worker was still running 15 s after it, and
 * had written nothing after its four start-up lines. Before the fix the
 * signal ended it at once.
 *
 * Why 10 s: the real worker's first connection came about 0.6 s after its
 * start in BUG-32's reproduction (docs/progress/m2.md). Ten times that leaves
 * a healthy start room, and ends a stuck one, loudly, well inside a
 * platform's usual stop grace. The repository records no Clever Cloud stop
 * timeout to take instead: neither docs/plan nor infra/ names one.
 */
const START_LIMIT_MS = 10_000;

/**
 * BUG-32, review loop 1: the line a stop signal during the start writes at
 * once, so that whoever asked for the stop, often because the worker looks
 * stuck, sees in the log that it arrived and what it waits for. Its words are
 * the fix's to choose; what it must say is held here: a worker line, that a
 * stop signal came, and that it came during the start.
 */
const saysSignalDuringStart = (line: string) =>
  /^worker\b/.test(line) && /\bstop signal\b/i.test(line) && /\bstart/i.test(line);

/**
 * BUG-32, review loop 1: the line written when START_LIMIT_MS have passed
 * since the stop signal and the start has still not returned. It says so,
 * that it was the stop signal's wait, and names the limit in ms, as the
 * worker's other lines name theirs ("runs again in 10000 ms").
 */
const saysStartNeverReturned = (line: string) =>
  /^worker\b/.test(line) &&
  /\bstop signal\b/i.test(line) &&
  /\bstart/i.test(line) &&
  /\b(?:not|never) return/i.test(line) &&
  new RegExp(`\\b${String(START_LIMIT_MS)} ?ms\\b`).test(line);

describe('runWorkerProcess, when the stop signal comes while the runner is starting', () => {
  test.each(STOP_SIGNALS)(
    'BUG-32: a %s sent while the runner is still starting is not lost: once started, it stops the runner, ends the pool, and exits with 0',
    async (signal) => {
      const runner = heldRunner();
      const signals = new EventEmitter();
      const written: string[] = [];
      const exits: number[] = [];

      const running = runWorkerProcess('postgres://example/db', {
        runWorker: runner.run,
        signals,
        write: (text) => {
          written.push(text);
        },
        exit: (code) => {
          exits.push(code);
        },
        // Quiet loops, as the other runWorkerProcess tests have: this test is
        // about the signal, not the loops.
        ...quietLoops(),
      });
      await settle();
      // The window: the runner has been called, and its start has not returned.
      expect(runner.starting()).toBe(true);
      expect(
        signals.listenerCount(signal),
        `nothing listens for ${signal} while the runner is starting, so a real process would die by it`,
      ).toBeGreaterThan(0);
      signals.emit(signal);
      await settle();
      // Not before the start has returned: an exit then would cut Graphile
      // Worker's start in half and leave the pool it was handed open.
      expect(exits).toEqual([]);
      runner.release();

      await expect(running).resolves.toBeUndefined();
      await settle();
      expect(runner.events).toEqual(['runner stopped', 'pool ended']);
      expect(exits).toEqual([0]);
      expect(written.join('')).not.toContain('worker failed');
    },
  );

  test('BUG-32: a second signal after the start does not stop the worker twice', async () => {
    // Passes before the fix, on purpose: there, the SIGTERM sent during the
    // start is lost, and the SIGINT alone stops the worker. It guards the
    // fix's shape. The platform sends SIGTERM and may follow with SIGINT
    // (process.ts). A fix that took the early signal with a handler of its
    // own, and added exitOnSignal's once the start had returned, would stop
    // on both: the runner stopped twice, and the pool ended twice, which
    // throws.
    const runner = heldRunner();
    const signals = new EventEmitter();
    const exits: number[] = [];

    const running = runWorkerProcess('postgres://example/db', {
      runWorker: runner.run,
      signals,
      write: () => undefined,
      exit: (code) => {
        exits.push(code);
      },
      // Quiet loops, as the other runWorkerProcess tests have: this test is
      // about the signals, not the loops.
      ...quietLoops(),
    });
    await settle();
    signals.emit('SIGTERM');
    runner.release();
    await settle();
    signals.emit('SIGINT');

    await expect(running).resolves.toBeUndefined();
    await settle();
    expect(runner.events).toEqual(['runner stopped', 'pool ended']);
    expect(exits).toEqual([0]);
  });

  test('BUG-32: a start that fails after a SIGTERM still fails the worker, and never exits with 0', async () => {
    // Passes before the fix, on purpose: there, nothing hears the SIGTERM,
    // and the failed start rejects as it always has, which runMain turns into
    // "worker failed: …" and an exit with 1 (bin/worker.ts). It guards the
    // fix: a stop that waits for the start must not take a start that failed
    // for a clean stop. An exit with 0 says the worker stopped cleanly, and
    // one that never started watches nobody (process.ts: on any failure it
    // exits with 1 and says what failed). Which line says it, runMain's or
    // the stop's, is the fix's to choose; the rejection and the exit code are
    // not.
    const runner = heldRunner();
    const signals = new EventEmitter();
    const exits: number[] = [];

    const running = runWorkerProcess('postgres://example/db', {
      runWorker: runner.run,
      signals,
      write: () => undefined,
      exit: (code) => {
        exits.push(code);
      },
      // Quiet loops, as the other runWorkerProcess tests have: a start that
      // fails starts none, and this test is not about them.
      ...quietLoops(),
    });
    await settle();
    signals.emit('SIGTERM');
    runner.fail(new Error('could not connect'));

    await expect(running).rejects.toThrow('could not connect');
    await settle();
    expect(exits).not.toContain(0);
  });

  // BUG-32, review loop 1 (safety-reviewer, CI's blocking review of 33e27ac,
  // should-fix): the fix made a stop signal during the start wait for the
  // start, and say nothing while it waits. Against a database that accepts
  // the connection and never answers, the real worker was still running 15 s
  // after SIGTERM, with nothing written after its four start-up lines. A stop
  // the owner asks for, often because the worker looks stuck, must show in
  // the log the moment it arrives.
  test.each(STOP_SIGNALS)(
    'BUG-32: a %s during the start is said at once, in one line, before the start has returned',
    async (signal) => {
      const runner = heldRunner();
      const signals = new EventEmitter();
      const written: string[] = [];
      const exits: number[] = [];

      const running = runWorkerProcess('postgres://example/db', {
        runWorker: runner.run,
        signals,
        write: (text) => {
          written.push(text);
        },
        exit: (code) => {
          exits.push(code);
        },
        // Quiet loops, as the other runWorkerProcess tests have: this test is
        // about the signal, not the loops.
        ...quietLoops(),
      });
      await settle();
      expect(runner.starting()).toBe(true);
      signals.emit(signal);
      await settle();

      // At once: the start has not returned, nothing has stopped, no exit,
      // and the line is there.
      expect(runner.events).toEqual([]);
      expect(exits).toEqual([]);
      expect(
        linesOf(written).filter(saysSignalDuringStart),
        `nothing says the ${signal} arrived while the worker was starting`,
      ).toHaveLength(1);

      // Once the start returns, the stop runs as before, and the line is not
      // said again.
      runner.release();
      await expect(running).resolves.toBeUndefined();
      await settle();
      expect(runner.events).toEqual(['runner stopped', 'pool ended']);
      expect(exits).toEqual([0]);
      expect(linesOf(written).filter(saysSignalDuringStart)).toHaveLength(1);
    },
  );

  test('BUG-32: a stop signal after the start has returned does not write the during-the-start line', async () => {
    // Passes before the fix, on purpose: there, no such line exists. It
    // guards the fix's shape: the line says the worker is still starting, and
    // once the start has returned that is false, a line that would send
    // whoever reads the log after a hang that never happened.
    const runner = heldRunner();
    const signals = new EventEmitter();
    const written: string[] = [];
    const exits: number[] = [];

    const running = runWorkerProcess('postgres://example/db', {
      runWorker: runner.run,
      signals,
      write: (text) => {
        written.push(text);
      },
      exit: (code) => {
        exits.push(code);
      },
      // Quiet loops, as the other runWorkerProcess tests have: this test is
      // about the signal, not the loops.
      ...quietLoops(),
    });
    await settle();
    runner.release();
    await settle();
    signals.emit('SIGTERM');

    await expect(running).resolves.toBeUndefined();
    await settle();
    expect(exits).toEqual([0]);
    expect(linesOf(written).filter(saysSignalDuringStart)).toEqual([]);
  });

  test('BUG-32: a stop signal during a start that never returns ends the worker 10 000 ms after the signal: one line says the start had not returned, then it exits with 1', async () => {
    // BUG-32, review loop 1 (safety-reviewer): the stop waited for the start
    // with no limit, so a start that never returns held the signal until the
    // platform killed the process. Now the wait has a limit, counted from the
    // signal, and running out of it is a failure: said, and an exit with 1,
    // so the platform restarts the worker and the log says why.
    //
    // Only setTimeout and clearTimeout are faked, as in the loops' tests:
    // settle() still turns on the real setImmediate. So the limit is held as
    // measured on the global setTimeout; a timer from node:timers/promises
    // would not be faked, and this test would wait for it in vain.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const runner = heldRunner();
      const signals = new EventEmitter();
      const output: string[] = [];
      const exits: number[] = [];

      void runWorkerProcess('postgres://example/db', {
        runWorker: runner.run,
        signals,
        write: (text) => {
          output.push(text);
        },
        exit: (code) => {
          exits.push(code);
          output.push(`exit ${String(code)}\n`);
        },
        // Quiet loops, as the other runWorkerProcess tests have: a start that
        // never returns starts none, and this test is not about them.
        ...quietLoops(),
      });
      await settle();
      expect(runner.starting()).toBe(true);
      // The start has hung a while before the stop comes: the limit counts
      // from the signal, not from the start.
      await vi.advanceTimersByTimeAsync(START_LIMIT_MS / 2);
      signals.emit('SIGTERM');
      await settle();

      // Just under the limit: still waiting for the start, as a slow start
      // deserves.
      await vi.advanceTimersByTimeAsync(START_LIMIT_MS - 1);
      await settle();
      expect(exits, 'the worker gave up on its start before the limit').toEqual([]);
      expect(linesOf(output).filter(saysStartNeverReturned)).toEqual([]);

      const linesBefore = linesOf(output).length;
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(
        exits,
        `still waiting for the start ${String(START_LIMIT_MS)} ms after the stop signal`,
      ).toEqual([1]);
      const linesAtLimit = linesOf(output).slice(linesBefore);
      expect(
        linesAtLimit.filter(saysStartNeverReturned),
        'no one line says the start had not returned within the limit after the stop signal',
      ).toHaveLength(1);
      // Said before the exit, so a log that ends at the exit holds it.
      expect(linesAtLimit.at(-1)).toBe('exit 1');
      // The runner never started, so there was nothing to stop.
      expect(runner.events).toEqual([]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  test('BUG-32: a start that returns within the limit still stops cleanly with 0, and the limit never fires after it', async () => {
    // Passes before the fix, on purpose: there is no limit yet. It guards the
    // limit's shape: a limit whose timer writes and exits by itself, left
    // running once the start has returned, would, 10 000 ms after the signal,
    // write that the start had not returned and exit with 1 after a clean
    // stop had exited with 0. The start here is slow, 1 s inside the limit,
    // so such a timer would still be due.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const runner = heldRunner();
      const signals = new EventEmitter();
      const written: string[] = [];
      const exits: number[] = [];

      const running = runWorkerProcess('postgres://example/db', {
        runWorker: runner.run,
        signals,
        write: (text) => {
          written.push(text);
        },
        exit: (code) => {
          exits.push(code);
        },
        // Quiet loops, as the other runWorkerProcess tests have: this test is
        // about the signal and the limit, not the loops.
        ...quietLoops(),
      });
      await settle();
      signals.emit('SIGTERM');
      await settle();
      await vi.advanceTimersByTimeAsync(START_LIMIT_MS - SECOND);
      runner.release();

      await expect(running).resolves.toBeUndefined();
      await settle();
      expect(runner.events).toEqual(['runner stopped', 'pool ended']);
      expect(exits).toEqual([0]);

      const linesAtExit = linesOf(written).length;
      await vi.advanceTimersByTimeAsync(2 * START_LIMIT_MS);
      await settle();
      expect(exits).toEqual([0]);
      expect(linesOf(written).slice(linesAtExit), 'written after the exit with 0').toEqual([]);
      expect(linesOf(written).filter(saysStartNeverReturned)).toEqual([]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  test('BUG-32: with a stop signal during the start, the stop still waits for the limits read-back: it reaches the database and is answered before the pool ends (D-109)', async () => {
    // BUG-32, review loop 1 (test-auditor, fault M12). Passes today, on
    // purpose: a guard. D-109 says the stop waits for the read-back, and on
    // this path that holds only by the order of two awaits of one promise:
    // runWorkerProcess's `await started` was registered before the stop's, so
    // its continuation starts the read-back first. Started one macrotask
    // later, the stop begins first, finds no read-back to wait for, and ends
    // the pool; the read-back then never reaches the database. Shown failing
    // under that fault, applied in memory only (BUG-32 review loop 1's
    // handoff).
    //
    // The read-back's answer is held, as in LOST-02-AC17's test above, so the
    // stop is seen waiting for a read-back in flight, not merely after one.
    const database = await listeningFakePostgres(
      (query) => pgSettingsAnswer(query, LIMITS_AS_ASKED) ?? quietDatabase(query),
    );
    const read = database.holdAnswer(/\bpg_settings\b/);
    const runner = heldRunner();
    const signals = new EventEmitter();
    const running = runWorkerProcess(database.url, {
      runWorker: runner.run,
      signals,
      ...quietLoops(),
      write: (text) => {
        if (/\bsession limits?\b/.test(text)) {
          runner.events.push(text.trim());
        }
      },
      exit: (code) => {
        runner.events.push(`exit ${String(code)}`);
      },
    });
    try {
      await settle();
      expect(runner.starting()).toBe(true);
      signals.emit('SIGTERM');
      await settle();
      runner.release();

      expect(
        await eventually(() => read.arrived()),
        'the limits read-back never reached the database: the stop ended the pool before it',
      ).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Still waiting for the read-back: no line, the pool open, no exit.
      expect(runner.events.filter((event) => event !== 'runner stopped')).toEqual([]);
      read.release();
      expect(await eventually(() => runner.events.includes('exit 0'))).toBe(true);
      await running;

      expect(runner.events).toContain('runner stopped');
      // RG-03 (BUG-51, D-132): the read-back reports statement_timeout too,
      // so its one line names both limits. The order it holds is unchanged.
      expect(runner.events.filter((event) => event !== 'runner stopped')).toEqual([
        'worker: session limits in force: idle_in_transaction_session_timeout=10000ms statement_timeout=10000ms',
        'pool ended',
        'exit 0',
      ]);
    } finally {
      read.release();
      await database.close();
    }
  });
});

// BUG-34 (safety-reviewer, on BUG-32): against a database that accepts the
// connection and never answers, the real worker's start never returned nor
// rejected, and nothing was written after its start-up lines. BUG-32's limit
// ends such a start only after a stop signal; with none, the worker waited
// for ever, and a worker stuck there watches nobody: no sweep, no beat, and
// Healthchecks.io pages only about 3 minutes later. Now the pool's first
// connection gives up after CONNECT_TIMEOUT_MS (db.test.ts shows each pool),
// and the start fails with it, so runMain says so and exits with 1, and the
// platform restarts the worker.
//
// The start here is the real one: the real createPool and the real Graphile
// Worker run(), whose first act is to take a connection for its migrations,
// against the silent server. pg's timer is the global setTimeout, driven by
// the fake one, so the bound is exact; the tests' own waits are real and
// generous (settledWithin, HANG_CEILING_MS), so only a hang reaches them.
describe('BUG-34: the worker against a database that accepts the connection and never answers', () => {
  /** How long a check that something has not happened yet waits, in real ms. */
  const NOT_YET_MS = 100;

  // BUG-34, review loop 1 (safety-reviewer and test-auditor): the tests below
  // hold the start to CONNECT_TIMEOUT_MS whatever its value, so 10 s or 60 s
  // passed them all. What fixes the value is its reason in db.ts: half the
  // worker's START_LIMIT_MS, so a start against a silent database fails on its
  // own cause before a stop signal's limit would end it. The limit is the one
  // worker.ts exports. This file's own START_LIMIT_MS, above, stays: it pins
  // the 10 s BUG-32's tests hold, and taking the export in its place would let
  // a change to the limit pass them. So this test also says the two agree.
  test('BUG-34: CONNECT_TIMEOUT_MS is shorter than the worker’s START_LIMIT_MS, so a start against a silent database fails on its own cause before a stop signal’s limit would end it', () => {
    expect(WORKER_START_LIMIT_MS, 'the limit BUG-32’s tests pin').toBe(START_LIMIT_MS);
    expect(CONNECT_TIMEOUT_MS).toBeLessThan(WORKER_START_LIMIT_MS);
  });

  /**
   * BUG-34, review loop 1: the slowest whole start BUG-32 measured, in ms:
   * the real worker's first connection came 0.6 to 1.1 s after the process
   * started, process start included, against a local PostgreSQL
   * (docs/progress/m2.md). Any handshake inside such a start took less, so a
   * timeout above it would have cut off none of them. A floor only: the
   * handshake to Clever Cloud over the network has not been measured.
   */
  const SLOWEST_MEASURED_START_MS = 1_100;

  test('BUG-34: CONNECT_TIMEOUT_MS is longer than the slowest whole start BUG-32 measured, so no start measured healthy would have been cut off', () => {
    expect(
      CONNECT_TIMEOUT_MS,
      `CONNECT_TIMEOUT_MS must exceed ${String(SLOWEST_MEASURED_START_MS)} ms, the slowest whole start BUG-32 measured`,
    ).toBeGreaterThan(SLOWEST_MEASURED_START_MS);
  });

  test('BUG-34: startWorker, with the real Graphile Worker and no stop signal, rejects once CONNECT_TIMEOUT_MS have passed since it asked for its first connection, and not before', async () => {
    const database = await listeningSilentPostgres();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // Quiet loops, as elsewhere: they start only after the runner has, and
    // this test is about the start.
    const started = startWorker(database.url, graphileRun, {
      write: () => undefined,
      ...quietLoops(),
    }).then(
      () => 'started',
      (error: unknown) => error,
    );
    try {
      expect(
        await settledWithin(database.heard(), HANG_CEILING_MS),
        'the worker never asked the database for a connection',
      ).toBeUndefined();

      await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS - 1);
      expect(await settledWithin(started, NOT_YET_MS)).toBe(STILL_WAITING);

      await vi.advanceTimersByTimeAsync(1);
      vi.useRealTimers();
      expect(
        await settledWithin(started, HANG_CEILING_MS),
        `the start had neither returned nor failed ${String(CONNECT_TIMEOUT_MS)} ms after it asked for a connection`,
      ).toBeInstanceOf(Error);
    } finally {
      vi.useRealTimers();
      // Closing the server fails a start still waiting, so none outlives the test.
      await database.close();
      await settledWithin(started, HANG_CEILING_MS);
    }
  });

  test('BUG-34: the worker process then says in one line that it failed and why, without the password, and exits with 1: it does not wait for a stop signal', async () => {
    const marker = syntheticCredential();
    const database = await listeningSilentPostgres({ password: marker });
    const written: string[] = [];
    let exited: (code: number) => void = () => undefined;
    const exit = new Promise<number>((resolve) => {
      exited = resolve;
    });
    const reporting = {
      write: (text: string) => {
        written.push(text);
      },
      exit: (code: number) => {
        exited(code);
      },
    };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      // As bin/worker.ts runs it, with the real Graphile Worker (the
      // default), and signals that never come.
      runMain(
        'worker',
        () =>
          runWorkerProcess(database.url, {
            signals: new EventEmitter(),
            log: fakeLog(),
            ...reporting,
          }),
        reporting,
      );
      expect(await settledWithin(database.heard(), HANG_CEILING_MS)).toBeUndefined();

      await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
      vi.useRealTimers();

      expect(
        await settledWithin(exit, HANG_CEILING_MS),
        `no exit ${String(CONNECT_TIMEOUT_MS)} ms after the worker asked for a connection`,
      ).toBe(1);
      const failed = linesOf(written).filter((line) => line.startsWith('worker failed: '));
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatch(/\btime(?:d)? ?out\b|\btimeout\b/i);
      expect(written.join('')).not.toContain(marker);
    } finally {
      vi.useRealTimers();
      await database.close();
      await settledWithin(exit, HANG_CEILING_MS);
    }
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
/**
 * GRP-01-AC25: the worker's check-in withheld because the SMS check is not
 * reporting. The Healthchecks.io line says it is withheld and names the SMS
 * check's setting, never its value. It does not say "SMS check" itself, so
 * the SMS check's own line, which says why it does not report and what then
 * goes unpaged, stays the one line that does.
 */
const WITHHELD = /\bwithheld\b.*\bHEALTHCHECKS_SMS_URL\b|\bHEALTHCHECKS_SMS_URL\b.*\bwithheld\b/;
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
/**
 * RG-03 (GRP-01-AC25, D-122, D-137; not in the spec's "Existing assertions
 * that change by design", which missed it): since GRP-01 the worker checks in
 * only while its SMS check reports, so the INF-08 tests below, which are about
 * the check-in itself, are given what staging runs: when the worker's URL is
 * usable, a usable SMS check URL of its own, a different synthetic check,
 * unless a test says otherwise. Every assertion they make is unchanged; the
 * withheld check-in is GRP-01-AC25's, tested on its own below.
 */
function workerProcess({
  healthchecks,
  instanceType,
  createCheckIn,
  healthchecksSms = healthchecks.checkingIn
    ? readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: syntheticPingUrl() })
    : undefined,
}: {
  healthchecks: HealthchecksSetting;
  instanceType?: string;
  createCheckIn?: ((url: string) => CheckIn) | 'default';
  healthchecksSms?: HealthchecksSetting | undefined;
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
    ...(healthchecksSms === undefined ? {} : { healthchecksSms }),
    createSmsAlarm: () => fakeSmsAlarm(),
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
        // RG-03 (GRP-01-AC25): the check-in runs only beside a reporting SMS
        // check, so this is given one of its own, as staging has.
        healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: syntheticPingUrl() }),
        createSmsAlarm: () => fakeSmsAlarm(),
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

  /**
   * A worker whose loops run the stubs, on fake timers: only setTimeout, which the loops keep time with.
   *
   * RG-03 (LOST-07; not in the spec's list, which names quietLoops() for the
   * same reason): the worker gains a third loop, the SMS sender's. Left real
   * here, it would claim from a database that does not exist every 10 s, and
   * stop() would wait for that claim. So it gets a stand-in that succeeds at
   * once, as quietLoops() gives one, unless a test hands in its own. The
   * tests about the sweep and the delivery assert what they did before.
   *
   * RG-03 (BUG-45, D-129): that stand-in is bounded, as quietLoops()' are
   * (quietWork), and answers exactly as before. Unbounded, it was what hung
   * these tests under worker.ts's two "run again at once" mutants: the SMS
   * loop's chain of promise callbacks starved the fake timers' own turns.
   */
  async function looping({
    smsSender = {
      deliverDue: quietWork('the quiet SMS delivery', () => ({ sent: 0, failed: 0 })),
    },
  }: { smsSender?: { deliverDue: () => Promise<DeliveryResult> } } = {}) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const watchdog = stubWatchdog();
    const sender = stubSender();
    const written: string[] = [];
    const runner = recordingRunner();
    const worker = await startWorker('postgres://example/db', runner.run, {
      watchdog,
      sender,
      smsSender,
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

    watchdog.finish({ ok: true, opened: 1, escalated: 0, stuck: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.count).toBe(2);
    sender.finish();

    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(watchdog.count).toBe(2);
    const deliveries = sender.count;
    sender.finish();
    watchdog.finish({ ok: true, opened: 0, escalated: 0, stuck: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.count).toBe(deliveries);
  });

  test('LOST-02-AC21: a sweep that opens an alert while a delivery is in flight gets a delivery as soon as that one finishes, not 10 s later', async () => {
    const { watchdog, sender } = await looping();

    watchdog.finish({ ok: true, opened: 2, escalated: 0, stuck: 0 });
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
    watchdog.finish({ ok: true, opened: 1, escalated: 0, stuck: 0 });
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
    watchdog.finish({ ok: true, opened: 1, escalated: 0, stuck: 0 });
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
    watchdog.finish({ ok: true, opened: 1, escalated: 0, stuck: 0 });
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
    watchdog.finish({ ok: true, opened: 3, escalated: 0, stuck: 0 });
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

  // BUG-45 (D-129): Stryker scored two mutants of worker.ts as timed out,
  // about 40 s each: `again = false` at 271:15 made `true`, and `if (again)`
  // at 288:15 made `if (true)`. Either starts a loop's next run as soon as the
  // last one finished, with no WATCHDOG_INTERVAL_MS timer between; over work
  // that answers at once, that is a chain of promise callbacks that starved
  // every timer, Vitest's timeout included. With every quiet work bounded
  // (quietWork), these fail at once on either mutant, and the worker is
  // stopped whatever happened.

  test('BUG-45-AC12: a run nobody woke while it was in flight is followed by its loop’s 10 s timer, never by a second run at once: each loop’s work runs once at start, and again only 10 s later (worker.ts:288)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const calls = { sweep: 0, delivery: 0, sms: 0 };
    const counted =
      <T>(loop: keyof typeof calls, work: () => Promise<T>) =>
      (): Promise<T> => {
        calls[loop] += 1;
        return work();
      };
    const quiet = quietLoops();
    const worker = await startWorker('postgres://example/db', recordingRunner().run, {
      ...quiet,
      watchdog: { sweep: counted('sweep', quiet.watchdog.sweep) },
      sender: { deliverDue: counted('delivery', quiet.sender.deliverDue) },
      smsSender: { deliverDue: counted('sms', quiet.smsSender.deliverDue) },
      write: () => undefined,
    });

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toEqual({ sweep: 1, delivery: 1, sms: 1 });
      await vi.advanceTimersByTimeAsync(10 * SECOND - 1);
      expect(calls).toEqual({ sweep: 1, delivery: 1, sms: 1 });
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toEqual({ sweep: 2, delivery: 2, sms: 2 });
    } finally {
      await worker.stop();
    }
  });

  test('BUG-45-AC12: a delivery a sweep asked for while one was in flight runs once at once when that one finishes, and the run after it waits for the 10 s timer: what was asked for is forgotten once a run starts (worker.ts:271)', async () => {
    const { watchdog, sender, worker } = await looping();

    try {
      // A sweep that opened an alert while the first delivery is in flight:
      // one more delivery is owed.
      watchdog.finish({ ok: true, opened: 1, escalated: 0, stuck: 0 });
      await vi.advanceTimersByTimeAsync(0);
      expect(sender.count).toBe(1);
      sender.finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(sender.count).toBe(2);

      // Nothing more is owed: the next delivery waits for the timer.
      sender.finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(sender.count).toBe(2);
      await vi.advanceTimersByTimeAsync(10 * SECOND - 1);
      expect(sender.count).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(sender.count).toBe(3);
    } finally {
      const stopping = worker.stop();
      watchdog.finish();
      sender.finish();
      await vi.advanceTimersByTimeAsync(0);
      await stopping;
    }
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
      // RG-03 (GRP-01-AC25): the check-in runs only beside a reporting SMS
      // check, so this is given one of its own, as staging has.
      healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: syntheticPingUrl() }),
      createSmsAlarm: () => fakeSmsAlarm(),
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
      // RG-03 (GRP-01-AC25): the check-in runs only beside a reporting SMS
      // check, so this is given one of its own, as staging has.
      healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: syntheticPingUrl() }),
      createSmsAlarm: () => fakeSmsAlarm(),
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

/**
 * What the worker asks for, as pg_settings reports it when the startup
 * parameters arrived.
 *
 * RG-03 (BUG-51, D-132): statement_timeout joins the idle limit, because the
 * worker now asks for it and reads it back too, so this was renamed from
 * IDLE_AS_ASKED. Each test that took it as "everything in force" still does.
 */
const LIMITS_AS_ASKED: Record<string, FakePgSetting> = {
  idle_in_transaction_session_timeout: { setting: '10000', unit: 'ms' },
  statement_timeout: { setting: '10000', unit: 'ms' },
};

/** statement_timeout as the worker asks for it, in force (BUG-51, D-132). */
const STATEMENT_AS_ASKED: Record<string, FakePgSetting> = {
  statement_timeout: { setting: '10000', unit: 'ms' },
};

/** The lines a worker wrote about its session limits. */
const limitLines = (written: string[]) =>
  linesOf(written).filter((line) => /\bsession limits?\b/.test(line));

/** The worker's line for a statement_timeout read back as 0 (BUG-51, D-132), word for word. */
const STATEMENT_TIMEOUT_DROPPED =
  'worker: session limit statement_timeout is 0ms, not 10000ms: a slow statement is cut off only by the query limit, which closes its connection.';

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
      (query) => pgSettingsAnswer(query, LIMITS_AS_ASKED) ?? quietDatabase(query),
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
    //
    // RG-03 (LOST-02, review loop 2, test-auditor): the pattern was
    // /\bwrite\s*[:,]/, which missed `{ …, write }` as the last property and
    // a `write(text) {…}` method. It now finds a property named write in any
    // of the three shapes, and still not a member such as
    // process.stderr.write(…) or the word in a comment. Held below, both ways.
    const passesAWriter = /(?<![.\w$])write\s*(?:[:,}]|\([^)]*\)\s*\{)/;
    for (const shape of [
      'runWorkerProcess(url, { write: (text) => undefined })',
      'runWorkerProcess(url, { healthchecks, write })',
      'runWorkerProcess(url, { write, healthchecks })',
      'runWorkerProcess(url, { write(text) { log(text); } })',
    ]) {
      expect(shape, shape).toMatch(passesAWriter);
    }
    for (const other of [
      'process.stderr.write(text);',
      '// what the worker would write to stderr',
      'const writeToStderr = () => undefined;',
    ]) {
      expect(other, other).not.toMatch(passesAWriter);
    }
    const entry = readFileSync(new URL('bin/worker.ts', import.meta.url), 'utf8');
    expect(entry).toMatch(/runWorkerProcess\(/);
    expect(entry).not.toMatch(passesAWriter);

    const database = await listeningFakePostgres(
      (query) => pgSettingsAnswer(query, LIMITS_AS_ASKED) ?? quietDatabase(query),
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

    // RG-03 (BUG-51, D-132): the line names statement_timeout too.
    expect(limitLines(toStderr)).toEqual([
      'worker: session limits in force: idle_in_transaction_session_timeout=10000ms statement_timeout=10000ms',
    ]);
    expect(toStdout.join('')).not.toMatch(/\bsession limits?\b/);
  });

  // RG-03 (BUG-51, D-132): statement_timeout is given as in force, so the
  // one limit with no row is still the idle limit alone.
  test('LOST-02-AC17: a limit pg_settings returns no row for is written as unreadable, not in force', async () => {
    const { written } = await workerReadingBack(
      (query) => pgSettingsAnswer(query, STATEMENT_AS_ASKED) ?? quietDatabase(query),
    );

    expect(limitLines(written)).toEqual([IDLE_UNREADABLE]);
  });

  test.each(['10000x', 'x10000', '10 000'])(
    'LOST-02-AC17: a setting with anything around its digits (10000x, x10000, 10 000) is written as unreadable — %s',
    async (setting) => {
      // RG-03 (BUG-51, D-132): statement_timeout in force, so only the idle
      // limit is unreadable, as before.
      const { written } = await workerReadingBack(
        (query) =>
          pgSettingsAnswer(query, {
            ...STATEMENT_AS_ASKED,
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
      // RG-03 (BUG-51, D-132): statement_timeout in force, so only the idle
      // limit is unreadable, as before.
      const { written } = await workerReadingBack(
        (query) =>
          pgSettingsAnswer(query, {
            ...STATEMENT_AS_ASKED,
            idle_in_transaction_session_timeout: { setting: '10000', unit },
          }) ?? quietDatabase(query),
      );

      expect(limitLines(written)).toEqual([IDLE_UNREADABLE]);
      expect(written.join('')).not.toContain(`10000${unit}`);
    },
  );

  // RG-03 (BUG-51, D-132): the read-back reports statement_timeout too, so
  // the one read names it as well, and the one line names both limits.
  // Nothing this test held before is dropped.
  test('LOST-02-AC17: at start the worker reads idle_in_transaction_session_timeout and statement_timeout back from pg_settings and writes exactly one line: worker: session limits in force: idle_in_transaction_session_timeout=10000ms statement_timeout=10000ms', async () => {
    const { database, written } = await workerReadingBack(
      (query) => pgSettingsAnswer(query, LIMITS_AS_ASKED) ?? quietDatabase(query),
    );

    expect(
      database.queries.filter(
        ({ text, values }) =>
          /\bpg_settings\b/.test(text) &&
          `${text} ${values.join(' ')}`.includes('idle_in_transaction_session_timeout') &&
          `${text} ${values.join(' ')}`.includes('statement_timeout'),
      ),
    ).toHaveLength(1);
    expect(limitLines(written)).toEqual([
      'worker: session limits in force: idle_in_transaction_session_timeout=10000ms statement_timeout=10000ms',
    ]);
  });

  // RG-03 (BUG-51, D-132): a pooler that dropped the startup parameters
  // drops statement_timeout too, so it is 0 here as well, and its own line
  // follows the idle limit's. The idle limit's line is held as before.
  //
  // RG-03 (BUG-51, review loop 1, test-auditor's F22): statement_timeout's
  // line was matched only up to its reason (`.+`), so a reworded reason
  // passed. It is now pinned word for word, as the idle limit's is.
  test('LOST-02-AC17: when the database reports an idle limit other than the one asked for, as a pooler that dropped the startup parameters would, the worker writes the fixed mismatch line, and still sweeps', async () => {
    const { written, watchdog } = await workerReadingBack(
      (query) =>
        pgSettingsAnswer(query, {
          idle_in_transaction_session_timeout: { setting: '0', unit: 'ms' },
          statement_timeout: { setting: '0', unit: 'ms' },
        }) ?? quietDatabase(query),
    );

    expect(limitLines(written)).toEqual([
      'worker: session limit idle_in_transaction_session_timeout is 0ms, not 10000ms: a stalled transaction will not be ended.',
      STATEMENT_TIMEOUT_DROPPED,
    ]);
    expect(watchdog.count).toBeGreaterThan(0);
  });

  test('LOST-02-AC17: a limit that is not digits and a unit is written as unreadable, a failed read gives one line with its SQLSTATE, and no start-up line holds the connection URL, its password marker or an error message', async () => {
    const marker = syntheticCredential();
    // RG-03 (BUG-51, D-132): statement_timeout in force, so only the idle
    // limit is unreadable, as before.
    const unreadable = await workerReadingBack(
      (query) =>
        pgSettingsAnswer(query, {
          ...STATEMENT_AS_ASKED,
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

// ---------------------------------------------------------------------------
// BUG-51 (D-132): the worker's pool bounds every query once its connection is
// up. Each connection asks for statement_timeout and has TCP keepalive on; a
// query the database never answers fails once QUERY_TIMEOUT_MS have passed,
// made and released as Graphile Worker's are; a sweep held that way ends as a
// failed sweep, and the next one runs on a new connection; the read-back
// reports statement_timeout; and stop(), which waits for the read-back, waits
// no longer than the limit. How the pool itself behaves is in db.test.ts:
// this is the pool startWorker makes and hands Graphile Worker.
//
// The limit is driven with Vitest's fake setTimeout, as BUG-34's tests drive
// pg's; the tests' own waits are real (settledWithin, HANG_CEILING_MS).
// ---------------------------------------------------------------------------

/** A database's now(), as PostgreSQL writes it, for the reads a sweep makes. */
const SWEEP_NOW = '2031-02-03 04:05:06.789+00';

/**
 * BUG-51: a database with nothing in it but its clock. A read that asks for
 * now() gets one row, its now() and nothing else, as the sweep's left joins
 * give when no journey or alert is due; anything else gets no row.
 */
const emptyButTheClock: FakePostgresHandler = (query) => {
  const columns = askedFor(query.text);
  return columns.includes('now')
    ? { columns, rows: [columns.map((column) => (column === 'now' ? SWEEP_NOW : null))] }
    : quietDatabase(query);
};

/**
 * Waits in real 1 ms turns, which Vitest's fake timers leave alone, until
 * `check` holds or HANG_CEILING_MS have passed.
 */
async function untilReally(check: () => boolean): Promise<boolean> {
  const deadline = performance.now() + HANG_CEILING_MS;
  while (!check() && performance.now() < deadline) {
    await realDelay(1);
  }
  return check();
}

describe('BUG-51: the worker against a database that completes the startup and never answers a query', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** How long a check that something has not happened yet waits, in real ms. */
  const NOT_YET_MS = 100;

  test('BUG-51: the worker’s pool asks, in the startup of every connection it makes, for statement_timeout 10 000 ms', async () => {
    const database = await listeningFakePostgres(quietDatabase);
    const runner = recordingRunner();
    const worker = await startWorker(database.url, runner.run, {
      ...quietLoops(),
      write: () => undefined,
    });

    try {
      await runner.options()?.pgPool?.query('select 1');

      // A startup parameter, as D-132 says, like the idle limit before it:
      // in force before the connection's first statement.
      const connections = database.connections();
      expect(connections.length).toBeGreaterThan(0);
      for (const connection of connections) {
        expect(connection.parameters['statement_timeout']).toBe('10000');
      }
    } finally {
      await worker.stop();
      await database.close();
    }
  });

  test('BUG-51: every connection the worker’s pool makes has TCP keepalive turned on', async () => {
    const database = await listeningFakePostgres(quietDatabase);
    const keepAlive = watchingKeepAlive();
    const runner = recordingRunner();
    const worker = await startWorker(database.url, runner.run, {
      ...quietLoops(),
      write: () => undefined,
    });

    try {
      const pool = runner.options()?.pgPool;
      if (pool === undefined) {
        throw new Error('the runner was never given a pool');
      }
      const first = await pool.connect();
      const second = await pool.connect();
      first.release();
      second.release();

      expect(database.connections()).toHaveLength(2);
      expect(keepAlive.socketsTo(database.url), 'connections made with no TCP keepalive').toBe(2);
    } finally {
      keepAlive.restore();
      await worker.stop();
      await database.close();
    }
  });

  // RG-03 (BUG-51, review loop 1, test-auditor's F22): the line was matched
  // only up to its reason (`.+`), so a reworded reason passed. It is now
  // pinned word for word.
  test('BUG-51: when the database reports a statement_timeout other than 10 000 ms, as a pooler that dropped it would, the worker writes one line saying so, naming statement_timeout, and still sweeps', async () => {
    const { written, watchdog } = await workerReadingBack(
      (query) =>
        pgSettingsAnswer(query, {
          ...LIMITS_AS_ASKED,
          statement_timeout: { setting: '0', unit: 'ms' },
        }) ?? quietDatabase(query),
    );

    expect(limitLines(written)).toEqual([STATEMENT_TIMEOUT_DROPPED]);
    expect(watchdog.count).toBeGreaterThan(0);
  });

  test('BUG-51: on the pool startWorker hands Graphile Worker, a query made and released as Graphile’s withPgClient makes and releases it, which the database never answers, rejects once QUERY_TIMEOUT_MS have passed, and not before; the next one gets a new connection, which the database, answering again, answers', async () => {
    let answering = false;
    const database = await listeningHungPostgres(() =>
      answering ? { columns: ['answer'], rows: [['42']] } : NEVER_ANSWERED,
    );
    const runner = recordingRunner();
    let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      worker = await startWorker(database.url, runner.run, {
        ...quietLoops(),
        write: () => undefined,
      });
      const pool = runner.options()?.pgPool;
      if (pool === undefined) {
        throw new Error('the runner was never given a pool');
      }
      // As graphile-worker 0.18 makes it (dist/helpers.js,
      // makeWithPgClientFromPool): released in a `finally`, without an error.
      const withPgClient = async <T>(callback: (client: PoolClient) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try {
          return await callback(client);
        } finally {
          client.release();
        }
      };
      const first = withPgClient((client) => client.query('select 1')).then(
        () => 'answered',
        (error: unknown) => error,
      );
      expect(
        await settledWithin(database.hanging(), HANG_CEILING_MS),
        'the query never reached the database',
      ).toBeUndefined();

      await vi.advanceTimersByTimeAsync(QUERY_TIMEOUT_MS - 1);
      expect(await settledWithin(first, NOT_YET_MS)).toBe(STILL_WAITING);

      await vi.advanceTimersByTimeAsync(1);
      vi.useRealTimers();
      expect(
        await settledWithin(first, HANG_CEILING_MS),
        `the query was still waiting ${String(QUERY_TIMEOUT_MS)} ms after the database stopped answering it`,
      ).toBeInstanceOf(Error);

      answering = true;
      const next = withPgClient((client) =>
        client.query<{ answer: string }>('select 42 as answer'),
      ).then(
        (result) => result.rows,
        (error: unknown) => error,
      );
      expect(await settledWithin(next, HANG_CEILING_MS), 'the next query was not answered').toEqual(
        [{ answer: '42' }],
      );
      const [hung] = database.hung();
      const answeredOn = database
        .connections()
        .filter((connection) =>
          connection.queries.some(({ text }) => text === 'select 42 as answer'),
        );
      expect(answeredOn).toHaveLength(1);
      expect(answeredOn[0]).not.toBe(hung);
    } finally {
      vi.useRealTimers();
      await database.close();
      if (worker !== undefined) {
        await settledWithin(worker.stop(), HANG_CEILING_MS);
      }
    }
  });

  // RG-03 (BUG-51, review loop 1, privacy-security-reviewer): the hung
  // server's URL now carries a password marker, which it never asks for, and
  // the worker's writer keeps what it is given rather than dropping it, and
  // stdout and stderr are kept for the test's length. One check is added:
  // nothing the worker wrote, logged or printed holds the marker or the URL.
  // No assertion this test held is changed.
  test('BUG-51: a sweep over the worker’s pool whose read the database never answers ends with ok: false once QUERY_TIMEOUT_MS have passed, and not before, with one watchdog_failed line for its read; the next sweep runs WATCHDOG_INTERVAL_MS later on a new connection and, with the database answering again, succeeds and records the beat', async () => {
    let answering = false;
    const marker = syntheticCredential();
    const database = await listeningHungPostgres(
      (query) => (answering ? emptyButTheClock(query) : NEVER_ANSWERED),
      { password: marker },
    );
    const written: string[] = [];
    const runner = recordingRunner();
    const log = fakeLog();
    const loops = quietLoops();
    const sweeps: SweepResult[] = [];
    let watching: Watchdog | undefined;
    // The real watchdog over the pool startWorker made, built as startWorker
    // builds its own, with each sweep's result kept.
    const watchdog = {
      sweep: async (): Promise<SweepResult> => {
        const pool = runner.options()?.pgPool;
        if (pool === undefined) {
          throw new Error('the runner was never given a pool');
        }
        const db = createDatabase(pool);
        watching ??= createWatchdog({
          journeys: databaseJourneyStore(db),
          beats: databaseWorkerHeartbeats(db),
          log,
        });
        const result = await watching.sweep();
        sweeps.push(result);
        return result;
      },
    };
    let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
    const printed: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      printed.push(String(chunk));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      printed.push(String(chunk));
      return true;
    });
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      worker = await startWorker(database.url, runner.run, {
        watchdog,
        sender: loops.sender,
        smsSender: loops.smsSender,
        log,
        write: (text) => {
          written.push(text);
        },
      });
      expect(
        await settledWithin(database.hanging(), HANG_CEILING_MS),
        'the sweep’s read never reached the database',
      ).toBeUndefined();
      const [hung] = database.hung();
      expect(hung?.queries.map(({ text }) => text)).toEqual([
        expect.stringMatching(/\bleft join "?journeys"?/i),
      ]);

      await vi.advanceTimersByTimeAsync(QUERY_TIMEOUT_MS - 1);
      expect(sweeps).toEqual([]);
      expect(log.events.filter(({ event }) => event === 'watchdog_failed')).toEqual([]);

      answering = true;
      await vi.advanceTimersByTimeAsync(1);
      expect(
        await untilReally(() => sweeps.length === 1),
        `the sweep was still running ${String(QUERY_TIMEOUT_MS)} ms after the database stopped answering its read`,
      ).toBe(true);
      expect(sweeps[0]?.ok).toBe(false);
      expect(log.events.filter(({ event }) => event === 'watchdog_failed')).toEqual([
        expect.objectContaining({ event: 'watchdog_failed', stage: 'read' }),
      ]);

      // The loop sets its timer once the sweep has settled: a real turn first.
      await realDelay(1);
      await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);
      expect(
        await untilReally(() => sweeps.length === 2),
        `no sweep ran ${String(WATCHDOG_INTERVAL_MS)} ms after the one that failed`,
      ).toBe(true);
      expect(sweeps[1]).toEqual({ ok: true, opened: 0, escalated: 0, stuck: 0 });
      const beatOn = database
        .connections()
        .filter((connection) =>
          connection.queries.some(({ text }) => /\binsert into "?worker_heartbeat"?/i.test(text)),
        );
      expect(beatOn).toHaveLength(1);
      expect(beatOn[0]).not.toBe(hung);
    } finally {
      vi.useRealTimers();
      await database.close();
      if (worker !== undefined) {
        await settledWithin(worker.stop(), HANG_CEILING_MS);
      }
      stdout.mockRestore();
      stderr.mockRestore();
    }

    expect(
      markersIn([...written, ...printed, JSON.stringify(log.events)].join('\n'), [
        marker,
        database.url,
      ]),
    ).toEqual([]);
  });

  test('BUG-51: stop() finishes once QUERY_TIMEOUT_MS have passed, and not before, when the database never answers the read-back of the session limits: one line says they could not be read, and the pool is ended', async () => {
    const database = await listeningHungPostgres();
    const events: string[] = [];
    const runner = recordingRunner(events);
    const written: string[] = [];
    let stopping: Promise<unknown> | undefined;
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const worker = await startWorker(database.url, runner.run, {
        ...quietLoops(),
        write: (text) => {
          written.push(text);
        },
      });
      // As runWorkerProcess reads it back: once started, not awaited.
      void worker.readLimitsBack();
      expect(
        await settledWithin(database.hanging(), HANG_CEILING_MS),
        'the read-back never reached the database',
      ).toBeUndefined();
      stopping = worker.stop().then(
        () => 'stopped',
        (error: unknown) => error,
      );

      await vi.advanceTimersByTimeAsync(QUERY_TIMEOUT_MS - 1);
      expect(await settledWithin(stopping, NOT_YET_MS)).toBe(STILL_WAITING);

      await vi.advanceTimersByTimeAsync(1);
      vi.useRealTimers();
      expect(
        await settledWithin(stopping, HANG_CEILING_MS),
        `stop() was still waiting for the read-back ${String(QUERY_TIMEOUT_MS)} ms after the database stopped answering it`,
      ).toBe('stopped');
      expect(limitLines(written)).toEqual([
        expect.stringMatching(/^worker: session limits could not be read \(.+\)\.$/),
      ]);
      expect(events).toContain('pool ended');
    } finally {
      vi.useRealTimers();
      // The server first: a read-back still waiting would hold the stop.
      await database.close();
      if (stopping !== undefined) {
        await settledWithin(stopping, HANG_CEILING_MS);
      }
    }
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
      const settings = pgSettingsAnswer(query, LIMITS_AS_ASKED);
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
        // RG-03 (LOST-07; not in the spec's list): the worker's SMS loop
        // claims with a statement of the same shape, the SMS kind its only
        // difference. The real database hands a LOST_CONTACT push to the push
        // claim alone, by its kind; so does this one now, or the SMS loop could
        // take the push and this test would see an sms_failed line in place
        // of its push_failed. What the test asserts is unchanged.
        if (claimsTheSmsKind(query)) {
          return {
            columns: ['now', 'id', 'recipient_id', 'kind', 'attempts'],
            rows: [[DATABASE_NOW, null, null, null, null]],
          };
        }
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

// ---------------------------------------------------------------------------
// LOST-07: the SMS loop, the SMS check's minute task, and the worker's SMS
// until M3 (AC1, AC9, AC10, AC11, AC12).
// ---------------------------------------------------------------------------

/** The line the worker says at start until M3 brings an SMS provider (LOST-07-AC12). */
const NO_SMS = /^worker: .*\bno SMS provider\b/i;

/** The SMS check's start line says "the SMS check", and never "Healthchecks.io" (approach item 8). */
const SMS_CHECK = /\bSMS check\b/i;

const smsCheckLines = (written: string[]) =>
  linesOf(written).filter((line) => SMS_CHECK.test(line));

/**
 * The lines that are not one line of their own: a line written without its
 * end runs on into the next one, and two lines read as one. Each start line
 * begins "worker:" once, so a line holding it twice is two lines run together.
 */
const runTogether = (written: string[]) =>
  linesOf(written).filter((line) => (line.match(/\bworker:/g) ?? []).length !== 1);

/** The SMS kind (D-019). */
const SMS = 'LOST_CONTACT_SMS';

/** The message kinds a statement names, in its text or in its parameters, however it binds them. */
function kindsNamedIn(query: FakePostgresQuery): string[] {
  const found = new Set<string>();
  for (const part of [query.text, ...query.values.map((value) => value ?? '')]) {
    // RG-03 (SM-10; not in the spec's list, found by searching for pins of
    // the kinds): NO_RESPONDER is a push kind now (SM-10-AC17), so the push
    // claim names it, and the test below compares what this finds with the
    // test kit's PUSH_KINDS, which has it. Without it here, a claim that left
    // NO_RESPONDER out would look the same as one that named it.
    // RG-03 (LOST-08; not in the spec's "Existing assertions that change by
    // design", found by running this file against a throwaway reference of
    // the spec's lists): SAFE and EXPIRED are push kinds now (LOST-08-AC15),
    // so the push claim names them, and the test below compares what this
    // finds with the test kit's PUSH_KINDS, which has them. Without them
    // here, the claim's kinds could never equal that list, and a claim that
    // left either out would look the same as one that named it.
    for (const [kind] of part.matchAll(
      /\b(?:LOST_CONTACT_SMS|LOST_CONTACT|BACK_IN_CONTACT|HOME|ACKNOWLEDGED|NO_RESPONDER|SAFE|EXPIRED)\b/g,
    )) {
      found.add(kind);
    }
  }
  return [...found].sort();
}

/** Whether a statement is an outbox claim: it takes due rows no other claim holds. */
const isClaim = (query: FakePostgresQuery) =>
  /"?outbox"?[\s\S]*for update skip locked/i.test(query.text);

/** Whether a claim is the SMS loop's: the SMS kind is the one kind it names. */
function claimsTheSmsKind(query: FakePostgresQuery): boolean {
  const kinds = kindsNamedIn(query);
  return kinds.length === 1 && kinds[0] === SMS;
}

/** Whether a statement is the SMS check's count of SMS waiting unsent. */
const isSmsCount = (query: FakePostgresQuery) =>
  /\boutbox\b/i.test(query.text) && /\bcount\s*\(/i.test(query.text) && !isClaim(query);

/**
 * Whether a statement is the SMS check's count of unheard alerts (SM-10, Q3
 * (a)): a count that reads no outbox. It is the only other count the worker
 * makes, and it is matched before the overdue read, so a join of `journeys`
 * in it cannot pass it off as that read.
 */
const isUnheardCount = (query: FakePostgresQuery) =>
  /\bcount\s*\(/i.test(query.text) && !/\boutbox\b/i.test(query.text) && !isClaim(query);

/**
 * A count's one row, named as the statement names its columns: its aliases,
 * in order, when it has any (a count in a subselect hides its name from
 * askedFor), else what it asks for. The time where a name says now, the
 * count elsewhere.
 */
function countAnswer(query: FakePostgresQuery, count: number) {
  const aliases = [...query.text.matchAll(/\bas\s+"?(\w+)"?/gi)]
    .map(([, name = '']) => name)
    .filter((name) => !/^(int|integer|bigint|text|numeric)$/i.test(name));
  const asked = aliases.length > 0 ? aliases : askedFor(query.text);
  const columns = asked.length > 0 ? asked : ['now', 'count'];
  return {
    columns,
    rows: [
      columns.map((column) => (/now/i.test(column) ? NOW_AS_POSTGRES_WRITES_IT : String(count))),
    ],
  };
}

/**
 * A database for the worker's own statements, as the adapter shapes them
 * (their column names are the adapter's): the overdue read answers its time
 * and no journey; the SMS claim hands out `sms` once and the push claim
 * nothing; a mark answers with the message's ID; the SMS check's count
 * answers `state.count`, or fails while it is null. A statement that names
 * sms_raised_at fails when `refuseEscalation` is set. The rest is answered as
 * a quiet database answers it.
 *
 * RG-03, named in SM-10's spec ("`smsDatabase()` … on Q3 (a)"): the SMS check
 * now also counts unheard alerts, a statement this handler did not answer.
 * It answers `state.unheard`, zero unless a test says otherwise, so every
 * LOST-07 test here keeps its assertions: with no unheard alert, the check
 * reports as it did.
 */
function smsDatabase({
  sms,
  refuseEscalation = false,
}: { sms?: { messageId: string; recipientId: string }; refuseEscalation?: boolean } = {}) {
  const state: { count: number | null; unheard: number } = { count: 0, unheard: 0 };
  let claimed = false;
  const handler: FakePostgresHandler = (query) => {
    const settings = pgSettingsAnswer(query, LIMITS_AS_ASKED);
    if (settings !== undefined) {
      return settings;
    }
    if (isUnheardCount(query)) {
      return countAnswer(query, state.unheard);
    }
    if (/\bleft join "?journeys"?/i.test(query.text)) {
      return {
        columns: ['now', 'id', 'state', 'silent_since'],
        rows: [[NOW_AS_POSTGRES_WRITES_IT, null, null, null]],
      };
    }
    if (refuseEscalation && /\bsms_raised_at\b/i.test(query.text)) {
      throw new Error('this synthetic database refuses the escalation');
    }
    if (isClaim(query)) {
      const columns = ['now', 'id', 'recipient_id', 'kind', 'attempts'];
      if (claimsTheSmsKind(query) && sms !== undefined && !claimed) {
        claimed = true;
        return {
          columns,
          rows: [[NOW_AS_POSTGRES_WRITES_IT, sms.messageId, sms.recipientId, SMS, '1']],
        };
      }
      return { columns, rows: [[NOW_AS_POSTGRES_WRITES_IT, null, null, null, null]] };
    }
    if (/^\s*update "?outbox"?/i.test(query.text)) {
      return { columns: askedFor(query.text), rows: [[sms?.messageId ?? null]] };
    }
    if (isSmsCount(query)) {
      if (state.count === null) {
        throw new Error('this synthetic database cannot count');
      }
      return countAnswer(query, state.count);
    }
    return quietDatabase(query);
  };
  return { handler, state };
}

/**
 * The SMS check's minute task: the one task beside the heartbeat that the
 * crontab schedules every minute, found by the crontab whatever its name, and
 * in the task list.
 */
function smsCheckTaskOf(options: RunnerOptions | undefined): string {
  const crontab = typeof options?.crontab === 'string' ? options.crontab : '';
  const scheduled = crontab
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => /^\* \* \* \* \* ([^\s?]+)/.exec(line)?.[1] ?? `not every minute: ${line}`);
  expect(scheduled).toContain('heartbeat');
  const others = scheduled.filter((name) => name !== 'heartbeat');
  expect(others, 'one minute task beside the heartbeat').toHaveLength(1);
  const [name = ''] = others;
  expect(Object.keys(options?.taskList ?? {})).toContain(name);
  return name;
}

describe('LOST-07: the worker’s SMS until M3', () => {
  test('LOST-07-AC12: the worker’s default SMS port answers NOT_CONFIGURED to every message, of every kind, and accepts none', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.constantFrom(...MESSAGE_KINDS),
        async (messageId, recipientId, kind) => {
          expect(await UNCONFIGURED_SMS.send({ messageId, recipientId, kind })).toEqual({
            outcome: 'failed',
            reason: 'NOT_CONFIGURED',
          });
        },
      ),
    );
  });

  test('LOST-07-AC12: the worker says once at start that no SMS provider is configured, through the write it was given, beside its push line, each a line of its own', async () => {
    const worker = workerProcess({ healthchecks: readHealthchecksSetting({}) });
    await settle();

    expect(linesOf(worker.written).filter((line) => NO_SMS.test(line))).toHaveLength(1);
    expect(linesOf(worker.written).filter((line) => NO_PUSH.test(line))).toHaveLength(1);
    // Two lines, not one: the push line is not the SMS line run on.
    expect(
      linesOf(worker.written).filter((line) => NO_PUSH.test(line) && NO_SMS.test(line)),
    ).toEqual([]);
    expect(runTogether(worker.written)).toEqual([]);

    await stopCleanly(worker);
    expect(linesOf(worker.written).filter((line) => NO_SMS.test(line))).toHaveLength(1);
  });

  test('LOST-07-AC12: by default the worker says on stderr that no SMS provider is configured', async () => {
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
      expect(lines.filter((line) => NO_SMS.test(line))).toHaveLength(1);

      signals.emit('SIGTERM');
      await expect(running).resolves.toBeUndefined();
    } finally {
      stderr.mockRestore();
    }
  });

  test.each(['runWorkerProcess', 'startWorker with no sms'] as const)(
    'LOST-07-AC12: the running worker, started by %s, answers a claimed SMS NOT_CONFIGURED: the mark sets last_failure NOT_CONFIGURED and never sent_at, and one sms_failed line names the reason and the message',
    async (how) => {
      const messageId = syntheticUuid();
      const recipientId = syntheticUuid();
      const { handler } = smsDatabase({ sms: { messageId, recipientId } });
      const database = await listeningFakePostgres(handler);
      const log = fakeLog();
      const signals = new EventEmitter();
      // The watchdog and the push sender are quiet: this is about the SMS loop.
      const { watchdog, sender } = quietLoops();
      let stop: () => Promise<void>;
      if (how === 'runWorkerProcess') {
        const running = runWorkerProcess(database.url, {
          runWorker: recordingRunner().run,
          signals,
          watchdog,
          sender,
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
          watchdog,
          sender,
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
      expect(log.events.filter(({ event }) => event === 'sms_failed')).toEqual([
        { event: 'sms_failed', reason: 'NOT_CONFIGURED', messageId },
      ]);
      expect(log.events.filter(({ event }) => event === 'push_failed')).toEqual([]);
    },
  );
});

describe('LOST-07 and AR-05: the SMS loop, apart from the push loop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A worker whose loops run the stubs, the SMS sender's included, on fake timers. */
  async function smsLooping() {
    const sms = stubSender();
    const looped = await (async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const watchdog = stubWatchdog();
      const sender = stubSender();
      const written: string[] = [];
      const runner = recordingRunner();
      const worker = await startWorker('postgres://example/db', runner.run, {
        watchdog,
        sender,
        smsSender: sms,
        log: fakeLog(),
        write: (text) => {
          written.push(text);
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      return { watchdog, sender, written, runner, worker };
    })();
    return { ...looped, sms };
  }

  test('LOST-07-AC9: an SMS delivery runs at start, and again 10 s after the previous one finished; one that takes longer than that is never overlapped', async () => {
    const { sms } = await smsLooping();

    expect(sms.count).toBe(1);
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(sms.count).toBe(1);
    sms.finish();
    await vi.advanceTimersByTimeAsync(10 * SECOND - 1);
    expect(sms.count).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sms.count).toBe(2);
  });

  test('LOST-07-AC9: a push delivery that never settles leaves the SMS loop running every 10 s', async () => {
    const { sms, sender, watchdog } = await smsLooping();

    for (let run = 1; run <= 3; run += 1) {
      expect(sms.count).toBe(run);
      sms.finish();
      watchdog.finish();
      await vi.advanceTimersByTimeAsync(10 * SECOND);
    }
    expect(sms.count).toBe(4);
    expect(sender.count).toBe(1);
  });

  test('LOST-07-AC9: an SMS delivery that never settles leaves the push loop running every 10 s, and delays no sweep', async () => {
    const { sms, sender, watchdog } = await smsLooping();

    for (let run = 1; run <= 3; run += 1) {
      expect(sender.count).toBe(run);
      expect(watchdog.count).toBe(run);
      sender.finish();
      watchdog.finish();
      await vi.advanceTimersByTimeAsync(10 * SECOND);
    }
    expect(sender.count).toBe(4);
    expect(watchdog.count).toBe(4);
    expect(sms.count).toBe(1);
  });

  test('LOST-07-AC1: a sweep that escalated an alert starts an SMS delivery at once, without waiting for the interval; one that escalated none does not', async () => {
    const { sms, watchdog } = await smsLooping();
    sms.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sms.count).toBe(1);

    watchdog.finish({ ok: true, opened: 0, escalated: 1, stuck: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sms.count).toBe(2);
    sms.finish();

    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(watchdog.count).toBe(2);
    const deliveries = sms.count;
    sms.finish();
    watchdog.finish({ ok: true, opened: 0, escalated: 0, stuck: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sms.count).toBe(deliveries);
  });

  test('LOST-07-AC1: a sweep that escalates while an SMS delivery is in flight gets another as soon as that one finishes, not 10 s later', async () => {
    const { sms, watchdog } = await smsLooping();

    watchdog.finish({ ok: true, opened: 0, escalated: 2, stuck: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sms.count).toBe(1);

    sms.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sms.count).toBe(2);
  });

  test('LOST-07-AC9: an SMS delivery that throws is said in one line naming the SMS before the error, and the next runs 10 s later', async () => {
    const { sms, written } = await smsLooping();
    const error = 'synthetic failure number three';

    sms.fail(new Error(error));
    await vi.advanceTimersByTimeAsync(0);

    expect(linesOf(written)).toHaveLength(1);
    const [line = ''] = linesOf(written);
    expect(line).toContain(error);
    expect(line.slice(0, line.indexOf(error))).toMatch(/^worker: .*\bSMS\b/);
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(sms.count).toBe(2);
  });

  test('LOST-07-AC9: stop() waits for an SMS delivery in flight, starts no further run of any loop, and leaves no timer set', async () => {
    const { sms, sender, watchdog, runner, worker } = await smsLooping();
    watchdog.finish();
    sender.finish();
    await vi.advanceTimersByTimeAsync(0);
    const stopped: string[] = [];

    const stopping = worker.stop().then(() => stopped.push('stopped'));
    await vi.advanceTimersByTimeAsync(60 * SECOND);

    expect(stopped).toEqual([]);
    expect(runner.events).toEqual([]);
    expect(sms.count).toBe(1);

    sms.finish();
    await vi.advanceTimersByTimeAsync(0);
    await stopping;

    expect(stopped).toEqual(['stopped']);
    expect(runner.events).toEqual(['runner stopped', 'pool ended']);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(sms.count).toBe(1);
    expect(sender.count).toBe(1);
    expect(watchdog.count).toBe(1);
  });
});

describe('LOST-07, LOST-02 and D-086: by default, the escalation and the SMS loop over the worker’s own pool', () => {
  test('LOST-07-AC1: by default the worker’s sweep reads the alerts due for escalation through its own pool, after the overdue read, and a read it cannot make is one escalation_failed line, stage read, with the SQLSTATE', async () => {
    const { handler } = smsDatabase({ refuseEscalation: true });
    const database = await listeningFakePostgres(handler);
    const log = fakeLog();
    const { sender, smsSender } = quietLoops();
    const worker = await startWorker(database.url, recordingRunner().run, {
      sender,
      smsSender,
      log,
      write: () => undefined,
    });

    try {
      expect(
        await eventually(() => log.events.some(({ event }) => event === 'escalation_failed')),
      ).toBe(true);
    } finally {
      await worker.stop();
      await database.close();
    }

    expect(log.events.filter(({ event }) => event === 'escalation_failed')).toEqual([
      { event: 'escalation_failed', stage: 'read', code: 'XX000' },
    ]);
    const texts = database.queries.map(({ text }) => text);
    const overdueRead = texts.findIndex((text) => /\bleft join "?journeys"?/i.test(text));
    const escalationRead = texts.findIndex(
      (text) => /\balerts\b/i.test(text) && /\bsms_raised_at\b/i.test(text),
    );
    expect(overdueRead).toBeGreaterThanOrEqual(0);
    expect(escalationRead).toBeGreaterThan(overdueRead);
  });

  test('LOST-07-AC1 and AC8: by default the SMS loop claims the SMS kind only and hands what it claims to the SMS port, exactly as claimed; the push loop claims the push kinds only, and its port is never handed an SMS', async () => {
    const messageId = syntheticUuid();
    const recipientId = syntheticUuid();
    const { handler } = smsDatabase({ sms: { messageId, recipientId } });
    const database = await listeningFakePostgres(handler);
    const sms = fakeSms();
    const push = fakePush();
    const { watchdog } = quietLoops();
    const worker = await startWorker(database.url, recordingRunner().run, {
      watchdog,
      push,
      sms,
      log: fakeLog(),
      write: () => undefined,
    });

    try {
      expect(await eventually(() => sms.messages.length > 0)).toBe(true);
      expect(
        await eventually(() =>
          database.queries.filter(isClaim).some((query) => !claimsTheSmsKind(query)),
        ),
      ).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      await worker.stop();
      await database.close();
    }

    expect(sms.messages).toEqual([{ messageId, recipientId, kind: SMS }]);
    expect(push.messages).toEqual([]);
    const claims = database.queries.filter(isClaim);
    const smsClaims = claims.filter(claimsTheSmsKind);
    const pushClaims = claims.filter((query) => !claimsTheSmsKind(query));
    expect(smsClaims.length).toBeGreaterThan(0);
    expect(pushClaims.length).toBeGreaterThan(0);
    for (const claim of pushClaims) {
      expect(kindsNamedIn(claim), claim.text).toEqual([...PUSH_KINDS].sort());
    }
  });
});

describe('LOST-07: the SMS check, a minute task of its own', () => {
  /** A worker over a fake database whose minute tasks the test runs, with the SMS check's alarm given. */
  async function checking(
    database: ReturnType<typeof smsDatabase>,
    { withAlarm = true }: { withAlarm?: boolean } = {},
  ) {
    const listening = await listeningFakePostgres(database.handler);
    const runner = recordingRunner();
    const alarm = fakeSmsAlarm();
    const log = fakeLog();
    const { watchdog, sender, smsSender } = quietLoops();
    const worker = await startWorker(listening.url, runner.run, {
      watchdog,
      sender,
      smsSender,
      ...(withAlarm ? { smsAlarm: alarm } : {}),
      log,
      write: () => undefined,
    });
    const task = smsCheckTaskOf(runner.options());
    return {
      alarm,
      log,
      runCheck: () => runner.runTask(task),
      stop: async () => {
        await worker.stop();
        await listening.close();
      },
    };
  }

  test('LOST-07-AC10: the worker schedules the SMS check every minute beside the heartbeat; it counts the SMS waiting through the worker’s own pool and reports failing to the alarm it was given, with one sms_unsent line holding the count, while any waits; ok once none does', async () => {
    const database = smsDatabase();
    const worker = await checking(database);
    try {
      database.state.count = 3;
      await expect(worker.runCheck()).resolves.toBeUndefined();
      expect(worker.alarm.statuses).toEqual(['failing']);
      expect(worker.log.events).toEqual([{ event: 'sms_unsent', count: 3 }]);

      database.state.count = 0;
      await expect(worker.runCheck()).resolves.toBeUndefined();
      expect(worker.alarm.statuses).toEqual(['failing', 'ok']);
      expect(worker.log.events).toEqual([{ event: 'sms_unsent', count: 3 }]);
    } finally {
      await worker.stop();
    }
  });

  test('SM-10-AC15: the worker’s SMS check also counts unheard alerts through the worker’s own pool: with no SMS waiting and one unheard alert it reports failing, with one unheard_alerts line holding the count, 1, and no sms_unsent; ok once none is (SM-02, LOST-07)', async () => {
    const database = smsDatabase();
    const worker = await checking(database);
    try {
      database.state.unheard = 1;
      await expect(worker.runCheck()).resolves.toBeUndefined();
      expect(worker.alarm.statuses).toEqual(['failing']);
      expect(worker.log.events).toEqual([{ event: 'unheard_alerts', count: 1 }]);

      database.state.unheard = 0;
      await expect(worker.runCheck()).resolves.toBeUndefined();
      expect(worker.alarm.statuses).toEqual(['failing', 'ok']);
      expect(worker.log.events).toEqual([{ event: 'unheard_alerts', count: 1 }]);
    } finally {
      await worker.stop();
    }
  });

  test('LOST-07-AC11: with no alarm, as when HEALTHCHECKS_SMS_URL is unset, the SMS check’s task completes and writes nothing, however many SMS wait: never a thrown task, and no line for a report nobody is there to receive', async () => {
    const database = smsDatabase();
    const worker = await checking(database, { withAlarm: false });
    try {
      database.state.count = 3;
      await expect(worker.runCheck()).resolves.toBeUndefined();
      await expect(worker.runCheck()).resolves.toBeUndefined();
      expect(worker.log.events).toEqual([]);
      expect(worker.alarm.reports).toEqual([]);
    } finally {
      await worker.stop();
    }
  });

  test('LOST-07-AC11: when the SMS check cannot read the database, it reports nothing, writes one sms_check_failed line, stage read, with the SQLSTATE, and the task completes', async () => {
    const database = smsDatabase();
    const worker = await checking(database);
    try {
      database.state.count = null;
      await expect(worker.runCheck()).resolves.toBeUndefined();
      expect(worker.alarm.reports).toEqual([]);
      expect(worker.log.events).toEqual([
        { event: 'sms_check_failed', stage: 'read', code: 'XX000' },
      ]);
    } finally {
      await worker.stop();
    }
  });

  test('LOST-07-AC11: when the report fails, the SMS check writes one sms_check_failed line, stage report, and the task completes: never a thrown task that Graphile retries in a loop', async () => {
    const database = smsDatabase();
    const worker = await checking(database);
    try {
      database.state.count = 3;
      worker.alarm.failWith(new Error('the monitor answered 500'));
      await expect(worker.runCheck()).resolves.toBeUndefined();
      expect(worker.alarm.statuses).toEqual(['failing']);
      expect(worker.log.events.filter(({ event }) => event === 'sms_check_failed')).toEqual([
        expect.objectContaining({ event: 'sms_check_failed', stage: 'report' }),
      ]);
    } finally {
      await worker.stop();
    }
  });
});

describe('LOST-07 and D-079: runWorkerProcess and HEALTHCHECKS_SMS_URL', () => {
  /** runWorkerProcess with everything it reaches replaced, the SMS check's alarm included; what it wrote, and every URL an alarm was made for. */
  function smsWorkerProcess({
    healthchecks = readHealthchecksSetting({}),
    healthchecksSms,
  }: {
    healthchecks?: HealthchecksSetting;
    healthchecksSms?: HealthchecksSetting;
  }) {
    const runner = recordingRunner();
    const signals = new EventEmitter();
    const written: string[] = [];
    const exits: number[] = [];
    const created: string[] = [];
    const checkIns: string[] = [];
    // GRP-01-AC25: the check-ins made, kept, so a test can see one was never sent.
    const events: string[] = [];
    const checkIn = fakeCheckIn({ events });
    const running = runWorkerProcess('postgres://example/db', {
      runWorker: runner.run,
      signals,
      healthchecks,
      createCheckIn: (url: string) => {
        checkIns.push(url);
        return checkIn;
      },
      ...(healthchecksSms === undefined ? {} : { healthchecksSms }),
      createSmsAlarm: (url: string) => {
        created.push(url);
        return fakeSmsAlarm();
      },
      ...quietLoops(),
      keepAlive: () => undefined,
      write: (text) => {
        written.push(text);
      },
      exit: (code) => {
        exits.push(code);
      },
    });
    return { runner, signals, written, exits, created, checkIns, checkIn, events, running };
  }

  async function stopSmsWorker(worker: ReturnType<typeof smsWorkerProcess>) {
    worker.signals.emit('SIGTERM');
    await expect(worker.running).resolves.toBeUndefined();
    await settle();
    expect(worker.exits).toEqual([0]);
  }

  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['an http: address', `http://127.0.0.1:1/${CHECK}`],
    ['not an address at all', `hc-ping.com/${CHECK}`],
  ])(
    'LOST-07-AC11: with HEALTHCHECKS_SMS_URL %s the worker starts and stays up, makes no alarm, and says once why the SMS check does not report, never the value, and not naming Healthchecks.io',
    async (_what, value) => {
      const healthchecksSms = readHealthchecksSmsSetting(
        value === undefined ? {} : { HEALTHCHECKS_SMS_URL: value },
      );
      const worker = smsWorkerProcess({ healthchecksSms });
      await settle();

      const lines = smsCheckLines(worker.written);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^worker: /);
      expect(lines[0]).toContain('HEALTHCHECKS_SMS_URL');
      expect(lines[0]).toContain(reasonOf(healthchecksSms));
      expect(lines[0]).not.toContain('Healthchecks.io');
      expect(worker.written.join('')).not.toContain(CHECK);
      expect(worker.created).toEqual([]);
      // INF-08's count of the lines that name Healthchecks.io keeps its meaning.
      expect(healthchecksLines(worker.written)).toHaveLength(1);
      expect(worker.exits).toEqual([]);

      await stopSmsWorker(worker);
    },
  );

  test('LOST-07-AC11: with a usable https: address the worker says once, on a line of its own, that the SMS check reports on SMS waiting 60 s, without saying where or naming Healthchecks.io, and makes its alarm for that address', async () => {
    const worker = smsWorkerProcess({
      healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: PING_URL }),
    });
    await settle();

    expect(worker.created).toEqual([PING_URL]);
    const lines = smsCheckLines(worker.written);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^worker: /);
    expect(lines[0]).not.toContain('Healthchecks.io');
    // Said to its end, and a line of its own: what it reports on is the 60 s
    // an SMS may wait, and the line does not run on into the next.
    //
    // RG-03 (SM-10 review loop 1, safety-reviewer; D-122's consequences): was
    // /\b60 s\.$/. Since D-122, item 3, an open alert with no responder left
    // to tell is paged through the SMS check alone, so the line goes on past
    // the 60 s to say so, and ends there. Both things this held are held
    // still: the 60 s an SMS may wait, and the full stop at the line's end.
    // SM-10-AC15's tests below pin the new words on their own.
    expect(lines[0]).toMatch(/\b60 s, or any open alert has no responder left to tell\.$/);
    expect(runTogether(worker.written)).toEqual([]);
    expect(worker.written.join('')).not.toContain(CHECK);
    expect(healthchecksLines(worker.written)).toHaveLength(1);
    expect(worker.exits).toEqual([]);

    await stopSmsWorker(worker);
  });

  test('LOST-07-AC11: by default the SMS check reports through the Healthchecks.io adapter, made for the address the setting holds: with SMS waiting unsent, its minute task sends that address with /fail appended exactly one HEAD, with no body', async () => {
    // No alarm is injected here, so this is the adapter production uses, as
    // INF-08-AC4's test does for the check-in. The setting is given as made,
    // with a stand-in on the loopback address in place of hc-ping.com, so
    // nothing leaves this machine.
    const received: { method: string | undefined; path: string | undefined; bodyBytes: number }[] =
      [];
    const server = createServer((request, response) => {
      let bodyBytes = 0;
      request.on('data', (chunk: Buffer) => {
        bodyBytes += chunk.length;
      });
      request.on('end', () => {
        received.push({ method: request.method, path: request.url, bodyBytes });
        response.writeHead(200);
        response.end();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const database = smsDatabase();
    database.state.count = 3;
    const listening = await listeningFakePostgres(database.handler);
    const runner = recordingRunner();
    const signals = new EventEmitter();
    const log = fakeLog();
    const { watchdog, sender, smsSender } = quietLoops();

    try {
      const running = runWorkerProcess(listening.url, {
        runWorker: runner.run,
        signals,
        healthchecks: readHealthchecksSetting({}),
        healthchecksSms: { checkingIn: true, url: `http://127.0.0.1:${String(port)}/${CHECK}` },
        watchdog,
        sender,
        smsSender,
        log,
        keepAlive: () => undefined,
        write: () => undefined,
        exit: () => undefined,
      });
      await settle();

      await expect(runner.runTask(smsCheckTaskOf(runner.options()))).resolves.toBeUndefined();

      expect(received).toEqual([{ method: 'HEAD', path: `/${CHECK}/fail`, bodyBytes: 0 }]);
      expect(log.events).toEqual([{ event: 'sms_unsent', count: 3 }]);

      signals.emit('SIGTERM');
      await expect(running).resolves.toBeUndefined();
    } finally {
      server.closeAllConnections();
      server.close();
      await listening.close();
    }
  });

  test('LOST-07-AC11: with HEALTHCHECKS_SMS_URL set to the same address as HEALTHCHECKS_WORKER_URL, the worker makes no SMS alarm for it, and says once at start that the SMS check does not report, naming both variables and neither value; and, since GRP-01, it does not check in there either', async () => {
    // Two faults behind one signal (D-115, REL-08): an SMS check reporting to
    // the worker's own check would turn "worker down" and "SMS failing" into
    // one page, and an "ok" from one would clear the other's "failing".
    //
    // RG-03 (GRP-01-AC25, D-122's condition for the removal route, D-137;
    // not in the spec's "Existing assertions that change by design", which
    // missed it): this said "the worker checks in there", and held it with
    // `checkIns` equal to [PING_URL] and the CHECKING_IN line. The SMS check
    // naming the worker's own address is one of AC25's three cases of an SMS
    // check that does not report, and then the worker's check-in is
    // withheld, so `staging-worker` pages. So the worker no longer checks in
    // after a fresh beat, and its Healthchecks.io line says it does not, and
    // why. Everything else this held is held as it was.
    const worker = smsWorkerProcess({
      healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: PING_URL }),
      healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: PING_URL }),
    });
    await settle();
    answerLikePostgres(worker.runner, worker.events);
    await runHeartbeat(worker.runner);

    expect(worker.checkIn.calls).toBe(0);
    expect(worker.events).not.toContain(CHECKED_IN);
    expect(worker.created).toEqual([]);
    const lines = smsCheckLines(worker.written);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^worker: /);
    expect(lines[0]).toContain('HEALTHCHECKS_SMS_URL');
    expect(lines[0]).toContain('HEALTHCHECKS_WORKER_URL');
    expect(lines[0]).not.toContain('Healthchecks.io');
    expect(worker.written.join('')).not.toContain(CHECK);
    expect(healthchecksLines(worker.written)).toHaveLength(1);
    expect(healthchecksLines(worker.written)[0]).toMatch(NOT_CHECKING_IN);
    expect(healthchecksLines(worker.written)[0]).toMatch(WITHHELD);
    expect(runTogether(worker.written)).toEqual([]);
    expect(worker.exits).toEqual([]);

    await stopSmsWorker(worker);
  });

  test('LOST-07-AC11: with both URLs set, valid and different, as staging runs, the worker checks in at the worker’s, makes its SMS alarm for the SMS check’s, and says once that the SMS check reports once a minute, with no line about the same address', async () => {
    // LOST-07 review loop 2 (test-auditor S2, safety-reviewer should-fix 2):
    // the configuration that will run. The tests above set one URL, or both
    // to one address; two mutants of the equal-address guard survived them.
    // Two synthetic UUIDs on the loopback address, as SYNTHETIC_PING_URL is.
    const [workerCheck, smsCheck] = [syntheticUuid(), syntheticUuid()];
    const [workerUrl, smsUrl] = [syntheticPingUrl(workerCheck), syntheticPingUrl(smsCheck)];
    const worker = smsWorkerProcess({
      healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: workerUrl }),
      healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: smsUrl }),
    });
    await settle();

    expect(worker.checkIns).toEqual([workerUrl]);
    expect(worker.created).toEqual([smsUrl]);
    const lines = smsCheckLines(worker.written);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^worker: /);
    expect(lines[0]).toMatch(/\breports once a minute\b/);
    expect(lines[0]).not.toMatch(/\bsame\b/);
    expect(lines[0]).not.toContain('Healthchecks.io');
    expect(worker.written.join('')).not.toContain(workerCheck);
    expect(worker.written.join('')).not.toContain(smsCheck);
    expect(healthchecksLines(worker.written)).toHaveLength(1);
    expect(healthchecksLines(worker.written)[0]).toMatch(CHECKING_IN);
    expect(runTogether(worker.written)).toEqual([]);
    expect(worker.exits).toEqual([]);

    await stopSmsWorker(worker);
  });

  test('LOST-07-AC11: two settings with the same UUID are one check, however each is spelled: with the worker’s URL on one host and the SMS check’s on another, the worker makes no SMS alarm, says once at start the line it says for the same address, naming both variables and neither value; and, since GRP-01, does not check in', async () => {
    // RG-03 (GRP-01-AC25; not in the spec's "Existing assertions that change
    // by design", which missed it): this said "the worker checks in at the
    // worker's", held with `checkIns` equal to [workerUrl] and the CHECKING_IN
    // line. One check behind both is an SMS check that does not report, so
    // the worker's check-in is now withheld (AC25): no check-in after a fresh
    // beat, and the Healthchecks.io line says so. The rest is as it was.
    // LOST-07 review loop 2 (safety-reviewer should-fix 1, D-116): a check is
    // its UUID, so "different" compares UUIDs, not spellings. Config refuses
    // most other spellings of one URL, and takes any https: host, so the two
    // here differ in their host alone: the loopback address, and localhost.
    // Both on port 1, so nothing could leave this machine.
    const check = syntheticUuid();
    const workerUrl = syntheticPingUrl(check);
    const smsUrl = `https://localhost:1/${check}`;
    const worker = smsWorkerProcess({
      healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: workerUrl }),
      healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: smsUrl }),
    });
    // The line the worker says when the two are the very same address.
    const sameAddress = smsWorkerProcess({
      healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: PING_URL }),
      healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: PING_URL }),
    });
    await settle();
    answerLikePostgres(worker.runner, worker.events);
    await runHeartbeat(worker.runner);

    expect(worker.checkIn.calls).toBe(0);
    expect(worker.events).not.toContain(CHECKED_IN);
    expect(worker.created).toEqual([]);
    const lines = smsCheckLines(worker.written);
    expect(lines).toHaveLength(1);
    expect(lines).toEqual(smsCheckLines(sameAddress.written));
    expect(lines[0]).toContain('HEALTHCHECKS_SMS_URL');
    expect(lines[0]).toContain('HEALTHCHECKS_WORKER_URL');
    expect(lines[0]).not.toContain('Healthchecks.io');
    expect(worker.written.join('')).not.toContain(check);
    expect(worker.written.join('')).not.toContain('localhost');
    expect(healthchecksLines(worker.written)).toHaveLength(1);
    expect(healthchecksLines(worker.written)[0]).toMatch(NOT_CHECKING_IN);
    expect(healthchecksLines(worker.written)[0]).toMatch(WITHHELD);
    expect(runTogether(worker.written)).toEqual([]);
    expect(worker.exits).toEqual([]);

    await stopSmsWorker(worker);
    await stopSmsWorker(sameAddress);
  });

  test('LOST-07-AC11: given no SMS check setting at all, it runs as though HEALTHCHECKS_SMS_URL were unset', async () => {
    const worker = smsWorkerProcess({});
    await settle();

    const lines = smsCheckLines(worker.written);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('HEALTHCHECKS_SMS_URL');
    expect(lines[0]).toContain(reasonOf(readHealthchecksSmsSetting({})));
    expect(worker.created).toEqual([]);

    await stopSmsWorker(worker);
  });

  // SM-10 review loop 1 (safety-reviewer; D-122, item 3, and its
  // consequences): since SM-10 a silent journey with no responder left opens
  // its alert with nobody to tell, and the owner is paged through the SMS
  // check alone, no longer through the worker's own check. So the start line
  // says what the SMS check covers when it reports, and, when it does not,
  // what goes unpaged: fail loudly, never silently.

  /** The sentence a not-reporting SMS check's start line ends with: what goes unpaged without it. */
  const UNPAGED =
    /\bNeither an SMS left unsent nor an alert with no responder left to tell is paged\.$/m;

  test.each([
    [
      'only HEALTHCHECKS_SMS_URL set, to a usable https: address',
      () => ({ healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: PING_URL }) }),
    ],
    [
      'both URLs set, valid and different, as staging runs',
      () => ({
        healthchecks: readHealthchecksSetting({
          HEALTHCHECKS_WORKER_URL: syntheticPingUrl(syntheticUuid()),
        }),
        healthchecksSms: readHealthchecksSmsSetting({
          HEALTHCHECKS_SMS_URL: syntheticPingUrl(syntheticUuid()),
        }),
      }),
    ],
  ] as const)(
    'SM-10-AC15: with %s, the SMS check’s start line says it reports whether any open alert has no responder left to tell, as well as an SMS waiting 60 s, and never that something goes unpaged (SM-02, LOST-07)',
    async (_what, settings) => {
      const worker = smsWorkerProcess(settings());
      await settle();

      expect(worker.created).toHaveLength(1);
      const lines = smsCheckLines(worker.written);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/\bor any open alert has no responder left to tell\b/);
      expect(lines[0]).not.toMatch(UNPAGED);
      expect(runTogether(worker.written)).toEqual([]);

      await stopSmsWorker(worker);
    },
  );

  test.each([
    ['HEALTHCHECKS_SMS_URL unset', () => ({ healthchecksSms: readHealthchecksSmsSetting({}) })],
    [
      'HEALTHCHECKS_SMS_URL empty',
      () => ({ healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: '' }) }),
    ],
    [
      'HEALTHCHECKS_SMS_URL an http: address',
      () => ({
        healthchecksSms: readHealthchecksSmsSetting({
          HEALTHCHECKS_SMS_URL: `http://127.0.0.1:1/${CHECK}`,
        }),
      }),
    ],
    [
      'HEALTHCHECKS_SMS_URL not an address at all',
      () => ({
        healthchecksSms: readHealthchecksSmsSetting({
          HEALTHCHECKS_SMS_URL: `hc-ping.com/${CHECK}`,
        }),
      }),
    ],
    ['no SMS check setting at all', () => ({})],
    [
      'HEALTHCHECKS_SMS_URL the same address as HEALTHCHECKS_WORKER_URL',
      () => ({
        healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: PING_URL }),
        healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: PING_URL }),
      }),
    ],
    [
      'HEALTHCHECKS_SMS_URL the same check as HEALTHCHECKS_WORKER_URL on another host',
      () => {
        const check = syntheticUuid();
        return {
          healthchecks: readHealthchecksSetting({
            HEALTHCHECKS_WORKER_URL: syntheticPingUrl(check),
          }),
          healthchecksSms: readHealthchecksSmsSetting({
            HEALTHCHECKS_SMS_URL: `https://localhost:1/${check}`,
          }),
        };
      },
    ],
  ] as const)(
    'SM-10-AC15: with %s, the SMS check’s start line says, after why it does not report, that neither an SMS left unsent nor an alert with no responder left to tell is paged, and the worker stays up (SM-02, LOST-07)',
    async (_what, settings) => {
      const worker = smsWorkerProcess(settings());
      await settle();

      expect(worker.created).toEqual([]);
      const lines = smsCheckLines(worker.written);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^worker: the SMS check is not reporting: /);
      expect(lines[0]).toMatch(UNPAGED);
      expect(runTogether(worker.written)).toEqual([]);
      expect(worker.exits).toEqual([]);

      await stopSmsWorker(worker);
    },
  );
});

// ---------------------------------------------------------------------------
// GRP-01-AC25 (approach item 11, D-122's condition for the removal route,
// D-137): when the worker's own check-in is configured and the SMS check is
// not reporting (unset, unusable, or the worker's own check), the worker does
// not check in, so `staging-worker` pages within its grace. It still starts,
// and its watchdog and senders still run: refusing to start would stop every
// alert to page about one (F7). With neither URL set, as on a developer's
// machine, nothing changes; with a usable SMS URL of its own, the check-in
// runs as before.
// ---------------------------------------------------------------------------

describe('GRP-01-AC25: the worker’s check-in is withheld while the SMS check is not reporting', () => {
  /**
   * runWorkerProcess with a usable HEALTHCHECKS_WORKER_URL unless told
   * otherwise and the SMS setting given; a check-in that records what it is
   * asked, and loops that count their runs, each bounded as the quiet loops
   * are.
   */
  function withheldWorker({
    healthchecks = readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: PING_URL }),
    healthchecksSms,
  }: {
    healthchecks?: HealthchecksSetting;
    healthchecksSms?: HealthchecksSetting;
  }) {
    const runner = recordingRunner();
    const signals = new EventEmitter();
    const events: string[] = [];
    const written: string[] = [];
    const exits: number[] = [];
    const checkIn = fakeCheckIn({ events });
    const counts = { sweeps: 0, deliveries: 0, smsDeliveries: 0 };
    const bound = turnBound({ what: 'the counted loops', most: 3 * RUNS_PER_TURN });
    loopBounds.push(bound);
    const running = runWorkerProcess('postgres://example/db', {
      runWorker: runner.run,
      signals,
      healthchecks,
      ...(healthchecksSms === undefined ? {} : { healthchecksSms }),
      createCheckIn: () => checkIn,
      createSmsAlarm: () => fakeSmsAlarm(),
      ...quietLoops(),
      watchdog: {
        sweep: () => {
          counts.sweeps += 1;
          return bound.answer(() => ({ ok: true, opened: 0, escalated: 0, stuck: 0 }));
        },
      },
      sender: {
        deliverDue: () => {
          counts.deliveries += 1;
          return bound.answer(() => ({ sent: 0, failed: 0 }));
        },
      },
      smsSender: {
        deliverDue: () => {
          counts.smsDeliveries += 1;
          return bound.answer(() => ({ sent: 0, failed: 0 }));
        },
      },
      keepAlive: () => undefined,
      write: (text) => {
        written.push(text);
      },
      exit: (code) => {
        exits.push(code);
      },
    });
    return { runner, signals, events, written, exits, checkIn, counts, running };
  }

  async function stop(worker: ReturnType<typeof withheldWorker>) {
    worker.signals.emit('SIGTERM');
    await expect(worker.running).resolves.toBeUndefined();
    await settle();
    expect(worker.exits).toEqual([0]);
  }

  const NOT_REPORTING = [
    ['unset', () => undefined],
    ['empty', () => readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: '' })],
    [
      'an http: address',
      () => readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: `http://127.0.0.1:1/${CHECK}` }),
    ],
    [
      'not an address at all',
      () => readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: `hc-ping.com/${CHECK}` }),
    ],
    [
      'the worker’s own address',
      () => readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: PING_URL }),
    ],
    [
      'the worker’s own check, on another host',
      () => readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: `https://localhost:1/${CHECK}` }),
    ],
  ] as const;

  test.each(NOT_REPORTING)(
    'GRP-01-AC25: with HEALTHCHECKS_WORKER_URL usable and HEALTHCHECKS_SMS_URL %s, a fresh beat is followed by no check-in, ever',
    async (_what, sms) => {
      const healthchecksSms = sms();
      const worker = withheldWorker(healthchecksSms === undefined ? {} : { healthchecksSms });
      await settle();
      answerLikePostgres(worker.runner, worker.events);

      await expect(runHeartbeat(worker.runner)).resolves.toBeUndefined();
      await expect(runHeartbeat(worker.runner)).resolves.toBeUndefined();

      expect(worker.events).toContain(BEAT_READ);
      expect(worker.events).not.toContain(CHECKED_IN);
      expect(worker.checkIn.calls).toBe(0);
      expect(worker.exits).toEqual([]);

      await stop(worker);
    },
  );

  test.each(NOT_REPORTING)(
    'GRP-01-AC25: with HEALTHCHECKS_SMS_URL %s, the start line says the worker’s check-in is withheld because of HEALTHCHECKS_SMS_URL, never that it checks in, naming no URL; and the SMS check’s line still says what goes unpaged',
    async (_what, sms) => {
      const healthchecksSms = sms();
      const worker = withheldWorker(healthchecksSms === undefined ? {} : { healthchecksSms });
      await settle();

      const lines = healthchecksLines(worker.written);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(NOT_CHECKING_IN);
      expect(lines[0]).toMatch(WITHHELD);
      expect(lines[0]).not.toMatch(/\bSMS check\b/i);
      expect(linesOf(worker.written).filter((line) => CHECKING_IN.test(line))).toEqual([]);
      const smsLines = smsCheckLines(worker.written);
      expect(smsLines).toHaveLength(1);
      expect(smsLines[0]).toMatch(/^worker: the SMS check is not reporting: /);
      expect(smsLines[0]).toMatch(
        /\bNeither an SMS left unsent nor an alert with no responder left to tell is paged\.$/,
      );
      expect(worker.written.join('')).not.toContain(CHECK);
      expect(worker.written.join('')).not.toContain('localhost');
      expect(worker.written.join('')).not.toContain('127.0.0.1');
      expect(runTogether(worker.written)).toEqual([]);

      await stop(worker);
    },
  );

  test.each(NOT_REPORTING)(
    'GRP-01-AC25: with HEALTHCHECKS_SMS_URL %s and the check-in withheld, the worker starts and stays up: the watchdog sweeps and both senders run',
    async (_what, sms) => {
      const healthchecksSms = sms();
      const worker = withheldWorker(healthchecksSms === undefined ? {} : { healthchecksSms });
      await settle();

      expect(worker.runner.options()?.crontab).toBe(HEARTBEAT_CRONTAB);
      expect(worker.counts.sweeps).toBeGreaterThanOrEqual(1);
      expect(worker.counts.deliveries).toBeGreaterThanOrEqual(1);
      expect(worker.counts.smsDeliveries).toBeGreaterThanOrEqual(1);
      expect(worker.exits).toEqual([]);

      await stop(worker);
    },
  );

  test('GRP-01-AC25: with a usable SMS URL of its own, the check-in runs as today: one check-in after a fresh beat, and the CHECKING_IN line with no word of withholding', async () => {
    const worker = withheldWorker({
      healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: syntheticPingUrl() }),
    });
    await settle();
    answerLikePostgres(worker.runner, worker.events);

    await expect(runHeartbeat(worker.runner)).resolves.toBeUndefined();

    expect(worker.events.at(-1)).toBe(CHECKED_IN);
    expect(worker.checkIn.calls).toBe(1);
    const lines = healthchecksLines(worker.written);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(CHECKING_IN);
    expect(worker.written.join('')).not.toMatch(/\bwithheld\b/);

    await stop(worker);
  });

  test('GRP-01-AC25: with neither URL set, as on a developer’s machine, nothing changes: no check-in, the INF-08 line that it is not checking in because HEALTHCHECKS_WORKER_URL is not set, and no word of withholding', async () => {
    const worker = withheldWorker({ healthchecks: readHealthchecksSetting({}) });
    await settle();
    answerLikePostgres(worker.runner, worker.events);

    await expect(runHeartbeat(worker.runner)).resolves.toBeUndefined();

    expect(worker.checkIn.calls).toBe(0);
    const lines = healthchecksLines(worker.written);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(NOT_CHECKING_IN);
    expect(lines[0]).toContain(reasonOf(readHealthchecksSetting({})));
    expect(worker.written.join('')).not.toMatch(/\bwithheld\b/);

    await stop(worker);
  });
});

// ---------------------------------------------------------------------------
// REL-10: the staging canary, a Graphile cron task of the worker's every 15
// minutes, scheduled only when its own check can be reported to (the spec's
// approach items 1, 8, 9 and 10). What is held here is the worker's side: the
// cron line and the task, the start lines, the canary's own alarm apart from
// the worker's check-in and the SMS check, a stop that waits for no canary,
// and settings that never stop the worker. The run itself is held at L6, in
// canary.system.test.ts.
// ---------------------------------------------------------------------------

/** The canary's start line, whatever it says after "the canary". */
const CANARY_LINE = /^worker: the canary\b/;
/** The start line when the canary is scheduled (the spec's approach item 10). */
const CANARY_RUNS = /^worker: the canary runs every 15 minutes and reports to a check of its own\b/;
/** The start line when it is not, up to its reason. */
const CANARY_NOT_RUNNING = /^worker: the canary is not running: /;
/** How a not-running line ends: what goes unpaged without it. */
const CANARY_UNPAGED = /\bNothing checks end to end that an alert reaches the push port\.$/;

const canaryLines = (written: string[]) =>
  linesOf(written).filter((line) => CANARY_LINE.test(line));

/** The crontab the runner was given, line by line, comments and blank lines left out. */
function crontabLines(options: RunnerOptions | undefined): string[] {
  const crontab = typeof options?.crontab === 'string' ? options.crontab : '';
  return crontab
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** Three ping URLs, each a check of its own, on the test kit's unreachable address. */
function threeChecks() {
  const [worker, sms, canary] = [syntheticUuid(), syntheticUuid(), syntheticUuid()];
  return {
    uuids: { worker, sms, canary },
    urls: {
      worker: syntheticPingUrl(worker),
      sms: syntheticPingUrl(sms),
      canary: syntheticPingUrl(canary),
    },
  };
}

/** A canary client that is never called in these tests: a run that reached it would show here. */
function untouchedClient(calls: string[]) {
  return {
    start: () => {
      calls.push('start');
      return new Promise<never>(() => undefined);
    },
    heartbeat: () => {
      calls.push('heartbeat');
      return new Promise<never>(() => undefined);
    },
    home: () => {
      calls.push('home');
      return new Promise<never>(() => undefined);
    },
  };
}

/**
 * runWorkerProcess with everything it reaches replaced, the canary's alarm
 * and client included: what it wrote, how it exited, every URL an alarm or a
 * check-in was made for, and every client made, with what it was made with.
 */
function canaryWorkerProcess({
  healthchecks = readHealthchecksSetting({}),
  healthchecksSms = readHealthchecksSmsSetting({}),
  healthchecksCanary,
  canary,
  alarm = fakeCanaryAlarm(),
  defaultAlarm = false,
  events = [],
}: {
  healthchecks?: HealthchecksSetting;
  healthchecksSms?: HealthchecksSetting;
  healthchecksCanary?: HealthchecksSetting;
  canary?: ReturnType<typeof readCanarySetting>;
  alarm?: ReturnType<typeof fakeCanaryAlarm>;
  defaultAlarm?: boolean;
  events?: string[];
}) {
  const runner = recordingRunner(events);
  const signals = new EventEmitter();
  const written: string[] = [];
  const exits: number[] = [];
  const checkIns: string[] = [];
  const smsAlarms: string[] = [];
  const canaryAlarms: string[] = [];
  const clients: unknown[][] = [];
  const clientCalls: string[] = [];
  const checkIn = fakeCheckIn();
  const smsAlarm = fakeSmsAlarm();
  const log = fakeLog();
  let sweeps = 0;
  // RG-03 (BUG-45, D-129): the counting sweep below is bounded, as
  // quietLoops()' works are, and counts and answers exactly as before.
  const sweepBound = turnBound({ what: 'the counted sweep', most: RUNS_PER_TURN });
  loopBounds.push(sweepBound);
  const running = runWorkerProcess('postgres://example/db', {
    runWorker: runner.run,
    signals,
    healthchecks,
    createCheckIn: (url: string) => {
      checkIns.push(url);
      return checkIn;
    },
    healthchecksSms,
    createSmsAlarm: (url: string) => {
      smsAlarms.push(url);
      return smsAlarm;
    },
    ...(healthchecksCanary === undefined ? {} : { healthchecksCanary }),
    ...(canary === undefined ? {} : { canary }),
    ...(defaultAlarm
      ? {}
      : {
          createCanaryAlarm: (url: string) => {
            canaryAlarms.push(url);
            return alarm;
          },
        }),
    createCanaryClient: (...args: unknown[]) => {
      clients.push(args);
      return untouchedClient(clientCalls);
    },
    ...quietLoops(),
    watchdog: {
      sweep: () => {
        sweeps += 1;
        return sweepBound.answer(() => ({ ok: true, opened: 0, escalated: 0, stuck: 0 }));
      },
    },
    log,
    keepAlive: () => undefined,
    write: (text) => {
      written.push(text);
    },
    exit: (code) => {
      exits.push(code);
      events.push(`exit ${String(code)}`);
    },
  });
  return {
    runner,
    signals,
    written,
    exits,
    checkIns,
    smsAlarms,
    canaryAlarms,
    clients,
    clientCalls,
    checkIn,
    smsAlarm,
    alarm,
    log,
    running,
    sweeps: () => sweeps,
  };
}

async function stopCanaryWorker(worker: ReturnType<typeof canaryWorkerProcess>) {
  worker.signals.emit('SIGTERM');
  await expect(worker.running).resolves.toBeUndefined();
  await settle();
  expect(worker.exits).toEqual([0]);
}

describe('REL-10: the canary’s cron line, beside the minute tasks', () => {
  test('REL-10-AC16: CANARY_CRONTAB is exactly */15 * * * * canary ?max=1, and HEARTBEAT_CRONTAB is unchanged', () => {
    expect(CANARY_CRONTAB).toBe('*/15 * * * * canary ?max=1');
    expect(HEARTBEAT_CRONTAB).toBe('* * * * * heartbeat\n* * * * * sms_check');
  });

  test('REL-10-AC16: Graphile Worker reads the line as the task canary, at minutes 0, 15, 30 and 45 of every hour, with one attempt and no backfill, so a failed run is never retried', () => {
    const items = parseCrontab(CANARY_CRONTAB);

    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item?.task).toBe('canary');
    expect(item?.options).toMatchObject({ maxAttempts: 1, backfillPeriod: 0 });
    const minutes = Array.from({ length: 60 }, (_, min) => min).filter((min) =>
      item?.match({ min, hour: 21, date: 1, month: 10, dow: 4 }),
    );
    expect(minutes).toEqual([0, 15, 30, 45]);
    for (const hour of [0, 3, 12, 23]) {
      expect(item?.match({ min: 30, hour, date: 9, month: 10, dow: 5 })).toBe(true);
    }
  });

  test('REL-10-AC16: createTaskList holds the canary task exactly when it is given a canary, and the task hands the canary Graphile’s abort signal, the very one it was given', async () => {
    const heartbeats = fakeWorkerHeartbeats();
    const clock = fakeClock(NOW);
    const signals: AbortSignal[] = [];
    const canary = {
      run: (signal: AbortSignal) => {
        signals.push(signal);
        return Promise.resolve({ outcome: 'ON_TIME' });
      },
    };

    expect(Object.keys(createTaskList({ clock, heartbeats }))).not.toContain('canary');
    const tasks = createTaskList({ clock, heartbeats, canary });
    expect(Object.keys(tasks)).toContain('canary');
    const { canary: canaryTask } = tasks;

    const graphile = new AbortController();
    await expect(canaryTask?.(null, helpersWith(graphile.signal))).resolves.toBeUndefined();
    expect(signals).toEqual([graphile.signal]);
  });

  test('REL-10-AC16: with the canary’s check usable, the crontab is HEARTBEAT_CRONTAB with CANARY_CRONTAB appended, the task list holds canary, and the concurrency and the pool are unchanged', async () => {
    const { urls } = threeChecks();
    const worker = canaryWorkerProcess({
      healthchecksCanary: readHealthchecksCanarySetting({ HEALTHCHECKS_CANARY_URL: urls.canary }),
    });
    await settle();

    const options = worker.runner.options();
    expect(crontabLines(options)).toEqual([...HEARTBEAT_CRONTAB.split('\n'), CANARY_CRONTAB]);
    expect(Object.keys(options?.taskList ?? {}).sort()).toEqual(
      ['canary', 'heartbeat', 'sms_check'].sort(),
    );
    expect(options?.concurrency).toBe(2);
    expect(options?.pgPool?.options.max).toBe(POOL_SIZE.worker);
    expect(POOL_SIZE.worker).toBe(2);

    await stopCanaryWorker(worker);
  });

  test('REL-10-AC16: with the canary’s check unusable, the crontab is HEARTBEAT_CRONTAB alone, the task list holds no canary, and the concurrency and the pool are unchanged', async () => {
    const worker = canaryWorkerProcess({});
    await settle();

    const options = worker.runner.options();
    expect(options?.crontab).toBe(HEARTBEAT_CRONTAB);
    expect(Object.keys(options?.taskList ?? {})).not.toContain('canary');
    expect(options?.concurrency).toBe(2);
    expect(options?.pgPool?.options.max).toBe(POOL_SIZE.worker);

    await stopCanaryWorker(worker);
  });
});

describe('REL-10: the canary’s settings, said at start, never stop the worker', () => {
  const marker = syntheticUuid();

  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['an http: address', `http://127.0.0.1:1/${marker}`],
    ['not an address at all', `hc-ping.com/${marker}`],
    ['a trailing slash', `https://127.0.0.1:1/${marker}/`],
  ])(
    'REL-10-AC13: with HEALTHCHECKS_CANARY_URL %s, no canary cron line is added, nothing reports, and one line says the canary is not running, why, naming the variable and never the value, and what goes unpaged; the worker stays up',
    async (_what, value) => {
      const healthchecksCanary = readHealthchecksCanarySetting(
        value === undefined ? {} : { HEALTHCHECKS_CANARY_URL: value },
      );
      const worker = canaryWorkerProcess({
        healthchecksCanary,
        canary: readCanarySetting({
          CANARY_API_URL: 'https://trygg-hverdag-staging.cleverapps.io',
          CANARY_CREDENTIAL: syntheticCredential(),
        }),
      });
      await settle();

      expect(crontabLines(worker.runner.options())).not.toContain(CANARY_CRONTAB);
      expect(Object.keys(worker.runner.options()?.taskList ?? {})).not.toContain('canary');
      expect(worker.canaryAlarms).toEqual([]);
      const lines = canaryLines(worker.written);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(CANARY_NOT_RUNNING);
      expect(lines[0]).toContain('HEALTHCHECKS_CANARY_URL');
      expect(lines[0]).toContain(healthchecksCanary.checkingIn ? '' : healthchecksCanary.reason);
      expect(lines[0]).toMatch(CANARY_UNPAGED);
      expect(lines[0]).not.toContain('Healthchecks.io');
      expect(worker.written.join('')).not.toContain(marker);
      expect(runTogether(worker.written)).toEqual([]);
      expect(worker.exits).toEqual([]);

      await stopCanaryWorker(worker);
    },
  );

  test('REL-10-AC13: given no canary setting at all, the worker runs as though HEALTHCHECKS_CANARY_URL were unset, and says so', async () => {
    const worker = canaryWorkerProcess({});
    await settle();

    const lines = canaryLines(worker.written);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(CANARY_NOT_RUNNING);
    expect(lines[0]).toContain('HEALTHCHECKS_CANARY_URL');
    expect(lines[0]).toMatch(CANARY_UNPAGED);
    expect(worker.canaryAlarms).toEqual([]);

    await stopCanaryWorker(worker);
  });

  test.each([
    ['HEALTHCHECKS_WORKER_URL', 'worker'],
    ['HEALTHCHECKS_SMS_URL', 'sms'],
  ] as const)(
    'REL-10-AC13: HEALTHCHECKS_CANARY_URL with the same UUID as %s, on another host, is refused: no canary line in the crontab, no alarm, and one line naming both variables and neither value',
    async (other, which) => {
      const { urls, uuids } = threeChecks();
      const worker = canaryWorkerProcess({
        healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: urls.worker }),
        healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: urls.sms }),
        healthchecksCanary: readHealthchecksCanarySetting({
          HEALTHCHECKS_CANARY_URL: `https://localhost:1/${uuids[which]}`,
        }),
      });
      await settle();

      expect(crontabLines(worker.runner.options())).not.toContain(CANARY_CRONTAB);
      expect(worker.canaryAlarms).toEqual([]);
      // The other two checks are as they were.
      expect(worker.checkIns).toEqual([urls.worker]);
      expect(worker.smsAlarms).toEqual([urls.sms]);
      const lines = canaryLines(worker.written);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(CANARY_NOT_RUNNING);
      expect(lines[0]).toContain('HEALTHCHECKS_CANARY_URL');
      expect(lines[0]).toContain(other);
      expect(lines[0]).toMatch(CANARY_UNPAGED);
      for (const uuid of Object.values(uuids)) {
        expect(worker.written.join('')).not.toContain(uuid);
      }
      expect(worker.written.join('')).not.toContain('localhost');
      expect(worker.exits).toEqual([]);

      await stopCanaryWorker(worker);
    },
  );

  test('REL-10-AC13: with all three URLs set and different, and the canary’s settings usable, as staging runs: one line says the canary runs every 15 minutes and reports to a check of its own; its alarm is made for its own URL and its client once; no line holds a value', async () => {
    const { urls, uuids } = threeChecks();
    const credential = syntheticCredential();
    const apiUrl = 'https://trygg-hverdag-staging.cleverapps.io';
    const worker = canaryWorkerProcess({
      healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: urls.worker }),
      healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: urls.sms }),
      healthchecksCanary: readHealthchecksCanarySetting({ HEALTHCHECKS_CANARY_URL: urls.canary }),
      canary: readCanarySetting({ CANARY_API_URL: apiUrl, CANARY_CREDENTIAL: credential }),
    });
    await settle();

    expect(worker.checkIns).toEqual([urls.worker]);
    expect(worker.smsAlarms).toEqual([urls.sms]);
    expect(worker.canaryAlarms).toEqual([urls.canary]);
    expect(worker.clients).toHaveLength(1);
    expect(JSON.stringify(worker.clients[0])).toContain(apiUrl);
    expect(JSON.stringify(worker.clients[0])).toContain(credential);
    const lines = canaryLines(worker.written);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(CANARY_RUNS);
    expect(lines[0]).not.toContain('Healthchecks.io');
    const all = worker.written.join('');
    for (const value of [...Object.values(uuids), credential, apiUrl, 'cleverapps']) {
      expect(all).not.toContain(value);
    }
    expect(healthchecksLines(worker.written)).toHaveLength(1);
    expect(runTogether(worker.written)).toEqual([]);
    expect(worker.exits).toEqual([]);

    await stopCanaryWorker(worker);
  });

  test('REL-10-AC13: with the canary’s check usable and its other settings not, the canary is scheduled anyway, and each run reports failing with NOT_CONFIGURED through its own alarm, making no client', async () => {
    const { urls } = threeChecks();
    const worker = canaryWorkerProcess({
      healthchecksCanary: readHealthchecksCanarySetting({ HEALTHCHECKS_CANARY_URL: urls.canary }),
      canary: readCanarySetting({ CANARY_API_URL: 'http://127.0.0.1:1' }),
    });
    await settle();

    expect(crontabLines(worker.runner.options())).toContain(CANARY_CRONTAB);
    expect(worker.canaryAlarms).toEqual([urls.canary]);
    await expect(worker.runner.runTask('canary')).resolves.toBeUndefined();
    await expect(worker.runner.runTask('canary')).resolves.toBeUndefined();

    expect(worker.alarm.statuses).toEqual(['failing', 'failing']);
    const notConfigured = {
      event: 'canary_run',
      outcome: 'NOT_CONFIGURED',
      alertMs: null,
      openedAfterMs: null,
      status: null,
      code: null,
    };
    expect(worker.log.events.filter(({ event }) => event === 'canary_run')).toEqual([
      notConfigured,
      notConfigured,
    ]);
    expect(worker.clients).toEqual([]);
    expect(worker.clientCalls).toEqual([]);
    // RG-03 (REL-10 review loop 2, test-auditor should-fix 2): strengthened,
    // not weakened. This said only that some canary line was written, which a
    // line that lost its reason, or said the canary was not running, also is
    // (test-auditor's W2; Stryker's survivor at worker.ts:704). Now: exactly
    // one canary line, the half-configured one, naming the setting that broke
    // and NOT_CONFIGURED, and holding no value.
    const [line, ...more] = canaryLines(worker.written);
    expect(more, 'canary lines after the first').toEqual([]);
    expect(line).toMatch(CANARY_RUNS);
    expect(line).toMatch(
      /, but cannot reach the API: CANARY_API_URL\b.* Each run reports failing, with NOT_CONFIGURED\.$/,
    );
    expect(line).not.toMatch(CANARY_NOT_RUNNING);
    expect(worker.written.join('')).not.toContain(urls.canary);
    expect(worker.written.join('')).not.toContain('127.0.0.1:1');

    await stopCanaryWorker(worker);
  });

  // REL-10 review loop 2 (test-auditor should-fix 2): the half-configured
  // line names whichever setting broke, and never its value: the credential
  // is a secret, and the API's address is not the line's to repeat.
  test.each<{
    what: string;
    env: (credential: string) => Record<string, string>;
    names: string;
  }>([
    {
      what: 'CANARY_CREDENTIAL unset',
      env: () => ({ CANARY_API_URL: 'https://canary-api.invalid' }),
      names: 'CANARY_CREDENTIAL',
    },
    {
      what: 'CANARY_CREDENTIAL too short',
      env: (credential: string) => ({
        CANARY_API_URL: 'https://canary-api.invalid',
        CANARY_CREDENTIAL: credential.slice(0, 42),
      }),
      names: 'CANARY_CREDENTIAL',
    },
    {
      what: 'CANARY_API_URL with a path',
      env: (credential: string) => ({
        CANARY_API_URL: 'https://canary-api.invalid/v1',
        CANARY_CREDENTIAL: credential,
      }),
      names: 'CANARY_API_URL',
    },
  ])(
    'REL-10-AC13: with the canary’s check usable and $what, its one start line says it runs but cannot reach the API, naming $names and NOT_CONFIGURED, and holds neither the credential nor the API’s address',
    async ({ env, names }) => {
      const { urls } = threeChecks();
      const credential = syntheticCredential();
      const worker = canaryWorkerProcess({
        healthchecksCanary: readHealthchecksCanarySetting({ HEALTHCHECKS_CANARY_URL: urls.canary }),
        canary: readCanarySetting(env(credential)),
      });
      await settle();

      const lines = canaryLines(worker.written);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(CANARY_RUNS);
      expect(lines[0]).toMatch(
        new RegExp(
          `, but cannot reach the API: ${names}\\b.* Each run reports failing, with NOT_CONFIGURED\\.$`,
        ),
      );
      const written = worker.written.join('');
      expect(written).not.toContain(credential.slice(0, 42));
      expect(written).not.toContain('canary-api.invalid');
      expect(written).not.toContain(urls.canary);

      await stopCanaryWorker(worker);
    },
  );

  const COMBINATIONS = [
    { canaryCheck: 'unset', canarySettings: 'unset' },
    { canaryCheck: 'unset', canarySettings: 'usable' },
    { canaryCheck: 'usable', canarySettings: 'unset' },
    { canaryCheck: 'usable', canarySettings: 'usable' },
    { canaryCheck: 'the worker’s', canarySettings: 'usable' },
    { canaryCheck: 'the SMS check’s', canarySettings: 'unusable' },
    { canaryCheck: 'not a URL', canarySettings: 'unusable' },
  ] as const;

  test.each(COMBINATIONS)(
    'REL-10-AC13: with the canary’s check $canaryCheck and its settings $canarySettings, the worker starts and stays up, its loops run, its check-in and its SMS check are made for their own URLs and still scheduled every minute, and a SIGTERM still exits with 0',
    async ({ canaryCheck, canarySettings }) => {
      const { urls } = threeChecks();
      const canaryUrl = {
        unset: undefined,
        usable: urls.canary,
        'the worker’s': urls.worker,
        'the SMS check’s': urls.sms,
        'not a URL': 'canary',
      }[canaryCheck];
      const worker = canaryWorkerProcess({
        healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: urls.worker }),
        healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: urls.sms }),
        healthchecksCanary: readHealthchecksCanarySetting(
          canaryUrl === undefined ? {} : { HEALTHCHECKS_CANARY_URL: canaryUrl },
        ),
        canary: readCanarySetting(
          canarySettings === 'usable'
            ? {
                CANARY_API_URL: 'https://trygg-hverdag-staging.cleverapps.io',
                CANARY_CREDENTIAL: syntheticCredential(),
              }
            : canarySettings === 'unusable'
              ? { CANARY_API_URL: 'ftp://canary', CANARY_CREDENTIAL: 'short' }
              : {},
        ),
      });
      await settle();

      expect(worker.runner.options()).toBeDefined();
      expect(worker.sweeps()).toBeGreaterThanOrEqual(1);
      expect(worker.checkIns).toEqual([urls.worker]);
      expect(worker.smsAlarms).toEqual([urls.sms]);
      expect(crontabLines(worker.runner.options()).slice(0, 2)).toEqual(
        HEARTBEAT_CRONTAB.split('\n'),
      );
      expect(Object.keys(worker.runner.options()?.taskList ?? {})).toEqual(
        expect.arrayContaining(['heartbeat', 'sms_check']),
      );
      expect(worker.runner.options()?.concurrency).toBe(2);
      expect(canaryLines(worker.written)).toHaveLength(1);
      expect(worker.exits).toEqual([]);

      await stopCanaryWorker(worker);
    },
  );
});

describe('REL-10: the canary’s page is its own, and never touches the others', () => {
  test('REL-10-AC12: a failing run reports to the canary’s alarm alone: neither the worker’s check-in nor the SMS check’s alarm hears of it', async () => {
    const { urls } = threeChecks();
    const worker = canaryWorkerProcess({
      healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: urls.worker }),
      healthchecksSms: readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: urls.sms }),
      healthchecksCanary: readHealthchecksCanarySetting({ HEALTHCHECKS_CANARY_URL: urls.canary }),
    });
    await settle();

    await worker.runner.runTask('canary');

    expect(worker.alarm.statuses).toEqual(['failing']);
    expect(worker.checkIn.calls).toBe(0);
    expect(worker.smsAlarm.reports).toEqual([]);

    await stopCanaryWorker(worker);
  });

  test('REL-10-AC12: by default the canary reports through the Healthchecks.io adapter, made for its own address: a failing run sends that address with /fail appended exactly one HEAD, with no body, and nothing to any other', async () => {
    const received: { method: string | undefined; path: string | undefined; bodyBytes: number }[] =
      [];
    const server = createServer((request, response) => {
      let bodyBytes = 0;
      request.on('data', (chunk: Buffer) => {
        bodyBytes += chunk.length;
      });
      request.on('end', () => {
        received.push({ method: request.method, path: request.url, bodyBytes });
        response.writeHead(200);
        response.end();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const canaryCheck = syntheticUuid();

    try {
      const worker = canaryWorkerProcess({
        healthchecksCanary: {
          checkingIn: true,
          url: `http://127.0.0.1:${String(port)}/${canaryCheck}`,
        },
        defaultAlarm: true,
      });
      await settle();

      await expect(worker.runner.runTask('canary')).resolves.toBeUndefined();

      expect(received).toEqual([{ method: 'HEAD', path: `/${canaryCheck}/fail`, bodyBytes: 0 }]);
      await stopCanaryWorker(worker);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test('REL-10-AC12: a report that fails writes one canary_report_failed line beside the run’s, and the task completes: never a thrown task', async () => {
    const { urls } = threeChecks();
    const alarm = fakeCanaryAlarm();
    alarm.failWith(new Error('Healthchecks.io answered 500.'));
    const worker = canaryWorkerProcess({
      healthchecksCanary: readHealthchecksCanarySetting({ HEALTHCHECKS_CANARY_URL: urls.canary }),
      alarm,
    });
    await settle();

    await expect(worker.runner.runTask('canary')).resolves.toBeUndefined();

    expect(worker.log.events.filter(({ event }) => event.startsWith('canary_'))).toEqual([
      expect.objectContaining({ event: 'canary_run', outcome: 'NOT_CONFIGURED' }),
      { event: 'canary_report_failed' },
    ]);
    expect(worker.written.join('')).not.toContain('answered 500');

    await stopCanaryWorker(worker);
  });

  test('REL-10-AC12: while a canary run is in flight, never settling, the check-in and the SMS check still run each minute, each to its end', async () => {
    const clock = fakeClock(NOW);
    const heartbeats = fakeWorkerHeartbeats();
    const checkIn = fakeCheckIn();
    let smsChecks = 0;
    let canaryRuns = 0;
    const tasks = createTaskList({
      clock,
      heartbeats,
      checkIn,
      smsCheck: {
        check: () => {
          smsChecks += 1;
          return Promise.resolve('ok' as const);
        },
      },
      canary: {
        run: () => {
          canaryRuns += 1;
          return new Promise<never>(() => undefined);
        },
      },
      write: () => undefined,
    });
    let canarySettled = false;
    const { canary: canaryTask, heartbeat: heartbeatTask, sms_check: smsCheckTask } = tasks;
    expect(canaryTask, 'the canary task').toBeDefined();
    void Promise.resolve(canaryTask?.(null, helpersWith())).then(() => {
      canarySettled = true;
    });

    for (let minute = 0; minute < 3; minute += 1) {
      await heartbeats.record(await clock.now());
      await expect(heartbeatTask?.(null, helpersWith())).resolves.toBeUndefined();
      await expect(smsCheckTask?.(null, helpersWith())).resolves.toBeUndefined();
      clock.advance(60_000);
    }

    expect(checkIn.calls).toBe(3);
    expect(smsChecks).toBe(3);
    expect(canaryRuns).toBe(1);
    expect(canarySettled).toBe(false);
  });

  test('REL-10-AC12: with every canary run failing, the minute check-in follows each fresh beat as before; with the beat stale, as when the watchdog fails, there is none, whatever the canary did', async () => {
    const clock = fakeClock(NOW);
    const heartbeats = fakeWorkerHeartbeats();
    const checkIn = fakeCheckIn();
    let canaryRuns = 0;
    const tasks = createTaskList({
      clock,
      heartbeats,
      checkIn,
      canary: {
        run: () => {
          canaryRuns += 1;
          return Promise.resolve({ outcome: 'START_FAILED' });
        },
      },
      write: () => undefined,
    });
    const { canary: canaryTask, heartbeat: heartbeatTask } = tasks;

    await heartbeats.record(await clock.now());
    await canaryTask?.(null, helpersWith());
    await heartbeatTask?.(null, helpersWith());
    expect(checkIn.calls).toBe(1);

    clock.advance(BEAT_FRESH + 1);
    await canaryTask?.(null, helpersWith());
    await heartbeatTask?.(null, helpersWith());
    expect(checkIn.calls).toBe(1);
    expect(canaryRuns).toBe(2);
  });

  test('REL-10-AC12: while a canary task is in flight, its report hung, the sweep loop still runs every 10 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { urls } = threeChecks();
      const alarm = fakeCanaryAlarm();
      alarm.hang();
      const watchdog = stubWatchdog();
      const runner = recordingRunner();
      const signals = new EventEmitter();
      const running = runWorkerProcess('postgres://example/db', {
        runWorker: runner.run,
        signals,
        healthchecksCanary: readHealthchecksCanarySetting({ HEALTHCHECKS_CANARY_URL: urls.canary }),
        createCanaryAlarm: () => alarm,
        ...quietLoops(),
        watchdog,
        keepAlive: () => undefined,
        write: () => undefined,
        exit: () => undefined,
      });
      await vi.advanceTimersByTimeAsync(0);
      let canarySettled = false;
      void runner.runTask('canary').finally(() => {
        canarySettled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(alarm.reports).toHaveLength(1);

      const before = watchdog.count;
      for (let interval = 0; interval < 3; interval += 1) {
        watchdog.finish();
        await vi.advanceTimersByTimeAsync(10 * SECOND);
      }

      expect(watchdog.count - before).toBe(3);
      expect(canarySettled).toBe(false);
      watchdog.finish();
      signals.emit('SIGTERM');
      await vi.advanceTimersByTimeAsync(0);
      await running;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('REL-10: a stop waits for no canary', () => {
  test('REL-10-AC9: on SIGTERM with a canary run in flight, its report hung, the canary is handed Graphile’s abort signal, which ends it, and the worker exits with 0 no more than 5 s later', async () => {
    const events: string[] = [];
    const { urls } = threeChecks();
    const alarm = fakeCanaryAlarm({ events });
    alarm.hang();
    const worker = canaryWorkerProcess({
      healthchecksCanary: readHealthchecksCanarySetting({ HEALTHCHECKS_CANARY_URL: urls.canary }),
      alarm,
      events,
    });
    await settle();
    void worker.runner.runTask('canary').catch(() => undefined);
    expect(await eventually(() => alarm.reports.length === 1)).toBe(true);

    const signalled = performance.now();
    worker.signals.emit('SIGTERM');
    const exited = await eventually(() => events.includes('exit 0'), 3_000);

    expect(exited).toBe(true);
    expect(performance.now() - signalled).toBeLessThan(5_000 + 1_000);
    expect(events.indexOf(CANARY_ALARM_ABORTED)).toBeGreaterThanOrEqual(0);
    expect(events.indexOf(CANARY_ALARM_ABORTED)).toBeLessThan(events.indexOf('runner stopped'));
    expect(events.indexOf('runner stopped')).toBeLessThan(events.indexOf('exit 0'));
    await worker.running;
  });

  test('REL-10-AC9: the canary task never rejects: a run that came to any outcome, a skip included, completes the task, so Graphile never retries it', async () => {
    const heartbeats = fakeWorkerHeartbeats();
    const clock = fakeClock(NOW);
    for (const result of [
      { outcome: 'ON_TIME' },
      { outcome: 'NOT_OPENED' },
      { outcome: 'INTERRUPTED' },
      { skipped: 'RUN_IN_FLIGHT' },
    ]) {
      const { canary: canaryTask } = createTaskList({
        clock,
        heartbeats,
        canary: { run: () => Promise.resolve(result) },
      });

      await expect(canaryTask?.(null, helpersWith())).resolves.toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// REL-10-AC9: CANARY_WAIT, the wait the worker hands the canary in production.
// Every L6 test hands the canary the test kit's fakeWait, so its mutant
// `delay(ms, undefined, {})`, which ignores its signal, survived (#77): a
// stopped run still ends at once, but its timer would stay for up to 600 s.
//
// Real timers, on purpose: a faked timer would test the fake. However slow the
// machine, a right wait passes: each bound is started before the wait and due
// sooner, or after it and due later, or after the abort that has already
// settled it. A slow machine can only make a wrong wait fail later.
// pendingTimers counts the timers that keep Node running, as the wait's does.
// ---------------------------------------------------------------------------

/** How many timers this thread holds that keep Node running: Node's own count, read at once. */
function pendingTimers(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
}

/** The wait, with a rejection marked handled at once, so one that comes before its outcome is read is not reported as unhandled. */
function handled(waiting: Promise<void>): Promise<void> {
  waiting.catch(() => undefined);
  return waiting;
}

type WaitOutcome =
  | { settled: 'resolved'; value: unknown }
  | { settled: 'rejected'; name: string }
  | { settled: 'pending' };

/**
 * A real timer of `ms`, started now. `outcomeOf(waiting)` says what the wait
 * has come to when it fires: resolved and with what, rejected and with which
 * error's name, or still pending. It is cleared either way.
 */
function startBound(ms: number): { outcomeOf: (waiting: Promise<void>) => Promise<WaitOutcome> } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fired = new Promise<WaitOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve({ settled: 'pending' });
    }, ms);
  });
  return {
    outcomeOf: async (waiting) => {
      try {
        return await Promise.race([
          waiting.then(
            (value): WaitOutcome => ({ settled: 'resolved', value }),
            (error: unknown): WaitOutcome => ({
              settled: 'rejected',
              name: error instanceof Error ? error.name : String(error),
            }),
          ),
          fired,
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** A wait long enough that it can only settle within a test's bounds by its signal. */
const LONG_WAIT_MS = 10_000;
/** How long a wait's abort is given to show: far longer than it needs, far shorter than LONG_WAIT_MS. */
const ABORT_BOUND_MS = 200;

describe('REL-10: the canary’s production wait, which a stop ends at once', () => {
  beforeEach(() => {
    // Real timers for every test here, whatever another test left behind.
    vi.useRealTimers();
  });

  test('REL-10-AC9: CANARY_WAIT, with a signal that never aborts, is still waiting when a timer of 90 % of its ms has fired, and then resolves with nothing', async () => {
    const ms = 100;
    // The bound before the wait: started after it, a pause in between could
    // make it fall due after the wait's own timer.
    const atNinetyPercent = startBound(ms * 0.9);
    const waiting = CANARY_WAIT(ms, new AbortController().signal);

    expect(await atNinetyPercent.outcomeOf(waiting)).toEqual({ settled: 'pending' });
    expect(await startBound(5_000).outcomeOf(waiting)).toEqual({
      settled: 'resolved',
      value: undefined,
    });
  });

  test('REL-10-AC9: CANARY_WAIT rejects with an AbortError, as the test kit’s fakeWait does, as soon as its signal aborts while it is waiting, long before its 10 s are up', async () => {
    const controller = new AbortController();
    const underWay = startBound(20);
    const waiting = handled(CANARY_WAIT(LONG_WAIT_MS, controller.signal));
    // Still waiting, a turn of the event loop in, when the stop comes.
    expect(await underWay.outcomeOf(waiting)).toEqual({ settled: 'pending' });

    controller.abort();

    expect(await startBound(ABORT_BOUND_MS).outcomeOf(waiting)).toEqual({
      settled: 'rejected',
      name: 'AbortError',
    });
  });

  test('REL-10-AC9: CANARY_WAIT, with a signal that has already aborted, rejects with an AbortError at once and sets no timer', async () => {
    const controller = new AbortController();
    controller.abort();

    const before = pendingTimers();
    const waiting = CANARY_WAIT(LONG_WAIT_MS, controller.signal);
    const after = pendingTimers();
    const outcome = startBound(ABORT_BOUND_MS).outcomeOf(waiting);

    expect(after).toBe(before);
    expect(await outcome).toEqual({ settled: 'rejected', name: 'AbortError' });
  });

  test('REL-10-AC9: CANARY_WAIT holds one real timer while it waits, and an abort clears it there and then, so a stopped run leaves no timer pending for the rest of its 10 s', async () => {
    const controller = new AbortController();

    // Read with nothing awaited in between, so no other timer starts or fires.
    const before = pendingTimers();
    const waiting = handled(CANARY_WAIT(LONG_WAIT_MS, controller.signal));
    const whileWaiting = pendingTimers();
    controller.abort();
    const afterAbort = pendingTimers();

    // Without this, a count that missed the wait's timer would pass below
    // without showing anything.
    expect(whileWaiting).toBe(before + 1);
    expect(afterAbort).toBe(before);
    expect(await startBound(ABORT_BOUND_MS).outcomeOf(waiting)).toEqual({
      settled: 'rejected',
      name: 'AbortError',
    });
  });
});

// ---------------------------------------------------------------------------
// BUG-44: the wait startWorker hands the canary. The tests above hold
// CANARY_WAIT on its own, and every test of a run elsewhere hands the canary
// the test kit's fakeWait. So no test held that startWorker hands the canary
// CANARY_WAIT. A wait that ignored its signal, wired in its place, passed
// every test in this file (test-auditor, #80).
//
// So these run the canary that startWorker made, through the worker's own
// task list, and count the timer of its run limit: the wait of
// CANARY_RUN_LIMIT_MS that run.ts starts before anything else in a run, and
// aborts in the run's `finally`. It is the only wait these runs start: the
// first look and the polls come only after a start that succeeded, and the
// stop's wait for "I'm home" only once a journey has started. While the run
// is in flight, its run limit is one real timer; once the run has ended, by a
// stop or on its own, it is gone.
//
// Counted, never timed. Each assertion compares two reads of pendingTimers
// taken in the same turn of the event loop, so no timer can fire between
// them, however slow the machine:
//   - the first test compares `before` with `whileInFlight`, with nothing
//     awaited between them, and `beforeStop` with `afterStop`, with only the
//     abort and the end of the run it stops between them, which comes through
//     promise callbacks alone;
//   - the second test compares `before` with `whileInFlight`, with nothing
//     awaited between them, and `before` with `afterRun`, with only the run
//     between them, which ends through promise callbacks alone too.
// Each `settle()`, a turn of the event loop, comes before or between those
// pairs, never inside one.
// ---------------------------------------------------------------------------

/**
 * The canary device's registration: the insert into devices that returns the
 * ID of the row it wrote, for the canary's own device. The one statement of
 * the registration that the fake database answers with a row.
 */
const isTheCanaryDeviceInsert = ({ text, values }: FakePostgresQuery) =>
  /^insert into "devices" [\s\S]*\sreturning "id"$/i.test(text) &&
  values.includes(CANARY_IDS.deviceId);

/**
 * The fake database's answers to the canary's registration. The canary
 * device's insert returns the device's ID, as PostgreSQL returns the row it
 * wrote. Every other query is answered as quietDatabase answers it: a
 * set_config with one row, its value empty, and anything else with no rows.
 */
const registersTheCanary: FakePostgresHandler = (query) =>
  isTheCanaryDeviceInsert(query)
    ? { columns: ['id'], rows: [[CANARY_IDS.deviceId]] }
    : quietDatabase(query);

/**
 * untouchedClient, except that its first start is refused with a 503, so that
 * run ends at once. Every later call is untouchedClient's: recorded in
 * `calls`, never answered.
 */
function startRefusedThenHeld() {
  const calls: string[] = [];
  const untouched = untouchedClient(calls);
  return {
    calls,
    client: {
      ...untouched,
      start: () => {
        if (calls.includes('start')) {
          return untouched.start();
        }
        calls.push('start');
        return Promise.resolve({ ok: false as const, status: 503, code: null });
      },
    },
  };
}

/** The outcomes of the `canary_run` lines a log holds, in order. */
const canaryRunOutcomes = (log: FakeLog) =>
  log.events.flatMap((event) => (event.event === 'canary_run' ? [event.outcome] : []));

describe('BUG-44: the wait startWorker hands the canary, which a stop ends at once', () => {
  beforeEach(() => {
    // Real timers for every test here, whatever another test left behind.
    vi.useRealTimers();
  });

  test('BUG-44: a canary run startWorker made, stopped through Graphile’s abort signal while it is in flight, holds its wait’s one real timer until the stop, and none once the stop has ended it', async () => {
    const database = await listeningFakePostgres(registersTheCanary);
    try {
      const alarm = fakeCanaryAlarm();
      const { client, calls } = startRefusedThenHeld();
      const loops = quietLoops();
      const runner = recordingRunner();
      const worker = await startWorker(database.url, runner.run, {
        ...loops,
        write: () => undefined,
        canary: { client, credentialHash: hashCredential(syntheticCredential()), alarm },
      });
      try {
        const { canary: canaryTask } = runner.options()?.taskList ?? {};
        expect(canaryTask, 'the canary task').toBeDefined();

        // The first run registers the canary over the fake database and comes
        // to START_FAILED, so the run below reaches the database for nothing.
        await canaryTask?.(null, helpersWith());
        expect(canaryRunOutcomes(loops.log)).toEqual(['START_FAILED']);
        const queriesBefore = database.queries.length;

        const graphile = new AbortController();
        let ended = false;
        const before = pendingTimers();
        const run = Promise.resolve(canaryTask?.(null, helpersWith(graphile.signal))).finally(
          () => {
            ended = true;
          },
        );
        const whileInFlight = pendingTimers();
        // A turn of the event loop: the run is still in flight, waiting on its start.
        await settle();
        expect(ended, 'the run ended before it was stopped').toBe(false);
        expect(calls).toEqual(['start', 'start']);

        const beforeStop = pendingTimers();
        graphile.abort();
        await run;
        const afterStop = pendingTimers();

        // Without this, a count that missed the wait's timer would pass below
        // without showing anything.
        expect(whileInFlight, 'timers while the run is in flight').toBe(before + 1);
        expect(afterStop, 'timers once the stop has ended the run').toBe(beforeStop - 1);
        expect(canaryRunOutcomes(loops.log)).toEqual(['START_FAILED', 'INTERRUPTED']);
        expect(alarm.statuses).toEqual(['failing']);
        expect(calls).toEqual(['start', 'start']);
        expect(database.queries.length, 'queries the stopped run sent').toBe(queriesBefore);
      } finally {
        await worker.stop();
      }
    } finally {
      await database.close();
    }
  });

  test('BUG-44: a canary run startWorker made holds its run limit as one real timer from its first moment, and has cleared it by the time the run has ended on its own', async () => {
    const alarm = fakeCanaryAlarm();
    const loops = quietLoops();
    const runner = recordingRunner();
    // Unusable settings: each run comes to NOT_CONFIGURED and reports, with no
    // database and no API, so the run ends through promise callbacks alone.
    const worker = await startWorker('postgres://example/db', runner.run, {
      ...loops,
      write: () => undefined,
      canary: { client: null, credentialHash: null, alarm },
    });
    try {
      const { canary: canaryTask } = runner.options()?.taskList ?? {};
      expect(canaryTask, 'the canary task').toBeDefined();
      // A turn of the event loop first: the worker's loops set their timers in
      // promise callbacks after their first runs, which would otherwise land
      // between the counts below.
      await settle();

      const before = pendingTimers();
      const run = Promise.resolve(canaryTask?.(null, helpersWith()));
      const whileInFlight = pendingTimers();
      await run;
      const afterRun = pendingTimers();

      expect(whileInFlight, 'timers while the run is in flight').toBe(before + 1);
      expect(afterRun, 'timers once the run has ended').toBe(before);
      expect(canaryRunOutcomes(loops.log)).toEqual(['NOT_CONFIGURED']);
      expect(alarm.statuses).toEqual(['failing']);
    } finally {
      await worker.stop();
    }
  });
});
