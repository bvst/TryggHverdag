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
// shorter run is invalid, never passed or failed.
import {
  GAP_LIMIT_MS,
  arrivalsIn,
  gapsBetween,
  harnessEvidence,
  journeyWindow,
  markInside,
  shortRun,
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
  const gaps = gapsBetween(arrivals, window);
  const largestGapMs = Math.max(...gaps);
  const broken = harnessEvidence(records, window, breaks);

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
    status = reminderDelayMs !== null && reminderDelayMs <= REMINDER_LIMIT_MS ? 'passed' : 'failed';
    if (whileRunning.length > 0) {
      findings.push(
        `${whileRunning.length} reminder(s) shown before the last arrival, while protection still ran`,
      );
    }
  } else {
    reminderFired = shown.length > 0;
    status = largestGapMs > GAP_LIMIT_MS ? 'failed' : 'passed';
    if (reminderFired) {
      findings.push(
        `${shown.length} reminder(s) said protection had stopped while arrivals continued`,
      );
    }
  }
  if (broken.length > 0 || short.length > 0) status = 'invalid';
  return {
    status,
    arrivalsStopped,
    reminderFired,
    reminderDelayMs,
    largestGapMs,
    findings,
    evidence: [...broken, ...short],
  };
}
