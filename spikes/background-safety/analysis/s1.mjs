// SPIKE-01-AC5 (S1): 45 minutes in the background, no gap longer than 2 minutes.
// Pure: judges the receiver's records; reads no clock and no file.
import {
  GAP_LIMIT_MS,
  arrivalsIn,
  gapsBetween,
  harnessEvidence,
  journeyWindow,
} from './journey.mjs';

/**
 * @param {{ records: object[], breaks?: string[] }} input
 * @returns {{ status: 'passed' | 'failed' | 'invalid', largestGapMs: number,
 *   gapsOver60s: number, gapsOver120s: number,
 *   stateChanges: { afterMs: number, moving: boolean }[], evidence: string[] }}
 */
export function judgeS1({ records, breaks = [] }) {
  const window = journeyWindow(records);
  const arrivals = arrivalsIn(records, window);
  const gaps = gapsBetween(arrivals, window);
  const largestGapMs = Math.max(...gaps);
  const evidence = harnessEvidence(records, window, breaks);

  const stateChanges = [];
  let moving = null;
  for (const arrival of arrivals) {
    if (typeof arrival.moving !== 'boolean') continue;
    if (moving !== null && arrival.moving !== moving) {
      stateChanges.push({ afterMs: arrival.mono - window.start.mono, moving: arrival.moving });
    }
    moving = arrival.moving;
  }

  let status = largestGapMs > GAP_LIMIT_MS ? 'failed' : 'passed';
  if (evidence.length > 0) status = 'invalid';
  return {
    status,
    largestGapMs,
    gapsOver60s: gaps.filter((gap) => gap > 60_000).length,
    gapsOver120s: gaps.filter((gap) => gap > GAP_LIMIT_MS).length,
    stateChanges,
    evidence,
  };
}
