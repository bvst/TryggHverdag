// L3 server integration: "They're safe" (LOST-08, SM-06) on the real tables.
//
// The system tests prove the close rule and its flows against a fake store.
// What only a real PostgreSQL can prove is here:
//   - the flow, through the real adapter, the real modules and the recording
//     push (AC1), after a reset (AC3), and what the walker will be shown, read
//     together (AC6);
//   - the close deciding under the journey's row against a removal, contact
//     back, "I'm home" and the 24-hour end, in both orders, each seen waiting
//     in pg_stat_activity, and racing closes on separate connections (AC4);
//   - the per-responder hold, to the microsecond (AC7);
//   - all or nothing, with a test trigger refusing each write in turn, and the
//     API's lock limit (AC16); every time the transaction's now() (AC17).
// The shared behaviour suite runs the store's side of AC1 to AC4, AC6, AC7
// and AC21 against the adapter in adapters/journeys.integration.test.ts.
//
// PostgreSQL 15, staging's version, as deploy.integration.test.ts explains.
// Needs Docker, like every *.integration.test.ts: CI's integration job runs
// it, a cloud session cannot.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  RACE_ROUNDS,
  RACERS,
  apiPath,
  endTestPool,
  fakeLog,
  fakePush,
  syntheticCredential,
  syntheticEventId,
  syntheticUuid,
  type FakeLog,
  type FakePush,
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
import { LOCK_WAIT_LIMIT_MS } from './domain/watchdog.ts';
import { createAcknowledgementService } from './modules/alerts/acknowledgement.ts';
import { createClosureService } from './modules/alerts/closure.ts';
import { createPushSender } from './modules/alerts/outbox.ts';
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
const HOUR = 60 * MINUTE;
/** SM-06 (D-126): 24 hours, written out; the domain's constant is held to it below. */
const A_DAY = 24 * HOUR;
/** How far past its 24 hours an alert is stuck (D-116): the sweep then waits for its row once. */
const STUCK_AFTER = 30 * SECOND;
/** How much longer than the lock limit a wait may take here before it counts as never ending. */
const MARGIN = 2_500;

const QUIET = { ok: true, opened: 0, escalated: 0, stuck: 0 };
const ON_IT = { outcome: 'ACKNOWLEDGED' };
const CLOSED = { outcome: 'CLOSED' };

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
  // A quiet database for each test: every journey left unended ended, every
  // alert left unresolved resolved as "I'm home" would have resolved it, and
  // every message left due put out of reach as sent, so a sweep or a claim
  // here sees only what the test itself put in.
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

/** A pool of its own, named, with the API's lock limit, so a test can see in pg_stat_activity what its sessions wait for. */
function apiPool(applicationName: string, size = 2): pg.Pool {
  return createPool(withParameter(connectionUri(), 'application_name', applicationName), size, {
    lockTimeoutMs: LOCK_WAIT_LIMIT_MS,
  });
}

/** A pool of its own, named, with no lock limit, as the worker's is: the 24-hour end bounds its own waits. */
function workerPool(applicationName: string, size = 2): pg.Pool {
  return createPool(withParameter(connectionUri(), 'application_name', applicationName), size);
}

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

/**
 * An ACTIVE journey of a new walker, put in directly with `responders`
 * responders, each with a device of their own: started two hours before
 * now(), and last heard from an hour before now().
 */
async function silent({ responders = 3 }: { responders?: number } = {}) {
  const walker = await person();
  const following: Person[] = [];
  for (let i = 0; i < responders; i += 1) {
    following.push(await person());
  }
  const journeyId = syntheticUuid();
  await connection().query(
    `insert into journeys (id, walker_id, device_id, state, started_at, last_heartbeat_at)
     values ($1, $2, $3, 'ACTIVE', now() - interval '26 hours', now() - interval '25 hours')`,
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

/** As `lost`, its first responder, R1, on it through the API: the alert ACKNOWLEDGED by R1. */
async function acknowledged({ responders = 3 }: { responders?: number } = {}) {
  const journey = await lost({ responders });
  const [r1] = journey.responders as [Person, ...Person[]];
  const answer = await acknowledge(realApi(), r1.credential, journey.alertId);
  expect({ status: answer.status, body: answer.body }, 'R1 on it').toEqual({
    status: 200,
    body: ON_IT,
  });
  return { ...journey, r1, others: journey.responders.slice(1) };
}

/** Moves the alert's opened_at to `ms` before the database's now(). */
async function openedAgo(alertId: string, ms: number): Promise<void> {
  await connection().query(
    `update alerts set opened_at = now() - ($2::double precision * interval '1 millisecond')
      where id = $1`,
    [alertId, ms],
  );
}

/** A moment as milliseconds since the epoch, in SQL, floored as a Date floors it. */
const MS = (column: string) => `floor(extract(epoch from ${column}) * 1000)::bigint::text`;

async function databaseNowMs(): Promise<number> {
  const result = await connection().query<{ ms: string }>(`select ${MS('now()')} as ms`);
  return Number(result.rows[0]?.ms);
}

/** The database's now(), as PostgreSQL prints it, to the microsecond. */
async function databaseNowText(): Promise<string> {
  const result = await connection().query<{ now: string }>('select now()::text as now');
  return result.rows[0]?.now ?? '';
}

const numberOrNull = (ms: string | null | undefined): number | null =>
  ms === null || ms === undefined ? null : Number(ms);

/** The journey as the table holds it: its state, and when and why it ended, to the microsecond. */
async function journeyOf(journeyId: string) {
  const result = await connection().query<{
    state: string;
    ended_text: string | null;
    end_reason: string | null;
    xmin: string;
  }>(
    `select state::text as state, ended_at::text as ended_text, end_reason::text as end_reason,
            xmin::text as xmin
       from journeys where id = $1`,
    [journeyId],
  );
  const row = result.rows[0];
  return {
    state: row?.state ?? null,
    endedAt: row?.ended_text ?? null,
    endReason: row?.end_reason ?? null,
    xmin: row?.xmin ?? null,
  };
}

/** The journey's alerts, as the table holds them, times to the microsecond. */
async function alertsOf(journeyId: string) {
  const result = await connection().query<{
    id: string;
    state: string;
    opened_text: string;
    resolved_text: string | null;
    resolution: string | null;
    acknowledged_by: string | null;
    round: number;
    xmin: string;
  }>(
    `select id::text as id, state::text as state, opened_at::text as opened_text,
            resolved_at::text as resolved_text, resolution::text as resolution,
            acknowledged_by::text as acknowledged_by, round::int as round, xmin::text as xmin
       from alerts where journey_id = $1 order by opened_at, id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    state: row.state,
    openedAt: row.opened_text,
    resolvedAt: row.resolved_text,
    resolution: row.resolution,
    acknowledgedBy: row.acknowledged_by,
    round: row.round,
    xmin: row.xmin,
  }));
}

/** The journey's alerts' messages, as the table holds them, times to the microsecond. */
async function messagesOf(journeyId: string) {
  const result = await connection().query<{
    message_id: string;
    recipient_id: string;
    kind: string;
    round: number;
    attempts: number;
    created_text: string;
    next_text: string;
    sent_ms: string | null;
    withdrawn_text: string | null;
    last_failure: string | null;
    xmin: string;
  }>(
    `select o.id::text as message_id, o.recipient_id::text as recipient_id,
            o.kind::text as kind, o.round::int as round, o.attempts::int as attempts,
            o.created_at::text as created_text, o.next_attempt_at::text as next_text,
            ${MS('o.sent_at')} as sent_ms, o.withdrawn_at::text as withdrawn_text,
            o.last_failure::text as last_failure, o.xmin::text as xmin
       from outbox o join alerts a on a.id = o.alert_id
      where a.journey_id = $1 order by o.recipient_id, o.kind, o.round`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    messageId: row.message_id,
    recipientId: row.recipient_id,
    kind: row.kind,
    round: row.round,
    attempts: row.attempts,
    createdAt: row.created_text,
    nextAttemptAt: row.next_text,
    sentAt: numberOrNull(row.sent_ms),
    withdrawnAt: row.withdrawn_text,
    lastFailure: row.last_failure,
    xmin: row.xmin,
  }));
}

/** Everything the tables hold of a journey, its alerts and their messages, to compare before and after. */
async function recordOf(journeyId: string) {
  return {
    journey: await journeyOf(journeyId),
    alerts: await alertsOf(journeyId),
    messages: await messagesOf(journeyId),
    responders: (
      await connection().query<{ responder_id: string }>(
        `select responder_id::text as responder_id from journey_responders
          where journey_id = $1 order by responder_id`,
        [journeyId],
      )
    ).rows.map((row) => row.responder_id),
  };
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
    await new Promise((resolve) => setTimeout(resolve, 25));
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

/** A psql-like session of the test's own, holding the journey's row `for update` in an open transaction, outside every pool. */
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
  const name = `lost08_hold_${table}_${event}`;
  return {
    create: [
      `create function ${name}() returns trigger language plpgsql as $$
         begin
           perform pg_advisory_xact_lock(${String(key)});
           return new;
         end
       $$`,
      `create trigger ${name} after ${event} on ${table} for each row when (${condition})
         execute function ${name}()`,
    ],
    drop: [`drop trigger if exists ${name} on ${table}`, `drop function if exists ${name}()`],
  };
}

/** A test-only trigger refusing, with SQLSTATE P0001, one write of the close's or the 24-hour end's. */
function refusing(what: string, table: string, event: string, condition: string) {
  const name = `lost08_refuse_${table}_${event}`;
  return {
    what,
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

function senderFor({ push = fakePush(), log = fakeLog() }: { push?: FakePush; log?: FakeLog }) {
  return createPushSender({ outbox: store(), push, log });
}

function closuresFor({
  database: on = database(),
  log = fakeLog(),
}: { database?: Database; log?: FakeLog } = {}) {
  return createClosureService({ alerts: databaseJourneyStore(on), log });
}

function removalFor({ log = fakeLog() }: { log?: FakeLog } = {}) {
  return createRemovalService({ journeys: store(), log });
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
    closures: closuresFor({ database: on, log }),
  });
}

async function post(
  api: ReturnType<typeof realApi>,
  credential: string,
  route: string,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await api.request(apiPath(route), {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}` },
  });
  const text = await response.text();
  return { status: response.status, body: parsedOrNull(text) };
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

/** "They're safe" through the API (LOST-08). */
const close = (api: ReturnType<typeof realApi>, credential: string, alertId: string) =>
  post(api, credential, `alerts/${alertId}/closure`);

/**
 * "They're safe" through the API, its answer as sent: the status, the body's
 * text and every header, so two answers can be compared byte for byte.
 */
async function closeAsSent(api: ReturnType<typeof realApi>, credential: string, alertId: string) {
  const response = await api.request(apiPath(`alerts/${alertId}/closure`), {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}` },
  });
  return {
    status: response.status,
    text: await response.text(),
    headers: [...response.headers].map(([name, value]) => `${name}: ${value}`).join('\n'),
  };
}

/** "I'm home" through the API (D-110). */
const home = (api: ReturnType<typeof realApi>, credential: string, journeyId: string) =>
  post(api, credential, `journeys/${journeyId}/home`);

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

/** The stand-down kinds, one per resolution (D-112). */
const STAND_DOWNS = ['BACK_IN_CONTACT', 'HOME', 'SAFE', 'EXPIRED'];

// ---------------------------------------------------------------------------
// LOST-08-AC1, AC3 and AC6: the close, on the real tables.
// ---------------------------------------------------------------------------

describe('LOST-08 and SM-06: "They’re safe", on the real tables', () => {
  test('LOST-08-AC1: a journey alerted by the real adapter with R1, R2 and R3; R1 says "I’m on it" through the API, R2’s notice sent and R3’s not; R1 closes A through the API: 200 CLOSED; A RESOLVED, SAFE, acknowledged_by R1; J ENDED, SAFE, ended_at equal to resolved_at, to the microsecond; one SAFE each for R2 and R3 in A’s round, none for R1 or W; every unsent message of A withdrawn at that time, R2’s sent notice untouched; the next delivery hands each SAFE to the push port with exactly messageId, recipientId and kind (SM-06)', async () => {
    const { walker, journeyId, alertId, r1, others } = await acknowledged({ responders: 3 });
    const [r2, r3] = others as [Person, Person];
    await connection().query(
      `update outbox set sent_at = now(), attempts = 1
        where alert_id = $1 and recipient_id = $2 and kind = 'ACKNOWLEDGED'`,
      [alertId, r2.userId],
    );
    const before = await messagesOf(journeyId);
    const log = fakeLog();

    const answer = await close(realApi({ log }), r1.credential, alertId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: CLOSED });
    const [alert] = await alertsOf(journeyId);
    expect(alert).toMatchObject({
      state: 'RESOLVED',
      resolution: 'SAFE',
      acknowledgedBy: r1.userId,
      round: 1,
    });
    const journey = await journeyOf(journeyId);
    expect(journey).toMatchObject({ state: 'ENDED', endReason: 'SAFE' });
    expect(journey.endedAt).toBe(alert?.resolvedAt);
    const messages = await messagesOf(journeyId);
    const safe = ofKind(messages, 'SAFE');
    expect(recipientsOf(safe)).toEqual(idsOf([r2, r3]));
    for (const message of safe) {
      expect(message, message.recipientId).toMatchObject({
        round: 1,
        createdAt: alert?.resolvedAt,
        attempts: 0,
        sentAt: null,
        withdrawnAt: null,
      });
    }
    expect(messages.filter(({ recipientId }) => recipientId === walker.userId)).toEqual([]);
    for (const was of before) {
      const now = messages.find(({ messageId }) => messageId === was.messageId);
      expect(now, `${was.kind} for ${was.recipientId}`).toEqual(
        was.sentAt === null ? { ...was, withdrawnAt: alert?.resolvedAt, xmin: now?.xmin } : was,
      );
    }
    expect(log.events).toEqual([]);

    const push = fakePush();
    await senderFor({ push }).deliverDue();
    const handed = ofKind(push.accepted, 'SAFE');
    expect(recipientsOf(handed)).toEqual(idsOf([r2, r3]));
    for (const message of handed) {
      expect(Object.keys(message).sort()).toEqual(['kind', 'messageId', 'recipientId']);
    }
  });

  test('LOST-08-AC6: on the real tables, after the close, J’s end reason SAFE and A’s acknowledged_by naming the closer are read together in one statement, ended_at equal to resolved_at; and the walker has no message', async () => {
    const { walker, journeyId, alertId, r1 } = await acknowledged({ responders: 2 });

    expect((await close(realApi(), r1.credential, alertId)).status).toBe(200);

    const read = await connection().query<{
      end_reason: string;
      acknowledged_by: string;
      same_time: boolean;
    }>(
      `select j.end_reason::text as end_reason, a.acknowledged_by::text as acknowledged_by,
              j.ended_at = a.resolved_at as same_time
         from journeys j join alerts a on a.journey_id = j.id
        where j.id = $1`,
      [journeyId],
    );
    expect(read.rows).toEqual([
      { end_reason: 'SAFE', acknowledged_by: r1.userId, same_time: true },
    ]);
    const toWalker = await connection().query<{ n: number }>(
      'select count(*)::int as n from outbox where recipient_id = $1',
      [walker.userId],
    );
    expect(toWalker.rows).toEqual([{ n: 0 }]);
  });

  test('LOST-08-AC3: on the real tables, A acknowledged by R1 and R1 removed through the removal module: R1’s close is 404 ALERT_NOT_FOUND, R2’s and R3’s 403 NOT_THE_ACKNOWLEDGER, nothing changing; R2 acknowledges through the API and closes: 200; A RESOLVED, SAFE, acknowledged_by R2, round 2; J ENDED, SAFE; one SAFE for R3 alone, in round 2 (SM-10)', async () => {
    const { journeyId, alertId, r1, others } = await acknowledged({ responders: 3 });
    const [r2, r3] = others as [Person, Person];
    expect(await removalFor().remove({ journeyId, responderId: r1.userId })).toEqual({
      type: 'removed',
    });
    const before = await recordOf(journeyId);
    const api = realApi();

    const refused = [
      await close(api, r1.credential, alertId),
      await close(api, r2.credential, alertId),
      await close(api, r3.credential, alertId),
    ];

    expect(refused.map(({ status, body }) => [status, body?.['code']])).toEqual([
      [404, 'ALERT_NOT_FOUND'],
      [403, 'NOT_THE_ACKNOWLEDGER'],
      [403, 'NOT_THE_ACKNOWLEDGER'],
    ]);
    expect(await recordOf(journeyId)).toEqual(before);

    expect((await acknowledge(api, r2.credential, alertId)).status).toBe(200);
    const answer = await close(api, r2.credential, alertId);

    expect({ status: answer.status, body: answer.body }).toEqual({ status: 200, body: CLOSED });
    expect((await alertsOf(journeyId))[0]).toMatchObject({
      state: 'RESOLVED',
      resolution: 'SAFE',
      acknowledgedBy: r2.userId,
      round: 2,
    });
    expect(await journeyOf(journeyId)).toMatchObject({ state: 'ENDED', endReason: 'SAFE' });
    const safe = ofKind(await messagesOf(journeyId), 'SAFE');
    expect(safe.map(({ recipientId, round }) => [recipientId, round])).toEqual([[r3.userId, 2]]);
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC2 and AC3 at a resolved alert: SEC-07's one 404 (D-114). LOST-08
// review loop 1 (privacy-security-reviewer): a check for "already over" put
// before the close rule's first step, whether the sender follows the
// journey, would answer these callers 409 and tell them the alert is over.
// ---------------------------------------------------------------------------

describe('LOST-08, SEC-07 and SM-10: at a resolved alert, a caller who does not follow the journey gets the one 404, on the real tables', () => {
  test.each(['contact coming back', 'R1’s own close'] as const)(
    'LOST-08-AC2: on the real tables, A acknowledged by R1 and resolved by %s: W, a user who follows only another journey and another walker each get the 404 ALERT_NOT_FOUND an alert ID no alert has gets, byte for byte, never a 409; no line, and nothing written (SEC-07, D-114)',
    async (how) => {
      const { walker, journeyId, alertId, r1 } = await acknowledged({ responders: 2 });
      const [elsewhere] = (await silent({ responders: 1 })).responders as [Person];
      const otherWalker = await person();
      const log = fakeLog();
      const api = realApi({ log });
      if (how === 'contact coming back') {
        await store().recordHeartbeat(await freshHeartbeat(journeyId));
        expect((await journeyOf(journeyId)).state).toBe('ACTIVE');
      } else {
        expect((await close(api, r1.credential, alertId)).status).toBe(200);
      }
      expect((await alertsOf(journeyId))[0]).toMatchObject({
        state: 'RESOLVED',
        acknowledgedBy: r1.userId,
      });
      const unknown = await closeAsSent(api, r1.credential, syntheticUuid());
      expect({ status: unknown.status, code: parsedOrNull(unknown.text)?.['code'] }).toEqual({
        status: 404,
        code: 'ALERT_NOT_FOUND',
      });
      const before = await recordOf(journeyId);
      const lines = log.events.length;

      for (const [who, caller] of [
        ['W', walker],
        ['a user who follows only another journey', elsewhere],
        ['another walker', otherWalker],
      ] as const) {
        expect(await closeAsSent(api, caller.credential, alertId), who).toEqual(unknown);
      }

      expect(log.events.slice(lines)).toEqual([]);
      expect(await recordOf(journeyId)).toEqual(before);
    },
  );

  test('LOST-08-AC3: on the real tables, R1 acknowledges A, contact comes back (A RESOLVED, BACK_IN_CONTACT, acknowledged_by R1; J ACTIVE), and R1 is removed through the removal module: R1’s close is the 404 ALERT_NOT_FOUND an alert ID no alert has gets, byte for byte, never a 409, though R1 is still A’s acknowledger; no line, and nothing written (SM-10, SEC-07, D-114)', async () => {
    const { journeyId, alertId, r1 } = await acknowledged({ responders: 3 });
    await store().recordHeartbeat(await freshHeartbeat(journeyId));
    expect((await journeyOf(journeyId)).state).toBe('ACTIVE');
    expect(await removalFor().remove({ journeyId, responderId: r1.userId })).toEqual({
      type: 'removed',
    });
    const before = await recordOf(journeyId);
    expect(before.responders).not.toContain(r1.userId);
    expect(before.alerts).toMatchObject([
      { state: 'RESOLVED', resolution: 'BACK_IN_CONTACT', acknowledgedBy: r1.userId },
    ]);
    const log = fakeLog();
    const api = realApi({ log });
    const unknown = await closeAsSent(api, r1.credential, syntheticUuid());
    expect({ status: unknown.status, code: parsedOrNull(unknown.text)?.['code'] }).toEqual({
      status: 404,
      code: 'ALERT_NOT_FOUND',
    });

    const removed = await closeAsSent(api, r1.credential, alertId);

    expect(removed).toEqual(unknown);
    expect(log.events).toEqual([]);
    expect(await recordOf(journeyId)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC4: the close decides under the journey's row.
// ---------------------------------------------------------------------------

/** What holds J's row as R1's close arrives: its work, held open behind a gate, and the trigger that holds it. */
const HOLDERS = [
  {
    holder: 'R1’s removal',
    condition: "new.state = 'OPEN' and new.acknowledged_by is null",
    status: 404,
    code: 'ALERT_NOT_FOUND',
    resolution: null,
  },
  {
    holder: 'a fresh heartbeat',
    condition: "new.resolution::text = 'BACK_IN_CONTACT'",
    status: 409,
    code: 'ALERT_RESOLVED',
    resolution: 'BACK_IN_CONTACT',
  },
  {
    holder: '"I’m home"',
    condition: "new.resolution::text = 'HOME'",
    status: 409,
    code: 'ALERT_RESOLVED',
    resolution: 'HOME',
  },
  {
    holder: 'the 24-hour end',
    condition: "new.resolution::text = 'EXPIRED'",
    status: 409,
    code: 'ALERT_RESOLVED',
    resolution: 'EXPIRED',
  },
] as const;

describe('LOST-08, SM-09, SM-10 and LOST-03: the close decides under the journey’s row, on the real tables', () => {
  test('LOST-08-AC4: with another session holding J’s row, R1’s close through the API waits for it (pg_stat_activity); once the holder commits having changed nothing, it closes: 200 CLOSED (SM-09)', async () => {
    const { journeyId, alertId, r1 } = await acknowledged({ responders: 2 });
    const tag = 'lost08_ac4_unchanged';
    const closePool = apiPool(tag);
    const holder = await sessionHolding(journeyId);
    let answer: unknown;
    try {
      const closing = close(
        realApi({ database: createDatabase(closePool) }),
        r1.credential,
        alertId,
      );
      closing.catch(() => undefined);
      expect(await eventually(holder.waitedFor)).toBe(true);
      expect(await waitingOnALock(tag)).toBe(1);
      await holder.commit();
      answer = await bounded(closing, LOCK_WAIT_LIMIT_MS);
    } finally {
      await holder.end();
      await endTestPool(closePool);
    }

    expect(answer).toEqual({ status: 200, body: CLOSED });
    expect(await journeyOf(journeyId)).toMatchObject({ state: 'ENDED', endReason: 'SAFE' });
  }, 30_000);

  test.each(HOLDERS)(
    'LOST-08-AC4: $holder holding J’s row, held open behind a gate, as R1’s close past its read arrives: the close waits for the row (pg_stat_activity), then decides as the holder left J: $status $code, writing nothing; one resolution of A at most and the stand-downs of that one only (SM-09, SM-10, LOST-03)',
    async ({ holder, condition, status, code, resolution }) => {
      const { walker, journeyId, alertId, r1, responders } = await acknowledged({ responders: 3 });
      if (holder === 'the 24-hour end') {
        await openedAgo(alertId, A_DAY + MINUTE);
      }
      const tag = 'lost08_ac4_holder';
      const closePool = apiPool(tag);
      const log = fakeLog();
      const held = await gate();
      let answer: unknown;
      try {
        const { create, drop } = holdBehind(held.key, 'alerts', 'update', condition);
        await withTrigger(create, drop, async () => {
          const holding: Promise<unknown> =
            holder === 'R1’s removal'
              ? removalFor().remove({ journeyId, responderId: r1.userId })
              : holder === 'a fresh heartbeat'
                ? store().recordHeartbeat(await freshHeartbeat(journeyId))
                : holder === '"I’m home"'
                  ? home(realApi(), walker.credential, journeyId)
                  : watchdogFor().sweep();
          holding.catch(() => undefined);
          try {
            expect(await eventually(someoneAtTheGate)).toBe(true);
            const closing = close(
              realApi({ database: createDatabase(closePool), log }),
              r1.credential,
              alertId,
            );
            closing.catch(() => undefined);
            expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);

            await held.open();
            await holding;
            answer = await bounded(closing, LOCK_WAIT_LIMIT_MS);
          } finally {
            await held.open();
          }
        });
      } finally {
        await held.end();
        await endTestPool(closePool);
      }

      expect(answer).toMatchObject({ status, body: { code } });
      const [alert] = await alertsOf(journeyId);
      expect(alert?.resolution ?? null).toBe(resolution);
      const messages = await messagesOf(journeyId);
      expect(ofKind(messages, 'SAFE')).toEqual([]);
      const standDowns = messages.filter(({ kind }) => STAND_DOWNS.includes(kind));
      expect(new Set(standDowns.map(({ kind }) => kind))).toEqual(
        new Set(resolution === null ? [] : [resolution]),
      );
      if (resolution !== null) {
        expect(recipientsOf(standDowns)).toEqual(idsOf(responders));
      }
      expect(log.events).toEqual(
        status === 409 ? [{ event: 'closure_ignored', reason: 'ALERT_RESOLVED', alertId }] : [],
      );
    },
    30_000,
  );

  test.each(['a fresh heartbeat', '"I’m home"', 'R1’s removal', 'the 24-hour end'] as const)(
    'LOST-08-AC4: the other order: R1’s close holding J’s row, held open behind a gate after it resolved A, as %s arrives: that waits for the row, then finds J ENDED, SAFE, and changes nothing; one resolution, one end, one set of SAFE (SM-09, SM-07)',
    async (other) => {
      const { walker, journeyId, alertId, r1, others } = await acknowledged({ responders: 3 });
      if (other === 'the 24-hour end') {
        await openedAgo(alertId, A_DAY + STUCK_AFTER + MINUTE);
      }
      const tag = 'lost08_ac4_other';
      const otherPool = other === 'the 24-hour end' ? workerPool(tag) : apiPool(tag);
      const held = await gate();
      let result: unknown;
      try {
        const { create, drop } = holdBehind(
          held.key,
          'alerts',
          'update',
          "new.resolution::text = 'SAFE'",
        );
        await withTrigger(create, drop, async () => {
          const closing = close(realApi(), r1.credential, alertId);
          closing.catch(() => undefined);
          try {
            expect(await eventually(someoneAtTheGate)).toBe(true);
            const on = createDatabase(otherPool);
            const arriving: Promise<unknown> =
              other === 'a fresh heartbeat'
                ? databaseJourneyStore(on).recordHeartbeat(await freshHeartbeat(journeyId))
                : other === '"I’m home"'
                  ? home(realApi({ database: on }), walker.credential, journeyId)
                  : other === 'R1’s removal'
                    ? createRemovalService({
                        journeys: databaseJourneyStore(on),
                        log: fakeLog(),
                      }).remove({
                        journeyId,
                        responderId: r1.userId,
                      })
                    : watchdogFor({ database: on }).sweep();
            arriving.catch(() => undefined);
            expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);

            await held.open();
            expect(await closing).toEqual({ status: 200, body: CLOSED });
            result = await bounded(arriving, LOCK_WAIT_LIMIT_MS + MARGIN);
          } finally {
            await held.open();
          }
        });
      } finally {
        await held.end();
        await endTestPool(otherPool);
      }

      if (other === 'a fresh heartbeat') {
        expect(result).toEqual({ outcome: 'ended' });
      } else if (other === '"I’m home"') {
        expect(result).toMatchObject({ status: 409, body: { code: 'JOURNEY_ENDED' } });
      } else if (other === 'R1’s removal') {
        expect(result).toEqual({ type: 'ignored', reason: 'JOURNEY_ENDED' });
      } else {
        expect(result).toEqual(QUIET);
      }
      expect(await journeyOf(journeyId)).toMatchObject({ state: 'ENDED', endReason: 'SAFE' });
      expect(await alertsOf(journeyId)).toMatchObject([
        { state: 'RESOLVED', resolution: 'SAFE', acknowledgedBy: r1.userId },
      ]);
      const standDowns = (await messagesOf(journeyId)).filter(({ kind }) =>
        STAND_DOWNS.includes(kind),
      );
      expect(standDowns.map(({ kind }) => kind)).toEqual(['SAFE', 'SAFE']);
      expect(recipientsOf(standDowns)).toEqual(idsOf(others));
    },
    30_000,
  );

  test(`LOST-08-AC4: ${String(RACERS)} copies of R1’s close through the API at once, on separate connections, ${String(RACE_ROUNDS)} times over: exactly one 200 CLOSED and every other 409 ALERT_RESOLVED, none an error; one resolution, one end and one set of SAFE each time (SM-09)`, async () => {
    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const { journeyId, alertId, r1, others } = await acknowledged({ responders: 3 });
      const api = realApi();

      const answers = await Promise.all(
        Array.from({ length: RACERS }, () => close(api, r1.credential, alertId)),
      );

      const at = `round ${String(round)}`;
      expect(
        answers.filter(({ status }) => status === 200),
        at,
      ).toHaveLength(1);
      expect(
        answers.filter(({ status, body }) => status === 409 && body?.['code'] === 'ALERT_RESOLVED'),
        at,
      ).toHaveLength(RACERS - 1);
      expect(await journeyOf(journeyId), at).toMatchObject({ state: 'ENDED', endReason: 'SAFE' });
      expect(recipientsOf(ofKind(await messagesOf(journeyId), 'SAFE')), at).toEqual(idsOf(others));
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// LOST-08-AC7: the stand-down never overtakes what is in a port's hands.
// ---------------------------------------------------------------------------

describe('LOST-08, LOST-03 and LOST-07: a closed alert’s stand-downs never overtake what is in a port’s hands, on the real tables', () => {
  test('LOST-08-AC7: R3’s lost-contact push leased to a port until 30 s on, R2’s never claimed; R1 closes: R3’s SAFE is due exactly when that lease ends, to the microsecond, at most 60 s on; R2’s SAFE at the close’s now (LOST-03, LOST-07)', async () => {
    const { journeyId, alertId, r1, others } = await acknowledged({ responders: 3 });
    const [r2, r3] = others as [Person, Person];
    // As a claim leaves it: one attempt, due again when its lease ends.
    await connection().query(
      `update outbox set attempts = 1, next_attempt_at = now() + interval '30 seconds'
        where alert_id = $1 and recipient_id = $2 and kind = 'LOST_CONTACT'`,
      [alertId, r3.userId],
    );
    const leased = ofKind(await messagesOf(journeyId), 'LOST_CONTACT').find(
      ({ recipientId }) => recipientId === r3.userId,
    );

    expect((await close(realApi(), r1.credential, alertId)).status).toBe(200);

    const [alert] = await alertsOf(journeyId);
    const safe = ofKind(await messagesOf(journeyId), 'SAFE');
    const safeOf = (recipientId: string) =>
      safe.find((message) => message.recipientId === recipientId);
    expect(safeOf(r3.userId)?.nextAttemptAt).toBe(leased?.nextAttemptAt);
    expect(safeOf(r2.userId)?.nextAttemptAt).toBe(alert?.resolvedAt);
    const gap = await connection().query<{ ok: boolean }>(
      `select ($1::timestamptz - $2::timestamptz) <= interval '60 seconds'
              and $1::timestamptz > $2::timestamptz as ok`,
      [leased?.nextAttemptAt, alert?.resolvedAt],
    );
    expect(gap.rows).toEqual([{ ok: true }]);
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC16 and AC17: all or nothing, loud; the database's time.
// ---------------------------------------------------------------------------

const REFUSALS = [
  refusing('the journey’s end', 'journeys', 'update', "new.end_reason::text = 'SAFE'"),
  refusing('the alert’s resolution', 'alerts', 'update', "new.resolution::text = 'SAFE'"),
  refusing('a withdrawal', 'outbox', 'update', 'new.withdrawn_at is not null'),
  refusing('a stand-down', 'outbox', 'insert', "new.kind::text = 'SAFE'"),
];

describe('LOST-08 and SM-06: a close is all or nothing, a failure is loud, and its times are the database’s', () => {
  test.each(REFUSALS)(
    'LOST-08-AC16: with a test trigger refusing $what, R1’s close through the module fails, writing one closure_failed line, stage store, SQLSTATE P0001, and through the API is 500; J, A and every message as they were; without the trigger, the same close does all of its work (SM-06)',
    async ({ create, drop }) => {
      const { journeyId, alertId, r1, others } = await acknowledged({ responders: 3 });
      const before = await recordOf(journeyId);
      const log = fakeLog();

      await withTrigger(create, drop, async () => {
        await expect(
          closuresFor({ log }).close({ responderId: r1.userId, alertId }),
        ).rejects.toThrow();
        expect((await close(realApi(), r1.credential, alertId)).status).toBe(500);
      });

      expect(log.events).toEqual([{ event: 'closure_failed', stage: 'store', code: 'P0001' }]);
      expect(await recordOf(journeyId)).toEqual(before);
      expect(await closuresFor().close({ responderId: r1.userId, alertId })).toEqual({
        type: 'closed',
      });
      expect(await journeyOf(journeyId)).toMatchObject({ state: 'ENDED', endReason: 'SAFE' });
      expect(recipientsOf(ofKind(await messagesOf(journeyId), 'SAFE'))).toEqual(idsOf(others));
    },
  );

  test('LOST-08-AC16: a close whose wait for J’s row passes the API’s lock limit fails with 55P03: 500 within LOCK_WAIT_LIMIT_MS plus a margin, one closure_failed line, stage store, code 55P03, and nothing changed (SM-06)', async () => {
    const { journeyId, alertId, r1 } = await acknowledged({ responders: 2 });
    const tag = 'lost08_ac16_lock_limit';
    const closePool = apiPool(tag);
    const log = fakeLog();
    const before = await recordOf(journeyId);
    const holder = await sessionHolding(journeyId);
    let answer: unknown;
    let tookMs: number;
    try {
      const started = performance.now();
      const closing = close(
        realApi({ database: createDatabase(closePool), log }),
        r1.credential,
        alertId,
      );
      closing.catch(() => undefined);
      expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);
      answer = await bounded(closing, LOCK_WAIT_LIMIT_MS + MARGIN);
      tookMs = performance.now() - started;
    } finally {
      await holder.end();
      await endTestPool(closePool);
    }

    expect(answer).toMatchObject({ status: 500 });
    expect(tookMs).toBeGreaterThanOrEqual(LOCK_WAIT_LIMIT_MS - 100);
    expect(log.events).toEqual([{ event: 'closure_failed', stage: 'store', code: '55P03' }]);
    expect(await recordOf(journeyId)).toEqual(before);
  }, 30_000);

  test('LOST-08-AC17: ended_at, resolved_at, every withdrawal and every SAFE’s created_at are the closing transaction’s now(), to the microsecond, in that one transaction (xmin), between two readings of now() taken before and after the call (SM-06, REL-01)', async () => {
    const { journeyId, alertId, r1 } = await acknowledged({ responders: 3 });
    const before = await databaseNowText();

    expect(await closuresFor().close({ responderId: r1.userId, alertId })).toEqual({
      type: 'closed',
    });

    const after = await databaseNowText();
    const journey = await journeyOf(journeyId);
    const [alert] = await alertsOf(journeyId);
    const messages = await messagesOf(journeyId);
    const safe = ofKind(messages, 'SAFE');
    const withdrawn = messages.filter(({ withdrawnAt }) => withdrawnAt !== null);
    expect(safe.length).toBeGreaterThan(0);
    expect(withdrawn.length).toBeGreaterThan(0);
    const at = alert?.resolvedAt ?? '';
    expect(journey.endedAt).toBe(at);
    for (const message of safe) {
      expect(message.createdAt).toBe(at);
    }
    for (const message of withdrawn) {
      expect(message.withdrawnAt).toBe(at);
    }
    // One transaction wrote them all: the journey, the alert, every SAFE and
    // every withdrawal.
    expect(
      new Set([
        journey.xmin,
        alert?.xmin,
        ...safe.map(({ xmin }) => xmin),
        ...withdrawn.map(({ xmin }) => xmin),
      ]),
    ).toEqual(new Set([journey.xmin]));
    const between = await connection().query<{ ok: boolean }>(
      'select $1::timestamptz <= $2::timestamptz and $2::timestamptz <= $3::timestamptz as ok',
      [before, at, after],
    );
    expect(between.rows).toEqual([{ ok: true }]);
  });
});
