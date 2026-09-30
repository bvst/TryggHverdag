// SPIKE-01: the S7 verdict (analysis/s7.mjs): a reduced location permission is
// reported to the receiver within 60 s of the change.
//
// Records are synthetic and shaped as the receiver writes them (see
// s1.test.mjs). The driver marks the change; the app's report is the first
// arrival after it whose `permission` differs from the one reported before it.
// Both are timed on the receiver's monotonic clock.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const judgeS7 = async (input) => (await import('./s7.mjs')).judgeS7(input);

const S = 1_000;
const MIN = 60 * S;
const WALL0 = Date.UTC(2031, 0, 1, 21, 0, 0);
const MONO0 = 7_000_000;
const CHANGE = 5 * MIN;
const END = 12 * MIN;

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

/** Times from `from` to `to`, `step` apart, both ends included. */
const every = (step, from, to) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

/** The run's records around the permission change at 5 min; ticks every 10 s. */
function run(arrivals, { tickHoles = [] } = {}) {
  const ticks = every(10 * S, -5 * S, END + 5 * S)
    .filter((t) => !tickHoles.some(([from, to]) => t > from && t < to))
    .map(tick);
  return [
    mark('journey-started', 0),
    mark('permission-reduced', CHANGE),
    ...ticks,
    ...arrivals,
    mark('journey-ended', END),
  ].sort((a, b) => a.mono - b.mono);
}

/**
 * Heartbeats every minute report `before`, including one at 5 min 30 s that
 * has not noticed the change yet; from `delay` after the change they report
 * `after`, with `afterFields`.
 */
function reduced(
  delay,
  { before = 'always', after = 'whenInUse', afterFields = {}, ...options } = {},
) {
  const report = CHANGE + delay;
  return run(
    [
      ...every(MIN, 30 * S, 5 * MIN + 30 * S)
        .filter((t) => t < report)
        .map((t) => arrival(t, { permission: before })),
      ...every(MIN, report, END - 30 * S).map((t) =>
        arrival(t, { permission: after, ...afterFields }),
      ),
    ],
    options,
  );
}

test('SPIKE-01-AC11: a report 60 s after the change passes', async () => {
  const result = await judgeS7({ records: reduced(60 * S) });
  assert.equal(result.status, 'passed');
  assert.equal(result.reportDelayMs, 60 * S);
});

test('SPIKE-01-AC11: a report 61 s after the change fails, and so does one at 60 s and 1 ms', async () => {
  for (const delay of [61 * S, 60 * S + 1]) {
    const result = await judgeS7({ records: reduced(delay) });
    assert.equal(result.status, 'failed', `a report after ${delay} ms`);
    assert.equal(result.reportDelayMs, delay);
  }
});

test('SPIKE-01-AC11: no report of the change fails, whether heartbeats go on or stop', async () => {
  const unchanged = await judgeS7({ records: reduced(60 * S, { after: 'always' }) });
  assert.equal(unchanged.status, 'failed', 'heartbeats went on without reporting the change');
  assert.equal(unchanged.reportDelayMs, null);

  const ended = await judgeS7({
    records: run(every(MIN, 30 * S, 4 * MIN + 30 * S).map((t) => arrival(t))),
  });
  assert.equal(ended.status, 'failed', 'nothing arrived after the change');
  assert.equal(ended.reportDelayMs, null);
});

test('SPIKE-01-AC11: precise to approximate is a reduction too', async () => {
  const result = await judgeS7({
    records: reduced(40 * S, { before: 'always/precise', after: 'always/approximate' }),
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.reportDelayMs, 40 * S);
});

test('SPIKE-01-AC11: records how many arrivals came after the change, and how many carried no position', async () => {
  const result = await judgeS7({
    records: reduced(40 * S, { afterFields: { hasPosition: false } }),
  });
  assert.equal(result.status, 'passed');
  assert.equal(
    result.arrivalsAfterChange,
    7,
    'the one at 5 min 30 s and six reports from 5 min 40 s',
  );
  assert.equal(result.withoutPositionAfterChange, 6);
});

test("SPIKE-01-AC13: a gap in the receiver's ticks, or a break the driver saw, makes an S7 run invalid", async () => {
  const outage = await judgeS7({ records: reduced(40 * S, { tickHoles: [[5 * MIN, 7 * MIN]] }) });
  assert.equal(outage.status, 'invalid');
  assert.match(outage.evidence.join('\n'), /tick/i);

  const broken = await judgeS7({ records: reduced(40 * S), breaks: ['the Mac slept at 6 min'] });
  assert.equal(broken.status, 'invalid');
  assert.ok(broken.evidence.includes('the Mac slept at 6 min'), 'the evidence was not kept');
});

// An S7 run must watch for at least 60 s after the "permission-reduced" mark,
// so that a report at 60 s can be seen. No margin is added: the report and the
// mark are timed on the same monotonic clock, and a window of exactly 60 s
// decides both ways (a report at 60 s passes; none by then fails). A shorter
// window means the driver did not run the scenario: the run is invalid, never
// passed or failed, with the measured and the required duration as evidence.

/** The same records with the driver's `label` mark moved to `t`. */
const moveMark = (records, label, t) =>
  records
    .map((record) => (record.kind === 'mark' && record.label === label ? mark(label, t) : record))
    .sort((a, b) => a.mono - b.mono);

test('SPIKE-01-AC11: watching exactly 60 s after the change is long enough to pass a report at 60 s, and 1 ms less is invalid, even with a report seen', async () => {
  const full = await judgeS7({
    records: moveMark(reduced(60 * S), 'journey-ended', CHANGE + 60 * S),
  });
  assert.equal(full.status, 'passed');
  assert.equal(full.reportDelayMs, 60 * S);

  const short = await judgeS7({
    records: moveMark(reduced(40 * S), 'journey-ended', CHANGE + 60 * S - 1),
  });
  assert.equal(short.status, 'invalid', 'a run that watched for 59.999 s was judged');
  assert.ok(short.evidence.length > 0, 'an invalid run needs its evidence');
});

test('SPIKE-01-AC11: a run that stops watching 30 s after the change is invalid, not failed, with the measured and the required duration as evidence', async () => {
  const result = await judgeS7({
    records: moveMark(reduced(40 * S), 'journey-ended', CHANGE + 30 * S),
  });
  assert.equal(
    result.status,
    'invalid',
    'the app was blamed for a report the run stopped watching for',
  );
  const evidence = result.evidence.join('\n');
  assert.match(evidence, /\b30 s\b/, 'the evidence does not say how long the run watched');
  assert.match(evidence, /\b1 min\b/, 'the evidence does not say how long S7 must watch');
});
