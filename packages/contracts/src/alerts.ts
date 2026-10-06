/**
 * "I'm on it": what a responder's device sends to say it is handling an
 * alert, and every answer it can get (LOST-06, D-114).
 *
 * The alert is named in the path and nowhere else, by its ID, never as "the
 * journey's current alert", so a late or retried acknowledgement can never
 * reach a later alert. The input is detailed, as the "I'm home" route's is:
 * `params` holds the alert's ID alone, and the body is empty or absent. Any
 * key in it, an `alertId` included, is the fixed 400 (SEC-07).
 *
 * It takes no event ID (D-103's reading): a repeat by the same responder finds
 * itself recorded and is answered 200; anyone else's finds the alert taken.
 *
 * Every answer is a fixed shape, and none carries anything of the request or
 * says who is on it.
 */
import { z } from 'zod';
import { badRequestError } from './bad-request.ts';
import { deviceRoute } from './device-credential.ts';

export const acknowledgementRequestSchema = z.object({
  params: z.strictObject({
    // Lower-cased here, at the edge, as the other routes' IDs are: a UUID
    // names the same alert in either case.
    alertId: z.uuid().toLowerCase().describe('The alert to acknowledge.'),
  }),
  body: z.strictObject({}).optional().describe('Nothing: an empty object, or no body at all.'),
});

export type AcknowledgementRequest = z.infer<typeof acknowledgementRequestSchema>;

export const acknowledgementResponseSchema = z
  .object({
    outcome: z.literal('ACKNOWLEDGED').describe('The caller is the one on this alert.'),
  })
  .describe('The caller is on it: recorded now, or already theirs.');

export type AcknowledgementResponse = z.infer<typeof acknowledgementResponseSchema>;

/** Every refusal "I'm on it" can meet besides the 401, by its code. */
export const acknowledgementErrors = {
  // An alert ID that is not a UUID, or a body holding any key: the one fixed
  // 400 every route declares, never with `data`.
  BAD_REQUEST: badRequestError,
  // One answer for an alert that does not exist and for an alert of a journey
  // the caller does not follow, the walker's own included, so it says
  // nothing about alerts the caller does not follow.
  ALERT_NOT_FOUND: {
    status: 404,
    message: 'The caller follows no alert with this ID.',
  },
  // One responder is on an alert. Who, it does not say.
  ALREADY_ACKNOWLEDGED: {
    status: 409,
    message: 'Another responder is already on this alert.',
  },
  // Whatever resolved it.
  ALERT_RESOLVED: {
    status: 409,
    message: 'The alert is over.',
  },
};

export type AcknowledgementErrorCode = keyof typeof acknowledgementErrors;

export const acknowledgeAlert = deviceRoute
  .route({
    method: 'POST',
    path: '/alerts/{alertId}/acknowledgement',
    inputStructure: 'detailed',
    successStatus: 200,
    successDescription: 'The caller is on it.',
    summary: 'Say "I’m on it"',
    description:
      'Needs a device credential. Says "I’m on it" for the alert named in the path; only a ' +
      'responder of the alert’s journey may acknowledge it. The body is empty, or absent. A ' +
      '200, ACKNOWLEDGED, means the caller is the one on it, recorded now or already. A 409, ' +
      'ALREADY_ACKNOWLEDGED, means another responder is on it; a 409, ALERT_RESOLVED, means ' +
      'the alert is over.',
  })
  .errors(acknowledgementErrors)
  .input(acknowledgementRequestSchema)
  .output(acknowledgementResponseSchema);
