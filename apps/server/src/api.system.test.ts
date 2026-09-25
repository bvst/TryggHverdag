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

describe('GET /health when the database cannot answer', () => {
  // safety-reviewer asked for this, and was right to: the behaviour was already
  // correct and entirely untested, which means nothing would have noticed it
  // changing. An error handler added later for tidiness — or a middleware that
  // catches everything and returns a friendly body — would turn the one endpoint
  // an uptime monitor watches into a permanent green tick over a dead system.
  const apiThatCannotCheck = () =>
    createApi({
      health: {
        check: () =>
          Promise.reject(new Error('The database did not return a time, so nothing can be timed')),
      },
    });

  test('it fails loudly: 500, not a cheerful 200', async () => {
    const response = await apiThatCannotCheck().request(HEALTH);

    expect(response.status).toBe(500);
  });

  test('the body says something went wrong rather than being empty', async () => {
    // A 500 with an empty body reads to some monitors as "no data", which is
    // not the same as "this system is broken".
    const response = await apiThatCannotCheck().request(HEALTH);

    expect(await response.json()).toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });

  test('it does not answer `ok`, and does not answer at all in the health shape', async () => {
    // The failure that matters: anything that parses as a health response is
    // something a monitor will believe.
    const response = await apiThatCannotCheck().request(HEALTH);

    expect(healthResponseSchema.safeParse(await response.json()).success).toBe(false);
  });

  test('SEC-03: the internal error does not reach the caller', async () => {
    // The message names the database and what it failed to do. That belongs in
    // the server's own record, not in a response anyone on the internet can get
    // by asking an unauthenticated endpoint at the wrong moment.
    const response = await apiThatCannotCheck().request(HEALTH);

    expect(await response.text()).not.toContain('database');
  });
});

describe('REL-08: the keyword UptimeRobot watches for', () => {
  // UptimeRobot watches /v1/health as a keyword monitor: it alerts when the
  // raw body does not contain `"status":"ok"`, quotes included (D-079). So
  // these read the bytes the API sends, not the parsed object. The dangerous
  // direction is a body that still matches while the system is not healthy —
  // a green monitor over a worker nobody is watching.
  const KEYWORD = '"status":"ok"';

  test('INF-08-AC10: a worker that beat a moment ago: the raw body contains the keyword, exactly', async () => {
    const { api } = apiWith({ lastBeatAt: new Date(NOW.getTime() - 30_000) });

    const text = await (await api.request(HEALTH)).text();

    expect(text).toContain(KEYWORD);
  });

  test('INF-08-AC10: a worker that beat exactly WORKER_STALE_AFTER_MS ago is still within it, and so is the keyword', async () => {
    const { api, clock } = apiWith({ lastBeatAt: NOW });
    clock.advance(WORKER_STALE_AFTER_MS);

    const text = await (await api.request(HEALTH)).text();

    expect(text).toContain(KEYWORD);
  });

  test('INF-08-AC10: a worker silent past the threshold: the keyword is missing', async () => {
    const { api, clock } = apiWith({ lastBeatAt: NOW });
    clock.advance(WORKER_STALE_AFTER_MS + 1);

    const text = await (await api.request(HEALTH)).text();

    expect(text).not.toContain(KEYWORD);
    expect(text).not.toMatch(/"status"\s*:\s*"ok"/);
  });

  test('INF-08-AC10: a worker that has never beaten: the keyword is missing', async () => {
    const { api } = apiWith({ lastBeatAt: null });

    const text = await (await api.request(HEALTH)).text();

    expect(text).not.toContain(KEYWORD);
    expect(text).not.toMatch(/"status"\s*:\s*"ok"/);
  });

  test('INF-08-AC10: a health check that cannot run at all, the 500 answer: the keyword is missing', async () => {
    const api = createApi({
      health: {
        check: () =>
          Promise.reject(new Error('The database did not return a time, so nothing can be timed')),
      },
    });

    const response = await api.request(HEALTH);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain(KEYWORD);
    expect(text).not.toMatch(/"status"\s*:\s*"ok"/);
  });
});
