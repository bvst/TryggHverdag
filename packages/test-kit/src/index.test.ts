import { describe, expect, test } from 'vitest';
import { fakeCheckIn } from './fake-check-in.ts';
import { apiPath } from './index.js';
import * as kit from './index.ts';

describe('apiPath', () => {
  test('puts a route under the current API version', () => {
    expect(apiPath('journeys')).toBe('/v1/journeys');
  });

  test('accepts a leading slash, so callers do not have to think about it', () => {
    expect(apiPath('/journeys')).toBe('/v1/journeys');
    expect(apiPath('///journeys')).toBe('/v1/journeys');
  });
});

describe('the test kit', () => {
  test('hands out the check-in fake and fast-check beside the others', () => {
    expect(kit.fakeCheckIn).toBe(fakeCheckIn);
    expect(typeof kit.fc.assert).toBe('function');
    expect(typeof kit.fc.asyncProperty).toBe('function');
  });

  test('hands out the push fake beside the store fake and the shared suite, which now hold the watchdog’s and the outbox’s side', () => {
    expect(typeof kit.fakePush).toBe('function');
    expect(typeof kit.fakeJourneyStore).toBe('function');
    expect(kit.JOURNEY_STORE_BEHAVIOUR.some(({ name }) => name.includes('the overdue read'))).toBe(
      true,
    );
  });

  test('hands out a synthetic ping URL that cannot reach anything, and cannot name a real check', () => {
    // Every INF-08 test that could fetch it relies on this: https, so the
    // worker accepts it, but port 1 on the loopback address, which fetch
    // refuses outright. A kit that pointed it at Healthchecks.io would have
    // tests pinging a real service; one with a real UUID would leak a check.
    expect(kit.SYNTHETIC_PING_URL).toBe(`https://127.0.0.1:1/${kit.SYNTHETIC_CHECK_UUID}`);
    expect(kit.SYNTHETIC_CHECK_UUID).toBe('00000000-0000-0000-0000-000000000000');
  });
});
