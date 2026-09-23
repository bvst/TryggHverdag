/**
 * Is the worker still doing its job?
 *
 * The worker owns the watchdog, and the watchdog is what turns silence from a
 * phone into an alert. So an API that answers cheerfully while the worker is
 * dead is describing a system in which nobody is watching anyone walk home.
 * This is the rule that decides which of those two the server is in.
 *
 * Pure by construction (AR-02): milliseconds in, a decision out. The time comes
 * from the caller, because safety decisions use the database clock and tests
 * need to state the time rather than wait for it (AR-03, REL-01).
 */

export type HealthStatus = 'ok' | 'degraded';

export interface WorkerHealth {
  status: HealthStatus;
  /** How long the worker has been silent, or null when it has never checked in. */
  silentForMs: number | null;
}

export interface WorkerHealthInput {
  nowMs: number;
  /** The worker's last check-in, or null when it has never checked in. */
  lastBeatMs: number | null;
  staleAfterMs: number;
}

export function assessWorkerHealth({
  nowMs,
  lastBeatMs,
  staleAfterMs,
}: WorkerHealthInput): WorkerHealth {
  if (lastBeatMs === null) {
    // Never having run is not the same as running late, but it is not healthy
    // either: at this moment the watchdog has never swept a single journey.
    return { status: 'degraded', silentForMs: null };
  }

  // Clocks disagree, and a beat stamped in the future would otherwise produce
  // negative silence — which passes every threshold and looks healthy forever.
  const silentForMs = Math.max(0, nowMs - lastBeatMs);

  return { status: silentForMs > staleAfterMs ? 'degraded' : 'ok', silentForMs };
}
