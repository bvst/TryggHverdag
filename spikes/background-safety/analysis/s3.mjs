// SPIKE-01-AC7 (S3, Android): stock Android's restrictions, with and without the
// battery-optimisation exemption. Pure: reads no clock and no file.
//
// The restrictions must hold for 45 min, from the "restrictions-started" mark
// to the journey's end. A shorter run is never passed. A failure it already
// shows is final, so that run is failed: with the exemption, a gap over 120 s;
// without it, no "not exempt" report before the restrictions started. Any other
// short run is invalid.
//
// Breaks: with the exemption, as in S1 (the safety review's B2a), a gap over
// 120 s seen with the harness intact is failed unless a break with a time
// overlaps it; a break with no time, or any break when no gap is over 120 s,
// makes the run invalid. Without the exemption, any break makes the run
// invalid. Every break stays in the evidence.
//
// Which restrictions held comes from the driver's readings at the start and the
// end (`inForce`): deep Doze (`dumpsys deviceidle get deep` = IDLE) and the
// restricted standby bucket (`am get-standby-bucket` = 45). A restriction is in
// force only if both readings show it; one that did not hold is not shown.
// Android re-promotes a journeying app out of the restricted bucket, so a pass
// rests on deep Doze. With the exemption, a run in which deep Doze did not hold
// is invalid unless it already failed.
import {
  GAP_LIMIT_MS,
  arrivalsIn,
  gapRule,
  gapSpans,
  harnessBreaks,
  journeyWindow,
  markInside,
  shortRun,
} from './journey.mjs';

/** S3 holds the device in the restrictions for 45 minutes. */
const REQUIRED_MS = 45 * 60_000;

const DOZE = 'deep Doze';
const BUCKET = 'the restricted standby bucket';

const isReading = (reading) =>
  typeof reading?.idle === 'string' && typeof reading?.bucket === 'string';

/** Which restrictions held at both readings, and which did not. */
function restrictionsHeld(inForce) {
  if (!isReading(inForce?.start) || !isReading(inForce?.end)) {
    throw new Error(
      'inForce must hold the readings at the start and the end (idle and bucket), ' +
        'so the run is not judged as if the restrictions held',
    );
  }
  const { start, end } = inForce;
  const held = {
    [DOZE]: start.idle === 'IDLE' && end.idle === 'IDLE',
    [BUCKET]: start.bucket === '45' && end.bucket === '45',
  };
  const names = Object.keys(held);
  return {
    doze: held[DOZE],
    readings: `idle ${start.idle} then ${end.idle}, bucket ${start.bucket} then ${end.bucket}`,
    restrictions: {
      inForce: names.filter((name) => held[name]),
      notShown: names.filter((name) => !held[name]),
    },
  };
}

/**
 * With the exemption, judged by the 120 s rule. Without it, judged by whether
 * the app's "not exempt" report reached the receiver before the restrictions
 * started; what the restrictions then did is recorded, not judged.
 *
 * @param {{ exemption: boolean, records: object[],
 *   breaks?: (string | { text: string, from: number, to: number })[],
 *   inForce: { start: { idle: string, bucket: string }, end: { idle: string, bucket: string } } }} input
 */
export function judgeS3({ exemption, records, breaks = [], inForce }) {
  if (typeof exemption !== 'boolean') {
    throw new Error('exemption must say whether this run had the exemption (true or false)');
  }
  const { doze, readings, restrictions } = restrictionsHeld(inForce);
  const window = journeyWindow(records);
  const restricted = markInside(records, 'restrictions-started', window);
  const arrivals = arrivalsIn(records, window);
  const spans = gapSpans(arrivals, window);
  const gaps = spans.map((gap) => gap.ms);
  const largestGapMs = Math.max(...gaps);
  const harness = harnessBreaks(records, window, breaks);
  const short = shortRun(
    window.end.mono - restricted.mono,
    REQUIRED_MS,
    (measured, required) => `the restrictions held for ${measured}, and S3 needs ${required}`,
  );
  const notExemptReported = arrivals.some(
    (arrival) => arrival.exempt === false && arrival.mono < restricted.mono,
  );
  const noDoze =
    exemption && !doze ? [`deep Doze did not hold for the whole run (${readings})`] : [];

  let status = 'passed';
  if (exemption) {
    status = gapRule(spans, harness) ?? 'passed';
  } else if (harness.texts.length > 0) {
    status = 'invalid';
  } else if (!notExemptReported) {
    status = 'failed';
  }
  if (status === 'passed' && (short.length > 0 || noDoze.length > 0)) status = 'invalid';
  return {
    status,
    exemption,
    notExemptReported,
    largestGapMs,
    gapsOver120s: gaps.filter((gap) => gap > GAP_LIMIT_MS).length,
    restrictions,
    evidence: [...harness.texts, ...short, ...noDoze],
  };
}
