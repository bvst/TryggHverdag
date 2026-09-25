// The worker is a safety path (AR-06): what it does, and how often, is what
// turns silence from a phone into an alert. So its wiring is asserted here
// rather than left to be discovered in production.
import {
  BEAT_RECORDED,
  CHECKED_IN,
  SYNTHETIC_CHECK_UUID as CHECK,
  SYNTHETIC_PING_URL as PING_URL,
  fakeCheckIn,
  fakeClock,
  fakeWorkerHeartbeats,
  fc,
} from '@trygghverdag/test-kit';
import { EventEmitter } from 'node:events';
import process from 'node:process';
import { describe, expect, test, vi } from 'vitest';
import { healthchecksCheckIn } from './adapters/healthchecks.ts';
import { readHealthchecksSetting, type HealthchecksSetting } from './config.ts';
import type { CheckIn } from './ports.ts';
import {
  HEARTBEAT_CRONTAB,
  createTaskList,
  runWorkerProcess,
  startWorker,
  type RunWorker,
} from './worker.ts';

const NOW = new Date('2026-09-23T22:15:00.000Z');

describe('createTaskList', () => {
  test('REL-01: the heartbeat records the time the database gave, not this process', async () => {
    // The API compares this stamp against its own reading of now. If the worker
    // ever stamped it from its own clock, two machines drifting apart would be
    // read as the worker having stopped — a page in the night for nothing.
    const clock = fakeClock(NOW);
    const heartbeats = fakeWorkerHeartbeats(null);
    const { heartbeat } = createTaskList({ clock, heartbeats });

    await heartbeat?.(null, {} as never);

    expect((await heartbeats.lastBeat())?.toISOString()).toBe(NOW.toISOString());
  });

  test('beating twice moves the recorded time forward', async () => {
    const clock = fakeClock(NOW);
    const heartbeats = fakeWorkerHeartbeats(null);
    const { heartbeat } = createTaskList({ clock, heartbeats });

    await heartbeat?.(null, {} as never);
    clock.advance(60_000);
    await heartbeat?.(null, {} as never);

    expect((await heartbeats.lastBeat())?.getTime()).toBe(NOW.getTime() + 60_000);
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

    await startWorker('postgres://example/db', fakeRunner);

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

    await startWorker('postgres:///db?host=/nonexistent-socket-dir', fakeRunner);
    const { heartbeat } = options?.taskList ?? {};

    await expect(heartbeat?.(null, {} as never)).rejects.toThrow(/select now\(\)/);
  });
});

type RunnerOptions = Parameters<Parameters<typeof startWorker>[1] & object>[0];

/**
 * A runner that records what happens to it. `ends` settles the promise that
 * Graphile Worker's own runner settles when it stops or crashes.
 */
function recordingRunner() {
  const events: string[] = [];
  let options: RunnerOptions | undefined;
  let settle: { resolve: () => void; reject: (error: Error) => void } = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  const promise = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const run = ((given: RunnerOptions) => {
    options = given;
    const pool = given.pgPool;
    if (pool !== undefined) {
      const end = pool.end.bind(pool);
      pool.end = () => {
        events.push('pool ended');
        return end();
      };
    }
    return Promise.resolve({
      promise,
      stop: () => {
        events.push('runner stopped');
        settle.resolve();
        return Promise.resolve();
      },
    } as never);
  }) as RunWorker;
  return {
    run,
    events,
    options: () => options,
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
    const worker = await startWorker('postgres://example/db', runner.run);

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
    const worker = await startWorker('postgres://example/db', runner.run);

    const stopped = worker.untilStopped();
    await worker.stop();

    await expect(stopped).resolves.toBeUndefined();
  });

  test('AR-06: a runner that ends without being asked to is a failure, not a quiet exit', async () => {
    // A worker process that exits with 0 is one the platform does not restart,
    // and a worker that is not running is a watchdog that is not watching.
    const runner = recordingRunner();
    const worker = await startWorker('postgres://example/db', runner.run);

    runner.endsOnItsOwn();

    await expect(worker.untilStopped()).rejects.toThrow(/without being asked/);
  });

  test('a runner that crashes passes the crash on, so the process can say what happened', async () => {
    const runner = recordingRunner();
    const worker = await startWorker('postgres://example/db', runner.run);

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

    await startWorker('postgres://example/db', runner.run);

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
// never happen is a ping without a beat: Healthchecks.io would report a worker
// alive that is not recording anything, and nobody would be paged. And the
// ping URL must never be written anywhere: anyone who has it can keep the check
// green while the worker is dead.
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

/** What the fake database adds to `events` when the heartbeat reads its time. */
const TIME_READ = 'time read';

/** What was written, as lines. */
const linesOf = (written: string[]) =>
  written
    .join('')
    .split('\n')
    .filter((line) => line !== '');

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

/**
 * Makes the pool startWorker handed to the runner answer the heartbeat's two
 * queries as PostgreSQL would, so the heartbeat startWorker built — with the
 * real database clock and the real heartbeat table behind it — can run to the
 * end with no database. Each query joins `events` only once it has been
 * answered. Set `failing` to make one of them fail instead.
 */
function answerLikePostgres(runner: ReturnType<typeof recordingRunner>, events: string[]) {
  const pool = runner.options()?.pgPool;
  if (pool === undefined) {
    throw new Error('The runner was never given a pool.');
  }
  const database: { failing: 'time' | 'record' | null } = { failing: null };
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
      if (text.startsWith('insert into "worker_heartbeat"')) {
        if (database.failing === 'record') {
          throw new Error('Connection terminated unexpectedly');
        }
        events.push(BEAT_RECORDED);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`The heartbeat asked the database something unexpected: ${text}`);
    });
  };
  pool.query = answer as never;
  return database;
}

/** Runs the heartbeat task the runner was given, as Graphile Worker's cron would. */
function runHeartbeat(runner: ReturnType<typeof recordingRunner>): Promise<void> {
  const { heartbeat } = runner.options()?.taskList ?? {};
  if (heartbeat === undefined) {
    return Promise.reject(new Error('No heartbeat task was scheduled.'));
  }
  return Promise.resolve(heartbeat(null, {} as never)).then(() => undefined);
}

/**
 * runWorkerProcess with everything it reaches replaced: a recording runner,
 * signals the test sends, and — unless `createCheckIn` is 'default' — a
 * check-in the test owns. Returns what it wrote, how it exited, and every URL
 * it asked a check-in to be made for.
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

describe('REL-08: the heartbeat checks in with Healthchecks.io only after a recorded beat', () => {
  /** A task list over fakes that share one list of what happened, in order. */
  function heartbeatOverFakes() {
    const events: string[] = [];
    const written: string[] = [];
    const clock = fakeClock(NOW);
    const heartbeats = fakeWorkerHeartbeats(null, { events });
    const checkIn = fakeCheckIn({ events });
    const { heartbeat } = createTaskList({
      clock,
      heartbeats,
      checkIn,
      write: (text) => {
        written.push(text);
      },
    });
    const run = () => Promise.resolve(heartbeat?.(null, {} as never));
    return { events, written, clock, heartbeats, checkIn, run };
  }

  test('INF-08-AC2: a recorded beat is followed by exactly one check-in, and nothing is written', async () => {
    const { events, written, heartbeats, checkIn, run } = heartbeatOverFakes();

    await expect(run()).resolves.toBeUndefined();

    expect(events).toEqual([BEAT_RECORDED, CHECKED_IN]);
    expect(checkIn.calls).toBe(1);
    expect((await heartbeats.lastBeat())?.toISOString()).toBe(NOW.toISOString());
    expect(written).toEqual([]);
  });

  test('INF-08-AC2: for any run of heartbeats, check-ins equal recorded beats, and each follows its own', async () => {
    // The ordering rule, over every mix of outcomes a minute can have. The
    // fakes add to `events` only once a beat has actually been recorded, so a
    // check-in sent alongside the write rather than after it shows up here as
    // the wrong order, not as a pass.
    const OUTCOMES = ['beats', 'the clock fails', 'recording fails', 'the check-in fails'] as const;

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...OUTCOMES), { maxLength: 25 }),
        async (outcomes) => {
          const { events, written, clock, heartbeats, checkIn, run } = heartbeatOverFakes();
          const expected: string[] = [];
          let lastRecorded: Date | null = null;

          for (const outcome of outcomes) {
            clock.recover();
            heartbeats.recover();
            checkIn.recover();
            const failure = new Error(`${outcome}, on purpose`);
            if (outcome === 'the clock fails') {
              clock.failWith(failure);
            } else if (outcome === 'recording fails') {
              heartbeats.failWith(failure);
            } else if (outcome === 'the check-in fails') {
              checkIn.failWith(failure);
            }

            if (outcome === 'the clock fails' || outcome === 'recording fails') {
              await expect(run()).rejects.toBe(failure);
            } else {
              await expect(run()).resolves.toBeUndefined();
              expected.push(BEAT_RECORDED, CHECKED_IN);
              clock.recover();
              lastRecorded = await clock.now();
            }
            clock.advance(60_000);
          }

          expect(events).toEqual(expected);
          expect(checkIn.calls).toBe(expected.length / 2);
          expect(await heartbeats.lastBeat()).toEqual(lastRecorded);
          const failedCheckIns = outcomes.filter((outcome) => outcome === 'the check-in fails');
          expect(linesOf(written)).toHaveLength(failedCheckIns.length);
          for (const line of linesOf(written)) {
            expect(line.startsWith(CHECK_IN_FAILED)).toBe(true);
          }
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
    expect(events).toEqual([BEAT_RECORDED, CHECKED_IN]);
  });

  test('INF-08-AC3: when the beat cannot be recorded, there is no check-in, and the task fails as before', async () => {
    const { events, written, heartbeats, checkIn, run } = heartbeatOverFakes();
    const failure = new Error('Connection terminated unexpectedly');
    heartbeats.failWith(failure);

    await expect(run()).rejects.toBe(failure);

    expect(checkIn.calls).toBe(0);
    expect(events).toEqual([]);
    expect(written).toEqual([]);

    heartbeats.recover();
    await run();
    expect(events).toEqual([BEAT_RECORDED, CHECKED_IN]);
  });

  test.each([
    ['a non-2xx answer', 'Healthchecks.io answered 500'],
    ['no answer in time', 'The operation was aborted due to timeout'],
    ['no connection', 'fetch failed'],
  ])(
    'INF-08-AC4: a check-in that fails with %s does not fail the beat: recorded once, one line with the reason',
    async (_what, reason) => {
      const { events, written, heartbeats, checkIn, run } = heartbeatOverFakes();
      checkIn.failWith(new Error(reason));

      await expect(run()).resolves.toBeUndefined();

      expect(events).toEqual([BEAT_RECORDED, CHECKED_IN]);
      expect((await heartbeats.lastBeat())?.toISOString()).toBe(NOW.toISOString());
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
    const { written, checkIn, clock, run } = heartbeatOverFakes();
    checkIn.failWith(new Error('Healthchecks.io answered 500'));

    await run();
    clock.advance(60_000);
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
        heartbeats: fakeWorkerHeartbeats(null),
        checkIn,
      });

      await heartbeat?.(null, {} as never);

      const lines = linesOf(stderr.mock.calls.map(([text]) => String(text)));
      expect(lines.filter((line) => line.startsWith(CHECK_IN_FAILED))).toHaveLength(1);
      expect(lines.join('\n')).toContain('Healthchecks.io answered 500');
    } finally {
      stderr.mockRestore();
    }
  });
});

describe('REL-08: the heartbeat startWorker schedules checks in through the check-in it was given', () => {
  test('INF-08-AC2: it reads the database time, records the beat, and only then checks in', async () => {
    const events: string[] = [];
    const runner = recordingRunner();
    const checkIn = fakeCheckIn({ events });
    await startWorker('postgres://example/db', runner.run, { checkIn, write: () => undefined });
    answerLikePostgres(runner, events);

    await expect(runHeartbeat(runner)).resolves.toBeUndefined();

    expect(events).toEqual([TIME_READ, BEAT_RECORDED, CHECKED_IN]);
  });

  test('INF-08-AC3: when recording the beat fails, it does not check in, and fails as before', async () => {
    const events: string[] = [];
    const runner = recordingRunner();
    const checkIn = fakeCheckIn({ events });
    await startWorker('postgres://example/db', runner.run, { checkIn, write: () => undefined });
    const database = answerLikePostgres(runner, events);
    database.failing = 'record';

    await expect(runHeartbeat(runner)).rejects.toThrow(/insert into "worker_heartbeat"/);
    expect(events).toEqual([TIME_READ]);
    expect(checkIn.calls).toBe(0);

    database.failing = null;
    await runHeartbeat(runner);
    expect(events).toEqual([TIME_READ, TIME_READ, BEAT_RECORDED, CHECKED_IN]);
  });

  test('INF-08-AC3: when the database time cannot be read, it does not check in', async () => {
    const events: string[] = [];
    const runner = recordingRunner();
    const checkIn = fakeCheckIn({ events });
    await startWorker('postgres://example/db', runner.run, { checkIn, write: () => undefined });
    const database = answerLikePostgres(runner, events);
    database.failing = 'time';

    await expect(runHeartbeat(runner)).rejects.toThrow(/select now\(\)/);
    expect(events).toEqual([]);
    expect(checkIn.calls).toBe(0);

    database.failing = null;
    await runHeartbeat(runner);
    expect(events).toEqual([TIME_READ, BEAT_RECORDED, CHECKED_IN]);
  });

  test('INF-08-AC3: a heartbeat wired to a database it cannot reach sends no check-in', async () => {
    // The same unreachable database as the AR-06 wiring test above: the
    // attempt fails in milliseconds, with no network involved.
    const events: string[] = [];
    const runner = recordingRunner();
    const checkIn = fakeCheckIn({ events });
    await startWorker('postgres:///db?host=/nonexistent-socket-dir', runner.run, {
      checkIn,
      write: () => undefined,
    });

    await expect(runHeartbeat(runner)).rejects.toThrow(/select now\(\)/);
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
    });
    answerLikePostgres(runner, events);

    await expect(runHeartbeat(runner)).resolves.toBeUndefined();

    expect(events).toEqual([TIME_READ, BEAT_RECORDED, CHECKED_IN]);
    expect(linesOf(written)).toHaveLength(1);
    expect(linesOf(written)[0]?.startsWith(CHECK_IN_FAILED)).toBe(true);
    expect(linesOf(written)[0]).toContain('Healthchecks.io answered 429');
  });
});

describe('REL-08: runWorkerProcess and HEALTHCHECKS_WORKER_URL', () => {
  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['an http: address', `http://127.0.0.1:1/${CHECK}`],
    ['not an address at all', `hc-ping.com/${CHECK}`],
  ])(
    'INF-08-AC6: with HEALTHCHECKS_WORKER_URL %s it starts, beats and stays up, never checks in, and says why once',
    async (_what, value) => {
      // A monitoring setting must never stop the watchdog it watches, or put
      // it in a crash loop.
      const healthchecks = readHealthchecksSetting(
        value === undefined ? {} : { HEALTHCHECKS_WORKER_URL: value },
      );
      const worker = workerProcess({ healthchecks });
      await settle();

      expect(worker.runner.options()?.crontab).toBe(HEARTBEAT_CRONTAB);
      answerLikePostgres(worker.runner, worker.events);
      await expect(runHeartbeat(worker.runner)).resolves.toBeUndefined();
      expect(worker.events).toEqual([TIME_READ, BEAT_RECORDED]);
      expect(worker.created).toEqual([]);

      const lines = linesOf(worker.written);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(NOT_CHECKING_IN);
      expect(lines[0]).toContain('HEALTHCHECKS_WORKER_URL');
      expect(lines[0]).toContain(reasonOf(healthchecks));
      expect(worker.written.join('')).not.toContain(CHECK);
      expect(worker.exits).toEqual([]);

      await stopCleanly(worker);
    },
  );

  test('INF-08-AC6: with a usable https: address it says it is checking in, without saying where, and checks in after each beat', async () => {
    const worker = workerProcess({
      healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: PING_URL }),
    });
    await settle();

    expect(worker.created).toEqual([PING_URL]);
    expect(linesOf(worker.written)).toHaveLength(1);
    expect(linesOf(worker.written)[0]).toMatch(CHECKING_IN);

    answerLikePostgres(worker.runner, worker.events);
    await expect(runHeartbeat(worker.runner)).resolves.toBeUndefined();

    expect(worker.events).toEqual([TIME_READ, BEAT_RECORDED, CHECKED_IN]);
    expect(worker.checkIn.calls).toBe(1);
    expect(linesOf(worker.written)).toHaveLength(1);
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

    const lines = linesOf(worker.written);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(CHECKING_IN);
    expect(lines[1]?.startsWith(CHECK_IN_FAILED)).toBe(true);
    expect(worker.written.join('')).not.toContain(PING_URL);
    expect(worker.written.join('')).not.toContain(CHECK);

    await stopCleanly(worker);
  });

  test('INF-08-AC4: by default it checks in through the Healthchecks.io adapter, and a check-in that fails is one line, not a failed beat', async () => {
    // No check-in is injected here, so this is the adapter production uses,
    // and PING_URL's port 1 is what makes its fetch fail.
    const worker = workerProcess({
      healthchecks: readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: PING_URL }),
      createCheckIn: 'default',
    });
    await settle();
    answerLikePostgres(worker.runner, worker.events);

    await expect(runHeartbeat(worker.runner)).resolves.toBeUndefined();

    expect(worker.events).toEqual([TIME_READ, BEAT_RECORDED]);
    const lines = linesOf(worker.written);
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
      write: (text) => {
        written.push(text);
      },
      exit: () => undefined,
    });
    await settle();

    expect(runner.options()?.crontab).toBe(HEARTBEAT_CRONTAB);
    expect(linesOf(written)).toHaveLength(1);
    expect(linesOf(written)[0]).toMatch(NOT_CHECKING_IN);
    expect(linesOf(written)[0]).toContain('HEALTHCHECKS_WORKER_URL');

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
    // checks in after a beat there. Without it, "nothing checked in" below
    // would pass just as well for a worker that never checks in anywhere.
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
