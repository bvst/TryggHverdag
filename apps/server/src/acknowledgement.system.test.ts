// L6 system: "I'm on it" (LOST-06), through the whole server in one process.
//
// The real API, the real journey module, the real acknowledgement module, the
// real watchdog and the real sender, with fakes only at the edges: the device
// credentials, the journey store, the worker's beats, the push port and the
// log. One fake clock stands in for the database's now(): the store reads it
// as PostgreSQL's now() would be read. The acknowledgement module reads no
// clock (AR-03). The watchdog and the sender are called here as the worker's
// loops call them, every 10 s (D-107).
//
// What is proven here, the roadmap's "done when" for M2's task 5: "a
// responder's answer is recorded and shown, at L6". Recorded on the alert,
// for M3's read (D-106); shown to every other responder now, by one
// content-free push of the kind ACKNOWLEDGED (D-113):
//   - a responder's "I'm on it" is recorded and every other responder told
//     (AC1); it withdraws nothing (AC2);
//   - only a responder of the alert's journey can acknowledge it, from any of
//     their devices, and nobody else learns the alert exists (AC3);
//   - one responder is on it, and every repeat is safe (AC4, AC6); a resolved
//     alert refuses it, and an acknowledgement never reaches another alert
//     (AC5);
//   - the notices withdrawn when the alert resolves, and one stand-down per
//     responder, never overtaking what is in the port's hands (AC7, AC8);
//   - the record escalation to SMS will read, on the store's clock (AC9);
//     content-free messages (AC10); all or nothing (AC11); the row's two
//     orders (AC12); nothing personal in a log (AC16).
//
// This file is the `alerts` mutation group's second test file (D-114): the
// module it proves lives in modules/alerts/. Times are written out (five
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
import { createPushSender } from './modules/alerts/outbox.ts';
import { createWatchdog } from './modules/alerts/watchdog.ts';
import { createHealthService } from './modules/health/service.ts';
import { createJourneyService } from './modules/journeys/service.ts';
import type { Log, OutboxStore } from './ports.ts';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** D-021: responders are alerted when the server has heard nothing for five minutes, or more. */
const FIVE_MINUTES = 5 * MINUTE;
/** How often the worker's loops run (D-107). */
const INTERVAL = 10 * SECOND;
/** How long a claimed message is leased (LOST-02, approach item 5). */
const LEASE = 30 * SECOND;
/** The longest a stand-down is ever held (LOST-03, D-112): the retry cap. */
const LONGEST_HOLD = 60 * SECOND;

/** A synthetic night: 21:00 UTC on 1 October 2026. */
const START = new Date('2026-10-01T21:00:00.000Z');

const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const RECORDED = { outcome: 'RECORDED' };
const ENDED = { outcome: 'ENDED' };
/** "I'm on it" recorded now, or already the caller's (D-114). */
const ON_IT = { outcome: 'ACKNOWLEDGED' };

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
  const api = createApi({
    health: createHealthService({ clock, heartbeats: beats }),
    journeys: createJourneyService({ clock, journeys: store, log }),
    devices,
    acknowledgements: createAcknowledgementService({ alerts: store, log }),
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
    /**
     * A user with a device of their own, who can follow a journey and say
     * "I'm on it" from that device. Before the login task, a test hands a
     * responder a device as it hands a walker one (D-091, the spec's "What
     * exists today").
     */
    responder(): RegisteredDevice {
      const device = devices.register();
      store.addUser(device.userId);
      return device;
    },
    /** Another device of the same person: a responder's tablet, say. */
    secondDevice: (of: RegisteredDevice): RegisteredDevice =>
      devices.register({ userId: of.userId }),
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
    /** "I'm home" through the API (D-110), with the device's credential. */
    home: (device: RegisteredDevice, journeyId: string): Promise<Answer> =>
      post(device.credential, `journeys/${journeyId}/home`),
    /**
     * "I'm on it" through the API (D-114): POST /v1/alerts/{alertId}/acknowledgement,
     * with the device's credential, or another, or none; with no body unless
     * one is given.
     */
    acknowledge: (
      device: RegisteredDevice | null,
      alertId: string,
      { credential, body }: { credential?: string | null; body?: unknown } = {},
    ): Promise<Answer> =>
      post(
        credential === undefined ? (device?.credential ?? null) : credential,
        `alerts/${alertId}/acknowledgement`,
        body,
      ),
    /**
     * A journey put in directly, in any state, its silence begun `silentForMs`
     * before the clock's now: from its last heartbeat an hour after its start.
     */
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
     * silence's alert, which is LOST-02's, not what these tests watch.
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
    /** The acknowledgement module's lines only: a failing push writes lines of its own. */
    acknowledgementLines: () =>
      recorded.events.filter(({ event }) => event.startsWith('acknowledgement_')),
  };
  return self;
}

type World = ReturnType<typeof world>;

/** An overdue ACTIVE journey of a new walker, with `count` responders who each have a device. */
async function followed(w: World, count = 3) {
  const walker = w.walker();
  const responders = Array.from({ length: count }, () => w.responder());
  const responderIds = responders.map(({ userId }) => userId);
  const journeyId = await w.seed(walker, responderIds, { silentForMs: FIVE_MINUTES + MINUTE });
  return { walker, responders, responderIds, journeyId };
}

/** An overdue journey, swept: LOST_CONTACT, with its alert and one unsent LOST_CONTACT message per responder. */
async function lost(w: World, count = 3) {
  const journey = await followed(w, count);
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

/** A sender whose claim takes at most `limit`: the batch was full, so the rest are never claimed by it. */
function senderOf(w: World, limit: number) {
  const outbox: OutboxStore = {
    claimDue: (request) => w.store.claimDue({ ...request, limit }),
    markSent: (messageId) => w.store.markSent(messageId),
    markFailed: (request) => w.store.markFailed(request),
  };
  return createPushSender({ outbox, push: w.push, log: w.log });
}

/** Who is on the alert, and since when, as the store holds it. */
function acknowledgementOf(w: World, alertId: string) {
  const alert = w.store.alerts().find(({ id }) => id === alertId);
  return { acknowledgedBy: alert?.acknowledgedBy, acknowledgedAt: alert?.acknowledgedAt };
}

/**
 * One request's answer, and the port methods the store was asked while it
 * ran, in order. The spec's approach item 3, "why read first": a refusal the
 * plain read decides is answered from it, so recordAcknowledgement, which
 * takes the journey's row, is never asked.
 */
async function withStoreCalls(w: World, request: () => Promise<Answer>) {
  const from = w.store.calls.length;
  const answer = await request();
  return { answer, calls: w.store.calls.slice(from) };
}

// ---------------------------------------------------------------------------
// LOST-06-AC1: the roadmap's "done when".
// ---------------------------------------------------------------------------

describe('LOST-06 and LOST-02: a responder’s "I’m on it" is recorded on the alert, and every other responder is told', () => {
  test('LOST-06-AC1: W starts J through the API with R1, R2 and R3, each with a device; D sends a heartbeat every 60 s for 10 minutes and goes silent; at five minutes each responder gets LOST_CONTACT; a minute later R1 says "I’m on it" for J’s alert, its ID read from the store: 200 ACKNOWLEDGED; the alert ACKNOWLEDGED by R1 at the store’s now, J still LOST_CONTACT with no other alert; the next delivery hands exactly one ACKNOWLEDGED to R2 and one to R3, none to R1, W or anyone else; later sweeps open nothing and later deliveries send nothing more', async () => {
    const w = world();
    const walker = w.walker();
    const [r1, r2, r3] = [w.responder(), w.responder(), w.responder()] as const;
    const bystander = w.responder();
    const journeyId = await w.start(walker, [r1.userId, r2.userId, r3.userId]);

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
    expect(recipientsOf(ofKind(w.push.accepted, 'LOST_CONTACT'))).toEqual(
      [r1.userId, r2.userId, r3.userId].sort(),
    );
    // The alert's ID read from the store, as M3's read will hand it to the app.
    const [alert] = w.alertsOf(journeyId);
    const alertId = alert?.id ?? '';

    // A minute later R1 is on it.
    await w.runUntil(new Date(lastHeartbeatAt.getTime() + FIVE_MINUTES + MINUTE));
    const at = await w.clock.now();
    const answer = await w.acknowledge(r1, alertId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ON_IT });
    expect(
      w.alertsOf(journeyId).map(({ id, state, acknowledgedBy, acknowledgedAt }) => ({
        id,
        state,
        acknowledgedBy,
        acknowledgedAt,
      })),
    ).toEqual([
      { id: alertId, state: 'ACKNOWLEDGED', acknowledgedBy: r1.userId, acknowledgedAt: at },
    ]);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');

    const handedBefore = w.push.messages.length;
    await w.sender.deliverDue();

    const notices = ofKind(w.push.messages.slice(handedBefore), 'ACKNOWLEDGED');
    expect(recipientsOf(notices)).toEqual([r2.userId, r3.userId].sort());
    expect(recipientsOf(ofKind(w.push.accepted, 'ACKNOWLEDGED'))).toEqual(
      [r2.userId, r3.userId].sort(),
    );
    for (const nobody of [r1.userId, walker.userId, bystander.userId]) {
      expect(recipientsOf(ofKind(w.push.messages, 'ACKNOWLEDGED'))).not.toContain(nobody);
    }

    // The phone stays silent: later sweeps open nothing, later deliveries send nothing more.
    const handedOver = w.push.messages.length;
    await w.runUntil(new Date(at.getTime() + 10 * MINUTE));
    expect(w.push.messages).toHaveLength(handedOver);
    expect(w.alertsOf(journeyId)).toHaveLength(1);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(w.log.events).toEqual([]);
  });

  test('LOST-06-AC1: with R1 as the journey’s only responder, "I’m on it" is 200 and the alert ACKNOWLEDGED, and no ACKNOWLEDGED message is written or handed out', async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, 1);
    const [r1] = responders;
    if (r1 === undefined) {
      throw new Error('expected one responder');
    }
    await w.sender.deliverDue();

    const answer = await w.acknowledge(r1, alertId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ON_IT });
    expect(
      w.alertsOf(journeyId).map(({ state, acknowledgedBy }) => [state, acknowledgedBy]),
    ).toEqual([['ACKNOWLEDGED', r1.userId]]);
    expect(ofKind(w.messagesOf(journeyId), 'ACKNOWLEDGED')).toEqual([]);
    await w.sender.deliverDue();
    expect(ofKind(w.push.messages, 'ACKNOWLEDGED')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LOST-06-AC2: acknowledging withdraws nothing.
// ---------------------------------------------------------------------------

describe('LOST-06: acknowledging records exactly the acknowledgement, and withdraws nothing', () => {
  test('LOST-06-AC2: R2’s lost-contact push fails NO_TARGET; R1 acknowledges; R2’s push is not withdrawn nor re-timed, is retried after the acknowledgement, and is accepted once the port recovers: the others still hear of the alert', async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, 3);
    const [r1, r2] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    w.push.failFor(r2.userId, 'NO_TARGET');
    await w.sender.deliverDue();
    const lostContactBefore = ofKind(w.messagesOf(journeyId), 'LOST_CONTACT');
    const r2sBefore = lostContactBefore.find(({ recipientId }) => recipientId === r2.userId);
    expect(r2sBefore).toMatchObject({ sentAt: null, lastFailure: 'NO_TARGET', withdrawnAt: null });

    expect((await w.acknowledge(r1, alertId)).status).toBe(200);

    // Nothing of the lost-contact messages changed: none withdrawn, none re-timed.
    expect(ofKind(w.messagesOf(journeyId), 'LOST_CONTACT')).toEqual(lostContactBefore);
    w.push.recover();
    await w.deliverUntil(new Date(START.getTime() + MINUTE));
    expect(
      ofKind(w.push.accepted, 'LOST_CONTACT').filter(
        ({ recipientId }) => recipientId === r2.userId,
      ),
    ).toHaveLength(1);
    expect(recipientsOf(ofKind(w.push.accepted, 'LOST_CONTACT'))).toEqual(
      responders.map(({ userId }) => userId).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// LOST-06-AC3: only a responder of the alert's journey, and nobody else learns.
// ---------------------------------------------------------------------------

describe('LOST-06 and SEC-07: only a responder of the alert’s journey can acknowledge it, and nobody else learns that it exists', () => {
  test('LOST-06-AC3: "I’m on it" for J’s alert from W’s own device, from another walker, from a responder of another journey only, and from R1 for an alert ID no alert has, is 404 ALERT_NOT_FOUND with one and the same body; the alert, its messages and J are exactly as they were, no line is written, and no answer carries the alert’s ID or the credential', async () => {
    const w = world();
    const { walker, journeyId, alertId, responders } = await lost(w, 2);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice];
    const otherWalker = w.walker();
    const elsewhere = w.responder();
    await w.seed(w.walker(), [elsewhere.userId], { silentForMs: MINUTE });
    const before = w.recordOf(journeyId);

    const answers = [
      await w.acknowledge(walker, alertId),
      await w.acknowledge(otherWalker, alertId),
      await w.acknowledge(elsewhere, alertId),
      await w.acknowledge(r1, syntheticUuid()),
    ];

    for (const [index, answer] of answers.entries()) {
      expect(answer.status, String(index)).toBe(404);
      expect(codeOf(answer), String(index)).toBe('ALERT_NOT_FOUND');
      expect(answer.text, String(index)).toBe(answers[0]?.text);
      expect(answer.body, String(index)).not.toHaveProperty('data');
      expect(markersIn(`${answer.text}\n${answer.headers}`, [alertId, journeyId])).toEqual([]);
    }
    expect(answers[0]?.text).not.toContain(walker.credential);
    expect(w.recordOf(journeyId)).toEqual(before);
    expect(w.log.events).toEqual([]);
  });

  test('LOST-06-AC3: each ALERT_NOT_FOUND — W’s own device, another walker, a responder of another journey only, an alert ID no alert has — is decided by the plain read alone: the store is asked alertForAcknowledgement once and never recordAcknowledgement, so no stranger ever reaches J’s row', async () => {
    const w = world();
    const { walker, alertId, responders } = await lost(w, 2);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice];
    const otherWalker = w.walker();
    const elsewhere = w.responder();
    await w.seed(w.walker(), [elsewhere.userId], { silentForMs: MINUTE });

    for (const [who, request] of [
      ['W’s own device', () => w.acknowledge(walker, alertId)],
      ['another walker', () => w.acknowledge(otherWalker, alertId)],
      ['a responder of another journey only', () => w.acknowledge(elsewhere, alertId)],
      ['R1, for an alert ID no alert has', () => w.acknowledge(r1, syntheticUuid())],
    ] as const) {
      const { answer, calls } = await withStoreCalls(w, request);

      expect({ status: answer.status, code: codeOf(answer) }, who).toEqual({
        status: 404,
        code: 'ALERT_NOT_FOUND',
      });
      expect(calls, who).toEqual(['alertForAcknowledgement']);
    }
  });

  test('LOST-06-AC3: with no credential, or an unknown one, "I’m on it" is 401 UNAUTHORIZED and nothing changes', async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, 2);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice];
    const before = w.recordOf(journeyId);
    const unknown = syntheticCredential();

    const none = await w.acknowledge(r1, alertId, { credential: null });
    const stranger = await w.acknowledge(r1, alertId, { credential: unknown });

    for (const answer of [none, stranger]) {
      expect(answer.status).toBe(401);
      expect(codeOf(answer)).toBe('UNAUTHORIZED');
      expect(answer.text).not.toContain(alertId);
    }
    expect(stranger.text).not.toContain(unknown);
    expect(w.store.calls.filter((call) => call.includes('cknowledg'))).toEqual([]);
    expect(w.recordOf(journeyId)).toEqual(before);
  });

  test('LOST-06-AC3: an alert ID that is not a UUID, or a body holding any key — an alertId naming another alert included — is the one fixed 400, with no data; the alert named is not acknowledged, nothing changes and no line is written', async () => {
    const w = world();
    const { walker, journeyId, alertId, responders } = await lost(w, 2);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice];
    const other = await lost(w, 1);
    const before = [w.recordOf(journeyId), w.recordOf(other.journeyId)];
    // The fixed 400 every route answers, as the heartbeat route answers it.
    const fixed = await w.heartbeatAnswer(walker, { journeyId } as unknown as SyntheticHeartbeat);
    expect(fixed.status).toBe(400);

    const refused = [
      await w.acknowledge(r1, 'not-a-uuid'),
      await w.acknowledge(r1, `${alertId}x`),
      await w.acknowledge(r1, alertId, { body: { note: 'synthetic' } }),
      await w.acknowledge(r1, alertId, { body: { background_geolocation: { synthetic: true } } }),
      await w.acknowledge(r1, alertId, { body: { alertId } }),
      await w.acknowledge(r1, alertId, { body: { alertId: other.alertId } }),
      // The path names no alert; a body that named R1's own must not acknowledge it.
      await w.acknowledge(r1, syntheticUuid(), { body: { alertId } }),
    ];

    for (const [index, answer] of refused.entries()) {
      expect(answer.status, String(index)).toBe(400);
      expect(answer.text, String(index)).toBe(fixed.text);
      expect(answer.body, String(index)).not.toHaveProperty('data');
      expect(answer.text, String(index)).not.toContain('background_geolocation');
      expect(answer.headers, String(index)).not.toContain('background_geolocation');
      expect(answer.text, String(index)).not.toContain(alertId);
    }
    expect([w.recordOf(journeyId), w.recordOf(other.journeyId)]).toEqual(before);
    expect(w.log.events).toEqual([]);
  });

  test('LOST-06-AC3: any of R1’s devices can acknowledge: from R1’s second device the alert is acknowledged by R1; the same from R1’s first device afterwards is 200 and changes nothing', async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, 2);
    const [r1, r2] = responders as [RegisteredDevice, RegisteredDevice];
    const tablet = w.secondDevice(r1);
    expect(tablet.deviceId).not.toBe(r1.deviceId);

    const fromTablet = await w.acknowledge(tablet, alertId);

    expect({ status: fromTablet.status, body: fromTablet.body }).toEqual({
      status: 200,
      body: ON_IT,
    });
    expect(acknowledgementOf(w, alertId).acknowledgedBy).toBe(r1.userId);
    expect(recipientsOf(ofKind(w.messagesOf(journeyId), 'ACKNOWLEDGED'))).toEqual([r2.userId]);
    const before = w.recordOf(journeyId);

    const fromPhone = await w.acknowledge(r1, alertId);

    expect({ status: fromPhone.status, body: fromPhone.body }).toEqual({
      status: 200,
      body: ON_IT,
    });
    expect(w.recordOf(journeyId)).toEqual(before);
  });

  test('LOST-06-AC3: the alert’s ID in upper case names the same alert: 200, acknowledged by R1', async () => {
    const w = world();
    const { alertId, responders } = await lost(w, 2);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice];
    expect(alertId).toMatch(LOWER_UUID);
    expect(alertId.toUpperCase()).not.toBe(alertId);

    const answer = await w.acknowledge(r1, alertId.toUpperCase());

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: ON_IT });
    expect(acknowledgementOf(w, alertId).acknowledgedBy).toBe(r1.userId);
  });
});

// ---------------------------------------------------------------------------
// LOST-06-AC4: one responder is on it, and every repeat is safe.
// ---------------------------------------------------------------------------

describe('LOST-06 and SM-08: one responder is on it, and every repeat is safe without an event ID', () => {
  test('LOST-06-AC4: R1 sends it again, its first answer lost, after the clock has moved on: 200 ACKNOWLEDGED, and nothing changes: acknowledged_at keeps its first time, and no message is added', async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, 3);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    const firstAt = await w.clock.now();
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    const before = w.recordOf(journeyId);
    w.clock.advance(3 * MINUTE);

    const again = await w.acknowledge(r1, alertId);

    expect({ status: again.status, body: again.body }).toEqual({ status: 200, body: ON_IT });
    expect(w.recordOf(journeyId)).toEqual(before);
    expect(acknowledgementOf(w, alertId)).toEqual({
      acknowledgedBy: r1.userId,
      acknowledgedAt: firstAt,
    });
    expect(ofKind(w.messagesOf(journeyId), 'ACKNOWLEDGED')).toHaveLength(2);
    expect(w.log.events).toEqual([]);
  });

  test('LOST-06-AC4: R2 sends it after R1: 409 ALREADY_ACKNOWLEDGED, the fixed body with no data, saying nothing of who is on it; nothing changes, and no line is written', async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, 3);
    const [r1, r2] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    const before = w.recordOf(journeyId);

    const taken = await w.acknowledge(r2, alertId);

    expect(taken.status).toBe(409);
    expect(codeOf(taken)).toBe('ALREADY_ACKNOWLEDGED');
    expect(taken.body).not.toHaveProperty('data');
    expect(markersIn(taken.text, [r1.userId, alertId])).toEqual([]);
    // The same body every time, for whoever asks.
    expect((await w.acknowledge(responders[2] ?? r2, alertId)).text).toBe(taken.text);
    expect(w.recordOf(journeyId)).toEqual(before);
    expect(w.log.events).toEqual([]);
  });

  test('LOST-06-AC4: once R1 is on it, R1’s repeat (ALREADY_YOURS, 200) and R2’s (ALREADY_ACKNOWLEDGED, 409) are each decided by the plain read alone: the store is asked alertForAcknowledgement once and never recordAcknowledgement', async () => {
    const w = world();
    const { alertId, responders } = await lost(w, 3);
    const [r1, r2] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];

    const first = await withStoreCalls(w, () => w.acknowledge(r1, alertId));
    // Control: the acknowledgement the read allows goes on to the store's write.
    expect(first.answer.status).toBe(200);
    expect(first.calls).toEqual(['alertForAcknowledgement', 'recordAcknowledgement']);

    const repeat = await withStoreCalls(w, () => w.acknowledge(r1, alertId));
    const taken = await withStoreCalls(w, () => w.acknowledge(r2, alertId));

    expect({ status: repeat.answer.status, body: repeat.answer.body }).toEqual({
      status: 200,
      body: ON_IT,
    });
    expect(repeat.calls).toEqual(['alertForAcknowledgement']);
    expect({ status: taken.answer.status, code: codeOf(taken.answer) }).toEqual({
      status: 409,
      code: 'ALREADY_ACKNOWLEDGED',
    });
    expect(taken.calls).toEqual(['alertForAcknowledgement']);
  });
});

// ---------------------------------------------------------------------------
// LOST-06-AC5: a resolved alert cannot be acknowledged, and an acknowledgement
// never reaches another alert.
// ---------------------------------------------------------------------------

describe('LOST-06, SM-07, SM-04 and LOST-03: a resolved alert cannot be acknowledged, and an acknowledgement never reaches another alert', () => {
  test.each(['a fresh heartbeat', '"I’m home"'] as const)(
    'LOST-06-AC5: after J’s alert is resolved by %s, R1’s "I’m on it" is 409 ALERT_RESOLVED; the alert, its resolution and its messages are exactly as they were, and one acknowledgement_ignored line names the alert and ALERT_RESOLVED, and nothing else',
    async (how) => {
      const w = world();
      const { walker, journeyId, alertId, responders } = await lost(w, 2);
      const [r1] = responders as [RegisteredDevice, RegisteredDevice];
      if (how === 'a fresh heartbeat') {
        await w.heartbeat(walker, journeyId);
      } else {
        const ended = await w.home(walker, journeyId);
        expect({ status: ended.status, body: ended.body }).toEqual({ status: 200, body: ENDED });
      }
      const before = w.recordOf(journeyId);
      const lines = w.log.events.length;

      const answer = await w.acknowledge(r1, alertId);

      expect(answer.status).toBe(409);
      expect(codeOf(answer)).toBe('ALERT_RESOLVED');
      expect(answer.body).not.toHaveProperty('data');
      expect(w.recordOf(journeyId)).toEqual(before);
      expect(w.log.events.slice(lines)).toEqual([
        { event: 'acknowledgement_ignored', reason: 'ALERT_RESOLVED', alertId },
      ]);
    },
  );

  test.each(['a fresh heartbeat', '"I’m home"'] as const)(
    'LOST-06-AC5: after J’s alert is resolved by %s, R1’s ALERT_RESOLVED is decided by the plain read alone: the store is asked alertForAcknowledgement once and never recordAcknowledgement, so a late tap never reaches J’s row; its one acknowledgement_ignored line is still written',
    async (how) => {
      const w = world();
      const { walker, journeyId, alertId, responders } = await lost(w, 2);
      const [r1] = responders as [RegisteredDevice, RegisteredDevice];
      if (how === 'a fresh heartbeat') {
        await w.heartbeat(walker, journeyId);
      } else {
        expect((await w.home(walker, journeyId)).status).toBe(200);
      }

      const { answer, calls } = await withStoreCalls(w, () => w.acknowledge(r1, alertId));

      expect({ status: answer.status, code: codeOf(answer) }).toEqual({
        status: 409,
        code: 'ALERT_RESOLVED',
      });
      expect(calls).toEqual(['alertForAcknowledgement']);
      expect(w.acknowledgementLines()).toEqual([
        { event: 'acknowledgement_ignored', reason: 'ALERT_RESOLVED', alertId },
      ]);
    },
  );

  test('LOST-06-AC5: R1 acknowledged A before it resolved; R1’s repeat after the resolution is 409 ALERT_RESOLVED with one acknowledgement_ignored line, and A keeps R1 as its acknowledger', async () => {
    const w = world();
    const { walker, journeyId, alertId, responders } = await lost(w, 2);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice];
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    const acknowledged = acknowledgementOf(w, alertId);
    await w.heartbeat(walker, journeyId);
    const before = w.recordOf(journeyId);

    const again = await w.acknowledge(r1, alertId);

    expect(again.status).toBe(409);
    expect(codeOf(again)).toBe('ALERT_RESOLVED');
    expect(w.recordOf(journeyId)).toEqual(before);
    expect(acknowledgementOf(w, alertId)).toEqual(acknowledged);
    expect(w.acknowledgementLines()).toEqual([
      { event: 'acknowledgement_ignored', reason: 'ALERT_RESOLVED', alertId },
    ]);
  });

  test('LOST-06-AC5: J back in contact, silent again, and its second alert A2 OPEN: R1’s late "I’m on it" for A is 409 ALERT_RESOLVED, and A2 stays OPEN, with nobody recorded and no ACKNOWLEDGED message', async () => {
    const w = world();
    const { walker, journeyId, alertId, responders } = await lost(w, 2);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice];
    await w.heartbeat(walker, journeyId);
    const backAt = await w.clock.now();
    await w.runUntil(new Date(backAt.getTime() + FIVE_MINUTES));
    const second = w.alertsOf(journeyId).find(({ id }) => id !== alertId);
    expect(second?.state).toBe('OPEN');

    const late = await w.acknowledge(r1, alertId);

    expect(late.status).toBe(409);
    expect(codeOf(late)).toBe('ALERT_RESOLVED');
    const a2 = w.alertsOf(journeyId).find(({ id }) => id === second?.id);
    expect(a2).toMatchObject({ state: 'OPEN', acknowledgedBy: null, acknowledgedAt: null });
    expect(ofKind(w.messagesOf(journeyId), 'ACKNOWLEDGED')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LOST-06-AC6: acknowledgements that race.
// ---------------------------------------------------------------------------

describe('LOST-06, SM-08 and SM-09: acknowledgements that come together leave one acknowledger and one set of notices', () => {
  test(`LOST-06-AC6: ${String(RACERS)} different responders acknowledge one after another: the first is 200 and every other 409 ALREADY_ACKNOWLEDGED, none a 500; acknowledged by the first; one ACKNOWLEDGED message per other responder`, async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, RACERS);
    const [first] = responders;

    const answers: Answer[] = [];
    for (const responder of responders) {
      answers.push(await w.acknowledge(responder, alertId));
      w.clock.advance(SECOND);
    }

    expect(answers.map(({ status }) => status)).toEqual([
      200,
      ...Array.from({ length: RACERS - 1 }, () => 409),
    ]);
    expect(answers.slice(1).map(codeOf)).toEqual(
      Array.from({ length: RACERS - 1 }, () => 'ALREADY_ACKNOWLEDGED'),
    );
    expect(acknowledgementOf(w, alertId).acknowledgedBy).toBe(first?.userId);
    expect(recipientsOf(ofKind(w.messagesOf(journeyId), 'ACKNOWLEDGED'))).toEqual(
      responders
        .slice(1)
        .map(({ userId }) => userId)
        .sort(),
    );
  });

  test(`LOST-06-AC6: ${String(RACERS)} copies of R1’s acknowledgement at once: every one 200 ACKNOWLEDGED; the alert acknowledged once, by R1, with one set of messages`, async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, 3);
    const [r1, r2, r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];

    const answers = await Promise.all(
      Array.from({ length: RACERS }, () => w.acknowledge(r1, alertId)),
    );

    expect(answers.map(({ status, body }) => ({ status, body }))).toEqual(
      answers.map(() => ({ status: 200, body: ON_IT })),
    );
    expect(acknowledgementOf(w, alertId).acknowledgedBy).toBe(r1.userId);
    expect(recipientsOf(ofKind(w.messagesOf(journeyId), 'ACKNOWLEDGED'))).toEqual(
      [r2.userId, r3.userId].sort(),
    );
  });

  test('LOST-06-AC6: when every read finds nobody on it, the store decides again under J’s row: R1, R2 and a copy of each, all past their reads while another session holds J’s row, each reach recordAcknowledgement; once it is released, the winner’s two are 200 and the other’s two 409 ALREADY_ACKNOWLEDGED, as the store decided; one acknowledger, one set of notices, and no line', async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, 3);
    const [r1, r2] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    const senders = [r1, r2, r1, r2];
    w.store.hold(journeyId);
    const from = w.store.calls.length;
    const asked = (call: string) => w.store.calls.slice(from).filter((made) => made === call);

    const answering = Promise.all(senders.map((device) => w.acknowledge(device, alertId)));
    await until(
      () => asked('recordAcknowledgement').length === senders.length,
      'every acknowledgement past its read, waiting for J’s row',
    );
    // Every read found the alert OPEN with nobody on it, so the read refused none.
    expect(asked('alertForAcknowledgement')).toHaveLength(senders.length);
    expect(acknowledgementOf(w, alertId).acknowledgedBy).toBeNull();
    w.store.release(journeyId);
    const answers = await answering;

    const winner = acknowledgementOf(w, alertId).acknowledgedBy;
    expect([r1.userId, r2.userId]).toContain(winner);
    expect(answers.map(({ status }) => status)).toEqual(
      senders.map(({ userId }) => (userId === winner ? 200 : 409)),
    );
    expect(answers.map((answer) => (answer.status === 200 ? answer.body : codeOf(answer)))).toEqual(
      senders.map(({ userId }) => (userId === winner ? ON_IT : 'ALREADY_ACKNOWLEDGED')),
    );
    expect(recipientsOf(ofKind(w.messagesOf(journeyId), 'ACKNOWLEDGED'))).toEqual(
      responders
        .map(({ userId }) => userId)
        .filter((userId) => userId !== winner)
        .sort(),
    );
    expect(w.log.events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LOST-06-AC7 and AC8: the notices when the alert resolves.
// ---------------------------------------------------------------------------

describe('LOST-06, LOST-03 and SM-04: when an acknowledged alert resolves, its unsent notices are withdrawn and every responder is stood down (D-111, D-113)', () => {
  test.each([
    { how: 'a fresh heartbeat', fate: 'failed NO_TARGET and due again in 10 s' },
    { how: 'a fresh heartbeat', fate: 'never claimed' },
    { how: '"I’m home"', fate: 'failed NO_TARGET and due again in 10 s' },
    { how: '"I’m home"', fate: 'never claimed' },
  ] as const)(
    'LOST-06-AC7: R1 acknowledged A; R2’s ACKNOWLEDGED accepted, R3’s $fate; when $how resolves A, it keeps R1 and the time; R3’s notice is withdrawn at the store’s now, keeps its attempts and last failure, and is never handed to the port again; R2’s is as it was; every responder, R1 included, gets exactly one stand-down, and none is handed an ACKNOWLEDGED after it',
    async ({ how, fate }) => {
      const w = world();
      const { walker, journeyId, alertId, responders } = await lost(w, 3);
      const [r1, r2, r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
      // Every lost-contact push accepted.
      await w.sender.deliverDue();
      expect((await w.acknowledge(r1, alertId)).status).toBe(200);
      const acknowledged = acknowledgementOf(w, alertId);
      if (fate === 'never claimed') {
        // A claim of one: the batch was full when R3's notice was due.
        await senderOf(w, 1).deliverDue();
      } else {
        w.push.failFor(r3.userId, 'NO_TARGET');
        await w.sender.deliverDue();
      }
      const noticeOf = (recipientId: string) =>
        ofKind(w.messagesOf(journeyId), 'ACKNOWLEDGED').find(
          (message) => message.recipientId === recipientId,
        );
      expect(noticeOf(r2.userId)?.sentAt, 'R2’s accepted').not.toBeNull();
      expect(noticeOf(r3.userId), `R3’s ${fate}`).toMatchObject(
        fate === 'never claimed'
          ? { sentAt: null, attempts: 0, lastFailure: null }
          : { sentAt: null, attempts: 1, lastFailure: 'NO_TARGET' },
      );
      const r2sBefore = noticeOf(r2.userId);
      const r3sBefore = noticeOf(r3.userId);
      w.clock.advance(2 * SECOND);
      const resolvedAt = await w.clock.now();

      if (how === 'a fresh heartbeat') {
        await w.heartbeat(walker, journeyId);
      } else {
        expect((await w.home(walker, journeyId)).status).toBe(200);
      }

      const kind = how === 'a fresh heartbeat' ? 'BACK_IN_CONTACT' : 'HOME';
      expect(
        w
          .alertsOf(journeyId)
          .map(({ state, resolution, resolvedAt: at }) => [state, resolution, at]),
      ).toEqual([['RESOLVED', kind, resolvedAt]]);
      expect(acknowledgementOf(w, alertId)).toEqual(acknowledged);
      expect(noticeOf(r3.userId)).toEqual({ ...r3sBefore, withdrawnAt: resolvedAt });
      expect(noticeOf(r2.userId)).toEqual(r2sBefore);

      w.push.recover();
      await w.deliverUntil(new Date(resolvedAt.getTime() + 10 * MINUTE));

      expect(
        ofKind(w.push.messages, 'ACKNOWLEDGED').filter(
          ({ recipientId }) => recipientId === r3.userId,
        ),
        'R3’s notice, never handed over again',
      ).toHaveLength(fate === 'never claimed' ? 0 : 1);
      expect(recipientsOf(ofKind(w.messagesOf(journeyId), kind))).toEqual(
        [r1.userId, r2.userId, r3.userId].sort(),
      );
      expect(recipientsOf(ofKind(w.push.accepted, kind))).toEqual(
        [r1.userId, r2.userId, r3.userId].sort(),
      );
      for (const { userId } of responders) {
        const lastNotice = w.push.messages.findLastIndex(
          (message) => message.recipientId === userId && message.kind === 'ACKNOWLEDGED',
        );
        const standDown = w.push.messages.findIndex(
          (message) => message.recipientId === userId && message.kind === kind,
        );
        expect(standDown, userId).toBeGreaterThan(lastNotice);
      }
    },
  );

  test.each(['a fresh heartbeat', '"I’m home"'] as const)(
    'LOST-06-AC8: R1 acknowledged A, and R2’s phone has no push target: R2’s lost-contact push and R2’s notice both failed NO_TARGET and are due again; %s is answered 200, not 500: A RESOLVED, both of R2’s messages withdrawn, and R1, R2 and R3 each get exactly one stand-down',
    async (how) => {
      const w = world();
      const { walker, journeyId, alertId, responders } = await lost(w, 3);
      const [r1, r2, r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
      w.push.failFor(r2.userId, 'NO_TARGET');
      await w.sender.deliverDue();
      expect((await w.acknowledge(r1, alertId)).status).toBe(200);
      await w.sender.deliverDue();
      const r2s = () =>
        w
          .messagesOf(journeyId)
          .filter(
            ({ recipientId, kind }) =>
              recipientId === r2.userId && (kind === 'LOST_CONTACT' || kind === 'ACKNOWLEDGED'),
          );
      expect(r2s().map(({ kind, sentAt, lastFailure }) => [kind, sentAt, lastFailure])).toEqual([
        ['LOST_CONTACT', null, 'NO_TARGET'],
        ['ACKNOWLEDGED', null, 'NO_TARGET'],
      ]);
      w.clock.advance(2 * SECOND);
      const resolvedAt = await w.clock.now();

      const answer =
        how === 'a fresh heartbeat'
          ? await w.heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }))
          : await w.home(walker, journeyId);

      expect({ status: answer.status, body: answer.body }).toEqual({
        status: 200,
        body: how === 'a fresh heartbeat' ? RECORDED : ENDED,
      });
      expect(w.stateOf(journeyId)).toBe(how === 'a fresh heartbeat' ? 'ACTIVE' : 'ENDED');
      expect(w.alertsOf(journeyId).map(({ state }) => state)).toEqual(['RESOLVED']);
      expect(r2s().map(({ withdrawnAt }) => withdrawnAt)).toEqual([resolvedAt, resolvedAt]);
      const kind = how === 'a fresh heartbeat' ? 'BACK_IN_CONTACT' : 'HOME';
      expect(recipientsOf(ofKind(w.messagesOf(journeyId), kind))).toEqual(
        [r1.userId, r2.userId, r3.userId].sort(),
      );
      w.push.recover();
      await w.deliverUntil(new Date(resolvedAt.getTime() + 2 * MINUTE));
      expect(recipientsOf(ofKind(w.push.accepted, kind))).toEqual(
        [r1.userId, r2.userId, r3.userId].sort(),
      );
    },
  );

  test('LOST-06-AC8: R2’s lost-contact push and R2’s notice each in the port’s hands, unanswered, when contact comes back: R2’s stand-down is due at the later of their two lease ends and is not handed to the port before it; R1 and R3, whose messages were sent, get theirs at the first delivery; no hold is longer than 60 s', async () => {
    const w = world();
    const { walker, journeyId, alertId, responders } = await lost(w, 3);
    const [r1, r2, r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
    const handedTo = (recipientId: string, kind: string) =>
      w.push.messages.filter(
        (message) => message.recipientId === recipientId && message.kind === kind,
      ).length;
    // 0 s: R1's and R3's lost-contact pushes accepted; R2's refused, due again at 10 s.
    w.push.failFor(r2.userId, 'NO_TARGET');
    await w.sender.deliverDue();
    // 5 s: R1 is on it; R3's notice accepted, R2's refused, due again at 15 s.
    w.clock.advance(5 * SECOND);
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    await w.sender.deliverDue();
    // 10 s: R2's lost-contact push claimed, leased to 40 s, and held by the port.
    w.clock.advance(5 * SECOND);
    w.push.recover();
    w.push.holdAnswers();
    const lostContact = w.sender.deliverDue();
    await until(() => handedTo(r2.userId, 'LOST_CONTACT') === 2, 'R2’s retry reaching the port');
    // 15 s: R2's notice claimed, leased to 45 s, and held by the port.
    w.clock.advance(5 * SECOND);
    const noticeClaimedAt = await w.clock.now();
    const notice = w.sender.deliverDue();
    await until(() => handedTo(r2.userId, 'ACKNOWLEDGED') === 2, 'R2’s notice reaching the port');
    const laterLeaseEnd = new Date(noticeClaimedAt.getTime() + LEASE);
    // 16 s: back in contact, both of R2's still in the port's hands.
    w.clock.advance(SECOND);
    const backAt = await w.clock.now();
    await w.heartbeat(walker, journeyId);

    const standDownOf = (recipientId: string) =>
      ofKind(w.messagesOf(journeyId), 'BACK_IN_CONTACT').find(
        (message) => message.recipientId === recipientId,
      );
    expect(standDownOf(r2.userId)?.nextAttemptAt).toEqual(laterLeaseEnd);
    expect(standDownOf(r1.userId)?.nextAttemptAt).toEqual(backAt);
    expect(standDownOf(r3.userId)?.nextAttemptAt).toEqual(backAt);
    expect(laterLeaseEnd.getTime() - backAt.getTime()).toBeLessThanOrEqual(LONGEST_HOLD);

    // The port answers meanwhile, accepting both.
    w.push.releaseAnswers();
    await Promise.all([lostContact, notice]);
    await w.sender.deliverDue();
    expect(recipientsOf(ofKind(w.push.messages, 'BACK_IN_CONTACT'))).toEqual(
      [r1.userId, r3.userId].sort(),
    );
    await w.deliverUntil(new Date(laterLeaseEnd.getTime() - 1));
    expect(recipientsOf(ofKind(w.push.messages, 'BACK_IN_CONTACT'))).toEqual(
      [r1.userId, r3.userId].sort(),
    );
    w.clock.advance(1);
    await w.sender.deliverDue();
    expect(recipientsOf(ofKind(w.push.messages, 'BACK_IN_CONTACT'))).toEqual(
      [r1.userId, r2.userId, r3.userId].sort(),
    );
    const standDownAt = w.push.messages.findIndex(
      (message) => message.recipientId === r2.userId && message.kind === 'BACK_IN_CONTACT',
    );
    for (const kind of ['LOST_CONTACT', 'ACKNOWLEDGED']) {
      expect(
        w.push.messages.findLastIndex(
          (message) => message.recipientId === r2.userId && message.kind === kind,
        ),
        kind,
      ).toBeLessThan(standDownAt);
    }
  });
});

// ---------------------------------------------------------------------------
// LOST-06-AC9 and AC10: the record, and content-free messages.
// ---------------------------------------------------------------------------

describe('LOST-06 and SM-09: the record escalation to SMS will read, on the store’s clock', () => {
  test('LOST-06-AC9: acknowledged one minute after the alert opened, on the fake clock, acknowledged_at minus opened_at is exactly 60 s: the escalation story’s "acknowledgement at 1 minute", readable from the record', async () => {
    const w = world();
    const { journeyId, alertId, responders } = await lost(w, 2);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice];
    w.clock.advance(MINUTE);

    expect((await w.acknowledge(r1, alertId)).status).toBe(200);

    const [alert] = w.alertsOf(journeyId);
    expect(alert?.acknowledgedBy).toBe(r1.userId);
    expect(
      (alert?.acknowledgedAt?.getTime() ?? Number.NaN) - (alert?.openedAt.getTime() ?? 0),
    ).toBe(MINUTE);
  });
});

describe('LOST-06: every message stays content-free, the notice included (D-086, D-087)', () => {
  test('LOST-06-AC10: every message the push port receives — the lost-contact alerts, the notices and both kinds of stand-down — has exactly messageId, recipientId and kind, its kind one of MESSAGE_KINDS; every messageId a UUID of its own, equal to no user’s, walker’s, journey’s, alert’s or device’s ID, the acknowledger’s and the alert’s included', async () => {
    const w = world();
    const back = await lost(w, 2);
    const home = await lost(w, 2);
    await w.sender.deliverDue();
    for (const journey of [back, home]) {
      expect((await w.acknowledge(journey.responders[0] ?? null, journey.alertId)).status).toBe(
        200,
      );
    }
    await w.sender.deliverDue();

    await w.heartbeat(back.walker, back.journeyId);
    expect((await w.home(home.walker, home.journeyId)).status).toBe(200);
    await w.deliverUntil(new Date(START.getTime() + 2 * MINUTE));

    const sent = w.push.messages;
    expect([...new Set(sent.map(({ kind }) => kind))].sort()).toEqual(
      ['ACKNOWLEDGED', 'BACK_IN_CONTACT', 'HOME', 'LOST_CONTACT'].sort(),
    );
    expect(sent).toHaveLength(4 + 2 + 4);
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
      ...journey.responders.flatMap(({ userId, deviceId }) => [userId, deviceId]),
    ]);
    expect(messageIds.filter((id) => everyOtherId.includes(id))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LOST-06-AC11 and AC12: all or nothing, and meeting on the row.
// ---------------------------------------------------------------------------

describe('LOST-06 and AR-05: the acknowledgement and its notices are one transaction', () => {
  test.each([
    {
      stage: 'read' as const,
      call: 'alertForAcknowledgement' as const,
      error: databaseError('57P01'),
      code: '57P01',
    },
    {
      stage: 'store' as const,
      call: 'recordAcknowledgement' as const,
      error: databaseError('40001'),
      code: '40001',
    },
    {
      stage: 'store' as const,
      call: 'recordAcknowledgement' as const,
      error: new Error('no SQLSTATE here'),
      code: null,
    },
  ])(
    'LOST-06-AC11: with the store failing $call, "I’m on it" is 500, never a 2xx and never a 401; nothing changes, and one acknowledgement_failed line names the stage, $stage, and the SQLSTATE; once the store answers again, the same request is 200 and does AC1’s work',
    async ({ stage, call, error, code }) => {
      const w = world();
      const { journeyId, alertId, responders } = await lost(w, 3);
      const [r1, r2, r3] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
      const before = w.recordOf(journeyId);
      w.store.failWith(error, call);

      const failed = await w.acknowledge(r1, alertId);

      expect(failed.status).toBe(500);
      expect(failed.text).not.toContain(alertId);
      w.store.recover();
      expect(w.recordOf(journeyId)).toEqual(before);
      expect(w.log.events).toEqual([{ event: 'acknowledgement_failed', stage, code }]);

      const again = await w.acknowledge(r1, alertId);

      expect({ status: again.status, body: again.body }).toEqual({ status: 200, body: ON_IT });
      expect(acknowledgementOf(w, alertId).acknowledgedBy).toBe(r1.userId);
      expect(recipientsOf(ofKind(w.messagesOf(journeyId), 'ACKNOWLEDGED'))).toEqual(
        [r2.userId, r3.userId].sort(),
      );
    },
  );
});

describe('LOST-06, LOST-03, SM-04 and SM-09: "I’m on it" meets back in contact and "I’m home" on the journey’s row', () => {
  test.each(['a fresh heartbeat', '"I’m home"'] as const)(
    'LOST-06-AC12: an acknowledgement holding J’s row as %s arrives: it waits, then resolves A, keeping R1 as its acknowledger; the unsent ACKNOWLEDGED messages withdrawn; one stand-down per responder',
    async (how) => {
      const w = world();
      const { walker, journeyId, alertId, responders } = await lost(w, 3);
      const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
      w.store.hold(journeyId);
      let answered = false;
      const resolving = (
        how === 'a fresh heartbeat'
          ? w.heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }))
          : w.home(walker, journeyId)
      ).then((answer) => {
        answered = true;
        return answer;
      });
      const call = how === 'a fresh heartbeat' ? 'recordHeartbeat' : 'recordHome';
      await until(() => w.store.calls.includes(call), `${how} reaching the store`);
      expect(answered).toBe(false);

      // The acknowledgement's transaction holds the row, does its work, commits.
      await w.store.commitHold(journeyId, async () => {
        expect((await w.acknowledge(r1, alertId)).status).toBe(200);
      });
      const answer = await resolving;

      expect(answer.status).toBe(200);
      const kind = how === 'a fresh heartbeat' ? 'BACK_IN_CONTACT' : 'HOME';
      const [alert] = w.alertsOf(journeyId);
      expect(alert).toMatchObject({
        state: 'RESOLVED',
        resolution: kind,
        acknowledgedBy: r1.userId,
      });
      expect(
        ofKind(w.messagesOf(journeyId), 'ACKNOWLEDGED').map(({ withdrawnAt }) => withdrawnAt),
      ).toEqual([alert?.resolvedAt, alert?.resolvedAt]);
      expect(recipientsOf(ofKind(w.messagesOf(journeyId), kind))).toEqual(
        responders.map(({ userId }) => userId).sort(),
      );
    },
  );

  test.each(['a fresh heartbeat', '"I’m home"'] as const)(
    'LOST-06-AC12: %s holding J’s row as an acknowledgement past its read arrives: the acknowledgement waits, then is 409 ALERT_RESOLVED, writes nothing, and one acknowledgement_ignored line names the alert',
    async (how) => {
      const w = world();
      const { walker, journeyId, alertId, responders } = await lost(w, 3);
      const [r1] = responders as [RegisteredDevice, RegisteredDevice, RegisteredDevice];
      w.store.hold(journeyId);
      let answered = false;
      const acknowledging = w.acknowledge(r1, alertId).then((answer) => {
        answered = true;
        return answer;
      });
      // Past its read, the alert still OPEN there, and waiting for the row.
      await until(
        () => w.store.calls.includes('recordAcknowledgement'),
        'the acknowledgement reaching the store’s write',
      );
      expect(w.store.calls).toContain('alertForAcknowledgement');
      expect(answered).toBe(false);

      await w.store.commitHold(journeyId, async () => {
        const answer =
          how === 'a fresh heartbeat'
            ? await w.heartbeatAnswer(walker, syntheticHeartbeat({ journeyId }))
            : await w.home(walker, journeyId);
        expect(answer.status).toBe(200);
      });
      const answer = await acknowledging;

      expect(answer.status).toBe(409);
      expect(codeOf(answer)).toBe('ALERT_RESOLVED');
      expect(w.alertsOf(journeyId)).toMatchObject([
        { state: 'RESOLVED', acknowledgedBy: null, acknowledgedAt: null },
      ]);
      expect(ofKind(w.messagesOf(journeyId), 'ACKNOWLEDGED')).toEqual([]);
      expect(w.acknowledgementLines()).toEqual([
        { event: 'acknowledgement_ignored', reason: 'ALERT_RESOLVED', alertId },
      ]);
    },
  );
});

// ---------------------------------------------------------------------------
// LOST-06-AC16: nothing personal reaches a log (PRIV-07).
// ---------------------------------------------------------------------------

describe('PRIV-07 and LOST-06: nothing personal reaches a log', () => {
  test('LOST-06-AC16: when the store fails alertForAcknowledgement and recordAcknowledgement with errors whose messages hold a synthetic coordinate, a credential-like string and a responder’s ID, nothing written to stdout, stderr or the console holds any of them; the capture sees the lines the production log wrote, and the errors do hold the markers', async () => {
    // The production log, writing to this process's stdout, where the
    // capture watches: the recording fake would prove only what the module
    // chose, not what reached a stream.
    const w = world({ log: createLog() });
    const { alertId, responders, responderIds } = await lost(w, 2);
    const [r1] = responders as [RegisteredDevice, RegisteredDevice];
    const coordinate = String(syntheticCoordinate());
    const credential = `postgres://synthetic:${syntheticCredential()}@127.0.0.1:1/synthetic`;
    const responderId = responderIds[1] ?? '';
    const markers = [coordinate, credential, responderId, r1.credential];
    const thrown: Error[] = [];
    const failing = (code: string) => {
      const error = databaseError(
        code,
        `failed near (${coordinate}) as ${credential} for ${responderId} with ${r1.credential}`,
      );
      thrown.push(error);
      return error;
    };

    const { written, result } = await captured(async () => {
      w.store.failWith(failing('57P01'), 'alertForAcknowledgement');
      const read = await w.acknowledge(r1, alertId);
      w.store.failWith(failing('40P01'), 'recordAcknowledgement');
      const store = await w.acknowledge(r1, alertId);
      w.store.recover();
      return [read, store];
    });

    // Controls: the errors hold every marker, and the capture saw the lines.
    for (const error of thrown) {
      expect(markersIn(error.message, markers)).toEqual(markers);
    }
    expect(written).toContain('"event":"acknowledgement_failed"');
    expect(result.map(({ status }) => status)).toEqual([500, 500]);

    expect(markersIn(written, markers)).toEqual([]);
    for (const answer of result) {
      expect(markersIn(`${answer.text}\n${answer.headers}`, markers)).toEqual([]);
    }
  });

  test('LOST-06-AC16: a 400 from the "I’m on it" route, for a known responder’s device whose credential is a run-time marker and a body holding a key, writes nothing to stdout, stderr or the console that holds the credential; the capture sees the production log’s lines', async () => {
    const w = world({ log: createLog() });
    const { walker, journeyId, alertId, responders } = await lost(w, 1);
    const [r1] = responders as [RegisteredDevice];
    const markers = [r1.credential];

    const { written, result } = await captured(async () => {
      const refused = [
        await w.acknowledge(r1, alertId, { body: { note: 'synthetic' } }),
        await w.acknowledge(r1, alertId, { body: { alertId } }),
        await w.acknowledge(r1, 'not-a-uuid', { body: { note: 'synthetic' } }),
      ];
      // Control: a line through the production log, in the same capture.
      await w.heartbeat(walker, journeyId);
      const over = await w.acknowledge(r1, alertId);
      return { refused, over };
    });

    expect(result.refused.map(({ status }) => status)).toEqual([400, 400, 400]);
    expect(result.over.status).toBe(409);
    expect(written).toContain('"event":"acknowledgement_ignored"');
    expect(markersIn(written, markers)).toEqual([]);
    for (const answer of [...result.refused, result.over]) {
      expect(markersIn(`${answer.text}\n${answer.headers}`, markers)).toEqual([]);
    }
  });
});
