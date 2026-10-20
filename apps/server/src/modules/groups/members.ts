/**
 * The members (GRP-01-AC3, AC9, AC16 to AC21): who a phone is signed in as,
 * the admin's list, and the admin's removal of a member, at once and in one
 * transaction.
 *
 * GRP-01's red phase: the signatures only.
 */
import type { MemberRemovalRefusal } from '../../domain/groups.ts';
import type { GroupStore, Log, MemberAsRead } from '../../ports.ts';

/** Who this phone is signed in as; or not a member (the canary's device). */
export type MeResult = { type: 'member'; member: MemberAsRead } | { type: 'not_a_member' };

/** The admin's list of the members; or refused to anyone but the admin. */
export type MemberListResult =
  { type: 'listed'; members: MemberAsRead[] } | { type: 'refused'; reason: 'NOT_THE_ADMIN' };

/** Removed now, all of it; or refused, none of it, and why. */
export type MemberRemovalResult =
  { type: 'removed' } | { type: 'refused'; reason: MemberRemovalRefusal };

export interface MemberService {
  me(call: { userId: string }): Promise<MeResult>;
  list(call: { adminId: string }): Promise<MemberListResult>;
  remove(call: { adminId: string; memberId: string }): Promise<MemberRemovalResult>;
}

export const createMemberService: (dependencies: {
  groups: GroupStore;
  log: Log;
}) => MemberService = () => ({
  me() {
    throw new Error('not implemented (GRP-01)');
  },
  list() {
    throw new Error('not implemented (GRP-01)');
  },
  remove() {
    throw new Error('not implemented (GRP-01)');
  },
});
