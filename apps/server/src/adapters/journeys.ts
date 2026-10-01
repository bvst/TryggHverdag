/**
 * Journeys, their responders and the users both must be, in PostgreSQL (SM-01).
 *
 * The domain decides; this stores what it decided, and the database enforces
 * the one rule a read cannot: two starts that race past `unendedJourneyOf`
 * both meet the partial unique index `journeys_one_unended_per_walker`. The
 * insert names that index as its conflict target and does nothing on a
 * conflict, so the second start waits for the first, inserts nothing, and is
 * told which journey won.
 *
 * A journey and its responders are written in one transaction. A journey
 * without its responders, even for a moment, is one the watchdog would alert
 * nobody about.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { journeyResponders, journeys, unended, users } from '../db/schema.ts';
import type { UnendedJourney } from '../domain/journey.ts';
import type { InsertStartedResult, JourneyStore, StartedJourney } from '../ports.ts';
import type { Database } from './db.ts';

/** A database, or a transaction on one: both can read. */
type Reader = Pick<Database, 'select'>;

async function unendedJourneyOf(db: Reader, walkerId: string): Promise<UnendedJourney | null> {
  const rows = await db
    .select({ id: journeys.id, state: journeys.state })
    .from(journeys)
    .where(and(eq(journeys.walkerId, walkerId), unended(journeys.state)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  if (row.state === 'ENDED') {
    // The query asks for anything but ENDED, so this cannot happen; if it
    // ever does, the read is not what this code thinks it is, and a guess
    // either way would be a guess about whether someone is being watched.
    throw new Error(`An ended journey was read as unended: ${row.id}.`);
  }
  return { id: row.id, state: row.state };
}

export function databaseJourneyStore(db: Database): JourneyStore {
  return {
    unendedJourneyOf(walkerId: string): Promise<UnendedJourney | null> {
      return unendedJourneyOf(db, walkerId);
    },

    async existingUsers(ids: readonly string[]): Promise<ReadonlySet<string>> {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, [...ids]));
      return new Set(rows.map((row) => row.id));
    },

    insertStarted({ walkerId, responderIds, startedAt }: StartedJourney) {
      return db.transaction(async (tx): Promise<InsertStartedResult> => {
        const [journey] = await tx
          .insert(journeys)
          .values({ walkerId, state: 'ACTIVE', startedAt })
          .onConflictDoNothing({ target: journeys.walkerId, where: unended(journeys.state) })
          .returning({ id: journeys.id });

        if (journey === undefined) {
          // The index refused it: the walker has an unended journey. Read in
          // this transaction, after the conflict, so it sees the journey that
          // won the race.
          const winner = await unendedJourneyOf(tx, walkerId);
          if (winner === null) {
            throw new Error(
              'A start was refused as a second unended journey, and no unended journey was found.',
            );
          }
          return { inserted: false, unendedJourneyId: winner.id };
        }

        // An empty list is refused by the domain before this, and Drizzle
        // refuses one too: inserting no rows throws, so the transaction rolls
        // back and no journey is left without responders.
        await tx
          .insert(journeyResponders)
          .values(responderIds.map((responderId) => ({ journeyId: journey.id, responderId })));

        return { inserted: true, journeyId: journey.id };
      });
    },
  };
}
