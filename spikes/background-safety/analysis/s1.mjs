// SPIKE-01-AC5 (S1): 45 minutes in the background, no gap longer than 2 minutes.
// Pure: judges the receiver's records; reads no clock and no file.
//
// A journey shorter than 45 min is never passed. A gap over 120 s it already
// shows is final, because more watching could only make it longer, so that run
// is failed; any other short run is invalid.
//
// Breaks (the safety review's B2a): a gap over 120 s seen with the harness
// intact is failed, unless a break with a time (a hole in the receiver's
// ticks, or a sleep of the Mac) overlaps that gap. A break the driver saw,
// with no time, makes the run invalid; so does any break when no gap is over
// 120 s. Every break stays in the evidence.
import {
  GAP_LIMIT_MS,
  arrivalsIn,
  gapRule,
  gapSpans,
  harnessBreaks,
  journeyWindow,
  shortRun,
} from './journey.mjs';

/** S1 runs a 45-minute journey. */
const REQUIRED_MS = 45 * 60_000;

/**
 * @param {{ records: object[], breaks?: (string | { text: string, from: number, to: number })[] }} input
 * @returns {{ status: 'passed' | 'failed' | 'invalid', largestGapMs: number,
 *   gapsOver60s: number, gapsOver120s: number,
 *   stateChanges: { afterMs: number, moving: boolean }[], evidence: string[] }}
 */
export function judgeS1({ records, breaks = [] }) {
  const window = journeyWindow(records);
  const arrivals = arrivalsIn(records, window);
  const spans = gapSpans(arrivals, window);
  const gaps = spans.map((gap) => gap.ms);
  const largestGapMs = Math.max(...gaps);
  const harness = harnessBreaks(records, window, breaks);
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

  let status = gapRule(spans, harness) ?? 'passed';
  if (status === 'passed' && short.length > 0) status = 'invalid';
  return {
    status,
    largestGapMs,
    gapsOver60s: gaps.filter((gap) => gap > 60_000).length,
    gapsOver120s: gaps.filter((gap) => gap > GAP_LIMIT_MS).length,
    stateChanges,
    evidence: [...harness.texts, ...short],
  };
}
