/**
 * The ports: what the server needs from the outside world, as interfaces
 * (AR-02).
 *
 * They live here rather than in adapters/ so that modules can depend on the
 * shape without depending on the implementation, and so that the test kit can
 * satisfy them structurally without importing any server code.
 */
import type {
  AcknowledgeOutcome,
  AlertForAcknowledgement,
  JourneyForHeartbeat,
  JourneyState,
  MessageKind,
  PushFailureReason,
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
   * of it. Every open bounds its waits with a lock limit of its own, local to
   * its transaction: `lockWaitMs`, or LOCK_WAIT_LIMIT_MS without it. Without
   * `lockWaitMs` a held row is skipped (`skip locked`) and `held` is never
   * answered; with it, the open waits at most that long for the journey's
   * row, and answers `held` when that wait runs out. Rejects, having written
   * nothing, on any other failure: a wait for any other lock that ran out
   * (55P03), or a journey with no responder. Rejects before taking any lock
   * when `lockWaitMs` is given and is not a whole number from 1 to
   * 2147483647: PostgreSQL reads 0 as no limit.
   */
  openLostContactAlert(request: OpenRequest): Promise<OpenLostContactAlertResult>;
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
   * Rejects a start with no responders, and stores nothing.
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
  | { event: 'acknowledgement_failed'; stage: 'read' | 'store'; code: string | null };

/** Where the server writes what happened, one event at a time. */
export interface Log {
  write(event: LogEvent): void;
}
