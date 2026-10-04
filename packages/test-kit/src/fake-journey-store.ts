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
 *     transaction (`hold`, as `for update skip locked` skips it). An open
 *     given a `lockWaitMs` waits for a held row instead: a row held by `hold`
 *     never lets go, so the open answers `held`, as a lock wait that runs out
 *     does (55P03); a row held by `holdUntilWaited` is let go, after the
 *     holder's own action, and the open then checks it as it stands. Otherwise
 *     it moves the journey to LOST_CONTACT, opens one OPEN alert at now with
 *     the silence's start, and writes one LOST_CONTACT message per responder,
 *     each with a fresh ID, all of it or none of it. A journey with no
 *     responder is refused, and left as it was;
 *   - one alert per journey that is not RESOLVED, and one message per
 *     (alert, recipient, kind), as the unique indexes hold them;
 *   - a claim takes at most its limit of the due messages (not sent, and due
 *     at or before now), counts one attempt on each, and leases them until
 *     now plus the lease; a message is marked sent at now, or failed with one
 *     of the push port's reasons and due again after the delay given. A reason
 *     outside that set is refused, as the check constraint refuses it;
 *   - a heartbeat for a journey another transaction holds waits until it is
 *     released, as a row lock with no limit makes it wait.
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

/** Stored; already there, so nothing changed (SM-08); or the journey has ENDED, so nothing stored (SM-07). */
export interface RecordHeartbeatResult {
  outcome: 'recorded' | 'duplicate' | 'ended';
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

/** One message an alert's opening wrote, as the open hands it back. */
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
  lockWaitMs?: number;
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

/** An alert as stored: no position, no battery, no phone time (LOST-02-AC13). */
export interface StoredAlert {
  id: string;
  journeyId: string;
  state: FakeAlertState;
  openedAt: Date;
  silentSince: Date;
}

/** An outbox message as stored. Its ID is opaque: never a user's, a journey's or an alert's. */
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
  | 'markFailed';

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
   * forward to its receive time, never back: all of it or none of it.
   */
  recordHeartbeat(heartbeat: HeartbeatToRecord): Promise<RecordHeartbeatResult>;
  /** The heartbeat with the greatest receive time, a tie to the one stored last; null if none. */
  latestHeartbeatOf(journeyId: string): Promise<LatestHeartbeat | null>;

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
   * Puts a stored journey in another state directly, as a test's own setup:
   * nothing in the code can end a journey yet. Keeps the one-unended rule.
   */
  setState(journeyId: string, state: FakeJourneyState): void;
  /** Every journey stored, in the order stored. Copies: changing them changes nothing. */
  journeys(): StoredJourney[];
  /** The device that started this journey (D-101). Throws for a journey not stored. */
  deviceOf(journeyId: string): string;
  /** This journey's last contact, null until its first heartbeat. Throws for a journey not stored. */
  lastHeartbeatAt(journeyId: string): Date | null;
  /** Every heartbeat stored, in arrival order. Copies. */
  heartbeats(): StoredHeartbeat[];
  /** Every position stored, in arrival order. Copies. */
  positions(): StoredPosition[];
  /** Every alert opened, in the order opened. Copies. */
  alerts(): StoredAlert[];
  /** Every outbox message written, in the order written. Copies. */
  outbox(): StoredMessage[];
  /**
   * Stands in for a transaction elsewhere holding this journey's row, one
   * that never lets go by itself: the watchdog's open skips it, an open that
   * waits for it answers `held`, and a heartbeat for it waits, until
   * `release`. Throws for a journey not stored.
   */
  hold(journeyId: string): void;
  /** The row is free again: what waited for it goes on. */
  release(journeyId: string): void;
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

/** A journey as this fake keeps it: what SM-01 reads, and what D-101 and LOST-01 added. */
interface KeptJourney extends StoredJourney {
  deviceId: string;
  lastHeartbeatAt: Date | null;
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
          'journey has been silent or when a message is due. Make it with fakeJourneyStore({ clock }); ' +
          'a fake that guessed the time would prove nothing.',
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
  });
  const copyMessage = (message: StoredMessage): StoredMessage => ({
    ...message,
    createdAt: new Date(message.createdAt.getTime()),
    nextAttemptAt: new Date(message.nextAttemptAt.getTime()),
    sentAt: message.sentAt === null ? null : new Date(message.sentAt.getTime()),
  });

  /** When a journey's silence began: last contact, or its start when it has none. */
  const silentSinceOf = (journey: KeptJourney): Date =>
    new Date((journey.lastHeartbeatAt ?? journey.startedAt).getTime());

  const isOverdue = (journey: KeptJourney, now: Date, afterMs: number): boolean =>
    journey.state === 'ACTIVE' && now.getTime() - silentSinceOf(journey).getTime() >= afterMs;

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
      return answer(
        'recordHeartbeat',
        (): RecordHeartbeatResult => {
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
          if (
            heartbeats.some((kept) => kept.journeyId === journey.id && kept.eventId === eventId)
          ) {
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
              throw new Error(
                'invalid input syntax for type timestamp with time zone: recorded_at',
              );
            }
            if (!isStorableMoment(position.recordedAt)) {
              throw new Error('date/time field value out of range: recorded_at');
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
          // greatest(coalesce(last_heartbeat_at, $t), $t): never backwards.
          const last = journey.lastHeartbeatAt?.getTime() ?? receivedAt.getTime();
          journey.lastHeartbeatAt = new Date(Math.max(last, receivedAt.getTime()));
          return { outcome: 'recorded' };
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
        if (lockWaitMs !== undefined) {
          millisecondsOf('openLostContactAlert', 'lockWaitMs', lockWaitMs);
        }
        const found = journeyNamed(journeyId);
        if (found !== undefined && held.has(found.id)) {
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
          throw new Error(
            'duplicate key value violates unique constraint: one outbox message per ' +
              '(alert, recipient, kind); the transaction is rolled back',
          );
        }
        if (alerts.some((alert) => alert.journeyId === journey.id && alert.state !== 'RESOLVED')) {
          throw new Error(
            'duplicate key value violates unique constraint: one alert per journey that is not ' +
              'RESOLVED; the transaction is rolled back',
          );
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
        }));
        journey.state = 'LOST_CONTACT';
        alerts.push({
          id: alertId,
          journeyId: journey.id,
          state: 'OPEN',
          openedAt: new Date(now.getTime()),
          silentSince: silentSinceOf(journey),
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
              message.sentAt === null && message.nextAttemptAt.getTime() <= now.getTime(),
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
    journeys() {
      return stored.map(copy);
    },
    deviceOf(journeyId) {
      return storedJourney('deviceOf', journeyId).deviceId;
    },
    lastHeartbeatAt(journeyId) {
      const last = storedJourney('lastHeartbeatAt', journeyId).lastHeartbeatAt;
      return last === null ? null : new Date(last.getTime());
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
