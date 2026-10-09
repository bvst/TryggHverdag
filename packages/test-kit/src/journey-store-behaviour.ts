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
 *     journey with no responder is opened with no message (SM-10-AC15, which
 *     D-122 item 3 put in place of LOST-02-AC12's refusal), and opens that
 *     race leave one alert (AC7); an open told to wait for a held row answers `held`
 *     when the row stays held, and otherwise checks the row as its holder
 *     left it (AC20);
 *   - a claim hands each due message to one claimer, once, leased; a failure
 *     keeps its reason and is due again after its delay; a sent message is
 *     never handed out again (AC14, AC15).
 *
 * And when a responder says "I'm on it" (LOST-06, its spec's shared
 * behaviours 1 to 11, D-100):
 *   - the read is a plain read, of the alert's state, who is recorded on it
 *     and its journey's responders (AC2); the write decides by the alert rule
 *     under the journey's row, in its order, and writes the acknowledgement
 *     and one notice per other responder, or nothing (AC2 to AC6);
 *   - an acknowledged alert's resolution withdraws its unsent notices, keeps
 *     who acknowledged it and when, and stands every responder down once
 *     (AC7, a fast-check property among them); a responder with two
 *     messages withdrawn still gets one stand-down, held until the later of
 *     their due times (AC8), the case the fake once answered more leniently
 *     than the adapter, with the first withdrawn message only;
 *   - a resolution withdraws exactly the kinds withdrawn on resolution, of
 *     its own alert, and nothing else (AC13).
 *
 * And when a responder is removed (SM-10 and the last-responder half of
 * SM-02, its spec's shared behaviours 1 to 14 and AC10's, D-100, D-122,
 * D-123):
 *   - the read is a plain read of the journey's state and its responder rows
 *     (AC1); the write decides by the removal rule under the journey's row,
 *     as its holder left it, and racing removals of one responder leave one
 *     removed (AC1, AC3);
 *   - removing the acknowledger resets the alert: OPEN, who and when and the
 *     escalation time cleared, the round raised, its unsent notices
 *     withdrawn (AC4); the escalation then writes the next round's SMS beside
 *     the earlier round's, and a second acknowledgement its notices in the
 *     new round (AC6, AC7); an acknowledgement read before a removal is
 *     ALERT_NOT_FOUND under the lock (AC9);
 *   - the removed responder's unsent messages of the journey's alerts are
 *     withdrawn, whatever their kind, and nothing later is written to them
 *     (AC10, AC11);
 *   - the last responder's removal writes one NO_RESPONDER to the walker,
 *     a journey's message, which the push claim hands out and nothing
 *     withdraws (AC12 to AC14); a journey with no responder opens with no
 *     message, is never escalated, and is counted unheard (AC15);
 *   - for any sequence of steps the rules hold, a fast-check property (AC8),
 *     and each of the five withdrawals takes exactly its own kinds (AC17).
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
import {
  PUSH_KINDS,
  SMS_KINDS,
  WITHDRAWN_WHEN_ACKNOWLEDGED,
  WITHDRAWN_WHEN_OPENED,
  WITHDRAWN_WHEN_REMOVED,
  WITHDRAWN_WHEN_RESET,
  WITHDRAWN_WHEN_RESOLVED,
  type AlertRound,
  type JourneyForRemoval,
  type MessageRound,
  type RemoveResponderResult,
  type UnheardAlertCount,
  type AlertForAcknowledgement,
  type AlertMessage,
  type ClaimedMessages,
  type DueAlerts,
  type EscalateAlertResult,
  type UnsentSmsCount,
  type FakeAlertResolution,
  type FakeAlertState,
  type FakeJourneyState,
  type HeartbeatToRecord,
  type InsertStartedResult,
  type LatestHeartbeat,
  type OpenLostContactAlertResult,
  type OverdueJourneys,
  type RecordAcknowledgementResult,
  type RecordHeartbeatResult,
  type RecordHomeResult,
  type StartedJourney,
} from './fake-journey-store.ts';
import { MESSAGE_KINDS, type MessageKind, type PushFailureReason } from './fake-push.ts';
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
    /** "I'm on it" (LOST-06): the alert, its state, who is on it and its journey's responders, read without a lock; null for none. */
    alertForAcknowledgement(alertId: string): Promise<AlertForAcknowledgement | null>;
    /** "I'm on it" (LOST-06): decided by the alert rule under the journey's row, and written, or not. */
    recordAcknowledgement(acknowledgement: {
      alertId: string;
      responderId: string;
    }): Promise<RecordAcknowledgementResult>;
    /** LOST-07: the alerts due for escalation, read without a lock, and the store's now. */
    alertsDueForEscalation(afterMs: number): Promise<DueAlerts>;
    /**
     * LOST-07: decided by the escalation rule under the journey's row, and
     * written, or not. RG-03 (LOST-07 review loop 1, `code-reviewer`): no
     * `afterMs`. The store decides by its own two minutes, so no caller can
     * hand it another threshold; this suite holds the fake and the adapter to
     * the same 120 000 (ESCALATE_AFTER_MS below), and L3 the adapter to the
     * domain's. Every escalateAlert call below loses the field for that reason.
     */
    escalateAlert(request: {
      alertId: string;
      lockWaitMs?: number | undefined;
    }): Promise<EscalateAlertResult>;
    /** LOST-07: the SMS claim, of the SMS kinds only. */
    claimDueSms(request: { limit: number; leaseMs: number }): Promise<ClaimedMessages>;
    /** LOST-07: the SMS messages unsent, not withdrawn and written `olderThanMs` or more ago. */
    unsentSmsCount(olderThanMs: number): Promise<UnsentSmsCount>;
    /** SM-10: the journey's state and its responder rows, read without a lock; null for none. */
    journeyForRemoval(journeyId: string): Promise<JourneyForRemoval | null>;
    /** SM-10: decided by the removal rule under the journey's row, and written, or not. */
    removeResponder(removal: {
      journeyId: string;
      responderId: string;
    }): Promise<RemoveResponderResult>;
    /** SM-10 (D-122, item 3): the unresolved alerts whose journey has no responder row, and the store's now. */
    unheardAlertCount(): Promise<UnheardAlertCount>;
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
    /** LOST-06: who is on it and since when, both or neither; left out, neither. */
    acknowledgedBy?: string | null;
    acknowledgedAt?: Date | null;
    /** LOST-07: when it was escalated to SMS; left out, never. */
    smsRaisedAt?: Date | null;
    /** SM-10: its round; left out, the column's default, 1. */
    round?: number;
  }): Promise<string>;
  /**
   * LOST-03: an outbox message put in directly, as a test's own setup.
   * Resolves to its ID. LOST-07: withdrawn at `withdrawnAt` when given; left
   * out, never withdrawn.
   */
  seedMessage(message: {
    alertId: string;
    recipientId: string;
    kind: MessageKind;
    createdAt: Date;
    nextAttemptAt: Date;
    attempts?: number;
    sentAt?: Date | null;
    lastFailure?: PushFailureReason | null;
    withdrawnAt?: Date | null;
    /** SM-10: its round; left out, the column's default, 1. */
    round?: number;
  }): Promise<string>;
  /**
   * LOST-03-AC4: every responder row of the journey removed directly, as a
   * test's own setup, and nothing else: no reset, no withdrawal, no warning
   * (SM-10's removal does those).
   */
  removeResponders(journeyId: string): Promise<void>;
  /**
   * LOST-06: each alert of this journey's acknowledgement, read by a reader of
   * its own so that `alertsOf` keeps its shape: who is on it and since when,
   * both null until someone is. In any order.
   */
  acknowledgementsOf(journeyId: string): Promise<AcknowledgementAsStored[]>;
  /**
   * LOST-07: each alert of this journey's escalation time, read by a reader of
   * its own so that `alertsOf` keeps its shape: null until it is escalated. In
   * any order.
   */
  escalationsOf(journeyId: string): Promise<EscalationAsStored[]>;
  /**
   * LOST-07-AC16: holds the journey's row as `hold` does, and lets it go once
   * an escalation is waiting for it, having first changed the journey's
   * unresolved alert as a transaction in flight would: `acknowledge`, recorded
   * by one of the journey's responders, as "I'm on it" committing; `resolve`,
   * resolved with contact back, as a heartbeat committing; `unchanged`,
   * nothing. `release` lets go at once if no escalation came.
   */
  holdUntilEscalationWaits(
    journeyId: string,
    change: 'unchanged' | 'acknowledge' | 'resolve',
  ): Promise<{ release(): Promise<void> }>;
  /**
   * SM-10: each alert of this journey's round, read by a reader of its own so
   * that `alertsOf` keeps its shape. In any order.
   */
  roundsOf(journeyId: string): Promise<AlertRound[]>;
  /**
   * SM-10: each message of this journey's alerts' round, read by a reader of
   * its own so that `messagesOf` keeps its shape. In any order.
   */
  messageRoundsOf(journeyId: string): Promise<MessageRound[]>;
  /** SM-10: the journey's own messages, naming it and no alert: the walker's warnings. In any order. */
  journeyMessagesOf(journeyId: string): Promise<JourneyMessageAsStored[]>;
  /**
   * SM-10-AC3: holds the journey's row as `hold` does, and lets it go once a
   * removal is waiting for it, having first changed the journey as a
   * transaction in flight would: `{ remove }`, that responder's row deleted
   * and nothing else; `end`, the journey ENDED; `unchanged`, nothing.
   * `release` lets go at once if no removal came.
   */
  holdUntilRemovalWaits(
    journeyId: string,
    change: 'unchanged' | 'end' | { remove: string },
  ): Promise<{ release(): Promise<void> }>;
}

/**
 * A journey's message as a store under test holds it (SM-10): the walker's
 * warning, naming the journey and no alert.
 */
export interface JourneyMessageAsStored {
  messageId: string;
  journeyId: string;
  recipientId: string;
  kind: string;
  round: number;
  createdAt: Date;
  attempts: number;
  nextAttemptAt: Date;
  sentAt: Date | null;
  lastFailure: string | null;
  withdrawnAt: Date | null;
}

/** Who acknowledged an alert, and when, as a store under test holds it: both null until someone did (LOST-06). */
export interface AcknowledgementAsStored {
  alertId: string;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
}

/** When an alert was escalated to SMS, as a store under test holds it: null until it was (LOST-07). */
export interface EscalationAsStored {
  alertId: string;
  smsRaisedAt: Date | null;
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

// ---------------------------------------------------------------------------
// LOST-06: "I'm on it".
// ---------------------------------------------------------------------------

/** The kind of the notice that someone is on it (D-113). */
const NOTICE = 'ACKNOWLEDGED';

/** The rule's answers that write nothing, as the store hands them back (approach item 2). */
const NOT_FOUND: RecordAcknowledgementResult = {
  outcome: 'not_recorded',
  decision: { type: 'refused', reason: 'ALERT_NOT_FOUND' },
};
const TAKEN: RecordAcknowledgementResult = {
  outcome: 'not_recorded',
  decision: { type: 'refused', reason: 'ALREADY_ACKNOWLEDGED' },
};
const YOURS: RecordAcknowledgementResult = {
  outcome: 'not_recorded',
  decision: { type: 'unchanged', reason: 'ALREADY_YOURS' },
};
const OVER: RecordAcknowledgementResult = {
  outcome: 'not_recorded',
  decision: { type: 'ignored', reason: 'ALERT_RESOLVED' },
};

/** The answer of an acknowledgement that was recorded, or a failed expectation saying what it was instead. */
function acknowledged(
  result: RecordAcknowledgementResult,
  what = 'the acknowledgement',
): {
  messages: AlertMessage[];
} {
  expect(result.outcome, `${what} was recorded: ${JSON.stringify(result)}`).toBe('acknowledged');
  if (result.outcome !== 'acknowledged') {
    throw new Error(`${what} was answered ${JSON.stringify(result)}`);
  }
  return result;
}

/** This alert's acknowledgement, as the store under test holds it. */
async function acknowledgementOf(
  subject: JourneyStoreUnderTest,
  journeyId: string,
  alertId: string,
): Promise<AcknowledgementAsStored | undefined> {
  return (await subject.acknowledgementsOf(journeyId)).find((each) => each.alertId === alertId);
}

/** Everything a store holds of one journey's alerts and messages, who is on each alert included. */
async function acknowledgedRecordOf(subject: JourneyStoreUnderTest, journeyId: string) {
  return {
    ...(await alertRecordOf(subject, journeyId)),
    acknowledgements: [...(await subject.acknowledgementsOf(journeyId))].sort((a, b) =>
      a.alertId.localeCompare(b.alertId),
    ),
  };
}

/** A message's fields as the store hands it back in an answer. */
function asAnswered({ messageId, recipientId, kind }: AlertMessage | MessageAsStored) {
  return { messageId, recipientId, kind };
}

// ---------------------------------------------------------------------------
// LOST-07: escalation to SMS, its claim, the count of failing SMS, and the
// three withdrawals (its spec's shared behaviours 1 to 12, D-100).
// ---------------------------------------------------------------------------

/**
 * Two minutes (D-019): the server's ESCALATE_AFTER_MS, written out because the
 * test kit imports nothing from the server.
 */
const ESCALATE_AFTER_MS = 120_000;

/** Sixty seconds: the server's SMS_UNSENT_LIMIT_MS, written out for the same reason. */
const SMS_UNSENT_LIMIT_MS = 60_000;

/** The escalation SMS's kind (D-019). */
const SMS = 'LOST_CONTACT_SMS';

/** The escalation's answer when it writes nothing. */
const NOT_ESCALATED: EscalateAlertResult = { outcome: 'skipped' };

/**
 * How long before the store's now an alert may have opened and still be under
 * two minutes when the store decides: 1 min 59.999 s against the fake, whose
 * clock stands still, and a margin under two minutes against the database,
 * whose now() moves on.
 */
function underTwoMinutesMs(subject: JourneyStoreUnderTest): number {
  return ESCALATE_AFTER_MS - Math.max(1, subject.timeMarginMs);
}

/** How an alert is put in for the escalation's behaviours. */
interface AlertSeed {
  state?: FakeAlertState;
  /** Someone recorded on it, with a time: its journey's first responder. */
  recorded?: boolean;
  /** Escalated this long before the store's now; null, never. */
  smsRaisedAgoMs?: number | null;
  /** Opened this long before the store's now. */
  openedAgoMs?: number;
  responders?: number;
}

/**
 * A LOST_CONTACT journey of a new walker, with `responders` responders, and
 * its one alert put in directly as the seed says: opened `openedAgoMs` before
 * the store's now (three minutes unless told otherwise, so due), silent five
 * minutes before that. A RESOLVED one was resolved since, by contact back.
 */
async function alerted(
  subject: JourneyStoreUnderTest,
  {
    state = 'OPEN',
    recorded = false,
    smsRaisedAgoMs = null,
    openedAgoMs = 3 * MINUTE,
    responders = 3,
  }: AlertSeed = {},
): Promise<{
  walkerId: string;
  deviceId: string;
  journeyId: string;
  responderIds: string[];
  alertId: string;
  openedAt: Date;
  acknowledgedBy: string | null;
}> {
  const now = await subject.now();
  const openedAt = ago(now, openedAgoMs);
  const silentSince = ago(now, openedAgoMs + LOST_CONTACT_AFTER_MS);
  const journey = await watched(subject, {
    state: 'LOST_CONTACT',
    startedAt: ago(now, 2 * HOUR),
    lastHeartbeatAt: silentSince,
    responders,
  });
  const [first = ''] = journey.responderIds;
  const alertId = await subject.seedAlert({
    journeyId: journey.journeyId,
    state,
    openedAt,
    silentSince,
    ...(state === 'RESOLVED'
      ? {
          resolvedAt: ago(now, Math.floor(openedAgoMs / 3)),
          resolution: 'BACK_IN_CONTACT' as const,
        }
      : {}),
    ...(recorded
      ? { acknowledgedBy: first, acknowledgedAt: ago(now, Math.floor(openedAgoMs / 2)) }
      : {}),
    ...(smsRaisedAgoMs === null ? {} : { smsRaisedAt: ago(now, smsRaisedAgoMs) }),
  });
  return { ...journey, alertId, openedAt, acknowledgedBy: recorded ? first : null };
}

/** An escalation that escalated, or a failed expectation saying what it was instead. */
function escalated(
  result: EscalateAlertResult,
  what = 'the escalation',
): { messages: AlertMessage[] } {
  expect(result.outcome, `${what} escalated: ${JSON.stringify(result)}`).toBe('escalated');
  if (result.outcome !== 'escalated') {
    throw new Error(`${what} was answered ${JSON.stringify(result)}`);
  }
  return result;
}

/** This alert's escalation time, as the store under test holds it; undefined for an alert it does not hold. */
async function smsRaisedAtOf(
  subject: JourneyStoreUnderTest,
  journeyId: string,
  alertId: string,
): Promise<Date | null | undefined> {
  return (await subject.escalationsOf(journeyId)).find((each) => each.alertId === alertId)
    ?.smsRaisedAt;
}

/** Everything a store holds of one journey's alerts and messages, who is on each alert and when each escalated included. */
async function escalationRecordOf(subject: JourneyStoreUnderTest, journeyId: string) {
  return {
    ...(await acknowledgedRecordOf(subject, journeyId)),
    escalations: [...(await subject.escalationsOf(journeyId))].sort((a, b) =>
      a.alertId.localeCompare(b.alertId),
    ),
  };
}

/** The IDs of what one SMS claim handed out. */
async function smsClaimed(
  subject: JourneyStoreUnderTest,
  leaseMs: number = LEASE_MS,
): Promise<string[]> {
  return (await subject.store.claimDueSms({ limit: BATCH, leaseMs })).messages.map(
    ({ messageId }) => messageId,
  );
}

/** Marks every message sent: the tidy end of a behaviour that left some due. */
async function allSent(subject: JourneyStoreUnderTest, messageIds: readonly string[]) {
  for (const messageId of messageIds) {
    await subject.store.markSent(messageId);
  }
}

// ---------------------------------------------------------------------------
// SM-10: removing a responder, the reset, the round and the walker's warning
// (its spec's shared behaviours 1 to 14, and AC10's, D-100).
// ---------------------------------------------------------------------------

/** The walker's warning that the last responder was removed (SM-02, D-087). */
const WARNING = 'NO_RESPONDER';

/** The removal rule's answers that write nothing, as the store hands them back (approach item 2). */
const NOT_A_RESPONDER: RemoveResponderResult = {
  outcome: 'not_removed',
  decision: { type: 'unchanged', reason: 'NOT_A_RESPONDER' },
};
const NO_SUCH_JOURNEY: RemoveResponderResult = {
  outcome: 'not_removed',
  decision: { type: 'refused', reason: 'JOURNEY_NOT_FOUND' },
};
const JOURNEY_OVER: RemoveResponderResult = {
  outcome: 'not_removed',
  decision: { type: 'ignored', reason: 'JOURNEY_ENDED' },
};

/** A removal that removed, or a failed expectation saying what it was instead. */
function removed(
  result: RemoveResponderResult,
  what = 'the removal',
): { resetAlertId: string | null; messages: AlertMessage[] } {
  expect(result.outcome, `${what} removed: ${JSON.stringify(result)}`).toBe('removed');
  if (result.outcome !== 'removed') {
    throw new Error(`${what} was answered ${JSON.stringify(result)}`);
  }
  return result;
}

/** A removal of this responder from this journey, as the store takes it. */
function removal(
  journey: { journeyId: string },
  responderId: string,
): { journeyId: string; responderId: string } {
  return { journeyId: journey.journeyId, responderId };
}

/** This alert's round, as the store under test holds it; undefined for an alert it does not hold. */
async function roundOf(
  subject: JourneyStoreUnderTest,
  journeyId: string,
  alertId: string,
): Promise<number | undefined> {
  return (await subject.roundsOf(journeyId)).find((each) => each.alertId === alertId)?.round;
}

/** Each message of the journey's alerts' round, by message ID. */
async function messageRoundsByIdOf(
  subject: JourneyStoreUnderTest,
  journeyId: string,
): Promise<Map<string, number>> {
  return new Map(
    (await subject.messageRoundsOf(journeyId)).map(({ messageId, round }) => [messageId, round]),
  );
}

/** The journey's responders as stored, sorted; undefined for a journey the walker does not have. */
async function respondersOf(
  subject: JourneyStoreUnderTest,
  journey: { walkerId: string; journeyId: string },
): Promise<string[] | undefined> {
  const stored = (await subject.journeysOf(journey.walkerId)).find(
    ({ id }) => id === journey.journeyId,
  );
  return stored === undefined ? undefined : [...stored.responderIds].sort();
}

/** Everything a store holds of one journey that a removal could change: its responders, its alerts and their rounds, and its messages, its alerts' and its own. */
async function removalRecordOf(
  subject: JourneyStoreUnderTest,
  journey: { walkerId: string; journeyId: string },
) {
  return {
    ...(await escalationRecordOf(subject, journey.journeyId)),
    journeys: normalised(await subject.journeysOf(journey.walkerId)),
    rounds: [...(await subject.roundsOf(journey.journeyId))].sort((a, b) =>
      a.alertId.localeCompare(b.alertId),
    ),
    messageRounds: byMessage(await subject.messageRoundsOf(journey.journeyId)),
    journeyMessages: byMessage(await subject.journeyMessagesOf(journey.journeyId)),
  };
}

/** Whether a moment lies between two readings of the store's now, both included: the store's own now in between. */
function between(moment: Date | null | undefined, before: Date, after: Date): boolean {
  return (
    moment instanceof Date &&
    moment.getTime() >= before.getTime() &&
    moment.getTime() <= after.getTime()
  );
}

/** A journey's read, its responders sorted, so stores that hand rows back in any order compare equal. */
function readSorted(read: JourneyForRemoval | null) {
  return read === null ? null : { ...read, responderIds: [...read.responderIds].sort() };
}

/**
 * A message put in directly for a behaviour: unsent and due `dueAgoMs`
 * before now (or after, when negative), unless `sentAgoMs` or `withdrawnAgoMs`
 * says otherwise. Resolves to its ID.
 */
async function messageFor(
  subject: JourneyStoreUnderTest,
  {
    alertId,
    recipientId,
    kind,
    attempts = 1,
    lastFailure = null,
    dueAgoMs = MINUTE,
    sentAgoMs = null,
    withdrawnAgoMs = null,
    round,
  }: {
    alertId: string;
    recipientId: string;
    kind: MessageKind;
    attempts?: number;
    lastFailure?: PushFailureReason | null;
    dueAgoMs?: number;
    sentAgoMs?: number | null;
    withdrawnAgoMs?: number | null;
    round?: number;
  },
): Promise<string> {
  const now = await subject.now();
  return subject.seedMessage({
    alertId,
    recipientId,
    kind,
    createdAt: ago(now, 5 * MINUTE),
    nextAttemptAt: ago(now, dueAgoMs),
    attempts,
    lastFailure,
    ...(sentAgoMs === null ? {} : { sentAt: ago(now, sentAgoMs) }),
    ...(withdrawnAgoMs === null ? {} : { withdrawnAt: ago(now, withdrawnAgoMs) }),
    ...(round === undefined ? {} : { round }),
  });
}

/**
 * SM-10-AC17: a message of every kind on each alert given, unsent for each
 * of `unsentFor` and sent for each of `sentFor`, in round 1, but for the
 * kinds `skip` says, which the step under test writes itself.
 */
async function seedEveryKind(
  subject: JourneyStoreUnderTest,
  alerts: readonly { alertId: string; unsentFor: readonly string[]; sentFor: readonly string[] }[],
  skip: (alertId: string, kind: MessageKind) => boolean = () => false,
) {
  const now = await subject.now();
  const seeded: {
    messageId: string;
    alertId: string;
    recipientId: string;
    kind: MessageKind;
    unsent: boolean;
  }[] = [];
  for (const { alertId, unsentFor, sentFor } of alerts) {
    for (const kind of MESSAGE_KINDS) {
      if (skip(alertId, kind)) {
        continue;
      }
      for (const [recipients, unsent] of [
        [unsentFor, true],
        [sentFor, false],
      ] as const) {
        for (const recipientId of recipients) {
          const messageId = await subject.seedMessage({
            alertId,
            recipientId,
            kind,
            createdAt: ago(now, 50 * MINUTE),
            nextAttemptAt: ago(now, 50 * MINUTE),
            attempts: 1,
            lastFailure: unsent ? 'UNAVAILABLE' : null,
            sentAt: unsent ? null : ago(now, 49 * MINUTE),
          });
          seeded.push({ messageId, alertId, recipientId, kind, unsent });
        }
      }
    }
  }
  return seeded;
}

/** Every message of these journeys' alerts that is withdrawn, sorted by message ID. */
async function withdrawnIn(subject: JourneyStoreUnderTest, journeyIds: readonly string[]) {
  return byMessage(
    (await Promise.all(journeyIds.map((journeyId) => subject.withdrawalsOf(journeyId))))
      .flat()
      .filter(({ withdrawnAt }) => withdrawnAt !== null),
  );
}

/** A journey of this walker's, put in directly from their device: the walker's next journey. */
async function nextJourneyOf(
  subject: JourneyStoreUnderTest,
  walker: { walkerId: string; deviceId: string },
  {
    state,
    responders,
    startedAt,
    lastHeartbeatAt = null,
  }: {
    state: FakeJourneyState;
    responders: number;
    startedAt: Date;
    lastHeartbeatAt?: Date | null;
  },
) {
  const responderIds = await users(subject, responders);
  const journeyId = await subject.seedJourney({
    walkerId: walker.walkerId,
    deviceId: walker.deviceId,
    state,
    responderIds,
    startedAt,
    lastHeartbeatAt,
  });
  return { ...walker, journeyId, responderIds };
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
    // RG-03 (SM-10, the spec's "Existing assertions that change by design",
    // "the no-responder refusals", journey-store-behaviour.ts line 2436): this
    // was "LOST-02-AC12: a journey with no responder rows is never moved: the
    // open rejects, and it stays ACTIVE with no alert and no message". D-122
    // item 3 (the owner, Q3 (a)) removes the refusal: SM-02 lets a journey
    // run on with no responder, so when it goes silent its alert opens with
    // nobody to tell, and the SMS check pages the owner. So the open no
    // longer rejects; it opens, writes no message, and the journey is no
    // longer overdue. It keeps its point, that the open is decided on the
    // responder rows as they stand, now in the other direction (SM-10-AC15).
    name: 'SM-10-AC15: a journey with no responder rows is moved all the same: the open opens it, LOST_CONTACT with one OPEN alert and no message, and it is no longer overdue (SM-02, LOST-02)',
    async run(subject) {
      const now = await subject.now();
      const { journeyId } = await watched(subject, {
        startedAt: ago(now, HOUR),
        lastHeartbeatAt: ago(now, LOST_CONTACT_AFTER_MS + MINUTE),
        responders: 0,
      });

      const opened = await subject.store.openLostContactAlert({
        journeyId,
        afterMs: LOST_CONTACT_AFTER_MS,
      });

      expect(opened).toEqual({
        outcome: 'opened',
        alertId: expect.stringMatching(LOWER_UUID) as unknown,
        messages: [],
      });
      expect(await subject.stateOf(journeyId)).toBe('LOST_CONTACT');
      expect((await subject.alertsOf(journeyId)).map(({ state }) => state)).toEqual(['OPEN']);
      expect(await subject.messagesOf(journeyId)).toEqual([]);
      // No longer overdue, so no sweep tries it again.
      const read = await subject.store.overdueJourneys(LOST_CONTACT_AFTER_MS);
      expect(read.journeys.map(({ id }) => id)).not.toContain(journeyId);
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
    // Review loop 3 (the spec's item 21): renamed only. It said "every other
    // journey’s messages"; since loop 2 the walker's own earlier journeys
    // are not left alone. Its `other` journey belongs to another walker, so
    // every assertion holds as it was.
    name: 'LOST-03-AC8: an open withdraws the journey’s earlier alerts’ unsent stand-downs at the store’s now, and leaves alone those already sent, every other walker’s journeys’ messages and its own new ones; an open that skips withdraws nothing',
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
    // Review loop 2 (the spec's item 14b; safety-reviewer; D-112 amended):
    // no overtaking across a walker's journeys. An earlier journey of the
    // walker, ended by "I'm home" while the push failed, can hold unsent HOME
    // messages to the same responders, retried for ever; the new journey's
    // open withdraws them. Another walker's are no all-clear for this one,
    // and are left alone.
    name: 'LOST-03-AC8: an open withdraws the unsent stand-downs of the walker’s earlier journeys, and leaves another walker’s alone',
    async run(subject) {
      const now = await subject.now();
      // An ENDED journey of the walker, ended by "I'm home" 70 minutes ago
      // after its alert: its lost-contact messages sent, and its HOME
      // messages one sent, one failing and due again later, one never
      // handed over.
      const endedByHome = async (
        walker: { walkerId: string; deviceId: string },
        responderIds: string[],
      ) => {
        const journeyId = await subject.seedJourney({
          walkerId: walker.walkerId,
          deviceId: walker.deviceId,
          state: 'ENDED',
          responderIds,
          startedAt: ago(now, 3 * HOUR),
          lastHeartbeatAt: ago(now, 95 * MINUTE),
        });
        const alertId = await subject.seedAlert({
          journeyId,
          state: 'RESOLVED',
          openedAt: ago(now, 90 * MINUTE),
          silentSince: ago(now, 95 * MINUTE),
          resolvedAt: ago(now, 70 * MINUTE),
          resolution: 'HOME',
        });
        for (const recipientId of responderIds) {
          await subject.seedMessage({
            alertId,
            recipientId,
            kind: 'LOST_CONTACT',
            createdAt: ago(now, 90 * MINUTE),
            nextAttemptAt: ago(now, 90 * MINUTE),
            attempts: 1,
            sentAt: ago(now, 90 * MINUTE),
          });
        }
        const [sent = '', failing = '', never = ''] = responderIds;
        const home = (
          recipientId: string,
          extra: {
            attempts?: number;
            nextAttemptAt?: Date;
            sentAt?: Date;
            lastFailure?: 'UNAVAILABLE';
          },
        ) =>
          subject.seedMessage({
            alertId,
            recipientId,
            kind: 'HOME',
            createdAt: ago(now, 70 * MINUTE),
            nextAttemptAt: ago(now, 70 * MINUTE),
            ...extra,
          });
        return {
          journeyId,
          alertId,
          homes: {
            sent: await home(sent, { attempts: 1, sentAt: ago(now, 69 * MINUTE) }),
            failing: await home(failing, {
              attempts: 3,
              nextAttemptAt: ago(now, -30 * SECONDS),
              lastFailure: 'UNAVAILABLE',
            }),
            never: await home(never, {}),
          },
        };
      };
      // The walker's new journey, with the same responders, silent ten
      // minutes: overdue.
      const j2 = await watched(subject, {
        startedAt: ago(now, 20 * MINUTE),
        lastHeartbeatAt: ago(now, 10 * MINUTE),
        responders: 3,
      });
      const j1 = await endedByHome(j2, j2.responderIds);
      // Another walker, with the same responders, and their own ended journey.
      const [otherWalker = ''] = await users(subject, 1);
      const other = await endedByHome(
        { walkerId: otherWalker, deviceId: await subject.addDevice(otherWalker) },
        j2.responderIds,
      );
      const j1Before = byMessage(await subject.messagesOf(j1.journeyId));
      const otherBefore = await alertRecordOf(subject, other.journeyId);

      const opened = await subject.store.openLostContactAlert({
        journeyId: j2.journeyId,
        afterMs: LOST_CONTACT_AFTER_MS,
      });

      if (opened.outcome !== 'opened') {
        throw new Error(`expected the new journey to be opened, but it was ${opened.outcome}`);
      }
      const openedAt = (await subject.alertsOf(j2.journeyId)).find(
        ({ id }) => id === opened.alertId,
      )?.openedAt;
      expect(openedAt).toBeInstanceOf(Date);
      const withdrawnAt = await withdrawnAtOf(subject, j1.journeyId);
      expect(withdrawnAt.get(j1.homes.failing), 'failing').toEqual(openedAt);
      expect(withdrawnAt.get(j1.homes.never), 'never handed over').toEqual(openedAt);
      expect(withdrawnAt.get(j1.homes.sent), 'sent').toBeNull();
      for (const message of j1Before.filter(({ kind }) => kind === 'LOST_CONTACT')) {
        expect(withdrawnAt.get(message.messageId), 'the earlier journey’s lost-contact').toBeNull();
      }
      // Withdrawing keeps everything else of the earlier journey's messages.
      expect(byMessage(await subject.messagesOf(j1.journeyId))).toEqual(j1Before);
      // Another walker's are left exactly as they were.
      expect(await alertRecordOf(subject, other.journeyId)).toEqual(otherBefore);
      for (const { messageId } of opened.messages) {
        expect((await withdrawnAtOf(subject, j2.journeyId)).get(messageId)).toBeNull();
      }
    },
  },
  {
    // Review loop 2 (the spec's item 17a): the open's withdrawal is of
    // stand-downs only. An unsent lost-contact message of an earlier alert,
    // which the code never leaves past the alert's resolution, is put there
    // directly, and the open leaves it alone; the earlier alert's unsent
    // stand-down beside it is withdrawn, the control.
    name: 'LOST-03-AC8: an open leaves an earlier alert’s unsent LOST_CONTACT message alone',
    async run(subject) {
      const now = await subject.now();
      const journey = await watched(subject, {
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, 70 * MINUTE),
        responders: 1,
      });
      const [recipientId = ''] = journey.responderIds;
      const earlier = await subject.seedAlert({
        journeyId: journey.journeyId,
        state: 'RESOLVED',
        openedAt: ago(now, 90 * MINUTE),
        silentSince: ago(now, 95 * MINUTE),
        resolvedAt: ago(now, 70 * MINUTE),
        resolution: 'BACK_IN_CONTACT',
      });
      const lostContact = await subject.seedMessage({
        alertId: earlier,
        recipientId,
        kind: 'LOST_CONTACT',
        createdAt: ago(now, 90 * MINUTE),
        nextAttemptAt: ago(now, 89 * MINUTE),
        attempts: 2,
        lastFailure: 'UNAVAILABLE',
      });
      const standDown = await subject.seedMessage({
        alertId: earlier,
        recipientId,
        kind: 'BACK_IN_CONTACT',
        createdAt: ago(now, 70 * MINUTE),
        nextAttemptAt: ago(now, 70 * MINUTE),
      });

      const opened = await subject.store.openLostContactAlert({
        journeyId: journey.journeyId,
        afterMs: LOST_CONTACT_AFTER_MS,
      });

      expect(opened.outcome).toBe('opened');
      const withdrawnAt = await withdrawnAtOf(subject, journey.journeyId);
      expect(withdrawnAt.get(lostContact), 'the earlier lost-contact message').toBeNull();
      expect(withdrawnAt.get(standDown), 'the earlier stand-down, the control').toBeInstanceOf(
        Date,
      );
    },
  },
  {
    // Review loop 3 (the spec's item 19a; safety-reviewer; D-111, D-112
    // amended): overtaking matters only for someone the new alert's
    // lost-contact push will reach. A responder of the earlier journey who
    // is not one of the new journey's heard of the earlier loss and must
    // still be stood down: their stand-down stays, to be sent.
    name: 'LOST-03-AC8: an open withdraws an earlier journey’s unsent stand-down only for a responder of the new journey, and leaves another responder’s to be sent',
    async run(subject) {
      const now = await subject.now();
      // J2 has B alone; J1, the walker's earlier journey, had A and B.
      const j2 = await watched(subject, {
        startedAt: ago(now, 20 * MINUTE),
        lastHeartbeatAt: ago(now, 10 * MINUTE),
        responders: 1,
      });
      const [b = ''] = j2.responderIds;
      const [a = ''] = await users(subject, 1);
      const j1 = await subject.seedJourney({
        walkerId: j2.walkerId,
        deviceId: j2.deviceId,
        state: 'ENDED',
        responderIds: [a, b],
        startedAt: ago(now, 3 * HOUR),
        lastHeartbeatAt: ago(now, 95 * MINUTE),
      });
      const alertId = await subject.seedAlert({
        journeyId: j1,
        state: 'RESOLVED',
        openedAt: ago(now, 90 * MINUTE),
        silentSince: ago(now, 95 * MINUTE),
        resolvedAt: ago(now, 70 * MINUTE),
        resolution: 'HOME',
      });
      const homeFor = async (recipientId: string) => {
        await subject.seedMessage({
          alertId,
          recipientId,
          kind: 'LOST_CONTACT',
          createdAt: ago(now, 90 * MINUTE),
          nextAttemptAt: ago(now, 90 * MINUTE),
          attempts: 1,
          sentAt: ago(now, 90 * MINUTE),
        });
        return subject.seedMessage({
          alertId,
          recipientId,
          kind: 'HOME',
          createdAt: ago(now, 70 * MINUTE),
          nextAttemptAt: ago(now, 70 * MINUTE),
          attempts: 2,
          lastFailure: 'UNAVAILABLE',
        });
      };
      const homes = { a: await homeFor(a), b: await homeFor(b) };

      const opened = await subject.store.openLostContactAlert({
        journeyId: j2.journeyId,
        afterMs: LOST_CONTACT_AFTER_MS,
      });

      if (opened.outcome !== 'opened') {
        throw new Error(`expected the new journey to be opened, but it was ${opened.outcome}`);
      }
      expect(recipientsOf(opened.messages)).toEqual([b]);
      const openedAt = (await subject.alertsOf(j2.journeyId)).find(
        ({ id }) => id === opened.alertId,
      )?.openedAt;
      const withdrawnAt = await withdrawnAtOf(subject, j1);
      // B, whom the new alert will tell: withdrawn at the open's now.
      expect(withdrawnAt.get(homes.b), 'B’s HOME').toEqual(openedAt);
      // A, whom it will not: left, and handed out by the next claim.
      expect(withdrawnAt.get(homes.a), 'A’s HOME').toBeNull();
      const claimed = (
        await subject.store.claimDue({ limit: BATCH, leaseMs: LEASE_MS })
      ).messages.map(({ messageId }) => messageId);
      expect(claimed).toContain(homes.a);
      expect(claimed).not.toContain(homes.b);
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
        // Review loop 2 (the spec's item 16): another walker's ID with the
        // journey's own device. Only the walker check refuses this, so a
        // store that asked the rule with the locked row's own walker would
        // end the journey here.
        await expect(
          subject.store.recordHome({ ...homeOf(journey), walkerId: stranger }),
          'another walker, from the journey’s own device',
        ).rejects.toThrow(/refused/);
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
      // Review loop 2 (the spec's item 16): another walker on an ENDED
      // journey is refused, not told it has ended, as the rule looks at the
      // walker before the end; with the journey's own device, and with theirs.
      for (const deviceId of [ended.deviceId, strangersDevice]) {
        await expect(
          subject.store.recordHome({ journeyId: ended.journeyId, walkerId: stranger, deviceId }),
          'another walker, on an ENDED journey',
        ).rejects.toThrow(/refused/);
      }
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
  {
    // Review loop 2 (the spec's item 15; D-100): the IDs are compared
    // exactly, as the domain's rule compares them. The fake once read them in
    // any case, more leniently than the adapter; now both stores answer this.
    name: 'LOST-03-AC16: recordHome with the walker’s or the device’s ID in another case than the stored one is refused by the rule under the lock, and changes nothing',
    async run(subject) {
      const now = await subject.now();
      const lost = await lostWith(subject, 2);
      const active = await watched(subject, {
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, MINUTE),
      });

      for (const journey of [lost, active]) {
        const { walkerId, deviceId } = journey;
        expect(walkerId.toUpperCase(), 'an ID with a letter in it').not.toBe(walkerId);
        expect(deviceId.toUpperCase(), 'an ID with a letter in it').not.toBe(deviceId);
        const record = await alertRecordOf(subject, journey.journeyId);
        const end = await subject.endOf(journey.journeyId);

        await expect(
          subject.store.recordHome({ ...homeOf(journey), walkerId: walkerId.toUpperCase() }),
          'the walker’s ID in upper case',
        ).rejects.toThrow(/refused/);
        await expect(
          subject.store.recordHome({ ...homeOf(journey), deviceId: deviceId.toUpperCase() }),
          'the device’s ID in upper case',
        ).rejects.toThrow(/refused/);

        expect(await alertRecordOf(subject, journey.journeyId)).toEqual(record);
        expect(await subject.endOf(journey.journeyId)).toEqual(end);
      }
    },
  },
  // -------------------------------------------------------------------------
  // LOST-06: "I'm on it" (its spec's shared behaviours 1 to 11, D-100).
  // -------------------------------------------------------------------------
  {
    name: 'LOST-06-AC2: alertForAcknowledgement reads the alert’s state, who is recorded on it and its journey’s responders, in either case and without waiting for a held row; and null for an ID no alert has',
    async run(subject) {
      const readOf = async (alertId: string) => {
        const read = await subject.store.alertForAcknowledgement(alertId);
        return read === null ? null : { ...read, responderIds: [...read.responderIds].sort() };
      };
      const lost = await lostWith(subject, 3);
      const [r1 = '', r2 = ''] = lost.responderIds;

      expect(await readOf(lost.alertId)).toEqual({
        id: lost.alertId,
        state: 'OPEN',
        acknowledgedBy: null,
        responderIds: [...lost.responderIds].sort(),
      });
      expect(lost.alertId.toUpperCase(), 'an ID with a letter in it').not.toBe(lost.alertId);
      expect(await readOf(lost.alertId.toUpperCase())).toEqual(await readOf(lost.alertId));
      expect(await subject.store.alertForAcknowledgement(syntheticUuid())).toBeNull();

      // A plain read: a row another transaction holds is read all the same,
      // so nothing that refuses waits for a lock (AC3).
      const held = await subject.hold(lost.journeyId);
      try {
        expect(
          await within(2_000, readOf(lost.alertId), 'the read of a held journey’s alert'),
        ).toMatchObject({ id: lost.alertId, state: 'OPEN' });
      } finally {
        await held.release();
      }

      // What the rule reads follows the alert: recorded, then resolved.
      acknowledged(
        await subject.store.recordAcknowledgement({ alertId: lost.alertId, responderId: r1 }),
      );
      expect(await readOf(lost.alertId)).toMatchObject({
        state: 'ACKNOWLEDGED',
        acknowledgedBy: r1,
      });
      backInContact(
        await subject.store.recordHeartbeat(await freshHeartbeat(subject, lost.journeyId)),
      );
      expect(await readOf(lost.alertId)).toMatchObject({ state: 'RESOLVED', acknowledgedBy: r1 });

      // Put in directly: ESCALATED with nobody recorded, and ACKNOWLEDGED with R2.
      const now = await subject.now();
      for (const [state, acknowledgedBy] of [
        ['ESCALATED', null],
        ['ACKNOWLEDGED', r2],
      ] as const) {
        // A new walker's journey; R2 follows it too when R2 is the one
        // recorded, so whoever is on it is one of its responders.
        const [walkerId = '', follower = ''] = await users(subject, 2);
        const responderIds = acknowledgedBy === null ? [follower] : [follower, acknowledgedBy];
        const journeyId = await subject.seedJourney({
          walkerId,
          deviceId: await subject.addDevice(walkerId),
          state: 'LOST_CONTACT',
          responderIds,
          startedAt: ago(now, 2 * HOUR),
          lastHeartbeatAt: ago(now, HOUR),
        });
        const alertId = await subject.seedAlert({
          journeyId,
          state,
          openedAt: ago(now, 55 * MINUTE),
          silentSince: ago(now, HOUR),
          acknowledgedBy,
          acknowledgedAt: acknowledgedBy === null ? null : ago(now, 50 * MINUTE),
        });

        expect(await readOf(alertId), state).toEqual({
          id: alertId,
          state,
          acknowledgedBy,
          responderIds: [...responderIds].sort(),
        });
      }
    },
  },
  {
    name: 'LOST-06-AC2: recordAcknowledgement by a responder of the journey moves its unresolved alert — OPEN, ESCALATED, or ACKNOWLEDGED with nobody recorded — to ACKNOWLEDGED, acknowledged by that responder at the store’s now, and writes one ACKNOWLEDGED message per other responder row, each with an ID of its own and due at that now; the journey, its other alerts, another journey’s alert and every lost-contact message are untouched',
    async run(subject) {
      for (const state of ['OPEN', 'ESCALATED', 'ACKNOWLEDGED'] as const) {
        const now = await subject.now();
        const journey = await watched(subject, {
          state: 'LOST_CONTACT',
          startedAt: ago(now, 3 * HOUR),
          lastHeartbeatAt: ago(now, HOUR),
          responders: 3,
        });
        const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
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
          await subject.seedMessage({
            alertId: older,
            recipientId,
            kind: 'LOST_CONTACT',
            createdAt: ago(now, 2 * HOUR + 10 * MINUTE),
            nextAttemptAt: ago(now, 2 * HOUR + 10 * MINUTE),
            attempts: 1,
            sentAt: ago(now, 2 * HOUR + 10 * MINUTE),
          });
        }
        // This silence's alert, in `state`, nobody recorded; its lost-contact
        // messages: R1's accepted, R2's failed and due again, R3's never claimed.
        const current = await subject.seedAlert({
          journeyId: journey.journeyId,
          state,
          openedAt: ago(now, 55 * MINUTE),
          silentSince: ago(now, HOUR),
        });
        for (const [recipientId, given] of [
          [r1, { attempts: 1, sentAt: ago(now, 54 * MINUTE) }],
          [r2, { attempts: 1, lastFailure: 'NO_TARGET', nextAttemptAt: ago(now, -10 * SECOND) }],
          [r3, {}],
        ] as const) {
          await subject.seedMessage({
            alertId: current,
            recipientId,
            kind: 'LOST_CONTACT',
            createdAt: ago(now, 55 * MINUTE),
            nextAttemptAt: ago(now, 55 * MINUTE),
            ...given,
          });
        }
        const other = await lostWith(subject, 1);
        const otherBefore = await acknowledgedRecordOf(subject, other.journeyId);
        const before = await acknowledgedRecordOf(subject, journey.journeyId);
        const lastContact = await subject.lastHeartbeatAt(journey.journeyId);

        const from = await subject.now();
        const result = await subject.store.recordAcknowledgement({
          alertId: current,
          responderId: r1,
        });
        const to = await subject.now();

        const recorded = acknowledged(result, state);
        const after = await acknowledgedRecordOf(subject, journey.journeyId);
        const acknowledgement = after.acknowledgements.find(({ alertId }) => alertId === current);
        expect(acknowledgement?.acknowledgedBy, state).toBe(r1);
        const at = acknowledgement?.acknowledgedAt ?? new Date(Number.NaN);
        expect(at.getTime(), state).toBeGreaterThanOrEqual(from.getTime());
        expect(at.getTime(), state).toBeLessThanOrEqual(to.getTime());
        expect(after.alerts.find(({ id }) => id === current)?.state, state).toBe('ACKNOWLEDGED');

        // The notices: one per responder row but R1's, due at that now.
        const notices = ofKind(after.messages, current, NOTICE);
        expect(recipientsOf(notices), state).toEqual([r2, r3].sort());
        const written = new Map(after.withdrawals.map((each) => [each.messageId, each]));
        for (const notice of notices) {
          expect(notice, state).toMatchObject({ attempts: 0, sentAt: null, lastFailure: null });
          expect(notice.nextAttemptAt, state).toEqual(at);
          expect(written.get(notice.messageId)?.createdAt, state).toEqual(at);
          expect(written.get(notice.messageId)?.withdrawnAt, state).toBeNull();
          expect(notice.messageId, state).toMatch(LOWER_UUID);
        }
        const ids = notices.map(({ messageId }) => messageId);
        expect(new Set(ids).size, state).toBe(ids.length);
        const everyOtherId = [
          ...before.messages.map(({ messageId }) => messageId),
          current,
          older,
          journey.journeyId,
          journey.walkerId,
          journey.deviceId,
          ...journey.responderIds,
        ];
        expect(
          ids.filter((id) => everyOtherId.includes(id)),
          state,
        ).toEqual([]);
        expect(byRecipient(recorded.messages), state).toEqual(notices.map(asAnswered));

        // Untouched: the journey, its older alert, every lost-contact message
        // (none withdrawn, none re-timed), and another journey's alert.
        expect(after.state, state).toBe('LOST_CONTACT');
        expect(await subject.lastHeartbeatAt(journey.journeyId), state).toEqual(lastContact);
        expect(
          after.messages.filter(({ kind }) => kind !== NOTICE),
          state,
        ).toEqual(before.messages);
        expect(
          after.withdrawals.filter(({ messageId }) => !ids.includes(messageId)),
          state,
        ).toEqual(before.withdrawals);
        expect(
          after.alerts.filter(({ id }) => id !== current),
          state,
        ).toEqual(before.alerts.filter(({ id }) => id !== current));
        expect(after.resolutions, state).toEqual(before.resolutions);
        expect(
          after.acknowledgements.filter(({ alertId }) => alertId !== current),
          state,
        ).toEqual(before.acknowledgements.filter(({ alertId }) => alertId !== current));
        expect(await acknowledgedRecordOf(subject, other.journeyId), state).toEqual(otherBefore);
      }
    },
  },
  {
    name: 'LOST-06-AC3: recordAcknowledgement from a user who is not a responder of the alert’s journey — the walker, another walker, a responder of another journey — or for an alert ID no alert has, or with the responder’s own ID in another case, compared exactly, answers ALERT_NOT_FOUND and writes nothing',
    async run(subject) {
      const lost = await lostWith(subject, 2);
      const [r1 = ''] = lost.responderIds;
      const now = await subject.now();
      const elsewhere = await watched(subject, {
        state: 'LOST_CONTACT',
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, HOUR),
        responders: 1,
      });
      const [theirs = ''] = elsewhere.responderIds;
      expect(r1.toUpperCase(), 'an ID with a letter in it').not.toBe(r1);
      const before = await acknowledgedRecordOf(subject, lost.journeyId);

      for (const [who, asked] of [
        ['the walker', { alertId: lost.alertId, responderId: lost.walkerId }],
        ['another walker', { alertId: lost.alertId, responderId: elsewhere.walkerId }],
        ['a responder of another journey only', { alertId: lost.alertId, responderId: theirs }],
        ['an alert ID no alert has', { alertId: syntheticUuid(), responderId: r1 }],
        ['R1’s own ID in upper case', { alertId: lost.alertId, responderId: r1.toUpperCase() }],
      ] as const) {
        expect(await subject.store.recordAcknowledgement(asked), who).toEqual(NOT_FOUND);
      }

      expect(await acknowledgedRecordOf(subject, lost.journeyId)).toEqual(before);
      // The control: R1, a responder of the alert's journey, is recorded.
      acknowledged(
        await subject.store.recordAcknowledgement({ alertId: lost.alertId, responderId: r1 }),
      );
    },
  },
  {
    name: 'LOST-06-AC4: recordAcknowledgement by the responder already recorded answers ALREADY_YOURS and writes nothing: acknowledged_at keeps its first time',
    async run(subject) {
      const lost = await lostWith(subject, 3);
      const [r1 = ''] = lost.responderIds;
      const first = acknowledged(
        await subject.store.recordAcknowledgement({ alertId: lost.alertId, responderId: r1 }),
      );
      expect(first.messages).toHaveLength(2);
      const before = await acknowledgedRecordOf(subject, lost.journeyId);
      // The first answer lost, sent again once the clock has moved on.
      await subject.letTimePass(1_100);

      expect(
        await subject.store.recordAcknowledgement({ alertId: lost.alertId, responderId: r1 }),
      ).toEqual(YOURS);

      expect(await acknowledgedRecordOf(subject, lost.journeyId)).toEqual(before);
      expect(before.acknowledgements.map(({ acknowledgedBy }) => acknowledgedBy)).toEqual([r1]);
    },
  },
  {
    name: 'LOST-06-AC4: recordAcknowledgement by another responder, when someone is recorded, answers ALREADY_ACKNOWLEDGED and writes nothing',
    async run(subject) {
      const lost = await lostWith(subject, 3);
      const [r1 = '', r2 = ''] = lost.responderIds;
      acknowledged(
        await subject.store.recordAcknowledgement({ alertId: lost.alertId, responderId: r1 }),
      );
      const before = await acknowledgedRecordOf(subject, lost.journeyId);

      expect(
        await subject.store.recordAcknowledgement({ alertId: lost.alertId, responderId: r2 }),
      ).toEqual(TAKEN);
      expect(await acknowledgedRecordOf(subject, lost.journeyId)).toEqual(before);

      // The same for an alert put in ACKNOWLEDGED with someone recorded.
      const now = await subject.now();
      const journey = await watched(subject, {
        state: 'LOST_CONTACT',
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, HOUR),
        responders: 2,
      });
      const [onIt = '', other = ''] = journey.responderIds;
      const alertId = await subject.seedAlert({
        journeyId: journey.journeyId,
        state: 'ACKNOWLEDGED',
        openedAt: ago(now, 55 * MINUTE),
        silentSince: ago(now, HOUR),
        acknowledgedBy: onIt,
        acknowledgedAt: ago(now, 50 * MINUTE),
      });
      const seeded = await acknowledgedRecordOf(subject, journey.journeyId);

      expect(await subject.store.recordAcknowledgement({ alertId, responderId: other })).toEqual(
        TAKEN,
      );
      expect(await subject.store.recordAcknowledgement({ alertId, responderId: onIt })).toEqual(
        YOURS,
      );
      expect(await acknowledgedRecordOf(subject, journey.journeyId)).toEqual(seeded);
    },
  },
  {
    name: 'LOST-06-AC5: recordAcknowledgement of a RESOLVED alert answers ALERT_RESOLVED and writes nothing, whatever resolved it',
    async run(subject) {
      for (const [how, acknowledgedFirst] of [
        ['a fresh heartbeat', false],
        ['a fresh heartbeat', true],
        ['"I’m home"', false],
        ['"I’m home"', true],
      ] as const) {
        const at = `${how}${acknowledgedFirst ? ', after R1 acknowledged it' : ''}`;
        const lost = await lostWith(subject, 2);
        const [r1 = '', r2 = ''] = lost.responderIds;
        if (acknowledgedFirst) {
          acknowledged(
            await subject.store.recordAcknowledgement({ alertId: lost.alertId, responderId: r1 }),
            at,
          );
        }
        if (how === 'a fresh heartbeat') {
          backInContact(
            await subject.store.recordHeartbeat(await freshHeartbeat(subject, lost.journeyId)),
          );
        } else {
          endedHome(await subject.store.recordHome(homeOf(lost)));
        }
        const before = await acknowledgedRecordOf(subject, lost.journeyId);

        for (const responderId of [r1, r2]) {
          expect(
            await subject.store.recordAcknowledgement({ alertId: lost.alertId, responderId }),
            at,
          ).toEqual(OVER);
        }

        expect(await acknowledgedRecordOf(subject, lost.journeyId), at).toEqual(before);
      }

      // An earlier alert's acknowledgement never reaches the journey's open
      // one: J with A RESOLVED and A2 OPEN, both put in directly.
      const now = await subject.now();
      const journey = await watched(subject, {
        state: 'LOST_CONTACT',
        startedAt: ago(now, 3 * HOUR),
        lastHeartbeatAt: ago(now, HOUR),
        responders: 2,
      });
      const [r1 = ''] = journey.responderIds;
      const earlier = await subject.seedAlert({
        journeyId: journey.journeyId,
        state: 'RESOLVED',
        openedAt: ago(now, 2 * HOUR),
        silentSince: ago(now, 2 * HOUR + 5 * MINUTE),
        resolvedAt: ago(now, 90 * MINUTE),
        resolution: 'BACK_IN_CONTACT',
      });
      const open = await subject.seedAlert({
        journeyId: journey.journeyId,
        state: 'OPEN',
        openedAt: ago(now, 55 * MINUTE),
        silentSince: ago(now, HOUR),
      });
      const before = await acknowledgedRecordOf(subject, journey.journeyId);

      expect(
        await subject.store.recordAcknowledgement({ alertId: earlier, responderId: r1 }),
      ).toEqual(OVER);

      expect(await acknowledgedRecordOf(subject, journey.journeyId)).toEqual(before);
      expect(await acknowledgementOf(subject, journey.journeyId, open)).toEqual({
        alertId: open,
        acknowledgedBy: null,
        acknowledgedAt: null,
      });
      expect(ofKind(await subject.messagesOf(journey.journeyId), open, NOTICE)).toEqual([]);
    },
  },
  {
    name: `LOST-06-AC6: ${String(RACERS)} different responders acknowledging one alert at once, ${String(RACE_ROUNDS)} times over: exactly one is recorded and every other answers ALREADY_ACKNOWLEDGED, none an error, with one set of notices; and ${String(RACERS)} copies of one responder’s at once record it once`,
    async run(subject) {
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const at = `round ${String(round)}`;
        const lost = await lostWith(subject, RACERS);

        // Promise.all rejects if any acknowledgement fails outright: none may.
        const results = await Promise.all(
          lost.responderIds.map((responderId) =>
            subject.store.recordAcknowledgement({ alertId: lost.alertId, responderId }),
          ),
        );

        const winners = lost.responderIds.filter(
          (_, index) => results[index]?.outcome === 'acknowledged',
        );
        expect(winners, at).toHaveLength(1);
        const [winner = ''] = winners;
        expect(
          results.filter(({ outcome }) => outcome !== 'acknowledged'),
          at,
        ).toEqual(Array.from({ length: RACERS - 1 }, () => TAKEN));
        expect(
          (await acknowledgementOf(subject, lost.journeyId, lost.alertId))?.acknowledgedBy,
        ).toBe(winner);
        expect(
          recipientsOf(ofKind(await subject.messagesOf(lost.journeyId), lost.alertId, NOTICE)),
          at,
        ).toEqual(lost.responderIds.filter((id) => id !== winner).sort());

        // Copies of one responder's, at once: one records, every other finds it theirs.
        const copies = await lostWith(subject, 2);
        const [r1 = '', r2 = ''] = copies.responderIds;
        const answers = await Promise.all(
          Array.from({ length: RACERS }, () =>
            subject.store.recordAcknowledgement({ alertId: copies.alertId, responderId: r1 }),
          ),
        );
        expect(
          answers.filter(({ outcome }) => outcome === 'acknowledged'),
          at,
        ).toHaveLength(1);
        expect(
          answers.filter(({ outcome }) => outcome !== 'acknowledged'),
          at,
        ).toEqual(Array.from({ length: RACERS - 1 }, () => YOURS));
        expect(
          (await acknowledgementOf(subject, copies.journeyId, copies.alertId))?.acknowledgedBy,
          at,
        ).toBe(r1);
        expect(
          recipientsOf(ofKind(await subject.messagesOf(copies.journeyId), copies.alertId, NOTICE)),
          at,
        ).toEqual([r2]);
      }
    },
  },
  {
    name: 'LOST-06-AC7: when contact comes back, or "I’m home" ends the journey, an ACKNOWLEDGED alert is resolved keeping who acknowledged it and when; its ACKNOWLEDGED messages not yet sent are withdrawn at the store’s now, keeping their attempts and last failure, and are never handed out again; sent ones are left as they were; every responder, the acknowledger included, gets one stand-down',
    async run(subject) {
      for (const how of ['heartbeat', 'home'] as const) {
        for (const theirs of ['failed and due again', 'never claimed'] as const) {
          const at = `${how}, R3’s notice ${theirs}`;
          const lost = await lostWith(subject, 3);
          const [r1 = '', r2 = '', r3 = ''] = lost.responderIds;
          // Every lost-contact push accepted, so only the notices are left.
          for (const { messageId } of lost.messages) {
            await subject.store.markSent(messageId);
          }
          const recorded = acknowledged(
            await subject.store.recordAcknowledgement({ alertId: lost.alertId, responderId: r1 }),
            at,
          );
          const noticeOf = (recipientId: string): string =>
            recorded.messages.find((message) => message.recipientId === recipientId)?.messageId ??
            '';
          const acknowledgement = await acknowledgementOf(subject, lost.journeyId, lost.alertId);
          if (theirs === 'failed and due again') {
            const claimed = (
              await subject.store.claimDue({ limit: BATCH, leaseMs: LEASE_MS })
            ).messages.map(({ messageId }) => messageId);
            expect(claimed, at).toEqual(expect.arrayContaining([noticeOf(r2), noticeOf(r3)]));
            await subject.store.markSent(noticeOf(r2));
            await subject.store.markFailed({
              messageId: noticeOf(r3),
              reason: 'NO_TARGET',
              retryAfterMs: SECOND,
            });
          } else {
            await subject.store.markSent(noticeOf(r2));
          }
          const before = new Map(
            (await subject.messagesOf(lost.journeyId)).map((message) => [
              message.messageId,
              message,
            ]),
          );

          const result =
            how === 'heartbeat'
              ? backInContact(
                  await subject.store.recordHeartbeat(
                    await freshHeartbeat(subject, lost.journeyId),
                  ),
                )
              : endedHome(await subject.store.recordHome(homeOf(lost)));

          const kind = how === 'heartbeat' ? 'BACK_IN_CONTACT' : 'HOME';
          expect(result.alertId, at).toBe(lost.alertId);
          const resolution = await resolutionOf(subject, lost.journeyId, lost.alertId);
          expect(resolution?.resolution, at).toBe(kind);
          const resolvedAt = resolution?.resolvedAt ?? new Date(Number.NaN);
          expect(
            (await subject.alertsOf(lost.journeyId)).map(({ state }) => state),
            at,
          ).toEqual(['RESOLVED']);
          expect(await acknowledgementOf(subject, lost.journeyId, lost.alertId), at).toEqual(
            acknowledgement,
          );
          expect(acknowledgement?.acknowledgedBy, at).toBe(r1);

          const withdrawnAt = await withdrawnAtOf(subject, lost.journeyId);
          const stored = new Map(
            (await subject.messagesOf(lost.journeyId)).map((message) => [
              message.messageId,
              message,
            ]),
          );
          // R3's, unsent: withdrawn at the store's now, its attempts and last failure kept.
          expect(withdrawnAt.get(noticeOf(r3)), at).toEqual(resolvedAt);
          expect(stored.get(noticeOf(r3)), at).toEqual(before.get(noticeOf(r3)));
          // R2's, sent: as it was.
          expect(withdrawnAt.get(noticeOf(r2)), at).toBeNull();
          expect(stored.get(noticeOf(r2)), at).toEqual(before.get(noticeOf(r2)));
          // One stand-down each, the acknowledger included.
          const standDowns = ofKind([...stored.values()], lost.alertId, kind);
          expect(recipientsOf(standDowns), at).toEqual([r1, r2, r3].sort());
          expect(byRecipient(result.messages), at).toEqual(standDowns.map(asAnswered));

          // Never handed out again, whatever its due time.
          await subject.letTimePass(1_500);
          const handedOut = (
            await subject.store.claimDue({ limit: BATCH, leaseMs: 0 })
          ).messages.map(({ messageId }) => messageId);
          expect(handedOut, at).not.toContain(noticeOf(r3));
          expect(handedOut, at).not.toContain(noticeOf(r2));
          for (const messageId of handedOut) {
            await subject.store.markSent(messageId);
          }
        }
      }
    },
  },
  {
    name: 'LOST-06-AC7: for any sequence of acknowledgements, heartbeats fresh or stale, sweeps and "I’m home", after every step an alert is ACKNOWLEDGED exactly when it is unresolved and someone is recorded on it, nobody but one responder is ever recorded, the notices are one per other responder of an acknowledged alert, and no RESOLVED alert has an ACKNOWLEDGED message neither sent nor withdrawn',
    async run(subject) {
      const margin = subject.timeMarginMs;
      const step = fc.oneof(
        fc.record({ kind: fc.constant('heartbeat' as const), agoMs: silences(margin) }),
        fc.record({ kind: fc.constant('sweep' as const) }),
        // Who: the first responder, the second, the walker, or a stranger.
        fc.record({
          kind: fc.constant('acknowledge' as const),
          who: fc.integer({ min: 0, max: 3 }),
        }),
        fc.record({ kind: fc.constant('home' as const) }),
      );

      await fc.assert(
        fc.asyncProperty(
          silences(margin),
          fc.array(step, { maxLength: 8 }),
          async (startedAgoMs, steps) => {
            const now = await subject.now();
            const journey = await watched(subject, {
              startedAt: ago(now, startedAgoMs),
              responders: 2,
            });
            const { journeyId, responderIds } = journey;
            const [stranger = ''] = await users(subject, 1);
            const senders = [...responderIds, journey.walkerId, stranger];
            // The rules, applied step by step: the journey's silence and
            // state, and each alert opened so far, in order, with whether it
            // resolved and who is on it.
            let silentForMs = startedAgoMs;
            let state: 'ACTIVE' | 'LOST_CONTACT' | 'ENDED' = 'ACTIVE';
            const model: { id: string; resolved: boolean; acknowledgedBy: string | null }[] = [];

            for (const next of steps) {
              const current = model.at(-1);
              if (next.kind === 'heartbeat') {
                // Never before the start: contact comes after a journey began.
                const agoMs = Math.min(next.agoMs, startedAgoMs);
                const result = await subject.store.recordHeartbeat(
                  heartbeatFor(journeyId, { receivedAt: ago(now, agoMs), position: null }),
                );
                if (state === 'ENDED') {
                  expect(result.outcome, 'a heartbeat after the end').toBe('ended');
                } else {
                  silentForMs = Math.min(silentForMs, agoMs);
                  const back = state === 'LOST_CONTACT' && silentForMs < LOST_CONTACT_AFTER_MS;
                  expect(result.outcome, 'the heartbeat’s answer').toBe(
                    back ? 'back_in_contact' : 'recorded',
                  );
                  if (back) {
                    state = 'ACTIVE';
                    if (current !== undefined) {
                      current.resolved = true;
                    }
                  }
                }
              } else if (next.kind === 'sweep') {
                const opened = await sweepOf(subject, [journeyId]);
                if (state === 'ACTIVE' && silentForMs >= LOST_CONTACT_AFTER_MS) {
                  state = 'LOST_CONTACT';
                  const [result] = opened;
                  if (result?.outcome !== 'opened') {
                    throw new Error(
                      `expected the sweep to open the alert: ${JSON.stringify(opened)}`,
                    );
                  }
                  model.push({ id: result.alertId, resolved: false, acknowledgedBy: null });
                }
              } else if (next.kind === 'home') {
                const result = await subject.store.recordHome(homeOf(journey));
                if (state === 'ENDED') {
                  expect(result).toEqual({ outcome: 'already_ended' });
                } else {
                  expect(result.outcome, '"I’m home"').toBe('home');
                  if (state === 'LOST_CONTACT' && current !== undefined) {
                    current.resolved = true;
                  }
                  state = 'ENDED';
                }
              } else {
                const sender = senders[next.who] ?? stranger;
                const result = await subject.store.recordAcknowledgement({
                  alertId: current?.id ?? syntheticUuid(),
                  responderId: sender,
                });
                if (current === undefined || !responderIds.includes(sender)) {
                  expect(result, 'not a responder, or no alert').toEqual(NOT_FOUND);
                } else if (current.resolved) {
                  expect(result, 'a resolved alert').toEqual(OVER);
                } else if (current.acknowledgedBy === sender) {
                  expect(result, 'the sender’s own').toEqual(YOURS);
                } else if (current.acknowledgedBy !== null) {
                  expect(result, 'someone else’s').toEqual(TAKEN);
                } else {
                  acknowledged(result);
                  current.acknowledgedBy = sender;
                }
              }

              // After every step.
              expect(await subject.stateOf(journeyId)).toBe(state);
              const alerts = await subject.alertsOf(journeyId);
              const acknowledgements = await subject.acknowledgementsOf(journeyId);
              const messages = await subject.messagesOf(journeyId);
              const withdrawnAt = await withdrawnAtOf(subject, journeyId);
              expect(alerts.map(({ id }) => id).sort()).toEqual(model.map(({ id }) => id).sort());
              for (const alert of alerts) {
                const expected = model.find(({ id }) => id === alert.id);
                const by =
                  acknowledgements.find(({ alertId }) => alertId === alert.id)?.acknowledgedBy ??
                  null;
                expect(by, 'who is on it').toBe(expected?.acknowledgedBy ?? null);
                expect(by === null || responderIds.includes(by), 'one of the responders').toBe(
                  true,
                );
                expect(alert.state === 'RESOLVED', 'resolved').toBe(expected?.resolved);
                expect(alert.state === 'ACKNOWLEDGED', 'ACKNOWLEDGED').toBe(
                  alert.state !== 'RESOLVED' && by !== null,
                );
                const notices = ofKind(messages, alert.id, NOTICE);
                expect(recipientsOf(notices), 'the notices').toEqual(
                  by === null ? [] : responderIds.filter((id) => id !== by).sort(),
                );
                if (alert.state === 'RESOLVED') {
                  expect(
                    notices.filter(
                      ({ messageId, sentAt }) =>
                        sentAt === null && (withdrawnAt.get(messageId) ?? null) === null,
                    ),
                    'a resolved alert’s notices still to send',
                  ).toEqual([]);
                }
              }
            }
          },
        ),
        {
          numRuns: subject.propertyRuns,
          // The spec's test plan, after LOST-03's review loop 1: fixed
          // sequences run first, so even the database's few runs reach an
          // acknowledgement that is recorded and a resolution after it.
          examples: [
            [
              2 * HOUR,
              [
                { kind: 'sweep' },
                { kind: 'acknowledge', who: 0 },
                { kind: 'heartbeat', agoMs: 0 },
                { kind: 'sweep' },
              ],
            ],
            [
              2 * HOUR,
              [
                { kind: 'sweep' },
                { kind: 'acknowledge', who: 2 },
                { kind: 'acknowledge', who: 1 },
                { kind: 'acknowledge', who: 0 },
                { kind: 'acknowledge', who: 1 },
                { kind: 'home' },
                { kind: 'acknowledge', who: 1 },
              ],
            ],
          ],
        },
      );
    },
  },
  {
    name: 'LOST-06-AC8: a responder whose lost-contact message and ACKNOWLEDGED message are both unsent when the alert resolves gets exactly one stand-down, and the resolution is not refused; held until the later of their due times when both were handed over and are due later, and due at once otherwise',
    async run(subject) {
      for (const how of ['heartbeat', 'home'] as const) {
        // Which of R2's two is due later: the later decides, whichever it is,
        // so a store that held by the first message it found, or the last,
        // fails one of the two.
        for (const later of ['ACKNOWLEDGED', 'LOST_CONTACT'] as const) {
          const at = `${how}, R2’s ${later} due later`;
          const now = await subject.now();
          const journey = await watched(subject, {
            state: 'LOST_CONTACT',
            startedAt: ago(now, 2 * HOUR),
            lastHeartbeatAt: ago(now, HOUR),
            responders: 4,
          });
          const [r1 = '', r2 = '', r3 = '', r4 = ''] = journey.responderIds;
          const alertId = await subject.seedAlert({
            journeyId: journey.journeyId,
            state: 'ACKNOWLEDGED',
            openedAt: ago(now, 55 * MINUTE),
            silentSince: ago(now, HOUR),
            acknowledgedBy: r1,
            acknowledgedAt: ago(now, 50 * MINUTE),
          });
          const sooner = ago(now, -20 * SECOND);
          const latest = ago(now, -40 * SECOND);
          const seed = (
            recipientId: string,
            kind: 'LOST_CONTACT' | 'ACKNOWLEDGED',
            given: {
              attempts?: number;
              nextAttemptAt?: Date;
              sentAt?: Date;
              lastFailure?: 'NO_TARGET';
            },
          ) =>
            subject.seedMessage({
              alertId,
              recipientId,
              kind,
              createdAt: ago(now, kind === 'LOST_CONTACT' ? 55 * MINUTE : 50 * MINUTE),
              nextAttemptAt: ago(now, 50 * MINUTE),
              ...given,
            });
          // R1, who acknowledged: their lost-contact push never handed over.
          await seed(r1, 'LOST_CONTACT', {});
          // R2's phone has no push target: both handed over, refused
          // NO_TARGET, and due again later. The lost-contact one first, as
          // the code writes them.
          await seed(r2, 'LOST_CONTACT', {
            attempts: 2,
            lastFailure: 'NO_TARGET',
            nextAttemptAt: later === 'LOST_CONTACT' ? latest : sooner,
          });
          await seed(r2, 'ACKNOWLEDGED', {
            attempts: 1,
            lastFailure: 'NO_TARGET',
            nextAttemptAt: later === 'ACKNOWLEDGED' ? latest : sooner,
          });
          // R3: both sent.
          await seed(r3, 'LOST_CONTACT', { attempts: 1, sentAt: ago(now, 54 * MINUTE) });
          await seed(r3, 'ACKNOWLEDGED', { attempts: 1, sentAt: ago(now, 49 * MINUTE) });
          // R4: both handed over and refused, their retry times already past.
          await seed(r4, 'LOST_CONTACT', {
            attempts: 1,
            lastFailure: 'NO_TARGET',
            nextAttemptAt: ago(now, 30 * SECOND),
          });
          await seed(r4, 'ACKNOWLEDGED', {
            attempts: 1,
            lastFailure: 'NO_TARGET',
            nextAttemptAt: ago(now, 20 * SECOND),
          });

          // Not refused: answered, not rejected (approach item 5).
          const result =
            how === 'heartbeat'
              ? backInContact(
                  await subject.store.recordHeartbeat(
                    await freshHeartbeat(subject, journey.journeyId),
                  ),
                )
              : endedHome(await subject.store.recordHome(homeOf(journey)));

          const kind = how === 'heartbeat' ? 'BACK_IN_CONTACT' : 'HOME';
          expect(result.alertId, at).toBe(alertId);
          expect(await subject.stateOf(journey.journeyId), at).toBe(
            how === 'heartbeat' ? 'ACTIVE' : 'ENDED',
          );
          const resolvedAt =
            (await resolutionOf(subject, journey.journeyId, alertId))?.resolvedAt ??
            new Date(Number.NaN);
          expect(
            (await subject.alertsOf(journey.journeyId)).map(({ state }) => state),
            at,
          ).toEqual(['RESOLVED']);
          const messages = await subject.messagesOf(journey.journeyId);
          const withdrawnAt = await withdrawnAtOf(subject, journey.journeyId);
          const withdrawnOf = (recipientId: string) =>
            messages
              .filter((message) => message.recipientId === recipientId && message.kind !== kind)
              .map(({ messageId }) => withdrawnAt.get(messageId) ?? null);
          expect(withdrawnOf(r2), at).toEqual([resolvedAt, resolvedAt]);
          expect(withdrawnOf(r4), at).toEqual([resolvedAt, resolvedAt]);
          expect(withdrawnOf(r3), at).toEqual([null, null]);

          const standDowns = ofKind(messages, alertId, kind);
          expect(recipientsOf(standDowns), at).toEqual([r1, r2, r3, r4].sort());
          expect(byRecipient(result.messages), at).toEqual(standDowns.map(asAnswered));
          const standDownOf = (recipientId: string) =>
            standDowns.find((message) => message.recipientId === recipientId);
          expect(standDownOf(r2)?.nextAttemptAt, at).toEqual(latest);
          expect(standDownOf(r1)?.nextAttemptAt, at).toEqual(resolvedAt);
          expect(standDownOf(r3)?.nextAttemptAt, at).toEqual(resolvedAt);
          expect(standDownOf(r4)?.nextAttemptAt, at).toEqual(resolvedAt);
          for (const standDown of standDowns) {
            expect(
              standDown.nextAttemptAt.getTime() - resolvedAt.getTime(),
              `${at}: no hold longer than 60 s`,
            ).toBeLessThanOrEqual(60 * SECOND);
          }

          // R2's is not handed to the port before it is due; the others are.
          const claimed = (
            await subject.store.claimDue({ limit: BATCH, leaseMs: LEASE_MS })
          ).messages.map(({ messageId }) => messageId);
          expect(claimed, at).not.toContain(standDownOf(r2)?.messageId);
          expect(claimed, at).toEqual(
            expect.arrayContaining(
              [r1, r3, r4].map((recipientId) => standDownOf(recipientId)?.messageId),
            ),
          );
          for (const messageId of claimed) {
            await subject.store.markSent(messageId);
          }
        }
      }
    },
  },
  {
    name: 'LOST-06-AC13: a resolution withdraws exactly its own alert’s unsent messages of the kinds withdrawn on resolution, and leaves every other message alone',
    async run(subject) {
      const now = await subject.now();
      const journey = await watched(subject, {
        state: 'LOST_CONTACT',
        startedAt: ago(now, 3 * HOUR),
        lastHeartbeatAt: ago(now, HOUR),
        responders: 2,
      });
      const [r1 = '', r2 = ''] = journey.responderIds;
      const earlier = await subject.seedAlert({
        journeyId: journey.journeyId,
        state: 'RESOLVED',
        openedAt: ago(now, 2 * HOUR),
        silentSince: ago(now, 2 * HOUR + 5 * MINUTE),
        resolvedAt: ago(now, 90 * MINUTE),
        resolution: 'HOME',
      });
      const current = await subject.seedAlert({
        journeyId: journey.journeyId,
        state: 'ACKNOWLEDGED',
        openedAt: ago(now, 55 * MINUTE),
        silentSince: ago(now, HOUR),
        acknowledgedBy: r1,
        acknowledgedAt: ago(now, 50 * MINUTE),
      });
      const otherJourney = await watched(subject, {
        state: 'LOST_CONTACT',
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, HOUR),
        responders: 2,
      });
      const otherAlert = await subject.seedAlert({
        journeyId: otherJourney.journeyId,
        state: 'OPEN',
        openedAt: ago(now, 55 * MINUTE),
        silentSince: ago(now, HOUR),
      });
      // A message of every kind on each alert: unsent for one recipient,
      // sent for the other. On this alert, every kind but the stand-down the
      // resolution writes itself, which the unique (alert, recipient, kind)
      // would refuse.
      const seeded: { messageId: string; alertId: string; kind: MessageKind; unsent: boolean }[] =
        [];
      for (const [alertId, unsentFor, sentFor] of [
        [earlier, r2, r1],
        [current, r2, r1],
        [otherAlert, otherJourney.responderIds[1] ?? '', otherJourney.responderIds[0] ?? ''],
      ] as const) {
        for (const kind of MESSAGE_KINDS) {
          if (alertId === current && kind === 'BACK_IN_CONTACT') {
            continue;
          }
          for (const [recipientId, unsent] of [
            [unsentFor, true],
            [sentFor, false],
          ] as const) {
            const messageId = await subject.seedMessage({
              alertId,
              recipientId,
              kind,
              createdAt: ago(now, 50 * MINUTE),
              nextAttemptAt: ago(now, 50 * MINUTE),
              attempts: 1,
              lastFailure: unsent ? 'UNAVAILABLE' : null,
              sentAt: unsent ? null : ago(now, 49 * MINUTE),
            });
            seeded.push({ messageId, alertId, kind, unsent });
          }
        }
      }
      const expected = seeded
        .filter(
          ({ alertId, kind, unsent }) =>
            alertId === current && unsent && WITHDRAWN_WHEN_RESOLVED.includes(kind),
        )
        .map(({ messageId }) => messageId);
      expect(expected, 'one unsent message of each kind withdrawn on resolution').toHaveLength(
        WITHDRAWN_WHEN_RESOLVED.length,
      );

      backInContact(
        await subject.store.recordHeartbeat(await freshHeartbeat(subject, journey.journeyId)),
      );

      const resolvedAt = (await resolutionOf(subject, journey.journeyId, current))?.resolvedAt;
      const withdrawn = [
        ...(await subject.withdrawalsOf(journey.journeyId)),
        ...(await subject.withdrawalsOf(otherJourney.journeyId)),
      ].filter(({ withdrawnAt }) => withdrawnAt !== null);
      expect(withdrawn.map(({ messageId }) => messageId).sort()).toEqual([...expected].sort());
      for (const { withdrawnAt } of withdrawn) {
        expect(withdrawnAt).toEqual(resolvedAt);
      }
    },
  },
  // -------------------------------------------------------------------------
  // LOST-07: escalation to SMS (its spec's shared behaviours 1 to 12).
  // -------------------------------------------------------------------------
  {
    name: 'LOST-07-AC3: alertsDueForEscalation reads exactly the unresolved alerts with no escalation time, not acknowledged by someone, opened two minutes or more before the store’s now, with that now; none other, for any alerts in any state (fast-check)',
    async run(subject) {
      const anAlert = fc.record({
        state: fc.constantFrom<FakeAlertState>('OPEN', 'ESCALATED', 'ACKNOWLEDGED', 'RESOLVED'),
        recorded: fc.boolean(),
        wasEscalated: fc.boolean(),
        // Around the two minutes and far from them. Whether each is due is
        // worked out from the read's own now and the time it opened, so the
        // database's moving clock decides nothing here.
        openedAgoMs: fc.oneof(
          fc.integer({ min: 15 * SECOND, max: 10 * MINUTE }),
          fc.constantFrom(ESCALATE_AFTER_MS - 1, ESCALATE_AFTER_MS, ESCALATE_AFTER_MS + 1),
        ),
      });

      await fc.assert(
        fc.asyncProperty(fc.array(anAlert, { minLength: 1, maxLength: 4 }), async (drawn) => {
          const seeded = [];
          for (const { state, recorded, wasEscalated, openedAgoMs } of drawn) {
            const made = await alerted(subject, {
              state,
              recorded,
              openedAgoMs,
              smsRaisedAgoMs: wasEscalated ? Math.floor(openedAgoMs / 4) : null,
              responders: 1,
            });
            seeded.push({ state, recorded, wasEscalated, ...made });
          }

          const from = await subject.now();
          const read = await subject.store.alertsDueForEscalation(ESCALATE_AFTER_MS);
          const to = await subject.now();

          expect(read.now.getTime(), 'the read’s now is the store’s').toBeGreaterThanOrEqual(
            from.getTime(),
          );
          expect(read.now.getTime(), 'the read’s now is the store’s').toBeLessThanOrEqual(
            to.getTime(),
          );
          const ours = new Set(seeded.map(({ alertId }) => alertId));
          const expected = seeded.filter(
            (each) =>
              each.state !== 'RESOLVED' &&
              !(each.state === 'ACKNOWLEDGED' && each.recorded) &&
              !each.wasEscalated &&
              read.now.getTime() - each.openedAt.getTime() >= ESCALATE_AFTER_MS,
          );
          expect(
            read.alerts.filter(({ id }) => ours.has(id)).sort((a, b) => a.id.localeCompare(b.id)),
          ).toEqual(
            expected
              .map((each) => ({
                id: each.alertId,
                journeyId: each.journeyId,
                state: each.state,
                acknowledgedBy: each.acknowledgedBy,
                smsRaisedAt: null,
                openedAt: each.openedAt,
              }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          );
        }),
        {
          numRuns: subject.propertyRuns,
          // RG-03 (LOST-07 review loop 1, safety note): forced examples, run
          // first on every run. The states a read narrowed to OPEN would
          // miss: ESCALATED with no escalation time, and ACKNOWLEDGED with
          // nobody recorded, both due (a missing half sends the SMS, D-114).
          // Drawn at random they came up too rarely: a mutant narrowing the
          // read to OPEN got through one run in seven. The property itself
          // is unchanged.
          examples: [
            [
              [
                {
                  state: 'ESCALATED',
                  recorded: false,
                  wasEscalated: false,
                  openedAgoMs: 3 * MINUTE,
                },
                {
                  state: 'ACKNOWLEDGED',
                  recorded: false,
                  wasEscalated: false,
                  openedAgoMs: 3 * MINUTE,
                },
              ],
            ],
          ],
        },
      );
    },
  },
  {
    name: 'LOST-07-AC1: escalateAlert moves a due alert to ESCALATED at the store’s now and writes one LOST_CONTACT_SMS per responder row, each with an ID of its own and due at that now; the journey, its other alerts, another journey’s alert and every push message are untouched',
    async run(subject) {
      // Every situation the rule escalates (approach item 2, AC3): a missing
      // half of an acknowledgement sends the SMS.
      const due: [string, AlertSeed][] = [
        ['OPEN, nobody recorded', { state: 'OPEN' }],
        [
          'ESCALATED with no escalation time, as from before migration 0006',
          { state: 'ESCALATED' },
        ],
        [
          'ACKNOWLEDGED with nobody recorded, a state the code never makes',
          { state: 'ACKNOWLEDGED' },
        ],
        ['OPEN with someone recorded, a half-done reset', { state: 'OPEN', recorded: true }],
        [
          'ESCALATED with someone recorded, a half-done reset',
          { state: 'ESCALATED', recorded: true },
        ],
        [
          'OPEN, two minutes old: to the millisecond against the fake',
          { state: 'OPEN', openedAgoMs: ESCALATE_AFTER_MS + subject.timeMarginMs },
        ],
      ];
      for (const [at, seed] of due) {
        const journey = await alerted(subject, { ...seed, responders: 3 });
        const { journeyId, alertId, responderIds } = journey;
        const [r1 = '', r2 = '', r3 = ''] = responderIds;
        const now = await subject.now();
        // An earlier silence of the journey, over: escalated then, its pushes
        // and SMS sent.
        const older = await subject.seedAlert({
          journeyId,
          state: 'RESOLVED',
          openedAt: ago(now, HOUR + 30 * MINUTE),
          silentSince: ago(now, HOUR + 35 * MINUTE),
          resolvedAt: ago(now, HOUR),
          resolution: 'BACK_IN_CONTACT',
          smsRaisedAt: ago(now, HOUR + 28 * MINUTE),
        });
        for (const recipientId of responderIds) {
          for (const kind of ['LOST_CONTACT', SMS] as const) {
            await subject.seedMessage({
              alertId: older,
              recipientId,
              kind,
              createdAt: ago(now, HOUR + 28 * MINUTE),
              nextAttemptAt: ago(now, HOUR + 28 * MINUTE),
              attempts: 1,
              sentAt: ago(now, HOUR + 27 * MINUTE),
            });
          }
        }
        // This alert's lost-contact pushes: R1's accepted, R2's refused and
        // due again later, R3's never claimed.
        for (const [recipientId, given] of [
          [r1, { attempts: 1, sentAt: journey.openedAt }],
          [r2, { attempts: 2, lastFailure: 'NO_TARGET', nextAttemptAt: ago(now, -20 * SECOND) }],
          [r3, {}],
        ] as const) {
          await subject.seedMessage({
            alertId,
            recipientId,
            kind: 'LOST_CONTACT',
            createdAt: journey.openedAt,
            nextAttemptAt: journey.openedAt,
            ...given,
          });
        }
        const other = await alerted(subject, { responders: 1 });
        const otherBefore = await escalationRecordOf(subject, other.journeyId);
        const before = await escalationRecordOf(subject, journeyId);
        const lastContact = await subject.lastHeartbeatAt(journeyId);

        const from = await subject.now();
        const result = escalated(await subject.store.escalateAlert({ alertId }), at);
        const to = await subject.now();

        const after = await escalationRecordOf(subject, journeyId);
        const smsRaisedAt =
          after.escalations.find((each) => each.alertId === alertId)?.smsRaisedAt ??
          new Date(Number.NaN);
        expect(smsRaisedAt.getTime(), at).toBeGreaterThanOrEqual(from.getTime());
        expect(smsRaisedAt.getTime(), at).toBeLessThanOrEqual(to.getTime());
        expect(after.alerts.find(({ id }) => id === alertId)?.state, at).toBe('ESCALATED');
        // Who is on it, if anyone, is not the escalation's to change.
        expect(after.acknowledgements, at).toEqual(before.acknowledgements);

        // One SMS per responder row, R2 whose push failed included, due at that now.
        const sms = ofKind(after.messages, alertId, SMS);
        expect(recipientsOf(sms), at).toEqual([...responderIds].sort());
        const written = new Map(after.withdrawals.map((each) => [each.messageId, each]));
        for (const message of sms) {
          expect(message, at).toMatchObject({ attempts: 0, sentAt: null, lastFailure: null });
          expect(message.nextAttemptAt, at).toEqual(smsRaisedAt);
          expect(written.get(message.messageId)?.createdAt, at).toEqual(smsRaisedAt);
          expect(written.get(message.messageId)?.withdrawnAt, at).toBeNull();
          expect(message.messageId, at).toMatch(LOWER_UUID);
        }
        const ids = sms.map(({ messageId }) => messageId);
        expect(new Set(ids).size, at).toBe(ids.length);
        const everyOtherId = [
          ...before.messages.map(({ messageId }) => messageId),
          alertId,
          older,
          journeyId,
          journey.walkerId,
          journey.deviceId,
          ...responderIds,
          other.alertId,
          other.journeyId,
        ];
        expect(
          ids.filter((id) => everyOtherId.includes(id)),
          at,
        ).toEqual([]);
        expect(byRecipient(result.messages), at).toEqual(sms.map(asAnswered));

        // Untouched: the journey, its older alert, every push message (none
        // withdrawn, none re-timed), and another journey's alert.
        expect(after.state, at).toBe('LOST_CONTACT');
        expect(await subject.lastHeartbeatAt(journeyId), at).toEqual(lastContact);
        expect(
          after.messages.filter(({ messageId }) => !ids.includes(messageId)),
          at,
        ).toEqual(before.messages);
        expect(
          after.withdrawals.filter(({ messageId }) => !ids.includes(messageId)),
          at,
        ).toEqual(before.withdrawals);
        expect(
          after.alerts.filter(({ id }) => id !== alertId),
          at,
        ).toEqual(before.alerts.filter(({ id }) => id !== alertId));
        expect(after.resolutions, at).toEqual(before.resolutions);
        expect(
          after.escalations.filter((each) => each.alertId !== alertId),
          at,
        ).toEqual(before.escalations.filter((each) => each.alertId !== alertId));
        expect(await escalationRecordOf(subject, other.journeyId), at).toEqual(otherBefore);
      }
    },
  },
  {
    name: 'LOST-07-AC3: escalateAlert decides again under the journey’s row, and writes nothing for an alert no longer due there: acknowledged by someone, RESOLVED, already escalated, or under two minutes',
    async run(subject) {
      const under = underTwoMinutesMs(subject);
      const notDue: [string, AlertSeed][] = [
        ['ACKNOWLEDGED with someone recorded', { state: 'ACKNOWLEDGED', recorded: true }],
        ['RESOLVED, nobody recorded', { state: 'RESOLVED' }],
        ['RESOLVED, someone recorded', { state: 'RESOLVED', recorded: true }],
        ['RESOLVED, escalated before it resolved', { state: 'RESOLVED', smsRaisedAgoMs: MINUTE }],
        ['OPEN, already escalated', { state: 'OPEN', smsRaisedAgoMs: MINUTE }],
        ['ESCALATED, already escalated', { state: 'ESCALATED', smsRaisedAgoMs: MINUTE }],
        [
          'ACKNOWLEDGED with nobody recorded, already escalated',
          { state: 'ACKNOWLEDGED', smsRaisedAgoMs: MINUTE },
        ],
        [
          'OPEN with someone recorded, already escalated',
          { state: 'OPEN', recorded: true, smsRaisedAgoMs: MINUTE },
        ],
        ['OPEN, under two minutes old', { state: 'OPEN', openedAgoMs: under }],
        [
          'ESCALATED with no escalation time, under two minutes old',
          { state: 'ESCALATED', openedAgoMs: under },
        ],
        [
          'ACKNOWLEDGED with nobody recorded, under two minutes old',
          { state: 'ACKNOWLEDGED', openedAgoMs: under },
        ],
      ];
      for (const [at, seed] of notDue) {
        const journey = await alerted(subject, { ...seed, responders: 2 });
        const before = await escalationRecordOf(subject, journey.journeyId);

        const read = await subject.store.alertsDueForEscalation(ESCALATE_AFTER_MS);
        expect(
          read.alerts.map(({ id }) => id),
          `${at}: not read as due`,
        ).not.toContain(journey.alertId);
        expect(
          await subject.store.escalateAlert({
            alertId: journey.alertId,
          }),
          at,
        ).toEqual(NOT_ESCALATED);

        expect(await escalationRecordOf(subject, journey.journeyId), at).toEqual(before);
      }

      // Read as due, then no longer due by the time the journey's row is
      // taken: the rule is asked again there (AR-04), and writes nothing.
      for (const change of [
        'acknowledged by R1',
        'resolved by contact back',
        'ended by "I’m home"',
        'escalated by another sweep',
      ] as const) {
        const journey = await alerted(subject, { responders: 2 });
        const [r1 = ''] = journey.responderIds;
        const read = await subject.store.alertsDueForEscalation(ESCALATE_AFTER_MS);
        expect(
          read.alerts.map(({ id }) => id),
          `${change}: read as due first`,
        ).toContain(journey.alertId);
        if (change === 'acknowledged by R1') {
          acknowledged(
            await subject.store.recordAcknowledgement({
              alertId: journey.alertId,
              responderId: r1,
            }),
            change,
          );
        } else if (change === 'resolved by contact back') {
          backInContact(
            await subject.store.recordHeartbeat(await freshHeartbeat(subject, journey.journeyId)),
          );
        } else if (change === 'ended by "I’m home"') {
          endedHome(await subject.store.recordHome(homeOf(journey)));
        } else {
          escalated(
            await subject.store.escalateAlert({
              alertId: journey.alertId,
            }),
            change,
          );
        }
        const before = await escalationRecordOf(subject, journey.journeyId);

        expect(
          await subject.store.escalateAlert({
            alertId: journey.alertId,
          }),
          change,
        ).toEqual(NOT_ESCALATED);

        expect(await escalationRecordOf(subject, journey.journeyId), change).toEqual(before);
      }

      // An ID no alert has: no row to take, and nothing written.
      expect(await subject.store.escalateAlert({ alertId: syntheticUuid() })).toEqual(
        NOT_ESCALATED,
      );
    },
  },
  {
    name: 'LOST-07-AC16: escalateAlert skips a held row without waiting; told to wait, it answers held when the row stays held, and otherwise decides as the holder left it',
    async run(subject) {
      // Without a wait: skipped at once, writing nothing; once released, escalated.
      const skipping = await alerted(subject, { responders: 2 });
      const held = await subject.hold(skipping.journeyId);
      try {
        const before = await escalationRecordOf(subject, skipping.journeyId);
        expect(
          await within(
            2_000,
            subject.store.escalateAlert({
              alertId: skipping.alertId,
            }),
            'an escalation of a held row',
          ),
        ).toEqual(NOT_ESCALATED);
        expect(await escalationRecordOf(subject, skipping.journeyId)).toEqual(before);
      } finally {
        await held.release();
      }
      escalated(
        await subject.store.escalateAlert({
          alertId: skipping.alertId,
        }),
        'once released',
      );

      // Told to wait, with the row held throughout: held, writing nothing.
      const waiting = await alerted(subject, { responders: 2 });
      const holding = await subject.hold(waiting.journeyId);
      try {
        const before = await escalationRecordOf(subject, waiting.journeyId);
        expect(
          await subject.store.escalateAlert({
            alertId: waiting.alertId,
            lockWaitMs: subject.lockWaitMs,
          }),
        ).toEqual({ outcome: 'held' });
        expect(await escalationRecordOf(subject, waiting.journeyId)).toEqual(before);
      } finally {
        await holding.release();
      }

      // Told to wait, with a holder that lets go within the wait: decided as
      // the holder left the alert.
      for (const [change, outcome] of [
        ['unchanged', 'escalated'],
        ['acknowledge', 'skipped'],
        ['resolve', 'skipped'],
      ] as const) {
        const journey = await alerted(subject, { responders: 2 });
        const holder = await subject.holdUntilEscalationWaits(journey.journeyId, change);
        const result = await (async () => {
          try {
            return await subject.store.escalateAlert({
              alertId: journey.alertId,
              lockWaitMs: subject.lockWaitMs,
            });
          } finally {
            await holder.release();
          }
        })();

        expect(result.outcome, change).toBe(outcome);
        const sms = ofKind(await subject.messagesOf(journey.journeyId), journey.alertId, SMS);
        const states = (await subject.alertsOf(journey.journeyId)).map(({ state }) => state);
        if (change === 'unchanged') {
          expect(states, change).toEqual(['ESCALATED']);
          expect(recipientsOf(sms), change).toEqual([...journey.responderIds].sort());
        } else {
          expect(states, change).toEqual([change === 'acknowledge' ? 'ACKNOWLEDGED' : 'RESOLVED']);
          expect(sms, change).toEqual([]);
          expect(
            await smsRaisedAtOf(subject, journey.journeyId, journey.alertId),
            change,
          ).toBeNull();
        }
      }

      // A lock wait PostgreSQL would read as no limit at all is refused,
      // naming lockWaitMs, before anything is taken or written.
      const refused = await alerted(subject, { responders: 1 });
      const before = await escalationRecordOf(subject, refused.journeyId);
      for (const lockWaitMs of [0, -1, 0.5, 1.5, Number.NaN, 2_147_483_648]) {
        await expect(
          subject.store.escalateAlert({
            alertId: refused.alertId,
            lockWaitMs,
          }),
          String(lockWaitMs),
        ).rejects.toThrow(/lockWaitMs/);
      }
      expect(await escalationRecordOf(subject, refused.journeyId)).toEqual(before);
    },
  },
  {
    // RG-03 (SM-10, the spec's "Existing assertions that change by design",
    // "the no-responder refusals", journey-store-behaviour.ts line 5579): this
    // was "LOST-07-AC15: escalateAlert refuses an alert whose journey has no
    // responder row, writing nothing", and expected a rejection in the
    // store's own words. D-122 item 3 removes the refusal: an alert whose
    // journey has no responder is unheard, counted for the SMS check's page,
    // and its escalation is skipped under the lock, never a failure that
    // holds the worker's check down. It keeps its point, that nothing is
    // written for such an alert: the record unchanged, no escalation time and
    // no SMS, and the due read never offers it.
    name: 'SM-10-AC15: escalateAlert skips an alert whose journey has no responder row, writing nothing, and alertsDueForEscalation never reads it (LOST-07)',
    async run(subject) {
      const journey = await alerted(subject, { responders: 2 });
      await subject.removeResponders(journey.journeyId);
      const before = await escalationRecordOf(subject, journey.journeyId);

      expect(
        (await subject.store.alertsDueForEscalation(ESCALATE_AFTER_MS)).alerts.map(({ id }) => id),
      ).not.toContain(journey.alertId);
      expect(await subject.store.escalateAlert({ alertId: journey.alertId })).toEqual(
        NOT_ESCALATED,
      );

      expect(await escalationRecordOf(subject, journey.journeyId)).toEqual(before);
      expect(await smsRaisedAtOf(subject, journey.journeyId, journey.alertId)).toBeNull();
      expect(ofKind(await subject.messagesOf(journey.journeyId), journey.alertId, SMS)).toEqual([]);
      expect((await subject.alertsOf(journey.journeyId)).map(({ state }) => state)).toEqual([
        'OPEN',
      ]);
    },
  },
  {
    name: `LOST-07-AC4: ${String(RACERS)} escalations of one alert at once, ${String(RACE_ROUNDS)} times over: exactly one escalates, every other skips, none an error, with one set of SMS`,
    async run(subject) {
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const at = `round ${String(round)}`;
        const journey = await alerted(subject, { responders: 3 });

        // Promise.all rejects if any escalation fails outright: none may.
        const results = await Promise.all(
          Array.from({ length: RACERS }, () =>
            subject.store.escalateAlert({ alertId: journey.alertId }),
          ),
        );

        expect(
          results.filter(({ outcome }) => outcome === 'escalated'),
          at,
        ).toHaveLength(1);
        expect(
          results.filter(({ outcome }) => outcome !== 'escalated'),
          at,
        ).toEqual(Array.from({ length: RACERS - 1 }, () => NOT_ESCALATED));
        expect(
          recipientsOf(ofKind(await subject.messagesOf(journey.journeyId), journey.alertId, SMS)),
          at,
        ).toEqual([...journey.responderIds].sort());
        expect(
          (await subject.escalationsOf(journey.journeyId)).filter(
            ({ smsRaisedAt }) => smsRaisedAt !== null,
          ),
          at,
        ).toHaveLength(1);
      }
    },
  },
  {
    name: 'LOST-07-AC6: recordAcknowledgement of an escalated alert withdraws its SMS not yet sent at the store’s now, keeping attempts and last failure, and leaves sent SMS and every push message alone; of an alert never escalated it withdraws nothing',
    async run(subject) {
      for (const theirs of [
        'never claimed',
        'in the port’s hands, then accepted',
        'in the port’s hands, then refused',
      ] as const) {
        const at = `R3’s SMS ${theirs}`;
        const journey = await alerted(subject, {
          state: 'ESCALATED',
          smsRaisedAgoMs: MINUTE,
          responders: 3,
        });
        const { journeyId, alertId } = journey;
        const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
        const now = await subject.now();
        // Its lost-contact pushes: R1's accepted, R2's refused and due again
        // later, R3's never claimed.
        for (const [recipientId, given] of [
          [r1, { attempts: 1, sentAt: journey.openedAt }],
          [r2, { attempts: 2, lastFailure: 'NO_TARGET', nextAttemptAt: ago(now, -20 * SECOND) }],
          [r3, {}],
        ] as const) {
          await subject.seedMessage({
            alertId,
            recipientId,
            kind: 'LOST_CONTACT',
            createdAt: journey.openedAt,
            nextAttemptAt: journey.openedAt,
            ...given,
          });
        }
        // Its SMS: R1's accepted; R2's refused NO_TARGET and due again in a
        // second; R3's as `theirs` says (in the port's hands: leased 30 s).
        const seedSms = (
          recipientId: string,
          given: {
            attempts?: number;
            sentAt?: Date;
            lastFailure?: 'NO_TARGET';
            nextAttemptAt?: Date;
          },
        ) =>
          subject.seedMessage({
            alertId,
            recipientId,
            kind: SMS,
            createdAt: ago(now, MINUTE),
            nextAttemptAt: ago(now, MINUTE),
            ...given,
          });
        const smsOf = new Map([
          [r1, await seedSms(r1, { attempts: 1, sentAt: ago(now, MINUTE - SECOND) })],
          [
            r2,
            await seedSms(r2, {
              attempts: 1,
              lastFailure: 'NO_TARGET',
              nextAttemptAt: ago(now, -SECOND),
            }),
          ],
          [
            r3,
            await seedSms(
              r3,
              theirs === 'never claimed' ? {} : { attempts: 1, nextAttemptAt: ago(now, -LEASE_MS) },
            ),
          ],
        ]);
        const sms = (recipientId: string) => smsOf.get(recipientId) ?? '';
        const before = new Map(
          (await subject.messagesOf(journeyId)).map((message) => [message.messageId, message]),
        );
        const escalatedBefore = await smsRaisedAtOf(subject, journeyId, alertId);

        const recorded = acknowledged(
          await subject.store.recordAcknowledgement({ alertId, responderId: r2 }),
          at,
        );

        const acknowledgement = await acknowledgementOf(subject, journeyId, alertId);
        expect(acknowledgement?.acknowledgedBy, at).toBe(r2);
        const acknowledgedAt = acknowledgement?.acknowledgedAt ?? new Date(Number.NaN);
        expect(
          (await subject.alertsOf(journeyId)).map(({ state }) => state),
          at,
        ).toEqual(['ACKNOWLEDGED']);
        // It keeps its escalation time.
        expect(escalatedBefore, at).toBeInstanceOf(Date);
        expect(await smsRaisedAtOf(subject, journeyId, alertId), at).toEqual(escalatedBefore);

        const withdrawnAt = await withdrawnAtOf(subject, journeyId);
        const stored = new Map(
          (await subject.messagesOf(journeyId)).map((message) => [message.messageId, message]),
        );
        // R2's and R3's SMS: withdrawn at the store's now, attempts and last failure kept.
        for (const recipientId of [r2, r3]) {
          expect(withdrawnAt.get(sms(recipientId)), `${at}: withdrawn`).toEqual(acknowledgedAt);
          expect(stored.get(sms(recipientId)), `${at}: as it was`).toEqual(
            before.get(sms(recipientId)),
          );
        }
        // R1's, sent, as it was.
        expect(withdrawnAt.get(sms(r1)), at).toBeNull();
        expect(stored.get(sms(r1)), at).toEqual(before.get(sms(r1)));
        // Every push message as it was, sent or not; the notices as LOST-06 built them.
        for (const [messageId, message] of before) {
          if (message.kind !== SMS) {
            expect(withdrawnAt.get(messageId), `${at}: ${message.kind}`).toBeNull();
            expect(stored.get(messageId), `${at}: ${message.kind}`).toEqual(message);
          }
        }
        const notices = ofKind([...stored.values()], alertId, NOTICE);
        expect(recipientsOf(notices), at).toEqual([r1, r3].sort());
        expect(byRecipient(recorded.messages), at).toEqual(notices.map(asAnswered));
        for (const notice of notices) {
          expect(withdrawnAt.get(notice.messageId), at).toBeNull();
        }

        // One in the port's hands finishes as the port answers.
        if (theirs === 'in the port’s hands, then accepted') {
          await subject.store.markSent(sms(r3));
          expect(
            (await subject.messagesOf(journeyId)).find(({ messageId }) => messageId === sms(r3))
              ?.sentAt,
            at,
          ).toBeInstanceOf(Date);
        } else if (theirs === 'in the port’s hands, then refused') {
          await subject.store.markFailed({
            messageId: sms(r3),
            reason: 'UNAVAILABLE',
            retryAfterMs: SECOND,
          });
          expect(
            (await subject.messagesOf(journeyId)).find(({ messageId }) => messageId === sms(r3))
              ?.lastFailure,
            at,
          ).toBe('UNAVAILABLE');
        }
        expect((await withdrawnAtOf(subject, journeyId)).get(sms(r3)), at).toEqual(acknowledgedAt);

        // Never handed to the SMS port again, whatever its due time.
        await subject.letTimePass(1_500);
        const handedOut = await smsClaimed(subject, 0);
        expect(handedOut, at).not.toContain(sms(r2));
        expect(handedOut, at).not.toContain(sms(r3));
        await allSent(subject, handedOut);
        await allSent(
          subject,
          (await subject.store.claimDue({ limit: BATCH, leaseMs: 0 })).messages.map(
            ({ messageId }) => messageId,
          ),
        );
      }

      // An alert never escalated: the acknowledgement withdraws nothing.
      const lost = await lostWith(subject, 2);
      const [r1 = ''] = lost.responderIds;
      const before = await subject.withdrawalsOf(lost.journeyId);
      acknowledged(
        await subject.store.recordAcknowledgement({ alertId: lost.alertId, responderId: r1 }),
        'never escalated',
      );
      const after = await subject.withdrawalsOf(lost.journeyId);
      expect(after.filter(({ withdrawnAt }) => withdrawnAt !== null)).toEqual([]);
      expect(
        byMessage(
          after.filter(({ messageId }) => before.some((each) => each.messageId === messageId)),
        ),
      ).toEqual(byMessage(before));
      expect(ofKind(await subject.messagesOf(lost.journeyId), lost.alertId, SMS)).toEqual([]);
    },
  },
  {
    name: 'LOST-07-AC7: when contact comes back, or "I’m home" ends the journey, an escalated alert is resolved keeping its escalation time; its SMS not yet sent are withdrawn with its lost-contact pushes; every responder gets one stand-down, held behind an SMS handed over and due later',
    async run(subject) {
      for (const how of ['heartbeat', 'home'] as const) {
        const journey = await alerted(subject, { responders: 3 });
        const { journeyId, alertId } = journey;
        const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
        // Its lost-contact pushes: R1's and R3's accepted, R2's never handed over.
        for (const [recipientId, given] of [
          [r1, { attempts: 1, sentAt: journey.openedAt }],
          [r2, {}],
          [r3, { attempts: 1, sentAt: journey.openedAt }],
        ] as const) {
          await subject.seedMessage({
            alertId,
            recipientId,
            kind: 'LOST_CONTACT',
            createdAt: journey.openedAt,
            nextAttemptAt: journey.openedAt,
            ...given,
          });
        }
        // Escalated by the store's own escalation.
        const written = escalated(await subject.store.escalateAlert({ alertId }), how);
        const sms = (recipientId: string) =>
          written.messages.find((message) => message.recipientId === recipientId)?.messageId ?? '';
        const smsRaisedAt = await smsRaisedAtOf(subject, journeyId, alertId);
        // One SMS claim takes all three, leased 3 s: R1's accepted; R2's
        // refused NO_TARGET and due again in 2 s; R3's left in the port's hands.
        const claimed = await smsClaimed(subject, 3 * SECOND);
        const mine = [r1, r2, r3].map(sms);
        expect(claimed, how).toEqual(expect.arrayContaining(mine));
        await subject.store.markSent(sms(r1));
        await subject.store.markFailed({
          messageId: sms(r2),
          reason: 'NO_TARGET',
          retryAfterMs: 2 * SECOND,
        });
        await allSent(
          subject,
          claimed.filter((messageId) => !mine.includes(messageId)),
        );
        const before = new Map(
          (await subject.messagesOf(journeyId)).map((message) => [message.messageId, message]),
        );

        const result =
          how === 'heartbeat'
            ? backInContact(
                await subject.store.recordHeartbeat(await freshHeartbeat(subject, journeyId)),
              )
            : endedHome(await subject.store.recordHome(homeOf(journey)));

        const kind = how === 'heartbeat' ? 'BACK_IN_CONTACT' : 'HOME';
        expect(result.alertId, how).toBe(alertId);
        const resolution = await resolutionOf(subject, journeyId, alertId);
        expect(resolution?.resolution, how).toBe(kind);
        const resolvedAt = resolution?.resolvedAt ?? new Date(Number.NaN);
        expect(
          (await subject.alertsOf(journeyId)).map(({ state }) => state),
          how,
        ).toEqual(['RESOLVED']);
        // It keeps its escalation time.
        expect(smsRaisedAt, how).toBeInstanceOf(Date);
        expect(await smsRaisedAtOf(subject, journeyId, alertId), how).toEqual(smsRaisedAt);

        const messages = await subject.messagesOf(journeyId);
        const withdrawnAt = await withdrawnAtOf(subject, journeyId);
        const stored = new Map(messages.map((message) => [message.messageId, message]));
        const pushOf = (recipientId: string) =>
          ofKind(messages, alertId, 'LOST_CONTACT').find(
            (message) => message.recipientId === recipientId,
          )?.messageId ?? '';
        // R2's and R3's SMS, with R2's lost-contact push: withdrawn at the
        // resolution's now, attempts and last failure kept.
        for (const messageId of [sms(r2), sms(r3), pushOf(r2)]) {
          expect(withdrawnAt.get(messageId), how).toEqual(resolvedAt);
          expect(stored.get(messageId), how).toEqual(before.get(messageId));
        }
        // The sent ones as they were.
        for (const messageId of [sms(r1), pushOf(r1), pushOf(r3)]) {
          expect(withdrawnAt.get(messageId), how).toBeNull();
          expect(stored.get(messageId), how).toEqual(before.get(messageId));
        }
        // One stand-down each, by push, and no SMS more (D-115 item 5).
        expect(recipientsOf(ofKind(messages, alertId, SMS)), how).toEqual([r1, r2, r3].sort());
        const standDowns = ofKind(messages, alertId, kind);
        expect(recipientsOf(standDowns), how).toEqual([r1, r2, r3].sort());
        expect(byRecipient(result.messages), how).toEqual(standDowns.map(asAnswered));
        const standDownOf = (recipientId: string) =>
          standDowns.find((message) => message.recipientId === recipientId);
        // Held behind the SMS handed over and due later: R2's until its retry,
        // R3's until its lease ends; R1's due at once. None longer than 60 s.
        expect(standDownOf(r2)?.nextAttemptAt, how).toEqual(before.get(sms(r2))?.nextAttemptAt);
        expect(standDownOf(r3)?.nextAttemptAt, how).toEqual(before.get(sms(r3))?.nextAttemptAt);
        expect(standDownOf(r1)?.nextAttemptAt, how).toEqual(resolvedAt);
        for (const standDown of standDowns) {
          expect(
            standDown.nextAttemptAt.getTime() - resolvedAt.getTime(),
            `${how}: no hold longer than 60 s`,
          ).toBeLessThanOrEqual(60 * SECOND);
        }

        // R1's stand-down is handed out now; R2's and R3's not before their SMS's due time.
        const pushed = (
          await subject.store.claimDue({ limit: BATCH, leaseMs: LEASE_MS })
        ).messages.map(({ messageId }) => messageId);
        expect(pushed, how).toContain(standDownOf(r1)?.messageId);
        expect(pushed, how).not.toContain(standDownOf(r2)?.messageId);
        expect(pushed, how).not.toContain(standDownOf(r3)?.messageId);
        await allSent(subject, pushed);

        // Once those times have passed, the two stand-downs go, and the SMS never do.
        await subject.letTimePass(3_500);
        const smsLater = await smsClaimed(subject, 0);
        expect(smsLater, how).not.toContain(sms(r2));
        expect(smsLater, how).not.toContain(sms(r3));
        await allSent(subject, smsLater);
        const pushedLater = (
          await subject.store.claimDue({ limit: BATCH, leaseMs: 0 })
        ).messages.map(({ messageId }) => messageId);
        expect(pushedLater, how).toEqual(
          expect.arrayContaining([standDownOf(r2)?.messageId, standDownOf(r3)?.messageId]),
        );
        await allSent(subject, pushedLater);
      }
    },
  },
  {
    name: 'LOST-07-AC8: the push claim hands out push kinds only and the SMS claim SMS kinds only, each one claimer per message, leased, with its attempts counted',
    async run(subject) {
      const isPush = (kind: string) => (PUSH_KINDS as readonly string[]).includes(kind);
      const isSms = (kind: string) => (SMS_KINDS as readonly string[]).includes(kind);
      const now = await subject.now();
      const journey = await alerted(subject, {
        state: 'ESCALATED',
        smsRaisedAgoMs: 5 * MINUTE,
        openedAgoMs: 9 * MINUTE,
        responders: 2,
      });
      const { journeyId, alertId } = journey;
      // One message of every kind for each responder, all due, a second apart.
      const seeded: { messageId: string; kind: string }[] = [];
      let order = 0;
      for (const recipientId of journey.responderIds) {
        for (const kind of MESSAGE_KINDS) {
          order += 1;
          seeded.push({
            kind,
            messageId: await subject.seedMessage({
              alertId,
              recipientId,
              kind,
              createdAt: ago(now, 8 * MINUTE),
              nextAttemptAt: ago(now, 8 * MINUTE - order * SECOND),
            }),
          });
        }
      }
      const pushes = seeded.filter(({ kind }) => isPush(kind)).map(({ messageId }) => messageId);
      const sms = seeded.filter(({ kind }) => isSms(kind)).map(({ messageId }) => messageId);
      expect(sms, 'one SMS for each responder').toHaveLength(2);
      expect(pushes.length + sms.length, 'every kind is push or SMS').toBe(seeded.length);
      const ours = (claim: ClaimedMessages, ids: readonly string[]) =>
        claim.messages.filter(({ messageId }) => ids.includes(messageId));

      const pushClaim = await subject.store.claimDue({ limit: BATCH, leaseMs: LEASE_MS });
      expect(
        pushClaim.messages.filter(({ kind }) => !isPush(kind)),
        'the push claim hands out no SMS',
      ).toEqual([]);
      expect(
        ours(pushClaim, pushes)
          .map(({ messageId }) => messageId)
          .sort(),
      ).toEqual([...pushes].sort());
      expect(ours(pushClaim, sms)).toEqual([]);

      const smsClaim = await subject.store.claimDueSms({ limit: BATCH, leaseMs: LEASE_MS });
      expect(
        smsClaim.messages.filter(({ kind }) => !isSms(kind)),
        'the SMS claim hands out no push',
      ).toEqual([]);
      expect(
        ours(smsClaim, sms)
          .map(({ messageId }) => messageId)
          .sort(),
      ).toEqual([...sms].sort());
      expect(ours(smsClaim, pushes)).toEqual([]);

      // Each with one attempt counted, leased until its own claim's now plus the lease.
      for (const claimed of [...ours(pushClaim, pushes), ...ours(smsClaim, sms)]) {
        expect(claimed.attempts, claimed.kind).toBe(1);
      }
      const stored = new Map(
        (await subject.messagesOf(journeyId)).map((message) => [message.messageId, message]),
      );
      for (const [ids, claim] of [
        [pushes, pushClaim],
        [sms, smsClaim],
      ] as const) {
        for (const messageId of ids) {
          expect(stored.get(messageId)).toMatchObject({
            attempts: 1,
            nextAttemptAt: new Date(claim.now.getTime() + LEASE_MS),
          });
        }
      }
      // Leased: neither claim hands any of them out again while the lease runs.
      const seededIds = seeded.map(({ messageId }) => messageId);
      expect(
        ours(await subject.store.claimDue({ limit: BATCH, leaseMs: LEASE_MS }), seededIds),
      ).toEqual([]);
      expect(
        ours(await subject.store.claimDueSms({ limit: BATCH, leaseMs: LEASE_MS }), seededIds),
      ).toEqual([]);

      // In due order: told to take one, the SMS claim takes the earliest due.
      const ordered = await alerted(subject, {
        state: 'ESCALATED',
        smsRaisedAgoMs: MINUTE,
        responders: 2,
      });
      const [first = '', second = ''] = ordered.responderIds;
      const at = await subject.now();
      const later = await subject.seedMessage({
        alertId: ordered.alertId,
        recipientId: first,
        kind: SMS,
        createdAt: ago(at, MINUTE),
        nextAttemptAt: ago(at, 30 * SECOND),
      });
      const earlier = await subject.seedMessage({
        alertId: ordered.alertId,
        recipientId: second,
        kind: SMS,
        createdAt: ago(at, MINUTE),
        nextAttemptAt: ago(at, 50 * SECOND),
      });
      const one = await subject.store.claimDueSms({ limit: 1, leaseMs: LEASE_MS });
      expect(one.messages.map(({ messageId }) => messageId)).toEqual([earlier]);
      const next = await subject.store.claimDueSms({ limit: 1, leaseMs: LEASE_MS });
      expect(next.messages.map(({ messageId }) => messageId)).toEqual([later]);

      // One claimer per SMS: RACERS claims at once each take their own.
      const raced = await alerted(subject, {
        state: 'ESCALATED',
        smsRaisedAgoMs: MINUTE,
        responders: RACERS,
      });
      const racedAt = await subject.now();
      const racedIds: string[] = [];
      for (const recipientId of raced.responderIds) {
        racedIds.push(
          await subject.seedMessage({
            alertId: raced.alertId,
            recipientId,
            kind: SMS,
            createdAt: ago(racedAt, MINUTE),
            nextAttemptAt: ago(racedAt, MINUTE),
          }),
        );
      }
      const claims = await Promise.all(
        Array.from({ length: RACERS }, () =>
          subject.store.claimDueSms({ limit: BATCH, leaseMs: LEASE_MS }),
        ),
      );
      const handed = claims.flatMap((claim) =>
        ours(claim, racedIds).map(({ messageId }) => messageId),
      );
      expect(handed.sort(), 'each SMS handed to exactly one claimer').toEqual([...racedIds].sort());

      await allSent(subject, [...seededIds, later, earlier, ...racedIds]);
    },
  },
  {
    name: 'LOST-07-AC10: unsentSmsCount counts exactly the SMS messages unsent, not withdrawn and written 60 s or more before the store’s now, with that now',
    async run(subject) {
      const margin = Math.max(1, subject.timeMarginMs);
      const journey = await alerted(subject, {
        state: 'ESCALATED',
        smsRaisedAgoMs: 10 * MINUTE + SECOND,
        openedAgoMs: 15 * MINUTE,
        responders: 6,
      });
      const { alertId } = journey;
      const [r1 = '', r2 = '', r3 = '', r4 = '', r5 = '', r6 = ''] = journey.responderIds;
      const now = await subject.now();
      const seedSms = (
        recipientId: string,
        writtenAgoMs: number,
        given: {
          attempts?: number;
          sentAt?: Date;
          lastFailure?: 'NOT_CONFIGURED';
          withdrawnAt?: Date;
          nextAttemptAt?: Date;
        } = {},
      ) =>
        subject.seedMessage({
          alertId,
          recipientId,
          kind: SMS,
          createdAt: ago(now, writtenAgoMs),
          nextAttemptAt: ago(now, writtenAgoMs),
          ...given,
        });
      // Counted: written 60 s before the store's now (to the millisecond
      // against the fake), and ten minutes before, failing NOT_CONFIGURED.
      // That one is due again 40 s from now, as a refused SMS is after its
      // retry delay: the count is held to when an SMS was written, never to
      // when it is next due (D-100, LOST-07 review loop 2), so a count read
      // by next_attempt_at would miss it and say 2.
      await seedSms(r1, SMS_UNSENT_LIMIT_MS + (margin === 1 ? 0 : margin));
      await seedSms(r5, 10 * MINUTE, {
        attempts: 4,
        lastFailure: 'NOT_CONFIGURED',
        nextAttemptAt: new Date(now.getTime() + 40 * SECOND),
      });
      await seedSms(r6, 10 * MINUTE);
      // Not counted: written just under 60 s before; sent; withdrawn.
      await seedSms(r2, SMS_UNSENT_LIMIT_MS - margin);
      await seedSms(r3, 10 * MINUTE, { attempts: 1, sentAt: ago(now, 10 * MINUTE - SECOND) });
      await seedSms(r4, 10 * MINUTE, { withdrawnAt: ago(now, 9 * MINUTE) });
      // Nor a push of any kind, however long unsent.
      for (const kind of PUSH_KINDS) {
        await subject.seedMessage({
          alertId,
          recipientId: r1,
          kind,
          createdAt: ago(now, 10 * MINUTE),
          nextAttemptAt: ago(now, 10 * MINUTE),
        });
      }

      const from = await subject.now();
      const counted = await subject.store.unsentSmsCount(SMS_UNSENT_LIMIT_MS);
      const to = await subject.now();

      expect(counted.count).toBe(3);
      expect(counted.now.getTime(), 'the count’s now is the store’s').toBeGreaterThanOrEqual(
        from.getTime(),
      );
      expect(counted.now.getTime(), 'the count’s now is the store’s').toBeLessThanOrEqual(
        to.getTime(),
      );

      // Each that counts stops counting once it is sent or withdrawn.
      const unsent = ofKind(await subject.messagesOf(journey.journeyId), alertId, SMS).filter(
        ({ recipientId }) => [r1, r5, r6].includes(recipientId),
      );
      expect(unsent).toHaveLength(3);
      await allSent(
        subject,
        unsent.map(({ messageId }) => messageId),
      );
      expect((await subject.store.unsentSmsCount(SMS_UNSENT_LIMIT_MS)).count).toBe(0);
      await allSent(
        subject,
        (await subject.messagesOf(journey.journeyId)).map(({ messageId }) => messageId),
      );
    },
  },
  {
    name: 'LOST-07-AC7: for any sequence of acknowledgements, heartbeats fresh or stale, sweeps, time passing and "I’m home", after every step an alert is escalated exactly when a sweep found it due, holds one SMS per responder exactly when escalated, never has one when acknowledged before its two minutes, and no resolved or acknowledged alert has an SMS neither sent nor withdrawn',
    async run(subject) {
      const margin = subject.timeMarginMs;
      // The fake's clock is moved by hand. The database's moves on by
      // itself, and a behaviour cannot wait minutes for it, so against the
      // database a time step passes none: its runs reach two minutes through
      // alerts opened in the past instead (the spec's test plan).
      const passed = (ms: number) => (margin === 0 ? ms : 0);
      const step = fc.oneof(
        fc.record({ kind: fc.constant('heartbeat' as const), agoMs: silences(margin) }),
        fc.record({ kind: fc.constant('sweep' as const) }),
        // Who: the first responder, the second, the walker, or a stranger.
        fc.record({
          kind: fc.constant('acknowledge' as const),
          who: fc.integer({ min: 0, max: 3 }),
        }),
        fc.record({
          kind: fc.constant('time' as const),
          ms: fc.integer({ min: 1, max: 4 * MINUTE }),
        }),
        fc.record({ kind: fc.constant('home' as const) }),
      );
      const start = fc.oneof(
        // An ACTIVE journey silent this long, never heard from.
        fc.record({ kind: fc.constant('active' as const), silentForMs: silences(margin) }),
        // A LOST_CONTACT journey whose alert opened this long ago.
        fc.record({
          kind: fc.constant('lost' as const),
          openedAgoMs: fc.integer({ min: 15 * SECOND, max: 6 * MINUTE }),
        }),
      );

      await fc.assert(
        fc.asyncProperty(start, fc.array(step, { maxLength: 8 }), async (begin, steps) => {
          // The rules, applied step by step: the journey's state and last
          // contact, and each alert opened so far, with whether it resolved,
          // who is on it, whether a sweep escalated it, and whether someone
          // took it on before it was escalated.
          const model: {
            id: string;
            openedAt: Date;
            resolved: boolean;
            acknowledgedBy: string | null;
            escalated: boolean;
            acknowledgedBeforeEscalation: boolean;
          }[] = [];
          let state: 'ACTIVE' | 'LOST_CONTACT' | 'ENDED';
          let lastContact: Date;
          let journey: {
            walkerId: string;
            deviceId: string;
            journeyId: string;
            responderIds: string[];
          };
          if (begin.kind === 'active') {
            const now = await subject.now();
            journey = await watched(subject, {
              startedAt: ago(now, begin.silentForMs),
              responders: 2,
            });
            state = 'ACTIVE';
            lastContact = ago(now, begin.silentForMs);
          } else {
            const made = await alerted(subject, { openedAgoMs: begin.openedAgoMs, responders: 2 });
            journey = made;
            state = 'LOST_CONTACT';
            lastContact = new Date(made.openedAt.getTime() - LOST_CONTACT_AFTER_MS);
            model.push({
              id: made.alertId,
              openedAt: made.openedAt,
              resolved: false,
              acknowledgedBy: null,
              escalated: false,
              acknowledgedBeforeEscalation: false,
            });
          }
          const { journeyId, responderIds } = journey;
          const [started] = await subject.journeysOf(journey.walkerId);
          const startedAt = started?.startedAt ?? new Date(Number.NaN);
          const [stranger = ''] = await users(subject, 1);
          const senders = [...responderIds, journey.walkerId, stranger];

          for (const next of steps) {
            const current = model.at(-1);
            if (next.kind === 'heartbeat') {
              const at = await subject.now();
              // Never before the start: contact comes after a journey began.
              const receivedAt = ago(at, Math.min(next.agoMs, at.getTime() - startedAt.getTime()));
              const result = await subject.store.recordHeartbeat(
                heartbeatFor(journeyId, { receivedAt, position: null }),
              );
              if (state === 'ENDED') {
                expect(result.outcome, 'a heartbeat after the end').toBe('ended');
              } else {
                lastContact = new Date(Math.max(lastContact.getTime(), receivedAt.getTime()));
                const silenceMs = at.getTime() - lastContact.getTime();
                // Against the database, a silence within the margin of five
                // minutes could fall either side by the time the store
                // decides: then the store's answer is taken as the rule's.
                const sure = margin === 0 || Math.abs(silenceMs - LOST_CONTACT_AFTER_MS) > margin;
                const back = sure
                  ? state === 'LOST_CONTACT' && silenceMs < LOST_CONTACT_AFTER_MS
                  : result.outcome === 'back_in_contact';
                expect(result.outcome, 'the heartbeat’s answer').toBe(
                  back ? 'back_in_contact' : 'recorded',
                );
                if (back) {
                  state = 'ACTIVE';
                  if (current !== undefined) {
                    current.resolved = true;
                  }
                }
              }
            } else if (next.kind === 'sweep') {
              // The watchdog's two jobs at the store's level, in its order:
              // the open, then the escalation (approach item 3). Each is
              // decided by its read's own now, as the sweep decides.
              const overdue = await subject.store.overdueJourneys(LOST_CONTACT_AFTER_MS);
              const isOverdue = overdue.journeys.some(({ id }) => id === journeyId);
              expect(isOverdue, 'the overdue read').toBe(
                state === 'ACTIVE' &&
                  overdue.now.getTime() - lastContact.getTime() >= LOST_CONTACT_AFTER_MS,
              );
              if (isOverdue) {
                const opened = await subject.store.openLostContactAlert({
                  journeyId,
                  afterMs: LOST_CONTACT_AFTER_MS,
                });
                if (opened.outcome !== 'opened') {
                  throw new Error(
                    `expected the sweep to open the alert: ${JSON.stringify(opened)}`,
                  );
                }
                state = 'LOST_CONTACT';
                const openedAt =
                  (await subject.alertsOf(journeyId)).find(({ id }) => id === opened.alertId)
                    ?.openedAt ?? new Date(Number.NaN);
                model.push({
                  id: opened.alertId,
                  openedAt,
                  resolved: false,
                  acknowledgedBy: null,
                  escalated: false,
                  acknowledgedBeforeEscalation: false,
                });
              }
              const read = await subject.store.alertsDueForEscalation(ESCALATE_AFTER_MS);
              const due = read.alerts
                .filter(({ id }) => model.some((alert) => alert.id === id))
                .map(({ id }) => id)
                .sort();
              expect(due, 'the alerts read as due').toEqual(
                model
                  .filter(
                    (alert) =>
                      !alert.resolved &&
                      alert.acknowledgedBy === null &&
                      !alert.escalated &&
                      read.now.getTime() - alert.openedAt.getTime() >= ESCALATE_AFTER_MS,
                  )
                  .map(({ id }) => id)
                  .sort(),
              );
              for (const alertId of due) {
                escalated(await subject.store.escalateAlert({ alertId }));
                const alert = model.find(({ id }) => id === alertId);
                if (alert !== undefined) {
                  alert.escalated = true;
                }
              }
            } else if (next.kind === 'time') {
              const ms = passed(next.ms);
              if (ms > 0) {
                await subject.letTimePass(ms);
              }
            } else if (next.kind === 'home') {
              const result = await subject.store.recordHome(homeOf(journey));
              if (state === 'ENDED') {
                expect(result).toEqual({ outcome: 'already_ended' });
              } else {
                expect(result.outcome, '"I’m home"').toBe('home');
                if (state === 'LOST_CONTACT' && current !== undefined) {
                  current.resolved = true;
                }
                state = 'ENDED';
              }
            } else {
              const sender = senders[next.who] ?? stranger;
              const result = await subject.store.recordAcknowledgement({
                alertId: current?.id ?? syntheticUuid(),
                responderId: sender,
              });
              if (current === undefined || !responderIds.includes(sender)) {
                expect(result, 'not a responder, or no alert').toEqual(NOT_FOUND);
              } else if (current.resolved) {
                expect(result, 'a resolved alert').toEqual(OVER);
              } else if (current.acknowledgedBy === sender) {
                expect(result, 'the sender’s own').toEqual(YOURS);
              } else if (current.acknowledgedBy !== null) {
                expect(result, 'someone else’s').toEqual(TAKEN);
              } else {
                acknowledged(result);
                current.acknowledgedBy = sender;
                current.acknowledgedBeforeEscalation = !current.escalated;
              }
            }

            // After every step.
            expect(await subject.stateOf(journeyId)).toBe(state);
            const alerts = await subject.alertsOf(journeyId);
            const escalations = await subject.escalationsOf(journeyId);
            const acknowledgements = await subject.acknowledgementsOf(journeyId);
            const messages = await subject.messagesOf(journeyId);
            const withdrawnAt = await withdrawnAtOf(subject, journeyId);
            expect(alerts.map(({ id }) => id).sort()).toEqual(model.map(({ id }) => id).sort());
            for (const alert of alerts) {
              const expected = model.find(({ id }) => id === alert.id);
              const by =
                acknowledgements.find(({ alertId }) => alertId === alert.id)?.acknowledgedBy ??
                null;
              const smsRaisedAt =
                escalations.find(({ alertId }) => alertId === alert.id)?.smsRaisedAt ?? null;
              expect(alert.state === 'RESOLVED', 'resolved').toBe(expected?.resolved);
              expect(by, 'who is on it').toBe(expected?.acknowledgedBy ?? null);
              expect(
                smsRaisedAt !== null,
                'an escalation time exactly when a sweep found it due',
              ).toBe(expected?.escalated);
              const sms = ofKind(messages, alert.id, SMS);
              expect(
                recipientsOf(sms),
                'one SMS per responder exactly when it has an escalation time',
              ).toEqual(smsRaisedAt === null ? [] : [...responderIds].sort());
              if (expected?.acknowledgedBeforeEscalation === true) {
                expect(sms, 'taken on before it was due: never an SMS').toEqual([]);
              }
              if (alert.state === 'RESOLVED' || by !== null) {
                expect(
                  sms.filter(
                    ({ messageId, sentAt }) =>
                      sentAt === null && (withdrawnAt.get(messageId) ?? null) === null,
                  ),
                  'a resolved or acknowledged alert’s SMS still to send',
                ).toEqual([]);
              }
            }
          }
        }),
        {
          numRuns: subject.propertyRuns,
          // The spec's test plan, after LOST-03's review loop 1: fixed
          // sequences run first, so even the database's few runs reach an
          // escalation, then an acknowledgement, then a resolution.
          examples: [
            [
              { kind: 'lost', openedAgoMs: 3 * MINUTE },
              [
                { kind: 'sweep' },
                { kind: 'acknowledge', who: 0 },
                { kind: 'heartbeat', agoMs: 0 },
                { kind: 'sweep' },
              ],
            ],
            [
              { kind: 'lost', openedAgoMs: MINUTE },
              [
                { kind: 'acknowledge', who: 1 },
                { kind: 'time', ms: 2 * MINUTE },
                { kind: 'sweep' },
                { kind: 'home' },
              ],
            ],
            [
              { kind: 'active', silentForMs: 6 * MINUTE },
              [
                { kind: 'sweep' },
                { kind: 'time', ms: 2 * MINUTE },
                { kind: 'sweep' },
                { kind: 'heartbeat', agoMs: 0 },
                { kind: 'sweep' },
              ],
            ],
          ],
        },
      );
    },
  },
  {
    name: 'LOST-07-AC14: each withdrawal — the resolution, the acknowledgement, the open — withdraws exactly its own kinds’ unsent messages of the alerts it names, and leaves every other message alone',
    async run(subject) {
      /**
       * A message of every kind on each alert given, unsent for one recipient
       * and sent for another, but for the kinds `skip` says, which the step
       * under test writes itself and the unique (alert, recipient, kind)
       * would refuse a second of.
       */
      const seedEvery = async (
        alerts: readonly [alertId: string, unsentFor: string, sentFor: string][],
        skip: (alertId: string, kind: MessageKind) => boolean,
      ) => {
        const now = await subject.now();
        const seeded: { messageId: string; alertId: string; kind: MessageKind; unsent: boolean }[] =
          [];
        for (const [alertId, unsentFor, sentFor] of alerts) {
          for (const kind of MESSAGE_KINDS) {
            if (skip(alertId, kind)) {
              continue;
            }
            for (const [recipientId, unsent] of [
              [unsentFor, true],
              [sentFor, false],
            ] as const) {
              const messageId = await subject.seedMessage({
                alertId,
                recipientId,
                kind,
                createdAt: ago(now, 50 * MINUTE),
                nextAttemptAt: ago(now, 50 * MINUTE),
                attempts: 1,
                lastFailure: unsent ? 'UNAVAILABLE' : null,
                sentAt: unsent ? null : ago(now, 49 * MINUTE),
              });
              seeded.push({ messageId, alertId, kind, unsent });
            }
          }
        }
        return seeded;
      };
      const withdrawnOf = async (journeyIds: readonly string[]) =>
        (await Promise.all(journeyIds.map((journeyId) => subject.withdrawalsOf(journeyId))))
          .flat()
          .filter(({ withdrawnAt }) => withdrawnAt !== null);

      // The acknowledgement: its own alert's unsent messages of the kinds
      // withdrawn on acknowledgement, and nothing else. R3 acknowledges, and
      // its notices go to R1 and R2, so the alert's own ACKNOWLEDGED is seeded
      // for R3 alone, unsent, and must stay.
      {
        const now = await subject.now();
        const journey = await alerted(subject, {
          state: 'ESCALATED',
          smsRaisedAgoMs: MINUTE,
          responders: 3,
        });
        const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
        const earlier = await subject.seedAlert({
          journeyId: journey.journeyId,
          state: 'RESOLVED',
          openedAt: ago(now, HOUR + 30 * MINUTE),
          silentSince: ago(now, HOUR + 35 * MINUTE),
          resolvedAt: ago(now, HOUR),
          resolution: 'HOME',
          smsRaisedAt: ago(now, HOUR + 28 * MINUTE),
        });
        const other = await alerted(subject, {
          state: 'ESCALATED',
          smsRaisedAgoMs: MINUTE,
          responders: 2,
        });
        const [o1 = '', o2 = ''] = other.responderIds;
        const seeded = await seedEvery(
          [
            [earlier, r1, r2],
            [journey.alertId, r1, r2],
            [other.alertId, o2, o1],
          ],
          (alertId, kind) => alertId === journey.alertId && kind === NOTICE,
        );
        await subject.seedMessage({
          alertId: journey.alertId,
          recipientId: r3,
          kind: NOTICE,
          createdAt: ago(now, 50 * MINUTE),
          nextAttemptAt: ago(now, 50 * MINUTE),
          attempts: 1,
          lastFailure: 'UNAVAILABLE',
        });
        const expected = seeded
          .filter(
            ({ alertId, kind, unsent }) =>
              alertId === journey.alertId && unsent && WITHDRAWN_WHEN_ACKNOWLEDGED.includes(kind),
          )
          .map(({ messageId }) => messageId);
        expect(
          expected,
          'one unsent message of each kind withdrawn on acknowledgement',
        ).toHaveLength(WITHDRAWN_WHEN_ACKNOWLEDGED.length);

        acknowledged(
          await subject.store.recordAcknowledgement({
            alertId: journey.alertId,
            responderId: r3,
          }),
          'the acknowledgement',
        );

        const acknowledgedAt = (
          await acknowledgementOf(subject, journey.journeyId, journey.alertId)
        )?.acknowledgedAt;
        const withdrawn = await withdrawnOf([journey.journeyId, other.journeyId]);
        expect(withdrawn.map(({ messageId }) => messageId).sort(), 'the acknowledgement').toEqual(
          [...expected].sort(),
        );
        for (const { withdrawnAt } of withdrawn) {
          expect(withdrawnAt, 'the acknowledgement').toEqual(acknowledgedAt);
        }
      }

      // The resolution: its own alert's unsent messages of the kinds
      // withdrawn on resolution, the escalation SMS among them.
      {
        const now = await subject.now();
        const journey = await alerted(subject, {
          state: 'ESCALATED',
          smsRaisedAgoMs: MINUTE,
          responders: 2,
        });
        const [r1 = '', r2 = ''] = journey.responderIds;
        const earlier = await subject.seedAlert({
          journeyId: journey.journeyId,
          state: 'RESOLVED',
          openedAt: ago(now, HOUR + 30 * MINUTE),
          silentSince: ago(now, HOUR + 35 * MINUTE),
          resolvedAt: ago(now, HOUR),
          resolution: 'HOME',
        });
        const other = await alerted(subject, {
          state: 'ESCALATED',
          smsRaisedAgoMs: MINUTE,
          responders: 2,
        });
        const [o1 = '', o2 = ''] = other.responderIds;
        const seeded = await seedEvery(
          [
            [earlier, r1, r2],
            [journey.alertId, r1, r2],
            [other.alertId, o2, o1],
          ],
          (alertId, kind) => alertId === journey.alertId && kind === 'BACK_IN_CONTACT',
        );
        const expected = seeded
          .filter(
            ({ alertId, kind, unsent }) =>
              alertId === journey.alertId && unsent && WITHDRAWN_WHEN_RESOLVED.includes(kind),
          )
          .map(({ messageId }) => messageId);
        expect(expected, 'one unsent message of each kind withdrawn on resolution').toHaveLength(
          WITHDRAWN_WHEN_RESOLVED.length,
        );

        backInContact(
          await subject.store.recordHeartbeat(await freshHeartbeat(subject, journey.journeyId)),
        );

        const resolvedAt = (await resolutionOf(subject, journey.journeyId, journey.alertId))
          ?.resolvedAt;
        const withdrawn = await withdrawnOf([journey.journeyId, other.journeyId]);
        expect(withdrawn.map(({ messageId }) => messageId).sort(), 'the resolution').toEqual(
          [...expected].sort(),
        );
        for (const { withdrawnAt } of withdrawn) {
          expect(withdrawnAt, 'the resolution').toEqual(resolvedAt);
        }
      }

      // The open: the unsent messages of the kinds withdrawn on an open, of
      // the walker's earlier alerts, for this journey's responders.
      {
        const now = await subject.now();
        const journey = await watched(subject, {
          startedAt: ago(now, 3 * HOUR),
          lastHeartbeatAt: ago(now, HOUR),
          responders: 2,
        });
        const [r1 = '', r2 = ''] = journey.responderIds;
        const earlier = await subject.seedAlert({
          journeyId: journey.journeyId,
          state: 'RESOLVED',
          openedAt: ago(now, 2 * HOUR + 30 * MINUTE),
          silentSince: ago(now, 2 * HOUR + 35 * MINUTE),
          resolvedAt: ago(now, 2 * HOUR),
          resolution: 'BACK_IN_CONTACT',
          smsRaisedAt: ago(now, 2 * HOUR + 28 * MINUTE),
        });
        const other = await alerted(subject, {
          state: 'ESCALATED',
          smsRaisedAgoMs: MINUTE,
          responders: 2,
        });
        const [o1 = '', o2 = ''] = other.responderIds;
        const seeded = await seedEvery(
          [
            [earlier, r1, r2],
            [other.alertId, o2, o1],
          ],
          () => false,
        );
        const expected = seeded
          .filter(
            ({ alertId, kind, unsent }) =>
              alertId === earlier && unsent && WITHDRAWN_WHEN_OPENED.includes(kind),
          )
          .map(({ messageId }) => messageId);
        expect(expected, 'one unsent message of each kind withdrawn on an open').toHaveLength(
          WITHDRAWN_WHEN_OPENED.length,
        );

        const opened = await subject.store.openLostContactAlert({
          journeyId: journey.journeyId,
          afterMs: LOST_CONTACT_AFTER_MS,
        });
        if (opened.outcome !== 'opened') {
          throw new Error(`expected the open to open the alert: ${JSON.stringify(opened)}`);
        }

        const openedAt = (await subject.alertsOf(journey.journeyId)).find(
          ({ id }) => id === opened.alertId,
        )?.openedAt;
        const withdrawn = await withdrawnOf([journey.journeyId, other.journeyId]);
        expect(withdrawn.map(({ messageId }) => messageId).sort(), 'the open').toEqual(
          [...expected].sort(),
        );
        for (const { withdrawnAt } of withdrawn) {
          expect(withdrawnAt, 'the open').toEqual(openedAt);
        }
      }
    },
  },
  {
    name: 'SM-10-AC1: journeyForRemoval reads a journey’s state and its responder rows, without a lock; null for an ID no journey has',
    async run(subject) {
      const now = await subject.now();
      for (const state of STATES) {
        const journey = await watched(subject, { state, startedAt: ago(now, HOUR), responders: 2 });
        const expected = {
          id: journey.journeyId,
          state,
          responderIds: [...journey.responderIds].sort(),
        };

        expect(readSorted(await subject.store.journeyForRemoval(journey.journeyId)), state).toEqual(
          expected,
        );
        expect(
          readSorted(await subject.store.journeyForRemoval(journey.journeyId.toUpperCase())),
          `${state}, its ID in upper case`,
        ).toEqual(expected);
        // A plain read: a row another transaction holds is read all the same, at once.
        const holder = await subject.hold(journey.journeyId);
        try {
          expect(
            readSorted(
              await within(
                2_000,
                subject.store.journeyForRemoval(journey.journeyId),
                'the read of a held journey',
              ),
            ),
            `${state}, held`,
          ).toEqual(expected);
        } finally {
          await holder.release();
        }
      }

      // The responder rows as they stand: none, once every row is gone.
      const bare = await watched(subject, { startedAt: ago(now, HOUR), responders: 2 });
      await subject.removeResponders(bare.journeyId);
      expect(await subject.store.journeyForRemoval(bare.journeyId)).toEqual({
        id: bare.journeyId,
        state: 'ACTIVE',
        responderIds: [],
      });
      expect(await subject.store.journeyForRemoval(syntheticUuid())).toBeNull();
    },
  },
  {
    name: 'SM-10-AC1: removeResponder removes exactly the named responder’s row of an unended journey and nothing else of it; for an ended journey, a non-responder or no journey it answers not_removed with the rule’s decision and writes nothing (SM-02, SM-07, SM-08)',
    async run(subject) {
      for (const state of UNENDED) {
        const now = await subject.now();
        const journey =
          state === 'ACTIVE'
            ? await watched(subject, {
                startedAt: ago(now, HOUR),
                lastHeartbeatAt: ago(now, MINUTE),
                responders: 3,
              })
            : await alerted(subject, { responders: 3 });
        const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
        expect(r1.toUpperCase(), 'an ID with a letter in it').not.toBe(r1);
        // Another walker's journey, which R2 follows too, with R4.
        const [otherWalker = '', r4 = ''] = await users(subject, 2);
        const other = {
          walkerId: otherWalker,
          journeyId: await subject.seedJourney({
            walkerId: otherWalker,
            deviceId: await subject.addDevice(otherWalker),
            state: 'ACTIVE',
            responderIds: [r2, r4],
            startedAt: ago(now, HOUR),
          }),
        };
        const before = await removalRecordOf(subject, journey);
        const otherBefore = await removalRecordOf(subject, other);

        expect(await subject.store.removeResponder(removal(journey, r2)), state).toEqual({
          outcome: 'removed',
          resetAlertId: null,
          messages: [],
        });

        // R2's row is gone and nothing else of J changed: its state, its
        // start, its alert and every message as they were, and no warning,
        // since two responders remain.
        const after = await removalRecordOf(subject, journey);
        expect(await respondersOf(subject, journey), state).toEqual([r1, r3].sort());
        expect(after, state).toEqual({
          ...before,
          journeys: before.journeys.map((each) =>
            each.id === journey.journeyId ? { ...each, responderIds: [r1, r3].sort() } : each,
          ),
        });
        expect(await removalRecordOf(subject, other), `${state}: R2’s row elsewhere`).toEqual(
          otherBefore,
        );

        // Safe twice, with no event ID (D-103's reading): R2 is no longer
        // there. And nobody else who is not a responder of J, the walker
        // included, IDs compared exactly.
        for (const [who, responderId] of [
          ['R2 again', r2],
          ['the walker', journey.walkerId],
          ['a user who follows only another journey', r4],
          ['an ID that is no user’s', syntheticUuid()],
          ['R1’s ID in upper case', r1.toUpperCase()],
        ] as const) {
          expect(
            await subject.store.removeResponder(removal(journey, responderId)),
            `${state}, ${who}`,
          ).toEqual(NOT_A_RESPONDER);
        }
        expect(await removalRecordOf(subject, journey), state).toEqual(after);
        expect(await removalRecordOf(subject, other), state).toEqual(otherBefore);
      }

      // An ENDED journey: ignored, and its responder rows stay (SM-07).
      const ended = await watched(subject, { state: 'ENDED', startedAt: EARLIER, responders: 2 });
      const [first = ''] = ended.responderIds;
      const endedBefore = await removalRecordOf(subject, ended);
      expect(await subject.store.removeResponder(removal(ended, first))).toEqual(JOURNEY_OVER);
      expect(await removalRecordOf(subject, ended)).toEqual(endedBefore);
      // No journey at all.
      expect(
        await subject.store.removeResponder({ journeyId: syntheticUuid(), responderId: first }),
      ).toEqual(NO_SUCH_JOURNEY);
      expect(await removalRecordOf(subject, ended)).toEqual(endedBefore);
    },
  },
  {
    name: `SM-10-AC3: removeResponder decides again under the journey’s row, as its holder left it; ${String(RACERS)} removals of one responder at once, ${String(RACE_ROUNDS)} times over: one removes, every other is unchanged, none an error (SM-09)`,
    async run(subject) {
      for (const [what, change] of [
        ['let go unchanged', 'unchanged'],
        ['let go with R2’s row deleted', 'remove'],
        ['let go with J ended', 'end'],
      ] as const) {
        const now = await subject.now();
        const journey = await watched(subject, {
          startedAt: ago(now, HOUR),
          lastHeartbeatAt: ago(now, MINUTE),
          responders: 3,
        });
        const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
        const holder = await subject.holdUntilRemovalWaits(
          journey.journeyId,
          change === 'remove' ? { remove: r2 } : change,
        );
        let result: RemoveResponderResult;
        try {
          result = await within(
            10_000,
            subject.store.removeResponder(removal(journey, r2)),
            `the removal, ${what}`,
          );
        } finally {
          await holder.release();
        }

        // Decided by what the holder left, never by what was there before it.
        expect(result, what).toEqual(
          change === 'unchanged'
            ? { outcome: 'removed', resetAlertId: null, messages: [] }
            : change === 'remove'
              ? NOT_A_RESPONDER
              : JOURNEY_OVER,
        );
        expect(await respondersOf(subject, journey), what).toEqual(
          change === 'end' ? [r1, r2, r3].sort() : [r1, r3].sort(),
        );
        expect(await subject.journeyMessagesOf(journey.journeyId), what).toEqual([]);
      }

      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const at = `round ${String(round)}`;
        const now = await subject.now();
        const journey = await watched(subject, {
          startedAt: ago(now, HOUR),
          lastHeartbeatAt: ago(now, MINUTE),
          responders: 3,
        });
        const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;

        // Promise.all rejects if any removal fails outright: none may.
        const results = await Promise.all(
          Array.from({ length: RACERS }, () => subject.store.removeResponder(removal(journey, r2))),
        );

        expect(
          results.filter(({ outcome }) => outcome === 'removed'),
          at,
        ).toEqual([{ outcome: 'removed', resetAlertId: null, messages: [] }]);
        expect(
          results.filter(({ outcome }) => outcome !== 'removed'),
          at,
        ).toEqual(Array.from({ length: RACERS - 1 }, () => NOT_A_RESPONDER));
        expect(await respondersOf(subject, journey), at).toEqual([r1, r3].sort());
        expect(await subject.journeyMessagesOf(journey.journeyId), at).toEqual([]);
      }
    },
  },
  {
    name: 'SM-10-AC4: removing the acknowledger of the journey’s unresolved alert clears who and when together, clears its escalation time, sets it OPEN and raises its round, and withdraws its unsent ACKNOWLEDGED notices; removing another responder, or an acknowledger of a resolved alert, changes no alert (LOST-06)',
    async run(subject) {
      for (const [what, seed] of [
        ['ACKNOWLEDGED by R1', { state: 'ACKNOWLEDGED', recorded: true }],
        [
          'ACKNOWLEDGED by R1 after it escalated',
          { state: 'ACKNOWLEDGED', recorded: true, smsRaisedAgoMs: MINUTE },
        ],
        ['OPEN with R1 recorded, put in directly', { state: 'OPEN', recorded: true }],
        [
          'ESCALATED with R1 recorded, put in directly',
          { state: 'ESCALATED', recorded: true, smsRaisedAgoMs: MINUTE },
        ],
      ] as const) {
        const journey = await alerted(subject, { ...seed, responders: 3 });
        const { journeyId, alertId } = journey;
        const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
        expect(journey.acknowledgedBy, what).toBe(r1);
        // R1's "someone is on it" notices: R2's sent, R3's not yet accepted.
        const sent = await messageFor(subject, {
          alertId,
          recipientId: r2,
          kind: NOTICE,
          sentAgoMs: 50 * SECOND,
        });
        const unsent = await messageFor(subject, {
          alertId,
          recipientId: r3,
          kind: NOTICE,
          attempts: 2,
          lastFailure: 'UNAVAILABLE',
          dueAgoMs: -30 * SECOND,
        });
        const alertsBefore = await subject.alertsOf(journeyId);
        const messagesBefore = byMessage(await subject.messagesOf(journeyId));
        expect(await roundOf(subject, journeyId, alertId), what).toBe(1);

        const before = await subject.now();
        const result = await subject.store.removeResponder(removal(journey, r1));
        const after = await subject.now();

        expect(result, what).toEqual({ outcome: 'removed', resetAlertId: alertId, messages: [] });
        expect(await subject.alertsOf(journeyId), what).toEqual(
          alertsBefore.map((alert) => ({ ...alert, state: 'OPEN' })),
        );
        expect(await acknowledgementOf(subject, journeyId, alertId), what).toEqual({
          alertId,
          acknowledgedBy: null,
          acknowledgedAt: null,
        });
        expect(await smsRaisedAtOf(subject, journeyId, alertId), what).toBeNull();
        expect(await roundOf(subject, journeyId, alertId), what).toBe(2);
        expect(await subject.stateOf(journeyId), what).toBe('LOST_CONTACT');
        const withdrawnAt = await withdrawnAtOf(subject, journeyId);
        expect(
          between(withdrawnAt.get(unsent), before, after),
          `${what}: R3’s notice withdrawn at the removal’s now`,
        ).toBe(true);
        expect(withdrawnAt.get(sent), `${what}: R2’s sent notice`).toBeNull();
        // Attempts, last failures, due times and sent times as they were.
        expect(byMessage(await subject.messagesOf(journeyId)), what).toEqual(messagesBefore);
      }

      // Another responder removed, an alert nobody is on, and a RESOLVED
      // alert's acknowledger: no alert changes, who helped included.
      for (const [what, seed, who] of [
        ['R2 removed from an alert R1 is on', { state: 'ACKNOWLEDGED', recorded: true }, 1],
        ['R1 removed from an OPEN alert nobody is on', { state: 'OPEN' }, 0],
        ['R1 removed after the alert R1 was on RESOLVED', { state: 'RESOLVED', recorded: true }, 0],
      ] as const) {
        const journey = await alerted(subject, { ...seed, responders: 3 });
        const responderId = journey.responderIds[who] ?? '';
        const before = await escalationRecordOf(subject, journey.journeyId);
        const rounds = await subject.roundsOf(journey.journeyId);

        expect(await subject.store.removeResponder(removal(journey, responderId)), what).toEqual({
          outcome: 'removed',
          resetAlertId: null,
          messages: [],
        });

        expect(await escalationRecordOf(subject, journey.journeyId), what).toEqual(before);
        expect(await subject.roundsOf(journey.journeyId), what).toEqual(rounds);
      }
    },
  },
  {
    name: 'SM-10-AC6: after a reset of an escalated alert, alertsDueForEscalation reads it at once and escalateAlert writes one LOST_CONTACT_SMS per remaining responder in the new round, beside the earlier round’s (LOST-07, REL-07)',
    async run(subject) {
      const journey = await alerted(subject, {
        state: 'ACKNOWLEDGED',
        recorded: true,
        smsRaisedAgoMs: 2 * MINUTE,
        openedAgoMs: 4 * MINUTE,
        responders: 3,
      });
      const { journeyId, alertId } = journey;
      const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
      // Round 1's SMS, as the escalation and R1's "I'm on it" left them: R1's
      // and R2's accepted, R3's failing and withdrawn by the acknowledgement.
      const firstRound = [
        await messageFor(subject, {
          alertId,
          recipientId: r1,
          kind: SMS,
          dueAgoMs: 2 * MINUTE,
          sentAgoMs: 2 * MINUTE - SECOND,
        }),
        await messageFor(subject, {
          alertId,
          recipientId: r2,
          kind: SMS,
          dueAgoMs: 2 * MINUTE,
          sentAgoMs: 2 * MINUTE - SECOND,
        }),
        await messageFor(subject, {
          alertId,
          recipientId: r3,
          kind: SMS,
          lastFailure: 'NO_TARGET',
          withdrawnAgoMs: MINUTE,
        }),
      ];
      const firstRoundBefore = byMessage(await subject.messagesOf(journeyId));
      const withdrawalsBefore = byMessage(await subject.withdrawalsOf(journeyId));
      const dueIds = async () =>
        (await subject.store.alertsDueForEscalation(ESCALATE_AFTER_MS)).alerts.map(({ id }) => id);
      expect(await dueIds(), 'acknowledged by R1: not due').not.toContain(alertId);

      expect(removed(await subject.store.removeResponder(removal(journey, r1))).resetAlertId).toBe(
        alertId,
      );

      // Due at once: its two minutes from the opening have long passed.
      const read = await subject.store.alertsDueForEscalation(ESCALATE_AFTER_MS);
      expect(read.alerts.filter(({ id }) => id === alertId)).toEqual([
        {
          id: alertId,
          journeyId,
          state: 'OPEN',
          acknowledgedBy: null,
          smsRaisedAt: null,
          openedAt: journey.openedAt,
        },
      ]);
      const { messages } = escalated(await subject.store.escalateAlert({ alertId }));

      expect(byRecipient(messages.map(({ recipientId, kind }) => ({ recipientId, kind })))).toEqual(
        byRecipient([
          { recipientId: r2, kind: SMS },
          { recipientId: r3, kind: SMS },
        ]),
      );
      expect(messages.filter(({ messageId }) => firstRound.includes(messageId))).toEqual([]);
      const rounds = await messageRoundsByIdOf(subject, journeyId);
      expect(firstRound.map((messageId) => rounds.get(messageId))).toEqual([1, 1, 1]);
      expect(messages.map(({ messageId }) => rounds.get(messageId))).toEqual([2, 2]);
      // The first round's rows exactly as they were.
      expect(
        byMessage(
          (await subject.messagesOf(journeyId)).filter(({ messageId }) =>
            firstRound.includes(messageId),
          ),
        ),
      ).toEqual(firstRoundBefore);
      expect(
        byMessage(
          (await subject.withdrawalsOf(journeyId)).filter(({ messageId }) =>
            firstRound.includes(messageId),
          ),
        ),
      ).toEqual(withdrawalsBefore);
      expect((await subject.alertsOf(journeyId)).map(({ state }) => state)).toEqual(['ESCALATED']);
      expect(await smsRaisedAtOf(subject, journeyId, alertId)).not.toBeNull();
      expect(await roundOf(subject, journeyId, alertId)).toBe(2);

      // Escalated in this round: neither due nor escalated again.
      expect(await dueIds()).not.toContain(alertId);
      expect(await subject.store.escalateAlert({ alertId })).toEqual(NOT_ESCALATED);
      expect(ofKind(await subject.messagesOf(journeyId), alertId, SMS)).toHaveLength(5);
    },
  },
  {
    name: 'SM-10-AC7: after a reset, recordAcknowledgement records a second acknowledger, writes its notices in the new round, and withdraws the alert’s unsent SMS; one message per alert, recipient, kind and round (LOST-06, LOST-07)',
    async run(subject) {
      const journey = await alerted(subject, {
        state: 'ACKNOWLEDGED',
        recorded: true,
        smsRaisedAgoMs: 2 * MINUTE,
        openedAgoMs: 4 * MINUTE,
        responders: 3,
      });
      const { journeyId, alertId } = journey;
      const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
      // Round 1: R1's notices to R2 and R3, both accepted.
      const firstNotices = [
        await messageFor(subject, {
          alertId,
          recipientId: r2,
          kind: NOTICE,
          sentAgoMs: 2 * MINUTE,
        }),
        await messageFor(subject, {
          alertId,
          recipientId: r3,
          kind: NOTICE,
          sentAgoMs: 2 * MINUTE,
        }),
      ];
      removed(await subject.store.removeResponder(removal(journey, r1)));
      const secondRound = escalated(await subject.store.escalateAlert({ alertId })).messages;

      const { messages: notices } = acknowledged(
        await subject.store.recordAcknowledgement({ alertId, responderId: r2 }),
        'R2’s acknowledgement after the reset',
      );

      expect(notices.map(({ recipientId, kind }) => ({ recipientId, kind }))).toEqual([
        { recipientId: r3, kind: NOTICE },
      ]);
      const acknowledgement = await acknowledgementOf(subject, journeyId, alertId);
      expect(acknowledgement?.acknowledgedBy).toBe(r2);
      expect(acknowledgement?.acknowledgedAt).toBeInstanceOf(Date);
      expect((await subject.alertsOf(journeyId)).map(({ state }) => state)).toEqual([
        'ACKNOWLEDGED',
      ]);
      let rounds = await messageRoundsByIdOf(subject, journeyId);
      expect(notices.map(({ messageId }) => rounds.get(messageId))).toEqual([2]);
      expect(firstNotices.map((messageId) => rounds.get(messageId))).toEqual([1, 1]);
      // The second round's SMS, unsent, withdrawn at the acknowledgement's now.
      const withdrawnAt = await withdrawnAtOf(subject, journeyId);
      expect(secondRound.map(({ messageId }) => withdrawnAt.get(messageId))).toEqual(
        secondRound.map(() => acknowledgement?.acknowledgedAt),
      );
      // One message per alert, recipient, kind and round.
      const keys = (await subject.messagesOf(journeyId)).map(
        ({ messageId, alertId: of, recipientId, kind }) =>
          `${of} ${recipientId} ${kind} ${String(rounds.get(messageId))}`,
      );
      expect(new Set(keys).size).toBe(keys.length);

      // R2 removed too: reset again, its round raised again, R3's unsent
      // notice withdrawn, and the next escalation texts R3 alone.
      expect(removed(await subject.store.removeResponder(removal(journey, r2))).resetAlertId).toBe(
        alertId,
      );
      expect(await roundOf(subject, journeyId, alertId)).toBe(3);
      expect(await acknowledgementOf(subject, journeyId, alertId)).toEqual({
        alertId,
        acknowledgedBy: null,
        acknowledgedAt: null,
      });
      expect(
        (await withdrawnAtOf(subject, journeyId)).get(notices[0]?.messageId ?? ''),
      ).toBeInstanceOf(Date);
      const thirdRound = escalated(await subject.store.escalateAlert({ alertId })).messages;
      expect(thirdRound.map(({ recipientId, kind }) => ({ recipientId, kind }))).toEqual([
        { recipientId: r3, kind: SMS },
      ]);
      rounds = await messageRoundsByIdOf(subject, journeyId);
      expect(thirdRound.map(({ messageId }) => rounds.get(messageId))).toEqual([3]);

      // The store's own rule, as the unique key and the check hold it: a
      // second message of one kind for the same alert, recipient and round is
      // refused; one in another round is taken; a round under 1 is refused.
      await expect(
        messageFor(subject, { alertId, recipientId: r3, kind: NOTICE, round: 2 }),
      ).rejects.toThrow();
      await expect(
        messageFor(subject, { alertId, recipientId: r3, kind: NOTICE, round: 4 }),
      ).resolves.toMatch(LOWER_UUID);
      await expect(
        messageFor(subject, { alertId, recipientId: r3, kind: NOTICE, round: 4 }),
      ).rejects.toThrow();
      await expect(
        messageFor(subject, { alertId, recipientId: r1, kind: NOTICE, round: 0 }),
      ).rejects.toThrow();
    },
  },
  {
    name: 'SM-10-AC9: recordAcknowledgement from a responder removed after its read answers ALERT_NOT_FOUND under the lock and writes nothing (LOST-06, SM-09)',
    async run(subject) {
      const journey = await alerted(subject, { responders: 2 });
      const { journeyId, alertId } = journey;
      const [r1 = ''] = journey.responderIds;
      // The read, as "I'm on it" makes it: R1 is a responder.
      const read = await subject.store.alertForAcknowledgement(alertId);
      expect(read?.responderIds).toContain(r1);
      removed(await subject.store.removeResponder(removal(journey, r1)));
      const before = await removalRecordOf(subject, journey);

      expect(await subject.store.recordAcknowledgement({ alertId, responderId: r1 })).toEqual(
        NOT_FOUND,
      );

      expect(await removalRecordOf(subject, journey)).toEqual(before);
      expect(await acknowledgementOf(subject, journeyId, alertId)).toEqual({
        alertId,
        acknowledgedBy: null,
        acknowledgedAt: null,
      });
      expect(ofKind(await subject.messagesOf(journeyId), alertId, NOTICE)).toEqual([]);
    },
  },
  {
    name: 'SM-10-AC11: removeResponder withdraws every unsent message of the journey’s alerts to the removed responder, whatever its kind, at the store’s now, keeping attempts and last failure; sent ones and other recipients’ are left alone, and a later resolution writes the removed responder no stand-down (LOST-03)',
    async run(subject) {
      const now = await subject.now();
      const journey = await alerted(subject, {
        state: 'ESCALATED',
        smsRaisedAgoMs: MINUTE,
        responders: 3,
      });
      const { journeyId, alertId } = journey;
      const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
      const earlier = await subject.seedAlert({
        journeyId,
        state: 'RESOLVED',
        openedAt: ago(now, HOUR + 30 * MINUTE),
        silentSince: ago(now, HOUR + 35 * MINUTE),
        resolvedAt: ago(now, HOUR),
        resolution: 'HOME',
      });
      // R2's: the lost-contact push accepted; the SMS failing NO_TARGET and
      // due again; a notice never claimed; an earlier alert's stand-down,
      // unsent and failing.
      const accepted = await messageFor(subject, {
        alertId,
        recipientId: r2,
        kind: 'LOST_CONTACT',
        sentAgoMs: 3 * MINUTE,
      });
      const r2Unsent = [
        await messageFor(subject, {
          alertId,
          recipientId: r2,
          kind: SMS,
          attempts: 2,
          lastFailure: 'NO_TARGET',
          dueAgoMs: SECOND,
        }),
        await messageFor(subject, { alertId, recipientId: r2, kind: NOTICE, attempts: 0 }),
        await messageFor(subject, {
          alertId: earlier,
          recipientId: r2,
          kind: 'HOME',
          attempts: 3,
          lastFailure: 'UNAVAILABLE',
          dueAgoMs: SECOND,
        }),
      ];
      // Everyone else's, of every kind, unsent: none of them is R2's to lose.
      const others: string[] = [];
      for (const recipientId of [r1, r3]) {
        for (const [of, kind] of [
          [alertId, 'LOST_CONTACT'],
          [alertId, SMS],
          [alertId, NOTICE],
          [earlier, 'HOME'],
        ] as const) {
          others.push(await messageFor(subject, { alertId: of, recipientId, kind }));
        }
      }
      // R2 follows another walker's journey too, with an unsent message there.
      const [otherWalker = ''] = await users(subject, 1);
      const elsewhere = await subject.seedJourney({
        walkerId: otherWalker,
        deviceId: await subject.addDevice(otherWalker),
        state: 'LOST_CONTACT',
        responderIds: [r2],
        startedAt: ago(now, HOUR),
        lastHeartbeatAt: ago(now, 10 * MINUTE),
      });
      const elsewhereAlert = await subject.seedAlert({
        journeyId: elsewhere,
        state: 'OPEN',
        openedAt: ago(now, 4 * MINUTE),
        silentSince: ago(now, 10 * MINUTE),
      });
      const theirs = await messageFor(subject, {
        alertId: elsewhereAlert,
        recipientId: r2,
        kind: 'LOST_CONTACT',
      });
      const messagesBefore = byMessage(await subject.messagesOf(journeyId));
      const elsewhereBefore = await alertRecordOf(subject, elsewhere);

      const before = await subject.now();
      expect(await subject.store.removeResponder(removal(journey, r2))).toEqual({
        outcome: 'removed',
        resetAlertId: null,
        messages: [],
      });
      const after = await subject.now();

      const withdrawnAt = await withdrawnAtOf(subject, journeyId);
      for (const messageId of r2Unsent) {
        expect(between(withdrawnAt.get(messageId), before, after), messageId).toBe(true);
      }
      expect(withdrawnAt.get(accepted)).toBeNull();
      for (const messageId of others) {
        expect(withdrawnAt.get(messageId), messageId).toBeNull();
      }
      // Attempts, last failures, due and sent times all as they were.
      expect(byMessage(await subject.messagesOf(journeyId))).toEqual(messagesBefore);
      expect(await alertRecordOf(subject, elsewhere)).toEqual(elsewhereBefore);
      expect((await withdrawnAtOf(subject, elsewhere)).get(theirs)).toBeNull();
      // Never handed to a port again.
      const pushed = (await subject.store.claimDue({ limit: BATCH, leaseMs: LEASE_MS })).messages;
      const texted = await smsClaimed(subject);
      for (const messageId of r2Unsent) {
        expect(pushed.map((message) => message.messageId)).not.toContain(messageId);
        expect(texted).not.toContain(messageId);
      }
      await allSent(subject, [...pushed.map(({ messageId }) => messageId), ...texted]);

      // The alert resolves: R1 and R3 are stood down, R2 is not.
      const { messages } = backInContact(
        await subject.store.recordHeartbeat(await freshHeartbeat(subject, journeyId)),
      );
      expect(recipientsOf(messages)).toEqual([r1, r3].sort());
      expect(
        recipientsOf(
          (await subject.messagesOf(journeyId)).filter(
            ({ alertId: of, kind }) => of === alertId && kind === 'BACK_IN_CONTACT',
          ),
        ),
      ).toEqual([r1, r3].sort());
    },
  },
  {
    name: 'SM-10-AC12: removing the last responder of an unended journey writes one NO_RESPONDER to its walker, naming the journey and no alert, due at the store’s now; a removal that leaves a responder writes none (SM-02)',
    async run(subject) {
      for (const state of UNENDED) {
        const now = await subject.now();
        const journey =
          state === 'ACTIVE'
            ? await watched(subject, {
                startedAt: ago(now, HOUR),
                lastHeartbeatAt: ago(now, MINUTE),
                responders: 2,
              })
            : await alerted(subject, { responders: 2 });
        const [r1 = '', r2 = ''] = journey.responderIds;
        const alertsBefore = await escalationRecordOf(subject, journey.journeyId);
        const roundsBefore = await subject.roundsOf(journey.journeyId);

        // A removal that leaves a responder warns nobody.
        expect(await subject.store.removeResponder(removal(journey, r1)), state).toEqual({
          outcome: 'removed',
          resetAlertId: null,
          messages: [],
        });
        expect(await subject.journeyMessagesOf(journey.journeyId), state).toEqual([]);

        const before = await subject.now();
        const result = removed(await subject.store.removeResponder(removal(journey, r2)), state);
        const after = await subject.now();

        expect(result.resetAlertId, state).toBeNull();
        expect(
          result.messages.map(({ recipientId, kind }) => ({ recipientId, kind })),
          state,
        ).toEqual([{ recipientId: journey.walkerId, kind: WARNING }]);
        const [answered] = result.messages;
        const messageId = answered?.messageId ?? '';
        // An opaque ID of its own: no person's, journey's, alert's or device's.
        expect(messageId, state).toMatch(LOWER_UUID);
        expect(
          [
            journey.walkerId,
            journey.deviceId,
            journey.journeyId,
            r1,
            r2,
            ...alertsBefore.alerts.map(({ id }) => id),
          ],
          state,
        ).not.toContain(messageId);
        const stored = await subject.journeyMessagesOf(journey.journeyId);
        expect(stored, state).toEqual([
          {
            messageId,
            journeyId: journey.journeyId,
            recipientId: journey.walkerId,
            kind: WARNING,
            round: 1,
            createdAt: expect.any(Date) as unknown,
            attempts: 0,
            nextAttemptAt: stored[0]?.createdAt,
            sentAt: null,
            lastFailure: null,
            withdrawnAt: null,
          },
        ]);
        expect(
          between(stored[0]?.createdAt, before, after),
          `${state}: due at the removal’s now`,
        ).toBe(true);
        // Nothing for anyone else, nothing on the alert, and the journey goes on.
        expect(await escalationRecordOf(subject, journey.journeyId), state).toEqual(alertsBefore);
        expect(await subject.roundsOf(journey.journeyId), state).toEqual(roundsBefore);
        expect(await subject.stateOf(journey.journeyId), state).toBe(state);
        expect(await respondersOf(subject, journey), state).toEqual([]);

        // A removal answered unchanged warns nobody again.
        expect(await subject.store.removeResponder(removal(journey, r2)), state).toEqual(
          NOT_A_RESPONDER,
        );
        expect(await subject.journeyMessagesOf(journey.journeyId), state).toEqual(stored);
      }

      // An ENDED journey's last responder: ignored, and no warning.
      const ended = await watched(subject, { state: 'ENDED', startedAt: EARLIER, responders: 1 });
      expect(
        await subject.store.removeResponder(removal(ended, ended.responderIds[0] ?? '')),
      ).toEqual(JOURNEY_OVER);
      expect(await subject.journeyMessagesOf(ended.journeyId)).toEqual([]);
    },
  },
  {
    name: 'SM-10-AC13: the last two responders removed at once write one NO_RESPONDER between them (SM-02)',
    async run(subject) {
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const at = `round ${String(round)}`;
        const now = await subject.now();
        const journey = await watched(subject, {
          startedAt: ago(now, HOUR),
          lastHeartbeatAt: ago(now, MINUTE),
          responders: 2,
        });
        const [r1 = '', r2 = ''] = journey.responderIds;

        // Promise.all rejects if either fails outright: neither may.
        const results = await Promise.all([
          subject.store.removeResponder(removal(journey, r1)),
          subject.store.removeResponder(removal(journey, r2)),
        ]);

        const warned = results.map((result) => removed(result, at).messages);
        expect(
          warned.filter((messages) => messages.length > 0),
          at,
        ).toHaveLength(1);
        expect(
          warned.flat().map(({ recipientId, kind }) => ({ recipientId, kind })),
          at,
        ).toEqual([{ recipientId: journey.walkerId, kind: WARNING }]);
        expect(
          (await subject.journeyMessagesOf(journey.journeyId)).map(({ messageId }) => messageId),
          at,
        ).toEqual(warned.flat().map(({ messageId }) => messageId));
        expect(await respondersOf(subject, journey), at).toEqual([]);
      }
    },
  },
  {
    name: 'SM-10-AC14: the push claim hands out a NO_RESPONDER in its due order and the SMS claim never does; no withdrawal touches it (SM-02)',
    async run(subject) {
      const now = await subject.now();
      // W's journey J, silent an hour, with one responder; and V's journey K,
      // which W follows, with X, its alert open, and two messages due before
      // the warning will be.
      const journey = await watched(subject, {
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, HOUR),
        responders: 1,
      });
      const [r1 = ''] = journey.responderIds;
      const [v = '', x = ''] = await users(subject, 2);
      const k = {
        walkerId: v,
        journeyId: await subject.seedJourney({
          walkerId: v,
          deviceId: await subject.addDevice(v),
          state: 'LOST_CONTACT',
          responderIds: [journey.walkerId, x],
          startedAt: ago(now, 2 * HOUR),
          lastHeartbeatAt: ago(now, 8 * MINUTE),
        }),
      };
      const kAlert = await subject.seedAlert({
        journeyId: k.journeyId,
        state: 'OPEN',
        openedAt: ago(now, 3 * MINUTE),
        silentSince: ago(now, 8 * MINUTE),
      });
      const early = await messageFor(subject, {
        alertId: kAlert,
        recipientId: x,
        kind: 'LOST_CONTACT',
        attempts: 0,
        dueAgoMs: 2 * MINUTE,
      });
      const middle = await messageFor(subject, {
        alertId: kAlert,
        recipientId: journey.walkerId,
        kind: 'LOST_CONTACT',
        attempts: 0,
        dueAgoMs: MINUTE,
      });

      const [warning] = removed(await subject.store.removeResponder(removal(journey, r1))).messages;
      const warningId = warning?.messageId ?? '';

      // The SMS claim never hands it out.
      expect(await smsClaimed(subject)).not.toContain(warningId);
      // The push claim does, in its due order: after the two due before it.
      const claimOne = () => subject.store.claimDue({ limit: 1, leaseMs: LEASE_MS });
      expect((await claimOne()).messages.map(({ messageId }) => messageId)).toEqual([early]);
      expect((await claimOne()).messages.map(({ messageId }) => messageId)).toEqual([middle]);
      const claim = await claimOne();
      expect(claim.messages).toEqual([
        { messageId: warningId, recipientId: journey.walkerId, kind: WARNING, attempts: 1 },
      ]);
      // Leased, with its attempt counted, as every push kind's.
      const [leased] = await subject.journeyMessagesOf(journey.journeyId);
      expect(leased?.attempts).toBe(1);
      expect(leased?.nextAttemptAt.getTime()).toBe(claim.now.getTime() + LEASE_MS);
      expect((await claimOne()).messages).toEqual([]);
      await allSent(subject, [early, middle]);

      // No withdrawal touches it. W says "I'm on it" for K's alert, and is
      // removed from K, which resets it and withdraws W's unsent messages of
      // K's alerts: none of them is J's warning. Then J goes silent and is
      // opened, which withdraws the walker's stand-downs, and contact comes
      // back, which resolves J's alert.
      acknowledged(
        await subject.store.recordAcknowledgement({
          alertId: kAlert,
          responderId: journey.walkerId,
        }),
      );
      expect(
        removed(await subject.store.removeResponder(removal(k, journey.walkerId))).resetAlertId,
      ).toBe(kAlert);
      const opened = await subject.store.openLostContactAlert({
        journeyId: journey.journeyId,
        afterMs: LOST_CONTACT_AFTER_MS,
      });
      expect(opened.outcome).toBe('opened');
      backInContact(
        await subject.store.recordHeartbeat(await freshHeartbeat(subject, journey.journeyId)),
      );

      expect(await subject.journeyMessagesOf(journey.journeyId)).toEqual([leased]);
      expect(await subject.journeyMessagesOf(k.journeyId)).toEqual([]);
    },
  },
  {
    name: 'SM-10-AC15: a journey with no responder row opens with no message; its alert is never read as due and never escalated; unheardAlertCount counts exactly the unresolved alerts whose journey has no responder row, with the store’s now (SM-02, LOST-02, LOST-07)',
    async run(subject) {
      // Read against the whole store, as the SMS check reads it: so each
      // count is compared with the one before it.
      const counted = async (what: string): Promise<number> => {
        const before = await subject.now();
        const read = await subject.store.unheardAlertCount();
        const after = await subject.now();
        expect(between(read.now, before, after), `${what}: the count’s now is the store’s`).toBe(
          true,
        );
        expect(Number.isSafeInteger(read.count) && read.count >= 0, what).toBe(true);
        return read.count;
      };
      const base = await counted('at the start');
      const now = await subject.now();

      // J, silent an hour, its last responder removed: no alert yet.
      const journey = await watched(subject, {
        startedAt: ago(now, 2 * HOUR),
        lastHeartbeatAt: ago(now, HOUR),
        responders: 1,
      });
      removed(await subject.store.removeResponder(removal(journey, journey.responderIds[0] ?? '')));
      expect(await counted('J with no responder, still ACTIVE')).toBe(base);

      // Opened, with nobody to tell.
      const opened = await subject.store.openLostContactAlert({
        journeyId: journey.journeyId,
        afterMs: LOST_CONTACT_AFTER_MS,
      });
      expect(opened).toEqual({
        outcome: 'opened',
        alertId: expect.stringMatching(LOWER_UUID) as unknown,
        messages: [],
      });
      expect(await subject.stateOf(journey.journeyId)).toBe('LOST_CONTACT');
      expect((await subject.alertsOf(journey.journeyId)).map(({ state }) => state)).toEqual([
        'OPEN',
      ]);
      expect(await subject.messagesOf(journey.journeyId)).toEqual([]);
      expect(await counted('J opened with nobody to tell')).toBe(base + 1);

      // An alert two minutes old or more is due while its journey has a
      // responder (the control), and never once it has none.
      const old = await alerted(subject, { openedAgoMs: 3 * MINUTE, responders: 2 });
      const dueIds = async () =>
        (await subject.store.alertsDueForEscalation(ESCALATE_AFTER_MS)).alerts.map(({ id }) => id);
      expect(await dueIds()).toContain(old.alertId);
      for (const responderId of old.responderIds) {
        removed(await subject.store.removeResponder(removal(old, responderId)));
      }
      const oldBefore = await escalationRecordOf(subject, old.journeyId);
      expect(await dueIds()).not.toContain(old.alertId);
      expect(await subject.store.escalateAlert({ alertId: old.alertId })).toEqual(NOT_ESCALATED);
      expect(await escalationRecordOf(subject, old.journeyId)).toEqual(oldBefore);
      expect(await counted('two unheard alerts')).toBe(base + 2);

      // Not counted: an alert whose journey has a responder, and a RESOLVED
      // one whose journey has none.
      await alerted(subject, { responders: 1 });
      const over = await alerted(subject, { state: 'RESOLVED', responders: 1 });
      await subject.removeResponders(over.journeyId);
      expect(await counted('one heard, one over')).toBe(base + 2);

      // Contact back resolves J's alert, with no stand-down: counted no more.
      expect(
        backInContact(
          await subject.store.recordHeartbeat(await freshHeartbeat(subject, journey.journeyId)),
        ).messages,
      ).toEqual([]);
      expect(await counted('J back in contact')).toBe(base + 1);
    },
  },
  {
    name: 'SM-10-AC8: for any sequence of acknowledgements, removals, sweeps, time passing, heartbeats fresh or stale and "I’m home", after every step an acknowledger is a responder, each round’s SMS reach exactly that round’s responders, a due alert with a responder is escalated in its round by the next sweep, no removed responder has a message pending, and the walker holds one warning per time the last responder went (LOST-02, LOST-07)',
    async run(subject) {
      const margin = subject.timeMarginMs;
      // As LOST-07-AC7's property: the fake's clock is moved by hand; the
      // database's moves on by itself, so against it a time step passes none,
      // and its runs reach two minutes through alerts opened in the past.
      const passed = (ms: number) => (margin === 0 ? ms : 0);
      // Who: the first, second or third responder, the walker, or a stranger.
      const who = fc.integer({ min: 0, max: 4 });
      const step = fc.oneof(
        fc.record({ kind: fc.constant('heartbeat' as const), agoMs: silences(margin) }),
        fc.record({ kind: fc.constant('sweep' as const) }),
        fc.record({ kind: fc.constant('acknowledge' as const), who }),
        fc.record({ kind: fc.constant('remove' as const), who }),
        fc.record({
          kind: fc.constant('time' as const),
          ms: fc.integer({ min: 1, max: 4 * MINUTE }),
        }),
        fc.record({ kind: fc.constant('home' as const) }),
      );
      const start = fc.oneof(
        // An ACTIVE journey silent this long, never heard from.
        fc.record({ kind: fc.constant('active' as const), silentForMs: silences(margin) }),
        // A LOST_CONTACT journey whose alert opened this long ago.
        fc.record({
          kind: fc.constant('lost' as const),
          openedAgoMs: fc.integer({ min: 15 * SECOND, max: 6 * MINUTE }),
        }),
      );

      await fc.assert(
        fc.asyncProperty(start, fc.array(step, { maxLength: 10 }), async (begin, steps) => {
          // The rules, applied step by step: the journey's state, last
          // contact and responders, who was removed, how many warnings the
          // walker was written, and each alert opened so far: whether it
          // resolved, who is on it, its round, who its lost-contact push was
          // written for, and, for each round it escalated in, who was texted.
          const model: {
            id: string;
            openedAt: Date;
            resolved: boolean;
            acknowledgedBy: string | null;
            round: number;
            pushedTo: string[];
            texted: Map<number, string[]>;
          }[] = [];
          let state: 'ACTIVE' | 'LOST_CONTACT' | 'ENDED';
          let lastContact: Date;
          let journey: {
            walkerId: string;
            deviceId: string;
            journeyId: string;
            responderIds: string[];
          };
          if (begin.kind === 'active') {
            const now = await subject.now();
            journey = await watched(subject, {
              startedAt: ago(now, begin.silentForMs),
              responders: 3,
            });
            state = 'ACTIVE';
            lastContact = ago(now, begin.silentForMs);
          } else {
            const made = await alerted(subject, { openedAgoMs: begin.openedAgoMs, responders: 3 });
            journey = made;
            state = 'LOST_CONTACT';
            lastContact = new Date(made.openedAt.getTime() - LOST_CONTACT_AFTER_MS);
            model.push({
              id: made.alertId,
              openedAt: made.openedAt,
              resolved: false,
              acknowledgedBy: null,
              round: 1,
              pushedTo: [],
              texted: new Map(),
            });
          }
          const { journeyId } = journey;
          let responders = [...journey.responderIds];
          const removedOnes = new Set<string>();
          let warnings = 0;
          const [started] = await subject.journeysOf(journey.walkerId);
          const startedAt = started?.startedAt ?? new Date(Number.NaN);
          const [stranger = ''] = await users(subject, 1);
          const people = [...journey.responderIds, journey.walkerId, stranger];

          for (const next of steps) {
            const current = model.at(-1);
            if (next.kind === 'heartbeat') {
              const at = await subject.now();
              // Never before the start: contact comes after a journey began.
              const receivedAt = ago(at, Math.min(next.agoMs, at.getTime() - startedAt.getTime()));
              const result = await subject.store.recordHeartbeat(
                heartbeatFor(journeyId, { receivedAt, position: null }),
              );
              if (state === 'ENDED') {
                expect(result.outcome, 'a heartbeat after the end').toBe('ended');
              } else {
                lastContact = new Date(Math.max(lastContact.getTime(), receivedAt.getTime()));
                const silenceMs = at.getTime() - lastContact.getTime();
                const sure = margin === 0 || Math.abs(silenceMs - LOST_CONTACT_AFTER_MS) > margin;
                const back = sure
                  ? state === 'LOST_CONTACT' && silenceMs < LOST_CONTACT_AFTER_MS
                  : result.outcome === 'back_in_contact';
                expect(result.outcome, 'the heartbeat’s answer').toBe(
                  back ? 'back_in_contact' : 'recorded',
                );
                if (back) {
                  state = 'ACTIVE';
                  if (current !== undefined) {
                    current.resolved = true;
                    // Stood down: the responders still on the journey, and
                    // nobody removed.
                    const stoodDown = result.outcome === 'back_in_contact' ? result.messages : [];
                    expect(recipientsOf(stoodDown), 'stood down').toEqual([...responders].sort());
                  }
                }
              }
            } else if (next.kind === 'sweep') {
              // The watchdog's two jobs at the store's level, in its order:
              // the open, then the escalation, each by its read's own now.
              const overdue = await subject.store.overdueJourneys(LOST_CONTACT_AFTER_MS);
              const isOverdue = overdue.journeys.some(({ id }) => id === journeyId);
              expect(isOverdue, 'the overdue read').toBe(
                state === 'ACTIVE' &&
                  overdue.now.getTime() - lastContact.getTime() >= LOST_CONTACT_AFTER_MS,
              );
              if (isOverdue) {
                const opened = await subject.store.openLostContactAlert({
                  journeyId,
                  afterMs: LOST_CONTACT_AFTER_MS,
                });
                if (opened.outcome !== 'opened') {
                  throw new Error(
                    `expected the sweep to open the alert: ${JSON.stringify(opened)}`,
                  );
                }
                // One lost-contact push per responder still on the journey,
                // and none at all when nobody is (D-122, item 3).
                expect(recipientsOf(opened.messages), 'the open’s pushes').toEqual(
                  [...responders].sort(),
                );
                state = 'LOST_CONTACT';
                const openedAt =
                  (await subject.alertsOf(journeyId)).find(({ id }) => id === opened.alertId)
                    ?.openedAt ?? new Date(Number.NaN);
                model.push({
                  id: opened.alertId,
                  openedAt,
                  resolved: false,
                  acknowledgedBy: null,
                  round: 1,
                  pushedTo: [...responders],
                  texted: new Map(),
                });
              }
              const isDue = (alert: (typeof model)[number], now: Date) =>
                !alert.resolved &&
                alert.acknowledgedBy === null &&
                !alert.texted.has(alert.round) &&
                responders.length > 0 &&
                now.getTime() - alert.openedAt.getTime() >= ESCALATE_AFTER_MS;
              const read = await subject.store.alertsDueForEscalation(ESCALATE_AFTER_MS);
              const due = read.alerts
                .filter(({ id }) => model.some((alert) => alert.id === id))
                .map(({ id }) => id)
                .sort();
              expect(due, 'the alerts read as due').toEqual(
                model
                  .filter((alert) => isDue(alert, read.now))
                  .map(({ id }) => id)
                  .sort(),
              );
              for (const alertId of due) {
                const { messages } = escalated(await subject.store.escalateAlert({ alertId }));
                expect(recipientsOf(messages), 'texted').toEqual([...responders].sort());
                const alert = model.find(({ id }) => id === alertId);
                alert?.texted.set(alert.round, [...responders]);
              }
              // After the sweep, no alert is still due in its round.
              expect(
                model.filter((alert) => isDue(alert, read.now)).map(({ id }) => id),
                'due and not escalated after the sweep',
              ).toEqual([]);
            } else if (next.kind === 'time') {
              const ms = passed(next.ms);
              if (ms > 0) {
                await subject.letTimePass(ms);
              }
            } else if (next.kind === 'home') {
              const result = await subject.store.recordHome(homeOf(journey));
              if (state === 'ENDED') {
                expect(result).toEqual({ outcome: 'already_ended' });
              } else {
                expect(result.outcome, '"I’m home"').toBe('home');
                if (state === 'LOST_CONTACT' && current !== undefined) {
                  current.resolved = true;
                }
                state = 'ENDED';
              }
            } else if (next.kind === 'acknowledge') {
              const sender = people[next.who] ?? stranger;
              const result = await subject.store.recordAcknowledgement({
                alertId: current?.id ?? syntheticUuid(),
                responderId: sender,
              });
              if (current === undefined || !responders.includes(sender)) {
                expect(result, 'not a responder, or no alert').toEqual(NOT_FOUND);
              } else if (current.resolved) {
                expect(result, 'a resolved alert').toEqual(OVER);
              } else if (current.acknowledgedBy === sender) {
                expect(result, 'the sender’s own').toEqual(YOURS);
              } else if (current.acknowledgedBy !== null) {
                expect(result, 'someone else’s').toEqual(TAKEN);
              } else {
                acknowledged(result);
                current.acknowledgedBy = sender;
              }
            } else {
              const removedOne = people[next.who] ?? stranger;
              const result = await subject.store.removeResponder({
                journeyId,
                responderId: removedOne,
              });
              if (state === 'ENDED') {
                expect(result, 'a removal from an ended journey').toEqual(JOURNEY_OVER);
              } else if (!responders.includes(removedOne)) {
                expect(result, 'not a responder').toEqual(NOT_A_RESPONDER);
              } else {
                const resets =
                  current !== undefined &&
                  !current.resolved &&
                  current.acknowledgedBy === removedOne;
                responders = responders.filter((id) => id !== removedOne);
                removedOnes.add(removedOne);
                const { resetAlertId, messages } = removed(result);
                expect(resetAlertId, 'the reset').toBe(resets ? current.id : null);
                expect(
                  messages.map(({ recipientId, kind }) => ({ recipientId, kind })),
                  'the warning',
                ).toEqual(
                  responders.length === 0 ? [{ recipientId: journey.walkerId, kind: WARNING }] : [],
                );
                if (resets) {
                  current.acknowledgedBy = null;
                  current.round += 1;
                }
                if (responders.length === 0) {
                  warnings += 1;
                }
              }
            }

            // After every step.
            expect(await subject.stateOf(journeyId)).toBe(state);
            expect(await respondersOf(subject, journey), 'the responders').toEqual(
              [...responders].sort(),
            );
            const alerts = await subject.alertsOf(journeyId);
            const escalations = await subject.escalationsOf(journeyId);
            const acknowledgements = await subject.acknowledgementsOf(journeyId);
            const rounds = await subject.roundsOf(journeyId);
            const messages = await subject.messagesOf(journeyId);
            const messageRounds = await messageRoundsByIdOf(subject, journeyId);
            const withdrawnAt = await withdrawnAtOf(subject, journeyId);
            const pending = (message: MessageAsStored) =>
              message.sentAt === null && (withdrawnAt.get(message.messageId) ?? null) === null;
            expect(alerts.map(({ id }) => id).sort()).toEqual(model.map(({ id }) => id).sort());
            for (const alert of alerts) {
              const expected = model.find(({ id }) => id === alert.id);
              const by =
                acknowledgements.find(({ alertId }) => alertId === alert.id)?.acknowledgedBy ??
                null;
              const smsRaisedAt =
                escalations.find(({ alertId }) => alertId === alert.id)?.smsRaisedAt ?? null;
              const round = rounds.find(({ alertId }) => alertId === alert.id)?.round;
              expect(alert.state === 'RESOLVED', 'resolved').toBe(expected?.resolved);
              expect(by, 'who is on it').toBe(expected?.acknowledgedBy ?? null);
              expect(round, 'its round').toBe(expected?.round);
              // An unresolved alert's acknowledger is a responder of its journey.
              if (alert.state !== 'RESOLVED' && by !== null) {
                expect(responders, 'the acknowledger is a responder').toContain(by);
              }
              expect(
                smsRaisedAt !== null,
                'an escalation time exactly when escalated in this round',
              ).toBe(expected?.texted.has(expected.round));
              // At most one lost-contact push per responder, written by the
              // open: no reset and no escalation writes one.
              expect(
                recipientsOf(ofKind(messages, alert.id, 'LOST_CONTACT')),
                'the lost-contact pushes',
              ).toEqual([...(expected?.pushedTo ?? [])].sort());
              // One SMS per round it escalated in, for the responders it had
              // then; none for a round it did not escalate in.
              const sms = ofKind(messages, alert.id, SMS);
              const roundsTexted = new Set(
                sms.map(({ messageId }) => messageRounds.get(messageId)),
              );
              expect([...roundsTexted].sort(), 'the rounds with SMS').toEqual(
                [...(expected?.texted.keys() ?? [])].sort(),
              );
              for (const [textedRound, texted] of expected?.texted ?? []) {
                expect(
                  recipientsOf(
                    sms.filter(({ messageId }) => messageRounds.get(messageId) === textedRound),
                  ),
                  `round ${String(textedRound)}’s SMS`,
                ).toEqual([...texted].sort());
              }
              // Nobody on it, or over: no "someone is on it" still to send;
              // and nothing to text while someone is on it, or once it is over.
              if (alert.state === 'RESOLVED' || by === null) {
                expect(
                  ofKind(messages, alert.id, NOTICE).filter(pending),
                  'a notice still to send for an alert nobody is on',
                ).toEqual([]);
              }
              if (alert.state === 'RESOLVED' || by !== null) {
                expect(sms.filter(pending), 'an SMS still to send').toEqual([]);
              }
            }
            // No removed responder has a message of the journey's alerts
            // pending (D-122, item 2).
            expect(
              messages.filter(
                (message) => removedOnes.has(message.recipientId) && pending(message),
              ),
              'a removed responder’s message still to send',
            ).toEqual([]);
            // No two messages share an alert, a recipient, a kind and a round.
            const keys = messages.map(
              ({ messageId, alertId, recipientId, kind }) =>
                `${alertId} ${recipientId} ${kind} ${String(messageRounds.get(messageId))}`,
            );
            expect(new Set(keys).size, 'one message per alert, recipient, kind and round').toBe(
              keys.length,
            );
            // One warning for each time the last responder went.
            expect(
              (await subject.journeyMessagesOf(journeyId)).map(({ recipientId, kind }) => ({
                recipientId,
                kind,
              })),
              'the walker’s warnings',
            ).toEqual(
              Array.from({ length: warnings }, () => ({
                recipientId: journey.walkerId,
                kind: WARNING,
              })),
            );
          }
        }),
        {
          numRuns: subject.propertyRuns,
          // The spec's test plan: fixed sequences run first, so even the
          // database's few runs escalate, acknowledge, remove the
          // acknowledger, escalate again and resolve; and lose every
          // responder, warn the walker, and open with nobody to tell.
          examples: [
            [
              { kind: 'lost', openedAgoMs: 3 * MINUTE },
              [
                { kind: 'sweep' },
                { kind: 'acknowledge', who: 0 },
                { kind: 'remove', who: 0 },
                { kind: 'sweep' },
                { kind: 'acknowledge', who: 1 },
                { kind: 'remove', who: 1 },
                { kind: 'sweep' },
                { kind: 'heartbeat', agoMs: 0 },
              ],
            ],
            [
              { kind: 'active', silentForMs: 6 * MINUTE },
              [
                { kind: 'remove', who: 0 },
                { kind: 'remove', who: 3 },
                { kind: 'remove', who: 1 },
                { kind: 'remove', who: 2 },
                { kind: 'sweep' },
                { kind: 'time', ms: 3 * MINUTE },
                { kind: 'sweep' },
                { kind: 'home' },
                { kind: 'remove', who: 0 },
              ],
            ],
            [
              { kind: 'lost', openedAgoMs: MINUTE },
              [
                { kind: 'acknowledge', who: 1 },
                { kind: 'remove', who: 1 },
                { kind: 'time', ms: 2 * MINUTE },
                { kind: 'sweep' },
                { kind: 'remove', who: 0 },
                { kind: 'acknowledge', who: 2 },
                { kind: 'remove', who: 2 },
                { kind: 'sweep' },
                { kind: 'heartbeat', agoMs: 0 },
              ],
            ],
          ],
        },
      );
    },
  },
  {
    name: 'SM-10-AC17: each withdrawal — the resolution, the acknowledgement, the open, the reset, the removal — withdraws exactly its own kinds’ unsent messages, and the removal only the removed responder’s (LOST-06, LOST-07)',
    async run(subject) {
      const sortedIds = (rows: readonly { messageId: string }[]) =>
        rows.map(({ messageId }) => messageId).sort();

      // The reset and the removal, together: R1, the acknowledger, removed.
      // The reset takes the alert's unsent notices, whoever they are for;
      // the removal takes R1's unsent messages of the journey's alerts, every
      // alert kind, and of no other journey's. Then R2, nobody's acknowledger,
      // removed: the removal alone.
      {
        const now = await subject.now();
        const journey = await alerted(subject, {
          state: 'ACKNOWLEDGED',
          recorded: true,
          responders: 3,
        });
        const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
        const earlier = await subject.seedAlert({
          journeyId: journey.journeyId,
          state: 'RESOLVED',
          openedAt: ago(now, HOUR + 30 * MINUTE),
          silentSince: ago(now, HOUR + 35 * MINUTE),
          resolvedAt: ago(now, HOUR),
          resolution: 'HOME',
        });
        // Another walker's journey that R1 follows too.
        const [otherWalker = '', o2 = ''] = await users(subject, 2);
        const other = await subject.seedJourney({
          walkerId: otherWalker,
          deviceId: await subject.addDevice(otherWalker),
          state: 'LOST_CONTACT',
          responderIds: [r1, o2],
          startedAt: ago(now, HOUR),
          lastHeartbeatAt: ago(now, 10 * MINUTE),
        });
        const otherAlert = await subject.seedAlert({
          journeyId: other,
          state: 'OPEN',
          openedAt: ago(now, 5 * MINUTE),
          silentSince: ago(now, 10 * MINUTE),
        });
        const seeded = await seedEveryKind(subject, [
          { alertId: journey.alertId, unsentFor: [r1, r2], sentFor: [r3] },
          { alertId: earlier, unsentFor: [r1, r2], sentFor: [r3] },
          { alertId: otherAlert, unsentFor: [r1], sentFor: [o2] },
        ]);
        const journeysAlerts = [journey.alertId, earlier];
        const byReset = seeded.filter(
          ({ alertId, kind, unsent }) =>
            unsent && alertId === journey.alertId && WITHDRAWN_WHEN_RESET.includes(kind),
        );
        const byRemovalOf = (responderId: string) =>
          seeded.filter(
            ({ alertId, recipientId, kind, unsent }) =>
              unsent &&
              journeysAlerts.includes(alertId) &&
              recipientId === responderId &&
              WITHDRAWN_WHEN_REMOVED.includes(kind),
          );
        expect(byReset, 'one unsent notice each for R1 and R2').toHaveLength(
          2 * WITHDRAWN_WHEN_RESET.length,
        );
        expect(byRemovalOf(r1), 'every alert kind for R1, on both of J’s alerts').toHaveLength(
          2 * WITHDRAWN_WHEN_REMOVED.length,
        );
        const first = [...new Set([...sortedIds(byReset), ...sortedIds(byRemovalOf(r1))])].sort();

        const before = await subject.now();
        expect(
          removed(await subject.store.removeResponder(removal(journey, r1)), 'R1’s removal')
            .resetAlertId,
        ).toBe(journey.alertId);
        const after = await subject.now();

        let withdrawn = await withdrawnIn(subject, [journey.journeyId, other]);
        expect(sortedIds(withdrawn), 'the reset and R1’s removal').toEqual(first);
        for (const { messageId, withdrawnAt } of withdrawn) {
          expect(between(withdrawnAt, before, after), messageId).toBe(true);
        }

        const second = [...new Set([...first, ...sortedIds(byRemovalOf(r2))])].sort();
        expect(
          removed(await subject.store.removeResponder(removal(journey, r2)), 'R2’s removal')
            .resetAlertId,
        ).toBeNull();
        withdrawn = await withdrawnIn(subject, [journey.journeyId, other]);
        expect(sortedIds(withdrawn), 'R2’s removal, with no reset').toEqual(second);

        // R3, the last: the walker is warned, and R3's messages, all sent,
        // are left as they were.
        expect(
          removed(await subject.store.removeResponder(removal(journey, r3)), 'R3’s removal')
            .messages,
        ).toHaveLength(1);
        withdrawn = await withdrawnIn(subject, [journey.journeyId, other]);
        expect(sortedIds(withdrawn), 'R3’s removal, every message of theirs sent').toEqual(second);
        expect(
          (await subject.journeyMessagesOf(journey.journeyId)).map(
            ({ withdrawnAt }) => withdrawnAt,
          ),
        ).toEqual([null]);
      }

      // The resolution, the acknowledgement and the open, each on the
      // walker's next journey, beside the walker's warning on the journey
      // before it, which none of them withdraws (a journey's message).
      for (const withdrawal of ['the resolution', 'the acknowledgement', 'the open'] as const) {
        const now = await subject.now();
        const first = await watched(subject, {
          startedAt: ago(now, 5 * HOUR),
          lastHeartbeatAt: ago(now, 4 * HOUR),
          responders: 1,
        });
        removed(await subject.store.removeResponder(removal(first, first.responderIds[0] ?? '')));
        await subject.endJourney(first.journeyId);
        const [warningBefore] = await subject.journeyMessagesOf(first.journeyId);
        const next = await nextJourneyOf(subject, first, {
          state: withdrawal === 'the open' ? 'ACTIVE' : 'LOST_CONTACT',
          responders: 3,
          startedAt: ago(now, 3 * HOUR),
          lastHeartbeatAt: ago(now, withdrawal === 'the open' ? HOUR : 10 * MINUTE),
        });
        const [r1 = '', r2 = '', r3 = ''] = next.responderIds;
        const earlier = await subject.seedAlert({
          journeyId: next.journeyId,
          state: 'RESOLVED',
          openedAt: ago(now, 2 * HOUR + 30 * MINUTE),
          silentSince: ago(now, 2 * HOUR + 35 * MINUTE),
          resolvedAt: ago(now, 2 * HOUR),
          resolution: 'BACK_IN_CONTACT',
        });
        const current =
          withdrawal === 'the open'
            ? null
            : await subject.seedAlert({
                journeyId: next.journeyId,
                state: 'ESCALATED',
                openedAt: ago(now, 5 * MINUTE),
                silentSince: ago(now, 10 * MINUTE),
                smsRaisedAt: ago(now, 3 * MINUTE),
              });
        const seeded = await seedEveryKind(
          subject,
          [
            { alertId: earlier, unsentFor: [r1], sentFor: [r2] },
            ...(current === null ? [] : [{ alertId: current, unsentFor: [r1], sentFor: [r2] }]),
          ],
          // The kinds the step under test writes itself, for those it writes
          // them for: the resolution's stand-down, and R3's notices.
          (alertId, kind) =>
            alertId === current &&
            ((withdrawal === 'the resolution' && kind === 'BACK_IN_CONTACT') ||
              (withdrawal === 'the acknowledgement' && kind === NOTICE)),
        );
        const expected = seeded
          .filter(({ alertId, kind, unsent }) =>
            withdrawal === 'the open'
              ? unsent && alertId === earlier && WITHDRAWN_WHEN_OPENED.includes(kind)
              : withdrawal === 'the resolution'
                ? unsent && alertId === current && WITHDRAWN_WHEN_RESOLVED.includes(kind)
                : unsent && alertId === current && WITHDRAWN_WHEN_ACKNOWLEDGED.includes(kind),
          )
          .map(({ messageId }) => messageId)
          .sort();
        expect(expected.length, withdrawal).toBeGreaterThan(0);

        if (withdrawal === 'the resolution') {
          backInContact(
            await subject.store.recordHeartbeat(await freshHeartbeat(subject, next.journeyId)),
          );
        } else if (withdrawal === 'the acknowledgement') {
          acknowledged(
            await subject.store.recordAcknowledgement({
              alertId: current ?? '',
              responderId: r3,
            }),
          );
        } else {
          expect(
            (
              await subject.store.openLostContactAlert({
                journeyId: next.journeyId,
                afterMs: LOST_CONTACT_AFTER_MS,
              })
            ).outcome,
            withdrawal,
          ).toBe('opened');
        }

        expect(
          sortedIds(await withdrawnIn(subject, [next.journeyId, first.journeyId])),
          withdrawal,
        ).toEqual(expected);
        expect(await subject.journeyMessagesOf(first.journeyId), withdrawal).toEqual([
          warningBefore,
        ]);
      }
    },
  },
  {
    name: 'SM-10-AC10: a removal before the open, the escalation or a resolution leaves the removed responder out of what each writes; after it, it withdraws what each wrote them that is still unsent (LOST-02, LOST-03, LOST-07, SM-04)',
    async run(subject) {
      const now = await subject.now();
      const overdue = () =>
        watched(subject, {
          startedAt: ago(now, 2 * HOUR),
          lastHeartbeatAt: ago(now, HOUR),
          responders: 3,
        });
      /** R2's messages of the journey's alerts that are neither sent nor withdrawn. */
      const pendingFor = async (journeyId: string, responderId: string) => {
        const withdrawnAt = await withdrawnAtOf(subject, journeyId);
        return (await subject.messagesOf(journeyId)).filter(
          ({ messageId, recipientId, sentAt }) =>
            recipientId === responderId &&
            sentAt === null &&
            (withdrawnAt.get(messageId) ?? null) === null,
        );
      };
      /** Removes R2, and checks what it withdrew: R2's pending messages, at the removal's now. */
      const removeAfter = async (
        journey: { walkerId: string; journeyId: string },
        r2: string,
        what: string,
      ) => {
        const pending = (await pendingFor(journey.journeyId, r2)).map(({ messageId }) => messageId);
        expect(pending.length, `${what}: R2 had something pending`).toBeGreaterThan(0);
        const before = await subject.now();
        removed(await subject.store.removeResponder(removal(journey, r2)), what);
        const after = await subject.now();
        const withdrawnAt = await withdrawnAtOf(subject, journey.journeyId);
        for (const messageId of pending) {
          expect(between(withdrawnAt.get(messageId), before, after), `${what}: ${messageId}`).toBe(
            true,
          );
        }
        expect(await pendingFor(journey.journeyId, r2), what).toEqual([]);
      };

      // The open.
      {
        const journey = await overdue();
        const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
        removed(await subject.store.removeResponder(removal(journey, r2)));
        const opened = await subject.store.openLostContactAlert({
          journeyId: journey.journeyId,
          afterMs: LOST_CONTACT_AFTER_MS,
        });
        expect(opened.outcome === 'opened' ? recipientsOf(opened.messages) : opened).toEqual(
          [r1, r3].sort(),
        );
      }
      {
        const journey = await overdue();
        const [, r2 = ''] = journey.responderIds;
        const opened = await subject.store.openLostContactAlert({
          journeyId: journey.journeyId,
          afterMs: LOST_CONTACT_AFTER_MS,
        });
        expect(opened.outcome === 'opened' ? recipientsOf(opened.messages) : opened).toEqual(
          [...journey.responderIds].sort(),
        );
        await removeAfter(journey, r2, 'a removal after the open');
      }

      // The escalation.
      {
        const journey = await alerted(subject, { responders: 3 });
        const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
        removed(await subject.store.removeResponder(removal(journey, r2)));
        const { messages } = escalated(
          await subject.store.escalateAlert({ alertId: journey.alertId }),
        );
        expect(recipientsOf(messages)).toEqual([r1, r3].sort());
      }
      {
        const journey = await alerted(subject, { responders: 3 });
        const [, r2 = ''] = journey.responderIds;
        const { messages } = escalated(
          await subject.store.escalateAlert({ alertId: journey.alertId }),
        );
        expect(recipientsOf(messages)).toEqual([...journey.responderIds].sort());
        await removeAfter(journey, r2, 'a removal after the escalation');
      }

      // Contact back.
      {
        const journey = await lostWith(subject, 3);
        const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
        removed(await subject.store.removeResponder(removal(journey, r2)));
        const { messages } = backInContact(
          await subject.store.recordHeartbeat(await freshHeartbeat(subject, journey.journeyId)),
        );
        expect(recipientsOf(messages)).toEqual([r1, r3].sort());
      }
      {
        const journey = await lostWith(subject, 3);
        const [, r2 = ''] = journey.responderIds;
        // R2's lost-contact push accepted first, so what is left pending of
        // R2's after the resolution is the stand-down alone.
        const r2Push = journey.messages.find(({ recipientId }) => recipientId === r2);
        await allSent(subject, r2Push === undefined ? [] : [r2Push.messageId]);
        const { messages } = backInContact(
          await subject.store.recordHeartbeat(await freshHeartbeat(subject, journey.journeyId)),
        );
        expect(recipientsOf(messages)).toEqual([...journey.responderIds].sort());
        await removeAfter(journey, r2, 'a removal after contact came back');
      }

      // "I'm home".
      {
        const journey = await lostWith(subject, 3);
        const [r1 = '', r2 = '', r3 = ''] = journey.responderIds;
        removed(await subject.store.removeResponder(removal(journey, r2)));
        const { messages } = endedHome(await subject.store.recordHome(homeOf(journey)));
        expect(recipientsOf(messages)).toEqual([r1, r3].sort());
      }
      {
        // After "I'm home" the journey has ENDED, so a removal is ignored
        // (SM-07, the spec's reading 2) and R2's stand-down is left to be
        // sent: there is no removal to withdraw it.
        const journey = await lostWith(subject, 3);
        const [, r2 = ''] = journey.responderIds;
        const { messages } = endedHome(await subject.store.recordHome(homeOf(journey)));
        expect(recipientsOf(messages)).toEqual([...journey.responderIds].sort());
        const before = await removalRecordOf(subject, journey);
        expect(await subject.store.removeResponder(removal(journey, r2))).toEqual(JOURNEY_OVER);
        expect(await removalRecordOf(subject, journey)).toEqual(before);
      }
    },
  },
];
