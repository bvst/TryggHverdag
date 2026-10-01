// L2 contract: what a start request may hold, and what a start answers.
//
// SEC-07's second half: the server validates what it receives. The body is
// the one place a caller could try to name a walker, so it holds exactly one
// field, `responderIds`, and anything else is refused rather than ignored. A
// field that was quietly dropped today is one that a later version reads.
//
// The IDs are generated per run, never written out. This package may not
// depend on the test kit (it depends on nothing of ours), so they come from
// node:crypto here.
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { MAX_RESPONDERS, startJourneyRequestSchema, startJourneyResponseSchema } from './index.ts';

function uuids(count: number): string[] {
  return Array.from({ length: count }, () => randomUUID());
}

/** Bodies the request schema must refuse, by what is wrong with them. */
const REFUSED_BODIES = [
  { what: 'a walkerId beside the list', body: { responderIds: uuids(1), walkerId: randomUUID() } },
  { what: 'any other field beside the list', body: { responderIds: uuids(1), note: 'hello' } },
  { what: 'no responderIds at all', body: {} },
  { what: 'only a walkerId', body: { walkerId: randomUUID() } },
  { what: 'responderIds as one string', body: { responderIds: randomUUID() } },
  { what: 'responderIds as null', body: { responderIds: null } },
  { what: 'responderIds as an object', body: { responderIds: { first: randomUUID() } } },
  { what: 'responderIds as a number', body: { responderIds: 1 } },
  { what: 'an entry that is not a UUID', body: { responderIds: [randomUUID(), 'not-a-uuid'] } },
  { what: 'an entry that is a number', body: { responderIds: [7] } },
  { what: 'an entry that is null', body: { responderIds: [null] } },
  { what: 'an entry that is an empty string', body: { responderIds: [''] } },
  { what: 'one entry more than MAX_RESPONDERS', body: { responderIds: uuids(51) } },
  { what: 'a body that is null', body: null },
  { what: 'a body that is a list', body: [randomUUID()] },
  { what: 'a body that is a string', body: randomUUID() },
];

describe('SEC-07: the start request holds exactly the responder list, and nothing else', () => {
  test('SM-01-AC10: MAX_RESPONDERS is 50, a fixed bound on what one request can ask the server to check', () => {
    expect(MAX_RESPONDERS).toBe(50);
  });

  test('SM-01-AC10: a list of responder IDs is accepted, and comes through unchanged', () => {
    const responderIds = uuids(3);

    expect(startJourneyRequestSchema.parse({ responderIds })).toEqual({ responderIds });
  });

  test('SM-01-AC10: exactly MAX_RESPONDERS entries is still accepted', () => {
    const body = { responderIds: uuids(MAX_RESPONDERS) };

    expect(startJourneyRequestSchema.safeParse(body).success).toBe(true);
  });

  test('SM-01-AC10: an empty list is accepted here, so that SM-02 refuses it in its own words', () => {
    // A 400 for an empty list would tell the app "your request was malformed"
    // when the truth is "a journey needs someone to follow it".
    expect(startJourneyRequestSchema.safeParse({ responderIds: [] }).success).toBe(true);
  });

  test('SM-01-AC10: a repeated responder is accepted here, so that the start counts it once', () => {
    const [responderId = ''] = uuids(1);

    expect(
      startJourneyRequestSchema.safeParse({ responderIds: [responderId, responderId] }).success,
    ).toBe(true);
  });

  test.each(REFUSED_BODIES)('SM-01-AC10: refuses $what', ({ body }) => {
    expect(startJourneyRequestSchema.safeParse(body).success).toBe(false);
  });

  test('SM-01-AC10: the bound in the refused list is the contract’s own constant', () => {
    // The table above is written with 51; this keeps it honest if the bound
    // ever moves.
    expect(
      startJourneyRequestSchema.safeParse({ responderIds: uuids(MAX_RESPONDERS + 1) }).success,
    ).toBe(false);
    expect(MAX_RESPONDERS + 1).toBe(51);
  });
});

describe('the start answer', () => {
  const answer = () => ({
    journeyId: randomUUID(),
    state: 'ACTIVE',
    startedAt: '2026-10-01T21:40:00.000Z',
  });

  test('SM-01-AC1: a started journey’s answer is its ID, ACTIVE and the database time it started', () => {
    const body = answer();

    expect(startJourneyResponseSchema.parse(body)).toEqual(body);
  });

  test('SM-01-AC1: no other state is a started journey', () => {
    for (const state of ['LOST_CONTACT', 'ENDED', 'active', '']) {
      expect(startJourneyResponseSchema.safeParse({ ...answer(), state }).success, state).toBe(
        false,
      );
    }
  });

  test('SM-01-AC1: startedAt is RFC 3339, and the journey ID a UUID', () => {
    expect(
      startJourneyResponseSchema.safeParse({ ...answer(), startedAt: 'yesterday' }).success,
    ).toBe(false);
    expect(
      startJourneyResponseSchema.safeParse({ ...answer(), journeyId: 'journey-1' }).success,
    ).toBe(false);
  });

  test('SM-01-AC1: each of the three fields is required', () => {
    for (const field of ['journeyId', 'state', 'startedAt']) {
      const body = Object.fromEntries(Object.entries(answer()).filter(([key]) => key !== field));

      expect(startJourneyResponseSchema.safeParse(body).success, field).toBe(false);
    }
  });
});
