// SPIKE-01-AC6 (S2): after the app is ended, the reminder fires before the
// lost-contact threshold. Pure: reads no clock and no file.
//
// Reminders are the platform's own record of delivered notifications. They
// carry only a wall-clock time (`at`), so the delay is measured against the
// last arrival's `at`.
//
// The run must watch for 6 min: the 5 min a reminder may take, plus 1 min for
// the device's clock against the Mac's, the platform writing its record after
// showing the reminder, and the rule's own 60 s step. They count from the
// "app-ended" mark, or from the last arrival when arrivals stopped after it. A
// shorter run is never passed. A failure it already shows is final (the code
// review's S5): a reminder seen more than 5 min after the last arrival, or,
// while arrivals went on, a gap over 120 s; more watching could change
// neither. Any other short run is invalid.
//
// Breaks (review loop 2): a failure is judged where it shows. When arrivals
// stopped, a late or missing reminder is failed unless a break could explain
// it: one with no time, or a timed break over the 5 min after the last
// arrival. When arrivals went on, the 120 s rule is judged on the stretches
// of each gap the harness was intact for, as in S1. A run that would pass is
// invalid with any break. Every break stays in the evidence.
import {
  GAP_LIMIT_MS,
  arrivalsIn,
  failureRule,
  gapRule,
  gapSpans,
  harnessBreaks,
  journeyWindow,
  markInside,
  shortRun,
  spanAfter,
  spanOf,
} from './journey.mjs';

/** D-021: lost contact after 5 minutes of silence. The reminder must come first. */
const REMINDER_LIMIT_MS = 5 * 60_000;
/** How long the run must watch: the reminder's 5 min plus a 1 min margin. */
const REQUIRED_MS = REMINDER_LIMIT_MS + 60_000;

/**
 * @param {{ records: object[], reminders: { at: number }[], breaks?: string[] }} input
 */
export function judgeS2({ records, reminders, breaks = [] }) {
  const window = journeyWindow(records);
  const ended = markInside(records, 'app-ended', window);
  if (!Array.isArray(reminders) || reminders.some((r) => !Number.isFinite(r?.at))) {
    throw new Error('reminders must be a list of delivered notifications, each with its time');
  }
  const arrivals = arrivalsIn(records, window);
  const spans = gapSpans(arrivals, window);
  const largestGapMs = Math.max(...spans.map((gap) => gap.ms));
  const harness = harnessBreaks(records, window, breaks);

  const last = arrivals.at(-1);
  const arrivalsStopped = last === undefined || window.end.mono - last.mono > GAP_LIMIT_MS;
  const from = arrivalsStopped && last !== undefined && last.mono > ended.mono ? last : ended;
  const short = shortRun(window.end.mono - from.mono, REQUIRED_MS, (measured, required) =>
    from === ended
      ? `the run watched ${measured} after the app was ended, and S2 needs ${required}`
      : `the run watched ${measured} after the last arrival, and S2 needs ${required}`,
  );
  const shown = reminders
    .filter((reminder) => reminder.at >= window.start.at)
    .sort((a, b) => a.at - b.at);
  const findings = [];

  let status;
  let reminderFired;
  let reminderDelayMs = null;
  if (arrivalsStopped) {
    const whileRunning = last === undefined ? [] : shown.filter((r) => r.at < last.at);
    const counted = last === undefined ? undefined : shown.find((r) => r.at >= last.at);
    reminderFired = counted !== undefined;
    if (counted !== undefined) reminderDelayMs = counted.at - last.at;
    const onTime = reminderDelayMs !== null && reminderDelayMs <= REMINDER_LIMIT_MS;
    if (!onTime) {
      // The reminder had 5 min from the last arrival: only a break over them can explain it.
      const decided =
        last === undefined ? spanOf(window.start, window.end) : spanAfter(last, REMINDER_LIMIT_MS);
      status = failureRule(harness, decided);
    } else {
      status = harness.texts.length > 0 ? 'invalid' : 'passed';
    }
    if (whileRunning.length > 0) {
      findings.push(
        `${whileRunning.length} reminder(s) shown before the last arrival, while protection still ran`,
      );
    }
  } else {
    reminderFired = shown.length > 0;
    status = gapRule(spans, harness) ?? 'passed';
    if (reminderFired) {
      findings.push(
        `${shown.length} reminder(s) said protection had stopped while arrivals continued`,
      );
    }
  }
  // Failed with a late reminder already seen, or with a gap while arrivals went on.
  const final = status === 'failed' && (!arrivalsStopped || reminderDelayMs !== null);
  if (short.length > 0 && !final) status = 'invalid';
  return {
    status,
    arrivalsStopped,
    reminderFired,
    reminderDelayMs,
    largestGapMs,
    findings,
    evidence: [...harness.texts, ...short],
  };
}
