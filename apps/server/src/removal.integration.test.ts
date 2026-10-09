// L3 server integration: removing a responder (SM-10, and SM-02's
// last-responder warning) on the real tables.
//
// The system tests prove the rules, the flows and the warning against a fake
// store. What only a real PostgreSQL can prove is here:
//   - the flow, through the real adapter, the real modules and the recording
//     fakes: a removed responder on the journey for nothing that follows
//     (AC2), escalation resumed at its two minutes or at once (AC5, AC6), a
//     second acknowledgement and a second reset in a round of their own (AC7);
//   - the removal deciding under the journey's row, as its holder left it,
//     and RACERS removals of one responder at once (AC3);
//   - the removal and "I'm on it" meeting on the journey's row, in each order
//     forced and at the same moment (AC9), and the removal meeting the open,
//     the escalation, contact back and "I'm home" in each order (AC10);
//   - the last two responders removed at once: one warning (AC13);
//   - all or nothing, with test triggers that refuse the warning, the reset
//     and the withdrawal in turn, and a 55P03 past the 5 s lock limit (AC18);
//   - every time the removal writes is its transaction's now(), in one
//     transaction (xmin), and a resumed escalation's time the sweep's own
//     (AC19).
// The shared behaviour suite runs the store's side of AC1, AC3, AC4, AC6 to
// AC15 and AC17 against the adapter in adapters/journeys.integration.test.ts;
// AC7's key, AC14's check and AC21's tables are read there and in
// deploy.integration.test.ts.
//
// No route removes a responder in M2 (D-122, item 5): the removal is driven
// through its module, `createRemovalService`, as the spec's reading 8 says.
// It runs here on a pool with the API's lock limit, LOCK_WAIT_LIMIT_MS.
//
// An alert's two minutes are reached by moving its opened_at back, relative
// to the database's own now(), not by waiting.
//
// PostgreSQL 15, staging's version, as deploy.integration.test.ts explains.
// Needs Docker, like every *.integration.test.ts: CI's integration job runs
// it, a cloud session cannot.
//
// Each test starts from a quiet database: every journey a test left unended
// is ended, every alert left unresolved is resolved, and every message left
// due is put out of reach as sent, so a sweep or a claim here sees only what
// the test itself put in.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  RACE_ROUNDS,
  RACERS,
  apiPath,
  endTestPool,
  fakeLog,
  fakePush,
  fakeSms,
  syntheticCredential,
  syntheticEventId,
  syntheticHeartbeat,
  syntheticUuid,
  type FakeLog,
  type FakePush,
  type FakeSms,
} from '@trygghverdag/test-kit';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { databaseClock } from './adapters/clock.ts';
import { createDatabase, createPool, type Database } from './adapters/db.ts';
import { databaseDeviceAuthenticator, hashCredential } from './adapters/device-credentials.ts';
import { databaseJourneyStore } from './adapters/journeys.ts';
import { migrateDatabase } from './adapters/migrations.ts';
import { databaseWorkerHeartbeats } from './adapters/worker-heartbeats.ts';
import { createApi } from './api.ts';
import { LOST_CONTACT_AFTER_MS } from './domain/journey.ts';
import { sqlstateOf } from './domain/sqlstate.ts';
import { LOCK_WAIT_LIMIT_MS } from './domain/watchdog.ts';
import { createAcknowledgementService } from './modules/alerts/acknowledgement.ts';
import { createPushSender, createSmsSender } from './modules/alerts/outbox.ts';
import { createWatchdog } from './modules/alerts/watchdog.ts';
import { createHealthService } from './modules/health/service.ts';
import { createRemovalService } from './modules/journeys/removal.ts';
import { createJourneyService } from './modules/journeys/service.ts';

/** What Clever Cloud's DEV plan runs; see deploy.integration.test.ts. */
const STAGING_POSTGRES = 'postgres:15-alpine';

/** Enough connections that every racer holds its own. */
const CONNECTIONS = RACERS + 4;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/** Two minutes (D-019), written out so that a wrong ESCALATE_AFTER_MS fails here as well. */
const TWO_MINUTES = 2 * MINUTE;

/** Opened this long ago, an alert is due, and its two minutes passed less than 30 s ago. */
const DUE = TWO_MINUTES + 10 * SECOND;

/** How far past a wait a call may finish and still count as on time. */
const MARGIN = 2_500;

const QUIET = { ok: true, opened: 0, escalated: 0, stuck: 0 };
const ON_IT = { outcome: 'ACKNOWLEDGED' };
const SMS = 'LOST_CONTACT_SMS';
const NOTICE = 'ACKNOWLEDGED';
const WARNING = 'NO_RESPONDER';

/** The removal module's answers, as the spec names them (RemovalResult). */
const REMOVED = { type: 'removed' };
const NOT_A_RESPONDER = { type: 'unchanged', reason: 'NOT_A_RESPONDER' };
const JOURNEY_ENDED = { type: 'ignored', reason: 'JOURNEY_ENDED' };

let container: StartedPostgreSqlContainer | undefined;
let pool: pg.Pool | undefined;
let db: Database | undefined;

beforeAll(async () => {
  container = await new PostgreSqlContainer(STAGING_POSTGRES).start();
  // The deploy's own migration step, not a schema built by hand.
  await migrateDatabase(container.getConnectionUri());
  pool = createPool(container.getConnectionUri(), CONNECTIONS);
  db = createDatabase(pool);
}, 180_000);

afterAll(async () => {
  // endTestPool: see journeys.integration.test.ts.
  await endTestPool(pool);
  await container?.stop();
});

beforeEach(async () => {
  await connection().query("update journeys set state = 'ENDED' where state <> 'ENDED'");
  await connection().query(
    "update alerts set state = 'RESOLVED', resolved_at = now(), resolution = 'HOME' " +
      "where state <> 'RESOLVED'",
  );
  await connection().query('update outbox set sent_at = now() where sent_at is null');
});

function connectionUri(): string {
  if (container === undefined) {
    throw new Error('The container did not start, so there is nothing to test against.');
  }
  return container.getConnectionUri();
}

function database(): Database {
  if (db === undefined) {
    throw new Error('The container did not start, so there is nothing to test against.');
  }
  return db;
}

function connection(): pg.Pool {
  if (pool === undefined) {
    throw new Error('The container did not start, so there is nothing to query.');
  }
  return pool;
}

/** This URI with a query parameter added: here, a name its sessions show in pg_stat_activity. */
function withParameter(uri: string, name: string, value: string): string {
  const url = new URL(uri);
  url.searchParams.set(name, value);
  return url.toString();
}

/** A pool of its own, named, with no lock limit, as the worker's is: the sweep bounds its own waits. */
function workerPool(applicationName: string, size = 2): pg.Pool {
  return createPool(withParameter(connectionUri(), 'application_name', applicationName), size);
}

/** A pool of its own, named, with the API's lock limit: the removal's, and "I'm on it"'s. */
function apiPool(applicationName: string, size = 2): pg.Pool {
  return createPool(withParameter(connectionUri(), 'application_name', applicationName), size, {
    lockTimeoutMs: LOCK_WAIT_LIMIT_MS,
  });
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// ---------------------------------------------------------------------------
// Rows, put in and read back directly. Times are written relative to the
// database's own now(), in the statement that writes them.
// ---------------------------------------------------------------------------

async function addUser(): Promise<string> {
  const id = syntheticUuid();
  await connection().query('insert into users (id) values ($1)', [id]);
  return id;
}

/** A device of this user, and the credential it would send. */
async function addDevice(userId: string): Promise<{ deviceId: string; credential: string }> {
  const deviceId = syntheticUuid();
  const credential = syntheticCredential();
  await connection().query(
    'insert into devices (id, user_id, credential_hash) values ($1, $2, $3)',
    [deviceId, userId, hashCredential(credential)],
  );
  return { deviceId, credential };
}

/** A user with a device, and the credential that device would send: a walker, or a responder. */
async function person(): Promise<{ userId: string; deviceId: string; credential: string }> {
  const userId = await addUser();
  return { userId, ...(await addDevice(userId)) };
}

type Person = Awaited<ReturnType<typeof person>>;

/** An ACTIVE journey of a new walker, put in directly with `responders` responders, silent for an hour. */
async function silent({ responders = 3 }: { responders?: number } = {}) {
  const walker = await person();
  const following: Person[] = [];
  for (let i = 0; i < responders; i += 1) {
    following.push(await person());
  }
  const journeyId = syntheticUuid();
  await connection().query(
    `insert into journeys (id, walker_id, device_id, state, started_at, last_heartbeat_at)
     values ($1, $2, $3, 'ACTIVE', now() - interval '2 hours', now() - interval '1 hour')`,
    [journeyId, walker.userId, walker.deviceId],
  );
  for (const { userId } of following) {
    await connection().query(
      'insert into journey_responders (journey_id, responder_id) values ($1, $2)',
      [journeyId, userId],
    );
  }
  return { walker, responders: following, journeyId };
}

/** An ACTIVE journey of a new walker, heard from just now: not overdue. */
async function walking({ responders = 3 }: { responders?: number } = {}) {
  const journey = await silent({ responders });
  await connection().query('update journeys set last_heartbeat_at = now() where id = $1', [
    journey.journeyId,
  ]);
  return journey;
}

const store = () => databaseJourneyStore(database());

/** A silent journey, opened by the real adapter: LOST_CONTACT, its alert, and one unsent LOST_CONTACT message per responder. */
async function lost({ responders = 3 }: { responders?: number } = {}) {
  const journey = await silent({ responders });
  const opened = await store().openLostContactAlert({
    journeyId: journey.journeyId,
    afterMs: LOST_CONTACT_AFTER_MS,
  });
  if (opened.outcome !== 'opened') {
    throw new Error(`expected the journey to be opened, but it was ${opened.outcome}`);
  }
  return { ...journey, alertId: opened.alertId };
}

/** Moves the alert's opened_at to `ms` before the database's now(). */
async function openedAgo(alertId: string, ms: number): Promise<void> {
  await connection().query(
    `update alerts set opened_at = now() - ($2::double precision * interval '1 millisecond')
      where id = $1`,
    [alertId, ms],
  );
}

/** A lost journey whose alert opened `openedAgoMs` before now(): due, unless told otherwise. */
async function due({
  responders = 3,
  openedAgoMs = DUE,
}: { responders?: number; openedAgoMs?: number } = {}) {
  const journey = await lost({ responders });
  await openedAgo(journey.alertId, openedAgoMs);
  return journey;
}

/** Every message of the journey's alerts, and its own, put out of reach as sent: a later claim sees only what follows. */
async function markAllSent(): Promise<void> {
  await connection().query('update outbox set sent_at = now() where sent_at is null');
}

/** A moment as milliseconds since the epoch, in SQL, floored as a Date floors it. */
const MS = (column: string) => `floor(extract(epoch from ${column}) * 1000)::bigint::text`;

async function databaseNowMs(): Promise<number> {
  const result = await connection().query<{ ms: string }>(`select ${MS('now()')} as ms`);
  return Number(result.rows[0]?.ms);
}

/** now() as PostgreSQL prints it, to the microsecond. */
async function databaseNowText(): Promise<string> {
  const result = await connection().query<{ now: string }>('select now()::text as now');
  return result.rows[0]?.now ?? '';
}

const numberOrNull = (ms: string | null | undefined): number | null =>
  ms === null || ms === undefined ? null : Number(ms);

async function stateOf(journeyId: string): Promise<string | null> {
  const result = await connection().query<{ state: string }>(
    'select state::text as state from journeys where id = $1',
    [journeyId],
  );
  return result.rows[0]?.state ?? null;
}

/** The journey's responder rows, sorted. */
async function respondersOf(journeyId: string): Promise<string[]> {
  const result = await connection().query<{ responder_id: string }>(
    `select responder_id::text as responder_id from journey_responders
      where journey_id = $1 order by responder_id`,
    [journeyId],
  );
  return result.rows.map(({ responder_id }) => responder_id);
}

/** The journey's alerts as the table holds them: who is on each, when each escalated, its round, and the transaction that wrote it. */
async function alertsOf(journeyId: string) {
  const result = await connection().query<{
    id: string;
    state: string;
    opened_ms: string;
    silent_ms: string;
    acknowledged_by: string | null;
    acknowledged_ms: string | null;
    sms_raised_ms: string | null;
    sms_raised_text: string | null;
    round: number;
    xmin: string;
  }>(
    `select id::text as id, state::text as state, ${MS('opened_at')} as opened_ms,
            ${MS('silent_since')} as silent_ms,
            acknowledged_by::text as acknowledged_by, ${MS('acknowledged_at')} as acknowledged_ms,
            ${MS('sms_raised_at')} as sms_raised_ms, sms_raised_at::text as sms_raised_text,
            round::int as round, xmin::text as xmin
       from alerts where journey_id = $1 order by opened_at, id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    state: row.state,
    openedAt: Number(row.opened_ms),
    silentSince: Number(row.silent_ms),
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: numberOrNull(row.acknowledged_ms),
    smsRaisedAt: numberOrNull(row.sms_raised_ms),
    /** sms_raised_at as PostgreSQL prints it, to the microsecond. */
    smsRaisedText: row.sms_raised_text,
    round: row.round,
    xmin: row.xmin,
  }));
}

/** The messages of the journey's alerts as the table holds them, each with its round and the transaction that last wrote it. */
async function messagesOf(journeyId: string) {
  const result = await connection().query<{
    message_id: string;
    alert_id: string;
    recipient_id: string;
    kind: string;
    attempts: number;
    round: number;
    sent_ms: string | null;
    withdrawn_ms: string | null;
    withdrawn_text: string | null;
    last_failure: string | null;
    xmin: string;
  }>(
    `select o.id::text as message_id, o.alert_id::text as alert_id,
            o.recipient_id::text as recipient_id, o.kind::text as kind,
            o.attempts::int as attempts, o.round::int as round,
            ${MS('o.sent_at')} as sent_ms, ${MS('o.withdrawn_at')} as withdrawn_ms,
            o.withdrawn_at::text as withdrawn_text, o.last_failure::text as last_failure,
            o.xmin::text as xmin
       from outbox o join alerts a on a.id = o.alert_id
      where a.journey_id = $1 order by o.recipient_id, o.kind, o.round`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    messageId: row.message_id,
    alertId: row.alert_id,
    recipientId: row.recipient_id,
    kind: row.kind,
    attempts: row.attempts,
    round: row.round,
    sentAt: numberOrNull(row.sent_ms),
    withdrawnAt: numberOrNull(row.withdrawn_ms),
    /** withdrawn_at as PostgreSQL prints it, to the microsecond. */
    withdrawnText: row.withdrawn_text,
    lastFailure: row.last_failure,
    xmin: row.xmin,
  }));
}

/** The journey's own messages, naming it and no alert: the walker's warnings. */
async function warningsOf(journeyId: string) {
  const result = await connection().query<{
    message_id: string;
    alert_id: string | null;
    recipient_id: string;
    kind: string;
    round: number;
    created_text: string;
    next_text: string;
    sent_ms: string | null;
    withdrawn_ms: string | null;
    xmin: string;
  }>(
    `select id::text as message_id, alert_id::text as alert_id,
            recipient_id::text as recipient_id, kind::text as kind, round::int as round,
            created_at::text as created_text, next_attempt_at::text as next_text,
            ${MS('sent_at')} as sent_ms, ${MS('withdrawn_at')} as withdrawn_ms,
            xmin::text as xmin
       from outbox where journey_id = $1 order by created_at, id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    messageId: row.message_id,
    alertId: row.alert_id,
    recipientId: row.recipient_id,
    kind: row.kind,
    round: row.round,
    /** created_at as PostgreSQL prints it, to the microsecond. */
    createdText: row.created_text,
    /** next_attempt_at as PostgreSQL prints it, to the microsecond. */
    nextAttemptText: row.next_text,
    sentAt: numberOrNull(row.sent_ms),
    withdrawnAt: numberOrNull(row.withdrawn_ms),
    xmin: row.xmin,
  }));
}

/** Everything the tables hold of a journey: its state, responders, alerts, their messages and its warnings, to compare before and after. */
async function recordOf(journeyId: string) {
  return {
    state: await stateOf(journeyId),
    responders: await respondersOf(journeyId),
    alerts: await alertsOf(journeyId),
    messages: await messagesOf(journeyId),
    warnings: await warningsOf(journeyId),
  };
}

/** This responder's messages of the journey's alerts that are neither sent nor withdrawn. */
async function pendingFor(journeyId: string, responderId: string) {
  return (await messagesOf(journeyId)).filter(
    ({ recipientId, sentAt, withdrawnAt }) =>
      recipientId === responderId && sentAt === null && withdrawnAt === null,
  );
}

async function lastBeatMs(): Promise<number | null> {
  return (await databaseWorkerHeartbeats(database()).lastBeat())?.getTime() ?? null;
}

/** A test-only database object, dropped again whatever happens. */
async function withTrigger(create: string[], drop: string[], run: () => Promise<void>) {
  for (const statement of create) {
    await connection().query(statement);
  }
  try {
    await run();
  } finally {
    for (const statement of drop) {
      await connection().query(statement);
    }
  }
}

/** Waits, in short sleeps rather than by a clock, until `check` holds or the attempts run out. */
async function eventually(check: () => Promise<boolean>, attempts = 400): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) {
      return true;
    }
    await sleep(25);
  }
  return check();
}

/** How many sessions of this application are waiting on a lock right now. */
async function waitingOnALock(applicationName: string): Promise<number> {
  const result = await connection().query<{ n: number }>(
    `select count(*)::int as n from pg_stat_activity
      where application_name = $1 and wait_event_type = 'Lock'`,
    [applicationName],
  );
  return result.rows[0]?.n ?? 0;
}

/** Settles as `promise` does, or as `still waiting` once `ms` have passed: a wait with no end fails here, not by hanging. */
async function bounded<T>(promise: Promise<T>, ms: number): Promise<T | 'still waiting'> {
  promise.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'still waiting'>((resolve) => {
    timer = setTimeout(() => {
      resolve('still waiting');
    }, ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A psql-like session of the test's own, holding the journey's row `for
 * update` in an open transaction, outside every pool; it can change the
 * journey before it commits, as a transaction in flight would.
 */
async function sessionHolding(journeyId: string) {
  const session = new pg.Client({ connectionString: connectionUri() });
  await session.connect();
  await session.query('begin');
  await session.query('select id from journeys where id = $1 for update', [journeyId]);
  const pid = (await session.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid;
  return {
    /** Whether another session is waiting for a lock this one holds. */
    waitedFor: async () => {
      const waiting = await connection().query<{ n: number }>(
        'select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
        [pid],
      );
      return (waiting.rows[0]?.n ?? 0) > 0;
    },
    run: (text: string, values: unknown[]) => session.query(text, values),
    commit: () => session.query('commit'),
    end: async () => {
      await session.query('rollback').catch(() => undefined);
      await session.end();
    },
  };
}

/** A session holding an advisory lock that a test trigger waits for: the gate a held transaction stays behind. */
async function gate() {
  const key = Math.floor(Math.random() * 1_000_000_000);
  const client = await connection().connect();
  await client.query('select pg_advisory_lock($1)', [key]);
  return {
    key,
    open: async () => {
      await client.query('select pg_advisory_unlock_all()');
    },
    end: async () => {
      await client.query('select pg_advisory_unlock_all()');
      client.release();
    },
  };
}

/** Whether a session is waiting for an advisory lock: a held transaction is behind the gate. */
async function someoneAtTheGate(): Promise<boolean> {
  const result = await connection().query<{ n: number }>(
    "select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted",
  );
  return (result.rows[0]?.n ?? 0) > 0;
}

/** A trigger that holds a transaction open behind a gate, after `event` on `table`, when `condition` holds. */
function holdBehind(key: number, table: string, event: string, condition: string) {
  const name = `sm10_hold_${table}_${event}`;
  return {
    create: [
      `create function ${name}() returns trigger language plpgsql as $$
         begin
           perform pg_advisory_xact_lock(${String(key)});
           return null;
         end
       $$`,
      `create trigger ${name} after ${event} on ${table} for each row when (${condition})
         execute function ${name}()`,
    ],
    drop: [`drop trigger if exists ${name} on ${table}`, `drop function if exists ${name}()`],
  };
}

/**
 * Two transactions meeting on the journey's row, in an order forced: `first`
 * runs on the shared pool and is held open behind a gate by a test trigger
 * (`holder`) once it has taken the row and written; `second` starts on a pool
 * of its own, named `tag`, and waits for the row (pg_stat_activity); then the
 * gate opens, `first` commits, and `second` goes on, deciding by what `first`
 * left.
 */
async function inOrder<A, B>({
  holder,
  first,
  second,
  tag,
  pool: poolFor = apiPool,
}: {
  holder: { table: string; event: string; condition: string };
  first: () => Promise<A>;
  second: (on: Database) => Promise<B>;
  tag: string;
  pool?: (applicationName: string) => pg.Pool;
}): Promise<{ first: A | 'still waiting'; second: B | 'still waiting' }> {
  const secondPool = poolFor(tag);
  const held = await gate();
  let answers: { first: A | 'still waiting'; second: B | 'still waiting' } | undefined;
  try {
    const { create, drop } = holdBehind(held.key, holder.table, holder.event, holder.condition);
    await withTrigger(create, drop, async () => {
      const firstGoing = first();
      firstGoing.catch(() => undefined);
      try {
        expect(await eventually(someoneAtTheGate), 'the first held behind the gate').toBe(true);
        const secondGoing = second(createDatabase(secondPool));
        secondGoing.catch(() => undefined);
        expect(
          await eventually(async () => (await waitingOnALock(tag)) === 1),
          'the second waiting for the row',
        ).toBe(true);

        await held.open();
        answers = {
          first: await bounded(firstGoing, LOCK_WAIT_LIMIT_MS + MARGIN),
          second: await bounded(secondGoing, LOCK_WAIT_LIMIT_MS + MARGIN),
        };
      } finally {
        await held.open();
      }
    });
  } finally {
    await held.end();
    await endTestPool(secondPool);
  }
  if (answers === undefined) {
    throw new Error('the two transactions never met');
  }
  return answers;
}

/** A test-only trigger that refuses, before `event` on `table`, the rows `condition` names (AC18). */
function refuse(table: string, event: string, condition: string) {
  const name = `sm10_refuse_${table}_${event}`;
  return {
    create: [
      `create function ${name}() returns trigger language plpgsql as $$
         begin
           raise exception 'refused by a test trigger' using errcode = 'P0001';
         end
       $$`,
      `create trigger ${name} before ${event} on ${table} for each row when (${condition})
         execute function ${name}()`,
    ],
    drop: [`drop trigger if exists ${name} on ${table}`, `drop function if exists ${name}()`],
  };
}

// ---------------------------------------------------------------------------
// The real adapter, the real modules, and the recording fakes at the edge.
// ---------------------------------------------------------------------------

function removalFor({
  database: on = database(),
  log = fakeLog(),
}: { database?: Database; log?: FakeLog } = {}) {
  return createRemovalService({ journeys: databaseJourneyStore(on), log });
}

/** The removal, through its module, on the shared pool unless another database is given. */
const remove = (
  journeyId: string,
  responderId: string,
  options: { database?: Database; log?: FakeLog } = {},
) => removalFor(options).remove({ journeyId, responderId });

function watchdogFor({
  database: on = database(),
  log = fakeLog(),
}: { database?: Database; log?: FakeLog } = {}) {
  return createWatchdog({
    journeys: databaseJourneyStore(on),
    beats: databaseWorkerHeartbeats(on),
    log,
  });
}

function pushSenderFor({ push = fakePush(), log = fakeLog() }: { push?: FakePush; log?: FakeLog }) {
  return createPushSender({ outbox: store(), push, log });
}

function smsSenderFor({ sms = fakeSms(), log = fakeLog() }: { sms?: FakeSms; log?: FakeLog }) {
  return createSmsSender({ outbox: store(), sms, log });
}

function realApi({
  database: on = database(),
  log = fakeLog(),
}: { database?: Database; log?: FakeLog } = {}) {
  const clock = databaseClock(on);
  return createApi({
    health: createHealthService({ clock, heartbeats: databaseWorkerHeartbeats(on) }),
    journeys: createJourneyService({ clock, journeys: databaseJourneyStore(on), log }),
    devices: databaseDeviceAuthenticator(on),
    acknowledgements: createAcknowledgementService({ alerts: databaseJourneyStore(on), log }),
  });
}

async function post(
  api: ReturnType<typeof realApi>,
  credential: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null; text: string }> {
  const response = await api.request(
    apiPath(route),
    body === undefined
      ? { method: 'POST', headers: { authorization: `Bearer ${credential}` } }
      : {
          method: 'POST',
          headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const text = await response.text();
  return { status: response.status, body: parsedOrNull(text), text };
}

function parsedOrNull(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** "I'm on it" through the API (D-114). */
const acknowledge = (api: ReturnType<typeof realApi>, credential: string, alertId: string) =>
  post(api, credential, `alerts/${alertId}/acknowledgement`);

const recipientsOf = (messages: readonly { recipientId: string }[]) =>
  messages.map(({ recipientId }) => recipientId).sort();

const ofKind = <T extends { kind: string }>(messages: readonly T[], kind: string): T[] =>
  messages.filter((message) => message.kind === kind);

const idsOf = (people: readonly Person[]) => people.map(({ userId }) => userId).sort();

/** A heartbeat for the store, received at the database's now: as fresh as contact gets. */
async function freshHeartbeat(journeyId: string) {
  return {
    journeyId,
    eventId: syntheticEventId(),
    receivedAt: new Date(await databaseNowMs()),
    batteryLevel: null,
    position: null,
  };
}

/** A lost journey whose alert R1 acknowledged through the API: the notices for the others written, unsent. */
async function acknowledgedBy(count: number, { openedAgoMs }: { openedAgoMs?: number } = {}) {
  const journey = await lost({ responders: count });
  if (openedAgoMs !== undefined) {
    await openedAgo(journey.alertId, openedAgoMs);
  }
  const [r1] = journey.responders as [Person];
  expect(await acknowledge(realApi(), r1.credential, journey.alertId)).toMatchObject({
    status: 200,
    body: ON_IT,
  });
  return { ...journey, r1 };
}

// ---------------------------------------------------------------------------
// SM-10-AC2: a removed responder is on the journey for nothing that follows.
// ---------------------------------------------------------------------------

describe('SM-10, LOST-02, LOST-03, LOST-06 and LOST-07: a removed responder is on the journey for nothing that follows, on the real tables', () => {
  test('SM-10-AC2: J started through the API with R1, R2 and R3, R2 removed while J is ACTIVE; silent past five minutes and past two minutes after the alert opened, then back in contact: the lost-contact push, the escalation SMS and the stand-down are each written for and handed to R1 and R3 only; R2’s "I’m on it" is 404 ALERT_NOT_FOUND, the body a stranger gets, and writes nothing (LOST-02, LOST-03, LOST-06, LOST-07)', async () => {
    const api = realApi();
    const push = fakePush();
    const sms = fakeSms();
    const walker = await person();
    const [r1, r2, r3] = [await person(), await person(), await person()];
    const stranger = await person();
    const started = await post(api, walker.credential, 'journeys', {
      responderIds: idsOf([r1, r2, r3]),
    });
    expect(started.status).toBe(201);
    const journeyId = String(started.body?.['journeyId']);
    expect(
      (await post(api, walker.credential, 'heartbeats', syntheticHeartbeat({ journeyId }))).status,
    ).toBe(200);

    expect(await remove(journeyId, r2.userId)).toEqual(REMOVED);
    expect(await respondersOf(journeyId)).toEqual(idsOf([r1, r3]));

    // Silent past five minutes, relative to the database's own now().
    await connection().query(
      `update journeys set started_at = now() - interval '15 minutes',
              last_heartbeat_at = now() - interval '5 minutes 1 second' where id = $1`,
      [journeyId],
    );
    expect(await watchdogFor().sweep()).toEqual({ ...QUIET, opened: 1 });
    await pushSenderFor({ push }).deliverDue();
    const [alert] = await alertsOf(journeyId);
    const alertId = alert?.id ?? '';

    // R2's "I'm on it", as a stranger's.
    const removedOnes = await acknowledge(api, r2.credential, alertId);
    const strangers = await acknowledge(api, stranger.credential, alertId);
    expect(removedOnes.status).toBe(404);
    expect(removedOnes.body?.['code']).toBe('ALERT_NOT_FOUND');
    expect(removedOnes.text).toBe(strangers.text);

    await openedAgo(alertId, TWO_MINUTES);
    expect(await watchdogFor().sweep()).toEqual({ ...QUIET, escalated: 1 });
    await smsSenderFor({ sms }).deliverDue();
    expect((await store().recordHeartbeat(await freshHeartbeat(journeyId))).outcome).toBe(
      'back_in_contact',
    );
    await pushSenderFor({ push }).deliverDue();

    const messages = await messagesOf(journeyId);
    for (const kind of ['LOST_CONTACT', SMS, 'BACK_IN_CONTACT']) {
      expect(recipientsOf(ofKind(messages, kind)), kind).toEqual(idsOf([r1, r3]));
    }
    expect(recipientsOf(push.accepted)).toEqual(
      [r1.userId, r1.userId, r3.userId, r3.userId].sort(),
    );
    expect(recipientsOf(sms.accepted)).toEqual(idsOf([r1, r3]));
    expect(ofKind(messages, NOTICE)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SM-10-AC3: the removal decides under the journey's row.
// ---------------------------------------------------------------------------

describe('SM-10 and SM-09: the removal decides under the journey’s row, on the real tables', () => {
  test.each([
    ['commits without changing J', 'unchanged', REMOVED],
    ['removes R2 first', 'remove', NOT_A_RESPONDER],
    ['ends J first', 'end', JOURNEY_ENDED],
  ] as const)(
    'SM-10-AC3: with J’s row held by a transaction that %s, a removal of R2 waits for the row (pg_stat_activity), then decides by what the holder left',
    async (_what, change, expected) => {
      const { journeyId, responders } = await walking({ responders: 2 });
      const [r1, r2] = responders as [Person, Person];
      const tag = `sm10_ac3_${change}`;
      const removalPool = apiPool(tag);
      const log = fakeLog();
      const holder = await sessionHolding(journeyId);
      let answer: unknown;
      try {
        const removing = remove(journeyId, r2.userId, {
          database: createDatabase(removalPool),
          log,
        });
        removing.catch(() => undefined);
        expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);
        expect(await holder.waitedFor()).toBe(true);
        if (change === 'remove') {
          await holder.run(
            'delete from journey_responders where journey_id = $1 and responder_id = $2',
            [journeyId, r2.userId],
          );
        }
        if (change === 'end') {
          await holder.run("update journeys set state = 'ENDED' where id = $1", [journeyId]);
        }
        await holder.commit();
        answer = await bounded(removing, LOCK_WAIT_LIMIT_MS + MARGIN);
      } finally {
        await holder.end();
        await endTestPool(removalPool);
      }

      expect(answer).toEqual(expected);
      expect(await respondersOf(journeyId)).toEqual(
        change === 'end' ? idsOf([r1, r2]) : [r1.userId],
      );
      expect(log.events).toEqual(
        change === 'end' ? [{ event: 'removal_ignored', reason: 'JOURNEY_ENDED', journeyId }] : [],
      );
      expect(await warningsOf(journeyId)).toEqual([]);
    },
    30_000,
  );

  test(`SM-10-AC3: ${String(RACERS)} removals of R2 at once on separate connections, ${String(RACE_ROUNDS)} times over, R2 the only responder and the acknowledger: exactly one answers removed and every other unchanged, none an error; one reset, the round raised once, and one warning`, async () => {
    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const at = `round ${String(round)}`;
      const { journeyId, alertId, responders, walker } = await lost({ responders: 1 });
      const [r2] = responders as [Person];
      await connection().query(
        `update alerts set state = 'ACKNOWLEDGED', acknowledged_by = $2, acknowledged_at = now()
          where id = $1`,
        [alertId, r2.userId],
      );

      const answers = await Promise.all(
        Array.from({ length: RACERS }, () =>
          remove(journeyId, r2.userId).then(
            (answer: unknown) => answer,
            (error: unknown) => ({ error: sqlstateOf(error) ?? String(error) }),
          ),
        ),
      );

      expect(
        answers.filter((answer: unknown) => JSON.stringify(answer) === JSON.stringify(REMOVED)),
        at,
      ).toHaveLength(1);
      expect(
        answers.filter((answer: unknown) => JSON.stringify(answer) !== JSON.stringify(REMOVED)),
        at,
      ).toEqual(Array.from({ length: RACERS - 1 }, () => NOT_A_RESPONDER));
      expect(await respondersOf(journeyId), at).toEqual([]);
      expect(
        (await alertsOf(journeyId)).map(({ state, acknowledgedBy, round: r }) => [
          state,
          acknowledgedBy,
          r,
        ]),
        at,
      ).toEqual([['OPEN', null, 2]]);
      expect(
        (await warningsOf(journeyId)).map(({ recipientId, kind }) => [recipientId, kind]),
        at,
      ).toEqual([[walker.userId, WARNING]]);
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// SM-10-AC5 to AC7: escalation resumes, on the real tables.
// ---------------------------------------------------------------------------

describe('SM-10, LOST-06, LOST-07 and REL-07: escalation resumes after the acknowledger’s removal, on the real tables', () => {
  test('SM-10-AC5: R1’s "I’m on it" through the API, then R1 removed, with the alert opened 90 s before now(): the alert is OPEN in round 2 with nobody on it; a sweep escalates nothing; with its opened_at moved to two minutes before now(), the next sweep escalates it, ESCALATED between two readings of now(), with one LOST_CONTACT_SMS each for R2 and R3 in round 2, none for R1 or W; the SMS sender hands exactly those two over (LOST-07, REL-07)', async () => {
    const { journeyId, alertId, walker, responders, r1 } = await acknowledgedBy(3, {
      openedAgoMs: 90 * SECOND,
    });
    const [, r2, r3] = responders as [Person, Person, Person];
    const sms = fakeSms();

    expect(await remove(journeyId, r1.userId)).toEqual(REMOVED);
    expect(
      (await alertsOf(journeyId)).map(
        ({ state, acknowledgedBy: by, acknowledgedAt, smsRaisedAt, round }) => [
          state,
          by,
          acknowledgedAt,
          smsRaisedAt,
          round,
        ],
      ),
    ).toEqual([['OPEN', null, null, null, 2]]);
    expect(await watchdogFor().sweep()).toEqual(QUIET);
    expect(ofKind(await messagesOf(journeyId), SMS)).toEqual([]);

    await openedAgo(alertId, TWO_MINUTES);
    const before = await databaseNowMs();
    expect(await watchdogFor().sweep()).toEqual({ ...QUIET, escalated: 1 });
    const after = await databaseNowMs();

    const [alert] = await alertsOf(journeyId);
    expect(alert?.state).toBe('ESCALATED');
    expect(alert?.smsRaisedAt).toBeGreaterThanOrEqual(before);
    expect(alert?.smsRaisedAt).toBeLessThanOrEqual(after);
    const written = ofKind(await messagesOf(journeyId), SMS);
    expect(recipientsOf(written)).toEqual(idsOf([r2, r3]));
    expect(written.map(({ round }) => round)).toEqual([2, 2]);
    expect(await smsSenderFor({ sms }).deliverDue()).toEqual({ sent: 2, failed: 0 });
    expect(recipientsOf(sms.accepted)).toEqual(idsOf([r2, r3]));
    expect(recipientsOf(sms.messages)).not.toContain(walker.userId);
  });

  test('SM-10-AC5: with the alert’s two minutes long past when R1 is removed, the first sweep after the removal escalates it (LOST-07, REL-07)', async () => {
    const { journeyId, r1 } = await acknowledgedBy(2, { openedAgoMs: 5 * MINUTE });
    expect(await watchdogFor().sweep()).toEqual(QUIET);

    expect(await remove(journeyId, r1.userId)).toEqual(REMOVED);

    expect(await watchdogFor().sweep()).toEqual({ ...QUIET, escalated: 1 });
    expect((await alertsOf(journeyId))[0]).toMatchObject({ state: 'ESCALATED', round: 2 });
  });

  test('SM-10-AC6: A escalated with round-1 SMS for R1, R2 and R3, R3’s unsent; R1’s "I’m on it" withdraws R3’s; R1 removed: the next sweep escalates A again, sms_raised_at that sweep’s now(), one new LOST_CONTACT_SMS each for R2 and R3 in round 2, each with an ID of its own, none for R1; the round-1 rows as they were; the SMS sender hands over those two only; a later sweep escalates nothing more (LOST-07, REL-07)', async () => {
    const { journeyId, alertId, responders } = await due({ responders: 3 });
    const [r1, r2, r3] = responders as [Person, Person, Person];
    const sms = fakeSms();
    expect(await watchdogFor().sweep()).toEqual({ ...QUIET, escalated: 1 });
    // R1's and R2's round-1 SMS accepted; R3's left unsent.
    await connection().query(
      `update outbox set sent_at = now() where alert_id = $1 and kind::text = $2
          and recipient_id <> $3`,
      [alertId, SMS, r3.userId],
    );
    expect(await acknowledge(realApi(), r1.credential, alertId)).toMatchObject({ status: 200 });
    const firstRound = ofKind(await messagesOf(journeyId), SMS);
    expect(firstRound.find(({ recipientId }) => recipientId === r3.userId)?.withdrawnAt).not.toBe(
      null,
    );

    expect(await remove(journeyId, r1.userId)).toEqual(REMOVED);
    const before = await databaseNowMs();
    expect(await watchdogFor().sweep()).toEqual({ ...QUIET, escalated: 1 });
    const after = await databaseNowMs();

    const [alert] = await alertsOf(journeyId);
    expect(alert).toMatchObject({ state: 'ESCALATED', round: 2 });
    expect(alert?.smsRaisedAt).toBeGreaterThanOrEqual(before);
    expect(alert?.smsRaisedAt).toBeLessThanOrEqual(after);
    const all = ofKind(await messagesOf(journeyId), SMS);
    const firstIds = firstRound.map(({ messageId }) => messageId);
    const secondRound = all.filter(({ messageId }) => !firstIds.includes(messageId));
    expect(recipientsOf(secondRound)).toEqual(idsOf([r2, r3]));
    expect(secondRound.map(({ round }) => round)).toEqual([2, 2]);
    expect(new Set(secondRound.map(({ messageId }) => messageId)).size).toBe(2);
    expect(all.filter(({ messageId }) => firstIds.includes(messageId))).toEqual(firstRound);
    expect(await smsSenderFor({ sms }).deliverDue()).toEqual({ sent: 2, failed: 0 });
    expect(recipientsOf(sms.accepted)).toEqual(idsOf([r2, r3]));

    expect(await watchdogFor().sweep()).toEqual(QUIET);
    expect(ofKind(await messagesOf(journeyId), SMS)).toHaveLength(5);
  });

  test('SM-10-AC7: with A escalated again in round 2 and R3’s round-2 SMS unsent, R2’s "I’m on it" through the API is 200: A ACKNOWLEDGED by R2, one ACKNOWLEDGED notice for R3 in round 2, R3’s unsent SMS withdrawn; R2 removed too: A OPEN in round 3, and the next sweep texts R3 alone, in round 3 (LOST-06, LOST-07)', async () => {
    const { journeyId, alertId, responders } = await due({ responders: 3 });
    const [r1, r2, r3] = responders as [Person, Person, Person];
    expect(await watchdogFor().sweep()).toEqual({ ...QUIET, escalated: 1 });
    expect(await acknowledge(realApi(), r1.credential, alertId)).toMatchObject({ status: 200 });
    expect(await remove(journeyId, r1.userId)).toEqual(REMOVED);
    await markAllSent();
    expect(await watchdogFor().sweep()).toEqual({ ...QUIET, escalated: 1 });
    // R2's round-2 SMS accepted, R3's left unsent.
    await connection().query(
      `update outbox set sent_at = now() where alert_id = $1 and recipient_id = $2 and round = 2`,
      [alertId, r2.userId],
    );

    expect(await acknowledge(realApi(), r2.credential, alertId)).toMatchObject({
      status: 200,
      body: ON_IT,
    });
    const [acknowledged] = await alertsOf(journeyId);
    expect(acknowledged).toMatchObject({ state: 'ACKNOWLEDGED', acknowledgedBy: r2.userId });
    const roundTwo = (await messagesOf(journeyId)).filter(({ round }) => round === 2);
    expect(ofKind(roundTwo, NOTICE).map(({ recipientId, round }) => [recipientId, round])).toEqual([
      [r3.userId, 2],
    ]);
    expect(
      ofKind(roundTwo, SMS).find(({ recipientId }) => recipientId === r3.userId),
    ).toMatchObject({ sentAt: null, withdrawnAt: acknowledged?.acknowledgedAt });

    expect(await remove(journeyId, r2.userId)).toEqual(REMOVED);
    expect((await alertsOf(journeyId))[0]).toMatchObject({
      state: 'OPEN',
      acknowledgedBy: null,
      smsRaisedAt: null,
      round: 3,
    });
    expect(await watchdogFor().sweep()).toEqual({ ...QUIET, escalated: 1 });
    const roundThree = ofKind(await messagesOf(journeyId), SMS).filter(({ round }) => round === 3);
    expect(recipientsOf(roundThree)).toEqual([r3.userId]);
  });
});

// ---------------------------------------------------------------------------
// SM-10-AC9: the removal and "I'm on it" meet on the journey's row.
// ---------------------------------------------------------------------------

describe('SM-10, LOST-06 and SM-09: the removal and "I’m on it" meet on the journey’s row, on the real tables', () => {
  test('SM-10-AC9: R1’s acknowledgement has read A, R1 a responder, and waits for J’s row while R1’s removal holds it, held open behind a gate once it deleted R1’s row; the removal commits: the acknowledgement answers 404 ALERT_NOT_FOUND from the store’s decision under the lock and writes nothing: A unacknowledged, no notice (LOST-06)', async () => {
    const { journeyId, alertId, responders } = await lost({ responders: 2 });
    const [r1] = responders as [Person, Person];
    const stranger = await person();
    const strangers = await acknowledge(realApi(), stranger.credential, alertId);

    const { first, second } = await inOrder({
      holder: {
        table: 'journey_responders',
        event: 'delete',
        condition: `old.responder_id = '${r1.userId}'`,
      },
      first: () => remove(journeyId, r1.userId),
      second: (on) => acknowledge(realApi({ database: on }), r1.credential, alertId),
      tag: 'sm10_ac9_acknowledgement',
    });

    expect(first).toEqual(REMOVED);
    expect(second).toMatchObject({ status: 404, text: strangers.text });
    expect(
      (await alertsOf(journeyId)).map(({ state, acknowledgedBy, round }) => [
        state,
        acknowledgedBy,
        round,
      ]),
    ).toEqual([['OPEN', null, 1]]);
    expect(ofKind(await messagesOf(journeyId), NOTICE)).toEqual([]);
  }, 30_000);

  test('SM-10-AC9: R1’s acknowledgement holds J’s row, held open behind a gate once it recorded R1, and R1’s removal waits for it; the acknowledgement commits: the removal resets A, OPEN in round 2 with nobody on it, and withdraws R2’s unsent notice at its own now() (LOST-06)', async () => {
    const { journeyId, alertId, responders } = await lost({ responders: 2 });
    const [r1, r2] = responders as [Person, Person];

    const { first, second } = await inOrder({
      holder: { table: 'alerts', event: 'update', condition: "new.state = 'ACKNOWLEDGED'" },
      first: () => acknowledge(realApi(), r1.credential, alertId),
      second: (on) => remove(journeyId, r1.userId, { database: on }),
      tag: 'sm10_ac9_removal',
    });

    expect(first).toMatchObject({ status: 200, body: ON_IT });
    expect(second).toEqual(REMOVED);
    expect(
      (await alertsOf(journeyId)).map(({ state, acknowledgedBy, acknowledgedAt, round }) => [
        state,
        acknowledgedBy,
        acknowledgedAt,
        round,
      ]),
    ).toEqual([['OPEN', null, null, 2]]);
    const notices = ofKind(await messagesOf(journeyId), NOTICE);
    expect(recipientsOf(notices)).toEqual([r2.userId]);
    expect(notices.map(({ withdrawnAt }) => withdrawnAt === null)).toEqual([false]);
  }, 30_000);

  test(`SM-10-AC9: R1’s acknowledgement and R1’s removal starting at the same moment on separate connections, ${String(RACE_ROUNDS)} rounds: every round ends with A unacknowledged, either acknowledged and then reset, or refused 404; never A acknowledged by someone who is not a responder, and never a notice left pending (LOST-06)`, async () => {
    const api = realApi();
    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const at = `round ${String(round)}`;
      const { journeyId, alertId, responders } = await lost({ responders: 2 });
      const [r1] = responders as [Person, Person];

      const [acknowledged, removed] = await Promise.all([
        acknowledge(api, r1.credential, alertId),
        remove(journeyId, r1.userId),
      ]);

      expect(removed, at).toEqual(REMOVED);
      expect([200, 404], at).toContain(acknowledged.status);
      const [alert] = await alertsOf(journeyId);
      expect(alert, at).toMatchObject({
        state: 'OPEN',
        acknowledgedBy: null,
        round: acknowledged.status === 200 ? 2 : 1,
      });
      expect(
        ofKind(await messagesOf(journeyId), NOTICE).filter(
          ({ sentAt, withdrawnAt }) => sentAt === null && withdrawnAt === null,
        ),
        at,
      ).toEqual([]);
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// SM-10-AC10: the removal meets the open, the escalation and the resolution,
// each order forced by a transaction held open behind a gate.
// ---------------------------------------------------------------------------

describe('SM-10, LOST-02, LOST-03, LOST-07 and SM-04: the removal meets the open, the escalation and the resolution on the journey’s row, on the real tables', () => {
  /** The removal of R2 holding J's row, held open behind a gate once it deleted R2's row. */
  const removalHolds = (journeyId: string, r2: Person) => ({
    holder: {
      table: 'journey_responders',
      event: 'delete',
      condition: `old.responder_id = '${r2.userId}'`,
    },
    first: () => remove(journeyId, r2.userId),
  });

  test('SM-10-AC10: a removal before the open (the removal holding J’s row, the waiting open behind it): the open writes LOST_CONTACT for R1 and R3 only (LOST-02)', async () => {
    const { journeyId, responders } = await silent({ responders: 3 });
    const [r1, r2, r3] = responders as [Person, Person, Person];

    const { first, second } = await inOrder({
      ...removalHolds(journeyId, r2),
      second: (on) =>
        databaseJourneyStore(on).openLostContactAlert({
          journeyId,
          afterMs: LOST_CONTACT_AFTER_MS,
          lockWaitMs: LOCK_WAIT_LIMIT_MS,
        }),
      tag: 'sm10_ac10_open',
      pool: workerPool,
    });

    expect(first).toEqual(REMOVED);
    expect(second).toMatchObject({ outcome: 'opened' });
    expect(recipientsOf(ofKind(await messagesOf(journeyId), 'LOST_CONTACT'))).toEqual(
      idsOf([r1, r3]),
    );
  }, 30_000);

  test('SM-10-AC10: a removal after the open (the open holding J’s row once it wrote its pushes, the removal waiting): R2’s unsent LOST_CONTACT is withdrawn at the removal’s now(), and R2 has nothing pending (LOST-02)', async () => {
    const { journeyId, responders } = await silent({ responders: 3 });
    const [, r2] = responders as [Person, Person, Person];

    const { first, second } = await inOrder({
      holder: { table: 'outbox', event: 'insert', condition: "new.kind::text = 'LOST_CONTACT'" },
      first: () => store().openLostContactAlert({ journeyId, afterMs: LOST_CONTACT_AFTER_MS }),
      second: (on) => remove(journeyId, r2.userId, { database: on }),
      tag: 'sm10_ac10_after_open',
    });

    expect(first).toMatchObject({ outcome: 'opened' });
    expect(second).toEqual(REMOVED);
    const r2Push = ofKind(await messagesOf(journeyId), 'LOST_CONTACT').find(
      ({ recipientId }) => recipientId === r2.userId,
    );
    expect(r2Push).toMatchObject({ sentAt: null });
    expect(r2Push?.withdrawnAt).not.toBeNull();
    expect(await pendingFor(journeyId, r2.userId)).toEqual([]);
  }, 30_000);

  test('SM-10-AC10: a removal before the escalation (the removal holding J’s row, the waiting escalation behind it): the SMS go to R1 and R3 only (LOST-07)', async () => {
    const { journeyId, alertId, responders } = await due({ responders: 3 });
    const [r1, r2, r3] = responders as [Person, Person, Person];

    const { first, second } = await inOrder({
      ...removalHolds(journeyId, r2),
      second: (on) =>
        databaseJourneyStore(on).escalateAlert({ alertId, lockWaitMs: LOCK_WAIT_LIMIT_MS }),
      tag: 'sm10_ac10_escalation',
      pool: workerPool,
    });

    expect(first).toEqual(REMOVED);
    expect(second).toMatchObject({ outcome: 'escalated' });
    expect(recipientsOf(ofKind(await messagesOf(journeyId), SMS))).toEqual(idsOf([r1, r3]));
  }, 30_000);

  test('SM-10-AC10: a removal after the escalation (the escalation holding J’s row once it wrote its SMS, the removal waiting): R2’s unsent SMS is withdrawn, never handed to the SMS port, and R2 has nothing pending (LOST-07)', async () => {
    const { journeyId, alertId, responders } = await due({ responders: 3 });
    const [r1, r2, r3] = responders as [Person, Person, Person];
    const sms = fakeSms();

    const { first, second } = await inOrder({
      holder: { table: 'outbox', event: 'insert', condition: `new.kind::text = '${SMS}'` },
      first: () => store().escalateAlert({ alertId }),
      second: (on) => remove(journeyId, r2.userId, { database: on }),
      tag: 'sm10_ac10_after_escalation',
    });

    expect(first).toMatchObject({ outcome: 'escalated' });
    expect(second).toEqual(REMOVED);
    expect(await pendingFor(journeyId, r2.userId)).toEqual([]);
    await smsSenderFor({ sms }).deliverDue();
    expect(recipientsOf(sms.messages)).toEqual(idsOf([r1, r3]));
  }, 30_000);

  test('SM-10-AC10: a removal before contact comes back (the removal holding J’s row, the heartbeat waiting): the stand-downs go to R1 and R3 only (LOST-03)', async () => {
    const { journeyId, responders } = await lost({ responders: 3 });
    const [r1, r2, r3] = responders as [Person, Person, Person];

    const { first, second } = await inOrder({
      ...removalHolds(journeyId, r2),
      second: async (on) =>
        databaseJourneyStore(on).recordHeartbeat(await freshHeartbeat(journeyId)),
      tag: 'sm10_ac10_contact',
    });

    expect(first).toEqual(REMOVED);
    expect(second).toMatchObject({ outcome: 'back_in_contact' });
    expect(recipientsOf(ofKind(await messagesOf(journeyId), 'BACK_IN_CONTACT'))).toEqual(
      idsOf([r1, r3]),
    );
  }, 30_000);

  test('SM-10-AC10: a removal after contact came back (the heartbeat holding J’s row once it wrote its stand-downs, the removal waiting): R2’s unsent stand-down is withdrawn, and R2 has nothing pending (LOST-03)', async () => {
    const { journeyId, responders } = await lost({ responders: 3 });
    const [, r2] = responders as [Person, Person, Person];
    await markAllSent();

    const { first, second } = await inOrder({
      holder: {
        table: 'outbox',
        event: 'insert',
        condition: "new.kind::text = 'BACK_IN_CONTACT'",
      },
      first: async () => store().recordHeartbeat(await freshHeartbeat(journeyId)),
      second: (on) => remove(journeyId, r2.userId, { database: on }),
      tag: 'sm10_ac10_after_contact',
    });

    expect(first).toMatchObject({ outcome: 'back_in_contact' });
    expect(second).toEqual(REMOVED);
    const standDown = ofKind(await messagesOf(journeyId), 'BACK_IN_CONTACT').find(
      ({ recipientId }) => recipientId === r2.userId,
    );
    expect(standDown?.withdrawnAt).not.toBeNull();
    expect(await pendingFor(journeyId, r2.userId)).toEqual([]);
  }, 30_000);

  test('SM-10-AC10: a removal before "I’m home" (the removal holding J’s row, "I’m home" waiting): the stand-downs go to R1 and R3 only; after "I’m home" J has ENDED, so a removal is ignored, JOURNEY_ENDED (SM-04, SM-07)', async () => {
    const { journeyId, walker, responders } = await lost({ responders: 3 });
    const [r1, r2, r3] = responders as [Person, Person, Person];

    const { first, second } = await inOrder({
      ...removalHolds(journeyId, r2),
      second: (on) =>
        post(realApi({ database: on }), walker.credential, `journeys/${journeyId}/home`),
      tag: 'sm10_ac10_home',
    });

    expect(first).toEqual(REMOVED);
    expect(second).toMatchObject({ status: 200 });
    expect(recipientsOf(ofKind(await messagesOf(journeyId), 'HOME'))).toEqual(idsOf([r1, r3]));

    const log = fakeLog();
    const before = await recordOf(journeyId);
    expect(await remove(journeyId, r1.userId, { log })).toEqual(JOURNEY_ENDED);
    expect(await recordOf(journeyId)).toEqual(before);
    expect(log.events).toEqual([{ event: 'removal_ignored', reason: 'JOURNEY_ENDED', journeyId }]);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// SM-10-AC13: one warning for the last responder, whoever removes.
// ---------------------------------------------------------------------------

describe('SM-10 and SM-02: one warning for the last responder, on the real tables', () => {
  test(`SM-10-AC13: J’s last two responders removed at the same moment on separate connections, ${String(RACE_ROUNDS)} rounds: both answer removed, none an error, and each round writes exactly one NO_RESPONDER, for W, naming J and no alert (SM-02)`, async () => {
    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const at = `round ${String(round)}`;
      const { journeyId, walker, responders } = await walking({ responders: 2 });
      const [r1, r2] = responders as [Person, Person];

      const answers = await Promise.all([
        remove(journeyId, r1.userId).catch((error: unknown) => ({ error: sqlstateOf(error) })),
        remove(journeyId, r2.userId).catch((error: unknown) => ({ error: sqlstateOf(error) })),
      ]);

      expect(answers, at).toEqual([REMOVED, REMOVED]);
      expect(await respondersOf(journeyId), at).toEqual([]);
      expect(
        (await warningsOf(journeyId)).map(({ recipientId, kind, alertId, round: r }) => [
          recipientId,
          kind,
          alertId,
          r,
        ]),
        at,
      ).toEqual([[walker.userId, WARNING, null, 1]]);
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// SM-10-AC18: a removal is all or nothing, and a failure is loud.
// ---------------------------------------------------------------------------

describe('SM-10: a removal is all or nothing, and a failure is loud, on the real tables', () => {
  /** J LOST_CONTACT, its alert acknowledged by its only responder R1, R1's lost-contact push unsent: removing R1 resets, withdraws and warns. */
  async function lastAcknowledger() {
    const journey = await lost({ responders: 1 });
    const [r1] = journey.responders as [Person];
    await connection().query(
      `update alerts set state = 'ACKNOWLEDGED', acknowledged_by = $2, acknowledged_at = now()
        where id = $1`,
      [journey.alertId, r1.userId],
    );
    return { ...journey, r1 };
  }

  test.each([
    ['the warning’s insert', 'outbox', 'insert', `new.kind::text = '${WARNING}'`],
    [
      'the reset’s update',
      'alerts',
      'update',
      'old.acknowledged_by is not null and new.acknowledged_by is null',
    ],
    [
      'the removed responder’s withdrawal',
      'outbox',
      'update',
      'old.withdrawn_at is null and new.withdrawn_at is not null',
    ],
  ] as const)(
    'SM-10-AC18: with a test trigger refusing %s, the removal fails: R1’s row still there, A and every message as they were, no warning; one removal_failed line, stage store, with the SQLSTATE; the module throws, never answering; once the trigger is removed, the same removal does all of its work',
    async (_what, table, event, condition) => {
      const { journeyId, r1 } = await lastAcknowledger();
      const before = await recordOf(journeyId);
      expect(before.warnings).toEqual([]);
      const log = fakeLog();
      const { create, drop } = refuse(table, event, condition);

      await withTrigger(create, drop, async () => {
        const outcome = await remove(journeyId, r1.userId, { log }).then(
          (answer: unknown) => ({ answer }),
          (error: unknown) => ({ error }),
        );
        expect(outcome).not.toHaveProperty('answer');
        expect(sqlstateOf((outcome as { error?: unknown }).error)).toBe('P0001');
      });

      expect(await recordOf(journeyId)).toEqual(before);
      expect(log.events).toEqual([{ event: 'removal_failed', stage: 'store', code: 'P0001' }]);

      expect(await remove(journeyId, r1.userId)).toEqual(REMOVED);
      const after = await recordOf(journeyId);
      expect(after.responders).toEqual([]);
      expect(
        after.alerts.map(({ state, acknowledgedBy, round }) => [state, acknowledgedBy, round]),
      ).toEqual([['OPEN', null, 2]]);
      expect(after.messages.filter(({ withdrawnAt }) => withdrawnAt === null)).toEqual([]);
      expect(after.warnings.map(({ kind }) => kind)).toEqual([WARNING]);
    },
    30_000,
  );

  // The removal bounds its own wait (approach item 6, step 1; D-123): it sets
  // lock_timeout to LOCK_WAIT_LIMIT_MS in its own transaction, whichever pool
  // runs it. On the API's pool, which has the same limit already, a removal
  // that set none would pass unseen; on the worker's, which has no limit of
  // its own (D-108), it would wait until the holder ended, and this test would
  // say 'still waiting'. So both.
  test.each([
    ['the API’s pool, which has its own 5 s limit', 'api', apiPool],
    ['the worker’s pool, which has no limit of its own (D-108)', 'worker', workerPool],
  ] as const)(
    'SM-10-AC18: on %s, a removal whose wait for J’s row passes its own 5 s lock limit waits for the row (pg_stat_activity), at least the limit, and fails within the limit plus a margin with 55P03: one removal_failed line, stage store, code 55P03; nothing changed',
    async (_pool, name, poolFor) => {
      const { journeyId, r1 } = await lastAcknowledger();
      const before = await recordOf(journeyId);
      const log = fakeLog();
      const tag = `sm10_ac18_lock_${name}`;
      const removalPool = poolFor(tag);
      const holder = await sessionHolding(journeyId);
      let outcome: unknown;
      let tookMs: number | undefined;
      try {
        const started = performance.now();
        const removing = remove(journeyId, r1.userId, {
          database: createDatabase(removalPool),
          log,
        }).then(
          (answer: unknown) => ({ answer }),
          (error: unknown) => ({ error }),
        );
        expect(
          await eventually(async () => (await waitingOnALock(tag)) === 1),
          'the removal waiting for J’s row',
        ).toBe(true);
        outcome = await bounded(
          removing,
          Math.max(0, LOCK_WAIT_LIMIT_MS + MARGIN - (performance.now() - started)),
        );
        tookMs = performance.now() - started;
      } finally {
        await holder.end();
        await endTestPool(removalPool);
      }

      expect(outcome).not.toBe('still waiting');
      expect(sqlstateOf((outcome as { error?: unknown }).error)).toBe('55P03');
      expect(tookMs).toBeGreaterThanOrEqual(LOCK_WAIT_LIMIT_MS);
      expect(log.events).toEqual([{ event: 'removal_failed', stage: 'store', code: '55P03' }]);
      expect(await recordOf(journeyId)).toEqual(before);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// SM-10-AC19: the removal's times are the database's.
// ---------------------------------------------------------------------------

describe('SM-10 and REL-01: the removal’s times are the database’s', () => {
  test('SM-10-AC19: removing the acknowledger: each withdrawal (R1’s unsent push, the others’ unsent notices) equals the removal transaction’s now() to the microsecond, between two readings of now(), written by the same transaction as the reset (xmin)', async () => {
    const { journeyId, alertId, r1 } = await acknowledgedBy(3);
    const before = await databaseNowText();

    expect(await remove(journeyId, r1.userId)).toEqual(REMOVED);

    const after = await databaseNowText();
    const [alert] = await alertsOf(journeyId);
    const withdrawn = (await messagesOf(journeyId)).filter(
      ({ withdrawnText }) => withdrawnText !== null,
    );
    expect(
      withdrawn
        .map(({ recipientId, kind }) => `${kind} ${recipientId === r1.userId ? 'R1' : 'other'}`)
        .sort(),
    ).toEqual(['ACKNOWLEDGED other', 'ACKNOWLEDGED other', 'LOST_CONTACT R1']);
    const [at] = withdrawn.map(({ withdrawnText }) => withdrawnText);
    expect(withdrawn.map(({ withdrawnText }) => withdrawnText)).toEqual([at, at, at]);
    const bounds = await connection().query<{ inside: boolean }>(
      'select $1::timestamptz >= $2::timestamptz and $1::timestamptz <= $3::timestamptz as inside',
      [at, before, after],
    );
    expect(bounds.rows).toEqual([{ inside: true }]);
    expect(withdrawn.map(({ xmin }) => xmin)).toEqual(withdrawn.map(() => alert?.xmin));
    expect(alert).toMatchObject({ id: alertId, state: 'OPEN', round: 2 });
  });

  test('SM-10-AC19: removing the last responder: the warning’s created_at and next_attempt_at equal the removal transaction’s now() to the microsecond, as R1’s withdrawal does, between two readings of now(), in the same transaction (xmin)', async () => {
    const { journeyId, responders } = await lost({ responders: 1 });
    const [r1] = responders as [Person];
    const before = await databaseNowText();

    expect(await remove(journeyId, r1.userId)).toEqual(REMOVED);

    const after = await databaseNowText();
    const [warning, ...others] = await warningsOf(journeyId);
    expect(others).toEqual([]);
    const [push] = (await messagesOf(journeyId)).filter(
      ({ recipientId }) => recipientId === r1.userId,
    );
    expect(warning?.nextAttemptText).toBe(warning?.createdText);
    expect(push?.withdrawnText).toBe(warning?.createdText);
    expect(push?.xmin).toBe(warning?.xmin);
    const bounds = await connection().query<{ inside: boolean }>(
      'select $1::timestamptz >= $2::timestamptz and $1::timestamptz <= $3::timestamptz as inside',
      [warning?.createdText, before, after],
    );
    expect(bounds.rows).toEqual([{ inside: true }]);
  });

  test('SM-10-AC19: the resumed escalation’s sms_raised_at is the sweep’s own now(), between two readings taken around the sweep, and later than the removal’s (REL-01)', async () => {
    const { journeyId, r1 } = await acknowledgedBy(2, { openedAgoMs: 5 * MINUTE });
    expect(await remove(journeyId, r1.userId)).toEqual(REMOVED);
    const removedAt = (await messagesOf(journeyId)).find(
      ({ withdrawnAt }) => withdrawnAt !== null,
    )?.withdrawnAt;
    await sleep(20);

    const before = await databaseNowMs();
    expect(await watchdogFor().sweep()).toEqual({ ...QUIET, escalated: 1 });
    const after = await databaseNowMs();

    const [alert] = await alertsOf(journeyId);
    expect(alert?.smsRaisedAt).toBeGreaterThanOrEqual(before);
    expect(alert?.smsRaisedAt).toBeLessThanOrEqual(after);
    expect(alert?.smsRaisedAt).toBeGreaterThan(removedAt ?? Number.POSITIVE_INFINITY);
    expect(await lastBeatMs()).toBeGreaterThanOrEqual(before);
  });
});
