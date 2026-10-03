// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// Every heartbeat test takes its positions, battery levels, phone times and
// event IDs from here. A builder that handed out a real-looking place would
// put a person's whereabouts in a public repository (RG-07, D-089); one whose
// values repeated, or printed as short common text, would let the "none of
// it reaches a log" tests find a marker by chance, or miss one.
import { describe, expect, test } from 'vitest';
import * as kit from './index.ts';
import {
  SYNTHETIC_EVENT_ID_PREFIX,
  syntheticAccuracy,
  syntheticBatteryLevel,
  syntheticCoordinate,
  syntheticEventId,
  syntheticHeartbeat,
  syntheticPhoneTime,
  syntheticPosition,
  toStoredPosition,
} from './synthetic-heartbeats.ts';
import { syntheticUuid } from './synthetic-ids.ts';

const MANY = 500;

/** The contract's event ID rule (LOST-01's spec, approach item 3). */
const EVENT_ID = /^[A-Za-z0-9-]{1,64}$/;

/** RFC 3339 with an offset, as the contract takes the phone's time. */
const RFC_3339 = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;

describe('syntheticCoordinate', () => {
  test('is always open sea: within 1° of 0° 0′, and at least 0.1 from it', () => {
    for (let i = 0; i < MANY; i += 1) {
      const coordinate = syntheticCoordinate();

      expect(Math.abs(coordinate)).toBeLessThan(1);
      expect(Math.abs(coordinate)).toBeGreaterThanOrEqual(0.1);
    }
  });

  test('has exactly seven decimals, none of them 0, so every rounding of it is a distinct text', () => {
    for (let i = 0; i < MANY; i += 1) {
      expect(String(syntheticCoordinate())).toMatch(/^-?0\.[1-9]{7}$/);
    }
  });

  test('takes both signs, and rarely repeats', () => {
    const made = Array.from({ length: MANY }, () => syntheticCoordinate());

    expect(made.some((coordinate) => coordinate < 0)).toBe(true);
    expect(made.some((coordinate) => coordinate > 0)).toBe(true);
    expect(new Set(made).size).toBeGreaterThan(MANY - 5);
  });
});

describe('syntheticBatteryLevel and syntheticAccuracy', () => {
  test('a battery level is strictly between 0 and 1, an odd number of 64ths', () => {
    for (let i = 0; i < MANY; i += 1) {
      const level = syntheticBatteryLevel();

      expect(level).toBeGreaterThan(0);
      expect(level).toBeLessThan(1);
      expect((level * 64) % 2).toBe(1);
    }
  });

  test('an accuracy is from 2.125 to 99.875 metres, an odd number of eighths', () => {
    for (let i = 0; i < MANY; i += 1) {
      const accuracy = syntheticAccuracy();

      expect(accuracy).toBeGreaterThanOrEqual(2.125);
      expect(accuracy).toBeLessThanOrEqual(99.875);
      expect((accuracy * 8) % 2).toBe(1);
    }
  });
});

describe('syntheticEventId', () => {
  test('has the shape the contract admits, and says it is synthetic', () => {
    for (let i = 0; i < MANY; i += 1) {
      const eventId = syntheticEventId();

      expect(eventId).toMatch(EVENT_ID);
      expect(eventId.startsWith(SYNTHETIC_EVENT_ID_PREFIX)).toBe(true);
    }
  });

  test('never repeats itself', () => {
    const made = Array.from({ length: MANY }, () => syntheticEventId());

    expect(new Set(made).size).toBe(MANY);
  });
});

describe('syntheticPosition and syntheticPhoneTime', () => {
  test('a phone time is RFC 3339 in the synthetic night, never on a whole second', () => {
    for (let i = 0; i < MANY; i += 1) {
      const recordedAt = syntheticPhoneTime();

      expect(recordedAt).toMatch(RFC_3339);
      expect(recordedAt.startsWith('2026-10-01T21:')).toBe(true);
      expect(recordedAt.endsWith('.000Z')).toBe(false);
    }
  });

  test('a position holds synthetic coordinates, an accuracy and a phone time', () => {
    const position = syntheticPosition();

    expect(Object.keys(position).sort()).toEqual([
      'accuracyMeters',
      'latitude',
      'longitude',
      'recordedAt',
    ]);
    expect(String(position.latitude)).toMatch(/^-?0\.[1-9]{7}$/);
    expect(String(position.longitude)).toMatch(/^-?0\.[1-9]{7}$/);
    expect(position.recordedAt).toMatch(RFC_3339);
  });

  test('takes the phone time a test gives, as text or as a Date written in UTC', () => {
    const at = new Date('2026-10-02T03:04:05.678Z');

    expect(syntheticPosition({ recordedAt: at }).recordedAt).toBe('2026-10-02T03:04:05.678Z');
    expect(syntheticPosition({ recordedAt: '2026-10-02T05:04:05.678+02:00' }).recordedAt).toBe(
      '2026-10-02T05:04:05.678+02:00',
    );
  });

  test('toStoredPosition keeps every value, and the phone time as the same instant', () => {
    const position = syntheticPosition({ recordedAt: '2026-10-02T05:04:05.678+02:00' });

    expect(toStoredPosition(position)).toEqual({
      latitude: position.latitude,
      longitude: position.longitude,
      accuracyMeters: position.accuracyMeters,
      recordedAt: new Date('2026-10-02T03:04:05.678Z'),
    });
  });
});

describe('syntheticHeartbeat', () => {
  test('is the request body: the journey, a fresh event ID, a battery level and a position', () => {
    const journeyId = syntheticUuid();

    const heartbeat = syntheticHeartbeat({ journeyId });

    expect(Object.keys(heartbeat).sort()).toEqual([
      'batteryLevel',
      'eventId',
      'journeyId',
      'position',
    ]);
    expect(heartbeat.journeyId).toBe(journeyId);
    expect(heartbeat.eventId).toMatch(EVENT_ID);
    expect(heartbeat.batteryLevel).not.toBeNull();
    expect(heartbeat.position).not.toBeNull();
  });

  test('keeps a null battery level and a null position, as the phone sends "unknown" and "none"', () => {
    const heartbeat = syntheticHeartbeat({
      journeyId: syntheticUuid(),
      batteryLevel: null,
      position: null,
    });

    expect(heartbeat.batteryLevel).toBeNull();
    expect(heartbeat.position).toBeNull();
  });

  test('takes the event ID, battery level and position a test gives', () => {
    const position = syntheticPosition();
    const eventId = syntheticEventId();

    expect(
      syntheticHeartbeat({ journeyId: syntheticUuid(), eventId, batteryLevel: 0.5, position }),
    ).toMatchObject({ eventId, batteryLevel: 0.5, position });
  });

  test('the test kit hands them all out', () => {
    expect(kit.syntheticHeartbeat).toBe(syntheticHeartbeat);
    expect(kit.syntheticCoordinate).toBe(syntheticCoordinate);
    expect(kit.syntheticBatteryLevel).toBe(syntheticBatteryLevel);
    expect(kit.syntheticAccuracy).toBe(syntheticAccuracy);
    expect(kit.syntheticPhoneTime).toBe(syntheticPhoneTime);
    expect(kit.SYNTHETIC_EVENT_ID_PREFIX).toBe(SYNTHETIC_EVENT_ID_PREFIX);
  });
});
