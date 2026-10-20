/**
 * The group: joining it with an invitation, who a phone is signed in as, and
 * the admin's invitations, member list and removal of a member (GRP-01,
 * D-136, D-137).
 *
 * The join is the second public route, beside health (SM-01-AC9's list, on
 * purpose): nobody holds a device credential before they join. Everything
 * else needs one.
 *
 * Every refusal is a fixed shape that carries nothing of the request, and
 * every ID in a path is a UUID, lower-cased at the edge, so a malformed one is
 * the fixed 400. No answer but the join's carries a credential, and the join's
 * carries it once.
 */
import { oc } from '@orpc/contract';
import { z } from 'zod';
import { badRequestError } from './bad-request.ts';
import { deviceRoute } from './device-credential.ts';

/** A member's role: one ADMIN, everyone else a MEMBER. */
export const ROLES = ['ADMIN', 'MEMBER'] as const;

/**
 * A code as a person may type it: 20 to 32 of Crockford's base32 characters,
 * in either case, with O, I and L read as 0, 1 and 1, and spaces or hyphens
 * anywhere between. Every letter but U, so, and digits. The server normalises
 * it to the code it stores (`normaliseInvitationCode`, in the server's
 * domain); anything this does not match is the fixed 400.
 */
export const INVITATION_CODE_PATTERN = /^[ -]*(?:[0-9A-TV-Za-tv-z][ -]*){20,32}$/;

/** A join key and a device credential alike: 32 bytes, base64url without padding, 43 characters (D-091). */
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

/** Whether a text holds a control character, C0 or C1, which the memberships table's check refuses (approach item 2). */
function holdsControlCharacter(text: string): boolean {
  return Array.from(text).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

/** The longest display name, in characters, after trimming. */
export const MAX_DISPLAY_NAME_LENGTH = 40;

const role = z.enum(ROLES).describe('ADMIN for the one admin; MEMBER for everyone else.');

const displayName = z
  .string()
  .trim()
  .min(1)
  .max(MAX_DISPLAY_NAME_LENGTH)
  .refine((name) => !holdsControlCharacter(name))
  .describe(
    'The name the person typed for themself: 1 to 40 characters once the spaces around it are ' +
      'trimmed, and no control character.',
  );

export const joinRequestSchema = z
  .strictObject({
    invitationCode: z
      .string()
      .max(100)
      .regex(INVITATION_CODE_PATTERN)
      .describe(
        'The invitation code as typed: 20 base32 characters, in any case, with spaces or ' +
          'hyphens between, O read as 0 and I or L as 1. The first admin types the bootstrap ' +
          'code here.',
      ),
    joinKey: z
      .string()
      .regex(BASE64URL_43)
      .describe(
        'A key the phone makes once, 32 random bytes as base64url, and sends again with a ' +
          'retried join, so a join whose answer was lost can be retried.',
      ),
    displayName,
  })
  .describe('A join: the code, the phone’s join key, and the name the person typed.');

export type JoinRequest = z.infer<typeof joinRequestSchema>;

export const joinResponseSchema = z
  .object({
    credential: z
      .string()
      .regex(BASE64URL_43)
      .describe(
        'This phone’s device credential, shown once: keep it in secure storage, and send it as ' +
          '`Authorization: Bearer <credential>`.',
      ),
    userId: z.uuid().describe('The member this phone is signed in as.'),
    role,
  })
  .describe('Joined: a member of the group, signed in on this phone.');

export type JoinResponse = z.infer<typeof joinResponseSchema>;

/** Every refusal a join can meet. It is public, so it has no 401. */
export const joinErrors = {
  // A body that is not JSON, or not a join: a code that is not a code, a
  // join key or a name of the wrong shape, or any other key. The one fixed
  // 400, never with `data`.
  BAD_REQUEST: badRequestError,
  // One answer for every code that lets nobody in: one that never existed,
  // used by someone else, expired, or the bootstrap code once a group exists.
  INVITATION_NOT_VALID: {
    status: 404,
    message: 'The invitation is not valid. Ask the admin for a new one.',
  },
};

export type JoinErrorCode = keyof typeof joinErrors;

export const joinGroup = oc
  .route({
    method: 'POST',
    path: '/group/members',
    successStatus: 201,
    successDescription: 'Joined.',
    summary: 'Join the group with an invitation',
    description:
      'Public: needs no device credential. Joins the group with an invitation code, or, while ' +
      'no group exists, as its first admin with the bootstrap code. The answer carries the ' +
      'device credential once, and is not cached. The same code sent again with the same join ' +
      'key, while the invitation has not expired and its member has not been removed, is the ' +
      'same join retried: the same member, and a new credential that replaces the first. A ' +
      '404, INVITATION_NOT_VALID, is the one answer for every code that lets nobody in.',
  })
  .errors(joinErrors)
  .input(joinRequestSchema)
  .output(joinResponseSchema);

export const memberSchema = z
  .object({
    userId: z.uuid().describe('The member.'),
    displayName: z.string().describe('The name the member typed when they joined.'),
    role,
  })
  .describe('A member of the group.');

export type Member = z.infer<typeof memberSchema>;

/** Every refusal "who am I" can meet besides the 401. */
export const meErrors = {
  // A device that authenticates and is no member: the staging canary's, which
  // is kept outside the group (D-128).
  NOT_A_MEMBER: {
    status: 404,
    message: 'This device belongs to no member of the group.',
  },
};

export const me = deviceRoute
  .route({
    method: 'GET',
    path: '/me',
    successStatus: 200,
    successDescription: 'The member this phone is signed in as.',
    summary: 'Who this phone is signed in as',
    description:
      'Needs a device credential. Answers the member the device belongs to: their ID, the name ' +
      'they typed and their role. A 401 means this phone is no longer signed in to the group.',
  })
  .errors(meErrors)
  .output(memberSchema);

/** Every refusal an admin's route can meet when someone else asks: they know they are not the admin. */
const notTheAdmin = {
  status: 403,
  message: 'Only the admin can do this.',
};

export const createInvitationRequestSchema = z
  .strictObject({})
  .optional()
  .describe('Nothing: an empty object, or no body at all.');

export const createInvitationResponseSchema = z
  .object({
    invitationCode: z
      .string()
      .describe('The code, shown once: 20 base32 characters in four groups of five.'),
    expiresAt: z.iso
      .datetime()
      .describe(
        'When it expires: seven days after it was made, by the database clock (REL-01), as ' +
          'RFC 3339.',
      ),
  })
  .describe('A new invitation: it brings one person in, once, before it expires.');

export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>;

export const createInvitationErrors = {
  BAD_REQUEST: badRequestError,
  NOT_THE_ADMIN: notTheAdmin,
};

export const createInvitation = deviceRoute
  .route({
    method: 'POST',
    path: '/group/invitations',
    successStatus: 201,
    successDescription: 'The invitation.',
    summary: 'Invite someone to the group',
    description:
      'Needs the admin’s device credential. Makes an invitation that brings one person in, ' +
      'once, within seven days. Only its hash is kept, so the code is shown once.',
  })
  .errors(createInvitationErrors)
  .input(createInvitationRequestSchema)
  .output(createInvitationResponseSchema);

export const listMembersResponseSchema = z
  .object({
    members: z.array(memberSchema).describe('Every member, the admin included.'),
  })
  .describe('The members of the group.');

export type ListMembersResponse = z.infer<typeof listMembersResponseSchema>;

export const listMembersErrors = {
  NOT_THE_ADMIN: notTheAdmin,
};

export const listMembers = deviceRoute
  .route({
    method: 'GET',
    path: '/group/members',
    successStatus: 200,
    successDescription: 'The members.',
    summary: 'The members of the group',
    description:
      'Needs the admin’s device credential. Lists every member: their ID, the name they typed ' +
      'and their role.',
  })
  .errors(listMembersErrors)
  .output(listMembersResponseSchema);

export const removeMemberRequestSchema = z.object({
  params: z.strictObject({
    // Lower-cased here, at the edge, as the other routes' IDs are: a UUID
    // names the same user in either case.
    userId: z.uuid().toLowerCase().describe('The member to remove.'),
  }),
});

export type RemoveMemberRequest = z.infer<typeof removeMemberRequestSchema>;

export const removedResponseSchema = z
  .object({
    outcome: z.literal('REMOVED').describe('Removed now.'),
  })
  .describe('Removed, all of it, now.');

export type RemovedResponse = z.infer<typeof removedResponseSchema>;

export const removeMemberErrors = {
  // A user ID that is not a UUID: the one fixed 400, never with `data`.
  BAD_REQUEST: badRequestError,
  NOT_THE_ADMIN: notTheAdmin,
  // One answer for a user who is no member, removed already or never one.
  MEMBER_NOT_FOUND: {
    status: 404,
    message: 'The group has no member with this ID.',
  },
  CANNOT_REMOVE_ADMIN: {
    status: 409,
    message: 'The admin cannot be removed.',
  },
};

export const removeMember = deviceRoute
  .route({
    method: 'DELETE',
    path: '/group/members/{userId}',
    inputStructure: 'detailed',
    successStatus: 200,
    successDescription: 'The member is removed.',
    summary: 'Remove a member from the group',
    description:
      'Needs the admin’s device credential. Removes the member at once, in one step: their ' +
      'phones are signed out, they are taken off every journey they follow that has not ended, ' +
      'and nothing more is sent to them. A journey of their own that has not ended runs to its ' +
      'end. A 404, MEMBER_NOT_FOUND, after a removal whose answer was lost means it is done.',
  })
  .errors(removeMemberErrors)
  .input(removeMemberRequestSchema)
  .output(removedResponseSchema);
