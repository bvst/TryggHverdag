// L6 system: SMS escalation (LOST-07, REL-07), through the whole server in one
// process.
//
// The real API, the real journey and acknowledgement modules, the real
// watchdog, the real push sender, the real SMS sender and the real SMS check,
// with fakes only at the edges: the device credentials, the journey store, the
// worker's beats, the push port, the SMS port, the SMS check's monitor and the
// log. One fake clock stands in for the database's now(): the store reads it
// as PostgreSQL's now() would be read. No module reads a clock (AR-03). The
// loops are run here as the worker runs them, every 10 s (D-107): a sweep,
// then a push delivery, then an SMS delivery, so an SMS goes in the run that
// escalated it, as a sweep that escalated wakes the SMS loop.
//
// What is proven here, the roadmap's "done when" for M2's task 6: "the
// escalation and the page pass at L6 against a recording SMS fake":
//   - with no acknowledgement, every responder gets an SMS at two minutes,
//     and nobody else (AC1); with one at a minute, no SMS is sent (AC2);
//   - the escalation reads both halves of an acknowledgement (AC3), happens
//     once (AC4), and meets "I'm on it" on the journey's row (AC5);
//   - "I'm on it" withdraws the unsent SMS (AC6), and a resolution withdraws
//     them with the pushes and stands every responder down by push only (AC7);
//   - each message reaches its own port, content-free (AC8), the SMS with
//     retries on a sender of its own (AC9);
//   - a failed SMS pages the owner, and the page fails toward paging (AC10,
//     AC11); an escalation is all or nothing (AC15), a held row never hides
//     one (AC16), its time is the store's (AC17), and nothing personal
//     reaches a log (AC18).
//
// The requirements this file holds, beside LOST-07 and REL-07: LOST-02 (the
// alert and its content-free messages), LOST-06 ("I'm on it"), LOST-03 and
// SM-04 (contact back and "I'm home"), SM-09 (the journey's row, the order of
// arrival), REL-01 (the store's time) and PRIV-07 (nothing personal in a log).
//
// This file is the `alerts` mutation group's third test file (D-116): the
// escalation, the SMS sender and the SMS check live in modules/alerts/. Times
// are written out (two minutes, five minutes, 10 s, 60 s), not read from the
// domain's constants, so a wrong constant fails here as well as in the
// domain's own tests.
import {
  MESSAGE_KINDS,
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
import { createJourneyService } from './modules/journeys/service.ts';
import type { Log, OutboxStore, WatchdogStore } from './ports.ts';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** D-021: responders are alerted when the server has heard nothing for five minutes, or more. */
const FIVE_MINUTES = 5 * MINUTE;
/** D-019: every responder gets an SMS when nobody has acknowledged within two minutes, or more. */
const TWO_MINUTES = 2 * MINUTE;
/** How often the worker's loops run (D-107). */
const INTERVAL = 10 * SECOND;
/** How long a claimed message is leased (LOST-02, approach item 5). */
const LEASE = 30 * SECOND;
/** An SMS still unsent this long after it was written is failing, and pages (approach item 8). */
const SMS_UNSENT_LIMIT = 60 * SECOND;
/** Past the two minutes, how long a held row is skipped before it is waited for once (STUCK_AFTER_MS). */
const STUCK_AFTER = 30 * SECOND;
/** The longest a stand-down is ever held (LOST-03, D-112): the retry cap. */
const LONGEST_HOLD = 60 * SECOND;

/** A synthetic night: 21:00 UTC on 1 October 2026. */
const START = new Date('2026-10-01T21:00:00.000Z');

const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SMS = 'LOST_CONTACT_SMS';
const ON_IT = { outcome: 'ACKNOWLEDGED' };

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

/** A few turns of the event loop: long enough for anything that was going to settle to settle. */
async function aFewTurns(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
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
    async runUntil(at: Date | number, { smsLoop = true }: { smsLoop?: boolean } = {}) {
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
        if (smsLoop) {
          await smsSender.deliverDue();
        }
      }
    },
    stateOf: (journeyId: string) => store.journeys().find(({ id }) => id === journeyId)?.state,
    alertsOf: (journeyId: string) =>
      store.alerts().filter((alert) => alert.journeyId === journeyId),
    messagesOf(journeyId: string) {
      const alertIds = self.alertsOf(journeyId).map(({ id }) => id);
      return store.outbox().filter(({ alertId }) => alertIds.includes(alertId));
    },
    smsOf: (journeyId: string) => self.messagesOf(journeyId).filter(({ kind }) => kind === SMS),
    /** The SMS check's own lines, and the escalation's: the ones a check or a sweep chose to write. */
    lines: (...names: string[]) => recorded.events.filter(({ event }) => names.includes(event)),
  };
  return self;
}

type World = ReturnType<typeof world>;

/** Recipients of these messages, sorted. */
const recipientsOf = (messages: readonly { recipientId: string }[]) =>
  messages.map(({ recipientId }) => recipientId).sort();

/** The distinct message IDs of these messages. */
const idsOf = (messages: readonly { messageId: string }[]) =>
  [...new Set(messages.map(({ messageId }) => messageId))].sort();

/**
 * An overdue journey of a new walker, with `count` responders, swept: LOST_CONTACT,
 * with its alert opened at the clock's now and one unsent LOST_CONTACT push per
 * responder.
 */
async function lost(w: World, count = 3) {
  const walker = w.walker();
  const responders = Array.from({ length: count }, () => w.responder());
  const responderIds = responders.map(({ userId }) => userId);
  const journeyId = await w.seed(walker, responderIds, { silentForMs: FIVE_MINUTES + MINUTE });
  const swept = await w.watchdog.sweep();
  expect(swept.opened, 'the sweep opened the alert').toBe(1);
  const [alert] = w.alertsOf(journeyId);
  if (alert === undefined) {
    throw new Error('expected the sweep to open an alert');
  }
  return {
    walker,
    responders,
    responderIds,
    journeyId,
    alertId: alert.id,
    openedAt: alert.openedAt,
  };
}

/** As `lost`, two minutes on: the alert is due for escalation. */
async function due(w: World, count = 3) {
  const alerted = await lost(w, count);
  w.clock.advance(TWO_MINUTES);
  return alerted;
}

/** As `due`, swept: the alert ESCALATED, with one unsent LOST_CONTACT_SMS per responder, due now. */
async function escalated(w: World, count = 3) {
  const alerted = await due(w, count);
  const swept = await w.watchdog.sweep();
  expect(swept, 'the sweep escalated the alert').toEqual({ ...QUIET_SWEEP, escalated: 1 });
  const smsOf = (recipientId: string) =>
    w.smsOf(alerted.journeyId).find((message) => message.recipientId === recipientId)?.messageId ??
    '';
  return { ...alerted, smsRaisedAt: await w.clock.now(), smsOf };
}

/** An SMS sender whose claim takes at most `limit`: the batch was full, so the rest are left unclaimed. */
function smsSenderOf(w: World, limit: number) {
  const outbox: OutboxStore = {
    claimDue: (request) => w.store.claimDue(request),
    claimDueSms: (request: { limit: number; leaseMs: number }) =>
      w.store.claimDueSms({ ...request, limit }),
    markSent: (messageId) => w.store.markSent(messageId),
    markFailed: (request) => w.store.markFailed(request),
    unsentSmsCount: (olderThanMs: number) => w.store.unsentSmsCount(olderThanMs),
  };
  return createSmsSender({ outbox, sms: w.sms, log: w.log });
}

// ---------------------------------------------------------------------------
// LOST-07-AC1 and AC2: the story's two tests, and the roadmap's "done when".
// ---------------------------------------------------------------------------

describe('LOST-07, REL-07 and LOST-02: with no acknowledgement, every responder gets an SMS at two minutes', () => {
  test('LOST-07-AC1: W starts J through the API with R1, R2 and R3; D sends a heartbeat every 60 s for 10 minutes and goes silent; at five minutes the alert opens and each responder is pushed LOST_CONTACT, R2’s push failing NO_TARGET throughout; at 119 999 ms after the alert opened it is still OPEN with no escalation time and no SMS has gone; at exactly 120 000 ms it is ESCALATED at the store’s now, J still LOST_CONTACT with one alert, and the SMS fake holds exactly one LOST_CONTACT_SMS for each of R1, R2 and R3, none for W or anyone else; the push fake holds nothing the escalation caused; ten more minutes escalate and send nothing more', async () => {
    const w = world();
    const walker = w.walker();
    const [r1, r2, r3] = [w.responder(), w.responder(), w.responder()] as const;
    const bystander = w.responder();
    w.push.failFor(r2.userId, 'NO_TARGET');
    const journeyId = await w.start(walker, [r1.userId, r2.userId, r3.userId]);

    // Ten minutes of heartbeats, one every 60 s, the loops running every 10 s.
    let lastHeartbeatAt = START;
    for (let second = 0; second <= 600; second += 10) {
      if (second % 60 === 0) {
        await w.heartbeat(walker, journeyId);
        lastHeartbeatAt = await w.clock.now();
      }
      await w.runLoops();
      w.clock.advance(INTERVAL);
    }
    // Then silence, and at five minutes the alert.
    await w.runUntil(new Date(lastHeartbeatAt.getTime() + FIVE_MINUTES));
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    const [alert] = w.alertsOf(journeyId);
    const openedAt = alert?.openedAt ?? new Date(Number.NaN);
    expect(recipientsOf(w.push.accepted.filter(({ kind }) => kind === 'LOST_CONTACT'))).toEqual(
      [r1.userId, r3.userId].sort(),
    );
    const pushedBefore = idsOf(w.push.messages);

    // A millisecond under two minutes: still OPEN, no escalation time, no SMS.
    await w.runUntil(openedAt.getTime() + TWO_MINUTES - 1);
    expect(w.alertsOf(journeyId).map(({ state, smsRaisedAt }) => [state, smsRaisedAt])).toEqual([
      ['OPEN', null],
    ]);
    expect(w.smsOf(journeyId)).toEqual([]);
    expect(w.sms.messages).toEqual([]);

    // Exactly two minutes: escalated, and every responder texted, R2 included.
    w.clock.advance(1);
    const at = await w.clock.now();
    const { swept, texted } = await w.runLoops();

    expect(swept).toEqual({ ...QUIET_SWEEP, escalated: 1 });
    expect(texted).toEqual({ sent: 3, failed: 0 });
    expect(w.alertsOf(journeyId).map(({ state, smsRaisedAt }) => [state, smsRaisedAt])).toEqual([
      ['ESCALATED', at],
    ]);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(w.sms.messages.map(({ kind }) => kind)).toEqual([SMS, SMS, SMS]);
    expect(recipientsOf(w.sms.accepted)).toEqual([r1.userId, r2.userId, r3.userId].sort());
    for (const nobody of [walker.userId, bystander.userId]) {
      expect(recipientsOf(w.sms.messages)).not.toContain(nobody);
    }
    // Nothing the escalation caused reached the push port: no new message,
    // so no second LOST_CONTACT, and no SMS kind.
    expect(idsOf(w.push.messages)).toEqual(pushedBefore);
    expect(w.push.messages.filter(({ kind }) => kind === SMS)).toEqual([]);

    // Ten more minutes: nothing more escalated, nothing more sent by either port.
    const accepted = { push: w.push.accepted.length, sms: w.sms.accepted.length };
    const texts = w.sms.messages.length;
    await w.runUntil(new Date(at.getTime() + 10 * MINUTE));
    expect(w.alertsOf(journeyId).map(({ state, smsRaisedAt }) => [state, smsRaisedAt])).toEqual([
      ['ESCALATED', at],
    ]);
    expect(w.smsOf(journeyId)).toHaveLength(3);
    expect(w.sms.messages).toHaveLength(texts);
    expect(idsOf(w.push.messages)).toEqual(pushedBefore);
    expect({ push: w.push.accepted.length, sms: w.sms.accepted.length }).toEqual(accepted);
    // R2's push failing is the only thing anyone logged; the escalation logs nothing.
    expect(w.log.events.filter(({ event }) => event !== 'push_failed')).toEqual([]);
  });
});

describe('LOST-07, REL-07 and LOST-06: with an acknowledgement inside the two minutes, no SMS is sent', () => {
  test.each([
    ['one minute', MINUTE],
    ['119 999 ms', TWO_MINUTES - 1],
  ])(
    'LOST-07-AC2: R1 says "I’m on it" %s after the alert opened, and the loops run ten minutes after: no SMS is written or handed to the SMS fake, the alert stays ACKNOWLEDGED by R1, and its escalation time stays null',
    async (_when, afterMs) => {
      const w = world();
      const { journeyId, alertId, openedAt, responders } = await lost(w, 3);
      const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
      await w.runUntil(openedAt.getTime() + afterMs);

      const answer = await w.acknowledge(r1, alertId);
      expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ON_IT });
      await w.runUntil(openedAt.getTime() + afterMs + 10 * MINUTE);

      expect(w.smsOf(journeyId)).toEqual([]);
      expect(w.sms.messages).toEqual([]);
      expect(
        w
          .alertsOf(journeyId)
          .map(({ state, acknowledgedBy, smsRaisedAt }) => [state, acknowledgedBy, smsRaisedAt]),
      ).toEqual([['ACKNOWLEDGED', r1.userId, null]]);
    },
  );

  test('LOST-07-AC2: at exactly 120 000 ms with the sweep run first, the alert escalates; R1’s "I’m on it" then withdraws every SMS before any delivery, so none reaches the SMS fake', async () => {
    const w = world();
    const { journeyId, alertId, openedAt, responders } = await lost(w, 3);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    await w.runUntil(openedAt.getTime() + TWO_MINUTES - 1);
    w.clock.advance(1);

    expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, escalated: 1 });
    const acknowledgedAt = await w.clock.now();
    const answer = await w.acknowledge(r1, alertId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ON_IT });
    expect(w.smsOf(journeyId).map(({ withdrawnAt }) => withdrawnAt)).toEqual([
      acknowledgedAt,
      acknowledgedAt,
      acknowledgedAt,
    ]);
    expect(await w.smsSender.deliverDue()).toEqual({ sent: 0, failed: 0 });
    await w.runUntil(acknowledgedAt.getTime() + 10 * MINUTE);
    expect(w.sms.messages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LOST-07-AC3: both halves of an acknowledgement.
// ---------------------------------------------------------------------------

describe('LOST-07 and REL-07: the escalation reads both halves of an acknowledgement, and a missing half sends the SMS', () => {
  /** A LOST_CONTACT journey of a new walker, with three responders and one alert put in directly. */
  async function seeded(
    w: World,
    {
      state,
      recorded = false,
      smsRaisedAt = null,
      openedAgoMs = TWO_MINUTES + SECOND,
    }: {
      state: 'OPEN' | 'ESCALATED' | 'ACKNOWLEDGED' | 'RESOLVED';
      recorded?: boolean;
      smsRaisedAt?: Date | null;
      openedAgoMs?: number;
    },
  ) {
    const walker = w.walker();
    const responders = [w.responder(), w.responder(), w.responder()] as const;
    const responderIds = responders.map(({ userId }) => userId);
    const journeyId = await w.seed(walker, responderIds, {
      state: 'LOST_CONTACT',
      silentForMs: FIVE_MINUTES + openedAgoMs,
    });
    const now = (await w.clock.now()).getTime();
    const alertId = w.store.seedAlert({
      journeyId,
      state,
      openedAt: new Date(now - openedAgoMs),
      silentSince: new Date(now - openedAgoMs - FIVE_MINUTES),
      ...(state === 'RESOLVED' ? { resolvedAt: new Date(now - SECOND), resolution: 'HOME' } : {}),
      ...(recorded
        ? { acknowledgedBy: responderIds[0], acknowledgedAt: new Date(now - 2 * SECOND) }
        : {}),
      smsRaisedAt,
    });
    return { journeyId, alertId, responders, responderIds };
  }

  test.each([
    ['OPEN', { state: 'OPEN' }],
    ['ESCALATED with no escalation time', { state: 'ESCALATED' }],
    ['ACKNOWLEDGED with nobody recorded', { state: 'ACKNOWLEDGED' }],
    ['OPEN with someone recorded', { state: 'OPEN', recorded: true }],
    ['ESCALATED with someone recorded', { state: 'ESCALATED', recorded: true }],
  ] as const)(
    'LOST-07-AC3: an unresolved alert %s, opened more than two minutes ago, is escalated by the sweep: ESCALATED, with an SMS for each responder',
    async (_what, seed) => {
      const w = world();
      const { journeyId, responderIds } = await seeded(w, seed);

      expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, escalated: 1 });

      expect(w.alertsOf(journeyId).map(({ state, smsRaisedAt }) => [state, smsRaisedAt])).toEqual([
        ['ESCALATED', await w.clock.now()],
      ]);
      expect(recipientsOf(w.smsOf(journeyId))).toEqual([...responderIds].sort());
    },
  );

  test.each([
    ['ACKNOWLEDGED with someone recorded', { state: 'ACKNOWLEDGED', recorded: true }],
    ['RESOLVED, nobody recorded', { state: 'RESOLVED' }],
    ['RESOLVED, someone recorded', { state: 'RESOLVED', recorded: true }],
    ['OPEN with an escalation time', { state: 'OPEN', smsRaisedAt: START }],
    ['ESCALATED with an escalation time', { state: 'ESCALATED', smsRaisedAt: START }],
    [
      'ACKNOWLEDGED, nobody recorded, with an escalation time',
      { state: 'ACKNOWLEDGED', smsRaisedAt: START },
    ],
    [
      'OPEN, opened 119 999 ms before the store’s now',
      { state: 'OPEN', openedAgoMs: TWO_MINUTES - 1 },
    ],
  ] as const)(
    'LOST-07-AC3: an alert %s is not escalated, and the sweep writes nothing',
    async (_what, seed) => {
      const w = world();
      const { journeyId } = await seeded(w, seed);
      const before = { alerts: w.alertsOf(journeyId), messages: w.messagesOf(journeyId) };

      expect(await w.watchdog.sweep()).toEqual(QUIET_SWEEP);

      expect({ alerts: w.alertsOf(journeyId), messages: w.messagesOf(journeyId) }).toEqual(before);
      expect(await w.smsSender.deliverDue()).toEqual({ sent: 0, failed: 0 });
    },
  );

  test('LOST-07-AC3: an ESCALATED alert can still be acknowledged, as LOST-06 built: 200 ACKNOWLEDGED, its SMS withdrawn', async () => {
    const w = world();
    const { journeyId, alertId, responders } = await seeded(w, {
      state: 'ESCALATED',
      smsRaisedAt: new Date(START.getTime() - SECOND),
    });
    const [r1] = responders;

    const answer = await w.acknowledge(r1, alertId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ON_IT });
    expect(
      w.alertsOf(journeyId).map(({ state, acknowledgedBy }) => [state, acknowledgedBy]),
    ).toEqual([['ACKNOWLEDGED', r1.userId]]);
  });

  test('LOST-07-AC3: with a stub store whose read returns alerts the rule does not escalate — opened 1 min 59.999 s before its now, acknowledged by someone, already escalated, resolved — the sweep asks the store to escalate only the one opened exactly two minutes before, and is ok', async () => {
    // Defence in depth (approach item 3, step 2), as LOST-02-AC2's test holds
    // it for the open: the rule decides again, with the times and the state
    // the read returned, so a read whose SQL drifted escalates nobody early,
    // twice, or after "I'm on it". The store would refuse each of them under
    // the lock too; what is held here is that it is never asked.
    const w = world();
    const due = await seeded(w, { state: 'OPEN', openedAgoMs: TWO_MINUTES });
    const early = await seeded(w, { state: 'OPEN', openedAgoMs: TWO_MINUTES - 1 });
    const onIt = await seeded(w, { state: 'ACKNOWLEDGED', recorded: true });
    const already = await seeded(w, {
      state: 'ESCALATED',
      smsRaisedAt: new Date(START.getTime() - SECOND),
    });
    const over = await seeded(w, { state: 'RESOLVED' });
    const now = await w.clock.now();
    const asRead = (alertId: string) => {
      const alert = w.store.alerts().find(({ id }) => id === alertId);
      if (alert === undefined) {
        throw new Error('expected the seeded alert');
      }
      const { id, journeyId, state, acknowledgedBy, smsRaisedAt, openedAt } = alert;
      return { id, journeyId, state, acknowledgedBy, smsRaisedAt, openedAt };
    };
    const drifted: WatchdogStore = {
      overdueJourneys: (afterMs: number) => w.store.overdueJourneys(afterMs),
      openLostContactAlert: (request) => w.store.openLostContactAlert(request),
      alertsDueForEscalation: () =>
        Promise.resolve({
          now,
          alerts: [due, early, onIt, already, over].map(({ alertId }) => asRead(alertId)),
        }),
      escalateAlert: (request) => w.store.escalateAlert(request),
    };
    // RG-03 (LOST-07 review loop 1, `code-reviewer`): the requests recorded
    // here, and in the AC16 test below, no longer carry afterMs; the store
    // decides by its own two minutes, as the adapter does.
    const asked = w.store.escalateRequests().length;

    const result = await createWatchdog({ journeys: drifted, beats: w.beats, log: w.log }).sweep();

    expect(result).toEqual({ ...QUIET_SWEEP, escalated: 1 });
    expect(w.store.escalateRequests().slice(asked)).toEqual([{ alertId: due.alertId }]);
    expect(w.smsOf(due.journeyId)).toHaveLength(3);
    for (const other of [early, onIt, already, over]) {
      expect(w.smsOf(other.journeyId)).toEqual([]);
    }
    expect(w.log.events).toEqual([]);
    expect(await w.beats.lastBeat()).toEqual(now);
  });
});

// ---------------------------------------------------------------------------
// LOST-07-AC4: once, whoever sweeps.
// ---------------------------------------------------------------------------

describe('LOST-07 and AR-06: an alert is escalated once, whoever sweeps', () => {
  test('LOST-07-AC4: two sweeps one after the other: the first escalates and the second escalates nothing; one LOST_CONTACT_SMS per responder and one escalation time; across the open, the escalation and every later sweep, each responder has exactly one LOST_CONTACT push and one LOST_CONTACT_SMS for the alert', async () => {
    const w = world();
    const { journeyId, responderIds, alertId } = await due(w, 3);

    expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, escalated: 1 });
    const at = await w.clock.now();
    expect(await w.watchdog.sweep()).toEqual(QUIET_SWEEP);
    await w.runUntil(at.getTime() + 10 * MINUTE);

    expect(w.alertsOf(journeyId).map(({ smsRaisedAt }) => smsRaisedAt)).toEqual([at]);
    for (const kind of ['LOST_CONTACT', SMS]) {
      const ofKind = w.messagesOf(journeyId).filter((message) => message.kind === kind);
      expect(recipientsOf(ofKind), kind).toEqual([...responderIds].sort());
      expect(
        ofKind.every((message) => message.alertId === alertId),
        kind,
      ).toBe(true);
    }
    // Each port was handed one message of each kind per responder, by ID.
    expect(recipientsOf(w.push.accepted.filter(({ kind }) => kind === 'LOST_CONTACT'))).toEqual(
      [...responderIds].sort(),
    );
    expect(recipientsOf(w.sms.accepted)).toEqual([...responderIds].sort());
    expect(idsOf(w.sms.messages)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// LOST-07-AC5: the escalation and "I'm on it" meet on the journey's row.
// ---------------------------------------------------------------------------

describe('LOST-07, LOST-06 and SM-09: the escalation and "I’m on it" meet on the journey’s row', () => {
  test('LOST-07-AC5: an acknowledgement’s transaction holds J’s row past the two minutes and a half; the sweep skips it, then waits for it once; the holder commits R1’s "I’m on it", and the waiting escalation finds the alert acknowledged and writes nothing', async () => {
    const w = world();
    const { journeyId, alertId, openedAt, responders } = await lost(w, 3);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    await w.runUntil(openedAt.getTime() + TWO_MINUTES - 1);
    w.clock.advance(STUCK_AFTER + 1);
    const answers: Answer[] = [];
    w.store.holdUntilWaited(journeyId, async () => {
      answers.push(await w.acknowledge(r1, alertId));
    });

    const swept = await w.watchdog.sweep();

    expect(swept).toEqual(QUIET_SWEEP);
    expect(w.store.escalateRequests().map(({ lockWaitMs }) => lockWaitMs)).toEqual([
      undefined,
      5 * SECOND,
    ]);
    expect(answers.map(({ status, body }) => ({ status, body }))).toEqual([
      { status: 200, body: ON_IT },
    ]);
    expect(
      w
        .alertsOf(journeyId)
        .map(({ state, acknowledgedBy, smsRaisedAt }) => [state, acknowledgedBy, smsRaisedAt]),
    ).toEqual([['ACKNOWLEDGED', r1.userId, null]]);
    expect(w.smsOf(journeyId)).toEqual([]);
  });

  test('LOST-07-AC5: the escalation’s transaction holds J’s row when R1’s "I’m on it", past its read, arrives: the acknowledgement waits, then records R1 and withdraws every SMS the escalation wrote, none of which any port had; none ever reaches the SMS fake', async () => {
    const w = world();
    const { journeyId, alertId, responders, smsRaisedAt } = await (async () => {
      const alerted = await due(w, 3);
      return { ...alerted, smsRaisedAt: await w.clock.now() };
    })();
    const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    w.store.hold(journeyId);
    let answer: Answer | undefined;
    const acknowledging = w.acknowledge(r1, alertId).then((given) => {
      answer = given;
    });
    await until(
      () => w.store.calls.includes('recordAcknowledgement'),
      'the acknowledgement’s wait',
    );
    await aFewTurns();
    expect(answer, 'the acknowledgement waits for the row').toBeUndefined();

    await w.store.commitHold(journeyId, async () => {
      expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, escalated: 1 });
    });
    await acknowledging;

    expect({ status: answer?.status, body: answer?.body }).toEqual({ status: 200, body: ON_IT });
    expect(
      w
        .alertsOf(journeyId)
        .map(({ state, acknowledgedBy, smsRaisedAt: at }) => [state, acknowledgedBy, at]),
    ).toEqual([['ACKNOWLEDGED', r1.userId, smsRaisedAt]]);
    expect(w.smsOf(journeyId).map(({ withdrawnAt }) => withdrawnAt)).toEqual([
      smsRaisedAt,
      smsRaisedAt,
      smsRaisedAt,
    ]);
    await w.runUntil(smsRaisedAt.getTime() + 10 * MINUTE);
    expect(w.sms.messages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LOST-07-AC6: "I'm on it" stops the escalation.
// ---------------------------------------------------------------------------

describe('LOST-07 and LOST-06: "I’m on it" stops the escalation, withdrawing the alert’s unsent SMS and nothing else', () => {
  test('LOST-07-AC6: R1’s SMS accepted, R2’s refused NO_TARGET and due again in 10 s, R3’s never claimed; R2 says "I’m on it": the alert ACKNOWLEDGED by R2, keeping its escalation time; R2’s and R3’s SMS withdrawn at the store’s now, keeping attempts and last failure, and never handed to the SMS port again; R1’s as it was; every push message as it was, and the notices written as LOST-06 built them', async () => {
    const w = world();
    const alerted = await escalated(w, 3);
    const { journeyId, alertId, responders, smsRaisedAt, smsOf } = alerted;
    const [r1, r2, r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    await w.sender.deliverDue();
    w.sms.failFor(r2.userId, 'NO_TARGET');
    // A batch of two: R1's and R2's are claimed, R3's is left unclaimed.
    expect(await smsSenderOf(w, 2).deliverDue()).toEqual({ sent: 1, failed: 1 });
    const pushesBefore = w.messagesOf(journeyId).filter(({ kind }) => kind !== SMS);
    const smsBefore = new Map(w.smsOf(journeyId).map((message) => [message.messageId, message]));
    expect(smsBefore.get(smsOf(r3.userId))?.attempts).toBe(0);
    w.clock.advance(SECOND);
    const acknowledgedAt = await w.clock.now();

    const answer = await w.acknowledge(r2, alertId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ON_IT });
    expect(
      w
        .alertsOf(journeyId)
        .map(({ state, acknowledgedBy, smsRaisedAt: at }) => [state, acknowledgedBy, at]),
    ).toEqual([['ACKNOWLEDGED', r2.userId, smsRaisedAt]]);
    const stored = new Map(w.smsOf(journeyId).map((message) => [message.messageId, message]));
    for (const responder of [r2, r3]) {
      const messageId = smsOf(responder.userId);
      expect(stored.get(messageId)).toEqual({
        ...smsBefore.get(messageId),
        withdrawnAt: acknowledgedAt,
      });
    }
    expect(stored.get(smsOf(r1.userId))).toEqual(smsBefore.get(smsOf(r1.userId)));
    expect(stored.get(smsOf(r2.userId))).toMatchObject({ attempts: 1, lastFailure: 'NO_TARGET' });
    // Every push message as it was; the notices are new, one each to R1 and R3.
    const pushesAfter = w.messagesOf(journeyId).filter(({ kind }) => kind !== SMS);
    expect(pushesAfter.filter(({ kind }) => kind !== 'ACKNOWLEDGED')).toEqual(pushesBefore);
    expect(recipientsOf(pushesAfter.filter(({ kind }) => kind === 'ACKNOWLEDGED'))).toEqual(
      [r1.userId, r3.userId].sort(),
    );

    // Ten minutes on: R2's and R3's never reach the SMS port again.
    w.sms.recover();
    await w.runUntil(acknowledgedAt.getTime() + 10 * MINUTE);
    expect(w.sms.messages.map(({ recipientId }) => recipientId)).toEqual([r1.userId, r2.userId]);
  });

  test.each(['accepts it', 'refuses it'] as const)(
    'LOST-07-AC6: R1’s SMS accepted, R2’s refused NO_TARGET, and R3’s handed to the SMS port and not yet answered; R2 says "I’m on it": R2’s and R3’s withdrawn; when the port %s, R3’s finishes as the port answered, and neither is ever handed to the port again',
    async (answer) => {
      const w = world();
      const { journeyId, alertId, responders, smsOf } = await escalated(w, 3);
      const [r1, r2, r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
      w.sms.failFor(r2.userId, 'NO_TARGET');
      expect(await smsSenderOf(w, 2).deliverDue()).toEqual({ sent: 1, failed: 1 });
      if (answer === 'refuses it') {
        w.sms.failFor(r3.userId, 'UNAVAILABLE');
      }
      w.sms.holdAnswers();
      const delivering = w.smsSender.deliverDue();
      await until(() => w.sms.messages.length === 3, 'R3’s SMS handed to the port');
      const acknowledgedAt = await w.clock.now();

      expect((await w.acknowledge(r2, alertId)).status).toBe(200);
      const withdrawn = new Map(
        w.smsOf(journeyId).map(({ messageId, withdrawnAt }) => [messageId, withdrawnAt]),
      );
      expect(withdrawn.get(smsOf(r2.userId))).toEqual(acknowledgedAt);
      expect(withdrawn.get(smsOf(r3.userId))).toEqual(acknowledgedAt);
      expect(withdrawn.get(smsOf(r1.userId))).toBeNull();

      w.sms.releaseAnswers();
      expect(await delivering).toEqual(
        answer === 'accepts it' ? { sent: 1, failed: 0 } : { sent: 0, failed: 1 },
      );
      const r3s = w.smsOf(journeyId).find(({ messageId }) => messageId === smsOf(r3.userId));
      expect(r3s).toMatchObject(
        answer === 'accepts it'
          ? { sentAt: acknowledgedAt, lastFailure: null, withdrawnAt: acknowledgedAt }
          : { sentAt: null, lastFailure: 'UNAVAILABLE', withdrawnAt: acknowledgedAt },
      );

      w.sms.recover();
      await w.runUntil(acknowledgedAt.getTime() + 10 * MINUTE);
      expect(w.sms.messages.map(({ recipientId }) => recipientId)).toEqual([
        r1.userId,
        r2.userId,
        r3.userId,
      ]);
    },
  );

  test('LOST-07-AC6: an acknowledgement of an alert never escalated withdraws nothing', async () => {
    const w = world();
    const { journeyId, alertId, openedAt, responders } = await lost(w, 3);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    await w.runUntil(openedAt.getTime() + MINUTE);

    expect((await w.acknowledge(r1, alertId)).status).toBe(200);

    expect(w.messagesOf(journeyId).filter(({ withdrawnAt }) => withdrawnAt !== null)).toEqual([]);
    expect(w.smsOf(journeyId)).toEqual([]);
  });

  test('LOST-07-AC6: a stranger learns nothing of an ESCALATED alert and stops nothing (SEC-02, PRIV-03): W’s own device, another walker and a responder of another journey only each get, status, body and headers byte for byte, the 404 an alert ID no alert has gets; no acknowledgement_ignored line is written; the alert and its messages are as they were, every SMS unwithdrawn, and then delivered', async () => {
    // LOST-07 review loop 1 (privacy-security-reviewer): "not a responder"
    // comes before every state, ESCALATED included, so neither the alert's
    // existence nor its escalation can be learned by someone who does not
    // follow the journey, and only a responder's "I'm on it" withdraws an SMS.
    const w = world();
    const { walker, journeyId, alertId, responders, responderIds } = await escalated(w, 3);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    const otherWalker = w.walker();
    const elsewhere = w.responder();
    await w.seed(w.walker(), [elsewhere.userId], { silentForMs: MINUTE });
    const noAlert = await w.acknowledge(r1, syntheticUuid());
    expect(noAlert.status).toBe(404);
    expect(noAlert.body).toMatchObject({ code: 'ALERT_NOT_FOUND' });
    const before = { alerts: w.alertsOf(journeyId), messages: w.messagesOf(journeyId) };
    const lines = w.log.events.length;

    for (const [who, device] of [
      ['W’s own device', walker],
      ['another walker', otherWalker],
      ['a responder of another journey only', elsewhere],
    ] as const) {
      const { status, text, headers } = await w.acknowledge(device, alertId);
      expect({ status, text, headers }, who).toEqual({
        status: noAlert.status,
        text: noAlert.text,
        headers: noAlert.headers,
      });
    }

    expect(w.log.events.slice(lines)).toEqual([]);
    expect(w.alertsOf(journeyId)).toEqual(before.alerts);
    expect(w.messagesOf(journeyId)).toEqual(before.messages);
    expect(w.smsOf(journeyId).map(({ withdrawnAt }) => withdrawnAt)).toEqual([null, null, null]);
    expect(await w.smsSender.deliverDue()).toEqual({ sent: 3, failed: 0 });
    expect(recipientsOf(w.sms.accepted)).toEqual([...responderIds].sort());
  });
});

// ---------------------------------------------------------------------------
// LOST-07-AC7: a resolved alert never escalates; an escalated one's
// resolution withdraws its SMS and stands everyone down by push.
// ---------------------------------------------------------------------------

describe('LOST-07, LOST-03 and SM-04: a resolved alert never escalates, and an escalated alert’s resolution withdraws its unsent SMS and stands every responder down by push only', () => {
  test.each(['a fresh heartbeat', '"I’m home"'] as const)(
    'LOST-07-AC7: the alert opens, and %s comes 119 999 ms later: the alert is RESOLVED, and no sweep after it escalates it',
    async (how) => {
      const w = world();
      const { walker, journeyId, alertId, openedAt } = await lost(w, 3);
      await w.runUntil(openedAt.getTime() + TWO_MINUTES - 1);

      if (how === 'a fresh heartbeat') {
        await w.heartbeat(walker, journeyId);
      } else {
        expect((await w.home(walker, journeyId)).status).toBe(200);
      }
      // Sweeps until just short of the next silence's five minutes: a fresh
      // heartbeat starts a silence of its own, whose alert is another one.
      await w.runUntil(openedAt.getTime() + TWO_MINUTES - 1 + FIVE_MINUTES - SECOND);

      expect(
        w.alertsOf(journeyId).map(({ id, state, smsRaisedAt }) => [id, state, smsRaisedAt]),
      ).toEqual([[alertId, 'RESOLVED', null]]);
      expect(w.smsOf(journeyId)).toEqual([]);
      expect(w.sms.messages).toEqual([]);
    },
  );

  test.each(['a fresh heartbeat', '"I’m home"'] as const)(
    'LOST-07-AC7: with the alert ESCALATED, R1’s SMS accepted, R2’s refused and due again in 10 s, R3’s in the SMS port’s hands and leased for 30 s, contact comes back by %s: the alert RESOLVED with its resolution, keeping its escalation time; R2’s and R3’s SMS withdrawn at the store’s now, keeping attempts and last failure, never handed to the SMS port again; R1’s as it was; every responder stood down once, by push, and by no SMS; R3’s stand-down not handed to the push port before R3’s SMS’s due time; no hold longer than 60 s',
    async (how) => {
      const w = world();
      const alerted = await escalated(w, 3);
      const { walker, journeyId, alertId, responders, smsRaisedAt, smsOf } = alerted;
      const [r1, r2, r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
      expect(await w.sender.deliverDue()).toEqual({ sent: 3, failed: 0 });
      // R1's and R2's first, in a batch of two; then R3's, held in the port.
      w.sms.failFor(r2.userId, 'NO_TARGET');
      expect(await smsSenderOf(w, 2).deliverDue()).toEqual({ sent: 1, failed: 1 });
      w.sms.holdAnswers();
      const delivering = w.smsSender.deliverDue();
      await until(() => w.sms.messages.length === 3, 'R3’s SMS handed to the port');
      const smsBefore = new Map(w.smsOf(journeyId).map((message) => [message.messageId, message]));
      const r2Due = smsBefore.get(smsOf(r2.userId))?.nextAttemptAt ?? new Date(Number.NaN);
      const r3Due = smsBefore.get(smsOf(r3.userId))?.nextAttemptAt ?? new Date(Number.NaN);
      expect(r2Due.getTime() - smsRaisedAt.getTime()).toBe(INTERVAL);
      expect(r3Due.getTime() - smsRaisedAt.getTime()).toBe(LEASE);

      const kind = how === 'a fresh heartbeat' ? 'BACK_IN_CONTACT' : 'HOME';
      if (how === 'a fresh heartbeat') {
        await w.heartbeat(walker, journeyId);
      } else {
        expect((await w.home(walker, journeyId)).status).toBe(200);
      }
      const resolvedAt = await w.clock.now();

      expect(
        w
          .alertsOf(journeyId)
          .map(({ id, state, resolution, smsRaisedAt: at }) => [id, state, resolution, at]),
      ).toEqual([[alertId, 'RESOLVED', kind, smsRaisedAt]]);
      const stored = new Map(w.smsOf(journeyId).map((message) => [message.messageId, message]));
      for (const responder of [r2, r3]) {
        const messageId = smsOf(responder.userId);
        expect(stored.get(messageId)).toEqual({
          ...smsBefore.get(messageId),
          withdrawnAt: resolvedAt,
        });
      }
      expect(stored.get(smsOf(r1.userId))).toEqual(smsBefore.get(smsOf(r1.userId)));
      // One stand-down each, by push; no SMS more.
      const standDowns = w.messagesOf(journeyId).filter((message) => message.kind === kind);
      expect(recipientsOf(standDowns)).toEqual([r1.userId, r2.userId, r3.userId].sort());
      expect(w.smsOf(journeyId)).toHaveLength(3);
      const standDownOf = (responder: RegisteredDevice) =>
        standDowns.find(({ recipientId }) => recipientId === responder.userId);
      expect(standDownOf(r1)?.nextAttemptAt).toEqual(resolvedAt);
      expect(standDownOf(r2)?.nextAttemptAt).toEqual(r2Due);
      expect(standDownOf(r3)?.nextAttemptAt).toEqual(r3Due);
      for (const standDown of standDowns) {
        expect(standDown.nextAttemptAt.getTime() - resolvedAt.getTime()).toBeLessThanOrEqual(
          LONGEST_HOLD,
        );
      }

      // The port answers R3's: it finishes, accepted, and stays withdrawn.
      w.sms.releaseAnswers();
      expect(await delivering).toEqual({ sent: 1, failed: 0 });

      // R3's stand-down is not handed to the push port a millisecond before R3's SMS's due time.
      const handed = () => w.push.messages.map(({ messageId }) => messageId);
      await w.sender.deliverDue();
      expect(handed()).toContain(standDownOf(r1)?.messageId);
      w.clock.advance(r3Due.getTime() - resolvedAt.getTime() - 1);
      await w.sender.deliverDue();
      expect(handed()).not.toContain(standDownOf(r3)?.messageId);
      w.clock.advance(1);
      await w.sender.deliverDue();
      expect(handed()).toContain(standDownOf(r3)?.messageId);
      expect(handed()).toContain(standDownOf(r2)?.messageId);

      // Four minutes on, short of a new silence's alert: no SMS of the alert
      // is handed to the port again.
      w.sms.recover();
      const texts = w.sms.messages.length;
      await w.runUntil(resolvedAt.getTime() + 4 * MINUTE);
      expect(w.sms.messages).toHaveLength(texts);
      expect(w.alertsOf(journeyId)).toHaveLength(1);
      expect(w.push.messages.filter((message) => message.kind === SMS)).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// LOST-07-AC8: each message to its own port, content-free.
// ---------------------------------------------------------------------------

describe('LOST-07 and LOST-02: each message reaches its own port, and every message stays content-free', () => {
  test('LOST-07-AC8: an alert’s lost-contact pushes, its SMS, its notices and its stand-downs, delivered by both senders: the SMS fake receives only LOST_CONTACT_SMS and the push fake never does; every message either receives has exactly the keys messageId, recipientId and kind, its kind one of MESSAGE_KINDS, and a UUID of its own, distinct from every other message’s and from every user’s, walker’s, journey’s, alert’s and device’s ID', async () => {
    const w = world();
    const { walker, journeyId, alertId, responders, responderIds } = await escalated(w, 3);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    await w.runLoops();
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    await w.runLoops();
    await w.heartbeat(walker, journeyId);
    await w.runUntil((await w.clock.now()).getTime() + 2 * MINUTE);

    const handed = [...w.push.messages, ...w.sms.messages];
    expect(w.sms.messages.map(({ kind }) => kind)).toEqual([SMS, SMS, SMS]);
    expect(w.push.messages.filter(({ kind }) => kind === SMS)).toEqual([]);
    expect(new Set(w.push.messages.map(({ kind }) => kind))).toEqual(
      new Set(['LOST_CONTACT', 'ACKNOWLEDGED', 'BACK_IN_CONTACT']),
    );
    const everyOtherId = [
      walker.userId,
      walker.deviceId,
      journeyId,
      alertId,
      ...responderIds,
      ...responders.map(({ deviceId }) => deviceId),
    ];
    for (const message of handed) {
      expect(Object.keys(message).sort()).toEqual(['kind', 'messageId', 'recipientId']);
      expect(MESSAGE_KINDS).toContain(message.kind);
      expect(message.messageId).toMatch(LOWER_UUID);
      expect(everyOtherId).not.toContain(message.messageId);
    }
    const stored = w.messagesOf(journeyId);
    expect(idsOf(handed)).toEqual(idsOf(stored));
    expect(new Set(stored.map(({ messageId }) => messageId)).size).toBe(stored.length);
  });
});

// ---------------------------------------------------------------------------
// LOST-07-AC9: the SMS sender, at least once, with retries, on its own.
// ---------------------------------------------------------------------------

describe('LOST-07 and AR-05: the SMS sender delivers at least once, with retries, apart from push', () => {
  test('LOST-07-AC9: the SMS fake accepts R1’s, refuses R2’s NO_TARGET and throws for R3’s: one sent and two failed; R1’s marked sent; R2’s NO_TARGET and R3’s UNAVAILABLE, each due again 10 s, then 20, 40, 60 and 60 s later, never a millisecond sooner, with the same message ID; one sms_failed line per failure, its reason and the message’s ID only; once the fake recovers, each is sent once and never again', async () => {
    const w = world();
    const { journeyId, responders, smsOf } = await escalated(w, 3);
    const [r1, r2, r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    w.sms.failFor(r2.userId, 'NO_TARGET');
    w.sms.throwWith(new Error('the SMS provider fell over'), r3.userId);
    const smsAt = () =>
      new Map(w.smsOf(journeyId).map((message) => [message.recipientId, message]));
    const failures = (reason: string, recipient: RegisteredDevice) => ({
      event: 'sms_failed',
      reason,
      messageId: smsOf(recipient.userId),
    });

    let now = await w.clock.now();
    expect(await w.smsSender.deliverDue()).toEqual({ sent: 1, failed: 2 });
    expect(smsAt().get(r1.userId)?.sentAt).toEqual(now);
    expect(w.log.events).toEqual([failures('NO_TARGET', r2), failures('UNAVAILABLE', r3)]);

    for (const delay of [10, 20, 40, 60, 60].map((seconds) => seconds * SECOND)) {
      for (const responder of [r2, r3]) {
        expect(smsAt().get(responder.userId)?.nextAttemptAt.getTime()).toBe(now.getTime() + delay);
      }
      const sends = w.sms.messages.length;
      w.clock.advance(delay - 1);
      expect(await w.smsSender.deliverDue(), 'a millisecond early').toEqual({ sent: 0, failed: 0 });
      expect(w.sms.messages).toHaveLength(sends);
      w.clock.advance(1);
      now = await w.clock.now();
      expect(await w.smsSender.deliverDue()).toEqual({ sent: 0, failed: 2 });
      expect(
        w.sms.messages
          .slice(sends)
          .map(({ messageId }) => messageId)
          .sort(),
      ).toEqual([smsOf(r2.userId), smsOf(r3.userId)].sort());
    }
    expect(smsAt().get(r2.userId)).toMatchObject({ attempts: 6, lastFailure: 'NO_TARGET' });
    expect(smsAt().get(r3.userId)).toMatchObject({ attempts: 6, lastFailure: 'UNAVAILABLE' });
    expect(w.log.events).toHaveLength(12);

    w.sms.recover();
    w.clock.advance(60 * SECOND);
    expect(await w.smsSender.deliverDue()).toEqual({ sent: 2, failed: 0 });
    const sent = w.sms.accepted.length;
    w.clock.advance(10 * MINUTE);
    expect(await w.smsSender.deliverDue()).toEqual({ sent: 0, failed: 0 });
    expect(w.sms.accepted).toHaveLength(sent);
    expect(recipientsOf(w.sms.accepted)).toEqual([r1.userId, r2.userId, r3.userId].sort());
    for (const message of w.log.events) {
      expect(Object.keys(message).sort()).toEqual(['event', 'messageId', 'reason']);
    }
  });

  test('LOST-07-AC9: with the push fake holding its answers for ever, the SMS sender still delivers every due SMS; and with the SMS fake holding its answers, the push sender still delivers every due push', async () => {
    const w = world();
    const { journeyId } = await due(w, 3);
    w.push.holdAnswers();
    // The push sender hands its messages over one at a time: the first is
    // held, and the sender waits on it.
    const pushHung = w.sender.deliverDue();
    await until(() => w.push.messages.length === 1, 'a push handed to the port');
    expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, escalated: 1 });

    expect(await w.smsSender.deliverDue()).toEqual({ sent: 3, failed: 0 });
    expect(w.smsOf(journeyId).every(({ sentAt }) => sentAt !== null)).toBe(true);

    // The reverse: SMS hung in the port, and the push sender delivers the notices.
    w.push.releaseAnswers();
    await pushHung;
    const other = world();
    const second = await escalated(other, 3);
    other.sms.holdAnswers();
    const smsHung = other.smsSender.deliverDue();
    await until(() => other.sms.messages.length === 1, 'an SMS handed to the port');
    const [o1] = second.responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    expect((await other.acknowledge(o1, second.alertId)).status).toBe(200);

    expect(await other.sender.deliverDue()).toEqual({ sent: 5, failed: 0 });
    expect(recipientsOf(other.push.accepted.filter(({ kind }) => kind === 'ACKNOWLEDGED'))).toEqual(
      second.responderIds.filter((id) => id !== o1.userId).sort(),
    );
    other.sms.releaseAnswers();
    expect(await smsHung).toEqual({ sent: 3, failed: 0 });
  });

  test('LOST-07-AC9: a claim that fails is one sms_delivery_failed line, stage claim, with its SQLSTATE; a mark that fails is one line, stage mark; the lease brings the message back, and it is sent again with the same ID', async () => {
    const w = world();
    const { responders, smsOf } = await escalated(w, 1);
    const [r1] = responders as [RegisteredDevice];

    w.store.failWith(databaseError('57P01'), 'claimDueSms');
    expect(await w.smsSender.deliverDue()).toEqual({ sent: 0, failed: 0 });
    expect(w.log.events).toEqual([{ event: 'sms_delivery_failed', stage: 'claim', code: '57P01' }]);
    expect(w.sms.messages).toEqual([]);
    w.store.recover();

    w.store.failWith(databaseError('40001'), 'markSent');
    expect(await w.smsSender.deliverDue()).toEqual({ sent: 1, failed: 0 });
    expect(w.log.events.slice(1)).toEqual([
      { event: 'sms_delivery_failed', stage: 'mark', code: '40001' },
    ]);
    w.store.recover();

    w.clock.advance(LEASE - 1);
    expect(await w.smsSender.deliverDue()).toEqual({ sent: 0, failed: 0 });
    w.clock.advance(1);
    expect(await w.smsSender.deliverDue()).toEqual({ sent: 1, failed: 0 });
    expect(w.sms.messages.map(({ messageId }) => messageId)).toEqual([
      smsOf(r1.userId),
      smsOf(r1.userId),
    ]);
  });
});

// ---------------------------------------------------------------------------
// LOST-07-AC10 and AC11: the page.
// ---------------------------------------------------------------------------

describe('LOST-07: a failed SMS pages the owner, and the page fails toward paging', () => {
  test.each([
    'refusing NO_TARGET',
    'refusing NOT_CONFIGURED',
    'throwing',
    'holding its answers for ever',
  ] as const)(
    'LOST-07-AC10: with the SMS fake %s for every SMS, the check run 59 999 ms after the SMS were written reports ok and writes no line; at 60 000 ms, and every minute after, it reports failing, with one sms_unsent line holding the count, 3',
    async (failing) => {
      const w = world();
      await due(w, 3);
      if (failing === 'refusing NO_TARGET') {
        w.sms.failAll('NO_TARGET');
      } else if (failing === 'refusing NOT_CONFIGURED') {
        w.sms.failAll('NOT_CONFIGURED');
      } else if (failing === 'throwing') {
        w.sms.throwWith(new Error('the SMS provider fell over'));
      } else {
        w.sms.holdAnswers();
      }
      const writtenAt = await w.clock.now();
      expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, escalated: 1 });
      // The SMS loop: every 10 s, or, holding, one run that never ends.
      const smsLoop = failing !== 'holding its answers for ever';
      if (!smsLoop) {
        void w.smsSender.deliverDue();
      }

      await w.runUntil(writtenAt.getTime() + SMS_UNSENT_LIMIT - 1, { smsLoop });
      expect(await w.smsCheck.check()).toBe('ok');
      expect(w.alarm.statuses).toEqual(['ok']);
      expect(w.lines('sms_unsent', 'sms_check_failed')).toEqual([]);

      w.clock.advance(1);
      expect(await w.smsCheck.check()).toBe('failing');
      for (let minute = 1; minute <= 3; minute += 1) {
        await w.runUntil(writtenAt.getTime() + SMS_UNSENT_LIMIT + minute * MINUTE, { smsLoop });
        expect(await w.smsCheck.check()).toBe('failing');
      }

      expect(w.alarm.statuses).toEqual(['ok', 'failing', 'failing', 'failing', 'failing']);
      expect(w.lines('sms_unsent', 'sms_check_failed')).toEqual(
        Array.from({ length: 4 }, () => ({ event: 'sms_unsent', count: 3 })),
      );
    },
  );

  test.each([
    'the SMS fake recovers and the SMS are sent',
    'R1 says "I’m on it"',
    'contact comes back',
  ] as const)(
    'LOST-07-AC10: the check reports failing, then %s, and the next check reports ok',
    async (then) => {
      const w = world();
      const { walker, journeyId, alertId, responders } = await escalated(w, 3);
      const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
      w.sms.failAll('NO_TARGET');
      const writtenAt = await w.clock.now();
      await w.runUntil(writtenAt.getTime() + SMS_UNSENT_LIMIT);
      expect(await w.smsCheck.check()).toBe('failing');

      if (then === 'the SMS fake recovers and the SMS are sent') {
        w.sms.recover();
        await w.runUntil(writtenAt.getTime() + SMS_UNSENT_LIMIT + MINUTE);
        expect(w.smsOf(journeyId).every(({ sentAt }) => sentAt !== null)).toBe(true);
      } else if (then === 'R1 says "I’m on it"') {
        expect((await w.acknowledge(r1, alertId)).status).toBe(200);
      } else {
        await w.heartbeat(walker, journeyId);
      }

      expect(await w.smsCheck.check()).toBe('ok');
      expect(w.alarm.statuses).toEqual(['failing', 'ok']);
      expect(w.lines('sms_unsent')).toEqual([{ event: 'sms_unsent', count: 3 }]);
    },
  );

  test('LOST-07-AC10: an SMS refused once and accepted on its retry within 60 s is never reported as failing', async () => {
    const w = world();
    await escalated(w, 3);
    const writtenAt = await w.clock.now();
    w.sms.failAll('NO_TARGET');
    expect(await w.smsSender.deliverDue()).toEqual({ sent: 0, failed: 3 });
    w.sms.recover();

    for (let minute = 1; minute <= 3; minute += 1) {
      await w.runUntil(writtenAt.getTime() + minute * MINUTE);
      expect(await w.smsCheck.check()).toBe('ok');
    }
    expect(w.alarm.statuses).toEqual(['ok', 'ok', 'ok']);
    expect(w.lines('sms_unsent', 'sms_check_failed')).toEqual([]);
  });

  test('LOST-07-AC10: with no SMS at all, every check reports ok and writes no line; and the check hands its signal to the monitor', async () => {
    const w = world();
    const signal = new AbortController().signal;

    for (let minute = 0; minute < 3; minute += 1) {
      expect(await w.smsCheck.check(signal)).toBe('ok');
      w.clock.advance(MINUTE);
    }

    expect(w.alarm.statuses).toEqual(['ok', 'ok', 'ok']);
    expect(w.alarm.reports.map(({ signal: given }) => given)).toEqual([signal, signal, signal]);
    expect(w.log.events).toEqual([]);
  });

  test('LOST-07-AC11: when the check cannot read the database it reports nothing, writes one sms_check_failed line, stage read, with the SQLSTATE, and completes: the monitor’s silence pages', async () => {
    const w = world();
    w.store.failWith(databaseError('57P01'), 'unsentSmsCount');

    expect(await w.smsCheck.check()).toBe('unread');

    expect(w.alarm.reports).toEqual([]);
    expect(w.log.events).toEqual([{ event: 'sms_check_failed', stage: 'read', code: '57P01' }]);
  });

  test.each([
    ['a non-2xx answer, or no connection', 'fails'],
    ['a timeout, or a stop', 'hangs until its signal aborts'],
  ] as const)(
    'LOST-07-AC11: when the report fails (%s) the check writes one sms_check_failed line, stage report, and completes: never a thrown task',
    async (_what, how) => {
      const w = world();
      await escalated(w, 3);
      w.sms.failAll('NO_TARGET');
      await w.runUntil((await w.clock.now()).getTime() + SMS_UNSENT_LIMIT);
      const controller = new AbortController();
      if (how === 'fails') {
        w.alarm.failWith(new Error('Healthchecks.io answered 500.'));
      } else {
        w.alarm.hang();
      }

      const checking = w.smsCheck.check(controller.signal);
      if (how !== 'fails') {
        await aFewTurns();
        controller.abort();
      }

      await expect(checking).resolves.toBe('failing');
      expect(w.alarm.statuses).toEqual(['failing']);
      expect(w.lines('sms_unsent', 'sms_check_failed')).toEqual([
        { event: 'sms_unsent', count: 3 },
        { event: 'sms_check_failed', stage: 'report', code: null },
      ]);
    },
  );

  test('LOST-07-AC11: the check runs whether or not the watchdog’s beat is fresh: with no beat at all, and with the sweep failing, it reports what the outbox says', async () => {
    const w = world();
    await escalated(w, 3);
    w.sms.failAll('NO_TARGET');
    await w.runUntil((await w.clock.now()).getTime() + SMS_UNSENT_LIMIT);
    w.store.failWith(databaseError('57P01'), 'overdueJourneys');
    expect((await w.watchdog.sweep()).ok).toBe(false);

    expect(await w.smsCheck.check()).toBe('failing');
    expect(w.alarm.statuses).toEqual(['failing']);
  });
});

// ---------------------------------------------------------------------------
// LOST-07-AC15: all or nothing, at L6.
// ---------------------------------------------------------------------------

describe('LOST-07 and AR-05: an escalation that fails is a failed sweep, saying where, with no beat', () => {
  test('LOST-07-AC15: with the store failing the escalation’s read, the sweep fails with one escalation_failed line, stage read, and its SQLSTATE; no beat; and, the store answering again, the next sweep escalates', async () => {
    const w = world();
    const { journeyId } = await due(w, 3);
    const beatBefore = await w.beats.lastBeat();
    w.store.failWith(databaseError('57P01'), 'alertsDueForEscalation');

    expect(await w.watchdog.sweep()).toEqual({ ok: false, opened: 0, escalated: 0, stuck: 0 });

    expect(w.log.events).toEqual([{ event: 'escalation_failed', stage: 'read', code: '57P01' }]);
    expect(await w.beats.lastBeat()).toEqual(beatBefore);
    expect(w.smsOf(journeyId)).toEqual([]);
    w.store.recover();
    expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, escalated: 1 });
    expect(await w.beats.lastBeat()).toEqual(await w.clock.now());
  });

  test('LOST-07-AC1: with only the overdue read failing, a due alert is still escalated and every responder’s SMS written: the escalation runs whatever the read for new alerts came to; the sweep fails, with its one watchdog_failed line, and records no beat', async () => {
    // LOST-07 review loop 1 (safety-reviewer and code-reviewer, REL-07): a
    // read of journeys that fails says nothing about the alerts already open,
    // and their two minutes go on. Skipping the escalation then would hold
    // every SMS back for as long as that read keeps failing.
    const w = world();
    const { journeyId, responderIds } = await due(w, 3);
    const beatBefore = await w.beats.lastBeat();
    w.store.failWith(databaseError('57P01'), 'overdueJourneys');

    expect(await w.watchdog.sweep()).toEqual({ ok: false, opened: 0, escalated: 1, stuck: 0 });

    expect(w.alertsOf(journeyId).map(({ state }) => state)).toEqual(['ESCALATED']);
    expect(recipientsOf(w.smsOf(journeyId))).toEqual([...responderIds].sort());
    expect(w.log.events).toEqual([{ event: 'watchdog_failed', stage: 'read', code: '57P01' }]);
    expect(await w.beats.lastBeat()).toEqual(beatBefore);
  });

  test('LOST-07-AC15: with the store failing the escalation’s write, the sweep fails with one escalation_failed line, stage escalate, and its SQLSTATE; no beat; the alert as it was', async () => {
    const w = world();
    const { journeyId } = await due(w, 3);
    const beatBefore = await w.beats.lastBeat();
    const before = w.alertsOf(journeyId);
    w.store.failWith(databaseError('40001'), 'escalateAlert');

    expect(await w.watchdog.sweep()).toEqual({ ok: false, opened: 0, escalated: 0, stuck: 0 });

    expect(w.log.events).toEqual([
      { event: 'escalation_failed', stage: 'escalate', code: '40001' },
    ]);
    expect(await w.beats.lastBeat()).toEqual(beatBefore);
    expect(w.alertsOf(journeyId)).toEqual(before);
    expect(w.smsOf(journeyId)).toEqual([]);
  });

  test('LOST-07-AC15: an alert whose journey has no responder row is not escalated: the escalation is refused whole, and the sweep fails, saying so in one escalation_failed line, stage escalate', async () => {
    const w = world();
    const { journeyId } = await due(w, 2);
    w.store.removeResponders(journeyId);

    expect(await w.watchdog.sweep()).toEqual({ ok: false, opened: 0, escalated: 0, stuck: 0 });

    expect(w.log.events).toEqual([{ event: 'escalation_failed', stage: 'escalate', code: null }]);
    expect(w.alertsOf(journeyId).map(({ state, smsRaisedAt }) => [state, smsRaisedAt])).toEqual([
      ['OPEN', null],
    ]);
    expect(w.smsOf(journeyId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LOST-07-AC16: a held row never hides an escalation.
// ---------------------------------------------------------------------------

describe('LOST-07, AR-06 and D-108: a held row never hides an escalation', () => {
  test('LOST-07-AC16: with J’s row held, the sweep skips the due alert without waiting and is ok, until its two minutes passed 30 s ago; at 2 min 29.999 s still ok; at 2 min 30 s it waits once, at most 5 s, and, held through the wait, writes one escalation_overdue line naming the alert, fails and records no beat', async () => {
    const w = world();
    const { journeyId, alertId, openedAt } = await lost(w, 3);
    await w.runUntil(openedAt.getTime() + TWO_MINUTES - 1);
    w.clock.advance(1);
    w.store.hold(journeyId);

    expect(await w.watchdog.sweep()).toEqual(QUIET_SWEEP);
    expect(w.store.escalateRequests()).toEqual([{ alertId }]);
    w.clock.advance(STUCK_AFTER - 1);
    expect(await w.watchdog.sweep()).toEqual(QUIET_SWEEP);
    const beat = await w.beats.lastBeat();
    expect(beat).toEqual(await w.clock.now());

    w.clock.advance(1);
    expect(await w.watchdog.sweep()).toEqual({ ok: false, opened: 0, escalated: 0, stuck: 1 });

    expect(w.store.escalateRequests().slice(2)).toEqual([
      { alertId },
      { alertId, lockWaitMs: 5 * SECOND },
    ]);
    expect(w.log.events).toEqual([{ event: 'escalation_overdue', alertId }]);
    expect(await w.beats.lastBeat()).toEqual(beat);
    expect(w.smsOf(journeyId)).toEqual([]);

    // Released, the next sweep escalates.
    w.store.release(journeyId);
    expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, escalated: 1 });
  });

  test.each([
    ['commits "I’m on it"', 'ACKNOWLEDGED', 0],
    ['commits a heartbeat that brings contact back', 'RESOLVED', 0],
    ['commits having changed nothing', 'ESCALATED', 1],
  ] as const)(
    'LOST-07-AC16: when the holder of J’s row %s within the wait, the waiting escalation decides as the holder left the alert',
    async (_holder, state, escalatedCount) => {
      const w = world();
      const { walker, journeyId, alertId, openedAt, responders } = await lost(w, 3);
      const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
      await w.runUntil(openedAt.getTime() + TWO_MINUTES - 1);
      w.clock.advance(STUCK_AFTER + 1);
      w.store.holdUntilWaited(journeyId, async () => {
        if (state === 'ACKNOWLEDGED') {
          expect((await w.acknowledge(r1, alertId)).status).toBe(200);
        } else if (state === 'RESOLVED') {
          await w.heartbeat(walker, journeyId);
        }
      });

      expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, escalated: escalatedCount });

      expect(w.alertsOf(journeyId).map(({ state: now }) => now)).toEqual([state]);
      expect(w.smsOf(journeyId)).toHaveLength(escalatedCount === 1 ? 3 : 0);
      expect(w.log.events.filter(({ event }) => event.startsWith('escalation_'))).toEqual([]);
    },
  );

  test('LOST-07-AC16: an escalation that fails with the alert’s two minutes passed 30 s ago or more counts as stuck, as an open does (D-116): the sweep fails with one escalation_failed line, stage escalate, with its SQLSTATE, and one escalation_overdue line naming the alert, and records no beat; at 2 min 29.999 s the same failure fails the sweep but is not stuck; once the store answers, the next sweep escalates', async () => {
    const w = world();
    const { journeyId, alertId } = await lost(w, 3);
    w.clock.advance(TWO_MINUTES + STUCK_AFTER - 1);
    const beat = await w.beats.lastBeat();
    const before = w.alertsOf(journeyId);
    w.store.failWith(databaseError('40001'), 'escalateAlert');

    expect(await w.watchdog.sweep()).toEqual({ ok: false, opened: 0, escalated: 0, stuck: 0 });
    expect(w.log.events).toEqual([
      { event: 'escalation_failed', stage: 'escalate', code: '40001' },
    ]);

    w.clock.advance(1);
    expect(await w.watchdog.sweep()).toEqual({ ok: false, opened: 0, escalated: 0, stuck: 1 });
    expect(w.log.events.slice(1)).toEqual([
      { event: 'escalation_failed', stage: 'escalate', code: '40001' },
      { event: 'escalation_overdue', alertId },
    ]);
    expect(await w.beats.lastBeat()).toEqual(beat);
    expect(w.alertsOf(journeyId)).toEqual(before);
    expect(w.smsOf(journeyId)).toEqual([]);

    // The store answering again, the next sweep escalates and beats.
    w.store.recover();
    expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, escalated: 1 });
    expect(await w.beats.lastBeat()).toEqual(await w.clock.now());
    expect(w.smsOf(journeyId)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// LOST-07-AC17: the store's time.
// ---------------------------------------------------------------------------

describe('LOST-07 and REL-01: the escalation’s time is the store’s', () => {
  test('LOST-07-AC17: swept exactly two minutes after the alert opened on the fake clock, its escalation time minus its opening is exactly 120 s, and each SMS is written and due at that time; a resolution and an acknowledgement keep it', async () => {
    const w = world();
    const { walker, journeyId, alertId, openedAt, responders } = await lost(w, 3);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    await w.runUntil(openedAt.getTime() + TWO_MINUTES - 1);
    w.clock.advance(1);
    expect(await w.watchdog.sweep()).toEqual({ ...QUIET_SWEEP, escalated: 1 });

    const [alert] = w.alertsOf(journeyId);
    const smsRaisedAt = alert?.smsRaisedAt ?? new Date(Number.NaN);
    expect(smsRaisedAt.getTime() - openedAt.getTime()).toBe(120 * SECOND);
    for (const message of w.smsOf(journeyId)) {
      expect(message.createdAt).toEqual(smsRaisedAt);
      expect(message.nextAttemptAt).toEqual(smsRaisedAt);
    }

    w.clock.advance(MINUTE);
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    expect(w.alertsOf(journeyId)[0]?.smsRaisedAt).toEqual(smsRaisedAt);
    w.clock.advance(MINUTE);
    await w.heartbeat(walker, journeyId);
    expect(w.alertsOf(journeyId)[0]).toMatchObject({ state: 'RESOLVED', smsRaisedAt });
  });
});

// ---------------------------------------------------------------------------
// LOST-07-AC18: nothing personal reaches a log (PRIV-07).
// ---------------------------------------------------------------------------

describe('PRIV-07 and LOST-07: nothing personal reaches a log', () => {
  test('LOST-07-AC18: when the store fails the escalation’s read and write, the SMS claim and mark and the count, and the SMS fake and the monitor fail, each with an error whose message holds a synthetic coordinate, a phone-number-shaped string, a credential-like string and a responder’s ID, nothing written to stdout, stderr or the console holds any of them; the capture sees the lines the production log wrote, and the errors do hold the markers', async () => {
    // The production log, writing to this process's stdout, where the
    // capture watches: the recording fake would prove only what the modules
    // chose, not what reached a stream.
    const w = world({ log: createLog() });
    const { responderIds } = await due(w, 2);
    const coordinate = String(syntheticCoordinate());
    // Phone-number-shaped, made at run time: eight digits, a leading 0, which
    // no Norwegian subscriber number has, and never the +47 form.
    const phoneShaped = `0${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
    const credential = `postgres://synthetic:${syntheticCredential()}@127.0.0.1:1/synthetic`;
    const responderId = responderIds[1] ?? '';
    const markers = [coordinate, phoneShaped, credential, responderId];
    const thrown: Error[] = [];
    const failing = (code: string) => {
      const error = databaseError(
        code,
        `failed near (${coordinate}) texting ${phoneShaped} as ${credential} for ${responderId}`,
      );
      thrown.push(error);
      return error;
    };

    const { written, result } = await captured(async () => {
      const results: unknown[] = [];
      w.store.failWith(failing('57P01'), 'alertsDueForEscalation');
      results.push(await w.watchdog.sweep());
      w.store.failWith(failing('40001'), 'escalateAlert');
      results.push(await w.watchdog.sweep());
      w.store.recover();
      results.push(await w.watchdog.sweep());
      w.store.failWith(failing('53300'), 'claimDueSms');
      results.push(await w.smsSender.deliverDue());
      w.store.failWith(failing('57014'), 'markSent');
      results.push(await w.smsSender.deliverDue());
      w.store.recover();
      w.clock.advance(LEASE);
      w.sms.throwWith(failing('XX000'));
      results.push(await w.smsSender.deliverDue());
      w.store.failWith(failing('08006'), 'unsentSmsCount');
      results.push(await w.smsCheck.check());
      w.store.recover();
      w.clock.advance(SMS_UNSENT_LIMIT);
      w.alarm.failWith(failing('XX001'));
      results.push(await w.smsCheck.check());
      return results;
    });

    // Controls: the errors hold every marker, the work was done, and the
    // capture saw the production log's lines.
    expect(thrown).toHaveLength(7);
    for (const error of thrown) {
      expect(markersIn(error.message, markers)).toEqual(markers);
    }
    expect(result).toEqual([
      { ok: false, opened: 0, escalated: 0, stuck: 0 },
      { ok: false, opened: 0, escalated: 0, stuck: 0 },
      { ...QUIET_SWEEP, escalated: 1 },
      { sent: 0, failed: 0 },
      { sent: 2, failed: 0 },
      { sent: 0, failed: 2 },
      'unread',
      'failing',
    ]);
    for (const event of [
      'escalation_failed',
      'sms_delivery_failed',
      'sms_failed',
      'sms_check_failed',
      'sms_unsent',
    ]) {
      expect(written).toContain(`"event":"${event}"`);
    }

    expect(markersIn(written, markers)).toEqual([]);
  });
});
