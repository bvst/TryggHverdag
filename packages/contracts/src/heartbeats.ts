/**
 * A heartbeat: what a device sends during a journey, and every answer it can
 * get (LOST-01).
 *
 * The phone sends one at least every ⚙️ 60 seconds: the journey it belongs to,
 * an event ID, the battery level or "unknown", and a position or none. The
 * server stores it once (SM-08), timed by the database clock (SM-09, REL-01),
 * and a heartbeat without a position keeps the journey in contact exactly as
 * one with a position does (SM-03).
 *
 * The journey is named in the body, never in the path: the location SDK posts
 * to one URL, and a record queued during one journey and sent after the next
 * one started must still count for the journey it was made in. So no value of
 * a heartbeat is ever in a URL or a header, where access logs would see it.
 *
 * SEC-07: the server validates what it receives. A heartbeat holds four fields
 * and nothing else. Anything more is refused rather than ignored: the status
 * fields the SDK can send (`moving`, the queue, the permission) are
 * behavioural data no rule here needs, and a field dropped quietly today is
 * one a later version reads.
 *
 * Every answer is a fixed shape, and none carries a key or a value from the
 * request: the SDK can run commands that arrive in its own HTTP response body,
 * so nothing a request held may ever come back (04b-spike-results.md §4.5).
 */
import { z } from 'zod';
import { badRequestError } from './bad-request.ts';
import { deviceRoute } from './device-credential.ts';

/** The longest event ID: the spike receiver's bound, which every SDK record in 40 runs met. */
export const MAX_EVENT_ID_LENGTH = 64;

/**
 * The characters of an event ID: letters, digits and `-`, compared exactly,
 * case and all. No `.` and no `_`, so neither a coordinate nor the text
 * `background_geolocation` can travel as an event ID.
 */
export const EVENT_ID_PATTERN = /^[A-Za-z0-9-]+$/;

export const heartbeatPositionSchema = z
  .strictObject({
    // zod 4's numbers are finite: NaN and ±Infinity are refused by z.number().
    latitude: z.number().min(-90).max(90).describe('Degrees, from -90 to 90.'),
    longitude: z.number().min(-180).max(180).describe('Degrees, from -180 to 180.'),
    accuracyMeters: z.number().min(0).describe('The position’s accuracy in metres, 0 or more.'),
    // The years are the instant's in UTC, not as written: the server hands
    // PostgreSQL the UTC instant, and `timestamptz` has no year 0 and no year
    // 10000. Refused here as a 400, such a time cannot reach the database as
    // a 500 the phone would resend for ever. Within the years, no bound: a
    // bound on the phone's clock would be a decision made on it (REL-01).
    recordedAt: z.iso
      .datetime({ offset: true })
      .refine(
        (text) => {
          const year = new Date(text).getUTCFullYear();
          return year >= 1 && year <= 9999;
        },
        { message: 'The time is outside the years 0001 to 9999 in UTC.' },
      )
      .describe(
        'When the phone recorded the position, by the phone’s clock, as RFC 3339 with an ' +
          'offset, whose instant in UTC falls in the years 0001 to 9999. Within those years, ' +
          'any time is accepted, however far from the server’s clock: it labels the position ' +
          'and decides nothing (REL-01).',
      ),
  })
  .describe('Where the phone was, as the phone recorded it.');

export const heartbeatRequestSchema = z
  .strictObject({
    // Lower-cased here, at the edge, as the start route's responder IDs are:
    // a UUID names the same journey in either case.
    journeyId: z.uuid().toLowerCase().describe('The journey this heartbeat belongs to.'),
    eventId: z
      .string()
      .min(1)
      .max(MAX_EVENT_ID_LENGTH)
      .regex(EVENT_ID_PATTERN)
      .describe(
        'The heartbeat’s own ID, unique within its journey. Sent again, it changes nothing ' +
          'and is answered DUPLICATE (SM-08).',
      ),
    batteryLevel: z
      .number()
      .min(0)
      .max(1)
      .nullable()
      .describe('The battery level from 0 to 1, or null when the phone does not know it.'),
    position: heartbeatPositionSchema
      .nullable()
      .describe('The position, or null when the phone has none (SM-03).'),
  })
  .describe(
    'A heartbeat. The walker is the user whose device sends it, and the device must be the one ' +
      'that started the journey; no field names either.',
  );

export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;

export const heartbeatResponseSchema = z
  .object({
    outcome: z
      .enum(['RECORDED', 'DUPLICATE'])
      .describe(
        'RECORDED when the heartbeat was stored now; DUPLICATE when its journey already had ' +
          'its event ID, so nothing changed.',
      ),
  })
  .describe('The server has the heartbeat, so the phone may drop it.');

export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;

/** Every refusal a heartbeat can meet besides the 401, by its code. */
export const heartbeatErrors = {
  // A body that is not JSON, or not a heartbeat: the one fixed 400 every
  // route with a body declares, the start route's too, and never a `data`
  // holding the validator's issues: those name the keys and values the
  // request held.
  BAD_REQUEST: badRequestError,
  NOT_THE_JOURNEYS_DEVICE: {
    status: 403,
    message: 'Only the device that started this journey can send its heartbeats.',
  },
  // One answer for a journey that does not exist and for another walker's,
  // so it says nothing about other walkers.
  JOURNEY_NOT_FOUND: {
    status: 404,
    message: 'The walker has no journey with this ID.',
  },
  JOURNEY_ENDED: {
    status: 409,
    message: 'The journey has ended, so the heartbeat was not stored. Stop sending them.',
  },
};

export type HeartbeatErrorCode = keyof typeof heartbeatErrors;

export const recordHeartbeat = deviceRoute
  .route({
    method: 'POST',
    path: '/heartbeats',
    successStatus: 200,
    successDescription: 'The server has the heartbeat, so the phone may drop it.',
    summary: 'Send a heartbeat',
    description:
      'Needs a device credential. Answers only for the device user’s own journeys, and only ' +
      'from the device that started the journey. A 200, RECORDED or DUPLICATE, means the ' +
      'server has the event, so the phone may drop it. A 409 means the journey has ended: ' +
      'stop sending.',
  })
  .errors(heartbeatErrors)
  .input(heartbeatRequestSchema)
  .output(heartbeatResponseSchema);
