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
 *
 * GRP-01-AC8, review loop 1: a group keeps the SHA-256 of its first admin's
 * join key, `bootstrap_join_key_hash`, not null. A group put in here is no
 * bootstrap, so it gets the hash of a join key nobody holds, and no phone can
 * retry it. The row is built from the columns the table has
 * (`json_populate_record`), so the same SQL fills that column once the
 * migration adds it and still runs on a table without it; any other column
 * the table gains that is not null and not named here fails here, loudly.
 */
import { syntheticDisplayName, syntheticJoinKey } from './synthetic-groups.ts';
import { syntheticUuid } from './synthetic-ids.ts';

/** What these helpers need of a pool or a client: pg's query, by shape. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * A group row, as SQL: the ID in `$<id>`, now() as its time, and the hash of
 * the join key in `$<key>` as its first admin's, nobody's. Only the columns
 * the table has are filled.
 */
const groupRowSql = (id: number, key: number): string =>
  `select r.* from json_populate_record(
     null::groups,
     json_build_object(
       'id', $${String(id)}::uuid,
       'created_at', now(),
       'bootstrap_join_key_hash', encode(sha256(convert_to($${String(key)}, 'UTF8')), 'hex')
     )
   ) as r`;

/**
 * Puts a group row in, as a second group would be: no `on conflict`, so it
 * rejects as the table rejects one (GRP-01-AC9). Resolves to its ID.
 */
export async function insertGroupRow(db: Queryable): Promise<string> {
  const id = syntheticUuid();
  await db.query(`insert into groups ${groupRowSql(1, 2)}`, [id, syntheticJoinKey()]);
  return id;
}

/** The one group's ID, the group put in first, at now(), when there is none. */
export async function theGroupRow(db: Queryable): Promise<string> {
  await db.query(`insert into groups ${groupRowSql(1, 2)} on conflict do nothing`, [
    syntheticUuid(),
    syntheticJoinKey(),
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
       insert into groups ${groupRowSql(1, 5)} on conflict do nothing returning id
     ),
     the_group as (
       select id from made union all select id from groups
     ),
     the_user as (
       insert into users (id) values ($2) on conflict do nothing
     )
     insert into memberships (user_id, group_id, role, display_name, joined_at)
     select $2, (select id from the_group limit 1), $3, $4, now()`,
    [syntheticUuid(), userId, role, displayName, syntheticJoinKey()],
  );
  return userId;
}
