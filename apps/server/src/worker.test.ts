// The worker is a safety path (AR-06): what it does, and how often, is what
// turns silence from a phone into an alert. So its wiring is asserted here
// rather than left to be discovered in production.
import { fakeClock, fakeWorkerHeartbeats } from '@trygghverdag/test-kit';
import { EventEmitter } from 'node:events';
import process from 'node:process';
import { describe, expect, test, vi } from 'vitest';
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
