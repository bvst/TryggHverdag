/**
 * The ports: what the server needs from the outside world, as interfaces
 * (AR-02).
 *
 * They live here rather than in adapters/ so that modules can depend on the
 * shape without depending on the implementation, and so that the test kit can
 * satisfy them structurally without importing any server code.
 */
import type { UnendedJourney } from './domain/journey.ts';

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
  /** Distinct, and at least one: the domain refuses anything else. */
  responderIds: readonly string[];
  startedAt: Date;
}

/** Stored, or refused because the walker already has an unended journey. */
export type InsertStartedResult =
  { inserted: true; journeyId: string } | { inserted: false; unendedJourneyId: string };

/** Journeys, their responders, and the users both must be (SM-01). */
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
}
