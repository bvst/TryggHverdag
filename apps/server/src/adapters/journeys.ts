/**
 * Journeys, their responders, their heartbeats and the users all of them must
 * be, in PostgreSQL (SM-01, LOST-01).
 *
 * The domain decides; this stores what it decided, and the database enforces
 * the rules a read cannot. Two starts that race past `unendedJourneyOf` both
 * meet the partial unique index `journeys_one_unended_per_walker`. The insert
 * names that index as its conflict target and does nothing on a conflict, so
 * the second start waits for the first, inserts nothing, and is told which
 * journey won.
 *
 * A journey and its responders are written in one transaction, and a start
 * with no responders is refused before it opens. A journey without its
 * responders, even for a moment, is one the watchdog would alert nobody about.
 * The journey records the device that sent the start (D-101).
 *
 * A heartbeat is written in one transaction that first locks its journey's
 * row. That lock is where racing heartbeats meet: copies of one event are
 * stored once (SM-08), last contact only ever moves forward (SM-09), and a
 * journey that has ended takes nothing (SM-07). It is also where the watchdog
 * will meet them: its `for update skip locked` skips a journey whose heartbeat
 * is being written, which is right, because that phone is alive. No clock is
 * read inside the transaction, so it stays short.
 *
 * Any failure while storing a heartbeat is replaced by a `HeartbeatStoreError`
 * holding PostgreSQL's SQLSTATE and nothing else. PostgreSQL's own error can
 * hold the row it refused ("Failing row contains (…)"), and Drizzle's names
 * the query's parameters: either would carry the position into whatever
 * printed the error. Cleaned here, where it starts, it cannot reach any of
 * them (PRIV-07).
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  heartbeats,
  journeyResponders,
  journeys,
  positions,
  unended,
  users,
} from '../db/schema.ts';
import type { JourneyForHeartbeat, UnendedJourney } from '../domain/journey.ts';
import type {
  HeartbeatToRecord,
  InsertStartedResult,
  JourneyStore,
  LatestHeartbeat,
  RecordHeartbeatResult,
  StartedJourney,
} from '../ports.ts';
import type { Database } from './db.ts';

/** A database, or a transaction on one: both can read. */
type Reader = Pick<Database, 'select'>;

/** PostgreSQL's error codes: exactly five of 0-9 and A-Z. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/** How many causes deep a SQLSTATE is looked for: Drizzle wraps PostgreSQL's error once. */
const CAUSE_DEPTH = 5;

/**
 * Storing a heartbeat failed. A fixed message, the SQLSTATE when there is one,
 * and nothing else: no cause, no detail, no parameters, so nothing of the
 * heartbeat can be printed from it, however deep anything looks.
 */
export class HeartbeatStoreError extends Error {
  readonly code: string | null;

  constructor(code: string | null) {
    super('The heartbeat could not be stored.');
    this.name = 'HeartbeatStoreError';
    this.code = code;
  }
}

/** The first SQLSTATE in an error or its causes, or null. Only the code is read, never a message. */
function sqlstateOf(error: unknown): string | null {
  let current = error;
  for (let depth = 0; depth < CAUSE_DEPTH && current instanceof Error; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && SQLSTATE.test(code)) {
      return code;
    }
    current = current.cause;
  }
  return null;
}

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

    async insertStarted({ walkerId, deviceId, responderIds, startedAt }: StartedJourney) {
      // The domain refuses an empty list first, as NO_RESPONDER. Refused here
      // too, before anything is written: a journey with nobody to alert is
      // never stored, whoever calls.
      if (responderIds.length === 0) {
        throw new Error('A journey needs at least one responder; none was given.');
      }
      return db.transaction(async (tx): Promise<InsertStartedResult> => {
        const [journey] = await tx
          .insert(journeys)
          .values({ walkerId, deviceId, state: 'ACTIVE', startedAt })
          .onConflictDoNothing({ target: journeys.walkerId, where: unended(journeys.state) })
          .returning({ id: journeys.id });

        if (journey === undefined) {
          // The index refused it: the walker has an unended journey. Read in
          // this transaction, after the conflict, so it sees the journey that
          // won the race. That relies on READ COMMITTED, PostgreSQL's default:
          // each statement takes a fresh snapshot, so this read sees the
          // winner the insert waited for. Under REPEATABLE READ (or
          // SERIALIZABLE), a conflict with a journey this transaction's
          // snapshot cannot see raises 40001 instead.
          const winner = await unendedJourneyOf(tx, walkerId);
          if (winner === null) {
            // Unreachable while no journey can end: the conflicting journey
            // is still unended when this reads it. Once one can end (tasks 4
            // and 7), it may end between the conflict and this read; then the
            // start should retry the insert once rather than answer 500.
            throw new Error(
              'A start was refused as a second unended journey, and no unended journey was found.',
            );
          }
          return { inserted: false, unendedJourneyId: winner.id };
        }

        await tx
          .insert(journeyResponders)
          .values(responderIds.map((responderId) => ({ journeyId: journey.id, responderId })));

        return { inserted: true, journeyId: journey.id };
      });
    },

    async journeyForHeartbeat(journeyId: string): Promise<JourneyForHeartbeat | null> {
      const rows = await db
        .select({
          id: journeys.id,
          walkerId: journeys.walkerId,
          deviceId: journeys.deviceId,
          state: journeys.state,
        })
        .from(journeys)
        .where(eq(journeys.id, journeyId))
        .limit(1);
      return rows[0] ?? null;
    },

    async recordHeartbeat({
      journeyId,
      eventId,
      receivedAt,
      batteryLevel,
      position,
    }: HeartbeatToRecord): Promise<RecordHeartbeatResult> {
      try {
        return await db.transaction(async (tx): Promise<RecordHeartbeatResult> => {
          // The journey's row, locked until this transaction ends: racing
          // heartbeats for one journey take their turns here.
          const [journey] = await tx
            .select({ state: journeys.state })
            .from(journeys)
            .where(eq(journeys.id, journeyId))
            .for('update');
          if (journey === undefined) {
            // Nothing deletes a journey before the retention work, so one
            // that was read and is gone is an error, not a guess.
            throw new Error('The journey a heartbeat names was not found to lock.');
          }
          if (journey.state === 'ENDED') {
            return { outcome: 'ended' };
          }

          const [stored] = await tx
            .insert(heartbeats)
            .values({ journeyId, eventId, receivedAt, batteryLevel })
            .onConflictDoNothing({ target: [heartbeats.journeyId, heartbeats.eventId] })
            .returning({ id: heartbeats.id });
          if (stored === undefined) {
            // This journey already has this event: nothing changes, last
            // contact included (SM-08).
            return { outcome: 'duplicate' };
          }

          if (position !== null) {
            await tx.insert(positions).values({
              heartbeatId: stored.id,
              latitude: position.latitude,
              longitude: position.longitude,
              accuracyMeters: position.accuracyMeters,
              recordedAt: position.recordedAt,
            });
          }

          // Never backwards, even when two heartbeats take the lock in the
          // reverse order of their receive times (SM-09).
          const at = receivedAt.toISOString();
          await tx
            .update(journeys)
            .set({
              lastHeartbeatAt: sql`greatest(coalesce(${journeys.lastHeartbeatAt}, ${at}::timestamptz), ${at}::timestamptz)`,
            })
            .where(eq(journeys.id, journeyId));

          return { outcome: 'recorded' };
        });
      } catch (error) {
        throw new HeartbeatStoreError(sqlstateOf(error));
      }
    },

    async latestHeartbeatOf(journeyId: string): Promise<LatestHeartbeat | null> {
      const rows = await db
        .select({
          receivedAt: heartbeats.receivedAt,
          batteryLevel: heartbeats.batteryLevel,
          positionOf: positions.heartbeatId,
        })
        .from(heartbeats)
        .leftJoin(positions, eq(positions.heartbeatId, heartbeats.id))
        .where(eq(heartbeats.journeyId, journeyId))
        .orderBy(desc(heartbeats.receivedAt), desc(heartbeats.id))
        .limit(1);
      const latest = rows[0];
      return latest === undefined
        ? null
        : {
            receivedAt: latest.receivedAt,
            // "Location unavailable" is the latest heartbeat having none.
            hasPosition: latest.positionOf !== null,
            batteryLevel: latest.batteryLevel,
          };
    },
  };
}
