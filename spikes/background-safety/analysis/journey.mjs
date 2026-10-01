// SPIKE-01: what the scenario verdicts share. Pure functions over the
// receiver's records (arrivals, ticks and marks); no clock, no I/O.
//
// Every duration is measured on `mono`, the receiver's monotonic clock, so a
// wall-clock correction mid-run can neither create nor hide a gap.

/** The receiver writes a tick every 10 s. A longer silence than this means it stopped. */
export const TICK_HOLE_MS = 15_000;

/** No two consecutive arrivals may be further apart than this (S1, S2, S3). */
export const GAP_LIMIT_MS = 120_000;

/** The record of the driver's mark `label`. Throws if the run has none. */
export function findMark(records, label) {
  const mark = records.find((record) => record.kind === 'mark' && record.label === label);
  if (mark === undefined) {
    throw new Error(`the run has no "${label}" mark, so it cannot be judged`);
  }
  return mark;
}

/**
 * The driver's mark `label`, which must lie inside the journey's window: a
 * scenario's step outside its journey means the driver broke, and a duration
 * measured from it would mean nothing.
 */
export function markInside(records, label, window) {
  const mark = findMark(records, label);
  if (!inWindow(mark, window)) {
    throw new Error(`the "${label}" mark lies outside the journey, so the run cannot be judged`);
  }
  return mark;
}

/** The journey's window: from its "journey-started" mark to its "journey-ended" mark. */
export function journeyWindow(records) {
  if (!Array.isArray(records)) throw new Error('records must be the list the receiver wrote');
  const start = findMark(records, 'journey-started');
  const end = findMark(records, 'journey-ended');
  if (end.mono < start.mono) {
    throw new Error('the "journey-ended" mark comes before the "journey-started" mark');
  }
  return { start, end };
}

/** Whether `record` falls inside the window, both ends included. */
export const inWindow = (record, { start, end }) =>
  record.mono >= start.mono && record.mono <= end.mono;

/** The arrivals inside the window, in the order the receiver wrote them. */
export const arrivalsIn = (records, window) =>
  records.filter((record) => record.kind === 'arrival' && inWindow(record, window));

/** Each silence between start, the arrivals and end, in ms. Never empty. */
export function gapsBetween(arrivals, { start, end }) {
  const times = [start.mono, ...arrivals.map((arrival) => arrival.mono), end.mono];
  return times.slice(1).map((time, i) => time - times[i]);
}

/** "12 min 5 s", for evidence and findings. */
export function duration(ms) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/**
 * A run shorter than its scenario needs: the evidence for it, as a list of one
 * line, or an empty list when the run lasted long enough (equal is enough).
 * `describe(measured, required)` writes the line from both durations. When the
 * shortfall is too small to show in whole seconds, it is added in ms, so the
 * line never reads as "45 min, and 45 min is needed".
 */
export function shortRun(measuredMs, requiredMs, describe) {
  if (measuredMs >= requiredMs) return [];
  const required = duration(requiredMs);
  let measured = duration(measuredMs);
  if (measured === required) measured += ` (${requiredMs - measuredMs} ms short)`;
  return [describe(measured, required)];
}

/**
 * A break: words alone (one the driver saw, with no time), or
 * { text, from, to }, its span on the Mac's wall clock in ms (a sleep, as
 * readSleeps gives it). Throws on anything else.
 */
function checkBreaks(breaks) {
  const ok = (found) =>
    (typeof found === 'string' && found !== '') ||
    (typeof found?.text === 'string' &&
      found.text !== '' &&
      Number.isFinite(found.from) &&
      Number.isFinite(found.to));
  if (!Array.isArray(breaks) || !breaks.every(ok)) {
    throw new Error('breaks must be a list of descriptions, each with its span or none');
  }
}

/**
 * The harness's breaks inside the window, sorted by kind:
 * - untimed: the driver's, which could have been at any time;
 * - timed: each with its span, on the receiver's monotonic clock (a hole in the
 *   ticks) or on the Mac's wall clock (a sleep);
 * - texts: every break's words, for the evidence.
 */
export function harnessBreaks(records, window, breaks = []) {
  checkBreaks(breaks);
  const ticks = records
    .filter((record) => record.kind === 'tick' && inWindow(record, window))
    .map((tick) => tick.mono);
  const times = [window.start.mono, ...ticks, window.end.mono];
  const holes = [];
  for (let i = 1; i < times.length; i++) {
    const silence = times[i] - times[i - 1];
    if (silence > TICK_HOLE_MS) {
      const from = duration(times[i - 1] - window.start.mono);
      holes.push({
        text: `the receiver wrote no tick for ${duration(silence)}, from ${from} into the journey`,
        clock: 'mono',
        from: times[i - 1],
        to: times[i],
      });
    }
  }
  const untimed = breaks.filter((found) => typeof found === 'string');
  const slept = breaks
    .filter((found) => typeof found !== 'string')
    .map(({ text, from, to }) => ({ text, clock: 'wall', from, to }));
  const timed = [...slept, ...holes];
  return { untimed, timed, texts: [...untimed, ...timed.map((found) => found.text)] };
}

/**
 * Why the harness, not the device, may have decided the run: the breaks the
 * driver saw and the Mac's sleeps, kept word for word, and every hole in the
 * receiver's ticks inside the window. An empty list means the run is valid.
 */
export function harnessEvidence(records, window, breaks = []) {
  return harnessBreaks(records, window, breaks).texts;
}

/** Each silence between start, the arrivals and end, with its span on both clocks. */
export function gapSpans(arrivals, { start, end }) {
  const points = [start, ...arrivals, end];
  return points.slice(1).map((point, i) => ({
    ms: point.mono - points[i].mono,
    mono: [points[i].mono, point.mono],
    wall: [points[i].at, point.at],
  }));
}

/** The span between two records (or marks), on both clocks: { mono: [a, b], wall: [a, b] }. */
export const spanOf = (from, to) => ({ mono: [from.mono, to.mono], wall: [from.at, to.at] });

/** The span from `from` to `ms` after it, on both clocks. */
export const spanAfter = (from, ms) => ({
  mono: [from.mono, from.mono + ms],
  wall: [from.at, from.at + ms],
});

/**
 * Whether a timed break overlaps a span, on the break's own clock (a hole in
 * the ticks on `mono`, a sleep on the Mac's wall clock). Touching is not
 * overlapping: a break that ends as the span starts takes nothing from it.
 */
export function breakOver(found, span) {
  const [from, to] = found.clock === 'mono' ? span.mono : span.wall;
  return found.from < to && found.to > from;
}

/**
 * The longest stretch of a gap the harness was intact for: every timed break
 * taken out of it together, each on its own clock, measured from the gap's
 * start (review loop 2).
 */
export function longestIntact(gap, timed) {
  const cuts = [];
  for (const found of timed) {
    if (!breakOver(found, gap)) continue;
    const [from] = found.clock === 'mono' ? gap.mono : gap.wall;
    const start = Math.max(0, found.from - from);
    const end = Math.min(gap.ms, found.to - from);
    if (end > start) cuts.push([start, end]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  let longest = 0;
  let at = 0;
  for (const [start, end] of cuts) {
    longest = Math.max(longest, start - at);
    at = Math.max(at, end);
  }
  return Math.max(longest, gap.ms - at);
}

/**
 * The 120 s rule with the harness's breaks, judged on intact stretches (the
 * safety review's B2a, made strict in review loop 2): a gap with a stretch
 * over 120 s left once every timed break is taken out of it was seen with the
 * harness intact, so it is 'failed'. 'invalid' when an untimed break exists
 * (it could have been anywhere), or when a timed break exists and no such
 * stretch is left; null otherwise.
 */
export function gapRule(gaps, { untimed, timed }) {
  if (untimed.length > 0) return 'invalid';
  const seen = gaps.filter((gap) => gap.ms > GAP_LIMIT_MS);
  if (seen.some((gap) => longestIntact(gap, timed) > GAP_LIMIT_MS)) return 'failed';
  if (timed.length > 0) return 'invalid';
  return null;
}

/**
 * A failure that shows in one span of the run (review loop 2): it stays
 * 'failed' unless a break could explain it, which makes it 'invalid': a break
 * with no time, or a timed break over that span. A timed break elsewhere does
 * not rescue it.
 */
export function failureRule({ untimed, timed }, span) {
  if (untimed.length > 0) return 'invalid';
  return timed.some((found) => breakOver(found, span)) ? 'invalid' : 'failed';
}
