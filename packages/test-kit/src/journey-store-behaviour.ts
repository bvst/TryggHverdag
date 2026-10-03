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
 * Each behaviour is a value — a name and a function — rather than a test of
 * its own, so a runner file states it with `test.each(JOURNEY_STORE_BEHAVIOUR)`
 * and the fake's test file can pin the list of names. Removing one then
 * changes an assertion in a test file, where the gates and test-auditor see
 * it.
 */
import * as fc from 'fast-check';
import { expect } from 'vitest';
import type {
  FakeJourneyState,
  HeartbeatToRecord,
  InsertStartedResult,
  LatestHeartbeat,
  RecordHeartbeatResult,
  StartedJourney,
} from './fake-journey-store.ts';
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
    unendedJourneyOf(walkerId: string): Promise<{ id: string; state: string } | null>;
    existingUsers(ids: readonly string[]): Promise<ReadonlySet<string>>;
    insertStarted(journey: StartedJourney): Promise<InsertStartedResult>;
    journeyForHeartbeat(
      journeyId: string,
    ): Promise<{ id: string; walkerId: string; deviceId: string; state: string } | null>;
    recordHeartbeat(heartbeat: HeartbeatToRecord): Promise<RecordHeartbeatResult>;
    latestHeartbeatOf(journeyId: string): Promise<LatestHeartbeat | null>;
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
  /** Ends the journey directly, as a test's own setup: nothing in the code can end one yet. */
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
    name: 'LOST-01-AC8: a heartbeat for a journey in LOST_CONTACT is recorded and advances last contact, and the journey stays LOST_CONTACT',
    async run(subject) {
      const { journeyId } = await journeyFor(subject, {
        state: 'LOST_CONTACT',
        lastHeartbeatAt: EARLIER,
      });
      const heartbeat = heartbeatFor(journeyId);

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
];
