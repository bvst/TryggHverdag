import { describe, expect, test } from 'vitest';
import { apiPath } from './index.js';

describe('apiPath', () => {
  test('puts a route under the current API version', () => {
    expect(apiPath('journeys')).toBe('/v1/journeys');
  });

  test('accepts a leading slash, so callers do not have to think about it', () => {
    expect(apiPath('/journeys')).toBe('/v1/journeys');
    expect(apiPath('///journeys')).toBe('/v1/journeys');
  });
});
