/**
 * "I'm on it" and "They're safe": what a responder's device sends to say it is
 * handling an alert, and to close it once the walker is known to be safe, and
 * every answer each can get (LOST-06, D-114; LOST-08, D-126).
 *
 * The alert is named in the path and nowhere else, by its ID, never as "the
 * journey's current alert", so a late or retried request can never reach a
 * later alert. Each input is detailed, as the "I'm home" route's is: `params`
 * holds the alert's ID alone, and the body is empty or absent. Any key in it,
 * an `alertId` included, is the fixed 400 (SEC-07).
 *
 * Neither takes an event ID (D-103's reading): a repeat of "I'm on it" by the
 * same responder finds itself recorded and is answered 200; anyone else's
 * finds the alert taken. A repeat of "They're safe" finds the alert over and
 * is answered 409, as "I'm home"'s repeat is: a 200 and a 409 both mean it is
 * over.
 *
 * Every answer is a fixed shape, and none carries anything of the request or
 * says who is on the alert or who closed it.
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

export const closureRequestSchema = z.object({
  params: z.strictObject({
    // Lower-cased here, at the edge, as the other routes' IDs are: a UUID
    // names the same alert in either case.
    alertId: z.uuid().toLowerCase().describe('The alert to close.'),
  }),
  body: z.strictObject({}).optional().describe('Nothing: an empty object, or no body at all.'),
});

export type ClosureRequest = z.infer<typeof closureRequestSchema>;

export const closureResponseSchema = z
  .object({
    outcome: z.literal('CLOSED').describe('The alert is closed, and its journey has ended.'),
  })
  .describe('Closed now: the walker is safe, and the other responders are told.');

export type ClosureResponse = z.infer<typeof closureResponseSchema>;

/** Every refusal "They're safe" can meet besides the 401, by its code. */
export const closureErrors = {
  // An alert ID that is not a UUID, or a body holding any key: the one fixed
  // 400 every route declares, never with `data`.
  BAD_REQUEST: badRequestError,
  // A responder of the alert's journey who is not the one on it: they follow
  // the journey, so the alert's existence is theirs to know. Who is on it, it
  // does not say.
  NOT_THE_ACKNOWLEDGER: {
    status: 403,
    message: 'Only the responder on this alert can close it.',
  },
  // One answer for an alert that does not exist and for an alert of a journey
  // the caller does not follow, the walker's own included, so it says
  // nothing about alerts the caller does not follow.
  ALERT_NOT_FOUND: {
    status: 404,
    message: 'The caller follows no alert with this ID.',
  },
  // Whatever resolved it, a close included.
  ALERT_RESOLVED: {
    status: 409,
    message: 'The alert is over.',
  },
};

export type ClosureErrorCode = keyof typeof closureErrors;

export const closeAlert = deviceRoute
  .route({
    method: 'POST',
    path: '/alerts/{alertId}/closure',
    inputStructure: 'detailed',
    successStatus: 200,
    successDescription: 'The alert is closed.',
    summary: 'Say "They’re safe"',
    description:
      'Needs a device credential. Closes the alert named in the path once the walker is known ' +
      'to be safe; only the responder on the alert may close it. The body is empty, or absent. ' +
      'A 200, CLOSED, means the alert is resolved and the journey has ended, and the other ' +
      'responders are told. A 403, NOT_THE_ACKNOWLEDGER, means the caller is not the one on ' +
      'it; a 409, ALERT_RESOLVED, means the alert is over.',
  })
  .errors(closureErrors)
  .input(closureRequestSchema)
  .output(closureResponseSchema);
