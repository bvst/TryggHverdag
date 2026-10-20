/**
 * The group, its members, its invitations and its audit log, in PostgreSQL
 * (GRP-01, D-137): the join, the invitation, the members, and the admin's
 * removal of a member.
 *
 * GRP-01's red phase: the signatures only. Every method throws until the
 * green phase writes its SQL and the migration its tables.
 */
import type { GroupStore } from '../ports.ts';
import type { Database } from './db.ts';

/**
 * A new invitation code (GRP-01-AC1, approach item 3): 20 characters of
 * Crockford's base32, 100 bits from `crypto.randomBytes`.
 */
export function issueInvitationCode(): string {
  throw new Error('not implemented (GRP-01)');
}

export const databaseGroupStore: (db: Database) => GroupStore = () => ({
  bootstrapGroup() {
    throw new Error('not implemented (GRP-01)');
  },
  joinWithInvitation() {
    throw new Error('not implemented (GRP-01)');
  },
  memberOf() {
    throw new Error('not implemented (GRP-01)');
  },
  members() {
    throw new Error('not implemented (GRP-01)');
  },
  createInvitation() {
    throw new Error('not implemented (GRP-01)');
  },
  removeMember() {
    throw new Error('not implemented (GRP-01)');
  },
});
