// L6 system: removing a responder from a journey (SM-10, and the
// last-responder half of SM-02), through the whole server in one process.
//
// The real API, the real journey and acknowledgement modules, the real
// removal module, the real watchdog, the real push sender, the real SMS
// sender and the real SMS check, with fakes only at the edges: the device
// credentials, the journey store, the worker's beats, the push port, the SMS
// port, the SMS check's monitor and the log. One fake clock stands in for the
// database's now(): the store reads it as PostgreSQL's now() would be read.
// No module reads a clock (AR-03). The loops are run here as the worker runs
// them, every 10 s (D-107): a sweep, then a push delivery, then an SMS
// delivery.
//
// No route removes a responder in M2 (D-122, item 5), so the removal is
// driven through its module, as the watchdog is driven through its own (the
// spec's reading 8). Everything else in these flows goes through the API:
// the start, the heartbeats, "I'm on it" and "I'm home".
//
// What is proven here, the roadmap's "done when" for M2's task 7: "both rules
// pass at L6":
//   - the resumed-escalation rule (SM-10): the acknowledger's removal puts the
//     alert back to unacknowledged (AC4), and escalation resumes, at two
//     minutes from the opening or at once if they have passed (AC5), and, for
//     an alert already escalated, with every remaining responder texted again
//     at once (AC6), a second acknowledgement and a second reset in rounds of
//     their own (AC7), and one lost-contact push per responder whatever
//     happens (AC8);
//   - SM-02's last-responder warning: one NO_RESPONDER to the walker, by push,
//     content-free (AC12), one however the last two go (AC13), and a journey
//     left with nobody that goes silent opens with nobody to tell, and pages
//     the owner through the SMS check (AC15);
//   - and around them: the removal itself (AC1), a removed responder left out
//     of everything after (AC2, AC10, AC11), the removal and "I'm on it"
//     meeting on the journey's row (AC9), a failure loud (AC18), the store's
//     time (AC19), and nothing personal in a log (AC20).
//
// The requirements this file holds, beside SM-10 and SM-02: SM-07 and SM-08
// (an ended journey ignored, a removal safe twice), SM-09 (the journey's
// row), SM-04 ("I'm home"), LOST-02 (the alert and its pushes), LOST-03
// (contact back, the stand-downs), LOST-06 ("I'm on it"), LOST-07 and REL-07
// (the SMS), REL-01 (the store's time) and PRIV-07 (nothing personal in a
// log).
//
// This file is the `journeys` mutation group's third test file (the spec's
// Mutation section): the removal module lives in modules/journeys/. Times are
// written out (two minutes, five minutes, 10 s, 60 s), not read from the
// domain's constants, so a wrong constant fails here as well as in the
// domain's own tests.
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
  syntheticUuid,
  type FakeJourneyState,
  type RegisteredDevice,
  type SyntheticHeartbeat,
} from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import { createApi } from './api.ts';
import { captured, markersIn } from './capture.test.ts';
import { createLog } from './log.ts';
import { createAcknowledgementService } from './modules/alerts/acknowledgement.ts';
import { createPushSender, createSmsSender } from './modules/alerts/outbox.ts';
import { createSmsCheck } from './modules/alerts/sms-check.ts';
import { createWatchdog } from './modules/alerts/watchdog.ts';
import { createHealthService } from './modules/health/service.ts';
import { createRemovalService } from './modules/journeys/removal.ts';
import { createJourneyService } from './modules/journeys/service.ts';
import type { Log } from './ports.ts';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** D-021: responders are alerted when the server has heard nothing for five minutes, or more. */
const FIVE_MINUTES = 5 * MINUTE;
/** D-019: every responder gets an SMS when nobody has acknowledged within two minutes, or more. */
const TWO_MINUTES = 2 * MINUTE;
/** How often the worker's loops run (D-107). */
const INTERVAL = 10 * SECOND;
/** An SMS still unsent this long after it was written is failing, and pages (LOST-07). */
const SMS_UNSENT_LIMIT = 60 * SECOND;

/** A synthetic night: 21:00 UTC on 1 October 2026. */
const START = new Date('2026-10-01T21:00:00.000Z');

const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SMS = 'LOST_CONTACT_SMS';
const NOTICE = 'ACKNOWLEDGED';
const WARNING = 'NO_RESPONDER';
const ON_IT = { outcome: 'ACKNOWLEDGED' };

/** The removal module's answers, as the spec names them (RemovalResult). */
const REMOVED = { type: 'removed' };
const NOT_A_RESPONDER = { type: 'unchanged', reason: 'NOT_A_RESPONDER' };
const JOURNEY_ENDED = { type: 'ignored', reason: 'JOURNEY_ENDED' };
const JOURNEY_NOT_FOUND = { type: 'refused', reason: 'JOURNEY_NOT_FOUND' };

/** A sweep's answer when it opened nothing, escalated nothing and found nothing stuck. */
const QUIET_SWEEP = { ok: true, opened: 0, escalated: 0, stuck: 0 };

/** An error as a database or a driver throws one: a message, and a SQLSTATE. */
function databaseError(code: string, message = 'the database could not answer'): Error {
  return Object.assign(new Error(message), { code });
}

/** An answer as these tests read it: its status, its body parsed, and its text. */
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
  });
  const removal = createRemovalService({ journeys: store, log });
  const watchdog = createWatchdog({ journeys: store, beats, log });
  const sender = createPushSender({ outbox: store, push, log });
  const smsSender = createSmsSender({ outbox: store, sms, log });
  const smsCheck = createSmsCheck({ outbox: store, alarm, log });

  const post = async (credential: string, route: string, body?: unknown): Promise<Answer> => {
    const headers: Record<string, string> = { authorization: `Bearer ${credential}` };
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
    /** A user with a device of their own, who can follow a journey and say "I'm on it" (D-091). */
    responder(): RegisteredDevice {
      const device = devices.register();
      store.addUser(device.userId);
      return device;
    },
    /** Starts a journey through the API, which must be 201; resolves to its ID. */
    async start(device: RegisteredDevice, responderIds: readonly string[]): Promise<string> {
      const answer = await post(device.credential, 'journeys', { responderIds });
      expect(answer.status, 'the start').toBe(201);
      return (answer.body as { journeyId: string }).journeyId;
    },
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
        await watchdog.sweep();
        await sender.deliverDue();
        await smsSender.deliverDue();
      }
    },
    stateOf: (journeyId: string) => store.journeys().find(({ id }) => id === journeyId)?.state,
    respondersOf: (journeyId: string) =>
      [...(store.journeys().find(({ id }) => id === journeyId)?.responderIds ?? [])].sort(),
    alertsOf: (journeyId: string) =>
      store.alerts().filter((alert) => alert.journeyId === journeyId),
    messagesOf(journeyId: string) {
      const alertIds = self.alertsOf(journeyId).map(({ id }) => id);
      return store.outbox().filter(({ alertId }) => alertIds.includes(alertId));
    },
    smsOf: (journeyId: string) => self.messagesOf(journeyId).filter(({ kind }) => kind === SMS),
    /** The journey's own messages, naming it and no alert: the walker's warnings. */
    warningsOf: (journeyId: string) =>
      store.journeyMessages().filter((message) => message.journeyId === journeyId),
    /** This alert's round: 1 when opened, one more with each reset. */
    roundOf: (alertId: string) =>
      store.alertRounds().find((alert) => alert.alertId === alertId)?.round,
    /** Each message's round, by its ID. */
    rounds: () => new Map(store.messageRounds().map(({ messageId, round }) => [messageId, round])),
    /** The removal's own lines, and the SMS check's: the ones the modules chose to write. */
    lines: (...names: string[]) => recorded.events.filter(({ event }) => names.includes(event)),
    /** Everything the store holds of one journey, to compare before and after. */
    recordOf: (journeyId: string) => ({
      journey: store.journeys().find(({ id }) => id === journeyId),
      device: store.deviceOf(journeyId),
      lastContact: store.lastHeartbeatAt(journeyId),
      alerts: self.alertsOf(journeyId),
      messages: self.messagesOf(journeyId),
      warnings: self.warningsOf(journeyId),
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

/**
 * A journey's record with its responders blanked: everything a removal must
 * leave as it was. The responders are compared on their own.
 */
function withoutResponders(record: ReturnType<World['recordOf']>) {
  return { ...record, journey: record.journey && { ...record.journey, responderIds: [] } };
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

/** As startedAndLost, but the journey put in directly, silent past five minutes, and swept. */
async function lost(w: World, count = 3) {
  const walker = w.walker();
  const responders = Array.from({ length: count }, () => w.responder());
  const journeyId = await w.seed(walker, idsOf(responders), {
    silentForMs: FIVE_MINUTES + MINUTE,
  });
  const { swept } = await w.runLoops();
  expect(swept.opened, 'the sweep opened the alert').toBe(1);
  const [alert] = w.alertsOf(journeyId);
  if (alert === undefined) {
    throw new Error('expected the sweep to open an alert');
  }
  return { walker, responders, journeyId, alertId: alert.id, openedAt: alert.openedAt };
}

// ---------------------------------------------------------------------------
// SM-10-AC1: removing a responder, and nothing else.
// ---------------------------------------------------------------------------

describe('SM-10, SM-02, SM-07 and SM-08: a responder is removed from a running journey, and nothing else changes', () => {
  test('SM-10-AC1: W starts J through the API with R1, R2 and R3, and D sends a heartbeat; R2 is removed: the answer is removed; J’s responders are R1 and R3; J is still ACTIVE, with the same start, device and last contact; no alert, no message, no warning, and no line, since two responders remain (SM-02)', async () => {
    const w = world();
    const walker = w.walker();
    const [r1, r2, r3] = [w.responder(), w.responder(), w.responder()] as const;
    const journeyId = await w.start(walker, [r1.userId, r2.userId, r3.userId]);
    await w.heartbeat(walker, journeyId);
    const before = w.recordOf(journeyId);

    expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);

    expect(w.respondersOf(journeyId)).toEqual(idsOf([r1, r3]));
    expect(withoutResponders(w.recordOf(journeyId))).toEqual(withoutResponders(before));
    expect(w.stateOf(journeyId)).toBe('ACTIVE');
    expect(w.store.alerts()).toEqual([]);
    expect(w.store.outbox()).toEqual([]);
    expect(w.store.journeyMessages()).toEqual([]);
    expect(w.log.events).toEqual([]);
  });

  test('SM-10-AC1: removing R2 again answers unchanged, NOT_A_RESPONDER, and changes nothing: safe twice, with no event ID (SM-08); and so do W, a user who follows only another journey, an ID that is no user’s, and R1’s ID in upper case', async () => {
    const w = world();
    const walker = w.walker();
    const [r1, r2, r3] = [w.responder(), w.responder(), w.responder()] as const;
    const elsewhere = w.responder();
    await w.start(w.walker(), [elsewhere.userId]);
    const journeyId = await w.start(walker, [r1.userId, r2.userId, r3.userId]);
    expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);
    const after = w.recordOf(journeyId);
    const outbox = w.store.outbox();
    expect(r1.userId.toUpperCase(), 'an ID with a letter in it').not.toBe(r1.userId);

    for (const [who, responderId] of [
      ['R2 again', r2.userId],
      ['W', walker.userId],
      ['a user who follows only another journey', elsewhere.userId],
      ['an ID that is no user’s', syntheticUuid()],
      ['R1’s ID in upper case', r1.userId.toUpperCase()],
    ] as const) {
      expect(await w.remove(journeyId, responderId), who).toEqual(NOT_A_RESPONDER);
    }

    expect(w.recordOf(journeyId)).toEqual(after);
    expect(w.store.outbox()).toEqual(outbox);
    expect(w.log.events).toEqual([]);
  });

  test('SM-10-AC1: for a journey ID no journey has, the answer is refused, JOURNEY_NOT_FOUND: nothing written, no line; and the store is asked only to read', async () => {
    const w = world();
    const r1 = w.responder();
    await w.start(w.walker(), [r1.userId]);
    const journeys = w.store.journeys();
    const callsBefore = w.store.calls.length;

    expect(await w.remove(syntheticUuid(), r1.userId)).toEqual(JOURNEY_NOT_FOUND);

    expect(w.store.journeys()).toEqual(journeys);
    expect(w.store.calls.slice(callsBefore)).toEqual(['journeyForRemoval']);
    expect(w.log.events).toEqual([]);
  });

  test('SM-10-AC1: for an ENDED journey the answer is ignored, JOURNEY_ENDED: its responder rows stay, and one removal_ignored line names the journey and the reason, and nothing else (SM-07)', async () => {
    const w = world();
    const walker = w.walker();
    const [r1, r2] = [w.responder(), w.responder()] as const;
    const journeyId = await w.start(walker, [r1.userId, r2.userId]);
    expect((await w.home(walker, journeyId)).status).toBe(200);
    const before = w.recordOf(journeyId);
    const callsBefore = w.store.calls.length;

    expect(await w.remove(journeyId, r1.userId)).toEqual(JOURNEY_ENDED);

    expect(w.recordOf(journeyId)).toEqual(before);
    expect(w.respondersOf(journeyId)).toEqual(idsOf([r1, r2]));
    expect(w.log.events).toEqual([
      { event: 'removal_ignored', reason: 'JOURNEY_ENDED', journeyId },
    ]);
    // Decided by the plain read: the store's write is never asked.
    expect(w.store.calls.slice(callsBefore)).toEqual(['journeyForRemoval']);
  });

  test('SM-10-AC1: another journey’s responders, R2’s rows on other journeys, and every other row are unchanged', async () => {
    const w = world();
    const [r1, r2, r3, r4] = [w.responder(), w.responder(), w.responder(), w.responder()] as const;
    const journeyId = await w.start(w.walker(), [r1.userId, r2.userId, r3.userId]);
    const other = await w.start(w.walker(), [r2.userId, r4.userId]);
    const otherLost = await lost(w, 2);
    const before = {
      other: w.recordOf(other),
      lost: w.recordOf(otherLost.journeyId),
      outbox: w.store.outbox(),
      alerts: w.store.alerts(),
    };

    expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);

    expect(w.recordOf(other)).toEqual(before.other);
    expect(w.respondersOf(other)).toEqual(idsOf([r2, r4]));
    expect(w.recordOf(otherLost.journeyId)).toEqual(before.lost);
    expect(w.store.outbox()).toEqual(before.outbox);
    expect(w.store.alerts()).toEqual(before.alerts);
  });

  test('SM-10-AC1: the store decides again under the journey’s row, and its answer is the module’s: R2’s row gone between the read and the write is unchanged, NOT_A_RESPONDER, with no line; J ended in between is ignored, JOURNEY_ENDED, with its one removal_ignored line', async () => {
    const w = world();
    const walker = w.walker();
    const [r1, r2] = [w.responder(), w.responder()] as const;
    const journeyId = await w.start(walker, [r1.userId, r2.userId]);

    w.store.beforeNext('removeResponder', () => {
      w.store.removeResponderRow(journeyId, r2.userId);
    });
    expect(await w.remove(journeyId, r2.userId)).toEqual(NOT_A_RESPONDER);
    expect(w.log.events).toEqual([]);

    w.store.beforeNext('removeResponder', () => {
      w.store.setState(journeyId, 'ENDED');
    });
    expect(await w.remove(journeyId, r1.userId)).toEqual(JOURNEY_ENDED);
    expect(w.log.events).toEqual([
      { event: 'removal_ignored', reason: 'JOURNEY_ENDED', journeyId },
    ]);
    expect(w.respondersOf(journeyId)).toEqual([r1.userId]);
    expect(w.store.journeyMessages()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SM-10-AC2: a removed responder is on the journey for nothing that follows.
// ---------------------------------------------------------------------------

describe('SM-10, LOST-02, LOST-03, LOST-06 and LOST-07: a removed responder is on the journey for nothing that follows', () => {
  test('SM-10-AC2: R2 removed while J is ACTIVE; D goes silent, the loops run past five minutes and past two minutes after the alert opened, and contact then comes back: the lost-contact push, the escalation SMS and the stand-down are each written for and handed to R1 and R3 only, never R2 (LOST-02, LOST-03, LOST-07)', async () => {
    const w = world();
    const walker = w.walker();
    const [r1, r2, r3] = [w.responder(), w.responder(), w.responder()] as const;
    const journeyId = await w.start(walker, [r1.userId, r2.userId, r3.userId]);
    await w.heartbeat(walker, journeyId);
    const lastContact = await w.clock.now();
    expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);

    await w.runUntil(lastContact.getTime() + FIVE_MINUTES + TWO_MINUTES);
    await w.heartbeat(walker, journeyId);
    await w.runLoops();

    const messages = w.messagesOf(journeyId);
    for (const kind of ['LOST_CONTACT', SMS, 'BACK_IN_CONTACT'] as const) {
      expect(
        recipientsOf(messages.filter((message) => message.kind === kind)),
        `${kind} written`,
      ).toEqual(idsOf([r1, r3]));
    }
    expect(recipientsOf(w.push.messages), 'pushed').toEqual(
      [r1.userId, r1.userId, r3.userId, r3.userId].sort(),
    );
    expect(recipientsOf(w.sms.messages), 'texted').toEqual(idsOf([r1, r3]));
    expect(w.push.messages.map(({ kind }) => kind).sort()).toEqual(
      ['BACK_IN_CONTACT', 'BACK_IN_CONTACT', 'LOST_CONTACT', 'LOST_CONTACT'].sort(),
    );
  });

  test('SM-10-AC2: R2’s "I’m on it" for J’s alert is 404 ALERT_NOT_FOUND, with the body a stranger gets, and writes nothing; R1’s writes its notice for R3 only (LOST-06)', async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, 3);
    const [r1, r2, r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    const stranger = w.responder();
    await w.seed(w.walker(), [stranger.userId], { silentForMs: MINUTE });
    expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);
    const before = w.recordOf(journeyId);

    const removedOnes = await w.acknowledge(r2, alertId);
    const strangers = await w.acknowledge(stranger, alertId);

    expect(removedOnes.status).toBe(404);
    expect((removedOnes.body as { code?: unknown }).code).toBe('ALERT_NOT_FOUND');
    expect(removedOnes.text, 'the body a stranger gets').toBe(strangers.text);
    expect(w.recordOf(journeyId)).toEqual(before);

    const answer = await w.acknowledge(r1, alertId);
    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ON_IT });
    expect(recipientsOf(w.messagesOf(journeyId).filter(({ kind }) => kind === NOTICE))).toEqual([
      r3.userId,
    ]);
  });
});

// ---------------------------------------------------------------------------
// SM-10-AC4: the acknowledger's removal puts the alert back to unacknowledged.
// ---------------------------------------------------------------------------

describe('SM-10 and LOST-06: removing the responder who acknowledged an alert puts it back to unacknowledged', () => {
  /** J lost, its alert acknowledged by R1 through the API 60 s after it opened, R2's notice sent and R3's not yet claimed. */
  async function acknowledged(w: World) {
    const alerted = await startedAndLost(w, 3);
    const [r1, r2, r3] = alerted.responders as [
      RegisteredDevice,
      RegisteredDevice,
      RegisteredDevice,
    ];
    await w.runUntil(alerted.openedAt.getTime() + MINUTE);
    const answer = await w.acknowledge(r1, alerted.alertId);
    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ON_IT });
    const noticeOf = (recipient: RegisteredDevice) =>
      w
        .messagesOf(alerted.journeyId)
        .find(({ kind, recipientId }) => kind === NOTICE && recipientId === recipient.userId);
    // R2's notice accepted by the push port; R3's never claimed.
    await w.store.markSent(noticeOf(r2)?.messageId ?? '');
    return { ...alerted, r1, r2, r3, noticeOf };
  }

  test('SM-10-AC4: J LOST_CONTACT, its alert A acknowledged by R1 through the API 60 s after it opened, with notices for R2 (sent) and R3 (not yet claimed); R1 removed: A is OPEN, who and when both null, no escalation time, its round one more; opened_at, silent_since and J’s state unchanged; R3’s notice withdrawn at the removal’s now, keeping its attempts and last failure; R2’s as it was (LOST-06)', async () => {
    const w = world();
    const { journeyId, alertId, r1, r2, r3, noticeOf } = await acknowledged(w);
    const [before] = w.alertsOf(journeyId);
    const r2Notice = noticeOf(r2);
    const r3Notice = noticeOf(r3);
    expect(w.roundOf(alertId)).toBe(1);
    w.clock.advance(5 * SECOND);
    const removedAt = await w.clock.now();

    expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);

    expect(w.alertsOf(journeyId)).toEqual([
      {
        ...before,
        state: 'OPEN',
        acknowledgedBy: null,
        acknowledgedAt: null,
        smsRaisedAt: null,
      },
    ]);
    expect(w.roundOf(alertId)).toBe(2);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(noticeOf(r3)).toEqual({ ...r3Notice, withdrawnAt: removedAt });
    expect(noticeOf(r2)).toEqual(r2Notice);
    // No line for a removal that removed.
    expect(w.lines('removal_ignored', 'removal_failed')).toEqual([]);
  });

  test('SM-10-AC4: removing R2 or R3 instead leaves A as it was: ACKNOWLEDGED by R1, its round unchanged (LOST-06)', async () => {
    for (const which of ['R2', 'R3'] as const) {
      const w = world();
      const { journeyId, alertId, r1, r2, r3 } = await acknowledged(w);
      const before = w.alertsOf(journeyId);

      expect(await w.remove(journeyId, (which === 'R2' ? r2 : r3).userId), which).toEqual(REMOVED);

      expect(w.alertsOf(journeyId), which).toEqual(before);
      expect(w.alertsOf(journeyId)[0]?.acknowledgedBy, which).toBe(r1.userId);
      expect(w.roundOf(alertId), which).toBe(1);
    }
  });

  test('SM-10-AC4: when A is RESOLVED, acknowledged by R1 and then contact came back, removing R1 leaves A as it was, who acknowledged it included (LOST-06)', async () => {
    const w = world();
    const { walker, journeyId, alertId, r1 } = await acknowledged(w);
    await w.heartbeat(walker, journeyId);
    const before = w.alertsOf(journeyId);
    expect(before.map(({ state, acknowledgedBy }) => [state, acknowledgedBy])).toEqual([
      ['RESOLVED', r1.userId],
    ]);

    expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);

    expect(w.alertsOf(journeyId)).toEqual(before);
    expect(w.roundOf(alertId)).toBe(1);
  });

  test.each(['OPEN', 'ESCALATED'] as const)(
    'SM-10-AC4: an alert %s with R1 recorded, put in directly, is reset too, in the safe direction (LOST-06)',
    async (state) => {
      const w = world();
      const walker = w.walker();
      const [r1, r2] = [w.responder(), w.responder()] as const;
      const journeyId = await w.seed(walker, [r1.userId, r2.userId], {
        state: 'LOST_CONTACT',
        silentForMs: FIVE_MINUTES + MINUTE,
      });
      const now = (await w.clock.now()).getTime();
      const alertId = w.store.seedAlert({
        journeyId,
        state,
        openedAt: new Date(now - MINUTE),
        silentSince: new Date(now - MINUTE - FIVE_MINUTES),
        acknowledgedBy: r1.userId,
        acknowledgedAt: new Date(now - 30 * SECOND),
        ...(state === 'ESCALATED' ? { smsRaisedAt: new Date(now - 10 * SECOND) } : {}),
      });

      expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);

      expect(
        w
          .alertsOf(journeyId)
          .map(({ state: now, acknowledgedBy, acknowledgedAt, smsRaisedAt }) => [
            now,
            acknowledgedBy,
            acknowledgedAt,
            smsRaisedAt,
          ]),
      ).toEqual([['OPEN', null, null, null]]);
      expect(w.roundOf(alertId)).toBe(2);
    },
  );
});

// ---------------------------------------------------------------------------
// SM-10-AC5 and AC6: escalation resumes. The roadmap's "both rules at L6",
// its first half.
// ---------------------------------------------------------------------------

describe('SM-10, LOST-07 and REL-07: escalation resumes for an alert never escalated, at its two minutes or at once if they have passed', () => {
  test('SM-10-AC5: J, D sending a heartbeat every 60 s and then nothing, the loops every 10 s, A opened at five minutes with every push accepted; R1 says "I’m on it" through the API 60 s after A opened and is removed 90 s after it opened: up to 119 999 ms nothing is escalated and the SMS fake holds nothing; at exactly 120 000 ms the sweep escalates A, ESCALATED at that now, with one LOST_CONTACT_SMS each for R2 and R3 in A’s current round, none for R1 or W, and the SMS fake receives exactly those two (LOST-07, REL-07)', async () => {
    const w = world();
    const walker = w.walker();
    const [r1, r2, r3] = [w.responder(), w.responder(), w.responder()] as const;
    const journeyId = await w.start(walker, [r1.userId, r2.userId, r3.userId]);
    // Five minutes of heartbeats, one every 60 s, the loops every 10 s.
    let lastContact = START;
    for (let second = 0; second <= 300; second += 10) {
      if (second % 60 === 0) {
        await w.heartbeat(walker, journeyId);
        lastContact = await w.clock.now();
      }
      await w.runLoops();
      w.clock.advance(INTERVAL);
    }
    await w.runUntil(lastContact.getTime() + FIVE_MINUTES);
    const [alert] = w.alertsOf(journeyId);
    const alertId = alert?.id ?? '';
    const openedAt = (alert?.openedAt ?? new Date(Number.NaN)).getTime();
    expect(openedAt).toBe(lastContact.getTime() + FIVE_MINUTES);
    expect(recipientsOf(w.push.accepted)).toEqual(idsOf([r1, r2, r3]));

    await w.runUntil(openedAt + MINUTE);
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    await w.runUntil(openedAt + 90 * SECOND);
    expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);
    const round = w.roundOf(alertId);
    expect(round).toBe(2);

    // A millisecond under two minutes: OPEN, nobody on it, no escalation time, no SMS.
    await w.runUntil(openedAt + TWO_MINUTES - 1);
    expect(w.alertsOf(journeyId).map(({ state, smsRaisedAt }) => [state, smsRaisedAt])).toEqual([
      ['OPEN', null],
    ]);
    expect(w.smsOf(journeyId)).toEqual([]);
    expect(w.sms.messages).toEqual([]);

    // Exactly two minutes: escalated, and R2 and R3 texted in the current round.
    w.clock.advance(1);
    const at = await w.clock.now();
    const { swept, texted } = await w.runLoops();

    expect(swept).toEqual({ ...QUIET_SWEEP, escalated: 1 });
    expect(texted).toEqual({ sent: 2, failed: 0 });
    expect(w.alertsOf(journeyId).map(({ state, smsRaisedAt }) => [state, smsRaisedAt])).toEqual([
      ['ESCALATED', at],
    ]);
    const sms = w.smsOf(journeyId);
    expect(recipientsOf(sms)).toEqual(idsOf([r2, r3]));
    const rounds = w.rounds();
    expect(sms.map(({ messageId }) => rounds.get(messageId))).toEqual([round, round]);
    expect(recipientsOf(w.sms.messages)).toEqual(idsOf([r2, r3]));
    expect(w.sms.messages.map(({ kind }) => kind)).toEqual([SMS, SMS]);
    for (const nobody of [r1.userId, walker.userId]) {
      expect(recipientsOf(w.sms.messages)).not.toContain(nobody);
    }
  });

  test('SM-10-AC5: in another run, with R1 removed five minutes after the opening, the first sweep after the removal escalates A, within 10 s of the removal (LOST-07, REL-07)', async () => {
    const w = world();
    const { journeyId, alertId, openedAt, responders } = await startedAndLost(w, 3);
    const [r1, r2, r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    await w.runUntil(openedAt.getTime() + MINUTE);
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    await w.runUntil(openedAt.getTime() + FIVE_MINUTES);
    expect(w.smsOf(journeyId)).toEqual([]);
    const removedAt = await w.clock.now();

    expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);
    await w.runUntil(removedAt.getTime() + INTERVAL);

    const [alert] = w.alertsOf(journeyId);
    expect(alert?.state).toBe('ESCALATED');
    const raisedAt = alert?.smsRaisedAt?.getTime() ?? Number.NaN;
    expect(raisedAt).toBeGreaterThan(removedAt.getTime());
    expect(raisedAt).toBeLessThanOrEqual(removedAt.getTime() + INTERVAL);
    expect(recipientsOf(w.sms.accepted)).toEqual(idsOf([r2, r3]));
  });

  test('SM-10-AC5: with no removal, the acknowledgement at 60 s still means no SMS for ten minutes (LOST-07’s second test, unchanged)', async () => {
    const w = world();
    const { journeyId, alertId, openedAt, responders } = await startedAndLost(w, 3);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    await w.runUntil(openedAt.getTime() + MINUTE);
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);

    await w.runUntil(openedAt.getTime() + MINUTE + 10 * MINUTE);

    expect(w.smsOf(journeyId)).toEqual([]);
    expect(w.sms.messages).toEqual([]);
    expect(
      w.alertsOf(journeyId).map(({ state, acknowledgedBy }) => [state, acknowledgedBy]),
    ).toEqual([['ACKNOWLEDGED', r1.userId]]);
  });
});

/**
 * SM-10-AC6's alert: escalated at 120 000 ms with round-1 SMS for R1, R2 and
 * R3, R1's and R2's accepted and R3's failing NO_TARGET; R1's "I'm on it" at
 * three minutes withdraws R3's unsent SMS; R1 removed at four minutes.
 */
async function resetAfterEscalation(w: World) {
  const alerted = await startedAndLost(w, 3);
  const [r1, r2, r3] = alerted.responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
  const { journeyId, alertId, openedAt } = alerted;
  w.sms.failFor(r3.userId, 'NO_TARGET');
  await w.runUntil(openedAt.getTime() + TWO_MINUTES);
  const firstRound = w.smsOf(journeyId);
  expect(recipientsOf(firstRound)).toEqual(idsOf([r1, r2, r3]));
  expect(recipientsOf(w.sms.accepted)).toEqual(idsOf([r1, r2]));
  await w.runUntil(openedAt.getTime() + 3 * MINUTE);
  const acknowledgedAt = await w.clock.now();
  expect((await w.acknowledge(r1, alertId)).status).toBe(200);
  const r3Sms = w.smsOf(journeyId).find(({ recipientId }) => recipientId === r3.userId);
  expect(r3Sms?.withdrawnAt, 'R3’s unsent SMS withdrawn by the acknowledgement').toEqual(
    acknowledgedAt,
  );
  await w.runUntil(openedAt.getTime() + 4 * MINUTE);
  const removedAt = await w.clock.now();
  const before = {
    firstRound: w.smsOf(journeyId),
    texts: w.sms.messages.length,
    pushes: w.push.messages.length,
  };
  expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);
  return { ...alerted, r1, r2, r3, removedAt, before };
}

describe('SM-10, LOST-07 and REL-07: escalation resumes for an alert already escalated, every remaining responder texted again at once (Q1 (a))', () => {
  test('SM-10-AC6: A escalated at 120 000 ms with round-1 SMS for R1, R2 and R3, R1’s and R2’s accepted and R3’s failing NO_TARGET; R1’s "I’m on it" at three minutes withdraws R3’s unsent SMS, and R1 is removed at four minutes: the first sweep after escalates A again, ESCALATED with that sweep’s now, one new LOST_CONTACT_SMS each for R2 and R3 in the new round, each with an ID of its own, none for R1; the round-1 rows as they were; the SMS fake receives one more for each of R2 and R3 and none for R1; the push fake no new LOST_CONTACT; later sweeps escalate nothing more (LOST-07, REL-07)', async () => {
    const w = world();
    const { journeyId, alertId, r1, r2, r3, removedAt, before } = await resetAfterEscalation(w);
    w.sms.recover();

    await w.runUntil(removedAt.getTime() + INTERVAL);
    const sweptAt = new Date(removedAt.getTime() + INTERVAL);

    const [alert] = w.alertsOf(journeyId);
    expect([alert?.state, alert?.smsRaisedAt]).toEqual(['ESCALATED', sweptAt]);
    const firstIds = before.firstRound.map(({ messageId }) => messageId);
    const secondRound = w.smsOf(journeyId).filter(({ messageId }) => !firstIds.includes(messageId));
    expect(recipientsOf(secondRound)).toEqual(idsOf([r2, r3]));
    expect(new Set(secondRound.map(({ messageId }) => messageId)).size).toBe(2);
    const rounds = w.rounds();
    expect(secondRound.map(({ messageId }) => rounds.get(messageId))).toEqual([2, 2]);
    expect(firstIds.map((messageId) => rounds.get(messageId))).toEqual([1, 1, 1]);
    // The round-1 rows exactly as they were.
    expect(w.smsOf(journeyId).filter(({ messageId }) => firstIds.includes(messageId))).toEqual(
      before.firstRound,
    );
    // One more SMS each for R2 and R3, none for R1; no push the escalation caused.
    expect(recipientsOf(w.sms.messages.slice(before.texts))).toEqual(idsOf([r2, r3]));
    expect(w.sms.messages.slice(before.texts).map(({ recipientId }) => recipientId)).not.toContain(
      r1.userId,
    );
    expect(
      w.push.messages.slice(before.pushes).filter(({ kind }) => kind === 'LOST_CONTACT'),
    ).toEqual([]);

    // Later sweeps escalate nothing more while nobody acknowledges.
    const texts = w.sms.messages.length;
    await w.runUntil(sweptAt.getTime() + 10 * MINUTE);
    expect(w.smsOf(journeyId)).toHaveLength(5);
    expect(w.sms.messages).toHaveLength(texts);
    expect(w.alertsOf(journeyId)[0]?.smsRaisedAt).toEqual(sweptAt);
    expect(w.roundOf(alertId)).toBe(2);
  });
});

describe('SM-10, LOST-06 and LOST-07: a second acknowledgement, a second reset, and the round', () => {
  test('SM-10-AC7: with AC6’s alert escalated again and R3’s SMS still failing, R2 says "I’m on it" through the API: 200; A ACKNOWLEDGED by R2 at that now; one ACKNOWLEDGED notice for R3 in the current round, none for R1 or R2; R3’s unsent SMS of the current round withdrawn. R2 removed too: A is OPEN again, its round raised again, and the next sweep texts R3 alone (LOST-06, LOST-07)', async () => {
    const w = world();
    const { journeyId, alertId, r1, r2, r3, removedAt, before } = await resetAfterEscalation(w);
    await w.runUntil(removedAt.getTime() + INTERVAL);
    const firstIds = before.firstRound.map(({ messageId }) => messageId);
    const secondRound = w.smsOf(journeyId).filter(({ messageId }) => !firstIds.includes(messageId));
    const r3Second = secondRound.find(({ recipientId }) => recipientId === r3.userId);
    expect(r3Second?.sentAt, 'R3’s second-round SMS failing').toBeNull();
    const noticesBefore = w.messagesOf(journeyId).filter(({ kind }) => kind === NOTICE);

    w.clock.advance(SECOND);
    const acknowledgedAt = await w.clock.now();
    const answer = await w.acknowledge(r2, alertId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ON_IT });
    expect(
      w
        .alertsOf(journeyId)
        .map(({ state, acknowledgedBy, acknowledgedAt: at }) => [state, acknowledgedBy, at]),
    ).toEqual([['ACKNOWLEDGED', r2.userId, acknowledgedAt]]);
    const notices = w
      .messagesOf(journeyId)
      .filter(
        ({ kind, messageId }) =>
          kind === NOTICE && !noticesBefore.some((n) => n.messageId === messageId),
      );
    expect(recipientsOf(notices)).toEqual([r3.userId]);
    const rounds = w.rounds();
    expect(notices.map(({ messageId }) => rounds.get(messageId))).toEqual([2]);
    expect(
      w.smsOf(journeyId).find(({ messageId }) => messageId === r3Second?.messageId)?.withdrawnAt,
    ).toEqual(acknowledgedAt);
    expect(recipientsOf(notices)).not.toContain(r1.userId);

    // R2 removed too: reset again, and the next sweep texts R3 alone.
    w.sms.recover();
    expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);
    expect(
      w
        .alertsOf(journeyId)
        .map(({ state, acknowledgedBy, smsRaisedAt }) => [state, acknowledgedBy, smsRaisedAt]),
    ).toEqual([['OPEN', null, null]]);
    expect(w.roundOf(alertId)).toBe(3);
    const smsBefore = w.smsOf(journeyId).map(({ messageId }) => messageId);
    const textsBefore = w.sms.messages.length;
    await w.runUntil((await w.clock.now()).getTime() + INTERVAL);
    const thirdRound = w.smsOf(journeyId).filter(({ messageId }) => !smsBefore.includes(messageId));
    expect(recipientsOf(thirdRound)).toEqual([r3.userId]);
    expect(thirdRound.map(({ messageId }) => w.rounds().get(messageId))).toEqual([3]);
    expect(recipientsOf(w.sms.messages.slice(textsBefore))).toEqual([r3.userId]);
  });
});

describe('SM-10, LOST-02 and LOST-07: one lost-contact push per responder per alert, and one SMS per responder per round', () => {
  test('SM-10-AC8: across the open, the escalation, two acknowledgements and two resets, and ten minutes of sweeps after: each responder has exactly one LOST_CONTACT for the alert, written by the open, and the push fake received one each; the SMS rows and the SMS fake hold one per responder per round in which A escalated: R1, R2 and R3 in round 1, R2 and R3 in round 2, R3 in round 3 (the server half of D-087’s owed test; LOST-02, LOST-07)', async () => {
    const w = world();
    const { journeyId, alertId, openedAt, responders } = await startedAndLost(w, 3);
    const [r1, r2, r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    await w.runUntil(openedAt.getTime() + TWO_MINUTES);
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);
    await w.runUntil(openedAt.getTime() + 3 * MINUTE);
    expect((await w.acknowledge(r2, alertId)).status).toBe(200);
    expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);
    await w.runUntil(openedAt.getTime() + 4 * MINUTE + 10 * MINUTE);

    const lostContact = w.messagesOf(journeyId).filter(({ kind }) => kind === 'LOST_CONTACT');
    expect(recipientsOf(lostContact)).toEqual(idsOf([r1, r2, r3]));
    expect(lostContact.map(({ createdAt }) => createdAt)).toEqual(lostContact.map(() => openedAt));
    expect(recipientsOf(w.push.messages.filter(({ kind }) => kind === 'LOST_CONTACT'))).toEqual(
      idsOf([r1, r2, r3]),
    );
    const rounds = w.rounds();
    const smsByRound = (round: number) =>
      recipientsOf(w.smsOf(journeyId).filter(({ messageId }) => rounds.get(messageId) === round));
    expect([smsByRound(1), smsByRound(2), smsByRound(3)]).toEqual([
      idsOf([r1, r2, r3]),
      idsOf([r2, r3]),
      [r3.userId],
    ]);
    expect(recipientsOf(w.sms.messages)).toEqual(
      [r1.userId, r2.userId, r2.userId, r3.userId, r3.userId, r3.userId].sort(),
    );
    expect(w.roundOf(alertId)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// SM-10-AC9 and AC10: the removal meets "I'm on it", the open, the escalation
// and the resolution on the journey's row.
// ---------------------------------------------------------------------------

describe('SM-10, LOST-06 and SM-09: the removal and "I’m on it" meet on the journey’s row', () => {
  test('SM-10-AC9: R1’s acknowledgement has read A, R1 a responder, and waits for J’s row while R1’s removal holds it and commits: 404 ALERT_NOT_FOUND through the API, the body a stranger gets, decided under the lock; A unacknowledged and no notice (LOST-06, SM-09)', async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, 2);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice];
    const stranger = w.responder();
    const strangers = await w.acknowledge(stranger, alertId);
    w.store.hold(journeyId);
    const callsBefore = w.store.calls.length;

    const acknowledging = w.acknowledge(r1, alertId);
    await until(
      () => w.store.calls.slice(callsBefore).includes('recordAcknowledgement'),
      'the acknowledgement past its read, waiting for the row',
    );
    let removed: unknown;
    await w.store.commitHold(journeyId, async () => {
      removed = await w.remove(journeyId, r1.userId);
    });
    const answer = await acknowledging;

    expect(removed).toEqual(REMOVED);
    expect(answer.status).toBe(404);
    expect(answer.text).toBe(strangers.text);
    expect(w.store.calls.slice(callsBefore)).toEqual([
      'alertForAcknowledgement',
      'recordAcknowledgement',
      'journeyForRemoval',
      'removeResponder',
    ]);
    expect(
      w.alertsOf(journeyId).map(({ state, acknowledgedBy }) => [state, acknowledgedBy]),
    ).toEqual([['OPEN', null]]);
    expect(w.messagesOf(journeyId).filter(({ kind }) => kind === NOTICE)).toEqual([]);
  });

  test('SM-10-AC9: R1’s acknowledgement holds J’s row and commits, and R1’s removal waits for it: the removal resets A, as AC4 (LOST-06, SM-09)', async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, 2);
    const [r1, r2] = responders as [RegisteredDevice, RegisteredDevice];
    w.store.hold(journeyId);
    const callsBefore = w.store.calls.length;

    const removing = w.remove(journeyId, r1.userId);
    await until(
      () => w.store.calls.slice(callsBefore).includes('removeResponder'),
      'the removal past its read, waiting for the row',
    );
    let acknowledgement: Answer | undefined;
    await w.store.commitHold(journeyId, async () => {
      acknowledgement = await w.acknowledge(r1, alertId);
    });

    expect(await removing).toEqual(REMOVED);
    expect(acknowledgement?.status).toBe(200);
    expect(
      w.alertsOf(journeyId).map(({ state, acknowledgedBy }) => [state, acknowledgedBy]),
    ).toEqual([['OPEN', null]]);
    expect(w.roundOf(alertId)).toBe(2);
    // R2's notice, written by the acknowledgement, withdrawn by the reset.
    const notices = w.messagesOf(journeyId).filter(({ kind }) => kind === NOTICE);
    expect(recipientsOf(notices)).toEqual([r2.userId]);
    expect(notices.map(({ withdrawnAt }) => withdrawnAt)).toEqual([await w.clock.now()]);
  });
});

describe('SM-10, LOST-02, LOST-03, LOST-07 and SM-04: the removal meets the open, the escalation and the resolution on the journey’s row', () => {
  /** Whether R's messages of J's alerts are all sent or withdrawn. */
  const nothingPendingFor = (w: World, journeyId: string, responderId: string) =>
    w
      .messagesOf(journeyId)
      .filter(
        ({ recipientId, sentAt, withdrawnAt }) =>
          recipientId === responderId && sentAt === null && withdrawnAt === null,
      );

  test('SM-10-AC10: R2’s row gone between the sweep’s read and its open (the fake’s beforeNext): the open writes LOST_CONTACT for R1 and R3 only; and R2 removed through the module before the sweep: the same (LOST-02)', async () => {
    for (const how of ['between the read and the open', 'before the sweep'] as const) {
      const w = world();
      const walker = w.walker();
      const [r1, r2, r3] = [w.responder(), w.responder(), w.responder()] as const;
      const journeyId = await w.seed(walker, [r1.userId, r2.userId, r3.userId], {
        silentForMs: FIVE_MINUTES + MINUTE,
      });
      if (how === 'before the sweep') {
        expect(await w.remove(journeyId, r2.userId), how).toEqual(REMOVED);
      } else {
        w.store.beforeNext('openLostContactAlert', () => {
          w.store.removeResponderRow(journeyId, r2.userId);
        });
      }

      await w.runLoops();

      expect(
        recipientsOf(w.messagesOf(journeyId).filter(({ kind }) => kind === 'LOST_CONTACT')),
        how,
      ).toEqual(idsOf([r1, r3]));
      expect(recipientsOf(w.push.messages), how).toEqual(idsOf([r1, r3]));
    }
  });

  test('SM-10-AC10: R2 removed after the open, its LOST_CONTACT push not yet accepted: withdrawn at the removal’s now, and never handed to the push port (LOST-02)', async () => {
    const w = world();
    const walker = w.walker();
    const [r1, r2, r3] = [w.responder(), w.responder(), w.responder()] as const;
    w.push.failFor(r2.userId, 'NO_TARGET');
    const journeyId = await w.seed(walker, [r1.userId, r2.userId, r3.userId], {
      silentForMs: FIVE_MINUTES + MINUTE,
    });
    await w.runLoops();
    const removedAt = await w.clock.now();

    expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);
    w.push.recover();
    await w.runUntil(removedAt.getTime() + 2 * MINUTE);

    const r2Push = w
      .messagesOf(journeyId)
      .find(({ kind, recipientId }) => kind === 'LOST_CONTACT' && recipientId === r2.userId);
    expect(r2Push).toMatchObject({
      sentAt: null,
      withdrawnAt: removedAt,
      lastFailure: 'NO_TARGET',
    });
    expect(recipientsOf(w.push.accepted)).not.toContain(r2.userId);
    expect(nothingPendingFor(w, journeyId, r2.userId)).toEqual([]);
  });

  test('SM-10-AC10: R2 removed before the escalation: the SMS go to R1 and R3 only; R2 removed after it, R2’s SMS unsent: withdrawn, and never handed to the SMS port (LOST-07)', async () => {
    for (const when of ['before', 'after'] as const) {
      const w = world();
      const { journeyId, openedAt, responders } = await lost(w, 3);
      const [r1, r2, r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
      w.sms.failFor(r2.userId, 'NO_TARGET');
      if (when === 'before') {
        expect(await w.remove(journeyId, r2.userId), when).toEqual(REMOVED);
      }
      await w.runUntil(openedAt.getTime() + TWO_MINUTES);
      if (when === 'after') {
        expect(recipientsOf(w.smsOf(journeyId)), when).toEqual(idsOf([r1, r2, r3]));
        expect(await w.remove(journeyId, r2.userId), when).toEqual(REMOVED);
      }
      const texts = w.sms.messages.length;
      w.sms.recover();
      await w.runUntil(openedAt.getTime() + TWO_MINUTES + 5 * MINUTE);

      expect(recipientsOf(w.sms.accepted), when).toEqual(idsOf([r1, r3]));
      expect(
        w.sms.messages.slice(texts).map(({ recipientId }) => recipientId),
        when,
      ).not.toContain(r2.userId);
      expect(nothingPendingFor(w, journeyId, r2.userId), when).toEqual([]);
      if (when === 'before') {
        expect(recipientsOf(w.smsOf(journeyId)), when).toEqual(idsOf([r1, r3]));
      }
    }
  });

  test.each(['contact comes back', '"I’m home"'] as const)(
    'SM-10-AC10: R2 removed before %s: the stand-downs go to R1 and R3 only (LOST-03, SM-04)',
    async (how) => {
      const w = world();
      const { walker, journeyId, responders } = await lost(w, 3);
      const [r1, r2, r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
      expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);

      if (how === 'contact comes back') {
        await w.heartbeat(walker, journeyId);
      } else {
        expect((await w.home(walker, journeyId)).status).toBe(200);
      }
      await w.runLoops();

      const standDowns = w
        .messagesOf(journeyId)
        .filter(({ kind }) => kind === 'BACK_IN_CONTACT' || kind === 'HOME');
      expect(recipientsOf(standDowns)).toEqual(idsOf([r1, r3]));
      expect(nothingPendingFor(w, journeyId, r2.userId)).toEqual([]);
    },
  );

  test('SM-10-AC10: R2 removed after contact came back, R2’s stand-down not yet accepted: withdrawn at the removal’s now, and never handed to the push port (LOST-03)', async () => {
    const w = world();
    const { walker, journeyId, responders } = await lost(w, 3);
    const [r1, r2, r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    w.push.failFor(r2.userId, 'UNAVAILABLE');
    await w.heartbeat(walker, journeyId);
    await w.runLoops();
    const removedAt = await w.clock.now();

    expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);
    w.push.recover();
    await w.runUntil(removedAt.getTime() + 2 * MINUTE);

    const r2StandDown = w
      .messagesOf(journeyId)
      .find(({ kind, recipientId }) => kind === 'BACK_IN_CONTACT' && recipientId === r2.userId);
    expect(r2StandDown).toMatchObject({ sentAt: null, withdrawnAt: removedAt });
    // R2's lost-contact push was accepted before contact came back; its stand-down never is.
    expect(recipientsOf(w.push.accepted.filter(({ kind }) => kind === 'BACK_IN_CONTACT'))).toEqual(
      idsOf([r1, r3]),
    );
    expect(nothingPendingFor(w, journeyId, r2.userId)).toEqual([]);
  });

  test('SM-10-AC10: after "I’m home" J has ENDED, so a removal of R2 is ignored (SM-07, the spec’s reading 2): nothing is withdrawn, and R2’s stand-down is left to be sent (SM-04)', async () => {
    const w = world();
    const { walker, journeyId, responders } = await lost(w, 3);
    const [, r2] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    expect((await w.home(walker, journeyId)).status).toBe(200);
    const before = w.recordOf(journeyId);

    expect(await w.remove(journeyId, r2.userId)).toEqual(JOURNEY_ENDED);
    await w.runLoops();

    expect(w.messagesOf(journeyId).filter(({ withdrawnAt }) => withdrawnAt !== null)).toEqual(
      before.messages.filter(({ withdrawnAt }) => withdrawnAt !== null),
    );
    expect(recipientsOf(w.push.accepted.filter(({ kind }) => kind === 'HOME'))).toContain(
      r2.userId,
    );
  });
});

// ---------------------------------------------------------------------------
// SM-10-AC11: a removed responder hears nothing more (Q2 (a)).
// ---------------------------------------------------------------------------

describe('SM-10 and LOST-03: a removed responder hears nothing more (Q2 (a))', () => {
  /**
   * J LOST_CONTACT and A ESCALATED, and R2 holding: a LOST_CONTACT accepted;
   * a LOST_CONTACT_SMS that failed NO_TARGET and is due again; an
   * ACKNOWLEDGED notice never claimed; and a HOME stand-down of an earlier
   * alert of J, unsent and failing.
   */
  async function holding(w: World) {
    const alerted = await lost(w, 3);
    const [r1, r2, r3] = alerted.responders as [
      RegisteredDevice,
      RegisteredDevice,
      RegisteredDevice,
    ];
    const { journeyId, alertId, openedAt } = alerted;
    w.sms.failFor(r2.userId, 'NO_TARGET');
    await w.runUntil(openedAt.getTime() + TWO_MINUTES);
    const now = (await w.clock.now()).getTime();
    // Put in directly: by the flows, R2's notice would mean A acknowledged,
    // and the HOME stand-down an alert resolved by "I'm home", which ends J.
    // The spec's given holds them together, as the removal must meet them.
    const notice = w.store.seedMessage({
      alertId,
      recipientId: r2.userId,
      kind: NOTICE,
      createdAt: new Date(now),
      nextAttemptAt: new Date(now + HOUR),
    });
    // The journey started an hour before its silence (lost()); the earlier
    // alert opened and resolved inside that hour.
    const earlier = w.store.seedAlert({
      journeyId,
      state: 'RESOLVED',
      openedAt: new Date(now - 40 * MINUTE),
      silentSince: new Date(now - 45 * MINUTE),
      resolvedAt: new Date(now - 30 * MINUTE),
      resolution: 'HOME',
    });
    const standDown = w.store.seedMessage({
      alertId: earlier,
      recipientId: r2.userId,
      kind: 'HOME',
      createdAt: new Date(now - 30 * MINUTE),
      nextAttemptAt: new Date(now + 30 * SECOND),
      attempts: 3,
      lastFailure: 'UNAVAILABLE',
    });
    const r2s = (kind: string) =>
      w
        .messagesOf(journeyId)
        .find((message) => message.recipientId === r2.userId && message.kind === kind);
    expect(r2s('LOST_CONTACT')?.sentAt, 'R2’s push accepted').not.toBeNull();
    expect(r2s(SMS)).toMatchObject({ sentAt: null, lastFailure: 'NO_TARGET', attempts: 1 });
    return { ...alerted, r1, r2, r3, notice, standDown, r2s };
  }

  test('SM-10-AC11: R2 removed: each of R2’s unsent messages of J’s alerts — the SMS, the notice and the earlier alert’s stand-down — is withdrawn at the removal’s now, keeping attempts and last failure, and is never handed to a port again; the accepted push as it was; every other responder’s messages as they were; and when A then resolves, R2 gets no stand-down, and R1 and R3 one each (LOST-03)', async () => {
    const w = world();
    const { walker, journeyId, alertId, r1, r2, r3, notice, standDown, r2s } = await holding(w);
    const before = w.messagesOf(journeyId);
    const removedAt = await w.clock.now();
    const unsent = [r2s(SMS)?.messageId ?? '', notice, standDown];

    expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);

    const after = new Map(w.messagesOf(journeyId).map((message) => [message.messageId, message]));
    for (const message of before) {
      const expected = unsent.includes(message.messageId)
        ? { ...message, withdrawnAt: removedAt }
        : message;
      expect(after.get(message.messageId), `${message.kind} for ${message.recipientId}`).toEqual(
        expected,
      );
    }
    // Never handed to a port again, however long the loops run.
    w.sms.recover();
    const pushed = w.push.messages.length;
    const texted = w.sms.messages.length;
    await w.runUntil(removedAt.getTime() + 10 * MINUTE);
    for (const message of [...w.push.messages.slice(pushed), ...w.sms.messages.slice(texted)]) {
      expect(unsent).not.toContain(message.messageId);
      expect(message.recipientId).not.toBe(r2.userId);
    }

    // A resolves: R1 and R3 are stood down, R2 is not.
    await w.heartbeat(walker, journeyId);
    await w.runLoops();
    const standDowns = w
      .messagesOf(journeyId)
      .filter((message) => message.alertId === alertId && message.kind === 'BACK_IN_CONTACT');
    expect(recipientsOf(standDowns)).toEqual(idsOf([r1, r3]));
    expect(recipientsOf(w.push.accepted.filter(({ kind }) => kind === 'BACK_IN_CONTACT'))).toEqual(
      idsOf([r1, r3]),
    );
  });

  test.each(['accepts it', 'refuses it'] as const)(
    'SM-10-AC11: R2’s SMS handed to the SMS port and not yet answered (holdAnswers) when R2 is removed: withdrawn; when the port %s, it is marked as the port answered, and never retried (LOST-03)',
    async (answer) => {
      const w = world();
      const { journeyId, r2, r2s } = await holding(w);
      const sms = r2s(SMS)?.messageId ?? '';
      w.clock.advance(MINUTE);
      w.sms.recover();
      if (answer === 'refuses it') {
        w.sms.failFor(r2.userId, 'UNAVAILABLE');
      }
      w.sms.holdAnswers();
      const delivering = w.smsSender.deliverDue();
      await until(
        () => w.sms.messages.filter(({ messageId }) => messageId === sms).length === 2,
        'R2’s SMS handed to the port again',
      );
      const removedAt = await w.clock.now();

      expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);
      expect(r2s(SMS)?.withdrawnAt).toEqual(removedAt);

      w.sms.releaseAnswers();
      expect(await delivering).toEqual(
        answer === 'accepts it' ? { sent: 1, failed: 0 } : { sent: 0, failed: 1 },
      );
      expect(r2s(SMS)).toMatchObject(
        answer === 'accepts it'
          ? { sentAt: removedAt, withdrawnAt: removedAt }
          : { sentAt: null, lastFailure: 'UNAVAILABLE', withdrawnAt: removedAt },
      );
      w.sms.recover();
      const texted = w.sms.messages.length;
      await w.runUntil(removedAt.getTime() + 10 * MINUTE);
      expect(w.sms.messages.slice(texted).map(({ messageId }) => messageId)).not.toContain(sms);
    },
  );
});

// ---------------------------------------------------------------------------
// SM-10-AC12 and AC13: the walker is warned when the last responder goes. The
// roadmap's "both rules at L6", its second half.
// ---------------------------------------------------------------------------

describe('SM-10 and SM-02: the walker is warned at once when the last responder is removed', () => {
  test('SM-10-AC12: J ACTIVE, started naming R1 and R2; R1 removed: nothing written for W; R2 removed: exactly one NO_RESPONDER for W, naming J and no alert, written and due at the removal’s now; the push sender’s next run hands it to the push fake with exactly messageId, recipientId W and kind NO_RESPONDER, the ID a UUID equal to no user’s, journey’s, alert’s or device’s; nothing for anyone else; J still ACTIVE (SM-02)', async () => {
    const w = world();
    const walker = w.walker();
    const [r1, r2] = [w.responder(), w.responder()] as const;
    const journeyId = await w.start(walker, [r1.userId, r2.userId]);
    await w.heartbeat(walker, journeyId);

    expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);
    expect(w.store.journeyMessages()).toEqual([]);

    w.clock.advance(3 * SECOND);
    const removedAt = await w.clock.now();
    expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);

    const [warning] = w.warningsOf(journeyId);
    expect(w.store.journeyMessages()).toEqual([
      {
        messageId: warning?.messageId,
        journeyId,
        recipientId: walker.userId,
        kind: WARNING,
        round: 1,
        createdAt: removedAt,
        attempts: 0,
        nextAttemptAt: removedAt,
        sentAt: null,
        lastFailure: null,
        withdrawnAt: null,
      },
    ]);
    const messageId = warning?.messageId ?? '';
    expect(messageId).toMatch(LOWER_UUID);
    expect([
      walker.userId,
      walker.deviceId,
      r1.userId,
      r1.deviceId,
      r2.userId,
      r2.deviceId,
      journeyId,
    ]).not.toContain(messageId);
    expect(w.store.outbox()).toEqual([]);
    expect(w.store.alerts()).toEqual([]);

    expect(await w.sender.deliverDue()).toEqual({ sent: 1, failed: 0 });
    expect(w.push.messages).toEqual([{ messageId, recipientId: walker.userId, kind: WARNING }]);
    for (const message of w.push.messages) {
      expect(Object.keys(message).sort()).toEqual(['kind', 'messageId', 'recipientId']);
    }
    expect(w.warningsOf(journeyId)[0]?.sentAt).toEqual(removedAt);
    expect(w.stateOf(journeyId)).toBe('ACTIVE');
    expect(w.log.events).toEqual([]);
  });

  test('SM-10-AC12: the same while J is LOST_CONTACT, its alert open: one NO_RESPONDER for W, naming J and no alert; the alert as it was (SM-02)', async () => {
    const w = world();
    const { walker, journeyId, alertId, responders } = await lost(w, 2);
    const [r1, r2] = responders as [RegisteredDevice, RegisteredDevice];
    const alertBefore = w.alertsOf(journeyId);

    expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);
    expect(w.warningsOf(journeyId)).toEqual([]);
    expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);

    expect(
      w
        .warningsOf(journeyId)
        .map(({ recipientId, kind, journeyId: of }) => [recipientId, kind, of]),
    ).toEqual([[walker.userId, WARNING, journeyId]]);
    expect(w.alertsOf(journeyId)).toEqual(alertBefore);
    expect(w.roundOf(alertId)).toBe(1);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(recipientsOf(w.messagesOf(journeyId))).not.toContain(walker.userId);
  });

  test('SM-10-AC12: no warning when a removal leaves a responder, for an ENDED journey, or for a removal answered unchanged (SM-02)', async () => {
    const w = world();
    const walker = w.walker();
    const [r1, r2] = [w.responder(), w.responder()] as const;
    const journeyId = await w.start(walker, [r1.userId, r2.userId]);
    expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);
    expect(await w.remove(journeyId, r1.userId)).toEqual(NOT_A_RESPONDER);
    expect(await w.remove(journeyId, walker.userId)).toEqual(NOT_A_RESPONDER);
    expect(w.store.journeyMessages()).toEqual([]);

    const ended = w.walker();
    const last = w.responder();
    const endedJourney = await w.start(ended, [last.userId]);
    expect((await w.home(ended, endedJourney)).status).toBe(200);
    expect(await w.remove(endedJourney, last.userId)).toEqual(JOURNEY_ENDED);

    expect(w.store.journeyMessages()).toEqual([]);
    expect(w.respondersOf(journeyId)).toEqual([r2.userId]);
  });

  test('SM-10-AC12: the SMS claim never hands the warning out, and the SMS check never counts it as an SMS, however long it waits unsent (SM-02)', async () => {
    const w = world();
    const walker = w.walker();
    const r1 = w.responder();
    const journeyId = await w.start(walker, [r1.userId]);
    w.push.failAll('NOT_CONFIGURED');
    expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);

    for (let minute = 0; minute < 3; minute += 1) {
      expect(await w.smsSender.deliverDue()).toEqual({ sent: 0, failed: 0 });
      w.clock.advance(SMS_UNSENT_LIMIT);
      expect(await w.smsCheck.check()).toBe('ok');
    }

    expect(w.sms.messages).toEqual([]);
    expect(w.alarm.statuses).toEqual(['ok', 'ok', 'ok']);
    expect(w.lines('sms_unsent', 'unheard_alerts')).toEqual([]);
    expect(w.warningsOf(journeyId)[0]?.sentAt).toBeNull();
  });
});

describe('SM-10 and SM-02: one warning for the last responder, whoever removes', () => {
  test('SM-10-AC13: J’s last two responders removed one after the other: exactly one NO_RESPONDER, for the removal that comes second, and no error (SM-02)', async () => {
    const w = world();
    const walker = w.walker();
    const [r1, r2] = [w.responder(), w.responder()] as const;
    const journeyId = await w.start(walker, [r1.userId, r2.userId]);

    expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);
    expect(w.warningsOf(journeyId)).toEqual([]);
    expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);

    expect(w.warningsOf(journeyId).map(({ recipientId }) => recipientId)).toEqual([walker.userId]);
  });

  test('SM-10-AC13: J’s last two responders removed at the same moment, five times over: each time exactly one NO_RESPONDER between them, and no error (SM-02)', async () => {
    for (let round = 0; round < 5; round += 1) {
      const at = `round ${String(round)}`;
      const w = world();
      const walker = w.walker();
      const [r1, r2] = [w.responder(), w.responder()] as const;
      const journeyId = await w.start(walker, [r1.userId, r2.userId]);

      expect(
        await Promise.all([w.remove(journeyId, r1.userId), w.remove(journeyId, r2.userId)]),
        at,
      ).toEqual([REMOVED, REMOVED]);

      expect(
        w.warningsOf(journeyId).map(({ recipientId }) => recipientId),
        at,
      ).toEqual([walker.userId]);
      expect(w.respondersOf(journeyId), at).toEqual([]);
      expect(w.log.events, at).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// SM-10-AC15: a journey left with no responder that goes silent (Q3 (a)).
// ---------------------------------------------------------------------------

describe('SM-10, SM-02, LOST-02 and LOST-07: a journey left with no responder that goes silent opens with nobody to tell, and the owner is paged', () => {
  test.each(['contact comes back', 'W says "I’m home"'] as const)(
    'SM-10-AC15: J started with R1, R1 removed and W warned; D goes silent and the loops run past five minutes: J LOST_CONTACT with one OPEN alert and no message, the sweep ok, counting it opened, and the beat recorded; no sweep escalates it, writes an SMS for it or fails on it; the SMS check reports failing each minute with one unheard_alerts line, count 1; when %s the alert resolves with no stand-down, and the next check reports ok (SM-02, LOST-02, LOST-07)',
    async (how) => {
      const w = world();
      const walker = w.walker();
      const r1 = w.responder();
      const journeyId = await w.start(walker, [r1.userId]);
      await w.heartbeat(walker, journeyId);
      const lastContact = await w.clock.now();
      expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);
      expect(w.warningsOf(journeyId)).toHaveLength(1);

      const sweeps: unknown[] = [];
      for (
        let at = lastContact.getTime() + INTERVAL;
        at <= lastContact.getTime() + FIVE_MINUTES + 5 * MINUTE;
        at += INTERVAL
      ) {
        w.clock.advance(at - (await w.clock.now()).getTime());
        sweeps.push(await w.watchdog.sweep());
        if (
          (at - lastContact.getTime()) % MINUTE === 0 &&
          at > lastContact.getTime() + FIVE_MINUTES
        ) {
          expect(await w.smsCheck.check(), `the check at ${String(at)}`).toBe('failing');
        }
      }

      expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
      expect(w.alertsOf(journeyId).map(({ state, smsRaisedAt }) => [state, smsRaisedAt])).toEqual([
        ['OPEN', null],
      ]);
      expect(w.messagesOf(journeyId)).toEqual([]);
      expect(
        sweeps.filter((swept) => JSON.stringify(swept) !== JSON.stringify(QUIET_SWEEP)),
      ).toEqual([{ ...QUIET_SWEEP, opened: 1 }]);
      expect(await w.beats.lastBeat()).toEqual(await w.clock.now());
      expect(w.alarm.statuses.length).toBeGreaterThanOrEqual(4);
      expect(new Set(w.alarm.statuses)).toEqual(new Set(['failing']));
      expect(w.lines('unheard_alerts')).toEqual(
        w.alarm.statuses.map(() => ({ event: 'unheard_alerts', count: 1 })),
      );
      expect(w.lines('escalation_failed', 'watchdog_failed', 'watchdog_overdue')).toEqual([]);

      if (how === 'contact comes back') {
        await w.heartbeat(walker, journeyId);
      } else {
        expect((await w.home(walker, journeyId)).status).toBe(200);
      }
      expect(w.alertsOf(journeyId).map(({ state }) => state)).toEqual(['RESOLVED']);
      expect(w.messagesOf(journeyId)).toEqual([]);
      expect(await w.smsCheck.check()).toBe('ok');
      expect(w.alarm.statuses.at(-1)).toBe('ok');
    },
  );

  test('SM-10-AC15: an alert reset by removing its acknowledger, who was the last responder, is unheard the same way: not escalated, and counted by the SMS check (SM-02, LOST-07)', async () => {
    const w = world();
    const { journeyId, alertId, openedAt, responders } = await lost(w, 1);
    const [r1] = responders as [RegisteredDevice];
    await w.runUntil(openedAt.getTime() + MINUTE);
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);

    await w.runUntil(openedAt.getTime() + 10 * MINUTE);

    expect(w.alertsOf(journeyId).map(({ state, smsRaisedAt }) => [state, smsRaisedAt])).toEqual([
      ['OPEN', null],
    ]);
    expect(w.smsOf(journeyId)).toEqual([]);
    expect(await w.smsCheck.check()).toBe('failing');
    expect(w.lines('unheard_alerts')).toEqual([{ event: 'unheard_alerts', count: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// SM-10-AC18, AC19 and AC20: a failure is loud, the times are the store's,
// and nothing personal reaches a log.
// ---------------------------------------------------------------------------

describe('SM-10: a removal that fails is loud', () => {
  test.each([
    ['read', 'journeyForRemoval', '57P01'],
    ['store', 'removeResponder', '40001'],
  ] as const)(
    'SM-10-AC18: with the fake failing the removal’s %s, the module throws the store’s error, never an answer, with one removal_failed line naming that stage and its SQLSTATE; nothing changed',
    async (stage, call, code) => {
      const w = world();
      const walker = w.walker();
      const [r1, r2] = [w.responder(), w.responder()] as const;
      const journeyId = await w.start(walker, [r1.userId, r2.userId]);
      const before = w.recordOf(journeyId);
      const error = databaseError(code);
      w.store.failWith(error, call);

      await expect(w.remove(journeyId, r1.userId)).rejects.toBe(error);

      expect(w.log.events).toEqual([{ event: 'removal_failed', stage, code }]);
      expect(w.recordOf(journeyId)).toEqual(before);
      w.store.recover();
      expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);
    },
  );

  test('SM-10-AC18: a failure with no SQLSTATE is one removal_failed line with code null, and the throw', async () => {
    const w = world();
    const r1 = w.responder();
    const journeyId = await w.start(w.walker(), [r1.userId]);
    const error = new Error('the connection was cut');
    w.store.failWith(error, 'removeResponder');

    await expect(w.remove(journeyId, r1.userId)).rejects.toBe(error);

    expect(w.log.events).toEqual([{ event: 'removal_failed', stage: 'store', code: null }]);
  });
});

describe('SM-10 and REL-01: the removal’s times are the store’s', () => {
  test('SM-10-AC19: the removal’s withdrawals and the warning are at the store’s now as it answers, not as it was asked (the clock moved by beforeNext); and the resumed escalation’s sms_raised_at is the sweep’s own now, never the removal’s (REL-01)', async () => {
    const w = world();
    const { walker, journeyId, alertId, openedAt, responders } = await startedAndLost(w, 2);
    const [r1, r2] = responders as [RegisteredDevice, RegisteredDevice];
    await w.runUntil(openedAt.getTime() + 3 * MINUTE);
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    const asked = await w.clock.now();
    w.store.beforeNext('removeResponder', () => {
      w.clock.advance(1_234);
    });

    expect(await w.remove(journeyId, r1.userId)).toEqual(REMOVED);
    const removedAt = new Date(asked.getTime() + 1_234);

    const notices = w.messagesOf(journeyId).filter(({ kind }) => kind === NOTICE);
    expect(notices.map(({ withdrawnAt }) => withdrawnAt)).toEqual([removedAt]);
    w.clock.advance(INTERVAL - 1_234);
    const sweptAt = await w.clock.now();
    await w.runLoops();
    expect(w.alertsOf(journeyId)[0]?.smsRaisedAt).toEqual(sweptAt);
    expect(w.alertsOf(journeyId)[0]?.smsRaisedAt).not.toEqual(removedAt);

    w.store.beforeNext('removeResponder', () => {
      w.clock.advance(777);
    });
    const lastAsked = await w.clock.now();
    expect(await w.remove(journeyId, r2.userId)).toEqual(REMOVED);
    const [warning] = w.warningsOf(journeyId);
    expect([warning?.createdAt, warning?.nextAttemptAt]).toEqual([
      new Date(lastAsked.getTime() + 777),
      new Date(lastAsked.getTime() + 777),
    ]);
    expect(warning?.recipientId).toBe(walker.userId);
  });
});

describe('PRIV-07 and SM-10: nothing personal reaches a log', () => {
  test('SM-10-AC20: when the store fails the removal’s read and its write, and the unheard count, each with an error whose message holds a synthetic coordinate, a phone-number-shaped string, a credential-like string, the removed responder’s ID and the walker’s ID, nothing written to stdout, stderr or the console holds any of them; the capture sees the lines the production log wrote, and the errors do hold the markers (PRIV-07)', async () => {
    // The production log, writing to this process's stdout, where the
    // capture watches: the recording fake would prove only what the modules
    // chose, not what reached a stream.
    const w = world({ log: createLog() });
    const walker = w.walker();
    const [r1, r2] = [w.responder(), w.responder()] as const;
    const journeyId = await w.start(walker, [r1.userId, r2.userId]);
    const coordinate = String(syntheticCoordinate());
    // Phone-number-shaped, made at run time: eight digits, a leading 0, which
    // no Norwegian subscriber number has, and never the +47 form.
    const phoneShaped = `0${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
    const credential = `postgres://synthetic:${syntheticCredential()}@127.0.0.1:1/synthetic`;
    const markers = [coordinate, phoneShaped, credential, r1.userId, walker.userId];
    const thrown: Error[] = [];
    const failing = (code: string) => {
      const error = databaseError(
        code,
        `failed near (${coordinate}) for ${phoneShaped} as ${credential}: removing ${r1.userId} from ${walker.userId}'s journey`,
      );
      thrown.push(error);
      return error;
    };

    const { written, result } = await captured(async () => {
      const results: unknown[] = [];
      w.store.failWith(failing('57P01'), 'journeyForRemoval');
      results.push(await w.remove(journeyId, r1.userId).catch((error: unknown) => error));
      w.store.failWith(failing('40001'), 'removeResponder');
      results.push(await w.remove(journeyId, r1.userId).catch((error: unknown) => error));
      w.store.failWith(failing('08006'), 'unheardAlertCount');
      results.push(await w.smsCheck.check());
      w.store.recover();
      // And a line the production log writes on the way that works: the
      // removal of an ended journey, and the unheard count.
      expect((await w.home(walker, journeyId)).status).toBe(200);
      results.push(await w.remove(journeyId, r1.userId));
      return results;
    });

    // Controls: the errors hold every marker, the work was done, and the
    // capture saw the production log's lines.
    expect(thrown).toHaveLength(3);
    for (const error of thrown) {
      expect(markersIn(error.message, markers)).toEqual(markers);
    }
    expect(result).toEqual([thrown[0], thrown[1], 'unread', JOURNEY_ENDED]);
    for (const event of ['removal_failed', 'sms_check_failed', 'removal_ignored']) {
      expect(written).toContain(`"event":"${event}"`);
    }

    expect(markersIn(written, markers)).toEqual([]);
  });
});
