// L6 system: the lost-contact alert (LOST-02), through the whole server in
// one process.
//
// The real API, the real journey module, the real watchdog and the real
// sender, with fakes only at the edges: the device credentials, the journey
// store, the worker's beats, the push port and the log. One fake clock stands
// in for the database's now(): the store reads it as PostgreSQL's now() would
// be read, and nothing else in the server reads a clock at all (AR-03,
// REL-01). The watchdog and the sender are called here as the worker's loops
// call them, every 10 s (D-107); the loops themselves are worker.test.ts's.
//
// "The most important test in the project" (D-007) is the first one below:
// start a journey, silence the simulated phone, advance time, and assert that
// every responder was alerted. The rest hold what that test rests on:
//   - five minutes, never before, from last contact or from the start (AC1,
//     AC3, AC4), on the database's clock, whatever the phone's says;
//   - once per silence, only for an ACTIVE journey (AC5, SM-03), and once
//     however many sweepers and senders run (AC7);
//   - a held row skipped and alerted once free (AC8); past 5 min 30 s, waited
//     for once, briefly, so a holder that lets go is not stuck and one that
//     never does is reported, not silently skipped (AC20, REL-08);
//   - all or nothing (AC12), and what the alert records (AC13);
//   - each message to the port once, content-free, with its own opaque ID
//     (AC14), never counted as sent unless accepted (AC15), and never lost to
//     a sender that stops mid-send (AC16);
//   - the watchdog feeds the beat, so /v1/health and the minute check-in
//     page the owner when it cannot sweep (AC19, REL-08);
//   - nothing personal reaches stdout, stderr or the console (AC22, PRIV-07).
//
// The times are written out (five minutes, 30 s, 10 s doubling to 60 s), not
// read from the domain's constants, so a wrong constant fails here as well as
// in the domain's own tests.
import {
  apiPath,
  fakeClock,
  fakeDeviceAuthenticator,
  fakeJourneyStore,
  fakeLog,
  fakePush,
  fakeWorkerHeartbeats,
  syntheticBatteryLevel,
  syntheticCoordinate,
  syntheticCredential,
  syntheticHeartbeat,
  syntheticPosition,
  type FakeJourneyState,
  type PushFailureReason,
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
import type { Log, WatchdogStore } from './ports.ts';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** D-021: responders are alerted when the server has heard nothing for five minutes, or more. */
const FIVE_MINUTES = 5 * MINUTE;
/** How often the worker's loops run (D-107). */
const INTERVAL = 10 * SECOND;
/** How long past the five minutes a journey nobody could move is reported (approach item 6). */
const STUCK_AFTER = 30 * SECOND;
/** How long a claimed message is leased (approach item 5). */
const LEASE = 30 * SECOND;
/** How long a sweep's second attempt waits for a held row past 5 min 30 s (approach item 3, step 4). */
const LOCK_WAIT = 5 * SECOND;
/**
 * Overdue, and under STUCK_AFTER_MS (5 min 30 s). Past it, a skipped journey
 * gets a second attempt that waits for its row, and one held through that
 * wait, or whose open failed, is stuck (AC20): another criterion.
 */
const UNDER_STUCK = FIVE_MINUTES + 10 * SECOND;
/** /v1/health's rule: degraded when the beat is older than this (D-065). */
const WORKER_STALE_AFTER = 3 * MINUTE;

/** A synthetic night: 21:00 UTC on 1 October 2026. */
const START = new Date('2026-10-01T21:00:00.000Z');

const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An error as a database or a driver throws one: a message, and a SQLSTATE. */
function databaseError(code: string, message = 'the database could not answer'): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * One server, its fakes, and the people a test needs. The journey module,
 * the watchdog and the sender log to the recording fake, `log`, unless a
 * test hands them another log.
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
  });
  const watchdog = createWatchdog({ journeys: store, beats, log });
  const sender = createPushSender({ outbox: store, push, log });

  const post = (device: RegisteredDevice, route: string, body: unknown) =>
    api.request(apiPath(route), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${device.credential}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

  const self = {
    api,
    clock,
    store,
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
    /** A user with no device here: someone who can follow a journey. */
    user: (): string => store.addUser(),
    /** Starts a journey through the API; resolves to its ID. */
    async start(device: RegisteredDevice, responderIds: readonly string[]): Promise<string> {
      const response = await post(device, 'journeys', { responderIds });
      expect(response.status).toBe(201);
      return ((await response.json()) as { journeyId: string }).journeyId;
    },
    /** A heartbeat from the phone through the API, which must be recorded. */
    async heartbeat(
      device: RegisteredDevice,
      journeyId: string,
      body: SyntheticHeartbeat = syntheticHeartbeat({ journeyId }),
    ): Promise<SyntheticHeartbeat> {
      const response = await post(device, 'heartbeats', body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ outcome: 'RECORDED' });
      return body;
    },
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
    stateOf: (journeyId: string) => store.journeys().find(({ id }) => id === journeyId)?.state,
    alertsOf: (journeyId: string) =>
      store.alerts().filter((alert) => alert.journeyId === journeyId),
    messagesOf(journeyId: string) {
      const alertIds = self.alertsOf(journeyId).map(({ id }) => id);
      return store.outbox().filter(({ alertId }) => alertIds.includes(alertId));
    },
    async health(): Promise<{ status: string; worker: { lastBeatAt: string | null } }> {
      const response = await api.request(apiPath('health'));
      expect(response.status).toBe(200);
      return (await response.json()) as { status: string; worker: { lastBeatAt: string | null } };
    },
  };
  return self;
}

type World = ReturnType<typeof world>;

/** An overdue journey of a new walker with `responders` responders, put in directly. */
function overdue(w: World, responders = 3, silentForMs = FIVE_MINUTES + MINUTE) {
  const walker = w.walker();
  const responderIds = Array.from({ length: responders }, () => w.user());
  const journeyId = w.seed(walker, responderIds, { silentForMs });
  return { walker, responderIds, journeyId };
}

/** Recipients of these messages, sorted. */
const recipientsOf = (messages: readonly { recipientId: string }[]) =>
  messages.map(({ recipientId }) => recipientId).sort();

// ---------------------------------------------------------------------------
// The most important test (D-007).
// ---------------------------------------------------------------------------

describe('LOST-02: every responder is alerted after five minutes of silence', () => {
  test('LOST-02-AC1: the most important test (D-007): a walker starts a journey through the API with three responders, the phone sends a heartbeat every 60 s for 10 minutes and then nothing at all; at exactly 5 minutes after the last heartbeat every responder gets exactly one LOST_CONTACT message and the walker none; one millisecond earlier, nothing', async () => {
    const w = world();
    const walker = w.walker();
    const responders = [w.user(), w.user(), w.user()];
    const bystander = w.user();
    const journeyId = await w.start(walker, responders);
    // Someone else's journey, whose phone keeps talking the whole time: its
    // responder must hear nothing.
    const otherWalker = w.walker();
    const otherResponder = w.user();
    const otherJourneyId = await w.start(otherWalker, [otherResponder]);

    // Ten minutes of heartbeats, one every 60 s, the loops running every 10 s.
    let lastHeartbeatAt = START;
    for (let second = 0; second <= 600; second += 10) {
      if (second % 60 === 0) {
        await w.heartbeat(walker, journeyId);
        await w.heartbeat(otherWalker, otherJourneyId);
        lastHeartbeatAt = await w.clock.now();
      }
      await w.sweepAndDeliver();
      w.clock.advance(INTERVAL);
    }
    expect(w.store.alerts()).toEqual([]);
    expect(w.push.messages).toEqual([]);

    // Then the phone goes silent: no request of any kind. The other one keeps
    // its heartbeats coming.
    const fiveMinutesAfter = new Date(lastHeartbeatAt.getTime() + FIVE_MINUTES);
    for (
      let next = lastHeartbeatAt.getTime() + MINUTE;
      next < fiveMinutesAfter.getTime();
      next += MINUTE
    ) {
      await w.runUntil(new Date(next));
      await w.heartbeat(otherWalker, otherJourneyId);
    }
    await w.runUntil(new Date(fiveMinutesAfter.getTime() - 1));

    // One millisecond before five minutes: a sweep and a delivery change nothing, send nothing.
    expect((await w.clock.now()).getTime()).toBe(fiveMinutesAfter.getTime() - 1);
    expect(w.stateOf(journeyId)).toBe('ACTIVE');
    expect(w.store.alerts()).toEqual([]);
    expect(w.push.messages).toEqual([]);

    // Exactly five minutes after the last heartbeat's receive time.
    w.clock.advance(1);
    await w.sweepAndDeliver();

    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(w.alertsOf(journeyId).map(({ state }) => state)).toEqual(['OPEN']);
    expect(recipientsOf(w.push.accepted)).toEqual([...responders].sort());
    expect(w.push.accepted.map(({ kind }) => kind)).toEqual([
      'LOST_CONTACT',
      'LOST_CONTACT',
      'LOST_CONTACT',
    ]);
    expect(w.push.messages).toEqual(w.push.accepted);
    expect(recipientsOf(w.push.messages)).not.toContain(walker.userId);
    expect(recipientsOf(w.push.messages)).not.toContain(bystander);
    expect(recipientsOf(w.push.messages)).not.toContain(otherResponder);
    expect(w.stateOf(otherJourneyId)).toBe('ACTIVE');
    expect(w.alertsOf(otherJourneyId)).toEqual([]);
    expect(w.log.events).toEqual([]);
  });

  test('LOST-02-AC1: the same with a single responder: exactly one LOST_CONTACT message, to them, at exactly 5 minutes and not a millisecond before', async () => {
    const w = world();
    const walker = w.walker();
    const responder = w.user();
    const journeyId = await w.start(walker, [responder]);
    for (let minute = 0; minute <= 10; minute += 1) {
      await w.heartbeat(walker, journeyId);
      await w.runUntil(new Date((await w.clock.now()).getTime() + MINUTE));
    }
    const lastHeartbeatAt = new Date((await w.clock.now()).getTime() - MINUTE);

    await w.runUntil(new Date(lastHeartbeatAt.getTime() + FIVE_MINUTES - 1));
    expect(w.push.messages).toEqual([]);
    expect(w.stateOf(journeyId)).toBe('ACTIVE');

    await w.runUntil(new Date(lastHeartbeatAt.getTime() + FIVE_MINUTES));

    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(recipientsOf(w.push.accepted)).toEqual([responder]);
    expect(w.push.messages).toHaveLength(1);
    expect(w.alertsOf(journeyId)).toHaveLength(1);
  });
});

describe('LOST-02: five minutes, never before, on the database’s clock', () => {
  test('LOST-02-AC2: with a stub store whose read returns a journey silent 4 min 59.999 s, the watchdog attempts no open and the sweep is ok; a journey silent exactly 5 min is opened', async () => {
    // Defence in depth (approach item 3, step 2): the domain decides again,
    // with the now() and silent_since the read returned, so a read whose SQL
    // drifted toward alerting early alerts nobody early.
    const w = world();
    const early = overdue(w, 1, FIVE_MINUTES - 1);
    const due = overdue(w, 1, FIVE_MINUTES);
    const now = await w.clock.now();
    const drifted: WatchdogStore = {
      overdueJourneys: () =>
        Promise.resolve({
          now,
          journeys: [early, due].map(({ journeyId }) => ({
            id: journeyId,
            state: 'ACTIVE' as const,
            silentSince: new Date(
              START.getTime() - (journeyId === early.journeyId ? FIVE_MINUTES - 1 : FIVE_MINUTES),
            ),
          })),
        }),
      openLostContactAlert: (request) => w.store.openLostContactAlert(request),
    };

    const result = await createWatchdog({ journeys: drifted, beats: w.beats, log: w.log }).sweep();

    expect(result).toEqual({ ok: true, opened: 1, stuck: 0 });
    expect(w.store.openRequests().map(({ journeyId }) => journeyId)).toEqual([due.journeyId]);
    expect(w.stateOf(early.journeyId)).toBe('ACTIVE');
    expect(w.stateOf(due.journeyId)).toBe('LOST_CONTACT');
    expect(w.log.events).toEqual([]);
    expect(await w.beats.lastBeat()).toEqual(now);
  });

  test('LOST-02-AC3: a journey started through the API that never sends a heartbeat: nothing at 4:59.999 after its start; its alert at 5:00, silent since its start', async () => {
    const w = world();
    const walker = w.walker();
    const responder = w.user();
    const journeyId = await w.start(walker, [responder]);
    const startedAt = w.store.journeys().find(({ id }) => id === journeyId)?.startedAt;
    expect(startedAt).toEqual(START);

    await w.runUntil(new Date(START.getTime() + FIVE_MINUTES - 1));
    expect(w.stateOf(journeyId)).toBe('ACTIVE');
    expect(w.store.alerts()).toEqual([]);

    await w.runUntil(new Date(START.getTime() + FIVE_MINUTES));

    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(w.alertsOf(journeyId).map(({ silentSince }) => silentSince)).toEqual([START]);
    expect(recipientsOf(w.push.accepted)).toEqual([responder]);
  });

  test('LOST-02-AC4: phone times hours ahead or behind the server’s change nothing: each journey is alerted exactly five minutes after its last heartbeat was received, and not before', async () => {
    const w = world();
    const ahead = w.walker();
    const behind = w.walker();
    const aheadId = await w.start(ahead, [w.user()]);
    const behindId = await w.start(behind, [w.user()]);
    const now = await w.clock.now();
    // The phone's own time, a label only (REL-01): nine hours either way.
    await w.heartbeat(
      ahead,
      aheadId,
      syntheticHeartbeat({
        journeyId: aheadId,
        position: syntheticPosition({ recordedAt: new Date(now.getTime() + 9 * HOUR) }),
      }),
    );
    await w.heartbeat(
      behind,
      behindId,
      syntheticHeartbeat({
        journeyId: behindId,
        position: syntheticPosition({ recordedAt: new Date(now.getTime() - 9 * HOUR) }),
      }),
    );

    await w.runUntil(new Date(now.getTime() + FIVE_MINUTES - 1));
    expect([w.stateOf(aheadId), w.stateOf(behindId)]).toEqual(['ACTIVE', 'ACTIVE']);

    await w.runUntil(new Date(now.getTime() + FIVE_MINUTES));
    expect([w.stateOf(aheadId), w.stateOf(behindId)]).toEqual(['LOST_CONTACT', 'LOST_CONTACT']);
    expect(w.alertsOf(aheadId).map(({ silentSince }) => silentSince)).toEqual([now]);
    expect(w.alertsOf(behindId).map(({ silentSince }) => silentSince)).toEqual([now]);
  });

  test('LOST-02-AC4: the beat is recorded at exactly the now() the store’s overdue read returned, and the alert is opened at its own transaction’s database time: neither is this process’s clock', async () => {
    const w = world();
    const { journeyId } = overdue(w, 1);
    const read = await w.clock.now();
    // The database's clock moves on between the read and the open.
    w.store.beforeNext('openLostContactAlert', () => {
      w.clock.advance(7 * SECOND);
    });

    const result = await w.watchdog.sweep();

    expect(result).toEqual({ ok: true, opened: 1, stuck: 0 });
    expect(await w.beats.lastBeat()).toEqual(read);
    expect(w.alertsOf(journeyId).map(({ openedAt }) => openedAt)).toEqual([
      new Date(read.getTime() + 7 * SECOND),
    ]);
  });
});

describe('SM-03 and LOST-02: only an ACTIVE journey is alerted, and once per silence', () => {
  test('LOST-02-AC5: swept every 10 s for an hour, with a heartbeat from its phone in between, a journey alerted once keeps its one alert, gets no further message and stays LOST_CONTACT; an ENDED journey silent for an hour never gets an alert', async () => {
    const w = world();
    const walker = w.walker();
    const responders = [w.user(), w.user()];
    const journeyId = await w.start(walker, responders);
    const ended = w.walker();
    const endedId = w.seed(ended, [w.user()], { state: 'ENDED', silentForMs: HOUR });

    await w.runUntil(new Date(START.getTime() + FIVE_MINUTES));
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    const [alert] = w.alertsOf(journeyId);
    expect(recipientsOf(w.push.accepted)).toEqual([...responders].sort());

    await w.runUntil(new Date(START.getTime() + 30 * MINUTE));
    await w.heartbeat(walker, journeyId);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    await w.runUntil(new Date(START.getTime() + HOUR + FIVE_MINUTES));

    expect(w.alertsOf(journeyId)).toEqual([alert]);
    expect(w.push.messages).toHaveLength(2);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(w.stateOf(endedId)).toBe('ENDED');
    expect(w.alertsOf(endedId)).toEqual([]);
  });
});

describe('LOST-02: once, however many sweep (AR-06)', () => {
  test('LOST-02-AC7: swept twice in a row and delivered twice: one alert, one message per responder, and no sweep failed', async () => {
    const w = world();
    const { journeyId, responderIds } = overdue(w, 3);

    const first = await w.sweepAndDeliver();
    const second = await w.sweepAndDeliver();

    expect(first.swept).toEqual({ ok: true, opened: 1, stuck: 0 });
    expect(second.swept).toEqual({ ok: true, opened: 0, stuck: 0 });
    expect(w.alertsOf(journeyId)).toHaveLength(1);
    expect(recipientsOf(w.messagesOf(journeyId))).toEqual([...responderIds].sort());
    expect(recipientsOf(w.push.messages)).toEqual([...responderIds].sort());
  });

  test('LOST-02-AC7: two watchdogs sweeping at once, and two senders delivering at once: one alert, each message pushed once, and neither sweep failed', async () => {
    const w = world();
    // Under 5 min 30 s of silence: past it, a journey a sweep skipped is
    // AC20's stuck journey, which is another criterion.
    const { journeyId, responderIds } = overdue(w, 3, UNDER_STUCK);
    const otherWatchdog = createWatchdog({ journeys: w.store, beats: w.beats, log: w.log });
    const otherSender = createPushSender({ outbox: w.store, push: w.push, log: w.log });

    const swept = await Promise.all([w.watchdog.sweep(), otherWatchdog.sweep()]);
    await Promise.all([w.sender.deliverDue(), otherSender.deliverDue()]);

    expect(swept.map(({ ok }) => ok)).toEqual([true, true]);
    expect(swept.map(({ opened }) => opened).sort()).toEqual([0, 1]);
    expect(w.alertsOf(journeyId)).toHaveLength(1);
    expect(recipientsOf(w.push.messages)).toEqual([...responderIds].sort());
    expect(w.log.events).toEqual([]);
  });
});

describe('LOST-02: a held row is skipped, not waited for, and alerted once it is free', () => {
  test('LOST-02-AC8: with J’s row held elsewhere, a sweep opens K’s alert and leaves J untouched; after the hold ends, the next sweep opens J’s', async () => {
    const w = world();
    // Under 5 min 30 s, as at L3: a held journey past it is AC20's.
    const j = overdue(w, 1, UNDER_STUCK);
    const k = overdue(w, 1, UNDER_STUCK);
    w.store.hold(j.journeyId);

    const held = await w.watchdog.sweep();

    expect(held).toEqual({ ok: true, opened: 1, stuck: 0 });
    expect(w.stateOf(k.journeyId)).toBe('LOST_CONTACT');
    expect(w.stateOf(j.journeyId)).toBe('ACTIVE');
    expect(w.alertsOf(j.journeyId)).toEqual([]);
    expect(w.log.events).toEqual([]);

    w.store.release(j.journeyId);
    const freed = await w.watchdog.sweep();

    expect(freed).toEqual({ ok: true, opened: 1, stuck: 0 });
    expect(w.stateOf(j.journeyId)).toBe('LOST_CONTACT');
    expect(w.alertsOf(j.journeyId)).toHaveLength(1);
  });
});

describe('LOST-02: the move, the alert and its messages, all or nothing (AR-05)', () => {
  test('LOST-02-AC12: one journey whose open fails holds up no other: the next overdue journey in the same sweep is opened, the failed one stays ACTIVE, and the sweep fails with one watchdog_failed line', async () => {
    // Each journey's alert opens in its own transaction (approach item 3.3).
    const w = world();
    const j = overdue(w, 1, UNDER_STUCK);
    const k = overdue(w, 1, UNDER_STUCK);
    w.store.beforeNext('openLostContactAlert', () => {
      w.store.failWith(databaseError('23514'), 'openLostContactAlert');
    });
    w.store.beforeNext('openLostContactAlert', () => {
      w.store.recover();
    });

    const result = await w.watchdog.sweep();

    expect(w.stateOf(j.journeyId)).toBe('ACTIVE');
    expect(w.alertsOf(j.journeyId)).toEqual([]);
    expect(w.stateOf(k.journeyId)).toBe('LOST_CONTACT');
    expect(result).toEqual({ ok: false, opened: 1, stuck: 0 });
    expect(w.log.events).toEqual([{ event: 'watchdog_failed', stage: 'open', code: '23514' }]);
    expect(await w.beats.lastBeat()).toBeNull();
  });

  test('LOST-02-AC12: with the store failing the open, J stays ACTIVE with no alert and no message, one watchdog_failed line names the stage and the SQLSTATE, and no beat is recorded; once it answers again, the next sweep opens J’s alert with every message', async () => {
    const w = world();
    // Under 5 min 30 s: a failed open past it is also reported as stuck (AC20).
    const { journeyId, responderIds } = overdue(w, 3, UNDER_STUCK);
    w.store.failWith(databaseError('40P01'), 'openLostContactAlert');

    const failed = await w.watchdog.sweep();

    expect(failed.ok).toBe(false);
    expect(failed.opened).toBe(0);
    expect(w.stateOf(journeyId)).toBe('ACTIVE');
    expect(w.store.alerts()).toEqual([]);
    expect(w.store.outbox()).toEqual([]);
    expect(w.log.events).toEqual([{ event: 'watchdog_failed', stage: 'open', code: '40P01' }]);
    expect(await w.beats.lastBeat()).toBeNull();

    w.store.recover();
    const next = await w.watchdog.sweep();

    expect(next).toEqual({ ok: true, opened: 1, stuck: 0 });
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(recipientsOf(w.messagesOf(journeyId))).toEqual([...responderIds].sort());
    expect(await w.beats.lastBeat()).toEqual(await w.clock.now());
  });
});

describe('LOST-02: what the alert records', () => {
  test('LOST-02-AC13: the alert is OPEN, opened at the sweep’s database time, silent since the last heartbeat’s receive time; and that heartbeat is the journey’s latest, with its battery level and its position', async () => {
    const w = world();
    const walker = w.walker();
    const journeyId = await w.start(walker, [w.user()]);
    await w.heartbeat(walker, journeyId);
    w.clock.advance(MINUTE);
    const last = await w.heartbeat(
      walker,
      journeyId,
      syntheticHeartbeat({
        journeyId,
        batteryLevel: syntheticBatteryLevel(),
        position: syntheticPosition(),
      }),
    );
    const lastReceivedAt = await w.clock.now();

    await w.runUntil(new Date(lastReceivedAt.getTime() + FIVE_MINUTES));

    const alerts = w.alertsOf(journeyId);
    expect(
      alerts.map(({ state, openedAt, silentSince }) => ({ state, openedAt, silentSince })),
    ).toEqual([
      {
        state: 'OPEN',
        openedAt: new Date(lastReceivedAt.getTime() + FIVE_MINUTES),
        silentSince: lastReceivedAt,
      },
    ]);
    expect(await w.store.latestHeartbeatOf(journeyId)).toEqual({
      receivedAt: lastReceivedAt,
      hasPosition: true,
      batteryLevel: last.batteryLevel,
    });
  });
});

describe('LOST-02: each message reaches the push port once, content-free', () => {
  test('LOST-02-AC14: three messages, one per responder, each with exactly messageId, recipientId and kind; kind LOST_CONTACT; distinct UUIDs, none a user’s, a device’s, the journey’s or the alert’s; each marked sent, and never sent again', async () => {
    const w = world();
    const walker = w.walker();
    const responders = [w.user(), w.user(), w.user()];
    const journeyId = await w.start(walker, responders);

    await w.runUntil(new Date(START.getTime() + FIVE_MINUTES));

    const sent = w.push.accepted;
    expect(sent).toHaveLength(3);
    expect(recipientsOf(sent)).toEqual([...responders].sort());
    for (const message of sent) {
      expect(Object.keys(message).sort()).toEqual(['kind', 'messageId', 'recipientId']);
      expect(message.kind).toBe('LOST_CONTACT');
      expect(message.messageId).toMatch(LOWER_UUID);
    }
    const messageIds = sent.map(({ messageId }) => messageId);
    expect(new Set(messageIds).size).toBe(3);
    const everyOtherId = [
      walker.userId,
      walker.deviceId,
      ...responders,
      journeyId,
      ...w.store.alerts().map(({ id }) => id),
    ];
    expect(messageIds.filter((id) => everyOtherId.includes(id))).toEqual([]);
    expect(w.messagesOf(journeyId).map(({ sentAt }) => sentAt)).toEqual([
      new Date(START.getTime() + FIVE_MINUTES),
      new Date(START.getTime() + FIVE_MINUTES),
      new Date(START.getTime() + FIVE_MINUTES),
    ]);

    await w.runUntil(new Date(START.getTime() + HOUR));

    expect(w.push.messages).toHaveLength(3);
  });

  test('LOST-02-AC14: a delivery answers how many messages the port accepted and how many it did not: three sent and none failed; the next delivery, with nothing due, none of either', async () => {
    const w = world();
    overdue(w, 3);
    await w.watchdog.sweep();

    expect(await w.sender.deliverDue()).toEqual({ sent: 3, failed: 0 });
    expect(await w.sender.deliverDue()).toEqual({ sent: 0, failed: 0 });
  });
});

describe('LOST-02: a message the port did not accept is never counted as sent', () => {
  test('LOST-02-AC15: R2 has no push target: R1’s and R3’s are sent, R2’s stays unsent, and one push_failed line carries the reason and R2’s message ID only', async () => {
    const w = world();
    const { journeyId, responderIds } = overdue(w, 3);
    const [r1 = '', r2 = '', r3 = ''] = responderIds;
    w.push.failFor(r2, 'NO_TARGET');

    await w.sweepAndDeliver();

    expect(recipientsOf(w.push.accepted)).toEqual([r1, r3].sort());
    const byRecipient = new Map(
      w.messagesOf(journeyId).map((message) => [message.recipientId, message]),
    );
    expect(byRecipient.get(r1)?.sentAt).not.toBeNull();
    expect(byRecipient.get(r3)?.sentAt).not.toBeNull();
    expect(byRecipient.get(r2)?.sentAt).toBeNull();
    expect(byRecipient.get(r2)?.lastFailure).toBe('NO_TARGET');
    expect(w.log.events).toEqual([
      { event: 'push_failed', reason: 'NO_TARGET', messageId: byRecipient.get(r2)?.messageId },
    ]);
  });

  test('LOST-02-AC15: a delivery counts R2’s refusal as failed, never as sent: two sent and one failed; refused again when due, none sent and one failed; once the port accepts it, one sent and none failed', async () => {
    const w = world();
    const { responderIds } = overdue(w, 3);
    w.push.failFor(responderIds[1] ?? '', 'NO_TARGET');
    await w.watchdog.sweep();

    expect(await w.sender.deliverDue()).toEqual({ sent: 2, failed: 1 });
    w.clock.advance(10 * SECOND);
    expect(await w.sender.deliverDue()).toEqual({ sent: 0, failed: 1 });
    w.push.recover();
    w.clock.advance(20 * SECOND);
    expect(await w.sender.deliverDue()).toEqual({ sent: 1, failed: 0 });
  });

  test('LOST-02-AC15: R2’s message is due again after 10, 20, 40, 60 and 60 s of database time, never a millisecond sooner, with the same message ID each time; once accepted it is marked sent, and nothing more is sent', async () => {
    const w = world();
    const { responderIds } = overdue(w, 3);
    const r2 = responderIds[1] ?? '';
    w.push.failFor(r2, 'NO_TARGET');
    await w.sweepAndDeliver();
    const toR2 = () => w.push.messages.filter(({ recipientId }) => recipientId === r2);
    const [first] = toR2();
    expect(toR2()).toHaveLength(1);

    for (const [index, delay] of [10, 20, 40, 60, 60].entries()) {
      w.clock.advance(delay * SECOND - 1);
      await w.sender.deliverDue();
      expect(toR2(), `attempt ${String(index + 2)}, a millisecond early`).toHaveLength(index + 1);

      w.clock.advance(1);
      await w.sender.deliverDue();
      expect(toR2(), `attempt ${String(index + 2)}`).toHaveLength(index + 2);
      expect(toR2().at(-1)?.messageId).toBe(first?.messageId);
    }

    w.push.recover();
    w.clock.advance(60 * SECOND);
    await w.sender.deliverDue();
    expect(w.push.accepted.filter(({ recipientId }) => recipientId === r2)).toEqual([first]);
    const attempts = toR2().length;

    for (let minute = 0; minute < 10; minute += 1) {
      w.clock.advance(MINUTE);
      await w.sender.deliverDue();
    }
    expect(toR2()).toHaveLength(attempts);
    expect(w.store.outbox().every(({ sentAt }) => sentAt !== null)).toBe(true);
  });

  const FAILURES: { what: string; fail: (w: World) => void; reason: PushFailureReason }[] = [
    {
      what: 'REFUSED',
      fail: (w) => {
        w.push.failAll('REFUSED');
      },
      reason: 'REFUSED',
    },
    {
      what: 'UNAVAILABLE',
      fail: (w) => {
        w.push.failAll('UNAVAILABLE');
      },
      reason: 'UNAVAILABLE',
    },
    {
      what: 'NOT_CONFIGURED',
      fail: (w) => {
        w.push.failAll('NOT_CONFIGURED');
      },
      reason: 'NOT_CONFIGURED',
    },
    {
      what: 'a thrown error, which counts as UNAVAILABLE',
      fail: (w) => {
        w.push.throwWith(new Error('the provider did not answer'));
      },
      reason: 'UNAVAILABLE',
    },
  ];

  test.each(FAILURES)(
    'LOST-02-AC15: a port that answers $what: nothing is counted as sent, each failed attempt is one push_failed line with the reason and the message ID only, and the message is tried again',
    async ({ fail, reason }) => {
      const w = world();
      const { journeyId } = overdue(w, 2);
      fail(w);

      await w.sweepAndDeliver();

      const messages = w.messagesOf(journeyId);
      expect(messages.map(({ sentAt }) => sentAt)).toEqual([null, null]);
      expect(messages.map(({ lastFailure }) => lastFailure)).toEqual([reason, reason]);
      expect(w.push.accepted).toEqual([]);
      const lines = w.log.events;
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(Object.keys(line).sort()).toEqual(['event', 'messageId', 'reason']);
        expect(line).toMatchObject({ event: 'push_failed', reason });
      }
      expect(lines.map((line) => ('messageId' in line ? line.messageId : '')).sort()).toEqual(
        messages.map(({ messageId }) => messageId).sort(),
      );

      w.push.recover();
      w.clock.advance(10 * SECOND);
      await w.sender.deliverDue();
      expect(w.push.accepted).toHaveLength(2);
    },
  );
});

describe('LOST-02: a sender that stops mid-send loses nothing', () => {
  test('LOST-02-AC16: a message claimed by a sender that never reports back is claimed and sent again once the 30 s lease has passed, with the same message ID, and is then marked sent', async () => {
    const w = world();
    const { journeyId, responderIds } = overdue(w, 2);
    await w.watchdog.sweep();
    // A sender whose push never answers: it claims, sends, and never marks.
    const stuckPush = fakePush();
    stuckPush.holdAnswers();
    const stuckSender = createPushSender({ outbox: w.store, push: stuckPush, log: w.log });
    void stuckSender.deliverDue();
    for (let turn = 0; turn < 20; turn += 1) {
      await Promise.resolve();
    }
    // Its claim took both messages; it sent one or both, one at a time or
    // together, which the spec leaves open, and is waiting on the push.
    const claimed = w.messagesOf(journeyId);
    expect(recipientsOf(claimed)).toEqual([...responderIds].sort());
    expect(claimed.map(({ attempts, sentAt }) => [attempts, sentAt])).toEqual([
      [1, null],
      [1, null],
    ]);
    expect(stuckPush.messages.length).toBeGreaterThan(0);

    w.clock.advance(LEASE - 1);
    await w.sender.deliverDue();
    expect(w.push.messages).toEqual([]);

    w.clock.advance(1);
    await w.sender.deliverDue();

    const sentAgain = w.push.accepted.map(({ messageId }) => messageId);
    expect([...sentAgain].sort()).toEqual(claimed.map(({ messageId }) => messageId).sort());
    for (const { messageId } of stuckPush.messages) {
      expect(sentAgain).toContain(messageId);
    }
    expect(w.messagesOf(journeyId).every(({ sentAt }) => sentAt !== null)).toBe(true);
  });
});

describe('REL-08 and LOST-02: the watchdog feeds the beat', () => {
  test('LOST-02-AC19: a sweep that succeeds records the worker beat at the now() it read', async () => {
    const w = world();
    w.clock.advance(12_345);

    expect(await w.watchdog.sweep()).toEqual({ ok: true, opened: 0, stuck: 0 });

    expect(await w.beats.lastBeat()).toEqual(new Date(START.getTime() + 12_345));
    expect(w.log.events).toEqual([]);
  });

  test('LOST-02-AC19: a sweep whose read fails records no beat, and writes one watchdog_failed line with stage read and the SQLSTATE', async () => {
    const w = world();
    overdue(w, 1);
    w.store.failWith(databaseError('57P01'), 'overdueJourneys');

    const result = await w.watchdog.sweep();

    expect(result.ok).toBe(false);
    expect(await w.beats.lastBeat()).toBeNull();
    expect(w.log.events).toEqual([{ event: 'watchdog_failed', stage: 'read', code: '57P01' }]);
    expect(w.store.alerts()).toEqual([]);
  });

  test('LOST-02-AC19: a beat that cannot be written is one watchdog_failed line with stage beat, and the sweep counts as failed; the alert it opened stays opened', async () => {
    const w = world();
    const { journeyId } = overdue(w, 1);
    w.beats.failWith(databaseError('53300'));

    const result = await w.watchdog.sweep();

    expect(result.ok).toBe(false);
    expect(await w.beats.lastBeat()).toBeNull();
    expect(w.log.events).toEqual([{ event: 'watchdog_failed', stage: 'beat', code: '53300' }]);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
  });

  test('LOST-02-AC19: with every sweep failing after a good one, /v1/health is ok 3 minutes after the last good sweep and degraded a millisecond later, as for a stopped worker', async () => {
    const w = world();
    expect((await w.watchdog.sweep()).ok).toBe(true);
    const lastGood = await w.clock.now();
    expect(await w.health()).toMatchObject({
      status: 'ok',
      worker: { lastBeatAt: lastGood.toISOString() },
    });
    // The database is gone: every store call fails, the sweep's read and the
    // sender's claim alike.
    w.store.failWith(databaseError('08006'));

    await w.runUntil(new Date(lastGood.getTime() + WORKER_STALE_AFTER));
    expect((await w.health()).status).toBe('ok');

    w.clock.advance(1);
    await w.sweepAndDeliver();
    const health = await w.health();

    expect(health.status).toBe('degraded');
    expect(health.worker.lastBeatAt).toBe(lastGood.toISOString());
    expect(w.log.events.length).toBeGreaterThanOrEqual(18);
    expect(new Set(w.log.events.map((event) => JSON.stringify(event)))).toEqual(
      new Set([
        JSON.stringify({ event: 'watchdog_failed', stage: 'read', code: '08006' }),
        JSON.stringify({ event: 'delivery_failed', stage: 'claim', code: '08006' }),
      ]),
    );
  });
});

describe('REL-08 and LOST-02: a journey the watchdog cannot move is reported, and stops the beat', () => {
  test('LOST-02-AC19: a waiting attempt that fails with an error, past 5 min 30 s, makes the journey stuck: the sweep fails, one watchdog_failed line with stage open and its SQLSTATE, one watchdog_overdue line naming the journey, and no beat', async () => {
    const w = world();
    const { journeyId } = overdue(w, 1, FIVE_MINUTES + STUCK_AFTER);
    w.store.hold(journeyId);
    // The first attempt is skipped, as the row is held; the waiting one fails.
    w.store.beforeNext('openLostContactAlert', () => undefined);
    w.store.beforeNext('openLostContactAlert', () => {
      w.store.failWith(databaseError('40P01'), 'openLostContactAlert');
    });

    const result = await w.watchdog.sweep();

    expect(result).toEqual({ ok: false, opened: 0, stuck: 1 });
    expect(w.store.openRequests()).toEqual([
      { journeyId, afterMs: FIVE_MINUTES },
      { journeyId, afterMs: FIVE_MINUTES, lockWaitMs: LOCK_WAIT },
    ]);
    expect(w.log.events).toHaveLength(2);
    expect(w.log.events).toEqual(
      expect.arrayContaining([
        { event: 'watchdog_failed', stage: 'open', code: '40P01' },
        { event: 'watchdog_overdue', journeyId },
      ]),
    );
    expect(await w.beats.lastBeat()).toBeNull();
  });

  test('LOST-02-AC20: J held elsewhere: at 5 min 29.999 s it is skipped, nothing is written and the beat is recorded; from 5 min 30 s each sweep writes one watchdog_overdue line naming J and records no beat; the first sweep after the hold ends opens J’s alert and records the beat again', async () => {
    const w = world();
    const walker = w.walker();
    const responder = w.user();
    const journeyId = w.seed(walker, [responder], { silentForMs: 0 });
    w.store.hold(journeyId);

    w.clock.advance(FIVE_MINUTES + STUCK_AFTER - 1);
    const early = await w.watchdog.sweep();
    const beatAt = await w.clock.now();

    expect(early).toEqual({ ok: true, opened: 0, stuck: 0 });
    expect(w.log.events).toEqual([]);
    expect(await w.beats.lastBeat()).toEqual(beatAt);

    w.clock.advance(1);
    const stuck = await w.watchdog.sweep();
    w.clock.advance(INTERVAL);
    const stillStuck = await w.watchdog.sweep();

    expect(stuck).toEqual({ ok: false, opened: 0, stuck: 1 });
    expect(stillStuck).toEqual({ ok: false, opened: 0, stuck: 1 });
    expect(w.log.events).toEqual([
      { event: 'watchdog_overdue', journeyId },
      { event: 'watchdog_overdue', journeyId },
    ]);
    expect(await w.beats.lastBeat()).toEqual(beatAt);
    expect(w.stateOf(journeyId)).toBe('ACTIVE');

    w.store.release(journeyId);
    w.clock.advance(INTERVAL);
    const freed = await w.watchdog.sweep();

    expect(freed).toEqual({ ok: true, opened: 1, stuck: 0 });
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(await w.beats.lastBeat()).toEqual(await w.clock.now());
    expect(w.log.events).toHaveLength(2);
  });

  test('LOST-02-AC20: under 5 min 30 s a held journey gets no waiting attempt: it is opened once, without a lock wait, skipped, and the sweep is ok', async () => {
    const w = world();
    const { journeyId } = overdue(w, 1, FIVE_MINUTES + STUCK_AFTER - 1);
    w.store.hold(journeyId);

    const result = await w.watchdog.sweep();

    expect(result).toEqual({ ok: true, opened: 0, stuck: 0 });
    expect(w.store.openRequests()).toEqual([{ journeyId, afterMs: FIVE_MINUTES }]);
    expect(w.log.events).toEqual([]);
    expect(await w.beats.lastBeat()).toEqual(await w.clock.now());
  });

  test('LOST-02-AC20: a journey silent 5 min 30 s whose row is held by a transaction that commits within the lock wait without changing it is not stuck: the waiting attempt opens its alert, the sweep is ok and the beat recorded', async () => {
    const w = world();
    const { journeyId, responderIds } = overdue(w, 2, FIVE_MINUTES + STUCK_AFTER);
    w.store.holdUntilWaited(journeyId);

    const result = await w.watchdog.sweep();

    expect(result).toEqual({ ok: true, opened: 1, stuck: 0 });
    expect(w.store.openRequests()).toEqual([
      { journeyId, afterMs: FIVE_MINUTES },
      { journeyId, afterMs: FIVE_MINUTES, lockWaitMs: LOCK_WAIT },
    ]);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(w.alertsOf(journeyId)).toHaveLength(1);
    expect(recipientsOf(w.messagesOf(journeyId))).toEqual([...responderIds].sort());
    expect(w.log.events).toEqual([]);
    expect(await w.beats.lastBeat()).toEqual(await w.clock.now());
  });

  test('LOST-02-AC20: a journey silent 5 min 30 s whose row is held by a transaction that moves it to LOST_CONTACT with its alert and commits within the lock wait, as a concurrent sweeper does, is skipped, not stuck: exactly one alert, the sweep ok, no watchdog_overdue line', async () => {
    const w = world();
    const { journeyId, responderIds } = overdue(w, 2, FIVE_MINUTES + STUCK_AFTER);
    // The holder is another sweeper, which opens the alert and commits.
    const otherSweeper = { opened: false };
    w.store.holdUntilWaited(journeyId, async () => {
      const theirs = await w.store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES });
      otherSweeper.opened = theirs.outcome === 'opened';
    });

    const result = await w.watchdog.sweep();

    expect(otherSweeper.opened).toBe(true);
    expect(result).toEqual({ ok: true, opened: 0, stuck: 0 });
    expect(w.store.openRequests().filter((request) => request.lockWaitMs !== undefined)).toEqual([
      { journeyId, afterMs: FIVE_MINUTES, lockWaitMs: LOCK_WAIT },
    ]);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(w.alertsOf(journeyId)).toHaveLength(1);
    expect(recipientsOf(w.messagesOf(journeyId))).toEqual([...responderIds].sort());
    expect(w.log.events).toEqual([]);
    expect(await w.beats.lastBeat()).toEqual(await w.clock.now());
  });

  test('LOST-02-AC20: a journey silent 5 min 30 s held by a session that never lets go is stuck after the lock wait: its one waiting attempt asks for the 5 s limit, after every other journey’s first attempt; another overdue journey in the same sweep is opened, one watchdog_overdue line names it, and no beat is recorded', async () => {
    const w = world();
    const beforeAt = await w.clock.now();
    expect((await w.watchdog.sweep()).ok).toBe(true);
    const j = overdue(w, 1, FIVE_MINUTES + STUCK_AFTER);
    const k = overdue(w, 1, UNDER_STUCK);
    w.store.hold(j.journeyId);

    const result = await w.watchdog.sweep();

    expect(result).toEqual({ ok: false, opened: 1, stuck: 1 });
    expect(w.stateOf(k.journeyId)).toBe('LOST_CONTACT');
    expect(w.stateOf(j.journeyId)).toBe('ACTIVE');
    expect(w.alertsOf(j.journeyId)).toEqual([]);
    expect(w.log.events).toEqual([{ event: 'watchdog_overdue', journeyId: j.journeyId }]);
    expect(await w.beats.lastBeat()).toEqual(beforeAt);
    const requests = w.store.openRequests();
    expect(requests.filter((request) => request.lockWaitMs !== undefined)).toEqual([
      { journeyId: j.journeyId, afterMs: FIVE_MINUTES, lockWaitMs: LOCK_WAIT },
    ]);
    expect(requests.at(-1)).toEqual({
      journeyId: j.journeyId,
      afterMs: FIVE_MINUTES,
      lockWaitMs: LOCK_WAIT,
    });
    expect(requests.map(({ journeyId }) => journeyId).sort()).toEqual(
      [j.journeyId, j.journeyId, k.journeyId].sort(),
    );
  });

  test('LOST-02-AC20: a journey whose open fails from 5 min 30 s on is reported too: one watchdog_failed line with stage open, and one watchdog_overdue naming it, per sweep, and no beat', async () => {
    const w = world();
    const { journeyId } = overdue(w, 1, FIVE_MINUTES + STUCK_AFTER);
    w.store.failWith(databaseError('40001'), 'openLostContactAlert');

    const result = await w.watchdog.sweep();

    expect(result).toEqual({ ok: false, opened: 0, stuck: 1 });
    expect(w.log.events).toHaveLength(2);
    expect(w.log.events).toEqual(
      expect.arrayContaining([
        { event: 'watchdog_failed', stage: 'open', code: '40001' },
        { event: 'watchdog_overdue', journeyId },
      ]),
    );
    expect(await w.beats.lastBeat()).toBeNull();
  });
});

describe('PRIV-07 and LOST-02: nothing personal reaches a log', () => {
  test.each([
    { mark: 'markSent' as const, answer: 'accepted' },
    { mark: 'markFailed' as const, answer: 'refused' },
  ])(
    'LOST-02-AC22: a mark that fails after the port $answer the message is one delivery_failed line with stage mark and the SQLSTATE, and no other field; the message is not counted as sent',
    async ({ mark }) => {
      const w = world();
      const { journeyId, responderIds } = overdue(w, 1);
      await w.watchdog.sweep();
      if (mark === 'markFailed') {
        w.push.failFor(responderIds[0] ?? '', 'REFUSED');
      }
      w.store.failWith(databaseError('40001'), mark);

      await w.sender.deliverDue();

      const [message] = w.messagesOf(journeyId);
      const failedMark = { event: 'delivery_failed', stage: 'mark', code: '40001' };
      expect(w.log.events).toEqual(
        mark === 'markSent'
          ? [failedMark]
          : expect.arrayContaining([
              { event: 'push_failed', reason: 'REFUSED', messageId: message?.messageId },
              failedMark,
            ]),
      );
      expect(w.log.events).toHaveLength(mark === 'markSent' ? 1 : 2);
      expect(message?.sentAt).toBeNull();
    },
  );

  test('LOST-02-AC22: when the store and the push fail with errors whose messages hold a synthetic coordinate, a credential-like string and a responder’s ID, nothing written to stdout, stderr or the console holds any of them; the capture sees the lines the production log wrote, and the errors do hold the markers', async () => {
    // The production log, writing to this process's stdout, where the
    // capture watches; the recording fake would prove only what the modules
    // chose, not what reached a stream.
    const w = world({ log: createLog() });
    const first = overdue(w, 2);
    const coordinate = String(syntheticCoordinate());
    const credential = `postgres://synthetic:${syntheticCredential()}@127.0.0.1:1/synthetic`;
    const responderId = first.responderIds[0] ?? '';
    const markers = [coordinate, credential, responderId];
    const failure = (code: string) =>
      databaseError(code, `failed near (${coordinate}) as ${credential} for ${responderId}`);
    const thrown: Error[] = [];
    const failing = (code: string) => {
      const error = failure(code);
      thrown.push(error);
      return error;
    };

    const { written } = await captured(async () => {
      // The open succeeds; then the push throws.
      w.push.throwWith(failing('XX000'));
      await w.sweepAndDeliver();
      w.push.recover();
      // The claim fails.
      w.store.failWith(failing('08006'), 'claimDue');
      w.clock.advance(MINUTE);
      await w.sender.deliverDue();
      // Marking fails.
      w.store.recover();
      w.store.failWith(failing('08003'), 'markSent');
      await w.sender.deliverDue();
      w.store.recover();
      // Another journey's open fails, and is stuck.
      overdue(w, 1, FIVE_MINUTES + HOUR);
      w.store.failWith(failing('40P01'), 'openLostContactAlert');
      await w.watchdog.sweep();
      // The read fails.
      w.store.failWith(failing('57P01'), 'overdueJourneys');
      await w.watchdog.sweep();
      w.store.recover();
      // The beat cannot be written.
      w.beats.failWith(failing('53300'));
      await w.watchdog.sweep();
    });

    // Controls: the errors hold every marker, and the capture saw the lines.
    for (const error of thrown) {
      expect(markersIn(error.message, markers)).toEqual(markers);
    }
    for (const event of ['push_failed', 'delivery_failed', 'watchdog_failed', 'watchdog_overdue']) {
      expect(written, event).toContain(`"event":"${event}"`);
    }

    expect(markersIn(written, markers)).toEqual([]);
  });
});
