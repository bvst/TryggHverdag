/**
 * The ports: what the server needs from the outside world, as interfaces
 * (AR-02).
 *
 * They live here rather than in adapters/ so that modules can depend on the
 * shape without depending on the implementation, and so that the test kit can
 * satisfy them structurally without importing any server code.
 */
import type { JourneyForHeartbeat, UnendedJourney } from './domain/journey.ts';

/**
 * The time, from the database (REL-01).
 *
 * Asynchronous on purpose. A synchronous clock would be one `Date.now()` away
 * from every process using its own slightly different time, and a safety
 * decision made on a server whose clock drifted is a safety decision made on
 * the wrong minute. Async keeps the database as the single source of now.
 */
export interface Clock {
  now(): Promise<Date>;
}

/** The worker's periodic "I am still here". */
export interface WorkerHeartbeats {
  /** The last check-in, or null when the worker has never run. */
  lastBeat(): Promise<Date | null>;
  record(at: Date): Promise<void>;
}

/**
 * The worker's "I am still here", told to an outside monitor (INF-08). The
 * monitor pages the owner when these stop, so it must only ever follow a beat
 * that was recorded.
 */
export interface CheckIn {
  /** Resolves when the monitor accepted it; rejects on anything else. */
  checkIn(): Promise<void>;
}

/** Who a device credential belongs to. */
export interface AuthenticatedDevice {
  deviceId: string;
  userId: string;
}

/**
 * Which device sent a request (SEC-07).
 *
 * Three answers, kept apart on purpose: the device, `null` for a credential no
 * device has, and a rejection when it cannot check at all. The API answers the
 * second with 401 and the third with 500, because a 401 tells an app its
 * credential is bad, and a database that blinked must never sign a walker out.
 */
export interface DeviceAuthenticator {
  authenticate(credential: string): Promise<AuthenticatedDevice | null>;
}

/** A start to be stored: the domain's decision, timed by the clock. */
export interface StartedJourney {
  walkerId: string;
  /** The device that sent the start: the only one whose heartbeats the journey takes (D-101). */
  deviceId: string;
  /** Distinct, and at least one: the domain refuses anything else. */
  responderIds: readonly string[];
  startedAt: Date;
}

/** Stored, or refused because the walker already has an unended journey. */
export type InsertStartedResult =
  { inserted: true; journeyId: string } | { inserted: false; unendedJourneyId: string };

/** A position as the phone recorded it. Its time is the phone's: a label, never a decision (REL-01). */
export interface HeartbeatPosition {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  recordedAt: Date;
}

/** A heartbeat to be stored, timed by the clock as it arrived (SM-09). */
export interface HeartbeatToRecord {
  journeyId: string;
  eventId: string;
  receivedAt: Date;
  /** From 0 to 1, or null for unknown. */
  batteryLevel: number | null;
  position: HeartbeatPosition | null;
}

/**
 * Stored; already there, so nothing changed (SM-08); or the journey had ENDED
 * by the time it was written, so nothing was stored (SM-07).
 */
export interface RecordHeartbeatResult {
  outcome: 'recorded' | 'duplicate' | 'ended';
}

/**
 * A journey's latest heartbeat: the greatest receive time, a tie to the one
 * stored last. No coordinates: "location unavailable" is `!hasPosition`.
 */
export interface LatestHeartbeat {
  receivedAt: Date;
  hasPosition: boolean;
  batteryLevel: number | null;
}

/** Journeys, their responders, their heartbeats, and the users all of them must be (SM-01, LOST-01). */
export interface JourneyStore {
  /** The walker's journey in any state but ENDED, or null. */
  unendedJourneyOf(walkerId: string): Promise<UnendedJourney | null>;
  /** Which of these IDs are users. */
  existingUsers(ids: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * Stores the journey ACTIVE with its responders, all of it or none of it.
   * When the walker already has an unended journey, as when two starts race
   * past `unendedJourneyOf`, nothing is stored and that journey is named.
   * Rejects a start with no responders, and stores nothing.
   */
  insertStarted(journey: StartedJourney): Promise<InsertStartedResult>;
  /** The journey this ID names, in any state, ENDED included, or null. */
  journeyForHeartbeat(journeyId: string): Promise<JourneyForHeartbeat | null>;
  /**
   * Stores the heartbeat and its position, if any, once per (journey, event
   * ID), and moves last contact forward to its receive time, never back: all
   * of it or none of it. A duplicate changes nothing, last contact included,
   * and a journey ENDED by the time of the write takes nothing.
   */
  recordHeartbeat(heartbeat: HeartbeatToRecord): Promise<RecordHeartbeatResult>;
  /** The journey's latest heartbeat, or null when it has none. */
  latestHeartbeatOf(journeyId: string): Promise<LatestHeartbeat | null>;
}

/**
 * Every line the server may log, and nothing else (PRIV-07). A closed union:
 * no event has a field a location, a phone number or an error's message
 * could travel in. `code` is a SQLSTATE or null, never a message.
 */
export type LogEvent =
  | { event: 'heartbeat_ignored'; reason: 'JOURNEY_ENDED'; journeyId: string }
  | { event: 'heartbeat_failed'; stage: 'clock' | 'read' | 'store'; code: string | null };

/** Where the server writes what happened, one event at a time. */
export interface Log {
  write(event: LogEvent): void;
}
