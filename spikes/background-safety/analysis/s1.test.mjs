// SPIKE-01: the S1 verdict (analysis/s1.mjs).
//
// Records are synthetic and shaped as the receiver writes them: arrivals, the
// receiver's own tick every 10 s, and the driver's marks. Each has its time on
// the Mac's clock (`at`) and on the monotonic clock (`mono`). Gaps are judged
// on `mono`, from the journey-started mark to the journey-ended mark.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const judgeS1 = async (input) => (await import('./s1.mjs')).judgeS1(input);

const S = 1_000;
const MIN = 60 * S;
const WALL0 = Date.UTC(2031, 0, 1, 21, 0, 0);
const MONO0 = 7_000_000;
const END = 45 * MIN;

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

/**
 * One journey's records, in the order the receiver writes them. Ticks run
 * every 10 s from before the start to after the end, except inside `tickHoles`.
 */
function journey({ end = END, arrivals = [], marks = [], tickHoles = [] } = {}) {
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

/** Arrivals every minute, with one gap of `gap` ms after the one at 20 min 30 s. */
function withGap(gap, options = {}) {
  const times = [
    ...every(MIN, 30 * S, 20 * MIN + 30 * S),
    ...every(MIN, 20 * MIN + 30 * S + gap, END - S),
  ];
  return journey({ ...options, arrivals: times.map((t) => arrival(t)) });
}

/** The same records after the Mac's wall clock was stepped by `by` at `from`. */
const stepWall = (records, from, by) =>
  records.map((record) =>
    record.mono >= MONO0 + from ? { ...record, at: record.at + by } : record,
  );

test('SPIKE-01-AC5: a gap of exactly 120 s passes', async () => {
  const result = await judgeS1({ records: withGap(120 * S) });
  assert.equal(result.status, 'passed');
  assert.equal(result.largestGapMs, 120 * S);
});

test('SPIKE-01-AC5: a gap of 121 s fails, and so does one of 120 s and 1 ms', async () => {
  for (const gap of [121 * S, 120 * S + 1]) {
    const result = await judgeS1({ records: withGap(gap) });
    assert.equal(result.status, 'failed', `a gap of ${gap} ms`);
    assert.equal(result.largestGapMs, gap);
  }
});

test('SPIKE-01-AC5: silence after the start or before the end is a gap too', async () => {
  const lateStart = journey({ arrivals: every(MIN, 2 * MIN + S, END - S).map((t) => arrival(t)) });
  const late = await judgeS1({ records: lateStart });
  assert.equal(late.status, 'failed', 'the first arrival came 121 s after the start');
  assert.equal(late.largestGapMs, 121 * S);

  const stopsEarly = journey({
    arrivals: every(MIN, 30 * S, 30 * MIN + 30 * S).map((t) => arrival(t)),
  });
  const early = await judgeS1({ records: stopsEarly });
  assert.equal(early.status, 'failed', 'nothing arrived in the last 14 min 30 s');
  assert.equal(early.largestGapMs, 14 * MIN + 30 * S);
});

test('SPIKE-01-AC5: a run in which nothing arrived fails', async () => {
  const result = await judgeS1({ records: journey() });
  assert.equal(result.status, 'failed');
  assert.equal(result.largestGapMs, END);
});

test('SPIKE-01-AC5: gaps are measured on the monotonic clock, so a wall-clock step neither creates nor hides one', async () => {
  // The wall clock jumps 90 s forward at 20 min: 150 s on the wall, 60 s in fact.
  const created = await judgeS1({ records: stepWall(withGap(MIN), 20 * MIN, 90 * S) });
  assert.equal(created.status, 'passed', 'a clock correction created a gap');
  assert.equal(created.largestGapMs, MIN);

  // The wall clock jumps 61 s back at 21 min: 60 s on the wall, 121 s in fact.
  const hidden = await judgeS1({ records: stepWall(withGap(121 * S), 21 * MIN, -61 * S) });
  assert.equal(hidden.status, 'failed', 'a clock correction hid a gap');
  assert.equal(hidden.largestGapMs, 121 * S);
});

test('SPIKE-01-AC5: missing receiver ticks make a run invalid, not failed and not passed', async () => {
  const outage = await judgeS1({
    records: withGap(200 * S, { tickHoles: [[20 * MIN + 35 * S, 23 * MIN + 45 * S]] }),
  });
  assert.equal(outage.status, 'invalid', 'a receiver outage was judged as a silent phone');
  assert.match(outage.evidence.join('\n'), /tick/i);

  const quietReceiver = await judgeS1({
    records: withGap(MIN, { tickHoles: [[30 * MIN, 31 * MIN]] }),
  });
  assert.equal(quietReceiver.status, 'invalid', 'a run with a gap in the ticks was passed');
  assert.match(quietReceiver.evidence.join('\n'), /tick/i);
});

test("SPIKE-01-AC5: records the largest gap, the gaps over 60 s and over 120 s, and the SDK's state changes", async () => {
  const times = [
    ...every(MIN, 30 * S, 10 * MIN + 30 * S),
    ...every(MIN, 12 * MIN, 20 * MIN), // 90 s after 10 min 30 s
    ...every(MIN, 22 * MIN + 10 * S, 44 * MIN + 10 * S), // 130 s after 20 min
  ];
  const moving = (t) => !(t >= 25 * MIN && t < 31 * MIN);
  const result = await judgeS1({
    records: journey({ arrivals: times.map((t) => arrival(t, { moving: moving(t) })) }),
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.largestGapMs, 130 * S);
  assert.equal(result.gapsOver60s, 2, 'a gap of exactly 60 s is not over 60 s');
  assert.equal(result.gapsOver120s, 1);
  assert.deepEqual(result.stateChanges, [
    { afterMs: 25 * MIN + 10 * S, moving: false },
    { afterMs: 31 * MIN + 10 * S, moving: true },
  ]);
});

test('SPIKE-01-AC5: a run without its start or end mark is refused, not judged', async () => {
  const records = withGap(MIN);
  await assert.rejects(
    judgeS1({ records: records.filter((record) => record.label !== 'journey-ended') }),
    /journey-ended/,
  );
  await assert.rejects(
    judgeS1({ records: records.filter((record) => record.label !== 'journey-started') }),
    /journey-started/,
  );
});

test('SPIKE-01-AC13: a break the driver saw (the emulator exited, the Mac slept) makes an S1 run invalid, with that evidence', async () => {
  const result = await judgeS1({
    records: withGap(MIN),
    breaks: ['the emulator exited at 31 min'],
  });
  assert.equal(result.status, 'invalid');
  assert.ok(result.evidence.includes('the emulator exited at 31 min'), 'the evidence was not kept');
});
