// L6 system: back in contact (LOST-03) and "I'm home" after an alert (SM-04),
// through the whole server in one process.
//
// The real API, the real journey module, the real watchdog and the real
// sender, with fakes only at the edges: the device credentials, the journey
// store, the worker's beats, the push port and the log. One fake clock stands
// in for the database's now(): the store reads it as PostgreSQL's now() would
// be read, and the journey module reads it only as the Clock port, for a
// heartbeat's receive time (AR-03, REL-01). The watchdog and the sender are
// called here as the worker's loops call them, every 10 s (D-107).
//
// What is proven here, the roadmap's "done when" for M2's task 4: "a
// heartbeat, or a queued 'I'm home', after an alert resolves it and tells
// the responders, at L6":
//   - after an alert, the phone's next heartbeat brings the journey back,
//     resolves the alert, and stands every responder down, after their
//     lost-contact push (AC1), only when the silence counted with it is under
//     five minutes by the store's clock (AC2);
//   - the safe direction for a journey with no alert, or with nobody left to
//     stand down (AC4); watched again afterwards (AC5);
//   - every responder stood down once, whatever became of their push (AC6);
//     a push not yet accepted never sent again (AC7); a stand-down never
//     overtaking its alert at the port (AC8); content-free, opaque IDs (AC9);
//   - all or nothing (AC10, AC17), the row's two orders (AC11, AC17),
//     duplicates and repeats (AC12, AC16), no clock for "I'm home" (AC13);
//   - "I'm home" after an alert, in both orders with a heartbeat (AC14), on an
//     ACTIVE journey (AC15), and every refusal changing nothing (AC16);
//   - nothing personal reaches stdout, stderr or the console (AC19, PRIV-07).
//
// This file is the `journeys` mutation group's second test file (D-112): the
// code it proves lives in modules/journeys/. Times are written out (five
// minutes, 10 s, the 30 s lease), not read from the domain's constants, so a
// wrong constant fails here as well as in the domain's own tests.
import {
  MESSAGE_KINDS,
  RACERS,
  apiPath,
  fakeClock,
  fakeDeviceAuthenticator,
  fakeJourneyStore,
  fakeLog,
  fakePush,
  fakeWorkerHeartbeats,
  syntheticCoordinate,
  syntheticCredential,
  syntheticHeartbeat,
  syntheticPosition,
  syntheticUuid,
  type FakeJourneyState,
  type RegisteredDevice,
  type SyntheticHeartbeat,
} from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import { createApi } from './api.ts';
import { captured, markersIn } from './capture.test.ts';
import { createLog } from './log.ts';
import { createPushSender } from './modules/alerts/outbox.ts';
import { createWatchdog } from './modules/alerts/watchdog.ts';
import { createHealthService } from './modules/health/service.ts';
import { createJourneyService } from './modules/journeys/service.ts';
import type { Clock, Log, OutboxStore } from './ports.ts';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** D-021: responders are alerted when the server has heard nothing for five minutes, or more. */
const FIVE_MINUTES = 5 * MINUTE;
/** How often the worker's loops run (D-107). */
const INTERVAL = 10 * SECOND;
/** How long a claimed message is leased (LOST-02, approach item 5). */
const LEASE = 30 * SECOND;
/** The first retry delay after a failed push (LOST-02). */
const FIRST_RETRY = 10 * SECOND;
/**
 * Overdue, and under 5 min 30 s. Past it, a journey a sweep skipped gets a
 * second attempt that waits for its row, and one held through that wait is
 * stuck (LOST-02-AC20): another criterion.
 */
const UNDER_STUCK = FIVE_MINUTES + 10 * SECOND;

/** A synthetic night: 21:00 UTC on 1 October 2026. */
const START = new Date('2026-10-01T21:00:00.000Z');

const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const RECORDED = { outcome: 'RECORDED' };
const DUPLICATE = { outcome: 'DUPLICATE' };
const ENDED = { outcome: 'ENDED' };

/** An error as a database or a driver throws one: a message, and a SQLSTATE. */
function databaseError(code: string, message = 'the database could not answer'): Error {
  return Object.assign(new Error(message), { code });
}

/** An answer as these tests read it: its status, its body parsed, its text and its headers. */
interface Answer {
  status: number;
  body: unknown;
  text: string;
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
 * One server, its fakes, and the people a test needs. The journey module,
 * the watchdog and the sender log to the recording fake, `log`, unless a
 * test hands them another log. With `moduleClock`, the journey module reads
 * that clock, and the store still reads the world's (LOST-03-AC13).
 */
function world({ log: given, moduleClock }: { log?: Log; moduleClock?: Clock } = {}) {
  const clock = fakeClock(START);
  const store = fakeJourneyStore({ clock });
  const devices = fakeDeviceAuthenticator();
  const recorded = fakeLog();
  const log = given ?? recorded;
  const beats = fakeWorkerHeartbeats();
  const push = fakePush();
  const api = createApi({
    health: createHealthService({ clock, heartbeats: beats }),
    journeys: createJourneyService({ clock: moduleClock ?? clock, journeys: store, log }),
    devices,
    // RG-03 (LOST-06, the spec's "Existing assertions that change by
    // design"): `acknowledgements` added because "I'm on it" (D-114) made it
    // part of what the API needs. These tests acknowledge nothing, so it
    // rejects; they never call it, and nothing they assert changes.
    acknowledgements: {
      acknowledge: () => Promise.reject(new Error('these tests acknowledge nothing')),
    },
  });
  const watchdog = createWatchdog({ journeys: store, beats, log });
  const sender = createPushSender({ outbox: store, push, log });

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
    watchdog,
    sender,
    /** What the modules logged, unless they were handed another log. */
    log: recorded,
    /** A user with a device: someone who can start a journey. */
    walker(): RegisteredDevice {
      const device = devices.register();
      store.addUser(device.userId);
      store.addDevice(device.userId, device.deviceId);
      return device;
    },
    /** Another device of the same walker: a tablet left at home (D-101). */
    secondDevice(of: RegisteredDevice): RegisteredDevice {
      const device = devices.register({ userId: of.userId });
      store.addDevice(of.userId, device.deviceId);
      return device;
    },
    /** A user with no device here: someone who can follow a journey. */
    user: (): string => store.addUser(),
    /** Starts a journey through the API, which must be 201; resolves to its ID. */
    async start(device: RegisteredDevice, responderIds: readonly string[]): Promise<string> {
      const answer = await post(device.credential, 'journeys', { responderIds });
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
    ): Promise<SyntheticHeartbeat> {
      const answer = await post(device.credential, 'heartbeats', body);
      expect({ status: answer.status, body: answer.body }, 'the heartbeat').toEqual({
        status: 200,
        body: RECORDED,
      });
      return body;
    },
    /**
     * "I'm home" through the API (D-110): POST /v1/journeys/{journeyId}/home,
     * with the device's credential, or another, or none; with no body unless
     * one is given.
     */
    home: (
      device: RegisteredDevice | null,
      journeyId: string,
      { credential, body }: { credential?: string | null; body?: unknown } = {},
    ): Promise<Answer> =>
      post(
        credential === undefined ? (device?.credential ?? null) : credential,
        `journeys/${journeyId}/home`,
        body,
      ),
    /**
     * A journey put in directly, in any state, its silence begun `silentForMs`
     * before START: from its last heartbeat, or from its start when it has none.
     */
    seed(
      device: RegisteredDevice,
      responderIds: readonly string[],
      {
        state = 'ACTIVE',
        silentForMs,
        heartbeat = true,
      }: { state?: FakeJourneyState; silentForMs: number; heartbeat?: boolean },
    ): string {
      const silentSince = new Date(START.getTime() - silentForMs);
      return store.seed({
        walkerId: device.userId,
        deviceId: device.deviceId,
        state,
        responderIds,
        startedAt: heartbeat ? new Date(silentSince.getTime() - HOUR) : silentSince,
        lastHeartbeatAt: heartbeat ? silentSince : null,
      });
    },
    /** One run of each loop, as the worker makes them: a sweep, then a delivery. */
    async sweepAndDeliver() {
      const swept = await watchdog.sweep();
      const delivered = await sender.deliverDue();
      return { swept, delivered };
    },
    /** Moves the clock to exactly `at`, sweeping and delivering every 10 s on the way, as the loops would. */
    async runUntil(at: Date): Promise<void> {
      for (;;) {
        const now = (await clock.now()).getTime();
        const step = Math.min(INTERVAL, at.getTime() - now);
        if (step <= 0) {
          return;
        }
        clock.advance(step);
        await self.sweepAndDeliver();
      }
    },
    /**
     * Moves the clock to exactly `at`, delivering every 10 s on the way, with
     * no sweep: the phone is not sending, so a sweep would open the next
     * silence's alert, which is LOST-02's, not what AC7 watches.
     */
    async deliverUntil(at: Date): Promise<void> {
      for (;;) {
        const now = (await clock.now()).getTime();
        const step = Math.min(INTERVAL, at.getTime() - now);
        if (step <= 0) {
          return;
        }
        clock.advance(step);
        await sender.deliverDue();
      }
    },
    stateOf: (journeyId: string) => store.journeys().find(({ id }) => id === journeyId)?.state,
    alertsOf: (journeyId: string) =>
      store.alerts().filter((alert) => alert.journeyId === journeyId),
    messagesOf(journeyId: string) {
      const alertIds = self.alertsOf(journeyId).map(({ id }) => id);
      return store.outbox().filter(({ alertId }) => alertIds.includes(alertId));
    },
    /** Everything the store holds of a journey, to compare before and after. */
    recordOf(journeyId: string) {
      return {
        state: self.stateOf(journeyId),
        end: store.endOf(journeyId),
        lastHeartbeatAt: store.lastHeartbeatAt(journeyId),
        heartbeats: store.heartbeats().filter((heartbeat) => heartbeat.journeyId === journeyId),
        alerts: self.alertsOf(journeyId),
        messages: self.messagesOf(journeyId),
      };
    },
  };
  return self;
}

type World = ReturnType<typeof world>;

/** An overdue ACTIVE journey of a new walker with `responders` responders, put in directly. */
function overdue(w: World, responders = 3, silentForMs = FIVE_MINUTES + MINUTE) {
  const walker = w.walker();
  const responderIds = Array.from({ length: responders }, () => w.user());
  const journeyId = w.seed(walker, responderIds, { silentForMs });
  return { walker, responderIds, journeyId };
}

/** An overdue journey, swept: LOST_CONTACT, with its alert and one unsent LOST_CONTACT message per responder. */
async function lost(w: World, responders = 3) {
  const journey = overdue(w, responders);
  const swept = await w.watchdog.sweep();
  expect(swept.opened, 'the sweep opened the alert').toBe(1);
  const [alert] = w.alertsOf(journey.journeyId);
  if (alert === undefined) {
    throw new Error('expected the sweep to open an alert');
  }
  return { ...journey, alertId: alert.id };
}

/** Recipients of these messages, sorted. */
const recipientsOf = (messages: readonly { recipientId: string }[]) =>
  messages.map(({ recipientId }) => recipientId).sort();

/** The messages of this kind, in the order the port was handed them. */
const ofKind = <T extends { kind: string }>(messages: readonly T[], kind: string): T[] =>
  messages.filter((message) => message.kind === kind);

/** Where in the port's record this responder's message of this kind first appears, or -1. */
function indexIn(
  messages: readonly { recipientId: string; kind: string }[],
  recipientId: string,
  kind: string,
): number {
  return messages.findIndex(
    (message) => message.recipientId === recipientId && message.kind === kind,
  );
}

/**
 * A sender whose claim takes at most two: the batch was full when the third
 * message was due, so it is never claimed by this delivery (LOST-03-AC6,
 * AC7, AC8: "R3's never claimed").
 */
function senderOfTwo(w: World) {
  const outbox: OutboxStore = {
    claimDue: (request) => w.store.claimDue({ ...request, limit: 2 }),
    markSent: (messageId) => w.store.markSent(messageId),
    markFailed: (request) => w.store.markFailed(request),
  };
  return createPushSender({ outbox, push: w.push, log: w.log });
}

/**
 * R1's lost-contact push accepted, R2's answered NO_TARGET and due again in
 * 10 s, R3's never claimed: the Given of LOST-03-AC6 and AC7. The order of
 * the claim is the fake's (the order the messages were written), so the
 * roles are checked here, not assumed.
 */
async function acceptedFailedAndNeverClaimed(w: World) {
  const journey = await lost(w, 3);
  const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
  w.push.failFor(r2, 'NO_TARGET');
  await senderOfTwo(w).deliverDue();
  const byRecipient = new Map(w.messagesOf(journey.journeyId).map((m) => [m.recipientId, m]));
  expect(byRecipient.get(r1)?.sentAt, 'R1’s accepted').not.toBeNull();
  expect(byRecipient.get(r2), 'R2’s failed').toMatchObject({
    sentAt: null,
    lastFailure: 'NO_TARGET',
    attempts: 1,
  });
  expect(byRecipient.get(r3), 'R3’s never claimed').toMatchObject({ sentAt: null, attempts: 0 });
  return { ...journey, r1, r2, r3 };
}

// ---------------------------------------------------------------------------
// LOST-03-AC1: the roadmap's "done when", with a heartbeat.
// ---------------------------------------------------------------------------

describe('LOST-03: after an alert, the phone’s next heartbeat brings the journey back and stands every responder down', () => {
  test.each([3, 1])(
    'LOST-03-AC1: a walker starts a journey through the API with %i responder(s), the phone sends a heartbeat every 60 s for 10 minutes and goes silent; at five minutes each responder gets LOST_CONTACT; a minute later a heartbeat with a new event ID is 200 RECORDED, J is ACTIVE, its one alert RESOLVED at the store’s now with resolution BACK_IN_CONTACT, and each responder gets exactly one BACK_IN_CONTACT after their LOST_CONTACT, the walker and anyone else none; while the phone keeps sending, nothing more is sent and no alert opens',
    async (count) => {
      const w = world();
      const walker = w.walker();
      const responders = Array.from({ length: count }, () => w.user());
      const bystander = w.user();
      const journeyId = await w.start(walker, responders);

      // Ten minutes of heartbeats, one every 60 s, the loops running every 10 s.
      let lastHeartbeatAt = START;
      for (let second = 0; second <= 600; second += 10) {
        if (second % 60 === 0) {
          await w.heartbeat(walker, journeyId);
          lastHeartbeatAt = await w.clock.now();
        }
        await w.sweepAndDeliver();
        w.clock.advance(INTERVAL);
      }
      // Then silence, and at five minutes the alert.
      await w.runUntil(new Date(lastHeartbeatAt.getTime() + FIVE_MINUTES));
      expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
      expect(recipientsOf(ofKind(w.push.accepted, 'LOST_CONTACT'))).toEqual([...responders].sort());

      // A minute later the phone is back.
      await w.runUntil(new Date(lastHeartbeatAt.getTime() + FIVE_MINUTES + MINUTE));
      const backAt = await w.clock.now();
      const answer = await w.heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }));

      expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: RECORDED });
      expect(w.stateOf(journeyId)).toBe('ACTIVE');
      expect(
        w
          .alertsOf(journeyId)
          .map(({ state, resolvedAt, resolution }) => ({ state, resolvedAt, resolution })),
      ).toEqual([{ state: 'RESOLVED', resolvedAt: backAt, resolution: 'BACK_IN_CONTACT' }]);

      await w.sender.deliverDue();

      const standDowns = ofKind(w.push.accepted, 'BACK_IN_CONTACT');
      expect(recipientsOf(standDowns)).toEqual([...responders].sort());
      for (const responder of responders) {
        expect(indexIn(w.push.messages, responder, 'LOST_CONTACT'), responder).toBeLessThan(
          indexIn(w.push.messages, responder, 'BACK_IN_CONTACT'),
        );
      }
      expect(recipientsOf(w.push.messages)).not.toContain(walker.userId);
      expect(recipientsOf(w.push.messages)).not.toContain(bystander);

      // The phone keeps sending, every 60 s for ten minutes.
      const handedOver = w.push.messages.length;
      for (let minute = 1; minute <= 10; minute += 1) {
        await w.runUntil(new Date(backAt.getTime() + minute * MINUTE));
        await w.heartbeat(walker, journeyId);
      }
      expect(w.push.messages).toHaveLength(handedOver);
      expect(w.alertsOf(journeyId)).toHaveLength(1);
      expect(w.stateOf(journeyId)).toBe('ACTIVE');
      expect(w.log.events).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// LOST-03-AC2: contact is back only under five minutes, by the store's clock.
// ---------------------------------------------------------------------------

describe('LOST-03 and REL-01: contact is back only when the heartbeat leaves the silence under five minutes, by the database clock', () => {
  test('LOST-03-AC2: the five-minute race: a heartbeat received at 4:59.999 of silence and written just after the watchdog opened the alert brings J back at once: 200 RECORDED, J ACTIVE, the alert RESOLVED, BACK_IN_CONTACT, one stand-down per responder', async () => {
    const w = world();
    const { walker, journeyId, responderIds } = overdue(w, 2, FIVE_MINUTES - 1);
    // The watchdog's open is about to take J's row.
    w.store.hold(journeyId);
    const answering = w.heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }));
    await until(
      () => w.store.calls.includes('recordHeartbeat'),
      'the heartbeat reaching the store',
    );

    // 5:00.000: the sweep opens J's alert, then lets the row go.
    w.clock.advance(1);
    await w.store.commitHold(journeyId, async () => {
      expect((await w.watchdog.sweep()).opened).toBe(1);
    });
    const answer = await answering;

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: RECORDED });
    expect(w.stateOf(journeyId)).toBe('ACTIVE');
    expect(w.alertsOf(journeyId).map(({ state, resolution }) => [state, resolution])).toEqual([
      ['RESOLVED', 'BACK_IN_CONTACT'],
    ]);
    expect(recipientsOf(ofKind(w.messagesOf(journeyId), 'BACK_IN_CONTACT'))).toEqual(
      [...responderIds].sort(),
    );
  });

  test('LOST-03-AC2: a heartbeat written 4 min 59.999 s after the module read the time it arrived, counted with it, still brings J back', async () => {
    const w = world();
    const { walker, journeyId } = await lost(w, 2);
    w.store.beforeNext('recordHeartbeat', () => {
      w.clock.advance(FIVE_MINUTES - 1);
    });

    const answer = await w.heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }));

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: RECORDED });
    expect(w.stateOf(journeyId)).toBe('ACTIVE');
    expect(w.alertsOf(journeyId).map(({ state }) => state)).toEqual(['RESOLVED']);
  });

  test.each([
    { what: 'exactly five minutes', delay: FIVE_MINUTES },
    { what: 'five minutes and a millisecond', delay: FIVE_MINUTES + 1 },
    { what: 'an hour', delay: HOUR },
  ])(
    'LOST-03-AC2: a heartbeat the store writes $what after the module read the time it arrived — as from an API process that froze — is 200 RECORDED, stored, and moves last contact, and J stays LOST_CONTACT with its alert OPEN, no message withdrawn and none written',
    async ({ delay }) => {
      const w = world();
      const { walker, journeyId } = await lost(w, 2);
      const messages = w.messagesOf(journeyId);
      const receivedAt = await w.clock.now();
      w.store.beforeNext('recordHeartbeat', () => {
        w.clock.advance(delay);
      });

      const answer = await w.heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }));

      expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: RECORDED });
      expect(w.store.heartbeats().map(({ receivedAt: at }) => at)).toEqual([receivedAt]);
      expect(w.store.lastHeartbeatAt(journeyId)).toEqual(receivedAt);
      expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
      expect(
        w.alertsOf(journeyId).map(({ state, resolvedAt, resolution }) => ({
          state,
          resolvedAt,
          resolution,
        })),
      ).toEqual([{ state: 'OPEN', resolvedAt: null, resolution: null }]);
      expect(w.messagesOf(journeyId)).toEqual(messages);
      expect(w.log.events).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// LOST-03-AC4: the two states the code never makes, met in the safe direction.
// ---------------------------------------------------------------------------

describe('LOST-03: the journey’s one unresolved alert is resolved, and a journey is never left LOST_CONTACT', () => {
  test('LOST-03-AC4: a LOST_CONTACT journey with no alert at all, put there directly, moves back to ACTIVE on fresh contact: 200 RECORDED, no message written, and one alert_missing line naming it', async () => {
    const w = world();
    const walker = w.walker();
    const journeyId = w.seed(walker, [w.user()], { state: 'LOST_CONTACT', silentForMs: HOUR });

    const answer = await w.heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }));

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: RECORDED });
    expect(w.stateOf(journeyId)).toBe('ACTIVE');
    expect(w.store.alerts()).toEqual([]);
    expect(w.store.outbox()).toEqual([]);
    expect(w.log.events).toEqual([{ event: 'alert_missing', journeyId }]);
  });

  // SM-04, reading 11 and D-112: added after the red phase (the spec's "Tests
  // added after the red phase"). "I'm home" meets the state the code never
  // makes in the safe direction too: the journey ends, nothing is invented,
  // and the line says the alert was missing.
  test('LOST-03-AC4: "I\'m home" on a LOST_CONTACT journey with no unresolved alert, put there directly, is 200 ENDED: the journey is ENDED with end reason HOME, no message is written, and one alert_missing line names it', async () => {
    const w = world();
    const walker = w.walker();
    const journeyId = w.seed(walker, [w.user()], { state: 'LOST_CONTACT', silentForMs: HOUR });
    const homeAt = await w.clock.now();

    const answer = await w.home(walker, journeyId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ENDED });
    expect(w.stateOf(journeyId)).toBe('ENDED');
    expect(w.store.endOf(journeyId)).toEqual({ endedAt: homeAt, endReason: 'HOME' });
    expect(w.store.alerts()).toEqual([]);
    expect(w.store.outbox()).toEqual([]);
    expect(w.log.events).toEqual([{ event: 'alert_missing', journeyId }]);
  });

  test('LOST-03-AC4: a LOST_CONTACT journey whose responder rows are gone, removed directly, still moves back and resolves its alert on fresh contact, and writes no stand-down and no line', async () => {
    const w = world();
    const { walker, journeyId } = await lost(w, 2);
    w.store.removeResponders(journeyId);

    const answer = await w.heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }));

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: RECORDED });
    expect(w.stateOf(journeyId)).toBe('ACTIVE');
    expect(w.alertsOf(journeyId).map(({ state }) => state)).toEqual(['RESOLVED']);
    expect(w.messagesOf(journeyId).map(({ kind }) => kind)).toEqual([
      'LOST_CONTACT',
      'LOST_CONTACT',
    ]);
    expect(w.log.events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LOST-03-AC5: watched again, and a new silence is a new alert.
// ---------------------------------------------------------------------------

describe('LOST-03 and LOST-02: after the alert resolved, the journey is watched like any other', () => {
  test('LOST-03-AC5: back in contact, more heartbeats are each 200 RECORDED and write nothing else; five minutes after the last, not a millisecond sooner, the next sweep opens a new alert for J — another ID, OPEN, silent since that heartbeat — with one new LOST_CONTACT message per responder, and the first alert stays RESOLVED with its messages', async () => {
    const w = world();
    const walker = w.walker();
    const responders = [w.user(), w.user()];
    const journeyId = await w.start(walker, responders);
    await w.runUntil(new Date(START.getTime() + FIVE_MINUTES));
    const [first] = w.alertsOf(journeyId);
    await w.heartbeat(walker, journeyId);
    await w.runUntil(new Date(START.getTime() + FIVE_MINUTES + MINUTE));
    const firstRecord = {
      alert: w.alertsOf(journeyId),
      messages: w.messagesOf(journeyId),
    };
    expect(firstRecord.alert.map(({ state }) => state)).toEqual(['RESOLVED']);

    let lastHeartbeatAt = await w.clock.now();
    for (let minute = 1; minute <= 3; minute += 1) {
      await w.runUntil(new Date(START.getTime() + FIVE_MINUTES + (1 + minute) * MINUTE));
      await w.heartbeat(walker, journeyId);
      lastHeartbeatAt = await w.clock.now();
      expect(w.alertsOf(journeyId)).toEqual(firstRecord.alert);
      expect(w.messagesOf(journeyId)).toEqual(firstRecord.messages);
    }

    await w.runUntil(new Date(lastHeartbeatAt.getTime() + FIVE_MINUTES - 1));
    expect(w.alertsOf(journeyId)).toHaveLength(1);
    await w.runUntil(new Date(lastHeartbeatAt.getTime() + FIVE_MINUTES));

    const alerts = w.alertsOf(journeyId);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(alerts).toHaveLength(2);
    const [kept, second] = alerts;
    expect(kept).toEqual(firstRecord.alert[0]);
    expect(second?.id).not.toBe(first?.id);
    expect(second).toMatchObject({ state: 'OPEN', silentSince: lastHeartbeatAt, resolvedAt: null });
    expect(
      recipientsOf(w.messagesOf(journeyId).filter(({ alertId }) => alertId === second?.id)),
    ).toEqual([...responders].sort());
    expect(w.messagesOf(journeyId).filter(({ alertId }) => alertId === first?.id)).toEqual(
      firstRecord.messages,
    );
  });
});

// ---------------------------------------------------------------------------
// LOST-03-AC6 to AC9: the messages.
// ---------------------------------------------------------------------------

describe('LOST-03: every responder is stood down once, whether or not their lost-contact push went out (D-111)', () => {
  test('LOST-03-AC6: R1’s lost-contact push accepted, R2’s answered NO_TARGET, R3’s never claimed: once contact is back, the push recovers and the sender delivers until nothing is due, the outbox holds exactly one BACK_IN_CONTACT message for that alert for each of R1, R2 and R3, and the push accepted each; the walker has none; a second heartbeat, another sweep and another delivery add none', async () => {
    const w = world();
    const { walker, journeyId, alertId, r1, r2, r3 } = await acceptedFailedAndNeverClaimed(w);
    w.clock.advance(5 * SECOND);

    await w.heartbeat(walker, journeyId);
    w.push.recover();
    await w.runUntil(new Date(START.getTime() + 3 * MINUTE));

    const standDowns = ofKind(w.messagesOf(journeyId), 'BACK_IN_CONTACT');
    expect(standDowns.every((message) => message.alertId === alertId)).toBe(true);
    expect(recipientsOf(standDowns)).toEqual([r1, r2, r3].sort());
    expect(standDowns.every(({ sentAt }) => sentAt !== null)).toBe(true);
    expect(recipientsOf(ofKind(w.push.accepted, 'BACK_IN_CONTACT'))).toEqual([r1, r2, r3].sort());
    expect(recipientsOf(w.push.messages)).not.toContain(walker.userId);

    await w.heartbeat(walker, journeyId);
    await w.sweepAndDeliver();
    w.clock.advance(MINUTE);
    await w.sweepAndDeliver();
    expect(ofKind(w.messagesOf(journeyId), 'BACK_IN_CONTACT')).toHaveLength(3);
    expect(ofKind(w.push.messages, 'BACK_IN_CONTACT')).toHaveLength(3);
  });
});

describe('LOST-03: a lost-contact push not yet accepted when contact comes back is never sent again (D-111)', () => {
  test('LOST-03-AC7: R1’s accepted, R2’s failed and due again in 10 s, R3’s never claimed: once contact is back, the push recovers and ten minutes pass with a delivery every 10 s, neither R2’s nor R3’s lost-contact message is handed to the port again; each keeps its attempts and last failure, withdrawn at the store’s now when contact came back; R1’s stays sent, not withdrawn', async () => {
    const w = world();
    const { walker, journeyId, r1, r2, r3 } = await acceptedFailedAndNeverClaimed(w);
    const before = new Map(w.messagesOf(journeyId).map((m) => [m.recipientId, m]));
    w.clock.advance(5 * SECOND);
    const backAt = await w.clock.now();

    await w.heartbeat(walker, journeyId);
    w.push.recover();
    await w.deliverUntil(new Date(backAt.getTime() + 10 * MINUTE));

    const handedOver = (recipientId: string) =>
      ofKind(w.push.messages, 'LOST_CONTACT').filter((m) => m.recipientId === recipientId);
    expect(handedOver(r1)).toHaveLength(1);
    expect(handedOver(r2)).toHaveLength(1);
    expect(handedOver(r3)).toHaveLength(0);
    const after = new Map(
      ofKind(w.messagesOf(journeyId), 'LOST_CONTACT').map((m) => [m.recipientId, m]),
    );
    expect(after.get(r2)).toMatchObject({
      attempts: 1,
      lastFailure: 'NO_TARGET',
      sentAt: null,
      withdrawnAt: backAt,
    });
    expect(after.get(r3)).toMatchObject({ attempts: 0, sentAt: null, withdrawnAt: backAt });
    expect(after.get(r1)).toEqual({ ...before.get(r1), withdrawnAt: null });
  });

  test.each([
    { answer: 'accepts it', refuse: false },
    { answer: 'refuses it', refuse: true },
  ])(
    'LOST-03-AC7: a lost-contact push the port was holding when contact came back is marked as the port then $answer — sent at the store’s now, or with its reason — and is never handed out again',
    async ({ refuse }) => {
      const w = world();
      const { walker, journeyId, responderIds } = await lost(w, 1);
      const [r1 = ''] = responderIds;
      w.push.holdAnswers();
      const delivering = w.sender.deliverDue();
      await until(() => w.push.messages.length === 1, 'the push reaching the port');
      w.clock.advance(SECOND);
      const backAt = await w.clock.now();

      await w.heartbeat(walker, journeyId);
      const [withdrawn] = ofKind(w.messagesOf(journeyId), 'LOST_CONTACT');
      expect(withdrawn?.withdrawnAt).toEqual(backAt);

      if (refuse) {
        w.push.failAll('REFUSED');
      }
      w.clock.advance(SECOND);
      const answeredAt = await w.clock.now();
      w.push.releaseAnswers();
      await delivering;

      const [marked] = ofKind(w.messagesOf(journeyId), 'LOST_CONTACT');
      expect(marked).toMatchObject(
        refuse
          ? { sentAt: null, lastFailure: 'REFUSED', withdrawnAt: backAt }
          : { sentAt: answeredAt, withdrawnAt: backAt },
      );
      w.push.recover();
      await w.deliverUntil(new Date(backAt.getTime() + 10 * MINUTE));
      expect(
        ofKind(w.push.messages, 'LOST_CONTACT').filter(({ recipientId }) => recipientId === r1),
      ).toHaveLength(1);
      expect(recipientsOf(ofKind(w.push.accepted, 'BACK_IN_CONTACT'))).toEqual([r1]);
    },
  );
});

describe('LOST-03: at the push port, a stand-down never overtakes the lost-contact push it stands down', () => {
  test('LOST-03-AC8: R1’s lost-contact push in the port’s hands when contact comes back, R2’s and R3’s accepted: R2’s and R3’s BACK_IN_CONTACT go at the first delivery; R1’s is not handed over before the lease of R1’s claim has run out, 30 s after that claim, whatever the port answers meanwhile, and goes at the first delivery after; each responder’s lost-contact push comes before their stand-down in the port’s record', async () => {
    const w = world();
    const { walker, journeyId, responderIds } = await lost(w, 3);
    const [r1 = '', r2 = '', r3 = ''] = responderIds;
    w.push.failFor(r1, 'NO_TARGET');
    await w.sender.deliverDue();
    // R1's retry, 10 s later, is claimed, leased 30 s and handed to a port that holds its answer.
    w.clock.advance(FIRST_RETRY);
    w.push.recover();
    w.push.holdAnswers();
    const claimedAt = await w.clock.now();
    const delivering = w.sender.deliverDue();
    await until(() => w.push.messages.length === 4, 'R1’s retry reaching the port');
    const leaseEnd = claimedAt.getTime() + LEASE;

    w.clock.advance(5 * SECOND);
    await w.heartbeat(walker, journeyId);
    // The port answers meanwhile: it accepts R1's lost-contact push.
    w.push.releaseAnswers();
    await delivering;

    await w.runUntil(new Date(claimedAt.getTime() + 2 * INTERVAL));
    expect(recipientsOf(ofKind(w.push.messages, 'BACK_IN_CONTACT'))).toEqual([r2, r3].sort());
    await w.runUntil(new Date(leaseEnd - 1));
    expect(recipientsOf(ofKind(w.push.messages, 'BACK_IN_CONTACT'))).toEqual([r2, r3].sort());
    w.clock.advance(1);
    await w.sender.deliverDue();
    expect(recipientsOf(ofKind(w.push.messages, 'BACK_IN_CONTACT'))).toEqual([r1, r2, r3].sort());

    for (const responder of responderIds) {
      const lostAt = w.push.messages.findLastIndex(
        (m) => m.recipientId === responder && m.kind === 'LOST_CONTACT',
      );
      expect(lostAt, responder).toBeGreaterThanOrEqual(0);
      expect(lostAt, responder).toBeLessThan(
        indexIn(w.push.messages, responder, 'BACK_IN_CONTACT'),
      );
    }
  });

  test('LOST-03-AC8: a responder whose lost-contact push failed and is due again later gets the stand-down no later than that due time; one whose push was sent, or never handed over, gets it at the first delivery', async () => {
    const w = world();
    const { walker, journeyId, r1, r2, r3 } = await acceptedFailedAndNeverClaimed(w);
    const retryAt = START.getTime() + FIRST_RETRY;
    w.clock.advance(2 * SECOND);

    await w.heartbeat(walker, journeyId);
    w.push.recover();
    await w.sender.deliverDue();

    expect(recipientsOf(ofKind(w.push.messages, 'BACK_IN_CONTACT'))).toEqual([r1, r3].sort());
    w.clock.set(new Date(retryAt - 1));
    await w.sender.deliverDue();
    expect(recipientsOf(ofKind(w.push.messages, 'BACK_IN_CONTACT'))).toEqual([r1, r3].sort());
    w.clock.set(new Date(retryAt));
    await w.sender.deliverDue();
    expect(recipientsOf(ofKind(w.push.messages, 'BACK_IN_CONTACT'))).toEqual([r1, r2, r3].sort());
    expect(indexIn(w.push.messages, r2, 'LOST_CONTACT')).toBeLessThan(
      indexIn(w.push.messages, r2, 'BACK_IN_CONTACT'),
    );
  });
});

describe('LOST-03 and LOST-02: no overtaking across alerts — a new alert withdraws the earlier alert’s unsent stand-downs', () => {
  // Review loop 1 (the spec's item 1a; D-112 amended): the scenario
  // safety-reviewer reproduced. A stand-down that cannot be delivered is
  // retried for ever, so without the open's withdrawal an earlier alert's
  // "back in contact" could reach a responder after a later alert's
  // lost-contact push, while that alert is open: a false all-clear in the
  // middle of a real alert. The open is LOST-02's code; what it now
  // withdraws extends what LOST-02-AC9 says it writes.
  test('LOST-03-AC8: with a failing push, alert A1 opens, a heartbeat resolves it, the journey stays silent until A2 opens, and then the push recovers: the port never accepts A1’s BACK_IN_CONTACT after A2’s LOST_CONTACT, because A2’s open withdrew it', async () => {
    const w = world();
    const walker = w.walker();
    const responders = [w.user(), w.user()];
    const journeyId = await w.start(walker, responders);
    await w.heartbeat(walker, journeyId);
    for (const responder of responders) {
      w.push.failFor(responder, 'UNAVAILABLE');
    }

    // A1 opens at five minutes; its lost-contact pushes fail.
    await w.runUntil(new Date(START.getTime() + FIVE_MINUTES));
    const [a1] = w.alertsOf(journeyId);
    expect(a1?.state).toBe('OPEN');
    // A minute later the phone is back: A1 resolved, its stand-downs written,
    // and every push still failing.
    await w.runUntil(new Date(START.getTime() + FIVE_MINUTES + MINUTE));
    await w.heartbeat(walker, journeyId);
    const backAt = await w.clock.now();
    expect(w.alertsOf(journeyId).map(({ state }) => state)).toEqual(['RESOLVED']);
    // Then silence again, until A2 opens five minutes after that heartbeat.
    await w.runUntil(new Date(backAt.getTime() + FIVE_MINUTES));
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    const a2 = w.alertsOf(journeyId).find(({ id }) => id !== a1?.id);
    expect(a2?.state).toBe('OPEN');

    // The push recovers, and the loops run on.
    w.push.recover();
    await w.runUntil(new Date(backAt.getTime() + FIVE_MINUTES + 5 * MINUTE));

    const alertOf = new Map(w.store.outbox().map(({ messageId, alertId }) => [messageId, alertId]));
    const labelled = (
      messages: readonly { messageId: string; recipientId: string; kind: string }[],
    ) =>
      messages.map(({ messageId, recipientId, kind }) => ({
        alertId: alertOf.get(messageId),
        recipientId,
        kind,
      }));
    const accepted = labelled(w.push.accepted);
    for (const responder of responders) {
      const theirs = accepted.filter(({ recipientId }) => recipientId === responder);
      const a2Lost = theirs.findIndex(
        ({ alertId, kind }) => alertId === a2?.id && kind === 'LOST_CONTACT',
      );
      expect(a2Lost, `${responder}: A2’s LOST_CONTACT was accepted`).toBeGreaterThanOrEqual(0);
      expect(
        theirs
          .slice(a2Lost)
          .filter(({ alertId, kind }) => alertId === a1?.id && kind === 'BACK_IN_CONTACT'),
        `${responder}: A1’s BACK_IN_CONTACT after A2’s LOST_CONTACT`,
      ).toEqual([]);
    }
    // Because A2's open withdrew A1's stand-downs, at its own now, and none
    // was handed to the port again once A2 had opened.
    const a1StandDowns = w
      .messagesOf(journeyId)
      .filter(({ alertId, kind }) => alertId === a1?.id && kind === 'BACK_IN_CONTACT');
    expect(recipientsOf(a1StandDowns)).toEqual([...responders].sort());
    for (const standDown of a1StandDowns) {
      expect(standDown).toMatchObject({ sentAt: null, withdrawnAt: a2?.openedAt });
    }
    const handed = labelled(w.push.messages);
    const firstOfA2 = handed.findIndex(({ alertId }) => alertId === a2?.id);
    expect(firstOfA2).toBeGreaterThanOrEqual(0);
    expect(
      handed
        .slice(firstOfA2)
        .filter(({ alertId, kind }) => alertId === a1?.id && kind === 'BACK_IN_CONTACT'),
    ).toEqual([]);
  });

  // Review loop 2 (the spec's item 14a; D-112 amended again): the scenario
  // safety-reviewer reproduced across a walker's journeys. J1, ended by
  // "I'm home" while the push failed, holds unsent HOME messages to the same
  // responders, retried for ever; J2's open withdraws them, so J1's "home"
  // can never follow J2's lost-contact push. SM-04's HOME, and LOST-02's open.
  test('LOST-03-AC8: with a failing push, J1’s alert opens and "I’m home" ends J1; the same walker starts J2 with the same responders, J2 goes silent until its alert opens, and then the push recovers: the port never accepts J1’s HOME after J2’s LOST_CONTACT', async () => {
    const w = world();
    const walker = w.walker();
    const responders = [w.user(), w.user()];
    const j1 = await w.start(walker, responders);
    await w.heartbeat(walker, j1);
    for (const responder of responders) {
      w.push.failFor(responder, 'UNAVAILABLE');
    }

    // J1's alert opens at five minutes; its lost-contact pushes fail.
    await w.runUntil(new Date(START.getTime() + FIVE_MINUTES));
    const [a1] = w.alertsOf(j1);
    expect(a1?.state).toBe('OPEN');
    // A minute later the walker is home: J1 ended, its alert resolved HOME,
    // one HOME message per responder, and every push still failing.
    await w.runUntil(new Date(START.getTime() + FIVE_MINUTES + MINUTE));
    const ended = await w.home(walker, j1);
    expect({ status: ended.status, body: ended.body }).toEqual({ status: 200, body: ENDED });
    // The same walker starts J2 with the same responders, and it goes silent
    // until its alert opens.
    const j2 = await w.start(walker, responders);
    await w.heartbeat(walker, j2);
    const startedAt = await w.clock.now();
    await w.runUntil(new Date(startedAt.getTime() + FIVE_MINUTES));
    expect(w.stateOf(j2)).toBe('LOST_CONTACT');
    const [a2] = w.alertsOf(j2);
    expect(a2?.state).toBe('OPEN');

    // The push recovers, and the loops run on.
    w.push.recover();
    await w.runUntil(new Date(startedAt.getTime() + FIVE_MINUTES + 5 * MINUTE));

    const alertOf = new Map(w.store.outbox().map(({ messageId, alertId }) => [messageId, alertId]));
    const labelled = (
      messages: readonly { messageId: string; recipientId: string; kind: string }[],
    ) =>
      messages.map(({ messageId, recipientId, kind }) => ({
        alertId: alertOf.get(messageId),
        recipientId,
        kind,
      }));
    const accepted = labelled(w.push.accepted);
    for (const responder of responders) {
      const theirs = accepted.filter(({ recipientId }) => recipientId === responder);
      const j2Lost = theirs.findIndex(
        ({ alertId, kind }) => alertId === a2?.id && kind === 'LOST_CONTACT',
      );
      expect(j2Lost, `${responder}: J2’s LOST_CONTACT was accepted`).toBeGreaterThanOrEqual(0);
      expect(
        theirs.slice(j2Lost).filter(({ alertId, kind }) => alertId === a1?.id && kind === 'HOME'),
        `${responder}: J1’s HOME after J2’s LOST_CONTACT`,
      ).toEqual([]);
    }
    // Because J2's open withdrew J1's HOME messages, at its own now, and none
    // was handed to the port again once J2's alert had opened.
    const j1Homes = w
      .messagesOf(j1)
      .filter(({ alertId, kind }) => alertId === a1?.id && kind === 'HOME');
    expect(recipientsOf(j1Homes)).toEqual([...responders].sort());
    for (const message of j1Homes) {
      expect(message).toMatchObject({ sentAt: null, withdrawnAt: a2?.openedAt });
    }
    const handed = labelled(w.push.messages);
    const firstOfJ2 = handed.findIndex(({ alertId }) => alertId === a2?.id);
    expect(firstOfJ2).toBeGreaterThanOrEqual(0);
    expect(
      handed.slice(firstOfJ2).filter(({ alertId, kind }) => alertId === a1?.id && kind === 'HOME'),
    ).toEqual([]);
  });

  // Review loop 3 (the spec's item 19b; D-111, D-112 amended): the open
  // withdraws an earlier stand-down only for someone its own lost-contact
  // push will reach. A, who heard of J1's loss and is not J2's responder,
  // must still be told J1 is over; B, who is, must not hear J1's "home"
  // after J2's lost-contact push.
  test('LOST-03-AC8: J1 has responders A and B and its alert reaches both; with a failing push, "I’m home" ends J1; J2 starts with B alone and its alert opens; when the push recovers, A is still told J1’s HOME, and B is never told J1’s HOME after J2’s LOST_CONTACT', async () => {
    const w = world();
    const walker = w.walker();
    const a = w.user();
    const b = w.user();
    const j1 = await w.start(walker, [a, b]);
    await w.heartbeat(walker, j1);

    // J1's alert opens at five minutes and reaches both.
    await w.runUntil(new Date(START.getTime() + FIVE_MINUTES));
    const [a1] = w.alertsOf(j1);
    expect(recipientsOf(ofKind(w.push.accepted, 'LOST_CONTACT'))).toEqual([a, b].sort());
    // Then the push fails, and "I'm home" ends J1: one HOME each, failing.
    w.push.failFor(a, 'UNAVAILABLE');
    w.push.failFor(b, 'UNAVAILABLE');
    await w.runUntil(new Date(START.getTime() + FIVE_MINUTES + MINUTE));
    const ended = await w.home(walker, j1);
    expect({ status: ended.status, body: ended.body }).toEqual({ status: 200, body: ENDED });
    // J2 starts with B alone, and goes silent until its alert opens.
    const j2 = await w.start(walker, [b]);
    await w.heartbeat(walker, j2);
    const startedAt = await w.clock.now();
    await w.runUntil(new Date(startedAt.getTime() + FIVE_MINUTES));
    const [a2] = w.alertsOf(j2);
    expect(a2?.state).toBe('OPEN');

    // The push recovers, and the loops run on.
    w.push.recover();
    await w.runUntil(new Date(startedAt.getTime() + FIVE_MINUTES + 5 * MINUTE));

    const alertOf = new Map(w.store.outbox().map(({ messageId, alertId }) => [messageId, alertId]));
    const accepted = w.push.accepted.map(({ messageId, recipientId, kind }) => ({
      alertId: alertOf.get(messageId),
      recipientId,
      kind,
    }));
    const isJ1Home = ({ alertId, kind }: { alertId: string | undefined; kind: string }) =>
      alertId === a1?.id && kind === 'HOME';
    // A, not J2's responder: still stood down from J1, once.
    expect(accepted.filter((m) => m.recipientId === a && isJ1Home(m))).toHaveLength(1);
    // B: J2's lost-contact push accepted, and J1's HOME never after it.
    const theirs = accepted.filter(({ recipientId }) => recipientId === b);
    const j2Lost = theirs.findIndex(
      ({ alertId, kind }) => alertId === a2?.id && kind === 'LOST_CONTACT',
    );
    expect(j2Lost, 'B: J2’s LOST_CONTACT was accepted').toBeGreaterThanOrEqual(0);
    expect(theirs.slice(j2Lost).filter(isJ1Home), 'B: J1’s HOME after J2’s LOST_CONTACT').toEqual(
      [],
    );
    // In the store: B's J1 HOME withdrawn at J2's open, A's sent and never withdrawn.
    const j1Homes = new Map(
      ofKind(w.messagesOf(j1), 'HOME').map((message) => [message.recipientId, message]),
    );
    expect(j1Homes.get(b)).toMatchObject({ sentAt: null, withdrawnAt: a2?.openedAt });
    expect(j1Homes.get(a)?.withdrawnAt).toBeNull();
    expect(j1Homes.get(a)?.sentAt).not.toBeNull();
  });
});

describe('LOST-03 and SM-04: every message is content-free, with an opaque ID of its own (D-086, D-087)', () => {
  test('LOST-03-AC9: every message the push port receives — the lost-contact alerts, and the stand-downs of each kind, BACK_IN_CONTACT and HOME — has exactly messageId, recipientId and kind, its kind one of MESSAGE_KINDS; every messageId a UUID of its own, equal to no user’s, walker’s, journey’s, alert’s or device’s ID', async () => {
    const w = world();
    const back = await lost(w, 2);
    const home = await lost(w, 2);
    await w.sender.deliverDue();

    await w.heartbeat(back.walker, back.journeyId);
    const ended = await w.home(home.walker, home.journeyId);
    expect({ status: ended.status, body: ended.body }).toEqual({ status: 200, body: ENDED });
    await w.runUntil(new Date(START.getTime() + 2 * MINUTE));

    const sent = w.push.messages;
    expect([...new Set(sent.map(({ kind }) => kind))].sort()).toEqual(
      ['BACK_IN_CONTACT', 'HOME', 'LOST_CONTACT'].sort(),
    );
    expect(sent).toHaveLength(8);
    for (const message of sent) {
      expect(Object.keys(message).sort()).toEqual(['kind', 'messageId', 'recipientId']);
      expect(MESSAGE_KINDS).toContain(message.kind);
      expect(message.messageId).toMatch(LOWER_UUID);
    }
    const messageIds = sent.map(({ messageId }) => messageId);
    expect(new Set(messageIds).size).toBe(messageIds.length);
    const everyOtherId = [back, home].flatMap((journey) => [
      journey.walker.userId,
      journey.walker.deviceId,
      journey.journeyId,
      journey.alertId,
      ...journey.responderIds,
    ]);
    expect(messageIds.filter((id) => everyOtherId.includes(id))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LOST-03-AC10 to AC12: all or nothing, the races, and duplicates.
// ---------------------------------------------------------------------------

describe('LOST-03 and AR-05: the heartbeat and everything it causes, all or nothing', () => {
  test('LOST-03-AC10: with the store failing recordHeartbeat, a fresh heartbeat for LOST_CONTACT J is 500 with one heartbeat_failed line, stage store and the SQLSTATE, and nothing changes; once the store answers again, the same heartbeat, the same event ID, is RECORDED, not DUPLICATE, and brings J back with a stand-down for each responder', async () => {
    const w = world();
    const { walker, journeyId, responderIds } = await lost(w, 3);
    const before = w.recordOf(journeyId);
    const body = syntheticHeartbeat({ journeyId, position: syntheticPosition() });
    w.store.failWith(databaseError('40001'), 'recordHeartbeat');

    const failed = await w.heartbeatAnswer(walker, body);

    expect(failed.status).toBe(500);
    expect(w.log.events).toEqual([{ event: 'heartbeat_failed', stage: 'store', code: '40001' }]);
    expect(w.recordOf(journeyId)).toEqual(before);

    w.store.recover();
    const again = await w.heartbeatAnswer(walker, body);

    expect({ status: again.status, body: again.body }).toEqual({ status: 200, body: RECORDED });
    expect(w.stateOf(journeyId)).toBe('ACTIVE');
    expect(w.alertsOf(journeyId).map(({ state }) => state)).toEqual(['RESOLVED']);
    expect(recipientsOf(ofKind(w.messagesOf(journeyId), 'BACK_IN_CONTACT'))).toEqual(
      [...responderIds].sort(),
    );
  });
});

describe('LOST-03 and SM-09: a heartbeat and the watchdog’s open meet on the row', () => {
  test('LOST-03-AC11: a heartbeat holding J’s row as a sweep runs: the sweep skips J; once the heartbeat is written J is ACTIVE and not overdue, with no alert and no message, and the next sweep opens nothing', async () => {
    const w = world();
    const { walker, journeyId } = overdue(w, 2, UNDER_STUCK);
    w.store.hold(journeyId);
    const answering = w.heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }));
    await until(
      () => w.store.calls.includes('recordHeartbeat'),
      'the heartbeat reaching the store',
    );

    expect(await w.watchdog.sweep()).toEqual({ ok: true, opened: 0, stuck: 0 });
    w.store.release(journeyId);
    const answer = await answering;

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: RECORDED });
    expect(w.stateOf(journeyId)).toBe('ACTIVE');
    expect(w.store.alerts()).toEqual([]);
    expect(w.store.outbox()).toEqual([]);
    expect(await w.watchdog.sweep()).toEqual({ ok: true, opened: 0, stuck: 0 });
  });

  test('LOST-03-AC11: the sweep’s open holding J’s row as a heartbeat for J arrives: the heartbeat waits, then brings J back: the alert RESOLVED, the lost-contact messages withdrawn, one BACK_IN_CONTACT per responder; J ACTIVE and not overdue, and the next sweep opens nothing', async () => {
    const w = world();
    const { walker, journeyId, responderIds } = overdue(w, 2);
    w.store.hold(journeyId);
    let answered = false;
    const answering = w
      .heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }))
      .then((answer) => {
        answered = true;
        return answer;
      });
    await until(
      () => w.store.calls.includes('recordHeartbeat'),
      'the heartbeat reaching the store',
    );
    expect(answered).toBe(false);

    await w.store.commitHold(journeyId, async () => {
      expect((await w.watchdog.sweep()).opened).toBe(1);
    });
    const answer = await answering;

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: RECORDED });
    expect(w.stateOf(journeyId)).toBe('ACTIVE');
    expect(w.alertsOf(journeyId).map(({ state }) => state)).toEqual(['RESOLVED']);
    expect(
      ofKind(w.messagesOf(journeyId), 'LOST_CONTACT').every(
        ({ withdrawnAt }) => withdrawnAt !== null,
      ),
    ).toBe(true);
    expect(recipientsOf(ofKind(w.messagesOf(journeyId), 'BACK_IN_CONTACT'))).toEqual(
      [...responderIds].sort(),
    );
    expect(await w.watchdog.sweep()).toEqual({ ok: true, opened: 0, stuck: 0 });
  });
});

describe('LOST-03 and SM-08: duplicates change nothing, and heartbeats that come one after another resolve the alert once', () => {
  test('LOST-03-AC12: a heartbeat J already has, from before the silence, resent with its answer lost, is 200 DUPLICATE and changes nothing: J LOST_CONTACT, its alert open, last contact as it was, no message', async () => {
    const w = world();
    const walker = w.walker();
    const journeyId = await w.start(walker, [w.user(), w.user()]);
    const beforeTheSilence = await w.heartbeat(walker, journeyId);
    await w.runUntil(new Date(START.getTime() + FIVE_MINUTES));
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    const before = w.recordOf(journeyId);

    const answer = await w.heartbeatAnswer(walker, beforeTheSilence);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: DUPLICATE });
    expect(w.recordOf(journeyId)).toEqual(before);
  });

  test(`LOST-03-AC12: ${String(RACERS)} different fresh heartbeats, one after another: every one RECORDED and stored; the first brings J back and the rest are recorded; one resolution, at the first one’s time, and one stand-down per responder; the first, sent again, is DUPLICATE and writes nothing`, async () => {
    const w = world();
    const { walker, journeyId, responderIds } = await lost(w, 2);
    const bodies = Array.from({ length: RACERS }, () => syntheticHeartbeat({ journeyId }));
    const firstAt = await w.clock.now();

    for (const body of bodies) {
      await w.heartbeat(walker, journeyId, body);
      w.clock.advance(SECOND);
    }

    expect(w.store.heartbeats()).toHaveLength(RACERS);
    expect(w.stateOf(journeyId)).toBe('ACTIVE');
    expect(w.alertsOf(journeyId).map(({ state, resolvedAt }) => [state, resolvedAt])).toEqual([
      ['RESOLVED', firstAt],
    ]);
    const outbox = w.store.outbox();
    expect(recipientsOf(ofKind(outbox, 'BACK_IN_CONTACT'))).toEqual([...responderIds].sort());

    const [first] = bodies;
    const again = await w.heartbeatAnswer(walker, first ?? syntheticHeartbeat({ journeyId }));
    expect({ status: again.status, body: again.body }).toEqual({ status: 200, body: DUPLICATE });
    expect(w.store.outbox()).toEqual(outbox);
  });
});

describe('LOST-03 and REL-01: "I’m home" reads no clock', () => {
  test('LOST-03-AC13: with the journey module’s clock failing, "I’m home" is still 200 ENDED, ended at the store’s now; a heartbeat, which reads that clock, is a 500 (the control)', async () => {
    const moduleClock = fakeClock(START);
    moduleClock.failWith(new Error('the clock could not be read'));
    const w = world({ moduleClock });
    const walker = w.walker();
    const journeyId = w.seed(walker, [w.user()], { silentForMs: MINUTE });
    const other = w.walker();
    const otherJourneyId = w.seed(other, [w.user()], { silentForMs: MINUTE });
    w.clock.advance(MINUTE);

    const ended = await w.home(walker, journeyId);
    const control = await w.heartbeatAnswer(
      other,
      syntheticHeartbeat({ journeyId: otherJourneyId }),
    );

    expect({ status: ended.status, body: ended.body }).toEqual({ status: 200, body: ENDED });
    expect(w.store.endOf(journeyId)).toEqual({
      endedAt: new Date(START.getTime() + MINUTE),
      endReason: 'HOME',
    });
    expect(control.status).toBe(500);
    expect(w.log.events).toEqual([{ event: 'heartbeat_failed', stage: 'clock', code: null }]);
  });
});

// ---------------------------------------------------------------------------
// LOST-03-AC14 to AC17: "I'm home" (SM-04, D-110).
// ---------------------------------------------------------------------------

/** A journey started through the API with three responders, silent five minutes, alerted, and its lost-contact pushes delivered but R3's, which failed. */
async function alertedThroughTheApi(w: World) {
  const walker = w.walker();
  const responderIds = [w.user(), w.user(), w.user()];
  const [r1 = '', r2 = '', r3 = ''] = responderIds;
  const journeyId = await w.start(walker, responderIds);
  await w.heartbeat(walker, journeyId);
  w.push.failFor(r3, 'NO_TARGET');
  await w.runUntil(new Date(START.getTime() + FIVE_MINUTES));
  expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
  expect(recipientsOf(ofKind(w.push.accepted, 'LOST_CONTACT'))).toEqual([r1, r2].sort());
  w.push.recover();
  const [alert] = w.alertsOf(journeyId);
  return { walker, responderIds, journeyId, alertId: alert?.id ?? '', r1, r2, r3 };
}

describe('SM-04: a queued "I’m home" after an alert ends the journey, resolves the alert and tells every responder', () => {
  test('LOST-03-AC14: D, reconnecting, sends its queued "I’m home" before any heartbeat: 200 ENDED; J ENDED, end reason HOME, ended at the store’s now; the alert RESOLVED with resolution HOME, the unsent lost-contact push withdrawn; exactly one HOME message to each responder, after their LOST_CONTACT, none to W; the queued heartbeats that follow are 409 JOURNEY_ENDED, store nothing, and write one heartbeat_ignored line each; the watchdog never alerts J again, and W starts a new journey (201)', async () => {
    const w = world();
    const { walker, responderIds, journeyId, r3 } = await alertedThroughTheApi(w);
    w.clock.advance(4 * SECOND);
    const homeAt = await w.clock.now();
    // The setup's NO_TARGET wrote a push_failed line; what follows writes its own.
    const lines = w.log.events.length;

    const answer = await w.home(walker, journeyId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ENDED });
    expect(w.stateOf(journeyId)).toBe('ENDED');
    expect(w.store.endOf(journeyId)).toEqual({ endedAt: homeAt, endReason: 'HOME' });
    expect(
      w
        .alertsOf(journeyId)
        .map(({ state, resolvedAt, resolution }) => ({ state, resolvedAt, resolution })),
    ).toEqual([{ state: 'RESOLVED', resolvedAt: homeAt, resolution: 'HOME' }]);
    const unsent = ofKind(w.messagesOf(journeyId), 'LOST_CONTACT').filter(
      ({ recipientId }) => recipientId === r3,
    );
    expect(unsent.map(({ withdrawnAt }) => withdrawnAt)).toEqual([homeAt]);

    await w.runUntil(new Date(homeAt.getTime() + 2 * MINUTE));
    expect(recipientsOf(ofKind(w.push.accepted, 'HOME'))).toEqual([...responderIds].sort());
    for (const responder of responderIds) {
      expect(indexIn(w.push.messages, responder, 'LOST_CONTACT'), responder).toBeLessThan(
        indexIn(w.push.messages, responder, 'HOME'),
      );
    }
    expect(recipientsOf(w.push.messages)).not.toContain(walker.userId);
    expect(ofKind(w.push.messages, 'BACK_IN_CONTACT')).toEqual([]);

    // The phone's queue goes on after its "I'm home": heartbeats, each refused.
    const stored = w.store.heartbeats();
    for (let queued = 0; queued < 3; queued += 1) {
      const refused = await w.heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }));
      expect(refused.status).toBe(409);
      expect(codeOf(refused)).toBe('JOURNEY_ENDED');
    }
    expect(w.store.heartbeats()).toEqual(stored);
    expect(w.log.events.slice(lines)).toEqual(
      Array.from({ length: 3 }, () => ({
        event: 'heartbeat_ignored',
        reason: 'JOURNEY_ENDED',
        journeyId,
      })),
    );

    await w.runUntil(new Date(homeAt.getTime() + HOUR));
    expect(w.alertsOf(journeyId)).toHaveLength(1);
    await w.start(walker, responderIds);
  });

  test('LOST-03-AC14: in the other order, a queued heartbeat first: J comes back in contact with a BACK_IN_CONTACT message to each responder, and the "I’m home" that follows ends J from ACTIVE with no further message; the watchdog never alerts J again, and W starts a new journey (201)', async () => {
    const w = world();
    const { walker, responderIds, journeyId } = await alertedThroughTheApi(w);
    w.clock.advance(4 * SECOND);

    await w.heartbeat(walker, journeyId);
    await w.runUntil(new Date(START.getTime() + FIVE_MINUTES + MINUTE));
    expect(recipientsOf(ofKind(w.push.accepted, 'BACK_IN_CONTACT'))).toEqual(
      [...responderIds].sort(),
    );
    const outbox = w.store.outbox();
    const alerts = w.alertsOf(journeyId);
    const homeAt = await w.clock.now();

    const answer = await w.home(walker, journeyId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ENDED });
    expect(w.store.endOf(journeyId)).toEqual({ endedAt: homeAt, endReason: 'HOME' });
    expect(w.store.outbox()).toEqual(outbox);
    expect(w.alertsOf(journeyId)).toEqual(alerts);
    await w.runUntil(new Date(homeAt.getTime() + HOUR));
    expect(ofKind(w.push.messages, 'HOME')).toEqual([]);
    expect(w.alertsOf(journeyId)).toHaveLength(1);
    await w.start(walker, responderIds);
  });
});

describe('SM-04: "I’m home" on an ACTIVE journey ends it, and tells nobody yet', () => {
  test('LOST-03-AC15: "I’m home" on an ACTIVE journey with no alert: 200 ENDED; J ENDED, end reason HOME, ended at the store’s now; no alert touched and no message written; later sweeps never alert J, and W starts again', async () => {
    const w = world();
    const walker = w.walker();
    const responderIds = [w.user(), w.user()];
    const journeyId = await w.start(walker, responderIds);
    w.clock.advance(MINUTE);
    const homeAt = await w.clock.now();

    const answer = await w.home(walker, journeyId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ENDED });
    expect(w.stateOf(journeyId)).toBe('ENDED');
    expect(w.store.endOf(journeyId)).toEqual({ endedAt: homeAt, endReason: 'HOME' });
    expect(w.store.alerts()).toEqual([]);
    expect(w.store.outbox()).toEqual([]);
    await w.runUntil(new Date(homeAt.getTime() + HOUR));
    expect(w.store.alerts()).toEqual([]);
    expect(w.push.messages).toEqual([]);
    expect(w.log.events).toEqual([]);
    await w.start(walker, responderIds);
  });

  test('LOST-03-AC15: "I’m home" on an ACTIVE journey whose only alerts are resolved ones: 200 ENDED, and those alerts and their messages are untouched', async () => {
    const w = world();
    const walker = w.walker();
    const responderIds = [w.user()];
    const journeyId = w.seed(walker, responderIds, { silentForMs: MINUTE });
    const resolved = w.store.seedAlert({
      journeyId,
      state: 'RESOLVED',
      openedAt: new Date(START.getTime() - HOUR),
      silentSince: new Date(START.getTime() - HOUR - FIVE_MINUTES),
      resolvedAt: new Date(START.getTime() - 50 * MINUTE),
      resolution: 'BACK_IN_CONTACT',
    });
    w.store.seedMessage({
      alertId: resolved,
      recipientId: responderIds[0] ?? '',
      kind: 'BACK_IN_CONTACT',
      createdAt: new Date(START.getTime() - 50 * MINUTE),
      nextAttemptAt: new Date(START.getTime() - 50 * MINUTE),
      attempts: 1,
      sentAt: new Date(START.getTime() - 50 * MINUTE),
    });
    const alerts = w.store.alerts();
    const outbox = w.store.outbox();

    const answer = await w.home(walker, journeyId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ENDED });
    expect(w.store.endOf(journeyId)).toEqual({ endedAt: START, endReason: 'HOME' });
    expect(w.store.alerts()).toEqual(alerts);
    expect(w.store.outbox()).toEqual(outbox);
  });
});

describe('SM-04, SM-07, SM-08 and SEC-07: only the journey’s own device ends it, and every other answer changes nothing', () => {
  test.each(['ACTIVE', 'LOST_CONTACT'] as const)(
    'LOST-03-AC16: for J in %s, "I’m home" from another device of W’s is 403 NOT_THE_JOURNEYS_DEVICE, and J, its alert and its messages are exactly as they were',
    async (state) => {
      const w = world();
      const { walker, journeyId } = state === 'ACTIVE' ? overdue(w, 2, MINUTE) : await lost(w, 2);
      const tablet = w.secondDevice(walker);
      const before = w.recordOf(journeyId);

      const answer = await w.home(tablet, journeyId);

      expect(answer.status).toBe(403);
      expect(codeOf(answer)).toBe('NOT_THE_JOURNEYS_DEVICE');
      expect(w.recordOf(journeyId)).toEqual(before);
      expect(answer.text).not.toContain(journeyId);
      expect(answer.text).not.toContain(tablet.credential);
    },
  );

  test.each(['ACTIVE', 'LOST_CONTACT'] as const)(
    'LOST-03-AC16: "I’m home" for another walker’s %s journey, or for an ID no journey has, is 404 JOURNEY_NOT_FOUND, the two bodies identical, and their journey is exactly as it was',
    async (state) => {
      const w = world();
      const { journeyId: theirs } = state === 'ACTIVE' ? overdue(w, 2, MINUTE) : await lost(w, 2);
      const walker = w.walker();
      const before = w.recordOf(theirs);

      const toTheirs = await w.home(walker, theirs);
      const toNone = await w.home(walker, syntheticUuid());

      expect(toTheirs.status).toBe(404);
      expect(codeOf(toTheirs)).toBe('JOURNEY_NOT_FOUND');
      expect(toNone.status).toBe(404);
      expect(toTheirs.text).toBe(toNone.text);
      expect(w.recordOf(theirs)).toEqual(before);
      expect(toTheirs.text).not.toContain(theirs);
    },
  );

  test('LOST-03-AC16: with no credential, or an unknown one, "I’m home" is 401 UNAUTHORIZED and nothing changes', async () => {
    const w = world();
    const { walker, journeyId } = await lost(w, 2);
    const before = w.recordOf(journeyId);
    const unknown = syntheticCredential();

    const none = await w.home(walker, journeyId, { credential: null });
    const stranger = await w.home(walker, journeyId, { credential: unknown });

    for (const answer of [none, stranger]) {
      expect(answer.status).toBe(401);
      expect(codeOf(answer)).toBe('UNAUTHORIZED');
      expect(answer.text).not.toContain(journeyId);
    }
    expect(stranger.text).not.toContain(unknown);
    expect(w.recordOf(journeyId)).toEqual(before);
  });

  test('LOST-03-AC16: a journey ID that is not a UUID, or a body holding any key — the journey’s own ID included — is the one fixed 400, with no data, and nothing changes', async () => {
    const w = world();
    const { walker, journeyId } = await lost(w, 2);
    const other = w.seed(w.walker(), [w.user()], { state: 'ENDED', silentForMs: HOUR });
    const before = w.recordOf(journeyId);
    // The fixed 400 every route answers, as the heartbeat route answers it.
    const fixed = await w.heartbeatAnswer(walker, { journeyId } as unknown as SyntheticHeartbeat);
    expect(fixed.status).toBe(400);

    const refused = [
      await w.home(walker, 'not-a-uuid'),
      await w.home(walker, `${journeyId}x`),
      await w.home(walker, journeyId, { body: { note: 'synthetic' } }),
      await w.home(walker, journeyId, { body: { background_geolocation: { synthetic: true } } }),
      await w.home(walker, journeyId, { body: { journeyId } }),
      await w.home(walker, journeyId, { body: { journeyId: other } }),
      // The path names no journey; a body that named the walker's own must not end it.
      await w.home(walker, syntheticUuid(), { body: { journeyId } }),
    ];

    for (const [index, answer] of refused.entries()) {
      expect(answer.status, String(index)).toBe(400);
      expect(answer.text, String(index)).toBe(fixed.text);
      expect(answer.body, String(index)).not.toHaveProperty('data');
      expect(answer.text, String(index)).not.toContain('background_geolocation');
      expect(answer.headers, String(index)).not.toContain('background_geolocation');
    }
    expect(w.recordOf(journeyId)).toEqual(before);
  });

  test('LOST-03-AC16: for an ENDED journey, whatever ended it — set directly, or an earlier "I’m home" whose answer was lost — "I’m home" is 409 JOURNEY_ENDED, nothing changes, and one home_ignored line names the journey and the reason', async () => {
    const w = world();
    const walker = w.walker();
    const endedDirectly = w.seed(walker, [w.user()], { state: 'ENDED', silentForMs: HOUR });
    const { walker: other, journeyId: endedByHome } = await lost(w, 2);
    const first = await w.home(other, endedByHome);
    expect({ status: first.status, body: first.body }).toEqual({ status: 200, body: ENDED });
    const before = [w.recordOf(endedDirectly), w.recordOf(endedByHome)];
    const lines = w.log.events.length;

    const answers = [await w.home(walker, endedDirectly), await w.home(other, endedByHome)];

    for (const answer of answers) {
      expect(answer.status).toBe(409);
      expect(codeOf(answer)).toBe('JOURNEY_ENDED');
    }
    expect([w.recordOf(endedDirectly), w.recordOf(endedByHome)]).toEqual(before);
    expect(w.log.events.slice(lines)).toEqual([
      { event: 'home_ignored', reason: 'JOURNEY_ENDED', journeyId: endedDirectly },
      { event: 'home_ignored', reason: 'JOURNEY_ENDED', journeyId: endedByHome },
    ]);
  });

  test('LOST-03-AC16: a journey that ends between the module’s read and the store’s write is answered as one already ended: 409 JOURNEY_ENDED and one home_ignored line', async () => {
    const w = world();
    const { walker, journeyId } = await lost(w, 2);
    w.store.beforeNext('recordHome', () => {
      w.store.setState(journeyId, 'ENDED');
    });

    const answer = await w.home(walker, journeyId);

    expect(answer.status).toBe(409);
    expect(codeOf(answer)).toBe('JOURNEY_ENDED');
    expect(w.store.endOf(journeyId)).toEqual({ endedAt: null, endReason: null });
    expect(w.alertsOf(journeyId).map(({ state }) => state)).toEqual(['OPEN']);
    expect(w.log.events).toEqual([{ event: 'home_ignored', reason: 'JOURNEY_ENDED', journeyId }]);
  });

  test.each([
    {
      stage: 'store' as const,
      call: 'recordHome' as const,
      error: databaseError('40001'),
      code: '40001',
    },
    {
      stage: 'read' as const,
      call: 'journeyForHeartbeat' as const,
      error: databaseError('57P01'),
      code: '57P01',
    },
    {
      stage: 'store' as const,
      call: 'recordHome' as const,
      error: new Error('no SQLSTATE here'),
      code: null,
    },
  ])(
    'LOST-03-AC16: when the store fails at $call, "I’m home" is 500, never a 2xx and never a 401; nothing changes, and one home_failed line carries the stage, $stage, and the SQLSTATE',
    async ({ stage, call, error, code }) => {
      const w = world();
      const { walker, journeyId } = await lost(w, 2);
      const before = w.recordOf(journeyId);
      w.store.failWith(error, call);

      const answer = await w.home(walker, journeyId);

      expect(answer.status).toBe(500);
      expect(answer.text).not.toContain(journeyId);
      w.store.recover();
      expect(w.recordOf(journeyId)).toEqual(before);
      expect(w.log.events).toEqual([{ event: 'home_failed', stage, code }]);
    },
  );

  // Review loop 1 (the spec's item 7b; test-auditor): the route lower-cases
  // the journey's ID at the edge, so the ID in upper case names the same
  // journey, and the line names it as the database writes it.
  test('LOST-03-AC16: “I’m home” with the journey’s ID in upper case is 200 ENDED; sent again it is 409 JOURNEY_ENDED, and the home_ignored line names the ID in lower case', async () => {
    const w = world();
    const { walker, journeyId } = await lost(w, 2);
    expect(journeyId).toMatch(LOWER_UUID);
    const upper = journeyId.toUpperCase();

    const first = await w.home(walker, upper);
    expect({ status: first.status, body: first.body }).toEqual({ status: 200, body: ENDED });
    expect(w.stateOf(journeyId)).toBe('ENDED');
    expect(w.store.endOf(journeyId).endReason).toBe('HOME');
    const lines = w.log.events.length;

    const again = await w.home(walker, upper);

    expect(again.status).toBe(409);
    expect(codeOf(again)).toBe('JOURNEY_ENDED');
    expect(w.log.events.slice(lines)).toEqual([
      { event: 'home_ignored', reason: 'JOURNEY_ENDED', journeyId },
    ]);
  });
});

describe('SM-04 and SM-09: "I’m home" is all or nothing, and meets the watchdog and the heartbeat on the row', () => {
  test('LOST-03-AC17: with the store failing recordHome, nothing changes and the answer is 500 with one home_failed line; once it answers again, the same request does all of AC14’s work', async () => {
    const w = world();
    const { walker, journeyId, responderIds } = await lost(w, 3);
    const before = w.recordOf(journeyId);
    w.store.failWith(databaseError('P0001'), 'recordHome');

    const failed = await w.home(walker, journeyId);

    expect(failed.status).toBe(500);
    expect(w.log.events).toEqual([{ event: 'home_failed', stage: 'store', code: 'P0001' }]);
    w.store.recover();
    expect(w.recordOf(journeyId)).toEqual(before);

    const again = await w.home(walker, journeyId);

    expect({ status: again.status, body: again.body }).toEqual({ status: 200, body: ENDED });
    expect(w.store.endOf(journeyId).endReason).toBe('HOME');
    expect(w.alertsOf(journeyId).map(({ resolution }) => resolution)).toEqual(['HOME']);
    await w.runUntil(new Date(START.getTime() + MINUTE));
    expect(recipientsOf(ofKind(w.push.accepted, 'HOME'))).toEqual([...responderIds].sort());
  });

  test('LOST-03-AC17: "I’m home" holding J’s row as a sweep runs: the sweep skips J, and J ends with no alert; no later sweep alerts it', async () => {
    const w = world();
    const { walker, journeyId } = overdue(w, 2, UNDER_STUCK);
    w.store.hold(journeyId);
    const answering = w.home(walker, journeyId);
    await until(() => w.store.calls.includes('recordHome'), '"I’m home" reaching the store');

    expect(await w.watchdog.sweep()).toEqual({ ok: true, opened: 0, stuck: 0 });
    w.store.release(journeyId);
    const answer = await answering;

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ENDED });
    expect(w.stateOf(journeyId)).toBe('ENDED');
    expect(w.store.alerts()).toEqual([]);
    await w.runUntil(new Date(START.getTime() + HOUR));
    expect(w.store.alerts()).toEqual([]);
  });

  test('LOST-03-AC17: the sweep’s open holding J’s row as "I’m home" arrives: "I’m home" waits, then does SM-04’s work: J ENDED, the alert RESOLVED with resolution HOME, a HOME message per responder, the unsent lost-contact messages withdrawn', async () => {
    const w = world();
    const { walker, journeyId, responderIds } = overdue(w, 2);
    w.store.hold(journeyId);
    let answered = false;
    const answering = w.home(walker, journeyId).then((answer) => {
      answered = true;
      return answer;
    });
    await until(() => w.store.calls.includes('recordHome'), '"I’m home" reaching the store');
    expect(answered).toBe(false);

    await w.store.commitHold(journeyId, async () => {
      expect((await w.watchdog.sweep()).opened).toBe(1);
    });
    const answer = await answering;

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ENDED });
    expect(w.stateOf(journeyId)).toBe('ENDED');
    expect(w.alertsOf(journeyId).map(({ state, resolution }) => [state, resolution])).toEqual([
      ['RESOLVED', 'HOME'],
    ]);
    expect(recipientsOf(ofKind(w.messagesOf(journeyId), 'HOME'))).toEqual([...responderIds].sort());
    expect(
      ofKind(w.messagesOf(journeyId), 'LOST_CONTACT').every(
        ({ withdrawnAt }) => withdrawnAt !== null,
      ),
    ).toBe(true);
  });

  test.each(['heartbeat first', '"I’m home" first'] as const)(
    'LOST-03-AC17: "I’m home" and a fresh heartbeat meet on LOST_CONTACT J, %s: heartbeat first gives BACK_IN_CONTACT to each and then ENDED with no HOME; "I’m home" first gives HOME to each, and the heartbeat is 409 JOURNEY_ENDED and stores nothing; either way one resolution and one stand-down per responder',
    async (order) => {
      const w = world();
      const { walker, journeyId, responderIds } = await lost(w, 2);
      const body = syntheticHeartbeat({ journeyId });

      if (order === 'heartbeat first') {
        const beat = await w.heartbeatAnswer(walker, body);
        const ended = await w.home(walker, journeyId);
        expect([beat.status, ended.status]).toEqual([200, 200]);
        expect(ofKind(w.messagesOf(journeyId), 'HOME')).toEqual([]);
      } else {
        const ended = await w.home(walker, journeyId);
        const beat = await w.heartbeatAnswer(walker, body);
        expect([ended.status, beat.status]).toEqual([200, 409]);
        expect(codeOf(beat)).toBe('JOURNEY_ENDED');
        expect(w.store.heartbeats()).toEqual([]);
        expect(ofKind(w.messagesOf(journeyId), 'BACK_IN_CONTACT')).toEqual([]);
      }

      expect(w.stateOf(journeyId)).toBe('ENDED');
      expect(w.alertsOf(journeyId).map(({ state }) => state)).toEqual(['RESOLVED']);
      const standDowns = w.messagesOf(journeyId).filter(({ kind }) => kind !== 'LOST_CONTACT');
      expect(recipientsOf(standDowns)).toEqual([...responderIds].sort());
    },
  );

  test('LOST-03-AC17: two "I’m home" requests for J at once: one is 200 and the other 409, with one resolution, one HOME message per responder and one home_ignored line', async () => {
    const w = world();
    const { walker, journeyId, responderIds } = await lost(w, 2);

    const answers = await Promise.all([w.home(walker, journeyId), w.home(walker, journeyId)]);

    expect(answers.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(w.alertsOf(journeyId).map(({ state }) => state)).toEqual(['RESOLVED']);
    expect(recipientsOf(ofKind(w.messagesOf(journeyId), 'HOME'))).toEqual([...responderIds].sort());
    expect(w.log.events).toEqual([{ event: 'home_ignored', reason: 'JOURNEY_ENDED', journeyId }]);
  });
});

// ---------------------------------------------------------------------------
// LOST-03-AC19: nothing personal reaches a log (PRIV-07).
// ---------------------------------------------------------------------------

describe('PRIV-07 and LOST-03: nothing personal reaches a log', () => {
  test('LOST-03-AC19: when the store fails recordHeartbeat and recordHome with errors whose messages hold a synthetic coordinate, a credential-like string and a responder’s ID, nothing written to stdout, stderr or the console holds any of them; the capture sees the lines the production log wrote, and the errors do hold the markers', async () => {
    // The production log, writing to this process's stdout, where the
    // capture watches: the recording fake would prove only what the module
    // chose, not what reached a stream.
    const w = world({ log: createLog() });
    const { walker, journeyId, responderIds } = await lost(w, 2);
    const coordinate = String(syntheticCoordinate());
    const credential = `postgres://synthetic:${syntheticCredential()}@127.0.0.1:1/synthetic`;
    const responderId = responderIds[0] ?? '';
    const markers = [coordinate, credential, responderId];
    const thrown: Error[] = [];
    const failing = (code: string) => {
      const error = databaseError(
        code,
        `failed near (${coordinate}) as ${credential} for ${responderId}`,
      );
      thrown.push(error);
      return error;
    };

    const { written, result } = await captured(async () => {
      w.store.failWith(failing('40001'), 'recordHeartbeat');
      const beat = await w.heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }));
      w.store.failWith(failing('40P01'), 'recordHome');
      const home = await w.home(walker, journeyId);
      w.store.failWith(failing('57P01'), 'journeyForHeartbeat');
      const read = await w.home(walker, journeyId);
      w.store.recover();
      return [beat, home, read];
    });

    // Controls: the errors hold every marker, and the capture saw the lines.
    for (const error of thrown) {
      expect(markersIn(error.message, markers)).toEqual(markers);
    }
    expect(written).toContain('"event":"heartbeat_failed"');
    expect(written).toContain('"event":"home_failed"');
    expect(result.map(({ status }) => status)).toEqual([500, 500, 500]);

    expect(markersIn(written, markers)).toEqual([]);
    for (const answer of result) {
      expect(markersIn(`${answer.text}\n${answer.headers}`, markers)).toEqual([]);
    }
  });

  // Review loop 1 (the spec's item 4a; privacy-security-reviewer): with the
  // route's detailed input, oRPC keeps the request's headers, the device
  // credential among them, in a validation error's cause.data. Nothing may
  // print that error. The registered device's credential is generated at run
  // time, so it is the marker.
  test('LOST-03-AC19: a 400 from the “I’m home” route, for a known device whose credential is a run-time marker and a body holding a key, writes nothing to stdout, stderr or the console that holds the credential; the capture sees the production log’s lines', async () => {
    const w = world({ log: createLog() });
    const { walker, journeyId } = await lost(w, 1);
    const markers = [walker.credential];

    const { written, result } = await captured(async () => {
      const refused = [
        await w.home(walker, journeyId, { body: { note: 'synthetic' } }),
        await w.home(walker, journeyId, { body: { journeyId } }),
        await w.home(walker, 'not-a-uuid', { body: { note: 'synthetic' } }),
      ];
      // Control: a line through the production log, in the same capture.
      const ended = await w.home(walker, journeyId);
      const again = await w.home(walker, journeyId);
      return { refused, ended, again };
    });

    expect(result.refused.map(({ status }) => status)).toEqual([400, 400, 400]);
    expect(result.ended.status).toBe(200);
    expect(result.again.status).toBe(409);
    expect(written).toContain('"event":"home_ignored"');
    expect(markersIn(written, markers)).toEqual([]);
    for (const answer of [...result.refused, result.ended, result.again]) {
      expect(markersIn(`${answer.text}\n${answer.headers}`, markers)).toEqual([]);
    }
  });
});
