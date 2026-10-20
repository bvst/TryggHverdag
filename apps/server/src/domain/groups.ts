/**
 * The group's rules (GRP-01): who gets in, and who may act as the admin.
 *
 * The invitation code's normalisation, the invitation's validity and the
 * retried join (readings 2 to 4), the seven days, the roles, and the admin's
 * rules (approach items 3, 8, 9). Pure, with no clock of its own (AR-03):
 * every time is handed in, the database's now() as the store reads it.
 *
 * GRP-01's red phase: the signatures only. Each function throws until the
 * green phase gives it its rule; the two constants hold the spec's values.
 */

/** Reading 4: an invitation is valid while now is before its creation plus seven days. ⚙️ */
export const INVITATION_VALID_FOR_MS = 604_800_000;

/** A member's role in the group (approach item 2): one ADMIN, everyone else a MEMBER. */
export const ROLES = ['ADMIN', 'MEMBER'] as const;

export type Role = (typeof ROLES)[number];

/**
 * An invitation as the join rule reads it: when it was made, by the
 * database's clock, and, once used, whether this join sends the same join
 * key and whether the user it brought in is still a member.
 */
export interface InvitationForJoin {
  createdAt: Date;
  used: { sameJoinKey: boolean; stillAMember: boolean } | null;
}

/** A join for an unused invitation, the same join retried (reading 3), or the one refusal. */
export type JoinDecision =
  { type: 'join' } | { type: 'retry' } | { type: 'refused'; reason: 'INVITATION_NOT_VALID' };

/** Why the admin's removal of a member writes nothing (GRP-01-AC16). */
export type MemberRemovalRefusal = 'NOT_THE_ADMIN' | 'MEMBER_NOT_FOUND' | 'CANNOT_REMOVE_ADMIN';

/** A member as the admin's rules read one: who, and their role. */
export interface MemberForRules {
  userId: string;
  role: Role;
}

/** The admin removes the member, or the removal is refused, and why. */
export type MemberRemovalDecision =
  { type: 'remove' } | { type: 'refused'; reason: MemberRemovalRefusal };

/**
 * The code as typed, made the code as stored: upper case, spaces and hyphens
 * dropped, O read as 0, I and L as 1; or null when it is not a code at all.
 */
export const normaliseInvitationCode: (typed: string) => string | null = () => {
  throw new Error('not implemented (GRP-01)');
};

/** Whether this invitation, as read, lets a join in at `now` (readings 2 to 4). */
export const decideJoin: (invitation: InvitationForJoin | null, now: Date) => JoinDecision = () => {
  throw new Error('not implemented (GRP-01)');
};

/** Whether this member, or nobody, may invite and list the members. */
export const mayAdminister: (member: Pick<MemberForRules, 'role'> | null) => boolean = () => {
  throw new Error('not implemented (GRP-01)');
};

/** Whether `caller` may remove `member`, who is null when no member has that ID. */
export const decideMemberRemoval: (
  caller: MemberForRules | null,
  member: MemberForRules | null,
) => MemberRemovalDecision = () => {
  throw new Error('not implemented (GRP-01)');
};
