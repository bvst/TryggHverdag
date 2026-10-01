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
import { deviceRoute } from './device-credential.ts';

/**
 * The most responders one start may name. A fixed bound on what one request
 * can ask the server to check: the group is at least 12 people, and the cost
 * plan reckons with 12 to 20 (D-009).
 */
export const MAX_RESPONDERS = 50;

export const startJourneyRequestSchema = z
  .strictObject({
    responderIds: z
      .array(z.uuid())
      .max(MAX_RESPONDERS)
      .describe(
        'The users who should follow this journey. Each must be an existing user other than ' +
          'the walker; a repeated ID counts once. An empty list is accepted here and refused ' +
          'as NO_RESPONDER.',
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
  // Raised by oRPC itself when the body fails the request schema, in its own
  // words; declared here so the description lists it.
  BAD_REQUEST: {
    status: 400,
    message: 'Input validation failed',
  },
  ALREADY_ON_A_JOURNEY: {
    status: 409,
    message: 'The walker already has a journey that has not ended.',
    data: z.object({
      journeyId: z.uuid().describe('The walker’s own unended journey.'),
    }),
  },
  INVALID_RESPONDER: {
    status: 422,
    message: 'A responder named is the walker, or is not a user.',
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
