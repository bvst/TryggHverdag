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
 * journey that has ended takes nothing (SM-07).
 *
 * It is also where the watchdog meets them (LOST-02): its `for update skip
 * locked` skips a journey whose heartbeat is being written, and a heartbeat
 * that arrives while a sweep holds the row waits, and is then stored against
 * LOST_CONTACT, which it brings back if it is fresh (below). That is right
 * only while every transaction on the row is short. No clock is read and no
 * network is called inside one, so they are short as written, and the
 * process pools bound them anyway (D-108, in db.ts): a session idle inside a
 * transaction is ended after 10 s, and the API's statements wait at most 5 s
 * for a row, the outbox's and the users' rows the new paths touch included.
 * A journey skipped past 5 min 30 s gets one attempt that waits for its
 * holder, and one held through that wait is reported by the watchdog, not
 * skipped silently.
 *
 * The watchdog's open is one transaction: the journey's row, taken again only
 * if it is still ACTIVE and overdue by that transaction's now(); the move to
 * LOST_CONTACT, which must change exactly that row; the withdrawal of the
 * unsent stand-downs of every alert of the walker's journeys, and of no other
 * walker's (LOST-03); the alert; and one outbox message per responder, at
 * least one. Any of it failing writes none of it (AR-05). The outbox's claim,
 * its marks and the read of what is overdue are single statements, each timed
 * by the database's now() (REL-01).
 *
 * Back in contact and "I'm home" (LOST-03) take the journey's row first too,
 * so no two of these can wait for each other in a cycle: the claim never
 * waits (`skip locked`), and a mark holds one outbox row for one statement.
 *   - A heartbeat stored for a journey LOST_CONTACT when its row was taken
 *     asks the domain's contact rule, with the silence counted with it and
 *     the transaction's now(). Back in contact, the journey moves to ACTIVE
 *     and its alert is resolved, in the heartbeat's own transaction: a
 *     failure anywhere rolls back the heartbeat too, and the phone resends.
 *   - "I'm home" asks the domain's home rule under the row's lock, with the
 *     walker and the device, and writes what it decides: the journey ended
 *     from the state its row is in when taken, and its alert resolved only
 *     when the rule says so (from LOST_CONTACT), in one transaction (AR-04).
 *   - Resolving is one helper (`resolveInside`), for every path that resolves
 *     an alert: the journey's one unresolved alert goes to RESOLVED; its
 *     lost-contact messages not yet sent are withdrawn, so no claim hands them
 *     out again (D-111); and every responder row gets one stand-down of the
 *     resolution's own kind. A stand-down for a responder whose lost-contact
 *     message may still be in the push port's hands is due only once that
 *     message's lease or retry time has passed, so it never overtakes it.
 *
 * The worker's marks can now wait on two withdrawals, and the worker's pool
 * has no lock limit of its own. The first is the API's, when it resolves an
 * alert: that wait is bounded by the API's limits (each statement waits at
 * most 5 s for a lock, and a frozen transaction is ended after 10 s idle).
 * The second is the open's own, on the worker's pool: a mark waits for the
 * open to commit, and each lock the open waits for after its withdrawal is
 * bounded by the open's own 5 s lock limit (and a frozen open by the worker's
 * 10 s idle limit). Either wait stalls delivery only.
 *
 * Any failure while storing a heartbeat is replaced by a `HeartbeatStoreError`
 * holding PostgreSQL's SQLSTATE and nothing else. PostgreSQL's own error can
 * hold the row it refused ("Failing row contains (…)"), and Drizzle's names
 * the query's parameters: either would carry the position into whatever
 * printed the error. Cleaned here, where it starts, it cannot reach any of
 * them (PRIV-07).
 */
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  alerts,
  heartbeats,
  journeyResponders,
  journeys,
  messageKind,
  outbox,
  positions,
  unended,
  unresolved,
  users,
} from '../db/schema.ts';
import { databaseTime } from '../domain/database-time.ts';
import {
  transition,
  type AlertResolution,
  type JourneyForHeartbeat,
  type JourneyState,
  type UnendedJourney,
} from '../domain/journey.ts';
import { sqlstateOf } from '../domain/sqlstate.ts';
import { LOCK_WAIT_LIMIT_MS } from '../domain/watchdog.ts';
import type {
  AlertMessage,
  ClaimedMessages,
  HeartbeatToRecord,
  HomeToRecord,
  InsertStartedResult,
  JourneyStore,
  LatestHeartbeat,
  MessageKind,
  OpenLostContactAlertResult,
  OpenRequest,
  OutboxStore,
  OverdueJourneys,
  PushFailureReason,
  RecordHeartbeatResult,
  RecordHomeResult,
  StartedJourney,
  WatchdogStore,
} from '../ports.ts';
import type { Database } from './db.ts';

/** A database, or a transaction on one: both can read. */
type Reader = Pick<Database, 'select'>;

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

/** SQLSTATE lock_not_available: a wait for a row ran past its lock_timeout. */
const LOCK_NOT_AVAILABLE = '55P03';

/** The longest lock_timeout PostgreSQL takes, in milliseconds. */
const LOCK_TIMEOUT_MAX_MS = 2_147_483_647;

/** A number of milliseconds as an interval, in SQL. */
const milliseconds = (ms: number) => sql`(${ms}::double precision * interval '1 millisecond')`;

/** When a journey's silence began: its last contact, or its start when it has had none. */
const silentSince = sql`coalesce(${journeys.lastHeartbeatAt}, ${journeys.startedAt})`;

/** A message as the outbox's statements return it: a row, so any column may be read. */
interface MessageRow {
  [column: string]: unknown;
  id: string;
  recipient_id: string;
  kind: MessageKind;
}

const asMessage = (row: MessageRow): AlertMessage => ({
  messageId: row.id,
  recipientId: row.recipient_id,
  kind: row.kind,
});

/**
 * The open, inside its transaction. Throws to roll back: a move that changed
 * no row, or a journey with nobody to tell, is never half-written. Marks
 * `progress.rowTaken` once the journey's row is taken, so a lock that ran out
 * after that is known to be another one.
 */
async function openInside(
  tx: Pick<Database, 'execute' | 'select' | 'update'>,
  { journeyId, afterMs, lockWaitMs }: OpenRequest,
  progress: { rowTaken: boolean },
): Promise<OpenLostContactAlertResult> {
  // Every open bounds its own waits (D-108): `skip locked` covers only the
  // journey's row, and the open takes other locks. Each outbox row's insert
  // takes a key-share lock on its responder's users row, and the alert's
  // insert can wait on the one-unresolved-alert index. Without a limit, one
  // users row held by anything would stop this sweep, and every sweep after
  // it. A waiting open waits that long for the journey's row too. SET LOCAL,
  // for this transaction only: the pool keeps no lock limit of its own.
  // set_config takes parameters; SET does not.
  await tx.execute(
    sql`select set_config('lock_timeout', ${String(lockWaitMs ?? LOCK_WAIT_LIMIT_MS)}, true)`,
  );
  // The row, taken again under the lock with this transaction's now(): a
  // heartbeat committed after the read moved last contact, and a sweep that
  // got here first moved the state, and either one means no row. Without a
  // wait a row someone holds is no row either; with one, PostgreSQL checks
  // the row its holder left.
  const [locked] = await tx
    .select({ id: journeys.id, walkerId: journeys.walkerId })
    .from(journeys)
    .where(
      and(
        eq(journeys.id, journeyId),
        eq(journeys.state, 'ACTIVE'),
        sql`${silentSince} <= now() - ${milliseconds(afterMs)}`,
      ),
    )
    .for('update', lockWaitMs === undefined ? { skipLocked: true } : {});
  progress.rowTaken = true;
  if (locked === undefined) {
    return { outcome: 'skipped' };
  }

  const moved = await tx
    .update(journeys)
    .set({ state: 'LOST_CONTACT' })
    .where(and(eq(journeys.id, journeyId), eq(journeys.state, 'ACTIVE')))
    .returning({ id: journeys.id });
  if (moved.length !== 1) {
    throw new Error('The move to LOST_CONTACT changed no row, so nothing of the alert is kept.');
  }

  // No overtaking (LOST-03, D-112 as amended in review loops 1 and 2): the
  // stand-downs not yet sent of every alert of this walker's journeys, this
  // journey's earlier alerts and the walker's earlier journeys' alike, are
  // withdrawn at this now(), so an earlier "back in contact" or "home",
  // retried for ever, never reaches a responder after this alert's
  // lost-contact push. The walker is the locked row's. Another walker's are
  // left alone: their stand-down is no all-clear for this one. The walker's
  // other journeys are all ENDED (one unended journey per walker), so nothing
  // resolves them meanwhile, and the journey's row is still the first lock
  // taken. Before the new alert is written, so every alert matched is an
  // earlier one; their unsent lost-contact messages were withdrawn when they
  // resolved. In this transaction, so an open that rolls back withdraws
  // nothing. One already in the port's hands was handed over before this
  // alert opened.
  await tx
    .update(outbox)
    .set({ withdrawnAt: sql`now()` })
    .where(
      and(
        inArray(
          outbox.alertId,
          tx
            .select({ id: alerts.id })
            .from(alerts)
            .innerJoin(journeys, eq(journeys.id, alerts.journeyId))
            .where(eq(journeys.walkerId, locked.walkerId)),
        ),
        ne(outbox.kind, 'LOST_CONTACT'),
        isNull(outbox.sentAt),
        isNull(outbox.withdrawnAt),
      ),
    );

  // Silent since the journey's own last contact, copied in SQL so it keeps
  // the database's precision.
  const alert = await tx.execute<{ id: string }>(sql`
    insert into "alerts" ("journey_id", "state", "opened_at", "silent_since")
    select ${journeys.id}, 'OPEN', now(), ${silentSince} from ${journeys}
     where ${journeys.id} = ${journeyId}
    returning "id"`);
  const alertId = alert.rows[0]?.id;
  if (alertId === undefined) {
    throw new Error('The alert was not written, so nothing of it is kept.');
  }

  // One message per responder, each with a new random ID, due at once.
  const messages = await tx.execute<MessageRow>(sql`
    insert into "outbox" ("alert_id", "recipient_id", "kind", "created_at", "attempts",
                          "next_attempt_at")
    select ${alertId}, ${journeyResponders.responderId}, 'LOST_CONTACT', now(), 0, now()
      from ${journeyResponders}
     where ${journeyResponders.journeyId} = ${journeyId}
    returning "id", "recipient_id", "kind"`);
  if (messages.rows.length === 0) {
    // The start rule makes this unreachable. If it happens, the journey
    // stays ACTIVE and overdue, and the watchdog reports it, rather than
    // moving it with nobody told.
    throw new Error('The journey has no responder to tell, so it is not moved.');
  }

  return { outcome: 'opened', alertId, messages: messages.rows.map(asMessage) };
}

/** What resolving an alert came to: the alert, null when there was none unresolved, and the stand-downs. */
interface Resolved {
  alertId: string | null;
  messages: AlertMessage[];
}

/**
 * Resolves the journey's one unresolved alert, inside the transaction that
 * moved the journey, whose row it holds (LOST-03, approach item 4). Every
 * path that resolves an alert calls this, and nothing else does it.
 *
 *   1. The alert, whatever its state, goes to RESOLVED at now(), with the
 *      resolution. LOST-02's index allows at most one; none is answered with
 *      no alert and no messages, and the move stands (reading 11).
 *   2. Its lost-contact messages not sent and not withdrawn are withdrawn at
 *      now() (D-111). The update takes each row's lock, so a claim or a mark
 *      in progress finishes first, and the row is checked again as it left
 *      it: one marked sent meanwhile is not withdrawn, and one claimed comes
 *      back with its new attempt count and lease. Attempts and the last
 *      failure are kept.
 *   3. One stand-down per responder row, of the resolution's own kind, with a
 *      new random ID, due at now(), unless that responder's lost-contact
 *      message was withdrawn having been handed to the port (attempts ≥ 1)
 *      and is due after now(): then at that time, the end of its lease or its
 *      retry, at most 60 s on. So a stand-down is never handed to the port
 *      while the push it stands down may still be in the port's hands. The
 *      unique (alert, recipient, kind) refuses a second one. Steps 2 and 3
 *      are one statement, so the hold copies the time at the database's own
 *      precision.
 */
async function resolveInside(
  tx: Pick<Database, 'execute' | 'update'>,
  journeyId: string,
  resolution: AlertResolution,
): Promise<Resolved> {
  const [alert] = await tx
    .update(alerts)
    .set({ state: 'RESOLVED', resolvedAt: sql`now()`, resolution })
    .where(and(eq(alerts.journeyId, journeyId), unresolved(alerts.state)))
    .returning({ id: alerts.id });
  if (alert === undefined) {
    return { alertId: null, messages: [] };
  }

  const standDowns = await tx.execute<MessageRow>(sql`
    with withdrawn as (
      update ${outbox} set "withdrawn_at" = now()
       where ${outbox.alertId} = ${alert.id}
         and ${outbox.kind} = 'LOST_CONTACT'
         and ${outbox.sentAt} is null
         and ${outbox.withdrawnAt} is null
      returning ${outbox.recipientId}, ${outbox.attempts}, ${outbox.nextAttemptAt}
    )
    insert into "outbox" ("alert_id", "recipient_id", "kind", "created_at", "attempts",
                          "next_attempt_at")
    select ${alert.id}, ${journeyResponders.responderId},
           ${resolution}::${sql.identifier(messageKind.enumName)}, now(), 0,
           case when withdrawn."attempts" >= 1 and withdrawn."next_attempt_at" > now()
                then withdrawn."next_attempt_at"
                else now()
           end
      from ${journeyResponders}
      left join withdrawn on withdrawn."recipient_id" = ${journeyResponders.responderId}
     where ${journeyResponders.journeyId} = ${journeyId}
    returning "id", "recipient_id", "kind"`);

  return { alertId: alert.id, messages: standDowns.rows.map(asMessage) };
}

export function databaseJourneyStore(db: Database): JourneyStore & WatchdogStore & OutboxStore {
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
            // Reachable now that "I'm home" ends journeys: the conflicting
            // journey may end between the conflict and this read. Only the
            // walker's own phone ends one yet, so it is their start racing
            // their own end: answered 500, loudly, and the app's retry then
            // starts. Retrying the insert once here is left for the task that
            // lets someone else end a journey ("They're safe", and the
            // 24-hour rule), where a start can meet an end by chance.
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
          // reverse order of their receive times (SM-09). GREATEST ignores
          // NULLs, so the first heartbeat sets it.
          const at = receivedAt.toISOString();
          const lastContact = tx
            .update(journeys)
            .set({
              lastHeartbeatAt: sql`greatest(${journeys.lastHeartbeatAt}, ${at}::timestamptz)`,
            })
            .where(eq(journeys.id, journeyId));
          if (journey.state !== 'LOST_CONTACT') {
            await lastContact;
            return { outcome: 'recorded' };
          }

          // LOST-03: the locked state was LOST_CONTACT, so the same statement
          // returns the silence's start, counted with this heartbeat, and
          // this transaction's now(); whether contact is back is the
          // domain's, asked with the database's times (REL-01).
          const [contact] = await lastContact.returning({
            silentSince: sql<unknown>`${silentSince}`,
            now: sql<unknown>`now()`,
          });
          if (contact === undefined) {
            throw new Error('The locked journey’s last contact was not moved.');
          }
          const decision = transition(
            { id: journeyId, state: journey.state },
            {
              type: 'contact',
              silentSince: databaseTime(contact.silentSince, 'The heartbeat’s write'),
              now: databaseTime(contact.now, 'The heartbeat’s write'),
            },
          );
          if (decision.type === 'unchanged') {
            return { outcome: 'recorded' };
          }
          const moved = await tx
            .update(journeys)
            .set({ state: decision.state })
            .where(and(eq(journeys.id, journeyId), eq(journeys.state, 'LOST_CONTACT')))
            .returning({ id: journeys.id });
          if (moved.length !== 1) {
            throw new Error('The move back to ACTIVE changed no row, so nothing of it is kept.');
          }
          const resolved = await resolveInside(tx, journeyId, 'BACK_IN_CONTACT');
          return { outcome: 'back_in_contact', ...resolved };
        });
      } catch (error) {
        throw new HeartbeatStoreError(sqlstateOf(error));
      }
    },

    recordHome({ journeyId, walkerId, deviceId }: HomeToRecord): Promise<RecordHomeResult> {
      // Not rewritten as the heartbeat's errors are: nothing here binds a
      // location or a phone number, so no error of this can carry one. The
      // module logs the SQLSTATE alone.
      return db.transaction(async (tx): Promise<RecordHomeResult> => {
        // The journey's row first, as a heartbeat and the watchdog take it,
        // with what the home rule reads: whose it is, its device, its state.
        const [locked] = await tx
          .select({
            id: journeys.id,
            walkerId: journeys.walkerId,
            deviceId: journeys.deviceId,
            state: journeys.state,
          })
          .from(journeys)
          .where(eq(journeys.id, journeyId))
          .for('update');

        // The domain decides under the lock, and its decision is what is
        // written (AR-04). The state the row is in now decides, not the
        // module's read: a journey the watchdog moved to LOST_CONTACT since
        // is ended as SM-04 says, and one a heartbeat brought back is ended
        // from ACTIVE.
        const decision = transition(locked ?? null, { type: 'home', walkerId, deviceId });
        if (decision.type === 'ignored') {
          return { outcome: 'already_ended' };
        }
        if (decision.type === 'refused') {
          // The module asked the same rule about the same journey, and
          // nothing deletes a journey or changes its walker or device, so
          // this cannot happen; if it does, the read is not what this code
          // thinks it is, and a guess would end, or keep, the wrong journey.
          throw new Error(
            `The home rule refused "I’m home" under the journey’s lock (${decision.reason}), ` +
              'though the module’s read allowed it; nothing is written.',
          );
        }
        const from = locked?.state;
        if (from === undefined || from === 'ENDED') {
          // The rule ends only a journey that is there and not ENDED.
          throw new Error('The home rule ended a journey that is not there to end.');
        }

        const ended = await tx
          .update(journeys)
          .set({ state: decision.state, endedAt: sql`now()`, endReason: decision.reason })
          .where(and(eq(journeys.id, journeyId), eq(journeys.state, from)))
          .returning({ id: journeys.id });
        if (ended.length !== 1) {
          throw new Error('The end changed no row, so nothing of it is kept.');
        }
        const resolved: Resolved = decision.resolvesAlert
          ? await resolveInside(tx, journeyId, 'HOME')
          : { alertId: null, messages: [] };
        return { outcome: 'home', from, ...resolved };
      });
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

    async overdueJourneys(afterMs: number): Promise<OverdueJourneys> {
      // One statement, no lock: now() and the journeys silent for afterMs or
      // more by it. The left join keeps now() when none is.
      const result = await db.execute<{
        now: unknown;
        id: string | null;
        state: JourneyState | null;
        silent_since: unknown;
      }>(sql`
        select clock.now, ${journeys.id}, ${journeys.state}, ${silentSince} as silent_since
          from (select now() as now) as clock
          left join ${journeys}
            on ${journeys.state} = 'ACTIVE'
           and ${silentSince} <= clock.now - ${milliseconds(afterMs)}`);
      const [first] = result.rows;
      if (first === undefined) {
        // The left join always returns a row; none means the read is not
        // what this code thinks it is, and a guess would be a guess about
        // whether someone is being watched.
        throw new Error('The overdue read returned no row, not even the time.');
      }
      return {
        now: databaseTime(first.now, 'The overdue read'),
        journeys: result.rows.flatMap(({ id, state, silent_since }) =>
          id === null || state === null
            ? []
            : [{ id, state, silentSince: databaseTime(silent_since, 'The overdue read') }],
        ),
      };
    },

    async openLostContactAlert(request: OpenRequest): Promise<OpenLostContactAlertResult> {
      // Refused before the transaction, so nothing is written and no lock is
      // taken. PostgreSQL reads a lock_timeout of 0 as no limit at all, which
      // a wait must never quietly become.
      const { lockWaitMs } = request;
      if (
        lockWaitMs !== undefined &&
        !(Number.isInteger(lockWaitMs) && lockWaitMs >= 1 && lockWaitMs <= LOCK_TIMEOUT_MAX_MS)
      ) {
        throw new Error(
          `lockWaitMs must be a whole number of milliseconds from 1 to ${String(LOCK_TIMEOUT_MAX_MS)}, ` +
            `not ${String(lockWaitMs)}: PostgreSQL reads a lock_timeout of 0 as no limit at all.`,
        );
      }
      const progress = { rowTaken: false };
      try {
        return await db.transaction((tx) => openInside(tx, request, progress));
      } catch (error) {
        // Only a waiting open's wait for the journey's own row is answered,
        // as held, not thrown: the watchdog reports that journey, and a row
        // someone holds is not a failure of the database. Any other lock that
        // ran out, in either attempt, is a failed open, and is thrown.
        if (
          request.lockWaitMs !== undefined &&
          !progress.rowTaken &&
          sqlstateOf(error) === LOCK_NOT_AVAILABLE
        ) {
          return { outcome: 'held' };
        }
        throw error;
      }
    },

    async claimDue({ limit, leaseMs }): Promise<ClaimedMessages> {
      // One statement: the due messages no other claim holds, one attempt
      // more each, leased until now() plus the lease; and now(), even when
      // nothing is due. A withdrawn message is never due again, whatever its
      // time and whatever a later mark wrote (D-111).
      const result = await db.execute<{
        now: unknown;
        id: string | null;
        recipient_id: string | null;
        kind: MessageKind | null;
        attempts: number | null;
      }>(sql`
        with due as (
          select ${outbox.id} from ${outbox}
           where ${outbox.sentAt} is null and ${outbox.withdrawnAt} is null
             and ${outbox.nextAttemptAt} <= now()
           order by ${outbox.nextAttemptAt}, ${outbox.id}
           limit ${limit}
           for update skip locked
        ), claimed as (
          update ${outbox}
             set "attempts" = ${outbox.attempts} + 1,
                 "next_attempt_at" = now() + ${milliseconds(leaseMs)}
            from due
           where ${outbox.id} = due."id"
          returning ${outbox.id}, ${outbox.recipientId}, ${outbox.kind}, ${outbox.attempts}
        )
        select clock.now, claimed."id", claimed."recipient_id", claimed."kind",
               claimed."attempts"
          from (select now() as now) as clock
          left join claimed on true`);
      const [first] = result.rows;
      if (first === undefined) {
        throw new Error('The claim returned no row, not even the time.');
      }
      return {
        now: databaseTime(first.now, 'The claim'),
        messages: result.rows.flatMap(({ id, recipient_id, kind, attempts }) =>
          id === null || recipient_id === null || kind === null || attempts === null
            ? []
            : [{ ...asMessage({ id, recipient_id, kind }), attempts }],
        ),
      };
    },

    async markSent(messageId: string): Promise<void> {
      // Sent once: a message marked again keeps its first time.
      const marked = await db
        .update(outbox)
        .set({ sentAt: sql`coalesce(${outbox.sentAt}, now())` })
        .where(eq(outbox.id, messageId))
        .returning({ id: outbox.id });
      if (marked.length !== 1) {
        throw new Error('No message by that ID was in the outbox to mark as sent.');
      }
    },

    async markFailed({
      messageId,
      reason,
      retryAfterMs,
    }: {
      messageId: string;
      reason: PushFailureReason;
      retryAfterMs: number;
    }): Promise<void> {
      // A reason outside the port's four is refused by the table's check.
      const marked = await db
        .update(outbox)
        .set({
          lastFailure: reason,
          nextAttemptAt: sql`now() + ${milliseconds(retryAfterMs)}`,
        })
        .where(eq(outbox.id, messageId))
        .returning({ id: outbox.id });
      if (marked.length !== 1) {
        throw new Error('No message by that ID was in the outbox to mark as failed.');
      }
    },
  };
}
