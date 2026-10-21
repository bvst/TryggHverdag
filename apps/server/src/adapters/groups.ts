/**
 * The group, its members, its invitations and its audit log, in PostgreSQL
 * (GRP-01, D-137): the first admin's bootstrap, the join, the invitation, the
 * members, and the admin's removal of a member.
 *
 * The domain decides (`domain/groups.ts`); this reads what it needs, asks, and
 * writes what it decided, each in one transaction, all of it or none of it
 * (AR-04, AR-05). The database holds what a read cannot: one group (a unique
 * index on a constant), one admin, a member in one group, a display name of 1
 * to 40 characters, and neither canary user a member (D-128).
 *
 * Nothing secret is stored. An invitation's code, a join key and a device's
 * credential are kept only as their SHA-256 (`hashCredential`), and none of
 * them is ever bound into a query: only its hash is. Every ID a row gets, a
 * user's, a device's, a group's or an invitation's, is the database's own
 * `gen_random_uuid()`, never a constant, so no join can write the canary's
 * device (approach item 7).
 *
 * Every time is the transaction's now() (AR-03, REL-01): an invitation's
 * creation and expiry, its use, a membership's start and each audit row. An
 * invitation is decided at that now() by the domain's rule.
 *
 * The first admin's bootstrap can be retried (GRP-01-AC8, review loop 1,
 * approach item 8): the group's row keeps the SHA-256 of the join key it was
 * made with, and the same key, while the admin is the group's only member,
 * gives the admin's one device a new credential, as a retried join does. The
 * group's row is taken FOR UPDATE for it; a member joining checks its
 * membership's foreign key against that row (FOR KEY SHARE), so the two take
 * turns, and the retry counts the members as they are when it decides.
 *
 * The admin's removal of a member is one transaction (approach item 9): its
 * own lock limit; the membership's row FOR UPDATE, after the start's FOR SHARE
 * (`adapters/journeys.ts`), so a start and a removal never leave a removed
 * member on a new journey; the membership deleted; then, in journey-ID order,
 * SM-10's own removal step (`removeInside`) on each unended journey the member
 * follows; then the audit row. A journey's row that cannot be had within the
 * limit fails the whole removal, writing nothing (AC20). Membership row, then
 * journey rows: the watchdog, a heartbeat and "I'm on it" take journey rows
 * alone, and a start takes membership rows before it writes, so no two of
 * them can wait for each other in a cycle.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import {
  auditLog,
  devices,
  groups,
  invitations,
  journeyResponders,
  journeys,
  memberships,
  unended,
  users,
} from '../db/schema.ts';
import { databaseTime } from '../domain/database-time.ts';
import {
  CODE_ALPHABET,
  INVITATION_CODE_LENGTH,
  INVITATION_VALID_FOR_MS,
  decideJoin,
  decideMemberRemoval,
  mayAdminister,
  type Role,
} from '../domain/groups.ts';
import { LOCK_WAIT_LIMIT_MS } from '../domain/watchdog.ts';
import type {
  CreateInvitationResult,
  GroupStore,
  JoinResult,
  JoinToRecord,
  MemberAsRead,
  RemoveMemberResult,
} from '../ports.ts';
import type { Database } from './db.ts';
import { hashCredential, issueCredential } from './device-credentials.ts';
import { removeInside } from './journeys.ts';

/** A transaction on the database: what every write here runs in. */
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** A database, or a transaction on one: both can read. */
type Reader = Pick<Database, 'select'>;

/**
 * A new invitation code (GRP-01-AC1, approach item 3): 20 characters of
 * Crockford's base32, 100 bits from `crypto.randomBytes`. One byte for each
 * character, its low five bits: 256 is a multiple of 32, so each character is
 * equally likely. A failure of the random source is thrown, never answered
 * with a code made some other way.
 */
export function issueInvitationCode(): string {
  return Array.from(randomBytes(INVITATION_CODE_LENGTH), (byte) =>
    CODE_ALPHABET.charAt(byte & 0x1f),
  ).join('');
}

/** A member's row as the rules and the routes read it. */
const memberColumns = {
  userId: memberships.userId,
  displayName: memberships.displayName,
  role: memberships.role,
};

/** This user's membership, or null for a user who is no member. A plain read: no lock. */
async function memberOf(db: Reader, userId: string): Promise<MemberAsRead | null> {
  const [row] = await db
    .select(memberColumns)
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);
  return row ?? null;
}

/** A new user, under an ID the database makes. */
async function newUser(tx: Transaction): Promise<string> {
  const [user] = await tx
    .insert(users)
    .values({ id: sql`gen_random_uuid()` })
    .returning({ id: users.id });
  if (user === undefined) {
    throw new Error('A new user was not written, so nothing of the join is kept.');
  }
  return user.id;
}

/**
 * A device of this user holding only the SHA-256 of a fresh credential, under
 * an ID the database makes; the credential, for the phone, once (approach
 * item 4).
 */
async function newDevice(tx: Transaction, userId: string): Promise<string> {
  const { credential, hash } = issueCredential();
  const [device] = await tx
    .insert(devices)
    .values({ id: sql`gen_random_uuid()`, userId, credentialHash: hash })
    .returning({ id: devices.id });
  if (device === undefined) {
    throw new Error('A new device was not written, so nothing of the join is kept.');
  }
  return credential;
}

/** A member, joined now: their user, membership and device, in the transaction given. */
async function newMember(
  tx: Transaction,
  { groupId, role, displayName }: { groupId: string; role: Role; displayName: string },
): Promise<{ userId: string; credential: string }> {
  const userId = await newUser(tx);
  await tx.insert(memberships).values({ userId, groupId, role, displayName });
  const credential = await newDevice(tx, userId);
  return { userId, credential };
}

/** The join's one refusal. */
const NOT_VALID: JoinResult = { outcome: 'not_valid' };

/**
 * The same join retried (readings 3 and 5): the one device the first join made
 * for this user gets a new credential, and the first stops working. Anything
 * else than one device is thrown, never guessed at.
 */
async function reissueCredential(tx: Transaction, userId: string): Promise<string> {
  const own = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.userId, userId))
    .for('update');
  const [device, ...others] = own;
  if (device === undefined || others.length > 0) {
    throw new Error('A retried join found other than the one device its join made.');
  }
  const { credential, hash } = issueCredential();
  await tx.update(devices).set({ credentialHash: hash }).where(eq(devices.id, device.id));
  return credential;
}

/**
 * The first admin's bootstrap, sent again once the group exists (GRP-01-AC8,
 * review loop 1): the same bootstrap retried when the group was made with this
 * join key and its admin is still its only member; the one refusal otherwise,
 * writing nothing.
 */
async function retriedBootstrap(tx: Transaction, joinKeyHash: string): Promise<JoinResult> {
  const [group] = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.bootstrapJoinKeyHash, joinKeyHash))
    .for('update');
  if (group === undefined) {
    return NOT_VALID;
  }
  const [admin, ...others] = await tx
    .select(memberColumns)
    .from(memberships)
    .where(eq(memberships.groupId, group.id));
  if (admin === undefined || others.length > 0 || admin.role !== 'ADMIN') {
    return NOT_VALID;
  }
  const credential = await reissueCredential(tx, admin.userId);
  return { outcome: 'joined', userId: admin.userId, role: 'ADMIN', credential };
}

export function databaseGroupStore(db: Database): GroupStore {
  return {
    // GRP-01-AC8 (approach item 8): the group, keeping the join key's
    // SHA-256, its ADMIN, a device and the audit row, in one transaction. The
    // one-group index decides a race: a second bootstrap waits for the first,
    // finds the group, and writes nothing, unless it is the same bootstrap
    // retried (review loop 1).
    bootstrapGroup({
      joinKey,
      displayName,
    }: {
      joinKey: string;
      displayName: string;
    }): Promise<JoinResult> {
      return db.transaction(async (tx): Promise<JoinResult> => {
        const joinKeyHash = hashCredential(joinKey);
        const [group] = await tx
          .insert(groups)
          .values({ bootstrapJoinKeyHash: joinKeyHash })
          .onConflictDoNothing()
          .returning({ id: groups.id });
        if (group === undefined) {
          return retriedBootstrap(tx, joinKeyHash);
        }
        const { userId, credential } = await newMember(tx, {
          groupId: group.id,
          role: 'ADMIN',
          displayName,
        });
        await tx
          .insert(auditLog)
          .values({ actorId: userId, action: 'GROUP_CREATED', subjectId: userId });
        return { outcome: 'joined', userId, role: 'ADMIN', credential };
      });
    },

    // GRP-01-AC2 to AC6 (approach items 3 and 4): the invitation's row taken
    // FOR UPDATE, so joins racing with one code take their turns here, and
    // the domain's rule asked at the transaction's now().
    joinWithInvitation({ invitationCode, joinKey, displayName }: JoinToRecord) {
      return db.transaction(async (tx): Promise<JoinResult> => {
        const [invitation] = await tx
          .select({
            id: invitations.id,
            groupId: invitations.groupId,
            createdAt: invitations.createdAt,
            usedBy: invitations.usedBy,
            joinKeyHash: invitations.joinKeyHash,
            now: sql<unknown>`now()`,
          })
          .from(invitations)
          .where(eq(invitations.codeHash, hashCredential(invitationCode)))
          .for('update');
        if (invitation === undefined) {
          return NOT_VALID;
        }
        const joinKeyHash = hashCredential(joinKey);
        const user = invitation.usedBy === null ? null : await memberOf(tx, invitation.usedBy);
        const decision = decideJoin(
          {
            createdAt: invitation.createdAt,
            used:
              invitation.usedBy === null
                ? null
                : {
                    sameJoinKey: invitation.joinKeyHash === joinKeyHash,
                    stillAMember: user !== null,
                  },
          },
          databaseTime(invitation.now, 'The join'),
        );

        if (decision.type === 'refused') {
          return NOT_VALID;
        }
        if (decision.type === 'retry') {
          // The same join, retried after its answer was lost (reading 3): the
          // device it made gets a new credential, and the first stops working.
          if (user === null) {
            throw new Error('The join rule retried a join whose user is no member.');
          }
          const credential = await reissueCredential(tx, user.userId);
          return { outcome: 'joined', userId: user.userId, role: user.role, credential };
        }

        const { userId, credential } = await newMember(tx, {
          groupId: invitation.groupId,
          role: 'MEMBER',
          displayName,
        });
        const used = await tx
          .update(invitations)
          .set({ usedAt: sql`now()`, usedBy: userId, joinKeyHash })
          .where(eq(invitations.id, invitation.id))
          .returning({ id: invitations.id });
        if (used.length !== 1) {
          throw new Error('The invitation was not marked used, so nothing of the join is kept.');
        }
        return { outcome: 'joined', userId, role: 'MEMBER', credential };
      });
    },

    memberOf(userId: string): Promise<MemberAsRead | null> {
      return memberOf(db, userId);
    },

    members(): Promise<MemberAsRead[]> {
      return db
        .select(memberColumns)
        .from(memberships)
        .orderBy(asc(memberships.joinedAt), asc(memberships.userId));
    },

    // GRP-01-AC1 (approach item 3): the admin's alone; seven days from the
    // transaction's now(), and the audit row in the same transaction. The
    // interval is the domain's milliseconds, never "7 days", which across a
    // change of summer time would be a calendar's days, not 604 800 s.
    createInvitation({ adminId }: { adminId: string }): Promise<CreateInvitationResult> {
      return db.transaction(async (tx): Promise<CreateInvitationResult> => {
        const [admin] = await tx
          .select({ role: memberships.role, groupId: memberships.groupId })
          .from(memberships)
          .where(eq(memberships.userId, adminId))
          .for('share');
        if (admin === undefined || !mayAdminister(admin)) {
          return { outcome: 'not_the_admin' };
        }
        const invitationCode = issueInvitationCode();
        const [invitation] = await tx
          .insert(invitations)
          .values({
            groupId: admin.groupId,
            codeHash: hashCredential(invitationCode),
            createdBy: adminId,
            createdAt: sql`now()`,
            expiresAt: sql`now() + (${INVITATION_VALID_FOR_MS}::double precision * interval '1 millisecond')`,
          })
          .returning({ id: invitations.id, expiresAt: invitations.expiresAt });
        if (invitation === undefined) {
          throw new Error('The invitation was not written.');
        }
        await tx
          .insert(auditLog)
          .values({ actorId: adminId, action: 'INVITATION_CREATED', subjectId: invitation.id });
        return { outcome: 'created', invitationCode, expiresAt: invitation.expiresAt };
      });
    },

    // GRP-01-AC16, AC17, AC20 (approach item 9): all or nothing, in one
    // transaction, with a lock limit of its own whichever pool runs it.
    removeMember({
      adminId,
      memberId,
    }: {
      adminId: string;
      memberId: string;
    }): Promise<RemoveMemberResult> {
      return db.transaction(async (tx): Promise<RemoveMemberResult> => {
        await tx.execute(
          sql`select set_config('lock_timeout', ${String(LOCK_WAIT_LIMIT_MS)}, true)`,
        );
        const caller = await memberOf(tx, adminId);
        // Anyone but the admin is refused before any row is taken.
        if (!mayAdminister(caller)) {
          return { outcome: 'not_removed', reason: 'NOT_THE_ADMIN' };
        }
        const [member] = await tx
          .select({ userId: memberships.userId, role: memberships.role })
          .from(memberships)
          .where(eq(memberships.userId, memberId))
          .for('update');
        const decision = decideMemberRemoval(caller, member ?? null);
        if (decision.type === 'refused') {
          return { outcome: 'not_removed', reason: decision.reason };
        }

        const removed = await tx
          .delete(memberships)
          .where(eq(memberships.userId, memberId))
          .returning({ userId: memberships.userId });
        if (removed.length !== 1) {
          throw new Error('The membership was not deleted, so nothing of the removal is kept.');
        }
        // Read after the membership's lock: a start that held it FOR SHARE has
        // committed by now, and its journey is among these (AC13).
        const following = await tx
          .select({ id: journeys.id })
          .from(journeys)
          .innerJoin(journeyResponders, eq(journeyResponders.journeyId, journeys.id))
          .where(and(eq(journeyResponders.responderId, memberId), unended(journeys.state)))
          .orderBy(asc(journeys.id));
        for (const { id } of following) {
          // SM-10's own step. A journey that ended, or lost this responder,
          // since the read is answered under its lock and left as it is.
          await removeInside(tx, { journeyId: id, responderId: memberId });
        }
        await tx
          .insert(auditLog)
          .values({ actorId: adminId, action: 'MEMBER_REMOVED', subjectId: memberId });
        return { outcome: 'removed' };
      });
    },
  };
}
