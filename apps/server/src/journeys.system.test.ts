// L6 system: starting a journey, through the whole API in one process.
//
// The real router, the real contract and the real journey module, with fakes
// only at the edges: the device credentials, the journey store and the clock.
// What is proven here:
//   - SM-01: one unended journey per walker, and a retried start learns which
//     journey it already has;
//   - SM-02, its start rule: a journey needs at least one responder, and every
//     responder must be a user other than the walker;
//   - SEC-07: every route but health refuses a request without a valid device
//     credential, the walker is always the device's own user, and the body is
//     checked before anything is stored.
//
// The routes are read from the contract, never typed out, so a route added
// there is called by these tests the day it appears: it fails here unless it
// is authenticated, or is added to PUBLIC_ROUTES on purpose.
//
// LOST-01 adds the heartbeat, below the start's tests, and with it a
// recording log the journey module writes to. Since D-101 a journey records
// the device that started it, so the fake store knows each walker's device,
// as the devices table does.
import {
  API_PREFIX,
  MAX_EVENT_ID_LENGTH,
  MAX_RESPONDERS,
  heartbeatResponseSchema,
  openApiDocument,
  startJourneyResponseSchema,
} from '@trygghverdag/contracts';
import {
  apiPath,
  fakeClock,
  fakeDeviceAuthenticator,
  fakeJourneyStore,
  fakeLog,
  fakeWorkerHeartbeats,
  syntheticBatteryLevel,
  syntheticCredential,
  syntheticHeartbeat,
  syntheticPosition,
  syntheticUuid,
  type FakeJourneyState,
  type RegisteredDevice,
  type SyntheticHeartbeat,
  type SyntheticPosition,
} from '@trygghverdag/test-kit';
import process from 'node:process';
import { inspect } from 'node:util';
import { describe, expect, test, vi } from 'vitest';
import { createApi } from './api.ts';
import { createHealthService } from './modules/health/service.ts';
import { createJourneyService } from './modules/journeys/service.ts';
import type { Log } from './ports.ts';

const NOW = new Date('2026-10-01T21:40:00.000Z');
const EARLIER = new Date('2026-10-01T21:10:00.000Z');
const JOURNEYS = apiPath('journeys');
const HEARTBEATS = apiPath('heartbeats');

/** The routes anyone may call without a device credential. Only health: see the file comment. */
const PUBLIC_ROUTES = ['GET /v1/health'];

type Api = ReturnType<typeof createApi>;

async function send(
  api: Api,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Response> {
  if (body === undefined) {
    return api.request(path, { method, headers });
  }
  return api.request(path, {
    method,
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * One API, its fakes, and the people a test needs. The journey module logs to
 * the recording fake, `log`, unless a test hands it another log.
 */
function world({ log }: { log?: Log } = {}) {
  const clock = fakeClock(NOW);
  const devices = fakeDeviceAuthenticator();
  const store = fakeJourneyStore();
  const recorded = fakeLog();
  const api = createApi({
    health: createHealthService({ clock, heartbeats: fakeWorkerHeartbeats(NOW) }),
    journeys: createJourneyService({ clock, journeys: store, log: log ?? recorded }),
    devices,
  });

  return {
    api,
    clock,
    devices,
    store,
    /** What the journey module logged, unless it was handed another log. */
    log: recorded,
    /**
     * A user with a device: someone who can start a journey. The store knows
     * the device too, as the devices table does: a journey records the device
     * that started it, and refuses one that does not exist (D-101).
     */
    walker: () => {
      const device = devices.register();
      store.addUser(device.userId);
      store.addDevice(device.userId, device.deviceId);
      return device;
    },
    /** Another device of the same walker: a tablet left at home, say (D-101). */
    secondDevice: (of: RegisteredDevice): RegisteredDevice => {
      const device = devices.register({ userId: of.userId });
      store.addDevice(of.userId, device.deviceId);
      return device;
    },
    /** A user with no device here: someone who can follow a journey. */
    user: (): string => store.addUser(),
    /** A journey of this device's walker, started from this device, put in directly. */
    journeyOf: (
      device: RegisteredDevice,
      {
        state = 'ACTIVE',
        lastHeartbeatAt = null,
      }: { state?: FakeJourneyState; lastHeartbeatAt?: Date | null } = {},
    ): string =>
      store.seed({
        walkerId: device.userId,
        deviceId: device.deviceId,
        state,
        responderIds: [store.addUser()],
        startedAt: EARLIER,
        lastHeartbeatAt,
      }),
    start: (credential: string, body: unknown): Promise<Response> =>
      send(api, 'POST', JOURNEYS, { authorization: `Bearer ${credential}` }, body),
    heartbeat: (credential: string, body: unknown): Promise<Response> =>
      send(api, 'POST', HEARTBEATS, { authorization: `Bearer ${credential}` }, body),
    /** A heartbeat body sent as it is written: one that is not JSON, or JSON no value can be built as. */
    heartbeatText: (credential: string, text: string): Promise<Response> =>
      Promise.resolve(
        api.request(HEARTBEATS, {
          method: 'POST',
          headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
          body: text,
        }),
      ),
  };
}

type World = ReturnType<typeof world>;

interface ErrorBody {
  code?: unknown;
  data?: { journeyId?: unknown };
}

async function errorOf(response: Response): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

interface StartedBody {
  journeyId: string;
  state: string;
  startedAt: string;
}

// ---------------------------------------------------------------------------
// Starting, and one unended journey per walker.
// ---------------------------------------------------------------------------

describe('SM-01: starting a journey', () => {
  test('SM-01-AC1: a walker with no journey and one responder starts one: 201, ACTIVE, in the contract’s shape', async () => {
    const { start, walker, user } = world();
    const device = walker();
    const responderId = user();

    const response = await start(device.credential, { responderIds: [responderId] });
    const body: unknown = await response.json();

    expect(response.status).toBe(201);
    expect(startJourneyResponseSchema.safeParse(body).success).toBe(true);
    expect(Object.keys(body as object).sort()).toEqual(['journeyId', 'startedAt', 'state']);
    expect((body as StartedBody).state).toBe('ACTIVE');
  });

  test('SM-01-AC1: exactly one journey is stored, with that walker, ACTIVE, exactly that responder, and the answer’s ID', async () => {
    const { start, walker, user, store } = world();
    const device = walker();
    const responderId = user();

    const response = await start(device.credential, { responderIds: [responderId] });
    const body = (await response.json()) as StartedBody;

    expect(store.journeys()).toEqual([
      {
        id: body.journeyId,
        walkerId: device.userId,
        state: 'ACTIVE',
        startedAt: NOW,
        responderIds: [responderId],
      },
    ]);
  });

  test('SM-01-AC1: startedAt is the injected clock’s reading at the moment of the start, exactly', async () => {
    // The clock moves after the API is built, so a time read at build time,
    // or one read from this machine, shows up as wrong.
    const { start, walker, user, clock, store } = world();
    const device = walker();
    const responderId = user();
    clock.advance(93_250);
    const expected = new Date(NOW.getTime() + 93_250);

    const body = (await (
      await start(device.credential, { responderIds: [responderId] })
    ).json()) as StartedBody;

    expect(body.startedAt).toBe(expected.toISOString());
    expect(store.journeys()[0]?.startedAt).toEqual(expected);
  });
});

/** The two states in which a walker's journey is still running. */
const UNENDED_STATES = ['ACTIVE', 'LOST_CONTACT'] as const;

describe('SM-01: one unended journey per walker', () => {
  test.each(UNENDED_STATES)(
    'SM-01-AC2: a walker whose journey is %s cannot start another: 409 with that journey’s ID, and nothing changes',
    async (state) => {
      const { start, walker, user, store } = world();
      const device = walker();
      const earlier = user();
      const journeyId = store.seed({
        walkerId: device.userId,
        deviceId: device.deviceId,
        state,
        responderIds: [earlier],
        startedAt: EARLIER,
      });
      const before = store.journeys();

      const response = await start(device.credential, { responderIds: [user()] });

      expect(response.status).toBe(409);
      expect(await errorOf(response)).toMatchObject({
        code: 'ALREADY_ON_A_JOURNEY',
        data: { journeyId },
      });
      expect(store.journeys()).toEqual(before);
    },
  );

  test('SM-01-AC2: a start retried after its answer was lost gets 409 with the journey it already has', async () => {
    const { start, walker, user, store } = world();
    const device = walker();
    const body = { responderIds: [user()] };

    const first = (await (await start(device.credential, body)).json()) as StartedBody;
    const retried = await start(device.credential, body);

    expect(retried.status).toBe(409);
    expect(await errorOf(retried)).toMatchObject({
      code: 'ALREADY_ON_A_JOURNEY',
      data: { journeyId: first.journeyId },
    });
    expect(store.journeys()).toHaveLength(1);
  });

  test('SM-01-AC3: starts that race past the read get one 201, and every other a 409 with that journey, not a 500', async () => {
    // The real race is the integration test's, on PostgreSQL. This one holds
    // the journey module to its half: when the store says "not inserted",
    // that is the same ALREADY_ON_A_JOURNEY as the read gives, never an error.
    const { start, walker, user, store } = world();
    const device = walker();
    const body = { responderIds: [user()] };

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => start(device.credential, body)),
    );
    const answers = await Promise.all(
      responses.map(async (response) => ({
        status: response.status,
        body: (await response.json()) as ErrorBody & Partial<StartedBody>,
      })),
    );

    // More than one start got past the read, or this proved nothing.
    expect(store.calls.filter((call) => call === 'insertStarted').length).toBeGreaterThan(1);
    const created = answers.filter((answer) => answer.status === 201);
    expect(created).toHaveLength(1);
    const winner = created[0]?.body.journeyId;
    expect(
      answers
        .filter((answer) => answer.status !== 201)
        .map((answer) => ({
          status: answer.status,
          code: answer.body.code,
          journeyId: answer.body.data?.journeyId,
        })),
    ).toEqual(
      Array.from({ length: 9 }, () => ({
        status: 409,
        code: 'ALREADY_ON_A_JOURNEY',
        journeyId: winner,
      })),
    );
    expect(store.journeys().map((journey) => journey.id)).toEqual([winner]);
  });

  test('SM-01-AC2: another walker’s journey blocks nobody else', async () => {
    const { start, walker, user, store } = world();
    const first = walker();
    const second = walker();
    const responderId = user();
    store.seed({
      walkerId: first.userId,
      deviceId: first.deviceId,
      state: 'ACTIVE',
      responderIds: [responderId],
      startedAt: EARLIER,
    });

    const response = await start(second.credential, { responderIds: [responderId] });

    expect(response.status).toBe(201);
  });

  test('SM-01-AC4: a walker whose only journey has ENDED starts a new one, and the ended one is unchanged', async () => {
    const { start, walker, user, store } = world();
    const device = walker();
    const earlier = user();
    const later = user();
    const endedId = store.seed({
      walkerId: device.userId,
      deviceId: device.deviceId,
      state: 'ENDED',
      responderIds: [earlier],
      startedAt: EARLIER,
    });

    const response = await start(device.credential, { responderIds: [later] });
    const body = (await response.json()) as StartedBody;

    expect(response.status).toBe(201);
    expect(store.journeys()).toEqual([
      {
        id: endedId,
        walkerId: device.userId,
        state: 'ENDED',
        startedAt: EARLIER,
        responderIds: [earlier],
      },
      {
        id: body.journeyId,
        walkerId: device.userId,
        state: 'ACTIVE',
        startedAt: NOW,
        responderIds: [later],
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// At least one responder to start: SM-02's start rule.
// ---------------------------------------------------------------------------

interface People {
  walker: string;
  responder: string;
  stranger: string;
}

/** Lists refused as INVALID_RESPONDER, by what is wrong with them. */
const INVALID_LISTS = [
  { what: 'the walker alone', list: (p: People) => [p.walker] },
  { what: 'an ID that is not a user', list: (p: People) => [p.stranger] },
  { what: 'a responder and the walker', list: (p: People) => [p.responder, p.walker] },
  {
    what: 'a responder and an ID that is not a user',
    list: (p: People) => [p.responder, p.stranger],
  },
  {
    what: 'an ID that is not a user, then a responder',
    list: (p: People) => [p.stranger, p.responder],
  },
];

describe('SM-02: at least one responder to start', () => {
  test('SM-01-AC5: an empty list is 422 NO_RESPONDER, and no journey or responder is stored', async () => {
    const { start, walker, store } = world();
    const device = walker();

    const response = await start(device.credential, { responderIds: [] });

    expect(response.status).toBe(422);
    expect((await errorOf(response)).code).toBe('NO_RESPONDER');
    expect(store.journeys()).toEqual([]);
    expect(store.calls).not.toContain('insertStarted');
  });

  test.each(INVALID_LISTS)(
    'SM-01-AC6: a list naming $what is 422 INVALID_RESPONDER, and nothing is stored',
    async ({ list }) => {
      const { start, walker, user, store } = world();
      const device = walker();
      const people = { walker: device.userId, responder: user(), stranger: syntheticUuid() };

      const response = await start(device.credential, { responderIds: list(people) });

      expect(response.status).toBe(422);
      expect((await errorOf(response)).code).toBe('INVALID_RESPONDER');
      expect(store.journeys()).toEqual([]);
      expect(store.calls).not.toContain('insertStarted');
    },
  );

  test('SM-01-AC6: a user who exists only as a device elsewhere is not a responder until the store says so', async () => {
    // The responder check asks the journey store which IDs are users. A
    // device's user that the store does not know is not taken on trust.
    const { start, walker, devices, store } = world();
    const device = walker();
    const elsewhere = devices.register();

    const response = await start(device.credential, { responderIds: [elsewhere.userId] });

    expect(response.status).toBe(422);
    expect((await errorOf(response)).code).toBe('INVALID_RESPONDER');
    expect(store.journeys()).toEqual([]);
  });

  test('SM-01-AC6: a responder named twice starts the journey with that responder once', async () => {
    const { start, walker, user, store } = world();
    const device = walker();
    const responderId = user();

    const response = await start(device.credential, { responderIds: [responderId, responderId] });

    expect(response.status).toBe(201);
    expect(store.journeys().map((journey) => journey.responderIds)).toEqual([[responderId]]);
  });

  test('SM-01-AC6: an existing responder named in upper case is that user: the journey starts with them, stored lower-case', async () => {
    // A UUID's hex digits mean the same in either case, the contract accepts
    // both, and the database hands IDs back lower-case. The start rule
    // compares IDs as strings, so unless the edge makes them one case, a real
    // user named in upper case is refused as INVALID_RESPONDER: a walker told
    // their friend cannot follow them, for the way an ID was spelled.
    const { start, walker, user, store } = world();
    const device = walker();
    const responderId = user();
    expect(responderId).toBe(responderId.toLowerCase());

    const response = await start(device.credential, { responderIds: [responderId.toUpperCase()] });

    expect(response.status).toBe(201);
    expect(store.journeys().map((journey) => journey.responderIds)).toEqual([[responderId]]);
  });

  test('SM-01-AC6: one responder named in both cases counts once', async () => {
    const { start, walker, user, store } = world();
    const device = walker();
    const responderId = user();

    const response = await start(device.credential, {
      responderIds: [responderId.toUpperCase(), responderId],
    });

    expect(response.status).toBe(201);
    expect(store.journeys().map((journey) => journey.responderIds)).toEqual([[responderId]]);
  });

  test('SM-01-AC6: the walker naming themself in upper case is still the walker, and refused INVALID_RESPONDER', async () => {
    // Making IDs one case must not open a way round the self check.
    const { start, walker, user, store } = world();
    const device = walker();
    const responderId = user();

    const response = await start(device.credential, {
      responderIds: [responderId, device.userId.toUpperCase()],
    });

    expect(response.status).toBe(422);
    expect((await errorOf(response)).code).toBe('INVALID_RESPONDER');
    expect(store.journeys()).toEqual([]);
  });

  test('SM-01-AC6: several responders, with repeats, are stored once each in the order first named', async () => {
    const { start, walker, user, store } = world();
    const device = walker();
    const first = user();
    const second = user();

    const response = await start(device.credential, {
      responderIds: [second, first, second, first],
    });

    expect(response.status).toBe(201);
    expect(store.journeys().map((journey) => journey.responderIds)).toEqual([[second, first]]);
  });

  test('SM-01-AC7: through the API too, an unended journey is reported before anything wrong with the list', async () => {
    const { start, walker, store } = world();
    const device = walker();
    const journeyId = store.seed({
      walkerId: device.userId,
      deviceId: device.deviceId,
      state: 'LOST_CONTACT',
      responderIds: [],
      startedAt: EARLIER,
    });

    for (const responderIds of [[], [device.userId], [syntheticUuid()]]) {
      const response = await start(device.credential, { responderIds });

      expect(response.status, JSON.stringify(responderIds)).toBe(409);
      expect(await errorOf(response)).toMatchObject({
        code: 'ALREADY_ON_A_JOURNEY',
        data: { journeyId },
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Every request from a known device: SEC-07.
// ---------------------------------------------------------------------------

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

interface Route {
  /** As written in PUBLIC_ROUTES: the method, then the path under the API version. */
  key: string;
  method: string;
  /** The path to call, with any path parameter filled in. */
  path: string;
}

/** Every route the contract describes, read from the generated document. */
async function contractRoutes(): Promise<Route[]> {
  const document = await openApiDocument();
  const paths = document['paths'] as Record<string, Record<string, unknown>>;
  return Object.entries(paths).flatMap(([path, item]) =>
    Object.keys(item)
      .filter((method) => HTTP_METHODS.includes(method))
      .map((method) => ({
        key: `${method.toUpperCase()} ${API_PREFIX}${path}`,
        method: method.toUpperCase(),
        path: `${API_PREFIX}${path.replace(/\{[^}]*\}/g, () => syntheticUuid())}`,
      })),
  );
}

/**
 * The body each route is called with: one that would succeed with a valid
 * credential, so that a 401 can only be the credential's doing. A route not
 * listed gets an empty object, and must refuse that too.
 */
function bodyFor(route: Route, responderId: string): unknown {
  if (route.key === `POST ${JOURNEYS}`) {
    return { responderIds: [responderId] };
  }
  return ['POST', 'PUT', 'PATCH'].includes(route.method) ? {} : undefined;
}

interface Credentials {
  valid: string;
  removed: string;
}

/** The six ways a request can come without a valid device credential. */
const REFUSED_FORMS = [
  { form: 'no Authorization header', headers: (): Record<string, string> => ({}) },
  { form: 'an empty Authorization header', headers: () => ({ authorization: '' }) },
  {
    form: 'a scheme other than Bearer, around a valid credential',
    headers: (c: Credentials) => ({ authorization: `Basic ${c.valid}` }),
  },
  { form: 'Bearer with nothing after it', headers: () => ({ authorization: 'Bearer' }) },
  {
    form: 'a well-formed credential no device has',
    headers: () => ({ authorization: `Bearer ${syntheticCredential()}` }),
  },
  {
    form: 'the credential of a device whose row has been removed',
    headers: (c: Credentials) => ({ authorization: `Bearer ${c.removed}` }),
  },
];

/** A world with a working device, a removed one, and a responder, all of whom exist. */
function guardedWorld() {
  const w = world();
  const device = w.walker();
  const removed = w.walker();
  w.devices.remove(removed.deviceId);
  const responderId = w.user();
  return {
    ...w,
    device,
    responderId,
    credentials: { valid: device.credential, removed: removed.credential },
  };
}

async function protectedRoutes(): Promise<Route[]> {
  return (await contractRoutes()).filter((route) => !PUBLIC_ROUTES.includes(route.key));
}

describe('SEC-07: every route but health needs a valid device credential', () => {
  test('SM-01-AC9: the routes are read from the contract; the public list holds only GET /v1/health, which the contract has', async () => {
    const routes = await contractRoutes();

    expect(PUBLIC_ROUTES).toEqual(['GET /v1/health']);
    expect(routes.map((route) => route.key)).toEqual(expect.arrayContaining(PUBLIC_ROUTES));
    expect(routes.map((route) => route.key)).toContain(`POST ${JOURNEYS}`);
    expect((await protectedRoutes()).length).toBe(routes.length - PUBLIC_ROUTES.length);
  });

  test.each(REFUSED_FORMS)(
    'SM-01-AC9: $form: every route but health answers 401, and its handler never runs',
    async ({ headers }) => {
      const { api, store, responderId, credentials } = guardedWorld();
      const answers: { route: string; status: number }[] = [];

      for (const route of await protectedRoutes()) {
        const response = await send(
          api,
          route.method,
          route.path,
          headers(credentials),
          bodyFor(route, responderId),
        );
        answers.push({ route: route.key, status: response.status });
      }

      expect(answers.length).toBeGreaterThan(0);
      expect(answers).toEqual(answers.map(({ route }) => ({ route, status: 401 })));
      expect(store.calls).toEqual([]);
      expect(store.journeys()).toEqual([]);
    },
  );

  test('SM-01-AC9: the 401 body is the same for every cause and every route, so it says nothing about which check failed', async () => {
    const { api, responderId, credentials } = guardedWorld();
    const bodies: string[] = [];

    for (const route of await protectedRoutes()) {
      for (const { headers } of REFUSED_FORMS) {
        const response = await send(
          api,
          route.method,
          route.path,
          headers(credentials),
          bodyFor(route, responderId),
        );
        bodies.push(await response.text());
      }
    }

    expect(bodies.length).toBeGreaterThanOrEqual(REFUSED_FORMS.length);
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0] ?? 'null')).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  test('SM-01-AC9: the same requests with the device’s own credential are not refused, so the 401s were the credential’s doing', async () => {
    const { api, responderId, credentials } = guardedWorld();

    for (const route of await protectedRoutes()) {
      const response = await send(
        api,
        route.method,
        route.path,
        { authorization: `Bearer ${credentials.valid}` },
        bodyFor(route, responderId),
      );

      expect(response.status, route.key).not.toBe(401);
    }
  });

  test('SM-01-AC9: the server registers no route of its own, only the one handler that serves the contract', () => {
    // Every test above reaches the routes through the contract, and the
    // authentication middleware is part of the contract's router. A route
    // registered on the Hono app directly would be neither: it would skip the
    // middleware, and these tests, reading the contract, would never call it.
    // The likeliest one is a raw route for the location SDK's own upload
    // body, which is not the contract's shape. So the app's own route table
    // is pinned here: anything beside the contract handler fails until it is
    // brought into the contract, or this test is changed on purpose.
    const { api } = world();

    expect(api.routes.map((route) => `${route.method} ${route.path}`)).toEqual(['ALL /*']);
  });

  test('SM-01-AC9: GET /v1/health still answers 200 with no credential', async () => {
    const { api } = guardedWorld();

    const response = await send(api, 'GET', apiPath('health'), {});

    expect(response.status).toBe(200);
  });

  test('SM-01-AC13: without a credential only GET /v1/health answers, so no route can hand one out before the login task', async () => {
    // A route that issued credentials would have to answer callers who have
    // none. This lists every route that does; it can only grow by changing
    // PUBLIC_ROUTES above, in a test, on purpose.
    const { api, responderId } = guardedWorld();
    const answering: string[] = [];

    for (const route of await contractRoutes()) {
      const response = await send(api, route.method, route.path, {}, bodyFor(route, responderId));
      if (response.status !== 401) {
        answering.push(route.key);
      }
    }

    expect(answering).toEqual(['GET /v1/health']);
  });
});

/** Bodies refused with 400, by what is wrong with them. */
const BAD_BODIES = [
  {
    what: 'a walkerId naming another user',
    body: (p: { responder: string; other: string }) => ({
      responderIds: [p.responder],
      walkerId: p.other,
    }),
  },
  {
    what: 'a field besides responderIds',
    body: (p: { responder: string }) => ({ responderIds: [p.responder], note: 'hello' }),
  },
  { what: 'no responderIds', body: () => ({}) },
  {
    what: 'responderIds that is not a list',
    body: (p: { responder: string }) => ({ responderIds: p.responder }),
  },
  {
    what: 'an entry that is not a UUID',
    body: (p: { responder: string }) => ({ responderIds: [p.responder, 'not-a-uuid'] }),
  },
  {
    what: 'more than MAX_RESPONDERS entries',
    body: () => ({
      responderIds: Array.from({ length: MAX_RESPONDERS + 1 }, () => syntheticUuid()),
    }),
  },
];

describe('SEC-07: the walker is the device’s own user, and the body is checked', () => {
  test('SM-01-AC10: the walker of a journey a device starts is that device’s user, and no one else', async () => {
    const { start, walker, user, store } = world();
    const device = walker();
    const other = user();
    const responderId = user();

    await start(device.credential, { responderIds: [responderId] });

    expect(store.journeys().map((journey) => journey.walkerId)).toEqual([device.userId]);
    expect(store.journeys().map((journey) => journey.walkerId)).not.toContain(other);
  });

  test('SM-01-AC10: two devices of one user are one walker: the second device meets the first one’s journey', async () => {
    const { start, walker, user, devices } = world();
    const phone = walker();
    const tablet = devices.register({ userId: phone.userId });
    const responderId = user();

    const first = (await (
      await start(phone.credential, { responderIds: [responderId] })
    ).json()) as StartedBody;
    const second = await start(tablet.credential, { responderIds: [responderId] });

    expect(second.status).toBe(409);
    expect(await errorOf(second)).toMatchObject({ data: { journeyId: first.journeyId } });
  });

  test.each(BAD_BODIES)(
    'SM-01-AC10: a body with $what is 400, and nothing is stored',
    async ({ body }) => {
      const { start, walker, user, store } = world();
      const device = walker();
      const people = { responder: user(), other: user() };

      const response = await start(device.credential, body(people));

      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe('BAD_REQUEST');
      expect(store.journeys()).toEqual([]);
      expect(store.calls).not.toContain('insertStarted');
    },
  );

  test('SM-01-AC10: exactly MAX_RESPONDERS responders who are users is accepted', async () => {
    const { start, walker, user, store } = world();
    const device = walker();
    const responderIds = Array.from({ length: MAX_RESPONDERS }, () => user());

    const response = await start(device.credential, { responderIds });

    expect(response.status).toBe(201);
    expect(store.journeys()[0]?.responderIds).toEqual(responderIds);
  });
});

// ---------------------------------------------------------------------------
// The credential is never written, and a failed check is never a 401.
// ---------------------------------------------------------------------------

/**
 * Everything written to stdout, stderr or the console while `run` runs.
 * Vitest routes the console through its own streams, not through
 * process.stdout, so both are watched.
 */
async function captured<T>(run: () => Promise<T>): Promise<{ result: T; written: string }> {
  const pieces: string[] = [];
  const keep = (value: unknown): void => {
    if (typeof value === 'string') {
      pieces.push(value);
    } else if (value instanceof Uint8Array) {
      pieces.push(Buffer.from(value).toString('utf8'));
    } else {
      pieces.push(inspect(value, { depth: 10 }));
    }
  };
  const spies = [
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      keep(chunk);
      return true;
    }),
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      keep(chunk);
      return true;
    }),
    ...(['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation((...args: unknown[]) => {
        args.forEach(keep);
      }),
    ),
  ];
  try {
    return { result: await run(), written: pieces.join('\n') };
  } finally {
    for (const spy of spies) {
      spy.mockRestore();
    }
  }
}

/** All the bytes a response carries back: its status line aside, the headers and the body. */
async function everythingSentBack(response: Response): Promise<string> {
  const headers = [...response.headers].map(([name, value]) => `${name}: ${value}`).join('\n');
  return `${headers}\n${await response.text()}`;
}

describe('SEC-07: only a hash of a credential is kept, and the credential is never written', () => {
  test('SM-01-AC11: the capture below sees stdout, stderr and the console, so finding nothing in it means nothing was written', async () => {
    const marker = syntheticCredential();

    const { written } = await captured(() => {
      process.stdout.write(`out ${marker}\n`);
      process.stderr.write(Buffer.from(`err ${marker}\n`));
      console.error(new Error(`error ${marker}`));
      console.log({ nested: { deeper: marker } });
      return Promise.resolve();
    });

    expect(written.split(marker).length - 1).toBe(4);
  });

  test('SM-01-AC11: when the credential cannot be checked, neither the answer nor anything written holds it', async () => {
    const { start, walker, user, devices } = world();
    const device = walker();
    const responderId = user();
    devices.failWith(new Error('the device store did not answer'));

    const { result: response, written } = await captured(() =>
      start(device.credential, { responderIds: [responderId] }),
    );

    expect(response.status).toBe(500);
    expect(await everythingSentBack(response)).not.toContain(device.credential);
    expect(written).not.toContain(device.credential);
  });

  test('SM-01-AC11: when a start fails after the check, neither the answer nor anything written holds it', async () => {
    const { start, walker, user, store } = world();
    const device = walker();
    const responderId = user();
    store.failWith(new Error('the journey store did not answer'));

    const { result: response, written } = await captured(() =>
      start(device.credential, { responderIds: [responderId] }),
    );

    expect(response.status).toBe(500);
    expect(await everythingSentBack(response)).not.toContain(device.credential);
    expect(written).not.toContain(device.credential);
  });
});

describe('SEC-07: a credential check that cannot run is a 500, never a 401', () => {
  // A 401 tells the app its credential is bad. From the heartbeat task on, a
  // database hiccup answered with 401 could sign a walker out mid-journey,
  // stop their heartbeats, and turn into a false alarm.
  function failingCheck() {
    const w = world();
    const device = w.walker();
    const responderId = w.user();
    w.devices.failWith(new Error('the device store did not answer'));
    return { ...w, device, responderId };
  }

  test('SM-01-AC12: a valid credential whose check cannot reach its store is answered 500, not 401', async () => {
    const { start, device, responderId } = failingCheck();

    const response = await start(device.credential, { responderIds: [responderId] });

    expect(response.status).toBe(500);
  });

  test('SM-01-AC12: and the handler never runs', async () => {
    const { start, device, responderId, store } = failingCheck();

    await start(device.credential, { responderIds: [responderId] });

    expect(store.calls).toEqual([]);
    expect(store.journeys()).toEqual([]);
  });

  test('SM-01-AC12: and the body is not the 401 body, so an app cannot read it as "signed out"', async () => {
    const { api, start, device, responderId } = failingCheck();
    const unauthorized = await (await send(api, 'POST', JOURNEYS, {}, {})).text();

    const response = await start(device.credential, { responderIds: [responderId] });
    const text = await response.text();

    expect(text).not.toBe(unauthorized);
    expect((JSON.parse(text) as ErrorBody).code).not.toBe('UNAUTHORIZED');
  });

  test('SM-01-AC12: once the check can run again, the same device starts its journey', async () => {
    const { start, device, responderId, devices } = failingCheck();
    await start(device.credential, { responderIds: [responderId] });

    devices.recover();
    const response = await start(device.credential, { responderIds: [responderId] });

    expect(response.status).toBe(201);
  });
});

// ===========================================================================
// LOST-01: the heartbeat, through the whole API in one process.
// ===========================================================================
//
// The same router, contract and journey module, with the same fakes and a
// recording log. What is proven here:
//   - LOST-01: a heartbeat is stored once, timed by the injected clock, with
//     its position exactly as sent and the phone's time beside it;
//   - SM-03: a heartbeat without a position keeps the journey as one with a
//     position does, and the journey reads "location unavailable";
//   - SM-08: a resent event has no effect, last contact included;
//   - SM-09 and REL-01: last contact is the receive time, never the phone's;
//   - SM-07: a heartbeat for an ended journey is refused, stores nothing, and
//     is logged by the journey's ID alone;
//   - SEC-07 and D-101: only the walker's own journey, and only from the
//     device that started it; the body is checked, and no answer echoes
//     anything of the request, `background_geolocation` least of all;
//   - PRIV-07: none of a heartbeat reaches stdout, stderr, the console or the
//     log, whatever the outcome.
// Every position is synthetic: open sea within 1° of 0° 0′, made at run time.

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** A heartbeat body with every field filled: a position and a battery level. */
type FullHeartbeat = SyntheticHeartbeat & { position: SyntheticPosition; batteryLevel: number };

function fullHeartbeat(journeyId: string): FullHeartbeat {
  return {
    ...syntheticHeartbeat({ journeyId }),
    batteryLevel: syntheticBatteryLevel(),
    position: syntheticPosition(),
  };
}

/** A response, read once: its status, its headers as text, its body as text and as JSON when it is. */
interface Answer {
  status: number;
  headers: string;
  text: string;
  body: unknown;
}

async function answerOf(response: Response): Promise<Answer> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: a route that does not exist answers in plain text.
  }
  return {
    status: response.status,
    headers: [...response.headers].map(([name, value]) => `${name}: ${value}`).join('\n'),
    text,
    body,
  };
}

function codeOf(answer: Answer): unknown {
  return (answer.body as { code?: unknown } | null)?.code;
}

const RECORDED = { outcome: 'RECORDED' };
const DUPLICATE = { outcome: 'DUPLICATE' };

/** The heartbeats stored for this journey, as the store holds them. */
function heartbeatsOf(world: World, journeyId: string) {
  return world.store.heartbeats().filter((stored) => stored.journeyId === journeyId);
}

/** A heartbeat as it should be stored. */
function storedAs(body: SyntheticHeartbeat, journeyId: string, receivedAt: Date) {
  return {
    id: expect.any(Number) as unknown,
    journeyId,
    eventId: body.eventId,
    receivedAt,
    batteryLevel: body.batteryLevel,
  };
}

/** A position as it should be stored: every value as sent, the phone's time as the same instant. */
function positionStoredAs(position: SyntheticPosition, heartbeatId: number | undefined) {
  return {
    heartbeatId,
    latitude: position.latitude,
    longitude: position.longitude,
    accuracyMeters: position.accuracyMeters,
    recordedAt: new Date(position.recordedAt),
  };
}

describe('LOST-01: a heartbeat is stored once, timed by the database clock', () => {
  test('LOST-01-AC1: a heartbeat with a position from the journey’s own device is 200 RECORDED, in the contract’s shape and nothing more', async () => {
    const { heartbeat, walker, journeyOf } = world();
    const device = walker();
    const journeyId = journeyOf(device);

    const answer = await answerOf(await heartbeat(device.credential, fullHeartbeat(journeyId)));

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(RECORDED);
    expect(heartbeatResponseSchema.safeParse(answer.body).success).toBe(true);
  });

  test('LOST-01-AC1: exactly one heartbeat is stored, received at the injected clock’s reading, with its battery, and exactly one position equal to the one sent, the phone’s time as given', async () => {
    // The clock moves after the API is built, so a time read at build time,
    // or one read from this machine, shows up as wrong.
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device);
    w.clock.advance(93_250);
    const expected = new Date(NOW.getTime() + 93_250);
    const body = fullHeartbeat(journeyId);

    expect((await w.heartbeat(device.credential, body)).status).toBe(200);

    expect(w.store.heartbeats()).toEqual([storedAs(body, journeyId, expected)]);
    expect(w.store.positions()).toEqual([
      positionStoredAs(body.position, w.store.heartbeats()[0]?.id),
    ]);
  });

  test('LOST-01-AC1: last contact is that same reading, and the journey is still ACTIVE', async () => {
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device, { lastHeartbeatAt: EARLIER });
    w.clock.advance(41_500);

    expect((await w.heartbeat(device.credential, fullHeartbeat(journeyId))).status).toBe(200);

    expect(w.store.lastHeartbeatAt(journeyId)).toEqual(new Date(NOW.getTime() + 41_500));
    expect(w.store.journeys().map((journey) => journey.state)).toEqual(['ACTIVE']);
  });

  test('LOST-01-AC1: the receive time is the clock’s reading as the heartbeat arrived, read before the journey is', async () => {
    // A slow journey read must not make a heartbeat look later than it came.
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device);
    w.store.beforeNext('journeyForHeartbeat', () => {
      w.clock.advance(5_000);
    });

    expect((await w.heartbeat(device.credential, fullHeartbeat(journeyId))).status).toBe(200);

    expect(w.store.heartbeats().map((stored) => stored.receivedAt)).toEqual([NOW]);
    expect(w.store.lastHeartbeatAt(journeyId)).toEqual(NOW);
  });

  test('LOST-01-AC1: the journey ID is read in either case, as a UUID is, and stored lower-case', async () => {
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device);
    const body = { ...fullHeartbeat(journeyId), journeyId: journeyId.toUpperCase() };

    const answer = await answerOf(await w.heartbeat(device.credential, body));

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(RECORDED);
    expect(w.store.heartbeats().map((stored) => stored.journeyId)).toEqual([journeyId]);
  });
});

describe('SM-03: a heartbeat without a position keeps the journey as one with a position does', () => {
  test('LOST-01-AC2: a heartbeat with "position": null is 200 RECORDED, stored with no position, advances last contact exactly as one with a position does, and the journey stays ACTIVE', async () => {
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device, { lastHeartbeatAt: EARLIER });
    w.clock.advance(MINUTE);
    const without = { ...fullHeartbeat(journeyId), position: null };

    const answer = await answerOf(await w.heartbeat(device.credential, without));

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(RECORDED);
    const at = new Date(NOW.getTime() + MINUTE);
    expect(w.store.heartbeats()).toEqual([storedAs(without, journeyId, at)]);
    expect(w.store.positions()).toEqual([]);
    expect(w.store.lastHeartbeatAt(journeyId)).toEqual(at);
    expect(w.store.journeys().map((journey) => journey.state)).toEqual(['ACTIVE']);
  });

  test('LOST-01-AC2: an unknown battery level, null, is accepted and stored as unknown', async () => {
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device);

    const answer = await answerOf(
      await w.heartbeat(device.credential, { ...fullHeartbeat(journeyId), batteryLevel: null }),
    );

    expect(answer.status).toBe(200);
    expect(w.store.heartbeats().map((stored) => stored.batteryLevel)).toEqual([null]);
  });

  test('LOST-01-AC2: the journey reads location unavailable after a heartbeat with no position, and available again once one with a position arrives', async () => {
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device);

    expect((await w.heartbeat(device.credential, fullHeartbeat(journeyId))).status).toBe(200);
    w.clock.advance(MINUTE);
    expect(
      (await w.heartbeat(device.credential, { ...fullHeartbeat(journeyId), position: null }))
        .status,
    ).toBe(200);
    expect(await w.store.latestHeartbeatOf(journeyId)).toMatchObject({ hasPosition: false });

    w.clock.advance(MINUTE);
    expect((await w.heartbeat(device.credential, fullHeartbeat(journeyId))).status).toBe(200);
    expect(await w.store.latestHeartbeatOf(journeyId)).toMatchObject({ hasPosition: true });
    expect(w.store.journeys().map((journey) => journey.state)).toEqual(['ACTIVE']);
  });
});

describe('SM-08: a heartbeat sent twice has no effect the second time', () => {
  test('LOST-01-AC3: the same event sent again after the clock has moved on, with the same content, is 200 DUPLICATE and changes nothing, last contact included', async () => {
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device);
    const body = fullHeartbeat(journeyId);
    expect((await answerOf(await w.heartbeat(device.credential, body))).body).toEqual(RECORDED);
    const heartbeats = w.store.heartbeats();
    const positions = w.store.positions();
    w.clock.advance(3 * MINUTE);

    const answer = await answerOf(await w.heartbeat(device.credential, body));

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(DUPLICATE);
    expect(heartbeatResponseSchema.safeParse(answer.body).success).toBe(true);
    expect(w.store.heartbeats()).toEqual(heartbeats);
    expect(w.store.positions()).toEqual(positions);
    expect(w.store.lastHeartbeatAt(journeyId)).toEqual(NOW);
  });

  test('LOST-01-AC3: the same event ID with other content — another position and battery level, or no position — is DUPLICATE, and the first content stays', async () => {
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device);
    const first = fullHeartbeat(journeyId);
    expect((await answerOf(await w.heartbeat(device.credential, first))).body).toEqual(RECORDED);

    for (const other of [
      { ...fullHeartbeat(journeyId), eventId: first.eventId },
      { ...fullHeartbeat(journeyId), eventId: first.eventId, position: null, batteryLevel: null },
    ]) {
      w.clock.advance(MINUTE);
      const answer = await answerOf(await w.heartbeat(device.credential, other));

      expect(answer.status).toBe(200);
      expect(answer.body).toEqual(DUPLICATE);
    }

    expect(w.store.heartbeats()).toEqual([storedAs(first, journeyId, NOW)]);
    expect(w.store.positions()).toEqual([
      positionStoredAs(first.position, w.store.heartbeats()[0]?.id),
    ]);
    expect(w.store.lastHeartbeatAt(journeyId)).toEqual(NOW);
    expect(await w.store.latestHeartbeatOf(journeyId)).toEqual({
      receivedAt: NOW,
      hasPosition: true,
      batteryLevel: first.batteryLevel,
    });
  });

  test('LOST-01-AC3: the same event ID for another walker’s journey, from that walker’s device, is a new event there: RECORDED', async () => {
    const w = world();
    const device = w.walker();
    const other = w.walker();
    const journeyId = w.journeyOf(device);
    const theirs = w.journeyOf(other);
    const here = fullHeartbeat(journeyId);
    expect((await answerOf(await w.heartbeat(device.credential, here))).body).toEqual(RECORDED);

    const answer = await answerOf(
      await w.heartbeat(other.credential, { ...fullHeartbeat(theirs), eventId: here.eventId }),
    );

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(RECORDED);
    expect(heartbeatsOf(w, journeyId)).toHaveLength(1);
    expect(heartbeatsOf(w, theirs).map((stored) => stored.eventId)).toEqual([here.eventId]);
  });

  test('LOST-01-AC3: an event ID that differs only in case is another event, RECORDED', async () => {
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device);
    const lower = fullHeartbeat(journeyId);
    expect((await answerOf(await w.heartbeat(device.credential, lower))).body).toEqual(RECORDED);

    const answer = await answerOf(
      await w.heartbeat(device.credential, {
        ...fullHeartbeat(journeyId),
        eventId: lower.eventId.toUpperCase(),
      }),
    );

    expect(answer.body).toEqual(RECORDED);
    expect(heartbeatsOf(w, journeyId)).toHaveLength(2);
  });
});

describe('SM-09 and REL-01: database-time order, and the phone’s clock decides nothing', () => {
  test('LOST-01-AC6: phone times hours ahead of the clock, hours behind it, and earlier than the heartbeat before are each RECORDED at the clock’s reading; last contact and the latest follow the receive times, and each phone time is stored as given', async () => {
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device);
    const phoneTimes = [
      new Date(NOW.getTime() + 3 * HOUR),
      new Date(NOW.getTime() - 5 * HOUR),
      // A queue flushed late: earlier than the one before it, by the phone.
      new Date(NOW.getTime() - 6 * HOUR),
    ];
    const sent: { body: FullHeartbeat; at: Date }[] = [];

    for (const [index, recordedAt] of phoneTimes.entries()) {
      w.clock.set(new Date(NOW.getTime() + index * MINUTE));
      const body = { ...fullHeartbeat(journeyId), position: syntheticPosition({ recordedAt }) };
      const answer = await answerOf(await w.heartbeat(device.credential, body));

      expect(answer.status, recordedAt.toISOString()).toBe(200);
      expect(answer.body, recordedAt.toISOString()).toEqual(RECORDED);
      sent.push({ body, at: await w.clock.now() });
    }

    expect(w.store.heartbeats()).toEqual(sent.map(({ body, at }) => storedAs(body, journeyId, at)));
    expect(w.store.positions().map((position) => position.recordedAt)).toEqual(phoneTimes);
    const last = new Date(NOW.getTime() + 2 * MINUTE);
    expect(w.store.lastHeartbeatAt(journeyId)).toEqual(last);
    expect(await w.store.latestHeartbeatOf(journeyId)).toMatchObject({ receivedAt: last });
  });

  test('LOST-01-AC6: the walk: a heartbeat a minute for 45 minutes, every fifth without a position; a 3-minute gap, then a burst of queued heartbeats; one resend. Every event is stored once, last contact is the last receive time, and the location flag is the last heartbeat’s', async () => {
    const w = world();
    const device = w.walker();
    const started = await answerOf(await w.start(device.credential, { responderIds: [w.user()] }));
    expect(started.status).toBe(201);
    const { journeyId } = started.body as StartedBody;
    const sent: SyntheticHeartbeat[] = [];
    const receivedAt = new Map<string, number>();

    async function send(body: SyntheticHeartbeat, expected: typeof RECORDED): Promise<void> {
      const at = await w.clock.now();
      const answer = await answerOf(await w.heartbeat(device.credential, body));

      expect(answer.status, body.eventId).toBe(200);
      expect(answer.body, body.eventId).toEqual(expected);
      if (expected === RECORDED) {
        sent.push(body);
        receivedAt.set(body.eventId, at.getTime());
      }
    }

    // 45 minutes, one a minute, the phone's own time two seconds behind;
    // every fifth without a position, as when the phone loses its fix.
    for (let minute = 0; minute < 45; minute += 1) {
      w.clock.set(new Date(NOW.getTime() + minute * MINUTE));
      const recordedAt = new Date(NOW.getTime() + minute * MINUTE - 2_000);
      await send(
        syntheticHeartbeat({
          journeyId,
          position: (minute + 1) % 5 === 0 ? null : syntheticPosition({ recordedAt }),
        }),
        RECORDED,
      );
    }
    // Three minutes in which nothing arrives, while the phone queues one
    // every 30 seconds; then the queue, flushed a second apart after the gap.
    // The last one queued has no position.
    const lastBeforeGap = NOW.getTime() + 44 * MINUTE;
    const queued = [1, 2, 3, 4, 5].map((k) =>
      syntheticHeartbeat({
        journeyId,
        position:
          k === 5 ? null : syntheticPosition({ recordedAt: new Date(lastBeforeGap + k * 30_000) }),
      }),
    );
    for (const [index, body] of queued.entries()) {
      w.clock.set(new Date(lastBeforeGap + 3 * MINUTE + (index + 1) * 1_000));
      await send(body, RECORDED);
    }
    // And one event already stored, resent later still.
    const resent = sent[10];
    expect(resent).toBeDefined();
    w.clock.set(new Date(lastBeforeGap + 3 * MINUTE + 10_000));
    await send(resent ?? fullHeartbeat(journeyId), DUPLICATE);

    const lastReceived = new Date(lastBeforeGap + 3 * MINUTE + 5_000);
    expect(w.store.heartbeats()).toEqual(
      sent.map((body) => storedAs(body, journeyId, new Date(receivedAt.get(body.eventId) ?? 0))),
    );
    expect(new Set(w.store.heartbeats().map((stored) => stored.eventId)).size).toBe(50);
    expect(w.store.lastHeartbeatAt(journeyId)).toEqual(lastReceived);
    expect(await w.store.latestHeartbeatOf(journeyId)).toEqual({
      receivedAt: lastReceived,
      hasPosition: false,
      batteryLevel: queued[4]?.batteryLevel,
    });
    expect(w.store.positions().map((position) => position.recordedAt)).toEqual(
      sent.flatMap((body) => (body.position === null ? [] : [new Date(body.position.recordedAt)])),
    );
    expect(w.store.journeys().map((journey) => journey.state)).toEqual(['ACTIVE']);
  });
});

describe('SM-07: a heartbeat for an ended journey is refused, stores nothing, and is logged without location', () => {
  const POSITIONS = [
    { carrying: 'with a position', position: () => syntheticPosition() },
    { carrying: 'without a position', position: () => null },
  ];

  test.each(POSITIONS)(
    'LOST-01-AC7: a heartbeat $carrying for an ENDED journey is 409 JOURNEY_ENDED; nothing is stored, and last contact is unchanged',
    async ({ position }) => {
      const w = world();
      const device = w.walker();
      const journeyId = w.journeyOf(device, { state: 'ENDED', lastHeartbeatAt: EARLIER });

      const answer = await answerOf(
        await w.heartbeat(device.credential, { ...fullHeartbeat(journeyId), position: position() }),
      );

      expect(answer.status).toBe(409);
      expect(codeOf(answer)).toBe('JOURNEY_ENDED');
      expect(w.store.heartbeats()).toEqual([]);
      expect(w.store.positions()).toEqual([]);
      expect(w.store.lastHeartbeatAt(journeyId)).toEqual(EARLIER);
      expect(w.store.journeys().map((journey) => journey.state)).toEqual(['ENDED']);
    },
  );

  test('LOST-01-AC7: exactly one log event is written, heartbeat_ignored with the journey’s ID and the reason, and it holds nothing of the heartbeat', async () => {
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device, { state: 'ENDED' });
    const body = fullHeartbeat(journeyId);

    expect((await w.heartbeat(device.credential, body)).status).toBe(409);

    expect(w.log.events).toEqual([
      { event: 'heartbeat_ignored', reason: 'JOURNEY_ENDED', journeyId },
    ]);
    expect(markersIn(JSON.stringify(w.log.events), markersOf(body))).toEqual([]);
  });

  test('LOST-01-AC7: the answer is the same whatever else the heartbeat holds: an event ID the journey already has, or another device of the walker’s (D-101)', async () => {
    const w = world();
    const device = w.walker();
    const tablet = w.secondDevice(device);
    const journeyId = w.journeyOf(device);
    const before = fullHeartbeat(journeyId);
    expect((await answerOf(await w.heartbeat(device.credential, before))).body).toEqual(RECORDED);
    w.store.setState(journeyId, 'ENDED');
    w.clock.advance(MINUTE);

    const resent = await answerOf(await w.heartbeat(device.credential, before));
    const fromTablet = await answerOf(
      await w.heartbeat(tablet.credential, fullHeartbeat(journeyId)),
    );

    expect([resent.status, codeOf(resent)]).toEqual([409, 'JOURNEY_ENDED']);
    expect([fromTablet.status, codeOf(fromTablet)]).toEqual([409, 'JOURNEY_ENDED']);
    expect(fromTablet.text).toBe(resent.text);
    expect(w.store.heartbeats()).toEqual([storedAs(before, journeyId, NOW)]);
    expect(w.store.lastHeartbeatAt(journeyId)).toEqual(NOW);
    expect(w.log.events).toEqual([
      { event: 'heartbeat_ignored', reason: 'JOURNEY_ENDED', journeyId },
      { event: 'heartbeat_ignored', reason: 'JOURNEY_ENDED', journeyId },
    ]);
  });

  test('LOST-01-AC7: when the journey ends between the module’s read and the store’s write, the answer, the log line and "nothing stored" are the same', async () => {
    // The store answers `ended`: the journey was ACTIVE when it was read, and
    // ENDED by the time the heartbeat was written.
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device, { lastHeartbeatAt: EARLIER });
    w.store.beforeNext('recordHeartbeat', () => {
      w.store.setState(journeyId, 'ENDED');
    });

    const answer = await answerOf(await w.heartbeat(device.credential, fullHeartbeat(journeyId)));

    expect(w.store.calls).toContain('recordHeartbeat');
    expect(answer.status).toBe(409);
    expect(codeOf(answer)).toBe('JOURNEY_ENDED');
    expect(w.store.heartbeats()).toEqual([]);
    expect(w.store.positions()).toEqual([]);
    expect(w.store.lastHeartbeatAt(journeyId)).toEqual(EARLIER);
    expect(w.log.events).toEqual([
      { event: 'heartbeat_ignored', reason: 'JOURNEY_ENDED', journeyId },
    ]);
  });
});

describe('SM-03: a heartbeat for a journey that has lost contact', () => {
  test('LOST-01-AC8: a heartbeat for a journey in LOST_CONTACT, put there directly, is 200 RECORDED, stored, and advances last contact; the journey stays LOST_CONTACT', async () => {
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device, { state: 'LOST_CONTACT', lastHeartbeatAt: EARLIER });
    w.clock.advance(MINUTE);
    const body = fullHeartbeat(journeyId);

    const answer = await answerOf(await w.heartbeat(device.credential, body));

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(RECORDED);
    const at = new Date(NOW.getTime() + MINUTE);
    expect(w.store.heartbeats()).toEqual([storedAs(body, journeyId, at)]);
    expect(w.store.lastHeartbeatAt(journeyId)).toEqual(at);
    expect(w.store.journeys().map((journey) => journey.state)).toEqual(['LOST_CONTACT']);
    expect(w.log.events).toEqual([]);
  });
});

describe('SEC-07: a heartbeat only for the walker’s own journey', () => {
  test('LOST-01-AC9: a heartbeat naming another walker’s unended journey, or an ID no journey has, is 404 JOURNEY_NOT_FOUND, and the two bodies are identical', async () => {
    const w = world();
    const device = w.walker();
    const other = w.walker();
    const theirs = w.journeyOf(other);

    const toTheirs = await answerOf(await w.heartbeat(device.credential, fullHeartbeat(theirs)));
    const toNone = await answerOf(
      await w.heartbeat(device.credential, fullHeartbeat(syntheticUuid())),
    );

    expect(toTheirs.status).toBe(404);
    expect(codeOf(toTheirs)).toBe('JOURNEY_NOT_FOUND');
    expect(toNone.status).toBe(404);
    expect(toTheirs.text).toBe(toNone.text);
  });

  test.each(['ACTIVE', 'LOST_CONTACT', 'ENDED'] as const)(
    'LOST-01-AC9: for another walker’s %s journey nothing is stored, its heartbeats and last contact are unchanged, and the answer is 404, never their journey’s state',
    async (state) => {
      const w = world();
      const device = w.walker();
      const other = w.walker();
      const theirs = w.journeyOf(other);
      const theirOwn = fullHeartbeat(theirs);
      expect((await answerOf(await w.heartbeat(other.credential, theirOwn))).body).toEqual(
        RECORDED,
      );
      w.store.setState(theirs, state);
      w.clock.advance(MINUTE);

      const answer = await answerOf(await w.heartbeat(device.credential, fullHeartbeat(theirs)));

      expect(answer.status).toBe(404);
      expect(codeOf(answer)).toBe('JOURNEY_NOT_FOUND');
      expect(w.store.heartbeats()).toEqual([storedAs(theirOwn, theirs, NOW)]);
      expect(w.store.lastHeartbeatAt(theirs)).toEqual(NOW);
      expect(w.log.events).toEqual([]);
    },
  );
});

describe('SEC-07 and D-101: a heartbeat only from the device that started the journey', () => {
  test('LOST-01-AC10: a heartbeat for the journey from the walker’s second device is 403 NOT_THE_JOURNEYS_DEVICE; nothing is stored, and last contact is unchanged', async () => {
    const w = world();
    const phone = w.walker();
    const tablet = w.secondDevice(phone);
    const journeyId = w.journeyOf(phone, { lastHeartbeatAt: EARLIER });
    w.clock.advance(MINUTE);

    const answer = await answerOf(await w.heartbeat(tablet.credential, fullHeartbeat(journeyId)));

    expect(answer.status).toBe(403);
    expect(codeOf(answer)).toBe('NOT_THE_JOURNEYS_DEVICE');
    expect(w.store.heartbeats()).toEqual([]);
    expect(w.store.positions()).toEqual([]);
    expect(w.store.lastHeartbeatAt(journeyId)).toEqual(EARLIER);
  });

  test('LOST-01-AC10: the refusal holds whatever the second device’s heartbeat holds — a position or none, an event ID the journey already has — while the phone’s next heartbeat is RECORDED', async () => {
    const w = world();
    const phone = w.walker();
    const tablet = w.secondDevice(phone);
    const journeyId = w.journeyOf(phone);
    const first = fullHeartbeat(journeyId);
    expect((await answerOf(await w.heartbeat(phone.credential, first))).body).toEqual(RECORDED);
    w.clock.advance(MINUTE);

    for (const body of [
      fullHeartbeat(journeyId),
      { ...fullHeartbeat(journeyId), position: null, batteryLevel: null },
      first,
    ]) {
      const answer = await answerOf(await w.heartbeat(tablet.credential, body));

      expect([answer.status, codeOf(answer)], body.eventId).toEqual([
        403,
        'NOT_THE_JOURNEYS_DEVICE',
      ]);
    }
    expect(w.store.lastHeartbeatAt(journeyId)).toEqual(NOW);

    const next = await answerOf(await w.heartbeat(phone.credential, fullHeartbeat(journeyId)));
    expect(next.body).toEqual(RECORDED);
    expect(heartbeatsOf(w, journeyId)).toHaveLength(2);
    expect(w.store.lastHeartbeatAt(journeyId)).toEqual(new Date(NOW.getTime() + MINUTE));
  });

  test('LOST-01-AC10: a journey started through the API records the device that sent the start, and no other', async () => {
    const w = world();
    const phone = w.walker();
    const tablet = w.secondDevice(phone);

    const started = await answerOf(await w.start(phone.credential, { responderIds: [w.user()] }));

    expect(started.status).toBe(201);
    const { journeyId } = started.body as StartedBody;
    expect(w.store.deviceOf(journeyId)).toBe(phone.deviceId);
    expect(w.store.deviceOf(journeyId)).not.toBe(tablet.deviceId);
  });

  test('LOST-01-AC10: a journey started from the tablet takes heartbeats from the tablet, and refuses the phone', async () => {
    // The rule is the starting device, not a favourite one.
    const w = world();
    const phone = w.walker();
    const tablet = w.secondDevice(phone);
    const started = await answerOf(await w.start(tablet.credential, { responderIds: [w.user()] }));
    const { journeyId } = started.body as StartedBody;

    const fromPhone = await answerOf(await w.heartbeat(phone.credential, fullHeartbeat(journeyId)));
    const fromTablet = await answerOf(
      await w.heartbeat(tablet.credential, fullHeartbeat(journeyId)),
    );

    expect([fromPhone.status, codeOf(fromPhone)]).toEqual([403, 'NOT_THE_JOURNEYS_DEVICE']);
    expect(fromTablet.body).toEqual(RECORDED);
  });
});

// ---------------------------------------------------------------------------
// The body is checked, and nothing of it is echoed: SEC-07 and §4.5.
// ---------------------------------------------------------------------------

/** A heartbeat's JSON with one value written in place of another, as text: for values JSON.stringify cannot write. */
function replacing(body: FullHeartbeat, field: 'latitude' | 'longitude', raw: string): string {
  const text = JSON.stringify(body);
  const value = `"${field}":${String(body.position[field])}`;
  if (!text.includes(value)) {
    throw new Error(`the heartbeat's JSON has no ${value} to replace`);
  }
  return text.replace(value, `"${field}":${raw}`);
}

/** The body without one of its fields. */
function without(object: object, field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([key]) => key !== field));
}

/** Heartbeat bodies refused with 400, by what is wrong with them, each made from a valid one. */
const REFUSED_HEARTBEATS: { what: string; text: (valid: FullHeartbeat) => string }[] = [
  {
    what: 'has a field beyond the four',
    text: (b) => JSON.stringify({ ...b, note: 'hello' }),
  },
  {
    what: 'has a field beyond the four inside position',
    text: (b) => JSON.stringify({ ...b, position: { ...b.position, altitude: 12.5 } }),
  },
  { what: 'misses journeyId', text: (b) => JSON.stringify(without(b, 'journeyId')) },
  { what: 'misses eventId', text: (b) => JSON.stringify(without(b, 'eventId')) },
  { what: 'misses batteryLevel', text: (b) => JSON.stringify(without(b, 'batteryLevel')) },
  { what: 'misses position', text: (b) => JSON.stringify(without(b, 'position')) },
  {
    what: 'has a journeyId that is not a UUID',
    text: (b) => JSON.stringify({ ...b, journeyId: 'journey-1' }),
  },
  { what: 'has an empty eventId', text: (b) => JSON.stringify({ ...b, eventId: '' }) },
  {
    what: 'has an eventId longer than MAX_EVENT_ID_LENGTH',
    text: (b) => JSON.stringify({ ...b, eventId: b.eventId.padEnd(MAX_EVENT_ID_LENGTH + 1, 'f') }),
  },
  {
    what: 'has an eventId with an underscore',
    text: (b) => JSON.stringify({ ...b, eventId: `${b.eventId}_1` }),
  },
  {
    what: 'has an eventId with a dot',
    text: (b) => JSON.stringify({ ...b, eventId: `${b.eventId}.1` }),
  },
  {
    what: 'has an eventId with a space',
    text: (b) => JSON.stringify({ ...b, eventId: `${b.eventId} 1` }),
  },
  {
    what: 'has an eventId with a letter outside ASCII',
    text: (b) => JSON.stringify({ ...b, eventId: `${b.eventId}ø` }),
  },
  {
    what: 'has a latitude above 90',
    text: (b) => JSON.stringify({ ...b, position: { ...b.position, latitude: 90.0000001 } }),
  },
  {
    what: 'has a latitude below -90',
    text: (b) => JSON.stringify({ ...b, position: { ...b.position, latitude: -90.0000001 } }),
  },
  {
    what: 'has a longitude above 180',
    text: (b) => JSON.stringify({ ...b, position: { ...b.position, longitude: 180.0000001 } }),
  },
  {
    what: 'has a longitude below -180',
    text: (b) => JSON.stringify({ ...b, position: { ...b.position, longitude: -180.0000001 } }),
  },
  { what: 'has a latitude that is not finite', text: (b) => replacing(b, 'latitude', '1e999') },
  {
    what: 'has a longitude that is not finite',
    text: (b) => replacing(b, 'longitude', '-1e999'),
  },
  {
    what: 'has a negative accuracy',
    text: (b) => JSON.stringify({ ...b, position: { ...b.position, accuracyMeters: -0.125 } }),
  },
  {
    what: 'has a battery level above 1',
    text: (b) => JSON.stringify({ ...b, batteryLevel: 1.015625 }),
  },
  {
    what: 'has a battery level below 0',
    text: (b) => JSON.stringify({ ...b, batteryLevel: -0.015625 }),
  },
  {
    what: 'has a recordedAt with no offset',
    text: (b) =>
      JSON.stringify({
        ...b,
        position: { ...b.position, recordedAt: b.position.recordedAt.replace(/Z$/, '') },
      }),
  },
  {
    what: 'has a position without its latitude',
    text: (b) => JSON.stringify({ ...b, position: without(b.position, 'latitude') }),
  },
  {
    what: 'has a position without its longitude',
    text: (b) => JSON.stringify({ ...b, position: without(b.position, 'longitude') }),
  },
  {
    what: 'has a position without its accuracy',
    text: (b) => JSON.stringify({ ...b, position: without(b.position, 'accuracyMeters') }),
  },
  {
    what: 'has a position without its recordedAt',
    text: (b) => JSON.stringify({ ...b, position: without(b.position, 'recordedAt') }),
  },
  { what: 'is not JSON at all: cut short', text: (b) => JSON.stringify(b).slice(0, -2) },
  {
    what: 'is not JSON at all: plain words',
    text: (b) => `heartbeat ${b.eventId} at ${String(b.position.latitude)}`,
  },
];

describe('SEC-07: the heartbeat’s body is checked, and a refused body stores nothing', () => {
  test.each(REFUSED_HEARTBEATS)(
    'LOST-01-AC11: a body that $what is 400 BAD_REQUEST, and nothing is stored',
    async ({ text }) => {
      const w = world();
      const device = w.walker();
      const journeyId = w.journeyOf(device, { lastHeartbeatAt: EARLIER });

      const answer = await answerOf(
        await w.heartbeatText(device.credential, text(fullHeartbeat(journeyId))),
      );

      expect(answer.status).toBe(400);
      expect(codeOf(answer)).toBe('BAD_REQUEST');
      expect(w.store.calls).not.toContain('recordHeartbeat');
      expect(w.store.heartbeats()).toEqual([]);
      expect(w.store.positions()).toEqual([]);
      expect(w.store.lastHeartbeatAt(journeyId)).toEqual(EARLIER);
    },
  );

  test('LOST-01-AC11: the valid body each refusal above is made from is RECORDED, so each 400 is the change’s doing', async () => {
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device);

    const answer = await answerOf(
      await w.heartbeatText(device.credential, JSON.stringify(fullHeartbeat(journeyId))),
    );

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(RECORDED);
  });
});

/** What §4.5 forbids in any answer: the SDK's remote-command key, in any of its spellings. */
const ECHO = /background[_-]?geolocation/i;

/** Requests that carry it, each refused with 400. */
const CARRYING_IT: { where: string; text: (valid: FullHeartbeat) => string }[] = [
  {
    where: 'as a top-level key',
    text: (b) => JSON.stringify({ ...b, background_geolocation: { url: 'synthetic' } }),
  },
  {
    where: 'as a key inside position',
    text: (b) => JSON.stringify({ ...b, position: { ...b.position, background_geolocation: 1 } }),
  },
  {
    where: 'as a string value',
    text: (b) => JSON.stringify({ ...b, eventId: 'background_geolocation' }),
  },
  {
    where: 'inside a body that is not JSON',
    text: (b) => `${JSON.stringify(b).slice(0, -1)}, "background_geolocation": `,
  },
  {
    where: 'spelled backgroundGeolocation',
    text: (b) => JSON.stringify({ ...b, backgroundGeolocation: {} }),
  },
  {
    where: 'spelled BACKGROUND-GEOLOCATION',
    text: (b) => JSON.stringify({ ...b, 'BACKGROUND-GEOLOCATION': {} }),
  },
];

describe('§4.5: no answer carries a background_geolocation key, or anything of the request', () => {
  test.each(CARRYING_IT)(
    'LOST-01-AC12: a request holding background_geolocation $where is 400, and the answer’s headers and body do not echo it',
    async ({ text }) => {
      const w = world();
      const device = w.walker();
      const journeyId = w.journeyOf(device);

      const answer = await answerOf(
        await w.heartbeatText(device.credential, text(fullHeartbeat(journeyId))),
      );

      expect(answer.status).toBe(400);
      expect(codeOf(answer)).toBe('BAD_REQUEST');
      expect(answer.headers).not.toMatch(ECHO);
      expect(answer.text).not.toMatch(ECHO);
    },
  );

  test('LOST-01-AC12: every 400 is exactly the one fixed BAD_REQUEST body, with no data, whatever the request held', async () => {
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device);
    const bodies = new Set<string>();

    for (const { text } of [...REFUSED_HEARTBEATS, ...CARRYING_IT]) {
      const answer = await answerOf(
        await w.heartbeatText(device.credential, text(fullHeartbeat(journeyId))),
      );
      expect(answer.status).toBe(400);
      bodies.add(answer.text);
    }

    expect(bodies.size).toBe(1);
    const [fixed = ''] = bodies;
    const parsed = JSON.parse(fixed) as Record<string, unknown>;
    expect(parsed['code']).toBe('BAD_REQUEST');
    expect(Object.keys(parsed)).not.toContain('data');
  });

  test('LOST-01-AC12: across every answer the route gives — 200, 400, 401, 403, 404, 409 and 500 — with the key in the request, no header or body matches it, and each 200 body is exactly { outcome }', async () => {
    // `background-geolocation` in any case is a valid event ID: letters and
    // `-`. So it reaches every outcome, the stored ones included.
    const w = world();
    const device = w.walker();
    const tablet = w.secondDevice(device);
    const other = w.walker();
    const journeyId = w.journeyOf(device);
    const ended = w.journeyOf(other, { state: 'ENDED' });
    const echoing = (target: string, eventId = 'background-geolocation') => ({
      ...fullHeartbeat(target),
      eventId,
    });
    const answers: { expected: number; answer: Answer }[] = [];
    const ask = async (expected: number, credential: string, body: unknown) => {
      answers.push({ expected, answer: await answerOf(await w.heartbeat(credential, body)) });
    };

    await ask(200, device.credential, echoing(journeyId));
    await ask(200, device.credential, echoing(journeyId));
    await ask(400, device.credential, { ...echoing(journeyId), background_geolocation: {} });
    await ask(401, syntheticCredential(), echoing(journeyId, 'BACKGROUND-GEOLOCATION'));
    await ask(403, tablet.credential, echoing(journeyId, 'Background-Geolocation'));
    await ask(404, device.credential, echoing(syntheticUuid()));
    await ask(409, other.credential, echoing(ended));
    w.store.failWith(new Error('background_geolocation: the store failed'), 'recordHeartbeat');
    await ask(500, device.credential, echoing(journeyId, 'backgroundgeolocation'));

    expect(answers.map(({ answer }) => answer.status)).toEqual(
      answers.map(({ expected }) => expected),
    );
    expect(answers.map(({ answer }) => answer.body).slice(0, 2)).toEqual([RECORDED, DUPLICATE]);
    for (const { answer } of answers) {
      expect(answer.headers, String(answer.status)).not.toMatch(ECHO);
      expect(answer.text, String(answer.status)).not.toMatch(ECHO);
    }
  });
});

// ---------------------------------------------------------------------------
// All or nothing, and loud: a failure is a 500 and one line.
// ---------------------------------------------------------------------------

/** The three places a heartbeat can fail, and how a test makes each one fail. */
const FAILURES = [
  {
    stage: 'clock',
    fail: (w: World, error: Error) => {
      w.clock.failWith(error);
    },
  },
  {
    stage: 'read',
    fail: (w: World, error: Error) => {
      w.store.failWith(error, 'journeyForHeartbeat');
    },
  },
  {
    stage: 'store',
    fail: (w: World, error: Error) => {
      w.store.failWith(error, 'recordHeartbeat');
    },
  },
] as const;

describe('LOST-01: a heartbeat is stored whole or not at all, and a failure is a loud 500', () => {
  test.each(FAILURES)(
    'LOST-01-AC13: when the $stage fails, the answer is 500, nothing is stored, last contact is unchanged, and exactly one heartbeat_failed event names the stage',
    async ({ stage, fail }) => {
      const w = world();
      const device = w.walker();
      const journeyId = w.journeyOf(device, { lastHeartbeatAt: EARLIER });
      fail(w, new Error(`the ${stage} did not answer`));

      const answer = await answerOf(await w.heartbeat(device.credential, fullHeartbeat(journeyId)));

      expect(answer.status).toBe(500);
      expect(codeOf(answer)).not.toBe('UNAUTHORIZED');
      expect(w.store.heartbeats()).toEqual([]);
      expect(w.store.positions()).toEqual([]);
      expect(w.store.lastHeartbeatAt(journeyId)).toEqual(EARLIER);
      expect(w.log.events).toEqual([{ event: 'heartbeat_failed', stage, code: null }]);
    },
  );

  test.each(FAILURES)(
    'LOST-01-AC13: once the $stage answers again, the same event is RECORDED, not DUPLICATE: nothing half-written blocks it',
    async ({ stage, fail }) => {
      const w = world();
      const device = w.walker();
      const journeyId = w.journeyOf(device);
      const body = fullHeartbeat(journeyId);
      fail(w, new Error(`the ${stage} did not answer`));
      expect((await w.heartbeat(device.credential, body)).status).toBe(500);

      w.clock.recover();
      w.store.recover();
      const answer = await answerOf(await w.heartbeat(device.credential, body));

      expect(answer.status).toBe(200);
      expect(answer.body).toEqual(RECORDED);
      expect(w.store.heartbeats()).toHaveLength(1);
    },
  );

  test('LOST-01-AC13: a store failure carrying a SQLSTATE is logged with that code, and nothing of its message', async () => {
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device);
    const failure = Object.assign(new Error('could not extend file: no space left on device'), {
      code: '53100',
    });
    w.store.failWith(failure, 'recordHeartbeat');

    expect((await w.heartbeat(device.credential, fullHeartbeat(journeyId))).status).toBe(500);

    expect(w.log.events).toEqual([{ event: 'heartbeat_failed', stage: 'store', code: '53100' }]);
    expect(JSON.stringify(w.log.events)).not.toContain('no space left');
  });

  test('LOST-01-AC13: a failed credential check is still a 500 on this route, never a 401, and the handler never runs', async () => {
    const w = world();
    const device = w.walker();
    const journeyId = w.journeyOf(device);
    w.devices.failWith(new Error('the device store did not answer'));

    const answer = await answerOf(await w.heartbeat(device.credential, fullHeartbeat(journeyId)));

    expect(answer.status).toBe(500);
    expect(w.store.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// None of it reaches a log: PRIV-07, and LOST-01's "none of it".
// ---------------------------------------------------------------------------

/**
 * Every text a careless line could print of this heartbeat: each coordinate
 * in full and rounded to 3, 4, 5, 6 and 7 decimals, the accuracy, the battery
 * level, the phone's time as sent and as a number, and the event ID.
 */
function markersOf(body: SyntheticHeartbeat): string[] {
  const { position } = body;
  const coordinates = position === null ? [] : [position.latitude, position.longitude];
  return [
    ...new Set([
      ...coordinates.flatMap((value) => [
        String(value),
        ...[3, 4, 5, 6, 7].map((decimals) => value.toFixed(decimals)),
      ]),
      ...(position === null
        ? []
        : [
            String(position.accuracyMeters),
            position.recordedAt,
            String(Date.parse(position.recordedAt)),
          ]),
      ...(body.batteryLevel === null ? [] : [String(body.batteryLevel)]),
      body.eventId,
    ]),
  ];
}

/** The markers found in this text: none, if nothing of the heartbeat is in it. */
function markersIn(text: string, markers: readonly string[]): string[] {
  return markers.filter((marker) => text.includes(marker));
}

interface PrivateRun {
  answer: Answer;
  /** The heartbeat whose values must appear nowhere. */
  sent: SyntheticHeartbeat;
  /** The error a fake was made to throw, when it was: the control that the markers were there to leak. */
  thrown?: Error;
}

/** An error whose message holds every value of the heartbeat, as PostgreSQL's "Failing row contains (…)" would. */
function errorHolding(body: SyntheticHeartbeat): Error {
  return new Error(`Failing row contains (${markersOf(body).join(', ')})`);
}

/**
 * Each outcome a heartbeat can have, set up and sent, and what its answer must
 * be: the status, and the body's code or outcome, so that an outcome that did
 * not happen (a route that does not exist answers 404 too) cannot pass here.
 */
const OUTCOMES: {
  outcome: string;
  status: number;
  answered: unknown;
  run: (w: World) => Promise<PrivateRun>;
}[] = [
  {
    outcome: 'recorded, with a position',
    status: 200,
    answered: 'RECORDED',
    run: async (w) => {
      const device = w.walker();
      const sent = fullHeartbeat(w.journeyOf(device));
      return { answer: await answerOf(await w.heartbeat(device.credential, sent)), sent };
    },
  },
  {
    outcome: 'recorded, without a position',
    status: 200,
    answered: 'RECORDED',
    run: async (w) => {
      const device = w.walker();
      const sent = { ...fullHeartbeat(w.journeyOf(device)), position: null };
      return { answer: await answerOf(await w.heartbeat(device.credential, sent)), sent };
    },
  },
  {
    outcome: 'duplicate',
    status: 200,
    answered: 'DUPLICATE',
    run: async (w) => {
      const device = w.walker();
      const sent = fullHeartbeat(w.journeyOf(device));
      await w.heartbeat(device.credential, sent);
      w.clock.advance(MINUTE);
      return { answer: await answerOf(await w.heartbeat(device.credential, sent)), sent };
    },
  },
  {
    outcome: 'ended',
    status: 409,
    answered: 'JOURNEY_ENDED',
    run: async (w) => {
      const device = w.walker();
      const sent = fullHeartbeat(w.journeyOf(device, { state: 'ENDED' }));
      return { answer: await answerOf(await w.heartbeat(device.credential, sent)), sent };
    },
  },
  {
    outcome: 'not found',
    status: 404,
    answered: 'JOURNEY_NOT_FOUND',
    run: async (w) => {
      const device = w.walker();
      const sent = fullHeartbeat(syntheticUuid());
      return { answer: await answerOf(await w.heartbeat(device.credential, sent)), sent };
    },
  },
  {
    outcome: 'another device’s 403',
    status: 403,
    answered: 'NOT_THE_JOURNEYS_DEVICE',
    run: async (w) => {
      const device = w.walker();
      const tablet = w.secondDevice(device);
      const sent = fullHeartbeat(w.journeyOf(device));
      return { answer: await answerOf(await w.heartbeat(tablet.credential, sent)), sent };
    },
  },
  {
    outcome: '401',
    status: 401,
    answered: 'UNAUTHORIZED',
    run: async (w) => {
      const device = w.walker();
      const sent = fullHeartbeat(w.journeyOf(device));
      return { answer: await answerOf(await w.heartbeat(syntheticCredential(), sent)), sent };
    },
  },
  {
    outcome: 'a store failure whose error message holds the heartbeat',
    status: 500,
    answered: 'INTERNAL_SERVER_ERROR',
    run: async (w) => {
      const device = w.walker();
      const sent = fullHeartbeat(w.journeyOf(device));
      const thrown = errorHolding(sent);
      w.store.failWith(thrown, 'recordHeartbeat');
      return { answer: await answerOf(await w.heartbeat(device.credential, sent)), sent, thrown };
    },
  },
  {
    outcome: 'a clock failure',
    status: 500,
    answered: 'INTERNAL_SERVER_ERROR',
    run: async (w) => {
      const device = w.walker();
      const sent = fullHeartbeat(w.journeyOf(device));
      const thrown = errorHolding(sent);
      w.clock.failWith(thrown);
      return { answer: await answerOf(await w.heartbeat(device.credential, sent)), sent, thrown };
    },
  },
];

describe('PRIV-07: nothing of a heartbeat is written, whatever the outcome', () => {
  test.each(OUTCOMES)(
    'LOST-01-AC14: $outcome: nothing of the heartbeat is in stdout, stderr, the console, the log or the answer',
    async ({ run, status, answered }) => {
      const w = world();

      const { result, written } = await captured(() => run(w));

      expect(result.answer.status).toBe(status);
      const body = result.answer.body as { code?: unknown; outcome?: unknown } | null;
      expect(status === 200 ? body?.outcome : body?.code).toBe(answered);
      const markers = markersOf(result.sent);
      expect(markers.length).toBeGreaterThan(0);
      expect(markersIn(written, markers), 'written to stdout, stderr or the console').toEqual([]);
      expect(markersIn(JSON.stringify(w.log.events), markers), 'in the log').toEqual([]);
      expect(
        markersIn(`${result.answer.headers}\n${result.answer.text}`, markers),
        'in the answer',
      ).toEqual([]);
      if (result.thrown !== undefined) {
        // The control: the error the fake threw did hold every marker, so
        // finding none of them above means they were kept out, not absent.
        expect(markersIn(result.thrown.message, markers)).toEqual(markers);
        expect(w.log.events).toHaveLength(1);
      }
    },
  );

  test.each(REFUSED_HEARTBEATS)(
    'LOST-01-AC14: a body that $what: its 400 holds nothing of the heartbeat, and nothing of it is written',
    async ({ text }) => {
      const w = world();
      const device = w.walker();
      const sent = fullHeartbeat(w.journeyOf(device));

      const { result, written } = await captured(async () =>
        answerOf(await w.heartbeatText(device.credential, text(sent))),
      );

      expect(result.status).toBe(400);
      const markers = markersOf(sent);
      expect(markersIn(written, markers), 'written to stdout, stderr or the console').toEqual([]);
      expect(markersIn(JSON.stringify(w.log.events), markers), 'in the log').toEqual([]);
      expect(markersIn(`${result.headers}\n${result.text}`, markers), 'in the answer').toEqual([]);
    },
  );

  test('LOST-01-AC14: (control) the capture sees a line written through the production createLog, made before the capture as api-process.ts makes it at start-up', async () => {
    // pino's own default destination writes to file descriptor 1 directly,
    // past any spy on process.stdout.write. A capture that could not see the
    // log would pass every "nothing written" test above while proving
    // nothing, so the production log, wired as the API process wires it,
    // must be seen here. Loaded when needed rather than at the top, so the
    // rest of this file ran while log.ts did not exist yet (RG-02).
    const { createLog } = await import('./log.ts');
    const log = createLog();
    const journeyId = syntheticUuid();

    const { written } = await captured(() => {
      log.write({ event: 'heartbeat_ignored', reason: 'JOURNEY_ENDED', journeyId });
      return Promise.resolve();
    });

    expect(written).toContain('heartbeat_ignored');
    expect(written).toContain(journeyId);
  });

  test('LOST-01-AC14: (control) through the API with the production log, an ended journey’s one line reaches the capture, naming the journey, and holds nothing of the heartbeat', async () => {
    const { createLog } = await import('./log.ts');
    const w = world({ log: createLog() });
    const device = w.walker();
    const journeyId = w.journeyOf(device, { state: 'ENDED' });
    const sent = fullHeartbeat(journeyId);

    const { result, written } = await captured(async () =>
      answerOf(await w.heartbeat(device.credential, sent)),
    );

    expect(result.status).toBe(409);
    const lines = written.split('\n').filter((line) => line.includes('heartbeat_ignored'));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? 'null')).toMatchObject({
      event: 'heartbeat_ignored',
      reason: 'JOURNEY_ENDED',
      journeyId,
    });
    expect(markersIn(written, markersOf(sent))).toEqual([]);
  });
});
