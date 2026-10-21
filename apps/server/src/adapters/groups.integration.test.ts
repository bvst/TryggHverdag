// L3 server integration: the group store against a real PostgreSQL, through
// the shared group suite (GRP-01, D-100).
//
// The system tests run the API against the journey fake, which since GRP-01
// keeps the group, its members, invitations, devices and audit rows. This
// file runs the same expectations, GROUP_STORE_BEHAVIOUR, against the real
// adapters, so the fake and the tables cannot drift apart: the group store
// (`adapters/groups.ts`, `databaseGroupStore`), the device authenticator, the
// journey store's eligibility read and start, and the canary's registration.
// What only the real tables can show is in the behaviours themselves: the
// one-group index and the memberships' key deciding races, the checks on the
// display name and the canary's users, only SHA-256 hashes stored, the
// database's now() deciding seven days, and the member's removal waiting on
// a journey's row lock and failing whole when it cannot have it (AC20).
//
// Each behaviour runs in a database of its own, made from a migrated template:
// the bootstrap's behaviours need one with no group in it, and there is only
// ever one group.
//
// PostgreSQL 15, staging's version, as deploy.integration.test.ts explains.
// Needs Docker, like every *.integration.test.ts: CI's integration job runs
// it, a cloud session cannot.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  GROUP_STORE_BEHAVIOUR,
  endTestPool,
  insertMemberRow,
  syntheticCredential,
  syntheticInvitationCode,
  syntheticUuid,
  type GroupStoreUnderTest,
} from '@trygghverdag/test-kit';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { databaseCanaryStore } from './canary.ts';
import { createDatabase, createPool } from './db.ts';
import { databaseDeviceAuthenticator, hashCredential } from './device-credentials.ts';
import { databaseGroupStore } from './groups.ts';
import { databaseJourneyStore } from './journeys.ts';
import { migrateDatabase } from './migrations.ts';

/** What Clever Cloud's DEV plan runs; see deploy.integration.test.ts. */
const STAGING_POSTGRES = 'postgres:15-alpine';

/** The migrated database every behaviour's own is copied from. */
const TEMPLATE = 'groups_template';

/** Enough connections for a race of GROUP_RACERS, each holding its own, and a holder beside them. */
const CONNECTIONS = 12;

let container: StartedPostgreSqlContainer | undefined;
let admin: pg.Pool | undefined;
let made = 0;

/** The container's URI with another database in its path. */
function uriFor(database: string): string {
  if (container === undefined) {
    throw new Error('The container did not start, so there is nothing to test against.');
  }
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${database}`;
  return url.toString();
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(STAGING_POSTGRES).start();
  admin = new pg.Pool({ connectionString: container.getConnectionUri(), max: 1 });
  await admin.query(`create database ${TEMPLATE}`);
  // The deploy's own migration step, not a schema built by hand.
  await migrateDatabase(uriFor(TEMPLATE));
}, 180_000);

afterAll(async () => {
  await endTestPool(admin);
  await container?.stop();
});

/** A fresh, migrated database of its own, and a pool on it. */
async function freshDatabase(): Promise<{ pool: pg.Pool; drop: () => Promise<void> }> {
  if (admin === undefined) {
    throw new Error('The container did not start, so there is nothing to test against.');
  }
  made += 1;
  const name = `groups_${String(made)}`;
  await admin.query(`create database ${name} template ${TEMPLATE}`);
  const pool = createPool(uriFor(name), CONNECTIONS);
  return {
    pool,
    drop: async () => {
      await endTestPool(pool);
      await admin?.query(`drop database if exists ${name} with (force)`);
    },
  };
}

/** The subject: the real adapters over one database, and its rows read back directly. */
function underTest(pool: pg.Pool): GroupStoreUnderTest {
  const db = createDatabase(pool);
  const groups = databaseGroupStore(db);
  const journeys = databaseJourneyStore(db);
  const devices = databaseDeviceAuthenticator(db);
  const canary = databaseCanaryStore(db);
  const rows = async <T>(text: string, values: unknown[] = []): Promise<T[]> =>
    (await pool.query(text, values)).rows as T[];
  return {
    store: {
      bootstrapGroup: (request) => groups.bootstrapGroup(request),
      joinWithInvitation: (request) => groups.joinWithInvitation(request),
      memberOf: (userId) => groups.memberOf(userId),
      members: () => groups.members(),
      createInvitation: (request) => groups.createInvitation(request),
      removeMember: (request) => groups.removeMember(request),
      authenticate: (credential) => devices.authenticate(credential),
      eligibleResponders: (walkerId, ids) => journeys.eligibleResponders(walkerId, ids),
      insertStarted: (journey) => journeys.insertStarted(journey),
      recordHome: (home) => journeys.recordHome(home),
      registerCanary: (request) => canary.registerCanary(request),
    },
    now: async () => (await rows<{ now: Date }>('select now() as now'))[0]?.now ?? new Date(NaN),
    // The database's now() moves on while a behaviour runs; five seconds is
    // far past what one join takes, and far inside seven days.
    timeMarginMs: 5_000,
    hash: hashCredential,
    addUser: async () => {
      const id = syntheticUuid();
      await pool.query('insert into users (id) values ($1)', [id]);
      return id;
    },
    addMember: ({ role, id } = {}) =>
      insertMemberRow(pool, {
        ...(id === undefined ? {} : { userId: id }),
        ...(role === undefined ? {} : { role }),
      }),
    addDevice: async (userId) => {
      const deviceId = syntheticUuid();
      const credential = syntheticCredential();
      await pool.query('insert into devices (id, user_id, credential_hash) values ($1, $2, $3)', [
        deviceId,
        userId,
        hashCredential(credential),
      ]);
      return { deviceId, credential };
    },
    seedInvitation: async ({ createdBy, createdAgoMs, used = null }) => {
      const id = syntheticUuid();
      const invitationCode = syntheticInvitationCode();
      await pool.query(
        `insert into invitations (id, group_id, code_hash, created_by, created_at, expires_at,
                                  used_at, used_by, join_key_hash)
         select $1, m.group_id, $2, $3,
                now() - make_interval(secs => $4::double precision / 1000),
                now() - make_interval(secs => $4::double precision / 1000) + interval '7 days',
                case when $5::uuid is null then null else now() end, $5::uuid, $6
           from memberships m where m.user_id = $3`,
        [
          id,
          hashCredential(invitationCode),
          createdBy,
          createdAgoMs,
          used?.by ?? null,
          used === null ? null : hashCredential(used.joinKey),
        ],
      );
      return { id, invitationCode };
    },
    seedJourney: async ({
      walkerId,
      deviceId,
      state,
      responderIds,
      startedAt,
      lastHeartbeatAt = null,
    }) => {
      const id = syntheticUuid();
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(
          'insert into journeys (id, walker_id, device_id, state, started_at, last_heartbeat_at) ' +
            'values ($1, $2, $3, $4, $5, $6)',
          [id, walkerId, deviceId, state, startedAt, lastHeartbeatAt],
        );
        for (const responderId of responderIds) {
          await client.query(
            'insert into journey_responders (journey_id, responder_id) values ($1, $2)',
            [id, responderId],
          );
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
      return id;
    },
    seedAlert: async ({
      journeyId,
      state,
      openedAt,
      silentSince,
      acknowledgedBy = null,
      acknowledgedAt = null,
      smsRaisedAt = null,
    }) => {
      const id = syntheticUuid();
      await pool.query(
        `insert into alerts (id, journey_id, state, opened_at, silent_since, acknowledged_by,
                             acknowledged_at, sms_raised_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, journeyId, state, openedAt, silentSince, acknowledgedBy, acknowledgedAt, smsRaisedAt],
      );
      return id;
    },
    seedMessage: async ({ alertId, recipientId, kind, createdAt, nextAttemptAt }) => {
      const id = syntheticUuid();
      await pool.query(
        `insert into outbox (id, alert_id, recipient_id, kind, created_at, next_attempt_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, alertId, recipientId, kind, createdAt, nextAttemptAt],
      );
      return id;
    },
    respondersOf: async (journeyId) =>
      (
        await rows<{ id: string }>(
          'select responder_id::text as id from journey_responders where journey_id = $1 order by 1',
          [journeyId],
        )
      ).map(({ id }) => id),
    stateOf: async (journeyId) =>
      (
        await rows<{ state: string }>('select state::text as state from journeys where id = $1', [
          journeyId,
        ])
      )[0]?.state ?? null,
    alertsOf: async (journeyId) =>
      (
        await rows<{ id: string; state: string; acknowledged_by: string | null; round: number }>(
          `select id::text as id, state::text as state, acknowledged_by::text as acknowledged_by, round
             from alerts where journey_id = $1 order by opened_at, id`,
          [journeyId],
        )
      ).map((row) => ({
        id: row.id,
        state: row.state,
        acknowledgedBy: row.acknowledged_by,
        round: row.round,
      })),
    messagesOf: async (journeyId) =>
      (
        await rows<{ id: string; recipient_id: string; kind: string; withdrawn_at: Date | null }>(
          `select o.id::text as id, o.recipient_id::text as recipient_id, o.kind::text as kind,
                  o.withdrawn_at
             from outbox o join alerts a on a.id = o.alert_id
            where a.journey_id = $1`,
          [journeyId],
        )
      ).map((row) => ({
        messageId: row.id,
        recipientId: row.recipient_id,
        kind: row.kind,
        withdrawnAt: row.withdrawn_at,
      })),
    journeyMessagesOf: async (journeyId) =>
      (
        await rows<{ recipient_id: string; kind: string }>(
          `select recipient_id::text as recipient_id, kind::text as kind
             from outbox where journey_id = $1`,
          [journeyId],
        )
      ).map((row) => ({ recipientId: row.recipient_id, kind: row.kind })),
    groupsAsStored: () => rows<{ id: string }>('select id::text as id from groups'),
    membershipsAsStored: async () =>
      (
        await rows<{ user_id: string; group_id: string; role: string; display_name: string }>(
          `select user_id::text as user_id, group_id::text as group_id, role::text as role,
                  display_name
             from memberships`,
        )
      ).map((row) => ({
        userId: row.user_id,
        groupId: row.group_id,
        role: row.role,
        displayName: row.display_name,
      })),
    invitationsAsStored: async () =>
      (
        await rows<{
          id: string;
          group_id: string;
          code_hash: string;
          created_by: string;
          created_at: Date;
          expires_at: Date;
          used_at: Date | null;
          used_by: string | null;
          join_key_hash: string | null;
        }>(
          `select id::text as id, group_id::text as group_id, code_hash, created_by::text as created_by,
                  created_at, expires_at, used_at, used_by::text as used_by, join_key_hash
             from invitations order by created_at, id`,
        )
      ).map((row) => ({
        id: row.id,
        groupId: row.group_id,
        codeHash: row.code_hash,
        createdBy: row.created_by,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        usedAt: row.used_at,
        usedBy: row.used_by,
        joinKeyHash: row.join_key_hash,
      })),
    auditAsStored: async () =>
      (
        await rows<{
          at: Date;
          actor_id: string | null;
          action: string;
          subject_id: string | null;
        }>(
          `select at, actor_id::text as actor_id, action::text as action,
                  subject_id::text as subject_id
             from audit_log order by id`,
        )
      ).map((row) => ({
        at: row.at,
        actorId: row.actor_id,
        action: row.action,
        subjectId: row.subject_id,
      })),
    devicesOf: async (userId) =>
      (
        await rows<{ id: string; credential_hash: string }>(
          'select id::text as id, credential_hash from devices where user_id = $1 order by 1',
          [userId],
        )
      ).map((row) => ({ id: row.id, credentialHash: row.credential_hash })),
    userCount: async () =>
      Number((await rows<{ count: string }>('select count(*) as count from users'))[0]?.count),
    deviceCount: async () =>
      Number((await rows<{ count: string }>('select count(*) as count from devices'))[0]?.count),
    hold: async (journeyId) => {
      const client = await pool.connect();
      await client.query('begin');
      await client.query('select 1 from journeys where id = $1 for update', [journeyId]);
      return {
        release: async () => {
          try {
            await client.query('rollback');
          } finally {
            client.release();
          }
        },
      };
    },
    removeMembershipRow: async (userId) => {
      await pool.query('delete from memberships where user_id = $1', [userId]);
    },
  };
}

describe('the group store over PostgreSQL, against the behaviour every group store shares (GRP-01, D-100)', () => {
  test('every behaviour of the shared suite is run here, the same list the fake runs', () => {
    expect(GROUP_STORE_BEHAVIOUR.length).toBeGreaterThanOrEqual(25);
  });

  test.each(GROUP_STORE_BEHAVIOUR)('$name', async ({ run }) => {
    const { pool, drop } = await freshDatabase();
    try {
      await run(underTest(pool));
    } finally {
      await drop();
    }
  });
});
