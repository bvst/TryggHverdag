/**
 * The ports: what the server needs from the outside world, as interfaces
 * (AR-02).
 *
 * They live here rather than in adapters/ so that modules can depend on the
 * shape without depending on the implementation, and so that the test kit can
 * satisfy them structurally without importing any server code.
 */

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
