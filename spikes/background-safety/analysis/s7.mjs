// SPIKE-01-AC11 (S7): a reduced location permission is reported to the receiver
// within 60 s of the change. Pure: reads no clock and no file.
//
// The app's report is the first arrival at or after the driver's
// "permission-reduced" mark whose `permission` differs from the one reported
// before it. Both are timed on the receiver's monotonic clock.
import { arrivalsIn, findMark, harnessEvidence, journeyWindow } from './journey.mjs';

const REPORT_LIMIT_MS = 60_000;

/** @param {{ records: object[], breaks?: string[] }} input */
export function judgeS7({ records, breaks = [] }) {
  const window = journeyWindow(records);
  const change = findMark(records, 'permission-reduced');
  const arrivals = arrivalsIn(records, window);
  const evidence = harnessEvidence(records, window, breaks);

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

  let status = reportDelayMs !== null && reportDelayMs <= REPORT_LIMIT_MS ? 'passed' : 'failed';
  if (evidence.length > 0) status = 'invalid';
  return {
    status,
    reportDelayMs,
    arrivalsAfterChange: afterChange.length,
    withoutPositionAfterChange: afterChange.filter((arrival) => arrival.hasPosition === false)
      .length,
    evidence,
  };
}
