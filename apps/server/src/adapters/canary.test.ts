// L2 adapter: the staging canary's HTTP client (REL-10, PRIV-07; D-128).
//
// The canary goes through the public API as a phone would: Clever Cloud's
// routing, TLS, the API process, its authentication, the contract's
// validation and its three routes (the spec's approach item 3). Its client is
// the one place that holds the canary's device credential and speaks HTTP, so
// what is held here:
//   - each route is called as the contract says, with the canary's own
//     values: the responder alone at the start; a heartbeat with a fresh
//     event ID, no battery level and no position; "I'm home" with no body;
//   - every answer that is not the route's success comes back as a result
//     naming its HTTP status, or none for a request that got no answer: a
//     refusal, a server error, a redirect (never followed), a body the
//     contract refuses, a network failure, and a request still unanswered
//     after its own timeout (AC6). A 409 to the start names the canary's
//     unended journey, which the run's leftover and overlap rules read (AC8);
//   - the credential goes only in `Authorization: Bearer`, only to the
//     configured origin, and nothing the client returns, throws or writes
//     holds it, a coordinate, a phone-number-shaped value or the walker's ID,
//     whatever an error it met held (AC15).
//
// The answers that are not canned come from the real API, in-process, over
// the fake journey store: the start's 201 and 409 and the heartbeat's and
// "I'm home"'s 200 are the server's own, so a client that misread their shape
// fails here. No request leaves this machine: the fetch is injected, or, for
// the redirect, a stand-in server on the loopback address.
import {
  CANARY_IDS,
  apiPath,
  fakeClock,
  fakeJourneyStore,
  fakeLog,
  fakeWorkerHeartbeats,
  syntheticCoordinate,
  syntheticCredential,
  syntheticUuid,
} from '@trygghverdag/test-kit';
import {
  EVENT_ID_PATTERN,
  MAX_EVENT_ID_LENGTH,
  heartbeatRequestSchema,
} from '@trygghverdag/contracts';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import process from 'node:process';
import { inspect } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';
import { createApi } from '../api.ts';
import { captured, markersIn } from '../capture.test.ts';
import {
  CANARY_DEADLINE_MS,
  CANARY_RUN_LIMIT_MS,
  CANARY_STAND_DOWN_LIMIT_MS,
} from '../domain/canary.ts';
import { createAcknowledgementService } from '../modules/alerts/acknowledgement.ts';
import { createClosureService } from '../modules/alerts/closure.ts';
import { createHealthService } from '../modules/health/service.ts';
import { createJourneyService } from '../modules/journeys/service.ts';
import type { DeviceAuthenticator } from '../ports.ts';
import { CANARY_REQUEST_TIMEOUT_MS, httpCanaryClient } from './canary.ts';
import { hashCredential } from './device-credentials.ts';

/** Where the canary's API is, for these tests: https, as staging's is, and never fetched for real. */
const ORIGIN = 'https://canary-api.invalid';

const START = new Date('2026-10-01T21:00:00.000Z');

/** A request as the client sent it, read back whole. */
interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  redirect: string;
  hadSignal: boolean;
}

/**
 * How a fetch stands in: a canned answer, or the real API's. `signal` is the
 * one the client handed its fetch: the Request's own follows it only through
 * a weak reference, which garbage collection can cut.
 */
type Responder = (request: Request, signal: AbortSignal | null) => Promise<Response> | Response;

/**
 * The real API over the fake journey store, with the canary registered: its
 * device authenticated by the hash of its credential, as the adapter
 * authenticates it. And a fetch that records each request whole, then hands
 * it to `respond`, the API by default.
 */
async function world() {
  const clock = fakeClock(START);
  const store = fakeJourneyStore({ clock });
  const log = fakeLog();
  const credential = syntheticCredential();
  await store.registerCanary({ credentialHash: hashCredential(credential) });
  const devices: DeviceAuthenticator = {
    authenticate: (given) => Promise.resolve(store.deviceWithCredentialHash(hashCredential(given))),
  };
  const api = createApi({
    health: createHealthService({ clock, heartbeats: fakeWorkerHeartbeats() }),
    journeys: createJourneyService({ clock, journeys: store, log }),
    devices,
    acknowledgements: createAcknowledgementService({ alerts: store, log }),
    closures: createClosureService({ alerts: store, log }),
  });
  const sent: Sent[] = [];
  let respond: Responder = (request) => api.fetch(request);
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
    const request = new Request(input, init);
    sent.push({
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: await request.clone().text(),
      redirect: request.redirect,
      hadSignal: init?.signal !== undefined && init.signal !== null,
    });
    return respond(request, signal);
  };
  return {
    store,
    credential,
    sent,
    api,
    client: (options: { timeoutMs?: number } = {}) =>
      httpCanaryClient({ baseUrl: ORIGIN, credential, fetch, ...options }),
    /** From now on, every request is answered by this. */
    answerWith(responder: Responder) {
      respond = responder;
    },
    /** From now on, requests to this path get this answer, and the rest the API's. */
    answerPath(path: string, answer: () => Response | Promise<Response>) {
      const before = respond;
      respond = (request, signal) =>
        new URL(request.url).pathname === path ? answer() : before(request, signal);
    },
  };
}

/** A JSON answer of this status. */
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * A fetch that never answers, but gives up, as Node's does, when its signal
 * aborts. It listens to the signal the client handed its fetch, not the
 * Request's own: that one follows the client's only through a weak reference,
 * so a Request collected as garbage would leave this waiting for an abort that
 * never comes, and a client that relied on its signal alone would hang here
 * though it would not on a real fetch.
 */
const neverAnswering: Responder = (request, signal) =>
  new Promise<Response>((_resolve, reject) => {
    const given = signal ?? request.signal;
    if (given.aborted) {
      reject(given.reason as Error);
      return;
    }
    given.addEventListener('abort', () => {
      reject(given.reason as Error);
    });
  });

/** What a client call came to, resolved or rejected, so a test can read either. */
async function outcomeOf<T>(call: Promise<T>): Promise<{ result: T } | { error: unknown }> {
  return call.then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  );
}

describe('REL-10: the canary client’s timeout', () => {
  test('REL-10-AC6: CANARY_REQUEST_TIMEOUT_MS is 10 000, and three of them fit in the run limit beside the deadline and the stand-down limit (AC5)', () => {
    expect(CANARY_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(CANARY_RUN_LIMIT_MS).toBeGreaterThan(
      CANARY_DEADLINE_MS + CANARY_STAND_DOWN_LIMIT_MS + 3 * CANARY_REQUEST_TIMEOUT_MS,
    );
  });
});

describe('REL-10: the canary client calls each route as the contract says', () => {
  test('REL-10-AC1: start posts the canary’s responder alone to POST /v1/journeys on the configured origin, as JSON with the credential as a Bearer, and answers the journey the API started', async () => {
    const w = await world();

    const result = await w.client().start();

    const [journey] = w.store.journeys();
    expect(result).toEqual({ ok: true, value: { journeyId: journey?.id } });
    expect(journey).toMatchObject({
      walkerId: CANARY_IDS.walkerId,
      responderIds: [CANARY_IDS.responderId],
    });
    expect(w.sent).toHaveLength(1);
    const [request] = w.sent;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe(`${ORIGIN}${apiPath('journeys')}`);
    expect(JSON.parse(request?.body ?? 'null')).toEqual({
      responderIds: [CANARY_IDS.responderId],
    });
    expect(request?.headers['content-type']).toMatch(/^application\/json\b/);
    expect(request?.headers['authorization']).toBe(`Bearer ${w.credential}`);
  });

  test('REL-10-AC8: a start answered 409 ALREADY_ON_A_JOURNEY names the canary walker’s unended journey, read from the API’s own answer', async () => {
    const w = await world();
    const first = await w.client().start();

    const second = await w.client().start();

    expect(first.ok).toBe(true);
    const journeyId = first.ok ? first.value.journeyId : '';
    expect(second).toEqual({ ok: false, status: 409, journeyId });
  });

  test('REL-10-AC1: heartbeat posts the journey’s ID, a fresh event ID the contract takes, a null battery level and a null position, and nothing else, to POST /v1/heartbeats; a 200 is a success', async () => {
    const w = await world();
    const started = await w.client().start();
    const journeyId = started.ok ? started.value.journeyId : '';

    const first = await w.client().heartbeat(journeyId);
    const second = await w.client().heartbeat(journeyId);

    expect([first, second]).toEqual([
      { ok: true, value: null },
      { ok: true, value: null },
    ]);
    const beats = w.sent.slice(1).map((request) => {
      expect(request.method).toBe('POST');
      expect(request.url).toBe(`${ORIGIN}${apiPath('heartbeats')}`);
      expect(request.headers['authorization']).toBe(`Bearer ${w.credential}`);
      return JSON.parse(request.body) as Record<string, unknown>;
    });
    expect(beats).toHaveLength(2);
    for (const beat of beats) {
      expect(Object.keys(beat).sort()).toEqual([
        'batteryLevel',
        'eventId',
        'journeyId',
        'position',
      ]);
      expect(beat).toMatchObject({ journeyId, batteryLevel: null, position: null });
      expect(heartbeatRequestSchema.safeParse(beat).success).toBe(true);
      expect(String(beat['eventId'])).toMatch(EVENT_ID_PATTERN);
      expect(String(beat['eventId']).length).toBeLessThanOrEqual(MAX_EVENT_ID_LENGTH);
    }
    expect(beats[0]?.['eventId']).not.toBe(beats[1]?.['eventId']);
    // The store holds both, each with no battery level and no position.
    expect(w.store.heartbeats().map(({ batteryLevel }) => batteryLevel)).toEqual([null, null]);
    expect(w.store.positions()).toEqual([]);
  });

  test('REL-10-AC1: home posts to POST /v1/journeys/{journeyId}/home with no body but an empty one; the API’s 200 is a success and the journey ends HOME', async () => {
    const w = await world();
    const started = await w.client().start();
    const journeyId = started.ok ? started.value.journeyId : '';

    const result = await w.client().home(journeyId);

    expect(result).toEqual({ ok: true, value: null });
    const request = w.sent.at(-1);
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe(`${ORIGIN}${apiPath(`journeys/${journeyId}/home`)}`);
    expect(['', '{}']).toContain(request?.body);
    expect(request?.headers['authorization']).toBe(`Bearer ${w.credential}`);
    expect(w.store.endOf(journeyId)).toMatchObject({ endReason: 'HOME' });
  });

  test('REL-10-AC6: a home answered 409 JOURNEY_ENDED, the API’s own answer to a second "I’m home", is a failure naming 409', async () => {
    const w = await world();
    const started = await w.client().start();
    const journeyId = started.ok ? started.value.journeyId : '';
    await w.client().home(journeyId);

    expect(await w.client().home(journeyId)).toMatchObject({ ok: false, status: 409 });
  });

  test('REL-10-AC15: every request names the configured origin, follows no redirect, carries a signal of its own, and holds the credential in Authorization alone (PRIV-07)', async () => {
    const w = await world();
    const started = await w.client().start();
    const journeyId = started.ok ? started.value.journeyId : '';
    await w.client().heartbeat(journeyId);
    await w.client().home(journeyId);

    expect(w.sent).toHaveLength(3);
    for (const request of w.sent) {
      expect(new URL(request.url).origin).toBe(ORIGIN);
      expect(request.redirect).toBe('manual');
      expect(request.hadSignal).toBe(true);
      const { authorization, ...otherHeaders } = request.headers;
      expect(authorization).toBe(`Bearer ${w.credential}`);
      expect(
        markersIn(JSON.stringify({ url: request.url, body: request.body, otherHeaders }), [
          w.credential,
        ]),
      ).toEqual([]);
    }
  });
});

/** Each route a client call reaches, and how a test makes it. */
const ROUTES = [
  {
    route: 'start',
    path: () => apiPath('journeys'),
    call: (client: ReturnType<typeof httpCanaryClient>) => client.start(),
    refused: { journeyId: 'not-a-uuid', state: 'ACTIVE', startedAt: START.toISOString() },
    success: 201,
  },
  {
    route: 'heartbeat',
    path: () => apiPath('heartbeats'),
    call: (client: ReturnType<typeof httpCanaryClient>) => client.heartbeat(JOURNEY),
    refused: { outcome: 'STORED_SOMEWHERE' },
    success: 200,
  },
  {
    route: 'home',
    path: () => apiPath(`journeys/${JOURNEY}/home`),
    call: (client: ReturnType<typeof httpCanaryClient>) => client.home(JOURNEY),
    refused: { outcome: 'GONE_HOME' },
    success: 200,
  },
] as const;

/** The journey the heartbeat and home failures name: fresh, and never stored (RG-07). */
const JOURNEY = syntheticUuid();

describe.each(ROUTES)(
  'REL-10: the canary client’s $route, every failure a result naming its status',
  ({ path, call, refused, success }) => {
    test.each([
      { what: 'a refused credential', status: 401 },
      { what: 'a refusal of the request', status: 422 },
      { what: 'a server error', status: 500 },
      { what: 'an unavailable service', status: 503 },
    ])(
      'REL-10-AC6: $what, $status, is a failure naming $status, never a throw',
      async ({ status }) => {
        const w = await world();
        w.answerWith(() => json(status, { code: 'SOMETHING', status, message: 'no' }));

        expect(await call(w.client())).toMatchObject({ ok: false, status });
      },
    );

    test.each([301, 302, 307, 308])(
      'REL-10-AC6: a redirect, %i, is a failure naming its status, and is not followed',
      async (status) => {
        const w = await world();
        w.answerWith(
          () => new Response(null, { status, headers: { location: `${ORIGIN}/elsewhere` } }),
        );

        expect(await call(w.client())).toMatchObject({ ok: false, status });
        expect(w.sent).toHaveLength(1);
        expect(w.sent[0]?.redirect).toBe('manual');
      },
    );

    test('REL-10-AC6: a success whose body the contract refuses is a failure naming the status it came with', async () => {
      const w = await world();
      w.answerWith(() => json(success, refused));

      expect(await call(w.client())).toMatchObject({ ok: false, status: success });
    });

    test('REL-10-AC6: a success whose body is not JSON at all is a failure naming the status it came with', async () => {
      const w = await world();
      w.answerWith(() => new Response('<html>a proxy’s page</html>', { status: success }));

      expect(await call(w.client())).toMatchObject({ ok: false, status: success });
    });

    test('REL-10-AC6: a network failure is a failure with no status, never a throw', async () => {
      const w = await world();
      w.answerWith(() => Promise.reject(new TypeError('fetch failed')));

      expect(await call(w.client())).toMatchObject({ ok: false, status: null });
    });

    test('REL-10-AC6: no answer within its own timeout is a failure with no status, after about that long', async () => {
      const w = await world();
      w.answerWith(neverAnswering);
      const began = performance.now();

      const result = await call(w.client({ timeoutMs: 50 }));

      expect(result).toMatchObject({ ok: false, status: null });
      expect(performance.now() - began).toBeLessThan(5_000);
      expect(w.sent).toHaveLength(1);
    });

    test('REL-10-AC6: a request is made once: a failure is not retried', async () => {
      const w = await world();
      w.answerWith(() => json(500, { code: 'INTERNAL_SERVER_ERROR', status: 500, message: 'no' }));

      await call(w.client());

      expect(w.sent.map((request) => new URL(request.url).pathname)).toEqual([path()]);
    });
  },
);

describe('REL-10: what the canary client lets out (PRIV-07)', () => {
  /**
   * The markers an error may hold, made at run time (RG-07): the credential, a
   * synthetic coordinate, a phone-number-shaped value never in +47 form (eight
   * digits with a leading 0, which no Norwegian subscriber number has), and
   * the canary walker's ID.
   */
  const markersFor = (credential: string) => [
    credential,
    String(syntheticCoordinate()),
    `0${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
    CANARY_IDS.walkerId,
  ];

  test.each(ROUTES)(
    'REL-10-AC15: PRIV-07: when $route’s fetch fails with an error whose message and cause hold the markers, nothing the client returns, throws or writes to stdout, stderr or the console holds one',
    async ({ call }) => {
      const w = await world();
      const markers = markersFor(w.credential);
      const error = new TypeError(`fetch failed: ${markers.join(' ')}`, {
        cause: Object.assign(new Error(`connect ECONNREFUSED ${markers.join(' ')}`), {
          code: 'ECONNREFUSED',
        }),
      });
      w.answerWith(() => Promise.reject(error));

      const { result, written } = await captured(() => outcomeOf<unknown>(call(w.client())));

      // Controls: the injected error holds every marker, and the capture sees
      // a line written while it runs.
      expect(markersIn(inspect(error, { depth: 10 }), markers)).toEqual(markers);
      const control = await captured(() => {
        process.stdout.write(`control ${markers[0] ?? ''}\n`);
        return Promise.resolve();
      });
      expect(markersIn(control.written, markers)).toEqual([markers[0]]);

      expect(markersIn(inspect(result, { depth: 10 }), markers)).toEqual([]);
      expect(markersIn(written, markers)).toEqual([]);
    },
  );

  test.each(ROUTES)(
    'REL-10-AC15: PRIV-07: when $route is answered with a body that echoes the markers, nothing the client returns or writes holds one',
    async ({ call }) => {
      const w = await world();
      const markers = markersFor(w.credential);
      w.answerWith(() => json(500, { code: 'INTERNAL_SERVER_ERROR', message: markers.join(' ') }));

      const { result, written } = await captured(() => outcomeOf<unknown>(call(w.client())));

      expect(markersIn(inspect(result, { depth: 10 }), markers)).toEqual([]);
      expect(markersIn(written, markers)).toEqual([]);
    },
  );
});

describe('REL-10: the canary client over a real fetch', () => {
  const servers: { close: () => void }[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  /** A stand-in API on the loopback address, answering every request with a redirect to another of its paths. */
  async function redirecting(status: number) {
    const received: { path: string | undefined; authorization: string | undefined }[] = [];
    const server = createServer((request, response) => {
      received.push({ path: request.url, authorization: request.headers.authorization });
      request.resume();
      request.on('end', () => {
        response.writeHead(status, { location: '/v1/elsewhere' });
        response.end();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    servers.push({ close: () => server.close() });
    const { port } = server.address() as AddressInfo;
    return { origin: `http://127.0.0.1:${String(port)}`, received };
  }

  test('REL-10-AC15: with the default fetch, a 302 from the API is not followed: one request reaches it, with the credential, and the answer is a failure naming 302', async () => {
    const stand = await redirecting(302);
    const credential = syntheticCredential();
    const client = httpCanaryClient({ baseUrl: stand.origin, credential });

    const result = await client.start();

    expect(result).toMatchObject({ ok: false, status: 302 });
    expect(stand.received).toEqual([
      { path: apiPath('journeys'), authorization: `Bearer ${credential}` },
    ]);
  });
});
