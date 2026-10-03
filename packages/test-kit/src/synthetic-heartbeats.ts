/**
 * Synthetic heartbeats: event IDs, positions, battery levels and phone times,
 * made fresh on every run (RG-07, LOST-01).
 *
 * Every position is inside 1° of 0° 0′. That is open Atlantic in the Gulf of
 * Guinea, hundreds of kilometres from the nearest coast, so no coordinate a
 * test holds can ever be someone's address. Each one is generated at run time,
 * never written out, and has exactly seven decimals with no zero among them,
 * so every rounding a careless log line could print (3 to 7 decimals) is a
 * distinct text to look for. Its whole part is 0 and its first decimal is at
 * least 1, which keeps the shortest of those texts ("0.123", "-0.123") from
 * being a run of zeros that a timestamp could hold by chance.
 *
 * Battery levels and accuracies are odd multiples of 1/64 and 1/8. Both are
 * exact in every number type a column might use (real, double precision or
 * numeric), so what a test sends is what a database hands back, and both
 * print with enough digits ("0.734375", "23.625") to be told apart from
 * anything else in a log.
 *
 * `Math.random`, not a CSPRNG: these values guard nothing. The test kit has
 * no Node types (see synthetic-ids.ts).
 */
import type { HeartbeatPosition } from './fake-journey-store.ts';

/** A position as the phone sends it: the phone's own time is RFC 3339 text with an offset. */
export interface SyntheticPosition {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  recordedAt: string;
}

/** A heartbeat request body, as the phone sends it to `POST /v1/heartbeats`. */
export interface SyntheticHeartbeat {
  journeyId: string;
  eventId: string;
  batteryLevel: number | null;
  position: SyntheticPosition | null;
}

/** What every synthetic event ID starts with, so one is recognisable in any output. */
export const SYNTHETIC_EVENT_ID_PREFIX = 'synthetic-event-';

const HEX = '0123456789abcdef';

/** A synthetic night: the phone times default to some moment in this hour. */
const NIGHT_START_MS = Date.parse('2026-10-01T21:00:00.000Z');
const HOUR_MS = 3_600_000;

function randomBelow(limit: number): number {
  return Math.floor(Math.random() * limit);
}

/** A digit from 1 to 9: never 0, so no rounding ends in a zero that a shorter print would drop. */
function nonZeroDigit(): string {
  return String(1 + randomBelow(9));
}

/**
 * An event ID with the shape the contract admits (letters, digits and `-`,
 * at most 64 characters), fresh each time: the prefix and 16 hex digits.
 */
export function syntheticEventId(): string {
  let out = SYNTHETIC_EVENT_ID_PREFIX;
  for (let i = 0; i < 16; i += 1) {
    out += HEX.charAt(randomBelow(16));
  }
  return out;
}

/**
 * One coordinate, latitude or longitude alike: within 1° of 0, at least 0.1
 * from it, with seven non-zero decimals and a random sign.
 */
export function syntheticCoordinate(): number {
  let decimals = '';
  for (let i = 0; i < 7; i += 1) {
    decimals += nonZeroDigit();
  }
  const sign = randomBelow(2) === 0 ? '' : '-';
  return Number(`${sign}0.${decimals}`);
}

/** A battery level strictly between 0 and 1: an odd number of 64ths, so six decimals. */
export function syntheticBatteryLevel(): number {
  return (2 * randomBelow(32) + 1) / 64;
}

/** An accuracy in metres from 2.125 to 99.875: an odd number of eighths, so three decimals. */
export function syntheticAccuracy(): number {
  return (2 * (8 + randomBelow(392)) + 1) / 8;
}

/** A phone time in the synthetic night, to the millisecond and never on a whole second. */
export function syntheticPhoneTime(): string {
  const wholeSeconds = randomBelow(HOUR_MS / 1_000);
  const milliseconds = 1 + randomBelow(999);
  return new Date(NIGHT_START_MS + wholeSeconds * 1_000 + milliseconds).toISOString();
}

/**
 * A position as the phone sends it. The phone's time is any moment in the
 * synthetic night unless a test says which; a Date is written as UTC.
 */
export function syntheticPosition(options: { recordedAt?: Date | string } = {}): SyntheticPosition {
  const { recordedAt } = options;
  return {
    latitude: syntheticCoordinate(),
    longitude: syntheticCoordinate(),
    accuracyMeters: syntheticAccuracy(),
    recordedAt:
      recordedAt === undefined
        ? syntheticPhoneTime()
        : typeof recordedAt === 'string'
          ? recordedAt
          : recordedAt.toISOString(),
  };
}

/**
 * A heartbeat body for this journey. A fresh event ID, a battery level and a
 * position unless a test gives its own; `null` for either is kept as null, as
 * the phone sends "unknown" and "no position".
 */
export function syntheticHeartbeat(options: {
  journeyId: string;
  eventId?: string;
  batteryLevel?: number | null;
  position?: SyntheticPosition | null;
}): SyntheticHeartbeat {
  return {
    journeyId: options.journeyId,
    eventId: options.eventId ?? syntheticEventId(),
    batteryLevel:
      options.batteryLevel === undefined ? syntheticBatteryLevel() : options.batteryLevel,
    position: options.position === undefined ? syntheticPosition() : options.position,
  };
}

/** A position as the journey store takes it: the phone's time as a Date, the same instant. */
export function toStoredPosition(position: SyntheticPosition): HeartbeatPosition {
  return {
    latitude: position.latitude,
    longitude: position.longitude,
    accuracyMeters: position.accuracyMeters,
    recordedAt: new Date(position.recordedAt),
  };
}
