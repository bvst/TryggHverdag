/**
 * Joining the group (GRP-01-AC2 to AC8): with an invitation, or, while no
 * group exists, as its first admin with the bootstrap code (D-136, answer 1).
 * The public route's module: it reads, asks the domain, and writes through
 * the group store, which issues the device's credential.
 *
 * GRP-01's red phase: the signatures only.
 */
import type { Role } from '../../domain/groups.ts';
import type { GroupStore, Log } from '../../ports.ts';

/** A join, as the phone sends it: the code as typed, its join key, and the name the person typed. */
export interface JoinCall {
  invitationCode: string;
  joinKey: string;
  displayName: string;
}

/** Joined, with the credential the phone keeps; or the one refusal for every invalid code. */
export type JoinServiceResult =
  | { type: 'joined'; userId: string; role: Role; credential: string }
  | { type: 'refused'; reason: 'INVITATION_NOT_VALID' };

export interface JoinService {
  join(call: JoinCall): Promise<JoinServiceResult>;
}

/** `bootstrapCode` is ADMIN_BOOTSTRAP_CODE as config.ts hands it over, normalised; null when unset or unusable. */
export const createJoinService: (dependencies: {
  groups: GroupStore;
  log: Log;
  bootstrapCode: string | null;
}) => JoinService = () => ({
  join() {
    throw new Error('not implemented (GRP-01)');
  },
});
