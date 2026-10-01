// SPIKE-01: the S3 verdict (analysis/s3.mjs), Android only: stock Android's
// restrictions, with and without the battery-optimisation exemption.
//
// Records are synthetic and shaped as the receiver writes them (see
// s1.test.mjs). The driver marks the moment it starts the restrictions.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * What the driver found in force at the start and the end of the restrictions
 * (meta.json's `inForce`): `dumpsys deviceidle get deep` and
 * `am get-standby-bucket`, trimmed. Deep Doze is IDLE; the restricted bucket
 * is 45. Every run below held both, unless a test says otherwise.
 */
const HELD = { start: { idle: 'IDLE', bucket: '45' }, end: { idle: 'IDLE', bucket: '45' } };

/** Imported per call, so that each test reports a missing module on its own. */
const judgeS3 = async (input) => (await import('./s3.mjs')).judgeS3({ inForce: HELD, ...input });

const S = 1_000;
const MIN = 60 * S;
const WALL0 = Date.UTC(2031, 0, 1, 21, 0, 0);
const MONO0 = 7_000_000;
const RESTRICTED = 2 * MIN;
const END = 47 * MIN;

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

/** The run's records: restrictions start at 2 min and hold for 45 min; ticks every 10 s. */
function run(arrivals, { tickHoles = [] } = {}) {
  const ticks = every(10 * S, -5 * S, END + 5 * S)
    .filter((t) => !tickHoles.some(([from, to]) => t > from && t < to))
    .map(tick);
  return [
    mark('journey-started', 0),
    mark('restrictions-started', RESTRICTED),
    ...ticks,
    ...arrivals,
    mark('journey-ended', END),
  ].sort((a, b) => a.mono - b.mono);
}

/** An arrival every minute from 30 s to 30 s before the end, all with `fields`. */
const minutely = (fields) => every(MIN, 30 * S, END - 30 * S).map((t) => arrival(t, fields));

test('SPIKE-01-AC7: with the exemption, 45 minutes under the restrictions with no gap over 120 s passes', async () => {
  const result = await judgeS3({ exemption: true, records: run(minutely({ exempt: true })) });
  assert.equal(result.status, 'passed');
  assert.equal(result.largestGapMs, MIN);
});

test('SPIKE-01-AC7: with the exemption, one gap over 120 s fails', async () => {
  const times = [
    ...every(MIN, 30 * S, 20 * MIN + 30 * S),
    ...every(MIN, 22 * MIN + 31 * S, END - 29 * S),
  ];
  const result = await judgeS3({
    exemption: true,
    records: run(times.map((t) => arrival(t, { exempt: true }))),
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.largestGapMs, 121 * S);
});

test('SPIKE-01-AC7: without the exemption, a "not exempt" report before the restrictions passes, and what they did is recorded, not judged', async () => {
  // The app reports "not exempt" from 30 s; the restrictions then silence it for 10 minutes.
  const times = [
    ...every(MIN, 30 * S, 9 * MIN + 30 * S),
    ...every(MIN, 19 * MIN + 30 * S, END - 30 * S),
  ];
  const result = await judgeS3({
    exemption: false,
    records: run(times.map((t) => arrival(t, { exempt: false }))),
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.notExemptReported, true);
  assert.equal(result.largestGapMs, 10 * MIN);
  assert.equal(result.gapsOver120s, 1);
});

test('SPIKE-01-AC7: without the exemption, no "not exempt" report fails', async () => {
  const saysExempt = await judgeS3({ exemption: false, records: run(minutely({ exempt: true })) });
  assert.equal(saysExempt.status, 'failed', 'the app claimed an exemption it did not have');
  assert.equal(saysExempt.notExemptReported, false);

  const neverChecked = await judgeS3({
    exemption: false,
    records: run(minutely({ exempt: null })),
  });
  assert.equal(neverChecked.status, 'failed', 'an unknown exemption is not a "not exempt" report');
});

test('SPIKE-01-AC7: without the exemption, a report that arrives only after the restrictions start fails', async () => {
  const records = run(
    every(MIN, 30 * S, END - 30 * S).map((t) =>
      arrival(t, { exempt: t < RESTRICTED ? null : false }),
    ),
  );
  const result = await judgeS3({ exemption: false, records });
  assert.equal(
    result.status,
    'failed',
    'the missing exemption was found only after the walk went wrong',
  );
});

test("SPIKE-01-AC13: a gap in the receiver's ticks, or a break the driver saw, makes an S3 run invalid", async () => {
  const outage = await judgeS3({
    exemption: true,
    records: run(minutely({ exempt: true }), { tickHoles: [[20 * MIN, 22 * MIN]] }),
  });
  assert.equal(outage.status, 'invalid');
  assert.match(outage.evidence.join('\n'), /tick/i);

  const broken = await judgeS3({
    exemption: true,
    records: run(minutely({ exempt: true })),
    breaks: ['the emulator exited at 40 min'],
  });
  assert.equal(broken.status, 'invalid');
  assert.ok(broken.evidence.includes('the emulator exited at 40 min'), 'the evidence was not kept');
});

// S3 holds the device in the restrictions "for 45 minutes" (the spec's
// criterion), so the run must last 45 min from the "restrictions-started" mark
// to the journey's end, with the exemption and without it. A shorter run means
// the driver did not run all of it, so it is never passed. But a failure its
// observed part already shows is final, because an invalid run is re-run and
// a re-run must never replace a failure (AC13, D-060): with the exemption, a
// gap over 120 s; without it, no "not exempt" report before the restrictions
// started, which is settled the moment they start. Such a run is failed. Any
// other short run is invalid. Either way the evidence gives the measured and
// the required duration.

/** The same records with the driver's `label` mark moved to `t`. */
const moveMark = (records, label, t) =>
  records
    .map((record) => (record.kind === 'mark' && record.label === label ? mark(label, t) : record))
    .sort((a, b) => a.mono - b.mono);

test('SPIKE-01-AC7: restrictions held for exactly 45 min are long enough, and 1 ms less is invalid, not passed, with the exemption and without', async () => {
  for (const exemption of [true, false]) {
    const records = run(minutely({ exempt: exemption }));
    const full = await judgeS3({ exemption, records });
    assert.equal(full.status, 'passed', `exemption ${exemption}, restrictions held 45 min`);

    const short = await judgeS3({
      exemption,
      records: moveMark(records, 'journey-ended', RESTRICTED + 45 * MIN - 1),
    });
    assert.equal(short.status, 'invalid', `exemption ${exemption}, held for 44 min 59.999 s`);
    assert.ok(short.evidence.length > 0, 'an invalid run needs its evidence');
  }
});

test('SPIKE-01-AC7: a journey of 46 min whose restrictions held for 44 min is invalid: the 45 min count from the restrictions', async () => {
  // The restrictions start at 2 min, as in every run here.
  const records = moveMark(run(minutely({ exempt: true })), 'journey-ended', 46 * MIN);
  const result = await judgeS3({ exemption: true, records });
  assert.equal(result.status, 'invalid', 'the journey lasted 46 min, but the restrictions only 44');
  const evidence = result.evidence.join('\n');
  assert.match(evidence, /\b44 min\b/, 'the evidence does not say how long the restrictions held');
  assert.match(evidence, /\b45 min\b/, 'the evidence does not say how long S3 must hold them');
});

/** The run's records with the journey ended once the restrictions have held for 28 min. */
const heldFor28Min = (arrivals) => moveMark(run(arrivals), 'journey-ended', RESTRICTED + 28 * MIN);

/** Asserts the evidence gives the 28 min measured and the 45 min required. */
function namesBothDurations(result, what) {
  const evidence = result.evidence.join('\n');
  assert.match(evidence, /\b28 min\b/, `${what}: the measured duration is not in the evidence`);
  assert.match(evidence, /\b45 min\b/, `${what}: the required duration is not in the evidence`);
}

test('SPIKE-01-AC7: with the exemption, a run whose restrictions held for 28 min with a gap over 120 s is failed, not invalid: the gap is final', async () => {
  const times = [
    ...every(MIN, 30 * S, 20 * MIN + 30 * S),
    ...every(MIN, 22 * MIN + 31 * S, END - 29 * S),
  ];
  const result = await judgeS3({
    exemption: true,
    records: heldFor28Min(times.map((t) => arrival(t, { exempt: true }))),
  });
  assert.equal(result.status, 'failed', 'a re-run could replace a gap already seen');
  assert.equal(result.largestGapMs, 121 * S);
  namesBothDurations(result, 'a gap of 121 s');
});

test('SPIKE-01-AC7: without the exemption, a run whose restrictions held for 28 min with no "not exempt" report before they started is failed, not invalid: that was settled when they started', async () => {
  const cases = [
    ['the app said it was exempt', minutely({ exempt: true })],
    ['the app never checked', minutely({ exempt: null })],
    [
      'the report came after the restrictions started',
      every(MIN, 30 * S, END - 30 * S).map((t) =>
        arrival(t, { exempt: t < RESTRICTED ? null : false }),
      ),
    ],
  ];
  for (const [what, arrivals] of cases) {
    const result = await judgeS3({ exemption: false, records: heldFor28Min(arrivals) });
    assert.equal(result.status, 'failed', `${what}: a re-run could replace the missed report`);
    assert.equal(result.notExemptReported, false, what);
    namesBothDurations(result, what);
  }
});

test('SPIKE-01-AC7: a run whose restrictions held for 28 min that would otherwise pass is invalid, with the exemption and without', async () => {
  const cases = [
    ['with the exemption, no gap', true, { exempt: true }],
    ['without it, and a "not exempt" report', false, { exempt: false }],
  ];
  for (const [what, exemption, fields] of cases) {
    const result = await judgeS3({ exemption, records: heldFor28Min(minutely(fields)) });
    assert.equal(result.status, 'invalid', `${what}: 28 min of restrictions passed for 45`);
    namesBothDurations(result, what);
  }
});

// Which restrictions actually held. Android re-promotes a journeying app out
// of the restricted standby bucket within a second (seen on the android-37.2
// image, 2026-09-30: back to 10 or 30), so the driver records deep Doze and
// the bucket when the restrictions start and when they end. A restriction is
// in force only if both readings show it. One that did not hold is not shown,
// and a pass never rests on it.

const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError, RangeError];
/** Rejects on purpose: not a missing module, and not a programming error. */
async function refuses(promise, why) {
  await assert.rejects(
    promise,
    (error) => {
      assert.ok(
        error?.code !== 'ERR_MODULE_NOT_FOUND' &&
          !PROGRAMMING_ERRORS.some((type) => error instanceof type),
        `${why}: it broke instead of refusing (${error?.name}: ${error?.message})`,
      );
      return true;
    },
    why,
  );
}

/** The restriction record with the readings at the start and the end changed. */
const readings = (start = {}, end = {}) => ({
  start: { ...HELD.start, ...start },
  end: { ...HELD.end, ...end },
});
const DOZE = /doze/i;
const BUCKET = /bucket/i;
/** The names in `list` that match `pattern`. */
const names = (list, pattern) => list.filter((name) => pattern.exec(name) !== null);

test('SPIKE-01-AC7: reports the restrictions in force at the start and the end: deep Doze and the restricted bucket', async () => {
  const result = await judgeS3({
    exemption: true,
    records: run(minutely({ exempt: true })),
    inForce: HELD,
  });
  assert.equal(result.status, 'passed');
  assert.equal(names(result.restrictions.inForce, DOZE).length, 1, 'deep Doze is not reported');
  assert.equal(names(result.restrictions.inForce, BUCKET).length, 1, 'the bucket is not reported');
  assert.deepEqual(result.restrictions.notShown, []);
});

test('SPIKE-01-AC7: a restricted bucket that did not hold is listed as not shown, never as in force, so a pass rests on deep Doze alone and says so', async () => {
  const cases = [
    ['re-promoted by the end', readings({}, { bucket: '10' })],
    ['re-promoted before the first reading', readings({ bucket: '30' }, { bucket: '10' })],
  ];
  for (const [what, inForce] of cases) {
    const result = await judgeS3({
      exemption: true,
      records: run(minutely({ exempt: true })),
      inForce,
    });
    assert.equal(names(result.restrictions.notShown, BUCKET).length, 1, `${what}: not listed`);
    assert.deepEqual(names(result.restrictions.inForce, BUCKET), [], `${what}: in force`);
    assert.equal(names(result.restrictions.inForce, DOZE).length, 1, `${what}: Doze held`);
    assert.equal(result.status, 'passed', `${what}: no gap over 120 s under deep Doze`);
  }
});

test('SPIKE-01-AC7: with the exemption, a run in which deep Doze did not hold is invalid, never passed, and a gap over 120 s is still failed', async () => {
  const cases = [
    ['Doze ended before the restrictions did', readings({}, { idle: 'ACTIVE' })],
    ['Doze never began', readings({ idle: 'ACTIVE' }, { idle: 'ACTIVE' })],
  ];
  for (const [what, inForce] of cases) {
    const result = await judgeS3({
      exemption: true,
      records: run(minutely({ exempt: true })),
      inForce,
    });
    assert.equal(result.status, 'invalid', `${what}: nothing held the app in Doze`);
    assert.match(result.evidence.join('\n'), /doze|idle/i, `${what}: the evidence does not say`);
    assert.equal(names(result.restrictions.notShown, DOZE).length, 1, `${what}: not listed`);
  }

  const times = [
    ...every(MIN, 30 * S, 20 * MIN + 30 * S),
    ...every(MIN, 22 * MIN + 31 * S, END - 29 * S),
  ];
  const gap = await judgeS3({
    exemption: true,
    records: run(times.map((t) => arrival(t, { exempt: true }))),
    inForce: readings({}, { idle: 'ACTIVE' }),
  });
  assert.equal(gap.status, 'failed', 'a gap already seen is final');
});

test('SPIKE-01-AC7: without the exemption the verdict rests on the report before the restrictions, so what did not hold is listed and changes nothing', async () => {
  const result = await judgeS3({
    exemption: false,
    records: run(minutely({ exempt: false })),
    inForce: readings({}, { idle: 'ACTIVE', bucket: '10' }),
  });
  assert.equal(result.status, 'passed');
  assert.equal(names(result.restrictions.notShown, DOZE).length, 1, 'Doze is not listed');
  assert.equal(names(result.restrictions.notShown, BUCKET).length, 1, 'the bucket is not listed');
});

test('SPIKE-01-AC7: a run without the record of what was in force is refused, never judged as if the restrictions held', async () => {
  const records = run(minutely({ exempt: true }));
  await refuses(judgeS3({ exemption: true, records, inForce: undefined }), 'no record at all');
  await refuses(
    judgeS3({ exemption: true, records, inForce: { start: HELD.start } }),
    'no reading at the end',
  );
  await refuses(
    judgeS3({ exemption: true, records, inForce: { start: { idle: 'IDLE' }, end: HELD.end } }),
    'no bucket at the start',
  );
});

// With the exemption, a failure shown stays final (the safety review's B2a,
// 2026-10-01), as in S1: a gap over 120 s seen with the ticks intact at that
// time is failed, unless a break with a time overlaps that gap (a hole in the
// ticks, or a sleep's span as readSleeps gives it, { text, from, to } on the
// Mac's wall clock). A break elsewhere does not rescue it. A break the driver
// saw, with no time, still makes the run invalid.

/** With the exemption: arrivals every minute but for one gap of 121 s, from 20 min 30 s to 22 min 31 s. */
const gapOf121s = (options) =>
  run(
    [...every(MIN, 30 * S, 20 * MIN + 30 * S), ...every(MIN, 22 * MIN + 31 * S, END - 29 * S)].map(
      (t) => arrival(t, { exempt: true }),
    ),
    options,
  );
/** A sleep of the Mac, `secs` long from `t` into the journey, as readSleeps gives it. */
const sleepBreak = (t, secs) => ({
  text: `the Mac slept: pmset logged Sleep at ${t / MIN} min into the journey for ${secs} secs`,
  from: WALL0 + t,
  to: WALL0 + t + secs * S,
});

test('SPIKE-01-AC7: with the exemption, a gap over 120 s seen with the ticks intact at that time is failed, even with a hole in the ticks or a sleep elsewhere in the run', async () => {
  const hole = await judgeS3({
    exemption: true,
    records: gapOf121s({ tickHoles: [[35 * MIN, 36 * MIN]] }),
  });
  assert.equal(hole.status, 'failed', 'a hole in the ticks after the gap rescued it');
  assert.match(hole.evidence.join('\n'), /tick/i, 'the hole is not in the evidence');

  const slept = sleepBreak(40 * MIN, 60);
  const sleep = await judgeS3({ exemption: true, records: gapOf121s(), breaks: [slept] });
  assert.equal(sleep.status, 'failed', 'a sleep after the gap rescued it');
  assert.ok(sleep.evidence.includes(slept.text), 'the sleep is not in the evidence');
});

test('SPIKE-01-AC13: with the exemption, a hole in the ticks or a sleep over the gap makes an S3 run invalid, and so does a break with no time', async () => {
  const hole = await judgeS3({
    exemption: true,
    records: gapOf121s({ tickHoles: [[21 * MIN, 22 * MIN]] }),
  });
  assert.equal(hole.status, 'invalid', 'a receiver outage was judged as a silent phone');

  const slept = sleepBreak(21 * MIN, 60);
  const sleep = await judgeS3({ exemption: true, records: gapOf121s(), breaks: [slept] });
  assert.equal(sleep.status, 'invalid', "the Mac's sleep was judged as a silent phone");
  assert.ok(sleep.evidence.includes(slept.text), 'the sleep is not in the evidence');

  const untimed = await judgeS3({
    exemption: true,
    records: gapOf121s(),
    breaks: ['the emulator exited'],
  });
  assert.equal(
    untimed.status,
    'invalid',
    'a break that could have been during the gap was ignored',
  );
});

// With the exemption, judged on the stretches the harness was intact for, as
// in S1 (review loop 2): every timed break is taken out of the gap together,
// and a stretch over 120 s left with the ticks up makes the run failed. Only
// when none is left is it invalid. gapOf121s above is too short to tell the
// two rules apart, so these use a gap of 200 s, from 20 min 30 s to 23 min
// 50 s. The ticks are at 5 s past each 10 s.

/** With the exemption: arrivals every minute but for one gap of 200 s, from 20 min 30 s to 23 min 50 s. */
const gapOf200s = (options) =>
  run(
    [...every(MIN, 30 * S, 20 * MIN + 30 * S), ...every(MIN, 23 * MIN + 50 * S, END - 10 * S)].map(
      (t) => arrival(t, { exempt: true }),
    ),
    options,
  );

test('SPIKE-01-AC7: with the exemption, a gap that a break covers only in part, leaving more than 120 s with the ticks up, is failed, and the break stays in the evidence', async () => {
  // No tick from 22 min 55 s to 24 min 35 s: 145 s of the gap are left before it.
  const hole = await judgeS3({
    exemption: true,
    records: gapOf200s({ tickHoles: [[23 * MIN, 24 * MIN + 30 * S]] }),
  });
  assert.equal(hole.status, 'failed', 'a hole over the end of the gap rescued the 145 s before it');
  assert.equal(hole.largestGapMs, 200 * S);
  assert.match(hole.evidence.join('\n'), /tick/i, 'the hole is not in the evidence');

  // A sleep from 20 min to 21 min leaves the gap's last 170 s.
  const slept = sleepBreak(20 * MIN, 60);
  const sleep = await judgeS3({ exemption: true, records: gapOf200s(), breaks: [slept] });
  assert.equal(sleep.status, 'failed', 'a sleep over the start of the gap rescued 170 s');
  assert.ok(sleep.evidence.includes(slept.text), 'the sleep is not in the evidence');
});

test('SPIKE-01-AC13: with the exemption, breaks that together leave no stretch of the gap over 120 s make an S3 run invalid', async () => {
  // A sleep from 21 min to 22 min leaves 30 s and 110 s.
  const inside = await judgeS3({
    exemption: true,
    records: gapOf200s(),
    breaks: [sleepBreak(21 * MIN, 60)],
  });
  assert.equal(inside.status, 'invalid', "the Mac's sleep was judged as a silent phone");

  // A sleep from 20 min to 21 min 30 s and the hole from 22 min 55 s to
  // 24 min 35 s leave 85 s between them; each alone would leave over 120 s.
  const both = await judgeS3({
    exemption: true,
    records: gapOf200s({ tickHoles: [[23 * MIN, 24 * MIN + 30 * S]] }),
    breaks: [sleepBreak(20 * MIN, 90)],
  });
  assert.equal(both.status, 'invalid', 'the breaks were taken out of the gap one at a time');
});

// Without the exemption, the verdict is settled when the restrictions start:
// the app's "not exempt" report reached the receiver before them, or it did
// not (review loop 2, the same principle). So only a break before the
// "restrictions-started" mark, or over it, can explain a missing report, and
// makes the run invalid. A timed break after it does not rescue a report that
// never came with the harness intact, and stays in the evidence. A break with
// no time could have been anywhere, so it makes the run invalid; and a run
// that would pass is invalid with any break, as before.

/** Without the exemption: the app says it is exempt, so no "not exempt" report ever comes. */
const neverReported = (options) => run(minutely({ exempt: true }), options);

test('SPIKE-01-AC7: without the exemption, no "not exempt" report before the restrictions is failed even with a hole in the ticks or a sleep after they started, and the break stays in the evidence', async () => {
  const hole = await judgeS3({
    exemption: false,
    records: neverReported({ tickHoles: [[20 * MIN, 22 * MIN]] }),
  });
  assert.equal(hole.status, 'failed', 'a hole at 20 min rescued a report missed at 2 min');
  assert.equal(hole.notExemptReported, false);
  assert.match(hole.evidence.join('\n'), /tick/i, 'the hole is not in the evidence');

  const slept = sleepBreak(30 * MIN, 60);
  const sleep = await judgeS3({ exemption: false, records: neverReported(), breaks: [slept] });
  assert.equal(sleep.status, 'failed', 'a sleep at 30 min rescued a report missed at 2 min');
  assert.ok(sleep.evidence.includes(slept.text), 'the sleep is not in the evidence');
});

test('SPIKE-01-AC13: without the exemption, a break before the restrictions or over their start, or one with no time, makes a run with no "not exempt" report invalid; and a run with the report is invalid with any break', async () => {
  const cases = [
    // No tick from 35 s to 1 min 55 s, before the mark at 2 min.
    ['a hole before the restrictions', neverReported({ tickHoles: [[40 * S, MIN + 50 * S]] }), []],
    // No tick from 1 min 45 s to 2 min 25 s, over the mark.
    [
      'a hole over their start',
      neverReported({ tickHoles: [[MIN + 50 * S, 2 * MIN + 20 * S]] }),
      [],
    ],
    ['a sleep over their start', neverReported(), [sleepBreak(MIN + 30 * S, 60)]],
    ['a break with no time', neverReported(), ['the emulator exited']],
    [
      'the report came, and a hole after the restrictions started',
      run(minutely({ exempt: false }), { tickHoles: [[20 * MIN, 22 * MIN]] }),
      [],
    ],
    [
      'the report came, and a sleep after the restrictions started',
      run(minutely({ exempt: false })),
      [sleepBreak(30 * MIN, 60)],
    ],
  ];
  for (const [what, records, breaks] of cases) {
    const result = await judgeS3({ exemption: false, records, breaks });
    assert.equal(result.status, 'invalid', what);
    assert.ok(result.evidence.length > 0, `${what}: invalid without its evidence`);
  }
});

test('SPIKE-01-AC7: without the exemption, a "not exempt" report that reaches the receiver exactly as the restrictions start is not before them, and fails; 1 ms earlier passes', async () => {
  /** Unknown at 30 s and 1 min 30 s, then "not exempt" from `first` on. */
  const reportFrom = (first) =>
    run(
      [
        ...[30 * S, MIN + 30 * S].map((t) => arrival(t, { exempt: null })),
        arrival(first, { exempt: false }),
        ...every(MIN, 2 * MIN + 30 * S, END - 30 * S).map((t) => arrival(t, { exempt: false })),
      ],
      {},
    );
  const atTheMark = await judgeS3({ exemption: false, records: reportFrom(RESTRICTED) });
  assert.equal(atTheMark.notExemptReported, false, 'a report at the mark counted as before it');
  assert.equal(atTheMark.status, 'failed');

  const justBefore = await judgeS3({ exemption: false, records: reportFrom(RESTRICTED - 1) });
  assert.equal(justBefore.notExemptReported, true);
  assert.equal(justBefore.status, 'passed');
});
