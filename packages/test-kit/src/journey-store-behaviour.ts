/**
 * One set of expectations for every journey store: the in-memory fake and the
 * real adapter over PostgreSQL (SM-01, LOST-01).
 *
 * The system tests run the API against the fake, so they prove the real
 * behaviour only while the fake behaves like the adapter. This suite is what
 * holds them together: the fake's own tests run it at L2, and the adapter's
 * integration test runs it at L3 against the real tables. A rule kept by one
 * and not the other fails in one of the two runs.
 *
 * What both must do when a journey starts:
 *   - one unended journey per walker: a second start is "not inserted" and
 *     names the journey already there, also when many starts race;
 *   - an ENDED journey blocks nothing and is never reported as unended;
 *   - a start is written whole or not at all, and a walker or responder who
 *     is not a user, or a device that is not a device, is refused, not
 *     half-stored;
 *   - a start stores the device that sent it, and no other (D-101);
 *   - a start with no responders is refused, in the store's own words, and
 *     leaves nothing: a journey with nobody to alert is the silent failure
 *     this whole app exists to prevent, so the store holds the line even if a
 *     caller gets past the domain's NO_RESPONDER. Beside an unended journey
 *     too, where answering "not inserted" would let the empty list through
 *     unrefused;
 *   - `existingUsers` names exactly the IDs that are users;
 *   - an ID is matched as PostgreSQL's `uuid` type matches it, in either
 *     case, and comes back lower-case.
 *
 * And when a heartbeat arrives (LOST-01):
 *   - it is stored once, with its receive time and battery, and its position
 *     as given, the phone's time included; last contact moves to its receive
 *     time (LOST-01-AC1);
 *   - one without a position counts the same, and the latest heartbeat then
 *     reads "no position" until one with a position comes (SM-03, AC2);
 *   - an event ID the journey already has changes nothing, last contact
 *     included, whatever the content; event IDs belong to their journey and
 *     are compared exactly (SM-08, AC3); copies that race leave one (AC4);
 *   - last contact is the greatest receive time and never moves backwards,
 *     whatever order heartbeats are written in, and the latest heartbeat is
 *     the one with the greatest receive time, a tie to the one stored last
 *     (SM-09, AC5, a fast-check property);
 *   - the phone's time decides nothing (REL-01, AC6);
 *   - a heartbeat for an ENDED journey is answered `ended` and stores
 *     nothing (SM-07, AC7); one for a LOST_CONTACT journey is stored, and
 *     the journey stays LOST_CONTACT (AC8);
 *   - a heartbeat whose position is refused leaves nothing behind, so the
 *     same event can be sent again (AC13); values outside the contract's
 *     rules are refused (AC18).
 *
 * And when a journey goes silent (LOST-02), the watchdog's and the outbox's
 * side of the store:
 *   - the overdue read returns exactly the ACTIVE journeys silent for five
 *     minutes or more, counted from last contact or from the start, with the
 *     store's own now (AC2, AC3), for any journeys and any sequence of
 *     heartbeats and sweeps (fast-check);
 *   - opening an alert moves the journey, opens one OPEN alert and writes one
 *     message per responder, all of it or none of it, and only for a journey
 *     still ACTIVE and overdue under the lock: contact that came after the
 *     read wins (AC9), a held row is skipped and never waited for (AC8), a
 *     journey with no responder is refused (AC12), and opens that race leave
 *     one alert (AC7); an open told to wait for a held row answers `held`
 *     when the row stays held, and otherwise checks the row as its holder
 *     left it (AC20);
 *   - a claim hands each due message to one claimer, once, leased; a failure
 *     keeps its reason and is due again after its delay; a sent message is
 *     never handed out again (AC14, AC15).
 * Times are the store's own: the fake's clock, or the database's now(). The
 * database's moves on while a test runs, so a subject says how far from the
 * threshold a time must be to be sure of its side (`timeMarginMs`); the fake's
 * stands still, and is asked about the threshold itself.
 *
 * Each behaviour is a value — a name and a function — rather than a test of
 * its own, so a runner file states it with `test.each(JOURNEY_STORE_BEHAVIOUR)`
 * and the fake's test file can pin the list of names. Removing one then
 * changes an assertion in a test file, where the gates and test-auditor see
 * it.
 */
import * as fc from 'fast-check';
import { expect } from 'vitest';
import type {
  AlertMessage,
  ClaimedMessages,
  FakeAlertResolution,
  FakeAlertState,
  FakeJourneyState,
  HeartbeatToRecord,
  InsertStartedResult,
  LatestHeartbeat,
  OpenLostContactAlertResult,
  OverdueJourneys,
  RecordHeartbeatResult,
  RecordHomeResult,
  StartedJourney,
} from './fake-journey-store.ts';
import type { MessageKind, PushFailureReason } from './fake-push.ts';
import {
  syntheticBatteryLevel,
  syntheticEventId,
  syntheticPosition,
  toStoredPosition,
} from './synthetic-heartbeats.ts';
import { syntheticUuid } from './synthetic-ids.ts';

/** A journey as a store under test holds it. */
export interface JourneyAsStored {
  id: string;
  walkerId: string;
  state: string;
  startedAt: Date;
  responderIds: readonly string[];
}

/** A heartbeat as a store under test holds it, without its arrival number, which differs by store. */
export interface HeartbeatAsStored {
  eventId: string;
  receivedAt: Date;
  batteryLevel: number | null;
}

/** A position as a store under test holds it, named by its heartbeat's event ID. */
export interface PositionAsStored {
  eventId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  recordedAt: Date;
}

/**
 * A journey store, with what a test needs around it: making users and
 * devices, putting a journey in directly, and reading back everything a
 * walker or a journey has.
 */
export interface JourneyStoreUnderTest {
  store: {
    overdueJourneys(afterMs: number): Promise<OverdueJourneys>;
    openLostContactAlert(request: {
      journeyId: string;
      afterMs: number;
      lockWaitMs?: number | undefined;
    }): Promise<OpenLostContactAlertResult>;
    claimDue(request: { limit: number; leaseMs: number }): Promise<ClaimedMessages>;
    markSent(messageId: string): Promise<void>;
    markFailed(request: {
      messageId: string;
      reason: PushFailureReason;
      retryAfterMs: number;
    }): Promise<void>;
    unendedJourneyOf(walkerId: string): Promise<{ id: string; state: string } | null>;
    existingUsers(ids: readonly string[]): Promise<ReadonlySet<string>>;
    insertStarted(journey: StartedJourney): Promise<InsertStartedResult>;
    journeyForHeartbeat(
      journeyId: string,
    ): Promise<{ id: string; walkerId: string; deviceId: string; state: string } | null>;
    recordHeartbeat(heartbeat: HeartbeatToRecord): Promise<RecordHeartbeatResult>;
    latestHeartbeatOf(journeyId: string): Promise<LatestHeartbeat | null>;
    /**
     * "I'm home" (LOST-03, D-110): the journey, and the walker and device
     * the home rule is asked with under the lock (review loop 1).
     */
    recordHome(home: {
      journeyId: string;
      walkerId: string;
      deviceId: string;
    }): Promise<RecordHomeResult>;
  };
  /** A new user, by the store's own means: a row in the real table, an entry in the fake. */
  addUser(): Promise<string>;
  /**
   * A new device of this user, by the store's own means; resolves to its ID.
   * Every start and every seeded journey names the device it came from, as
   * `journeys.device_id` is not null and references `devices` (D-101).
   */
  addDevice(userId: string): Promise<string>;
  /** A journey put in directly, in any state, started from this device; resolves to its ID. */
  seedJourney(journey: {
    walkerId: string;
    deviceId: string;
    state: FakeJourneyState;
    responderIds: readonly string[];
    startedAt: Date;
    lastHeartbeatAt?: Date | null;
  }): Promise<string>;
  /** Every journey the walker has, as stored, in any order. */
  journeysOf(walkerId: string): Promise<JourneyAsStored[]>;
  /**
   * Ends the journey directly, as a test's own setup, without the "I'm home"
   * route or any rule: no end time and no end reason, as a journey ended by
   * hand in the database has neither.
   */
  endJourney(journeyId: string): Promise<void>;
  /** The device the journey records as the one that started it, or null if there is no such journey. */
  deviceOf(journeyId: string): Promise<string | null>;
  /** The journey's state as stored, or null if there is no such journey. */
  stateOf(journeyId: string): Promise<string | null>;
  /** The journey's last contact, null until its first heartbeat. */
  lastHeartbeatAt(journeyId: string): Promise<Date | null>;
  /** Every heartbeat the journey has, as stored, in any order. */
  heartbeatsOf(journeyId: string): Promise<HeartbeatAsStored[]>;
  /** Every position the journey's heartbeats carried, as stored, in any order. */
  positionsOf(journeyId: string): Promise<PositionAsStored[]>;
  /**
   * How many runs a fast-check property gets here: many against the fake,
   * fewer against a real database, where each run writes real rows.
   */
  propertyRuns: number;
  /** The store's own now: the fake's clock, or the database's `now()` (LOST-02). */
  now(): Promise<Date>;
  /** The alerts this journey has, as stored, in any order. */
  alertsOf(journeyId: string): Promise<AlertAsStored[]>;
  /** The outbox messages of this journey's alerts, as stored, in any order. */
  messagesOf(journeyId: string): Promise<MessageAsStored[]>;
  /**
   * Holds the journey's row in a transaction of its own, as a heartbeat being
   * written or another worker's sweep would, until `release` (LOST-02-AC8).
   */
  hold(journeyId: string): Promise<{ release(): Promise<void> }>;
  /**
   * Holds the journey's row as `hold` does, and lets it go once an open is
   * waiting for it: a healthy transaction that commits within the lock wait
   * (LOST-02-AC20). With `contact`, the holder first moves the journey's last
   * contact to the store's now, as a heartbeat in flight does, so the
   * journey is no longer overdue when it lets go; with `unchanged`, it
   * changes nothing. `release` lets go at once if no open came.
   */
  holdUntilWaited(
    journeyId: string,
    change: 'unchanged' | 'contact',
  ): Promise<{ release(): Promise<void> }>;
  /**
   * The wait an open is given for a held row here: short against the
   * database, where a row held throughout costs the test that long.
   */
  lockWaitMs: number;
  /**
   * Lets this much of the store's time pass: the fake's clock is moved on;
   * the database's moves on by itself, so the test waits that long.
   */
  letTimePass(ms: number): Promise<void>;
  /**
   * How far from the five-minute threshold a silence must be for this store
   * to be sure which side it is on: 0 for the fake, whose clock stands still;
   * a second or two for the database, whose `now()` moves on while a test runs.
   */
  timeMarginMs: number;
  /**
   * LOST-03: each alert of this journey's resolution, read by a reader of its
   * own so that `alertsOf` keeps its shape: when it resolved and how, both
   * null until it is. In any order.
   */
  resolutionsOf(journeyId: string): Promise<ResolutionAsStored[]>;
  /** LOST-03: each outbox message of this journey's alerts, when it was written and when withdrawn. In any order. */
  withdrawalsOf(journeyId: string): Promise<WithdrawalAsStored[]>;
  /** LOST-03: how the journey ended, by a reader of its own, or null if there is no such journey. */
  endOf(journeyId: string): Promise<JourneyEndAsStored | null>;
  /**
   * LOST-03-AC4: an alert put in directly, in any state, as a test's own
   * setup: nothing in the code writes ESCALATED or ACKNOWLEDGED yet.
   * Resolves to its ID.
   */
  seedAlert(alert: {
    journeyId: string;
    state: FakeAlertState;
    openedAt: Date;
    silentSince: Date;
    resolvedAt?: Date | null;
    resolution?: FakeAlertResolution | null;
  }): Promise<string>;
  /** LOST-03: an outbox message put in directly, never withdrawn, as a test's own setup. Resolves to its ID. */
  seedMessage(message: {
    alertId: string;
    recipientId: string;
    kind: MessageKind;
    createdAt: Date;
    nextAttemptAt: Date;
    attempts?: number;
    sentAt?: Date | null;
    lastFailure?: PushFailureReason | null;
  }): Promise<string>;
  /** LOST-03-AC4: every responder row of the journey removed directly: nothing in the code removes one yet. */
  removeResponders(journeyId: string): Promise<void>;
}

/** An alert's resolution, as a store under test holds it (LOST-03). */
export interface ResolutionAsStored {
  alertId: string;
  resolvedAt: Date | null;
  resolution: string | null;
}

/** When an outbox message was written, and when it was withdrawn, null if never (LOST-03). */
export interface WithdrawalAsStored {
  messageId: string;
  createdAt: Date;
  withdrawnAt: Date | null;
}

/** How a journey ended, as a store under test holds it: both null until it ends through the store (LOST-03). */
export interface JourneyEndAsStored {
  endedAt: Date | null;
  endReason: string | null;
}

/** An alert as a store under test holds it (LOST-02). */
export interface AlertAsStored {
  id: string;
  state: string;
  openedAt: Date;
  silentSince: Date;
}

/** An outbox message as a store under test holds it (LOST-02). */
export interface MessageAsStored {
  messageId: string;
  alertId: string;
  recipientId: string;
  kind: string;
  attempts: number;
  nextAttemptAt: Date;
  sentAt: Date | null;
  lastFailure: string | null;
}

export interface JourneyStoreBehaviour {
  name: string;
  /** A plain function, not a method, so a runner can take it out of the case. */
  run: (subject: JourneyStoreUnderTest) => Promise<void>;
}

/** How many starts race at once, and how many times the race is run. */
export const RACERS = 10;
export const RACE_ROUNDS = 5;

const STARTED_AT = new Date('2026-10-01T21:00:00.000Z');
const EARLIER = new Date('2026-10-01T20:00:00.000Z');
const UNENDED: readonly FakeJourneyState[] = ['ACTIVE', 'LOST_CONTACT'];

/**
 * How a store says it refused a start for having no responders: the word
 * "responder" or "responders", on its own. Both stores' messages say it. A
 * refusal that comes from somewhere else does not: Drizzle's throw on an empty
 * insert says "values() must be called with at least one value", and a query
 * that failed on the responders' table names "journey_responders" and
 * "responder_id", where the word is joined to its neighbours and so is not on
 * its own. Without this, a store whose own refusal had been deleted would
 * still pass, rejected by whatever broke next.
 */
const REFUSED_FOR_NO_RESPONDER = /\bresponders?\b/i;

/** Order-free, so a database that returns rows in any order compares equal. */
function normalised(journeys: readonly JourneyAsStored[]) {
  return [...journeys]
    .map((journey) => ({
      id: journey.id,
      walkerId: journey.walkerId,
      state: journey.state,
      startedAtMs: journey.startedAt.getTime(),
      responderIds: [...journey.responderIds].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function users(subject: JourneyStoreUnderTest, count: number): Promise<string[]> {
  const made: string[] = [];
  for (let i = 0; i < count; i += 1) {
    made.push(await subject.addUser());
  }
  return made;
}

function insertedId(result: InsertStartedResult): string {
  if (!result.inserted) {
    throw new Error(
      `expected the start to be inserted, but it was refused for ${result.unendedJourneyId}`,
    );
  }
  return result.journeyId;
}

/** The time heartbeats are received at, unless a behaviour says otherwise. */
const RECEIVED_AT = new Date('2026-10-01T21:40:00.000Z');
const SECOND = 1_000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const STATES: readonly FakeJourneyState[] = ['ACTIVE', 'LOST_CONTACT', 'ENDED'];

/** A moment this long after RECEIVED_AT. */
function after(ms: number): Date {
  return new Date(RECEIVED_AT.getTime() + ms);
}

/** A walker with a device, and a journey of theirs started from it, put in directly. */
async function journeyFor(
  subject: JourneyStoreUnderTest,
  {
    state = 'ACTIVE',
    lastHeartbeatAt = null,
  }: { state?: FakeJourneyState; lastHeartbeatAt?: Date | null } = {},
): Promise<{ walkerId: string; deviceId: string; journeyId: string }> {
  const [walkerId = '', responderId = ''] = await users(subject, 2);
  const deviceId = await subject.addDevice(walkerId);
  const journeyId = await subject.seedJourney({
    walkerId,
    deviceId,
    state,
    responderIds: [responderId],
    startedAt: EARLIER,
    lastHeartbeatAt,
  });
  return { walkerId, deviceId, journeyId };
}

/**
 * A heartbeat for this journey, received at RECEIVED_AT, with a fresh event
 * ID, a battery level and a synthetic position, unless the behaviour gives
 * its own.
 */
function heartbeatFor(
  journeyId: string,
  given: Partial<HeartbeatToRecord> = {},
): HeartbeatToRecord {
  return {
    journeyId,
    eventId: syntheticEventId(),
    receivedAt: RECEIVED_AT,
    batteryLevel: syntheticBatteryLevel(),
    position: toStoredPosition(syntheticPosition()),
    ...given,
  };
}

/** A synthetic position, as the store takes it. */
function position(): HeartbeatToRecord['position'] & object {
  return toStoredPosition(syntheticPosition());
}

/** What a heartbeat should be stored as. */
function storedAs({ eventId, receivedAt, batteryLevel }: HeartbeatToRecord): HeartbeatAsStored {
  return { eventId, receivedAt, batteryLevel };
}

/** The positions these heartbeats carried, as they should be stored: exactly as given. */
function positionsCarried(heartbeats: readonly HeartbeatToRecord[]): PositionAsStored[] {
  return heartbeats.flatMap(({ eventId, position: carried }) =>
    carried === null ? [] : [{ eventId, ...carried }],
  );
}

/** Order-free, so a database that returns rows in any order compares equal. */
function byEvent<T extends { eventId: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
}

const RECORDED: RecordHeartbeatResult = { outcome: 'recorded' };
const DUPLICATE: RecordHeartbeatResult = { outcome: 'duplicate' };
const ENDED: RecordHeartbeatResult = { outcome: 'ended' };

/**
 * Phone times whose instant in UTC is outside the years 0001 to 9999: year
 * 0, which PostgreSQL does not have, and year 10000, which the adapter's
 * `toISOString()` writes as `+010000-…`. PostgreSQL 16 refuses the first with
 * SQLSTATE 22008 and the second with 22009 (safety-reviewer, LOST-01; the
 * codes read on PostgreSQL 16.13). Each is written as the contract
 * would have taken it, so the second and third show that the offset, not the
 * year as written, decides: `9999-12-31` at -14:00 is already year 10000 in
 * UTC, and `0001-01-01` at +01:00 still year 0.
 */
const PHONE_TIMES_OUT_OF_RANGE = [
  '0000-01-01T00:00:00Z',
  '9999-12-31T23:59:59-14:00',
  '0001-01-01T00:30:00+01:00',
] as const;

/** The first and the last whole second of the years 0001 to 9999, in UTC. */
const PHONE_TIMES_AT_THE_EDGES = ['0001-01-01T00:00:00Z', '9999-12-31T23:59:59Z'] as const;

// ---------------------------------------------------------------------------
// LOST-02: silence, alerts and the outbox.
// ---------------------------------------------------------------------------

/**
 * Five minutes (D-021): the server's LOST_CONTACT_AFTER_MS, written out
 * because the test kit imports nothing from the server.
 */
const LOST_CONTACT_AFTER_MS = 300_000;

/** The claim's lease: the server's CLAIM_LEASE_MS, written out for the same reason. */
const LEASE_MS = 30_000;

/** The claim's batch: the server's CLAIM_BATCH. */
const BATCH = 50;

/** A canonical UUID, as the database writes one: lower-case. */
const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A moment this long before `now`. */
function ago(now: Date, ms: number): Date {
  return new Date(now.getTime() - ms);
}

/** A walker, `responders` users following them, and a journey of theirs put in directly. */
async function watched(
  subject: JourneyStoreUnderTest,
  {
    state = 'ACTIVE',
    startedAt,
    lastHeartbeatAt = null,
    responders = 1,
  }: {
    state?: FakeJourneyState;
    startedAt: Date;
    lastHeartbeatAt?: Date | null;
    responders?: number;
  },
): Promise<{ walkerId: string; deviceId: string; journeyId: string; responderIds: string[] }> {
  const [walkerId = '', ...responderIds] = await users(subject, 1 + responders);
  const deviceId = await subject.addDevice(walkerId);
  const journeyId = await subject.seedJourney({
    walkerId,
    deviceId,
    state,
    responderIds,
    startedAt,
    lastHeartbeatAt,
  });
  return { walkerId, deviceId, journeyId, responderIds };
}

/**
 * One sweep at the store's level, over these journeys only: the overdue
 * read, then an open for each of them it returned. The read is of the whole
 * store, and at L3 other tests' journeys are in it.
 */
async function sweepOf(
  subject: JourneyStoreUnderTest,
  journeyIds: readonly string[],
): Promise<OpenLostContactAlertResult[]> {
  const read = await subject.store.overdueJourneys(LOST_CONTACT_AFTER_MS);
  const results: OpenLostContactAlertResult[] = [];
  for (const journey of read.journeys.filter(({ id }) => journeyIds.includes(id))) {
    results.push(
      await subject.store.openLostContactAlert({
        journeyId: journey.id,
        afterMs: LOST_CONTACT_AFTER_MS,
      }),
    );
  }
  return results;
}

/** An overdue journey, opened: its alert and its messages. */
async function openedWith(
  subject: JourneyStoreUnderTest,
  responders: number,
): Promise<{
  journeyId: string;
  alertId: string;
  messages: { messageId: string; recipientId: string; kind: string }[];
}> {
  const now = await subject.now();
  const { journeyId } = await watched(subject, {
    startedAt: ago(now, 2 * HOUR),
    lastHeartbeatAt: ago(now, HOUR),
    responders,
  });
  const opened = await subject.store.openLostContactAlert({
    journeyId,
    afterMs: LOST_CONTACT_AFTER_MS,
  });
  if (opened.outcome !== 'opened') {
    throw new Error('expected the overdue journey to be opened, but it was skipped');
  }
  return { journeyId, alertId: opened.alertId, messages: opened.messages };
}

/** The recipients of these messages, sorted. */
function recipientsOf(messages: readonly { recipientId: string }[]): string[] {
  return messages.map(({ recipientId }) => recipientId).sort();
}

/** Sorted by message ID, so stores that hand rows back in any order compare equal. */
function byMessage<T extends { messageId: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0,
  );
}

/** The timers, by shape: the test kit has no DOM or Node types (see synthetic-ids.ts). */
const timers = globalThis as unknown as {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

/**
 * Settles as `promise` does, or rejects once `ms` have passed, saying what
 * waited: "skipped, not waited for" is checked as an answer that came at once.
 */
function within<T>(ms: number, promise: Promise<T>, what: string): Promise<T> {
  let handle: unknown;
  const late = new Promise<never>((_resolve, reject) => {
    handle = timers.setTimeout(() => {
      reject(new Error(`${what} did not answer within ${String(ms)} ms: it waited`));
    }, ms);
  });
  return Promise.race([promise, late]).finally(() => {
    timers.clearTimeout(handle);
  });
}

/**
 * Silences, in milliseconds, around the threshold and far from it: those a
 * margin cannot judge left out. The third branch (LOST-03 review loop 1, the
 * spec's item 8) draws only silences under the threshold by more than the
 * margin, so heartbeats that bring a journey back are drawn against the
 * database too, where the margin filters out the ones near the threshold
 * and few runs are drawn.
 */
function silences(margin: number): fc.Arbitrary<number> {
  return fc
    .oneof(
      fc.integer({ min: 0, max: 2 * HOUR }),
      fc.constantFrom(LOST_CONTACT_AFTER_MS - 1, LOST_CONTACT_AFTER_MS, LOST_CONTACT_AFTER_MS + 1),
      fc.integer({ min: 0, max: LOST_CONTACT_AFTER_MS - margin - 1 }),
    )
    .filter((ms) => margin === 0 || Math.abs(ms - LOST_CONTACT_AFTER_MS) > margin);
}

// ---------------------------------------------------------------------------
// LOST-03: back in contact, and "I'm home".
// ---------------------------------------------------------------------------

const SECONDS = SECOND;

/**
 * How long before the store's now a heartbeat may be received and still
 * leave the silence under five minutes when the store writes it: 4 min
 * 59.999 s against the fake, whose clock stands still, and a margin under
 * five minutes against the database, whose now() moves on.
 */
function freshAgoMs(subject: JourneyStoreUnderTest): number {
  return LOST_CONTACT_AFTER_MS - Math.max(1, subject.timeMarginMs);
}

/** A heartbeat for this journey, received at the store's now: as fresh as contact gets. */
async function freshHeartbeat(
  subject: JourneyStoreUnderTest,
  journeyId: string,
  given: Partial<HeartbeatToRecord> = {},
): Promise<HeartbeatToRecord> {
  return heartbeatFor(journeyId, { receivedAt: await subject.now(), ...given });
}

/** A LOST_CONTACT journey opened by the store's own open, silent an hour: its people, its alert and its lost-contact messages. */
async function lostWith(
  subject: JourneyStoreUnderTest,
  responders: number,
): Promise<{
  walkerId: string;
  deviceId: string;
  journeyId: string;
  responderIds: string[];
  alertId: string;
  messages: AlertMessage[];
}> {
  const now = await subject.now();
  const journey = await watched(subject, {
    startedAt: ago(now, 2 * HOUR),
    lastHeartbeatAt: ago(now, HOUR),
    responders,
  });
  const opened = await subject.store.openLostContactAlert({
    journeyId: journey.journeyId,
    afterMs: LOST_CONTACT_AFTER_MS,
  });
  if (opened.outcome !== 'opened') {
    throw new Error(`expected the silent journey to be opened, but it was ${opened.outcome}`);
  }
  return { ...journey, alertId: opened.alertId, messages: opened.messages };
}

/** The answer of a heartbeat that brought a journey back, or a failed expectation saying what it was instead. */
function backInContact(result: RecordHeartbeatResult): {
  alertId: string | null;
  messages: AlertMessage[];
} {
  expect(result.outcome, 'the heartbeat brought the journey back in contact').toBe(
    'back_in_contact',
  );
  if (result.outcome !== 'back_in_contact') {
    throw new Error(`the heartbeat was answered ${result.outcome}`);
  }
  return result;
}

/**
 * "I'm home" as the store takes it, for this journey: from its own walker and
 * the device that started it (review loop 1: the store asks the home rule
 * with them under the lock).
 */
function homeOf(journey: { journeyId: string; walkerId: string; deviceId: string }): {
  journeyId: string;
  walkerId: string;
  deviceId: string;
} {
  return { journeyId: journey.journeyId, walkerId: journey.walkerId, deviceId: journey.deviceId };
}

/** The answer of an "I'm home" that ended a journey, or a failed expectation saying what it was instead. */
function endedHome(result: RecordHomeResult): {
  from: string;
  alertId: string | null;
  messages: AlertMessage[];
} {
  expect(result.outcome, '"I’m home" ended the journey').toBe('home');
  if (result.outcome !== 'home') {
    throw new Error(`"I’m home" was answered ${result.outcome}`);
  }
  return result;
}

/** This alert's resolution, as the store under test holds it. */
async function resolutionOf(
  subject: JourneyStoreUnderTest,
  journeyId: string,
  alertId: string,
): Promise<ResolutionAsStored | undefined> {
  return (await subject.resolutionsOf(journeyId)).find((each) => each.alertId === alertId);
}

/** When each of these messages was withdrawn, by message ID. */
async function withdrawnAtOf(
  subject: JourneyStoreUnderTest,
  journeyId: string,
): Promise<Map<string, Date | null>> {
  return new Map(
    (await subject.withdrawalsOf(journeyId)).map(({ messageId, withdrawnAt }) => [
      messageId,
      withdrawnAt,
    ]),
  );
}

/** The messages of one kind, for one alert, sorted by recipient. */
function ofKind<T extends { alertId: string; kind: string; recipientId: string }>(
  messages: readonly T[],
  alertId: string,
  kind: string,
): T[] {
  return messages
    .filter((message) => message.alertId === alertId && message.kind === kind)
    .sort((a, b) => (a.recipientId < b.recipientId ? -1 : a.recipientId > b.recipientId ? 1 : 0));
}

/** Sorted by recipient, so stores that hand rows back in any order compare equal. */
function byRecipient<T extends { recipientId: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    a.recipientId < b.recipientId ? -1 : a.recipientId > b.recipientId ? 1 : 0,
  );
}

/** Everything a store holds of one journey's alerts and messages, to compare before and after. */
async function alertRecordOf(subject: JourneyStoreUnderTest, journeyId: string) {
  return {
    state: await subject.stateOf(journeyId),
    alerts: [...(await subject.alertsOf(journeyId))].sort((a, b) => a.id.localeCompare(b.id)),
    resolutions: [...(await subject.resolutionsOf(journeyId))].sort((a, b) =>
      a.alertId.localeCompare(b.alertId),
    ),
    messages: byMessage(await subject.messagesOf(journeyId)),
    withdrawals: byMessage(await subject.withdrawalsOf(journeyId)),
  };
}

export const JOURNEY_STORE_BEHAVIOUR: readonly JourneyStoreBehaviour[] = [
  {
    name: 'a walker with no journey has no unended journey',
    async run(subject) {
      const [walkerId = ''] = await users(subject, 1);

      expect(await subject.store.unendedJourneyOf(walkerId)).toBeNull();
      expect(await subject.journeysOf(walkerId)).toEqual([]);
    },
  },
  {
    name: 'a start is stored ACTIVE, with exactly its responders and the moment it was given',
    async run(subject) {
      const [walkerId = '', first = '', second = ''] = await users(subject, 3);
      const deviceId = await subject.addDevice(walkerId);

      const result = await subject.store.insertStarted({
        walkerId,
        deviceId,
        responderIds: [first, second],
        startedAt: STARTED_AT,
      });

      expect(result.inserted).toBe(true);
      const journeyId = insertedId(result);
      expect(normalised(await subject.journeysOf(walkerId))).toEqual(
        normalised([
          {
            id: journeyId,
            walkerId,
            state: 'ACTIVE',
            startedAt: STARTED_AT,
            responderIds: [first, second],
          },
        ]),
      );
      expect(await subject.store.unendedJourneyOf(walkerId)).toEqual({
        id: journeyId,
        state: 'ACTIVE',
      });
    },
  },
  {
    name: 'a journey in ACTIVE or in LOST_CONTACT is reported as unended, with its ID and state',
    async run(subject) {
      for (const state of UNENDED) {
        const [walkerId = '', responderId = ''] = await users(subject, 2);
        const deviceId = await subject.addDevice(walkerId);
        const journeyId = await subject.seedJourney({
          walkerId,
          deviceId,
          state,
          responderIds: [responderId],
          startedAt: EARLIER,
        });

        expect(await subject.store.unendedJourneyOf(walkerId), state).toEqual({
          id: journeyId,
          state,
        });
      }
    },
  },
  {
    name: 'an ENDED journey is never reported as unended',
    async run(subject) {
      const [walkerId = '', responderId = ''] = await users(subject, 2);
      await subject.seedJourney({
        walkerId,
        deviceId: await subject.addDevice(walkerId),
        state: 'ENDED',
        responderIds: [responderId],
        startedAt: EARLIER,
      });

      expect(await subject.store.unendedJourneyOf(walkerId)).toBeNull();
    },
  },
  {
    name: 'a start beside an unended journey is not inserted, names that journey, and changes nothing',
    async run(subject) {
      for (const state of UNENDED) {
        const [walkerId = '', earlier = '', later = ''] = await users(subject, 3);
        const deviceId = await subject.addDevice(walkerId);
        const journeyId = await subject.seedJourney({
          walkerId,
          deviceId,
          state,
          responderIds: [earlier],
          startedAt: EARLIER,
        });
        const before = normalised(await subject.journeysOf(walkerId));

        const result = await subject.store.insertStarted({
          walkerId,
          deviceId,
          responderIds: [later],
          startedAt: STARTED_AT,
        });

        expect(result, state).toEqual({ inserted: false, unendedJourneyId: journeyId });
        expect(normalised(await subject.journeysOf(walkerId)), state).toEqual(before);
      }
    },
  },
  {
    name: 'an ENDED journey does not block a new one, and stays exactly as it was',
    async run(subject) {
      const [walkerId = '', earlier = '', later = ''] = await users(subject, 3);
      const deviceId = await subject.addDevice(walkerId);
      const endedId = await subject.seedJourney({
        walkerId,
        deviceId,
        state: 'ENDED',
        responderIds: [earlier],
        startedAt: EARLIER,
      });

      const journeyId = insertedId(
        await subject.store.insertStarted({
          walkerId,
          deviceId,
          responderIds: [later],
          startedAt: STARTED_AT,
        }),
      );

      expect(normalised(await subject.journeysOf(walkerId))).toEqual(
        normalised([
          { id: endedId, walkerId, state: 'ENDED', startedAt: EARLIER, responderIds: [earlier] },
          {
            id: journeyId,
            walkerId,
            state: 'ACTIVE',
            startedAt: STARTED_AT,
            responderIds: [later],
          },
        ]),
      );
    },
  },
  {
    name: 'one walker’s unended journey does not block another walker',
    async run(subject) {
      const [first = '', second = '', responderId = ''] = await users(subject, 3);
      await subject.seedJourney({
        walkerId: first,
        deviceId: await subject.addDevice(first),
        state: 'ACTIVE',
        responderIds: [responderId],
        startedAt: EARLIER,
      });

      const result = await subject.store.insertStarted({
        walkerId: second,
        deviceId: await subject.addDevice(second),
        responderIds: [responderId],
        startedAt: STARTED_AT,
      });

      expect(result.inserted).toBe(true);
    },
  },
  {
    name: `starts racing for one walker, ${String(RACERS)} at once and ${String(RACE_ROUNDS)} times over: exactly one is inserted, and every other names it`,
    async run(subject) {
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const [walkerId = '', responderId = ''] = await users(subject, 2);
        const deviceId = await subject.addDevice(walkerId);

        // Promise.all rejects if any start fails outright, which is the
        // "no unhandled error" half of the rule.
        const results = await Promise.all(
          Array.from({ length: RACERS }, () =>
            subject.store.insertStarted({
              walkerId,
              deviceId,
              responderIds: [responderId],
              startedAt: STARTED_AT,
            }),
          ),
        );

        const winners = results.flatMap((result) => (result.inserted ? [result.journeyId] : []));
        expect(winners, `round ${String(round)}`).toHaveLength(1);
        const winner = winners[0];
        expect(
          results.filter((result) => !result.inserted),
          `round ${String(round)}`,
        ).toEqual(
          Array.from({ length: RACERS - 1 }, () => ({
            inserted: false,
            unendedJourneyId: winner,
          })),
        );
        expect(
          (await subject.journeysOf(walkerId)).map((journey) => journey.id),
          `round ${String(round)}`,
        ).toEqual([winner]);
      }
    },
  },
  {
    name: 'existingUsers names exactly the given IDs that are users',
    async run(subject) {
      const [first = '', second = ''] = await users(subject, 2);
      const stranger = syntheticUuid();

      const found = await subject.store.existingUsers([first, stranger, second, first]);

      expect([...found].sort()).toEqual([first, second].sort());
      expect([...(await subject.store.existingUsers([stranger]))]).toEqual([]);
      expect([...(await subject.store.existingUsers([]))]).toEqual([]);
    },
  },
  {
    name: 'an ID in upper case finds the same user and the same journey, and every ID comes back lower-case',
    async run(subject) {
      // A UUID's hex digits may be written in either case and name one ID;
      // PostgreSQL reads both and writes lower-case. A fake that matched IDs
      // as exact strings would hide what the database does to them, and so
      // hide a caller that compares the IDs it sent with the IDs it got back.
      const [walkerId = '', responderId = ''] = await users(subject, 2);
      expect([walkerId, responderId]).toEqual([walkerId.toLowerCase(), responderId.toLowerCase()]);

      expect([...(await subject.store.existingUsers([responderId.toUpperCase()]))]).toEqual([
        responderId,
      ]);

      const journeyId = insertedId(
        await subject.store.insertStarted({
          walkerId: walkerId.toUpperCase(),
          deviceId: await subject.addDevice(walkerId),
          responderIds: [responderId.toUpperCase()],
          startedAt: STARTED_AT,
        }),
      );

      expect(journeyId).toBe(journeyId.toLowerCase());
      expect(normalised(await subject.journeysOf(walkerId))).toEqual(
        normalised([
          {
            id: journeyId,
            walkerId,
            state: 'ACTIVE',
            startedAt: STARTED_AT,
            responderIds: [responderId],
          },
        ]),
      );
      expect(await subject.store.unendedJourneyOf(walkerId.toUpperCase())).toEqual({
        id: journeyId,
        state: 'ACTIVE',
      });
    },
  },
  {
    name: 'a responder who is not a user is refused whole: the store rejects, and leaves no journey',
    async run(subject) {
      const [walkerId = '', responderId = ''] = await users(subject, 2);
      const deviceId = await subject.addDevice(walkerId);

      await expect(
        subject.store.insertStarted({
          walkerId,
          deviceId,
          responderIds: [responderId, syntheticUuid()],
          startedAt: STARTED_AT,
        }),
      ).rejects.toThrow();

      expect(await subject.journeysOf(walkerId)).toEqual([]);
      expect(await subject.store.unendedJourneyOf(walkerId)).toBeNull();
      // And nothing half-written is left to block the walker's next start.
      const retried = await subject.store.insertStarted({
        walkerId,
        deviceId,
        responderIds: [responderId],
        startedAt: STARTED_AT,
      });
      expect(retried.inserted).toBe(true);
    },
  },
  {
    name: 'a walker who is not a user is refused: the store rejects, and stores nothing',
    async run(subject) {
      const [responderId = ''] = await users(subject, 1);
      const stranger = syntheticUuid();
      // A device that exists, so the walker is the only thing wrong here
      // (D-101): a device that did not exist would be refused on its own.
      const deviceId = await subject.addDevice(responderId);

      await expect(
        subject.store.insertStarted({
          walkerId: stranger,
          deviceId,
          responderIds: [responderId],
          startedAt: STARTED_AT,
        }),
      ).rejects.toThrow();

      expect(await subject.journeysOf(stranger)).toEqual([]);
    },
  },
  {
    name: 'a start with no responders is refused, and stores nothing',
    async run(subject) {
      // The domain refuses an empty list first, as NO_RESPONDER. This is the
      // store's own half: asked anyway, it must not keep a journey that
      // alerts nobody. Refusing because a library happens to throw on an
      // empty insert, after the journey row is written, is not a rule; an
      // upgrade that made that insert a no-op would leave the journey. So the
      // reason is checked, not only the rejection: Drizzle throws on an empty
      // insert and the transaction rolls back, which with the store's own
      // refusal deleted would otherwise pass here unseen.
      const [walkerId = '', responderId = ''] = await users(subject, 2);
      const deviceId = await subject.addDevice(walkerId);

      await expect(
        subject.store.insertStarted({
          walkerId,
          deviceId,
          responderIds: [],
          startedAt: STARTED_AT,
        }),
      ).rejects.toThrow(REFUSED_FOR_NO_RESPONDER);

      expect(await subject.store.unendedJourneyOf(walkerId)).toBeNull();
      expect(await subject.journeysOf(walkerId)).toEqual([]);
      // And nothing half-written is left to block the walker's next start.
      const retried = await subject.store.insertStarted({
        walkerId,
        deviceId,
        responderIds: [responderId],
        startedAt: STARTED_AT,
      });
      expect(retried.inserted).toBe(true);
    },
  },
  {
    name: 'a start with no responders beside an unended journey is refused too, never answered as not inserted, and changes nothing',
    async run(subject) {
      // The case above holds a walker with no journey. This is the other
      // situation, where a store could answer "not inserted" through the
      // one-unended rule and so never look at the list at all. The domain
      // answers ALREADY_ON_A_JOURNEY here first and never asks the store;
      // the store refuses on its own account, whatever its caller did. For
      // the adapter, this is the only case that fails if its explicit check
      // for an empty list is deleted: the insert's ON CONFLICT DO NOTHING
      // would answer before Drizzle ever sees the empty list.
      for (const state of UNENDED) {
        const [walkerId = '', responderId = ''] = await users(subject, 2);
        const deviceId = await subject.addDevice(walkerId);
        const journeyId = await subject.seedJourney({
          walkerId,
          deviceId,
          state,
          responderIds: [responderId],
          startedAt: EARLIER,
        });
        const before = normalised(await subject.journeysOf(walkerId));

        await expect(
          subject.store.insertStarted({
            walkerId,
            deviceId,
            responderIds: [],
            startedAt: STARTED_AT,
          }),
          state,
        ).rejects.toThrow(REFUSED_FOR_NO_RESPONDER);

        expect(normalised(await subject.journeysOf(walkerId)), state).toEqual(before);
        expect(await subject.store.unendedJourneyOf(walkerId), state).toEqual({
          id: journeyId,
          state,
        });
      }
    },
  },
  {
    name: 'LOST-01-AC10: a start stores the device it was given, and no other (D-101)',
    async run(subject) {
      const [walkerId = '', responderId = ''] = await users(subject, 2);
      const phone = await subject.addDevice(walkerId);
      const tablet = await subject.addDevice(walkerId);

      const journeyId = insertedId(
        await subject.store.insertStarted({
          walkerId,
          deviceId: phone,
          responderIds: [responderId],
          startedAt: STARTED_AT,
        }),
      );

      expect(tablet).not.toBe(phone);
      expect(await subject.deviceOf(journeyId)).toBe(phone);
      expect(await subject.store.journeyForHeartbeat(journeyId)).toEqual({
        id: journeyId,
        walkerId,
        deviceId: phone,
        state: 'ACTIVE',
      });
    },
  },
  {
    name: 'a start naming a device that does not exist is refused: the store rejects, and stores nothing (D-101)',
    async run(subject) {
      const [walkerId = '', responderId = ''] = await users(subject, 2);

      await expect(
        subject.store.insertStarted({
          walkerId,
          deviceId: syntheticUuid(),
          responderIds: [responderId],
          startedAt: STARTED_AT,
        }),
      ).rejects.toThrow();

      expect(await subject.journeysOf(walkerId)).toEqual([]);
      expect(await subject.store.unendedJourneyOf(walkerId)).toBeNull();
    },
  },
  {
    name: 'LOST-01-AC9: journeyForHeartbeat names the journey’s walker, its starting device and its state, in every state, ENDED included, in either case; and null for an ID no journey has',
    async run(subject) {
      for (const state of STATES) {
        const { walkerId, deviceId, journeyId } = await journeyFor(subject, { state });
        const expected = { id: journeyId, walkerId, deviceId, state };

        expect(await subject.store.journeyForHeartbeat(journeyId), state).toEqual(expected);
        expect(
          await subject.store.journeyForHeartbeat(journeyId.toUpperCase()),
          `${state}, upper case`,
        ).toEqual(expected);
      }
      expect(await subject.store.journeyForHeartbeat(syntheticUuid())).toBeNull();
    },
  },
  {
    name: 'LOST-01-AC1: a heartbeat with a position is recorded once: its receive time and battery, its position exactly as given with the phone’s time, last contact at its receive time, and the journey still ACTIVE',
    async run(subject) {
      const { journeyId } = await journeyFor(subject);
      const heartbeat = heartbeatFor(journeyId);

      expect(await subject.store.recordHeartbeat(heartbeat)).toEqual(RECORDED);

      expect(await subject.heartbeatsOf(journeyId)).toEqual([storedAs(heartbeat)]);
      expect(await subject.positionsOf(journeyId)).toEqual(positionsCarried([heartbeat]));
      expect(await subject.lastHeartbeatAt(journeyId)).toEqual(heartbeat.receivedAt);
      expect(await subject.stateOf(journeyId)).toBe('ACTIVE');
      expect(await subject.store.latestHeartbeatOf(journeyId)).toEqual({
        receivedAt: heartbeat.receivedAt,
        hasPosition: true,
        batteryLevel: heartbeat.batteryLevel,
      });
    },
  },
  {
    name: 'LOST-01-AC2: a journey with no heartbeat has no latest heartbeat and no last contact',
    async run(subject) {
      const { journeyId } = await journeyFor(subject);

      expect(await subject.store.latestHeartbeatOf(journeyId)).toBeNull();
      expect(await subject.lastHeartbeatAt(journeyId)).toBeNull();
    },
  },
  {
    name: 'LOST-01-AC2: a heartbeat without a position, battery unknown, is recorded the same with no position stored, and the latest reads no position until one with a position comes',
    async run(subject) {
      const { journeyId } = await journeyFor(subject);
      const without = heartbeatFor(journeyId, { position: null, batteryLevel: null });

      expect(await subject.store.recordHeartbeat(without)).toEqual(RECORDED);

      expect(await subject.heartbeatsOf(journeyId)).toEqual([storedAs(without)]);
      expect(await subject.positionsOf(journeyId)).toEqual([]);
      expect(await subject.lastHeartbeatAt(journeyId)).toEqual(without.receivedAt);
      expect(await subject.stateOf(journeyId)).toBe('ACTIVE');
      expect(await subject.store.latestHeartbeatOf(journeyId)).toEqual({
        receivedAt: without.receivedAt,
        hasPosition: false,
        batteryLevel: null,
      });

      const later = heartbeatFor(journeyId, { receivedAt: after(MINUTE) });
      expect(await subject.store.recordHeartbeat(later)).toEqual(RECORDED);

      expect(await subject.store.latestHeartbeatOf(journeyId)).toEqual({
        receivedAt: later.receivedAt,
        hasPosition: true,
        batteryLevel: later.batteryLevel,
      });
    },
  },
  {
    name: 'LOST-01-AC3: an event ID the journey already has is a duplicate, with the same content or another, however late: nothing changes, last contact included',
    async run(subject) {
      const { journeyId } = await journeyFor(subject);
      const first = heartbeatFor(journeyId);
      expect(await subject.store.recordHeartbeat(first)).toEqual(RECORDED);

      const resends = [
        { ...first, receivedAt: after(MINUTE) },
        heartbeatFor(journeyId, { eventId: first.eventId, receivedAt: after(2 * MINUTE) }),
        heartbeatFor(journeyId, {
          eventId: first.eventId,
          receivedAt: after(3 * MINUTE),
          batteryLevel: null,
          position: null,
        }),
      ];
      for (const [index, resend] of resends.entries()) {
        expect(await subject.store.recordHeartbeat(resend), `resend ${String(index)}`).toEqual(
          DUPLICATE,
        );
      }

      expect(await subject.heartbeatsOf(journeyId)).toEqual([storedAs(first)]);
      expect(await subject.positionsOf(journeyId)).toEqual(positionsCarried([first]));
      expect(await subject.lastHeartbeatAt(journeyId)).toEqual(first.receivedAt);
      expect(await subject.store.latestHeartbeatOf(journeyId)).toEqual({
        receivedAt: first.receivedAt,
        hasPosition: true,
        batteryLevel: first.batteryLevel,
      });
    },
  },
  {
    name: 'LOST-01-AC3: an event ID belongs to its journey: the same ID for another journey is recorded there, and changes nothing here',
    async run(subject) {
      const one = await journeyFor(subject);
      const other = await journeyFor(subject);
      const here = heartbeatFor(one.journeyId);
      const there = heartbeatFor(other.journeyId, {
        eventId: here.eventId,
        receivedAt: after(MINUTE),
      });

      expect(await subject.store.recordHeartbeat(here)).toEqual(RECORDED);
      expect(await subject.store.recordHeartbeat(there)).toEqual(RECORDED);

      expect(await subject.heartbeatsOf(one.journeyId)).toEqual([storedAs(here)]);
      expect(await subject.heartbeatsOf(other.journeyId)).toEqual([storedAs(there)]);
      expect(await subject.lastHeartbeatAt(one.journeyId)).toEqual(here.receivedAt);
    },
  },
  {
    name: 'LOST-01-AC3: event IDs are compared exactly, case and all: one that differs only in case is another event',
    async run(subject) {
      const { journeyId } = await journeyFor(subject);
      const lower = heartbeatFor(journeyId);
      const upper = heartbeatFor(journeyId, {
        eventId: lower.eventId.toUpperCase(),
        receivedAt: after(MINUTE),
      });
      expect(upper.eventId).not.toBe(lower.eventId);

      expect(await subject.store.recordHeartbeat(lower)).toEqual(RECORDED);
      expect(await subject.store.recordHeartbeat(upper)).toEqual(RECORDED);

      expect(byEvent(await subject.heartbeatsOf(journeyId))).toEqual(
        byEvent([storedAs(lower), storedAs(upper)]),
      );
    },
  },
  {
    name: `LOST-01-AC4: ${String(RACERS)} copies of one heartbeat at once, ${String(RACE_ROUNDS)} times over: exactly one is recorded and every other is a duplicate, none an error, leaving one heartbeat and one position`,
    async run(subject) {
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const { journeyId } = await journeyFor(subject);
        const heartbeat = heartbeatFor(journeyId);

        // Promise.all rejects if any copy fails outright: "none is an error".
        const results = await Promise.all(
          Array.from({ length: RACERS }, () => subject.store.recordHeartbeat({ ...heartbeat })),
        );

        expect(results.map((result) => result.outcome).sort(), `round ${String(round)}`).toEqual(
          ['recorded', ...Array.from({ length: RACERS - 1 }, () => 'duplicate')].sort(),
        );
        expect(await subject.heartbeatsOf(journeyId), `round ${String(round)}`).toEqual([
          storedAs(heartbeat),
        ]);
        expect(await subject.positionsOf(journeyId), `round ${String(round)}`).toEqual(
          positionsCarried([heartbeat]),
        );
      }
    },
  },
  {
    name: 'LOST-01-AC5: for any receive times, written in any order, last contact is the greatest so far after every write and never moves backwards; the latest heartbeat is the one with the greatest receive time, a tie to the one stored last; and each is stored exactly once',
    async run(subject) {
      // Receive times from a span of 20 seconds, so ties happen; up to 12
      // writes, in whatever order the generator puts them.
      const planned = fc.array(
        fc.record({ second: fc.integer({ min: 0, max: 20 }), hasPosition: fc.boolean() }),
        { minLength: 1, maxLength: 12 },
      );

      await fc.assert(
        fc.asyncProperty(planned, async (writes) => {
          const { journeyId } = await journeyFor(subject);
          const written: HeartbeatToRecord[] = [];
          let greatest = Number.NEGATIVE_INFINITY;

          for (const [index, { second, hasPosition }] of writes.entries()) {
            const heartbeat = heartbeatFor(journeyId, {
              receivedAt: after(second * SECOND),
              // One battery level per write, so the latest can be told from a tie.
              batteryLevel: (2 * index + 1) / 64,
              position: hasPosition ? position() : null,
            });
            expect(await subject.store.recordHeartbeat(heartbeat)).toEqual(RECORDED);
            written.push(heartbeat);
            greatest = Math.max(greatest, heartbeat.receivedAt.getTime());

            expect((await subject.lastHeartbeatAt(journeyId))?.getTime()).toBe(greatest);
          }

          const latest = written.reduce((best, heartbeat) =>
            heartbeat.receivedAt.getTime() >= best.receivedAt.getTime() ? heartbeat : best,
          );
          expect(await subject.store.latestHeartbeatOf(journeyId)).toEqual({
            receivedAt: latest.receivedAt,
            hasPosition: latest.position !== null,
            batteryLevel: latest.batteryLevel,
          });
          expect(byEvent(await subject.heartbeatsOf(journeyId))).toEqual(
            byEvent(written.map(storedAs)),
          );
          expect(byEvent(await subject.positionsOf(journeyId))).toEqual(
            byEvent(positionsCarried(written)),
          );
        }),
        { numRuns: subject.propertyRuns },
      );
    },
  },
  {
    name: `LOST-01-AC5: ${String(RACERS)} heartbeats written at once, started in an order unrelated to their receive times: last contact is the greatest receive time, and each is stored once`,
    async run(subject) {
      const { journeyId } = await journeyFor(subject);
      // 0, 7, 4, 1, 8, … seconds: every offset once, out of step with the
      // order the writes are started in.
      const heartbeats = Array.from({ length: RACERS }, (_, index) =>
        heartbeatFor(journeyId, { receivedAt: after(((index * 7) % RACERS) * SECOND) }),
      );

      const results = await Promise.all(
        heartbeats.map((heartbeat) => subject.store.recordHeartbeat(heartbeat)),
      );

      expect(results).toEqual(heartbeats.map(() => RECORDED));
      expect(await subject.lastHeartbeatAt(journeyId)).toEqual(after((RACERS - 1) * SECOND));
      expect(byEvent(await subject.heartbeatsOf(journeyId))).toEqual(
        byEvent(heartbeats.map(storedAs)),
      );
    },
  },
  {
    name: 'LOST-01-AC5: a heartbeat received before the journey’s last contact is stored, and last contact stays where it was',
    async run(subject) {
      const { journeyId } = await journeyFor(subject, { lastHeartbeatAt: after(HOUR) });
      const earlier = heartbeatFor(journeyId);

      expect(await subject.store.recordHeartbeat(earlier)).toEqual(RECORDED);

      expect(await subject.heartbeatsOf(journeyId)).toEqual([storedAs(earlier)]);
      expect(await subject.lastHeartbeatAt(journeyId)).toEqual(after(HOUR));
    },
  },
  {
    name: 'LOST-01-AC6: the phone’s time is stored as given, hours ahead of the receive time or hours behind it, and last contact and the latest heartbeat follow the receive times only',
    async run(subject) {
      const { journeyId } = await journeyFor(subject);
      const ahead = heartbeatFor(journeyId, {
        receivedAt: RECEIVED_AT,
        position: toStoredPosition(syntheticPosition({ recordedAt: after(5 * HOUR) })),
      });
      const behind = heartbeatFor(journeyId, {
        receivedAt: after(MINUTE),
        position: toStoredPosition(syntheticPosition({ recordedAt: after(-7 * HOUR) })),
      });

      expect(await subject.store.recordHeartbeat(ahead)).toEqual(RECORDED);
      expect(await subject.store.recordHeartbeat(behind)).toEqual(RECORDED);

      expect(byEvent(await subject.positionsOf(journeyId))).toEqual(
        byEvent(positionsCarried([ahead, behind])),
      );
      expect(await subject.lastHeartbeatAt(journeyId)).toEqual(behind.receivedAt);
      expect(await subject.store.latestHeartbeatOf(journeyId)).toEqual({
        receivedAt: behind.receivedAt,
        hasPosition: true,
        batteryLevel: behind.batteryLevel,
      });
    },
  },
  {
    name: 'LOST-01-AC7: a heartbeat for a journey already ENDED in the store is answered ended, with a position or without: nothing is stored, and last contact is unchanged',
    async run(subject) {
      const { journeyId } = await journeyFor(subject, { state: 'ENDED', lastHeartbeatAt: EARLIER });

      for (const heartbeat of [
        heartbeatFor(journeyId),
        heartbeatFor(journeyId, { position: null, receivedAt: after(MINUTE) }),
      ]) {
        expect(await subject.store.recordHeartbeat(heartbeat)).toEqual(ENDED);
      }

      expect(await subject.heartbeatsOf(journeyId)).toEqual([]);
      expect(await subject.positionsOf(journeyId)).toEqual([]);
      expect(await subject.lastHeartbeatAt(journeyId)).toEqual(EARLIER);
      expect(await subject.stateOf(journeyId)).toBe('ENDED');
    },
  },
  {
    name: 'LOST-01-AC7: once a journey has ended, even an event ID it already has is answered ended, not duplicate, and nothing it holds changes',
    async run(subject) {
      const { journeyId } = await journeyFor(subject);
      const before = heartbeatFor(journeyId);
      expect(await subject.store.recordHeartbeat(before)).toEqual(RECORDED);
      await subject.endJourney(journeyId);

      for (const heartbeat of [
        { ...before, receivedAt: after(MINUTE) },
        heartbeatFor(journeyId, { receivedAt: after(2 * MINUTE) }),
      ]) {
        expect(await subject.store.recordHeartbeat(heartbeat)).toEqual(ENDED);
      }

      expect(await subject.heartbeatsOf(journeyId)).toEqual([storedAs(before)]);
      expect(await subject.positionsOf(journeyId)).toEqual(positionsCarried([before]));
      expect(await subject.lastHeartbeatAt(journeyId)).toEqual(before.receivedAt);
    },
  },
  {
    // RG-03 (LOST-03, the spec's "Existing assertions that change by
    // design"): this was "…and the journey stays LOST_CONTACT", for any
    // heartbeat. Since LOST-03 a heartbeat that leaves the silence under five
    // minutes brings the journey back (LOST-03-AC2), so "stays LOST_CONTACT"
    // holds only for one received five minutes or more before the store's
    // now. The heartbeat here was always that stale, by accident of the fixed
    // RECEIVED_AT against the stores' clocks; its times are now written
    // relative to the store's own now, so it is stale on purpose. Every
    // assertion is the one it had.
    name: 'LOST-01-AC8: a heartbeat for a journey in LOST_CONTACT is recorded and advances last contact; received five minutes or more before the store’s now, it brings nothing back, and the journey stays LOST_CONTACT (LOST-03-AC2)',
    async run(subject) {
      const now = await subject.now();
      const { journeyId } = await journeyFor(subject, {
        state: 'LOST_CONTACT',
        lastHeartbeatAt: ago(now, 2 * HOUR),
      });
      const heartbeat = heartbeatFor(journeyId, { receivedAt: ago(now, HOUR) });

      expect(await subject.store.recordHeartbeat(heartbeat)).toEqual(RECORDED);

      expect(await subject.heartbeatsOf(journeyId)).toEqual([storedAs(heartbeat)]);
      expect(await subject.lastHeartbeatAt(journeyId)).toEqual(heartbeat.receivedAt);
      expect(await subject.stateOf(journeyId)).toBe('LOST_CONTACT');
    },
  },
  {
    name: 'LOST-01-AC13: a heartbeat whose position is refused leaves nothing behind: no heartbeat, no position, last contact unchanged; and the same event is then recorded, not a duplicate',
    async run(subject) {
      const { journeyId } = await journeyFor(subject, { lastHeartbeatAt: EARLIER });
      const refused = heartbeatFor(journeyId, { position: { ...position(), latitude: 90.5 } });

      await expect(subject.store.recordHeartbeat(refused)).rejects.toThrow();

      expect(await subject.heartbeatsOf(journeyId)).toEqual([]);
      expect(await subject.positionsOf(journeyId)).toEqual([]);
      expect(await subject.lastHeartbeatAt(journeyId)).toEqual(EARLIER);

      const retried = { ...refused, position: position() };
      expect(await subject.store.recordHeartbeat(retried)).toEqual(RECORDED);
      expect(await subject.heartbeatsOf(journeyId)).toEqual([storedAs(retried)]);
      expect(await subject.positionsOf(journeyId)).toEqual(positionsCarried([retried]));
    },
  },
  {
    name: 'LOST-01-AC18: a latitude, longitude, accuracy, battery level or event ID outside the contract’s rules is refused by the store, and nothing is stored',
    async run(subject) {
      const { journeyId } = await journeyFor(subject);
      const at = (given: Partial<NonNullable<HeartbeatToRecord['position']>>) =>
        heartbeatFor(journeyId, { position: { ...position(), ...given } });
      const refused: readonly { what: string; heartbeat: HeartbeatToRecord }[] = [
        { what: 'a latitude above 90', heartbeat: at({ latitude: 90.0000001 }) },
        { what: 'a latitude below -90', heartbeat: at({ latitude: -90.0000001 }) },
        { what: 'a latitude that is not a number', heartbeat: at({ latitude: Number.NaN }) },
        { what: 'an infinite latitude', heartbeat: at({ latitude: Number.POSITIVE_INFINITY }) },
        { what: 'a longitude above 180', heartbeat: at({ longitude: 180.0000001 }) },
        { what: 'a longitude below -180', heartbeat: at({ longitude: -180.0000001 }) },
        { what: 'a longitude that is not a number', heartbeat: at({ longitude: Number.NaN }) },
        {
          what: 'an infinite longitude',
          heartbeat: at({ longitude: Number.NEGATIVE_INFINITY }),
        },
        { what: 'a negative accuracy', heartbeat: at({ accuracyMeters: -0.125 }) },
        { what: 'an accuracy that is not a number', heartbeat: at({ accuracyMeters: Number.NaN }) },
        {
          what: 'an infinite accuracy',
          heartbeat: at({ accuracyMeters: Number.POSITIVE_INFINITY }),
        },
        {
          what: 'a battery level above 1',
          heartbeat: heartbeatFor(journeyId, { batteryLevel: 1.015625 }),
        },
        {
          what: 'a battery level below 0',
          heartbeat: heartbeatFor(journeyId, { batteryLevel: -0.015625 }),
        },
        {
          what: 'a battery level that is not a number',
          heartbeat: heartbeatFor(journeyId, { batteryLevel: Number.NaN }),
        },
        { what: 'an empty event ID', heartbeat: heartbeatFor(journeyId, { eventId: '' }) },
        {
          what: 'an event ID of 65 characters',
          heartbeat: heartbeatFor(journeyId, { eventId: syntheticEventId().padEnd(65, 'f') }),
        },
        {
          what: 'an event ID with an underscore',
          heartbeat: heartbeatFor(journeyId, { eventId: 'synthetic_event' }),
        },
        {
          what: 'an event ID with a dot',
          heartbeat: heartbeatFor(journeyId, { eventId: 'synthetic.event' }),
        },
        {
          what: 'an event ID with a space',
          heartbeat: heartbeatFor(journeyId, { eventId: 'synthetic event' }),
        },
        {
          what: 'an event ID with a letter outside ASCII',
          heartbeat: heartbeatFor(journeyId, { eventId: 'synthetic-ø' }),
        },
      ];

      for (const { what, heartbeat } of refused) {
        await expect(subject.store.recordHeartbeat(heartbeat), what).rejects.toThrow();
      }

      expect(await subject.heartbeatsOf(journeyId)).toEqual([]);
      expect(await subject.positionsOf(journeyId)).toEqual([]);
      expect(await subject.lastHeartbeatAt(journeyId)).toBeNull();
    },
  },
  {
    name: 'LOST-01-AC18: the boundaries are accepted: latitude ±90, longitude ±180, accuracy 0, battery 0 and 1, and an event ID of 64 characters',
    async run(subject) {
      const { journeyId } = await journeyFor(subject);
      const at = (given: Partial<NonNullable<HeartbeatToRecord['position']>>) =>
        heartbeatFor(journeyId, { position: { ...position(), ...given } });
      const accepted = [
        at({ latitude: 90 }),
        at({ latitude: -90 }),
        at({ longitude: 180 }),
        at({ longitude: -180 }),
        at({ accuracyMeters: 0 }),
        heartbeatFor(journeyId, { batteryLevel: 0 }),
        heartbeatFor(journeyId, { batteryLevel: 1 }),
        heartbeatFor(journeyId, { eventId: syntheticEventId().padEnd(64, 'f') }),
        // The shortest event ID, and the one character allowed that is not a
        // letter or a digit: a store, or a check constraint, that wanted one
        // of those would refuse it (test-auditor, LOST-01 loop 1).
        heartbeatFor(journeyId, { eventId: '-' }),
      ];

      for (const heartbeat of accepted) {
        expect(await subject.store.recordHeartbeat(heartbeat)).toEqual(RECORDED);
      }

      expect(byEvent(await subject.heartbeatsOf(journeyId))).toEqual(
        byEvent(accepted.map(storedAs)),
      );
      expect(byEvent(await subject.positionsOf(journeyId))).toEqual(
        byEvent(positionsCarried(accepted)),
      );
    },
  },
  {
    name: 'LOST-01-AC18: a phone time whose instant in UTC falls outside the years 0001 to 9999 is refused by the store, as PostgreSQL refuses it, and nothing is stored; the same event with a phone time inside them is then recorded',
    async run(subject) {
      const { journeyId } = await journeyFor(subject, { lastHeartbeatAt: EARLIER });
      const refused = PHONE_TIMES_OUT_OF_RANGE.map((recordedAt) =>
        heartbeatFor(journeyId, { position: { ...position(), recordedAt: new Date(recordedAt) } }),
      );

      for (const heartbeat of refused) {
        const recordedAt = heartbeat.position?.recordedAt ?? new Date(Number.NaN);
        // Each is a real instant, so a refusal is the range's doing, not an invalid date's.
        expect(Number.isNaN(recordedAt.getTime()), recordedAt.toISOString()).toBe(false);
        await expect(
          subject.store.recordHeartbeat(heartbeat),
          recordedAt.toISOString(),
        ).rejects.toThrow();
      }

      expect(await subject.heartbeatsOf(journeyId)).toEqual([]);
      expect(await subject.positionsOf(journeyId)).toEqual([]);
      expect(await subject.lastHeartbeatAt(journeyId)).toEqual(EARLIER);

      const [first] = refused;
      const retried = { ...(first ?? heartbeatFor(journeyId)), position: position() };
      expect(await subject.store.recordHeartbeat(retried)).toEqual(RECORDED);
      expect(await subject.heartbeatsOf(journeyId)).toEqual([storedAs(retried)]);
      expect(await subject.positionsOf(journeyId)).toEqual(positionsCarried([retried]));
    },
  },
  {
    name: 'LOST-01-AC18: the first and the last instant of the years 0001 to 9999 in UTC are accepted as phone times, and stored exactly as given',
    async run(subject) {
      const { journeyId } = await journeyFor(subject);
      const accepted = PHONE_TIMES_AT_THE_EDGES.map((recordedAt) =>
        heartbeatFor(journeyId, { position: { ...position(), recordedAt: new Date(recordedAt) } }),
      );

      for (const heartbeat of accepted) {
        expect(
          await subject.store.recordHeartbeat(heartbeat),
          heartbeat.position?.recordedAt.toISOString(),
        ).toEqual(RECORDED);
      }

      expect(byEvent(await subject.positionsOf(journeyId))).toEqual(
        byEvent(positionsCarried(accepted)),
      );
    },
  },
  {
    name: 'a heartbeat for a journey that does not exist is refused: the store rejects, and stores nothing',
    async run(subject) {
      const missing = syntheticUuid();

      await expect(subject.store.recordHeartbeat(heartbeatFor(missing))).rejects.toThrow();

      expect(await subject.heartbeatsOf(missing)).toEqual([]);
    },
  },
  {
    name: 'LOST-02-AC2: the overdue read returns exactly the ACTIVE journeys silent for five minutes or more, counted from last contact, or from the start when there is none, each with when its silence began, and the store’s now; and now when nothing is overdue',
    async run(subject) {
      const margin = subject.timeMarginMs;
      const now = await subject.now();
      // At the threshold itself against the fake; a margin either side of it
      // against the database, whose now() moves on while this runs.
      const over = LOST_CONTACT_AFTER_MS + margin;
      const under = LOST_CONTACT_AFTER_MS - Math.max(1, margin);
      const lastOver = await watched(subject, {
        startedAt: ago(now, HOUR),
        lastHeartbeatAt: ago(now, over),
      });
      const lastUnder = await watched(subject, {
        startedAt: ago(now, HOUR),
        lastHeartbeatAt: ago(now, under),
      });
      const startOver = await watched(subject, { startedAt: ago(now, over) });
      const startUnder = await watched(subject, { startedAt: ago(now, under) });
      const lost = await watched(subject, {
        state: 'LOST_CONTACT',
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, HOUR),
      });
      const ended = await watched(subject, {
        state: 'ENDED',
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, HOUR),
      });
      const mine = [lastOver, lastUnder, startOver, startUnder, lost, ended].map(
        ({ journeyId }) => journeyId,
      );

      const before = await subject.now();
      const read = await subject.store.overdueJourneys(LOST_CONTACT_AFTER_MS);
      const after = await subject.now();

      expect(read.now.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(read.now.getTime()).toBeLessThanOrEqual(after.getTime());
      const found = read.journeys
        .filter(({ id }) => mine.includes(id))
        .sort((a, b) => a.id.localeCompare(b.id));
      expect(found).toEqual(
        [
          { id: lastOver.journeyId, state: 'ACTIVE', silentSince: ago(now, over) },
          { id: startOver.journeyId, state: 'ACTIVE', silentSince: ago(now, over) },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      );

      // Nothing has been silent for a century: no journey, and now all the same.
      const none = await subject.store.overdueJourneys(100 * 365 * 24 * HOUR);
      expect(none.journeys).toEqual([]);
      expect(none.now.getTime()).toBeGreaterThanOrEqual(before.getTime());
    },
  },
  {
    name: 'LOST-02-AC2: for any journeys, in any state, silent for any time, with or without a heartbeat, one sweep moves exactly the ACTIVE ones silent five minutes or more to LOST_CONTACT, each with one OPEN alert silent since its silence began, and leaves every other one as it was',
    async run(subject) {
      const margin = subject.timeMarginMs;
      const journey = fc.record({
        state: fc.constantFrom(...STATES),
        silentForMs: silences(margin),
        heartbeat: fc.boolean(),
        startedBeforeMs: fc.integer({ min: 0, max: HOUR }),
      });

      await fc.assert(
        fc.asyncProperty(fc.array(journey, { minLength: 1, maxLength: 4 }), async (given) => {
          const now = await subject.now();
          const seeded = [];
          for (const one of given) {
            const silentSince = ago(now, one.silentForMs);
            const { journeyId } = await watched(subject, {
              state: one.state,
              startedAt: one.heartbeat
                ? ago(now, one.silentForMs + one.startedBeforeMs)
                : silentSince,
              lastHeartbeatAt: one.heartbeat ? silentSince : null,
            });
            seeded.push({ ...one, journeyId, silentSince });
          }

          await sweepOf(
            subject,
            seeded.map(({ journeyId }) => journeyId),
          );

          for (const one of seeded) {
            const moved = one.state === 'ACTIVE' && one.silentForMs >= LOST_CONTACT_AFTER_MS;
            expect(await subject.stateOf(one.journeyId)).toBe(moved ? 'LOST_CONTACT' : one.state);
            expect(
              (await subject.alertsOf(one.journeyId)).map(({ state, silentSince }) => ({
                state,
                silentSince,
              })),
            ).toEqual(moved ? [{ state: 'OPEN', silentSince: one.silentSince }] : []);
          }
        }),
        { numRuns: subject.propertyRuns },
      );
    },
  },
  {
    // RG-03 (LOST-03, the spec's "Existing assertions that change by
    // design"): this was "…a journey is LOST_CONTACT after a sweep exactly
    // when some sweep so far found it silent five minutes or more, and a
    // heartbeat after that does not move it back". LOST-03-AC5's property
    // replaces that last clause: a heartbeat that leaves the silence under
    // five minutes now moves the journey back, and resolves its alert. The
    // rest stands, stated step by step: a sweep still moves the journey to
    // LOST_CONTACT exactly when it has been silent five minutes or more, with
    // one alert; and every step is now checked, a heartbeat's answer
    // included, where only sweeps were.
    name: 'LOST-02-AC2 and LOST-03-AC5: for any sequence of heartbeats, fresh or stale, received in any order, and sweeps between them, after every step the store agrees with the rules applied step by step: a sweep moves the journey to LOST_CONTACT exactly when it has been silent five minutes or more, and a heartbeat that leaves its silence under five minutes moves it back; exactly one unresolved alert while it is LOST_CONTACT and none while it is ACTIVE; one stand-down per responder for each resolved alert, and none for an unresolved one',
    async run(subject) {
      const margin = subject.timeMarginMs;
      const step = fc.oneof(
        fc.record({ kind: fc.constant('heartbeat' as const), agoMs: silences(margin) }),
        fc.record({ kind: fc.constant('sweep' as const) }),
      );

      await fc.assert(
        fc.asyncProperty(
          silences(margin),
          fc.array(step, { maxLength: 8 }),
          async (startedAgoMs, steps) => {
            const now = await subject.now();
            const { journeyId, responderIds } = await watched(subject, {
              startedAt: ago(now, startedAgoMs),
              responders: 2,
            });
            // The rules, applied step by step: the silence at `now`, counted
            // from last contact or from the start, and what it has made of
            // the journey so far.
            let silentForMs = startedAgoMs;
            let state: 'ACTIVE' | 'LOST_CONTACT' = 'ACTIVE';
            let opened = 0;
            let resolved = 0;

            for (const next of steps) {
              if (next.kind === 'heartbeat') {
                // Never before the start: contact comes after a journey began.
                const agoMs = Math.min(next.agoMs, startedAgoMs);
                const result = await subject.store.recordHeartbeat(
                  heartbeatFor(journeyId, { receivedAt: ago(now, agoMs), position: null }),
                );
                silentForMs = Math.min(silentForMs, agoMs);
                const back = state === 'LOST_CONTACT' && silentForMs < LOST_CONTACT_AFTER_MS;
                expect(result.outcome, 'the heartbeat’s answer').toBe(
                  back ? 'back_in_contact' : 'recorded',
                );
                if (back) {
                  state = 'ACTIVE';
                  resolved += 1;
                }
              } else {
                await sweepOf(subject, [journeyId]);
                if (state === 'ACTIVE' && silentForMs >= LOST_CONTACT_AFTER_MS) {
                  state = 'LOST_CONTACT';
                  opened += 1;
                }
              }

              expect(await subject.stateOf(journeyId)).toBe(state);
              const alerts = await subject.alertsOf(journeyId);
              expect(alerts).toHaveLength(opened);
              expect(alerts.filter((alert) => alert.state !== 'RESOLVED')).toHaveLength(
                state === 'LOST_CONTACT' ? 1 : 0,
              );
              expect(alerts.filter((alert) => alert.state === 'RESOLVED')).toHaveLength(resolved);
              const messages = await subject.messagesOf(journeyId);
              for (const alert of alerts) {
                const standDowns = messages.filter(
                  ({ alertId, kind }) => alertId === alert.id && kind !== 'LOST_CONTACT',
                );
                expect(recipientsOf(standDowns), alert.state).toEqual(
                  alert.state === 'RESOLVED' ? [...responderIds].sort() : [],
                );
                expect(standDowns.map(({ kind }) => kind)).toEqual(
                  standDowns.map(() => 'BACK_IN_CONTACT'),
                );
              }
            }
          },
        ),
        {
          numRuns: subject.propertyRuns,
          // LOST-03 review loop 1 (the spec's item 8): one fixed sequence
          // that brings the journey back, run first, so even the database's
          // few runs reach the move: silent two hours, swept (opened), a
          // heartbeat received at now (back in contact), swept again
          // (nothing opens).
          examples: [
            [2 * HOUR, [{ kind: 'sweep' }, { kind: 'heartbeat', agoMs: 0 }, { kind: 'sweep' }]],
          ],
        },
      );
    },
  },
  {
    name: 'LOST-02-AC3: a journey that never sent a heartbeat is timed from its start: not overdue a moment before five minutes have passed since it, overdue at five minutes, and its alert is silent since its start',
    async run(subject) {
      const margin = subject.timeMarginMs;
      const now = await subject.now();
      const under = await watched(subject, {
        startedAt: ago(now, LOST_CONTACT_AFTER_MS - Math.max(1, margin)),
      });
      const at = await watched(subject, { startedAt: ago(now, LOST_CONTACT_AFTER_MS + margin) });

      const read = await subject.store.overdueJourneys(LOST_CONTACT_AFTER_MS);

      expect(
        read.journeys
          .filter(({ id }) => id === under.journeyId || id === at.journeyId)
          .map(({ id }) => id),
      ).toEqual([at.journeyId]);
      expect(
        await subject.store.openLostContactAlert({
          journeyId: under.journeyId,
          afterMs: LOST_CONTACT_AFTER_MS,
        }),
      ).toEqual({ outcome: 'skipped' });
      expect(
        (
          await subject.store.openLostContactAlert({
            journeyId: at.journeyId,
            afterMs: LOST_CONTACT_AFTER_MS,
          })
        ).outcome,
      ).toBe('opened');
      expect(await subject.stateOf(under.journeyId)).toBe('ACTIVE');
      expect(await subject.alertsOf(under.journeyId)).toEqual([]);
      expect((await subject.alertsOf(at.journeyId)).map(({ silentSince }) => silentSince)).toEqual([
        ago(now, LOST_CONTACT_AFTER_MS + margin),
      ]);
    },
  },
  {
    name: 'LOST-02-AC9: opening moves an overdue ACTIVE journey to LOST_CONTACT, with one OPEN alert opened at the store’s now and silent since its last contact, and one LOST_CONTACT message per responder, each with a fresh ID, not sent and due at once; the walker gets none',
    async run(subject) {
      const now = await subject.now();
      const silentSince = ago(now, LOST_CONTACT_AFTER_MS + MINUTE);
      const journey = await watched(subject, {
        startedAt: ago(now, HOUR),
        lastHeartbeatAt: silentSince,
        responders: 3,
      });

      const before = await subject.now();
      const result = await subject.store.openLostContactAlert({
        journeyId: journey.journeyId,
        afterMs: LOST_CONTACT_AFTER_MS,
      });
      const after = await subject.now();

      if (result.outcome !== 'opened') {
        throw new Error('expected the overdue journey to be opened, but it was skipped');
      }
      expect(result.alertId).toMatch(LOWER_UUID);
      expect(result.messages.map(({ recipientId }) => recipientId).sort()).toEqual(
        [...journey.responderIds].sort(),
      );
      expect(result.messages.map(({ kind }) => kind)).toEqual([
        'LOST_CONTACT',
        'LOST_CONTACT',
        'LOST_CONTACT',
      ]);
      const messageIds = result.messages.map(({ messageId }) => messageId);
      expect(new Set(messageIds).size).toBe(3);
      for (const messageId of messageIds) {
        expect(messageId).toMatch(LOWER_UUID);
      }
      const others = [
        journey.journeyId,
        result.alertId,
        journey.walkerId,
        journey.deviceId,
        ...journey.responderIds,
      ];
      expect(messageIds.filter((messageId) => others.includes(messageId))).toEqual([]);

      expect(await subject.stateOf(journey.journeyId)).toBe('LOST_CONTACT');
      const alerts = await subject.alertsOf(journey.journeyId);
      expect(
        alerts.map(({ id, state, silentSince: since }) => ({ id, state, silentSince: since })),
      ).toEqual([{ id: result.alertId, state: 'OPEN', silentSince }]);
      const openedAt = alerts[0]?.openedAt.getTime() ?? Number.NaN;
      expect(openedAt).toBeGreaterThanOrEqual(before.getTime());
      expect(openedAt).toBeLessThanOrEqual(after.getTime());

      const messages = await subject.messagesOf(journey.journeyId);
      expect(
        byMessage(
          messages.map(
            ({ messageId, alertId, recipientId, kind, attempts, sentAt, lastFailure }) => ({
              messageId,
              alertId,
              recipientId,
              kind,
              attempts,
              sentAt,
              lastFailure,
            }),
          ),
        ),
      ).toEqual(
        byMessage(
          result.messages.map((message) => ({
            ...message,
            alertId: result.alertId,
            attempts: 0,
            sentAt: null,
            lastFailure: null,
          })),
        ),
      );
      for (const message of messages) {
        expect(message.nextAttemptAt.getTime()).toBeLessThanOrEqual(after.getTime());
      }
      expect(messages.filter(({ recipientId }) => recipientId === journey.walkerId)).toEqual([]);
    },
  },
  {
    name: 'LOST-02-AC9: opening skips, and writes nothing, for a journey not yet overdue, already LOST_CONTACT, ENDED, or not there at all',
    async run(subject) {
      const now = await subject.now();
      const recent = await watched(subject, {
        startedAt: ago(now, HOUR),
        lastHeartbeatAt: ago(now, 4 * MINUTE),
      });
      const lost = await watched(subject, {
        state: 'LOST_CONTACT',
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, HOUR),
      });
      const ended = await watched(subject, {
        state: 'ENDED',
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, HOUR),
      });
      const cases = [
        { journeyId: recent.journeyId, state: 'ACTIVE' },
        { journeyId: lost.journeyId, state: 'LOST_CONTACT' },
        { journeyId: ended.journeyId, state: 'ENDED' },
        { journeyId: syntheticUuid(), state: null },
      ];

      for (const { journeyId, state } of cases) {
        expect(
          await subject.store.openLostContactAlert({ journeyId, afterMs: LOST_CONTACT_AFTER_MS }),
          String(state),
        ).toEqual({ outcome: 'skipped' });
        expect(await subject.stateOf(journeyId), String(state)).toBe(state);
        expect(await subject.alertsOf(journeyId), String(state)).toEqual([]);
        expect(await subject.messagesOf(journeyId), String(state)).toEqual([]);
      }
    },
  },
  {
    name: 'LOST-02-AC9: contact stored between the overdue read and the open wins: the open skips and writes nothing, and the journey stays ACTIVE; and a journey whose state changed in between is skipped too',
    async run(subject) {
      const now = await subject.now();
      const silent = await watched(subject, {
        startedAt: ago(now, HOUR),
        lastHeartbeatAt: ago(now, LOST_CONTACT_AFTER_MS + MINUTE),
      });
      const ending = await watched(subject, {
        startedAt: ago(now, HOUR),
        lastHeartbeatAt: ago(now, LOST_CONTACT_AFTER_MS + MINUTE),
      });

      const read = await subject.store.overdueJourneys(LOST_CONTACT_AFTER_MS);
      expect(read.journeys.map(({ id }) => id)).toEqual(
        expect.arrayContaining([silent.journeyId, ending.journeyId]),
      );
      // Contact arrives, received at the store's now, after the read.
      expect(
        await subject.store.recordHeartbeat(
          heartbeatFor(silent.journeyId, { receivedAt: await subject.now() }),
        ),
      ).toEqual(RECORDED);
      await subject.endJourney(ending.journeyId);

      for (const { journeyId, state } of [
        { journeyId: silent.journeyId, state: 'ACTIVE' },
        { journeyId: ending.journeyId, state: 'ENDED' },
      ]) {
        expect(
          await subject.store.openLostContactAlert({ journeyId, afterMs: LOST_CONTACT_AFTER_MS }),
          state,
        ).toEqual({ outcome: 'skipped' });
        expect(await subject.stateOf(journeyId), state).toBe(state);
        expect(await subject.alertsOf(journeyId), state).toEqual([]);
        expect(await subject.messagesOf(journeyId), state).toEqual([]);
      }
    },
  },
  {
    name: 'LOST-02-AC5: a journey already alerted is never opened again: a second open skips, and it keeps its one alert and its messages as they were',
    async run(subject) {
      const { journeyId, alertId } = await openedWith(subject, 2);
      const alerts = await subject.alertsOf(journeyId);
      const messages = byMessage(await subject.messagesOf(journeyId));

      expect(
        await subject.store.openLostContactAlert({ journeyId, afterMs: LOST_CONTACT_AFTER_MS }),
      ).toEqual({ outcome: 'skipped' });
      expect(await sweepOf(subject, [journeyId])).toEqual([]);

      expect(await subject.alertsOf(journeyId)).toEqual(alerts);
      expect(alerts.map(({ id }) => id)).toEqual([alertId]);
      expect(byMessage(await subject.messagesOf(journeyId))).toEqual(messages);
      expect(await subject.stateOf(journeyId)).toBe('LOST_CONTACT');
    },
  },
  {
    name: 'LOST-02-AC12: a journey with no responder rows is never moved: the open rejects, and it stays ACTIVE with no alert and no message',
    async run(subject) {
      const now = await subject.now();
      const { journeyId } = await watched(subject, {
        startedAt: ago(now, HOUR),
        lastHeartbeatAt: ago(now, LOST_CONTACT_AFTER_MS + MINUTE),
        responders: 0,
      });

      await expect(
        subject.store.openLostContactAlert({ journeyId, afterMs: LOST_CONTACT_AFTER_MS }),
      ).rejects.toThrow();

      expect(await subject.stateOf(journeyId)).toBe('ACTIVE');
      expect(await subject.alertsOf(journeyId)).toEqual([]);
      expect(await subject.messagesOf(journeyId)).toEqual([]);
      // Still overdue, so the next sweep tries again, and the watchdog reports it.
      const read = await subject.store.overdueJourneys(LOST_CONTACT_AFTER_MS);
      expect(read.journeys.map(({ id }) => id)).toContain(journeyId);
    },
  },
  {
    name: 'LOST-02-AC8: a journey whose row another transaction holds is skipped at once, not waited for, and changes nothing; once released, it is opened',
    async run(subject) {
      const now = await subject.now();
      const { journeyId } = await watched(subject, {
        startedAt: ago(now, HOUR),
        lastHeartbeatAt: ago(now, LOST_CONTACT_AFTER_MS + MINUTE),
      });
      const holder = await subject.hold(journeyId);

      try {
        expect(
          await within(
            2_000,
            subject.store.openLostContactAlert({ journeyId, afterMs: LOST_CONTACT_AFTER_MS }),
            'the open of a held journey',
          ),
        ).toEqual({ outcome: 'skipped' });
        // The plain read is not blocked by the hold either.
        const read = await within(
          2_000,
          subject.store.overdueJourneys(LOST_CONTACT_AFTER_MS),
          'the overdue read',
        );
        expect(read.journeys.map(({ id }) => id)).toContain(journeyId);
      } finally {
        await holder.release();
      }

      expect(await subject.stateOf(journeyId)).toBe('ACTIVE');
      expect(await subject.alertsOf(journeyId)).toEqual([]);
      expect(
        (await subject.store.openLostContactAlert({ journeyId, afterMs: LOST_CONTACT_AFTER_MS }))
          .outcome,
      ).toBe('opened');
      expect(await subject.alertsOf(journeyId)).toHaveLength(1);
    },
  },
  {
    name: 'LOST-02-AC20: an open with a lock wait answers held when the row stays held, opened when it is let go unchanged, and skipped when it is let go no longer overdue',
    async run(subject) {
      const now = await subject.now();
      const overdue = () =>
        watched(subject, {
          startedAt: ago(now, HOUR),
          lastHeartbeatAt: ago(now, LOST_CONTACT_AFTER_MS + MINUTE),
          responders: 2,
        });
      const waitingOpen = (journeyId: string) =>
        subject.store.openLostContactAlert({
          journeyId,
          afterMs: LOST_CONTACT_AFTER_MS,
          lockWaitMs: subject.lockWaitMs,
        });

      // Held throughout: the wait runs out. The open answers, rather than
      // throwing, and writes nothing.
      const stays = await overdue();
      const holder = await subject.hold(stays.journeyId);
      let held: OpenLostContactAlertResult;
      try {
        held = await within(
          subject.lockWaitMs + 5_000,
          waitingOpen(stays.journeyId),
          'the waiting open of a row held throughout',
        );
      } finally {
        await holder.release();
      }
      expect(held).toEqual({ outcome: 'held' });
      expect(await subject.stateOf(stays.journeyId)).toBe('ACTIVE');
      expect(await subject.alertsOf(stays.journeyId)).toEqual([]);
      expect(await subject.messagesOf(stays.journeyId)).toEqual([]);

      // Let go unchanged within the wait: still overdue, so opened.
      const unchanged = await overdue();
      const lettingGo = await subject.holdUntilWaited(unchanged.journeyId, 'unchanged');
      let opened: OpenLostContactAlertResult;
      try {
        opened = await waitingOpen(unchanged.journeyId);
      } finally {
        await lettingGo.release();
      }
      expect(opened.outcome).toBe('opened');
      expect(await subject.stateOf(unchanged.journeyId)).toBe('LOST_CONTACT');
      expect(await subject.alertsOf(unchanged.journeyId)).toHaveLength(1);
      expect(recipientsOf(await subject.messagesOf(unchanged.journeyId))).toEqual(
        [...unchanged.responderIds].sort(),
      );

      // Let go after contact came: no longer overdue, so skipped, and nothing written.
      const heard = await overdue();
      const lettingGoAfterContact = await subject.holdUntilWaited(heard.journeyId, 'contact');
      let skipped: OpenLostContactAlertResult;
      try {
        skipped = await waitingOpen(heard.journeyId);
      } finally {
        await lettingGoAfterContact.release();
      }
      expect(skipped).toEqual({ outcome: 'skipped' });
      expect(await subject.stateOf(heard.journeyId)).toBe('ACTIVE');
      expect(await subject.alertsOf(heard.journeyId)).toEqual([]);
      expect(await subject.messagesOf(heard.journeyId)).toEqual([]);
    },
  },
  {
    name: 'LOST-02-AC20: an open given a lockWaitMs that is not a whole number from 1 to 2147483647 (0, -1, 0.5, 1.5, NaN, 2147483648) is refused, naming lockWaitMs, and writes nothing',
    async run(subject) {
      const now = await subject.now();
      const overdue = () =>
        watched(subject, {
          startedAt: ago(now, 2 * HOUR),
          lastHeartbeatAt: ago(now, HOUR),
        });
      const { journeyId } = await overdue();

      // PostgreSQL reads a lock_timeout of 0 as no limit at all. 1.5 is
      // there for the whole-number rule alone: every other fraction is also
      // below 1, so a store that checked only the range would refuse them.
      for (const lockWaitMs of [0, -1, 0.5, 1.5, Number.NaN, 2_147_483_648]) {
        await expect(
          subject.store.openLostContactAlert({
            journeyId,
            afterMs: LOST_CONTACT_AFTER_MS,
            lockWaitMs,
          }),
          String(lockWaitMs),
        ).rejects.toThrow(/lockWaitMs/);
      }
      expect(await subject.stateOf(journeyId)).toBe('ACTIVE');
      expect(await subject.alertsOf(journeyId)).toEqual([]);
      expect(await subject.messagesOf(journeyId)).toEqual([]);

      // The bounds themselves are taken.
      for (const lockWaitMs of [1, 2_147_483_647]) {
        const { journeyId: another } = await overdue();
        const opened = await subject.store.openLostContactAlert({
          journeyId: another,
          afterMs: LOST_CONTACT_AFTER_MS,
          lockWaitMs,
        });
        expect(opened.outcome, String(lockWaitMs)).toBe('opened');
      }
    },
  },
  {
    name: 'LOST-02-AC20: a held row that no longer matches answers skipped at once to an open with a lock wait, never held: one already LOST_CONTACT, and one whose last contact has moved',
    async run(subject) {
      const now = await subject.now();
      const silentForAnHour = {
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, HOUR),
      };
      // Already alerted, silent for an hour.
      const alerted = await watched(subject, { ...silentForAnHour, state: 'LOST_CONTACT' });
      // Overdue, until contact came.
      const heard = await watched(subject, silentForAnHour);
      expect(
        await subject.store.recordHeartbeat(heartbeatFor(heard.journeyId, { receivedAt: now })),
      ).toEqual({ outcome: 'recorded' });

      for (const { journeyId } of [alerted, heard]) {
        const holder = await subject.hold(journeyId);
        let answer: OpenLostContactAlertResult;
        try {
          answer = await within(
            Math.min(500, subject.lockWaitMs / 2),
            subject.store.openLostContactAlert({
              journeyId,
              afterMs: LOST_CONTACT_AFTER_MS,
              lockWaitMs: subject.lockWaitMs,
            }),
            'the waiting open of a held row that no longer matches',
          );
        } finally {
          await holder.release();
        }
        expect(answer, journeyId).toEqual({ outcome: 'skipped' });
        expect(await subject.alertsOf(journeyId), journeyId).toEqual([]);
        expect(await subject.messagesOf(journeyId), journeyId).toEqual([]);
      }
      expect(await subject.stateOf(alerted.journeyId)).toBe('LOST_CONTACT');
      expect(await subject.stateOf(heard.journeyId)).toBe('ACTIVE');
    },
  },
  {
    name: `LOST-02-AC7: ${String(RACERS)} opens racing for one overdue journey, ${String(RACE_ROUNDS)} times over: exactly one opens and every other skips, none an error; one alert, and one message per responder`,
    async run(subject) {
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const now = await subject.now();
        const { journeyId, responderIds } = await watched(subject, {
          startedAt: ago(now, HOUR),
          lastHeartbeatAt: ago(now, LOST_CONTACT_AFTER_MS + MINUTE),
          responders: 2,
        });

        const results = await Promise.all(
          Array.from({ length: RACERS }, () =>
            subject.store.openLostContactAlert({ journeyId, afterMs: LOST_CONTACT_AFTER_MS }),
          ),
        );

        expect(results.map(({ outcome }) => outcome).sort(), `round ${String(round)}`).toEqual(
          ['opened', ...Array.from({ length: RACERS - 1 }, () => 'skipped')].sort(),
        );
        expect(await subject.alertsOf(journeyId), `round ${String(round)}`).toHaveLength(1);
        expect(
          (await subject.messagesOf(journeyId)).map(({ recipientId }) => recipientId).sort(),
          `round ${String(round)}`,
        ).toEqual([...responderIds].sort());
      }
    },
  },
  {
    name: 'LOST-02-AC14: a claim hands out each due message once: one attempt counted, leased until the claim’s now plus the lease, and not handed out again while the lease runs',
    async run(subject) {
      const { journeyId, messages } = await openedWith(subject, 3);
      const mine = messages.map(({ messageId }) => messageId);

      const before = await subject.now();
      const claim = await subject.store.claimDue({ limit: BATCH, leaseMs: LEASE_MS });
      const after = await subject.now();

      expect(claim.now.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(claim.now.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(byMessage(claim.messages.filter(({ messageId }) => mine.includes(messageId)))).toEqual(
        byMessage(messages.map((message) => ({ ...message, attempts: 1 }))),
      );
      for (const stored of await subject.messagesOf(journeyId)) {
        expect(stored.attempts).toBe(1);
        expect(stored.nextAttemptAt.getTime()).toBe(claim.now.getTime() + LEASE_MS);
        expect(stored.sentAt).toBeNull();
      }

      const again = await subject.store.claimDue({ limit: BATCH, leaseMs: LEASE_MS });
      expect(again.messages.filter(({ messageId }) => mine.includes(messageId))).toEqual([]);
    },
  },
  {
    name: 'LOST-02-AC14: a claim takes at most its limit, and the next claim takes the rest',
    async run(subject) {
      const { messages } = await openedWith(subject, 3);
      const mine = messages.map(({ messageId }) => messageId);

      const first = await subject.store.claimDue({ limit: 2, leaseMs: LEASE_MS });
      const second = await subject.store.claimDue({ limit: 2, leaseMs: LEASE_MS });

      expect(first.messages).toHaveLength(2);
      const claimed = [...first.messages, ...second.messages]
        .map(({ messageId }) => messageId)
        .filter((messageId) => mine.includes(messageId));
      expect([...claimed].sort()).toEqual([...mine].sort());
    },
  },
  {
    name: `LOST-02-AC7: ${String(RACERS)} claims racing: each due message is handed to exactly one of them`,
    async run(subject) {
      const { messages } = await openedWith(subject, 3);
      const mine = messages.map(({ messageId }) => messageId);

      const claims = await Promise.all(
        Array.from({ length: RACERS }, () =>
          subject.store.claimDue({ limit: BATCH, leaseMs: LEASE_MS }),
        ),
      );

      const handedOut = claims
        .flatMap((claim) => claim.messages.map(({ messageId }) => messageId))
        .filter((messageId) => mine.includes(messageId));
      expect([...handedOut].sort()).toEqual([...mine].sort());
    },
  },
  {
    name: 'LOST-02-AC15: a failed message keeps its reason and is due again after the delay given, with the same ID and one more attempt; a sent one is marked at the store’s now, and never handed out again',
    async run(subject) {
      const { journeyId, messages } = await openedWith(subject, 2);
      const [failing, sending] = byMessage(messages);
      if (failing === undefined || sending === undefined) {
        throw new Error('expected two messages');
      }
      const mine = [failing.messageId, sending.messageId];
      // RG-03 (LOST-02, review loop 1, test-auditor): claimed with no lease,
      // so both messages are due again at once, and only being sent keeps
      // the sent one from the retry's claim below. With a lease, the lease
      // alone kept it out, and a store that handed out sent messages passed.
      await subject.store.claimDue({ limit: BATCH, leaseMs: 0 });

      const before = await subject.now();
      await subject.store.markFailed({
        messageId: failing.messageId,
        reason: 'NO_TARGET',
        retryAfterMs: 0,
      });
      await subject.store.markSent(sending.messageId);
      const after = await subject.now();

      const stored = byMessage(await subject.messagesOf(journeyId));
      const [failed, sent] = stored;
      expect(failed).toMatchObject({
        messageId: failing.messageId,
        lastFailure: 'NO_TARGET',
        sentAt: null,
      });
      expect(failed?.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(failed?.nextAttemptAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(sent?.messageId).toBe(sending.messageId);
      expect(sent?.sentAt?.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(sent?.sentAt?.getTime()).toBeLessThanOrEqual(after.getTime());

      const retried = await subject.store.claimDue({ limit: BATCH, leaseMs: LEASE_MS });
      expect(retried.messages.filter(({ messageId }) => mine.includes(messageId))).toEqual([
        { ...failing, attempts: 2 },
      ]);

      await subject.store.markFailed({
        messageId: failing.messageId,
        reason: 'UNAVAILABLE',
        retryAfterMs: HOUR,
      });
      const later = await subject.store.claimDue({ limit: BATCH, leaseMs: LEASE_MS });
      expect(later.messages.filter(({ messageId }) => mine.includes(messageId))).toEqual([]);
      const waiting = (await subject.messagesOf(journeyId)).find(
        ({ messageId }) => messageId === failing.messageId,
      );
      expect(waiting?.lastFailure).toBe('UNAVAILABLE');
      expect(waiting?.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before.getTime() + HOUR);
    },
  },
  {
    name: 'LOST-02-AC16: a message marked sent again, as one sent again after its lease passed is, keeps the time it was first marked',
    async run(subject) {
      const { journeyId, messages } = await openedWith(subject, 1);
      const [message] = messages;
      if (message === undefined) {
        throw new Error('expected one message');
      }

      await subject.store.markSent(message.messageId);
      const [first] = await subject.messagesOf(journeyId);
      const firstSentAt = first?.sentAt?.getTime();
      expect(firstSentAt).toBeDefined();
      await subject.letTimePass(50);
      expect((await subject.now()).getTime()).toBeGreaterThan(firstSentAt ?? Number.NaN);
      await subject.store.markSent(message.messageId);

      const [again] = await subject.messagesOf(journeyId);
      expect(again?.sentAt?.getTime()).toBe(firstSentAt);
    },
  },
  {
    name: 'LOST-02-AC15: a failure reason outside the push port’s four is refused, and the message is left as it was',
    async run(subject) {
      const { journeyId, messages } = await openedWith(subject, 1);
      const [message] = messages;
      if (message === undefined) {
        throw new Error('expected one message');
      }
      const before = await subject.messagesOf(journeyId);

      for (const reason of ['TIMEOUT', 'no_target', '']) {
        await expect(
          subject.store.markFailed({
            messageId: message.messageId,
            reason: reason as PushFailureReason,
            retryAfterMs: MINUTE,
          }),
          reason,
        ).rejects.toThrow();
      }

      expect(await subject.messagesOf(journeyId)).toEqual(before);
    },
  },
  {
    name: 'LOST-02-AC13: the heartbeat received at the alert’s silent_since is the journey’s latest, with its battery level and whether it had a position',
    async run(subject) {
      const now = await subject.now();
      const { journeyId } = await watched(subject, { startedAt: ago(now, HOUR), responders: 2 });
      const earlier = heartbeatFor(journeyId, { receivedAt: ago(now, 10 * MINUTE) });
      const last = heartbeatFor(journeyId, { receivedAt: ago(now, 6 * MINUTE) });
      for (const heartbeat of [last, earlier]) {
        expect(await subject.store.recordHeartbeat(heartbeat)).toEqual(RECORDED);
      }

      await sweepOf(subject, [journeyId]);

      const [alert] = await subject.alertsOf(journeyId);
      expect(alert?.silentSince).toEqual(last.receivedAt);
      expect(await subject.store.latestHeartbeatOf(journeyId)).toEqual({
        receivedAt: alert?.silentSince,
        hasPosition: true,
        batteryLevel: last.batteryLevel,
      });
    },
  },

  // -------------------------------------------------------------------------
  // LOST-03: back in contact, resolving an alert, and "I'm home" (the spec's
  // test plan: "The store's side of AC2, AC4 to AC8, AC12 and AC14 to AC16
  // joins JOURNEY_STORE_BEHAVIOUR").
  // -------------------------------------------------------------------------
  {
    name: 'LOST-03-AC2: a heartbeat that leaves a LOST_CONTACT journey’s silence under five minutes by the store’s now brings it back in one step: the heartbeat stored and last contact moved; the journey ACTIVE; its alert RESOLVED at that now, resolution BACK_IN_CONTACT; each unsent lost-contact message withdrawn at that now, keeping its attempts; and one BACK_IN_CONTACT message per responder, written and due at that now, with an ID of its own; the answer names the alert and those messages',
    async run(subject) {
      const lost = await lostWith(subject, 3);
      // 4 min 59.999 s before the store's now against the fake, and a margin
      // under five minutes against the database.
      const heartbeat = heartbeatFor(lost.journeyId, {
        receivedAt: ago(await subject.now(), freshAgoMs(subject)),
      });

      const before = await subject.now();
      const result = await subject.store.recordHeartbeat(heartbeat);
      const after = await subject.now();

      const back = backInContact(result);
      expect(back.alertId).toBe(lost.alertId);
      expect(await subject.heartbeatsOf(lost.journeyId)).toEqual([storedAs(heartbeat)]);
      expect(await subject.lastHeartbeatAt(lost.journeyId)).toEqual(heartbeat.receivedAt);
      expect(await subject.stateOf(lost.journeyId)).toBe('ACTIVE');
      expect(
        (await subject.alertsOf(lost.journeyId)).map(({ id, state }) => ({ id, state })),
      ).toEqual([{ id: lost.alertId, state: 'RESOLVED' }]);
      const resolution = await resolutionOf(subject, lost.journeyId, lost.alertId);
      expect(resolution?.resolution).toBe('BACK_IN_CONTACT');
      const resolvedAt = resolution?.resolvedAt ?? new Date(Number.NaN);
      expect(resolvedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(resolvedAt.getTime()).toBeLessThanOrEqual(after.getTime());

      const messages = await subject.messagesOf(lost.journeyId);
      const withdrawnAt = await withdrawnAtOf(subject, lost.journeyId);
      const created = new Map(
        (await subject.withdrawalsOf(lost.journeyId)).map(({ messageId, createdAt }) => [
          messageId,
          createdAt,
        ]),
      );
      // The lost-contact messages: the same three, withdrawn at that now, unsent, attempts kept.
      const lostContact = ofKind(messages, lost.alertId, 'LOST_CONTACT');
      expect(lostContact.map(({ messageId }) => messageId).sort()).toEqual(
        lost.messages.map(({ messageId }) => messageId).sort(),
      );
      for (const message of lostContact) {
        expect(message).toMatchObject({ attempts: 0, sentAt: null, lastFailure: null });
        expect(withdrawnAt.get(message.messageId)).toEqual(resolvedAt);
      }
      // The stand-downs: one per responder, never the walker, due at once.
      const standDowns = ofKind(messages, lost.alertId, 'BACK_IN_CONTACT');
      expect(recipientsOf(standDowns)).toEqual([...lost.responderIds].sort());
      expect(messages).toHaveLength(lostContact.length + standDowns.length);
      for (const message of standDowns) {
        expect(message).toMatchObject({ attempts: 0, sentAt: null, lastFailure: null });
        expect(message.nextAttemptAt).toEqual(resolvedAt);
        expect(created.get(message.messageId)).toEqual(resolvedAt);
        expect(withdrawnAt.get(message.messageId)).toBeNull();
        expect(message.messageId).toMatch(LOWER_UUID);
      }
      const ids = standDowns.map(({ messageId }) => messageId);
      expect(new Set(ids).size).toBe(ids.length);
      const everyOtherId = [
        ...lost.messages.map(({ messageId }) => messageId),
        lost.alertId,
        lost.journeyId,
        lost.walkerId,
        lost.deviceId,
        ...lost.responderIds,
      ];
      expect(ids.filter((id) => everyOtherId.includes(id))).toEqual([]);
      expect(byRecipient(back.messages)).toEqual(
        standDowns.map(({ messageId, recipientId, kind }) => ({ messageId, recipientId, kind })),
      );
    },
  },
  {
    name: 'LOST-03-AC2: a heartbeat that leaves the silence at five minutes or more brings nothing back: it is stored and moves last contact, and the journey stays LOST_CONTACT with its alert OPEN and unresolved, no message withdrawn and none written; at the threshold itself against the fake, a margin past it against the database',
    async run(subject) {
      const lost = await lostWith(subject, 2);
      const before = await alertRecordOf(subject, lost.journeyId);
      const now = await subject.now();
      // Received five minutes (and a margin) before the store's now, as from
      // an API process that froze between reading the time and taking the
      // row; and one received later still before, which moves nothing.
      const atTheThreshold = heartbeatFor(lost.journeyId, {
        receivedAt: ago(now, LOST_CONTACT_AFTER_MS + subject.timeMarginMs),
      });
      const older = heartbeatFor(lost.journeyId, { receivedAt: ago(now, 10 * MINUTE) });

      expect(await subject.store.recordHeartbeat(atTheThreshold)).toEqual(RECORDED);
      expect(await subject.store.recordHeartbeat(older)).toEqual(RECORDED);

      expect(byEvent(await subject.heartbeatsOf(lost.journeyId))).toEqual(
        byEvent([storedAs(atTheThreshold), storedAs(older)]),
      );
      expect(await subject.lastHeartbeatAt(lost.journeyId)).toEqual(atTheThreshold.receivedAt);
      expect(await alertRecordOf(subject, lost.journeyId)).toEqual(before);
      expect(before.state).toBe('LOST_CONTACT');
      expect(before.alerts.map(({ state }) => state)).toEqual(['OPEN']);
      expect(
        before.resolutions.map(({ resolvedAt, resolution }) => [resolvedAt, resolution]),
      ).toEqual([[null, null]]);
      expect(before.withdrawals.map(({ withdrawnAt }) => withdrawnAt)).toEqual([null, null]);
    },
  },
  {
    name: 'LOST-03-AC4: whatever state the journey’s unresolved alert is in — OPEN, ESCALATED or ACKNOWLEDGED — fresh contact resolves exactly that alert, its time and its resolution set together; an older RESOLVED alert of the journey, with its times and its messages, and another journey’s open alert, with its messages, are untouched',
    async run(subject) {
      for (const state of ['OPEN', 'ESCALATED', 'ACKNOWLEDGED'] as const) {
        const now = await subject.now();
        const journey = await watched(subject, {
          state: 'LOST_CONTACT',
          startedAt: ago(now, 3 * HOUR),
          lastHeartbeatAt: ago(now, HOUR),
          responders: 2,
        });
        // An earlier silence, already over: its alert RESOLVED, its messages sent.
        const older = await subject.seedAlert({
          journeyId: journey.journeyId,
          state: 'RESOLVED',
          openedAt: ago(now, 2 * HOUR + 10 * MINUTE),
          silentSince: ago(now, 2 * HOUR + 15 * MINUTE),
          resolvedAt: ago(now, 2 * HOUR),
          resolution: 'BACK_IN_CONTACT',
        });
        for (const recipientId of journey.responderIds) {
          for (const [kind, at] of [
            ['LOST_CONTACT', ago(now, 2 * HOUR + 10 * MINUTE)],
            ['BACK_IN_CONTACT', ago(now, 2 * HOUR)],
          ] as const) {
            await subject.seedMessage({
              alertId: older,
              recipientId,
              kind,
              createdAt: at,
              nextAttemptAt: at,
              attempts: 1,
              sentAt: at,
            });
          }
        }
        // This silence's alert, in `state`, with a lost-contact message per responder, unsent.
        const current = await subject.seedAlert({
          journeyId: journey.journeyId,
          state,
          openedAt: ago(now, 55 * MINUTE),
          silentSince: ago(now, HOUR),
        });
        for (const recipientId of journey.responderIds) {
          await subject.seedMessage({
            alertId: current,
            recipientId,
            kind: 'LOST_CONTACT',
            createdAt: ago(now, 55 * MINUTE),
            nextAttemptAt: ago(now, 55 * MINUTE),
          });
        }
        const other = await lostWith(subject, 1);
        const otherBefore = await alertRecordOf(subject, other.journeyId);
        const before = await alertRecordOf(subject, journey.journeyId);

        const back = backInContact(
          await subject.store.recordHeartbeat(await freshHeartbeat(subject, journey.journeyId)),
        );

        expect(back.alertId, state).toBe(current);
        expect(await subject.stateOf(journey.journeyId), state).toBe('ACTIVE');
        const after = await alertRecordOf(subject, journey.journeyId);
        const olderOf = (record: typeof before) => ({
          alerts: record.alerts.filter(({ id }) => id === older),
          resolutions: record.resolutions.filter(({ alertId }) => alertId === older),
          messages: record.messages.filter(({ alertId }) => alertId === older),
          withdrawals: record.withdrawals.filter(({ messageId }) =>
            record.messages.some(
              (message) => message.messageId === messageId && message.alertId === older,
            ),
          ),
        });
        expect(olderOf(after), state).toEqual(olderOf(before));
        expect(after.alerts.find(({ id }) => id === current)?.state, state).toBe('RESOLVED');
        const resolved = after.resolutions.find(({ alertId }) => alertId === current);
        expect(resolved?.resolution, state).toBe('BACK_IN_CONTACT');
        expect(resolved?.resolvedAt, state).toBeInstanceOf(Date);
        expect(
          after.alerts.filter(({ state: each }) => each !== 'RESOLVED'),
          state,
        ).toEqual([]);
        expect(await alertRecordOf(subject, other.journeyId), state).toEqual(otherBefore);
      }
    },
  },
  {
    name: 'LOST-03-AC4: a LOST_CONTACT journey with no unresolved alert — none at all, or only a RESOLVED one — still moves back to ACTIVE on fresh contact, writes no message and touches no alert, and the answer names no alert',
    async run(subject) {
      const now = await subject.now();
      const lostWithout = () =>
        watched(subject, {
          state: 'LOST_CONTACT',
          startedAt: ago(now, 2 * HOUR),
          lastHeartbeatAt: ago(now, HOUR),
          responders: 2,
        });
      const none = await lostWithout();
      const onlyResolved = await lostWithout();
      await subject.seedAlert({
        journeyId: onlyResolved.journeyId,
        state: 'RESOLVED',
        openedAt: ago(now, 90 * MINUTE),
        silentSince: ago(now, 95 * MINUTE),
        resolvedAt: ago(now, 70 * MINUTE),
        resolution: 'BACK_IN_CONTACT',
      });

      for (const { journeyId } of [none, onlyResolved]) {
        const before = await alertRecordOf(subject, journeyId);

        expect(
          await subject.store.recordHeartbeat(await freshHeartbeat(subject, journeyId)),
          journeyId,
        ).toEqual({ outcome: 'back_in_contact', alertId: null, messages: [] });

        expect(await subject.stateOf(journeyId)).toBe('ACTIVE');
        expect(await alertRecordOf(subject, journeyId)).toEqual({ ...before, state: 'ACTIVE' });
        expect(await subject.messagesOf(journeyId)).toEqual([]);
      }
    },
  },
  {
    // Added after the red phase (the spec's "Tests added after the red
    // phase", reading 11, D-112). The alert_missing line is the module's, so
    // this checks only the store's answer and what it wrote.
    name: 'LOST-03-AC4: recordHome on a LOST_CONTACT journey with no unresolved alert ends it ENDED with end reason HOME, and answers home, from LOST_CONTACT, with no alert and no messages',
    async run(subject) {
      const now = await subject.now();
      const lostWithout = () =>
        watched(subject, {
          state: 'LOST_CONTACT',
          startedAt: ago(now, 2 * HOUR),
          lastHeartbeatAt: ago(now, HOUR),
          responders: 2,
        });
      // None at all, and only a RESOLVED one with its sent message: neither
      // is an unresolved alert, so neither is touched.
      const none = await lostWithout();
      const onlyResolved = await lostWithout();
      const resolved = await subject.seedAlert({
        journeyId: onlyResolved.journeyId,
        state: 'RESOLVED',
        openedAt: ago(now, 90 * MINUTE),
        silentSince: ago(now, 95 * MINUTE),
        resolvedAt: ago(now, 70 * MINUTE),
        resolution: 'BACK_IN_CONTACT',
      });
      await subject.seedMessage({
        alertId: resolved,
        recipientId: onlyResolved.responderIds[0] ?? '',
        kind: 'LOST_CONTACT',
        createdAt: ago(now, 90 * MINUTE),
        nextAttemptAt: ago(now, 90 * MINUTE),
        attempts: 1,
        sentAt: ago(now, 90 * MINUTE),
      });

      for (const journey of [none, onlyResolved]) {
        const { journeyId } = journey;
        const record = await alertRecordOf(subject, journeyId);
        const resolutions = await subject.resolutionsOf(journeyId);
        const withdrawals = await subject.withdrawalsOf(journeyId);
        const before = await subject.now();

        // Review loop 1: recordHome takes the walker and the device too.
        expect(await subject.store.recordHome(homeOf(journey)), journeyId).toEqual({
          outcome: 'home',
          from: 'LOST_CONTACT',
          alertId: null,
          messages: [],
        });

        const after = await subject.now();
        expect(await subject.stateOf(journeyId)).toBe('ENDED');
        const end = await subject.endOf(journeyId);
        expect(end?.endReason).toBe('HOME');
        expect(end?.endedAt?.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(end?.endedAt?.getTime()).toBeLessThanOrEqual(after.getTime());
        // No alert opened, resolved or changed, and no message written or withdrawn.
        expect(await alertRecordOf(subject, journeyId)).toEqual({ ...record, state: 'ENDED' });
        expect(await subject.resolutionsOf(journeyId)).toEqual(resolutions);
        expect(await subject.withdrawalsOf(journeyId)).toEqual(withdrawals);
      }
    },
  },
  {
    name: 'LOST-03-AC4: a LOST_CONTACT journey whose responder rows are gone still moves back on fresh contact and resolves its alert, withdrawing its unsent lost-contact messages, and writes no stand-down',
    async run(subject) {
      const lost = await lostWith(subject, 2);
      await subject.removeResponders(lost.journeyId);

      const back = backInContact(
        await subject.store.recordHeartbeat(await freshHeartbeat(subject, lost.journeyId)),
      );

      expect(back).toEqual({ outcome: 'back_in_contact', alertId: lost.alertId, messages: [] });
      expect(await subject.stateOf(lost.journeyId)).toBe('ACTIVE');
      expect((await subject.alertsOf(lost.journeyId)).map(({ state }) => state)).toEqual([
        'RESOLVED',
      ]);
      const resolution = await resolutionOf(subject, lost.journeyId, lost.alertId);
      expect(resolution?.resolution).toBe('BACK_IN_CONTACT');
      const messages = await subject.messagesOf(lost.journeyId);
      expect(messages.map(({ kind }) => kind)).toEqual(['LOST_CONTACT', 'LOST_CONTACT']);
      const withdrawnAt = await withdrawnAtOf(subject, lost.journeyId);
      for (const { messageId } of messages) {
        expect(withdrawnAt.get(messageId)).toEqual(resolution?.resolvedAt);
      }
    },
  },
  {
    name: 'LOST-03-AC6: every responder is stood down once, whatever became of their lost-contact message — accepted, failed and due again, or never claimed; a second fresh heartbeat, a sweep and a claim add none, and one message per (alert, recipient, kind) holds a second stand-down out',
    async run(subject) {
      const lost = await lostWith(subject, 3);
      const mine = lost.messages.map(({ messageId }) => messageId);
      // A claim of two: one is accepted, one fails; the third is never claimed.
      const claim = await subject.store.claimDue({ limit: 2, leaseMs: LEASE_MS });
      const [accepted, refused] = claim.messages.filter(({ messageId }) =>
        mine.includes(messageId),
      );
      if (accepted === undefined || refused === undefined) {
        throw new Error('expected the claim to take two of this alert’s messages');
      }
      await subject.store.markSent(accepted.messageId);
      await subject.store.markFailed({
        messageId: refused.messageId,
        reason: 'NO_TARGET',
        retryAfterMs: 10 * SECONDS,
      });

      backInContact(
        await subject.store.recordHeartbeat(await freshHeartbeat(subject, lost.journeyId)),
      );

      const standDowns = () =>
        subject
          .messagesOf(lost.journeyId)
          .then((messages) => ofKind(messages, lost.alertId, 'BACK_IN_CONTACT'));
      const first = await standDowns();
      expect(recipientsOf(first)).toEqual([...lost.responderIds].sort());
      expect(recipientsOf(first)).not.toContain(lost.walkerId);

      expect(
        await subject.store.recordHeartbeat(await freshHeartbeat(subject, lost.journeyId)),
      ).toEqual(RECORDED);
      expect(await sweepOf(subject, [lost.journeyId])).toEqual([]);
      await subject.store.claimDue({ limit: BATCH, leaseMs: LEASE_MS });
      expect((await standDowns()).map(({ messageId }) => messageId).sort()).toEqual(
        first.map(({ messageId }) => messageId).sort(),
      );
      expect(await subject.alertsOf(lost.journeyId)).toHaveLength(1);

      // The one-per-(alert, recipient, kind) rule: a stand-down for someone
      // else is taken, so the refusal below is that rule's, not the kind's.
      const now = await subject.now();
      const bystander = await subject.addUser();
      await expect(
        subject.seedMessage({
          alertId: lost.alertId,
          recipientId: bystander,
          kind: 'BACK_IN_CONTACT',
          createdAt: now,
          nextAttemptAt: now,
        }),
      ).resolves.toEqual(expect.any(String));
      await expect(
        subject.seedMessage({
          alertId: lost.alertId,
          recipientId: lost.responderIds[0] ?? '',
          kind: 'BACK_IN_CONTACT',
          createdAt: now,
          nextAttemptAt: now,
        }),
      ).rejects.toThrow();
    },
  },
  {
    name: 'LOST-03-AC7: when contact comes back, a lost-contact message not yet accepted is withdrawn at the store’s now, keeping its attempts and its last failure, and a claim never hands it out again, whatever its due time and whatever a later mark says; one accepted is left as it was, sent and not withdrawn',
    async run(subject) {
      const lost = await lostWith(subject, 3);
      const mine = lost.messages.map(({ messageId }) => messageId);
      // Claimed with no lease, so both claimed messages are due again at once:
      // only the withdrawal keeps them from the claims below.
      const claim = await subject.store.claimDue({ limit: 2, leaseMs: 0 });
      const [accepted, refused] = claim.messages.filter(({ messageId }) =>
        mine.includes(messageId),
      );
      const never = lost.messages.find(
        ({ messageId }) => !claim.messages.some((claimed) => claimed.messageId === messageId),
      );
      if (accepted === undefined || refused === undefined || never === undefined) {
        throw new Error('expected a claim of two of this alert’s three messages');
      }
      await subject.store.markSent(accepted.messageId);
      await subject.store.markFailed({
        messageId: refused.messageId,
        reason: 'NO_TARGET',
        retryAfterMs: 0,
      });
      const sentAt = (await subject.messagesOf(lost.journeyId)).find(
        ({ messageId }) => messageId === accepted.messageId,
      )?.sentAt;

      backInContact(
        await subject.store.recordHeartbeat(await freshHeartbeat(subject, lost.journeyId)),
      );

      const resolvedAt = (await resolutionOf(subject, lost.journeyId, lost.alertId))?.resolvedAt;
      const withdrawnAt = await withdrawnAtOf(subject, lost.journeyId);
      const stored = new Map(
        (await subject.messagesOf(lost.journeyId)).map((message) => [message.messageId, message]),
      );
      expect(withdrawnAt.get(refused.messageId)).toEqual(resolvedAt);
      expect(withdrawnAt.get(never.messageId)).toEqual(resolvedAt);
      expect(withdrawnAt.get(accepted.messageId)).toBeNull();
      expect(stored.get(refused.messageId)).toMatchObject({
        attempts: 1,
        lastFailure: 'NO_TARGET',
        sentAt: null,
      });
      expect(stored.get(never.messageId)).toMatchObject({ attempts: 0, sentAt: null });
      expect(stored.get(accepted.messageId)?.sentAt).toEqual(sentAt);

      const handedOut = async () =>
        (await subject.store.claimDue({ limit: BATCH, leaseMs: 0 })).messages
          .map(({ messageId }) => messageId)
          .filter((messageId) => mine.includes(messageId));
      expect(await handedOut()).toEqual([]);
      // The port answers late for the refused one: failed again with no
      // delay, then accepted. Each mark is kept, and neither brings it back.
      await subject.store.markFailed({
        messageId: refused.messageId,
        reason: 'UNAVAILABLE',
        retryAfterMs: 0,
      });
      expect(await handedOut()).toEqual([]);
      await subject.store.markSent(refused.messageId);
      expect(await handedOut()).toEqual([]);
      const marked = (await subject.messagesOf(lost.journeyId)).find(
        ({ messageId }) => messageId === refused.messageId,
      );
      expect(marked?.lastFailure).toBe('UNAVAILABLE');
      expect(marked?.sentAt).toBeInstanceOf(Date);
      expect((await withdrawnAtOf(subject, lost.journeyId)).get(refused.messageId)).toEqual(
        resolvedAt,
      );
    },
  },
  {
    name: 'LOST-03-AC8: a responder’s stand-down waits for their lost-contact message when it was handed over and is not due yet — until its lease ends while it may be in the port’s hands, until its retry once it failed — and is due at the store’s now for one sent or never handed over; a claim hands out each stand-down only once it is due',
    async run(subject) {
      const lost = await lostWith(subject, 4);
      const mine = lost.messages.map(({ messageId }) => messageId);
      // Short times, so the database's own clock can pass them in a test.
      const lease = 4 * SECONDS;
      const retry = 1 * SECONDS;
      const claim = await subject.store.claimDue({ limit: 3, leaseMs: lease });
      const [inThePortsHands, failing, sending] = claim.messages.filter(({ messageId }) =>
        mine.includes(messageId),
      );
      const never = lost.messages.find(
        ({ messageId }) => !claim.messages.some((claimed) => claimed.messageId === messageId),
      );
      if (
        inThePortsHands === undefined ||
        failing === undefined ||
        sending === undefined ||
        never === undefined
      ) {
        throw new Error('expected a claim of three of this alert’s four messages');
      }
      await subject.store.markFailed({
        messageId: failing.messageId,
        reason: 'UNAVAILABLE',
        retryAfterMs: retry,
      });
      await subject.store.markSent(sending.messageId);
      const dueOf = new Map(
        (await subject.messagesOf(lost.journeyId)).map(({ messageId, nextAttemptAt }) => [
          messageId,
          nextAttemptAt,
        ]),
      );

      const back = backInContact(
        await subject.store.recordHeartbeat(await freshHeartbeat(subject, lost.journeyId)),
      );

      const resolvedAt = (await resolutionOf(subject, lost.journeyId, lost.alertId))?.resolvedAt;
      const standDowns = ofKind(
        await subject.messagesOf(lost.journeyId),
        lost.alertId,
        'BACK_IN_CONTACT',
      );
      const standDownOf = (recipientId: string) =>
        standDowns.find((message) => message.recipientId === recipientId);
      expect(standDownOf(inThePortsHands.recipientId)?.nextAttemptAt).toEqual(
        dueOf.get(inThePortsHands.messageId),
      );
      expect(standDownOf(failing.recipientId)?.nextAttemptAt).toEqual(dueOf.get(failing.messageId));
      expect(standDownOf(sending.recipientId)?.nextAttemptAt).toEqual(resolvedAt);
      expect(standDownOf(never.recipientId)?.nextAttemptAt).toEqual(resolvedAt);

      const standDownIds = back.messages.map(({ messageId }) => messageId);
      const claimed = async () =>
        recipientsOf(
          (await subject.store.claimDue({ limit: BATCH, leaseMs: LEASE_MS })).messages.filter(
            ({ messageId }) => standDownIds.includes(messageId),
          ),
        );
      expect(await claimed()).toEqual([sending.recipientId, never.recipientId].sort());
      await subject.letTimePass(retry + 500);
      expect(await claimed()).toEqual([failing.recipientId]);
      await subject.letTimePass(lease - retry);
      expect(await claimed()).toEqual([inThePortsHands.recipientId]);
    },
  },
  {
    // Review loop 1 (the spec's item 9a; test-auditor): the hold's "still
    // after now" condition. Only a message handed over and due later than
    // now holds its stand-down back; one whose retry time has passed holds
    // nothing.
    name: 'LOST-03-AC8: a responder whose lost-contact message failed and whose retry time had already passed when contact came back is not held: their stand-down is due at the alert’s resolved_at',
    async run(subject) {
      const now = await subject.now();
      const journey = await watched(subject, {
        state: 'LOST_CONTACT',
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, HOUR),
        responders: 2,
      });
      const [passed = '', toCome = ''] = journey.responderIds;
      const alertId = await subject.seedAlert({
        journeyId: journey.journeyId,
        state: 'OPEN',
        openedAt: ago(now, 55 * MINUTE),
        silentSince: ago(now, HOUR),
      });
      // Each handed over once and refused: one's retry time already passed,
      // the other's still to come when contact comes back.
      const passedRetry = ago(now, 30 * SECONDS);
      const retryToCome = ago(now, -50 * SECONDS);
      for (const [recipientId, nextAttemptAt] of [
        [passed, passedRetry],
        [toCome, retryToCome],
      ] as const) {
        await subject.seedMessage({
          alertId,
          recipientId,
          kind: 'LOST_CONTACT',
          createdAt: ago(now, 55 * MINUTE),
          nextAttemptAt,
          attempts: 1,
          lastFailure: 'UNAVAILABLE',
        });
      }

      backInContact(
        await subject.store.recordHeartbeat(await freshHeartbeat(subject, journey.journeyId)),
      );

      const resolvedAt = (await resolutionOf(subject, journey.journeyId, alertId))?.resolvedAt;
      expect(resolvedAt).toBeInstanceOf(Date);
      expect(resolvedAt?.getTime()).toBeGreaterThan(passedRetry.getTime());
      const standDowns = ofKind(
        await subject.messagesOf(journey.journeyId),
        alertId,
        'BACK_IN_CONTACT',
      );
      const dueOf = (recipientId: string) =>
        standDowns.find((message) => message.recipientId === recipientId)?.nextAttemptAt;
      expect(dueOf(passed)).toEqual(resolvedAt);
      // The contrast: a retry still to come holds its stand-down until then.
      expect(dueOf(toCome)).toEqual(retryToCome);
    },
  },
  {
    // Review loop 1 (the spec's item 1b; safety-reviewer; approach item 4,
    // step 5): no overtaking across alerts. A new alert's open withdraws the
    // journey's earlier alerts' stand-downs that are not sent, in its own
    // transaction, so an earlier "back in contact" can never reach the port
    // after the new alert's lost-contact push.
    name: 'LOST-03-AC8: an open withdraws the journey’s earlier alerts’ unsent stand-downs at the store’s now, and leaves alone those already sent, every other journey’s messages and its own new ones; an open that skips withdraws nothing',
    async run(subject) {
      const now = await subject.now();
      // A journey whose earlier alert was resolved 70 minutes ago, with its
      // lost-contact messages sent and three stand-downs: one sent, one
      // failing and due again later, one never handed over.
      const withEarlierAlert = async (lastHeartbeatAt: Date) => {
        const journey = await watched(subject, {
          startedAt: ago(now, 2 * HOUR),
          lastHeartbeatAt,
          responders: 3,
        });
        const earlier = await subject.seedAlert({
          journeyId: journey.journeyId,
          state: 'RESOLVED',
          openedAt: ago(now, 90 * MINUTE),
          silentSince: ago(now, 95 * MINUTE),
          resolvedAt: ago(now, 70 * MINUTE),
          resolution: 'BACK_IN_CONTACT',
        });
        for (const recipientId of journey.responderIds) {
          await subject.seedMessage({
            alertId: earlier,
            recipientId,
            kind: 'LOST_CONTACT',
            createdAt: ago(now, 90 * MINUTE),
            nextAttemptAt: ago(now, 90 * MINUTE),
            attempts: 1,
            sentAt: ago(now, 90 * MINUTE),
          });
        }
        const [sent = '', failing = '', never = ''] = journey.responderIds;
        const standDown = (
          recipientId: string,
          extra: {
            attempts?: number;
            nextAttemptAt?: Date;
            sentAt?: Date;
            lastFailure?: 'UNAVAILABLE';
          },
        ) =>
          subject.seedMessage({
            alertId: earlier,
            recipientId,
            kind: 'BACK_IN_CONTACT',
            createdAt: ago(now, 70 * MINUTE),
            nextAttemptAt: ago(now, 70 * MINUTE),
            ...extra,
          });
        const standDowns = {
          sent: await standDown(sent, { attempts: 1, sentAt: ago(now, 69 * MINUTE) }),
          failing: await standDown(failing, {
            attempts: 3,
            nextAttemptAt: ago(now, -30 * SECONDS),
            lastFailure: 'UNAVAILABLE',
          }),
          never: await standDown(never, {}),
        };
        return { ...journey, earlier, standDowns };
      };
      const j = await withEarlierAlert(ago(now, 70 * MINUTE));
      // Overdue as well, and never opened here: none of its messages moves.
      const other = await withEarlierAlert(ago(now, 70 * MINUTE));
      // In contact a minute ago: its open skips, and withdraws nothing.
      const quiet = await withEarlierAlert(ago(now, MINUTE));
      const earlierOf = async (journey: { journeyId: string; earlier: string }) =>
        byMessage(
          (await subject.messagesOf(journey.journeyId)).filter(
            ({ alertId }) => alertId === journey.earlier,
          ),
        );
      const earlierBefore = await earlierOf(j);
      const otherBefore = await alertRecordOf(subject, other.journeyId);
      const quietBefore = await alertRecordOf(subject, quiet.journeyId);

      const opened = await subject.store.openLostContactAlert({
        journeyId: j.journeyId,
        afterMs: LOST_CONTACT_AFTER_MS,
      });
      expect(
        await subject.store.openLostContactAlert({
          journeyId: quiet.journeyId,
          afterMs: LOST_CONTACT_AFTER_MS,
        }),
      ).toEqual({ outcome: 'skipped' });

      if (opened.outcome !== 'opened') {
        throw new Error(`expected the journey to be opened again, but it was ${opened.outcome}`);
      }
      const openedAt = (await subject.alertsOf(j.journeyId)).find(
        ({ id }) => id === opened.alertId,
      )?.openedAt;
      expect(openedAt).toBeInstanceOf(Date);
      const withdrawnAt = await withdrawnAtOf(subject, j.journeyId);
      // The unsent ones, withdrawn at the open's own now: due later or due already.
      expect(withdrawnAt.get(j.standDowns.failing), 'failing').toEqual(openedAt);
      expect(withdrawnAt.get(j.standDowns.never), 'never handed over').toEqual(openedAt);
      // The sent one, the earlier lost-contact messages and the new alert's own: untouched.
      expect(withdrawnAt.get(j.standDowns.sent), 'sent').toBeNull();
      for (const message of earlierBefore.filter(({ kind }) => kind === 'LOST_CONTACT')) {
        expect(withdrawnAt.get(message.messageId), 'an earlier lost-contact').toBeNull();
      }
      for (const { messageId } of opened.messages) {
        expect(withdrawnAt.get(messageId), 'the new alert’s own').toBeNull();
      }
      // Withdrawing keeps everything else: attempts, last failure, sent and due times.
      expect(await earlierOf(j)).toEqual(earlierBefore);
      expect(await alertRecordOf(subject, other.journeyId)).toEqual(otherBefore);
      expect(await alertRecordOf(subject, quiet.journeyId)).toEqual(quietBefore);
      // And a claim never hands the withdrawn ones out.
      const claimed = (
        await subject.store.claimDue({ limit: BATCH, leaseMs: LEASE_MS })
      ).messages.map(({ messageId }) => messageId);
      expect(claimed).not.toContain(j.standDowns.never);
      expect(claimed).not.toContain(j.standDowns.failing);
    },
  },
  {
    name: `LOST-03-AC12: a heartbeat a LOST_CONTACT journey already has, sent again later, is a duplicate and changes nothing; and ${String(RACERS)} different fresh heartbeats at once, ${String(RACE_ROUNDS)} times over, are each stored, exactly one bringing the journey back and every other recorded, with one resolution and one stand-down per responder; the one that brought it back, sent again, is a duplicate and writes nothing`,
    async run(subject) {
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const at = `round ${String(round)}`;
        const now = await subject.now();
        const { journeyId, responderIds } = await watched(subject, {
          startedAt: ago(now, 2 * HOUR),
          responders: 2,
        });
        // Its last heartbeat before the silence, whose answer was lost.
        const beforeTheSilence = heartbeatFor(journeyId, { receivedAt: ago(now, HOUR) });
        expect(await subject.store.recordHeartbeat(beforeTheSilence), at).toEqual(RECORDED);
        const opened = await subject.store.openLostContactAlert({
          journeyId,
          afterMs: LOST_CONTACT_AFTER_MS,
        });
        expect(opened.outcome, at).toBe('opened');
        const record = await alertRecordOf(subject, journeyId);

        expect(
          await subject.store.recordHeartbeat({
            ...beforeTheSilence,
            receivedAt: await subject.now(),
          }),
          at,
        ).toEqual(DUPLICATE);
        expect(await alertRecordOf(subject, journeyId), at).toEqual(record);
        expect(await subject.lastHeartbeatAt(journeyId), at).toEqual(beforeTheSilence.receivedAt);

        const receivedAt = await subject.now();
        const racers = Array.from({ length: RACERS }, () =>
          heartbeatFor(journeyId, { receivedAt, position: null }),
        );
        // Promise.all rejects if any heartbeat fails outright: none may.
        const results = await Promise.all(
          racers.map((heartbeat) => subject.store.recordHeartbeat(heartbeat)),
        );

        expect(results.map(({ outcome }) => outcome).sort(), at).toEqual(
          ['back_in_contact', ...Array.from({ length: RACERS - 1 }, () => 'recorded')].sort(),
        );
        expect(await subject.heartbeatsOf(journeyId), at).toHaveLength(RACERS + 1);
        expect(await subject.stateOf(journeyId), at).toBe('ACTIVE');
        expect(
          (await subject.alertsOf(journeyId)).map(({ state }) => state),
          at,
        ).toEqual(['RESOLVED']);
        const after = await subject.messagesOf(journeyId);
        expect(recipientsOf(after.filter(({ kind }) => kind === 'BACK_IN_CONTACT')), at).toEqual(
          [...responderIds].sort(),
        );

        const winner = racers[results.findIndex(({ outcome }) => outcome === 'back_in_contact')];
        if (winner === undefined) {
          throw new Error('no heartbeat brought the journey back');
        }
        expect(
          await subject.store.recordHeartbeat({ ...winner, receivedAt: await subject.now() }),
          at,
        ).toEqual(DUPLICATE);
        expect(byMessage(await subject.messagesOf(journeyId)), at).toEqual(byMessage(after));
      }
    },
  },
  {
    name: 'LOST-03-AC14: "I’m home" (recordHome) on a LOST_CONTACT journey ends it in one step: ENDED, end reason HOME at the store’s now; its alert RESOLVED at that now, resolution HOME; each unsent lost-contact message withdrawn, a stand-down held for one in the port’s hands; one HOME message per responder; the answer says it came from LOST_CONTACT and names the alert and the messages. Afterwards a heartbeat is answered ended and stores nothing, the overdue read never returns it, and the walker can start again (SM-04)',
    async run(subject) {
      const lost = await lostWith(subject, 3);
      const mine = lost.messages.map(({ messageId }) => messageId);
      const claim = await subject.store.claimDue({ limit: 1, leaseMs: LEASE_MS });
      const [inThePortsHands] = claim.messages.filter(({ messageId }) => mine.includes(messageId));
      if (inThePortsHands === undefined) {
        throw new Error('expected the claim to take one of this alert’s messages');
      }
      const leaseEnd = (await subject.messagesOf(lost.journeyId)).find(
        ({ messageId }) => messageId === inThePortsHands.messageId,
      )?.nextAttemptAt;

      const before = await subject.now();
      // Review loop 1: recordHome takes the walker and the device too.
      const result = await subject.store.recordHome(homeOf(lost));
      const after = await subject.now();

      const home = endedHome(result);
      expect(home.from).toBe('LOST_CONTACT');
      expect(home.alertId).toBe(lost.alertId);
      expect(await subject.stateOf(lost.journeyId)).toBe('ENDED');
      const end = await subject.endOf(lost.journeyId);
      expect(end?.endReason).toBe('HOME');
      const endedAt = end?.endedAt ?? new Date(Number.NaN);
      expect(endedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(endedAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(await resolutionOf(subject, lost.journeyId, lost.alertId)).toEqual({
        alertId: lost.alertId,
        resolvedAt: endedAt,
        resolution: 'HOME',
      });
      expect((await subject.alertsOf(lost.journeyId)).map(({ state }) => state)).toEqual([
        'RESOLVED',
      ]);
      const messages = await subject.messagesOf(lost.journeyId);
      const withdrawnAt = await withdrawnAtOf(subject, lost.journeyId);
      for (const { messageId } of ofKind(messages, lost.alertId, 'LOST_CONTACT')) {
        expect(withdrawnAt.get(messageId), messageId).toEqual(endedAt);
      }
      const standDowns = ofKind(messages, lost.alertId, 'HOME');
      expect(recipientsOf(standDowns)).toEqual([...lost.responderIds].sort());
      expect(messages.filter(({ kind }) => kind === 'BACK_IN_CONTACT')).toEqual([]);
      for (const message of standDowns) {
        expect(message.nextAttemptAt, message.recipientId).toEqual(
          message.recipientId === inThePortsHands.recipientId ? leaseEnd : endedAt,
        );
      }
      expect(byRecipient(home.messages)).toEqual(
        standDowns.map(({ messageId, recipientId, kind }) => ({ messageId, recipientId, kind })),
      );

      expect(
        await subject.store.recordHeartbeat(await freshHeartbeat(subject, lost.journeyId)),
      ).toEqual(ENDED);
      expect(await subject.heartbeatsOf(lost.journeyId)).toEqual([]);
      const read = await subject.store.overdueJourneys(LOST_CONTACT_AFTER_MS);
      expect(read.journeys.map(({ id }) => id)).not.toContain(lost.journeyId);
      expect(await subject.store.unendedJourneyOf(lost.walkerId)).toBeNull();
      const again = await subject.store.insertStarted({
        walkerId: lost.walkerId,
        deviceId: lost.deviceId,
        responderIds: lost.responderIds,
        startedAt: STARTED_AT,
      });
      expect(again.inserted).toBe(true);
    },
  },
  {
    name: 'LOST-03-AC15: "I’m home" (recordHome) on an ACTIVE journey ends it, end reason HOME at the store’s now, from ACTIVE, and touches no alert and writes no message — with no alert, and with only resolved ones; the overdue read and the open then never take it, and the walker can start again (SM-04)',
    async run(subject) {
      const now = await subject.now();
      const silent = () =>
        watched(subject, {
          startedAt: ago(now, 2 * HOUR),
          lastHeartbeatAt: ago(now, HOUR),
          responders: 2,
        });
      const plain = await silent();
      const withResolved = await silent();
      const resolved = await subject.seedAlert({
        journeyId: withResolved.journeyId,
        state: 'RESOLVED',
        openedAt: ago(now, 90 * MINUTE),
        silentSince: ago(now, 95 * MINUTE),
        resolvedAt: ago(now, 70 * MINUTE),
        resolution: 'BACK_IN_CONTACT',
      });
      for (const recipientId of withResolved.responderIds) {
        await subject.seedMessage({
          alertId: resolved,
          recipientId,
          kind: 'LOST_CONTACT',
          createdAt: ago(now, 90 * MINUTE),
          nextAttemptAt: ago(now, 90 * MINUTE),
          attempts: 1,
          sentAt: ago(now, 90 * MINUTE),
        });
      }

      for (const journey of [plain, withResolved]) {
        const record = await alertRecordOf(subject, journey.journeyId);
        const before = await subject.now();

        // Review loop 1: recordHome takes the walker and the device too.
        expect(await subject.store.recordHome(homeOf(journey)), journey.journeyId).toEqual({
          outcome: 'home',
          from: 'ACTIVE',
          alertId: null,
          messages: [],
        });

        const after = await subject.now();
        expect(await subject.stateOf(journey.journeyId)).toBe('ENDED');
        const end = await subject.endOf(journey.journeyId);
        expect(end?.endReason).toBe('HOME');
        expect(end?.endedAt?.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(end?.endedAt?.getTime()).toBeLessThanOrEqual(after.getTime());
        expect(await alertRecordOf(subject, journey.journeyId)).toEqual({
          ...record,
          state: 'ENDED',
        });
        const read = await subject.store.overdueJourneys(LOST_CONTACT_AFTER_MS);
        expect(read.journeys.map(({ id }) => id)).not.toContain(journey.journeyId);
        expect(
          await subject.store.openLostContactAlert({
            journeyId: journey.journeyId,
            afterMs: LOST_CONTACT_AFTER_MS,
          }),
        ).toEqual({ outcome: 'skipped' });
        const again = await subject.store.insertStarted({
          walkerId: journey.walkerId,
          deviceId: journey.deviceId,
          responderIds: journey.responderIds,
          startedAt: STARTED_AT,
        });
        expect(again.inserted).toBe(true);
      }
    },
  },
  {
    // RG-03 (LOST-03 review loop 1, the spec's item 3): this was "…is
    // answered ended…", and expected { outcome: 'ended' }. The store's answer
    // for a journey already ended is now already_ended (`ended` stays the
    // heartbeat's word), and recordHome takes the walker and the device too
    // (item 2). What the behaviour holds, nothing changes, is unchanged.
    name: 'LOST-03-AC16: "I’m home" (recordHome) on a journey already ENDED — by an earlier "I’m home", or set directly — is answered already_ended and changes nothing: its end, its alerts and its messages stay as they were; for a journey that does not exist the store rejects (SM-04, SM-07, SM-08)',
    async run(subject) {
      const lost = await lostWith(subject, 2);
      endedHome(await subject.store.recordHome(homeOf(lost)));
      const now = await subject.now();
      const direct = await watched(subject, {
        state: 'ENDED',
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, HOUR),
      });

      for (const journey of [lost, direct]) {
        const { journeyId } = journey;
        const record = await alertRecordOf(subject, journeyId);
        const end = await subject.endOf(journeyId);

        expect(await subject.store.recordHome(homeOf(journey)), journeyId).toEqual({
          outcome: 'already_ended',
        });

        expect(await alertRecordOf(subject, journeyId)).toEqual(record);
        expect(await subject.endOf(journeyId)).toEqual(end);
      }
      expect(await subject.endOf(direct.journeyId)).toEqual({ endedAt: null, endReason: null });
      await expect(
        subject.store.recordHome(homeOf({ ...lost, journeyId: syntheticUuid() })),
      ).rejects.toThrow();
    },
  },
  {
    // Review loop 1 (the spec's item 2a; code-reviewer; AR-04; SM-04): the
    // store asks the home rule under the lock, with the walker and the
    // device, and writes what it decided. The module asked the same rule
    // first, so a refusal here means something changed that cannot, and the
    // store rejects rather than guess.
    name: 'LOST-03-AC16: recordHome decides by the home rule under the lock: a walker or a device that is not the journey’s makes it reject and write nothing; an ENDED journey answers already_ended and writes nothing; an ACTIVE one is ended without resolving anything; a LOST_CONTACT one is ended and its alert resolved with resolution HOME',
    async run(subject) {
      const now = await subject.now();
      const lost = await lostWith(subject, 2);
      const active = await watched(subject, {
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, MINUTE),
      });
      const ended = await watched(subject, {
        state: 'ENDED',
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, HOUR),
      });
      const [stranger = ''] = await users(subject, 1);
      const strangersDevice = await subject.addDevice(stranger);
      const snapshot = async (journeyId: string) => ({
        record: await alertRecordOf(subject, journeyId),
        end: await subject.endOf(journeyId),
      });

      for (const journey of [lost, active]) {
        const before = await snapshot(journey.journeyId);
        const anotherOfTheirs = await subject.addDevice(journey.walkerId);
        // Another walker, from their own device: JOURNEY_NOT_FOUND under the lock.
        await expect(
          subject.store.recordHome({
            journeyId: journey.journeyId,
            walkerId: stranger,
            deviceId: strangersDevice,
          }),
          'another walker',
        ).rejects.toThrow();
        // The walker's other device: NOT_THE_JOURNEYS_DEVICE under the lock.
        await expect(
          subject.store.recordHome({ ...homeOf(journey), deviceId: anotherOfTheirs }),
          'another device',
        ).rejects.toThrow();
        expect(await snapshot(journey.journeyId)).toEqual(before);
      }

      // ENDED: already_ended, from any of the walker's devices, as the rule
      // reports the end before it looks at the device.
      const endedBefore = await snapshot(ended.journeyId);
      expect(await subject.store.recordHome(homeOf(ended))).toEqual({ outcome: 'already_ended' });
      expect(
        await subject.store.recordHome({
          ...homeOf(ended),
          deviceId: await subject.addDevice(ended.walkerId),
        }),
      ).toEqual({ outcome: 'already_ended' });
      expect(await snapshot(ended.journeyId)).toEqual(endedBefore);

      // ACTIVE: ended, HOME, and nothing resolved.
      const activeRecord = await alertRecordOf(subject, active.journeyId);
      expect(await subject.store.recordHome(homeOf(active))).toEqual({
        outcome: 'home',
        from: 'ACTIVE',
        alertId: null,
        messages: [],
      });
      expect((await subject.endOf(active.journeyId))?.endReason).toBe('HOME');
      expect(await alertRecordOf(subject, active.journeyId)).toEqual({
        ...activeRecord,
        state: 'ENDED',
      });

      // LOST_CONTACT: ended, HOME, its alert resolved HOME, one HOME per responder.
      const home = endedHome(await subject.store.recordHome(homeOf(lost)));
      expect(home.from).toBe('LOST_CONTACT');
      expect(home.alertId).toBe(lost.alertId);
      expect(recipientsOf(home.messages)).toEqual([...lost.responderIds].sort());
      expect(home.messages.map(({ kind }) => kind)).toEqual(['HOME', 'HOME']);
      expect(await subject.stateOf(lost.journeyId)).toBe('ENDED');
      expect((await subject.endOf(lost.journeyId))?.endReason).toBe('HOME');
      expect((await resolutionOf(subject, lost.journeyId, lost.alertId))?.resolution).toBe('HOME');
    },
  },
];
