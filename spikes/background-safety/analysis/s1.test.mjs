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

// A run shorter than the scenario means the driver did not run all of it. It is
// never passed, because a run in which the scenario did not run has not passed
// (D-060). But a failure its observed part already shows, one that more
// watching could not undo, is final: a gap over 120 s, seen with the receiver's
// ticks intact, fails the run whatever came after. Calling it invalid would let
// a re-run replace a failure (AC13, D-060). Otherwise the short run is invalid.
// Either way its evidence gives the measured and the required duration, written
// the way journey.mjs's `duration` writes them ("30 min", "5 min 30 s"). A break
// (a hole in the ticks, the emulator exiting, the Mac sleeping) still makes any
// run invalid.

/** Arrivals every minute from 30 s to a minute before `end`: no gap anywhere. */
const steady = (end) =>
  journey({ end, arrivals: every(MIN, 30 * S, end - MIN).map((t) => arrival(t)) });

test('SPIKE-01-AC5: a journey of exactly 45 min is long enough, and one 1 ms shorter is invalid, not passed', async () => {
  const full = await judgeS1({ records: steady(END) });
  assert.equal(full.status, 'passed');
  assert.deepEqual(full.evidence, []);

  const short = await judgeS1({ records: steady(END - 1) });
  assert.equal(short.status, 'invalid', 'a journey of 44 min 59.999 s was judged');
  assert.ok(short.evidence.length > 0, 'an invalid run needs its evidence');
});

test('SPIKE-01-AC5: a 30-minute S1 run is invalid, never passed, with the measured and the required duration as evidence', async () => {
  const result = await judgeS1({ records: steady(30 * MIN) });
  assert.equal(result.status, 'invalid');
  const evidence = result.evidence.join('\n');
  assert.match(evidence, /\b30 min\b/, 'the evidence does not say how long the journey lasted');
  assert.match(evidence, /\b45 min\b/, 'the evidence does not say how long S1 must last');
});

/** A 30-minute run, arrivals every minute but for a 200 s gap after 10 min 30 s. */
const shortWithGap = (options = {}) =>
  journey({
    ...options,
    end: 30 * MIN,
    arrivals: [
      ...every(MIN, 30 * S, 10 * MIN + 30 * S),
      ...every(MIN, 13 * MIN + 50 * S, 29 * MIN),
    ].map((t) => arrival(t)),
  });

test('SPIKE-01-AC5: a 30-minute S1 run with a 200 s gap between arrivals, ticks intact, is failed, not invalid: the gap is final whatever came after, and the evidence names both durations', async () => {
  const result = await judgeS1({ records: shortWithGap() });
  assert.equal(result.status, 'failed', 'a re-run could replace a gap already seen');
  const evidence = result.evidence.join('\n');
  assert.match(evidence, /\b30 min\b/, 'the evidence does not say how long the journey lasted');
  assert.match(evidence, /\b45 min\b/, 'the evidence does not say how long S1 must last');
  assert.equal(result.largestGapMs, 200 * S, 'the gap seen before the run ended is not recorded');
  assert.equal(result.gapsOver120s, 1);
});

/** A 30-minute run, arrivals every minute, the last one `silence` ms before its end. */
const shortEndingInSilence = (silence) =>
  journey({
    end: 30 * MIN,
    arrivals: every(MIN, 3 * MIN - silence, 30 * MIN - silence).map((t) => arrival(t)),
  });

test('SPIKE-01-AC5: in a 30-minute S1 run, 120 s of silence up to its end is invalid, and 120 s and 1 ms is failed: more watching could only make it longer', async () => {
  const open = await judgeS1({ records: shortEndingInSilence(120 * S) });
  assert.equal(open.largestGapMs, 120 * S);
  assert.equal(open.status, 'invalid', 'an arrival just after the end could still have passed it');

  const final = await judgeS1({ records: shortEndingInSilence(120 * S + 1) });
  assert.equal(final.largestGapMs, 120 * S + 1);
  assert.equal(final.status, 'failed', 'a silence already over 120 s was left to a re-run');
  for (const result of [open, final]) {
    const evidence = result.evidence.join('\n');
    assert.match(evidence, /\b30 min\b/, 'the evidence does not say how long the journey lasted');
    assert.match(evidence, /\b45 min\b/, 'the evidence does not say how long S1 must last');
  }
});

test('SPIKE-01-AC13: a 30-minute S1 run with a 200 s gap is still invalid when the harness broke during the gap: a hole in the ticks, or a break the driver saw', async () => {
  const outage = await judgeS1({
    records: shortWithGap({ tickHoles: [[10 * MIN + 35 * S, 13 * MIN + 45 * S]] }),
  });
  assert.equal(outage.status, 'invalid', 'a receiver outage was judged as a silent phone');
  assert.match(outage.evidence.join('\n'), /tick/i);

  const slept = await judgeS1({ records: shortWithGap(), breaks: ['the Mac slept at 11 min'] });
  assert.equal(slept.status, 'invalid', "the Mac's sleep was judged as a silent phone");
  assert.ok(slept.evidence.includes('the Mac slept at 11 min'), 'the evidence was not kept');
});

/** The same records with the receiver's ticks at `times` instead of every 10 s. */
const withTicks = (records, times) =>
  [...records.filter((record) => record.kind !== 'tick'), ...times.map(tick)].sort(
    (a, b) => a.mono - b.mono,
  );

/** Ticks every 10 s, with one silence of `silence` ms after the tick at 20 min 5 s. */
const ticksWithSilence = (silence) => [
  ...every(10 * S, -5 * S, 20 * MIN + 5 * S),
  ...every(10 * S, 20 * MIN + 5 * S + silence, END + 5 * S),
];
/** Ticks every 10 s until the last one, `silence` ms before the journey ends. */
const ticksEndingBefore = (silence) => [...every(10 * S, -5 * S, END - 25 * S), END - silence];

test('SPIKE-01-AC13: 15 s without a tick is still a working receiver, and 15 s and 1 ms is a hole that makes an S1 run invalid, mid-run and at the end', async () => {
  const cases = [
    ['15 s mid-run', ticksWithSilence(15 * S), 'passed'],
    ['15 s and 1 ms mid-run', ticksWithSilence(15 * S + 1), 'invalid'],
    ['15 s before the end', ticksEndingBefore(15 * S), 'passed'],
    ['15 s and 1 ms before the end', ticksEndingBefore(15 * S + 1), 'invalid'],
  ];
  for (const [what, times, status] of cases) {
    const result = await judgeS1({ records: withTicks(withGap(MIN), times) });
    assert.equal(result.status, status, `no tick for ${what}`);
    if (status === 'invalid') assert.match(result.evidence.join('\n'), /tick/i, what);
  }
});

// A failure shown stays final (the safety review's B2a, 2026-10-01), judged
// on the stretches of the gap the harness was intact for (the test audit's S2
// and the safety review's rule from loop 1, made strict, review loop 2): every
// timed break is taken out of the gap together, a hole in the ticks (from the
// last tick before it to the first after it, on `mono`) and a sleep of the
// Mac (its span as readSleeps gives it, { text, from, to } on the Mac's wall
// clock, compared with the arrivals' `at`). If any stretch that is left, with
// the ticks up, is over 120 s, the phone was silent for over 120 s with the
// harness watching, and the run is failed. Only when no such stretch is left
// is it invalid. A break elsewhere in the run, or over only part of the gap,
// does not rescue it, and every break stays in the evidence. A break the
// driver saw, with no time, could have been anywhere, so it still makes the
// run invalid.
//
// withGap(200 s) has its gap from 20 min 30 s to 23 min 50 s. Its ticks are
// at 5 s past each 10 s (20 min 55 s, 21 min 5 s, …).

/** A sleep of the Mac, `secs` long from `t` into the journey, as readSleeps gives it. */
const sleepBreak = (t, secs) => ({
  text: `the Mac slept: pmset logged Sleep at ${t / MIN} min into the journey for ${secs} secs`,
  from: WALL0 + t,
  to: WALL0 + t + secs * S,
});
/** A timed break from `from` to `to` ms into the journey, to the ms. */
const spanBreak = (from, to) => ({
  text: `the Mac slept from ${from} ms to ${to} ms into the journey`,
  from: WALL0 + from,
  to: WALL0 + to,
});

test('SPIKE-01-AC5: a gap over 120 s seen with the ticks intact for more than 120 s of it is failed: a hole in the ticks elsewhere in the run, or over only the end of the gap, does not rescue it, and the hole stays in the evidence', async () => {
  const elsewhere = [
    ['a hole before the gap', [5 * MIN, 6 * MIN]],
    ['a hole after the gap', [35 * MIN, 36 * MIN]],
  ];
  for (const [what, hole] of elsewhere) {
    const result = await judgeS1({ records: withGap(200 * S, { tickHoles: [hole] }) });
    assert.equal(result.status, 'failed', `${what} rescued a gap seen with the ticks intact`);
    assert.equal(result.largestGapMs, 200 * S);
    assert.match(result.evidence.join('\n'), /tick/i, `${what} is not in the evidence`);
  }

  // No tick from 22 min 55 s to 24 min 35 s: the 145 s from 20 min 30 s to
  // 22 min 55 s were silent with the receiver writing its ticks.
  const overItsEnd = await judgeS1({
    records: withGap(200 * S, { tickHoles: [[23 * MIN, 24 * MIN + 30 * S]] }),
  });
  assert.equal(
    overItsEnd.status,
    'failed',
    'a hole over the end of the gap rescued the 145 s before it, seen with the ticks up',
  );
  assert.match(overItsEnd.evidence.join('\n'), /tick/i, 'the hole is not in the evidence');
});

test('SPIKE-01-AC13: a sleep of the Mac makes an S1 run invalid only when, taken out of the gap, it leaves no stretch over 120 s; a sleep over part of the gap, or elsewhere in the run, leaves the gap failed; every sleep stays in the evidence', async () => {
  const covering = [
    ['inside the gap, leaving 30 s and 110 s', sleepBreak(21 * MIN, 60)],
    ['over its start, leaving its last 90 s', sleepBreak(20 * MIN, 140)],
    ['over its end, leaving its first 90 s', sleepBreak(22 * MIN, 180)],
  ];
  for (const [what, slept] of covering) {
    const result = await judgeS1({ records: withGap(200 * S), breaks: [slept] });
    assert.equal(result.status, 'invalid', `a sleep ${what} was judged as a silent phone`);
    assert.ok(result.evidence.includes(slept.text), `${what}: the sleep is not in the evidence`);
  }

  const partly = [
    ['over its start, leaving its last 170 s', sleepBreak(20 * MIN, 60)],
    ['over its end, leaving its first 180 s', sleepBreak(23 * MIN + 30 * S, 120)],
  ];
  for (const [what, slept] of partly) {
    const result = await judgeS1({ records: withGap(200 * S), breaks: [slept] });
    assert.equal(result.status, 'failed', `a sleep ${what} rescued the gap`);
    assert.ok(result.evidence.includes(slept.text), `${what}: the sleep is not in the evidence`);
  }

  const elsewhere = [
    ['before the gap', sleepBreak(10 * MIN, 60)],
    ['after the gap', sleepBreak(35 * MIN, 300)],
  ];
  for (const [what, slept] of elsewhere) {
    const result = await judgeS1({ records: withGap(200 * S), breaks: [slept] });
    assert.equal(result.status, 'failed', `a sleep ${what} rescued the gap`);
    assert.ok(result.evidence.includes(slept.text), `${what}: the sleep is not in the evidence`);
  }
});

test('SPIKE-01-AC13: a stretch of exactly 120 s left with the ticks up makes an S1 run invalid, and one of 120 s and 1 ms makes it failed, at the end of the gap and at its start', async () => {
  const cases = [
    ['its first 120 s left', spanBreak(22 * MIN + 30 * S, 24 * MIN), 'invalid'],
    ['its first 120 s and 1 ms left', spanBreak(22 * MIN + 30 * S + 1, 24 * MIN), 'failed'],
    ['its last 120 s left', spanBreak(19 * MIN, 21 * MIN + 50 * S), 'invalid'],
    ['its last 120 s and 1 ms left', spanBreak(19 * MIN, 21 * MIN + 50 * S - 1), 'failed'],
  ];
  for (const [what, slept, status] of cases) {
    const result = await judgeS1({ records: withGap(200 * S), breaks: [slept] });
    assert.equal(result.status, status, `the gap with ${what}`);
    assert.ok(result.evidence.includes(slept.text), `${what}: the sleep is not in the evidence`);
  }
});

test('SPIKE-01-AC13: every timed break is taken out of the gap together, and a stretch between two breaks counts as much as one at either end', async () => {
  // A sleep from 20 min to 21 min 30 s leaves 140 s of the gap on its own; the
  // hole in the ticks from 22 min 55 s to 24 min 35 s leaves 145 s on its own.
  // Together they leave 85 s, from 21 min 30 s to 22 min 55 s.
  const slept = sleepBreak(20 * MIN, 90);
  const hole = { tickHoles: [[23 * MIN, 24 * MIN + 30 * S]] };
  const sleepAlone = await judgeS1({ records: withGap(200 * S), breaks: [slept] });
  assert.equal(sleepAlone.status, 'failed', 'the sleep alone leaves 140 s');
  const holeAlone = await judgeS1({ records: withGap(200 * S, hole) });
  assert.equal(holeAlone.status, 'failed', 'the hole alone leaves 145 s');
  const both = await judgeS1({ records: withGap(200 * S, hole), breaks: [slept] });
  assert.equal(both.status, 'invalid', 'the breaks were taken out of the gap one at a time');
  assert.ok(both.evidence.includes(slept.text), 'the sleep is not in the evidence');
  assert.match(both.evidence.join('\n'), /tick/i, 'the hole is not in the evidence');

  // Two short sleeps: from 20 min 40 s and from 23 min, 10 s each, leave
  // 10 s, 130 s and 40 s: the 130 s between them were seen with the ticks up.
  const between = await judgeS1({
    records: withGap(200 * S),
    breaks: [sleepBreak(20 * MIN + 40 * S, 10), sleepBreak(23 * MIN, 10)],
  });
  assert.equal(between.status, 'failed', 'the 130 s between two sleeps were rescued');

  // From 21 min and from 22 min 30 s, 10 s each: 30 s, 80 s and 70 s are left.
  const short = await judgeS1({
    records: withGap(200 * S),
    breaks: [sleepBreak(21 * MIN, 10), sleepBreak(22 * MIN + 30 * S, 10)],
  });
  assert.equal(short.status, 'invalid', 'no stretch over 120 s is left, yet the run was failed');
});

test('SPIKE-01-AC13: a sleep that only touches the gap, ending as it starts or starting as it ends, takes nothing out of it, and the gap is failed', async () => {
  const touching = [
    ['ending as the gap starts', spanBreak(19 * MIN, 20 * MIN + 30 * S)],
    ['starting as the gap ends', spanBreak(23 * MIN + 50 * S, 25 * MIN)],
  ];
  for (const [what, slept] of touching) {
    const result = await judgeS1({ records: withGap(200 * S), breaks: [slept] });
    assert.equal(result.status, 'failed', `a sleep ${what} rescued all 200 s of it`);
    assert.ok(result.evidence.includes(slept.text), `${what}: the sleep is not in the evidence`);
  }
});

test('SPIKE-01-AC13: a break the driver saw, with no time, still makes an S1 run invalid when a gap over 120 s was seen with the ticks intact', async () => {
  const result = await judgeS1({
    records: withGap(200 * S),
    breaks: ['the emulator exited'],
  });
  assert.equal(result.status, 'invalid', 'a break that could have been during the gap was ignored');
  assert.ok(result.evidence.includes('the emulator exited'), 'the evidence was not kept');
});

test('SPIKE-01-AC13: a sleep with its span and no gap over 120 s still makes an S1 run invalid', async () => {
  const slept = sleepBreak(30 * MIN, 60);
  const result = await judgeS1({ records: withGap(MIN), breaks: [slept] });
  assert.equal(result.status, 'invalid', 'a run the Mac slept through was passed');
  assert.ok(result.evidence.includes(slept.text), 'the sleep is not in the evidence');
});
