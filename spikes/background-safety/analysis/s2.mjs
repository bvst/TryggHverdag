// SPIKE-01-AC6 (S2): after the app is ended, the reminder fires before the
// lost-contact threshold. Pure: reads no clock and no file.
//
// Reminders are the platform's own record of delivered notifications. They
// carry only a wall-clock time (`at`), so the delay is measured against the
// last arrival's `at`.
import {
  GAP_LIMIT_MS,
  arrivalsIn,
  gapsBetween,
  harnessEvidence,
  journeyWindow,
} from './journey.mjs';

/** D-021: lost contact after 5 minutes of silence. The reminder must come first. */
const REMINDER_LIMIT_MS = 5 * 60_000;

/**
 * @param {{ records: object[], reminders: { at: number }[], breaks?: string[] }} input
 */
export function judgeS2({ records, reminders, breaks = [] }) {
  const window = journeyWindow(records);
  if (!Array.isArray(reminders) || reminders.some((r) => !Number.isFinite(r?.at))) {
    throw new Error('reminders must be a list of delivered notifications, each with its time');
  }
  const arrivals = arrivalsIn(records, window);
  const gaps = gapsBetween(arrivals, window);
  const largestGapMs = Math.max(...gaps);
  const evidence = harnessEvidence(records, window, breaks);

  const last = arrivals.at(-1);
  const arrivalsStopped = last === undefined || window.end.mono - last.mono > GAP_LIMIT_MS;
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
  if (evidence.length > 0) status = 'invalid';
  return {
    status,
    arrivalsStopped,
    reminderFired,
    reminderDelayMs,
    largestGapMs,
    findings,
    evidence,
  };
}
