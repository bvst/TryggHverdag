/**
 * The admin's invitation (GRP-01-AC1, AC9): a code, valid for seven days by
 * the database's clock, and nobody else's to make.
 *
 * The store asks the domain whether the caller is the admin, and makes the
 * code, its hash, its expiry and its audit row in one transaction. This
 * module shows the code once, as a person reads it: four groups of five,
 * hyphens between. It reads no clock (AR-03).
 *
 * The log takes closed events only (PRIV-07): one line naming the stage and
 * the SQLSTATE when the store fails. A refusal writes no line, and no line
 * holds the code or anyone's ID.
 */
import { sqlstateOf } from '../../domain/sqlstate.ts';
import type { CreateInvitationResult, GroupStore, Log } from '../../ports.ts';

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

/** How many characters a group of a shown code holds. */
const GROUP_OF = 5;

/** The code as the admin's app shows it: in groups of five, hyphens between. */
function shown(code: string): string {
  const groups: string[] = [];
  for (let at = 0; at < code.length; at += GROUP_OF) {
    groups.push(code.slice(at, at + GROUP_OF));
  }
  return groups.join('-');
}

export function createInvitationService({
  groups,
  log,
}: {
  groups: GroupStore;
  log: Log;
}): InvitationService {
  return {
    async create({ adminId }: InvitationCall): Promise<InvitationResult> {
      let result: CreateInvitationResult;
      try {
        result = await groups.createInvitation({ adminId });
      } catch (error) {
        log.write({ event: 'invitation_failed', stage: 'store', code: sqlstateOf(error) });
        throw error;
      }
      if (result.outcome === 'not_the_admin') {
        return { type: 'refused', reason: 'NOT_THE_ADMIN' };
      }
      return {
        type: 'created',
        invitationCode: shown(result.invitationCode),
        expiresAt: result.expiresAt,
      };
    },
  };
}
