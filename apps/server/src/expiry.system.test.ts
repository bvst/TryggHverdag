// L6 system: the 24-hour end (LOST-08, SM-06's third end) and SM-05's guard,
// through the whole server in one process.
//
// The real API, the real journey, acknowledgement and closure modules, the
// real removal module, the real watchdog with the 24-hour end in its sweep,
// the real push sender, the real SMS sender and the real SMS check, with
// fakes only at the edges: the device credentials, the journey store, the
// worker's beats, the push port, the SMS port, the SMS check's monitor and
// the log. One fake clock stands in for the database's now(): the store reads
// it as PostgreSQL's now() would be read. No module reads a clock (AR-03).
// The loops are run here as the worker runs them, every 10 s (D-107); across
// a day, the clock is moved in steps and the sweep run at each named moment
// (the spec's notes: "not every 10 s for a day").
//
// What is proven here, the roadmap's "done when" for M2's task 8, its second
// half: "the 2-hour stop never ends a lost-contact journey (SM-05), at L6".
// SM-05: nothing automatic ends a LOST_CONTACT journey before 24 hours. SM-06:
// an alert ends when the walker reconnects and says "I'm home", when the
// acknowledger closes it, or 24 hours after it opened:
//   - 24 hours after the alert opened, and not a millisecond before, the
//     journey ends EXPIRED and every responder is told (AC8); an unheard
//     alert is resolved too, and the owner's page clears (AC9);
//   - the 24-hour end is part of the watchdog's sweep, after the opens and
//     the escalation, and a failure there is loud (AC10); it decides under
//     the journey's row (AC11);
//   - nothing automatic ends a lost-contact journey before 24 hours, and the
//     two-hour stop never ends one (AC12); SM-06's three ends, each end to end
//     (AC13); what the walker will be shown (AC6); all or nothing (AC16); the
//     store's time (AC17); nothing personal in a log (AC18).
//
// This file is one of the `alerts` mutation group's test files (the spec's
// Mutation section): the 24-hour end lives in modules/alerts/. Times are
// written out (five minutes, two minutes, 24 hours, 10 s, 30 s), not read
// from the domain's constants, so a wrong constant fails here as well as in
// the domain's own tests.
import {
  apiPath,
  fakeClock,
  fakeDeviceAuthenticator,
  fakeJourneyStore,
  fakeLog,
  fakePush,
  fakeSms,
  fakeSmsAlarm,
  fakeWorkerHeartbeats,
  syntheticCoordinate,
  syntheticCredential,
  syntheticHeartbeat,
  type FakeJourneyState,
  type RegisteredDevice,
  type SyntheticHeartbeat,
} from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import { createApi } from './api.ts';
import { captured, markersIn } from './capture.test.ts';
import { createLog } from './log.ts';
import { createAcknowledgementService } from './modules/alerts/acknowledgement.ts';
import { createClosureService } from './modules/alerts/closure.ts';
import { createExpiry } from './modules/alerts/expiry.ts';
import { createPushSender, createSmsSender } from './modules/alerts/outbox.ts';
import { createSmsCheck } from './modules/alerts/sms-check.ts';
import { createWatchdog } from './modules/alerts/watchdog.ts';
import { createHealthService } from './modules/health/service.ts';
import { createRemovalService } from './modules/journeys/removal.ts';
import { createJourneyService } from './modules/journeys/service.ts';
import type { Log, WatchdogStore } from './ports.ts';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** D-021: responders are alerted when the server has heard nothing for five minutes, or more. */
const FIVE_MINUTES = 5 * MINUTE;
/** D-019: every responder gets an SMS when nobody has acknowledged within two minutes, or more. */
const TWO_MINUTES = 2 * MINUTE;
/** SM-06 (D-126): the alert ends 24 hours after it opened, or more. */
const A_DAY = 24 * HOUR;
/** How often the worker's loops run (D-107). */
const INTERVAL = 10 * SECOND;
/** An alert not moved this long past its due time is stuck (D-116, REL-08). */
const STUCK_AFTER = 30 * SECOND;
/** How long a waiting attempt waits for a held row: the worker's lock limit (D-116). */
const LOCK_WAIT = 5 * SECOND;
/** An SMS still unsent this long after it was written is failing, and pages (LOST-07). */
const SMS_UNSENT_LIMIT = 60 * SECOND;

/** A synthetic night: 21:00 UTC on 1 October 2026. */
const START = new Date('2026-10-01T21:00:00.000Z');

const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SMS = 'LOST_CONTACT_SMS';
const SAFE = 'SAFE';
const EXPIRED = 'EXPIRED';

/** A sweep's answer when it opened nothing, escalated nothing and found nothing stuck. */
const QUIET_SWEEP = { ok: true, opened: 0, escalated: 0, stuck: 0 };

/** An error as a database or a driver throws one: a message, and a SQLSTATE. */
function databaseError(code: string, message = 'the database could not answer'): Error {
  return Object.assign(new Error(message), { code });
}

/** An answer as these tests read it: its status, its body parsed, its text and its headers. */
interface Answer {
  status: number;
  body: unknown;
  text: string;
  /** Every header, as sent, one per line: so two answers can be compared byte for byte. */
  headers: string;
}

function parsedOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function answerOf(response: Response): Promise<Answer> {
  const text = await response.text();
  return {
    status: response.status,
    body: parsedOrNull(text),
    text,
    headers: [...response.headers].map(([name, value]) => `${name}: ${value}`).join('\n'),
  };
}

/** The error code an answer's body names, if any. */
function codeOf(answer: Answer): unknown {
  return (answer.body as { code?: unknown } | null)?.code;
}

/** Waits, in turns of the event loop rather than by a clock, until `check` holds. */
async function until(check: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 500; turn += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  throw new Error(`${what} did not happen`);
}

/**
 * One server, its fakes, and the people a test needs. The modules log to the
 * recording fake, `log`, unless a test hands them another log.
 */
function world({ log: given }: { log?: Log } = {}) {
  const clock = fakeClock(START);
  const store = fakeJourneyStore({ clock });
  const devices = fakeDeviceAuthenticator();
  const recorded = fakeLog();
  const log = given ?? recorded;
  const beats = fakeWorkerHeartbeats();
  const push = fakePush();
  const sms = fakeSms();
  const alarm = fakeSmsAlarm();
  const api = createApi({
    health: createHealthService({ clock, heartbeats: beats }),
    journeys: createJourneyService({ clock, journeys: store, log }),
    devices,
    acknowledgements: createAcknowledgementService({ alerts: store, log }),
    // LOST-08 (the spec's "Interfaces": `ApiDependencies` gains `closures`).
    closures: createClosureService({ alerts: store, log }),
  });
  const removal = createRemovalService({ journeys: store, log });
  const watchdog = createWatchdog({ journeys: store, beats, log });
  const sender = createPushSender({ outbox: store, push, log });
  const smsSender = createSmsSender({ outbox: store, sms, log });
  const smsCheck = createSmsCheck({ outbox: store, alarm, log });

  const post = async (
    credential: string | null,
    route: string,
    body?: unknown,
  ): Promise<Answer> => {
    const headers: Record<string, string> = {};
    if (credential !== null) {
      headers['authorization'] = `Bearer ${credential}`;
    }
    if (body === undefined) {
      return answerOf(await api.request(apiPath(route), { method: 'POST', headers }));
    }
    headers['content-type'] = 'application/json';
    return answerOf(
      await api.request(apiPath(route), { method: 'POST', headers, body: JSON.stringify(body) }),
    );
  };

  const self = {
    api,
    clock,
    store,
    devices,
    beats,
    push,
    sms,
    alarm,
    removal,
    watchdog,
    sender,
    smsSender,
    smsCheck,
    /** What the modules logged, unless they were handed another log. */
    log: recorded,
    /** A user with a device: someone who can start a journey. */
    walker(): RegisteredDevice {
      const device = devices.register();
      store.addUser(device.userId);
      store.addDevice(device.userId, device.deviceId);
      return device;
    },
    /** A user with a device of their own, who can follow a journey, say "I'm on it" and close it (D-091). */
    responder(): RegisteredDevice {
      const device = devices.register();
      store.addUser(device.userId);
      return device;
    },
    /** Another device of the same person: a responder's tablet, say. */
    secondDevice: (of: RegisteredDevice): RegisteredDevice =>
      devices.register({ userId: of.userId }),
    /** A start through the API, whatever it is answered. */
    startAnswer: (device: RegisteredDevice, responderIds: readonly string[]): Promise<Answer> =>
      post(device.credential, 'journeys', { responderIds }),
    /** Starts a journey through the API, which must be 201; resolves to its ID. */
    async start(device: RegisteredDevice, responderIds: readonly string[]): Promise<string> {
      const answer = await self.startAnswer(device, responderIds);
      expect(answer.status, 'the start').toBe(201);
      return (answer.body as { journeyId: string }).journeyId;
    },
    /** A heartbeat from the phone through the API, whatever it is answered. */
    heartbeatAnswer: (device: RegisteredDevice, body: SyntheticHeartbeat): Promise<Answer> =>
      post(device.credential, 'heartbeats', body),
    /** A heartbeat from the phone through the API, which must be 200 RECORDED. */
    async heartbeat(
      device: RegisteredDevice,
      journeyId: string,
      body: SyntheticHeartbeat = syntheticHeartbeat({ journeyId }),
    ): Promise<void> {
      const answer = await post(device.credential, 'heartbeats', body);
      expect({ status: answer.status, body: answer.body }, 'the heartbeat').toEqual({
        status: 200,
        body: { outcome: 'RECORDED' },
      });
    },
    /** "I'm home" through the API (D-110). */
    home: (device: RegisteredDevice, journeyId: string): Promise<Answer> =>
      post(device.credential, `journeys/${journeyId}/home`),
    /** "I'm on it" through the API (D-114). */
    acknowledge: (device: RegisteredDevice, alertId: string): Promise<Answer> =>
      post(device.credential, `alerts/${alertId}/acknowledgement`),
    /**
     * "They're safe" through the API (LOST-08): POST /v1/alerts/{alertId}/closure,
     * with the device's credential, or another, or none; with no body unless
     * one is given.
     */
    close: (
      device: RegisteredDevice | null,
      alertId: string,
      { credential, body }: { credential?: string | null; body?: unknown } = {},
    ): Promise<Answer> =>
      post(
        credential === undefined ? (device?.credential ?? null) : credential,
        `alerts/${alertId}/closure`,
        body,
      ),
    /** The removal, through its module: no route removes a responder in M2 (D-122, item 5). */
    remove: (journeyId: string, responderId: string) => removal.remove({ journeyId, responderId }),
    /** A journey put in directly, its silence begun `silentForMs` before the clock's now. */
    async seed(
      device: RegisteredDevice,
      responderIds: readonly string[],
      { state = 'ACTIVE', silentForMs }: { state?: FakeJourneyState; silentForMs: number },
    ): Promise<string> {
      const silentSince = new Date((await clock.now()).getTime() - silentForMs);
      return store.seed({
        walkerId: device.userId,
        deviceId: device.deviceId,
        state,
        responderIds,
        startedAt: new Date(silentSince.getTime() - HOUR),
        lastHeartbeatAt: silentSince,
      });
    },
    /** One run of each loop, as the worker makes them: a sweep, a push delivery, an SMS delivery. */
    async runLoops() {
      const swept = await watchdog.sweep();
      const pushed = await sender.deliverDue();
      const texted = await smsSender.deliverDue();
      return { swept, pushed, texted };
    },
    /** Moves the clock to exactly `at`, running the loops every 10 s on the way, as the worker would. */
    async runUntil(at: Date | number) {
      const target = typeof at === 'number' ? at : at.getTime();
      for (;;) {
        const now = (await clock.now()).getTime();
        const step = Math.min(INTERVAL, target - now);
        if (step <= 0) {
          return;
        }
        clock.advance(step);
        await self.runLoops();
      }
    },
    /** Moves the clock to exactly `at`, delivering pushes every 10 s on the way, with no sweep. */
    async deliverUntil(at: Date | number) {
      const target = typeof at === 'number' ? at : at.getTime();
      for (;;) {
        const now = (await clock.now()).getTime();
        const step = Math.min(INTERVAL, target - now);
        if (step <= 0) {
          return;
        }
        clock.advance(step);
        await sender.deliverDue();
      }
    },
    stateOf: (journeyId: string) => store.journeys().find(({ id }) => id === journeyId)?.state,
    respondersOf: (journeyId: string) =>
      [...(store.journeys().find(({ id }) => id === journeyId)?.responderIds ?? [])].sort(),
    journeysOf: (walkerId: string) =>
      store.journeys().filter((journey) => journey.walkerId === walkerId),
    alertsOf: (journeyId: string) =>
      store.alerts().filter((alert) => alert.journeyId === journeyId),
    alertOf(alertId: string) {
      const alert = store.alerts().find(({ id }) => id === alertId);
      if (alert === undefined) {
        throw new Error('expected the alert to be stored');
      }
      return alert;
    },
    messagesOf(journeyId: string) {
      const alertIds = self.alertsOf(journeyId).map(({ id }) => id);
      return store.outbox().filter(({ alertId }) => alertIds.includes(alertId));
    },
    /** This alert's round: 1 when opened, one more with each reset. */
    roundOf: (alertId: string) =>
      store.alertRounds().find((alert) => alert.alertId === alertId)?.round,
    /** Each message's round, by its ID. */
    rounds: () => new Map(store.messageRounds().map(({ messageId, round }) => [messageId, round])),
    /** The lines of these events, in order. */
    lines: (...names: string[]) => recorded.events.filter(({ event }) => names.includes(event)),
    /** The closure module's own lines. */
    closureLines: () => recorded.events.filter(({ event }) => event.startsWith('closure_')),
    /** Everything the store holds of one journey, to compare before and after. */
    recordOf: (journeyId: string) => ({
      journey: store.journeys().find(({ id }) => id === journeyId),
      end: store.endOf(journeyId),
      lastContact: store.lastHeartbeatAt(journeyId),
      heartbeats: store.heartbeats().filter((heartbeat) => heartbeat.journeyId === journeyId),
      alerts: self.alertsOf(journeyId),
      rounds: store.alertRounds(),
      messages: self.messagesOf(journeyId),
      warnings: store.journeyMessages().filter((message) => message.journeyId === journeyId),
    }),
  };
  return self;
}

type World = ReturnType<typeof world>;

/** Recipients of these messages, sorted. */
const recipientsOf = (messages: readonly { recipientId: string }[]) =>
  messages.map(({ recipientId }) => recipientId).sort();

/** The user IDs of these people, sorted. */
const idsOf = (people: readonly RegisteredDevice[]) => people.map(({ userId }) => userId).sort();

/** The messages of this kind, in the order given. */
const ofKind = <T extends { kind: string }>(messages: readonly T[], kind: string): T[] =>
  messages.filter((message) => message.kind === kind);

/**
 * W starts J through the API naming `count` responders, D sends a heartbeat
 * now and then nothing, and the loops run every 10 s until the alert opens at
 * five minutes, every responder's lost-contact push accepted.
 */
async function startedAndLost(w: World, count = 3) {
  const walker = w.walker();
  const responders = Array.from({ length: count }, () => w.responder());
  const journeyId = await w.start(walker, idsOf(responders));
  await w.heartbeat(walker, journeyId);
  const lastContact = await w.clock.now();
  await w.runUntil(lastContact.getTime() + FIVE_MINUTES);
  const [alert] = w.alertsOf(journeyId);
  if (alert === undefined) {
    throw new Error('expected the alert to open at five minutes');
  }
  expect(alert.openedAt).toEqual(new Date(lastContact.getTime() + FIVE_MINUTES));
  return { walker, responders, journeyId, alertId: alert.id, openedAt: alert.openedAt };
}

/**
 * An overdue journey of a new walker, with `count` responders, swept and
 * nothing delivered: LOST_CONTACT, its alert OPEN at the clock's now, one
 * unsent lost-contact push per responder.
 */
async function lost(w: World, count = 3) {
  const walker = w.walker();
  const responders = Array.from({ length: count }, () => w.responder());
  const journeyId = await w.seed(walker, idsOf(responders), {
    silentForMs: FIVE_MINUTES + MINUTE,
  });
  const swept = await w.watchdog.sweep();
  expect(swept.opened, 'the sweep opened the alert').toBe(1);
  const [alert] = w.alertsOf(journeyId);
  if (alert === undefined) {
    throw new Error('expected the sweep to open an alert');
  }
  return { walker, responders, journeyId, alertId: alert.id, openedAt: alert.openedAt };
}

/** The first of these responders: R1. */
function firstOf(responders: readonly RegisteredDevice[]): RegisteredDevice {
  const [first] = responders;
  if (first === undefined) {
    throw new Error('expected a responder');
  }
  return first;
}

/** The time an alert reaches its 24 hours, and the sweep's moment `offsetMs` from it. */
const dayAfter = (openedAt: Date, offsetMs = 0) => openedAt.getTime() + A_DAY + offsetMs;

/** Moves the clock to exactly `at`, with no loop run on the way: a day passes between two sweeps. */
async function jumpTo(w: World, at: number): Promise<void> {
  const now = (await w.clock.now()).getTime();
  expect(at, 'the clock moves forward').toBeGreaterThanOrEqual(now);
  w.clock.advance(at - now);
}

/** What a sweep must leave as it was, its beat aside: everything the store holds of these journeys. */
function snapshot(w: World, journeyIds: readonly string[]) {
  return journeyIds.map((journeyId) => w.recordOf(journeyId));
}

/** The 24-hour end's own lines. */
const expiryLines = (w: World) => w.log.events.filter(({ event }) => event.startsWith('expiry_'));

/**
 * Checks the 24-hour end did all of its work at `at`: J ENDED, EXPIRED, at
 * `at`; A RESOLVED, EXPIRED, at `at`; one EXPIRED for each of `told`, in A's
 * round, created and due at `at`; none for anyone else, the walker included.
 */
function expectExpired(
  w: World,
  {
    journeyId,
    alertId,
    walker,
    told,
    at,
  }: {
    journeyId: string;
    alertId: string;
    walker: RegisteredDevice;
    told: readonly RegisteredDevice[];
    at: Date;
  },
) {
  expect(w.stateOf(journeyId)).toBe('ENDED');
  expect(w.store.endOf(journeyId)).toEqual({ endedAt: at, endReason: EXPIRED });
  expect(w.alertOf(alertId)).toMatchObject({
    state: 'RESOLVED',
    resolution: EXPIRED,
    resolvedAt: at,
  });
  const expired = ofKind(w.messagesOf(journeyId), EXPIRED);
  expect(recipientsOf(expired)).toEqual(idsOf(told));
  for (const message of expired) {
    expect(message, message.recipientId).toMatchObject({
      createdAt: at,
      nextAttemptAt: at,
      sentAt: null,
      withdrawnAt: null,
    });
    expect(w.rounds().get(message.messageId), 'in A’s round').toBe(w.roundOf(alertId));
  }
  expect(
    w.store
      .outbox()
      .filter(({ recipientId, kind }) => recipientId === walker.userId && kind === EXPIRED),
  ).toEqual([]);
}

/** As `lost`, two minutes on and swept: the alert ESCALATED, an SMS per responder. */
async function escalated(w: World, count = 3) {
  const alerted = await lost(w, count);
  w.clock.advance(TWO_MINUTES);
  expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, escalated: 1 });
  return alerted;
}

// ---------------------------------------------------------------------------
// LOST-08-AC8: 24 hours after the alert opened, the journey ends and every
// responder is told.
// ---------------------------------------------------------------------------

describe('LOST-08, SM-06 and REL-01: 24 hours after the alert opened, the journey ends and every responder is told', () => {
  test('LOST-08-AC8: W starts J through the API with R1, R2 and R3; D goes silent and A opens at five minutes on the fake clock, J LOST_CONTACT, the loops running for ten minutes; swept at 86 399 999 ms after A’s opening, nothing changes; at exactly 86 400 000 ms, J ENDED, EXPIRED, ended_at the sweep’s now; A RESOLVED, EXPIRED, at the same now; one EXPIRED each for R1, R2 and R3, none for W; the push fake receives them; the sweep is ok and records its beat (SM-06, REL-01)', async () => {
    const w = world();
    const { walker, responders, journeyId, alertId, openedAt } = await startedAndLost(w, 3);
    await w.runUntil(openedAt.getTime() + 10 * MINUTE);
    expect(w.alertOf(alertId).state).toBe('ESCALATED');
    await jumpTo(w, dayAfter(openedAt, -1));
    const before = snapshot(w, [journeyId]);

    expect(await w.watchdog.sweep()).toEqual(QUIET_SWEEP);

    expect(snapshot(w, [journeyId])).toEqual(before);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    w.clock.advance(1);
    const at = await w.clock.now();

    const swept = await w.watchdog.sweep();

    expect(swept).toEqual(QUIET_SWEEP);
    expect(await w.beats.lastBeat()).toEqual(at);
    expectExpired(w, { journeyId, alertId, walker, told: responders, at });
    expect(expiryLines(w)).toEqual([]);
    await w.sender.deliverDue();
    const handed = ofKind(w.push.accepted, EXPIRED);
    expect(recipientsOf(handed)).toEqual(idsOf(responders));
    for (const message of handed) {
      expect(Object.keys(message).sort()).toEqual(['kind', 'messageId', 'recipientId']);
      expect(message.messageId).toMatch(LOWER_UUID);
    }
  });

  test.each(['OPEN', 'ESCALATED', 'ACKNOWLEDGED', 'reset into round 2'] as const)(
    'LOST-08-AC8: the same for A %s: not a millisecond before its 24 hours, counted from A’s opening; at them, J ENDED EXPIRED and A RESOLVED EXPIRED at the sweep’s now, one EXPIRED for each responder row, the acknowledger’s included, in A’s round (SM-06)',
    async (state) => {
      const w = world();
      const { walker, journeyId, alertId, openedAt, responders } =
        state === 'OPEN' ? await lost(w, 3) : await escalated(w, 3);
      const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
      let told: readonly RegisteredDevice[] = responders;
      if (state === 'ACKNOWLEDGED' || state === 'reset into round 2') {
        expect((await w.acknowledge(r1, alertId)).status).toBe(200);
      }
      if (state === 'reset into round 2') {
        // An hour on, R1 removed: the alert back to unacknowledged, round 2,
        // escalated again at once; its 24 hours still count from its opening.
        w.clock.advance(HOUR);
        expect(await w.remove(journeyId, r1.userId)).toEqual({ type: 'removed' });
        expect(w.roundOf(alertId)).toBe(2);
        expect((await w.watchdog.sweep()).ok).toBe(true);
        told = responders.slice(1);
      }
      if (state === 'OPEN') {
        expect(w.alertOf(alertId).state).toBe('OPEN');
      }
      await jumpTo(w, dayAfter(openedAt, -1));
      expect((await w.watchdog.sweep()).ok).toBe(true);
      expect(w.stateOf(journeyId), 'a millisecond short').toBe('LOST_CONTACT');
      expect(w.alertOf(alertId).resolution).toBeNull();
      w.clock.advance(1);
      const at = await w.clock.now();

      const swept = await w.watchdog.sweep();

      expect({ ok: swept.ok, stuck: swept.stuck }).toEqual({ ok: true, stuck: 0 });
      expectExpired(w, { journeyId, alertId, walker, told, at });
      if (state === 'ACKNOWLEDGED') {
        expect(w.alertOf(alertId).acknowledgedBy).toBe(r1.userId);
        expect(recipientsOf(ofKind(w.messagesOf(journeyId), EXPIRED))).toContain(r1.userId);
      }
    },
  );

  test('LOST-08-AC8: for a journey that lost contact, came back and lost it again, the 24 hours count from its current alert’s opening: 24 hours after the first alert opened nothing ends; 24 hours after the second opened, J ENDED, EXPIRED, the second alert RESOLVED, EXPIRED, and the first keeps its BACK_IN_CONTACT (SM-06)', async () => {
    const w = world();
    const {
      walker,
      responders,
      journeyId,
      alertId: firstId,
      openedAt: firstOpened,
    } = await startedAndLost(w, 2);
    w.clock.advance(10 * MINUTE);
    await w.heartbeat(walker, journeyId);
    const lastContact = await w.clock.now();
    await w.runUntil(lastContact.getTime() + FIVE_MINUTES);
    const second = w.alertsOf(journeyId).find(({ id }) => id !== firstId);
    if (second === undefined) {
      throw new Error('expected a second alert to open');
    }

    await jumpTo(w, dayAfter(firstOpened));
    expect((await w.watchdog.sweep()).ok).toBe(true);

    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(w.alertOf(second.id).resolution).toBeNull();
    await jumpTo(w, dayAfter(second.openedAt));
    const at = await w.clock.now();
    expect((await w.watchdog.sweep()).ok).toBe(true);
    expectExpired(w, { journeyId, alertId: second.id, walker, told: responders, at });
    expect(w.alertOf(firstId).resolution).toBe('BACK_IN_CONTACT');
  });

  test('LOST-08-AC6: after the 24-hour end, J’s end reason is EXPIRED and A’s acknowledged_by still names whoever was on it, readable together; J’s ended_at equals A’s resolved_at; no message is written to W', async () => {
    const w = world();
    const { walker, journeyId, alertId, openedAt, responders } = await lost(w, 2);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice];
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    const toWalker = () =>
      w.store.outbox().filter(({ recipientId }) => recipientId === walker.userId);
    const before = toWalker();
    await jumpTo(w, dayAfter(openedAt));

    expect((await w.watchdog.sweep()).ok).toBe(true);

    const alert = w.alertOf(alertId);
    const end = w.store.endOf(journeyId);
    expect({ endReason: end.endReason, acknowledgedBy: alert.acknowledgedBy }).toEqual({
      endReason: EXPIRED,
      acknowledgedBy: r1.userId,
    });
    expect(end.endedAt).toEqual(alert.resolvedAt);
    expect(toWalker()).toEqual(before);
    expect(w.store.journeyMessages().filter((message) => message.journeyId === journeyId)).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC9: an unheard alert is resolved too, and the page clears.
// ---------------------------------------------------------------------------

describe('LOST-08, SM-06, SM-10 and SM-02: the 24-hour end resolves an unheard alert, and the page clears', () => {
  test('LOST-08-AC9: J with its last responder removed, silent, its alert opened with nobody to tell, the SMS check reporting failing with an unheard_alerts line; swept 24 hours after the alert opened: J ENDED, EXPIRED, the alert RESOLVED, EXPIRED, no message written; the next SMS check reports ok, with no new unheard_alerts line (SM-06, SM-10, SM-02)', async () => {
    const w = world();
    const walker = w.walker();
    const r1 = w.responder();
    const journeyId = await w.start(walker, [r1.userId]);
    await w.heartbeat(walker, journeyId);
    expect(await w.remove(journeyId, r1.userId)).toEqual({ type: 'removed' });
    expect(w.respondersOf(journeyId)).toEqual([]);
    const lastContact = await w.clock.now();
    await w.runUntil(lastContact.getTime() + FIVE_MINUTES);
    const [alert] = w.alertsOf(journeyId);
    if (alert === undefined) {
      throw new Error('expected the alert to open with nobody to tell');
    }
    expect(w.messagesOf(journeyId)).toEqual([]);
    w.clock.advance(SMS_UNSENT_LIMIT);
    expect(await w.smsCheck.check()).toBe('failing');
    expect(w.lines('unheard_alerts')).toEqual([{ event: 'unheard_alerts', count: 1 }]);
    const warnings = w.store.journeyMessages();
    await jumpTo(w, dayAfter(alert.openedAt));
    const at = await w.clock.now();

    expect(await w.watchdog.sweep()).toEqual(QUIET_SWEEP);

    expect(w.store.endOf(journeyId)).toEqual({ endedAt: at, endReason: EXPIRED });
    expect(w.alertOf(alert.id)).toMatchObject({
      state: 'RESOLVED',
      resolution: EXPIRED,
      resolvedAt: at,
    });
    expect(w.messagesOf(journeyId)).toEqual([]);
    expect(w.store.journeyMessages()).toEqual(warnings);
    expect(await w.smsCheck.check()).toBe('ok');
    expect(w.lines('unheard_alerts')).toEqual([{ event: 'unheard_alerts', count: 1 }]);
    expect(w.alarm.statuses.at(-1)).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC10 and AC16: part of the watchdog's sweep, and loud.
// ---------------------------------------------------------------------------

describe('LOST-08, SM-06, LOST-02 and REL-08: the 24-hour end is part of the watchdog’s sweep, and a failure there is loud', () => {
  test('LOST-08-AC10: the sweep reads the alerts due for their 24-hour end after the overdue read and the escalation’s read, and asks to end each after the escalation (SM-06, LOST-02)', async () => {
    const w = world();
    const { openedAt } = await lost(w, 2);
    await jumpTo(w, dayAfter(openedAt));
    const from = w.store.calls.length;

    expect((await w.watchdog.sweep()).ok).toBe(true);

    const calls = w.store.calls.slice(from);
    const at = (call: (typeof calls)[number]) => calls.indexOf(call);
    expect(at('overdueJourneys')).toBeGreaterThanOrEqual(0);
    expect(at('alertsDueForEscalation')).toBeGreaterThan(at('overdueJourneys'));
    expect(at('escalateAlert')).toBeGreaterThan(at('alertsDueForEscalation'));
    expect(at('alertsDueForExpiry')).toBeGreaterThan(at('escalateAlert'));
    expect(at('expireAlert')).toBeGreaterThan(at('alertsDueForExpiry'));
    expect(calls.filter((call) => call === 'alertsDueForExpiry')).toHaveLength(1);
  });

  test.each([
    {
      failing: 'overdueJourneys' as const,
      line: { event: 'watchdog_failed', stage: 'read', code: '57P01' },
    },
    {
      failing: 'alertsDueForEscalation' as const,
      line: { event: 'escalation_failed', stage: 'read', code: '57P01' },
    },
  ])(
    'LOST-08-AC10: with only $failing failing, a due alert still reaches its 24-hour end: the expiry runs whatever the opens and the escalation came to; the sweep fails with the one line of that failure, and records no beat (SM-06, LOST-02, REL-08)',
    async ({ failing, line }) => {
      const w = world();
      const { walker, responders, journeyId, alertId, openedAt } = await lost(w, 2);
      await jumpTo(w, dayAfter(openedAt));
      const at = await w.clock.now();
      const beat = await w.beats.lastBeat();
      w.store.failWith(databaseError('57P01'), failing);

      const swept = await w.watchdog.sweep();

      expect(swept.ok).toBe(false);
      expect(w.log.events).toEqual([line]);
      expect(await w.beats.lastBeat()).toEqual(beat);
      expectExpired(w, { journeyId, alertId, walker, told: responders, at });
    },
  );

  test.each([
    { stage: 'read' as const, call: 'alertsDueForExpiry' as const, code: '57P01' },
    { stage: 'expire' as const, call: 'expireAlert' as const, code: '40001' },
  ])(
    'LOST-08-AC10: with the store failing $call, the sweep fails with one expiry_failed line, stage $stage, and its SQLSTATE, and records no beat; J and A as they were; once the store answers, the next sweep ends J (SM-06, REL-08)',
    async ({ stage, call, code }) => {
      const w = world();
      const { walker, responders, journeyId, alertId, openedAt } = await lost(w, 2);
      w.clock.advance(TWO_MINUTES);
      expect((await w.watchdog.sweep()).escalated).toBe(1);
      const beat = await w.beats.lastBeat();
      await jumpTo(w, dayAfter(openedAt));
      const before = snapshot(w, [journeyId]);
      w.store.failWith(databaseError(code), call);

      const swept = await w.watchdog.sweep();

      expect(swept).toEqual({ ...QUIET_SWEEP, ok: false });
      expect(w.log.events).toEqual([{ event: 'expiry_failed', stage, code }]);
      expect(await w.beats.lastBeat()).toEqual(beat);
      expect(snapshot(w, [journeyId])).toEqual(before);

      w.store.recover();
      w.clock.advance(INTERVAL);
      const at = await w.clock.now();
      expect(await w.watchdog.sweep()).toEqual(QUIET_SWEEP);
      expect(await w.beats.lastBeat()).toEqual(at);
      expectExpired(w, { journeyId, alertId, walker, told: responders, at });
    },
  );

  test.each(['first', 'second'] as const)(
    'LOST-08-AC10: of two alerts past their 24 hours, the %s one’s expiry failing stops not the other’s: the other journey ENDED EXPIRED; the sweep fails with one expiry_failed line, stage expire, and records no beat (SM-06, REL-08)',
    async (failingOne) => {
      const w = world();
      const first = await lost(w, 2);
      // RG-03 (LOST-08 review loop 1, code-reviewer): the second opens a
      // second after the first. The fake now reads the alerts due as the
      // adapter does, by opening and then by ID, so two opened at the same
      // moment would come in an order their random IDs decide.
      w.clock.advance(SECOND);
      const second = await lost(w, 3);
      // Each on someone's hands, so the sweep escalates neither.
      for (const { responders, alertId } of [first, second]) {
        expect((await w.acknowledge(firstOf(responders), alertId)).status).toBe(200);
      }
      await jumpTo(w, dayAfter(second.openedAt));
      const at = await w.clock.now();
      const beat = await w.beats.lastBeat();
      // The fake reads the alerts due in the order they were opened.
      if (failingOne === 'first') {
        w.store.beforeNext('expireAlert', () => {
          w.store.failWith(databaseError('40001'), 'expireAlert');
        });
        w.store.beforeNext('expireAlert', () => {
          w.store.recover();
        });
      } else {
        w.store.beforeNext('expireAlert', () => undefined);
        w.store.beforeNext('expireAlert', () => {
          w.store.failWith(databaseError('40001'), 'expireAlert');
        });
      }
      const failed = failingOne === 'first' ? first : second;
      const other = failingOne === 'first' ? second : first;
      const failedBefore = snapshot(w, [failed.journeyId]);

      const swept = await w.watchdog.sweep();
      w.store.recover();

      expect(swept).toEqual({ ...QUIET_SWEEP, ok: false });
      expect(w.log.events).toEqual([{ event: 'expiry_failed', stage: 'expire', code: '40001' }]);
      expect(await w.beats.lastBeat()).toEqual(beat);
      expect(snapshot(w, [failed.journeyId])).toEqual(failedBefore);
      expectExpired(w, { ...other, told: other.responders, at });
    },
  );

  test('LOST-08-AC10: with J’s row held, the sweep skips A at its 24 hours without waiting and is ok, until they passed 30 s ago; at 24 h 0 min 29.999 s still ok; at 24 h 0 min 30 s it waits once, at most 5 s, and, held through the wait, writes one expiry_overdue line naming A, fails, counts it stuck and records no beat; released, the next sweep ends J (SM-06, REL-08, D-116)', async () => {
    const w = world();
    const { walker, responders, journeyId, alertId, openedAt } = await lost(w, 3);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    await jumpTo(w, dayAfter(openedAt));
    w.store.hold(journeyId);
    const asked = w.store.expireRequests().length;

    expect(await w.watchdog.sweep()).toEqual(QUIET_SWEEP);
    expect(w.store.expireRequests().slice(asked)).toEqual([{ alertId }]);
    w.clock.advance(STUCK_AFTER - 1);
    expect(await w.watchdog.sweep()).toEqual(QUIET_SWEEP);
    const beat = await w.beats.lastBeat();
    expect(beat).toEqual(await w.clock.now());

    w.clock.advance(1);
    expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, ok: false, stuck: 1 });

    expect(w.store.expireRequests().slice(asked + 2)).toEqual([
      { alertId },
      { alertId, lockWaitMs: LOCK_WAIT },
    ]);
    expect(w.log.events).toEqual([{ event: 'expiry_overdue', alertId }]);
    expect(await w.beats.lastBeat()).toEqual(beat);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');

    // Released, the next sweep ends J, and beats.
    w.store.release(journeyId);
    const at = await w.clock.now();
    expect(await w.watchdog.sweep()).toEqual(QUIET_SWEEP);
    expectExpired(w, { journeyId, alertId, walker, told: responders, at });
    expect(await w.beats.lastBeat()).toEqual(at);
  });

  test('LOST-08-AC10: an alert whose row is held 30 s past its 24 hours, and whose waiting retry then fails, is stuck, never skipped: one expiry_failed line, stage expire, code 55P03, and one expiry_overdue line naming it; the sweep fails and records no beat (SM-06, REL-08)', async () => {
    const w = world();
    const { journeyId, alertId, openedAt, responders } = await lost(w, 2);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice];
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    await jumpTo(w, dayAfter(openedAt, STUCK_AFTER));
    const beat = await w.beats.lastBeat();
    const asked = w.store.expireRequests().length;
    w.store.hold(journeyId);
    w.store.beforeNext('expireAlert', () => undefined);
    w.store.beforeNext('expireAlert', () => {
      w.store.failWith(databaseError('55P03'), 'expireAlert');
    });

    expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, ok: false, stuck: 1 });
    w.store.recover();

    expect(w.store.expireRequests().slice(asked)).toEqual([
      { alertId },
      { alertId, lockWaitMs: LOCK_WAIT },
    ]);
    expect(w.log.events).toEqual([
      { event: 'expiry_failed', stage: 'expire', code: '55P03' },
      { event: 'expiry_overdue', alertId },
    ]);
    expect(await w.beats.lastBeat()).toEqual(beat);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
  });

  test('LOST-08-AC10: a first attempt that fails with the alert’s 24 hours passed 30 s ago or more counts as stuck, as the escalation’s does (D-116): the sweep fails with one expiry_failed line, stage expire, with its SQLSTATE, and one expiry_overdue line naming the alert, counts it stuck, never waits for its row, and records no beat; at 24 h 0 min 29.999 s the same failure fails the sweep but is not stuck; once the store answers, the next sweep ends J (SM-06, REL-08)', async () => {
    // LOST-08 review loop 1 (safety-reviewer, should-fix 1). The escalation's
    // own test of this is LOST-07-AC16's in escalation.system.test.ts: a
    // first attempt that fails is not retried with a wait, and past the
    // stuck threshold it is stuck, so the owner learns which alert, not only
    // that a sweep failed.
    const w = world();
    const { walker, responders, journeyId, alertId, openedAt } = await lost(w, 3);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    // On someone's hands, so the sweep escalates nothing on the way.
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    await jumpTo(w, dayAfter(openedAt, STUCK_AFTER - 1));
    const beat = await w.beats.lastBeat();
    const before = snapshot(w, [journeyId]);
    const asked = w.store.expireRequests().length;
    w.store.failWith(databaseError('40001'), 'expireAlert');

    expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, ok: false });
    expect(w.log.events).toEqual([{ event: 'expiry_failed', stage: 'expire', code: '40001' }]);

    w.clock.advance(1);
    expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, ok: false, stuck: 1 });
    expect(w.log.events.slice(1)).toEqual([
      { event: 'expiry_failed', stage: 'expire', code: '40001' },
      { event: 'expiry_overdue', alertId },
    ]);
    // One attempt each sweep, neither of them a wait: only a skip is retried.
    expect(w.store.expireRequests().slice(asked)).toEqual([{ alertId }, { alertId }]);
    expect(await w.beats.lastBeat()).toEqual(beat);
    expect(snapshot(w, [journeyId])).toEqual(before);

    // The store answering again, the next sweep ends J and beats.
    w.store.recover();
    const at = await w.clock.now();
    expect(await w.watchdog.sweep()).toEqual(QUIET_SWEEP);
    expect(await w.beats.lastBeat()).toEqual(at);
    expectExpired(w, { journeyId, alertId, walker, told: responders, at });
  });

  test.each(['first', 'second'] as const)(
    'LOST-08-AC10: of two alerts 30 s past their 24 hours, each with its journey’s row held, the %s one held through its wait and the other let go within it: each meets its own outcome — the held one stuck, with one expiry_overdue line naming it, the other ENDED EXPIRED; the sweep fails, counting one stuck, and records no beat (BUG-28’s lesson, D-116)',
    async (heldOne) => {
      const w = world();
      const first = await lost(w, 2);
      // RG-03 (LOST-08 review loop 1): opened a second apart, as above, so
      // "in the order read" is the order opened.
      w.clock.advance(SECOND);
      const second = await lost(w, 3);
      for (const { responders, alertId } of [first, second]) {
        expect((await w.acknowledge(firstOf(responders), alertId)).status).toBe(200);
      }
      await jumpTo(w, dayAfter(second.openedAt, STUCK_AFTER));
      const at = await w.clock.now();
      const beat = await w.beats.lastBeat();
      const asked = w.store.expireRequests().length;
      const held = heldOne === 'first' ? first : second;
      const letGo = heldOne === 'first' ? second : first;
      w.store.hold(held.journeyId);
      w.store.holdUntilWaited(letGo.journeyId);

      expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, ok: false, stuck: 1 });

      // Both skipped without a wait, then both waited for, in the order read.
      expect(w.store.expireRequests().slice(asked)).toEqual([
        { alertId: first.alertId },
        { alertId: second.alertId },
        { alertId: first.alertId, lockWaitMs: LOCK_WAIT },
        { alertId: second.alertId, lockWaitMs: LOCK_WAIT },
      ]);
      expect(w.log.events).toEqual([{ event: 'expiry_overdue', alertId: held.alertId }]);
      expect(w.stateOf(held.journeyId)).toBe('LOST_CONTACT');
      expectExpired(w, { ...letGo, told: letGo.responders, at });
      expect(await w.beats.lastBeat()).toEqual(beat);

      w.store.release(held.journeyId);
      expect(await w.watchdog.sweep()).toEqual(QUIET_SWEEP);
      expect(w.store.endOf(held.journeyId).endReason).toBe(EXPIRED);
    },
  );

  test('LOST-08-AC10: with a stub store whose read returns alerts the rule does not end — opened 23 h 59 min 59.999 s before its now, of an ACTIVE journey, of an ENDED journey — the sweep asks the store to end only the one opened exactly 24 hours before, and is ok (SM-06: the rule decides again, defence in depth)', async () => {
    const w = world();
    const due = await lost(w, 2);
    const early = await lost(w, 2);
    const now = new Date(dayAfter(due.openedAt));
    const asRead = (
      alert: { alertId: string; journeyId: string },
      state: FakeJourneyState,
      openedAt: Date,
    ) => ({
      id: alert.alertId,
      journeyId: alert.journeyId,
      journeyState: state,
      openedAt,
    });
    const drifted: WatchdogStore = {
      overdueJourneys: (afterMs: number) => w.store.overdueJourneys(afterMs),
      openLostContactAlert: (request) => w.store.openLostContactAlert(request),
      alertsDueForEscalation: (afterMs: number) => w.store.alertsDueForEscalation(afterMs),
      escalateAlert: (request) => w.store.escalateAlert(request),
      alertsDueForExpiry: () =>
        Promise.resolve({
          now,
          alerts: [
            asRead(due, 'LOST_CONTACT', due.openedAt),
            asRead(early, 'LOST_CONTACT', new Date(now.getTime() - A_DAY + 1)),
            asRead(early, 'ACTIVE', due.openedAt),
            asRead(early, 'ENDED', due.openedAt),
          ],
        }),
      expireAlert: (request) => w.store.expireAlert(request),
    };
    await jumpTo(w, now.getTime());
    const asked = w.store.expireRequests().length;

    const swept = await createWatchdog({ journeys: drifted, beats: w.beats, log: w.log }).sweep();

    expect(swept.ok).toBe(true);
    expect(w.store.expireRequests().slice(asked)).toEqual([{ alertId: due.alertId }]);
    expect(w.store.endOf(due.journeyId).endReason).toBe(EXPIRED);
    expect(w.store.endOf(early.journeyId).endReason).toBeNull();
    expect(expiryLines(w)).toEqual([]);
  });

  test('LOST-08-AC10: the sweep’s result keeps exactly its four fields, ok, opened, escalated and stuck, a sweep that ended a journey at 24 hours included: how many ended is read from the store (SM-06)', async () => {
    const w = world();
    const { openedAt } = await lost(w, 2);
    await jumpTo(w, dayAfter(openedAt));

    const swept = await w.watchdog.sweep();

    expect(Object.keys(swept).sort()).toEqual(['escalated', 'ok', 'opened', 'stuck']);
  });

  test('LOST-08-AC10: the expiry run on its own answers ok, how many it ended and how many are stuck, and writes no line for a success (SM-06)', async () => {
    const w = world();
    const first = await lost(w, 2);
    const second = await lost(w, 1);
    // The third opened a minute later: still under its 24 hours below.
    w.clock.advance(MINUTE);
    const young = await lost(w, 1);
    await jumpTo(w, dayAfter(first.openedAt));
    const expiry = createExpiry({ journeys: w.store, log: w.log });

    expect(await expiry.expireDue()).toEqual({ ok: true, expired: 2, stuck: 0 });
    expect(await expiry.expireDue()).toEqual({ ok: true, expired: 0, stuck: 0 });

    expect(w.store.endOf(first.journeyId).endReason).toBe(EXPIRED);
    expect(w.store.endOf(second.journeyId).endReason).toBe(EXPIRED);
    expect(w.stateOf(young.journeyId)).toBe('LOST_CONTACT');
    expect(w.log.events).toEqual([]);
  });

  test('LOST-08-AC10: the expiry run on its own counts a journey ended on its waiting attempt among those it ended: of two alerts 30 s past their 24 hours, one ended at its first attempt and one whose row is let go within the wait, the run answers ok, expired 2, stuck 0, and writes no line (SM-06)', async () => {
    // LOST-08 review loop 1 (safety-reviewer's note): nothing read the count
    // the waiting attempts add to, so a run that dropped it, or took one
    // away, answered as this one does.
    const w = world();
    const first = await lost(w, 2);
    w.clock.advance(SECOND);
    const second = await lost(w, 3);
    await jumpTo(w, dayAfter(second.openedAt, STUCK_AFTER));
    w.store.holdUntilWaited(second.journeyId);
    const asked = w.store.expireRequests().length;
    const expiry = createExpiry({ journeys: w.store, log: w.log });

    expect(await expiry.expireDue()).toEqual({ ok: true, expired: 2, stuck: 0 });

    expect(w.store.expireRequests().slice(asked)).toEqual([
      { alertId: first.alertId },
      { alertId: second.alertId },
      { alertId: second.alertId, lockWaitMs: LOCK_WAIT },
    ]);
    expect(w.store.endOf(first.journeyId).endReason).toBe(EXPIRED);
    expect(w.store.endOf(second.journeyId).endReason).toBe(EXPIRED);
    expect(w.log.events).toEqual([]);
  });

  test('LOST-08-AC16: with the fake failing the expiry’s write, nothing changes — J, A and every message as they were — and the run fails, saying so in one line; once the store answers, the same run does all of its work (SM-06)', async () => {
    const w = world();
    const { walker, responders, journeyId, alertId, openedAt } = await lost(w, 3);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    await jumpTo(w, dayAfter(openedAt));
    const before = snapshot(w, [journeyId]);
    const expiry = createExpiry({ journeys: w.store, log: w.log });
    w.store.failWith(databaseError('23514'), 'expireAlert');

    expect(await expiry.expireDue()).toEqual({ ok: false, expired: 0, stuck: 0 });
    expect(w.log.events).toEqual([{ event: 'expiry_failed', stage: 'expire', code: '23514' }]);
    expect(snapshot(w, [journeyId])).toEqual(before);

    w.store.recover();
    const at = await w.clock.now();
    expect(await expiry.expireDue()).toEqual({ ok: true, expired: 1, stuck: 0 });
    expectExpired(w, { journeyId, alertId, walker, told: responders, at });
  });

  test('LOST-08-AC16: with the fake failing the expiry’s read, the run fails with one expiry_failed line, stage read, and nothing changes (SM-06)', async () => {
    const w = world();
    const { journeyId, openedAt } = await lost(w, 2);
    await jumpTo(w, dayAfter(openedAt));
    const before = snapshot(w, [journeyId]);
    w.store.failWith(databaseError('08006'), 'alertsDueForExpiry');

    expect(await createExpiry({ journeys: w.store, log: w.log }).expireDue()).toEqual({
      ok: false,
      expired: 0,
      stuck: 0,
    });
    expect(w.log.events).toEqual([{ event: 'expiry_failed', stage: 'read', code: '08006' }]);
    expect(snapshot(w, [journeyId])).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC11: the 24-hour end decides under the journey's row.
// ---------------------------------------------------------------------------

/** What holds J's row as the 24-hour end arrives, and how J and A are then left. */
const ROW_HOLDERS = [
  { holder: 'commits having changed nothing', resolution: EXPIRED, state: 'ENDED' },
  { holder: 'brings contact back', resolution: 'BACK_IN_CONTACT', state: 'ACTIVE' },
  { holder: 'says "I’m home"', resolution: 'HOME', state: 'ENDED' },
  { holder: 'closes A', resolution: SAFE, state: 'ENDED' },
  { holder: 'removes R3', resolution: EXPIRED, state: 'ENDED' },
] as const;

type RowHolder = (typeof ROW_HOLDERS)[number]['holder'];

/** The stand-down kinds, one per resolution (D-112). */
const STAND_DOWNS: readonly string[] = ['BACK_IN_CONTACT', 'HOME', SAFE, EXPIRED];

describe('LOST-08, SM-06 and SM-09: the 24-hour end decides under the journey’s row', () => {
  test.each(ROW_HOLDERS)(
    'LOST-08-AC11: A past its 24 hours and 30 s, J’s row held by a transaction that $holder; the sweep skips it, waits for it once, and decides as the holder left J: J $state, A resolved $resolution, once; one set of stand-downs, of that one resolution, the sweep ok (SM-06, SM-09)',
    async ({ holder, resolution, state }) => {
      const w = world();
      const { walker, journeyId, alertId, openedAt, responders } = await lost(w, 3);
      const [r1, , r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
      expect((await w.acknowledge(r1, alertId)).status).toBe(200);
      await jumpTo(w, dayAfter(openedAt, STUCK_AFTER));
      const run: Record<RowHolder, () => Promise<unknown>> = {
        'commits having changed nothing': () => Promise.resolve(),
        'brings contact back': () => w.heartbeat(walker, journeyId),
        'says "I’m home"': async () => {
          expect((await w.home(walker, journeyId)).status).toBe(200);
        },
        'closes A': async () => {
          expect((await w.close(r1, alertId)).status).toBe(200);
        },
        'removes R3': async () => {
          expect(await w.remove(journeyId, r3.userId)).toEqual({ type: 'removed' });
        },
      };
      w.store.holdUntilWaited(journeyId, async () => {
        await run[holder]();
      });

      const swept = await w.watchdog.sweep();

      expect(swept).toEqual(QUIET_SWEEP);
      expect(expiryLines(w)).toEqual([]);
      expect(w.stateOf(journeyId)).toBe(state);
      const alerts = w.alertsOf(journeyId);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ state: 'RESOLVED', resolution });
      const standDowns = w
        .messagesOf(journeyId)
        .filter((message) => STAND_DOWNS.includes(message.kind));
      expect(new Set(standDowns.map(({ kind }) => kind))).toEqual(new Set([resolution]));
      const told =
        resolution === SAFE
          ? responders.slice(1)
          : holder === 'removes R3'
            ? responders.slice(0, 2)
            : responders;
      expect(recipientsOf(standDowns)).toEqual(idsOf(told));
      if (state === 'ENDED') {
        expect(w.store.endOf(journeyId)).toEqual({
          endedAt: alerts[0]?.resolvedAt,
          endReason: resolution,
        });
      }
    },
  );

  test.each(['a fresh heartbeat', '"I’m home"', 'R1’s close', 'R3’s removal'] as const)(
    'LOST-08-AC11: the other order: %s, past its read, meets J’s row held by the sweep, which ends J at 24 hours and commits first; it then finds J ENDED, EXPIRED, and changes nothing: one resolution, one end, one set of EXPIRED (SM-06, SM-09, SM-07)',
    async (other) => {
      const w = world();
      const { walker, journeyId, alertId, openedAt, responders } = await lost(w, 3);
      const [r1, , r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
      expect((await w.acknowledge(r1, alertId)).status).toBe(200);
      await jumpTo(w, dayAfter(openedAt));
      w.store.hold(journeyId);
      const call = {
        'a fresh heartbeat': 'recordHeartbeat',
        '"I’m home"': 'recordHome',
        'R1’s close': 'recordClosure',
        'R3’s removal': 'removeResponder',
      }[other];
      const pending: Promise<unknown> =
        other === 'a fresh heartbeat'
          ? w.heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }))
          : other === '"I’m home"'
            ? w.home(walker, journeyId)
            : other === 'R1’s close'
              ? w.close(r1, alertId)
              : w.remove(journeyId, r3.userId);
      await until(() => w.store.calls.includes(call as never), `${other} reaching the store`);

      await w.store.commitHold(journeyId, async () => {
        expect(await w.watchdog.sweep()).toEqual(QUIET_SWEEP);
      });
      const result = await pending;

      if (other === 'R3’s removal') {
        expect(result).toEqual({ type: 'ignored', reason: 'JOURNEY_ENDED' });
      } else {
        const answer = result as Answer;
        expect({ status: answer.status, code: codeOf(answer) }).toEqual({
          status: 409,
          code: other === 'R1’s close' ? 'ALERT_RESOLVED' : 'JOURNEY_ENDED',
        });
      }
      expect(w.stateOf(journeyId)).toBe('ENDED');
      expect(w.store.endOf(journeyId).endReason).toBe(EXPIRED);
      expect(w.alertsOf(journeyId)).toMatchObject([{ state: 'RESOLVED', resolution: EXPIRED }]);
      expect(w.respondersOf(journeyId)).toEqual(idsOf(responders));
      const standDowns = w
        .messagesOf(journeyId)
        .filter((message) => STAND_DOWNS.includes(message.kind));
      expect(standDowns.map(({ kind }) => kind)).toEqual([EXPIRED, EXPIRED, EXPIRED]);
      expect(recipientsOf(standDowns)).toEqual(idsOf(responders));
    },
  );
});

// ---------------------------------------------------------------------------
// LOST-08-AC12: SM-05. The roadmap's second half at L6.
// ---------------------------------------------------------------------------

describe('SM-05 and SM-06: nothing automatic ends a lost-contact journey before 24 hours, and the two-hour stop never ends one', () => {
  test('LOST-08-AC12: (SM-05, SM-06) W starts J through the API and D goes silent; J LOST_CONTACT from five minutes, nobody acknowledging; swept at two hours, two hours ten minutes, every hour after, and one millisecond short of 24 hours after A’s opening: J LOST_CONTACT every time, A unresolved, J’s ended_at and end reason null; A escalated once, at two minutes', async () => {
    const w = world();
    const { journeyId, alertId, openedAt } = await startedAndLost(w, 3);
    await w.runUntil(openedAt.getTime() + 3 * MINUTE);
    const escalatedAt = w.alertOf(alertId).smsRaisedAt;
    expect(escalatedAt).toEqual(new Date(openedAt.getTime() + TWO_MINUTES));
    const moments = [2 * HOUR, 2 * HOUR + 10 * MINUTE];
    for (let hours = 3; hours < 24; hours += 1) {
      moments.push(hours * HOUR);
    }
    moments.push(A_DAY - 1);
    const seen: { at: number; state: unknown; resolution: unknown; end: unknown; ok: boolean }[] =
      [];

    for (const moment of moments) {
      await jumpTo(w, openedAt.getTime() + moment);
      const { swept } = await w.runLoops();
      seen.push({
        at: moment,
        state: w.stateOf(journeyId),
        resolution: w.alertOf(alertId).resolution,
        end: w.store.endOf(journeyId),
        ok: swept.ok,
      });
    }

    expect(seen).toEqual(
      moments.map((at) => ({
        at,
        state: 'LOST_CONTACT',
        resolution: null,
        end: { endedAt: null, endReason: null },
        ok: true,
      })),
    );
    expect(w.alertsOf(journeyId)).toHaveLength(1);
    expect(w.alertOf(alertId)).toMatchObject({ state: 'ESCALATED', smsRaisedAt: escalatedAt });
    expect(ofKind(w.messagesOf(journeyId), SMS)).toHaveLength(3);
    expect(ofKind(w.messagesOf(journeyId), EXPIRED)).toEqual([]);
  });

  test('LOST-08-AC12: (SM-05) an ACTIVE journey with a heartbeat every minute for three hours is never ended by any sweep: the loops run every 10 s, and J is ACTIVE with no alert, no end and no message throughout', async () => {
    const w = world();
    const walker = w.walker();
    const responders = [w.responder(), w.responder()];
    const journeyId = await w.start(walker, idsOf(responders));
    const states = new Set<unknown>();

    for (let second = 0; second < 3 * 60 * 60; second += 10) {
      if (second % 60 === 0) {
        await w.heartbeat(walker, journeyId);
      }
      const { swept } = await w.runLoops();
      expect(swept.ok).toBe(true);
      states.add(w.stateOf(journeyId));
      w.clock.advance(INTERVAL);
    }

    expect([...states]).toEqual(['ACTIVE']);
    expect(w.store.endOf(journeyId)).toEqual({ endedAt: null, endReason: null });
    expect(w.alertsOf(journeyId)).toEqual([]);
    expect(w.store.outbox()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC13: SM-06's three ends, each end to end.
// ---------------------------------------------------------------------------

describe('SM-06, SM-04 and LOST-03: a lost-contact journey ends in exactly three ways, and the end is the one the retention rule counts from', () => {
  test.each([
    'D reconnects and sends "I’m home"',
    'the acknowledger closes',
    '24 hours pass',
  ] as const)(
    'LOST-08-AC13: (SM-06) J LOST_CONTACT, A acknowledged by R1; %s: J ENDED with its end reason, ended_at set at the transaction’s now and equal to A’s resolved_at (SM-04, LOST-03)',
    async (how) => {
      const w = world();
      const { walker, responders, journeyId, alertId, openedAt } = await startedAndLost(w, 2);
      const [r1] = responders as [RegisteredDevice, RegisteredDevice];
      expect((await w.acknowledge(r1, alertId)).status).toBe(200);
      let reason: string;
      if (how === 'D reconnects and sends "I’m home"') {
        w.clock.advance(20 * MINUTE);
        const answer = await w.home(walker, journeyId);
        expect({ status: answer.status, body: answer.body }).toEqual({
          status: 200,
          body: { outcome: 'ENDED' },
        });
        reason = 'HOME';
      } else if (how === 'the acknowledger closes') {
        w.clock.advance(20 * MINUTE);
        expect((await w.close(r1, alertId)).status).toBe(200);
        reason = SAFE;
      } else {
        await jumpTo(w, dayAfter(openedAt));
        expect((await w.watchdog.sweep()).ok).toBe(true);
        reason = EXPIRED;
      }
      const at = await w.clock.now();

      expect(w.stateOf(journeyId)).toBe('ENDED');
      expect(w.store.endOf(journeyId)).toEqual({ endedAt: at, endReason: reason });
      expect(w.alertOf(alertId)).toMatchObject({
        state: 'RESOLVED',
        resolution: reason,
        resolvedAt: at,
      });
    },
  );

  test('LOST-08-AC13: (SM-06) a fresh heartbeat brings J back to ACTIVE and ends nothing: A RESOLVED, BACK_IN_CONTACT, and J’s ended_at and end reason null (SM-04, LOST-03)', async () => {
    const w = world();
    const { walker, journeyId, alertId } = await startedAndLost(w, 2);

    await w.heartbeat(walker, journeyId);

    expect(w.stateOf(journeyId)).toBe('ACTIVE');
    expect(w.store.endOf(journeyId)).toEqual({ endedAt: null, endReason: null });
    expect(w.alertOf(alertId)).toMatchObject({ state: 'RESOLVED', resolution: 'BACK_IN_CONTACT' });
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC17 and AC18: the store's time; nothing personal in a log.
// ---------------------------------------------------------------------------

describe('LOST-08, SM-06 and REL-01: the 24-hour end’s time is the store’s', () => {
  test('LOST-08-AC17: on the fake clock, the 24 hours are counted by the store’s now against the alert’s opening: an alert opened 24 hours less 1 s ago is not ended, one opened 24 hours ago is; ended_at, resolved_at, every withdrawal and every EXPIRED’s created_at are that now; the expiry is handed no clock (SM-06, REL-01)', async () => {
    const w = world();
    const older = await lost(w, 2);
    w.clock.advance(SECOND);
    const younger = await lost(w, 2);
    await jumpTo(w, dayAfter(older.openedAt));
    const at = await w.clock.now();
    // The expiry is made from the store and the log alone (AR-03).
    const expiry = createExpiry({ journeys: w.store, log: w.log });

    expect(await expiry.expireDue()).toEqual({ ok: true, expired: 1, stuck: 0 });

    expect(w.store.endOf(older.journeyId)).toEqual({ endedAt: at, endReason: EXPIRED });
    expect(w.alertOf(older.alertId).resolvedAt).toEqual(at);
    const withdrawn = w
      .messagesOf(older.journeyId)
      .filter(({ withdrawnAt }) => withdrawnAt !== null);
    expect(withdrawn.length).toBeGreaterThan(0);
    for (const message of withdrawn) {
      expect(message.withdrawnAt, message.kind).toEqual(at);
    }
    for (const message of ofKind(w.messagesOf(older.journeyId), EXPIRED)) {
      expect(message.createdAt).toEqual(at);
    }
    expect(w.stateOf(younger.journeyId)).toBe('LOST_CONTACT');
    expect(at.getTime() - younger.openedAt.getTime()).toBe(A_DAY - SECOND);
  });
});

describe('PRIV-07 and LOST-08: nothing personal reaches a log from the 24-hour end', () => {
  test('LOST-08-AC18: when the store fails the expiry’s read and its write with errors whose messages hold a synthetic coordinate, a phone-number-shaped string, a credential-like string and a responder’s and the walker’s IDs, nothing written to stdout, stderr or the console holds any of them; the capture sees the lines the production log wrote, and the errors do hold the markers', async () => {
    const w = world({ log: createLog() });
    const { walker, responders, openedAt } = await lost(w, 2);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice];
    const coordinate = String(syntheticCoordinate());
    // Phone-number-shaped, made at run time and never in +47 form: eight
    // digits with a leading 0, which no Norwegian subscriber number has.
    const numberShaped = `0${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
    const credential = `postgres://synthetic:${syntheticCredential()}@127.0.0.1:1/synthetic`;
    const markers = [coordinate, numberShaped, credential, r1.userId, walker.userId];
    const thrown: Error[] = [];
    const failing = (code: string) => {
      const error = databaseError(
        code,
        `failed near (${coordinate}) for ${numberShaped} as ${credential} ending ${walker.userId}'s journey for ${r1.userId}`,
      );
      thrown.push(error);
      return error;
    };
    await jumpTo(w, dayAfter(openedAt));

    const { written } = await captured(async () => {
      w.store.failWith(failing('57P01'), 'alertsDueForExpiry');
      await w.watchdog.sweep();
      w.store.recover();
      w.store.failWith(failing('40P01'), 'expireAlert');
      await w.watchdog.sweep();
      w.store.recover();
    });

    for (const error of thrown) {
      expect(markersIn(error.message, markers)).toEqual(markers);
    }
    expect(written).toContain('"event":"expiry_failed"');
    expect(markersIn(written, markers)).toEqual([]);
  });
});
