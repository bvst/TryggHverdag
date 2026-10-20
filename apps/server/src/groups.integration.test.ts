// L3 server integration: GRP-01 through the real API over a real PostgreSQL,
// with two connections where a race is the point.
//
// The shared group suite (adapters/groups.integration.test.ts) holds the
// store to the fake. What is held here is what only the whole server over
// the real tables can show:
//   - AC3: a join through the API leaves only hashes behind: no column of any
//     table holds the credential, the join key or the code;
//   - AC4 and AC8: two joins with one invitation, and two bootstraps, at once
//     through the API, leave one of each;
//   - AC6: the seven days are the database's: a process clock far ahead or far
//     behind changes nothing;
//   - AC9: the tables refuse a second ADMIN and a second group;
//   - AC11: a removed member's device is 401, the walking one admitted for its
//     own journey only, and a database that cannot answer is a 500;
//   - AC13: a start and a removal racing on the membership row, both orders,
//     on two connections, never leave a removed member on a new journey;
//   - AC15: the canary's users can have no membership, and joins never touch
//     the canary's device;
//   - AC20: a removal that cannot finish, its lock wait run out or a failure
//     after its first journey, changes nothing, says so in one closed line,
//     and completes when retried;
//   - AC24: no line the API writes holds a code, a join key, a credential or
//     its hash, a display name or a user's ID;
//   - SM-01-AC13's half that stays: a freshly migrated database holds no
//     group, membership, invitation or audit row either.
//
// Each test runs in a database of its own, made from a migrated template:
// there is only ever one group, and the bootstrap needs none.
//
// PostgreSQL 15, staging's version. Needs Docker: CI's integration job runs
// it, a cloud session cannot.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  CANARY_IDS,
  apiPath,
  endTestPool,
  fakeLog,
  insertGroupRow,
  insertMemberRow,
  syntheticBootstrapCode,
  syntheticCredential,
  syntheticDisplayName,
  syntheticHeartbeat,
  syntheticJoinKey,
  syntheticUuid,
} from '@trygghverdag/test-kit';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { databaseCanaryStore } from './adapters/canary.ts';
import { databaseClock } from './adapters/clock.ts';
import { createDatabase, createPool } from './adapters/db.ts';
import { databaseDeviceAuthenticator, hashCredential } from './adapters/device-credentials.ts';
import { databaseGroupStore } from './adapters/groups.ts';
import { databaseJourneyStore } from './adapters/journeys.ts';
import { migrateDatabase } from './adapters/migrations.ts';
import { databaseWorkerHeartbeats } from './adapters/worker-heartbeats.ts';
import { createApi } from './api.ts';
import { captured, markersIn } from './capture.test.ts';
import { createLog } from './log.ts';
import { createAcknowledgementService } from './modules/alerts/acknowledgement.ts';
import { createClosureService } from './modules/alerts/closure.ts';
import { createInvitationService } from './modules/groups/invitations.ts';
import { createJoinService } from './modules/groups/join.ts';
import { createMemberService } from './modules/groups/members.ts';
import { createHealthService } from './modules/health/service.ts';
import { createRemovalService } from './modules/journeys/removal.ts';
import { createJourneyService } from './modules/journeys/service.ts';
import type { Log } from './ports.ts';

/** What Clever Cloud's DEV plan runs; see deploy.integration.test.ts. */
const STAGING_POSTGRES = 'postgres:15-alpine';
const TEMPLATE = 'grp_template';
const CONNECTIONS = 6;
const DAY = 24 * 60 * 60 * 1_000;

let container: StartedPostgreSqlContainer | undefined;
let admin: pg.Pool | undefined;
let made = 0;

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
  await migrateDatabase(uriFor(TEMPLATE));
}, 180_000);

afterAll(async () => {
  await endTestPool(admin);
  await container?.stop();
});

function parsedOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface Phone {
  userId: string;
  credential: string;
  joinKey: string;
  displayName: string;
}

/** A migrated database of the test's own, the real API over it, and what a test needs around them. */
async function server({
  bootstrapCode = syntheticBootstrapCode(),
  log = fakeLog(),
}: { bootstrapCode?: string | null; log?: Log } = {}) {
  if (admin === undefined) {
    throw new Error('The container did not start, so there is nothing to test against.');
  }
  made += 1;
  const name = `grp_${String(made)}`;
  await admin.query(`create database ${name} template ${TEMPLATE}`);
  const uri = uriFor(name);
  const pool = createPool(uri, CONNECTIONS);
  const db = createDatabase(pool);
  const clock = databaseClock(db);
  const journeys = databaseJourneyStore(db);
  const groups = databaseGroupStore(db);
  const api = createApi({
    health: createHealthService({ clock, heartbeats: databaseWorkerHeartbeats(db) }),
    journeys: createJourneyService({ clock, journeys, log }),
    devices: databaseDeviceAuthenticator(db),
    acknowledgements: createAcknowledgementService({ alerts: journeys, log }),
    closures: createClosureService({ alerts: journeys, log }),
    joins: createJoinService({ groups, log, bootstrapCode }),
    invitations: createInvitationService({ groups, log }),
    members: createMemberService({ groups, log }),
    removals: createRemovalService({ journeys, log }),
  });

  const call = async (
    method: string,
    path: string,
    { credential, body }: { credential?: string; body?: unknown } = {},
  ) => {
    const headers: Record<string, string> = {};
    if (credential !== undefined) {
      headers['authorization'] = `Bearer ${credential}`;
    }
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const response = await api.request(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: parsedOrNull(text), text, headers: response.headers };
  };
  const count = async (table: string): Promise<number> =>
    (await pool.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]?.n ?? -1;

  const self = {
    pool,
    uri,
    groups,
    journeys,
    call,
    count,
    bootstrapCode,
    async joinWith(invitationCode: string): Promise<Phone> {
      const joinKey = syntheticJoinKey();
      const displayName = syntheticDisplayName();
      const answer = await call('POST', apiPath('group/members'), {
        body: { invitationCode, joinKey, displayName },
      });
      expect(answer.status, answer.text).toBe(201);
      const { userId, credential } = answer.body as { userId: string; credential: string };
      return { userId, credential, joinKey, displayName };
    },
    admin: () => self.joinWith(bootstrapCode ?? ''),
    async invitation(phone: Phone): Promise<string> {
      const answer = await call('POST', apiPath('group/invitations'), {
        credential: phone.credential,
        body: {},
      });
      expect(answer.status, answer.text).toBe(201);
      return (answer.body as { invitationCode: string }).invitationCode;
    },
    async member(adminPhone: Phone): Promise<Phone> {
      return self.joinWith(await self.invitation(adminPhone));
    },
    removeMember: (phone: Phone, userId: string) =>
      call('DELETE', apiPath(`group/members/${userId}`), { credential: phone.credential }),
    me: (phone: { credential: string }) =>
      call('GET', apiPath('me'), { credential: phone.credential }),
    async start(phone: Phone, responderIds: string[]) {
      return call('POST', apiPath('journeys'), {
        credential: phone.credential,
        body: { responderIds },
      });
    },
    async drop() {
      await endTestPool(pool);
      await admin?.query(`drop database if exists ${name} with (force)`);
    },
  };
  return self;
}

type Server = Awaited<ReturnType<typeof server>>;

/** Runs a test against a server of its own, and drops its database whatever happened. */
function withServer(
  run: (s: Server) => Promise<void>,
  options: { bootstrapCode?: string | null; log?: Log } = {},
): () => Promise<void> {
  return async () => {
    const s = await server(options);
    try {
      await run(s);
    } finally {
      await s.drop();
    }
  };
}

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** Whether any text, JSON or byte column of any table holds `secret`. */
async function anyColumnHolds(pool: pg.Pool, secret: string): Promise<string[]> {
  const columns = await pool.query<{ schema: string; table: string; column: string; type: string }>(
    `select c.table_schema as schema, c.table_name as table, c.column_name as column,
            c.data_type as type
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where t.table_type = 'BASE TABLE'
        and c.table_schema not in ('pg_catalog', 'information_schema')
        and c.table_schema not like 'pg\\_%'
        and c.data_type in ('text', 'character varying', 'character', 'json', 'jsonb', 'bytea', 'ARRAY')`,
  );
  const holding: string[] = [];
  for (const column of columns.rows) {
    const from = `${quoted(column.schema)}.${quoted(column.table)}`;
    const found =
      column.type === 'bytea'
        ? await pool.query<{ found: boolean }>(
            `select exists (select 1 from ${from} where position($1::bytea in ${quoted(column.column)}) > 0) as found`,
            [Buffer.from(secret, 'utf8')],
          )
        : await pool.query<{ found: boolean }>(
            `select exists (select 1 from ${from} where position($1 in ${quoted(column.column)}::text) > 0) as found`,
            [secret],
          );
    if (found.rows[0]?.found === true) {
      holding.push(`${column.table}.${column.column}`);
    }
  }
  return holding;
}

describe('GRP-01: a freshly migrated database', () => {
  test('GRP-01-AC8 and SM-01-AC13: as staging gets on deploy, it holds no group, membership, invitation, audit row, user or device: the first admin comes only from the bootstrap', async () => {
    const s = await server();
    try {
      expect({
        groups: await s.count('groups'),
        memberships: await s.count('memberships'),
        invitations: await s.count('invitations'),
        audit_log: await s.count('audit_log'),
        users: await s.count('users'),
        devices: await s.count('devices'),
      }).toEqual({ groups: 0, memberships: 0, invitations: 0, audit_log: 0, users: 0, devices: 0 });
    } finally {
      await s.drop();
    }
  });
});

describe('GRP-01: joining, against the real tables', () => {
  test(
    'GRP-01-AC3 and AC7: after a join through the API, no text, JSON or byte column of any table holds the credential, the join key or the code: only their SHA-256',
    withServer(async (s) => {
      const adminPhone = await s.admin();
      const shown = await s.invitation(adminPhone);
      const member = await s.joinWith(shown);
      const code = shown.replace(/[- ]/g, '');

      for (const secret of [member.credential, member.joinKey, code, adminPhone.credential]) {
        expect(await anyColumnHolds(s.pool, secret), 'a column holds a secret').toEqual([]);
      }
      const device = await s.pool.query<{ credential_hash: string; id: string }>(
        'select id::text as id, credential_hash from devices where user_id = $1',
        [member.userId],
      );
      expect(device.rows).toEqual([
        { id: expect.any(String) as unknown, credential_hash: hashCredential(member.credential) },
      ]);
      expect(device.rows[0]?.id).not.toBe(CANARY_IDS.deviceId);
      const invitation = await s.pool.query<{ code_hash: string; join_key_hash: string }>(
        'select code_hash, join_key_hash from invitations',
      );
      expect(invitation.rows).toEqual([
        { code_hash: hashCredential(code), join_key_hash: hashCredential(member.joinKey) },
      ]);
    }),
  );

  test(
    'GRP-01-AC4: two joins with one invitation and different join keys, at once on two connections: exactly one 201 and one 404 INVITATION_NOT_VALID; one user, one membership, one device come of it',
    withServer(async (s) => {
      const adminPhone = await s.admin();
      const invitationCode = await s.invitation(adminPhone);
      const before = { users: await s.count('users'), devices: await s.count('devices') };

      const answers = await Promise.all(
        [syntheticJoinKey(), syntheticJoinKey()].map((joinKey) =>
          s.call('POST', apiPath('group/members'), {
            body: { invitationCode, joinKey, displayName: syntheticDisplayName() },
          }),
        ),
      );

      expect(answers.map(({ status }) => status).sort()).toEqual([201, 404]);
      expect(await s.count('users')).toBe(before.users + 1);
      expect(await s.count('devices')).toBe(before.devices + 1);
      expect(await s.count('memberships')).toBe(2);
    }),
  );

  test(
    'GRP-01-AC8: two bootstraps at once on two connections leave exactly one group and one admin: one 201 ADMIN, one 404',
    withServer(async (s) => {
      const answers = await Promise.all(
        [syntheticJoinKey(), syntheticJoinKey()].map((joinKey) =>
          s.call('POST', apiPath('group/members'), {
            body: { invitationCode: s.bootstrapCode, joinKey, displayName: syntheticDisplayName() },
          }),
        ),
      );

      expect(answers.map(({ status }) => status).sort()).toEqual([201, 404]);
      expect(await s.count('groups')).toBe(1);
      expect((await s.pool.query("select 1 from memberships where role = 'ADMIN'")).rowCount).toBe(
        1,
      );
      expect(await s.count('audit_log')).toBe(1);
    }),
  );

  test(
    'GRP-01-AC6: the seven days are the database’s: with the process’s clock a month ahead, an invitation the database made yesterday still joins; with it a month behind, one the database made eight days ago does not',
    withServer(async (s) => {
      const adminPhone = await s.admin();
      const fresh = await s.invitation(adminPhone);
      const stale = await s.invitation(adminPhone);
      await s.pool.query(
        "update invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where code_hash = $1",
        [hashCredential(stale.replace(/[- ]/g, ''))],
      );
      await s.pool.query(
        "update invitations set created_at = now() - interval '1 day', expires_at = now() + interval '6 days' where code_hash = $1",
        [hashCredential(fresh.replace(/[- ]/g, ''))],
      );

      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date(Date.now() + 30 * DAY));
        const ahead = await s.call('POST', apiPath('group/members'), {
          body: {
            invitationCode: fresh,
            joinKey: syntheticJoinKey(),
            displayName: syntheticDisplayName(),
          },
        });
        vi.setSystemTime(new Date(Date.now() - 60 * DAY));
        const behind = await s.call('POST', apiPath('group/members'), {
          body: {
            invitationCode: stale,
            joinKey: syntheticJoinKey(),
            displayName: syntheticDisplayName(),
          },
        });

        expect(ahead.status, ahead.text).toBe(201);
        expect(behind.status, behind.text).toBe(404);
      } finally {
        vi.useRealTimers();
      }
    }),
  );

  test(
    'GRP-01-AC6: an invitation made seven days ago by the database’s clock, to the second, is not valid; one a minute younger is',
    withServer(async (s) => {
      const adminPhone = await s.admin();
      const [expired, valid] = [await s.invitation(adminPhone), await s.invitation(adminPhone)];
      await s.pool.query(
        "update invitations set created_at = now() - interval '7 days', expires_at = now() where code_hash = $1",
        [hashCredential(expired.replace(/[- ]/g, ''))],
      );
      await s.pool.query(
        "update invitations set created_at = now() - interval '7 days' + interval '1 minute', expires_at = now() + interval '1 minute' where code_hash = $1",
        [hashCredential(valid.replace(/[- ]/g, ''))],
      );

      const first = await s.call('POST', apiPath('group/members'), {
        body: {
          invitationCode: expired,
          joinKey: syntheticJoinKey(),
          displayName: syntheticDisplayName(),
        },
      });
      const second = await s.call('POST', apiPath('group/members'), {
        body: {
          invitationCode: valid,
          joinKey: syntheticJoinKey(),
          displayName: syntheticDisplayName(),
        },
      });

      expect(first.status).toBe(404);
      expect(second.status).toBe(201);
    }),
  );
});

// Review loop 1 (privacy-security-reviewer N1, code-reviewer; approach item
// 8): the first admin's bootstrap, retried with its join key while the admin
// is the group's only member, over the real tables. The group's row keeps
// the join key's SHA-256 (groups.bootstrap_join_key_hash), and nothing else
// is written but the admin's device's new hash.
describe('GRP-01: the first admin’s bootstrap, retried, against the real tables', () => {
  test(
    'GRP-01-AC8: the bootstrap code sent again with the same join key, while the admin is the only member, is 201: the same user, ADMIN, a new credential; the first credential is then 401 and the new one works; still one group, membership, user, device and GROUP_CREATED row; the device holds the new credential’s hash; the name is the first join’s; and the group’s row keeps only the join key’s SHA-256',
    withServer(async (s) => {
      const adminPhone = await s.admin();

      const again = await s.call('POST', apiPath('group/members'), {
        body: {
          invitationCode: s.bootstrapCode,
          joinKey: adminPhone.joinKey,
          displayName: syntheticDisplayName(),
        },
      });

      expect(again.status, again.text).toBe(201);
      expect(again.headers.get('cache-control')).toBe('no-store');
      const { userId, role, credential } = again.body as {
        userId: string;
        role: string;
        credential: string;
      };
      expect([userId, role]).toEqual([adminPhone.userId, 'ADMIN']);
      expect(credential).not.toBe(adminPhone.credential);
      expect((await s.me(adminPhone)).status).toBe(401);
      const me = await s.me({ credential });
      expect([me.status, me.body]).toEqual([
        200,
        { userId, displayName: adminPhone.displayName, role: 'ADMIN' },
      ]);
      expect({
        groups: await s.count('groups'),
        memberships: await s.count('memberships'),
        users: await s.count('users'),
        devices: await s.count('devices'),
      }).toEqual({ groups: 1, memberships: 1, users: 1, devices: 1 });
      const devices = await s.pool.query<{ credential_hash: string }>(
        'select credential_hash from devices where user_id = $1',
        [userId],
      );
      expect(devices.rows).toEqual([{ credential_hash: hashCredential(credential) }]);
      const audit = await s.pool.query<{ action: string }>('select action::text from audit_log');
      expect(audit.rows).toEqual([{ action: 'GROUP_CREATED' }]);
      const group = await s.pool.query<{ bootstrap_join_key_hash: string }>(
        'select bootstrap_join_key_hash from groups',
      );
      expect(group.rows).toEqual([{ bootstrap_join_key_hash: hashCredential(adminPhone.joinKey) }]);
      for (const secret of [adminPhone.joinKey, credential, adminPhone.credential]) {
        expect(await anyColumnHolds(s.pool, secret), 'a column holds a secret').toEqual([]);
      }
    }),
  );

  test(
    'GRP-01-AC8: the bootstrap code with another join key while the admin is the only member, and with the same join key once a second member has joined, is each 404 INVITATION_NOT_VALID and writes nothing: the admin’s device keeps its hash, and its credential still works',
    withServer(async (s) => {
      const adminPhone = await s.admin();
      const counts = async () => ({
        groups: await s.count('groups'),
        memberships: await s.count('memberships'),
        users: await s.count('users'),
        devices: await s.count('devices'),
        audit_log: await s.count('audit_log'),
        hashes: (
          await s.pool.query<{ credential_hash: string }>(
            'select credential_hash from devices order by credential_hash',
          )
        ).rows,
      });
      const join = (joinKey: string) =>
        s.call('POST', apiPath('group/members'), {
          body: { invitationCode: s.bootstrapCode, joinKey, displayName: syntheticDisplayName() },
        });

      const beforeOther = await counts();
      const otherKey = await join(syntheticJoinKey());
      expect(await counts()).toEqual(beforeOther);

      await s.member(adminPhone);
      const beforeSame = await counts();
      const sameKey = await join(adminPhone.joinKey);
      expect(await counts()).toEqual(beforeSame);

      for (const answer of [otherKey, sameKey]) {
        expect([answer.status, (answer.body as { code?: unknown } | null)?.code]).toEqual([
          404,
          'INVITATION_NOT_VALID',
        ]);
      }
      expect((await s.me(adminPhone)).status).toBe(200);
    }),
  );
});

describe('GRP-01: what the tables refuse', () => {
  test(
    'GRP-01-AC9: the database refuses a second ADMIN in the group (unique) and a second group (unique), by its own indexes',
    withServer(async (s) => {
      await insertMemberRow(s.pool, { role: 'ADMIN' });

      await expect(insertMemberRow(s.pool, { role: 'ADMIN' })).rejects.toMatchObject({
        code: '23505',
      });
      // RG-03 (GRP-01-AC8, review loop 1): the second group is put in by the
      // test kit's insertGroupRow, with every column the table has, rather
      // than with its ID and time alone: groups gains bootstrap_join_key_hash,
      // not null, and a row without it would be refused by that column
      // (23502) before the one-group index could refuse it. What is held,
      // 23505 from the index and still one group, is unchanged.
      await expect(insertGroupRow(s.pool)).rejects.toMatchObject({ code: '23505' });
      expect(await s.count('groups')).toBe(1);
    }),
  );

  test(
    'GRP-01-AC15: the memberships table refuses either canary user by its check, registered or not; joins and a bootstrap leave CANARY_DEVICE_ID with its user and hash',
    withServer(async (s) => {
      const canaryHash = hashCredential(syntheticCredential());
      await databaseCanaryStore(createDatabase(s.pool)).registerCanary({
        credentialHash: canaryHash,
      });

      for (const userId of [CANARY_IDS.walkerId, CANARY_IDS.responderId]) {
        await expect(insertMemberRow(s.pool, { userId }), userId).rejects.toMatchObject({
          code: '23514',
        });
      }
      const adminPhone = await s.admin();
      await s.member(adminPhone);
      await s.member(adminPhone);

      const canaryDevice = await s.pool.query<{ user_id: string; credential_hash: string }>(
        'select user_id::text as user_id, credential_hash from devices where id = $1',
        [CANARY_IDS.deviceId],
      );
      expect(canaryDevice.rows).toEqual([
        { user_id: CANARY_IDS.walkerId, credential_hash: canaryHash },
      ]);
      expect(
        (
          await s.pool.query('select 1 from memberships where user_id in ($1, $2)', [
            CANARY_IDS.walkerId,
            CANARY_IDS.responderId,
          ])
        ).rowCount,
      ).toBe(0);
    }),
  );

  test(
    'GRP-01: the memberships table refuses a display name blank after trimming, over 40 characters, or holding a control character, by its check',
    withServer(async (s) => {
      for (const displayName of ['   ', 'x'.repeat(41), 'Testmedlem\u0007Ø']) {
        await expect(
          insertMemberRow(s.pool, { displayName }),
          JSON.stringify(displayName),
        ).rejects.toMatchObject({
          code: '23514',
        });
      }
      await expect(insertMemberRow(s.pool, { displayName: 'x'.repeat(40) })).resolves.toEqual(
        expect.any(String),
      );
    }),
  );
});

describe('GRP-01: sessions, against the real tables', () => {
  test(
    'GRP-01-AC11: once removed, a member’s device is 401; the device that started their unended journey sends its heartbeats and "I’m home", and nothing else, until it ends',
    withServer(async (s) => {
      const adminPhone = await s.admin();
      const walker = await s.member(adminPhone);
      const responder = await s.member(adminPhone);
      const idle = await s.member(adminPhone);
      const started = await s.start(walker, [responder.userId]);
      expect(started.status, started.text).toBe(201);
      const { journeyId } = started.body as { journeyId: string };

      for (const userId of [walker.userId, idle.userId]) {
        expect((await s.removeMember(adminPhone, userId)).status).toBe(200);
      }

      expect((await s.me(idle)).status).toBe(401);
      expect((await s.me(walker)).status).toBe(401);
      expect((await s.start(walker, [responder.userId])).status).toBe(401);
      const beat = await s.call('POST', apiPath('heartbeats'), {
        credential: walker.credential,
        body: syntheticHeartbeat({ journeyId }),
      });
      expect([beat.status, beat.body]).toEqual([200, { outcome: 'RECORDED' }]);
      const home = await s.call('POST', apiPath(`journeys/${journeyId}/home`), {
        credential: walker.credential,
      });
      expect([home.status, home.body]).toEqual([200, { outcome: 'ENDED' }]);
      const after = await s.call('POST', apiPath('heartbeats'), {
        credential: walker.credential,
        body: syntheticHeartbeat({ journeyId }),
      });
      expect(after.status).toBe(401);
    }),
  );

  test(
    'GRP-01-AC11: when the database cannot answer, the authenticator rejects, and the API answers 500, never 401',
    withServer(async (s) => {
      const adminPhone = await s.admin();
      const gone = createPool(s.uri, 1);
      await gone.end();

      await expect(
        databaseDeviceAuthenticator(createDatabase(gone)).authenticate(adminPhone.credential),
      ).rejects.toThrow();
    }),
  );
});

describe('GRP-01: a start and a removal racing on the membership row (AC13)', () => {
  test(
    'GRP-01-AC13: the removal takes the row first: a start that read the member as eligible waits under its lock, then finds them gone, writes nothing and answers INVALID_RESPONDER',
    withServer(async (s) => {
      const adminPhone = await s.admin();
      const walker = await s.member(adminPhone);
      const [gone, kept] = [await s.member(adminPhone), await s.member(adminPhone)];
      const walkersDevice =
        (
          await s.pool.query<{ id: string }>(
            'select id::text as id from devices where user_id = $1',
            [walker.userId],
          )
        ).rows[0]?.id ?? '';
      expect(
        [
          ...(await s.journeys.eligibleResponders(walker.userId, [gone.userId, kept.userId])),
        ].sort(),
      ).toEqual([gone.userId, kept.userId].sort());
      // Another transaction, the removal's, takes the membership row and deletes it.
      const removal = await s.pool.connect();
      await removal.query('begin');
      await removal.query('delete from memberships where user_id = $1', [gone.userId]);

      const starting = s.journeys.insertStarted({
        walkerId: walker.userId,
        deviceId: walkersDevice,
        responderIds: [kept.userId, gone.userId],
        startedAt: new Date(),
      });
      // The start waits for the row; the removal commits.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await removal.query('commit');
      removal.release();

      expect(await starting).toEqual({ inserted: false, refused: 'INVALID_RESPONDER' });
      expect(await s.count('journeys')).toBe(0);
      expect(await s.count('journey_responders')).toBe(0);
    }),
  );

  test(
    'GRP-01-AC13: the start takes the row first: the removal waits, then finds the new journey and removes the member from it, in its own transaction',
    withServer(async (s) => {
      const adminPhone = await s.admin();
      const walker = await s.member(adminPhone);
      const [gone, kept] = [await s.member(adminPhone), await s.member(adminPhone)];
      const walkersDevice =
        (
          await s.pool.query<{ id: string }>(
            'select id::text as id from devices where user_id = $1',
            [walker.userId],
          )
        ).rows[0]?.id ?? '';
      // Another transaction, a start's, holds the membership rows FOR SHARE and
      // writes its journey with both responders.
      const start = await s.pool.connect();
      const journeyId = syntheticUuid();
      await start.query('begin');
      await start.query('select 1 from memberships where user_id = any($1) for share', [
        [gone.userId, kept.userId],
      ]);
      await start.query(
        "insert into journeys (id, walker_id, device_id, state, started_at) values ($1, $2, $3, 'ACTIVE', now())",
        [journeyId, walker.userId, walkersDevice],
      );
      for (const responderId of [kept.userId, gone.userId]) {
        await start.query(
          'insert into journey_responders (journey_id, responder_id) values ($1, $2)',
          [journeyId, responderId],
        );
      }

      const removing = s.groups.removeMember({ adminId: adminPhone.userId, memberId: gone.userId });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await start.query('commit');
      start.release();

      expect(await removing).toEqual({ outcome: 'removed' });
      const responders = await s.pool.query<{ id: string }>(
        'select responder_id::text as id from journey_responders where journey_id = $1',
        [journeyId],
      );
      expect(responders.rows.map(({ id }) => id)).toEqual([kept.userId]);
    }),
  );
});

describe('GRP-01: a removal that cannot finish changes nothing (AC20)', () => {
  /** Admin, member M on two unended journeys, and the journeys in ID order. */
  async function memberOnTwo(s: Server) {
    const adminPhone = await s.admin();
    const m = await s.member(adminPhone);
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const walker = await s.member(adminPhone);
      const answer = await s.start(walker, [m.userId]);
      expect(answer.status, answer.text).toBe(201);
      ids.push((answer.body as { journeyId: string }).journeyId);
    }
    return { adminPhone, m, journeys: ids.sort() };
  }

  async function stateOf(s: Server, memberId: string, journeyIds: string[]) {
    return {
      member: (await s.pool.query('select 1 from memberships where user_id = $1', [memberId]))
        .rowCount,
      on: (
        await s.pool.query(
          'select journey_id::text as j from journey_responders where responder_id = $1 and journey_id = any($2) order by 1',
          [memberId, journeyIds],
        )
      ).rows,
      audit: await s.count('audit_log'),
    };
  }

  test('GRP-01-AC20: the second journey’s row held by another transaction past the lock limit: 500, nothing written, one member_removal_failed line naming the stage and 55P03; retried once the row is free, it completes as AC17', async () => {
    const log = fakeLog();
    const s = await server({ log });
    try {
      const { adminPhone, m, journeys } = await memberOnTwo(s);
      const before = await stateOf(s, m.userId, journeys);
      const holder = await s.pool.connect();
      await holder.query('begin');
      await holder.query('select 1 from journeys where id = $1 for update', [journeys[1]]);

      let answer;
      try {
        answer = await s.removeMember(adminPhone, m.userId);
      } finally {
        await holder.query('rollback');
        holder.release();
      }

      expect(answer.status).toBe(500);
      expect(await stateOf(s, m.userId, journeys)).toEqual(before);
      expect(log.events.filter(({ event }) => event === 'member_removal_failed')).toEqual([
        { event: 'member_removal_failed', stage: 'store', code: '55P03' },
      ]);

      const retried = await s.removeMember(adminPhone, m.userId);
      expect([retried.status, retried.body]).toEqual([200, { outcome: 'REMOVED' }]);
      expect(await stateOf(s, m.userId, journeys)).toEqual({
        member: 0,
        on: [],
        audit: before.audit + 1,
      });
    } finally {
      await s.drop();
    }
  });

  test('GRP-01-AC20: a failure injected after the first journey’s step: 500, and the first journey’s removal is rolled back with the rest: M still a member, on both journeys, no audit row', async () => {
    const log = fakeLog();
    const s = await server({ log });
    try {
      const { adminPhone, m, journeys } = await memberOnTwo(s);
      const before = await stateOf(s, m.userId, journeys);
      // A trigger that fails the removal of M's row from the second journey,
      // after the first journey's step has run in the same transaction.
      await s.pool.query(
        `create function grp01_fail() returns trigger language plpgsql as $$
             begin
               if old.journey_id = '${journeys[1] ?? ''}'::uuid then
                 raise exception 'injected after the first journey' using errcode = '40001';
               end if;
               return old;
             end $$`,
      );
      await s.pool.query(
        'create trigger grp01_fail before delete on journey_responders for each row execute function grp01_fail()',
      );

      const answer = await s.removeMember(adminPhone, m.userId);

      expect(answer.status).toBe(500);
      expect(await stateOf(s, m.userId, journeys)).toEqual(before);
      expect(log.events.filter(({ event }) => event === 'member_removal_failed')).toEqual([
        { event: 'member_removal_failed', stage: 'store', code: '40001' },
      ]);
    } finally {
      await s.drop();
    }
  });
});

describe('GRP-01: nothing secret or personal reaches a log line (AC24)', () => {
  test('GRP-01-AC24: every new route through the real API and database, success, refusal and failure, with the real log: no line holds an invitation code, a join key, a credential or its hash, a display name or a user’s ID, and every line is a closed event', async () => {
    const markers: string[] = [];
    const { written } = await captured(async () => {
      const s = await server({ log: createLog() });
      try {
        const adminPhone = await s.admin();
        const shown = await s.invitation(adminPhone);
        const member = await s.joinWith(shown);
        const walker = await s.member(adminPhone);
        const started = await s.start(walker, [member.userId]);
        const { journeyId } = started.body as { journeyId: string };
        const code = shown.replace(/[- ]/g, '');
        markers.push(shown, code, hashCredential(code), s.bootstrapCode ?? '');
        for (const phone of [adminPhone, member, walker]) {
          markers.push(
            phone.credential,
            hashCredential(phone.credential),
            phone.joinKey,
            hashCredential(phone.joinKey),
            phone.displayName,
            phone.userId,
          );
        }
        await s.call('POST', apiPath('group/members'), {
          body: {
            invitationCode: shown,
            joinKey: syntheticJoinKey(),
            displayName: syntheticDisplayName(),
          },
        });
        await s.call('POST', apiPath('group/members'), {
          body: { invitationCode: shown, joinKey: member.joinKey, displayName: member.displayName },
        });
        await s.me(member);
        await s.call('GET', apiPath('group/members'), { credential: adminPhone.credential });
        await s.call('GET', apiPath('group/members'), { credential: member.credential });
        await s.removeMember(member, walker.userId);
        await s.removeMember(adminPhone, adminPhone.userId);
        await s.call('DELETE', apiPath(`journeys/${journeyId}/responders/${member.userId}`), {
          credential: member.credential,
        });
        await s.call('DELETE', apiPath(`journeys/${journeyId}/responders/${member.userId}`), {
          credential: walker.credential,
        });
        // A failure: the member's journey row held past the lock limit.
        const again = await s.start(walker, [member.userId]);
        const holder = await s.pool.connect();
        await holder.query('begin');
        const held = (again.body as { journeyId?: string } | null)?.journeyId ?? journeyId;
        await holder.query('select 1 from journeys where id = $1 for update', [held]);
        try {
          await s.removeMember(adminPhone, member.userId);
        } finally {
          await holder.query('rollback');
          holder.release();
        }
        await s.removeMember(adminPhone, member.userId);
      } finally {
        await s.drop();
      }
    });

    expect(
      markersIn(
        written,
        markers.filter((marker) => marker !== ''),
      ),
    ).toEqual([]);
    const lines = written.split('\n').filter((line) => line.trim().startsWith('{'));
    for (const line of lines) {
      const event = (JSON.parse(line) as { event?: unknown }).event;
      expect(typeof event, line).toBe('string');
    }
  });
});
