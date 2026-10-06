// L2 contract: the "I'm home" route (SM-04, LOST-03-AC18, D-110).
//
// LOST-03 builds the server half of "I'm home": `POST /journeys/{journeyId}
// /home`, under the /v1 server. The journey is named in the path, and the
// request holds nothing else. The answers are fixed shapes: 200 `ENDED`, the
// fixed 400, 403 for another device of the walker's (D-101), 404 for a
// journey that is not the walker's, one body for both, and 409 for a journey
// already ended, whatever ended it, a repeat "I'm home" included (D-112).
// A 200 and a 409 both mean the journey is over.
//
// What the route does with each request is proven through the API, at L6
// (contact.system.test.ts); this holds what the contract publishes. The
// published OpenAPI description is openapi.test.ts's.
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  badRequestError,
  contract,
  deviceCredentialErrors,
  homeErrors,
  homeRequestSchema,
  homeResponseSchema,
  reportHome,
  type HomeErrorCode,
  type HomeResponse,
} from './index.ts';

/** What oRPC keeps of a contract route, by shape: the parts these tests read. */
interface RouteDefinition {
  route: {
    method?: string;
    path?: string;
    successStatus?: number;
    summary?: string;
    description?: string;
  };
  inputSchema?: unknown;
  outputSchema?: unknown;
  errorMap: Record<string, { status?: number; message?: string; data?: unknown }>;
}

function definitionOf(route: unknown): RouteDefinition {
  return (route as { '~orpc': RouteDefinition })['~orpc'];
}

describe('SM-04: the "I’m home" route, as the contract holds it', () => {
  test('LOST-03-AC18: reportHome is in the contract beside health, start and heartbeat: POST /journeys/{journeyId}/home, answering 200', () => {
    const { route } = definitionOf(reportHome);

    expect(contract.reportHome).toBe(reportHome);
    expect(Object.keys(contract).sort()).toEqual(
      ['health', 'recordHeartbeat', 'reportHome', 'startJourney'].sort(),
    );
    expect(route.method).toBe('POST');
    expect(route.path).toBe('/journeys/{journeyId}/home');
    expect(route.successStatus).toBe(200);
  });

  test('LOST-03-AC18: its request is homeRequestSchema and its answer homeResponseSchema', () => {
    const definition = definitionOf(reportHome);

    expect(homeRequestSchema).toBeDefined();
    expect(definition.inputSchema).toBe(homeRequestSchema);
    expect(definition.outputSchema).toBe(homeResponseSchema);
  });

  test('LOST-03-AC18: the 200 body is exactly { outcome: "ENDED" }: ENDED is accepted, and no other outcome is', () => {
    const ended: HomeResponse = { outcome: 'ENDED' };

    expect(homeResponseSchema.parse(ended)).toEqual({ outcome: 'ENDED' });
    for (const outcome of ['RECORDED', 'DUPLICATE', 'HOME', 'ended', '', null]) {
      expect(homeResponseSchema.safeParse({ outcome }).success, String(outcome)).toBe(false);
    }
    expect(homeResponseSchema.safeParse({}).success).toBe(false);
  });

  test('LOST-03-AC18: its refusals are the fixed 400, 403 NOT_THE_JOURNEYS_DEVICE, 404 JOURNEY_NOT_FOUND and 409 JOURNEY_ENDED, each with no data, beside the 401 every device route has', () => {
    const codes: HomeErrorCode[] = [
      'BAD_REQUEST',
      'NOT_THE_JOURNEYS_DEVICE',
      'JOURNEY_NOT_FOUND',
      'JOURNEY_ENDED',
    ];
    const { errorMap } = definitionOf(reportHome);

    expect(Object.keys(homeErrors).sort()).toEqual([...codes].sort());
    expect(homeErrors.BAD_REQUEST).toBe(badRequestError);
    expect(
      Object.fromEntries(Object.entries(homeErrors).map(([code, error]) => [code, error.status])),
    ).toEqual({
      BAD_REQUEST: 400,
      NOT_THE_JOURNEYS_DEVICE: 403,
      JOURNEY_NOT_FOUND: 404,
      JOURNEY_ENDED: 409,
    });
    for (const error of Object.values(homeErrors)) {
      expect(error).not.toHaveProperty('data');
    }
    expect(Object.keys(errorMap).sort()).toEqual([...codes, 'UNAUTHORIZED'].sort());
    expect(errorMap['UNAUTHORIZED']).toBe(deviceCredentialErrors.UNAUTHORIZED);
  });

  // Review loop 1 (the spec's item 7a; test-auditor): the route
  // lower-cases the journey's ID at the edge, as the other routes do, so
  // the same journey is named in either case.
  test('LOST-03-AC18: the request schema lower-cases a journey ID given in upper case', () => {
    const journeyId = randomUUID();

    expect(
      homeRequestSchema.parse({ params: { journeyId: journeyId.toUpperCase() } }).params.journeyId,
    ).toBe(journeyId.toLowerCase());
  });

  test('LOST-03-AC18: its description says it needs a device credential, that only the device that started the journey may end it, and that a 200 and a 409 both mean the journey is over', () => {
    const description = definitionOf(reportHome).route.description ?? '';

    expect(description).toMatch(/device credential/i);
    expect(description).toMatch(/device that started the journey/i);
    expect(description).toMatch(/\b200\b/);
    expect(description).toMatch(/\b409\b/);
    expect(description).toMatch(/over/i);
  });
});
