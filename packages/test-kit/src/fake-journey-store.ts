/**
 * Journeys, in memory (SM-01, AR-02).
 *
 * Stands in for the adapter over the `journeys`, `journey_responders` and
 * `users` tables, so a system test can put a walker in any situation —
 * including the ones nothing in the code can reach yet, such as a journey in
 * LOST_CONTACT or one that has ENDED — and then look at exactly what was
 * stored.
 *
 * It keeps the database's rules, because a fake that was more forgiving than
 * the database would let the system tests prove the fake:
 *   - one unended journey per walker, as the partial unique index does: a
 *     second start is "not inserted" and names the journey already there;
 *   - a walker and every responder must be users, as the foreign keys do: a
 *     start that names anyone else is refused whole, and leaves nothing;
 *   - a start's journey and its responders are stored together or not at all.
 *
 * The shared behaviour suite (`journey-store-behaviour.ts`) runs the same
 * expectations against this fake and against the real adapter, which is
 * what keeps the two from drifting apart.
 *
 * It can also fail like a database that is gone (`failWith`), and it records
 * which of its port methods were called, so a test can say "the handler never
 * ran". Matches the server's JourneyStore port by shape, so the test kit
 * needs no import from the server.
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

/** A journey as it is stored. */
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
  responderIds: readonly string[];
  startedAt: Date;
}

/** What storing a start came to: stored, or refused by the one-unended-journey rule. */
export type InsertStartedResult =
  { inserted: true; journeyId: string } | { inserted: false; unendedJourneyId: string };

/** The port methods, which `calls` records. */
export type JourneyStoreCall = 'unendedJourneyOf' | 'existingUsers' | 'insertStarted';

export interface FakeJourneyStore {
  /** The walker's journey in any state but ENDED, or null. */
  unendedJourneyOf(walkerId: string): Promise<{ id: string; state: UnendedJourneyState } | null>;
  /** Which of these IDs are users. */
  existingUsers(ids: readonly string[]): Promise<ReadonlySet<string>>;
  /** Stores a start as ACTIVE, unless the walker already has an unended journey. */
  insertStarted(journey: StartedJourney): Promise<InsertStartedResult>;

  /** Makes a user exist, with a fresh ID unless one is given. Returns the ID. */
  addUser(id?: string): string;
  /**
   * Puts a journey in directly, in any state, as a test's own setup. Keeps
   * the database's rules: throws for a second unended journey, or for a
   * walker or responder who is not a user. Returns the journey's ID.
   */
  seed(journey: {
    walkerId: string;
    state: FakeJourneyState;
    responderIds: readonly string[];
    startedAt: Date;
    id?: string;
  }): string;
  /** Every journey stored, in the order stored. Copies: changing them changes nothing. */
  journeys(): StoredJourney[];
  /** The port methods called so far, in order. */
  readonly calls: readonly JourneyStoreCall[];
  /** From now on every port method rejects with this error and changes nothing. */
  failWith(error: Error): void;
  /** Port methods answer again. */
  recover(): void;
}

function copy(journey: StoredJourney): StoredJourney {
  return {
    ...journey,
    startedAt: new Date(journey.startedAt.getTime()),
    responderIds: [...journey.responderIds],
  };
}

export function fakeJourneyStore(): FakeJourneyStore {
  const users = new Set<string>();
  const stored: StoredJourney[] = [];
  const calls: JourneyStoreCall[] = [];
  let failure: Error | null = null;

  const unendedOf = (walkerId: string): StoredJourney | undefined =>
    stored.find((journey) => journey.walkerId === walkerId && journey.state !== 'ENDED');

  /** What a foreign key would refuse, worded as PostgreSQL words it. */
  const notAUser = (role: string, id: string): Error =>
    new Error(`insert violates foreign key constraint: the ${role} ${id} is not a user`);

  /**
   * Answers a turn later, as a real query does, and only then checks for a
   * failure and touches the data — so code that forgot to wait for a write
   * cannot look, to a test, as though it had waited. Each answer is worked
   * out in one step, which is what makes a check and its write atomic here,
   * as the index makes them in the database.
   */
  const answer = <T>(call: JourneyStoreCall, work: () => T): Promise<T> => {
    calls.push(call);
    return Promise.resolve().then(() => {
      if (failure !== null) {
        throw failure;
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
      return answer('existingUsers', () => new Set(ids.filter((id) => users.has(id))));
    },
    insertStarted({ walkerId, responderIds, startedAt }) {
      return answer('insertStarted', (): InsertStartedResult => {
        if (!users.has(walkerId)) {
          throw notAUser('walker', walkerId);
        }
        const unended = unendedOf(walkerId);
        if (unended !== undefined) {
          return { inserted: false, unendedJourneyId: unended.id };
        }
        const stranger = responderIds.find((id) => !users.has(id));
        if (stranger !== undefined) {
          throw notAUser('responder', stranger);
        }
        const journey: StoredJourney = {
          id: syntheticUuid(),
          walkerId,
          state: 'ACTIVE',
          startedAt: new Date(startedAt.getTime()),
          responderIds: [...responderIds],
        };
        stored.push(journey);
        return { inserted: true, journeyId: journey.id };
      });
    },

    addUser(id = syntheticUuid()) {
      users.add(id);
      return id;
    },
    seed({ walkerId, state, responderIds, startedAt, id = syntheticUuid() }) {
      if (!users.has(walkerId)) {
        throw notAUser('walker', walkerId);
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
      stored.push(copy({ id, walkerId, state, startedAt, responderIds }));
      return id;
    },
    journeys() {
      return stored.map(copy);
    },
    get calls() {
      return [...calls];
    },
    failWith(error) {
      failure = error;
    },
    recover() {
      failure = null;
    },
  };
}
