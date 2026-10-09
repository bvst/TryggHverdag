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
 * unsent stand-downs (BACK_IN_CONTACT, HOME) of every alert of the walker's
 * journeys, and of no other walker's, for recipients who are responders of
 * this journey only (LOST-03); the alert; and one outbox message per
 * responder, none when the journey has no responder row left (SM-10, D-122
 * item 3: its alert is then counted unheard, and the SMS check pages). Any of
 * it failing writes none of it (AR-05). The outbox's claim, its marks and the
 * read of what is overdue are single statements, each timed by the
 * database's now() (REL-01).
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
 *     messages of the kinds withdrawn on resolution (WITHDRAWN_WHEN_RESOLVED:
 *     lost-contact pushes, the notices that someone is on it, and the
 *     escalation SMS) not yet sent are withdrawn, so no claim hands them out
 *     again (D-111, D-113, LOST-07); and every responder row gets one
 *     stand-down, by push, of the resolution's own kind. A stand-down for a
 *     responder with a withdrawn message that may still be in a port's hands,
 *     the push port's or the SMS port's, is due only once the latest such
 *     lease or retry time has passed, so it never overtakes any of them
 *     (D-114).
 *
 * "I'm on it" (LOST-06) reads the alert first without a lock, so a refusal
 * never holds a row. One that would record takes the alert's journey's row
 * first too, asks the domain's alert rule again under it, and writes the
 * acknowledgement and one notice per other responder in one transaction
 * (AR-04, AR-05), withdrawing the alert's escalation SMS not yet sent
 * (LOST-07). It never holds an ACTIVE journey's row for more than the moment
 * it takes to find the alert resolved, so it cannot hide a journey from the
 * watchdog's open.
 *
 * The escalation to SMS (LOST-07) reads the alerts due without a lock, those
 * whose journey has a responder row, and escalates each in a transaction of
 * its own, written as the open is: its own lock limit; the alert's journey's
 * row first (D-112), skipped when held unless told to wait; the domain's
 * escalation rule asked again under it with the transaction's now(); and,
 * unless the journey has lost its last responder since the read (then
 * skipped, SM-10), the alert ESCALATED at now(), and one LOST_CONTACT_SMS per
 * responder row, all of it or none of it. It takes the
 * journey's row, then the alert's, then the new outbox rows, the order "I'm
 * on it" takes them, and only an unresolved alert's journey is LOST_CONTACT,
 * which the open never takes. The two claims each take their own channel's
 * kinds (PUSH_KINDS, SMS_KINDS), so no message ever reaches the other port,
 * and the count of failing SMS is one statement, timed by now().
 *
 * "They're safe" (LOST-08, D-126) reads the alert as "I'm on it" does, without
 * a lock, so a refusal never holds a row. A close the rule allows takes the
 * alert's journey's row first, waiting for it (a person's action, bounded by
 * the API's lock limit), asks the domain's close rule again under it, and in
 * one transaction ends the journey (ENDED, SAFE, at now(), guarded by
 * LOST_CONTACT) and resolves its alert SAFE through `resolveInside`, which
 * stands down every responder row but the closer's (AR-04, AR-05).
 *
 * The 24-hour end (SM-06, LOST-08) reads the unresolved alerts opened
 * ALERT_EXPIRES_AFTER_MS or more before now(), without a lock, and ends each
 * in a transaction of its own, written as the escalation is: its own lock
 * limit; the alert's journey's row first, skipped when held unless told to
 * wait; under it, the journey's state, its one unresolved alert, that alert's
 * opening and now(); skipped when that alert is not the one named or the
 * domain's 24-hour rule leaves the journey as it is; otherwise the journey
 * ENDED, EXPIRED, at now(), and its alert resolved EXPIRED through
 * `resolveInside`, every responder row stood down, all of it or none of it.
 *
 * Removing a responder (SM-10, D-122, D-123) reads the journey and its
 * responders without a lock, and removes in one transaction with its own lock
 * limit, whichever pool runs it: the journey's row first, the domain's
 * removal rule asked again under it, then the responder's row deleted, the
 * alert they are recorded on reset (OPEN, nobody recorded, no escalation
 * time, its round raised, its unsent notices withdrawn), their unsent
 * messages of the journey's alerts withdrawn, and the walker's warning
 * written when they were the last. The journey's row, then the responder's,
 * then the alert's, then outbox rows: the order every other path takes them.
 *
 * Every message is written with its alert's round, read in the statement
 * that writes it, so it cannot drift; the walker's warning, a journey's
 * message, in round 1. The outbox's unique (alert, recipient, kind, round)
 * refuses a second message of a kind in one round, and takes the next
 * round's.
 *
 * The worker's marks can now wait on four withdrawals, and the worker's pool
 * has no lock limit of its own. The first is the API's, when it resolves an
 * alert, a close included: that wait is bounded by the API's limits (each
 * statement waits at most 5 s for a lock, and a frozen transaction is ended
 * after 10 s idle). The second is the open's own, on the worker's pool: a
 * mark waits for the open to commit, and each lock the open waits for after
 * its withdrawal is bounded by the open's own 5 s lock limit (and a frozen
 * open by the worker's 10 s idle limit). The third is the removal's, bounded
 * by its own 5 s lock limit and the pools' 10 s idle limit. The fourth is the
 * 24-hour end's, on the worker's pool, bounded as the open's is. Each wait
 * stalls delivery only.
 *
 * Any failure while storing a heartbeat is replaced by a `HeartbeatStoreError`
 * holding PostgreSQL's SQLSTATE and nothing else. PostgreSQL's own error can
 * hold the row it refused ("Failing row contains (…)"), and Drizzle's names
 * the query's parameters: either would carry the position into whatever
 * printed the error. Cleaned here, where it starts, it cannot reach any of
 * them (PRIV-07).
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
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
  ALERT_EXPIRES_AFTER_MS,
  ALERT_RESOLUTIONS,
  PUSH_KINDS,
  SMS_KINDS,
  WITHDRAWN_WHEN_ACKNOWLEDGED,
  WITHDRAWN_WHEN_REMOVED,
  WITHDRAWN_WHEN_RESET,
  WITHDRAWN_WHEN_RESOLVED,
  alertTransition,
  transition,
  type AlertForAcknowledgement,
  type AlertResolution,
  type AlertState,
  type JourneyForHeartbeat,
  type JourneyForRemoval,
  type JourneyState,
  type UnendedJourney,
} from '../domain/journey.ts';
import { sqlstateOf } from '../domain/sqlstate.ts';
import { LOCK_WAIT_LIMIT_MS } from '../domain/watchdog.ts';
import type {
  AcknowledgementToRecord,
  AlertMessage,
  AlertStore,
  ClaimedMessages,
  ClosureStore,
  ClosureToRecord,
  DueAlerts,
  EscalateAlertResult,
  EscalateRequest,
  ExpireAlertResult,
  ExpireRequest,
  ExpiringAlerts,
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
  RecordAcknowledgementResult,
  RecordClosureResult,
  RecordHeartbeatResult,
  RecordHomeResult,
  RemovalToRecord,
  RemoveResponderResult,
  ResponderStore,
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

/**
 * The alert as "I'm on it" reads it (LOST-06): its state, who is on it, and
 * its journey's responders, one row each; or null for an ID no alert has. A
 * plain read, by the database or inside a transaction: it takes no lock.
 */
async function alertForAcknowledgement(
  db: Reader,
  alertId: string,
): Promise<AlertForAcknowledgement | null> {
  const rows = await db
    .select({
      id: alerts.id,
      state: alerts.state,
      acknowledgedBy: alerts.acknowledgedBy,
      responderId: journeyResponders.responderId,
    })
    .from(alerts)
    .leftJoin(journeyResponders, eq(journeyResponders.journeyId, alerts.journeyId))
    .where(eq(alerts.id, alertId));
  const [first] = rows;
  if (first === undefined) {
    return null;
  }
  return {
    id: first.id,
    state: first.state,
    acknowledgedBy: first.acknowledgedBy,
    responderIds: rows.flatMap(({ responderId }) => (responderId === null ? [] : [responderId])),
  };
}

/**
 * The journey as a removal reads it (SM-10): its state and its responder
 * rows, one row each; or null for an ID no journey has. A plain read: it
 * takes no lock.
 */
async function journeyForRemoval(db: Reader, journeyId: string): Promise<JourneyForRemoval | null> {
  const rows = await db
    .select({
      id: journeys.id,
      state: journeys.state,
      responderId: journeyResponders.responderId,
    })
    .from(journeys)
    .leftJoin(journeyResponders, eq(journeyResponders.journeyId, journeys.id))
    .where(eq(journeys.id, journeyId));
  const [first] = rows;
  if (first === undefined) {
    return null;
  }
  return {
    id: first.id,
    state: first.state,
    responderIds: rows.flatMap(({ responderId }) => (responderId === null ? [] : [responderId])),
  };
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
 * no row is never half-written. Marks `progress.rowTaken` once the journey's
 * row is taken, so a lock that ran out after that is known to be another
 * one.
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

  // No overtaking (LOST-03, D-112 as amended in review loops 1 to 3): the
  // stand-downs not yet sent of every alert of this walker's journeys, this
  // journey's earlier alerts and the walker's earlier journeys' alike, are
  // withdrawn at this now(), so an earlier "back in contact" or "home",
  // retried for ever, never reaches a responder after this alert's
  // lost-contact push. The walker is the locked row's. Another walker's are
  // left alone: their stand-down is no all-clear for this one. Only for a
  // recipient who is a responder of this journey, whom this alert's push will
  // reach (loop 3): anyone else heard of the earlier loss and is still stood
  // down (D-111). A plain read of the responders, so no new lock. Only the
  // stand-down kinds, the domain's resolutions, each opting in (loop 3): a
  // kind added later is not withdrawn by default. The walker's other journeys
  // are all ENDED (one unended journey per walker), so nothing resolves them
  // meanwhile, and the journey's row is still the first lock taken. Before the
  // new alert is written, so every alert matched is an earlier one; their
  // unsent lost-contact messages were withdrawn when they resolved. In this
  // transaction, so an open that rolls back withdraws nothing. One already in
  // the port's hands was handed over before this alert opened.
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
        inArray(
          outbox.recipientId,
          tx
            .select({ id: journeyResponders.responderId })
            .from(journeyResponders)
            .where(eq(journeyResponders.journeyId, locked.id)),
        ),
        inArray(outbox.kind, ALERT_RESOLUTIONS),
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

  // One message per responder, each with a new random ID, due at once, in
  // the alert's round. A journey whose last responder was removed gets none:
  // it is opened all the same (SM-10, D-122 item 3), so it is LOST_CONTACT
  // on record, the sweep stays healthy, and the SMS check counts its alert
  // unheard and pages the owner.
  const messages = await tx.execute<MessageRow>(sql`
    insert into "outbox" ("alert_id", "recipient_id", "kind", "round", "created_at", "attempts",
                          "next_attempt_at")
    select ${alerts.id}, ${journeyResponders.responderId}, 'LOST_CONTACT', ${alerts.round}, now(),
           0, now()
      from ${journeyResponders}
      join ${alerts} on ${alerts.id} = ${alertId}
     where ${journeyResponders.journeyId} = ${journeyId}
    returning "id", "recipient_id", "kind"`);

  return { outcome: 'opened', alertId, messages: messages.rows.map(asMessage) };
}

/**
 * Refuses, before any transaction, a wait PostgreSQL would read as something
 * else: a lock_timeout of 0 is no limit at all, which a wait must never
 * quietly become.
 */
function checkLockWait(lockWaitMs: number | undefined): void {
  if (
    lockWaitMs !== undefined &&
    !(Number.isInteger(lockWaitMs) && lockWaitMs >= 1 && lockWaitMs <= LOCK_TIMEOUT_MAX_MS)
  ) {
    throw new Error(
      `lockWaitMs must be a whole number of milliseconds from 1 to ${String(LOCK_TIMEOUT_MAX_MS)}, ` +
        `not ${String(lockWaitMs)}: PostgreSQL reads a lock_timeout of 0 as no limit at all.`,
    );
  }
}

/**
 * Runs a transaction that takes a journey's row first, as the open and the
 * escalation do. Only a waiting attempt's wait for that row is answered, as
 * held, not thrown: the watchdog reports it, and a row someone holds is not a
 * failure of the database. Any other lock that ran out, in either attempt, is
 * a failure, and is thrown.
 */
async function takingTheRow<T>(
  db: Database,
  lockWaitMs: number | undefined,
  inside: (
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    progress: { rowTaken: boolean },
  ) => Promise<T>,
): Promise<T | { outcome: 'held' }> {
  checkLockWait(lockWaitMs);
  const progress = { rowTaken: false };
  try {
    return await db.transaction((tx) => inside(tx, progress));
  } catch (error) {
    if (
      lockWaitMs !== undefined &&
      !progress.rowTaken &&
      sqlstateOf(error) === LOCK_NOT_AVAILABLE
    ) {
      return { outcome: 'held' };
    }
    throw error;
  }
}

/** A database time that may be null, as null; any other value as `databaseTime` reads it. */
function momentOrNull(value: unknown, what: string): Date | null {
  return value === null ? null : databaseTime(value, what);
}

/** The kind the escalation writes, cast to the enum as `resolveInside` casts its own. */
const ESCALATION_SMS = 'LOST_CONTACT_SMS' satisfies MessageKind;

/**
 * The escalation, inside its transaction (LOST-07). Throws to roll back: a
 * move that changed no row is never half-written. Marks `progress.rowTaken`
 * once the journey's row is taken, so a lock that ran out after that is known
 * to be another one.
 */
async function escalateInside(
  tx: Pick<Database, 'execute' | 'select' | 'update'>,
  { alertId, lockWaitMs }: EscalateRequest,
  progress: { rowTaken: boolean },
): Promise<EscalateAlertResult> {
  // Every escalation bounds its own waits, as every open does (D-108): the
  // worker's pool has no lock limit, and the outbox's inserts take key-share
  // locks on the responders' users rows. SET LOCAL, for this transaction.
  await tx.execute(
    sql`select set_config('lock_timeout', ${String(lockWaitMs ?? LOCK_WAIT_LIMIT_MS)}, true)`,
  );
  // The journey's row first (D-112), named by the alert, in any state: the
  // alert decides, not the journey. Without a wait, a row someone holds is
  // no row; with one, PostgreSQL waits at most the lock limit for it.
  const [locked] = await tx
    .select({ id: journeys.id })
    .from(journeys)
    .where(
      eq(
        journeys.id,
        tx.select({ journeyId: alerts.journeyId }).from(alerts).where(eq(alerts.id, alertId)),
      ),
    )
    .for('update', lockWaitMs === undefined ? { skipLocked: true } : {});
  progress.rowTaken = true;
  if (locked === undefined) {
    return { outcome: 'skipped' };
  }

  // The rule, asked again under the lock with what the alert holds now and
  // this transaction's now() (AR-04): an acknowledgement, a resolution, a
  // removal or another sweep's escalation committed since the read is met
  // here. With it, whether the journey has a responder row left to text:
  // every removal takes the journey's row first, so none goes while it is
  // held.
  const read = await tx.execute<{
    state: AlertState;
    acknowledged_by: string | null;
    sms_raised_at: unknown;
    opened_at: unknown;
    now: unknown;
    heard: unknown;
  }>(sql`
    select ${alerts.state}, ${alerts.acknowledgedBy}, ${alerts.smsRaisedAt}, ${alerts.openedAt},
           now() as now,
           exists (select 1 from ${journeyResponders}
                    where ${journeyResponders.journeyId} = ${alerts.journeyId}) as heard
      from ${alerts}
     where ${alerts.id} = ${alertId}`);
  const [alert] = read.rows;
  if (alert === undefined) {
    // The row lock was found through this alert, and nothing deletes one.
    throw new Error('The alert to escalate was not found under its journey’s lock.');
  }
  const decision = alertTransition(
    {
      id: alertId,
      state: alert.state,
      acknowledgedBy: alert.acknowledged_by,
      smsRaisedAt: momentOrNull(alert.sms_raised_at, 'The escalation’s read'),
    },
    {
      type: 'escalate',
      openedAt: databaseTime(alert.opened_at, 'The escalation’s read'),
      now: databaseTime(alert.now, 'The escalation’s read'),
    },
  );
  if (decision.type === 'unchanged') {
    return { outcome: 'skipped' };
  }
  if (alert.heard === false) {
    // Who to text is the write's to know (SM-10, D-122 item 3): the
    // journey's last responder was removed since the read. Nothing is
    // written; the SMS check counts the alert unheard and pages the owner.
    // Only a plain no skips: anything else goes on to the write, which
    // refuses loudly below if there is nobody to text.
    return { outcome: 'skipped' };
  }

  // ESCALATED at this transaction's now(). It must change exactly the one
  // row the rule read, or nothing is kept.
  const moved = await tx
    .update(alerts)
    .set({ state: decision.state, smsRaisedAt: sql`now()` })
    .where(
      and(
        eq(alerts.id, alertId),
        unresolved(alerts.state),
        isNull(alerts.smsRaisedAt),
        sql`not (${alerts.state} = 'ACKNOWLEDGED' and ${alerts.acknowledgedBy} is not null)`,
      ),
    )
    .returning({ id: alerts.id });
  if (moved.length !== 1) {
    throw new Error('The escalation changed no alert, so nothing of it is kept.');
  }

  // One SMS per responder row, whatever their push did, each with a new
  // random ID, written and due at now(), in the alert's round. The unique
  // (alert, recipient, kind, round) refuses a second in this round, and
  // takes the next round's after a reset (SM-10).
  const messages = await tx.execute<MessageRow>(sql`
    insert into "outbox" ("alert_id", "recipient_id", "kind", "round", "created_at", "attempts",
                          "next_attempt_at")
    select ${alerts.id}, ${journeyResponders.responderId},
           ${ESCALATION_SMS}::${sql.identifier(messageKind.enumName)}, ${alerts.round}, now(), 0,
           now()
      from ${journeyResponders}
      join ${alerts} on ${alerts.id} = ${alertId}
     where ${journeyResponders.journeyId} = ${locked.id}
    returning "id", "recipient_id", "kind"`);
  if (messages.rows.length === 0) {
    // The read under the lock found a responder row, and every removal takes
    // the journey's row first, so this cannot happen. If it does, the alert
    // stays as it was and the sweep says so, rather than counting an
    // escalation that told nobody.
    throw new Error('The alert’s journey has no responder to text, so it is not escalated.');
  }
  return { outcome: 'escalated', messages: messages.rows.map(asMessage) };
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
 *   2. Its messages of the kinds withdrawn on resolution
 *      (WITHDRAWN_WHEN_RESOLVED: its lost-contact pushes, its notices that
 *      someone is on it, and its escalation SMS), not sent and not
 *      withdrawn, are withdrawn at now() (D-111, D-113, LOST-07). The update takes each row's lock, so a claim or
 *      a mark in progress finishes first, and the row is checked again as it
 *      left it: one marked sent meanwhile is not withdrawn, and one claimed
 *      comes back with its new attempt count and lease. Attempts and the last
 *      failure are kept.
 *   3. One stand-down per responder row, of the resolution's own kind, in
 *      the alert's round, with a new random ID, due at now(), unless any of
 *      that responder's withdrawn messages was handed to a port
 *      (attempts ≥ 1) and is due after now():
 *      then at the latest such time, the end of a lease or a retry, at most
 *      60 s on. So a stand-down is never handed to the push port while
 *      anything it stands down may still be in a port's hands, an SMS in the
 *      SMS port's included. An SMS an acknowledgement withdrew earlier is not
 *      withdrawn here, so it holds nothing (LOST-07, approach item 6). Held per responder, so a
 *      responder with two messages withdrawn still gets one stand-down: the
 *      unique (alert, recipient, kind, round) refuses a second, and would
 *      roll back the whole resolution (D-114). Steps 2 and 3 are one statement, so the
 *      hold copies the time at the database's own precision.
 *
 * `except` leaves one responder out of the stand-downs: "They're safe"'s
 * closer, who has the 200, while every other responder is told (LOST-08,
 * D-126). Every other caller passes none, and its statement is then the same
 * as before.
 */
async function resolveInside(
  tx: Pick<Database, 'execute' | 'update'>,
  journeyId: string,
  resolution: AlertResolution,
  { except }: { except?: string } = {},
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
         and ${inArray(outbox.kind, WITHDRAWN_WHEN_RESOLVED)}
         and ${outbox.sentAt} is null
         and ${outbox.withdrawnAt} is null
      returning ${outbox.recipientId}, ${outbox.attempts}, ${outbox.nextAttemptAt}
    ), held as (
      select withdrawn."recipient_id", max(withdrawn."next_attempt_at") as "hold_until"
        from withdrawn
       where withdrawn."attempts" >= 1 and withdrawn."next_attempt_at" > now()
       group by withdrawn."recipient_id"
    )
    insert into "outbox" ("alert_id", "recipient_id", "kind", "round", "created_at", "attempts",
                          "next_attempt_at")
    select ${alerts.id}, ${journeyResponders.responderId},
           ${resolution}::${sql.identifier(messageKind.enumName)}, ${alerts.round}, now(), 0,
           coalesce(held."hold_until", now())
      from ${journeyResponders}
      join ${alerts} on ${alerts.id} = ${alert.id}
      left join held on held."recipient_id" = ${journeyResponders.responderId}
     where ${journeyResponders.journeyId} = ${journeyId}
     ${except === undefined ? sql`` : sql`and ${journeyResponders.responderId} <> ${except}`}
    returning "id", "recipient_id", "kind"`);

  return { alertId: alert.id, messages: standDowns.rows.map(asMessage) };
}

/**
 * "They're safe", inside its transaction (LOST-08, D-126, approach item 4).
 * Throws to roll back: an end or a resolution that changed other than the one
 * row the rule read is never half-written.
 *
 *   1. The journey's row first (D-112), found through the alert, waited for,
 *      as "I'm on it" waits: a person's action. The API's pool bounds the
 *      wait with its lock limit (D-108).
 *   2. Under that lock, the alert read again with its journey's responders
 *      ("I'm on it"'s read), and the domain's close rule (AR-04). Anything but
 *      closed writes nothing.
 *   3. The journey ENDED, SAFE, at now(), guarded by LOST_CONTACT, which must
 *      change exactly one row: an unresolved alert's journey is always
 *      LOST_CONTACT, so one that is not means the read is not what this code
 *      thinks it is.
 *   4. The alert resolved SAFE by `resolveInside`, every responder row but
 *      the closer's stood down; it must be the alert the call named.
 * The closer stays recorded on the alert: who closed it is its
 * `acknowledged_by` (D-126). Every time is this transaction's now().
 */
async function closeInside(
  tx: Pick<Database, 'execute' | 'select' | 'update'>,
  { alertId, responderId }: ClosureToRecord,
): Promise<RecordClosureResult> {
  const [locked] = await tx
    .select({ id: journeys.id })
    .from(journeys)
    .where(
      eq(
        journeys.id,
        tx.select({ journeyId: alerts.journeyId }).from(alerts).where(eq(alerts.id, alertId)),
      ),
    )
    .for('update');

  // The domain decides under the lock, from what the alert holds now (AR-04):
  // contact back, "I'm home", a removal, another close or the 24-hour end
  // committed since the module's read is answered here, writing nothing.
  const decision = alertTransition(
    locked === undefined ? null : await alertForAcknowledgement(tx, alertId),
    { type: 'close', responderId },
  );
  if (decision.type !== 'closed') {
    return { outcome: 'not_closed', decision };
  }
  if (locked === undefined) {
    // The rule closes only an alert that is there.
    throw new Error('The close rule closed an alert that is not there.');
  }

  const ended = await tx
    .update(journeys)
    .set({ state: decision.journey, endedAt: sql`now()`, endReason: decision.resolution })
    .where(and(eq(journeys.id, locked.id), eq(journeys.state, 'LOST_CONTACT')))
    .returning({ id: journeys.id });
  if (ended.length !== 1) {
    throw new Error('The close’s end changed no LOST_CONTACT journey, so nothing of it is kept.');
  }
  const resolved = await resolveInside(tx, locked.id, decision.resolution, {
    except: responderId,
  });
  if (resolved.alertId !== alertId) {
    throw new Error('The close resolved another alert than the one named, so nothing is kept.');
  }
  return { outcome: 'closed', messages: resolved.messages };
}

/**
 * The 24-hour end, inside its transaction (SM-06, LOST-08, approach item 6).
 * Throws to roll back: an end or a resolution that changed other than the one
 * row the rule read is never half-written. Marks `progress.rowTaken` once the
 * journey's row is taken, so a lock that ran out after that is known to be
 * another one.
 */
async function expireInside(
  tx: Pick<Database, 'execute' | 'select' | 'update'>,
  { alertId, lockWaitMs }: ExpireRequest,
  progress: { rowTaken: boolean },
): Promise<ExpireAlertResult> {
  // Every 24-hour end bounds its own waits, as every escalation does (D-108):
  // the worker's pool has no lock limit, and the stand-downs' inserts take
  // key-share locks on the responders' users rows. SET LOCAL, for this
  // transaction.
  await tx.execute(
    sql`select set_config('lock_timeout', ${String(lockWaitMs ?? LOCK_WAIT_LIMIT_MS)}, true)`,
  );
  // The journey's row first (D-112), named by the alert, in any state: the
  // rule decides under it. Without a wait, a row someone holds is no row;
  // with one, PostgreSQL waits at most the lock limit for it.
  const [locked] = await tx
    .select({ id: journeys.id })
    .from(journeys)
    .where(
      eq(
        journeys.id,
        tx.select({ journeyId: alerts.journeyId }).from(alerts).where(eq(alerts.id, alertId)),
      ),
    )
    .for('update', lockWaitMs === undefined ? { skipLocked: true } : {});
  progress.rowTaken = true;
  if (locked === undefined) {
    return { outcome: 'skipped' };
  }

  // Under the lock: the journey's state, its one unresolved alert and when
  // that opened, and this transaction's now(). Contact back, "I'm home", a
  // close or another sweep's end committed since the read is met here.
  const read = await tx.execute<{
    state: JourneyState;
    alert_id: string | null;
    opened_at: unknown;
    now: unknown;
  }>(sql`
    select ${journeys.state}, ${alerts.id} as alert_id, ${alerts.openedAt}, now() as now
      from ${journeys}
      left join ${alerts}
        on ${alerts.journeyId} = ${journeys.id} and ${unresolved(alerts.state)}
     where ${journeys.id} = ${locked.id}`);
  const [journey] = read.rows;
  if (journey === undefined) {
    // The row was just taken, and nothing deletes a journey.
    throw new Error('The journey to end was not found under its own lock.');
  }
  if (journey.alert_id !== alertId) {
    // Resolved since the read: whatever resolved it decided the journey.
    return { outcome: 'skipped' };
  }
  const decision = transition(
    { id: locked.id, state: journey.state },
    {
      type: 'expire',
      alertOpenedAt: databaseTime(journey.opened_at, 'The 24-hour end’s read'),
      now: databaseTime(journey.now, 'The 24-hour end’s read'),
    },
  );
  if (decision.type === 'unchanged') {
    return { outcome: 'skipped' };
  }

  const ended = await tx
    .update(journeys)
    .set({ state: decision.state, endedAt: sql`now()`, endReason: decision.reason })
    .where(and(eq(journeys.id, locked.id), eq(journeys.state, 'LOST_CONTACT')))
    .returning({ id: journeys.id });
  if (ended.length !== 1) {
    throw new Error('The 24-hour end changed no LOST_CONTACT journey, so nothing of it is kept.');
  }
  // Every responder row is stood down, the acknowledger included ("with
  // responders told", D-111); none when the journey has none left, and the
  // unheard alert is resolved all the same (D-122 item 3).
  const resolved = await resolveInside(tx, locked.id, decision.reason);
  if (resolved.alertId !== alertId) {
    throw new Error(
      'The 24-hour end resolved another alert than the one named, so nothing is kept.',
    );
  }
  return { outcome: 'expired', messages: resolved.messages };
}

/** The walker's warning that the journey's last responder was removed (SM-02), cast to the enum as the escalation's kind is. */
const NO_RESPONDER_WARNING = 'NO_RESPONDER' satisfies MessageKind;

/**
 * The removal, inside its transaction (SM-10, D-122, D-123, approach item 6).
 * Throws to roll back: a delete, a reset or a warning that changed other than
 * exactly one row is never half-written.
 *
 *   1. Its own lock limit, LOCK_WAIT_LIMIT_MS, whichever pool runs it: the
 *      API's pool has one, the worker's has none (D-108).
 *   2. The journey's row first (D-112), waited for, as "I'm home" waits: a
 *      person's action.
 *   3. Under that lock, the responder rows, and the domain's removal rule
 *      (AR-04). Anything but removed writes nothing.
 *   4. The responder's row deleted, exactly one (D-122, item 4).
 *   5. The journey's one unresolved alert, read under the lock, and the reset
 *      rule: when the removed responder is recorded on it, OPEN, nobody
 *      recorded, no escalation time, its round raised, in one statement that
 *      must change exactly that row; and its unsent WITHDRAWN_WHEN_RESET
 *      kinds withdrawn ("someone is on it" is false once nobody is).
 *   6. Every unsent, not yet withdrawn message of the journey's alerts to the
 *      removed responder, of the WITHDRAWN_WHEN_REMOVED kinds, withdrawn
 *      (D-122, item 2). Attempts and the last failure are kept, as every
 *      withdrawal keeps them. One in a port's hands finishes as the port
 *      answers, and is never handed out again.
 *   7. When the rule said it was the last responder, one NO_RESPONDER to the
 *      walker, naming the journey and no alert, in round 1, written and due
 *      at now(): exactly one row.
 * Every time is this transaction's now() (AR-03, REL-01).
 */
async function removeInside(
  tx: Pick<Database, 'execute' | 'select' | 'update' | 'delete'>,
  { journeyId, responderId }: RemovalToRecord,
): Promise<RemoveResponderResult> {
  await tx.execute(sql`select set_config('lock_timeout', ${String(LOCK_WAIT_LIMIT_MS)}, true)`);
  const [locked] = await tx
    .select({ id: journeys.id, walkerId: journeys.walkerId, state: journeys.state })
    .from(journeys)
    .where(eq(journeys.id, journeyId))
    .for('update');

  // The rule decides under the lock, from the responder rows as they stand
  // now (AR-04): a removal of the same responder, or an end, committed since
  // the module's read is answered here, writing nothing.
  const responders =
    locked === undefined
      ? []
      : await tx
          .select({ id: journeyResponders.responderId })
          .from(journeyResponders)
          .where(eq(journeyResponders.journeyId, locked.id));
  const decision = transition(
    locked === undefined
      ? null
      : { id: locked.id, state: locked.state, responderIds: responders.map(({ id }) => id) },
    { type: 'remove', responderId },
  );
  if (decision.type !== 'removed') {
    return { outcome: 'not_removed', decision };
  }
  if (locked === undefined) {
    // The rule removes only from a journey that is there.
    throw new Error('The removal rule removed a responder from no journey.');
  }

  const deleted = await tx
    .delete(journeyResponders)
    .where(
      and(
        eq(journeyResponders.journeyId, locked.id),
        eq(journeyResponders.responderId, responderId),
      ),
    )
    .returning({ id: journeyResponders.responderId });
  if (deleted.length !== 1) {
    throw new Error('The removal deleted no responder row, so nothing of it is kept.');
  }

  // The reset (SM-10): the alert rule decides from what the journey's one
  // unresolved alert holds under the lock.
  const [unresolvedAlert] = await tx
    .select({ id: alerts.id, state: alerts.state, acknowledgedBy: alerts.acknowledgedBy })
    .from(alerts)
    .where(and(eq(alerts.journeyId, locked.id), unresolved(alerts.state)));
  const reset = alertTransition(unresolvedAlert ?? null, {
    type: 'acknowledger_removed',
    responderId,
  });
  let resetAlertId: string | null = null;
  if (reset.type === 'reset' && unresolvedAlert !== undefined) {
    // Who and when cleared together, and the escalation time with them, so
    // the escalation LOST-07 built writes the next round's SMS (D-123).
    const [moved] = await tx
      .update(alerts)
      .set({
        state: reset.state,
        acknowledgedBy: null,
        acknowledgedAt: null,
        smsRaisedAt: null,
        round: sql`${alerts.round} + 1`,
      })
      .where(
        and(
          eq(alerts.id, unresolvedAlert.id),
          unresolved(alerts.state),
          eq(alerts.acknowledgedBy, responderId),
        ),
      )
      .returning({ id: alerts.id });
    if (moved === undefined) {
      throw new Error('The reset changed no alert, so nothing of the removal is kept.');
    }
    await tx
      .update(outbox)
      .set({ withdrawnAt: sql`now()` })
      .where(
        and(
          eq(outbox.alertId, moved.id),
          inArray(outbox.kind, WITHDRAWN_WHEN_RESET),
          isNull(outbox.sentAt),
          isNull(outbox.withdrawnAt),
        ),
      );
    resetAlertId = moved.id;
  }

  // A removed responder receives nothing more (D-122, item 2).
  await tx
    .update(outbox)
    .set({ withdrawnAt: sql`now()` })
    .where(
      and(
        inArray(
          outbox.alertId,
          tx.select({ id: alerts.id }).from(alerts).where(eq(alerts.journeyId, locked.id)),
        ),
        eq(outbox.recipientId, responderId),
        inArray(outbox.kind, WITHDRAWN_WHEN_REMOVED),
        isNull(outbox.sentAt),
        isNull(outbox.withdrawnAt),
      ),
    );

  if (!decision.lastResponder) {
    return { outcome: 'removed', resetAlertId, messages: [] };
  }
  // The walker is warned at once (SM-02, D-087): content-free, never at the
  // critical level, handed to the push port at the sender's next run.
  const warning = await tx.execute<MessageRow>(sql`
    insert into "outbox" ("journey_id", "recipient_id", "kind", "round", "created_at",
                          "attempts", "next_attempt_at")
    values (${locked.id}, ${locked.walkerId},
            ${NO_RESPONDER_WARNING}::${sql.identifier(messageKind.enumName)}, 1, now(), 0, now())
    returning "id", "recipient_id", "kind"`);
  if (warning.rows.length !== 1) {
    throw new Error('The walker’s warning was not written, so nothing of the removal is kept.');
  }
  return { outcome: 'removed', resetAlertId, messages: warning.rows.map(asMessage) };
}

/**
 * A claim of these kinds only, in one statement: at most `limit` due messages
 * (not sent, and due at or before now()) no other claim holds, one attempt
 * more each, leased until now() plus `leaseMs`; and now(), even when nothing
 * is due. A withdrawn message is never due again, whatever its time and
 * whatever a later mark wrote (D-111).
 */
async function claim(
  db: Database,
  kinds: readonly MessageKind[],
  { limit, leaseMs }: { limit: number; leaseMs: number },
): Promise<ClaimedMessages> {
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
         and ${inArray(outbox.kind, kinds)}
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
}

/**
 * A start's insert met the walker's unended journey, and the read after it
 * found none: that journey ended in between (LOST-08, approach item 9).
 */
const ENDED_MEANWHILE = Symbol('the journey the start met ended before its read');

export function databaseJourneyStore(
  db: Database,
): JourneyStore & WatchdogStore & OutboxStore & AlertStore & ResponderStore & ClosureStore {
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
      /** One try, in a transaction of its own: stored, refused, or ended meanwhile. */
      const attempt = () =>
        db.transaction(async (tx): Promise<InsertStartedResult | typeof ENDED_MEANWHILE> => {
          const [journey] = await tx
            .insert(journeys)
            .values({ walkerId, deviceId, state: 'ACTIVE', startedAt })
            .onConflictDoNothing({ target: journeys.walkerId, where: unended(journeys.state) })
            .returning({ id: journeys.id });

          if (journey === undefined) {
            // The index refused it: the walker has an unended journey. Read in
            // this transaction, after the conflict, so it sees the journey
            // that won the race. That relies on READ COMMITTED, PostgreSQL's
            // default: each statement takes a fresh snapshot, so this read
            // sees the winner the insert waited for. Under REPEATABLE READ (or
            // SERIALIZABLE), a conflict with a journey this transaction's
            // snapshot cannot see raises 40001 instead.
            const winner = await unendedJourneyOf(tx, walkerId);
            return winner === null
              ? ENDED_MEANWHILE
              : { inserted: false, unendedJourneyId: winner.id };
          }

          await tx
            .insert(journeyResponders)
            .values(responderIds.map((responderId) => ({ journeyId: journey.id, responderId })));

          return { inserted: true, journeyId: journey.id };
        });

      // The journey the insert met can end between the conflict and the read
      // (LOST-08, approach item 9): "I'm home" from the walker's own phone,
      // and now "They're safe" and the 24-hour end from outside it, which can
      // meet a start by chance. The insert is then tried once more, in a new
      // transaction. The same race a second time is answered 500, loudly,
      // with nothing stored, and the app's retry then starts.
      const first = await attempt();
      if (first !== ENDED_MEANWHILE) {
        return first;
      }
      const second = await attempt();
      if (second !== ENDED_MEANWHILE) {
        return second;
      }
      throw new Error(
        'A start was refused as a second unended journey, and no unended journey was found, twice.',
      );
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

    alertForAcknowledgement(alertId: string): Promise<AlertForAcknowledgement | null> {
      return alertForAcknowledgement(db, alertId);
    },

    recordAcknowledgement({
      alertId,
      responderId,
    }: AcknowledgementToRecord): Promise<RecordAcknowledgementResult> {
      // Not rewritten as the heartbeat's errors are: nothing here binds a
      // location or a phone number, so no error of this can carry one. The
      // module logs the SQLSTATE alone.
      return db.transaction(async (tx): Promise<RecordAcknowledgementResult> => {
        // The journey's row first, as every path that moves a journey or its
        // alert takes it (D-112). No row: no alert by that ID.
        const [locked] = await tx
          .select({ id: journeys.id })
          .from(journeys)
          .where(
            eq(
              journeys.id,
              tx.select({ journeyId: alerts.journeyId }).from(alerts).where(eq(alerts.id, alertId)),
            ),
          )
          .for('update');

        // The domain decides under the lock, from what the alert holds now,
        // and its decision is what is written (AR-04): another responder's
        // acknowledgement, a copy of this one, or a resolution committed
        // since the module's read is answered here, writing nothing.
        const decision = alertTransition(
          locked === undefined ? null : await alertForAcknowledgement(tx, alertId),
          { type: 'acknowledge', responderId },
        );
        if (decision.type !== 'acknowledged') {
          return { outcome: 'not_recorded', decision };
        }

        // Who and when, at this transaction's now() (AR-03, SM-09). It must
        // change exactly the one row the rule read, or nothing is kept.
        const [moved] = await tx
          .update(alerts)
          .set({ state: decision.state, acknowledgedBy: responderId, acknowledgedAt: sql`now()` })
          .where(
            and(eq(alerts.id, alertId), unresolved(alerts.state), isNull(alerts.acknowledgedBy)),
          )
          .returning({ journeyId: alerts.journeyId });
        if (moved === undefined) {
          throw new Error('The acknowledgement changed no alert, so nothing of it is kept.');
        }

        // Escalation stops as soon as anyone acknowledges (LOST-07): the
        // alert's SMS not yet sent are withdrawn at this now(), keeping their
        // attempts and last failure, so no claim hands them out again. One in
        // the port's hands finishes as the port answers. Push messages are
        // left as they are. After the alert's row, the order the escalation
        // takes its locks in.
        await tx
          .update(outbox)
          .set({ withdrawnAt: sql`now()` })
          .where(
            and(
              eq(outbox.alertId, alertId),
              inArray(outbox.kind, WITHDRAWN_WHEN_ACKNOWLEDGED),
              isNull(outbox.sentAt),
              isNull(outbox.withdrawnAt),
            ),
          );

        // One notice per responder row but the acknowledger's (D-113), each
        // with a new random ID, due at once, in the alert's round: a notice
        // stands nobody down, so nothing holds it. None when the acknowledger
        // is the only responder. The unique (alert, recipient, kind, round)
        // refuses a second one in this round, and takes a second
        // acknowledger's after a reset (SM-10).
        const notices = await tx.execute<MessageRow>(sql`insert into "outbox" ("alert_id",
            "recipient_id", "kind", "round", "created_at", "attempts", "next_attempt_at")
          select ${alerts.id}, ${journeyResponders.responderId}, 'ACKNOWLEDGED', ${alerts.round},
                 now(), 0, now()
            from ${journeyResponders}
            join ${alerts} on ${alerts.id} = ${alertId}
           where ${journeyResponders.journeyId} = ${moved.journeyId}
             and ${journeyResponders.responderId} <> ${responderId}
          returning "id", "recipient_id", "kind"`);

        return { outcome: 'acknowledged', messages: notices.rows.map(asMessage) };
      });
    },

    alertForClosure(alertId: string): Promise<AlertForAcknowledgement | null> {
      // "I'm on it"'s read: the close rule reads the same (LOST-08).
      return alertForAcknowledgement(db, alertId);
    },

    recordClosure(closure: ClosureToRecord): Promise<RecordClosureResult> {
      // Not rewritten as the heartbeat's errors are: nothing here binds a
      // location or a phone number, so no error of this can carry one. The
      // module logs the SQLSTATE alone.
      return db.transaction((tx) => closeInside(tx, closure));
    },

    journeyForRemoval(journeyId: string): Promise<JourneyForRemoval | null> {
      return journeyForRemoval(db, journeyId);
    },

    removeResponder(removal: RemovalToRecord): Promise<RemoveResponderResult> {
      // Not rewritten as the heartbeat's errors are: nothing here binds a
      // location or a phone number, so no error of this can carry one. The
      // module logs the SQLSTATE alone.
      return db.transaction((tx) => removeInside(tx, removal));
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

    openLostContactAlert(request: OpenRequest): Promise<OpenLostContactAlertResult> {
      // The wait is checked before the transaction, so nothing is written and
      // no lock is taken.
      return takingTheRow(db, request.lockWaitMs, (tx, progress) =>
        openInside(tx, request, progress),
      );
    },

    async alertsDueForEscalation(afterMs: number): Promise<DueAlerts> {
      // One statement, no lock: now() and every alert unresolved, not
      // escalated in its round, not acknowledged in D-114's sense
      // (ACKNOWLEDGED and someone recorded: a missing half is due), opened
      // afterMs or more before it (LOST-07), and whose journey has a
      // responder row to text (SM-10: one with none is unheard, and the SMS
      // check counts it). The left join keeps now() when none is.
      const result = await db.execute<{
        now: unknown;
        id: string | null;
        journey_id: string | null;
        state: AlertState | null;
        acknowledged_by: string | null;
        sms_raised_at: unknown;
        opened_at: unknown;
      }>(sql`
        select clock.now, ${alerts.id}, ${alerts.journeyId}, ${alerts.state},
               ${alerts.acknowledgedBy}, ${alerts.smsRaisedAt}, ${alerts.openedAt}
          from (select now() as now) as clock
          left join ${alerts}
            on ${unresolved(alerts.state)}
           and ${alerts.smsRaisedAt} is null
           and not (${alerts.state} = 'ACKNOWLEDGED' and ${alerts.acknowledgedBy} is not null)
           and ${alerts.openedAt} <= clock.now - ${milliseconds(afterMs)}
           and exists (select 1 from ${journeyResponders}
                        where ${journeyResponders.journeyId} = ${alerts.journeyId})`);
      const [first] = result.rows;
      if (first === undefined) {
        // The left join always returns a row; none means the read is not
        // what this code thinks it is.
        throw new Error('The escalation read returned no row, not even the time.');
      }
      return {
        now: databaseTime(first.now, 'The escalation read'),
        alerts: result.rows.flatMap((row) =>
          row.id === null || row.journey_id === null || row.state === null
            ? []
            : [
                {
                  id: row.id,
                  journeyId: row.journey_id,
                  state: row.state,
                  acknowledgedBy: row.acknowledged_by,
                  smsRaisedAt: momentOrNull(row.sms_raised_at, 'The escalation read'),
                  openedAt: databaseTime(row.opened_at, 'The escalation read'),
                },
              ],
        ),
      };
    },

    escalateAlert(request: EscalateRequest): Promise<EscalateAlertResult> {
      // As the open: the wait checked before the transaction, and only a
      // waiting attempt's wait for the journey's own row answered as held.
      return takingTheRow(db, request.lockWaitMs, (tx, progress) =>
        escalateInside(tx, request, progress),
      );
    },

    async alertsDueForExpiry(): Promise<ExpiringAlerts> {
      // One statement, no lock: now() and every unresolved alert opened
      // ALERT_EXPIRES_AFTER_MS or more before it, whatever its state and
      // whether its journey has a responder row (SM-06), with its journey's
      // state. No threshold is passed in, so no caller can choose another.
      // The left join keeps now() when none is.
      const result = await db.execute<{
        now: unknown;
        id: string | null;
        journey_id: string | null;
        journey_state: JourneyState | null;
        opened_at: unknown;
      }>(sql`
        select clock.now, ${alerts.id}, ${alerts.journeyId},
               ${journeys.state} as journey_state, ${alerts.openedAt}
          from (select now() as now) as clock
          left join (${alerts} join ${journeys} on ${journeys.id} = ${alerts.journeyId})
            on ${unresolved(alerts.state)}
           and ${alerts.openedAt} <= clock.now - ${milliseconds(ALERT_EXPIRES_AFTER_MS)}
         order by ${alerts.openedAt}, ${alerts.id}`);
      const [first] = result.rows;
      if (first === undefined) {
        // The left join always returns a row; none means the read is not
        // what this code thinks it is.
        throw new Error('The 24-hour end’s read returned no row, not even the time.');
      }
      return {
        now: databaseTime(first.now, 'The 24-hour end’s read'),
        alerts: result.rows.flatMap((row) =>
          row.id === null || row.journey_id === null || row.journey_state === null
            ? []
            : [
                {
                  id: row.id,
                  journeyId: row.journey_id,
                  journeyState: row.journey_state,
                  openedAt: databaseTime(row.opened_at, 'The 24-hour end’s read'),
                },
              ],
        ),
      };
    },

    expireAlert(request: ExpireRequest): Promise<ExpireAlertResult> {
      // As the escalation: the wait checked before the transaction, and only
      // a waiting attempt's wait for the journey's own row answered as held.
      return takingTheRow(db, request.lockWaitMs, (tx, progress) =>
        expireInside(tx, request, progress),
      );
    },

    claimDue(request): Promise<ClaimedMessages> {
      // The push kinds only: the push port is never handed an SMS (LOST-07).
      return claim(db, PUSH_KINDS, request);
    },

    claimDueSms(request): Promise<ClaimedMessages> {
      // The SMS kinds only, with the same limit, lease and attempt count.
      return claim(db, SMS_KINDS, request);
    },

    async unsentSmsCount(olderThanMs: number): Promise<{ now: Date; count: number }> {
      // One statement: now(), and the SMS messages not sent, not withdrawn,
      // and written olderThanMs or more before it, whatever the cause
      // (LOST-07). It reads the claim's partial index (sent_at is null).
      const result = await db.execute<{ now: unknown; count: unknown }>(sql`
        select now() as now, count(*) as count
          from ${outbox}
         where ${inArray(outbox.kind, SMS_KINDS)}
           and ${outbox.sentAt} is null and ${outbox.withdrawnAt} is null
           and ${outbox.createdAt} <= now() - ${milliseconds(olderThanMs)}`);
      const [row] = result.rows;
      // count(*) is a bigint, which the driver hands over as text.
      const count = Number(row?.count);
      if (row === undefined || !Number.isSafeInteger(count) || count < 0) {
        throw new Error('The count of SMS waiting returned no count.');
      }
      return { now: databaseTime(row.now, 'The count of SMS waiting'), count };
    },

    async unheardAlertCount(): Promise<{ now: Date; count: number }> {
      // One statement: now(), and the unresolved alerts whose journey has no
      // responder row, so nobody can be told of them (SM-10, D-122 item 3).
      // No index: a handful of unresolved alerts at the private group's
      // scale.
      const result = await db.execute<{ now: unknown; count: unknown }>(sql`
        select now() as now, count(*) as count
          from ${alerts}
         where ${unresolved(alerts.state)}
           and not exists (select 1 from ${journeyResponders}
                            where ${journeyResponders.journeyId} = ${alerts.journeyId})`);
      const [row] = result.rows;
      // count(*) is a bigint, which the driver hands over as text.
      const count = Number(row?.count);
      if (row === undefined || !Number.isSafeInteger(count) || count < 0) {
        throw new Error('The count of unheard alerts returned no count.');
      }
      return { now: databaseTime(row.now, 'The count of unheard alerts'), count };
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
