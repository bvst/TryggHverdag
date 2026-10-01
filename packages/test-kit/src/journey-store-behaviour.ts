/**
 * One set of expectations for every journey store: the in-memory fake and the
 * real adapter over PostgreSQL (SM-01).
 *
 * The system tests run the API against the fake, so they prove the real
 * behaviour only while the fake behaves like the adapter. This suite is what
 * holds them together: the fake's own tests run it at L2, and the adapter's
 * integration test runs it at L3 against the real tables. A rule kept by one
 * and not the other fails in one of the two runs.
 *
 * What both must do:
 *   - one unended journey per walker: a second start is "not inserted" and
 *     names the journey already there, also when many starts race;
 *   - an ENDED journey blocks nothing and is never reported as unended;
 *   - a start is written whole or not at all, and a walker or responder who
 *     is not a user is refused, not half-stored;
 *   - `existingUsers` names exactly the IDs that are users.
 *
 * Each behaviour is a value — a name and a function — rather than a test of
 * its own, so a runner file states it with `test.each(JOURNEY_STORE_BEHAVIOUR)`
 * and the fake's test file can pin the list of names. Removing one then
 * changes an assertion in a test file, where the gates and test-auditor see
 * it.
 */
import { expect } from 'vitest';
import type {
  FakeJourneyState,
  InsertStartedResult,
  StartedJourney,
} from './fake-journey-store.ts';
import { syntheticUuid } from './synthetic-ids.ts';

/** A journey as a store under test holds it. */
export interface JourneyAsStored {
  id: string;
  walkerId: string;
  state: string;
  startedAt: Date;
  responderIds: readonly string[];
}

/**
 * A journey store, with what a test needs around it: making users, putting a
 * journey in directly, and reading back everything a walker has.
 */
export interface JourneyStoreUnderTest {
  store: {
    unendedJourneyOf(walkerId: string): Promise<{ id: string; state: string } | null>;
    existingUsers(ids: readonly string[]): Promise<ReadonlySet<string>>;
    insertStarted(journey: StartedJourney): Promise<InsertStartedResult>;
  };
  /** A new user, by the store's own means: a row in the real table, an entry in the fake. */
  addUser(): Promise<string>;
  /** A journey put in directly, in any state; resolves to its ID. */
  seedJourney(journey: {
    walkerId: string;
    state: FakeJourneyState;
    responderIds: readonly string[];
    startedAt: Date;
  }): Promise<string>;
  /** Every journey the walker has, as stored, in any order. */
  journeysOf(walkerId: string): Promise<JourneyAsStored[]>;
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

      const result = await subject.store.insertStarted({
        walkerId,
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
        const journeyId = await subject.seedJourney({
          walkerId,
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
        const journeyId = await subject.seedJourney({
          walkerId,
          state,
          responderIds: [earlier],
          startedAt: EARLIER,
        });
        const before = normalised(await subject.journeysOf(walkerId));

        const result = await subject.store.insertStarted({
          walkerId,
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
      const endedId = await subject.seedJourney({
        walkerId,
        state: 'ENDED',
        responderIds: [earlier],
        startedAt: EARLIER,
      });

      const journeyId = insertedId(
        await subject.store.insertStarted({
          walkerId,
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
        state: 'ACTIVE',
        responderIds: [responderId],
        startedAt: EARLIER,
      });

      const result = await subject.store.insertStarted({
        walkerId: second,
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

        // Promise.all rejects if any start fails outright, which is the
        // "no unhandled error" half of the rule.
        const results = await Promise.all(
          Array.from({ length: RACERS }, () =>
            subject.store.insertStarted({
              walkerId,
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
    name: 'a responder who is not a user is refused whole: the store rejects, and leaves no journey',
    async run(subject) {
      const [walkerId = '', responderId = ''] = await users(subject, 2);

      await expect(
        subject.store.insertStarted({
          walkerId,
          responderIds: [responderId, syntheticUuid()],
          startedAt: STARTED_AT,
        }),
      ).rejects.toThrow();

      expect(await subject.journeysOf(walkerId)).toEqual([]);
      expect(await subject.store.unendedJourneyOf(walkerId)).toBeNull();
      // And nothing half-written is left to block the walker's next start.
      const retried = await subject.store.insertStarted({
        walkerId,
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

      await expect(
        subject.store.insertStarted({
          walkerId: stranger,
          responderIds: [responderId],
          startedAt: STARTED_AT,
        }),
      ).rejects.toThrow();

      expect(await subject.journeysOf(stranger)).toEqual([]);
    },
  },
];
