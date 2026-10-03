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
 *     the check constraints refuse it; last contact never moves backwards;
 *   - IDs are UUIDs, matched as PostgreSQL's `uuid` type matches them: the
 *     same ID in upper or lower case is one ID, and every ID the fake holds
 *     or hands back is lower-case, as the database returns it.
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

/** The port methods, which `calls` records. */
export type JourneyStoreCall =
  | 'unendedJourneyOf'
  | 'existingUsers'
  | 'insertStarted'
  | 'journeyForHeartbeat'
  | 'recordHeartbeat'
  | 'latestHeartbeatOf';

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
 * The rules the `heartbeats` and `positions` tables hold by check
 * constraints, which are the contract's (LOST-01's spec, approach items 3 and
 * 7). Written out here because the test kit does not depend on the server;
 * the fake's own tests hold the event ID rule to the contract's constants.
 */
const EVENT_ID = /^[A-Za-z0-9-]{1,64}$/;

function isWithin(value: number, low: number, high: number): boolean {
  return Number.isFinite(value) && value >= low && value <= high;
}

/** What a check constraint would refuse, worded as PostgreSQL words it. */
function checkViolation(table: string, what: string): Error {
  return new Error(`new row for relation "${table}" violates check constraint: ${what}`);
}

export function fakeJourneyStore(): FakeJourneyStore {
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
  const answer = <T>(call: JourneyStoreCall, work: () => T): Promise<T> => {
    calls.push(call);
    pending.get(call)?.shift()?.();
    return Promise.resolve().then(() => {
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
      return answer('recordHeartbeat', (): RecordHeartbeatResult => {
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
        if (!EVENT_ID.test(eventId)) {
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
      });
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
