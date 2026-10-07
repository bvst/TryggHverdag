// L3 server integration: the lost-contact alert (LOST-02) on the real tables.
//
// The system tests prove the rule and the flow against a fake store. What
// only a real PostgreSQL can prove is here:
//   - the most important test's flow, through the real adapter and the real
//     modules, with the journey's start and last contact written relative to
//     the database's own now() (AC1);
//   - the decision taken on the database's clock, whatever the phone's (AC4);
//   - sweepers racing on separate connections, a row held elsewhere and
//     skipped, a heartbeat that commits between the read and the lock, and a
//     move that changes no row (AC7 to AC10);
//   - the move, the alert and every message in one transaction (AC12), and
//     what the alert records (AC13);
//   - a push answering after the idle limit, with no transaction held open
//     across it (AC16);
//   - sweepers racing on journeys already past the stuck threshold, none of
//     them stuck (AC7); past it, a held journey waited for, briefly: opened or
//     skipped when its holder lets go, and reported when a session outside
//     both pools never does, then alerted once it is free (AC20).
//
// PostgreSQL 15, staging's version, as deploy.integration.test.ts explains.
// Needs Docker, like every *.integration.test.ts: CI's integration job runs
// it, a cloud session cannot.
//
// Each test starts from a quiet database: every journey a test left unended
// is ended, and every message left due is put out of reach as sent, so a
// sweep or a claim here sees only what the test itself put in.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  RACE_ROUNDS,
  RACERS,
  apiPath,
  endTestPool,
  fakeLog,
  fakePush,
  syntheticBatteryLevel,
  syntheticCredential,
  syntheticEventId,
  syntheticHeartbeat,
  syntheticPosition,
  syntheticUuid,
  toStoredPosition,
  type FakeLog,
  type FakePush,
} from '@trygghverdag/test-kit';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { databaseClock } from './adapters/clock.ts';
import { createDatabase, createPool, type Database } from './adapters/db.ts';
import { databaseDeviceAuthenticator, hashCredential } from './adapters/device-credentials.ts';
import { databaseJourneyStore } from './adapters/journeys.ts';
import { migrateDatabase } from './adapters/migrations.ts';
import { databaseWorkerHeartbeats } from './adapters/worker-heartbeats.ts';
import { createApi } from './api.ts';
import { createPushSender } from './modules/alerts/outbox.ts';
import { createWatchdog } from './modules/alerts/watchdog.ts';
import { LOST_CONTACT_AFTER_MS } from './domain/journey.ts';
import { sqlstateOf } from './domain/sqlstate.ts';
import { IDLE_IN_TRANSACTION_LIMIT_MS, LOCK_WAIT_LIMIT_MS } from './domain/watchdog.ts';
import { createHealthService } from './modules/health/service.ts';
import { createJourneyService } from './modules/journeys/service.ts';

/** What Clever Cloud's DEV plan runs; see deploy.integration.test.ts. */
const STAGING_POSTGRES = 'postgres:15-alpine';

/** Enough connections that every racing sweeper holds its own. */
const CONNECTIONS = RACERS + 2;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** Five minutes and 30 s: from here a journey a sweep skipped is waited for, briefly (AC20). */
const STUCK_SILENCE = 5 * MINUTE + 30 * SECOND;
/** How far past a wait the sweep may finish and still count as on time. */
const MARGIN = 2_500;

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
  await connection().query('update outbox set sent_at = now() where sent_at is null');
  // RG-03 (LOST-07; not in the spec's list, found reading this setup against
  // the escalation): the sweep now also escalates every unresolved alert two
  // minutes old or more, across the whole table. Ending a journey by hand
  // leaves its alert unresolved, so a later test's sweep would escalate an
  // earlier test's alert, and every `escalated: 0` below would depend on how
  // long the file had run. So the leftovers are resolved too, as "I'm home"
  // would have resolved them. Nothing a test asserts about its own rows
  // changes. And every exact sweep result below gains `escalated: 0` (the
  // spec's "Every exact sweep result", 15 here): these tests open alerts and
  // sweep within seconds, never two minutes, so none is escalated.
  await connection().query(
    "update alerts set state = 'RESOLVED', resolved_at = now(), resolution = 'HOME' " +
      "where state <> 'RESOLVED'",
  );
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

// ---------------------------------------------------------------------------
// Rows, put in and read back directly. Times are written relative to the
// database's own now(), in the statement that writes them.
// ---------------------------------------------------------------------------

async function addUser(): Promise<string> {
  const id = syntheticUuid();
  await connection().query('insert into users (id) values ($1)', [id]);
  return id;
}

/** A user with a device, and the credential that device would send. */
async function walker(): Promise<{ userId: string; deviceId: string; credential: string }> {
  const userId = await addUser();
  const deviceId = syntheticUuid();
  const credential = syntheticCredential();
  await connection().query(
    'insert into devices (id, user_id, credential_hash) values ($1, $2, $3)',
    [deviceId, userId, hashCredential(credential)],
  );
  return { userId, deviceId, credential };
}

/**
 * An ACTIVE journey of a new walker, put in directly with `responders`
 * responders: started `startedAgoMs` before now(), and last heard from
 * `silentForMs` before now(), or never.
 */
async function overdue({
  responders = 1,
  silentForMs = 5 * MINUTE + 10 * SECOND,
  heartbeat = true,
  startedAgoMs = 60 * MINUTE,
}: {
  responders?: number;
  silentForMs?: number;
  heartbeat?: boolean;
  startedAgoMs?: number;
} = {}): Promise<{
  journeyId: string;
  walkerId: string;
  deviceId: string;
  responderIds: string[];
}> {
  const { userId: walkerId, deviceId } = await walker();
  const responderIds: string[] = [];
  for (let i = 0; i < responders; i += 1) {
    responderIds.push(await addUser());
  }
  const journeyId = syntheticUuid();
  const client = await connection().connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into journeys (id, walker_id, device_id, state, started_at, last_heartbeat_at)
       values ($1, $2, $3, 'ACTIVE',
               now() - ($4::double precision * interval '1 millisecond'),
               case when $6 then now() - ($5::double precision * interval '1 millisecond') end)`,
      [
        journeyId,
        walkerId,
        deviceId,
        heartbeat ? startedAgoMs : silentForMs,
        silentForMs,
        heartbeat,
      ],
    );
    for (const responderId of responderIds) {
      await client.query(
        'insert into journey_responders (journey_id, responder_id) values ($1, $2)',
        [journeyId, responderId],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return { journeyId, walkerId, deviceId, responderIds };
}

/** A moment as milliseconds since the epoch, in SQL, floored as a Date floors it. */
const MS = (column: string) => `floor(extract(epoch from ${column}) * 1000)::bigint::text`;

async function databaseNowMs(): Promise<number> {
  const result = await connection().query<{ ms: string }>(`select ${MS('now()')} as ms`);
  return Number(result.rows[0]?.ms);
}

async function stateOf(journeyId: string): Promise<string | null> {
  const result = await connection().query<{ state: string }>(
    'select state::text as state from journeys where id = $1',
    [journeyId],
  );
  return result.rows[0]?.state ?? null;
}

async function lastHeartbeatAt(journeyId: string): Promise<number | null> {
  const result = await connection().query<{ ms: string | null }>(
    `select ${MS('last_heartbeat_at')} as ms from journeys where id = $1`,
    [journeyId],
  );
  const ms = result.rows[0]?.ms;
  return ms === undefined || ms === null ? null : Number(ms);
}

async function startedAt(journeyId: string): Promise<number> {
  const result = await connection().query<{ ms: string }>(
    `select ${MS('started_at')} as ms from journeys where id = $1`,
    [journeyId],
  );
  return Number(result.rows[0]?.ms);
}

async function alertsOf(journeyId: string) {
  const result = await connection().query<{
    id: string;
    state: string;
    opened_ms: string;
    silent_ms: string;
  }>(
    `select id::text as id, state::text as state, ${MS('opened_at')} as opened_ms,
            ${MS('silent_since')} as silent_ms
       from alerts where journey_id = $1 order by opened_at, id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    state: row.state,
    openedAt: Number(row.opened_ms),
    silentSince: Number(row.silent_ms),
  }));
}

async function messagesOf(journeyId: string) {
  const result = await connection().query<{
    message_id: string;
    recipient_id: string;
    kind: string;
    sent: boolean;
    last_failure: string | null;
  }>(
    `select o.id::text as message_id, o.recipient_id::text as recipient_id, o.kind::text as kind,
            o.sent_at is not null as sent, o.last_failure::text as last_failure
       from outbox o join alerts a on a.id = o.alert_id
      where a.journey_id = $1 order by o.recipient_id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    messageId: row.message_id,
    recipientId: row.recipient_id,
    kind: row.kind,
    sent: row.sent,
    lastFailure: row.last_failure,
  }));
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

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// ---------------------------------------------------------------------------
// The real adapter, the real modules, and the recording fakes at the edge.
// ---------------------------------------------------------------------------

const store = () => databaseJourneyStore(database());

function watchdogFor({
  journeys = store(),
  log = fakeLog(),
}: { journeys?: ReturnType<typeof store>; log?: FakeLog } = {}) {
  return createWatchdog({ journeys, beats: databaseWorkerHeartbeats(database()), log });
}

function senderFor({
  outbox = store(),
  push = fakePush(),
  log = fakeLog(),
}: {
  outbox?: ReturnType<typeof store>;
  push?: FakePush;
  log?: FakeLog;
} = {}) {
  return createPushSender({ outbox, push, log });
}

function realApi() {
  const clock = databaseClock(database());
  return createApi({
    health: createHealthService({ clock, heartbeats: databaseWorkerHeartbeats(database()) }),
    journeys: createJourneyService({ clock, journeys: store(), log: fakeLog() }),
    devices: databaseDeviceAuthenticator(database()),
    // RG-03 (LOST-06, the spec's "Existing assertions that change by
    // design"): `acknowledgements` added because "I'm on it" (D-114) made it
    // part of what the API needs. These tests acknowledge nothing, so it
    // rejects; they never call it, and nothing they assert changes.
    acknowledgements: {
      acknowledge: () => Promise.reject(new Error('these tests acknowledge nothing')),
    },
  });
}

async function post(
  api: ReturnType<typeof realApi>,
  credential: string,
  route: string,
  body: unknown,
) {
  const response = await api.request(apiPath(route), {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const recipientsOf = (messages: readonly { recipientId: string }[]) =>
  messages.map(({ recipientId }) => recipientId).sort();

// ---------------------------------------------------------------------------
// The most important test, on the real tables.
// ---------------------------------------------------------------------------

describe('LOST-02: every responder is alerted after five minutes of silence, on the real tables', () => {
  test.each([3, 1])(
    'LOST-02-AC1: a journey started through the API with %i responder(s), its last heartbeat 5 min 1 s before the database’s now(), is alerted by the real watchdog and sender: LOST_CONTACT, one OPEN alert, one LOST_CONTACT message to each responder and none to the walker; one 4 min 59 s silent is not',
    async (responders) => {
      const api = realApi();
      const walking = await walker();
      const responderIds: string[] = [];
      for (let i = 0; i < responders; i += 1) {
        responderIds.push(await addUser());
      }
      const started = await post(api, walking.credential, 'journeys', { responderIds });
      expect(started.status).toBe(201);
      const journeyId = String(started.body['journeyId']);
      const sent = await post(
        api,
        walking.credential,
        'heartbeats',
        syntheticHeartbeat({ journeyId }),
      );
      expect(sent.status).toBe(200);
      // The phone then falls silent: its start and last contact moved back,
      // relative to the database's own now(), in one transaction.
      const client = await connection().connect();
      try {
        await client.query('begin');
        await client.query(
          "update heartbeats set received_at = now() - interval '5 minutes 1 second' where journey_id = $1",
          [journeyId],
        );
        await client.query(
          `update journeys set started_at = now() - interval '15 minutes',
                  last_heartbeat_at = now() - interval '5 minutes 1 second' where id = $1`,
          [journeyId],
        );
        await client.query('commit');
      } finally {
        client.release();
      }
      const notYet = await overdue({ silentForMs: 4 * MINUTE + 59 * SECOND });
      const push = fakePush();
      const log = fakeLog();

      const swept = await watchdogFor({ log }).sweep();
      await senderFor({ push, log }).deliverDue();

      expect(swept).toEqual({ ok: true, opened: 1, escalated: 0, stuck: 0 });
      expect(await stateOf(journeyId)).toBe('LOST_CONTACT');
      expect((await alertsOf(journeyId)).map(({ state }) => state)).toEqual(['OPEN']);
      expect(recipientsOf(push.accepted)).toEqual([...responderIds].sort());
      expect(push.accepted.map(({ kind }) => kind)).toEqual(responderIds.map(() => 'LOST_CONTACT'));
      expect(push.messages).toHaveLength(responders);
      expect(recipientsOf(push.messages)).not.toContain(walking.userId);
      expect((await messagesOf(journeyId)).every(({ sent: isSent }) => isSent)).toBe(true);
      expect(await stateOf(notYet.journeyId)).toBe('ACTIVE');
      expect(await alertsOf(notYet.journeyId)).toEqual([]);
      expect(log.events).toEqual([]);
    },
  );
});

describe('REL-01 and LOST-02: the server decides on the database’s clock', () => {
  test('LOST-02-AC4: J last heard from 5 min 1 s before now(), K 4 min 59 s before: one sweep opens J’s alert and leaves K ACTIVE; opened_at and the beat lie between two readings of now(); phone times hours ahead and behind change neither outcome', async () => {
    const j = await overdue({ silentForMs: 5 * MINUTE + SECOND });
    const k = await overdue({ silentForMs: 5 * MINUTE - SECOND });
    // Each journey's last heartbeat carries a position whose phone time is
    // nine hours off the database's, one each way.
    for (const [journeyId, hours] of [
      [j.journeyId, 9],
      [k.journeyId, -9],
    ] as const) {
      const position = syntheticPosition();
      await connection().query(
        `with heartbeat as (
           insert into heartbeats (journey_id, event_id, received_at, battery_level)
           select id, $2, last_heartbeat_at, $3 from journeys where id = $1
           returning id)
         insert into positions (heartbeat_id, latitude, longitude, accuracy_m, recorded_at)
         select id, $4, $5, $6, now() + ($7::double precision * interval '1 hour') from heartbeat`,
        [
          journeyId,
          syntheticEventId(),
          syntheticBatteryLevel(),
          position.latitude,
          position.longitude,
          position.accuracyMeters,
          hours,
        ],
      );
    }

    const before = await databaseNowMs();
    const swept = await watchdogFor().sweep();
    const after = await databaseNowMs();

    expect(swept).toEqual({ ok: true, opened: 1, escalated: 0, stuck: 0 });
    expect(await stateOf(j.journeyId)).toBe('LOST_CONTACT');
    expect(await stateOf(k.journeyId)).toBe('ACTIVE');
    expect(await alertsOf(k.journeyId)).toEqual([]);
    const [alert] = await alertsOf(j.journeyId);
    expect(alert?.openedAt).toBeGreaterThanOrEqual(before);
    expect(alert?.openedAt).toBeLessThanOrEqual(after);
    const beat = (await databaseWorkerHeartbeats(database()).lastBeat())?.getTime() ?? Number.NaN;
    expect(beat).toBeGreaterThanOrEqual(before);
    expect(beat).toBeLessThanOrEqual(after);
  });
});

describe('LOST-02: swept by many at once, one alert (AR-06)', () => {
  test(`LOST-02-AC7: ${String(RACERS)} watchdogs sweeping at once on separate connections, ${String(RACE_ROUNDS)} times over: each overdue journey gets exactly one alert and one message per responder, and no sweep fails`, async () => {
    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const journeys = [
        await overdue({ responders: 2 }),
        await overdue({ responders: 2 }),
        await overdue({ responders: 2 }),
      ];
      const log = fakeLog();

      const results: { ok: boolean; opened: number; stuck: number }[] = await Promise.all(
        Array.from({ length: RACERS }, () => watchdogFor({ log }).sweep()),
      );

      expect(
        results.map(({ ok }) => ok),
        `round ${String(round)}`,
      ).toEqual(results.map(() => true));
      expect(
        results.reduce((sum, { opened }) => sum + opened, 0),
        `round ${String(round)}`,
      ).toBe(3);
      for (const { journeyId, responderIds } of journeys) {
        expect(await alertsOf(journeyId), `round ${String(round)}`).toHaveLength(1);
        expect(recipientsOf(await messagesOf(journeyId)), `round ${String(round)}`).toEqual(
          [...responderIds].sort(),
        );
      }
      expect(log.events, `round ${String(round)}`).toEqual([]);
    }
  }, 120_000);

  test(`LOST-02-AC7: ${String(RACERS)} watchdogs sweeping at once on separate connections, on journeys silent 5 min 30 s, 10 min and an hour, ${String(RACE_ROUNDS)} times over: one alert and one message per responder each, every sweep ok with nothing stuck, no watchdog_overdue line, and the beat recorded`, async () => {
    // As after a worker that was down: every journey is already past the
    // stuck threshold when the sweepers meet it. A loser waits for the
    // winner's commit, finds the journey LOST_CONTACT, and skips it.
    const beats = databaseWorkerHeartbeats(database());
    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const journeys = [
        await overdue({ responders: 2, silentForMs: STUCK_SILENCE }),
        await overdue({ responders: 2, silentForMs: 10 * MINUTE }),
        await overdue({ responders: 2, silentForMs: HOUR, startedAgoMs: 2 * HOUR }),
      ];
      const log = fakeLog();
      const before = await databaseNowMs();

      const results: { ok: boolean; opened: number; stuck: number }[] = await Promise.all(
        Array.from({ length: RACERS }, () => watchdogFor({ log }).sweep()),
      );

      const at = `round ${String(round)}`;
      expect(
        results.map(({ ok, stuck }) => ({ ok, stuck })),
        at,
      ).toEqual(results.map(() => ({ ok: true, stuck: 0 })));
      expect(
        results.reduce((sum, { opened }) => sum + opened, 0),
        at,
      ).toBe(3);
      for (const { journeyId, responderIds } of journeys) {
        expect(await alertsOf(journeyId), at).toHaveLength(1);
        expect(recipientsOf(await messagesOf(journeyId)), at).toEqual([...responderIds].sort());
      }
      expect(log.events, at).toEqual([]);
      expect((await beats.lastBeat())?.getTime(), at).toBeGreaterThanOrEqual(before);
    }
  }, 300_000);
});

describe('LOST-02: a held row is skipped, not waited for, and alerted once it is free', () => {
  test('LOST-02-AC8: with another transaction holding J’s row for update, a sweep finishes at once, opens K’s alert and leaves J untouched; after the holder commits without changing J, the next sweep opens J’s', async () => {
    const j = await overdue();
    const k = await overdue();
    const holder = await connection().connect();
    try {
      await holder.query('begin');
      await holder.query('select id from journeys where id = $1 for update', [j.journeyId]);

      const started = performance.now();
      const swept = await watchdogFor().sweep();

      expect(performance.now() - started).toBeLessThan(2 * SECOND);
      expect(swept).toEqual({ ok: true, opened: 1, escalated: 0, stuck: 0 });
      expect(await stateOf(k.journeyId)).toBe('LOST_CONTACT');
      expect(await stateOf(j.journeyId)).toBe('ACTIVE');
      expect(await alertsOf(j.journeyId)).toEqual([]);

      await holder.query('commit');
    } finally {
      holder.release();
    }

    expect(await watchdogFor().sweep()).toEqual({ ok: true, opened: 1, escalated: 0, stuck: 0 });
    expect(await stateOf(j.journeyId)).toBe('LOST_CONTACT');
    expect(await alertsOf(j.journeyId)).toHaveLength(1);
  });
});

describe('SM-09 and LOST-02: contact that arrives during the sweep wins', () => {
  /** The real store, with `between` run after the overdue read and before each open. */
  function withSomethingBetween(between: (journeyId: string) => Promise<void>) {
    const real = store();
    return {
      overdueJourneys: (afterMs: number) => real.overdueJourneys(afterMs),
      openLostContactAlert: async (request: { journeyId: string; afterMs: number }) => {
        await between(request.journeyId);
        return real.openLostContactAlert(request);
      },
      // RG-03 (LOST-07; not in the spec's list): the sweep asks the store for
      // the alerts due for escalation after its opens. This stand-in is cast,
      // so the type check cannot say it lacks them; without them every sweep
      // through it would fail. Both go to the real store, unchanged.
      alertsDueForEscalation: (afterMs: number) => real.alertsDueForEscalation(afterMs),
      escalateAlert: (request: { alertId: string; afterMs: number; lockWaitMs?: number }) =>
        real.escalateAlert(request),
    } as unknown as ReturnType<typeof store>;
  }

  test('LOST-02-AC9: a heartbeat for J committed on another connection between the read and the lock: J is skipped, stays ACTIVE, and has no alert and no message', async () => {
    const { journeyId } = await overdue({ responders: 2 });
    const log = fakeLog();
    const journeys = withSomethingBetween(async (id) => {
      const result = await store().recordHeartbeat({
        journeyId: id,
        eventId: syntheticEventId(),
        receivedAt: new Date(await databaseNowMs()),
        batteryLevel: syntheticBatteryLevel(),
        position: toStoredPosition(syntheticPosition()),
      });
      expect(result).toEqual({ outcome: 'recorded' });
    });

    const swept = await watchdogFor({ journeys, log }).sweep();

    expect(swept).toEqual({ ok: true, opened: 0, escalated: 0, stuck: 0 });
    expect(await stateOf(journeyId)).toBe('ACTIVE');
    expect(await alertsOf(journeyId)).toEqual([]);
    expect(await messagesOf(journeyId)).toEqual([]);
    expect(log.events).toEqual([]);
  });

  test('LOST-02-AC9: J’s state changed on another connection between the read and the lock: J is skipped, and has no alert and no message', async () => {
    const { journeyId } = await overdue();
    const journeys = withSomethingBetween(async (id) => {
      await connection().query("update journeys set state = 'ENDED' where id = $1", [id]);
    });

    const swept = await watchdogFor({ journeys }).sweep();

    expect(swept).toEqual({ ok: true, opened: 0, escalated: 0, stuck: 0 });
    expect(await stateOf(journeyId)).toBe('ENDED');
    expect(await alertsOf(journeyId)).toEqual([]);
    expect(await messagesOf(journeyId)).toEqual([]);
  });

  test('LOST-02-AC9: with an update planted to change no row, the open fails and is rolled back whole: J stays ACTIVE with no alert and no message, and one watchdog_failed line says stage open; without it, the next sweep opens J', async () => {
    const { journeyId } = await overdue({ responders: 2 });
    const log = fakeLog();

    await withTrigger(
      [
        `create function lost02_skip_the_move() returns trigger language plpgsql as $$
           begin
             return null;
           end
         $$`,
        `create trigger lost02_skip_the_move before update on journeys for each row
           when (old.state = 'ACTIVE' and new.state = 'LOST_CONTACT')
           execute function lost02_skip_the_move()`,
      ],
      [
        'drop trigger if exists lost02_skip_the_move on journeys',
        'drop function if exists lost02_skip_the_move()',
      ],
      async () => {
        const swept = await watchdogFor({ log }).sweep();

        expect(swept.ok).toBe(false);
        expect(swept.opened).toBe(0);
        expect(await stateOf(journeyId)).toBe('ACTIVE');
        expect(await alertsOf(journeyId)).toEqual([]);
        expect(await messagesOf(journeyId)).toEqual([]);
        expect(log.events).toHaveLength(1);
        expect(log.events[0]).toMatchObject({ event: 'watchdog_failed', stage: 'open' });
      },
    );

    expect((await watchdogFor().sweep()).opened).toBe(1);
    expect(await stateOf(journeyId)).toBe('LOST_CONTACT');
  });
});

describe('SM-03, SM-09 and LOST-02: a heartbeat and the watchdog meet on the row', () => {
  test('LOST-02-AC10: while a heartbeat’s transaction holds J’s row the sweep skips J; once it commits, J is no longer overdue and the next sweep opens nothing', async () => {
    const { journeyId } = await overdue();
    const heartbeat = await connection().connect();
    try {
      await heartbeat.query('begin');
      await heartbeat.query('select id from journeys where id = $1 for update', [journeyId]);
      await heartbeat.query(
        `insert into heartbeats (journey_id, event_id, received_at, battery_level)
         values ($1, $2, now(), null)`,
        [journeyId, syntheticEventId()],
      );
      await heartbeat.query('update journeys set last_heartbeat_at = now() where id = $1', [
        journeyId,
      ]);

      expect(await watchdogFor().sweep()).toEqual({ ok: true, opened: 0, escalated: 0, stuck: 0 });

      await heartbeat.query('commit');
    } finally {
      heartbeat.release();
    }

    expect(await watchdogFor().sweep()).toEqual({ ok: true, opened: 0, escalated: 0, stuck: 0 });
    expect(await stateOf(journeyId)).toBe('ACTIVE');
    expect(await alertsOf(journeyId)).toEqual([]);
  });

  // RG-03 (LOST-03, the spec's "Existing assertions that change by design"):
  // this ended "…and J stays LOST_CONTACT with its one alert unchanged". A
  // fresh heartbeat now brings J back in contact (LOST-03-AC1), so the end is
  // LOST-03-AC11's second order: J ACTIVE, its one alert RESOLVED with
  // resolution BACK_IN_CONTACT, and one BACK_IN_CONTACT for its responder
  // beside the lost-contact message. The wait and the store are unchanged.
  test('LOST-02-AC10: while a sweep’s transaction holds J’s row before commit, a heartbeat for J waits; then it is stored and last contact advances, and J comes back in contact (LOST-03-AC11): ACTIVE, with its one alert RESOLVED', async () => {
    const { journeyId, responderIds } = await overdue();
    const key = Math.floor(Math.random() * 1_000_000_000);
    const tag = 'lost02_ac10_heartbeat';
    const heartbeatUrl = new URL(connectionUri());
    heartbeatUrl.searchParams.set('application_name', tag);
    const heartbeatPool = createPool(heartbeatUrl.toString(), 1);
    // A session of the test's own holds an advisory lock; a trigger after the
    // alert's insert waits for it, so the sweep's transaction is held open,
    // J's row locked, for as long as the test says.
    const gate = await connection().connect();
    await gate.query('select pg_advisory_lock($1)', [key]);
    try {
      await withTrigger(
        [
          `create function lost02_hold_the_open() returns trigger language plpgsql as $$
             begin
               perform pg_advisory_xact_lock(${String(key)});
               return new;
             end
           $$`,
          `create trigger lost02_hold_the_open after insert on alerts for each row
             execute function lost02_hold_the_open()`,
        ],
        [
          'drop trigger if exists lost02_hold_the_open on alerts',
          'drop function if exists lost02_hold_the_open()',
        ],
        async () => {
          const sweeping = watchdogFor().sweep();
          // Settled below; a failed assertion before then must not leave it unhandled.
          sweeping.catch(() => undefined);
          try {
            // The sweep is inside its transaction, J's row held.
            expect(
              await eventually(async () => {
                const result = await connection().query<{ n: number }>(
                  `select count(*)::int as n from pg_locks
                  where locktype = 'advisory' and not granted`,
                );
                return (result.rows[0]?.n ?? 0) > 0;
              }),
            ).toBe(true);

            const receivedAt = new Date(await databaseNowMs());
            let answer: unknown;
            const recording = databaseJourneyStore(createDatabase(heartbeatPool))
              .recordHeartbeat({
                journeyId,
                eventId: syntheticEventId(),
                receivedAt,
                batteryLevel: syntheticBatteryLevel(),
                position: null,
              })
              .then((result) => {
                answer = result;
              });
            recording.catch(() => undefined);
            expect(
              await eventually(async () => {
                const result = await connection().query<{ n: number }>(
                  `select count(*)::int as n from pg_stat_activity
                  where application_name = $1 and wait_event_type = 'Lock'`,
                  [tag],
                );
                return result.rows[0]?.n === 1;
              }),
            ).toBe(true);
            expect(answer).toBeUndefined();

            await gate.query('select pg_advisory_unlock($1)', [key]);
            expect((await sweeping).opened).toBe(1);
            const [alert] = await alertsOf(journeyId);
            await recording;

            expect(answer).toMatchObject({ outcome: 'back_in_contact', alertId: alert?.id });
            expect(await lastHeartbeatAt(journeyId)).toBe(receivedAt.getTime());
            expect(await stateOf(journeyId)).toBe('ACTIVE');
            expect(alert).toBeDefined();
            expect(await alertsOf(journeyId)).toEqual([{ ...alert, state: 'RESOLVED' }]);
            // One recipient, two kinds: sorted by kind, as messagesOf orders by recipient only.
            const messages = (await messagesOf(journeyId))
              .map(({ recipientId, kind }) => ({ recipientId, kind }))
              .sort((a, b) => a.kind.localeCompare(b.kind));
            expect(messages).toEqual([
              { recipientId: responderIds[0], kind: 'BACK_IN_CONTACT' },
              { recipientId: responderIds[0], kind: 'LOST_CONTACT' },
            ]);
          } finally {
            // Before the trigger is dropped: dropping it waits for the sweep,
            // and the sweep waits for this lock.
            await gate.query('select pg_advisory_unlock_all()');
          }
        },
      );
    } finally {
      await gate.query('select pg_advisory_unlock_all()');
      gate.release();
      await endTestPool(heartbeatPool);
    }
  });
});

describe('LOST-02: the move, the alert and every message are one transaction (AR-05)', () => {
  test('LOST-02-AC12: with a test trigger refusing the second responder’s message, J stays ACTIVE with no alert and no message, and one watchdog_failed line carries stage open and the SQLSTATE; without it, the next sweep opens J’s alert with every message', async () => {
    const { journeyId, responderIds } = await overdue({ responders: 3 });
    const log = fakeLog();

    await withTrigger(
      [
        `create function lost02_refuse_a_second_message() returns trigger language plpgsql as $$
           begin
             if exists (select 1 from outbox where alert_id = new.alert_id) then
               raise exception 'a second message refused by a test trigger' using errcode = 'P0001';
             end if;
             return new;
           end
         $$`,
        `create trigger lost02_refuse_a_second_message before insert on outbox for each row
           execute function lost02_refuse_a_second_message()`,
      ],
      [
        'drop trigger if exists lost02_refuse_a_second_message on outbox',
        'drop function if exists lost02_refuse_a_second_message()',
      ],
      async () => {
        const swept = await watchdogFor({ log }).sweep();

        expect(swept.ok).toBe(false);
        expect(await stateOf(journeyId)).toBe('ACTIVE');
        expect(await alertsOf(journeyId)).toEqual([]);
        expect(await messagesOf(journeyId)).toEqual([]);
        expect(log.events).toEqual([{ event: 'watchdog_failed', stage: 'open', code: 'P0001' }]);
      },
    );

    expect((await watchdogFor().sweep()).opened).toBe(1);
    expect(await stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(recipientsOf(await messagesOf(journeyId))).toEqual([...responderIds].sort());
  });

  test('LOST-02-AC12: a journey with no responder rows, put there directly, is never moved: it stays ACTIVE, the open fails, and the sweep says so', async () => {
    const { journeyId } = await overdue({ responders: 0 });
    const log = fakeLog();

    const swept = await watchdogFor({ log }).sweep();

    expect(swept.ok).toBe(false);
    expect(await stateOf(journeyId)).toBe('ACTIVE');
    expect(await alertsOf(journeyId)).toEqual([]);
    expect(log.events).toContainEqual(
      expect.objectContaining({ event: 'watchdog_failed', stage: 'open' }),
    );
  });
});

describe('LOST-02: what the alert records', () => {
  test('LOST-02-AC13: the alert is OPEN, opened at the sweep’s database time, silent since the journey’s last heartbeat, which is the one latestHeartbeatOf reads; a journey with no heartbeat is silent since its start', async () => {
    const heard = await overdue({ heartbeat: false, silentForMs: 60 * MINUTE });
    const now = await databaseNowMs();
    const earlier = {
      journeyId: heard.journeyId,
      eventId: syntheticEventId(),
      receivedAt: new Date(now - 10 * MINUTE),
      batteryLevel: syntheticBatteryLevel(),
      position: toStoredPosition(syntheticPosition()),
    };
    const last = {
      ...earlier,
      eventId: syntheticEventId(),
      receivedAt: new Date(now - 6 * MINUTE),
    };
    for (const heartbeat of [last, earlier]) {
      expect(await store().recordHeartbeat(heartbeat)).toEqual({ outcome: 'recorded' });
    }
    const unheard = await overdue({ heartbeat: false, silentForMs: 7 * MINUTE });

    const before = await databaseNowMs();
    await watchdogFor().sweep();
    const after = await databaseNowMs();

    const [alert] = await alertsOf(heard.journeyId);
    expect(alert?.state).toBe('OPEN');
    expect(alert?.openedAt).toBeGreaterThanOrEqual(before);
    expect(alert?.openedAt).toBeLessThanOrEqual(after);
    expect(alert?.silentSince).toBe(last.receivedAt.getTime());
    expect(await store().latestHeartbeatOf(heard.journeyId)).toEqual({
      receivedAt: last.receivedAt,
      hasPosition: true,
      batteryLevel: last.batteryLevel,
    });
    expect((await alertsOf(unheard.journeyId)).map(({ silentSince }) => silentSince)).toEqual([
      await startedAt(unheard.journeyId),
    ]);
  });
});

describe('LOST-02: no push is made inside a transaction', () => {
  test('LOST-02-AC16: with the pool’s idle limit set to 300 ms for the test, a push that answers after a second is still marked sent; no session is ended, and no database_error line is written', async () => {
    const { journeyId } = await overdue();
    await watchdogFor().sweep();
    const log = fakeLog();
    const shortPool = createPool(connectionUri(), 2, {
      name: 'worker',
      log,
      idleInTransactionMs: 300,
    });
    try {
      const push = fakePush();
      push.holdAnswers();
      const sender = senderFor({
        outbox: databaseJourneyStore(createDatabase(shortPool)),
        push,
        log,
      });

      const delivering = sender.deliverDue();
      delivering.catch(() => undefined);
      try {
        expect(await eventually(() => Promise.resolve(push.messages.length === 1))).toBe(true);
        await sleep(SECOND);
      } finally {
        push.releaseAnswers();
      }
      await delivering;

      expect(push.messages).toHaveLength(1);
      expect((await messagesOf(journeyId)).map(({ sent }) => sent)).toEqual([true]);
      expect(log.events.filter(({ event }) => event === 'database_error')).toEqual([]);
      expect(log.events).toEqual([]);
    } finally {
      await endTestPool(shortPool);
    }
  });
});

describe('REL-08 and LOST-02: a journey the watchdog cannot move is reported, and stops the beat', () => {
  /** A session of the test's own, holding J's row `for update` in an open transaction. */
  async function holding(journeyId: string): Promise<pg.PoolClient> {
    const holder = await connection().connect();
    await holder.query('begin');
    await holder.query('select id from journeys where id = $1 for update', [journeyId]);
    return holder;
  }

  test('LOST-02-AC20: a journey silent 5 min 30 s whose row is held by a transaction that commits within the lock wait without changing it is not stuck: the waiting attempt opens its alert, the sweep is ok and the beat recorded', async () => {
    const { journeyId, responderIds } = await overdue({
      responders: 2,
      silentForMs: STUCK_SILENCE,
    });
    const log = fakeLog();
    const holder = await holding(journeyId);
    let result: { ok: boolean; opened: number; stuck: number };
    let tookMs: number;
    const before = await databaseNowMs();
    try {
      const started = performance.now();
      const sweeping = watchdogFor({ log }).sweep();
      sweeping.catch(() => undefined);
      // The holder lets go about a second after the sweep starts.
      await sleep(SECOND);
      await holder.query('commit');
      result = await sweeping;
      tookMs = performance.now() - started;
    } finally {
      holder.release();
    }

    expect(result).toEqual({ ok: true, opened: 1, escalated: 0, stuck: 0 });
    // It waited for the holder, and for no longer than the holder took.
    expect(tookMs).toBeGreaterThanOrEqual(SECOND - 100);
    expect(tookMs).toBeLessThan(LOCK_WAIT_LIMIT_MS);
    expect(await stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(await alertsOf(journeyId)).toHaveLength(1);
    expect(recipientsOf(await messagesOf(journeyId))).toEqual([...responderIds].sort());
    expect(log.events).toEqual([]);
    expect(
      (await databaseWorkerHeartbeats(database()).lastBeat())?.getTime(),
    ).toBeGreaterThanOrEqual(before);
  }, 60_000);

  test('LOST-02-AC20: a journey silent 5 min 30 s whose row is held by a transaction that moves it to LOST_CONTACT with its alert and commits within the lock wait, as a concurrent sweeper does, is skipped, not stuck: exactly one alert, the sweep ok, no watchdog_overdue line', async () => {
    const { journeyId, responderIds } = await overdue({
      responders: 2,
      silentForMs: STUCK_SILENCE,
    });
    const log = fakeLog();
    const alertId = syntheticUuid();
    const holder = await holding(journeyId);
    let result: { ok: boolean; opened: number; stuck: number };
    let tookMs: number;
    const before = await databaseNowMs();
    try {
      const started = performance.now();
      const sweeping = watchdogFor({ log }).sweep();
      sweeping.catch(() => undefined);
      await sleep(SECOND);
      // What a concurrent sweeper writes: the move, the alert and one message
      // per responder, in the transaction that holds the row.
      await holder.query("update journeys set state = 'LOST_CONTACT' where id = $1", [journeyId]);
      await holder.query(
        `insert into alerts (id, journey_id, state, opened_at, silent_since)
         select $1, id, 'OPEN', now(), coalesce(last_heartbeat_at, started_at)
           from journeys where id = $2`,
        [alertId, journeyId],
      );
      await holder.query(
        `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts, next_attempt_at)
         select gen_random_uuid(), $1, responder_id, 'LOST_CONTACT', now(), 0, now()
           from journey_responders where journey_id = $2`,
        [alertId, journeyId],
      );
      await holder.query('commit');
      result = await sweeping;
      tookMs = performance.now() - started;
    } finally {
      holder.release();
    }

    expect(result).toEqual({ ok: true, opened: 0, escalated: 0, stuck: 0 });
    expect(tookMs).toBeGreaterThanOrEqual(SECOND - 100);
    expect(tookMs).toBeLessThan(LOCK_WAIT_LIMIT_MS);
    expect(await stateOf(journeyId)).toBe('LOST_CONTACT');
    expect((await alertsOf(journeyId)).map(({ id }) => id)).toEqual([alertId]);
    expect(recipientsOf(await messagesOf(journeyId))).toEqual([...responderIds].sort());
    expect(log.events).toEqual([]);
    expect(
      (await databaseWorkerHeartbeats(database()).lastBeat())?.getTime(),
    ).toBeGreaterThanOrEqual(before);
  }, 60_000);

  test('LOST-02-AC20: a journey silent 5 min 30 s held by a session that never lets go is stuck after the lock wait: the sweep takes at least LOCK_WAIT_LIMIT_MS and less than it plus a margin, another overdue journey in the same sweep is opened, one watchdog_overdue line names it, and no beat is recorded; before 5 min 30 s it is skipped at once, and once the hold ends the next sweep opens it and records the beat', async () => {
    const { journeyId } = await overdue({ silentForMs: 5 * MINUTE + 28 * SECOND });
    const beats = databaseWorkerHeartbeats(database());
    const log = fakeLog();
    // A psql-like session: its own connection, outside every pool, with no limit.
    const { default: pgModule } = await import('pg');
    const outsider = new pgModule.Client({ connectionString: connectionUri() });
    await outsider.connect();
    let beatBeforeStuck: number | undefined;
    try {
      await outsider.query('begin');
      await outsider.query('select id from journeys where id = $1 for update', [journeyId]);

      // At 5 min 28 s: skipped at once, with no waiting attempt.
      const early = performance.now();
      expect(await watchdogFor({ log }).sweep()).toEqual({
        ok: true,
        opened: 0,
        escalated: 0,
        stuck: 0,
      });
      expect(performance.now() - early).toBeLessThan(SECOND);
      expect(log.events).toEqual([]);
      beatBeforeStuck = (await beats.lastBeat())?.getTime();
      expect(beatBeforeStuck).toBeDefined();

      // Past 5 min 30 s, with another overdue journey beside it.
      await sleep(2_500);
      const other = await overdue();
      const started = performance.now();
      const stuck = await watchdogFor({ log }).sweep();
      const tookMs = performance.now() - started;

      expect(tookMs).toBeGreaterThanOrEqual(LOCK_WAIT_LIMIT_MS);
      expect(tookMs).toBeLessThan(LOCK_WAIT_LIMIT_MS + MARGIN);
      expect(stuck).toEqual({ ok: false, opened: 1, escalated: 0, stuck: 1 });
      expect(await stateOf(other.journeyId)).toBe('LOST_CONTACT');
      expect(await stateOf(journeyId)).toBe('ACTIVE');
      expect(await alertsOf(journeyId)).toEqual([]);
      expect(log.events).toEqual([{ event: 'watchdog_overdue', journeyId }]);
      expect((await beats.lastBeat())?.getTime()).toBe(beatBeforeStuck);

      await outsider.query('rollback');
    } finally {
      await outsider.end();
    }

    expect(await watchdogFor({ log }).sweep()).toEqual({
      ok: true,
      opened: 1,
      escalated: 0,
      stuck: 0,
    });
    expect(await stateOf(journeyId)).toBe('LOST_CONTACT');
    expect((await beats.lastBeat())?.getTime()).toBeGreaterThan(beatBeforeStuck ?? Number.NaN);
    expect(log.events).toHaveLength(1);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// LOST-02, review loop 1 (approach item 3): every open, the first attempt
// included, bounds its own waits with a lock limit local to its transaction.
// `skip locked` covers only the journey's row; an open also waits for a
// responder's users row (each outbox row references it), and without a limit
// one such row held for ever would stop every sweep.
// ---------------------------------------------------------------------------

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

/** A psql-like session: its own connection, outside every pool, with no limit, holding a row `for update`. */
async function sessionHolding(table: 'users' | 'journeys', id: string) {
  const { default: pgModule } = await import('pg');
  const session = new pgModule.Client({ connectionString: connectionUri() });
  await session.connect();
  await session.query('begin');
  await session.query(`select id from ${table} where id = $1 for update`, [id]);
  return {
    letGo: async () => {
      await session.query('rollback').catch(() => undefined);
      await session.end();
    },
  };
}

/** A pool of one connection, made as the worker makes its pool: so a later query runs on the very connection an open used. */
function oneConnectionWorkerPool() {
  return createPool(connectionUri(), 1, {
    name: 'worker',
    log: fakeLog(),
    idleInTransactionMs: IDLE_IN_TRANSACTION_LIMIT_MS,
  });
}

async function lockTimeoutOf(single: pg.Pool): Promise<string | undefined> {
  const result = await single.query<{ value: string }>(
    "select current_setting('lock_timeout') as value",
  );
  return result.rows[0]?.value;
}

describe('LOST-02: every open bounds its own waits, the first attempt included', () => {
  test('LOST-02-AC17: with a responder’s users row held for update by a session outside both pools, a first-attempt open of that journey fails within LOCK_WAIT_LIMIT_MS plus a margin with code 55P03, writes nothing, and the worker connection’s own lock_timeout is still 0 afterwards', async () => {
    const { journeyId, responderIds } = await overdue();
    const holder = await sessionHolding('users', responderIds[0] ?? '');
    const single = oneConnectionWorkerPool();
    let outcome: unknown;
    let tookMs: number | undefined;
    try {
      const started = performance.now();
      outcome = await bounded(
        databaseJourneyStore(createDatabase(single))
          .openLostContactAlert({ journeyId, afterMs: LOST_CONTACT_AFTER_MS })
          .then(
            (answer) => ({ answer }),
            (error: unknown) => ({ error }),
          ),
        LOCK_WAIT_LIMIT_MS + MARGIN,
      );
      tookMs = performance.now() - started;
    } finally {
      await holder.letGo();
    }

    try {
      const failed = outcome as { error?: unknown };
      expect(failed.error, JSON.stringify(outcome)).toBeInstanceOf(Error);
      expect(sqlstateOf(failed.error)).toBe('55P03');
      expect(tookMs).toBeGreaterThanOrEqual(LOCK_WAIT_LIMIT_MS);
      expect(tookMs).toBeLessThan(LOCK_WAIT_LIMIT_MS + MARGIN);
      expect(await stateOf(journeyId)).toBe('ACTIVE');
      expect(await alertsOf(journeyId)).toEqual([]);
      expect(await messagesOf(journeyId)).toEqual([]);
      // Local to the open's transaction: the connection itself keeps none.
      expect(await lockTimeoutOf(single)).toBe('0');
    } finally {
      await endTestPool(single);
    }
  }, 60_000);

  test('LOST-02-AC17: a first-attempt open and a waiting open that each commit, on a pool of one connection, leave that connection’s lock_timeout at 0 afterwards', async () => {
    // After a commit, not a rollback (review loop 2, test-auditor): a
    // rollback undoes a session-level set_config too, so only a committed
    // open shows that its limit was the transaction's own.
    const first = await overdue();
    const waiting = await overdue();
    const single = oneConnectionWorkerPool();
    const journeys = databaseJourneyStore(createDatabase(single));
    try {
      const firstAttempt = await journeys.openLostContactAlert({
        journeyId: first.journeyId,
        afterMs: LOST_CONTACT_AFTER_MS,
      });
      expect(firstAttempt.outcome).toBe('opened');
      expect(await stateOf(first.journeyId)).toBe('LOST_CONTACT');
      expect(await lockTimeoutOf(single)).toBe('0');

      const waitingAttempt = await journeys.openLostContactAlert({
        journeyId: waiting.journeyId,
        afterMs: LOST_CONTACT_AFTER_MS,
        lockWaitMs: 300,
      });
      expect(waitingAttempt.outcome).toBe('opened');
      expect(await stateOf(waiting.journeyId)).toBe('LOST_CONTACT');
      expect(await lockTimeoutOf(single)).toBe('0');
    } finally {
      await endTestPool(single);
    }
  }, 60_000);

  test('LOST-02-AC17: a waiting attempt’s lock limit is local to its transaction too: on a pool of one connection, lock_timeout is still 0 after an attempt that answered held, and after one that opened', async () => {
    const { journeyId } = await overdue({ silentForMs: STUCK_SILENCE });
    const single = oneConnectionWorkerPool();
    const journeys = databaseJourneyStore(createDatabase(single));
    try {
      const holder = await sessionHolding('journeys', journeyId);
      let held: unknown;
      try {
        held = await bounded(
          journeys.openLostContactAlert({
            journeyId,
            afterMs: LOST_CONTACT_AFTER_MS,
            lockWaitMs: 300,
          }),
          300 + MARGIN,
        );
      } finally {
        await holder.letGo();
      }
      expect(held).toEqual({ outcome: 'held' });
      expect(await lockTimeoutOf(single)).toBe('0');

      const opened = await journeys.openLostContactAlert({
        journeyId,
        afterMs: LOST_CONTACT_AFTER_MS,
        lockWaitMs: 300,
      });
      expect(opened.outcome).toBe('opened');
      expect(await lockTimeoutOf(single)).toBe('0');
    } finally {
      await endTestPool(single);
    }
  }, 60_000);

  test('LOST-02-AC20: a journey whose responder’s users row is held for ever: under 5 min 30 s the sweep fails with one watchdog_failed line, stage open, code 55P03, still opens the other overdue journeys and records no beat; from 5 min 30 s it also writes one watchdog_overdue line naming the journey', async () => {
    const j = await overdue({ silentForMs: 5 * MINUTE + 22 * SECOND });
    const k = await overdue();
    const beats = databaseWorkerHeartbeats(database());
    const holder = await sessionHolding('users', j.responderIds[0] ?? '');
    try {
      const beatBefore = (await beats.lastBeat())?.getTime() ?? null;

      // Under 5 min 30 s: failed, and the sweep goes on.
      const underLog = fakeLog();
      const under = await bounded(
        watchdogFor({ log: underLog }).sweep(),
        LOCK_WAIT_LIMIT_MS + MARGIN,
      );
      expect(under).toEqual({ ok: false, opened: 1, escalated: 0, stuck: 0 });
      expect(underLog.events).toEqual([{ event: 'watchdog_failed', stage: 'open', code: '55P03' }]);
      expect(await stateOf(k.journeyId)).toBe('LOST_CONTACT');
      expect(await stateOf(j.journeyId)).toBe('ACTIVE');
      expect(await alertsOf(j.journeyId)).toEqual([]);
      expect((await beats.lastBeat())?.getTime() ?? null).toBe(beatBefore);

      // From 5 min 30 s: stuck as well.
      const silence = await connection().query<{ ms: string }>(
        `select floor(extract(epoch from now() - last_heartbeat_at) * 1000)::bigint::text as ms
           from journeys where id = $1`,
        [j.journeyId],
      );
      await sleep(Math.max(0, STUCK_SILENCE + 500 - Number(silence.rows[0]?.ms)));
      const pastLog = fakeLog();
      const past = await bounded(
        watchdogFor({ log: pastLog }).sweep(),
        LOCK_WAIT_LIMIT_MS + MARGIN,
      );
      expect(past).toEqual({ ok: false, opened: 0, escalated: 0, stuck: 1 });
      expect(pastLog.events).toHaveLength(2);
      expect(pastLog.events).toEqual(
        expect.arrayContaining([
          { event: 'watchdog_failed', stage: 'open', code: '55P03' },
          { event: 'watchdog_overdue', journeyId: j.journeyId },
        ]),
      );
      expect(await stateOf(j.journeyId)).toBe('ACTIVE');
      expect((await beats.lastBeat())?.getTime() ?? null).toBe(beatBefore);
    } finally {
      await holder.letGo();
    }
  }, 90_000);
});
