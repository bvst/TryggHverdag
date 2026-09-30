// SPIKE-01: the S2 verdict (analysis/s2.mjs): after the app is ended, the
// reminder fires before the lost-contact threshold.
//
// Records are synthetic and shaped as the receiver writes them (see
// s1.test.mjs). Reminders are the platform's own record of delivered
// notifications, each with its delivery time on the wall clock (`at`), which is
// compared with the last arrival's `at`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const judgeS2 = async (input) => (await import('./s2.mjs')).judgeS2(input);

const S = 1_000;
const MIN = 60 * S;
const WALL0 = Date.UTC(2031, 0, 1, 21, 0, 0);
const MONO0 = 7_000_000;
const APP_ENDED = 10 * MIN;
const END = 20 * MIN;
/** The last arrival when arrivals stop: one queued upload, 10 s after the app was ended. */
const LAST = 10 * MIN + 10 * S;

const iso = (t) => new Date(WALL0 + t).toISOString();
const tick = (t) => ({ kind: 'tick', at: WALL0 + t, mono: MONO0 + t });
const mark = (label, t) => ({ kind: 'mark', label, at: WALL0 + t, mono: MONO0 + t });
const arrival = (t, fields = {}) => ({
  kind: 'arrival',
  at: WALL0 + t,
  mono: MONO0 + t,
  platform: 'android',
  recordId: `rec-${t}`,
  recordedAt: iso(t - 2 * S),
  hasPosition: true,
  moving: true,
  queueCount: 0,
  permission: 'always',
  exempt: true,
  ...fields,
});
const reminder = (t) => ({ at: WALL0 + t });

/** Times from `from` to `to`, `step` apart, both ends included. */
const every = (step, from, to) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

/** One journey's records, in the order the receiver writes them, ticks every 10 s. */
function journey({ end, arrivals = [], marks = [], tickHoles = [] }) {
  const ticks = every(10 * S, -5 * S, end + 5 * S)
    .filter((t) => !tickHoles.some(([from, to]) => t > from && t < to))
    .map(tick);
  return [
    mark('journey-started', 0),
    ...marks,
    ...ticks,
    ...arrivals,
    mark('journey-ended', end),
  ].sort((a, b) => a.mono - b.mono);
}

/** The app is ended at 10 min; one more upload arrives at 10 min 10 s, then nothing. */
const stopped = (options = {}) =>
  journey({
    ...options,
    end: END,
    marks: [mark('app-ended', APP_ENDED)],
    arrivals: [...every(MIN, 30 * S, 9 * MIN + 30 * S), LAST].map((t) => arrival(t)),
  });

/** The location service keeps running after the app is ended. */
const continuing = (times = every(MIN, 30 * S, END - 30 * S)) =>
  journey({
    end: END,
    marks: [mark('app-ended', APP_ENDED)],
    arrivals: times.map((t) => arrival(t)),
  });

test('SPIKE-01-AC6: when arrivals stop, a reminder 5 minutes after the last one passes, and its delay is recorded', async () => {
  const result = await judgeS2({ records: stopped(), reminders: [reminder(LAST + 5 * MIN)] });
  assert.equal(result.status, 'passed');
  assert.equal(result.arrivalsStopped, true);
  assert.equal(result.reminderFired, true);
  assert.equal(result.reminderDelayMs, 5 * MIN);
});

test('SPIKE-01-AC6: a reminder 5 min 1 s after the last arrival fails', async () => {
  const result = await judgeS2({ records: stopped(), reminders: [reminder(LAST + 5 * MIN + S)] });
  assert.equal(result.status, 'failed');
  assert.equal(result.reminderDelayMs, 5 * MIN + S);
});

test('SPIKE-01-AC6: when arrivals stop and no reminder follows the last one, the case fails', async () => {
  const none = await judgeS2({ records: stopped(), reminders: [] });
  assert.equal(none.status, 'failed');
  assert.equal(none.reminderDelayMs, null);

  const onlyBefore = await judgeS2({ records: stopped(), reminders: [reminder(9 * MIN)] });
  assert.equal(
    onlyBefore.status,
    'failed',
    'a reminder before the last arrival is not the one that counts',
  );
});

test('SPIKE-01-AC6: arrivals that never stop pass under the 120 s rule, and the results say no reminder fired', async () => {
  const result = await judgeS2({ records: continuing(), reminders: [] });
  assert.equal(result.status, 'passed');
  assert.equal(result.arrivalsStopped, false);
  assert.equal(result.reminderFired, false);
  assert.deepEqual(result.findings, []);
});

test('SPIKE-01-AC6: a reminder while arrivals continue is a finding, not a pass', async () => {
  const kept = await judgeS2({ records: continuing(), reminders: [reminder(12 * MIN)] });
  assert.equal(kept.status, 'passed', 'the case is judged by the 120 s rule');
  assert.equal(kept.reminderFired, true);
  assert.match(
    kept.findings.join('\n'),
    /reminder/i,
    'the reminder shown while protection ran is not reported',
  );

  const withGap = continuing([
    ...every(MIN, 30 * S, 12 * MIN + 30 * S),
    ...every(MIN, 14 * MIN + 31 * S, END - 29 * S), // 121 s after 12 min 30 s
  ]);
  const notRescued = await judgeS2({ records: withGap, reminders: [reminder(14 * MIN)] });
  assert.equal(notRescued.status, 'failed', 'a reminder does not make up for a gap of 121 s');
});

test("SPIKE-01-AC13: a gap in the receiver's ticks, or a break the driver saw, makes an S2 run invalid", async () => {
  const outage = await judgeS2({
    records: stopped({ tickHoles: [[11 * MIN, 13 * MIN]] }),
    reminders: [],
  });
  assert.equal(outage.status, 'invalid');
  assert.match(outage.evidence.join('\n'), /tick/i);

  const broken = await judgeS2({
    records: stopped(),
    reminders: [reminder(LAST + MIN)],
    breaks: ['the Mac slept at 12 min'],
  });
  assert.equal(broken.status, 'invalid');
  assert.ok(broken.evidence.includes('the Mac slept at 12 min'), 'the evidence was not kept');
});

// How long an S2 run must keep watching after the app is ended. A reminder
// counts up to 5 min after the last arrival, so the run must see that far,
// plus a margin of 1 min, for 6 min in all:
// - reminders carry the device's clock and arrivals the Mac's, and the
//   emulator's clock can be seconds off the Mac's;
// - the platform writes its record of a delivered notification after showing
//   it, and the driver reads that record when the run ends;
// - 1 min is the rule's own step: the app moves the reminder on each heartbeat,
//   every 60 s.
// The 6 min count from the app being ended, or from the last arrival when
// arrivals stopped after it. A shorter run is invalid, never passed or failed,
// with the measured and the required duration as evidence.

/** The same records with the driver's `label` mark moved to `t`. */
const moveMark = (records, label, t) =>
  records
    .map((record) => (record.kind === 'mark' && record.label === label ? mark(label, t) : record))
    .sort((a, b) => a.mono - b.mono);

test('SPIKE-01-AC6: when arrivals stop, watching 6 min after the last arrival is long enough, and 1 ms less is invalid, even with the reminder seen', async () => {
  const full = await judgeS2({
    records: moveMark(stopped(), 'journey-ended', LAST + 6 * MIN),
    reminders: [reminder(LAST + 5 * MIN)],
  });
  assert.equal(full.status, 'passed');
  assert.equal(full.reminderDelayMs, 5 * MIN);

  const short = await judgeS2({
    records: moveMark(stopped(), 'journey-ended', LAST + 6 * MIN - 1),
    reminders: [reminder(LAST + 2 * MIN)],
  });
  assert.equal(
    short.status,
    'invalid',
    'a run that could not have seen a reminder at 5 min passed',
  );
  assert.ok(short.evidence.length > 0, 'an invalid run needs its evidence');
});

test('SPIKE-01-AC6: when arrivals go on, watching 6 min after the app is ended is long enough, and 3 min is invalid, not passed', async () => {
  const full = await judgeS2({
    records: moveMark(continuing(), 'journey-ended', APP_ENDED + 6 * MIN),
    reminders: [],
  });
  assert.equal(full.status, 'passed');
  assert.equal(full.arrivalsStopped, false);

  const edge = await judgeS2({
    records: moveMark(continuing(), 'journey-ended', APP_ENDED + 6 * MIN - 1),
    reminders: [],
  });
  assert.equal(edge.status, 'invalid', 'arrivals watched for 5 min 59.999 s were judged');

  const short = await judgeS2({
    records: moveMark(continuing(), 'journey-ended', APP_ENDED + 3 * MIN),
    reminders: [],
  });
  assert.equal(short.status, 'invalid', 'arrivals watched for only 3 min passed');
  const evidence = short.evidence.join('\n');
  assert.match(evidence, /\b3 min\b/, 'the evidence does not say how long the run watched');
  assert.match(evidence, /\b6 min\b/, 'the evidence does not say how long S2 must watch');
});

test('SPIKE-01-AC6: arrivals that stop 90 s after the app is ended, watched for 5 min 30 s after the last one, are invalid, not failed, without a reminder', async () => {
  // The location service ran on for 90 s after the app was ended, then stopped.
  // The run ends 7 min after the app was ended: enough from the app being
  // ended, but not from the last arrival, so a reminder due by 11 min 30 s
  // after it could still have come.
  const last = APP_ENDED + 90 * S;
  const records = journey({
    end: APP_ENDED + 7 * MIN,
    marks: [mark('app-ended', APP_ENDED)],
    arrivals: every(MIN, 30 * S, last).map((t) => arrival(t)),
  });
  const result = await judgeS2({ records, reminders: [] });
  assert.equal(result.status, 'invalid', 'the platform was blamed for a run that stopped watching');
  assert.equal(result.arrivalsStopped, true);
  const evidence = result.evidence.join('\n');
  assert.match(evidence, /\b5 min 30 s\b/, 'the evidence does not say how long the run watched');
  assert.match(evidence, /\b6 min\b/, 'the evidence does not say how long S2 must watch');
});
