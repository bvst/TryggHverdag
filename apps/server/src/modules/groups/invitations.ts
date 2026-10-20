/**
 * The admin's invitation (GRP-01-AC1, AC9): a code, valid for seven days by
 * the database's clock, and nobody else's to make.
 *
 * GRP-01's red phase: the signatures only.
 */
import type { GroupStore, Log } from '../../ports.ts';

/** An invitation, as the caller asks for one: who asks. */
export interface InvitationCall {
  adminId: string;
}

/** Created, with its code shown once and when it expires; or refused to anyone but the admin. */
export type InvitationResult =
  | { type: 'created'; invitationCode: string; expiresAt: Date }
  | { type: 'refused'; reason: 'NOT_THE_ADMIN' };

export interface InvitationService {
  create(call: InvitationCall): Promise<InvitationResult>;
}

export const createInvitationService: (dependencies: {
  groups: GroupStore;
  log: Log;
}) => InvitationService = () => ({
  create() {
    throw new Error('not implemented (GRP-01)');
  },
});
