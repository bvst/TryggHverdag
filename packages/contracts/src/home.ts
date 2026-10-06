/**
 * "I'm home": what a device sends to end its journey, and every answer it can
 * get (SM-04, D-110).
 *
 * The journey is named in the path and nowhere else. The input is detailed,
 * not compact: oRPC's compact input merges the path's parameters with the
 * body, and the body wins, so a body naming another journey would override
 * the path. Detailed, the path's parameters and the body are validated
 * apart: `params` holds the journey's ID alone, and the body is empty or
 * absent. Any key in it, a `journeyId` included, is the fixed 400 (SEC-07).
 *
 * It takes no event ID (D-103's reading): a repeat finds the journey ended,
 * is answered 409, and changes nothing. Only the device that started the
 * journey may end it (D-101's reasoning: ending a journey stops all
 * protection).
 *
 * Every answer is a fixed shape, and none carries anything of the request.
 */
import { z } from 'zod';
import { badRequestError } from './bad-request.ts';
import { deviceRoute } from './device-credential.ts';

export const homeRequestSchema = z.object({
  params: z.strictObject({
    // Lower-cased here, at the edge, as the other routes' IDs are: a UUID
    // names the same journey in either case.
    journeyId: z.uuid().toLowerCase().describe('The journey to end.'),
  }),
  body: z.strictObject({}).optional().describe('Nothing: an empty object, or no body at all.'),
});

export type HomeRequest = z.infer<typeof homeRequestSchema>;

export const homeResponseSchema = z
  .object({
    outcome: z.literal('ENDED').describe('The journey ended now.'),
  })
  .describe('The journey is over, so the phone may stop tracking it.');

export type HomeResponse = z.infer<typeof homeResponseSchema>;

/** Every refusal "I'm home" can meet besides the 401, by its code. */
export const homeErrors = {
  // A journey ID that is not a UUID, or a body holding any key: the one fixed
  // 400 every route declares, never with `data`.
  BAD_REQUEST: badRequestError,
  NOT_THE_JOURNEYS_DEVICE: {
    status: 403,
    message: 'Only the device that started this journey can end it.',
  },
  // One answer for a journey that does not exist and for another walker's,
  // so it says nothing about other walkers.
  JOURNEY_NOT_FOUND: {
    status: 404,
    message: 'The walker has no journey with this ID.',
  },
  // Whatever ended it, a repeat "I'm home" whose first answer was lost
  // included (D-112).
  JOURNEY_ENDED: {
    status: 409,
    message: 'The journey has already ended.',
  },
};

export type HomeErrorCode = keyof typeof homeErrors;

export const reportHome = deviceRoute
  .route({
    method: 'POST',
    path: '/journeys/{journeyId}/home',
    inputStructure: 'detailed',
    successStatus: 200,
    successDescription: 'The journey ended now.',
    summary: 'Say "I’m home"',
    description:
      'Needs a device credential. Ends the journey named in the path; only the device that ' +
      'started the journey may end it. The body is empty, or absent. A 200, ENDED, and a 409, ' +
      'JOURNEY_ENDED, both mean the journey is over: stop tracking it and drop anything queued ' +
      'for it.',
  })
  .errors(homeErrors)
  .input(homeRequestSchema)
  .output(homeResponseSchema);
