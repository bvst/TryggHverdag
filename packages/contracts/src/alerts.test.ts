// L2 contract: the "I'm on it" route (LOST-06-AC15, SEC-07; D-114).
//
// LOST-06 builds the server half of "I'm on it": `POST /alerts/{alertId}
// /acknowledgement`, under the /v1 server. The alert is named in the path and
// nowhere else, the input detailed as the "I'm home" route's is (D-112): its
// `params` hold the alert's ID alone, a UUID, lower-cased; its body is empty
// and strict, or absent, so a body holding any key is the fixed 400. The
// answers are fixed shapes: 200 `ACKNOWLEDGED` (recorded now, or already the
// caller's), the fixed 400, 404 `ALERT_NOT_FOUND` for an alert the caller
// does not follow, one body for all, 409 `ALREADY_ACKNOWLEDGED` and 409
// `ALERT_RESOLVED`. None says who is on it.
//
// What the route does with each request is proven through the API, at L6
// (acknowledgement.system.test.ts); this holds what the contract publishes.
// The published OpenAPI description is openapi.test.ts's.
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  acknowledgeAlert,
  acknowledgementErrors,
  acknowledgementRequestSchema,
  acknowledgementResponseSchema,
  badRequestError,
  contract,
  deviceCredentialErrors,
  type AcknowledgementErrorCode,
  type AcknowledgementRequest,
  type AcknowledgementResponse,
} from './index.ts';

/** What oRPC keeps of a contract route, by shape: the parts these tests read. */
interface RouteDefinition {
  route: {
    method?: string;
    path?: string;
    successStatus?: number;
    inputStructure?: string;
    description?: string;
  };
  inputSchema?: unknown;
  outputSchema?: unknown;
  errorMap: Record<string, { status?: number; message?: string; data?: unknown }>;
}

function definitionOf(route: unknown): RouteDefinition {
  return (route as { '~orpc': RouteDefinition })['~orpc'];
}

describe('LOST-06 and SEC-07: the "I’m on it" route, as the contract holds it', () => {
  test('LOST-06-AC15: acknowledgeAlert is in the contract beside health, start, heartbeat and "I’m home": POST /alerts/{alertId}/acknowledgement, answering 200, its input detailed', () => {
    const { route } = definitionOf(acknowledgeAlert);

    expect(contract.acknowledgeAlert).toBe(acknowledgeAlert);
    expect(Object.keys(contract).sort()).toEqual(
      ['acknowledgeAlert', 'health', 'recordHeartbeat', 'reportHome', 'startJourney'].sort(),
    );
    expect(route.method).toBe('POST');
    expect(route.path).toBe('/alerts/{alertId}/acknowledgement');
    expect(route.successStatus).toBe(200);
    // Detailed, not compact: compact input merges the path's parameters with
    // the body, and the body would win, so a body could name another alert.
    expect(route.inputStructure).toBe('detailed');
  });

  test('LOST-06-AC15: its request is acknowledgementRequestSchema and its answer acknowledgementResponseSchema', () => {
    const definition = definitionOf(acknowledgeAlert);

    expect(acknowledgementRequestSchema).toBeDefined();
    expect(definition.inputSchema).toBe(acknowledgementRequestSchema);
    expect(definition.outputSchema).toBe(acknowledgementResponseSchema);
  });

  test('LOST-06-AC15: the 200 body is exactly { outcome: "ACKNOWLEDGED" }: ACKNOWLEDGED is accepted, and no other outcome is, nor any other field, such as who is on it', () => {
    const acknowledged: AcknowledgementResponse = { outcome: 'ACKNOWLEDGED' };

    expect(acknowledgementResponseSchema.parse(acknowledged)).toEqual({ outcome: 'ACKNOWLEDGED' });
    for (const outcome of ['ENDED', 'RECORDED', 'ALREADY_YOURS', 'acknowledged', '', null]) {
      expect(acknowledgementResponseSchema.safeParse({ outcome }).success, String(outcome)).toBe(
        false,
      );
    }
    expect(acknowledgementResponseSchema.safeParse({}).success).toBe(false);
    // Who is on it is never answered: a field beside the outcome is refused,
    // or stripped, whichever the schema does.
    const carrying = acknowledgementResponseSchema.safeParse({
      outcome: 'ACKNOWLEDGED',
      acknowledgedBy: randomUUID(),
    });
    expect(carrying.success ? Object.keys(carrying.data) : ['outcome']).toEqual(['outcome']);
  });

  test('LOST-06-AC15: its refusals are the fixed 400, 404 ALERT_NOT_FOUND, 409 ALREADY_ACKNOWLEDGED and 409 ALERT_RESOLVED, each with no data, beside the 401 every device route has', () => {
    const codes: AcknowledgementErrorCode[] = [
      'BAD_REQUEST',
      'ALERT_NOT_FOUND',
      'ALREADY_ACKNOWLEDGED',
      'ALERT_RESOLVED',
    ];
    const { errorMap } = definitionOf(acknowledgeAlert);

    expect(Object.keys(acknowledgementErrors).sort()).toEqual([...codes].sort());
    expect(acknowledgementErrors.BAD_REQUEST).toBe(badRequestError);
    expect(
      Object.fromEntries(
        Object.entries(acknowledgementErrors).map(([code, error]) => [code, error.status]),
      ),
    ).toEqual({
      BAD_REQUEST: 400,
      ALERT_NOT_FOUND: 404,
      ALREADY_ACKNOWLEDGED: 409,
      ALERT_RESOLVED: 409,
    });
    for (const error of Object.values(acknowledgementErrors)) {
      expect(error).not.toHaveProperty('data');
    }
    expect(Object.keys(errorMap).sort()).toEqual([...codes, 'UNAUTHORIZED'].sort());
    expect(errorMap['UNAUTHORIZED']).toBe(deviceCredentialErrors.UNAUTHORIZED);
  });

  test('LOST-06-AC15: the alert comes from the path alone: params a strict object holding the alert’s ID, a UUID, lower-cased; the body empty and strict, or absent', () => {
    const alertId = randomUUID();
    const accepted: AcknowledgementRequest[] = [
      acknowledgementRequestSchema.parse({ params: { alertId } }),
      acknowledgementRequestSchema.parse({ params: { alertId }, body: {} }),
    ];

    for (const request of accepted) {
      expect(request.params).toEqual({ alertId });
    }
    expect(
      acknowledgementRequestSchema.parse({ params: { alertId: alertId.toUpperCase() } }).params
        .alertId,
    ).toBe(alertId.toLowerCase());
    for (const [what, input] of [
      ['an alert ID that is not a UUID', { params: { alertId: 'not-a-uuid' } }],
      ['an alert ID with a character after it', { params: { alertId: `${alertId}x` } }],
      ['a body naming another alert', { params: { alertId }, body: { alertId: randomUUID() } }],
      ['a body holding any key', { params: { alertId }, body: { note: 'synthetic' } }],
      ['another parameter beside the alert', { params: { alertId, responderId: randomUUID() } }],
      ['no alert at all', { params: {} }],
    ] as const) {
      expect(acknowledgementRequestSchema.safeParse(input).success, what).toBe(false);
    }
  });

  test('LOST-06-AC15: its description says it needs a device credential, that only a responder of the alert’s journey may acknowledge it, that a 200 means the caller is the one on it, and what each 409 means', () => {
    const description = definitionOf(acknowledgeAlert).route.description ?? '';

    expect(description).toMatch(/device credential/i);
    expect(description).toMatch(/responder of the alert/i);
    expect(description).toMatch(/\b200\b/);
    expect(description).toMatch(/\b409\b/);
    expect(description).toMatch(/ALREADY_ACKNOWLEDGED/);
    expect(description).toMatch(/ALERT_RESOLVED/);
    expect(description).toMatch(/over/i);
  });
});
