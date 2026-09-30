// SPIKE-01-AC7 (S3, Android): stock Android's restrictions, with and without the
// battery-optimisation exemption. Pure: reads no clock and no file.
//
// The restrictions must hold for 45 min, from the "restrictions-started" mark
// to the journey's end. A shorter run is never passed. A failure it already
// shows is final, so that run is failed: with the exemption, a gap over 120 s;
// without it, no "not exempt" report before the restrictions started. Any other
// short run is invalid. A break still makes any run invalid.
import {
  GAP_LIMIT_MS,
  arrivalsIn,
  gapsBetween,
  harnessEvidence,
  journeyWindow,
  markInside,
  shortRun,
} from './journey.mjs';

/** S3 holds the device in the restrictions for 45 minutes. */
const REQUIRED_MS = 45 * 60_000;

/**
 * With the exemption, judged by the 120 s rule. Without it, judged by whether
 * the app's "not exempt" report reached the receiver before the restrictions
 * started; what the restrictions then did is recorded, not judged.
 *
 * @param {{ exemption: boolean, records: object[], breaks?: string[] }} input
 */
export function judgeS3({ exemption, records, breaks = [] }) {
  if (typeof exemption !== 'boolean') {
    throw new Error('exemption must say whether this run had the exemption (true or false)');
  }
  const window = journeyWindow(records);
  const restricted = markInside(records, 'restrictions-started', window);
  const arrivals = arrivalsIn(records, window);
  const gaps = gapsBetween(arrivals, window);
  const largestGapMs = Math.max(...gaps);
  const broken = harnessEvidence(records, window, breaks);
  const short = shortRun(
    window.end.mono - restricted.mono,
    REQUIRED_MS,
    (measured, required) => `the restrictions held for ${measured}, and S3 needs ${required}`,
  );
  const notExemptReported = arrivals.some(
    (arrival) => arrival.exempt === false && arrival.mono < restricted.mono,
  );

  const failed = exemption ? largestGapMs > GAP_LIMIT_MS : !notExemptReported;
  let status = 'passed';
  if (broken.length > 0) status = 'invalid';
  else if (failed) status = 'failed';
  else if (short.length > 0) status = 'invalid';
  return {
    status,
    exemption,
    notExemptReported,
    largestGapMs,
    gapsOver120s: gaps.filter((gap) => gap > GAP_LIMIT_MS).length,
    evidence: [...broken, ...short],
  };
}
