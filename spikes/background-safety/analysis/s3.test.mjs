// SPIKE-01: the S3 verdict (analysis/s3.mjs), Android only: stock Android's
// restrictions, with and without the battery-optimisation exemption.
//
// Records are synthetic and shaped as the receiver writes them (see
// s1.test.mjs). The driver marks the moment it starts the restrictions.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const judgeS3 = async (input) => (await import('./s3.mjs')).judgeS3(input);

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
