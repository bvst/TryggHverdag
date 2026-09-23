// L6 system. The whole API in one process, with fakes for the outside world and
// a clock the test moves by hand — the level where "the alert went out five
// minutes after the phone went quiet" will be proven in M2.
//
// What makes it a system test rather than a unit test is that nothing here is
// stubbed between the HTTP request and the domain rule: the real router, the
// real contract, the real serialisation. Only the edges are fake.
import { fakeClock, fakeWorkerHeartbeats } from '@trygghverdag/test-kit';
import { API_PREFIX, WORKER_STALE_AFTER_MS, healthResponseSchema } from '@trygghverdag/contracts';
import { describe, expect, test } from 'vitest';
import { createApi } from './api.ts';
import { createHealthService } from './modules/health/service.ts';

const NOW = new Date('2026-09-23T22:15:00.000Z');
const HEALTH = `${API_PREFIX}/health`;

function apiWith({ lastBeatAt }: { lastBeatAt: Date | null }) {
  const clock = fakeClock(NOW);
  const heartbeats = fakeWorkerHeartbeats(lastBeatAt);
  const api = createApi({ health: createHealthService({ clock, heartbeats }) });
  return { api, clock, heartbeats };
}

describe('GET /health', () => {
  test('a worker that checked in a moment ago: 200, and the system is ok', async () => {
    const { api } = apiWith({ lastBeatAt: new Date(NOW.getTime() - 30_000) });

    const response = await api.request(HEALTH);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      checkedAt: NOW.toISOString(),
      worker: { lastBeatAt: new Date(NOW.getTime() - 30_000).toISOString(), silentForMs: 30_000 },
    });
  });

  test('the answer is the shape the app was built against', async () => {
    // Parsing the response with the contract's own schema is the point: if the
    // server ever answers something the schema does not accept, every app in
    // the field is about to break, and this is where that shows up.
    const { api } = apiWith({ lastBeatAt: NOW });

    const parsed = healthResponseSchema.safeParse(await (await api.request(HEALTH)).json());

    expect(parsed.success).toBe(true);
  });

  test('a worker gone quiet: still 200, but the body says degraded', async () => {
    // 200 on purpose. The process answering is a different question from the
    // system working, and a monitor that only watched the status code would
    // report green while nobody was watching anyone walk home.
    const { api, clock } = apiWith({ lastBeatAt: NOW });
    clock.advance(WORKER_STALE_AFTER_MS + 1);

    const response = await api.request(HEALTH);
    const body = (await response.json()) as { status: string; worker: { silentForMs: number } };

    expect(response.status).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.worker.silentForMs).toBe(WORKER_STALE_AFTER_MS + 1);
  });

  test('a worker that has never run is degraded from the first second', async () => {
    const { api } = apiWith({ lastBeatAt: null });

    const body = (await (await api.request(HEALTH)).json()) as {
      status: string;
      worker: { lastBeatAt: null; silentForMs: null };
    };

    expect(body.status).toBe('degraded');
    expect(body.worker).toEqual({ lastBeatAt: null, silentForMs: null });
  });

  test('a route that does not exist is a 404, not a 200 with an empty body', async () => {
    const { api } = apiWith({ lastBeatAt: NOW });

    expect((await api.request(`${API_PREFIX}/nope`)).status).toBe(404);
  });

  test('the routes live under the API version and nowhere else', async () => {
    const { api } = apiWith({ lastBeatAt: NOW });

    expect((await api.request('/health')).status).toBe(404);
  });
});
