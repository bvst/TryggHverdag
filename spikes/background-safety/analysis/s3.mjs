// SPIKE-01-AC7 (S3, Android): stock Android's restrictions, with and without the
// battery-optimisation exemption. Pure: reads no clock and no file.
import {
  GAP_LIMIT_MS,
  arrivalsIn,
  findMark,
  gapsBetween,
  harnessEvidence,
  journeyWindow,
} from './journey.mjs';

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
  const restricted = findMark(records, 'restrictions-started');
  const arrivals = arrivalsIn(records, window);
  const gaps = gapsBetween(arrivals, window);
  const largestGapMs = Math.max(...gaps);
  const evidence = harnessEvidence(records, window, breaks);
  const notExemptReported = arrivals.some(
    (arrival) => arrival.exempt === false && arrival.mono < restricted.mono,
  );

  let status;
  if (exemption) status = largestGapMs > GAP_LIMIT_MS ? 'failed' : 'passed';
  else status = notExemptReported ? 'passed' : 'failed';
  if (evidence.length > 0) status = 'invalid';
  return {
    status,
    exemption,
    notExemptReported,
    largestGapMs,
    gapsOver120s: gaps.filter((gap) => gap > GAP_LIMIT_MS).length,
    evidence,
  };
}
