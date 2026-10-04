/**
 * The watchdog's timing, and the budget it must fit (LOST-02, AR-06).
 *
 * The reliability target gives responders 60 seconds past the five-minute
 * threshold (ALERT_TIME_SLACK_MS). Everything the watchdog and the sender do
 * in time has to fit inside that, so the numbers that decide it live here, in
 * one pure module, where their tests check them against each other:
 *   - the sweep runs every WATCHDOG_INTERVAL_MS, the owner's 10 s within
 *     AR-06's 10 to 15 s (D-107);
 *   - a session idle inside a transaction is ended after
 *     IDLE_IN_TRANSACTION_LIMIT_MS, and the API waits at most
 *     LOCK_WAIT_LIMIT_MS for a row, as does the sweep's one waiting attempt
 *     (D-108);
 *   - a journey still ACTIVE STUCK_AFTER_MS past the threshold, that a sweep
 *     could not move, is reported, and stops the beat. That is more than one
 *     interval plus the idle limit, so a stall the limit already ends is
 *     never reported, and well inside the slack;
 *   - the minute check-in follows a beat at most BEAT_FRESH_MS old: three
 *     sweeps, so two missed sweeps are tolerated and a third is not;
 *   - the sender claims at most CLAIM_BATCH messages at a time, each leased
 *     for CLAIM_LEASE_MS, and a message the push port did not accept waits
 *     `retryDelayMs(attempts)`: 10 s, doubling, capped at 60 s.
 *
 * Pure: no clock, no I/O. The times it compares are the database's, handed
 * in by the module that read them (REL-01, AR-03).
 */
import { LOST_CONTACT_AFTER_MS } from './journey.ts';

/** How long after one sweep finishes the next one starts (D-107). */
export const WATCHDOG_INTERVAL_MS = 10_000;

/**
 * How long PostgreSQL lets a session sit idle inside a transaction before it
 * ends the session and frees its rows (idle_in_transaction_session_timeout),
 * on both process pools. Nothing inside this code's transactions waits for
 * anything but the database, so a healthy gap is milliseconds.
 */
export const IDLE_IN_TRANSACTION_LIMIT_MS = 10_000;

/**
 * How long a statement waits for a row another session holds (lock_timeout):
 * on the API's pool for every statement, and in the sweep's one waiting
 * attempt for a journey past STUCK_AFTER_MS. Above any wait this code
 * causes, and under the idle limit that ends a frozen holder.
 */
export const LOCK_WAIT_LIMIT_MS = 5_000;

/** How long past the five minutes an ACTIVE journey nobody could move counts as stuck. */
export const STUCK_AFTER_MS = 30_000;

/** How old the worker's beat may be for the minute check-in to follow it. */
export const BEAT_FRESH_MS = 30_000;

/** How long a claimed message is the claimer's before another may claim it again. */
export const CLAIM_LEASE_MS = 30_000;

/** How many due messages one claim takes at most. */
export const CLAIM_BATCH = 50;

/** How long past the five minutes the reliability target gives an alert to reach the responders. */
export const ALERT_TIME_SLACK_MS = 60_000;

/** The wait after a message's first failed attempt; each later one doubles it. */
const FIRST_RETRY_DELAY_MS = 10_000;

/** No message waits longer than this between two attempts. */
const RETRY_DELAY_CAP_MS = 60_000;

/**
 * How long a message waits after its `attempts`-th attempt failed: 10 s,
 * doubling, capped at 60 s. A count under one is read as the first attempt,
 * so the wait is never shorter than 10 s.
 */
export function retryDelayMs(attempts: number): number {
  return Math.min(FIRST_RETRY_DELAY_MS * 2 ** (Math.max(attempts, 1) - 1), RETRY_DELAY_CAP_MS);
}

/**
 * Whether a journey silent since `silentSince` is, at `now`, past the point
 * where a sweep that cannot move it must say so: the threshold plus
 * STUCK_AFTER_MS, or more. Both are database times.
 */
export function isStuck({ silentSince, now }: { silentSince: Date; now: Date }): boolean {
  return now.getTime() - silentSince.getTime() >= LOST_CONTACT_AFTER_MS + STUCK_AFTER_MS;
}
