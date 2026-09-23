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
});
