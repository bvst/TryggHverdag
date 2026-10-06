// L4 contract. The app is built against this description, and phones keep
// running old versions of the app (AR-08) — so the question these tests answer
// is not "does the server work" but "is the shape we published still the shape
// we serve".
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { API_PREFIX, openApiDocument, openApiJson } from './index.ts';

const COMMITTED_SPEC = path.join(import.meta.dirname, '..', 'openapi.json');

describe('the generated OpenAPI description', () => {
  test('describes the health route as a GET, where the contract puts it', async () => {
    const document = await openApiDocument();
    const paths = document['paths'] as Record<string, Record<string, unknown>>;

    // Was ['/health'] alone until SM-01 added the journeys route, and
    // ['/health', '/journeys'] until LOST-01 added the heartbeat route (RG-03:
    // a route added by design, LOST-01's spec, approach item 1). The list is
    // still exact, so a route added later has to be named here on purpose.
    //
    // RG-03 (LOST-03): the "I'm home" route is added by design (D-110, its
    // spec's approach item 5 and "Existing assertions that change by
    // design"), named here on purpose. The list is still exact.
    expect(Object.keys(paths).sort()).toEqual(
      ['/health', '/heartbeats', '/journeys', '/journeys/{journeyId}/home'].sort(),
    );
    expect(paths['/health']).toHaveProperty('get');
  });

  test('serves every route under the API version, so an old app keeps working', async () => {
    const document = await openApiDocument();

    expect(document['servers']).toEqual([{ url: API_PREFIX }]);
  });

  test('publishes what the body means, not just its types', async () => {
    // A monitor reading this has to know that `status` is about the worker
    // rather than about this process answering. If that description ever
    // disappears, the endpoint silently becomes ambiguous.
    const document = await openApiDocument();
    const json = JSON.stringify(document);

    expect(json).toContain('nothing is watching the journeys');
  });

  test('the committed openapi.json is what the contract generates today', async () => {
    // pnpm run api:diff compares released versions against the committed file.
    // If that file drifted from the contract, the compatibility gate would be
    // comparing against a description nobody serves — which is worse than not
    // comparing at all, because it would look like it had checked.
    //
    // Text, not objects: the file is what api:diff reads, so the file is what
    // has to match. Run `pnpm run api:spec` and commit the result.
    expect(readFileSync(COMMITTED_SPEC, 'utf8')).toBe(await openApiJson());
  });
});

/** The keys of an OpenAPI path item that are operations. */
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/**
 * The operations anyone may call without a device credential, as the
 * document names them, under the /v1 server. Only health, as in AC9's list.
 */
const PUBLIC_OPERATIONS = ['GET /health'];

/** The parts of an OpenAPI document these tests read. */
interface Operation {
  responses?: Record<string, unknown>;
  security?: Record<string, string[]>[];
}
interface SecurityScheme {
  type?: string;
  scheme?: string;
}

async function described() {
  const document = await openApiDocument();
  const paths = document['paths'] as Record<string, Record<string, Operation | undefined>>;
  const components = document['components'] as
    { securitySchemes?: Record<string, SecurityScheme> } | undefined;
  const globalSecurity = document['security'] as Record<string, string[]>[] | undefined;
  return {
    paths,
    securitySchemes: components?.securitySchemes ?? {},
    /** What a route requires once a document-wide default is taken into account. */
    securityOf: (operation: Operation | undefined) => operation?.security ?? globalSecurity ?? [],
  };
}

describe('SM-01: the journeys route, as published', () => {
  test('SM-01-AC16: POST /journeys is described under the /v1 server', async () => {
    const { paths } = await described();
    const document = await openApiDocument();

    expect(document['servers']).toEqual([{ url: API_PREFIX }]);
    expect(API_PREFIX).toBe('/v1');
    expect(paths['/journeys']?.['post']).toBeDefined();
  });

  test('SM-01-AC16: its answers include 201, 400, 401, 409 and 422', async () => {
    const { paths } = await described();
    const responses = Object.keys(paths['/journeys']?.['post']?.responses ?? {});

    expect(responses).toEqual(expect.arrayContaining(['201', '400', '401', '409', '422']));
  });

  test('SM-01-AC16: a bearer security scheme is declared, once', async () => {
    const { securitySchemes } = await described();

    const bearer = Object.values(securitySchemes).filter(
      (scheme) => scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'bearer',
    );

    expect(bearer).toHaveLength(1);
  });

  test('SM-01-AC16: POST /journeys requires the bearer scheme', async () => {
    const { paths, securitySchemes, securityOf } = await described();
    const [bearerName] = Object.entries(securitySchemes)
      .filter(([, scheme]) => scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'bearer')
      .map(([name]) => name);

    expect(bearerName).toBeDefined();
    expect(securityOf(paths['/journeys']?.['post'])).toContainEqual({ [bearerName ?? '']: [] });
  });

  test('SM-01-AC16: every operation but GET /health, read from the document, declares the 401 and requires the bearer scheme', async () => {
    // AC9 calls every route in the contract without a credential; this is
    // the published half. Read from the document, never typed out, so a
    // route added later is checked the day it appears: an app built from
    // this description must know that route wants a device credential.
    const { paths, securitySchemes, securityOf } = await described();
    const [bearerName] = Object.entries(securitySchemes)
      .filter(([, scheme]) => scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'bearer')
      .map(([name]) => name);
    const operations = Object.entries(paths).flatMap(([route, item]) =>
      Object.entries(item)
        .filter(([method]) => HTTP_METHODS.includes(method))
        .map(([method, operation]) => ({ key: `${method.toUpperCase()} ${route}`, operation })),
    );
    const guarded = operations.filter(({ key }) => !PUBLIC_OPERATIONS.includes(key));

    expect(bearerName).toBeDefined();
    expect(operations.map(({ key }) => key)).toEqual(expect.arrayContaining(PUBLIC_OPERATIONS));
    expect(guarded.length).toBe(operations.length - PUBLIC_OPERATIONS.length);
    expect(guarded.length).toBeGreaterThan(0);
    expect(
      guarded.map(({ key, operation }) => ({
        key,
        declares401: Object.keys(operation?.responses ?? {}).includes('401'),
        requiresBearer: securityOf(operation).some(
          (requirement) =>
            JSON.stringify(requirement) === JSON.stringify({ [bearerName ?? '']: [] }),
        ),
      })),
    ).toEqual(guarded.map(({ key }) => ({ key, declares401: true, requiresBearer: true })));
  });

  test('SM-01-AC16: GET /health requires nothing, so the monitors and the deploy check still reach it', async () => {
    const { paths, securityOf } = await described();

    expect(paths['/health']?.['get']).toBeDefined();
    expect(securityOf(paths['/health']?.['get'])).toEqual([]);
  });
});

describe('LOST-01: the heartbeat route, as published', () => {
  test('LOST-01-AC19: POST /heartbeats is described under the /v1 server', async () => {
    const { paths } = await described();
    const document = await openApiDocument();

    expect(document['servers']).toEqual([{ url: API_PREFIX }]);
    expect(API_PREFIX).toBe('/v1');
    expect(paths['/heartbeats']?.['post']).toBeDefined();
    expect(Object.keys(paths['/heartbeats'] ?? {})).toEqual(['post']);
  });

  test('LOST-01-AC19: its answers include 200, 400, 401, 403, 404 and 409', async () => {
    const { paths } = await described();
    const responses = Object.keys(paths['/heartbeats']?.['post']?.responses ?? {});

    expect(responses).toEqual(expect.arrayContaining(['200', '400', '401', '403', '404', '409']));
  });

  test('LOST-01-AC19: POST /heartbeats requires the bearer scheme', async () => {
    const { paths, securitySchemes, securityOf } = await described();
    const [bearerName] = Object.entries(securitySchemes)
      .filter(([, scheme]) => scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'bearer')
      .map(([name]) => name);

    expect(bearerName).toBeDefined();
    expect(securityOf(paths['/heartbeats']?.['post'])).toContainEqual({ [bearerName ?? '']: [] });
  });

  test('LOST-01-AC19: the journey is named in the body, never in the path, so no heartbeat value is ever in a URL', async () => {
    // Access logs, the platform's own included, see the URL. A journey ID or
    // anything else of a heartbeat in it would be in every one of them.
    const { paths } = await described();

    expect(Object.keys(paths).filter((route) => route.startsWith('/heartbeats'))).toEqual([
      '/heartbeats',
    ]);
    expect(JSON.stringify(paths['/heartbeats']?.['post'] ?? {})).not.toMatch(
      /"in":\s*"(path|query|header)"/,
    );
  });
});

/** The route LOST-03 adds (D-110), as the document names it under the /v1 server. */
const HOME = '/journeys/{journeyId}/home';

/** A JSON schema, by the parts these tests read. */
interface JsonSchema {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  format?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

/** A parameter of an operation, by the parts these tests read. */
interface Parameter {
  name?: string;
  in?: string;
  required?: boolean;
  schema?: JsonSchema;
}

/**
 * The published shape of the start and heartbeat routes before LOST-03, as
 * the committed openapi.json held it at 39f1beb: a SHA-256 of each path
 * item's JSON. LOST-03 adds a route and changes neither of these, so a
 * change to either shows here, and is made on purpose.
 */
const UNCHANGED_PATH_ITEMS = {
  '/journeys': '4b736a3f8275081700131fa40eec6c01df6f2a797210cbb35c168526b77945a3',
  '/heartbeats': '5bda3e10bfe01676c134acee502bb6e549f33d168a81a2ae5a1d753b8f7d1f53',
};

describe('SM-04: the "I’m home" route, as published (D-110)', () => {
  test('LOST-03-AC18: POST /journeys/{journeyId}/home is described under the /v1 server, as a POST and nothing else', async () => {
    const { paths } = await described();
    const document = await openApiDocument();

    expect(document['servers']).toEqual([{ url: API_PREFIX }]);
    expect(API_PREFIX).toBe('/v1');
    expect(paths[HOME]?.['post']).toBeDefined();
    expect(Object.keys(paths[HOME] ?? {}).filter((key) => HTTP_METHODS.includes(key))).toEqual([
      'post',
    ]);
  });

  test('LOST-03-AC18: its answers are 200, 400, 401, 403, 404 and 409', async () => {
    const { paths } = await described();
    const responses = Object.keys(paths[HOME]?.['post']?.responses ?? {});

    expect(responses).toEqual(expect.arrayContaining(['200', '400', '401', '403', '404', '409']));
  });

  test('LOST-03-AC18: it requires the bearer scheme', async () => {
    const { paths, securitySchemes, securityOf } = await described();
    const [bearerName] = Object.entries(securitySchemes)
      .filter(([, scheme]) => scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'bearer')
      .map(([name]) => name);

    expect(bearerName).toBeDefined();
    expect(securityOf(paths[HOME]?.['post'])).toContainEqual({ [bearerName ?? '']: [] });
  });

  test('LOST-03-AC18: its 200 body is exactly { "outcome": "ENDED" }', async () => {
    const { paths } = await described();
    const ok = paths[HOME]?.['post']?.responses?.['200'] as
      { content?: Record<string, { schema?: JsonSchema }> } | undefined;
    const schema = ok?.content?.['application/json']?.schema;
    const outcome = schema?.properties?.['outcome'];

    expect(Object.keys(schema?.properties ?? {})).toEqual(['outcome']);
    expect(schema?.required).toEqual(['outcome']);
    expect(outcome?.const === undefined ? outcome?.enum : [outcome.const]).toEqual(['ENDED']);
  });

  test('LOST-03-AC18: the journey is its one parameter: in the path, required, a UUID; nothing in the query or a header', async () => {
    const { paths } = await described();
    const parameters =
      (paths[HOME]?.['post'] as { parameters?: Parameter[] } | undefined)?.parameters ?? [];

    expect(parameters.map(({ name, in: where, required }) => ({ name, where, required }))).toEqual([
      { name: 'journeyId', where: 'path', required: true },
    ]);
    expect(parameters[0]?.schema?.format).toBe('uuid');
  });

  test('LOST-03-AC18: the heartbeat and start routes are published exactly as before', async () => {
    const { paths } = await described();

    for (const [route, digest] of Object.entries(UNCHANGED_PATH_ITEMS)) {
      expect(createHash('sha256').update(JSON.stringify(paths[route])).digest('hex'), route).toBe(
        digest,
      );
    }
  });
});
