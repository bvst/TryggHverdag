/**
 * Journeys, in memory (SM-01, LOST-01, AR-02).
 *
 * Stands in for the adapter over the `journeys`, `journey_responders`,
 * `heartbeats`, `positions`, `devices` and `users` tables, so a system test
 * can put a walker in any situation — including the ones nothing in the code
 * can reach yet, such as a journey in LOST_CONTACT or one that has ENDED — and
 * then look at exactly what was stored.
 *
 * It keeps the database's rules, because a fake that was more forgiving than
 * the database would let the system tests prove the fake (D-100):
 *   - one unended journey per walker, as the partial unique index does: a
 *     second start is "not inserted" and names the journey already there;
 *   - a walker and every responder must be users, and a journey's device a
 *     device, as the foreign keys do: a start that names anyone or anything
 *     else is refused whole, and leaves nothing;
 *   - a start's journey and its responders are stored together or not at all,
 *     so a start with no responders is refused, not stored as a journey with
 *     nobody to alert;
 *   - a journey records the device that started it, and it is never empty
 *     (D-101: `device_id` is not null);
 *   - a heartbeat is stored whole or not at all, once per (journey, event ID),
 *     with the event ID compared exactly, case and all; a heartbeat for an
 *     ENDED journey is answered `ended` and stores nothing; a heartbeat, a
 *     battery level or a position outside the contract's rules is refused, as
 *     the check constraints refuse it, and so is a phone time outside the
 *     years 0001 to 9999 in UTC, as `timestamptz` refuses it; last contact
 *     never moves backwards;
 *   - IDs are UUIDs, matched as PostgreSQL's `uuid` type matches them: the
 *     same ID in upper or lower case is one ID, and every ID the fake holds
 *     or hands back is lower-case, as the database returns it.
 *
 * And for the watchdog and the outbox (LOST-02), `alerts` and `outbox`:
 *   - silence is measured on the clock the fake is given, which stands in for
 *     the database's `now()`. A fake given no clock throws when asked about
 *     silence or delivery: a fake that guessed the time would prove nothing;
 *   - an overdue journey is ACTIVE and silent for the threshold or more,
 *     counted from last contact, or from its start when it has none;
 *   - opening an alert checks all of that again, and skips a journey that is
 *     no longer overdue, no longer ACTIVE, not there, or held by another
 *     transaction (`hold`, as `for update skip locked` skips it). A held row
 *     that no longer matches is skipped at once by either kind of open, as
 *     PostgreSQL never locks it. An open given a `lockWaitMs` waits for a
 *     held row that still matches instead: a row held by `hold`
 *     never lets go, so the open answers `held`, as a lock wait that runs out
 *     does (55P03); a row held by `holdUntilWaited` is let go, after the
 *     holder's own action, and the open then checks it as it stands. Otherwise
 *     it moves the journey to LOST_CONTACT, opens one OPEN alert at now with
 *     the silence's start, and writes one LOST_CONTACT message per responder,
 *     each with a fresh ID, all of it or none of it. A journey with no
 *     responder is refused, and left as it was;
 *   - one alert per journey that is not RESOLVED, and one message per
 *     (alert, recipient, kind), as the unique indexes hold them;
 *   - a claim takes at most its limit of the due messages (not sent, not
 *     withdrawn, and due at or before now), counts one attempt on each, and
 *     leases them until now plus the lease; a message is marked sent at now,
 *     or failed with one of the push port's reasons and due again after the
 *     delay given. A reason outside that set is refused, as the check
 *     constraint refuses it;
 *   - a heartbeat for a journey another transaction holds waits until it is
 *     released, as a row lock with no limit makes it wait.
 *
 * And for back in contact and "I'm home" (LOST-03, its spec's approach items
 * 3, 4, 5 and 9):
 *   - a stored heartbeat, not a duplicate, for a journey that was
 *     LOST_CONTACT when its row was taken asks whether contact is back: the
 *     journey's silence, counted with this heartbeat, from its last contact
 *     to the store's now. Under five minutes, the journey moves back to
 *     ACTIVE and its alert is resolved, all in the heartbeat's one step; five
 *     minutes or more, the heartbeat is recorded and nothing else changes;
 *   - "I'm home" (`recordHome`) decides by the home rule under the journey's
 *     "lock", as the adapter asks the domain there (review loop 1, AR-04): a
 *     walker or a device that is not the journey's makes it reject and write
 *     nothing; a journey already ENDED is answered `already_ended` and
 *     nothing changes; an ACTIVE or LOST_CONTACT journey is ended, HOME, at
 *     the store's now, and from LOST_CONTACT its alert is resolved;
 *   - resolving is one step: the journey's one unresolved alert, whatever its
 *     state, goes to RESOLVED at now with the resolution; every lost-contact
 *     message of it not sent and not withdrawn is withdrawn at now, keeping
 *     its attempts and last failure; and one stand-down per responder row of
 *     the journey is written, of the resolution's own kind, due at now, or,
 *     for a responder whose lost-contact message was withdrawn having been
 *     handed over at least once and due later than now, at that due time (the
 *     hold). No unresolved alert: no withdrawal and no stand-down, and the
 *     move stands. No responder row: no stand-down, and the resolution
 *     stands. A second stand-down of a kind for (alert, recipient) is refused,
 *     as the unique index refuses it, and nothing of the step is kept;
 *   - an open also withdraws, at its now, every unsent and not yet withdrawn
 *     stand-down (kind BACK_IN_CONTACT or HOME) of every alert of the
 *     walker's journeys, this one's earlier alerts and the walker's earlier
 *     journeys' alike, whose recipient is a responder of the journey being
 *     opened, in the same step as the new alert: so an earlier "back in
 *     contact" or "home" never reaches the port after the new alert's
 *     lost-contact push. Another walker's are left alone, and so is a
 *     stand-down for someone the new alert will not tell, who is still stood
 *     down (approach item 4, step 5; review loops 1 to 3; D-111);
 *   - a fake given no clock throws when asked whether contact is back, or to
 *     end a journey, as it throws when asked about silence.
 *
 * And for "I'm on it" (LOST-06, its spec's approach items 2 to 5 and 10):
 *   - `alertForAcknowledgement` is a plain read: the alert's state, who is
 *     recorded on it, and its journey's responders, or null for an ID no
 *     alert has. It never waits for a held row, as a read without a lock
 *     never does;
 *   - `recordAcknowledgement` takes the alert's journey's "row" first, and
 *     waits while `hold` holds it, as the adapter's `for update` waits; then
 *     decides by the alert rule, in its order, asked under that "lock": no
 *     alert, or a sender who is not a responder of the alert's journey, is
 *     ALERT_NOT_FOUND; a RESOLVED alert is ALERT_RESOLVED; the sender already
 *     recorded is ALREADY_YOURS; someone else recorded is
 *     ALREADY_ACKNOWLEDGED; each of these writes nothing. Otherwise the alert
 *     becomes ACKNOWLEDGED, acknowledged by the sender at the store's now,
 *     and one ACKNOWLEDGED message is written per responder row other than
 *     the sender's, each with a fresh ID, due at that now, all of it or none
 *     of it. IDs are compared exactly, as the rule compares them; the alert's
 *     ID is matched as a `uuid` parameter is, in either case;
 *   - an alert's `acknowledgedBy` and `acknowledgedAt` are both null, or both
 *     set, and `acknowledgedBy` must be a user, as the check and the foreign
 *     key hold them. No check ties the state to them (approach item 7);
 *   - resolving withdraws the unsent messages of every kind in
 *     `WITHDRAWN_WHEN_RESOLVED`, the notice included (reading 8), and holds a
 *     responder's stand-down until the latest due time among that
 *     responder's withdrawn messages that were handed over and are due later
 *     than now: one stand-down per responder, however many of their messages
 *     were withdrawn (approach item 5);
 *   - a fake given no clock throws when asked to record an acknowledgement,
 *     as it throws when asked about silence; a refusal it needs no time for
 *     is answered without one.
 *
 * The shared behaviour suite (`journey-store-behaviour.ts`) runs the same
 * expectations against this fake and against the real adapter, which is
 * what keeps the two from drifting apart.
 *
 * It can also fail like a database that is gone (`failWith`), for every port
 * method or for one, run a test's action at the moment a port method is
 * called (`beforeNext`), and it records which of its port methods were
 * called, so a test can say "the handler never ran". Matches the server's
 * JourneyStore port by shape, so the test kit needs no import from the server.
 */
import { EVENT_ID_PATTERN, MAX_EVENT_ID_LENGTH } from '@trygghverdag/contracts';
import { PUSH_FAILURE_REASONS, type MessageKind, type PushFailureReason } from './fake-push.ts';
import { syntheticUuid } from './synthetic-ids.ts';

/**
 * The kinds that stand a responder down, which an open withdraws (LOST-03
 * review loop 3): listed, so a kind added later is withdrawn only if it opts
 * in. The server's `ALERT_RESOLUTIONS`, written out because the test kit does
 * not import the server; exported so the domain's test holds the two equal
 * (LOST-06-AC13).
 */
export const WITHDRAWN_WHEN_OPENED: readonly MessageKind[] = ['BACK_IN_CONTACT', 'HOME'];

/**
 * The kinds an alert's resolution withdraws from its own alert, unsent (D-111,
 * D-113): its lost-contact pushes and its "someone is on it" notices. The
 * server's `WITHDRAWN_WHEN_RESOLVED`, written out for the same reason, and
 * held equal to it by the domain's test (LOST-06-AC13).
 */
export const WITHDRAWN_WHEN_RESOLVED: readonly MessageKind[] = ['LOST_CONTACT', 'ACKNOWLEDGED'];

/**
 * The journey states, as the server's state machine lists them. Written out
 * here because the test kit does not import the server; a state added there
 * is added here when its tests are written.
 */
export type FakeJourneyState = 'ACTIVE' | 'LOST_CONTACT' | 'ENDED';

/** Every state but the one that frees the walker. */
export type UnendedJourneyState = Exclude<FakeJourneyState, 'ENDED'>;

/** A journey as it is stored, in the shape SM-01's tests read it. */
export interface StoredJourney {
  id: string;
  walkerId: string;
  state: FakeJourneyState;
  startedAt: Date;
  responderIds: readonly string[];
}

/** A start to be stored, as the journey module hands it over. */
export interface StartedJourney {
  walkerId: string;
  /** The device that sent the start (D-101). */
  deviceId: string;
  responderIds: readonly string[];
  startedAt: Date;
}

/** What storing a start came to: stored, or refused by the one-unended-journey rule. */
export type InsertStartedResult =
  { inserted: true; journeyId: string } | { inserted: false; unendedJourneyId: string };

/** The journey a heartbeat names, in any state: whose it is and which device started it. */
export interface JourneyForHeartbeat {
  id: string;
  walkerId: string;
  deviceId: string;
  state: FakeJourneyState;
}

/** A position as the store takes it. The phone's time is a label, never a decision (REL-01). */
export interface HeartbeatPosition {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  recordedAt: Date;
}

/** A heartbeat to be stored, timed by the clock when it arrived. */
export interface HeartbeatToRecord {
  journeyId: string;
  eventId: string;
  receivedAt: Date;
  /** From 0 to 1, or null for unknown. */
  batteryLevel: number | null;
  position: HeartbeatPosition | null;
}

/**
 * Stored; already there, so nothing changed (SM-08); or the journey has ENDED,
 * so nothing stored (SM-07). Or (LOST-03) stored, and the journey, LOST_CONTACT
 * when its row was taken, is back in contact: its alert, null when it had
 * none, and the stand-downs written.
 */
export type RecordHeartbeatResult =
  | { outcome: 'recorded' | 'duplicate' | 'ended' }
  | { outcome: 'back_in_contact'; alertId: string | null; messages: AlertMessage[] };

/**
 * "I'm home" (LOST-03, D-110): ended now, from the state the journey's row was
 * in, with the alert it resolved, null when none, and the stand-downs
 * written; or the journey had already ENDED, and nothing changed
 * (`already_ended`, review loop 1: `ended` stays the heartbeat's word).
 */
export type RecordHomeResult =
  | {
      outcome: 'home';
      from: UnendedJourneyState;
      alertId: string | null;
      messages: AlertMessage[];
    }
  | { outcome: 'already_ended' };

/** "I'm home" as the store takes it: the journey, and who asks, for the home rule under the lock. */
export interface HomeToRecord {
  journeyId: string;
  walkerId: string;
  deviceId: string;
}

/** A journey's latest heartbeat: no coordinates, only whether it carried a position. */
export interface LatestHeartbeat {
  receivedAt: Date;
  hasPosition: boolean;
  batteryLevel: number | null;
}

/** A heartbeat as stored. `id` is the arrival order, as the identity column counts it. */
export interface StoredHeartbeat {
  id: number;
  journeyId: string;
  eventId: string;
  receivedAt: Date;
  batteryLevel: number | null;
}

/** A position as stored, beside the heartbeat it came with. */
export interface StoredPosition extends HeartbeatPosition {
  heartbeatId: number;
}

/** The time, by shape: the fake clock, standing in for the database's `now()`. */
export interface StoreClock {
  now(): Promise<Date>;
}

/** An overdue journey as the watchdog reads it: ACTIVE, and silent since this moment. */
export interface OverdueJourney {
  id: string;
  state: FakeJourneyState;
  silentSince: Date;
}

/** What the watchdog's read returns: the overdue journeys, and the store's now, from the same read. */
export interface OverdueJourneys {
  now: Date;
  journeys: OverdueJourney[];
}

/** One message an alert's opening, or its resolution, wrote, as the store hands it back. */
export interface AlertMessage {
  messageId: string;
  recipientId: string;
  kind: MessageKind;
}

/**
 * Opened, with its alert and its messages; or skipped, and nothing was
 * written; or held, when an open that waits for the row ran out of wait
 * (LOST-02, approach item 3, step 4), and nothing was written either.
 */
export type OpenLostContactAlertResult =
  | { outcome: 'opened'; alertId: string; messages: AlertMessage[] }
  | { outcome: 'skipped' }
  | { outcome: 'held' };

/** An open as it was asked for: `lockWaitMs` only when the open was told to wait for the row. */
export interface OpenRequest {
  journeyId: string;
  afterMs: number;
  lockWaitMs?: number | undefined;
}

/** A message as a claim hands it out: what the push needs, and how many attempts it has had. */
export interface ClaimedMessage extends AlertMessage {
  attempts: number;
}

/** What a claim returns: the messages it took, and the store's now, from the same statement. */
export interface ClaimedMessages {
  now: Date;
  messages: ClaimedMessage[];
}

/** The alert states, as the server's state machine lists them (D-033). */
export type FakeAlertState = 'OPEN' | 'ESCALATED' | 'ACKNOWLEDGED' | 'RESOLVED';

/** How an alert was resolved (LOST-03): the server's `ALERT_RESOLUTIONS`, each a message kind. */
export type FakeAlertResolution = Extract<MessageKind, 'BACK_IN_CONTACT' | 'HOME'>;

/** Why a journey ended (LOST-03): the server's `JOURNEY_END_REASONS`. */
export type FakeJourneyEndReason = 'HOME';

/**
 * An alert as stored: no position, no battery, no phone time (LOST-02-AC13).
 * `resolvedAt` and `resolution` are null until it is resolved, and set
 * together (LOST-03). `acknowledgedBy` and `acknowledgedAt` are null until a
 * responder says "I'm on it", and set together (LOST-06).
 */
export interface StoredAlert {
  id: string;
  journeyId: string;
  state: FakeAlertState;
  openedAt: Date;
  silentSince: Date;
  resolvedAt: Date | null;
  resolution: FakeAlertResolution | null;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
}

/**
 * An alert as "I'm on it" reads it (LOST-06): its state, who is recorded on
 * it, null for nobody, and its journey's responders. The server's
 * `AlertForAcknowledgement`, by shape.
 */
export interface AlertForAcknowledgement {
  id: string;
  state: FakeAlertState;
  acknowledgedBy: string | null;
  responderIds: readonly string[];
}

/** "I'm on it" as the store takes it: the alert, by its ID, and the responder who sent it. */
export interface AcknowledgementToRecord {
  alertId: string;
  responderId: string;
}

/**
 * The alert rule's outcomes other than "acknowledged" (LOST-06, approach item
 * 2): the sender's own already, the alert over, no such alert for the
 * sender, or someone else on it.
 */
export type AcknowledgementNotRecorded =
  | { type: 'unchanged'; reason: 'ALREADY_YOURS' }
  | { type: 'ignored'; reason: 'ALERT_RESOLVED' }
  | { type: 'refused'; reason: 'ALERT_NOT_FOUND' | 'ALREADY_ACKNOWLEDGED' };

/**
 * Recorded now, with the notices written; or not recorded, with the rule's
 * decision under the lock, and nothing written. The server's
 * `RecordAcknowledgementResult`, by shape.
 */
export type RecordAcknowledgementResult =
  | { outcome: 'acknowledged'; messages: AlertMessage[] }
  | { outcome: 'not_recorded'; decision: AcknowledgementNotRecorded };

/**
 * An outbox message as stored. Its ID is opaque: never a user's, a journey's
 * or an alert's. `withdrawnAt` is when it was withdrawn, null if never
 * (LOST-03, D-111): a withdrawn message is never handed out again.
 */
export interface StoredMessage {
  messageId: string;
  alertId: string;
  recipientId: string;
  kind: MessageKind;
  createdAt: Date;
  attempts: number;
  nextAttemptAt: Date;
  sentAt: Date | null;
  lastFailure: PushFailureReason | null;
  withdrawnAt: Date | null;
}

/** How a journey ended: both null until it ends through the store, and set together (LOST-03). */
export interface JourneyEnd {
  endedAt: Date | null;
  endReason: FakeJourneyEndReason | null;
}

/** The port methods, which `calls` records. */
export type JourneyStoreCall =
  | 'unendedJourneyOf'
  | 'existingUsers'
  | 'insertStarted'
  | 'journeyForHeartbeat'
  | 'recordHeartbeat'
  | 'latestHeartbeatOf'
  | 'overdueJourneys'
  | 'openLostContactAlert'
  | 'claimDue'
  | 'markSent'
  | 'markFailed'
  | 'recordHome'
  | 'alertForAcknowledgement'
  | 'recordAcknowledgement';

export interface FakeJourneyStore {
  /** The walker's journey in any state but ENDED, or null. */
  unendedJourneyOf(walkerId: string): Promise<{ id: string; state: UnendedJourneyState } | null>;
  /** Which of these IDs are users. */
  existingUsers(ids: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * Stores a start as ACTIVE, with the device that sent it, unless the walker
   * already has an unended journey. Rejects a start with no responders.
   */
  insertStarted(journey: StartedJourney): Promise<InsertStartedResult>;
  /** The journey this ID names, in any state, or null. */
  journeyForHeartbeat(journeyId: string): Promise<JourneyForHeartbeat | null>;
  /**
   * Stores a heartbeat and its position, if any, and moves last contact
   * forward to its receive time, never back: all of it or none of it. For a
   * journey LOST_CONTACT when its row is taken, asks whether contact is back
   * (LOST-03), which needs a clock.
   */
  recordHeartbeat(heartbeat: HeartbeatToRecord): Promise<RecordHeartbeatResult>;
  /** The heartbeat with the greatest receive time, a tie to the one stored last; null if none. */
  latestHeartbeatOf(journeyId: string): Promise<LatestHeartbeat | null>;
  /**
   * "I'm home" (LOST-03, D-110): decides by the home rule under the row's
   * lock. Ends the journey, HOME, at now, from the state its row is in,
   * resolving its alert when that is LOST_CONTACT; answers `already_ended`
   * for a journey already ENDED; rejects, writing nothing, for a walker or a
   * device that is not the journey's, or a journey that does not exist.
   * Needs a clock to end one.
   */
  recordHome(home: HomeToRecord): Promise<RecordHomeResult>;

  /**
   * "I'm on it" (LOST-06): the alert this ID names, read without a lock, with
   * its journey's responders; or null for an ID no alert has. A plain read:
   * it never waits for a held row.
   */
  alertForAcknowledgement(alertId: string): Promise<AlertForAcknowledgement | null>;
  /**
   * "I'm on it" (LOST-06): waits for the alert's journey's row while it is
   * held, then decides by the alert rule under that "lock" and writes what it
   * decided: ACKNOWLEDGED, by this responder at now, with one ACKNOWLEDGED
   * message per other responder row; or nothing, with the rule's other
   * outcome. Needs a clock to record one.
   */
  recordAcknowledgement(
    acknowledgement: AcknowledgementToRecord,
  ): Promise<RecordAcknowledgementResult>;

  /** The ACTIVE journeys silent for `afterMs` or more, without locking, and now. Needs a clock. */
  overdueJourneys(afterMs: number): Promise<OverdueJourneys>;
  /**
   * Moves an overdue ACTIVE journey to LOST_CONTACT, with its alert and one
   * message per responder, all of it or none of it; or skips it. A held row
   * is skipped, unless `lockWaitMs` is given: then the open waits for it, and
   * answers `held` if it is not let go. Needs a clock.
   */
  openLostContactAlert(request: OpenRequest): Promise<OpenLostContactAlertResult>;
  /** Takes at most `limit` due messages, one attempt more each, leased for `leaseMs`. Needs a clock. */
  claimDue(request: { limit: number; leaseMs: number }): Promise<ClaimedMessages>;
  /** The port accepted it: sent at now. Needs a clock. */
  markSent(messageId: string): Promise<void>;
  /** The port did not accept it: this reason, and due again `retryAfterMs` after now. Needs a clock. */
  markFailed(request: {
    messageId: string;
    reason: PushFailureReason;
    retryAfterMs: number;
  }): Promise<void>;

  /** Makes a user exist, with a fresh ID unless one is given. Returns the ID, lower-case. */
  addUser(id?: string): string;
  /**
   * Makes a device exist for a user who exists, as the `devices` table's
   * foreign key requires, with a fresh ID unless one is given. Returns the
   * ID, lower-case.
   */
  addDevice(userId: string, id?: string): string;
  /**
   * Puts a journey in directly, in any state, as a test's own setup. Keeps
   * the database's rules: throws for a second unended journey, or for a
   * walker, responder or device that does not exist. Returns the journey's ID.
   */
  seed(journey: {
    walkerId: string;
    deviceId: string;
    state: FakeJourneyState;
    responderIds: readonly string[];
    startedAt: Date;
    lastHeartbeatAt?: Date | null;
    id?: string;
  }): string;
  /**
   * Puts a stored journey in another state directly, as a test's own setup.
   * Keeps the one-unended rule. Sets no end time or reason: a journey ended
   * this way has neither, as one ended by hand in the database has neither.
   */
  setState(journeyId: string, state: FakeJourneyState): void;
  /**
   * Puts an alert in directly, as a test's own setup (LOST-03-AC4): in any
   * state, for a journey that is stored. Keeps the database's rules: one
   * alert per journey that is not RESOLVED, a resolution and its time both
   * set or both null, and (LOST-06) who acknowledged it and when both set or
   * both null, the acknowledger a user. Returns the alert's ID.
   */
  seedAlert(alert: {
    journeyId: string;
    state: FakeAlertState;
    openedAt: Date;
    silentSince: Date;
    resolvedAt?: Date | null;
    resolution?: FakeAlertResolution | null;
    acknowledgedBy?: string | null;
    acknowledgedAt?: Date | null;
  }): string;
  /**
   * Puts an outbox message in directly, as a test's own setup. Keeps the
   * database's rules: the alert is stored, the recipient is a user, the
   * attempts are not negative, and one message per (alert, recipient, kind).
   * Returns the message's ID.
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
  }): string;
  /** Removes every responder row of the journey, as a test's own setup: nothing in the code does. */
  removeResponders(journeyId: string): void;
  /** Every journey stored, in the order stored. Copies: changing them changes nothing. */
  journeys(): StoredJourney[];
  /** How this journey ended: its end time and reason, both null until it ends through the store. Throws for a journey not stored. */
  endOf(journeyId: string): JourneyEnd;
  /** The device that started this journey (D-101). Throws for a journey not stored. */
  deviceOf(journeyId: string): string;
  /** This journey's last contact, null until its first heartbeat. Throws for a journey not stored. */
  lastHeartbeatAt(journeyId: string): Date | null;
  /** Every heartbeat stored, in arrival order. Copies. */
  heartbeats(): StoredHeartbeat[];
  /** Every position stored, in arrival order. Copies. */
  positions(): StoredPosition[];
  /** Every alert opened or put in, in that order. Copies. */
  alerts(): StoredAlert[];
  /** Every outbox message written, in the order written. Copies. */
  outbox(): StoredMessage[];
  /**
   * Stands in for a transaction elsewhere holding this journey's row, one
   * that never lets go by itself: the watchdog's open skips it, an open that
   * waits for it answers `held`, and a heartbeat or an "I'm home" for it
   * waits, until `release` or `commitHold`. A held row that no longer
   * matches (no longer ACTIVE, or no longer overdue) answers `skipped` to
   * both opens, as PostgreSQL never locks it. Throws for a journey not
   * stored.
   */
  hold(journeyId: string): void;
  /** The row is free again: what waited for it goes on. */
  release(journeyId: string): void;
  /**
   * The holder does its own work on the row, then commits (LOST-03-AC11 and
   * AC17's second order: the sweep's open holding the row as a heartbeat or
   * an "I'm home" arrives). The row is the holder's while `holderAction`
   * runs, so the action is not held up by its own hold, and what waited for
   * the row goes on only once the action has finished. Throws for a journey
   * not stored.
   */
  commitHold(journeyId: string, holderAction: () => Promise<unknown>): Promise<void>;
  /**
   * Holds the journey's row as `hold` does, for a holder that lets go when an
   * open is waiting for it (LOST-02-AC20): a healthy transaction that commits
   * within the lock wait. When an open with a `lockWaitMs` reaches the row,
   * the hold ends, `holderAction` runs (moving the journey to LOST_CONTACT
   * as a concurrent sweeper would, say), and the open then checks the journey
   * as the holder left it. An open without a wait skips it, as it skips any
   * held row. Throws for a journey not stored.
   */
  holdUntilWaited(journeyId: string, holderAction?: () => void | Promise<void>): void;
  /** Every open asked for so far, in order, with its wait if it had one. Copies. */
  openRequests(): OpenRequest[];
  /** The port methods called so far, in order. */
  readonly calls: readonly JourneyStoreCall[];
  /**
   * From now on every port method, or only the one named, rejects with this
   * error and changes nothing.
   */
  failWith(error: Error, only?: JourneyStoreCall): void;
  /** Port methods answer again. */
  recover(): void;
  /**
   * Runs `action` once, at the next call of this port method, before that
   * call answers: a journey that ends, or a database that goes away, between
   * one call and the next.
   */
  beforeNext(call: JourneyStoreCall, action: () => void): void;
}

/**
 * Five minutes (D-021): the server's LOST_CONTACT_AFTER_MS, written out
 * because the test kit imports nothing from the server. Contact is back when
 * the silence is under it, the watchdog's rule asked the other way (LOST-03,
 * reading 1).
 */
const LOST_CONTACT_AFTER_MS = 300_000;

/** A journey as this fake keeps it: what SM-01 reads, and what D-101, LOST-01 and LOST-03 added. */
interface KeptJourney extends StoredJourney {
  deviceId: string;
  lastHeartbeatAt: Date | null;
  endedAt: Date | null;
  endReason: FakeJourneyEndReason | null;
}

function copy(journey: KeptJourney): StoredJourney {
  return {
    id: journey.id,
    walkerId: journey.walkerId,
    state: journey.state,
    startedAt: new Date(journey.startedAt.getTime()),
    responderIds: [...journey.responderIds],
  };
}

/** A moment, or null, copied. */
function copyOf(moment: Date | null): Date | null {
  return moment === null ? null : new Date(moment.getTime());
}

/**
 * An ID as a `uuid` column holds it. PostgreSQL reads a UUID's hex digits in
 * either case and writes them back lower-case, so an ID given in upper case
 * finds the same row, and comes back different from how it was sent.
 */
function asStored(id: string): string {
  return id.toLowerCase();
}

/** The textual form of a UUID, in either case. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The event ID rule the `heartbeats` table holds by a check constraint: the
 * contract's own, read from the contract rather than copied (LOST-01's spec,
 * approach items 3 and 7). The test kit depends on the contracts package, not
 * on the server.
 */
function isEventId(eventId: string): boolean {
  return eventId.length <= MAX_EVENT_ID_LENGTH && EVENT_ID_PATTERN.test(eventId);
}

function isWithin(value: number, low: number, high: number): boolean {
  return Number.isFinite(value) && value >= low && value <= high;
}

/**
 * Whether `timestamptz` takes this moment as the adapter writes it. The
 * adapter writes a Date with `toISOString()`, which gives year 0 as `0000-…`,
 * a year PostgreSQL does not have, and year 10000 as `+010000-…`. PostgreSQL
 * 16 refuses the first with SQLSTATE 22008 ("date/time field value out of
 * range") and the second with 22009 ("time zone displacement out of range"),
 * read on PostgreSQL 16.13. So only an instant in the years 0001 to 9999 in
 * UTC is stored, as the contract now requires of the phone's time.
 */
function isStorableMoment(moment: Date): boolean {
  const year = moment.getUTCFullYear();
  return year >= 1 && year <= 9999;
}

/** What a check constraint would refuse, worded as PostgreSQL words it. */
function checkViolation(table: string, what: string): Error {
  return new Error(`new row for relation "${table}" violates check constraint: ${what}`);
}

/** What a unique index would refuse, worded as PostgreSQL words it. */
function uniqueViolation(what: string): Error {
  return new Error(
    `duplicate key value violates unique constraint: ${what}; the transaction is rolled back`,
  );
}

/** The answer of a step that has not read the store's now yet, and needs it to go on. */
const NEEDS_NOW = Symbol('needs the store’s now');

export function fakeJourneyStore({ clock }: { clock?: StoreClock } = {}): FakeJourneyStore {
  const users = new Set<string>();
  /** Device ID → its user. */
  const devices = new Map<string, string>();
  const stored: KeptJourney[] = [];
  const heartbeats: StoredHeartbeat[] = [];
  const positions: StoredPosition[] = [];
  const calls: JourneyStoreCall[] = [];
  const pending = new Map<JourneyStoreCall, (() => void)[]>();
  let failure: { error: Error; only: JourneyStoreCall | undefined } | null = null;
  let arrivals = 0;
  const alerts: StoredAlert[] = [];
  const outbox: StoredMessage[] = [];
  /** The journeys another transaction holds, and what waits for each to be released. */
  const held = new Map<string, (() => void)[]>();
  /** The held journeys whose holder lets go when an open waits for it, and what the holder does first. */
  const lettingGo = new Map<string, () => void | Promise<void>>();
  const openRequests: OpenRequest[] = [];

  /** The store's now: the clock's, or a loud refusal when it was given none. */
  const nowFor = async (call: JourneyStoreCall): Promise<Date> => {
    if (clock === undefined) {
      throw new Error(
        `fakeJourneyStore.${call}: this fake was given no clock, so it cannot tell how long a ` +
          'journey has been silent, whether contact is back, when a journey ended or when a ' +
          'message is due. Make it with fakeJourneyStore({ clock }); a fake that guessed the ' +
          'time would prove nothing.',
      );
    }
    return new Date((await clock.now()).getTime());
  };

  /** Ends a hold of either kind: what waited for the row goes on. */
  const letGo = (id: string): void => {
    const waiting = held.get(id) ?? [];
    held.delete(id);
    lettingGo.delete(id);
    for (const go of waiting) {
      go();
    }
  };

  /** Settles once the journey's row is free, at once when nothing holds it. */
  const untilReleased = (journeyId: string): Promise<void> => {
    const waiting = held.get(journeyId);
    return waiting === undefined
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          waiting.push(resolve);
        });
  };

  /** Copies, so what a test reads cannot change what the fake holds. */
  const copyAlert = (alert: StoredAlert): StoredAlert => ({
    ...alert,
    openedAt: new Date(alert.openedAt.getTime()),
    silentSince: new Date(alert.silentSince.getTime()),
    resolvedAt: copyOf(alert.resolvedAt),
    acknowledgedAt: copyOf(alert.acknowledgedAt),
  });
  const copyMessage = (message: StoredMessage): StoredMessage => ({
    ...message,
    createdAt: new Date(message.createdAt.getTime()),
    nextAttemptAt: new Date(message.nextAttemptAt.getTime()),
    sentAt: copyOf(message.sentAt),
    withdrawnAt: copyOf(message.withdrawnAt),
  });

  /** When a journey's silence began: last contact, or its start when it has none. */
  const silentSinceOf = (journey: KeptJourney): Date =>
    new Date((journey.lastHeartbeatAt ?? journey.startedAt).getTime());

  const isOverdue = (journey: KeptJourney, now: Date, afterMs: number): boolean =>
    journey.state === 'ACTIVE' && now.getTime() - silentSinceOf(journey).getTime() >= afterMs;

  /**
   * Whether contact is back (LOST-03, reading 1): the silence, counted from
   * this moment, is under five minutes at now. No comparison with a time
   * that is not one holds, so an invalid moment brings nothing back.
   */
  const isInContact = (silentSince: Date, now: Date): boolean =>
    now.getTime() - silentSince.getTime() < LOST_CONTACT_AFTER_MS;

  /** The message this ID names, which must be stored: an update of nothing is a sender's bug. */
  const messageNamed = (call: JourneyStoreCall, messageId: string): StoredMessage => {
    const id = journeyIdOf(messageId);
    const message = outbox.find((kept) => kept.messageId === id);
    if (message === undefined) {
      throw new Error(`fakeJourneyStore.${call}: no message ${messageId} is in the outbox`);
    }
    return message;
  };

  /** A number of milliseconds as an interval takes it. */
  const millisecondsOf = (call: JourneyStoreCall, what: string, value: number): number => {
    if (!Number.isFinite(value)) {
      throw new Error(`fakeJourneyStore.${call}: ${what} must be a finite number of milliseconds`);
    }
    return value;
  };

  const unendedOf = (walkerId: string): KeptJourney | undefined =>
    stored.find((journey) => journey.walkerId === asStored(walkerId) && journey.state !== 'ENDED');

  /** What a foreign key would refuse, worded as PostgreSQL words it. */
  const notAUser = (role: string, id: string): Error =>
    new Error(`insert violates foreign key constraint: the ${role} ${id} is not a user`);
  const notADevice = (id: string): Error =>
    new Error(`insert violates foreign key constraint: the device ${id} is not a device`);
  /**
   * A journey's device as `journeys.device_id` takes it: not null, so a start
   * or a seed that names no device is refused as PostgreSQL refuses it
   * (D-101), rather than failing on whatever reads it next.
   */
  const deviceIdOf = (given: string | undefined | null): string => {
    if (typeof given !== 'string') {
      throw new Error(
        'null value in column "device_id" of relation "journeys" violates not-null constraint: ' +
          'a journey records the device that started it (D-101)',
      );
    }
    return asStored(given);
  };

  /** A journey ID as a `uuid` parameter takes it: refused, as PostgreSQL refuses it, unless it is one. */
  const journeyIdOf = (given: string): string => {
    if (!UUID.test(given)) {
      throw new Error(`invalid input syntax for type uuid: "${given}"`);
    }
    return asStored(given);
  };

  const journeyNamed = (journeyId: string): KeptJourney | undefined => {
    const id = journeyIdOf(journeyId);
    return stored.find((journey) => journey.id === id);
  };

  /** The journey a test helper names, which must be stored: a test about a journey it never made proves nothing. */
  const storedJourney = (helper: string, journeyId: string): KeptJourney => {
    const journey = journeyNamed(journeyId);
    if (journey === undefined) {
      throw new Error(`fakeJourneyStore.${helper}: no journey ${journeyId} is stored`);
    }
    return journey;
  };

  /**
   * The alert this ID names (LOST-06), matched as a `uuid` parameter is: in
   * either case, and refused, as PostgreSQL refuses it, unless it is a UUID.
   */
  const alertNamed = (alertId: string): StoredAlert | undefined => {
    const id = journeyIdOf(alertId);
    return alerts.find((alert) => alert.id === id);
  };

  /**
   * Resolving an alert (LOST-03, approach item 4), worked out without
   * changing anything: the journey's one unresolved alert, the lost-contact
   * messages to withdraw, and one stand-down per responder row, each due as
   * the hold says. Throws, having changed nothing, for anything the database
   * would refuse. `apply` then writes all of it in one go.
   */
  const planResolution = (
    journey: KeptJourney,
    resolution: FakeAlertResolution,
    now: Date,
  ): { alertId: string | null; messages: AlertMessage[]; apply: () => void } => {
    const alert = alerts.find((kept) => kept.journeyId === journey.id && kept.state !== 'RESOLVED');
    if (alert === undefined) {
      // Reading 11: nothing to resolve, withdraw or stand down; the move stands.
      return { alertId: null, messages: [], apply: () => undefined };
    }
    // LOST-06 (reading 8, approach item 5): every kind the resolution
    // withdraws, the notice that someone is on it included.
    const withdrawn = outbox.filter(
      (message) =>
        message.alertId === alert.id &&
        WITHDRAWN_WHEN_RESOLVED.includes(message.kind) &&
        message.sentAt === null &&
        message.withdrawnAt === null,
    );
    if (new Set(journey.responderIds).size !== journey.responderIds.length) {
      throw uniqueViolation('one outbox message per (alert, recipient, kind)');
    }
    const standDowns: StoredMessage[] = journey.responderIds.map((recipientId) => {
      if (
        outbox.some(
          (message) =>
            message.alertId === alert.id &&
            message.recipientId === recipientId &&
            message.kind === resolution,
        )
      ) {
        throw uniqueViolation('one outbox message per (alert, recipient, kind)');
      }
      // The hold (LOST-03 reading 7; LOST-06 approach item 5): a responder
      // whose withdrawn message was handed over and is not due yet may still
      // have it in the port's hands. Per responder, over everything withdrawn
      // for them: the latest such due time, or now. One stand-down each,
      // however many of their messages were withdrawn (D-114).
      const due = withdrawn
        .filter(
          (message) =>
            message.recipientId === recipientId &&
            message.attempts >= 1 &&
            message.nextAttemptAt.getTime() > now.getTime(),
        )
        .reduce<Date>(
          (latest, message) =>
            message.nextAttemptAt.getTime() > latest.getTime() ? message.nextAttemptAt : latest,
          now,
        );
      return {
        messageId: syntheticUuid(),
        alertId: alert.id,
        recipientId,
        kind: resolution,
        createdAt: new Date(now.getTime()),
        attempts: 0,
        nextAttemptAt: new Date(due.getTime()),
        sentAt: null,
        lastFailure: null,
        withdrawnAt: null,
      };
    });
    return {
      alertId: alert.id,
      messages: standDowns.map(({ messageId, recipientId, kind }) => ({
        messageId,
        recipientId,
        kind,
      })),
      apply: () => {
        alert.state = 'RESOLVED';
        alert.resolvedAt = new Date(now.getTime());
        alert.resolution = resolution;
        for (const message of withdrawn) {
          message.withdrawnAt = new Date(now.getTime());
        }
        outbox.push(...standDowns);
      },
    };
  };

  /**
   * Answers a turn later, as a real query does, and only then checks for a
   * failure and touches the data — so code that forgot to wait for a write
   * cannot look, to a test, as though it had waited. Each answer is worked
   * out in one step, which is what makes a check and its write atomic here,
   * as the index, the row lock and the transaction make them in the database.
   * A test's `beforeNext` action runs as the call is made, before it answers.
   */
  const answer = <T>(
    call: JourneyStoreCall,
    work: () => T | Promise<T>,
    waitFor: () => Promise<void> = () => Promise.resolve(),
  ): Promise<T> => {
    calls.push(call);
    pending.get(call)?.shift()?.();
    return Promise.resolve()
      .then(waitFor)
      .then(() => {
        if (failure !== null && (failure.only === undefined || failure.only === call)) {
          throw failure.error;
        }
        return work();
      });
  };

  return {
    unendedJourneyOf(walkerId) {
      return answer('unendedJourneyOf', () => {
        const journey = unendedOf(walkerId);
        return journey === undefined
          ? null
          : { id: journey.id, state: journey.state as UnendedJourneyState };
      });
    },
    existingUsers(ids) {
      return answer(
        'existingUsers',
        () => new Set(ids.map(asStored).filter((id) => users.has(id))),
      );
    },
    insertStarted({
      walkerId: givenWalkerId,
      deviceId: givenDeviceId,
      responderIds: givenResponderIds,
      startedAt,
    }) {
      return answer('insertStarted', (): InsertStartedResult => {
        const walkerId = asStored(givenWalkerId);
        const deviceId = deviceIdOf(givenDeviceId);
        const responderIds = givenResponderIds.map(asStored);
        if (responderIds.length === 0) {
          // The domain refuses an empty list before this, as NO_RESPONDER. A
          // store asked anyway refuses too, rather than keep a journey that
          // would alert nobody.
          throw new Error(
            'fakeJourneyStore.insertStarted: a start with no responders is refused, so no ' +
              'journey is ever stored with nobody to alert',
          );
        }
        if (!users.has(walkerId)) {
          throw notAUser('walker', walkerId);
        }
        const unended = unendedOf(walkerId);
        if (unended !== undefined) {
          // As ON CONFLICT DO NOTHING: no row is inserted, so no foreign key
          // is checked either.
          return { inserted: false, unendedJourneyId: unended.id };
        }
        if (!devices.has(deviceId)) {
          throw notADevice(deviceId);
        }
        const stranger = responderIds.find((id) => !users.has(id));
        if (stranger !== undefined) {
          throw notAUser('responder', stranger);
        }
        const journey: KeptJourney = {
          id: syntheticUuid(),
          walkerId,
          state: 'ACTIVE',
          startedAt: new Date(startedAt.getTime()),
          responderIds: [...responderIds],
          deviceId,
          lastHeartbeatAt: null,
          endedAt: null,
          endReason: null,
        };
        stored.push(journey);
        return { inserted: true, journeyId: journey.id };
      });
    },
    journeyForHeartbeat(journeyId) {
      return answer('journeyForHeartbeat', (): JourneyForHeartbeat | null => {
        const journey = journeyNamed(journeyId);
        return journey === undefined
          ? null
          : {
              id: journey.id,
              walkerId: journey.walkerId,
              deviceId: journey.deviceId,
              state: journey.state,
            };
      });
    },
    recordHeartbeat({ journeyId, eventId, receivedAt, batteryLevel, position }) {
      // A row another transaction holds makes the heartbeat wait for it, as
      // its `for update` waits in the database.
      const waitForRow = () => untilReleased(journeyId.toLowerCase());
      /**
       * The heartbeat's one step, worked out and written at once. Without the
       * store's now it stops before writing anything, as soon as it needs
       * it: only a stored heartbeat for a LOST_CONTACT journey asks whether
       * contact is back.
       */
      const step = (now: Date | null): RecordHeartbeatResult | typeof NEEDS_NOW => {
        const journey = journeyNamed(journeyId);
        if (journey === undefined) {
          // Nothing deletes journeys before the retention work, so a journey
          // that was read and is now gone is an error, not a guess.
          throw new Error(
            `fakeJourneyStore.recordHeartbeat: no journey ${journeyId}; a heartbeat for a ` +
              'journey that does not exist is never stored',
          );
        }
        if (journey.state === 'ENDED') {
          return { outcome: 'ended' };
        }
        // The heartbeat row's own constraints come before its conflict, as
        // PostgreSQL checks a row before it looks for a duplicate.
        if (!isEventId(eventId)) {
          throw checkViolation('heartbeats', 'event_id');
        }
        if (batteryLevel !== null && !isWithin(batteryLevel, 0, 1)) {
          throw checkViolation('heartbeats', 'battery_level');
        }
        if (Number.isNaN(receivedAt.getTime())) {
          throw new Error('invalid input syntax for type timestamp with time zone: received_at');
        }
        if (heartbeats.some((kept) => kept.journeyId === journey.id && kept.eventId === eventId)) {
          return { outcome: 'duplicate' };
        }
        if (position !== null) {
          if (!isWithin(position.latitude, -90, 90)) {
            throw checkViolation('positions', 'latitude');
          }
          if (!isWithin(position.longitude, -180, 180)) {
            throw checkViolation('positions', 'longitude');
          }
          if (!isWithin(position.accuracyMeters, 0, Number.MAX_VALUE)) {
            throw checkViolation('positions', 'accuracy_m');
          }
          if (Number.isNaN(position.recordedAt.getTime())) {
            throw new Error('invalid input syntax for type timestamp with time zone: recorded_at');
          }
          if (!isStorableMoment(position.recordedAt)) {
            throw new Error('date/time field value out of range: recorded_at');
          }
        }
        // greatest(coalesce(last_heartbeat_at, $t), $t): never backwards.
        const last = journey.lastHeartbeatAt?.getTime() ?? receivedAt.getTime();
        const lastContact = new Date(Math.max(last, receivedAt.getTime()));

        // LOST-03: the locked state was LOST_CONTACT, so ask whether contact
        // is back, with the silence counted with this heartbeat.
        let resolution: ReturnType<typeof planResolution> | null = null;
        if (journey.state === 'LOST_CONTACT') {
          if (now === null) {
            return NEEDS_NOW;
          }
          if (isInContact(lastContact, now)) {
            resolution = planResolution(journey, 'BACK_IN_CONTACT', now);
          }
        }

        arrivals += 1;
        heartbeats.push({
          id: arrivals,
          journeyId: journey.id,
          eventId,
          receivedAt: new Date(receivedAt.getTime()),
          batteryLevel,
        });
        if (position !== null) {
          positions.push({
            heartbeatId: arrivals,
            latitude: position.latitude,
            longitude: position.longitude,
            accuracyMeters: position.accuracyMeters,
            recordedAt: new Date(position.recordedAt.getTime()),
          });
        }
        journey.lastHeartbeatAt = lastContact;
        if (resolution === null) {
          return { outcome: 'recorded' };
        }
        journey.state = 'ACTIVE';
        resolution.apply();
        return {
          outcome: 'back_in_contact',
          alertId: resolution.alertId,
          messages: resolution.messages,
        };
      };
      return answer(
        'recordHeartbeat',
        async (): Promise<RecordHeartbeatResult> => {
          const first = step(null);
          if (first !== NEEDS_NOW) {
            return first;
          }
          // Read now, then work the whole step out again from the start, as
          // the row stands after the read: racing heartbeats meet here as
          // they meet on the row lock.
          const again = step(await nowFor('recordHeartbeat'));
          if (again === NEEDS_NOW) {
            throw new Error('fakeJourneyStore.recordHeartbeat: the store’s now was not used');
          }
          return again;
        },
        waitForRow,
      );
    },
    latestHeartbeatOf(journeyId) {
      return answer('latestHeartbeatOf', (): LatestHeartbeat | null => {
        const id = journeyIdOf(journeyId);
        const latest = heartbeats
          .filter((kept) => kept.journeyId === id)
          // Ordered by receive time, then arrival: the last one wins a tie.
          .reduce<StoredHeartbeat | undefined>(
            (best, kept) =>
              best === undefined || kept.receivedAt.getTime() >= best.receivedAt.getTime()
                ? kept
                : best,
            undefined,
          );
        return latest === undefined
          ? null
          : {
              receivedAt: new Date(latest.receivedAt.getTime()),
              hasPosition: positions.some((kept) => kept.heartbeatId === latest.id),
              batteryLevel: latest.batteryLevel,
            };
      });
    },
    recordHome(home) {
      if (typeof home !== 'object' || (home as unknown) === null) {
        // The interface changed in review loop 1: the walker and the device
        // come too, for the home rule under the lock. A caller still passing
        // the ID alone is told so, not guessed for.
        return Promise.reject(
          new Error(
            'fakeJourneyStore.recordHome takes { journeyId, walkerId, deviceId }, not a journey ID alone',
          ),
        );
      }
      const { journeyId, walkerId, deviceId } = home;
      // As a heartbeat: the journey's row first, waited for while held.
      const waitForRow = () => untilReleased(journeyId.toLowerCase());
      const step = (now: Date | null): RecordHomeResult | typeof NEEDS_NOW => {
        const journey = journeyNamed(journeyId);
        // The home rule, in its order, asked under the "lock" (approach item
        // 5, review loop 1): the module asked the same rule about the same
        // journey, so a refusal here cannot happen, and is thrown, never
        // guessed past.
        if (journey === undefined) {
          throw new Error(
            `fakeJourneyStore.recordHome: no journey ${journeyId}; nothing deletes a journey, so ` +
              'one that was read and is gone is an error, not a guess',
          );
        }
        // Compared exactly, as the domain's rule compares them (review loop
        // 2, D-100): an ID in another case than the stored one is not the
        // journey's walker or device, and is refused here as at the adapter.
        if (journey.walkerId !== walkerId) {
          throw new Error(
            'fakeJourneyStore.recordHome: the home rule refused under the lock ' +
              '(JOURNEY_NOT_FOUND: not the walker’s journey); nothing is written',
          );
        }
        if (journey.state === 'ENDED') {
          return { outcome: 'already_ended' };
        }
        if (journey.deviceId !== deviceId) {
          throw new Error(
            'fakeJourneyStore.recordHome: the home rule refused under the lock ' +
              '(NOT_THE_JOURNEYS_DEVICE); nothing is written',
          );
        }
        if (now === null) {
          return NEEDS_NOW;
        }
        // The locked state decides, not the module's read (approach item 5):
        // the rule resolves the alert only from LOST_CONTACT.
        const from = journey.state;
        const resolvesAlert = from === 'LOST_CONTACT';
        const resolution = resolvesAlert ? planResolution(journey, 'HOME', now) : null;
        journey.state = 'ENDED';
        journey.endedAt = new Date(now.getTime());
        journey.endReason = 'HOME';
        resolution?.apply();
        return {
          outcome: 'home',
          from,
          alertId: resolution?.alertId ?? null,
          messages: resolution?.messages ?? [],
        };
      };
      return answer(
        'recordHome',
        async (): Promise<RecordHomeResult> => {
          const first = step(null);
          if (first !== NEEDS_NOW) {
            return first;
          }
          const again = step(await nowFor('recordHome'));
          if (again === NEEDS_NOW) {
            throw new Error('fakeJourneyStore.recordHome: the store’s now was not used');
          }
          return again;
        },
        waitForRow,
      );
    },

    alertForAcknowledgement(alertId) {
      // A plain read, as the adapter's is: no lock, so a held row is read
      // all the same (LOST-06, approach item 3).
      return answer('alertForAcknowledgement', (): AlertForAcknowledgement | null => {
        const alert = alertNamed(alertId);
        if (alert === undefined) {
          return null;
        }
        return {
          id: alert.id,
          state: alert.state,
          acknowledgedBy: alert.acknowledgedBy,
          responderIds: [...storedJourney('alertForAcknowledgement', alert.journeyId).responderIds],
        };
      });
    },
    recordAcknowledgement(acknowledgement) {
      if (typeof acknowledgement !== 'object' || (acknowledgement as unknown) === null) {
        return Promise.reject(
          new Error(
            'fakeJourneyStore.recordAcknowledgement takes { alertId, responderId }, not an ID alone',
          ),
        );
      }
      const { alertId, responderId } = acknowledgement;
      // The alert's journey's row first, waited for while held, as the
      // adapter's `for update` on the journey waits (D-112's lock order).
      // No such alert: no row to wait for.
      const waitForRow = (): Promise<void> => {
        const alert = UUID.test(alertId) ? alerts.find(({ id }) => id === asStored(alertId)) : null;
        return alert === undefined || alert === null
          ? Promise.resolve()
          : untilReleased(alert.journeyId);
      };
      /**
       * The acknowledgement's one step, decided by the alert rule under the
       * "lock" and written at once. Without the store's now it stops before
       * writing anything, as soon as it needs it: only an acknowledgement
       * that records needs the time.
       */
      const step = (now: Date | null): RecordAcknowledgementResult | typeof NEEDS_NOW => {
        const alert = alertNamed(alertId);
        const journey =
          alert === undefined ? undefined : storedJourney('recordAcknowledgement', alert.journeyId);
        // The rule, in its order (approach item 2), the IDs compared exactly.
        if (alert === undefined || journey?.responderIds.includes(responderId) !== true) {
          return {
            outcome: 'not_recorded',
            decision: { type: 'refused', reason: 'ALERT_NOT_FOUND' },
          };
        }
        if (alert.state === 'RESOLVED') {
          return {
            outcome: 'not_recorded',
            decision: { type: 'ignored', reason: 'ALERT_RESOLVED' },
          };
        }
        if (alert.acknowledgedBy === responderId) {
          return {
            outcome: 'not_recorded',
            decision: { type: 'unchanged', reason: 'ALREADY_YOURS' },
          };
        }
        if (alert.acknowledgedBy !== null) {
          return {
            outcome: 'not_recorded',
            decision: { type: 'refused', reason: 'ALREADY_ACKNOWLEDGED' },
          };
        }
        if (now === null) {
          return NEEDS_NOW;
        }
        // One notice per responder row other than the sender's (D-113). The
        // unique (alert, recipient, kind) refuses a second, and nothing of
        // the step is kept.
        const recipients = journey.responderIds.filter((id) => id !== responderId);
        if (new Set(recipients).size !== recipients.length) {
          throw uniqueViolation('one outbox message per (alert, recipient, kind)');
        }
        const notices: StoredMessage[] = recipients.map((recipientId) => {
          if (
            outbox.some(
              (message) =>
                message.alertId === alert.id &&
                message.recipientId === recipientId &&
                message.kind === 'ACKNOWLEDGED',
            )
          ) {
            throw uniqueViolation('one outbox message per (alert, recipient, kind)');
          }
          return {
            messageId: syntheticUuid(),
            alertId: alert.id,
            recipientId,
            kind: 'ACKNOWLEDGED',
            createdAt: new Date(now.getTime()),
            attempts: 0,
            nextAttemptAt: new Date(now.getTime()),
            sentAt: null,
            lastFailure: null,
            withdrawnAt: null,
          };
        });
        alert.state = 'ACKNOWLEDGED';
        alert.acknowledgedBy = responderId;
        alert.acknowledgedAt = new Date(now.getTime());
        outbox.push(...notices);
        return {
          outcome: 'acknowledged',
          messages: notices.map(({ messageId, recipientId, kind }) => ({
            messageId,
            recipientId,
            kind,
          })),
        };
      };
      return answer(
        'recordAcknowledgement',
        async (): Promise<RecordAcknowledgementResult> => {
          const first = step(null);
          if (first !== NEEDS_NOW) {
            return first;
          }
          const again = step(await nowFor('recordAcknowledgement'));
          if (again === NEEDS_NOW) {
            throw new Error('fakeJourneyStore.recordAcknowledgement: the store’s now was not used');
          }
          return again;
        },
        waitForRow,
      );
    },

    overdueJourneys(afterMs) {
      return answer('overdueJourneys', async (): Promise<OverdueJourneys> => {
        const now = await nowFor('overdueJourneys');
        const threshold = millisecondsOf('overdueJourneys', 'afterMs', afterMs);
        // A plain read: a row another transaction holds is read all the same.
        return {
          now,
          journeys: stored
            .filter((journey) => isOverdue(journey, now, threshold))
            .map((journey) => ({
              id: journey.id,
              state: journey.state,
              silentSince: silentSinceOf(journey),
            })),
        };
      });
    },
    openLostContactAlert({ journeyId, afterMs, lockWaitMs }) {
      openRequests.push(
        lockWaitMs === undefined ? { journeyId, afterMs } : { journeyId, afterMs, lockWaitMs },
      );
      return answer('openLostContactAlert', async (): Promise<OpenLostContactAlertResult> => {
        const threshold = millisecondsOf('openLostContactAlert', 'afterMs', afterMs);
        // As lock_timeout takes it (LOST-02, review loop 2): a whole number of
        // milliseconds from 1 to 2147483647. PostgreSQL reads 0 as no limit
        // at all, which a wait must never quietly become.
        if (
          lockWaitMs !== undefined &&
          !(Number.isInteger(lockWaitMs) && lockWaitMs >= 1 && lockWaitMs <= 2_147_483_647)
        ) {
          throw new Error(
            'fakeJourneyStore.openLostContactAlert: lockWaitMs must be a whole number of ' +
              `milliseconds from 1 to 2147483647, not ${String(lockWaitMs)}: PostgreSQL reads ` +
              'a lock_timeout of 0 as no limit at all',
          );
        }
        const found = journeyNamed(journeyId);
        // A row whose committed version no longer matches is never locked,
        // so never waited for, held or not, as in PostgreSQL: skipped at once,
        // and its holder is not asked to let go (LOST-02, review loop 1).
        if (
          found === undefined ||
          !isOverdue(found, await nowFor('openLostContactAlert'), threshold)
        ) {
          return { outcome: 'skipped' };
        }
        if (held.has(found.id)) {
          // Without a wait: `for update skip locked` skips a held row.
          if (lockWaitMs === undefined) {
            return { outcome: 'skipped' };
          }
          // With one: a holder that never lets go outlasts it (55P03, held);
          // one that lets go does its own work first, and the open goes on.
          const holderAction = lettingGo.get(found.id);
          if (holderAction === undefined) {
            return { outcome: 'held' };
          }
          letGo(found.id);
          await holderAction();
        }
        const now = await nowFor('openLostContactAlert');
        const journey = journeyNamed(journeyId);
        // The silence checked again under the lock, against the row as it
        // now stands: a row held elsewhere, gone, no longer ACTIVE or no
        // longer overdue is skipped, and nothing is written.
        if (journey === undefined || held.has(journey.id) || !isOverdue(journey, now, threshold)) {
          return { outcome: 'skipped' };
        }
        if (journey.responderIds.length === 0) {
          throw new Error(
            'fakeJourneyStore.openLostContactAlert: the journey has no responder rows, so not one ' +
              'outbox message could be written; the transaction is rolled back, and the journey ' +
              'stays ACTIVE rather than being moved with nobody told',
          );
        }
        if (new Set(journey.responderIds).size !== journey.responderIds.length) {
          throw uniqueViolation('one outbox message per (alert, recipient, kind)');
        }
        if (alerts.some((alert) => alert.journeyId === journey.id && alert.state !== 'RESOLVED')) {
          throw uniqueViolation('one alert per journey that is not RESOLVED');
        }
        const alertId = syntheticUuid();
        const messages: StoredMessage[] = journey.responderIds.map((recipientId) => ({
          messageId: syntheticUuid(),
          alertId,
          recipientId,
          kind: 'LOST_CONTACT',
          createdAt: new Date(now.getTime()),
          attempts: 0,
          nextAttemptAt: new Date(now.getTime()),
          sentAt: null,
          lastFailure: null,
          withdrawnAt: null,
        }));
        // Review loops 1 to 3 (approach item 4, step 5): the stand-downs not
        // yet sent nor withdrawn of every alert of the walker's journeys,
        // this journey's and the walker's earlier ones, are withdrawn at this
        // now, in this same step, before the new alert's messages: an earlier
        // "back in contact" or "home" must never reach the port after this
        // alert's lost-contact push. Only for a responder of this journey,
        // who will receive that push (loop 3, D-111): anyone else is still
        // stood down. Another walker's are left alone. Only the kinds that
        // stand a responder down, each opting in (loop 3): the lost-contact
        // messages of an alert that resolved were withdrawn then.
        const walkersJourneyIds = new Set(
          stored.filter((kept) => kept.walkerId === journey.walkerId).map(({ id }) => id),
        );
        const earlierAlertIds = new Set(
          alerts.filter((alert) => walkersJourneyIds.has(alert.journeyId)).map(({ id }) => id),
        );
        for (const message of outbox) {
          if (
            earlierAlertIds.has(message.alertId) &&
            WITHDRAWN_WHEN_OPENED.includes(message.kind) &&
            journey.responderIds.includes(message.recipientId) &&
            message.sentAt === null &&
            message.withdrawnAt === null
          ) {
            message.withdrawnAt = new Date(now.getTime());
          }
        }
        journey.state = 'LOST_CONTACT';
        alerts.push({
          id: alertId,
          journeyId: journey.id,
          state: 'OPEN',
          openedAt: new Date(now.getTime()),
          silentSince: silentSinceOf(journey),
          resolvedAt: null,
          resolution: null,
          acknowledgedBy: null,
          acknowledgedAt: null,
        });
        outbox.push(...messages);
        return {
          outcome: 'opened',
          alertId,
          messages: messages.map(({ messageId, recipientId, kind }) => ({
            messageId,
            recipientId,
            kind,
          })),
        };
      });
    },
    claimDue({ limit, leaseMs }) {
      return answer('claimDue', async (): Promise<ClaimedMessages> => {
        const now = await nowFor('claimDue');
        if (!Number.isInteger(limit) || limit < 0) {
          throw new Error(
            `fakeJourneyStore.claimDue: LIMIT must not be negative, and was ${String(limit)}`,
          );
        }
        const lease = millisecondsOf('claimDue', 'leaseMs', leaseMs);
        const due = outbox
          .filter(
            (message) =>
              message.sentAt === null &&
              // LOST-03 (D-111): a withdrawn message is never handed out again,
              // whatever its due time.
              message.withdrawnAt === null &&
              message.nextAttemptAt.getTime() <= now.getTime(),
          )
          .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
          .slice(0, limit);
        for (const message of due) {
          message.attempts += 1;
          message.nextAttemptAt = new Date(now.getTime() + lease);
        }
        return {
          now,
          messages: due.map(({ messageId, recipientId, kind, attempts }) => ({
            messageId,
            recipientId,
            kind,
            attempts,
          })),
        };
      });
    },
    markSent(messageId) {
      return answer('markSent', async (): Promise<void> => {
        const now = await nowFor('markSent');
        const message = messageNamed('markSent', messageId);
        message.sentAt ??= now;
      });
    },
    markFailed({ messageId, reason, retryAfterMs }) {
      return answer('markFailed', async (): Promise<void> => {
        const now = await nowFor('markFailed');
        const delay = millisecondsOf('markFailed', 'retryAfterMs', retryAfterMs);
        if (!PUSH_FAILURE_REASONS.includes(reason)) {
          throw checkViolation('outbox', 'last_failure');
        }
        const message = messageNamed('markFailed', messageId);
        message.lastFailure = reason;
        message.nextAttemptAt = new Date(now.getTime() + delay);
      });
    },

    addUser(givenId = syntheticUuid()) {
      const id = asStored(givenId);
      users.add(id);
      return id;
    },
    addDevice(givenUserId, givenId = syntheticUuid()) {
      const userId = asStored(givenUserId);
      const id = asStored(givenId);
      if (!users.has(userId)) {
        throw notAUser('device’s user', userId);
      }
      if (devices.has(id)) {
        throw new Error(`fakeJourneyStore.addDevice: a device ${id} is already stored`);
      }
      devices.set(id, userId);
      return id;
    },
    seed({ state, startedAt, lastHeartbeatAt = null, ...given }) {
      const walkerId = asStored(given.walkerId);
      const deviceId = deviceIdOf(given.deviceId);
      const responderIds = given.responderIds.map(asStored);
      const id = asStored(given.id ?? syntheticUuid());
      if (!users.has(walkerId)) {
        throw notAUser('walker', walkerId);
      }
      if (!devices.has(deviceId)) {
        throw notADevice(deviceId);
      }
      const stranger = responderIds.find((responderId) => !users.has(responderId));
      if (stranger !== undefined) {
        throw notAUser('responder', stranger);
      }
      if (stored.some((journey) => journey.id === id)) {
        throw new Error(`fakeJourneyStore.seed: a journey ${id} is already stored`);
      }
      const unended = unendedOf(walkerId);
      if (state !== 'ENDED' && unended !== undefined) {
        throw new Error(
          `fakeJourneyStore.seed: the walker already has an unended journey, ${unended.id}; ` +
            'the database’s partial unique index would refuse a second one too',
        );
      }
      stored.push({
        id,
        walkerId,
        state,
        startedAt: new Date(startedAt.getTime()),
        responderIds,
        deviceId,
        lastHeartbeatAt: lastHeartbeatAt === null ? null : new Date(lastHeartbeatAt.getTime()),
        endedAt: null,
        endReason: null,
      });
      return id;
    },
    setState(journeyId, state) {
      const journey = storedJourney('setState', journeyId);
      const unended = unendedOf(journey.walkerId);
      if (state !== 'ENDED' && unended !== undefined && unended.id !== journey.id) {
        throw new Error(
          `fakeJourneyStore.setState: the walker already has an unended journey, ${unended.id}; ` +
            'the database’s partial unique index would refuse a second one too',
        );
      }
      journey.state = state;
    },
    seedAlert({
      journeyId,
      state,
      openedAt,
      silentSince,
      resolvedAt = null,
      resolution = null,
      acknowledgedBy: givenAcknowledgedBy = null,
      acknowledgedAt = null,
    }) {
      const journey = storedJourney('seedAlert', journeyId);
      if ((resolvedAt === null) !== (resolution === null)) {
        throw checkViolation('alerts', 'resolved_at and resolution, both set or both null');
      }
      // LOST-06 (approach item 7): who and when, both set or both null, and
      // whoever acknowledged a user, as the check and the foreign key hold.
      // No check ties them to the state.
      const acknowledgedBy = givenAcknowledgedBy === null ? null : asStored(givenAcknowledgedBy);
      if ((acknowledgedBy === null) !== (acknowledgedAt === null)) {
        throw checkViolation(
          'alerts',
          'acknowledged_by and acknowledged_at, both set or both null',
        );
      }
      if (acknowledgedBy !== null && !users.has(acknowledgedBy)) {
        throw notAUser('acknowledger', acknowledgedBy);
      }
      if (
        state !== 'RESOLVED' &&
        alerts.some((alert) => alert.journeyId === journey.id && alert.state !== 'RESOLVED')
      ) {
        throw uniqueViolation('one alert per journey that is not RESOLVED');
      }
      const id = syntheticUuid();
      alerts.push({
        id,
        journeyId: journey.id,
        state,
        openedAt: new Date(openedAt.getTime()),
        silentSince: new Date(silentSince.getTime()),
        resolvedAt: copyOf(resolvedAt),
        resolution,
        acknowledgedBy,
        acknowledgedAt: copyOf(acknowledgedAt),
      });
      return id;
    },
    seedMessage({
      alertId: givenAlertId,
      recipientId: givenRecipientId,
      kind,
      createdAt,
      nextAttemptAt,
      attempts = 0,
      sentAt = null,
      lastFailure = null,
      withdrawnAt = null,
    }) {
      const alertId = asStored(givenAlertId);
      const recipientId = asStored(givenRecipientId);
      if (!alerts.some((alert) => alert.id === alertId)) {
        throw new Error(
          `insert violates foreign key constraint: the alert ${alertId} is not an alert`,
        );
      }
      if (!users.has(recipientId)) {
        throw notAUser('recipient', recipientId);
      }
      if (!Number.isInteger(attempts) || attempts < 0) {
        throw checkViolation('outbox', 'attempts');
      }
      if (lastFailure !== null && !PUSH_FAILURE_REASONS.includes(lastFailure)) {
        throw checkViolation('outbox', 'last_failure');
      }
      if (
        outbox.some(
          (message) =>
            message.alertId === alertId &&
            message.recipientId === recipientId &&
            message.kind === kind,
        )
      ) {
        throw uniqueViolation('one outbox message per (alert, recipient, kind)');
      }
      const messageId = syntheticUuid();
      outbox.push({
        messageId,
        alertId,
        recipientId,
        kind,
        createdAt: new Date(createdAt.getTime()),
        attempts,
        nextAttemptAt: new Date(nextAttemptAt.getTime()),
        sentAt: copyOf(sentAt),
        lastFailure,
        withdrawnAt: copyOf(withdrawnAt),
      });
      return messageId;
    },
    removeResponders(journeyId) {
      storedJourney('removeResponders', journeyId).responderIds = [];
    },
    journeys() {
      return stored.map(copy);
    },
    endOf(journeyId) {
      const journey = storedJourney('endOf', journeyId);
      return { endedAt: copyOf(journey.endedAt), endReason: journey.endReason };
    },
    deviceOf(journeyId) {
      return storedJourney('deviceOf', journeyId).deviceId;
    },
    lastHeartbeatAt(journeyId) {
      return copyOf(storedJourney('lastHeartbeatAt', journeyId).lastHeartbeatAt);
    },
    heartbeats() {
      return heartbeats.map((kept) => ({
        ...kept,
        receivedAt: new Date(kept.receivedAt.getTime()),
      }));
    },
    positions() {
      return positions.map((kept) => ({
        ...kept,
        recordedAt: new Date(kept.recordedAt.getTime()),
      }));
    },
    alerts() {
      return alerts.map(copyAlert);
    },
    outbox() {
      return outbox.map(copyMessage);
    },
    hold(journeyId) {
      const journey = storedJourney('hold', journeyId);
      if (!held.has(journey.id)) {
        held.set(journey.id, []);
      }
    },
    release(journeyId) {
      letGo(storedJourney('release', journeyId).id);
    },
    async commitHold(journeyId, holderAction) {
      const id = storedJourney('commitHold', journeyId).id;
      const waiting = held.get(id) ?? [];
      held.delete(id);
      lettingGo.delete(id);
      try {
        await holderAction();
      } finally {
        for (const go of waiting) {
          go();
        }
      }
    },
    holdUntilWaited(journeyId, holderAction = () => undefined) {
      const journey = storedJourney('holdUntilWaited', journeyId);
      if (!held.has(journey.id)) {
        held.set(journey.id, []);
      }
      lettingGo.set(journey.id, holderAction);
    },
    openRequests() {
      return openRequests.map((request) => ({ ...request }));
    },
    get calls() {
      return [...calls];
    },
    failWith(error, only) {
      failure = { error, only };
    },
    recover() {
      failure = null;
    },
    beforeNext(call, action) {
      pending.set(call, [...(pending.get(call) ?? []), action]);
    },
  };
}
