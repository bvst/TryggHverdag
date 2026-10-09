// L6 system: "They're safe" (LOST-08, SM-06's first two ends), through the
// whole server in one process.
//
// The real API, the real journey, acknowledgement and closure modules, the
// real removal module, the real watchdog (with the 24-hour end in its sweep),
// the real push sender, the real SMS sender and the real SMS check, with
// fakes only at the edges: the device credentials, the journey store, the
// worker's beats, the push port, the SMS port, the SMS check's monitor and
// the log. One fake clock stands in for the database's now(): the store reads
// it as PostgreSQL's now() would be read. No module reads a clock (AR-03).
// The loops are run here as the worker runs them, every 10 s (D-107).
//
// What is proven here, the roadmap's "done when" for M2's task 8, its first
// half: "the acknowledging responder closes the alert, at L6". SM-06: an
// alert ends when the walker reconnects and says "I'm home", when the
// acknowledger closes it ("They're safe"), or 24 hours after it opened. This
// file holds the close (SAFE); expiry.system.test.ts the 24-hour end
// (EXPIRED) and SM-05:
//   - the acknowledger closes: the alert RESOLVED, SAFE, the journey ENDED,
//     SAFE, every other responder stood down (AC1); nobody else can (AC2), and
//     after a reset nobody can until someone acknowledges again (AC3);
//   - the close decides under the journey's row, against contact coming
//     back, "I'm home", a removal and the 24-hour end, in both orders (AC4);
//   - after it the journey is over for everything that follows, and the
//     walker is free (AC5); what the walker will be shown is on record (AC6);
//   - its stand-downs never overtake what is in a port's hands (AC7); a
//     failure is loud (AC16); its times are the store's (AC17); nothing
//     personal reaches a log (AC18); and a start that races it from outside
//     the walker's phone retries once (AC21).
//
// This file is one of the `alerts` mutation group's test files (the spec's
// Mutation section): the closure module lives in modules/alerts/. Times are
// written out (two minutes, five minutes, 24 hours, 10 s, the 30 s lease),
// not read from the domain's constants, so a wrong constant fails here as
// well as in the domain's own tests.
import {
  RACERS,
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
  syntheticUuid,
  type FakeAlertState,
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
import { createPushSender, createSmsSender } from './modules/alerts/outbox.ts';
import { createSmsCheck } from './modules/alerts/sms-check.ts';
import { createWatchdog } from './modules/alerts/watchdog.ts';
import { createHealthService } from './modules/health/service.ts';
import { createRemovalService } from './modules/journeys/removal.ts';
import { createJourneyService } from './modules/journeys/service.ts';
import type { Log, OutboxStore } from './ports.ts';

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
/** How long a claimed message is leased (LOST-02, approach item 5). */
const LEASE = 30 * SECOND;
/** The longest a stand-down is ever held (LOST-03, D-112): the retry cap. */
const LONGEST_HOLD = 60 * SECOND;

/** A synthetic night: 21:00 UTC on 1 October 2026. */
const START = new Date('2026-10-01T21:00:00.000Z');

const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const LOST = 'LOST_CONTACT';
const SMS = 'LOST_CONTACT_SMS';
const NOTICE = 'ACKNOWLEDGED';
const SAFE = 'SAFE';
const ON_IT = { outcome: 'ACKNOWLEDGED' };
/** "They're safe" answered: the alert closed (LOST-08, approach item 5). */
const CLOSED = { outcome: 'CLOSED' };

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

/** The person with this user ID, among these. */
function whoIs(people: readonly RegisteredDevice[], userId: string | undefined): RegisteredDevice {
  const person = people.find((device) => device.userId === userId);
  if (person === undefined) {
    throw new Error('expected one of the responders');
  }
  return person;
}

/** A push sender whose claim takes at most `limit`: the batch was full, so the rest are left unclaimed. */
function senderOf(w: World, limit: number) {
  const outbox: OutboxStore = {
    claimDue: (request) => w.store.claimDue({ ...request, limit }),
    claimDueSms: (request: { limit: number; leaseMs: number }) => w.store.claimDueSms(request),
    markSent: (messageId) => w.store.markSent(messageId),
    markFailed: (request) => w.store.markFailed(request),
    unsentSmsCount: (olderThanMs: number) => w.store.unsentSmsCount(olderThanMs),
    unheardAlertCount: () => w.store.unheardAlertCount(),
  };
  return createPushSender({ outbox, push: w.push, log: w.log });
}

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

/**
 * As `lost`, every lost-contact push delivered, then the first responder, R1,
 * on it through the API a minute after the opening: the alert ACKNOWLEDGED by
 * R1, one unsent ACKNOWLEDGED notice for each other responder.
 */
async function acknowledged(w: World, count = 3) {
  const alerted = await lost(w, count);
  await w.sender.deliverDue();
  w.clock.advance(MINUTE);
  const [r1] = alerted.responders as [RegisteredDevice, ...RegisteredDevice[]];
  const answer = await w.acknowledge(r1, alerted.alertId);
  expect({ status: answer.status, body: answer.body }, 'R1 on it').toEqual({
    status: 200,
    body: ON_IT,
  });
  return { ...alerted, r1, others: alerted.responders.slice(1) };
}

/**
 * A LOST_CONTACT journey of a new walker and its one alert, put in directly in
 * `state`, opened `openedAgoMs` before the clock's now (a minute unless told
 * otherwise); `recorded`, its first responder on it since then.
 */
async function seededAlert(
  w: World,
  {
    state,
    recorded,
    openedAgoMs = MINUTE,
    count = 3,
  }: { state: FakeAlertState; recorded: boolean; openedAgoMs?: number; count?: number },
) {
  const walker = w.walker();
  const responders = Array.from({ length: count }, () => w.responder());
  const now = await w.clock.now();
  const openedAt = new Date(now.getTime() - openedAgoMs);
  const silentSince = new Date(openedAt.getTime() - FIVE_MINUTES);
  const journeyId = w.store.seed({
    walkerId: walker.userId,
    deviceId: walker.deviceId,
    state: 'LOST_CONTACT',
    responderIds: idsOf(responders),
    startedAt: new Date(silentSince.getTime() - HOUR),
    lastHeartbeatAt: silentSince,
  });
  const [r1] = responders as [RegisteredDevice, ...RegisteredDevice[]];
  const alertId = w.store.seedAlert({
    journeyId,
    state,
    openedAt,
    silentSince,
    ...(recorded ? { acknowledgedBy: r1.userId, acknowledgedAt: openedAt } : {}),
    ...(state === 'ESCALATED' ? { smsRaisedAt: openedAt } : {}),
  });
  return { walker, responders, r1, journeyId, alertId, openedAt };
}

/** The IDs the system holds of these people and this journey: none may travel in a message's ID. */
function idsHeld(w: World, journeyId: string, people: readonly RegisteredDevice[]) {
  return [
    journeyId,
    ...w.alertsOf(journeyId).map(({ id }) => id),
    ...people.flatMap(({ userId, deviceId }) => [userId, deviceId]),
  ];
}

// ---------------------------------------------------------------------------
// LOST-08-AC1: the acknowledger closes. The roadmap's first half at L6.
// ---------------------------------------------------------------------------

describe('LOST-08 and SM-06: the acknowledger closes, the alert resolves SAFE, the journey ends SAFE, and the others are told', () => {
  test('LOST-08-AC1: W starts J through the API with R1, R2 and R3, D goes silent and at five minutes the alert A opens, every lost-contact push accepted; a minute later R1 says "I’m on it", R2’s ACKNOWLEDGED accepted and R3’s not yet claimed; R1 closes A: 200 CLOSED; A RESOLVED, SAFE, at the store’s now, acknowledged_by still R1; J ENDED, SAFE, ended_at equal to A’s resolved_at; one SAFE each for R2 and R3 in A’s round, none for R1 or W; R3’s notice withdrawn at that now; the next delivery hands each SAFE to the push fake with exactly messageId, recipientId and kind; nothing reaches the SMS fake (SM-06)', async () => {
    const w = world();
    const { walker, responders, journeyId, alertId } = await startedAndLost(w, 3);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    expect(recipientsOf(ofKind(w.push.accepted, LOST))).toEqual(idsOf(responders));
    w.clock.advance(MINUTE);
    const onIt = await w.acknowledge(r1, alertId);
    expect({ status: onIt.status, body: onIt.body }).toEqual({ status: 200, body: ON_IT });
    // A claim of one: the batch was full when the second notice was due.
    await senderOf(w, 1).deliverDue();
    const notices = ofKind(w.messagesOf(journeyId), NOTICE);
    const sentNotice = notices.find(({ sentAt }) => sentAt !== null);
    const unclaimedNotice = notices.find(
      ({ sentAt, attempts }) => sentAt === null && attempts === 0,
    );
    const r2 = whoIs(responders, sentNotice?.recipientId);
    const r3 = whoIs(responders, unclaimedNotice?.recipientId);
    expect(idsOf([r1, r2, r3])).toEqual(idsOf(responders));
    const alertBefore = w.alertOf(alertId);
    expect(alertBefore).toMatchObject({ state: 'ACKNOWLEDGED', acknowledgedBy: r1.userId });
    w.clock.advance(5 * SECOND);
    const closedAt = await w.clock.now();

    const answer = await w.close(r1, alertId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: CLOSED });
    expect(w.alertOf(alertId)).toEqual({
      ...alertBefore,
      state: 'RESOLVED',
      resolution: SAFE,
      resolvedAt: closedAt,
    });
    expect(w.stateOf(journeyId)).toBe('ENDED');
    expect(w.store.endOf(journeyId)).toEqual({ endedAt: closedAt, endReason: SAFE });
    expect(w.store.endOf(journeyId).endedAt).toEqual(w.alertOf(alertId).resolvedAt);
    // One SAFE each for R2 and R3, in A's round; none for R1, the closer, or W.
    const safes = ofKind(w.messagesOf(journeyId), SAFE);
    expect(recipientsOf(safes)).toEqual(idsOf([r2, r3]));
    for (const message of safes) {
      expect(message, message.recipientId).toMatchObject({
        createdAt: closedAt,
        nextAttemptAt: closedAt,
        attempts: 0,
        sentAt: null,
        withdrawnAt: null,
      });
      expect(w.rounds().get(message.messageId), 'in A’s round').toBe(w.roundOf(alertId));
    }
    expect(w.roundOf(alertId)).toBe(1);
    expect(
      w.store.outbox().filter(({ recipientId }) => recipientId === walker.userId),
      'nothing for W',
    ).toEqual([]);
    // R3's unsent notice withdrawn at the close's now; R2's, sent, as it was.
    expect(ofKind(w.messagesOf(journeyId), NOTICE)).toEqual(
      expect.arrayContaining([{ ...unclaimedNotice, withdrawnAt: closedAt }, { ...sentNotice }]),
    );
    expect(w.closureLines()).toEqual([]);

    await w.sender.deliverDue();
    await w.smsSender.deliverDue();

    const handed = ofKind(w.push.accepted, SAFE);
    expect(recipientsOf(handed)).toEqual(idsOf([r2, r3]));
    const held = idsHeld(w, journeyId, [walker, ...responders]);
    for (const message of handed) {
      expect(Object.keys(message).sort()).toEqual(['kind', 'messageId', 'recipientId']);
      expect(message.messageId).toMatch(LOWER_UUID);
      expect(held, 'a message ID of its own').not.toContain(message.messageId);
    }
    expect(new Set(handed.map(({ messageId }) => messageId)).size).toBe(handed.length);
    expect(w.sms.messages).toEqual([]);
  });

  test('LOST-08-AC1: with R1 the journey’s only responder, the close is 200 CLOSED, A RESOLVED SAFE and J ENDED SAFE, and no SAFE is written: there is nobody else to tell (SM-06)', async () => {
    const w = world();
    const { journeyId, alertId, r1 } = await acknowledged(w, 1);
    const closedAt = await w.clock.now();

    const answer = await w.close(r1, alertId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: CLOSED });
    expect(w.alertOf(alertId)).toMatchObject({
      state: 'RESOLVED',
      resolution: SAFE,
      resolvedAt: closedAt,
      acknowledgedBy: r1.userId,
    });
    expect(w.store.endOf(journeyId)).toEqual({ endedAt: closedAt, endReason: SAFE });
    expect(ofKind(w.messagesOf(journeyId), SAFE)).toEqual([]);
  });

  test('LOST-08-AC1: the close withdraws the alert’s unsent WITHDRAWN_WHEN_RESOLVED kinds at its now — here the three lost-contact pushes never claimed and the two notices — and leaves every other journey’s messages as they were (SM-06, D-111)', async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, 3);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    const other = await lost(w, 2);
    // R1 on it with every lost-contact push still unsent.
    const onIt = await w.acknowledge(r1, alertId);
    expect(onIt.status).toBe(200);
    const otherBefore = w.recordOf(other.journeyId);
    w.clock.advance(SECOND);
    const closedAt = await w.clock.now();

    expect((await w.close(r1, alertId)).status).toBe(200);

    const withdrawable = w
      .messagesOf(journeyId)
      .filter(({ kind }) => kind === LOST || kind === NOTICE || kind === SMS);
    expect(withdrawable.map(({ kind }) => kind).sort()).toEqual(
      [LOST, LOST, LOST, NOTICE, NOTICE].sort(),
    );
    for (const message of withdrawable) {
      expect(message.withdrawnAt, `${message.kind} for ${message.recipientId}`).toEqual(closedAt);
    }
    expect(w.recordOf(other.journeyId)).toEqual(otherBefore);
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC2: only the current acknowledger may close.
// ---------------------------------------------------------------------------

describe('LOST-08, LOST-06 and SEC-07: only the current acknowledger may close; every other caller is refused and nothing is written', () => {
  test('LOST-08-AC2: R2 closes A, acknowledged by R1: 403 NOT_THE_ACKNOWLEDGER, the fixed body with no data, saying nothing of who is on it; the same body for R3; nothing changes, no line is written, and the store is asked only to read (LOST-06)', async () => {
    const w = world();
    const { journeyId, alertId, r1, others } = await acknowledged(w, 3);
    const [r2, r3] = others as [RegisteredDevice, RegisteredDevice];
    const before = w.recordOf(journeyId);
    const callsBefore = w.store.calls.length;

    const refused = await w.close(r2, alertId);

    expect(refused.status).toBe(403);
    expect(codeOf(refused)).toBe('NOT_THE_ACKNOWLEDGER');
    expect(refused.body).not.toHaveProperty('data');
    expect(
      markersIn(`${refused.text}\n${refused.headers}`, [r1.userId, alertId, journeyId]),
    ).toEqual([]);
    expect(w.store.calls.slice(callsBefore)).toEqual(['alertForClosure']);
    expect((await w.close(r3, alertId)).text).toBe(refused.text);
    expect(w.recordOf(journeyId)).toEqual(before);
    expect(w.log.events).toEqual([]);
  });

  test('LOST-08-AC2: W’s own device, a user who follows only another journey, and R1 for an alert ID no alert has each get 404 ALERT_NOT_FOUND with one and the same body, decided by the plain read alone; nothing changes and no line is written (SEC-07)', async () => {
    const w = world();
    const { walker, journeyId, alertId, r1 } = await acknowledged(w, 2);
    const elsewhere = w.responder();
    await w.seed(w.walker(), [elsewhere.userId], { silentForMs: MINUTE });
    const otherWalker = w.walker();
    const before = w.recordOf(journeyId);
    const answers: Answer[] = [];

    for (const [who, request] of [
      ['W’s own device', () => w.close(walker, alertId)],
      ['a user who follows only another journey', () => w.close(elsewhere, alertId)],
      ['another walker', () => w.close(otherWalker, alertId)],
      ['R1, for an alert ID no alert has', () => w.close(r1, syntheticUuid())],
    ] as const) {
      const callsBefore = w.store.calls.length;
      const answer = await request();

      expect({ status: answer.status, code: codeOf(answer) }, who).toEqual({
        status: 404,
        code: 'ALERT_NOT_FOUND',
      });
      expect(answer.body, who).not.toHaveProperty('data');
      expect(w.store.calls.slice(callsBefore), who).toEqual(['alertForClosure']);
      expect(markersIn(`${answer.text}\n${answer.headers}`, [alertId, journeyId]), who).toEqual([]);
      answers.push(answer);
    }
    for (const answer of answers) {
      expect(answer.text).toBe(answers[0]?.text);
    }
    expect(w.recordOf(journeyId)).toEqual(before);
    expect(w.log.events).toEqual([]);
  });

  test('LOST-08-AC2: with A OPEN, then ESCALATED, and nobody recorded, every responder’s close is 403 NOT_THE_ACKNOWLEDGER and nothing changes: nobody is on it, so nobody can silence the others (LOST-06, LOST-07)', async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, 3);

    for (const state of ['OPEN', 'ESCALATED'] as const) {
      if (state === 'ESCALATED') {
        w.clock.advance(TWO_MINUTES);
        expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, escalated: 1 });
      }
      expect(w.alertOf(alertId).state).toBe(state);
      const before = w.recordOf(journeyId);
      for (const responder of responders) {
        const answer = await w.close(responder, alertId);
        expect({ status: answer.status, code: codeOf(answer) }, state).toEqual({
          status: 403,
          code: 'NOT_THE_ACKNOWLEDGER',
        });
      }
      expect(w.recordOf(journeyId), state).toEqual(before);
    }
    expect(w.log.events).toEqual([]);
  });

  test.each([
    { state: 'OPEN', recorded: true },
    { state: 'ESCALATED', recorded: true },
    { state: 'ACKNOWLEDGED', recorded: false },
  ] as const)(
    'LOST-08-AC2: both halves are read: with A put in directly as $state and R1 recorded $recorded, R1’s close is 403 NOT_THE_ACKNOWLEDGER and nothing changes (LOST-06)',
    async ({ state, recorded }) => {
      const w = world();
      const { r1, journeyId, alertId } = await seededAlert(w, { state, recorded });
      const before = w.recordOf(journeyId);

      const answer = await w.close(r1, alertId);

      expect({ status: answer.status, code: codeOf(answer) }).toEqual({
        status: 403,
        code: 'NOT_THE_ACKNOWLEDGER',
      });
      expect(w.recordOf(journeyId)).toEqual(before);
      expect(w.log.events).toEqual([]);
    },
  );

  test.each([
    'contact coming back',
    '"I’m home"',
    'the 24-hour end',
    'an earlier close by R1',
  ] as const)(
    'LOST-08-AC2: A acknowledged by R1 and resolved by %s: R1’s close is 409 ALERT_RESOLVED, with no data, and one closure_ignored line names A and the reason; R2’s is 409 too, with its own line; nothing changes, and the store is asked only to read (LOST-06, SM-07)',
    async (how) => {
      const w = world();
      const { walker, journeyId, alertId, r1, others } = await acknowledged(w, 3);
      const [r2] = others as [RegisteredDevice, RegisteredDevice];
      if (how === 'contact coming back') {
        await w.heartbeat(walker, journeyId);
      } else if (how === '"I’m home"') {
        expect((await w.home(walker, journeyId)).status).toBe(200);
      } else if (how === 'the 24-hour end') {
        w.clock.advance(A_DAY);
        expect((await w.watchdog.sweep()).ok).toBe(true);
      } else {
        expect((await w.close(r1, alertId)).status).toBe(200);
      }
      expect(w.alertOf(alertId).state, 'resolved').toBe('RESOLVED');
      expect(w.closureLines()).toEqual([]);
      const before = w.recordOf(journeyId);
      const callsBefore = w.store.calls.length;

      const over = await w.close(r1, alertId);

      expect(over.status).toBe(409);
      expect(codeOf(over)).toBe('ALERT_RESOLVED');
      expect(over.body).not.toHaveProperty('data');
      expect(w.store.calls.slice(callsBefore)).toEqual(['alertForClosure']);
      expect(w.closureLines()).toEqual([
        { event: 'closure_ignored', reason: 'ALERT_RESOLVED', alertId },
      ]);
      const again = await w.close(r2, alertId);
      expect({ status: again.status, text: again.text }).toEqual({ status: 409, text: over.text });
      expect(w.closureLines()).toEqual([
        { event: 'closure_ignored', reason: 'ALERT_RESOLVED', alertId },
        { event: 'closure_ignored', reason: 'ALERT_RESOLVED', alertId },
      ]);
      expect(w.recordOf(journeyId)).toEqual(before);
    },
  );

  test('LOST-08-AC2: with no credential, or one no device has, the close is 401 UNAUTHORIZED, the store is never asked about the alert, and nothing changes', async () => {
    const w = world();
    const { journeyId, alertId, r1 } = await acknowledged(w, 2);
    const before = w.recordOf(journeyId);
    const unknown = syntheticCredential();
    const callsBefore = w.store.calls.length;

    const none = await w.close(r1, alertId, { credential: null });
    const stranger = await w.close(r1, alertId, { credential: unknown });

    for (const answer of [none, stranger]) {
      expect(answer.status).toBe(401);
      expect(codeOf(answer)).toBe('UNAUTHORIZED');
      expect(answer.text).not.toContain(alertId);
    }
    expect(stranger.text).not.toContain(unknown);
    expect(w.store.calls.slice(callsBefore)).toEqual([]);
    expect(w.recordOf(journeyId)).toEqual(before);
  });

  test('LOST-08-AC2: an alert ID that is not a UUID, or a body holding any key — an alertId naming another alert included — is the one fixed 400, with no data; the alert is not closed, nothing changes and no line is written (SEC-07)', async () => {
    const w = world();
    const { walker, journeyId, alertId, r1 } = await acknowledged(w, 2);
    const other = await acknowledged(w, 1);
    const before = [w.recordOf(journeyId), w.recordOf(other.journeyId)];
    // The fixed 400 every route answers, as the heartbeat route answers it.
    const fixed = await w.heartbeatAnswer(walker, { journeyId } as unknown as SyntheticHeartbeat);
    expect(fixed.status).toBe(400);

    const refused = [
      await w.close(r1, 'not-a-uuid'),
      await w.close(r1, `${alertId}x`),
      await w.close(r1, alertId, { body: { note: 'synthetic' } }),
      await w.close(r1, alertId, { body: { alertId } }),
      await w.close(r1, alertId, { body: { alertId: other.alertId } }),
      await w.close(r1, alertId, { body: { responderId: r1.userId } }),
      // The path names no alert; a body that named R1's own must not close it.
      await w.close(r1, syntheticUuid(), { body: { alertId } }),
    ];

    for (const [index, answer] of refused.entries()) {
      expect(answer.status, String(index)).toBe(400);
      expect(answer.text, String(index)).toBe(fixed.text);
      expect(answer.body, String(index)).not.toHaveProperty('data');
      expect(answer.text, String(index)).not.toContain(alertId);
      expect(answer.text, String(index)).not.toContain(r1.userId);
    }
    expect([w.recordOf(journeyId), w.recordOf(other.journeyId)]).toEqual(before);
    expect(w.log.events).toEqual([]);
  });

  test('LOST-08-AC2: any of R1’s devices can close: from R1’s second device the close is 200 CLOSED, A RESOLVED SAFE with R1 its acknowledger, and R2 gets the one SAFE', async () => {
    const w = world();
    const { journeyId, alertId, r1, others } = await acknowledged(w, 2);
    const tablet = w.secondDevice(r1);
    expect(tablet.deviceId).not.toBe(r1.deviceId);

    const answer = await w.close(tablet, alertId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: CLOSED });
    expect(w.alertOf(alertId)).toMatchObject({
      state: 'RESOLVED',
      resolution: SAFE,
      acknowledgedBy: r1.userId,
    });
    expect(recipientsOf(ofKind(w.messagesOf(journeyId), SAFE))).toEqual(idsOf(others));
  });

  test('LOST-08-AC2: the alert’s ID in upper case names the same alert: 200 CLOSED, A RESOLVED SAFE', async () => {
    const w = world();
    const { alertId, r1 } = await acknowledged(w, 2);
    expect(alertId).toMatch(LOWER_UUID);
    expect(alertId.toUpperCase()).not.toBe(alertId);

    const answer = await w.close(r1, alertId.toUpperCase());

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: CLOSED });
    expect(w.alertOf(alertId)).toMatchObject({ state: 'RESOLVED', resolution: SAFE });
  });

  test('LOST-08-AC2: no answer says who is on A or who closed it: the 200, the 403, the 404 and the 409 hold no user’s ID, no device’s ID and no journey ID (SEC-07)', async () => {
    const w = world();
    const { walker, journeyId, alertId, r1, others } = await acknowledged(w, 3);
    const [r2] = others as [RegisteredDevice, RegisteredDevice];
    const people = [walker, r1, ...others];
    const markers = [journeyId, ...people.flatMap(({ userId, deviceId }) => [userId, deviceId])];

    const answers = [
      await w.close(r2, alertId),
      await w.close(walker, alertId),
      await w.close(r1, alertId),
      await w.close(r2, alertId),
    ];

    expect(answers.map(({ status }) => status)).toEqual([403, 404, 200, 409]);
    for (const answer of answers) {
      expect(markersIn(`${answer.text}\n${answer.headers}`, markers), answer.text).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC3: after a reset, nobody can close until someone acknowledges again.
// ---------------------------------------------------------------------------

describe('LOST-08 and SM-10: after a reset, nobody can close until someone acknowledges again', () => {
  test('LOST-08-AC3: A acknowledged by R1, and R1 removed through the removal module: R1’s close is 404 ALERT_NOT_FOUND, R2’s and R3’s 403 NOT_THE_ACKNOWLEDGER, nothing changing; R2 says "I’m on it" through the API, then closes A: 200 CLOSED; A RESOLVED, SAFE, acknowledged_by R2; J ENDED, SAFE; one SAFE for R3 alone, in A’s second round, none for R1 or R2 (SM-10)', async () => {
    const w = world();
    const { journeyId, alertId, r1, others } = await acknowledged(w, 3);
    const [r2, r3] = others as [RegisteredDevice, RegisteredDevice];
    expect(await w.remove(journeyId, r1.userId)).toEqual({ type: 'removed' });
    expect(w.alertOf(alertId)).toMatchObject({ state: 'OPEN', acknowledgedBy: null });
    expect(w.roundOf(alertId)).toBe(2);
    const before = w.recordOf(journeyId);

    const removed = await w.close(r1, alertId);
    const second = await w.close(r2, alertId);
    const third = await w.close(r3, alertId);

    expect({ status: removed.status, code: codeOf(removed) }).toEqual({
      status: 404,
      code: 'ALERT_NOT_FOUND',
    });
    for (const answer of [second, third]) {
      expect({ status: answer.status, code: codeOf(answer) }).toEqual({
        status: 403,
        code: 'NOT_THE_ACKNOWLEDGER',
      });
    }
    expect(w.recordOf(journeyId)).toEqual(before);

    expect((await w.acknowledge(r2, alertId)).status).toBe(200);
    w.clock.advance(SECOND);
    const closedAt = await w.clock.now();
    const answer = await w.close(r2, alertId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: CLOSED });
    expect(w.alertOf(alertId)).toMatchObject({
      state: 'RESOLVED',
      resolution: SAFE,
      resolvedAt: closedAt,
      acknowledgedBy: r2.userId,
    });
    expect(w.store.endOf(journeyId)).toEqual({ endedAt: closedAt, endReason: SAFE });
    const safes = ofKind(w.messagesOf(journeyId), SAFE);
    expect(recipientsOf(safes)).toEqual([r3.userId]);
    expect(safes.map(({ messageId }) => w.rounds().get(messageId))).toEqual([2]);
    expect(w.closureLines()).toEqual([]);
  });

  test('LOST-08-AC3: after the reset the first acknowledger again is the only one who can close: R3 acknowledges, R2’s close is 403 and R3’s 200; R2 gets the one SAFE (SM-10)', async () => {
    const w = world();
    const { journeyId, alertId, r1, others } = await acknowledged(w, 3);
    const [r2, r3] = others as [RegisteredDevice, RegisteredDevice];
    expect(await w.remove(journeyId, r1.userId)).toEqual({ type: 'removed' });
    expect((await w.acknowledge(r3, alertId)).status).toBe(200);

    expect((await w.close(r2, alertId)).status).toBe(403);
    expect((await w.close(r3, alertId)).status).toBe(200);

    expect(w.alertOf(alertId)).toMatchObject({ resolution: SAFE, acknowledgedBy: r3.userId });
    expect(recipientsOf(ofKind(w.messagesOf(journeyId), SAFE))).toEqual([r2.userId]);
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC4: the close decides under the journey's row.
// ---------------------------------------------------------------------------

/** What another transaction holding J's row does, and how the close it held up is then answered. */
const HOLDERS = [
  { holder: 'commits having changed nothing', status: 200, code: undefined, kind: SAFE },
  { holder: 'removes R1', status: 404, code: 'ALERT_NOT_FOUND', kind: null },
  {
    holder: 'brings J back in contact',
    status: 409,
    code: 'ALERT_RESOLVED',
    kind: 'BACK_IN_CONTACT',
  },
  { holder: 'ends J "I’m home"', status: 409, code: 'ALERT_RESOLVED', kind: 'HOME' },
  { holder: 'ends J at 24 hours', status: 409, code: 'ALERT_RESOLVED', kind: 'EXPIRED' },
] as const;

type Holder = (typeof HOLDERS)[number]['holder'];

/** The stand-down kinds, one per resolution (D-112). */
const STAND_DOWNS = ['BACK_IN_CONTACT', 'HOME', SAFE, 'EXPIRED'];

describe('LOST-08, SM-09, SM-10 and LOST-03: the close decides under the journey’s row', () => {
  test.each(HOLDERS)(
    'LOST-08-AC4: R1’s close, past its read, meets J’s row held by a transaction that $holder: it waits; once the holder commits it decides as the holder left J and A, answering $status; one resolution of A and one end of J at most, and the stand-downs of that one resolution only (SM-09)',
    async ({ holder, status, code, kind }) => {
      const w = world();
      const { walker, journeyId, alertId, r1, responders } = await acknowledged(w, 3);
      if (holder === 'ends J at 24 hours') {
        // Past the 24 hours, the sweep not yet run.
        w.clock.advance(A_DAY);
      }
      w.store.hold(journeyId);
      let answered = false;
      const closing = w.close(r1, alertId).then((answer) => {
        answered = true;
        return answer;
      });
      await until(() => w.store.calls.includes('recordClosure'), 'the close reaching its write');
      expect(w.store.calls).toContain('alertForClosure');
      expect(answered).toBe(false);

      await w.store.commitHold(journeyId, async (): Promise<void> => {
        const run: Record<Holder, () => Promise<unknown>> = {
          'commits having changed nothing': () => Promise.resolve(),
          'removes R1': async () => {
            expect(await w.remove(journeyId, r1.userId)).toEqual({ type: 'removed' });
          },
          'brings J back in contact': () => w.heartbeat(walker, journeyId),
          'ends J "I’m home"': async () => {
            expect((await w.home(walker, journeyId)).status).toBe(200);
          },
          'ends J at 24 hours': async () => {
            expect((await w.watchdog.sweep()).ok).toBe(true);
          },
        };
        await run[holder]();
      });
      const answer = await closing;

      expect({ status: answer.status, code: codeOf(answer) }).toEqual({ status, code });
      const [alert, ...more] = w.alertsOf(journeyId);
      expect(more).toEqual([]);
      const standDowns = w
        .messagesOf(journeyId)
        .filter((message) => STAND_DOWNS.includes(message.kind));
      if (kind === null) {
        // Removed: the alert reset, nothing resolved, nothing ended; the close wrote nothing.
        expect(alert).toMatchObject({ state: 'OPEN', resolution: null, acknowledgedBy: null });
        expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
        expect(standDowns).toEqual([]);
        expect(w.closureLines()).toEqual([]);
        return;
      }
      expect(alert).toMatchObject({ state: 'RESOLVED', resolution: kind });
      expect(new Set(standDowns.map((message) => message.kind))).toEqual(new Set([kind]));
      const told = kind === SAFE ? responders.slice(1) : responders;
      expect(recipientsOf(standDowns)).toEqual(idsOf(told));
      if (kind === 'BACK_IN_CONTACT') {
        expect(w.stateOf(journeyId)).toBe('ACTIVE');
        expect(w.store.endOf(journeyId)).toEqual({ endedAt: null, endReason: null });
      } else {
        expect(w.store.endOf(journeyId)).toEqual({
          endedAt: alert?.resolvedAt,
          endReason: kind,
        });
      }
      expect(w.closureLines()).toEqual(
        status === 409 ? [{ event: 'closure_ignored', reason: 'ALERT_RESOLVED', alertId }] : [],
      );
    },
  );

  test.each(['a fresh heartbeat', '"I’m home"', 'R1’s removal', 'the 24-hour end'] as const)(
    'LOST-08-AC4: the other order: %s, past its read, meets J’s row held by R1’s close, which commits first; it then finds J ENDED, SAFE, and changes nothing: one resolution of A, one end of J, one set of SAFE (SM-09, SM-07)',
    async (other) => {
      const w = world();
      const { walker, journeyId, alertId, r1, others } = await acknowledged(w, 3);
      const closer = async () => {
        expect((await w.close(r1, alertId)).status).toBe(200);
      };
      let result: unknown;
      if (other === 'the 24-hour end') {
        // Past the 24 hours and the 30 s after them: the sweep skips the held
        // row, then waits for it once; the holder closes and lets go.
        w.clock.advance(A_DAY + 30 * SECOND);
        w.store.holdUntilWaited(journeyId, closer);
        result = await w.watchdog.sweep();
        expect(result).toEqual(QUIET_SWEEP);
        expect(w.store.expireRequests().map(({ alertId: id }) => id)).toEqual([alertId, alertId]);
      } else {
        w.store.hold(journeyId);
        const call =
          other === 'a fresh heartbeat'
            ? 'recordHeartbeat'
            : other === '"I’m home"'
              ? 'recordHome'
              : 'removeResponder';
        const pending =
          other === 'a fresh heartbeat'
            ? w.heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }))
            : other === '"I’m home"'
              ? w.home(walker, journeyId)
              : w.remove(journeyId, r1.userId);
        await until(() => w.store.calls.includes(call), `${other} reaching the store`);
        await w.store.commitHold(journeyId, closer);
        result = await pending;
        if (other === 'R1’s removal') {
          expect(result).toEqual({ type: 'ignored', reason: 'JOURNEY_ENDED' });
        } else {
          const answer = result as Answer;
          expect({ status: answer.status, code: codeOf(answer) }).toEqual({
            status: 409,
            code: 'JOURNEY_ENDED',
          });
        }
      }

      expect(w.stateOf(journeyId)).toBe('ENDED');
      expect(w.store.endOf(journeyId).endReason).toBe(SAFE);
      expect(w.alertsOf(journeyId)).toMatchObject([
        { state: 'RESOLVED', resolution: SAFE, acknowledgedBy: r1.userId },
      ]);
      expect(w.respondersOf(journeyId)).toEqual(idsOf([r1, ...others]));
      const standDowns = w
        .messagesOf(journeyId)
        .filter((message) => STAND_DOWNS.includes(message.kind));
      expect(standDowns.map(({ kind }) => kind)).toEqual([SAFE, SAFE]);
      expect(recipientsOf(standDowns)).toEqual(idsOf(others));
    },
  );

  test(`LOST-08-AC4: ${String(RACERS)} copies of R1’s close at once: exactly one is 200 CLOSED and every other 409 ALERT_RESOLVED, none a 500; A resolved once, J ended once, one SAFE per other responder, and one closure_ignored line per 409 (SM-09)`, async () => {
    const w = world();
    const { journeyId, alertId, r1, others } = await acknowledged(w, 3);

    const answers = await Promise.all(Array.from({ length: RACERS }, () => w.close(r1, alertId)));

    const statuses = answers.map(({ status }) => status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(RACERS - 1);
    for (const answer of answers.filter(({ status }) => status === 409)) {
      expect(codeOf(answer)).toBe('ALERT_RESOLVED');
    }
    expect(w.alertsOf(journeyId)).toMatchObject([{ state: 'RESOLVED', resolution: SAFE }]);
    expect(w.store.endOf(journeyId).endReason).toBe(SAFE);
    expect(recipientsOf(ofKind(w.messagesOf(journeyId), SAFE))).toEqual(idsOf(others));
    expect(w.closureLines()).toEqual(
      Array.from({ length: RACERS - 1 }, () => ({
        event: 'closure_ignored',
        reason: 'ALERT_RESOLVED',
        alertId,
      })),
    );
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC5 and AC6: after a close; what the walker will be shown.
// ---------------------------------------------------------------------------

describe('LOST-08, SM-07, LOST-01, LOST-02, LOST-07 and SM-01: after a close, the journey is over for everything that follows, and the walker is free', () => {
  test('LOST-08-AC5: after R1 closes J, D’s next heartbeat is 409 JOURNEY_ENDED, stores nothing, and writes one heartbeat_ignored line naming J; D’s "I’m home" is 409 JOURNEY_ENDED (SM-07, LOST-01, SM-04)', async () => {
    const w = world();
    const { walker, journeyId, alertId, r1 } = await acknowledged(w, 2);
    expect((await w.close(r1, alertId)).status).toBe(200);
    const before = w.recordOf(journeyId);

    const heartbeat = await w.heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }));
    const home = await w.home(walker, journeyId);

    expect({ status: heartbeat.status, code: codeOf(heartbeat) }).toEqual({
      status: 409,
      code: 'JOURNEY_ENDED',
    });
    expect({ status: home.status, code: codeOf(home) }).toEqual({
      status: 409,
      code: 'JOURNEY_ENDED',
    });
    expect(w.recordOf(journeyId)).toEqual(before);
    expect(w.lines('heartbeat_ignored')).toEqual([
      { event: 'heartbeat_ignored', reason: 'JOURNEY_ENDED', journeyId },
    ]);
  });

  test('LOST-08-AC5: after the close no later sweep opens an alert for J or escalates A, and the SMS fake receives nothing for A, however far the clock runs: every 10 s for 10 minutes, then every hour to 25 hours after the opening; every sweep quiet and ok (LOST-02, LOST-07, SM-06)', async () => {
    const w = world();
    const { journeyId, alertId, openedAt, r1 } = await acknowledged(w, 3);
    expect((await w.close(r1, alertId)).status).toBe(200);
    const alertAfter = w.alertOf(alertId);
    const sweeps: unknown[] = [];

    for (let step = 0; step < 60; step += 1) {
      w.clock.advance(INTERVAL);
      const { swept } = await w.runLoops();
      sweeps.push(swept);
    }
    while ((await w.clock.now()).getTime() < openedAt.getTime() + 25 * HOUR) {
      w.clock.advance(HOUR);
      const { swept } = await w.runLoops();
      sweeps.push(swept);
    }

    expect(sweeps.filter((swept) => JSON.stringify(swept) !== JSON.stringify(QUIET_SWEEP))).toEqual(
      [],
    );
    expect(w.alertsOf(journeyId)).toEqual([alertAfter]);
    expect(alertAfter.smsRaisedAt).toBeNull();
    expect(ofKind(w.messagesOf(journeyId), SMS)).toEqual([]);
    expect(w.sms.messages).toEqual([]);
    expect(w.store.endOf(journeyId).endReason).toBe(SAFE);
  });

  test('LOST-08-AC5: W starts J2 naming R2 after J’s close: 201; when J2’s alert opens, R2’s SAFE from J, still unsent, is withdrawn at that open’s now, and R3’s is not, R3 not being on J2 (SM-01, D-112)', async () => {
    const w = world();
    const { walker, journeyId, alertId, r1, others } = await acknowledged(w, 3);
    const [r2, r3] = others as [RegisteredDevice, RegisteredDevice];
    expect((await w.close(r1, alertId)).status).toBe(200);

    const second = await w.startAnswer(walker, [r2.userId]);

    expect(second.status).toBe(201);
    const secondId = (second.body as { journeyId: string }).journeyId;
    expect(secondId).not.toBe(journeyId);
    expect(w.respondersOf(secondId)).toEqual([r2.userId]);
    // J2 goes silent; its alert opens at five minutes, nothing delivered meanwhile.
    w.clock.advance(FIVE_MINUTES);
    expect((await w.watchdog.sweep()).opened).toBe(1);
    const openedAt = await w.clock.now();
    const safeOf = (recipientId: string) =>
      ofKind(w.messagesOf(journeyId), SAFE).find((message) => message.recipientId === recipientId);
    expect(safeOf(r2.userId)?.withdrawnAt).toEqual(openedAt);
    expect(safeOf(r3.userId)?.withdrawnAt).toBeNull();
    expect(safeOf(r3.userId)?.sentAt).toBeNull();
  });

  test('LOST-08-AC6: after the close, J’s end reason SAFE and A’s acknowledged_by naming the closer are readable together, J’s ended_at equal to A’s resolved_at; no message is written to W by the close', async () => {
    const w = world();
    const { walker, journeyId, alertId, r1 } = await acknowledged(w, 3);
    const toWalkerBefore = w.store
      .outbox()
      .filter(({ recipientId }) => recipientId === walker.userId);

    expect((await w.close(r1, alertId)).status).toBe(200);

    const alert = w.alertOf(alertId);
    const end = w.store.endOf(journeyId);
    expect({ endReason: end.endReason, acknowledgedBy: alert.acknowledgedBy }).toEqual({
      endReason: SAFE,
      acknowledgedBy: r1.userId,
    });
    expect(end.endedAt).toEqual(alert.resolvedAt);
    expect(alert.resolution).toBe(SAFE);
    expect(w.store.outbox().filter(({ recipientId }) => recipientId === walker.userId)).toEqual(
      toWalkerBefore,
    );
    expect(w.store.journeyMessages().filter((message) => message.journeyId === journeyId)).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC7: a closed alert sends nothing more, and its stand-downs never
// overtake what is in a port's hands.
// ---------------------------------------------------------------------------

describe('LOST-08, LOST-03 and LOST-07: a closed alert sends nothing more, and its stand-downs never overtake what is in a port’s hands', () => {
  test('LOST-08-AC7: A escalated; then R2’s lost-contact push refused NO_TARGET and due again, R3’s handed to the push port and not yet answered, R1 on it; R1 closes A after R2’s retry time: R2’s push withdrawn at the close’s now, keeping its attempts and last failure, and never handed to a port again; R3’s finishes as the port answers and is never retried; R3’s SAFE due at that push’s lease end, at most 60 s on, R2’s at once; the close writes no SMS (D-115 item 5) (LOST-03, LOST-07)', async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, 3);
    w.clock.advance(TWO_MINUTES);
    expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, escalated: 1 });
    const smsBefore = ofKind(w.messagesOf(journeyId), SMS);
    expect(smsBefore).toHaveLength(3);
    // The lost-contact pushes, in the order a claim of one takes them.
    const [first, second, third] = ofKind(w.messagesOf(journeyId), LOST);
    const r1 = whoIs(responders, first?.recipientId);
    const r2 = whoIs(responders, second?.recipientId);
    const r3 = whoIs(responders, third?.recipientId);
    const handedTo = (recipientId: string, kind: string) =>
      w.push.messages.filter(
        (message) => message.recipientId === recipientId && message.kind === kind,
      ).length;
    // T: R1's accepted; R2's refused NO_TARGET, due again at T + 10 s.
    await senderOf(w, 1).deliverDue();
    w.push.failFor(r2.userId, 'NO_TARGET');
    await senderOf(w, 1).deliverDue();
    w.push.recover();
    const lostOf = (recipientId: string) =>
      ofKind(w.messagesOf(journeyId), LOST).find((message) => message.recipientId === recipientId);
    expect(lostOf(r1.userId)?.sentAt).not.toBeNull();
    expect(lostOf(r2.userId)).toMatchObject({
      sentAt: null,
      attempts: 1,
      lastFailure: 'NO_TARGET',
    });
    const r2RetryAt = lostOf(r2.userId)?.nextAttemptAt;
    // T + 5 s: R3's claimed, leased to T + 35 s, and held by the port.
    w.clock.advance(5 * SECOND);
    const r3ClaimedAt = await w.clock.now();
    w.push.holdAnswers();
    const inHands = senderOf(w, 1).deliverDue();
    await until(() => handedTo(r3.userId, LOST) === 1, 'R3’s push reaching the port');
    const leaseEnd = new Date(r3ClaimedAt.getTime() + LEASE);
    // T + 6 s: R1 on it, withdrawing the SMS.
    w.clock.advance(SECOND);
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    // T + 12 s: past R2's retry time, R2's push not yet claimed again; R1 closes.
    w.clock.advance(6 * SECOND);
    const closedAt = await w.clock.now();
    expect(r2RetryAt?.getTime()).toBeLessThanOrEqual(closedAt.getTime());
    const r2Before = lostOf(r2.userId);
    const r3Before = lostOf(r3.userId);

    expect((await w.close(r1, alertId)).status).toBe(200);

    expect(lostOf(r2.userId)).toEqual({ ...r2Before, withdrawnAt: closedAt });
    expect(lostOf(r3.userId)).toEqual({ ...r3Before, withdrawnAt: closedAt });
    const safeOf = (recipientId: string) =>
      ofKind(w.messagesOf(journeyId), SAFE).find((message) => message.recipientId === recipientId);
    expect(safeOf(r2.userId)?.nextAttemptAt).toEqual(closedAt);
    expect(safeOf(r3.userId)?.nextAttemptAt).toEqual(leaseEnd);
    expect(leaseEnd.getTime() - closedAt.getTime()).toBeGreaterThan(0);
    expect(leaseEnd.getTime() - closedAt.getTime()).toBeLessThanOrEqual(LONGEST_HOLD);
    expect(safeOf(r1.userId)).toBeUndefined();
    // No SMS written by the close: the three of the escalation, as they were.
    expect(
      ofKind(w.messagesOf(journeyId), SMS)
        .map(({ messageId }) => messageId)
        .sort(),
    ).toEqual(smsBefore.map(({ messageId }) => messageId).sort());

    // The port answers R3's push, accepting it.
    w.push.releaseAnswers();
    await inHands;
    await w.sender.deliverDue();
    expect(recipientsOf(ofKind(w.push.messages, SAFE))).toEqual([r2.userId]);
    await w.deliverUntil(leaseEnd.getTime() - 1);
    expect(recipientsOf(ofKind(w.push.messages, SAFE))).toEqual([r2.userId]);
    w.clock.advance(1);
    await w.sender.deliverDue();
    expect(recipientsOf(ofKind(w.push.messages, SAFE))).toEqual(idsOf([r2, r3]));
    await w.deliverUntil(closedAt.getTime() + 10 * MINUTE);
    await w.smsSender.deliverDue();

    expect(handedTo(r2.userId, LOST), 'R2’s, never handed over again').toBe(1);
    expect(handedTo(r3.userId, LOST), 'R3’s, never retried').toBe(1);
    expect(w.sms.messages).toEqual([]);
    const r3Safe = w.push.messages.findIndex(
      (message) => message.recipientId === r3.userId && message.kind === SAFE,
    );
    expect(
      w.push.messages.findLastIndex(
        (message) => message.recipientId === r3.userId && message.kind === LOST,
      ),
    ).toBeLessThan(r3Safe);
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC16 and AC17: all or nothing, loud; the store's time.
// ---------------------------------------------------------------------------

describe('LOST-08 and SM-06: a close is all or nothing, a failure is loud, and its times are the store’s', () => {
  test.each([
    {
      stage: 'read' as const,
      call: 'alertForClosure' as const,
      error: databaseError('57P01'),
      code: '57P01',
    },
    {
      stage: 'store' as const,
      call: 'recordClosure' as const,
      error: databaseError('40001'),
      code: '40001',
    },
    {
      stage: 'store' as const,
      call: 'recordClosure' as const,
      error: databaseError('55P03', 'canceling statement due to lock timeout'),
      code: '55P03',
    },
    {
      stage: 'store' as const,
      call: 'recordClosure' as const,
      error: new Error('no SQLSTATE here'),
      code: null,
    },
  ])(
    'LOST-08-AC16: with the store failing $call, the close is 500, never a 2xx; J, A and every message as they were, and one closure_failed line names the stage, $stage, and the SQLSTATE; once the store answers again, the same close is 200 and does AC1’s work (SM-06)',
    async ({ stage, call, error, code }) => {
      const w = world();
      const { journeyId, alertId, r1, others } = await acknowledged(w, 3);
      const before = w.recordOf(journeyId);
      w.store.failWith(error, call);

      const failed = await w.close(r1, alertId);

      expect(failed.status).toBe(500);
      expect(failed.text).not.toContain(alertId);
      w.store.recover();
      expect(w.recordOf(journeyId)).toEqual(before);
      expect(w.log.events).toEqual([{ event: 'closure_failed', stage, code }]);

      const again = await w.close(r1, alertId);

      expect({ status: again.status, body: again.body }).toEqual({ status: 200, body: CLOSED });
      expect(w.store.endOf(journeyId).endReason).toBe(SAFE);
      expect(recipientsOf(ofKind(w.messagesOf(journeyId), SAFE))).toEqual(idsOf(others));
    },
  );

  test('LOST-08-AC17: the close’s times are the store’s: on the fake clock, ended_at, resolved_at, every withdrawal and every SAFE’s created_at are the store’s now when the close is made; the closure module is handed no clock (SM-06, REL-01)', async () => {
    const w = world();
    const { journeyId, alertId, r1 } = await acknowledged(w, 3);
    w.clock.advance(12_345);
    const closedAt = await w.clock.now();
    // The closure module is made from the store and the log alone (AR-03).
    const closures = createClosureService({ alerts: w.store, log: w.log });

    expect(await closures.close({ responderId: r1.userId, alertId })).toEqual({ type: 'closed' });

    expect(w.alertOf(alertId).resolvedAt).toEqual(closedAt);
    expect(w.store.endOf(journeyId).endedAt).toEqual(closedAt);
    const withdrawn = w.messagesOf(journeyId).filter(({ withdrawnAt }) => withdrawnAt !== null);
    expect(withdrawn.length).toBeGreaterThan(0);
    for (const message of withdrawn) {
      expect(message.withdrawnAt, message.kind).toEqual(closedAt);
    }
    for (const message of ofKind(w.messagesOf(journeyId), SAFE)) {
      expect(message.createdAt).toEqual(closedAt);
    }
  });

  test('LOST-08-AC2: the closure module answers as the route does: refused NOT_THE_ACKNOWLEDGER and ALERT_NOT_FOUND, ignored ALERT_RESOLVED, closed; IDs as given, never guessed (LOST-06)', async () => {
    const w = world();
    const { walker, alertId, r1, others } = await acknowledged(w, 2);
    const [r2] = others as [RegisteredDevice];
    const closures = createClosureService({ alerts: w.store, log: w.log });

    expect(await closures.close({ responderId: r2.userId, alertId })).toEqual({
      type: 'refused',
      reason: 'NOT_THE_ACKNOWLEDGER',
    });
    expect(await closures.close({ responderId: walker.userId, alertId })).toEqual({
      type: 'refused',
      reason: 'ALERT_NOT_FOUND',
    });
    expect(await closures.close({ responderId: r1.userId.toUpperCase(), alertId })).toEqual({
      type: 'refused',
      reason: 'ALERT_NOT_FOUND',
    });
    expect(await closures.close({ responderId: r1.userId, alertId })).toEqual({ type: 'closed' });
    expect(await closures.close({ responderId: r1.userId, alertId })).toEqual({
      type: 'ignored',
      reason: 'ALERT_RESOLVED',
    });
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC18: nothing personal reaches a log (PRIV-07).
// ---------------------------------------------------------------------------

describe('PRIV-07 and LOST-08: nothing personal reaches a log', () => {
  test('LOST-08-AC18: when the store fails the close’s read and its store with errors whose messages hold a synthetic coordinate, a phone-number-shaped string, a credential-like string and the closer’s and the walker’s IDs, nothing written to stdout, stderr or the console holds any of them; the capture sees the lines the production log wrote, and the errors do hold the markers', async () => {
    // The production log, writing to this process's stdout, where the
    // capture watches: the recording fake would prove only what the module
    // chose, not what reached a stream.
    const w = world({ log: createLog() });
    const { walker, alertId, r1 } = await acknowledged(w, 2);
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
        `failed near (${coordinate}) for ${numberShaped} as ${credential} closing ${walker.userId}'s alert for ${r1.userId}`,
      );
      thrown.push(error);
      return error;
    };

    const { written, result } = await captured(async () => {
      w.store.failWith(failing('57P01'), 'alertForClosure');
      const read = await w.close(r1, alertId);
      w.store.recover();
      w.store.failWith(failing('40P01'), 'recordClosure');
      const store = await w.close(r1, alertId);
      w.store.recover();
      return [read, store];
    });

    // Controls: the errors hold every marker, and the capture saw the lines.
    for (const error of thrown) {
      expect(markersIn(error.message, markers)).toEqual(markers);
    }
    expect(written).toContain('"event":"closure_failed"');
    expect(result.map(({ status }) => status)).toEqual([500, 500]);

    expect(markersIn(written, markers)).toEqual([]);
    for (const answer of result) {
      expect(markersIn(`${answer.text}\n${answer.headers}`, markers)).toEqual([]);
    }
  });

  test('LOST-08-AC18: a 400 from the closure route, for a known responder’s device whose credential is a run-time marker and a body holding a key, writes nothing to stdout, stderr or the console that holds the credential; the capture sees the production log’s closure_ignored line', async () => {
    const w = world({ log: createLog() });
    const { alertId, r1 } = await acknowledged(w, 1);
    const markers = [r1.credential];

    const { written, result } = await captured(async () => {
      const refused = [
        await w.close(r1, alertId, { body: { note: 'synthetic' } }),
        await w.close(r1, alertId, { body: { alertId } }),
        await w.close(r1, 'not-a-uuid', { body: { note: 'synthetic' } }),
      ];
      // Control: a line through the production log, in the same capture.
      expect((await w.close(r1, alertId)).status).toBe(200);
      const over = await w.close(r1, alertId);
      return { refused, over };
    });

    expect(result.refused.map(({ status }) => status)).toEqual([400, 400, 400]);
    expect(result.over.status).toBe(409);
    expect(written).toContain('"event":"closure_ignored"');
    expect(markersIn(written, markers)).toEqual([]);
    for (const answer of [...result.refused, result.over]) {
      expect(markersIn(`${answer.text}\n${answer.headers}`, markers)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC21: a start that races an end from outside the walker's phone.
// ---------------------------------------------------------------------------

/**
 * Puts in, as a start racing W's own would, W's journey LOST_CONTACT with its
 * alert ACKNOWLEDGED by `responder`, opened `openedAgoMs` before `now`.
 * Returns the IDs. Synchronous, as the fake's hooks are.
 */
function racingJourney(
  w: World,
  walker: RegisteredDevice,
  responder: RegisteredDevice,
  now: Date,
  openedAgoMs = MINUTE,
) {
  const openedAt = new Date(now.getTime() - openedAgoMs);
  const silentSince = new Date(openedAt.getTime() - FIVE_MINUTES);
  const journeyId = w.store.seed({
    walkerId: walker.userId,
    deviceId: walker.deviceId,
    state: 'LOST_CONTACT',
    responderIds: [responder.userId],
    startedAt: new Date(silentSince.getTime() - HOUR),
    lastHeartbeatAt: silentSince,
  });
  const alertId = w.store.seedAlert({
    journeyId,
    state: 'ACKNOWLEDGED',
    openedAt,
    silentSince,
    acknowledgedBy: responder.userId,
    acknowledgedAt: openedAt,
  });
  return { journeyId, alertId };
}

describe('LOST-08 and SM-01: a start that races an end from outside the walker’s phone retries once', () => {
  test.each(['closed by its acknowledger', 'ended at 24 hours'] as const)(
    'LOST-08-AC21: W’s journey J, %s between W’s start’s conflict with it and the start’s read of the winner: the start retries its insert once and answers 201 with a new journey, its responders stored; J as the end left it (SM-01)',
    async (how) => {
      const w = world();
      const walker = w.walker();
      const [r1, r2] = [w.responder(), w.responder()] as const;
      const now = await w.clock.now();
      const raced: { journeyId?: string; alertId?: string } = {};
      let endAnswer: unknown;
      let afterEnd: unknown;
      // The other start wins at the database, between this start's read and its insert.
      w.store.beforeNext('insertStarted', () => {
        Object.assign(
          raced,
          racingJourney(w, walker, r1, now, how === 'ended at 24 hours' ? A_DAY : MINUTE),
        );
      });
      // Then, between the conflict and the read of who won, J ends from outside W's phone.
      w.store.afterConflict(async () => {
        endAnswer =
          how === 'closed by its acknowledger'
            ? (await w.close(r1, raced.alertId ?? '')).status
            : await w.watchdog.sweep();
        afterEnd = w.recordOf(raced.journeyId ?? '');
      });

      const answer = await w.startAnswer(walker, [r2.userId]);

      expect(answer.status).toBe(201);
      const journeyId = (answer.body as { journeyId: string }).journeyId;
      expect(journeyId).not.toBe(raced.journeyId);
      expect(w.respondersOf(journeyId)).toEqual([r2.userId]);
      expect(w.stateOf(journeyId)).toBe('ACTIVE');
      expect(endAnswer).toEqual(how === 'closed by its acknowledger' ? 200 : QUIET_SWEEP);
      expect(w.store.endOf(raced.journeyId ?? '').endReason).toBe(
        how === 'closed by its acknowledger' ? SAFE : 'EXPIRED',
      );
      expect(w.recordOf(raced.journeyId ?? '')).toEqual(afterEnd);
      expect(w.store.calls.filter((call) => call === 'insertStarted')).toHaveLength(1);
      expect(
        w
          .journeysOf(walker.userId)
          .map(({ id }) => id)
          .sort(),
      ).toEqual([journeyId, raced.journeyId].sort());
    },
  );

  test('LOST-08-AC21: when the retry meets the same race again — another of W’s journeys put in and closed between its conflict and its read — the start answers 500 with nothing stored, as before (SM-01)', async () => {
    const w = world();
    const walker = w.walker();
    const [r1, r2, r3] = [w.responder(), w.responder(), w.responder()] as const;
    const now = await w.clock.now();
    const first: { journeyId?: string; alertId?: string } = {};
    const second: { journeyId?: string; alertId?: string } = {};
    const closes: number[] = [];
    w.store.beforeNext('insertStarted', () => {
      Object.assign(first, racingJourney(w, walker, r1, now));
    });
    w.store.afterConflict(async () => {
      closes.push((await w.close(r1, first.alertId ?? '')).status);
    });
    w.store.beforeRetry(() => {
      Object.assign(second, racingJourney(w, walker, r3, now));
    });
    w.store.afterConflict(async () => {
      closes.push((await w.close(r3, second.alertId ?? '')).status);
    });

    const answer = await w.startAnswer(walker, [r2.userId]);

    expect(answer.status).toBe(500);
    expect(closes).toEqual([200, 200]);
    expect(
      w
        .journeysOf(walker.userId)
        .map(({ id }) => id)
        .sort(),
    ).toEqual([first.journeyId, second.journeyId].sort());
    expect(
      w.store.journeys().filter(({ responderIds }) => responderIds.includes(r2.userId)),
    ).toEqual([]);
  });
});
