// L2 contract: what a heartbeat request may hold, and what it is answered.
//
// SEC-07's second half for the heartbeat: the server validates what it
// receives. A heartbeat holds four fields and nothing else: the journey, an
// event ID, the battery level or null, and a position or null. Anything more
// is refused rather than ignored: a field quietly dropped today is one a
// later version reads, and the status fields the location SDK can send
// (`moving`, the queue, the permission) are behavioural data no rule here
// needs (LOST-01's spec, approach item 3).
//
// The event ID is the spike receiver's RECORD_ID: letters, digits and `-`, at
// most 64. It has no `.` and no `_`, so neither a coordinate nor the text
// `background_geolocation` can travel in it.
//
// The phone's time is accepted however far it is from the database clock:
// refusing a wrong phone clock would be a decision made on the phone's clock
// (REL-01), and would wedge the phone's queue.
//
// This package may not depend on the test kit (it depends on nothing of
// ours), so the synthetic values are made here, by the same rules as the
// kit's: positions inside 1° of 0° 0′, open sea, seven decimals, generated at
// run time (RG-07). IDs come from node:crypto.
import { randomInt, randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  EVENT_ID_PATTERN,
  MAX_EVENT_ID_LENGTH,
  heartbeatErrors,
  heartbeatRequestSchema,
  heartbeatResponseSchema,
  type HeartbeatErrorCode,
  type HeartbeatRequest,
  type HeartbeatResponse,
} from './index.ts';

/** A coordinate inside 1° of 0° 0′, open sea, with seven non-zero decimals. */
function coordinate(): number {
  const decimals = Array.from({ length: 7 }, () => String(randomInt(1, 10))).join('');
  return Number(`${randomInt(0, 2) === 0 ? '' : '-'}0.${decimals}`);
}

function position() {
  return {
    latitude: coordinate(),
    longitude: coordinate(),
    accuracyMeters: (2 * randomInt(8, 400) + 1) / 8,
    recordedAt: '2026-10-01T21:41:07.312Z',
  };
}

/** A heartbeat the schema must accept: every field, a position included. */
function heartbeat() {
  return {
    journeyId: randomUUID(),
    eventId: `synthetic-event-${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    batteryLevel: (2 * randomInt(0, 32) + 1) / 64,
    position: position(),
  };
}

type Body = ReturnType<typeof heartbeat>;
type Position = Body['position'];

/** The body without one of its fields. */
function without<T extends object>(body: T, field: keyof T): Omit<T, typeof field> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => key !== field)) as Omit<
    T,
    typeof field
  >;
}

/** The body with its position changed. */
function withPosition(body: Body, change: (position: Position) => unknown): unknown {
  return { ...body, position: change(body.position) };
}

function accepts(body: unknown): boolean {
  return heartbeatRequestSchema.safeParse(body).success;
}

describe('SEC-07: the heartbeat request holds four fields, each checked', () => {
  test('LOST-01-AC11: MAX_EVENT_ID_LENGTH is 64, the spike receiver’s bound', () => {
    expect(MAX_EVENT_ID_LENGTH).toBe(64);
  });

  test('LOST-01-AC11: EVENT_ID_PATTERN admits letters, digits and -, and nothing else', () => {
    // A RegExp or its source; either way it reads the same here. Checked
    // first: `new RegExp(undefined)` matches everything.
    expect(EVENT_ID_PATTERN, 'EVENT_ID_PATTERN is exported').toBeDefined();
    const pattern = new RegExp(EVENT_ID_PATTERN);

    for (const eventId of ['synthetic-event-0001', 'ABC-xyz-0123456789', '-', 'a']) {
      expect(pattern.test(eventId), eventId).toBe(true);
    }
    for (const eventId of ['a_b', 'a.b', 'a b', 'aø', 'a/b', 'a+b', 'a\nb', '']) {
      expect(pattern.test(eventId), JSON.stringify(eventId)).toBe(false);
    }
  });

  test('LOST-01-AC11: a heartbeat with a position comes through with every value as sent', () => {
    const body = heartbeat();

    const parsed = heartbeatRequestSchema.parse(body);

    expect(parsed.journeyId).toBe(body.journeyId);
    expect(parsed.eventId).toBe(body.eventId);
    expect(parsed.batteryLevel).toBe(body.batteryLevel);
    expect(parsed.position?.latitude).toBe(body.position.latitude);
    expect(parsed.position?.longitude).toBe(body.position.longitude);
    expect(parsed.position?.accuracyMeters).toBe(body.position.accuracyMeters);
    // As text or as a Date, the same instant: the phone's time as given.
    expect(new Date(parsed.position?.recordedAt ?? Number.NaN).getTime()).toBe(
      Date.parse(body.position.recordedAt),
    );
  });

  test('LOST-01-AC11: no position and an unknown battery level are null, and accepted', () => {
    const parsed = heartbeatRequestSchema.parse({
      ...heartbeat(),
      batteryLevel: null,
      position: null,
    });

    expect(parsed.batteryLevel).toBeNull();
    expect(parsed.position).toBeNull();
  });

  test('LOST-01-AC11: the journey ID comes through lower-case, whatever case it was sent in', () => {
    const body = heartbeat();

    expect(
      heartbeatRequestSchema.parse({ ...body, journeyId: body.journeyId.toUpperCase() }).journeyId,
    ).toBe(body.journeyId);
  });

  test('LOST-01-AC11: the event ID is kept exactly as sent, case and all', () => {
    const eventId = 'Synthetic-EVENT-abc';

    expect(heartbeatRequestSchema.parse({ ...heartbeat(), eventId }).eventId).toBe(eventId);
  });

  test('LOST-01-AC11: the boundaries are accepted: latitude ±90, longitude ±180, accuracy 0, battery 0 and 1, an event ID of 64 characters', () => {
    const body = heartbeat();
    const bounds: [string, unknown][] = [
      ['latitude 90', withPosition(body, (p) => ({ ...p, latitude: 90 }))],
      ['latitude -90', withPosition(body, (p) => ({ ...p, latitude: -90 }))],
      ['longitude 180', withPosition(body, (p) => ({ ...p, longitude: 180 }))],
      ['longitude -180', withPosition(body, (p) => ({ ...p, longitude: -180 }))],
      ['accuracy 0', withPosition(body, (p) => ({ ...p, accuracyMeters: 0 }))],
      ['battery 0', { ...body, batteryLevel: 0 }],
      ['battery 1', { ...body, batteryLevel: 1 }],
      ['an event ID of 64 characters', { ...body, eventId: 'e'.repeat(64) }],
    ];

    for (const [what, bound] of bounds) {
      expect(accepts(bound), what).toBe(true);
    }
  });

  test('LOST-01-AC11: a phone time far in the past or the future, or with any offset, is accepted: the phone’s clock decides nothing', () => {
    const body = heartbeat();

    for (const recordedAt of [
      '1970-01-01T00:00:00.000Z',
      '2001-02-03T04:05:06Z',
      '2099-12-31T23:59:59.999Z',
      '2026-10-01T23:41:07.312+02:00',
      '2026-10-01T09:41:07.312-12:00',
    ]) {
      expect(accepts(withPosition(body, (p) => ({ ...p, recordedAt }))), recordedAt).toBe(true);
    }
  });
});

/** Bodies the request schema must refuse, by what is wrong with them. */
const REFUSED: { what: string; body: (valid: Body) => unknown }[] = [
  { what: 'a field beyond the four', body: (b) => ({ ...b, note: 'hello' }) },
  { what: 'the platform beside the four', body: (b) => ({ ...b, platform: 'android' }) },
  { what: 'moving beside the four', body: (b) => ({ ...b, moving: true }) },
  {
    what: 'a background_geolocation key beside the four',
    body: (b) => ({ ...b, background_geolocation: {} }),
  },
  {
    what: 'a field beyond the four inside position',
    body: (b) => withPosition(b, (p) => ({ ...p, altitude: 12.5 })),
  },
  { what: 'no journeyId', body: (b) => without(b, 'journeyId') },
  { what: 'no eventId', body: (b) => without(b, 'eventId') },
  { what: 'no batteryLevel', body: (b) => without(b, 'batteryLevel') },
  { what: 'no position', body: (b) => without(b, 'position') },
  { what: 'a journeyId that is not a UUID', body: (b) => ({ ...b, journeyId: 'journey-1' }) },
  { what: 'a journeyId that is a number', body: (b) => ({ ...b, journeyId: 7 }) },
  { what: 'an empty eventId', body: (b) => ({ ...b, eventId: '' }) },
  { what: 'an eventId of 65 characters', body: (b) => ({ ...b, eventId: 'e'.repeat(65) }) },
  { what: 'an eventId with an underscore', body: (b) => ({ ...b, eventId: 'synthetic_event' }) },
  { what: 'an eventId with a dot', body: (b) => ({ ...b, eventId: 'synthetic.event' }) },
  { what: 'an eventId with a space', body: (b) => ({ ...b, eventId: 'synthetic event' }) },
  {
    what: 'an eventId with a letter outside ASCII',
    body: (b) => ({ ...b, eventId: 'synthetic-ø' }),
  },
  { what: 'an eventId that is a number', body: (b) => ({ ...b, eventId: 1 }) },
  {
    what: 'a latitude above 90',
    body: (b) => withPosition(b, (p) => ({ ...p, latitude: 90.0000001 })),
  },
  {
    what: 'a latitude below -90',
    body: (b) => withPosition(b, (p) => ({ ...p, latitude: -90.0000001 })),
  },
  {
    what: 'a longitude above 180',
    body: (b) => withPosition(b, (p) => ({ ...p, longitude: 180.0000001 })),
  },
  {
    what: 'a longitude below -180',
    body: (b) => withPosition(b, (p) => ({ ...p, longitude: -180.0000001 })),
  },
  {
    what: 'a latitude that is not finite',
    body: (b) => withPosition(b, (p) => ({ ...p, latitude: Number.POSITIVE_INFINITY })),
  },
  {
    what: 'a longitude that is not a number',
    body: (b) => withPosition(b, (p) => ({ ...p, longitude: Number.NaN })),
  },
  {
    what: 'a latitude given as text',
    body: (b) => withPosition(b, (p) => ({ ...p, latitude: String(p.latitude) })),
  },
  {
    what: 'a negative accuracy',
    body: (b) => withPosition(b, (p) => ({ ...p, accuracyMeters: -0.125 })),
  },
  {
    what: 'an accuracy that is not finite',
    body: (b) => withPosition(b, (p) => ({ ...p, accuracyMeters: Number.POSITIVE_INFINITY })),
  },
  { what: 'a battery level above 1', body: (b) => ({ ...b, batteryLevel: 1.015625 }) },
  { what: 'a battery level below 0', body: (b) => ({ ...b, batteryLevel: -0.015625 }) },
  {
    what: 'a battery level of -1, the SDK’s own "unknown"',
    body: (b) => ({ ...b, batteryLevel: -1 }),
  },
  { what: 'a battery level given as text', body: (b) => ({ ...b, batteryLevel: '0.5' }) },
  {
    what: 'a recordedAt with no offset',
    body: (b) => withPosition(b, (p) => ({ ...p, recordedAt: '2026-10-01T21:41:07.312' })),
  },
  {
    what: 'a recordedAt that is not a time',
    body: (b) => withPosition(b, (p) => ({ ...p, recordedAt: 'yesterday' })),
  },
  {
    what: 'a recordedAt given as a number',
    body: (b) => withPosition(b, (p) => ({ ...p, recordedAt: Date.parse(p.recordedAt) })),
  },
  {
    what: 'a position without its latitude',
    body: (b) => withPosition(b, (p) => without(p, 'latitude')),
  },
  {
    what: 'a position without its longitude',
    body: (b) => withPosition(b, (p) => without(p, 'longitude')),
  },
  {
    what: 'a position without its accuracy',
    body: (b) => withPosition(b, (p) => without(p, 'accuracyMeters')),
  },
  {
    what: 'a position without its recordedAt',
    body: (b) => withPosition(b, (p) => without(p, 'recordedAt')),
  },
  { what: 'a position that is a list', body: (b) => ({ ...b, position: [b.position] }) },
  { what: 'a position that is text', body: (b) => ({ ...b, position: 'none' }) },
  { what: 'a body that is null', body: () => null },
  { what: 'a body that is a list', body: (b) => [b] },
  { what: 'a body that is text', body: (b) => JSON.stringify(b) },
];

describe('SEC-07: every malformed heartbeat is refused', () => {
  test.each(REFUSED)('LOST-01-AC11: refuses $what', ({ body }) => {
    expect(accepts(body(heartbeat()))).toBe(false);
  });

  test('LOST-01-AC11: the valid body every refusal above is made from is itself accepted, so each refusal is the change’s doing', () => {
    expect(accepts(heartbeat())).toBe(true);
  });
});

describe('the heartbeat answers', () => {
  test('LOST-01-AC1: a heartbeat is answered RECORDED or DUPLICATE, and nothing else', () => {
    const recorded: HeartbeatResponse = { outcome: 'RECORDED' };
    const duplicate: HeartbeatResponse = { outcome: 'DUPLICATE' };

    expect(heartbeatResponseSchema.parse(recorded)).toEqual(recorded);
    expect(heartbeatResponseSchema.parse(duplicate)).toEqual(duplicate);
    for (const outcome of ['IGNORED', 'ENDED', 'recorded', '', null]) {
      expect(heartbeatResponseSchema.safeParse({ outcome }).success, String(outcome)).toBe(false);
    }
    expect(heartbeatResponseSchema.safeParse({}).success).toBe(false);
  });

  test('LOST-01-AC19: the route’s refusals are declared with their statuses: 403 for another device of the walker, 404 for no journey of theirs, 409 for an ended journey, and the 400', () => {
    const declared: Record<HeartbeatErrorCode, { status: number }> = heartbeatErrors;

    expect(Object.keys(declared).sort()).toEqual(
      ['BAD_REQUEST', 'JOURNEY_ENDED', 'JOURNEY_NOT_FOUND', 'NOT_THE_JOURNEYS_DEVICE'].sort(),
    );
    expect(declared).toMatchObject({
      BAD_REQUEST: { status: 400 },
      NOT_THE_JOURNEYS_DEVICE: { status: 403 },
      JOURNEY_NOT_FOUND: { status: 404 },
      JOURNEY_ENDED: { status: 409 },
    });
  });

  test('LOST-01-AC12: no declared answer names background_geolocation, in any spelling', () => {
    expect(JSON.stringify(heartbeatErrors)).not.toMatch(/background[_-]?geolocation/i);
  });

  test('the request type is the schema’s: a heartbeat built here is one', () => {
    const body: HeartbeatRequest = heartbeatRequestSchema.parse(heartbeat());

    expect(body.eventId).toMatch(/^synthetic-event-/);
  });
});
