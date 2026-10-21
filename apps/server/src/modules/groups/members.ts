/**
 * The members (GRP-01-AC3, AC9, AC16 to AC21): who a phone is signed in as,
 * the admin's list, and the admin's removal of a member, at once and in one
 * transaction.
 *
 * Thin, as every module: the store reads, asks the domain's admin rules
 * (`domain/groups.ts`) and writes. The removal is the store's one
 * transaction: the membership, the member's place on every unended journey
 * they follow, through SM-10's own step, and the audit row, all or none of
 * it (approach item 9). It reads no clock (AR-03).
 *
 * The log takes closed events only (PRIV-07): one line naming the stage and
 * the SQLSTATE when the removal's store fails. A refusal writes no line, and
 * no line holds a name or anyone's ID.
 */
import { mayAdminister, type MemberRemovalRefusal } from '../../domain/groups.ts';
import { sqlstateOf } from '../../domain/sqlstate.ts';
import type { GroupStore, Log, MemberAsRead, RemoveMemberResult } from '../../ports.ts';

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

export function createMemberService({
  groups,
  log,
}: {
  groups: GroupStore;
  log: Log;
}): MemberService {
  return {
    async me({ userId }: { userId: string }): Promise<MeResult> {
      const member = await groups.memberOf(userId);
      return member === null ? { type: 'not_a_member' } : { type: 'member', member };
    },

    async list({ adminId }: { adminId: string }): Promise<MemberListResult> {
      if (!mayAdminister(await groups.memberOf(adminId))) {
        return { type: 'refused', reason: 'NOT_THE_ADMIN' };
      }
      return { type: 'listed', members: await groups.members() };
    },

    async remove({
      adminId,
      memberId,
    }: {
      adminId: string;
      memberId: string;
    }): Promise<MemberRemovalResult> {
      let result: RemoveMemberResult;
      try {
        result = await groups.removeMember({ adminId, memberId });
      } catch (error) {
        log.write({ event: 'member_removal_failed', stage: 'store', code: sqlstateOf(error) });
        throw error;
      }
      return result.outcome === 'removed'
        ? { type: 'removed' }
        : { type: 'refused', reason: result.reason };
    },
  };
}
