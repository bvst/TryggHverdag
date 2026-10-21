/**
 * The group's rules (GRP-01): who gets in, and who may act as the admin.
 *
 * The invitation code's normalisation, the invitation's validity and the
 * retried join (readings 2 to 4), the seven days, the roles, and the admin's
 * rules (approach items 3, 8, 9). Pure, with no clock of its own (AR-03):
 * every time is handed in, the database's now() as the store reads it.
 */

/** Reading 4: an invitation is valid while now is before its creation plus seven days. ⚙️ */
export const INVITATION_VALID_FOR_MS = 604_800_000;

/** A member's role in the group (approach item 2): one ADMIN, everyone else a MEMBER. */
export const ROLES = ['ADMIN', 'MEMBER'] as const;

export type Role = (typeof ROLES)[number];

/**
 * Crockford's base32 alphabet (approach item 3): the digits, then the
 * letters without I, L, O and U, so no two characters look alike. An
 * invitation code is INVITATION_CODE_LENGTH of these, each 5 random bits.
 */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** An invitation code's length: 20 characters, 100 bits (approach item 3). */
export const INVITATION_CODE_LENGTH = 20;

/**
 * What a person may type for a code before it is normalised: ASCII letters
 * and digits, with spaces and hyphens between them. Anything else, a tab or
 * a letter outside ASCII included, is not a code: upper-casing such a letter
 * could turn it into one of the alphabet's.
 */
const TYPED_CODE = /^[0-9A-Za-z -]*$/;

/**
 * A code as the store keeps and hashes it: 20 to 32 of the alphabet's
 * characters, upper case, nothing between. An invitation's is 20; the first
 * admin's bootstrap code, 16 bytes as hex, is 32 (approach item 8).
 */
const WELL_FORMED_CODE = /^[0-9A-HJKMNP-TV-Z]{20,32}$/;

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
 * Never throws, whatever it is handed (GRP-01-AC2).
 */
export function normaliseInvitationCode(typed: string): string | null {
  if (!TYPED_CODE.test(typed)) {
    return null;
  }
  const code = typed.replace(/[ -]/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
  return WELL_FORMED_CODE.test(code) ? code : null;
}

/** The one refusal, for every invitation that does not let this join in (reading 2). */
const NOT_VALID: JoinDecision = { type: 'refused', reason: 'INVITATION_NOT_VALID' };

/**
 * Whether this invitation, as read, lets a join in at `now` (readings 2 to 4):
 *   1. no invitation at all is the one refusal;
 *   2. from its creation plus seven days on, expired, whatever else holds:
 *      exactly at seven days it is expired;
 *   3. unused, a join;
 *   4. used, the same join retried when it sends the same join key and the
 *      user it brought in is still a member (F2); anything else the one
 *      refusal.
 */
export function decideJoin(invitation: InvitationForJoin | null, now: Date): JoinDecision {
  if (invitation === null) {
    return NOT_VALID;
  }
  if (now.getTime() >= invitation.createdAt.getTime() + INVITATION_VALID_FOR_MS) {
    return NOT_VALID;
  }
  const { used } = invitation;
  if (used === null) {
    return { type: 'join' };
  }
  return used.sameJoinKey && used.stillAMember ? { type: 'retry' } : NOT_VALID;
}

/** Whether this member, or nobody, may invite and list the members: the admin alone. */
export function mayAdminister(member: Pick<MemberForRules, 'role'> | null): boolean {
  return member?.role === 'ADMIN';
}

/**
 * Whether `caller` may remove `member`, who is null when no member has that
 * ID (approach item 9), in this order:
 *   1. anyone but the admin is NOT_THE_ADMIN, whoever they name, so a member
 *      learns nothing of who else is one;
 *   2. nobody by that ID is MEMBER_NOT_FOUND;
 *   3. the admin, themself or any other, is CANNOT_REMOVE_ADMIN: the group
 *      keeps its one admin;
 *   4. otherwise the member is removed.
 */
export function decideMemberRemoval(
  caller: MemberForRules | null,
  member: MemberForRules | null,
): MemberRemovalDecision {
  if (caller === null || !mayAdminister(caller)) {
    return { type: 'refused', reason: 'NOT_THE_ADMIN' };
  }
  if (member === null) {
    return { type: 'refused', reason: 'MEMBER_NOT_FOUND' };
  }
  if (member.userId === caller.userId || member.role === 'ADMIN') {
    return { type: 'refused', reason: 'CANNOT_REMOVE_ADMIN' };
  }
  return { type: 'remove' };
}
