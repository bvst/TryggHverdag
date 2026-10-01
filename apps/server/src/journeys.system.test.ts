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
import {
  API_PREFIX,
  MAX_RESPONDERS,
  openApiDocument,
  startJourneyResponseSchema,
} from '@trygghverdag/contracts';
import {
  apiPath,
  fakeClock,
  fakeDeviceAuthenticator,
  fakeJourneyStore,
  fakeWorkerHeartbeats,
  syntheticCredential,
  syntheticUuid,
} from '@trygghverdag/test-kit';
import process from 'node:process';
import { inspect } from 'node:util';
import { describe, expect, test, vi } from 'vitest';
import { createApi } from './api.ts';
import { createHealthService } from './modules/health/service.ts';
import { createJourneyService } from './modules/journeys/service.ts';

const NOW = new Date('2026-10-01T21:40:00.000Z');
const EARLIER = new Date('2026-10-01T21:10:00.000Z');
const JOURNEYS = apiPath('journeys');

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

/** One API, its fakes, and the people a test needs. */
function world() {
  const clock = fakeClock(NOW);
  const devices = fakeDeviceAuthenticator();
  const store = fakeJourneyStore();
  const api = createApi({
    health: createHealthService({ clock, heartbeats: fakeWorkerHeartbeats(NOW) }),
    journeys: createJourneyService({ clock, journeys: store }),
    devices,
  });

  return {
    api,
    clock,
    devices,
    store,
    /** A user with a device: someone who can start a journey. */
    walker: () => {
      const device = devices.register();
      store.addUser(device.userId);
      return device;
    },
    /** A user with no device here: someone who can follow a journey. */
    user: (): string => store.addUser(),
    start: (credential: string, body: unknown): Promise<Response> =>
      send(api, 'POST', JOURNEYS, { authorization: `Bearer ${credential}` }, body),
  };
}

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
