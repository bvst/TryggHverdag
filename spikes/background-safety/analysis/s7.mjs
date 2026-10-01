// SPIKE-01-AC11 (S7): a reduced location permission is reported to the receiver
// within 60 s of the change. Pure: reads no clock and no file.
//
// The app's report is the first arrival at or after the driver's
// "permission-reduced" mark whose `permission` differs from the one reported
// before it. Both are timed on the receiver's monotonic clock.
//
// The run must watch for 60 s after the change, with no margin: the report and
// the mark are on the same clock. A shorter run is invalid, never passed or
// failed.
//
// Breaks (review loop 2): the failure is settled 60 s after the change. A
// timed break over any part of those 60 s, or one with no time, makes a run
// with no report in time invalid; a timed break wholly before the change or
// after those 60 s does not rescue it. A run that would pass is invalid with
// any break. Every break stays in the evidence.
import {
  arrivalsIn,
  failureRule,
  harnessBreaks,
  journeyWindow,
  markInside,
  shortRun,
  spanAfter,
} from './journey.mjs';

const REPORT_LIMIT_MS = 60_000;

/** @param {{ records: object[], breaks?: string[] }} input */
export function judgeS7({ records, breaks = [] }) {
  const window = journeyWindow(records);
  const change = markInside(records, 'permission-reduced', window);
  const arrivals = arrivalsIn(records, window);
  const harness = harnessBreaks(records, window, breaks);
  const short = shortRun(
    window.end.mono - change.mono,
    REPORT_LIMIT_MS,
    (measured, required) =>
      `the run watched ${measured} after the change, and S7 needs ${required}`,
  );

  let previous = null;
  let report = null;
  for (const arrival of arrivals) {
    if (arrival.permission == null) continue;
    const differs = previous !== null && arrival.permission !== previous;
    if (report === null && arrival.mono >= change.mono && differs) report = arrival;
    previous = arrival.permission;
  }
  const afterChange = arrivals.filter((arrival) => arrival.mono >= change.mono);
  const reportDelayMs = report === null ? null : report.mono - change.mono;

  const inTime = reportDelayMs !== null && reportDelayMs <= REPORT_LIMIT_MS;
  let status;
  if (inTime) status = harness.texts.length > 0 ? 'invalid' : 'passed';
  else status = failureRule(harness, spanAfter(change, REPORT_LIMIT_MS));
  if (short.length > 0) status = 'invalid';
  return {
    status,
    reportDelayMs,
    arrivalsAfterChange: afterChange.length,
    withoutPositionAfterChange: afterChange.filter((arrival) => arrival.hasPosition === false)
      .length,
    evidence: [...harness.texts, ...short],
  };
}
