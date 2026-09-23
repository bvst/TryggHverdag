// L4 contract. The app is built against this description, and phones keep
// running old versions of the app (AR-08) — so the question these tests answer
// is not "does the server work" but "is the shape we published still the shape
// we serve".
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { API_PREFIX, openApiDocument, openApiJson } from './index.ts';

const COMMITTED_SPEC = path.join(import.meta.dirname, '..', 'openapi.json');

describe('the generated OpenAPI description', () => {
  test('describes the health route as a GET, where the contract puts it', async () => {
    const document = await openApiDocument();
    const paths = document['paths'] as Record<string, Record<string, unknown>>;

    expect(Object.keys(paths)).toEqual(['/health']);
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
