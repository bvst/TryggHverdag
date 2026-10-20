/**
 * Group rows, put in directly, for the L3 tests (GRP-01, D-137).
 *
 * Since GRP-01 a journey's walker and responders must be current members of
 * the walker's group, held under the start's lock, so every L3 test that
 * starts a journey puts its people in the one group first (the spec's
 * "Existing assertions that change by design"). The SQL is written once,
 * here, rather than in each of a dozen files: the one group made if there is
 * none, a user if absent, and a membership with a synthetic display name
 * (RG-07). Times are the database's, now().
 *
 * The test kit has no Node types and does not depend on `pg`, so this takes
 * anything with pg's `query(text, values)`: a pool, or a client inside a
 * transaction of the test's own. Column names are the spec's (approach item
 * 2); a table that names them otherwise fails here, loudly.
 */
import { syntheticDisplayName } from './synthetic-groups.ts';
import { syntheticUuid } from './synthetic-ids.ts';

/** What these helpers need of a pool or a client: pg's query, by shape. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** The one group's ID, the group put in first, at now(), when there is none. */
export async function theGroupRow(db: Queryable): Promise<string> {
  await db.query('insert into groups (id, created_at) values ($1, now()) on conflict do nothing', [
    syntheticUuid(),
  ]);
  const { rows } = await db.query('select id::text as id from groups');
  const [row, ...others] = rows as { id: string }[];
  if (row === undefined || others.length > 0) {
    throw new Error(`expected exactly one group, and found ${String(rows.length)}`);
  }
  return row.id;
}

/**
 * A member of the one group: the group made if there is none, the user made
 * if absent, and the membership, a MEMBER with a synthetic display name unless
 * told otherwise. Rejects as the table rejects: a second membership, a second
 * ADMIN, a canary user, a name the check refuses. Resolves to the user's ID.
 *
 * One statement, so all of it or none of it: a membership the table refuses
 * leaves no group and no user behind, as the fake's builder leaves none. A
 * group left by a refused membership would make the next bootstrap find a
 * group, and refuse it.
 */
export async function insertMemberRow(
  db: Queryable,
  {
    userId = syntheticUuid(),
    role = 'MEMBER',
    displayName = syntheticDisplayName(),
  }: { userId?: string; role?: 'ADMIN' | 'MEMBER'; displayName?: string } = {},
): Promise<string> {
  await db.query(
    `with made as (
       insert into groups (id, created_at) values ($1, now()) on conflict do nothing returning id
     ),
     the_group as (
       select id from made union all select id from groups
     ),
     the_user as (
       insert into users (id) values ($2) on conflict do nothing
     )
     insert into memberships (user_id, group_id, role, display_name, joined_at)
     select $2, (select id from the_group limit 1), $3, $4, now()`,
    [syntheticUuid(), userId, role, displayName],
  );
  return userId;
}
