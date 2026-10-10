// L6 system: the staging canary (REL-10, PRIV-07; D-127, D-128), through the
// whole server in one process.
//
// The canary's run (modules/canary/run.ts), its HTTP client
// (adapters/canary.ts) calling the real API through the app's own fetch, the
// real journey module behind it, the real watchdog, the real push sender with
// the recording push port answering NOT_CONFIGURED as the worker's push does
// on staging, the real SMS sender and SMS check, and recording fakes at the
// edges: the journey store, the device credentials, the worker's beats, the
// canary's alarm and the SMS check's, and the log. One fake clock stands in
// for the database's now(): the store reads it as PostgreSQL's now() would be
// read, and no module reads a clock (AR-03).
//
// The canary keeps no time of its own: it is handed a Wait. Here that is the
// test kit's fake, which moves the clock only when the run can go no further
// by itself, and runs the worker's loops every 10 s of it (D-107): a sweep, a
// push delivery and an SMS delivery, and the SMS check each minute, as the
// worker would. A loop whose run never settles, such as a delivery whose port
// never answers, is skipped at each boundary until it does, as the worker's
// loops never overlap themselves. No real timer runs.
//
// What is proven here (the spec's acceptance criteria):
//   - a healthy system: the alert reaches the push port in time, the journey
//     ends, the stand-down follows, and the canary reports ok (AC1);
//   - each way the alert path can fail is a failing report, once, naming
//     itself: no alert (AC2), no hand-over (AC3), an early alert (AC4), every
//     step's own failure, the earlier of two first, with the journey always
//     ended (AC6), and an escalation (AC7);
//   - 96 runs over 24 hours never escalate and never page the SMS check (AC7);
//   - a leftover is ended first, a run in flight is never cut off, and two
//     runs never both report (AC8);
//   - a stop ends a run within 5 s and reports nothing; the run limit reports
//     a failure; no run ever rejects (AC9);
//   - the canary reads only its own journeys and changes the database only
//     through the API (AC11); its page is its own, and a report that fails is
//     one line (AC12); a half-configured canary pages (AC13); nothing reaches
//     the critical level or carries anything personal (AC14); nothing secret
//     or personal reaches stdout, stderr or the console (AC15).
//
// This file is the `canary` mutation group's test (the spec's Mutation
// section): every behaviour of the run is held here. Times are written out
// (five minutes, 60 s, two minutes, 10 s, 2 s, 90 s, 10 minutes, 5 s), not
// read from the domain's constants, so a wrong constant fails here as well as
// in the domain's own tests.
import {
  CANARY_IDS,
  apiPath,
  fakeCanaryAlarm,
  fakeClock,
  fakeDeviceAuthenticator,
  fakeJourneyStore,
  fakeLog,
  fakePush,
  fakeSms,
  fakeSmsAlarm,
  fakeWait,
  fakeWorkerHeartbeats,
  syntheticCoordinate,
  syntheticCredential,
  syntheticUuid,
  type CanaryObservation,
  type FakeJourneyStore,
  type FakeLogEvent,
  type PushMessage,
} from '@trygghverdag/test-kit';
import { getEventListeners } from 'node:events';
import process from 'node:process';
import { describe, expect, test } from 'vitest';
import { httpCanaryClient } from './adapters/canary.ts';
import { hashCredential } from './adapters/device-credentials.ts';
import { createApi } from './api.ts';
import { captured, markersIn } from './capture.test.ts';
import { CANARY_DEVICE_ID, CANARY_RESPONDER_ID, CANARY_WALKER_ID } from './domain/canary.ts';
import { createLog } from './log.ts';
import { createAcknowledgementService } from './modules/alerts/acknowledgement.ts';
import { createClosureService } from './modules/alerts/closure.ts';
import { createPushSender, createSmsSender } from './modules/alerts/outbox.ts';
import { createSmsCheck } from './modules/alerts/sms-check.ts';
import { createWatchdog } from './modules/alerts/watchdog.ts';
import { createCanary } from './modules/canary/run.ts';
import { createHealthService } from './modules/health/service.ts';
import { createJourneyService } from './modules/journeys/service.ts';
import type { DeviceAuthenticator, Log } from './ports.ts';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** D-021: an alert opens when the server has heard nothing for five minutes, or more. */
const FIVE_MINUTES = 5 * MINUTE;
/** The reliability target: alerted within the threshold plus 60 s. */
const DEADLINE = FIVE_MINUTES + 60 * SECOND;
/** D-019: the escalation to SMS, two minutes after the opening. */
const TWO_MINUTES = 2 * MINUTE;
/** How often the canary reads while it watches. */
const POLL = 2 * SECOND;
/** When the canary first looks for the alert after its heartbeat: before one could open. */
const FIRST_LOOK = 290 * SECOND;
/** How long after the alert's resolution the canary waits for the stand-down's answer. */
const STAND_DOWN_LIMIT = 90 * SECOND;
/** A canary journey started this long ago or more is a leftover. */
const LEFTOVER_AFTER = 10 * MINUTE;
/** The run's own limit. */
const RUN_LIMIT = 10 * MINUTE;
/** How long a stopped run waits for its "I'm home". */
const STOP_LIMIT = 5 * SECOND;
/** The canary's cron line: every 15 minutes. */
const FIFTEEN_MINUTES = 15 * MINUTE;

/** A synthetic night: 21:00 UTC on 1 October 2026, a quarter hour, as the canary's cron slots are. */
const START = new Date('2026-10-01T21:00:00.000Z');

/** Where the canary's API is, for these tests: https, as staging's is, and only ever reached in-process. */
const ORIGIN = 'https://canary-api.invalid';

/** The longest timeout a timer takes: the client's own timeout, lifted. */
const NO_TIMEOUT = 2_147_483_647;

const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An error as a database or a driver throws one: a message, and a SQLSTATE. */
function databaseError(code: string, message = 'the database could not answer'): Error {
  return Object.assign(new Error(message), { code });
}

/** One turn of the event loop. */
function aTurn(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * One of the worker's loops: a run starts only when none is in flight, as the
 * worker's never overlap themselves; it is let go as far as it can by itself,
 * and one that never settles is left in flight.
 */
function workerLoop(work: () => Promise<unknown>) {
  let inFlight = false;
  return async (): Promise<void> => {
    if (inFlight) {
      return;
    }
    inFlight = true;
    const run = { done: false };
    void work()
      .catch(() => undefined)
      .finally(() => {
        run.done = true;
        inFlight = false;
      });
    for (let turn = 0; turn < 50 && !run.done; turn += 1) {
      await aTurn();
    }
  };
}

/** Which route a request is for. */
type Route = 'start' | 'heartbeat' | 'home' | 'other';

function routeOf(url: URL): Route {
  if (url.pathname === apiPath('journeys')) return 'start';
  if (url.pathname === apiPath('heartbeats')) return 'heartbeat';
  if (/\/journeys\/[^/]+\/home$/.test(url.pathname)) return 'home';
  return 'other';
}

/** A request the canary's client sent, as the API received it, and the status it was answered with. */
interface Sent {
  route: Route;
  origin: string;
  path: string;
  authorization: string | null;
  body: string;
  /** Milliseconds since START, by the fake clock, when it was sent. */
  at: number;
  /** How many of the canary's reads came before it. */
  readsBefore: number;
  status: number | null;
}

/**
 * A canned answer for a route, or undefined to let the API answer. `signal` is
 * the one the client handed its fetch: the Request's own follows it only
 * through a weak reference, which garbage collection can cut.
 */
type Interceptor = (
  request: Request,
  sent: Sent,
  signal: AbortSignal | null,
) => Promise<Response | undefined> | Response | undefined;

/**
 * One server, its fakes, the worker's loops on the fake Wait, and the canary
 * wired to them as the worker wires it. The modules log to the recording
 * fake, `log`, unless a test hands them another log.
 */
function world({ log: given }: { log?: Log } = {}) {
  const clock = fakeClock(START);
  const store = fakeJourneyStore({ clock });
  const people = fakeDeviceAuthenticator();
  const recorded = fakeLog();
  const log = given ?? recorded;
  const beats = fakeWorkerHeartbeats();
  const push = fakePush();
  // As the worker's push answers on staging until M3 (D-127, Q1).
  push.failAll('NOT_CONFIGURED');
  const sms = fakeSms();
  sms.failAll('NOT_CONFIGURED');
  const smsAlarm = fakeSmsAlarm();
  const alarm = fakeCanaryAlarm();

  /** Every message handed to the push port, with the clock's time when it was. */
  const handed: { message: PushMessage; at: number }[] = [];
  const pushPort = {
    send: async (message: PushMessage) => {
      handed.push({ message: { ...message }, at: (await clock.now()).getTime() - START.getTime() });
      return push.send(message);
    },
  };

  // The API authenticates a device by its credential's hash, as the adapter
  // does: the canary's device by what its registration stored, anyone else's
  // by the device fake.
  const devices: DeviceAuthenticator = {
    authenticate: async (credential) =>
      store.deviceWithCredentialHash(hashCredential(credential)) ?? people.authenticate(credential),
  };
  // The journey store the API sees: the fake, with any port method a test stubs.
  const stubs: Partial<Record<keyof FakeJourneyStore, unknown>> = {};
  const apiStore = new Proxy(store, {
    get: (target, property, receiver) =>
      (stubs[property as keyof FakeJourneyStore] ??
        Reflect.get(target, property, receiver)) as unknown,
  });
  const api = createApi({
    health: createHealthService({ clock, heartbeats: beats }),
    journeys: createJourneyService({ clock, journeys: apiStore, log }),
    devices,
    acknowledgements: createAcknowledgementService({ alerts: store, log }),
    closures: createClosureService({ alerts: store, log }),
  });

  // The worker's loops, each switchable, and the sweep replaceable by a stub.
  const running = { sweep: true, deliver: true, sms: true };
  const watchdog = createWatchdog({ journeys: store, beats, log });
  let sweep: () => Promise<unknown> = () => watchdog.sweep();
  const sender = createPushSender({ outbox: store, push: pushPort, log });
  const smsSender = createSmsSender({ outbox: store, sms, log });
  const smsCheck = createSmsCheck({ outbox: store, alarm: smsAlarm, log });
  const sweepLoop = workerLoop(() => (running.sweep ? sweep() : Promise.resolve()));
  const deliveryLoop = workerLoop(() =>
    running.deliver ? sender.deliverDue() : Promise.resolve(),
  );
  const smsLoop = workerLoop(() => (running.sms ? smsSender.deliverDue() : Promise.resolve()));
  const smsCheckLoop = workerLoop(() => smsCheck.check());
  const hooks: ((at: number) => unknown)[] = [];
  const waits = fakeWait({
    clock,
    intervalMs: 10 * SECOND,
    onInterval: async (at) => {
      const since = at.getTime() - START.getTime();
      await sweepLoop();
      await deliveryLoop();
      await smsLoop();
      if (since % MINUTE === 0) {
        await smsCheckLoop();
      }
      for (const hook of hooks) {
        await hook(since);
      }
    },
  });

  /** Every observation the canary's store handed the run, in order. */
  const observations: CanaryObservation[] = [];

  // The canary's client calls the API through the app's own fetch, recorded.
  const sent: Sent[] = [];
  const interceptors: Interceptor[] = [];
  const appFetch: typeof fetch = async (input, init) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
    const request = new Request(input, init);
    const url = new URL(request.url);
    const entry: Sent = {
      route: routeOf(url),
      origin: url.origin,
      path: url.pathname,
      authorization: request.headers.get('authorization'),
      body: await request.clone().text(),
      at: (await clock.now()).getTime() - START.getTime(),
      readsBefore: observations.length,
      status: null,
    };
    sent.push(entry);
    for (const intercept of interceptors) {
      const canned = await intercept(request, entry, signal);
      if (canned !== undefined) {
        entry.status = canned.status;
        return canned;
      }
    }
    const response = await api.fetch(request);
    entry.status = response.status;
    return response;
  };

  const credential = syntheticCredential();
  const credentialHash = hashCredential(credential);

  // The canary's store: the fake's two canary methods and nothing else, so
  // the run can change the database only through the API (AC11). Every
  // observation it was handed is kept, and a test can fail or change a read.
  const storeCalls: string[] = [];
  let readFailure: ((index: number) => Error | null) | null = null;
  let readChange: ((observation: CanaryObservation) => CanaryObservation) | null = null;
  let readNone: ((observation: CanaryObservation, index: number) => boolean) | null = null;
  const canaryStore = {
    registerCanary: (request: { credentialHash: string }) => {
      storeCalls.push('registerCanary');
      return store.registerCanary(request);
    },
    observeCanaryJourney: async (journeyId: string) => {
      storeCalls.push('observeCanaryJourney');
      const failure = readFailure?.(observations.length) ?? null;
      if (failure !== null) {
        observations.push(null as unknown as CanaryObservation);
        throw failure;
      }
      const read = await store.observeCanaryJourney(journeyId);
      if (read === null) {
        return null;
      }
      if (readNone?.(read, observations.length) === true) {
        observations.push(null as unknown as CanaryObservation);
        return null;
      }
      const observation = readChange === null ? read : readChange(read);
      observations.push(observation);
      return observation;
    },
  };

  /** The HTTP client the worker makes, over the app's fetch, with the client's own timeout unless lifted. */
  const makeClient = ({
    credential: given = credential,
    timeoutMs,
  }: { credential?: string; timeoutMs?: number } = {}) =>
    httpCanaryClient({
      baseUrl: ORIGIN,
      credential: given,
      fetch: appFetch,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });

  /** The canary, as the worker makes it: one per worker process. */
  const makeCanary = ({
    client = makeClient(),
    notConfigured,
    hash = credentialHash,
    canaryAlarm = alarm,
    canaryLog = log,
  }: {
    client?: ReturnType<typeof httpCanaryClient> | null;
    notConfigured?: string;
    hash?: string | null;
    canaryAlarm?: typeof alarm;
    canaryLog?: Log;
  } = {}) =>
    createCanary({
      client,
      ...(notConfigured === undefined ? {} : { notConfigured }),
      store: canaryStore,
      credentialHash: hash,
      alarm: canaryAlarm,
      log: canaryLog,
      wait: waits.wait,
    });

  /** The canary walker's journeys, in the order stored. */
  const canaryJourneys = () =>
    store.journeys().filter(({ walkerId }) => walkerId === CANARY_WALKER_ID);

  /** The alerts of one journey. */
  const alertsOf = (journeyId: string) =>
    store.alerts().filter((alert) => alert.journeyId === journeyId);

  const self = {
    clock,
    store,
    people,
    log: recorded,
    beats,
    push,
    sms,
    smsAlarm,
    alarm,
    handed,
    sent,
    waits,
    running,
    credential,
    credentialHash,
    observations,
    storeCalls,
    api,
    appFetch,
    canaryStore,
    /** Replaces the worker's sweep with this one. */
    useSweep(stub: () => Promise<unknown>) {
      sweep = async () => {
        await stub();
        return { ok: true, opened: 0, escalated: 0, stuck: 0 };
      };
    },
    /** Runs `hook` at every 10 s boundary, after the loops, with the milliseconds since START. */
    everyInterval(hook: (at: number) => unknown) {
      hooks.push(hook);
    },
    /** Answers requests the interceptor answers; the API answers the rest. */
    intercept(interceptor: Interceptor) {
      interceptors.push(interceptor);
    },
    /** Answers this route with this, from now on. */
    answer(
      route: Route,
      answer: (request: Request, signal: AbortSignal | null) => Response | Promise<Response>,
    ) {
      interceptors.push((request, entry, signal) =>
        entry.route === route ? answer(request, signal) : undefined,
      );
    },
    /** Stubs one of the store's port methods as the API's journey module sees it. */
    stubApiStore<K extends keyof FakeJourneyStore>(name: K, stub: FakeJourneyStore[K]) {
      stubs[name] = stub;
    },
    /** From now on, the canary's reads fail as `fail` says, by their number, from 0. */
    failReads(fail: (index: number) => Error | null) {
      readFailure = fail;
    },
    /**
     * From now on, a canary read of a journey the store found is handed back as
     * none when `when` says so, by what it read and its number, from 0: a
     * store stub.
     */
    readsAsNone(when: (observation: CanaryObservation, index: number) => boolean) {
      readNone = when;
    },
    /** From now on, each canary read is handed back as `change` makes it: a store stub. */
    changeReads(change: (observation: CanaryObservation) => CanaryObservation) {
      readChange = change;
    },
    client: makeClient,
    canary: makeCanary,
    /** One run of the canary's task, driven to its end on the fake clock. */
    run(canary = makeCanary(), signal: AbortSignal = new AbortController().signal) {
      return waits.run(() => canary.run(signal));
    },
    /** Milliseconds since START, by the fake clock. */
    async elapsed(): Promise<number> {
      return (await clock.now()).getTime() - START.getTime();
    },
    canaryJourneys,
    /** The canary walker's one journey, which a test expects there to be. */
    onlyJourney() {
      const journeys = canaryJourneys();
      expect(journeys, 'the canary’s journeys').toHaveLength(1);
      const [journey] = journeys;
      if (journey === undefined) {
        throw new Error('expected one canary journey');
      }
      return journey;
    },
    alertsOf,
    messagesOf(journeyId: string) {
      const alertIds = alertsOf(journeyId).map(({ id }) => id);
      return store.outbox().filter(({ alertId }) => alertIds.includes(alertId));
    },
    /** Last contact of a journey, in milliseconds since START. */
    lastContactOf(journeyId: string): number {
      const at = store.lastHeartbeatAt(journeyId);
      expect(at, 'the journey’s last contact').not.toBeNull();
      return (at?.getTime() ?? Number.NaN) - START.getTime();
    },
    /** The canary's own lines. */
    canaryLines: () => recorded.events.filter(({ event }) => event.startsWith('canary_')),
    /** The canary_run lines. */
    runLines: () => recorded.events.filter(({ event }) => event === 'canary_run'),
    /** The requests sent to one route. */
    sentTo: (route: Route) => sent.filter((entry) => entry.route === route),
    /** The "I'm home" requests for one journey. */
    homesFor: (journeyId: string) =>
      sent.filter(
        ({ route, path }) => route === 'home' && path === apiPath(`journeys/${journeyId}/home`),
      ),
  };
  return self;
}

type World = ReturnType<typeof world>;

/** Milliseconds since START of a moment. */
const sinceStart = (moment: Date | null | undefined): number =>
  (moment?.getTime() ?? Number.NaN) - START.getTime();

/** Whether the port has answered a canary journey's lost-contact message, by the store's own record. */
const lostContactAnswered = (w: World): boolean =>
  w
    .canaryJourneys()
    .some((journey) =>
      w
        .messagesOf(journey.id)
        .some(
          ({ kind, sentAt, lastFailure }) =>
            kind === 'LOST_CONTACT' && (sentAt !== null || lastFailure !== null),
        ),
    );

/** An escalation stubbed to run at once: an SMS written for the canary's alert as soon as it opens. */
const escalatingAtOnce = (w: World) => {
  w.everyInterval(async () => {
    for (const journey of w.canaryJourneys()) {
      for (const alert of w.alertsOf(journey.id)) {
        const written = w.store
          .outbox()
          .some(({ alertId, kind }) => alertId === alert.id && kind === 'LOST_CONTACT_SMS');
        if (alert.state !== 'RESOLVED' && !written) {
          const now = await w.clock.now();
          w.store.seedMessage({
            alertId: alert.id,
            recipientId: CANARY_RESPONDER_ID,
            kind: 'LOST_CONTACT_SMS',
            createdAt: now,
            nextAttemptAt: now,
          });
        }
      }
    }
  });
};

/** A canary_run line as the run writes it. */
function runLine(fields: Partial<Extract<FakeLogEvent, { event: 'canary_run' }>>): unknown {
  return expect.objectContaining({ event: 'canary_run', ...fields });
}

describe('REL-10: the canary’s identities are the test kit’s', () => {
  test('REL-10-AC14: the domain’s three IDs are the ones the fake store registers, so these tests run the canary the fake knows', () => {
    expect({
      walkerId: CANARY_WALKER_ID,
      responderId: CANARY_RESPONDER_ID,
      deviceId: CANARY_DEVICE_ID,
    }).toEqual(CANARY_IDS);
  });
});

describe('REL-10: a healthy system', () => {
  test('REL-10-AC1: the canary starts one journey with its device’s credential naming its responder alone, beats once with no position and no battery level, sees the alert reach the push port in time, ends the journey, sees the stand-down answered, and reports ok once', async () => {
    const w = world();

    await expect(w.run()).resolves.toEqual({ outcome: 'ON_TIME' });

    // The start: one, through POST /v1/journeys, with the device's credential,
    // naming the responder alone, answered 201, and stored from the device.
    const journey = w.onlyJourney();
    const starts = w.sentTo('start');
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      origin: ORIGIN,
      authorization: `Bearer ${w.credential}`,
      status: 201,
    });
    expect(JSON.parse(starts[0]?.body ?? 'null')).toEqual({ responderIds: [CANARY_RESPONDER_ID] });
    expect(journey.responderIds).toEqual([CANARY_RESPONDER_ID]);
    expect(w.store.deviceOf(journey.id)).toBe(CANARY_DEVICE_ID);

    // One heartbeat, with no position and no battery level, which set last contact.
    const beats = w.sentTo('heartbeat');
    expect(beats).toHaveLength(1);
    expect(beats[0]?.status).toBe(200);
    expect(JSON.parse(beats[0]?.body ?? 'null')).toMatchObject({
      journeyId: journey.id,
      batteryLevel: null,
      position: null,
    });
    const stored = w.store.heartbeats().filter(({ journeyId }) => journeyId === journey.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.batteryLevel).toBeNull();
    expect(w.store.positions()).toEqual([]);
    const lastContact = w.lastContactOf(journey.id);
    expect(lastContact).toBe(sinceStart(stored[0]?.receivedAt));

    // The watchdog opened the alert no earlier than five minutes after last contact.
    const alerts = w.alertsOf(journey.id);
    expect(alerts).toHaveLength(1);
    const [alert] = alerts;
    const openedAfter = sinceStart(alert?.openedAt) - lastContact;
    expect(openedAfter).toBeGreaterThanOrEqual(FIVE_MINUTES);

    // The push port was handed the responder's lost-contact message for it,
    // with exactly an opaque ID, the recipient and the kind.
    const lostContact = w.messagesOf(journey.id).filter(({ kind }) => kind === 'LOST_CONTACT');
    expect(lostContact).toHaveLength(1);
    const handedLost = w.handed.filter(({ message }) => message.kind === 'LOST_CONTACT');
    expect(handedLost.length).toBeGreaterThanOrEqual(1);
    for (const { message } of handedLost) {
      expect(Object.keys(message).sort()).toEqual(['kind', 'messageId', 'recipientId']);
      expect(message).toEqual({
        messageId: lostContact[0]?.messageId,
        recipientId: CANARY_RESPONDER_ID,
        kind: 'LOST_CONTACT',
      });
    }

    // The run's verdict: the first read that saw the port's answer, within
    // five minutes and 60 s of last contact.
    const firstAnswered = w.observations.find((observation) => observation.lostContactAnswered);
    expect(firstAnswered).toBeDefined();
    const alertMs = sinceStart(firstAnswered?.now) - lastContact;
    expect(alertMs).toBeGreaterThanOrEqual(openedAfter);
    expect(alertMs).toBeLessThanOrEqual(DEADLINE);

    // "I'm home", once, answered 200: the journey ENDED HOME, the alert
    // RESOLVED HOME, and the responder's stand-down handed to the port within
    // 90 s of the resolution.
    const homes = w.homesFor(journey.id);
    expect(homes).toHaveLength(1);
    expect(homes[0]?.status).toBe(200);
    expect(homes[0]?.authorization).toBe(`Bearer ${w.credential}`);
    expect(w.store.journeys()[0]?.state).toBe('ENDED');
    expect(w.store.endOf(journey.id).endReason).toBe('HOME');
    const resolved = w.alertsOf(journey.id)[0];
    expect(resolved).toMatchObject({ state: 'RESOLVED', resolution: 'HOME' });
    const resolvedAt = sinceStart(resolved?.resolvedAt);
    const standDowns = w.handed.filter(
      ({ message }) => message.kind === 'HOME' && message.recipientId === CANARY_RESPONDER_ID,
    );
    expect(standDowns.length).toBeGreaterThanOrEqual(1);
    expect((standDowns[0]?.at ?? Number.NaN) - resolvedAt).toBeLessThanOrEqual(STAND_DOWN_LIMIT);
    expect(w.observations.some((observation) => observation.standDownAnswered)).toBe(true);

    // One ok, and one line saying so, with the two durations from last contact.
    expect(w.alarm.statuses).toEqual(['ok']);
    expect(w.runLines()).toEqual([
      {
        event: 'canary_run',
        outcome: 'ON_TIME',
        alertMs,
        openedAfterMs: openedAfter,
        status: null,
        code: null,
      },
    ]);
    expect(w.canaryLines()).toEqual(w.runLines());

    // Nothing reached the SMS port, and no message was written to the walker.
    expect(w.sms.messages).toEqual([]);
    expect(w.store.outbox().filter(({ recipientId }) => recipientId === CANARY_WALKER_ID)).toEqual(
      [],
    );
    expect(w.store.journeyMessages()).toEqual([]);
  });

  test('REL-10-AC1: the canary registers its rows before it starts, once per process: a second run on the same canary registers nothing again', async () => {
    const w = world();
    const canary = w.canary();

    await w.run(canary);
    await w.waits.advance(FIFTEEN_MINUTES - (await w.elapsed()));
    await w.run(canary);

    expect(w.storeCalls.filter((call) => call === 'registerCanary')).toEqual(['registerCanary']);
    expect(w.storeCalls[0]).toBe('registerCanary');
    expect(w.alarm.statuses).toEqual(['ok', 'ok']);
  });

  test('REL-10-AC1: a run whose registration failed registers again on the next run, and once it has succeeded, no more', async () => {
    const w = world();
    const canary = w.canary();
    w.store.failWith(databaseError('57P01'), 'registerCanary');

    await expect(w.run(canary)).resolves.toEqual({ outcome: 'REGISTER_FAILED' });
    w.store.recover();
    await w.waits.advance(FIFTEEN_MINUTES - (await w.elapsed()));
    await expect(w.run(canary)).resolves.toEqual({ outcome: 'ON_TIME' });
    await w.waits.advance(2 * FIFTEEN_MINUTES - (await w.elapsed()));
    await expect(w.run(canary)).resolves.toEqual({ outcome: 'ON_TIME' });

    expect(w.storeCalls.filter((call) => call === 'registerCanary')).toHaveLength(2);
    expect(w.alarm.statuses).toEqual(['failing', 'ok', 'ok']);
  });

  test('REL-10-AC1: the canary’s requests all go to its configured origin, and its credential is sent as a Bearer and nowhere else (PRIV-07)', async () => {
    const w = world();

    await w.run();

    expect(w.sent.map(({ route }) => route)).toEqual(['start', 'heartbeat', 'home']);
    for (const entry of w.sent) {
      expect(entry.origin).toBe(ORIGIN);
      expect(entry.authorization).toBe(`Bearer ${w.credential}`);
      expect(markersIn(`${entry.path} ${entry.body}`, [w.credential])).toEqual([]);
    }
  });
});

describe('REL-10: the canary keeps its reads few', () => {
  // The spec: silence until just before an alert could open, then a read
  // every 2 s from 290 s. On a Nano instance (D-077) each read is load, so a
  // canary that read from the beat on, or looked early, is wrong though it
  // would pass every outcome test.
  test('REL-10-AC5: after its first read, straight after the beat, the canary reads nothing until last contact + 290 s, then every 2 s until the read that sees the alert answered', async () => {
    const w = world();

    await expect(w.run()).resolves.toEqual({ outcome: 'ON_TIME' });

    const watching = w.observations.filter(({ journey }) => journey.state !== 'ENDED');
    const lastContact = watching[0]?.journey.lastHeartbeatAt?.getTime() ?? Number.NaN;
    const since = watching.map(({ now }) => now.getTime() - lastContact);
    const answeredAt = watching.findIndex(({ lostContactAnswered }) => lostContactAnswered);

    expect(since[0], 'the first read, after the beat').toBe(0);
    expect(since[1], 'the first look').toBe(FIRST_LOOK);
    expect(answeredAt, 'the read that saw the alert answered').toBe(watching.length - 1);
    expect(answeredAt).toBeGreaterThan(1);
    expect(since.slice(2), 'the reads after the first look').toEqual(
      since.slice(1, -1).map((at) => at + POLL),
    );
    expect(since.at(-1)).toBeLessThanOrEqual(DEADLINE);
  });
});

describe('REL-10: the watchdog does not open the alert', () => {
  test.each([
    { what: 'the sweep loop not running', stop: (w: World) => (w.running.sweep = false) },
    {
      what: 'every sweep failing',
      stop: (w: World) => {
        w.store.failWith(databaseError('57P01'), 'overdueJourneys');
      },
    },
  ])(
    'REL-10-AC2: with $what, the canary stops at its first read past last contact + 360 s, ends the journey, reports failing once, and says NOT_OPENED',
    async ({ stop }) => {
      const w = world();
      stop(w);

      await expect(w.run()).resolves.toEqual({ outcome: 'NOT_OPENED' });

      const journey = w.onlyJourney();
      const lastContact = w.lastContactOf(journey.id);
      expect(w.alertsOf(journey.id)).toEqual([]);
      const homes = w.homesFor(journey.id);
      expect(homes).toHaveLength(1);
      expect(homes[0]?.status).toBe(200);
      expect(w.store.endOf(journey.id).endReason).toBe('HOME');
      expect(w.store.journeys()[0]?.state).toBe('ENDED');

      // It stopped at its first read past the deadline: no read after the
      // deadline came before that one, and it was at most one poll past it.
      const before = w.observations
        .slice(0, homes[0]?.readsBefore ?? 0)
        .map((observation) => sinceStart(observation.now) - lastContact);
      const past = before.filter((at) => at > DEADLINE);
      expect(past).toHaveLength(1);
      expect(past[0]).toBeLessThanOrEqual(DEADLINE + POLL);
      // And the run was over no later than that read and the request.
      expect((await w.elapsed()) - lastContact).toBeLessThanOrEqual(DEADLINE + POLL);

      expect(w.alarm.statuses).toEqual(['failing']);
      expect(w.runLines()).toEqual([
        {
          event: 'canary_run',
          outcome: 'NOT_OPENED',
          alertMs: null,
          openedAfterMs: null,
          status: null,
          code: null,
        },
      ]);
    },
  );
});

describe('REL-10: the answer’s time is the read that first saw it, not the opening', () => {
  // REL-10 review loop 2 (test-auditor, its fault R3): in a healthy run the
  // alert opens, the port answers and the canary reads at the same moment, so
  // the answer's time and the opening's cannot be told apart there. Here the
  // port answers later than the opening. alertMs is the hand-over (what
  // AC19's owner reads), and an answer first seen past the deadline fails,
  // whenever the alert opened (approach item 6: never pass late).

  test('REL-10-AC1: with delivery held off until 330 s, the alert opens at 300 s and the answer comes later: the run is ON_TIME with openedAfterMs 300 000 and alertMs the now() of the first read that saw the answer, past the opening', async () => {
    const w = world();
    w.running.deliver = false;
    w.everyInterval((at) => {
      if (at >= 330 * SECOND) {
        w.running.deliver = true;
      }
    });

    await expect(w.run()).resolves.toEqual({ outcome: 'ON_TIME' });

    const lastContact = w.observations[0]?.journey.lastHeartbeatAt?.getTime() ?? Number.NaN;
    const firstAnswered = w.observations.find(({ lostContactAnswered }) => lostContactAnswered);
    const answeredAfter = (firstAnswered?.now.getTime() ?? Number.NaN) - lastContact;
    expect(answeredAfter, 'the first read that saw the answer').toBeGreaterThan(FIVE_MINUTES);
    expect(answeredAfter).toBeLessThanOrEqual(DEADLINE);
    expect(w.runLines()).toEqual([
      runLine({
        outcome: 'ON_TIME',
        alertMs: answeredAfter,
        openedAfterMs: FIVE_MINUTES,
        status: null,
        code: null,
      }),
    ]);
    expect(w.alarm.statuses).toEqual(['ok']);
  });

  test('REL-10-AC3: an answer the port gives at 361 s, first seen by the read at 362 s, past the 360 s deadline, is NOT_HANDED_OVER though the alert opened in time: never passed late', async () => {
    const w = world();
    w.push.holdAnswers();
    // The port answers 361 s after the start, which is last contact: after
    // the read at 360 s, before the one at 362 s.
    void w.waits.wait(DEADLINE + SECOND, new AbortController().signal).then(() => {
      w.push.releaseAnswers();
    });

    await expect(w.run()).resolves.toEqual({ outcome: 'NOT_HANDED_OVER' });

    const lastContact = w.observations[0]?.journey.lastHeartbeatAt?.getTime() ?? Number.NaN;
    expect(lastContact).toBe(START.getTime());
    const watching = w.observations.filter(({ journey }) => journey.state !== 'ENDED');
    const firstAnswered = watching.find(({ lostContactAnswered }) => lostContactAnswered);
    expect(
      (firstAnswered?.now.getTime() ?? Number.NaN) - lastContact,
      'the first read that saw the answer',
    ).toBe(DEADLINE + POLL);
    expect(firstAnswered).toBe(watching.at(-1));
    expect(w.runLines()).toEqual([
      runLine({
        outcome: 'NOT_HANDED_OVER',
        alertMs: null,
        openedAfterMs: FIVE_MINUTES,
        status: null,
        code: null,
      }),
    ]);
    expect(w.alarm.statuses).toEqual(['failing']);
    expect(w.homesFor(w.onlyJourney().id)).toHaveLength(1);
  });
});

describe('REL-10: the alert opens but never reaches the push port', () => {
  test.each([
    { what: 'the delivery loop not running', stop: (w: World) => (w.running.deliver = false) },
    {
      what: 'the push port holding every answer',
      stop: (w: World) => {
        w.push.holdAnswers();
      },
    },
    {
      what: 'the claim failing every time',
      stop: (w: World) => {
        w.store.failWith(databaseError('40001'), 'claimDue');
      },
    },
  ])(
    'REL-10-AC3: with $what, the alert opens, the canary sees no answer by last contact + 360 s, ends the journey, withdrawing the unsent lost-contact message, reports failing once, and says NOT_HANDED_OVER with the opening’s duration',
    async ({ stop }) => {
      const w = world();
      stop(w);

      await expect(w.run()).resolves.toEqual({ outcome: 'NOT_HANDED_OVER' });

      const journey = w.onlyJourney();
      const lastContact = w.lastContactOf(journey.id);
      const [alert] = w.alertsOf(journey.id);
      expect(alert).toMatchObject({ state: 'RESOLVED', resolution: 'HOME' });
      const openedAfter = sinceStart(alert?.openedAt) - lastContact;
      expect(openedAfter).toBeGreaterThanOrEqual(FIVE_MINUTES);
      expect(w.observations.some((observation) => observation.lostContactAnswered)).toBe(false);
      expect(w.homesFor(journey.id)).toHaveLength(1);
      expect(w.store.endOf(journey.id).endReason).toBe('HOME');
      const lostContact = w.messagesOf(journey.id).filter(({ kind }) => kind === 'LOST_CONTACT');
      expect(lostContact).toHaveLength(1);
      expect(lostContact[0]?.sentAt).toBeNull();
      expect(lostContact[0]?.withdrawnAt).not.toBeNull();

      expect(w.alarm.statuses).toEqual(['failing']);
      expect(w.runLines()).toEqual([
        {
          event: 'canary_run',
          outcome: 'NOT_HANDED_OVER',
          alertMs: null,
          openedAfterMs: openedAfter,
          status: null,
          code: null,
        },
      ]);
    },
  );
});

describe('REL-10: an alert that opens early', () => {
  /** A stub watchdog, as the sweep tests stub the store: it opens any overdue journey's alert after `afterMs`. */
  const openingAfter = (w: World, afterMs: number) => async () => {
    const { journeys } = await w.store.overdueJourneys(afterMs);
    for (const { id } of journeys) {
      await w.store.openLostContactAlert({ journeyId: id, afterMs });
    }
  };

  test('REL-10-AC4: an alert opened at last contact + 4 minutes is a failure of its own: at its first look the canary ends the journey, reports failing once, and says OPENED_EARLY with the opening’s duration', async () => {
    const w = world();
    w.useSweep(openingAfter(w, 4 * MINUTE));

    await expect(w.run()).resolves.toEqual({ outcome: 'OPENED_EARLY' });

    const journey = w.onlyJourney();
    const lastContact = w.lastContactOf(journey.id);
    const [alert] = w.alertsOf(journey.id);
    expect(sinceStart(alert?.openedAt) - lastContact).toBe(4 * MINUTE);
    const homes = w.homesFor(journey.id);
    expect(homes).toHaveLength(1);
    // At its first look: before five minutes after last contact, with no poll on.
    expect((homes[0]?.at ?? Number.NaN) - lastContact).toBeLessThan(FIVE_MINUTES);
    expect(w.store.endOf(journey.id).endReason).toBe('HOME');
    expect(w.alarm.statuses).toEqual(['failing']);
    expect(w.runLines()).toEqual([
      {
        event: 'canary_run',
        outcome: 'OPENED_EARLY',
        alertMs: null,
        openedAfterMs: 4 * MINUTE,
        status: null,
        code: null,
      },
    ]);
  });

  test('REL-10-AC4: an alert opened at exactly last contact + 300 000 ms is not early: the run is on time', async () => {
    const w = world();
    w.useSweep(openingAfter(w, FIVE_MINUTES));

    await expect(w.run()).resolves.toEqual({ outcome: 'ON_TIME' });

    const journey = w.onlyJourney();
    const [alert] = w.alertsOf(journey.id);
    expect(sinceStart(alert?.openedAt) - w.lastContactOf(journey.id)).toBe(FIVE_MINUTES);
    expect(w.alarm.statuses).toEqual(['ok']);
    expect(w.runLines()).toEqual([runLine({ outcome: 'ON_TIME', openedAfterMs: FIVE_MINUTES })]);
  });
});

/** A JSON answer of this status. */
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** An error answer in the API's shape, with this status and code. */
const refusal = (status: number, code: string) =>
  json(status, { defined: true, code, status, message: code });

/**
 * A fetch that never answers, and gives up, as Node's does, only when its
 * signal aborts. It listens to the signal the client handed its fetch, not
 * the Request's own: that one follows the client's only through a weak
 * reference, so a Request collected as garbage would leave this waiting for
 * an abort that never comes.
 */
const neverAnswered = (request: Request, signal: AbortSignal | null) =>
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

describe('REL-10: every step fails loudly, and the journey is still ended', () => {
  /** What one failing step comes to: the outcome, the status and the SQLSTATE on its line, and whether a journey was started. */
  interface Failing {
    what: string;
    arrange: (w: World) => void;
    outcome: string;
    status: number | null | 'any';
    code: string | null;
    started: boolean;
    client?: (w: World) => ReturnType<typeof httpCanaryClient>;
  }

  const FAILURES: Failing[] = [
    {
      what: 'the start answered 401, the API’s own answer to a credential no device has',
      arrange: () => undefined,
      client: (w) => w.client({ credential: syntheticCredential() }),
      outcome: 'START_FAILED',
      status: 401,
      code: null,
      started: false,
    },
    {
      what: 'the start answered 422',
      arrange: (w) => {
        w.answer('start', () => refusal(422, 'INVALID_RESPONDER'));
      },
      outcome: 'START_FAILED',
      status: 422,
      code: null,
      started: false,
    },
    {
      what: 'the start answered 500',
      arrange: (w) => {
        w.answer('start', () => refusal(500, 'INTERNAL_SERVER_ERROR'));
      },
      outcome: 'START_FAILED',
      status: 500,
      code: null,
      started: false,
    },
    {
      what: 'the start answered 302',
      arrange: (w) => {
        w.answer(
          'start',
          () =>
            new Response(null, { status: 302, headers: { location: `${ORIGIN}/v1/elsewhere` } }),
        );
      },
      outcome: 'START_FAILED',
      status: 302,
      code: null,
      started: false,
    },
    {
      what: 'the start answered 201 with a body the contract refuses',
      arrange: (w) => {
        w.answer('start', () =>
          json(201, { journeyId: 'not-a-uuid', state: 'ACTIVE', startedAt: START.toISOString() }),
        );
      },
      outcome: 'START_FAILED',
      status: 201,
      code: null,
      started: false,
    },
    {
      what: 'the start failing on the network',
      arrange: (w) => {
        w.answer('start', () => Promise.reject(new TypeError('fetch failed')));
      },
      outcome: 'START_FAILED',
      status: null,
      code: null,
      started: false,
    },
    {
      // At L6 the client's own 10 s timeout is not waited for on a real
      // clock: its fetch fails as Node's does when that timeout fires.
      // adapters/canary.test.ts holds the timeout itself.
      what: 'the start not answered within 10 s',
      arrange: (w) => {
        w.answer('start', () =>
          Promise.reject(
            new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
          ),
        );
      },
      outcome: 'START_FAILED',
      status: null,
      code: null,
      started: false,
    },
    {
      what: 'the heartbeat answered 500',
      arrange: (w) => {
        w.answer('heartbeat', () => refusal(500, 'INTERNAL_SERVER_ERROR'));
      },
      outcome: 'HEARTBEAT_FAILED',
      status: 500,
      code: null,
      started: true,
    },
    {
      what: 'the heartbeat answered 200 with last_heartbeat_at left null (a store stub)',
      arrange: (w) => {
        w.stubApiStore('recordHeartbeat', () => Promise.resolve({ outcome: 'recorded' as const }));
      },
      outcome: 'HEARTBEAT_FAILED',
      status: 'any',
      code: null,
      started: true,
    },
    {
      what: '"I’m home" answered 500',
      arrange: (w) => {
        w.answer('home', () => refusal(500, 'INTERNAL_SERVER_ERROR'));
      },
      outcome: 'HOME_FAILED',
      status: 500,
      code: null,
      started: true,
    },
    {
      what: '"I’m home" answered 409',
      arrange: (w) => {
        w.answer('home', () => refusal(409, 'JOURNEY_ENDED'));
      },
      outcome: 'HOME_FAILED',
      status: 409,
      code: null,
      started: true,
    },
    {
      what: 'the journey not ENDED HOME after "I’m home" (a store stub)',
      arrange: (w) => {
        w.stubApiStore('recordHome', () =>
          Promise.resolve({
            outcome: 'home' as const,
            from: 'LOST_CONTACT' as const,
            alertId: null,
            messages: [],
          }),
        );
      },
      outcome: 'NOT_RESOLVED',
      status: null,
      code: null,
      started: true,
    },
    {
      what: 'the alert not RESOLVED HOME after "I’m home" (a store stub)',
      arrange: (w) => {
        w.changeReads((observation) =>
          observation.journey.state === 'ENDED' && observation.alert !== null
            ? {
                ...observation,
                alert: { ...observation.alert, state: 'OPEN', resolution: null, resolvedAt: null },
              }
            : observation,
        );
      },
      outcome: 'NOT_RESOLVED',
      status: null,
      code: null,
      started: true,
    },
    {
      what: 'the responder’s stand-down never answered, the push port holding answers after the alert',
      arrange: (w) => {
        w.everyInterval(() => {
          if (lostContactAnswered(w)) {
            w.push.holdAnswers();
          }
        });
      },
      outcome: 'STAND_DOWN_NOT_HANDED_OVER',
      status: null,
      code: null,
      started: true,
    },
    {
      what: 'the first read failing with a SQLSTATE',
      arrange: (w) => {
        w.failReads((index) => (index === 0 ? databaseError('57P01') : null));
      },
      outcome: 'READ_FAILED',
      status: null,
      code: '57P01',
      started: true,
    },
    {
      what: 'a read failing with a SQLSTATE while it watches',
      arrange: (w) => {
        w.failReads((index) => (index === 2 ? databaseError('08006') : null));
      },
      outcome: 'READ_FAILED',
      status: null,
      code: '08006',
      started: true,
    },
    {
      what: 'the read after "I’m home" failing with a SQLSTATE',
      arrange: (w) => {
        w.failReads(() => (w.sentTo('home').length > 0 ? databaseError('40001') : null));
      },
      outcome: 'READ_FAILED',
      status: null,
      code: '40001',
      started: true,
    },
    {
      what: 'the registration failing with a SQLSTATE',
      arrange: (w) => {
        w.store.failWith(databaseError('57P01'), 'registerCanary');
      },
      outcome: 'REGISTER_FAILED',
      status: null,
      code: '57P01',
      started: false,
    },
  ];

  test.each(FAILURES)(
    'REL-10-AC6: with $what, the outcome is $outcome, the alarm gets exactly one failing, the line carries the status or the SQLSTATE, and a journey started is ended once',
    async ({ arrange, client, outcome, status, code, started }) => {
      const w = world();
      arrange(w);

      await expect(
        w.run(w.canary(client === undefined ? {} : { client: client(w) })),
      ).resolves.toEqual({
        outcome,
      });

      expect(w.alarm.statuses).toEqual(['failing']);
      const lines = w.runLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ event: 'canary_run', outcome, code });
      if (status !== 'any') {
        expect(lines[0]).toMatchObject({ status });
      }
      const journeys = w.canaryJourneys();
      if (started) {
        expect(journeys).toHaveLength(1);
        expect(w.homesFor(journeys[0]?.id ?? '')).toHaveLength(1);
      } else {
        expect(w.sentTo('home')).toEqual([]);
        expect(journeys).toEqual([]);
      }
    },
  );

  // The store's read of the run's own journey handed back as none, as for a
  // journey that is not the canary walker's (AC11): the run cannot see its
  // journey, so it cannot say the alert came. A failed read with nothing to
  // name, READ_FAILED with no SQLSTATE, and the journey still ended, once.
  test.each<{ what: string; when: (observation: CanaryObservation, index: number) => boolean }>([
    { what: 'the first read, after the beat', when: (_seen, index) => index === 0 },
    { what: 'the first look', when: (_seen, index) => index === 1 },
    { what: 'a read while it watches', when: (_seen, index) => index === 2 },
    {
      what: 'the read after "I’m home"',
      when: (seen) => seen.journey.state === 'ENDED',
    },
  ])(
    'REL-10-AC6: with $what of its own journey handed back as none, the outcome is READ_FAILED with no status and no SQLSTATE, the alarm gets one failing, and the journey is still ended HOME, once',
    async ({ when }) => {
      const w = world();
      let asNone = 0;
      w.readsAsNone((seen, index) => {
        const none = when(seen, index);
        asNone += none ? 1 : 0;
        return none;
      });

      await expect(w.run()).resolves.toEqual({ outcome: 'READ_FAILED' });

      expect(asNone, 'reads handed back as none').toBe(1);
      expect(w.runLines()).toEqual([
        runLine({
          outcome: 'READ_FAILED',
          alertMs: null,
          openedAfterMs: null,
          status: null,
          code: null,
        }),
      ]);
      expect(w.alarm.statuses).toEqual(['failing']);
      const journey = w.onlyJourney();
      expect(w.homesFor(journey.id).map(({ status }) => status)).toEqual([200]);
      expect(w.store.endOf(journey.id).endReason).toBe('HOME');
    },
  );

  test('REL-10-AC6: a read of its own journey handed back as none while it waits for the stand-down is READ_FAILED too, not a stand-down that never came', async () => {
    const w = world();
    let ended = 0;
    w.readsAsNone((seen) => {
      if (seen.journey.state !== 'ENDED') {
        return false;
      }
      ended += 1;
      // The first read after "I'm home" passes, unanswered; the next is none.
      return ended === 2;
    });

    await expect(w.run()).resolves.toEqual({ outcome: 'READ_FAILED' });

    expect(ended, 'reads of the ended journey').toBe(2);
    // The read before the one handed back as none: the journey ended, the stand-down not yet answered.
    expect(w.observations.at(-2)).toMatchObject({
      journey: { state: 'ENDED' },
      standDownAnswered: false,
    });
    expect(w.runLines()).toEqual([runLine({ outcome: 'READ_FAILED', status: null, code: null })]);
    expect(w.alarm.statuses).toEqual(['failing']);
    expect(w.homesFor(w.onlyJourney().id)).toHaveLength(1);
  });

  test('REL-10-AC6: a run that fails to register starts nothing: no request reaches the API', async () => {
    const w = world();
    w.store.failWith(databaseError('57P01'), 'registerCanary');

    await w.run();

    expect(w.sent).toEqual([]);
  });

  // After "I'm home": each thing the run checks, wrong on its own while every
  // other is as it must be (a store stub on the reads after the journey
  // ended), so a check dropped from the list is found on its own. A canary
  // whose "I'm home" stopped ending journeys, or resolving their alerts, must
  // page.
  test.each<{ what: string; change: (seen: CanaryObservation) => CanaryObservation }>([
    {
      what: 'the journey not ENDED, its reason HOME',
      change: (seen) => ({ ...seen, journey: { ...seen.journey, state: 'LOST_CONTACT' } }),
    },
    {
      what: 'the journey ENDED for another reason, SAFE',
      change: (seen) => ({ ...seen, journey: { ...seen.journey, endReason: 'SAFE' } }),
    },
    {
      what: 'the alert not RESOLVED, its resolution HOME',
      change: (seen) => ({
        ...seen,
        alert: seen.alert === null ? null : { ...seen.alert, state: 'ACKNOWLEDGED' },
      }),
    },
    {
      what: 'no alert at all',
      change: (seen) => ({ ...seen, alert: null }),
    },
    {
      what: 'the alert RESOLVED for another reason, SAFE',
      change: (seen) => ({
        ...seen,
        alert: seen.alert === null ? null : { ...seen.alert, resolution: 'SAFE' },
      }),
    },
    {
      what: 'the alert RESOLVED HOME with no time of resolution',
      change: (seen) => ({
        ...seen,
        alert: seen.alert === null ? null : { ...seen.alert, resolvedAt: null },
      }),
    },
  ])(
    'REL-10-AC6: with $what after "I’m home" answered, the outcome is NOT_RESOLVED, reported failing once, and the journey was ended once',
    async ({ change }) => {
      const w = world();
      let changed = 0;
      w.changeReads((seen) => {
        if (seen.journey.state !== 'ENDED') {
          return seen;
        }
        // The read as the store gave it is right in every way the run checks;
        // only the one change makes it wrong.
        expect(seen.journey.endReason).toBe('HOME');
        expect(seen.alert).toMatchObject({ state: 'RESOLVED', resolution: 'HOME' });
        expect(seen.alert?.resolvedAt).toBeInstanceOf(Date);
        changed += 1;
        return change(seen);
      });

      await expect(w.run()).resolves.toEqual({ outcome: 'NOT_RESOLVED' });

      expect(changed, 'reads after the journey ended').toBe(1);
      expect(w.runLines()).toEqual([
        runLine({
          outcome: 'NOT_RESOLVED',
          alertMs: null,
          openedAfterMs: null,
          status: null,
          code: null,
        }),
      ]);
      expect(w.alarm.statuses).toEqual(['failing']);
      expect(w.homesFor(w.onlyJourney().id).map(({ status }) => status)).toEqual([200]);
    },
  );

  // The stand-down's limit, 90 s after the alert's resolution by the
  // database's clock: a stand-down first seen at exactly the limit is in
  // time; one ms later it is not, though it was answered ("fail early, never
  // pass late"). The second read after "I'm home" is stubbed to that moment.
  test.each([
    { after: STAND_DOWN_LIMIT, outcome: 'ON_TIME' as const, alarm: 'ok' },
    {
      after: STAND_DOWN_LIMIT + 1,
      outcome: 'STAND_DOWN_NOT_HANDED_OVER' as const,
      alarm: 'failing',
    },
  ])(
    'REL-10-AC6: a stand-down first seen answered $after ms after the alert’s resolution comes to $outcome',
    async ({ after, outcome, alarm }) => {
      const w = world();
      let ended = 0;
      w.changeReads((seen) => {
        if (seen.journey.state !== 'ENDED') {
          return seen;
        }
        ended += 1;
        const resolvedAt = seen.alert?.resolvedAt?.getTime() ?? Number.NaN;
        return ended === 1
          ? { ...seen, standDownAnswered: false }
          : { ...seen, now: new Date(resolvedAt + after), standDownAnswered: true };
      });

      await expect(w.run()).resolves.toEqual({ outcome });

      expect(ended, 'reads after the journey ended').toBe(2);
      expect(w.alarm.statuses).toEqual([alarm]);
      expect(w.runLines()).toEqual([runLine({ outcome })]);
    },
  );

  test('REL-10-AC6: the stand-down’s wait ends 90 s after the alert’s resolution, at most one poll on, and then the run is over', async () => {
    const w = world();
    w.everyInterval(() => {
      if (lostContactAnswered(w)) {
        w.push.holdAnswers();
      }
    });

    await w.run();

    const journey = w.onlyJourney();
    const resolvedAt = sinceStart(w.alertsOf(journey.id)[0]?.resolvedAt);
    expect((await w.elapsed()) - resolvedAt).toBeGreaterThanOrEqual(STAND_DOWN_LIMIT);
    expect((await w.elapsed()) - resolvedAt).toBeLessThanOrEqual(STAND_DOWN_LIMIT + POLL);
  });

  test.each([
    {
      what: 'the heartbeat and "I’m home" both answered 500: HEARTBEAT_FAILED',
      arrange: (w: World) => {
        w.answer('heartbeat', () => refusal(500, 'INTERNAL_SERVER_ERROR'));
        w.answer('home', () => refusal(500, 'INTERNAL_SERVER_ERROR'));
      },
      outcome: 'HEARTBEAT_FAILED' as const,
    },
    {
      what: 'no hand-over and "I’m home" answered 409: NOT_HANDED_OVER',
      arrange: (w: World) => {
        w.running.deliver = false;
        w.answer('home', () => refusal(409, 'JOURNEY_ENDED'));
      },
      outcome: 'NOT_HANDED_OVER' as const,
    },
    {
      what: 'no alert and the read after "I’m home" failing: NOT_OPENED',
      arrange: (w: World) => {
        w.running.sweep = false;
        w.failReads(() => (w.sentTo('home').length > 0 ? databaseError('40001') : null));
      },
      outcome: 'NOT_OPENED' as const,
    },
    {
      what: 'no hand-over and the journey not ENDED HOME after "I’m home": NOT_HANDED_OVER',
      arrange: (w: World) => {
        w.running.deliver = false;
        w.stubApiStore('recordHome', () =>
          Promise.resolve({
            outcome: 'home' as const,
            from: 'LOST_CONTACT' as const,
            alertId: null,
            messages: [],
          }),
        );
      },
      outcome: 'NOT_HANDED_OVER' as const,
    },
    {
      what: 'the push port holding every answer and "I’m home" answered 500: NOT_HANDED_OVER',
      arrange: (w: World) => {
        w.answer('home', () => refusal(500, 'INTERNAL_SERVER_ERROR'));
        w.push.holdAnswers();
      },
      outcome: 'NOT_HANDED_OVER' as const,
    },
    {
      what: '"I’m home" answered 500 and the stand-down never answered: HOME_FAILED',
      arrange: (w: World) => {
        w.answer('home', () => refusal(500, 'INTERNAL_SERVER_ERROR'));
        w.everyInterval(() => {
          if (lostContactAnswered(w)) {
            w.push.holdAnswers();
          }
        });
      },
      outcome: 'HOME_FAILED' as const,
    },
    {
      what: 'an escalation and the stand-down never answered: ESCALATED',
      arrange: (w: World) => {
        escalatingAtOnce(w);
        w.everyInterval(() => {
          if (lostContactAnswered(w)) {
            w.push.holdAnswers();
          }
        });
      },
      outcome: 'ESCALATED' as const,
    },
  ])(
    'REL-10-AC6: when two steps fail, the outcome is the earlier one: $what',
    async ({ arrange, outcome }) => {
      const w = world();
      arrange(w);

      await expect(w.run()).resolves.toEqual({ outcome });

      expect(w.alarm.statuses).toEqual(['failing']);
      expect(w.runLines()).toEqual([runLine({ outcome })]);
      expect(w.homesFor(w.onlyJourney().id)).toHaveLength(1);
    },
  );
});

describe('REL-10: the canary never escalates, and never pages through the SMS check', () => {
  test('REL-10-AC7: run every 15 minutes for 24 hours of the clock, all 96 runs are on time, no escalation SMS is written, every journey ends HOME before its alert could escalate, the SMS check reports ok every minute, the 24-hour end touches nothing, and nothing personal reaches a port (AC14)', async () => {
    const w = world();
    const canary = w.canary();
    const outcomes: unknown[] = [];

    for (let slot = 0; slot < 96; slot += 1) {
      await w.waits.advance(slot * FIFTEEN_MINUTES - (await w.elapsed()));
      outcomes.push(await w.run(canary));
    }
    await w.waits.advance(24 * HOUR - (await w.elapsed()));

    expect(outcomes).toEqual(Array.from({ length: 96 }, () => ({ outcome: 'ON_TIME' })));
    expect(w.alarm.statuses).toEqual(Array.from({ length: 96 }, () => 'ok'));
    expect(w.runLines()).toHaveLength(96);
    expect(w.runLines().every((line) => (line as { outcome: string }).outcome === 'ON_TIME')).toBe(
      true,
    );

    // No escalation SMS for any canary alert, and nothing reached the SMS port.
    const journeys = w.canaryJourneys();
    expect(journeys).toHaveLength(96);
    expect(w.store.outbox().filter(({ kind }) => kind === 'LOST_CONTACT_SMS')).toEqual([]);
    expect(w.sms.messages).toEqual([]);

    // Every journey ENDED HOME, before its alert's opening + two minutes.
    for (const journey of journeys) {
      const end = w.store.endOf(journey.id);
      expect(end.endReason, journey.id).toBe('HOME');
      const [alert] = w.alertsOf(journey.id);
      expect(alert, journey.id).toBeDefined();
      expect(sinceStart(end.endedAt), journey.id).toBeLessThan(
        sinceStart(alert?.openedAt) + TWO_MINUTES,
      );
      expect(alert?.smsRaisedAt, journey.id).toBeNull();
    }

    // The SMS check reported ok each minute of the 24 hours.
    expect(w.smsAlarm.statuses).toEqual(Array.from({ length: 24 * 60 }, () => 'ok'));

    // The 24-hour end touched no canary journey.
    expect(w.store.alerts().filter(({ resolution }) => resolution === 'EXPIRED')).toEqual([]);
    expect(w.store.outbox().filter(({ kind }) => kind === 'EXPIRED')).toEqual([]);

    // AC14: the responder has no device; the canary registered one device;
    // every message handed to a port carried exactly an ID, a recipient and a
    // kind; none was written to the walker; no position; no battery level.
    expect(w.store.devices()).toEqual([
      expect.objectContaining({ id: CANARY_DEVICE_ID, userId: CANARY_WALKER_ID }),
    ]);
    for (const { message } of w.handed) {
      expect(Object.keys(message).sort()).toEqual(['kind', 'messageId', 'recipientId']);
      expect(message.recipientId).toBe(CANARY_RESPONDER_ID);
      expect(message.messageId).toMatch(LOWER_UUID);
    }
    expect(w.store.outbox().filter(({ recipientId }) => recipientId === CANARY_WALKER_ID)).toEqual(
      [],
    );
    expect(w.store.journeyMessages()).toEqual([]);
    expect(w.store.positions()).toEqual([]);
    expect(w.store.heartbeats()).toHaveLength(96);
    expect(w.store.heartbeats().every(({ batteryLevel }) => batteryLevel === null)).toBe(true);
  }, 120_000);

  test('REL-10-AC7: when the alert escalates anyway, an escalation stubbed to run at once, the run’s outcome is ESCALATED', async () => {
    const w = world();
    escalatingAtOnce(w);

    await expect(w.run()).resolves.toEqual({ outcome: 'ESCALATED' });

    expect(w.alarm.statuses).toEqual(['failing']);
    expect(w.runLines()).toEqual([runLine({ outcome: 'ESCALATED', status: null, code: null })]);
    expect(w.homesFor(w.onlyJourney().id)).toHaveLength(1);
  });

  test('REL-10-AC7: an escalation does not stand in for an earlier failure: with no hand-over as well, the outcome is NOT_HANDED_OVER', async () => {
    const w = world();
    escalatingAtOnce(w);
    w.running.deliver = false;

    await expect(w.run()).resolves.toEqual({ outcome: 'NOT_HANDED_OVER' });
    expect(w.runLines()).toEqual([runLine({ outcome: 'NOT_HANDED_OVER' })]);
  });
});

describe('REL-10: leftovers and overlap', () => {
  /** The canary registered and a journey of its put in, started `startedAgo` before the clock's now, as an earlier process left it. */
  async function leftover(
    w: World,
    { startedAgo, state = 'ACTIVE' }: { startedAgo: number; state?: 'ACTIVE' | 'LOST_CONTACT' },
  ): Promise<string> {
    await w.store.registerCanary({ credentialHash: w.credentialHash });
    const now = (await w.clock.now()).getTime();
    return w.store.seed({
      walkerId: CANARY_WALKER_ID,
      deviceId: CANARY_DEVICE_ID,
      state,
      responderIds: [CANARY_RESPONDER_ID],
      startedAt: new Date(now - startedAgo),
      lastHeartbeatAt: new Date(now - startedAgo + 10 * SECOND),
    });
  }

  /** Fails the test the moment the canary's walker has two unended journeys. */
  const neverTwoUnended = (w: World) => {
    const check = () => {
      expect(
        w.canaryJourneys().filter(({ state }) => state !== 'ENDED').length,
        'the canary walker’s unended journeys',
      ).toBeLessThanOrEqual(1);
    };
    w.everyInterval(check);
    w.intercept(() => {
      check();
      return undefined;
    });
  };

  test('REL-10-AC8: an ACTIVE canary journey started exactly 10 minutes ago is a leftover: the start meets 409, the run ends it through "I’m home", writes one canary_leftover_ended line with its ID, starts again once, and runs as AC1', async () => {
    const w = world();
    const left = await leftover(w, { startedAgo: LEFTOVER_AFTER });
    neverTwoUnended(w);

    await expect(w.run()).resolves.toEqual({ outcome: 'ON_TIME' });

    expect(w.sentTo('start').map(({ status }) => status)).toEqual([409, 201]);
    expect(w.homesFor(left)).toHaveLength(1);
    expect(w.store.endOf(left).endReason).toBe('HOME');
    expect(w.log.events.filter(({ event }) => event === 'canary_leftover_ended')).toEqual([
      { event: 'canary_leftover_ended', journeyId: left },
    ]);
    const fresh = w.canaryJourneys().filter(({ id }) => id !== left);
    expect(fresh).toHaveLength(1);
    expect(w.store.endOf(fresh[0]?.id ?? '').endReason).toBe('HOME');
    expect(w.alarm.statuses).toEqual(['ok']);
    expect(w.runLines()).toEqual([runLine({ outcome: 'ON_TIME' })]);
  });

  test('REL-10-AC8: a LOST_CONTACT canary journey started long ago with its alert escalated is a leftover: it is ended through "I’m home", its unsent SMS withdrawn, and the run then goes as AC1', async () => {
    const w = world();
    const left = await leftover(w, { startedAgo: 40 * MINUTE, state: 'LOST_CONTACT' });
    const now = await w.clock.now();
    const openedAt = new Date(now.getTime() - 30 * MINUTE);
    const alertId = w.store.seedAlert({
      journeyId: left,
      state: 'ESCALATED',
      openedAt,
      silentSince: new Date(now.getTime() - 35 * MINUTE),
      smsRaisedAt: new Date(openedAt.getTime() + TWO_MINUTES),
    });
    const due = new Date(now.getTime() + 30 * SECOND);
    w.store.seedMessage({
      alertId,
      recipientId: CANARY_RESPONDER_ID,
      kind: 'LOST_CONTACT',
      createdAt: openedAt,
      nextAttemptAt: due,
      attempts: 5,
      lastFailure: 'NOT_CONFIGURED',
    });
    const smsId = w.store.seedMessage({
      alertId,
      recipientId: CANARY_RESPONDER_ID,
      kind: 'LOST_CONTACT_SMS',
      createdAt: new Date(openedAt.getTime() + TWO_MINUTES),
      nextAttemptAt: due,
      attempts: 5,
      lastFailure: 'NOT_CONFIGURED',
    });
    neverTwoUnended(w);

    await expect(w.run()).resolves.toEqual({ outcome: 'ON_TIME' });

    expect(w.homesFor(left)).toHaveLength(1);
    expect(w.store.endOf(left).endReason).toBe('HOME');
    expect(w.store.alerts().find(({ id }) => id === alertId)).toMatchObject({
      state: 'RESOLVED',
      resolution: 'HOME',
    });
    const sms = w.store.outbox().find(({ messageId }) => messageId === smsId);
    expect(sms?.sentAt).toBeNull();
    expect(sms?.withdrawnAt).not.toBeNull();
    expect(w.log.events.filter(({ event }) => event === 'canary_leftover_ended')).toEqual([
      { event: 'canary_leftover_ended', journeyId: left },
    ]);
    expect(w.alarm.statuses).toEqual(['ok']);
  });

  test('REL-10-AC8: a canary journey started under 10 minutes ago is a run in flight: this run writes one canary_skipped line, ends nothing, sends nothing more, and reports nothing', async () => {
    const w = world();
    const inFlight = await leftover(w, { startedAgo: LEFTOVER_AFTER - 1 });
    const before = w.store.journeys();

    await expect(w.run()).resolves.toEqual({ skipped: 'RUN_IN_FLIGHT' });

    expect(w.canaryLines()).toEqual([{ event: 'canary_skipped', reason: 'RUN_IN_FLIGHT' }]);
    expect(w.sent.map(({ route, status }) => [route, status])).toEqual([['start', 409]]);
    expect(w.store.journeys()).toEqual(before);
    expect(w.store.endOf(inFlight)).toEqual({ endedAt: null, endReason: null });
    expect(w.alarm.reports).toEqual([]);
  });

  test('REL-10-AC8: two runs started together on one store, as the old and the new worker in a deploy: exactly one runs a journey and reports, the other skips, and the walker never has two unended journeys', async () => {
    const w = world();
    neverTwoUnended(w);
    const [one, other] = [w.canary(), w.canary()];

    const results = await w.waits.run(() =>
      Promise.all([one.run(new AbortController().signal), other.run(new AbortController().signal)]),
    );

    expect(results).toEqual(
      expect.arrayContaining([{ outcome: 'ON_TIME' }, { skipped: 'RUN_IN_FLIGHT' }]),
    );
    expect(w.canaryJourneys()).toHaveLength(1);
    expect(w.alarm.statuses).toEqual(['ok']);
    expect(w.runLines()).toHaveLength(1);
    expect(w.log.events.filter(({ event }) => event === 'canary_skipped')).toHaveLength(1);
    expect(w.sentTo('home')).toHaveLength(1);
  });

  test('REL-10-AC8: a second 409 after ending a leftover is START_FAILED, and the journey that answered it, another run’s, is not cut off', async () => {
    const w = world();
    const left = await leftover(w, { startedAgo: LEFTOVER_AFTER });
    let other = null as string | null;
    w.intercept((_request, entry) => {
      if (entry.route === 'start' && w.sentTo('start').length === 2) {
        // Another run's start wins the race to the walker's one unended journey.
        other = w.store.seed({
          walkerId: CANARY_WALKER_ID,
          deviceId: CANARY_DEVICE_ID,
          state: 'ACTIVE',
          responderIds: [CANARY_RESPONDER_ID],
          startedAt: START,
        });
      }
      return undefined;
    });

    await expect(w.run()).resolves.toEqual({ outcome: 'START_FAILED' });

    expect(w.sentTo('start').map(({ status }) => status)).toEqual([409, 409]);
    expect(w.store.endOf(left).endReason).toBe('HOME');
    expect(other).not.toBeNull();
    expect(w.homesFor(other ?? '')).toEqual([]);
    expect(w.store.endOf(other ?? '')).toEqual({ endedAt: null, endReason: null });
    expect(w.alarm.statuses).toEqual(['failing']);
    expect(w.runLines()).toEqual([runLine({ outcome: 'START_FAILED', status: 409, code: null })]);
  });

  test('REL-10-AC8: a leftover that ended meanwhile, its "I’m home" answered 409 JOURNEY_ENDED by the API, is accepted: one canary_leftover_ended line, the run starts again once and runs as AC1', async () => {
    const w = world();
    const left = await leftover(w, { startedAgo: LEFTOVER_AFTER });
    neverTwoUnended(w);
    // The leftover ends between the canary's read of it and its "I'm home",
    // as when the run that left it ends it late: the same request reaches the
    // API first, so the API answers the canary's own with its 409.
    let endedMeanwhile = 0;
    w.intercept(async (request, entry) => {
      if (entry.route === 'home' && entry.path === apiPath(`journeys/${left}/home`)) {
        endedMeanwhile += 1;
        expect((await w.api.fetch(request.clone())).status, 'the leftover ended meanwhile').toBe(
          200,
        );
      }
      return undefined;
    });

    await expect(w.run()).resolves.toEqual({ outcome: 'ON_TIME' });

    expect(endedMeanwhile).toBe(1);
    expect(w.homesFor(left).map(({ status }) => status)).toEqual([409]);
    expect(w.store.endOf(left).endReason).toBe('HOME');
    expect(w.log.events.filter(({ event }) => event === 'canary_leftover_ended')).toEqual([
      { event: 'canary_leftover_ended', journeyId: left },
    ]);
    expect(w.sentTo('start').map(({ status }) => status)).toEqual([409, 201]);
    const fresh = w.canaryJourneys().filter(({ id }) => id !== left);
    expect(fresh).toHaveLength(1);
    expect(w.homesFor(fresh[0]?.id ?? '').map(({ status }) => status)).toEqual([200]);
    expect(w.store.endOf(fresh[0]?.id ?? '').endReason).toBe('HOME');
    expect(w.alarm.statuses).toEqual(['ok']);
    expect(w.runLines()).toEqual([runLine({ outcome: 'ON_TIME', status: null, code: null })]);
  });

  // The spec is silent on a leftover's "I'm home" failing other than with
  // 409. Ending the leftover is part of the start (spec item 7: it is ended
  // "before the run starts again"), so the run cannot start, and AC6's first
  // row applies: START_FAILED, carrying the status, reported failing. The
  // leftover is not claimed ended, and nothing is started beside it; the next
  // run's leftover rule tries again.
  test.each([
    {
      what: 'answered 500',
      answer: () => refusal(500, 'INTERNAL_SERVER_ERROR'),
      status: 500,
    },
    {
      what: 'answered 401',
      answer: () => refusal(401, 'UNAUTHORIZED'),
      status: 401,
    },
    {
      what: 'failing on the network',
      answer: () => Promise.reject(new TypeError('fetch failed')),
      status: null,
    },
  ])(
    'REL-10-AC8: a leftover whose "I’m home" is $what is not ended, and the run is START_FAILED with that status, reported failing once: no canary_leftover_ended line, no second start, no journey of its own',
    async ({ answer, status }) => {
      const w = world();
      const left = await leftover(w, { startedAgo: LEFTOVER_AFTER });
      w.intercept((_request, entry) =>
        entry.route === 'home' && entry.path === apiPath(`journeys/${left}/home`)
          ? answer()
          : undefined,
      );

      await expect(w.run()).resolves.toEqual({ outcome: 'START_FAILED' });

      expect(w.runLines()).toEqual([
        runLine({
          outcome: 'START_FAILED',
          alertMs: null,
          openedAfterMs: null,
          status,
          code: null,
        }),
      ]);
      expect(w.alarm.statuses).toEqual(['failing']);
      expect(w.log.events.filter(({ event }) => event === 'canary_leftover_ended')).toEqual([]);
      expect(w.sent.map(({ route, status: answered }) => [route, answered])).toEqual([
        ['start', 409],
        ['home', status],
      ]);
      expect(w.store.endOf(left)).toEqual({ endedAt: null, endReason: null });
      expect(w.canaryJourneys().map(({ id }) => id)).toEqual([left]);
    },
  );

  test('REL-10-AC6: when its read of the journey named by the start’s 409 fails with a SQLSTATE, the outcome is READ_FAILED with that SQLSTATE, reported failing once, and nothing is ended or started', async () => {
    const w = world();
    const left = await leftover(w, { startedAgo: LEFTOVER_AFTER });
    w.failReads((index) => (index === 0 ? databaseError('57P01') : null));

    await expect(w.run()).resolves.toEqual({ outcome: 'READ_FAILED' });

    expect(w.runLines()).toEqual([
      runLine({
        outcome: 'READ_FAILED',
        alertMs: null,
        openedAfterMs: null,
        status: null,
        code: '57P01',
      }),
    ]);
    expect(w.alarm.statuses).toEqual(['failing']);
    expect(w.sent.map(({ route, status }) => [route, status])).toEqual([['start', 409]]);
    expect(w.log.events.filter(({ event }) => event === 'canary_leftover_ended')).toEqual([]);
    expect(w.store.endOf(left)).toEqual({ endedAt: null, endReason: null });
    expect(w.canaryJourneys().map(({ id }) => id)).toEqual([left]);
  });
});

describe('REL-10: a run that fails in a way no step names is RUN_FAILED, and pages', () => {
  // REL-10 review loop 1 (code-reviewer should-fix 4; D-128's loop-1
  // amendment). An error that is neither a step's failure nor a halt is a
  // fault in the canary itself: the run ends as RUN_FAILED, reported failing
  // at once, with "I'm home" sent once for a journey it started, waited for
  // at most CANARY_STOP_LIMIT_MS, as at the run limit. RUN_LIMIT means the run
  // limit alone (its tests are in "a stop, or the run limit"), INTERRUPTED
  // the worker's stop alone. The client is the one place such an error can
  // come from without being a step's failure: the store's errors are read
  // failures, and the waits reject only when aborted. Nothing of the error
  // reaches a line (PRIV-07): the line has no field for it.

  /** A TypeError whose message holds the credential and words a log must never carry. */
  const faultOf = (w: World) =>
    new TypeError(
      `Cannot read properties of undefined (reading 'journeyId'): Bearer ${w.credential}`,
    );

  /** Every line written, as text, to look for the error in. */
  const everyLine = (w: World) => w.log.events.map((event) => JSON.stringify(event)).join('\n');

  test('REL-10-AC6: a client whose heartbeat throws a TypeError, after the journey started, ends the run as RUN_FAILED at once: reported failing once, its journey ended by one "I’m home", and nothing of the error in any line (PRIV-07)', async () => {
    const w = world();
    const fault = faultOf(w);
    const client = {
      ...w.client(),
      heartbeat: () => {
        throw fault;
      },
    };

    await expect(w.run(w.canary({ client }))).resolves.toEqual({ outcome: 'RUN_FAILED' });

    expect(w.runLines()).toEqual([
      {
        event: 'canary_run',
        outcome: 'RUN_FAILED',
        alertMs: null,
        openedAfterMs: null,
        status: null,
        code: null,
      },
    ]);
    expect(w.alarm.statuses).toEqual(['failing']);
    const journey = w.onlyJourney();
    expect(w.homesFor(journey.id).map(({ status }) => status)).toEqual([200]);
    expect(w.store.endOf(journey.id).endReason).toBe('HOME');
    expect(await w.elapsed(), 'no wait for the run limit').toBeLessThanOrEqual(STOP_LIMIT);
    expect(everyLine(w)).not.toContain(w.credential);
    expect(everyLine(w)).not.toContain('Cannot read');
    expect(everyLine(w)).not.toContain('TypeError');
  });

  test('REL-10-AC6: when its "I’m home" is never answered either, the RUN_FAILED run waits for it at most CANARY_STOP_LIMIT_MS, sends it once, and reports failing once', async () => {
    const w = world();
    const fault = faultOf(w);
    w.answer('home', neverAnswered);
    const client = {
      ...w.client({ timeoutMs: NO_TIMEOUT }),
      heartbeat: () => Promise.reject(fault),
    };

    await expect(w.run(w.canary({ client }))).resolves.toEqual({ outcome: 'RUN_FAILED' });

    expect(w.sentTo('home')).toHaveLength(1);
    expect(w.alarm.statuses).toEqual(['failing']);
    expect(w.runLines()).toEqual([runLine({ outcome: 'RUN_FAILED', status: null, code: null })]);
    const elapsed = await w.elapsed();
    expect(elapsed).toBeGreaterThanOrEqual(STOP_LIMIT);
    expect(elapsed).toBeLessThanOrEqual(STOP_LIMIT + POLL);
  });

  test('REL-10-AC6: a client whose start throws a TypeError comes to RUN_FAILED with no journey, so no "I’m home", reported failing once', async () => {
    const w = world();
    const fault = faultOf(w);
    const client = {
      ...w.client(),
      start: () => {
        throw fault;
      },
    };

    await expect(w.run(w.canary({ client }))).resolves.toEqual({ outcome: 'RUN_FAILED' });

    expect(w.sent).toEqual([]);
    expect(w.canaryJourneys()).toEqual([]);
    expect(w.alarm.statuses).toEqual(['failing']);
    expect(w.runLines()).toEqual([runLine({ outcome: 'RUN_FAILED', status: null, code: null })]);
    expect(everyLine(w)).not.toContain(w.credential);
  });

  // Found while writing the above: today a client whose "I'm home" rejects
  // makes the run itself reject, from the stop-limit race in its catch, so it
  // writes no canary_run line and reports nothing: silent until the check's
  // grace. The task never rejects (AC9), and a fault pages (RUN_FAILED).
  test('REL-10-AC9: a client whose "I’m home" rejects with a TypeError does not make the run reject: it comes to RUN_FAILED, with one line, reported failing once', async () => {
    const w = world();
    const fault = faultOf(w);
    const real = w.client();
    const client = {
      ...real,
      heartbeat: () => Promise.reject(fault),
      home: () => Promise.reject(fault),
    };

    await expect(w.run(w.canary({ client }))).resolves.toEqual({ outcome: 'RUN_FAILED' });

    expect(w.runLines()).toEqual([runLine({ outcome: 'RUN_FAILED', status: null, code: null })]);
    expect(w.alarm.statuses).toEqual(['failing']);
    expect(everyLine(w)).not.toContain(w.credential);
  });
});

describe('REL-10: a stop, or the run limit, ends the run quickly', () => {
  // The worker's task hands every run Graphile's signal, run after run, 96 a
  // day. A run that left its listener on that signal, or its run limit's
  // timer or its stop limit's still running, would leak one of each per run.
  test('REL-10-AC9: run after run on one stop signal, as the worker’s task, each run leaves no listener on that signal and no wait pending: on time, failing, and skipped alike', async () => {
    const w = world();
    const stop = new AbortController();
    const canary = w.canary();
    const listeners = () => getEventListeners(stop.signal, 'abort').length;
    expect(listeners()).toBe(0);

    const results = [];
    for (let run = 0; run < 3; run += 1) {
      results.push(await w.run(canary, stop.signal));
      expect(listeners(), `listeners after run ${String(run + 1)}`).toBe(0);
      expect(w.waits.pending, `waits pending after run ${String(run + 1)}`).toBe(0);
    }
    w.answer('start', () => refusal(500, 'INTERNAL_SERVER_ERROR'));
    results.push(await w.run(canary, stop.signal));
    expect(listeners(), 'listeners after a failing run').toBe(0);
    expect(w.waits.pending, 'waits pending after a failing run').toBe(0);

    expect(results).toEqual([
      { outcome: 'ON_TIME' },
      { outcome: 'ON_TIME' },
      { outcome: 'ON_TIME' },
      { outcome: 'START_FAILED' },
    ]);
  });

  test('REL-10-AC9: a run skipped for a run in flight leaves no listener on the stop signal and no wait pending', async () => {
    const w = world();
    const stop = new AbortController();
    const [one, other] = [w.canary(), w.canary()];

    const results = await w.waits.run(() =>
      Promise.all([one.run(stop.signal), other.run(stop.signal)]),
    );

    expect(results).toEqual(
      expect.arrayContaining([{ outcome: 'ON_TIME' }, { skipped: 'RUN_IN_FLIGHT' }]),
    );
    expect(getEventListeners(stop.signal, 'abort')).toEqual([]);
    expect(w.waits.pending).toBe(0);
  });

  test('REL-10-AC9: a stopped run whose "I’m home" is answered leaves no wait pending: neither its stop limit nor its run limit', async () => {
    const w = world();
    const stop = new AbortController();
    w.everyInterval((at) => {
      if (at === 100 * SECOND) {
        stop.abort();
      }
    });

    await expect(w.run(w.canary(), stop.signal)).resolves.toEqual({ outcome: 'INTERRUPTED' });

    expect(w.homesFor(w.onlyJourney().id).map(({ status }) => status)).toEqual([200]);
    expect(w.waits.pending).toBe(0);
  });

  test('REL-10-AC9: a run at its run limit whose "I’m home" is answered leaves no wait pending, and no listener on the stop signal', async () => {
    const w = world();
    const stop = new AbortController();
    w.answer('heartbeat', neverAnswered);

    await expect(
      w.run(w.canary({ client: w.client({ timeoutMs: NO_TIMEOUT }) }), stop.signal),
    ).resolves.toEqual({
      outcome: 'RUN_LIMIT',
    });

    expect(w.homesFor(w.onlyJourney().id).map(({ status }) => status)).toEqual([200]);
    expect(w.waits.pending).toBe(0);
    expect(getEventListeners(stop.signal, 'abort')).toEqual([]);
  });

  test('REL-10-AC9: a stop while the run waits for its alert sends "I’m home" once, writes INTERRUPTED, reports nothing, and the run is over within 5 s', async () => {
    const w = world();
    const stop = new AbortController();
    let stoppedAt = null as number | null;
    w.everyInterval((at) => {
      if (at >= 100 * SECOND && stoppedAt === null) {
        stoppedAt = at;
        stop.abort();
      }
    });

    await expect(w.run(w.canary(), stop.signal)).resolves.toEqual({ outcome: 'INTERRUPTED' });

    const journey = w.onlyJourney();
    expect(w.homesFor(journey.id)).toHaveLength(1);
    expect(w.store.endOf(journey.id).endReason).toBe('HOME');
    expect(w.alarm.reports).toEqual([]);
    expect(w.runLines()).toEqual([runLine({ outcome: 'INTERRUPTED' })]);
    expect((await w.elapsed()) - (stoppedAt ?? Number.NaN)).toBeLessThanOrEqual(STOP_LIMIT);
  });

  test('REL-10-AC9: a stop whose "I’m home" is never answered waits for it at most 5 s, then writes INTERRUPTED and reports nothing', async () => {
    const w = world();
    const stop = new AbortController();
    let stoppedAt = null as number | null;
    w.answer('home', neverAnswered);
    w.everyInterval((at) => {
      if (at >= 100 * SECOND && stoppedAt === null) {
        stoppedAt = at;
        stop.abort();
      }
    });

    await expect(
      w.run(w.canary({ client: w.client({ timeoutMs: NO_TIMEOUT }) }), stop.signal),
    ).resolves.toEqual({ outcome: 'INTERRUPTED' });

    expect(w.sentTo('home')).toHaveLength(1);
    expect(w.alarm.reports).toEqual([]);
    expect(w.runLines()).toEqual([runLine({ outcome: 'INTERRUPTED' })]);
    expect((await w.elapsed()) - (stoppedAt ?? Number.NaN)).toBeLessThanOrEqual(STOP_LIMIT);
  });

  test('REL-10-AC9: a run stopped before it starts a journey sends no "I’m home", writes INTERRUPTED and reports nothing', async () => {
    const w = world();
    const stop = new AbortController();
    stop.abort();

    await expect(w.run(w.canary(), stop.signal)).resolves.toEqual({ outcome: 'INTERRUPTED' });

    expect(w.sentTo('home')).toEqual([]);
    expect(w.canaryJourneys().filter(({ state }) => state !== 'ENDED')).toEqual([]);
    expect(w.alarm.reports).toEqual([]);
    expect(w.runLines()).toEqual([runLine({ outcome: 'INTERRUPTED' })]);
  });

  test('REL-10-AC9: a run still going at 10 minutes, its client never answering and its own timeout lifted, is aborted, ends its journey once, and reports failing with RUN_LIMIT', async () => {
    const w = world();
    w.answer('heartbeat', neverAnswered);

    await expect(w.run(w.canary({ client: w.client({ timeoutMs: NO_TIMEOUT }) }))).resolves.toEqual(
      { outcome: 'RUN_LIMIT' },
    );

    const journey = w.onlyJourney();
    expect(w.homesFor(journey.id)).toHaveLength(1);
    expect(w.store.endOf(journey.id).endReason).toBe('HOME');
    expect(w.alarm.statuses).toEqual(['failing']);
    expect(w.runLines()).toEqual([runLine({ outcome: 'RUN_LIMIT' })]);
    const elapsed = await w.elapsed();
    expect(elapsed).toBeGreaterThanOrEqual(RUN_LIMIT);
    expect(elapsed).toBeLessThanOrEqual(RUN_LIMIT + STOP_LIMIT);
  });

  test('REL-10-AC9: at the run limit with "I’m home" never answered too, the run waits for it at most 5 s, then reports failing with RUN_LIMIT', async () => {
    const w = world();
    w.answer('heartbeat', neverAnswered);
    w.answer('home', neverAnswered);

    await expect(w.run(w.canary({ client: w.client({ timeoutMs: NO_TIMEOUT }) }))).resolves.toEqual(
      { outcome: 'RUN_LIMIT' },
    );

    expect(w.sentTo('home')).toHaveLength(1);
    expect(w.alarm.statuses).toEqual(['failing']);
    expect(await w.elapsed()).toBeLessThanOrEqual(RUN_LIMIT + STOP_LIMIT);
  });

  // REL-10 review loop 1 (safety-reviewer should-fix 2): the run limit, then
  // the worker's stop inside the 5 s wait for "I'm home". The outcome was
  // fixed at the limit, RUN_LIMIT, before that wait; its line says so; the
  // report is handed the stop's signal, by then aborted, so it fails, and the
  // failure is one canary_report_failed line. Never silent: two lines, and
  // staging-canary's grace pages if no later run reports. Pinned as the code
  // behaves; the reviewer judged it acceptable.
  test('REL-10-AC9: a run at its limit, stopped by the worker 2 s into its wait for "I’m home", still comes to RUN_LIMIT: one canary_run line saying so, then its report, handed the stop’s aborted signal, fails, and one canary_report_failed line follows', async () => {
    const w = world();
    const stop = new AbortController();
    w.answer('heartbeat', neverAnswered);
    let stoppedAt = null as number | null;
    w.intercept((_request, entry) => {
      if (entry.route === 'home') {
        // The worker's stop comes 2 s into the run's wait for its "I'm home".
        void w.waits.wait(2 * SECOND, new AbortController().signal).then(async () => {
          stoppedAt = await w.elapsed();
          stop.abort();
        });
      }
      return undefined;
    });
    w.answer('home', neverAnswered);

    await expect(
      w.run(w.canary({ client: w.client({ timeoutMs: NO_TIMEOUT }) }), stop.signal),
    ).resolves.toEqual({ outcome: 'RUN_LIMIT' });

    expect(stoppedAt).toBe(RUN_LIMIT + 2 * SECOND);
    expect(w.sentTo('home')).toHaveLength(1);
    expect(w.canaryLines()).toEqual([
      {
        event: 'canary_run',
        outcome: 'RUN_LIMIT',
        alertMs: null,
        openedAfterMs: null,
        status: null,
        code: null,
      },
      { event: 'canary_report_failed' },
    ]);
    expect(w.alarm.statuses).toEqual(['failing']);
    expect(w.alarm.reports[0]?.signal).toBe(stop.signal);
    expect(stop.signal.aborted).toBe(true);
    expect(await w.elapsed()).toBeLessThanOrEqual(RUN_LIMIT + STOP_LIMIT);
  });

  test('REL-10-AC9: with everything failing at once, the store, every request and the report, the run still resolves, with one line for the run and one for the report', async () => {
    const w = world();
    w.store.failWith(databaseError('57P01'));
    w.answer('start', () => Promise.reject(new TypeError('fetch failed')));
    w.alarm.failWith(new Error('the monitor could not be reached'));

    await expect(w.run()).resolves.toEqual({ outcome: 'REGISTER_FAILED' });

    expect(w.canaryLines()).toEqual([
      runLine({ outcome: 'REGISTER_FAILED', code: '57P01' }),
      { event: 'canary_report_failed' },
    ]);
  });
});

describe('REL-10: the canary reads only its own journeys, and changes the database only through the API', () => {
  /**
   * Other walkers' journeys the loops leave alone over a run: ENDED, and
   * LOST_CONTACT with an alert someone is on, each naming the canary's
   * responder, with messages of every alert kind to it, sent, withdrawn, or
   * due a day from now. One unsent stand-down to the canary's responder is
   * left due a day on: an open of the canary's must not withdraw another
   * walker's.
   */
  async function othersOf(w: World) {
    // The canary's rows exist, as an earlier run's registration left them,
    // so other walkers' journeys can name its responder.
    await w.store.registerCanary({ credentialHash: w.credentialHash });
    const now = await w.clock.now();
    const at = (ms: number) => new Date(now.getTime() + ms);
    const someone = w.people.register();
    w.store.addUser(someone.userId);
    const journeyIds: string[] = [];
    for (const state of ['ENDED', 'LOST_CONTACT', 'LOST_CONTACT'] as const) {
      const walker = w.people.register();
      w.store.addUser(walker.userId);
      w.store.addDevice(walker.userId, walker.deviceId);
      const journeyId = w.store.seed({
        walkerId: walker.userId,
        deviceId: walker.deviceId,
        state,
        responderIds: [CANARY_RESPONDER_ID, someone.userId],
        startedAt: at(-2 * HOUR),
        lastHeartbeatAt: at(-HOUR - 10 * MINUTE),
      });
      journeyIds.push(journeyId);
      const resolvedId = w.store.seedAlert({
        journeyId,
        state: 'RESOLVED',
        openedAt: at(-2 * HOUR + 10 * MINUTE),
        silentSince: at(-2 * HOUR + 5 * MINUTE),
        resolvedAt: at(-2 * HOUR + 15 * MINUTE),
        resolution: 'BACK_IN_CONTACT',
      });
      const alertIds = [resolvedId];
      if (state === 'LOST_CONTACT') {
        const escalated = journeyIds.length === 3;
        alertIds.push(
          w.store.seedAlert({
            journeyId,
            state: escalated ? 'ESCALATED' : 'ACKNOWLEDGED',
            openedAt: at(-HOUR),
            silentSince: at(-HOUR - 5 * MINUTE),
            ...(escalated
              ? { smsRaisedAt: at(-HOUR + TWO_MINUTES) }
              : { acknowledgedBy: someone.userId, acknowledgedAt: at(-HOUR + MINUTE) }),
          }),
        );
      }
      for (const alertId of alertIds) {
        for (const kind of [
          'LOST_CONTACT',
          'BACK_IN_CONTACT',
          'ACKNOWLEDGED',
          'LOST_CONTACT_SMS',
          'SAFE',
        ] as const) {
          w.store.seedMessage({
            alertId,
            recipientId: CANARY_RESPONDER_ID,
            kind,
            createdAt: at(-HOUR),
            nextAttemptAt: at(-HOUR),
            attempts: 1,
            sentAt: at(-HOUR),
          });
        }
        w.store.seedMessage({
          alertId,
          recipientId: CANARY_RESPONDER_ID,
          kind: 'HOME',
          createdAt: at(-HOUR),
          nextAttemptAt: at(24 * HOUR),
          attempts: 1,
          lastFailure: 'NOT_CONFIGURED',
        });
      }
    }
    return journeyIds;
  }

  /** Every row of these journeys, column for column. */
  function rowsOf(w: World, journeyIds: readonly string[]) {
    return journeyIds.map((journeyId) => ({
      journey: w.store.journeys().find(({ id }) => id === journeyId),
      end: w.store.endOf(journeyId),
      device: w.store.deviceOf(journeyId),
      lastContact: w.store.lastHeartbeatAt(journeyId),
      heartbeats: w.store.heartbeats().filter((heartbeat) => heartbeat.journeyId === journeyId),
      alerts: w.alertsOf(journeyId),
      messages: w.messagesOf(journeyId),
    }));
  }

  test('REL-10-AC11: over a healthy run, every row of every other walker is unchanged, column for column, and the canary’s own store calls are its registration and its reads', async () => {
    const w = world();
    const others = await othersOf(w);
    const before = rowsOf(w, others);
    const devicesBefore = w.store.devices();

    await expect(w.run()).resolves.toEqual({ outcome: 'ON_TIME' });

    expect(rowsOf(w, others)).toEqual(before);
    // Every device as it was: the others', and the canary's, registered again with the same hash.
    expect(w.store.devices()).toEqual(devicesBefore);
    expect([...new Set(w.storeCalls)].sort()).toEqual(['observeCanaryJourney', 'registerCanary']);
  });

  test('REL-10-AC11: over a leftover’s run, every row of every other walker is unchanged too', async () => {
    const w = world();
    const others = await othersOf(w);
    w.store.seed({
      walkerId: CANARY_WALKER_ID,
      deviceId: CANARY_DEVICE_ID,
      state: 'ACTIVE',
      responderIds: [CANARY_RESPONDER_ID],
      startedAt: new Date(START.getTime() - LEFTOVER_AFTER),
    });
    const before = rowsOf(w, others);

    await expect(w.run()).resolves.toEqual({ outcome: 'ON_TIME' });

    expect(rowsOf(w, others)).toEqual(before);
    expect(w.log.events.filter(({ event }) => event === 'canary_leftover_ended')).toHaveLength(1);
  });

  test('REL-10-AC11: a start answered 409 naming a journey that is not the canary’s is not ended, and the run fails: it acts on its own journeys only', async () => {
    const w = world();
    const others = await othersOf(w);
    const [stranger] = others;
    w.answer('start', () =>
      json(409, {
        defined: true,
        code: 'ALREADY_ON_A_JOURNEY',
        status: 409,
        message: 'The walker already has a journey that has not ended.',
        data: { journeyId: stranger },
      }),
    );
    const before = rowsOf(w, others);

    await expect(w.run()).resolves.toEqual({ outcome: 'START_FAILED' });

    expect(w.sentTo('home')).toEqual([]);
    expect(rowsOf(w, others)).toEqual(before);
    expect(w.alarm.statuses).toEqual(['failing']);
  });
});

describe('REL-10: the canary’s page is its own', () => {
  test('REL-10-AC12: an on-time run reports ok to the canary’s alarm only, and a failing one failing only; the SMS check’s alarm hears only the SMS check', async () => {
    const w = world();
    const canary = w.canary();

    await w.run(canary);
    const minutesSoFar = Math.floor((await w.elapsed()) / MINUTE);
    expect(w.alarm.statuses).toEqual(['ok']);
    expect(w.smsAlarm.statuses).toEqual(Array.from({ length: minutesSoFar }, () => 'ok'));

    w.running.sweep = false;
    await w.waits.advance(FIFTEEN_MINUTES - (await w.elapsed()));
    await w.run(canary);

    expect(w.alarm.statuses).toEqual(['ok', 'failing']);
    expect(w.smsAlarm.statuses).toEqual(
      Array.from({ length: Math.floor((await w.elapsed()) / MINUTE) }, () => 'ok'),
    );
  });

  test('REL-10-AC12: with every run failing, the sweep still records the worker’s beat every 10 s and the SMS check still reports each minute', async () => {
    const w = world();
    const canary = w.canary();
    w.answer('start', () => refusal(500, 'INTERNAL_SERVER_ERROR'));

    for (let slot = 0; slot < 4; slot += 1) {
      await w.waits.advance(slot * FIFTEEN_MINUTES - (await w.elapsed()));
      await expect(w.run(canary)).resolves.toEqual({ outcome: 'START_FAILED' });
    }
    await w.waits.advance(HOUR - (await w.elapsed()));

    expect(w.alarm.statuses).toEqual(['failing', 'failing', 'failing', 'failing']);
    expect(sinceStart(await w.beats.lastBeat())).toBe(HOUR);
    expect(w.smsAlarm.statuses).toEqual(Array.from({ length: 60 }, () => 'ok'));
  });

  test('REL-10-AC12: a report that fails writes one canary_report_failed line and nothing else, and the run still resolves', async () => {
    const w = world();
    w.alarm.failWith(new Error('Healthchecks.io answered 500.'));

    await expect(w.run()).resolves.toEqual({ outcome: 'ON_TIME' });

    expect(w.alarm.statuses).toEqual(['ok']);
    expect(w.canaryLines()).toEqual([
      runLine({ outcome: 'ON_TIME' }),
      { event: 'canary_report_failed' },
    ]);
  });
});

describe('REL-10: a half-configured canary pages', () => {
  test('REL-10-AC13: with no client, its settings unusable, each run reports failing with NOT_CONFIGURED, sends no request and starts nothing', async () => {
    const w = world();
    const canary = w.canary({
      client: null,
      notConfigured: 'CANARY_API_URL is not set.',
      hash: null,
    });

    await expect(w.run(canary)).resolves.toEqual({ outcome: 'NOT_CONFIGURED' });
    await expect(w.run(canary)).resolves.toEqual({ outcome: 'NOT_CONFIGURED' });

    expect(w.alarm.statuses).toEqual(['failing', 'failing']);
    expect(w.runLines()).toEqual([
      {
        event: 'canary_run',
        outcome: 'NOT_CONFIGURED',
        alertMs: null,
        openedAfterMs: null,
        status: null,
        code: null,
      },
      {
        event: 'canary_run',
        outcome: 'NOT_CONFIGURED',
        alertMs: null,
        openedAfterMs: null,
        status: null,
        code: null,
      },
    ]);
    expect(w.sent).toEqual([]);
    expect(w.canaryJourneys()).toEqual([]);
  });

  // Each half of the canary's settings on its own: the client, made from the
  // API's address and the credential, and the credential's hash. Either one
  // missing is a canary that cannot run, and it pages.
  test.each([
    { what: 'no client, though it has its credential’s hash', options: { client: null } },
    { what: 'a client, but no credential’s hash', options: { hash: null } },
  ])(
    'REL-10-AC13: a canary with $what reports failing with NOT_CONFIGURED, registers nothing, sends no request and starts nothing',
    async ({ options }) => {
      const w = world();

      await expect(w.run(w.canary(options))).resolves.toEqual({ outcome: 'NOT_CONFIGURED' });

      expect(w.alarm.statuses).toEqual(['failing']);
      expect(w.runLines()).toEqual([
        runLine({ outcome: 'NOT_CONFIGURED', status: null, code: null }),
      ]);
      expect(w.storeCalls).toEqual([]);
      expect(w.sent).toEqual([]);
      expect(w.store.devices()).toEqual([]);
      expect(w.canaryJourneys()).toEqual([]);
    },
  );
});

describe('REL-10: nothing secret or personal reaches a log (PRIV-07)', () => {
  /**
   * The markers, made at run time (RG-07): the credential, a synthetic
   * coordinate, a phone-number-shaped value never in +47 form (eight digits
   * with a leading 0, which no Norwegian subscriber number has), and the
   * canary walker's ID.
   */
  const markersFor = (credential: string) => [
    credential,
    String(syntheticCoordinate()),
    `0${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
    CANARY_WALKER_ID,
  ];

  test.each([
    {
      what: 'the client’s fetch',
      arrange: (w: World, error: Error) => {
        w.answer('start', () => Promise.reject(error));
      },
      outcome: 'START_FAILED',
    },
    {
      what: 'the store’s read',
      arrange: (w: World, error: Error) => {
        w.failReads((index) => (index === 1 ? error : null));
      },
      outcome: 'READ_FAILED',
    },
    {
      what: 'the store’s registration',
      arrange: (w: World, error: Error) => {
        w.store.failWith(error, 'registerCanary');
      },
      outcome: 'REGISTER_FAILED',
    },
    {
      what: 'the canary’s report',
      arrange: (w: World, error: Error) => {
        w.running.sweep = false;
        w.alarm.failWith(error);
      },
      outcome: 'NOT_OPENED',
    },
  ])(
    'REL-10-AC15: PRIV-07: when $what fails with an error whose message holds the markers, nothing written to stdout, stderr or the console holds one, through the production log',
    async ({ arrange, outcome }) => {
      const credential = syntheticCredential();
      const w = world({ log: createLog() });
      const markers = markersFor(w.credential);
      const error = Object.assign(
        new Error(`could not reach ${markers.join(' ')} for ${credential}`, {
          cause: new Error(markers.join(' ')),
        }),
        { code: '57P01' },
      );
      arrange(w, error);

      const { result, written } = await captured(() => w.run());

      expect(result).toEqual({ outcome });
      // Controls: the capture saw the run's line, written through the
      // production log, and the injected error holds every marker.
      expect(written).toContain('"event":"canary_run"');
      expect(markersIn(`${error.message} ${String(error.cause)}`, markers)).toEqual(markers);

      expect(markersIn(written, markers)).toEqual([]);
      expect(written).not.toContain(ORIGIN);
      expect(written).not.toContain(CANARY_RESPONDER_ID);
    },
  );

  test('REL-10-AC15: PRIV-07: a whole healthy run through the production log writes the canary’s line and the loops’ closed lines, none holding the credential, a URL or a user’s ID', async () => {
    const w = world({ log: createLog() });

    const { written } = await captured(() => w.run());

    const lines = written
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as { event: string });
    expect(lines.filter(({ event }) => event === 'canary_run')).toEqual([
      expect.objectContaining({ event: 'canary_run', outcome: 'ON_TIME' }),
    ]);
    expect(
      markersIn(written, [
        w.credential,
        ORIGIN,
        CANARY_WALKER_ID,
        CANARY_RESPONDER_ID,
        CANARY_DEVICE_ID,
      ]),
    ).toEqual([]);
    expect(process.exitCode ?? 0).toBe(0);
  });
});

describe('REL-10: the run’s journeys carry nothing personal', () => {
  test('REL-10-AC14: the responder never has a device: after registration and after a run, the canary walker’s one device is the only one the canary made', async () => {
    const w = world();
    await w.store.registerCanary({ credentialHash: w.credentialHash });
    expect(w.store.devices().filter(({ userId }) => userId === CANARY_RESPONDER_ID)).toEqual([]);

    await w.run();

    expect(w.store.devices()).toEqual([
      { id: CANARY_DEVICE_ID, userId: CANARY_WALKER_ID, credentialHash: w.credentialHash },
    ]);
    expect(syntheticUuid()).not.toBe(CANARY_DEVICE_ID);
  });
});
