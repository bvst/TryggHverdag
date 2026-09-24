// The worker is a safety path (AR-06): what it does, and how often, is what
// turns silence from a phone into an alert. So its wiring is asserted here
// rather than left to be discovered in production.
import { fakeClock, fakeWorkerHeartbeats } from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import { HEARTBEAT_CRONTAB, createTaskList, startWorker } from './worker.ts';

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
  }) as Parameters<typeof startWorker>[1];
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
