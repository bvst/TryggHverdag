/**
 * Starting a journey: what a device sends, and every answer it can get.
 *
 * SM-01: a walker has at most one unended journey. A second start is refused
 * with the ID of the journey the walker already has, so an app whose first
 * answer was lost can adopt that journey rather than leave one running that it
 * knows nothing about.
 *
 * SM-02, its start rule: a journey needs at least one responder to start.
 *
 * SEC-07: the server validates what it receives. The body holds exactly the
 * responder list; anything else, a walker's ID included, is refused rather
 * than ignored. The walker is always the user whose device sent the request.
 */
import { z } from 'zod';
import { badRequestError } from './bad-request.ts';
import { deviceRoute } from './device-credential.ts';

/**
 * The most responders one start may name. A fixed bound on what one request
 * can ask the server to check: the group is at least 12 people, and the cost
 * plan reckons with 12 to 20 (D-009).
 */
export const MAX_RESPONDERS = 50;

export const startJourneyRequestSchema = z
  .strictObject({
    // Lower-cased here, at the edge. A UUID names the same user in either
    // case, the database hands IDs back lower-case, and the start rule
    // compares IDs as strings: without this, a real user named in upper case
    // would be refused as INVALID_RESPONDER.
    responderIds: z
      .array(z.uuid().toLowerCase())
      .max(MAX_RESPONDERS)
      .describe(
        "The users who should follow this journey. Each must be a member of the walker's group " +
          'other than the walker; a repeated ID counts once. An empty list is accepted here and ' +
          'refused as NO_RESPONDER.',
      ),
  })
  .describe('A start request. The walker is the user whose device sends it; no field names one.');

export type StartJourneyRequest = z.infer<typeof startJourneyRequestSchema>;

export const startJourneyResponseSchema = z
  .object({
    journeyId: z.uuid().describe('The new journey.'),
    state: z.literal('ACTIVE').describe('A journey starts ACTIVE.'),
    startedAt: z.iso
      .datetime()
      .describe('When the journey started, from the database clock (REL-01), as RFC 3339.'),
  })
  .describe('The journey that started.');

export type StartJourneyResponse = z.infer<typeof startJourneyResponseSchema>;

/** Every refusal a start can meet besides the 401, by its code. */
export const startJourneyErrors = {
  // A body that is not JSON, or not a start request: the one fixed 400 every
  // route with a body declares, never with `data`.
  BAD_REQUEST: badRequestError,
  ALREADY_ON_A_JOURNEY: {
    status: 409,
    message: 'The walker already has a journey that has not ended.',
    data: z.object({
      journeyId: z.uuid().describe('The walker’s own unended journey.'),
    }),
  },
  INVALID_RESPONDER: {
    status: 422,
    message: "A responder named is the walker, or is not a member of the walker's group.",
  },
  NO_RESPONDER: {
    status: 422,
    message: 'A journey needs at least one responder to start.',
  },
};

export type StartJourneyErrorCode = keyof typeof startJourneyErrors;

export const startJourney = deviceRoute
  .route({
    method: 'POST',
    path: '/journeys',
    successStatus: 201,
    successDescription: 'The journey started.',
    summary: 'Start a journey',
    description:
      'Needs a device credential: the walker is the user whose device sends it. A walker can ' +
      'have only one unended journey, so a second start is refused with 409 and the ID of the ' +
      'journey already running.',
  })
  .errors(startJourneyErrors)
  .input(startJourneyRequestSchema)
  .output(startJourneyResponseSchema);

/**
 * The walker removes a responder from their journey (SM-10, D-122's route;
 * GRP-01, approach item 10, D-137). The journey and the responder are named
 * in the path and nowhere else, each a UUID lower-cased at the edge.
 *
 * Only the journey's walker may, from any of their devices. Anyone else gets
 * JOURNEY_NOT_FOUND, whatever the journey's state and whoever follows it: the
 * one answer for a caller who may not tell the three refusals apart, and no
 * 403, which would say the journey exists. A removed responder stays a member
 * of the group.
 */
export const removeResponderRequestSchema = z.object({
  params: z.strictObject({
    journeyId: z.uuid().toLowerCase().describe('The walker’s journey.'),
    responderId: z.uuid().toLowerCase().describe('The responder to remove from it.'),
  }),
});

export type RemoveResponderRequest = z.infer<typeof removeResponderRequestSchema>;

export const removeResponderResponseSchema = z
  .object({
    outcome: z.literal('REMOVED').describe('Removed now.'),
  })
  .describe('Removed: they follow the journey no more, and nothing more is sent to them about it.');

export type RemoveResponderResponse = z.infer<typeof removeResponderResponseSchema>;

/** Every refusal the removal can meet besides the 401, by its code. */
export const removeResponderErrors = {
  // A journey or user ID that is not a UUID: the one fixed 400, never with
  // `data`.
  BAD_REQUEST: badRequestError,
  // One answer for a journey that does not exist and for any journey whose
  // walker the caller is not, so it says nothing about other walkers'.
  JOURNEY_NOT_FOUND: {
    status: 404,
    message: 'The walker has no journey with this ID.',
  },
  NOT_A_RESPONDER: {
    status: 409,
    message: 'The user named is not a responder of this journey.',
  },
  JOURNEY_ENDED: {
    status: 409,
    message: 'The journey has already ended.',
  },
};

export type RemoveResponderErrorCode = keyof typeof removeResponderErrors;

export const removeResponder = deviceRoute
  .route({
    method: 'DELETE',
    path: '/journeys/{journeyId}/responders/{responderId}',
    inputStructure: 'detailed',
    successStatus: 200,
    successDescription: 'The responder is removed.',
    summary: 'Remove a responder from a journey',
    description:
      'Needs the walker’s device credential. Removes the responder named in the path from the ' +
      'walker’s journey named in the path: anything not yet sent to them about it is withdrawn, ' +
      'an alert they were on goes back to unacknowledged, and when none is left the walker is ' +
      'warned. A 409, NOT_A_RESPONDER, after a removal whose answer was lost means it is done.',
  })
  .errors(removeResponderErrors)
  .input(removeResponderRequestSchema)
  .output(removeResponderResponseSchema);
