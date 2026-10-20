/**
 * Joining the group (GRP-01-AC2 to AC8): with an invitation, or, while no
 * group exists, as its first admin with the bootstrap code (D-136, answer 1).
 * The public route's module: it reads, asks the domain, and writes through
 * the group store, which issues the device's credential.
 *
 * The code is normalised here, by the domain's rule, as a person types it:
 * case, spaces and hyphens, O for 0, I and L for 1. The bootstrap code, as
 * config.ts hands it over, normalised the same way, opens only an empty
 * group: the store's one-group index decides, and once a group exists it is
 * the one refusal, as any code that lets nobody in is (reading 2). With no
 * usable bootstrap code, every code is tried as an invitation.
 *
 * The module reads no clock: the store decides an invitation at the
 * database's now() (AR-03, REL-01).
 *
 * The log takes closed events only (PRIV-07, approach item 13): one line
 * naming the stage and the SQLSTATE when the store fails, and nothing else.
 * A refusal is the caller's answer and writes no line. No line holds a code,
 * a join key, a credential, a name or a user's ID.
 */
import { normaliseInvitationCode, type Role } from '../../domain/groups.ts';
import { sqlstateOf } from '../../domain/sqlstate.ts';
import type { GroupStore, JoinResult, Log } from '../../ports.ts';

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

const NOT_VALID: JoinServiceResult = { type: 'refused', reason: 'INVITATION_NOT_VALID' };

/** `bootstrapCode` is ADMIN_BOOTSTRAP_CODE as config.ts hands it over, normalised; null when unset or unusable. */
export function createJoinService({
  groups,
  log,
  bootstrapCode,
}: {
  groups: GroupStore;
  log: Log;
  bootstrapCode: string | null;
}): JoinService {
  return {
    async join({ invitationCode, joinKey, displayName }: JoinCall): Promise<JoinServiceResult> {
      const code = normaliseInvitationCode(invitationCode);
      // The contract lets only codes through; a code the rule refuses all the
      // same lets nobody in.
      if (code === null) {
        return NOT_VALID;
      }
      let result: JoinResult;
      try {
        result =
          bootstrapCode !== null && code === bootstrapCode
            ? await groups.bootstrapGroup({ displayName })
            : await groups.joinWithInvitation({ invitationCode: code, joinKey, displayName });
      } catch (error) {
        log.write({ event: 'join_failed', stage: 'store', code: sqlstateOf(error) });
        throw error;
      }
      if (result.outcome === 'not_valid') {
        return NOT_VALID;
      }
      const { userId, role, credential } = result;
      return { type: 'joined', userId, role, credential };
    },
  };
}
