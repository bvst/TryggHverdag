/**
 * The ports: what the server needs from the outside world, as interfaces
 * (AR-02).
 *
 * They live here rather than in adapters/ so that modules can depend on the
 * shape without depending on the implementation, and so that the test kit can
 * satisfy them structurally without importing any server code.
 */
import type { CanaryOutcome } from './domain/canary.ts';
import type {
  AcknowledgeOutcome,
  AlertForAcknowledgement,
  AlertForClosure,
  AlertResolution,
  AlertState,
  CloseRefusal,
  JourneyEndReason,
  JourneyForHeartbeat,
  JourneyForRemoval,
  JourneyState,
  MessageKind,
  PushFailureReason,
  RemoveOutcome,
  UnendedJourney,
  UnendedJourneyState,
} from './domain/journey.ts';

/** The domain's lists, as the types the ports are written in. */
export type { MessageKind, PushFailureReason };

/**
 * The time, from the database (REL-01).
 *
 * Asynchronous on purpose. A synchronous clock would be one `Date.now()` away
 * from every process using its own slightly different time, and a safety
 * decision made on a server whose clock drifted is a safety decision made on
 * the wrong minute. Async keeps the database as the single source of now.
 */
export interface Clock {
  now(): Promise<Date>;
}

/** The worker's periodic "I am still here". */
export interface WorkerHeartbeats {
  /** The last check-in, or null when the worker has never run. */
  lastBeat(): Promise<Date | null>;
  record(at: Date): Promise<void>;
}

/**
 * The worker's "I am still here", told to an outside monitor (INF-08). The
 * monitor pages the owner when these stop, so it must only ever follow a
 * fresh beat: one a sweep recorded at most BEAT_FRESH_MS ago.
 */
export interface CheckIn {
  /**
   * Resolves when the monitor accepted it; rejects on anything else, and as
   * soon as `signal` aborts, so a stop never waits for a monitor that does
   * not answer (D-079).
   */
  checkIn(signal?: AbortSignal): Promise<void>;
}

/**
 * The SMS check's report, told to an outside monitor of its own (LOST-07,
 * D-115): `ok` while no escalation SMS is failing and no alert is unheard,
 * `failing` while any is (SM-10, D-122 item 3: an unresolved alert whose
 * journey has no responder left to tell). The monitor pages the owner on a
 * failing report, and when the reports stop.
 */
export interface SmsAlarm {
  /**
   * Resolves when the monitor accepted it; rejects on anything else, and as
   * soon as `signal` aborts, so a stop never waits for a monitor that does
   * not answer.
   */
  report(status: 'ok' | 'failing', signal?: AbortSignal): Promise<void>;
}

/** Who a device credential belongs to. */
export interface AuthenticatedDevice {
  deviceId: string;
  userId: string;
}

/**
 * Which device sent a request (SEC-07).
 *
 * Three answers, kept apart on purpose: the device, `null` for a credential no
 * device has, and a rejection when it cannot check at all. The API answers the
 * second with 401 and the third with 500, because a 401 tells an app its
 * credential is bad, and a database that blinked must never sign a walker out.
 */
export interface DeviceAuthenticator {
  authenticate(credential: string): Promise<AuthenticatedDevice | null>;
}

/** A start to be stored: the domain's decision, timed by the clock. */
export interface StartedJourney {
  walkerId: string;
  /** The device that sent the start: the only one whose heartbeats the journey takes (D-101). */
  deviceId: string;
  /** Distinct, and at least one: the domain refuses anything else. */
  responderIds: readonly string[];
  startedAt: Date;
}

/** Stored, or refused because the walker already has an unended journey. */
export type InsertStartedResult =
  { inserted: true; journeyId: string } | { inserted: false; unendedJourneyId: string };

/** A position as the phone recorded it. Its time is the phone's: a label, never a decision (REL-01). */
export interface HeartbeatPosition {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  recordedAt: Date;
}

/** A heartbeat to be stored, timed by the clock as it arrived (SM-09). */
export interface HeartbeatToRecord {
  journeyId: string;
  eventId: string;
  receivedAt: Date;
  /** From 0 to 1, or null for unknown. */
  batteryLevel: number | null;
  position: HeartbeatPosition | null;
}

/**
 * Stored; already there, so nothing changed (SM-08); or the journey had ENDED
 * by the time it was written, so nothing was stored (SM-07). Or stored, and
 * the journey, LOST_CONTACT when its row was taken, is back in contact
 * (LOST-03): the alert it resolved, null when it found none unresolved, and
 * the stand-downs it wrote, one per responder.
 */
export type RecordHeartbeatResult =
  | { outcome: 'recorded' | 'duplicate' | 'ended' }
  | { outcome: 'back_in_contact'; alertId: string | null; messages: AlertMessage[] };

/**
 * "I'm home" as the store takes it (D-110): the journey, and the walker and
 * the device the domain's home rule is asked with under the row's lock.
 */
export interface HomeToRecord {
  journeyId: string;
  walkerId: string;
  deviceId: string;
}

/**
 * "I'm home" (D-110): ended now, from the state the journey's row was in when
 * taken, with the alert it resolved, null when none, and the stand-downs it
 * wrote; or the journey had already ENDED, and nothing changed. Named
 * `already_ended`, not `ended`: on the "I'm home" path `ended` means "ended
 * now", in the domain and the module alike.
 */
export type RecordHomeResult =
  | {
      outcome: 'home';
      from: UnendedJourneyState;
      alertId: string | null;
      messages: AlertMessage[];
    }
  | { outcome: 'already_ended' };

/**
 * A journey's latest heartbeat: the greatest receive time, a tie to the one
 * stored last. No coordinates: "location unavailable" is `!hasPosition`.
 */
export interface LatestHeartbeat {
  receivedAt: Date;
  hasPosition: boolean;
  batteryLevel: number | null;
}

/** An ACTIVE journey the watchdog found silent, and when its silence began, in database time. */
export interface OverdueJourney {
  id: string;
  state: JourneyState;
  silentSince: Date;
}

/** The overdue journeys, and the database's now() from the same statement: there even when none is. */
export interface OverdueJourneys {
  now: Date;
  journeys: OverdueJourney[];
}

/** An open as the watchdog asks for it: with `lockWaitMs`, it waits that long for a held row. */
export interface OpenRequest {
  journeyId: string;
  afterMs: number;
  /** How long to wait for a held row; undefined, or left out, skips it. */
  lockWaitMs?: number | undefined;
}

/** A message an alert's opening wrote: an opaque ID of its own, who it is for, and what kind. */
export interface AlertMessage {
  messageId: string;
  recipientId: string;
  kind: MessageKind;
}

/**
 * Opened: the journey moved to LOST_CONTACT, with its alert and one message
 * per responder. Skipped: nothing written, because the row was held (without
 * a wait), or the journey was no longer ACTIVE and overdue. Held: an open
 * that waited for the row ran out of wait (55P03), and nothing was written.
 */
export type OpenLostContactAlertResult =
  | { outcome: 'opened'; alertId: string; messages: AlertMessage[] }
  | { outcome: 'skipped' }
  | { outcome: 'held' };

/**
 * An alert the escalation's read found due (LOST-07): what the escalation rule
 * reads, its journey, and when it opened, in database time.
 */
export interface DueAlert {
  id: string;
  journeyId: string;
  state: AlertState;
  acknowledgedBy: string | null;
  smsRaisedAt: Date | null;
  openedAt: Date;
}

/** The alerts due for escalation, and the database's now() from the same statement: there even when none is. */
export interface DueAlerts {
  now: Date;
  alerts: DueAlert[];
}

/**
 * An escalation as the watchdog asks for it: with `lockWaitMs`, it waits that
 * long for a held row. No threshold: the store decides by the domain's
 * ESCALATE_AFTER_MS, so no caller can choose another (D-100, D-116).
 */
export interface EscalateRequest {
  alertId: string;
  /** How long to wait for a held row; undefined, or left out, skips it. */
  lockWaitMs?: number | undefined;
}

/**
 * Escalated: the alert ESCALATED, with one LOST_CONTACT_SMS per responder.
 * Skipped: nothing written, because the row was held (without a wait), or the
 * alert was no longer due under the journey's row. Held: an escalation that
 * waited for the row ran out of wait (55P03), and nothing was written.
 */
export type EscalateAlertResult =
  { outcome: 'escalated'; messages: AlertMessage[] } | { outcome: 'skipped' } | { outcome: 'held' };

/**
 * An alert the 24-hour end's read found due (LOST-08, SM-06): its journey, the
 * journey's state as read, and when the alert opened, in database time.
 */
export interface ExpiringAlert {
  id: string;
  journeyId: string;
  journeyState: JourneyState;
  openedAt: Date;
}

/** The alerts due for their 24-hour end, and the database's now() from the same statement: there even when none is. */
export interface ExpiringAlerts {
  now: Date;
  alerts: ExpiringAlert[];
}

/**
 * A 24-hour end as the watchdog asks for it: with `lockWaitMs`, it waits that
 * long for a held row. No threshold: the store decides by the domain's
 * ALERT_EXPIRES_AFTER_MS, so no caller can choose another (D-116's reading).
 */
export interface ExpireRequest {
  alertId: string;
  /** How long to wait for a held row; undefined, or left out, skips it. */
  lockWaitMs?: number | undefined;
}

/**
 * Expired: the journey ENDED (EXPIRED) and its alert RESOLVED (EXPIRED), with
 * one EXPIRED stand-down per responder row. Skipped: nothing written, because
 * the row was held (without a wait), or the alert was no longer due under the
 * journey's row. Held: an expiry that waited for the row ran out of wait
 * (55P03), and nothing was written.
 */
export type ExpireAlertResult =
  { outcome: 'expired'; messages: AlertMessage[] } | { outcome: 'skipped' } | { outcome: 'held' };

/** What the watchdog needs of the journeys (LOST-02, AR-06). */
export interface WatchdogStore {
  /**
   * The ACTIVE journeys silent for `afterMs` or more by the database's now(),
   * counted from last contact or from the start, read without locking, and
   * that now().
   */
  overdueJourneys(afterMs: number): Promise<OverdueJourneys>;
  /**
   * In one transaction: takes the journey's row if it is still ACTIVE and
   * overdue, moves it to LOST_CONTACT, withdraws the unsent stand-downs
   * (BACK_IN_CONTACT, HOME) of every alert of the walker's journeys, and of no
   * other walker's, whose recipient is a responder of this journey (LOST-03),
   * opens its alert and writes one message per responder, all of it or none
   * of it. A journey with no responder row is opened all the same, with no
   * message: its alert is counted unheard (`unheardAlertCount`, SM-10, D-122
   * item 3). Every open bounds its waits with a lock limit of its own, local
   * to its transaction: `lockWaitMs`, or LOCK_WAIT_LIMIT_MS without it.
   * Without `lockWaitMs` a held row is skipped (`skip locked`) and `held` is
   * never answered; with it, the open waits at most that long for the
   * journey's row, and answers `held` when that wait runs out. Rejects,
   * having written nothing, on any other failure, such as a wait for any
   * other lock that ran out (55P03). Rejects before taking any lock when
   * `lockWaitMs` is given and is not a whole number from 1 to 2147483647:
   * PostgreSQL reads 0 as no limit.
   */
  openLostContactAlert(request: OpenRequest): Promise<OpenLostContactAlertResult>;
  /**
   * LOST-07: every alert unresolved, not escalated in its round, not
   * acknowledged in D-114's sense (state ACKNOWLEDGED and someone recorded),
   * opened `afterMs` or more before the database's now(), and whose journey
   * has a responder row (SM-10: one with none is unheard, and counted
   * instead), read without locking, and that now().
   */
  alertsDueForEscalation(afterMs: number): Promise<DueAlerts>;
  /**
   * LOST-07, in one transaction: takes the alert's journey's row first
   * (D-112), asks the domain's escalation rule again under that lock with the
   * transaction's now() and its two minutes, ESCALATE_AFTER_MS (AR-04), and
   * writes what it decides: the alert
   * ESCALATED with its escalation time at now(), and one LOST_CONTACT_SMS per
   * responder row, in the alert's round, due at now() (AR-05); or nothing. A
   * journey with no responder row under the lock is skipped, writing nothing
   * (SM-10, D-122 item 3). Bounds its waits as an open does: `lockWaitMs`,
   * or LOCK_WAIT_LIMIT_MS without it; without `lockWaitMs` a held row is
   * skipped, with it the escalation waits at most that long for the
   * journey's row and answers `held` when that wait runs out. Rejects,
   * having written nothing, on any other failure; and before taking any lock
   * when `lockWaitMs` is given and is not a whole number from 1 to
   * 2147483647.
   */
  escalateAlert(request: EscalateRequest): Promise<EscalateAlertResult>;
  /**
   * LOST-08, SM-06: every unresolved alert opened ALERT_EXPIRES_AFTER_MS or
   * more before the database's now(), whatever its state and whether its
   * journey has a responder row, with its journey and the journey's state,
   * read without locking, and that now(). No threshold is passed in.
   */
  alertsDueForExpiry(): Promise<ExpiringAlerts>;
  /**
   * LOST-08, SM-06, in one transaction: takes the alert's journey's row first
   * (D-112); under that lock reads the journey's state, its one unresolved
   * alert and that alert's opening, and the transaction's now(); skips,
   * writing nothing, when that alert is not the one named (resolved since
   * the read) or the domain's 24-hour rule leaves the journey unchanged
   * (AR-04). Otherwise the journey ENDED, EXPIRED, at now(), and its alert
   * resolved EXPIRED, with one EXPIRED stand-down per responder row, the
   * acknowledger's included, none when there is no row (AR-05). Bounds its
   * waits as an escalation does: `lockWaitMs`, or LOCK_WAIT_LIMIT_MS without
   * it; without `lockWaitMs` a held row is skipped, with it the expiry waits
   * at most that long for the journey's row and answers `held` when that
   * wait runs out. Rejects, having written nothing, on any other failure; and
   * before taking any lock when `lockWaitMs` is given and is not a whole
   * number from 1 to 2147483647.
   */
  expireAlert(request: ExpireRequest): Promise<ExpireAlertResult>;
}

/** A message as a claim hands it out: what the push needs, and how many attempts it has had, this one included. */
export interface ClaimedMessage extends AlertMessage {
  attempts: number;
}

/** The messages a claim took, and the database's now() from the same statement. */
export interface ClaimedMessages {
  now: Date;
  messages: ClaimedMessage[];
}

/** What the sender needs of the outbox (LOST-02, AR-05). */
export interface OutboxStore {
  /**
   * In one statement: at most `limit` due messages (not sent, and due at or
   * before now()), skipping any another claim holds, each with one attempt
   * more and leased until now() plus `leaseMs`.
   */
  claimDue(request: { limit: number; leaseMs: number }): Promise<ClaimedMessages>;
  /**
   * LOST-07: as `claimDue`, for the SMS kinds only (`SMS_KINDS`), with the same
   * limit, lease, attempt count and order. `claimDue` takes the push kinds
   * only (`PUSH_KINDS`), so no message ever reaches the other channel's port.
   */
  claimDueSms(request: { limit: number; leaseMs: number }): Promise<ClaimedMessages>;
  /**
   * LOST-07: how many SMS messages are unsent, not withdrawn, and were written
   * `olderThanMs` or more before the database's now(); and that now().
   */
  unsentSmsCount(olderThanMs: number): Promise<{ now: Date; count: number }>;
  /**
   * SM-10 (D-122, item 3): how many unresolved alerts have a journey with no
   * responder row, so nobody can be told of them; and the database's now(),
   * from the same statement.
   */
  unheardAlertCount(): Promise<{ now: Date; count: number }>;
  /** The port accepted it: sent at now(). */
  markSent(messageId: string): Promise<void>;
  /** The port did not accept it: this reason, and due again `retryAfterMs` after now(). */
  markFailed(request: {
    messageId: string;
    reason: PushFailureReason;
    retryAfterMs: number;
  }): Promise<void>;
}

/**
 * A message as the push port takes it, and nothing more: no name, journey,
 * position, battery or time (D-086). `messageId` is opaque and new for each
 * message, never a person's, a journey's or an alert's ID (D-087), and is
 * what the platform collapses a resend by. `recipientId` is for the adapter
 * to find the device; it is never sent to Apple or Google.
 */
export type PushMessage = AlertMessage;

/** Why one message was not accepted. */
export interface PushFailure {
  outcome: 'failed';
  reason: PushFailureReason;
}

/** Accepted, or not, and why. Only `accepted` ever counts as sent. */
export type PushResult = { outcome: 'accepted' } | PushFailure;

/** The push notification port: APNs and FCM in M3, a recording fake in tests. */
export interface Push {
  /** Answers; a rejection counts as UNAVAILABLE. */
  send(message: PushMessage): Promise<PushResult>;
}

/**
 * A message as the SMS port takes it, and nothing more, as the push port
 * takes one (D-086, LOST-07): no text, no name, no number and no location.
 * The text and the number it goes to are the M3 adapter's to find, by the
 * recipient's ID (D-115).
 */
export type SmsMessage = AlertMessage;

/**
 * Accepted, or not, and why: the push port's four reasons, so the outbox's
 * check and the log take one list. `NO_TARGET` is "no confirmed number".
 */
export type SmsResult = PushResult;

/** The SMS port: LINK Mobility in M3 (D-086), a recording fake in tests. */
export interface Sms {
  /** Answers; a rejection counts as UNAVAILABLE. */
  send(message: SmsMessage): Promise<SmsResult>;
}

/** Journeys, their responders, their heartbeats, and the users all of them must be (SM-01, LOST-01). */
export interface JourneyStore {
  /** The walker's journey in any state but ENDED, or null. */
  unendedJourneyOf(walkerId: string): Promise<UnendedJourney | null>;
  /** Which of these IDs are users. */
  existingUsers(ids: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * Stores the journey ACTIVE with its responders, all of it or none of it.
   * When the walker already has an unended journey, as when two starts race
   * past `unendedJourneyOf`, nothing is stored and that journey is named.
   * When the journey it met has ended by the time it reads which one won (a
   * close or the 24-hour end, from outside the walker's phone), the insert is
   * tried once more; the same race a second time rejects, storing nothing
   * (LOST-08). Rejects a start with no responders, and stores nothing.
   */
  insertStarted(journey: StartedJourney): Promise<InsertStartedResult>;
  /** The journey this ID names, in any state, ENDED included, or null. */
  journeyForHeartbeat(journeyId: string): Promise<JourneyForHeartbeat | null>;
  /**
   * Stores the heartbeat and its position, if any, once per (journey, event
   * ID), and moves last contact forward to its receive time, never back: all
   * of it or none of it. A duplicate changes nothing, last contact included,
   * and a journey ENDED by the time of the write takes nothing. A journey
   * LOST_CONTACT when its row is taken, whose silence counted with this
   * heartbeat is under five minutes by the database's now(), is brought back
   * to ACTIVE in the same transaction: its alert resolved, its unsent
   * lost-contact messages withdrawn, and one stand-down per responder written
   * (LOST-03, AR-05).
   */
  recordHeartbeat(heartbeat: HeartbeatToRecord): Promise<RecordHeartbeatResult>;
  /**
   * "I'm home" (D-110), in one transaction, deciding by the domain's home rule
   * asked under the journey's row lock with this walker and device (AR-04):
   * ends the journey, HOME, at the database's now(), from the state its row is
   * in when taken, and from LOST_CONTACT resolves its alert as a heartbeat
   * that brings it back does (SM-04). A journey already ENDED is answered
   * `already_ended`, and nothing changes. A refusal under the lock (no such
   * journey, another walker's, or another device) rejects, writing nothing:
   * the module asked the same rule first, so it cannot happen.
   */
  recordHome(home: HomeToRecord): Promise<RecordHomeResult>;
  /** The journey's latest heartbeat, or null when it has none. */
  latestHeartbeatOf(journeyId: string): Promise<LatestHeartbeat | null>;
}

/** "I'm on it" as the store takes it (LOST-06): the alert, by its ID, and the responder who sent it. */
export interface AcknowledgementToRecord {
  alertId: string;
  responderId: string;
}

/**
 * Recorded now, with the notices it wrote, one per other responder; or not
 * recorded, with the alert rule's other outcome under the journey's lock, and
 * nothing written.
 */
export type RecordAcknowledgementResult =
  | { outcome: 'acknowledged'; messages: AlertMessage[] }
  | {
      outcome: 'not_recorded';
      decision: Exclude<AcknowledgeOutcome, { type: 'acknowledged' }>;
    };

/** What "I'm on it" needs of the alerts (LOST-06, D-114). */
export interface AlertStore {
  /**
   * The alert this ID names, with who is recorded on it and its journey's
   * responders, read without a lock; or null when no alert has that ID.
   */
  alertForAcknowledgement(alertId: string): Promise<AlertForAcknowledgement | null>;
  /**
   * In one transaction: takes the alert's journey's row first (D-112), asks
   * the domain's alert rule again under that lock (AR-04), and writes what it
   * decides: the alert ACKNOWLEDGED, by this responder at the database's
   * now(), and one ACKNOWLEDGED message per other responder row (AR-05); or
   * nothing, with the rule's other outcome. Rejects, having written nothing,
   * on any failure.
   */
  recordAcknowledgement(
    acknowledgement: AcknowledgementToRecord,
  ): Promise<RecordAcknowledgementResult>;
}

/** "They're safe" as the store takes it (LOST-08): the alert, by its ID, and the responder who sent it. */
export interface ClosureToRecord {
  alertId: string;
  responderId: string;
}

/**
 * Closed now, with the stand-downs it wrote, one per responder row but the
 * closer's; or not closed, with the close rule's other outcome under the
 * journey's lock, and nothing written.
 */
export type RecordClosureResult =
  | { outcome: 'closed'; messages: AlertMessage[] }
  | { outcome: 'not_closed'; decision: CloseRefusal };

/** What "They're safe" needs of the alerts (LOST-08, D-126). */
export interface ClosureStore {
  /**
   * The alert this ID names, with who is recorded on it and its journey's
   * responders, read without a lock; or null when no alert has that ID. "I'm
   * on it"'s read.
   */
  alertForClosure(alertId: string): Promise<AlertForClosure | null>;
  /**
   * In one transaction: takes the alert's journey's row first (D-112), waiting
   * for it, asks the domain's close rule again under that lock (AR-04), and
   * writes what it decides, all of it or none of it (AR-05), at the database's
   * now(): the journey ENDED, SAFE; the alert RESOLVED, SAFE, its unsent
   * WITHDRAWN_WHEN_RESOLVED kinds withdrawn, and one SAFE stand-down per
   * responder row but the closer's. Or nothing, with the rule's other outcome.
   * Rejects, having written nothing, on any failure.
   */
  recordClosure(closure: ClosureToRecord): Promise<RecordClosureResult>;
}

/** A removal as the store takes it (SM-10): the journey, and the responder to remove from it. */
export interface RemovalToRecord {
  journeyId: string;
  responderId: string;
}

/**
 * Removed now, with the alert it reset, null when it reset none, and the
 * walker's warning when it was the last responder (SM-02); or not removed,
 * with the removal rule's other outcome under the journey's lock, and nothing
 * written.
 */
export type RemoveResponderResult =
  | { outcome: 'removed'; resetAlertId: string | null; messages: AlertMessage[] }
  | { outcome: 'not_removed'; decision: Exclude<RemoveOutcome, { type: 'removed' }> };

/** What removing a responder needs of the journeys (SM-10, D-122, D-123). */
export interface ResponderStore {
  /**
   * The journey this ID names, in any state, with its responder rows, read
   * without a lock; or null when no journey has that ID.
   */
  journeyForRemoval(journeyId: string): Promise<JourneyForRemoval | null>;
  /**
   * In one transaction, with a lock limit of its own (LOCK_WAIT_LIMIT_MS),
   * whichever pool runs it: takes the journey's row first (D-112), asks the
   * domain's removal rule again under that lock (AR-04), and writes what it
   * decides, all of it or none of it (AR-05), at the database's now(): the
   * responder's row deleted; the journey's unresolved alert they are recorded
   * on reset to OPEN, nobody recorded, no escalation time, its round raised,
   * and its unsent notices withdrawn; their unsent messages of the journey's
   * alerts withdrawn, whatever the kind (D-122, item 2); and, when no
   * responder is left, one NO_RESPONDER to the walker. Or nothing, with the
   * rule's other outcome. Rejects, having written nothing, on any failure.
   */
  removeResponder(removal: RemovalToRecord): Promise<RemoveResponderResult>;
}

/**
 * The canary's read of one of its journeys (REL-10, D-128): the statement's
 * now(), and what the canary decides on, each time the row's own. `alert` is
 * the journey's latest; the two answers are the push port's (a send, or a
 * failure with its reason) to the canary's responder's lost-contact message
 * and "is home" stand-down of that alert; `smsWritten` counts the alert's
 * escalation SMS, whatever became of them.
 */
export interface CanaryObservation {
  now: Date;
  journey: {
    state: JourneyState;
    startedAt: Date;
    lastHeartbeatAt: Date | null;
    endReason: JourneyEndReason | null;
  };
  alert: {
    id: string;
    openedAt: Date;
    state: AlertState;
    resolution: AlertResolution | null;
    resolvedAt: Date | null;
  } | null;
  lostContactAnswered: boolean;
  standDownAnswered: boolean;
  smsWritten: number;
}

/**
 * The canary's own way into the database (REL-10, D-128): its registration,
 * the one insert of a device credential before the login task (D-091 as
 * D-128 amends it), and its read. Everything else it does goes through the
 * public API. Only the worker reaches the adapter (an import rule).
 */
export interface CanaryStore {
  /**
   * In one transaction: the canary's walker and responder made users if
   * absent, and the walker's one device stored with this hash, or its hash
   * replaced. Rejects, writing nothing, when a device with the canary's ID
   * belongs to anyone else, or another device holds the hash.
   */
  registerCanary(request: { credentialHash: string }): Promise<void>;
  /** One plain read at the statement's now(): no lock, no write. Null for any journey not the canary walker's. */
  observeCanaryJourney(journeyId: string): Promise<CanaryObservation | null>;
}

/**
 * One request of the canary's client: the route's answer, or the HTTP status
 * it came with (null when there was none: a network failure, a timeout).
 * `code` is a SQLSTATE or null, as a log line's is.
 */
export type CanaryCall<T> =
  { ok: true; value: T } | { ok: false; status: number | null; code: string | null };

/**
 * The canary's client of the public API, with the canary device's own
 * credential, as a phone would call it. Never rejects: every failure is a
 * result. A start refused because the walker has an unended journey names it.
 */
export interface CanaryClient {
  start(): Promise<
    CanaryCall<{ journeyId: string }> | { ok: false; status: 409; journeyId: string }
  >;
  heartbeat(journeyId: string): Promise<CanaryCall<null>>;
  home(journeyId: string): Promise<CanaryCall<null>>;
}

/**
 * The canary's report, told to an outside monitor of its own (REL-10, A-34):
 * `ok` after a run on time, `failing` after any other reported outcome, which
 * pages at once. Rejects on anything but the monitor's acceptance, and as
 * soon as `signal` aborts.
 */
export interface CanaryAlarm {
  report(status: 'ok' | 'failing', signal?: AbortSignal): Promise<void>;
}

/**
 * A wait of `ms`, which rejects as soon as `signal` aborts. The canary keeps
 * no time of its own: it decides on the database's times, and waits on this.
 */
export type Wait = (ms: number, signal: AbortSignal) => Promise<void>;

/**
 * Every line the server may log, and nothing else (PRIV-07). A closed union:
 * no event has a field a location, a phone number or an error's message
 * could travel in. `code` is a SQLSTATE or null, never a message.
 */
export type LogEvent =
  | { event: 'heartbeat_ignored'; reason: 'JOURNEY_ENDED'; journeyId: string }
  | { event: 'heartbeat_failed'; stage: 'clock' | 'read' | 'store'; code: string | null }
  | { event: 'watchdog_failed'; stage: 'read' | 'open' | 'beat'; code: string | null }
  | { event: 'watchdog_overdue'; journeyId: string }
  | { event: 'push_failed'; reason: PushFailureReason; messageId: string }
  | { event: 'delivery_failed'; stage: 'claim' | 'mark'; code: string | null }
  | { event: 'database_error'; pool: 'api' | 'worker'; code: string | null }
  | { event: 'home_ignored'; reason: 'JOURNEY_ENDED'; journeyId: string }
  | { event: 'home_failed'; stage: 'read' | 'store'; code: string | null }
  | { event: 'alert_missing'; journeyId: string }
  | { event: 'acknowledgement_ignored'; reason: 'ALERT_RESOLVED'; alertId: string }
  | { event: 'acknowledgement_failed'; stage: 'read' | 'store'; code: string | null }
  | { event: 'escalation_failed'; stage: 'read' | 'escalate'; code: string | null }
  | { event: 'escalation_overdue'; alertId: string }
  | { event: 'sms_failed'; reason: PushFailureReason; messageId: string }
  | { event: 'sms_delivery_failed'; stage: 'claim' | 'mark'; code: string | null }
  | { event: 'sms_unsent'; count: number }
  | { event: 'sms_check_failed'; stage: 'read' | 'report'; code: string | null }
  | { event: 'removal_ignored'; reason: 'JOURNEY_ENDED'; journeyId: string }
  | { event: 'removal_failed'; stage: 'read' | 'store'; code: string | null }
  | { event: 'unheard_alerts'; count: number }
  | { event: 'closure_ignored'; reason: 'ALERT_RESOLVED'; alertId: string }
  | { event: 'closure_failed'; stage: 'read' | 'store'; code: string | null }
  | { event: 'expiry_failed'; stage: 'read' | 'expire'; code: string | null }
  | { event: 'expiry_overdue'; alertId: string }
  | {
      event: 'canary_run';
      outcome: CanaryOutcome;
      alertMs: number | null;
      openedAfterMs: number | null;
      status: number | null;
      code: string | null;
    }
  | { event: 'canary_skipped'; reason: 'RUN_IN_FLIGHT' }
  | { event: 'canary_leftover_ended'; journeyId: string }
  | { event: 'canary_report_failed' };

/** Where the server writes what happened, one event at a time. */
export interface Log {
  write(event: LogEvent): void;
}
