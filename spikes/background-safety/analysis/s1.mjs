// SPIKE-01-AC5 (S1): 45 minutes in the background, no gap longer than 2 minutes.
// Pure: judges the receiver's records; reads no clock and no file.
//
// A journey shorter than 45 min is never passed. A gap over 120 s it already
// shows is final, because more watching could only make it longer, so that run
// is failed; any other short run is invalid. A break still makes any run invalid.
import {
  GAP_LIMIT_MS,
  arrivalsIn,
  gapsBetween,
  harnessEvidence,
  journeyWindow,
  shortRun,
} from './journey.mjs';

/** S1 runs a 45-minute journey. */
const REQUIRED_MS = 45 * 60_000;

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
  const broken = harnessEvidence(records, window, breaks);
  const short = shortRun(
    window.end.mono - window.start.mono,
    REQUIRED_MS,
    (measured, required) => `the journey lasted ${measured}, and S1 needs ${required}`,
  );

  const stateChanges = [];
  let moving = null;
  for (const arrival of arrivals) {
    if (typeof arrival.moving !== 'boolean') continue;
    if (moving !== null && arrival.moving !== moving) {
      stateChanges.push({ afterMs: arrival.mono - window.start.mono, moving: arrival.moving });
    }
    moving = arrival.moving;
  }

  let status = 'passed';
  if (broken.length > 0) status = 'invalid';
  else if (largestGapMs > GAP_LIMIT_MS) status = 'failed';
  else if (short.length > 0) status = 'invalid';
  return {
    status,
    largestGapMs,
    gapsOver60s: gaps.filter((gap) => gap > 60_000).length,
    gapsOver120s: gaps.filter((gap) => gap > GAP_LIMIT_MS).length,
    stateChanges,
    evidence: [...broken, ...short],
  };
}
