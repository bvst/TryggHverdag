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

  test('hands out the staging canary’s fakes: its three fixed IDs, three different lower-case v4 UUIDs; its outcomes; its alarm, its waits and its shared suite', () => {
    const ids = Object.values(kit.CANARY_IDS);
    expect(Object.keys(kit.CANARY_IDS).sort()).toEqual(['deviceId', 'responderId', 'walkerId']);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(new Set(ids).size).toBe(3);
    expect(kit.FAKE_CANARY_OUTCOMES).toHaveLength(15);
    expect(typeof kit.fakeCanaryAlarm).toBe('function');
    expect(typeof kit.fakeWait).toBe('function');
    expect(kit.CANARY_STORE_BEHAVIOUR).toHaveLength(3);
  });

  test('hands out a synthetic ping URL that cannot reach anything, and cannot name a real check', () => {
    // Every INF-08 test that could fetch it relies on this: https, so the
    // worker accepts it, but port 1 on the loopback address, which fetch
    // refuses outright. A kit that pointed it at Healthchecks.io would have
    // tests pinging a real service; one with a real UUID would leak a check.
    expect(kit.SYNTHETIC_PING_URL).toBe(`https://127.0.0.1:1/${kit.SYNTHETIC_CHECK_UUID}`);
    expect(kit.SYNTHETIC_CHECK_UUID).toBe('00000000-0000-0000-0000-000000000000');
  });

  test('hands out a synthetic ping URL for a check of its own: the same unreachable address, with the UUID given, or a fresh synthetic one each time', () => {
    // LOST-07: the worker's check and the SMS check are two checks, so a test
    // setting both needs two URLs, each as unreachable as SYNTHETIC_PING_URL.
    const uuid = kit.syntheticUuid();
    expect(kit.syntheticPingUrl(uuid)).toBe(`https://127.0.0.1:1/${uuid}`);
    expect(kit.syntheticPingUrl(kit.SYNTHETIC_CHECK_UUID)).toBe(kit.SYNTHETIC_PING_URL);

    const [one, two] = [kit.syntheticPingUrl(), kit.syntheticPingUrl()];
    expect(one).toMatch(
      /^https:\/\/127\.0\.0\.1:1\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(two).not.toBe(one);
  });
});
