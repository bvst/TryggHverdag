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

const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError];
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
