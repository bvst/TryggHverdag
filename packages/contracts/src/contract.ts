/**
 * Every route the server serves, in one object. Kept apart from index.ts so
 * that the OpenAPI generator can read it without importing the package's own
 * entry point — see the note in index.ts.
 */
import { acknowledgeAlert, closeAlert } from './alerts.ts';
import { createInvitation, joinGroup, listMembers, me, removeMember } from './groups.ts';
import { health } from './health.ts';
import { recordHeartbeat } from './heartbeats.ts';
import { reportHome } from './home.ts';
import { removeResponder, startJourney } from './journeys.ts';

export const contract = {
  health,
  startJourney,
  recordHeartbeat,
  reportHome,
  acknowledgeAlert,
  closeAlert,
  // GRP-01 (approach item 12): the join, public; who a phone is signed in as;
  // the admin's invitation, member list and removal of a member; and the
  // walker's removal of a responder (D-122's route).
  joinGroup,
  me,
  createInvitation,
  listMembers,
  removeMember,
  removeResponder,
};
