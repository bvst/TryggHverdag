// SPIKE-01: the S4 verdict (analysis/s4.mjs): positions recorded offline
// arrive, in order, after 3 minutes offline, and the queue empties.
//
// Records are synthetic and shaped as the receiver writes them (see
// s1.test.mjs). `held` is the list of SDK record IDs the device held in its
// queue when the offline window closed. Arrival order is the order of the
// records; "the order the device recorded them" is `recordedAt`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const judgeS4 = async (input) => (await import('./s4.mjs')).judgeS4(input);

const S = 1_000;
const MIN = 60 * S;
const WALL0 = Date.UTC(2031, 0, 1, 21, 0, 0);
const MONO0 = 7_000_000;
const OFFLINE = 5 * MIN;
const ONLINE = 8 * MIN;
const END = 15 * MIN;
/** When the device recorded each held position, inside the offline window. */
const RECORDED = {
  'held-1': 5 * MIN + 20 * S,
  'held-2': 6 * MIN,
  'held-3': 6 * MIN + 40 * S,
  'held-4': 7 * MIN + 20 * S,
};
const HELD = Object.keys(RECORDED);

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
const held = (id, t) => arrival(t, { recordId: id, recordedAt: iso(RECORDED[id]), queueCount: 4 });

/** Times from `from` to `to`, `step` apart, both ends included. */
const every = (step, from, to) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

/** Online until 5 min, offline until 8 min, then `afterReconnect`; ticks every 10 s. */
function run(afterReconnect, { tickHoles = [] } = {}) {
  const ticks = every(10 * S, -5 * S, END + 5 * S)
    .filter((t) => !tickHoles.some(([from, to]) => t > from && t < to))
    .map(tick);
  return [
    mark('journey-started', 0),
    mark('offline-started', OFFLINE),
    mark('offline-ended', ONLINE),
    ...ticks,
    ...every(MIN, 30 * S, 4 * MIN + 30 * S).map((t) => arrival(t)),
    ...afterReconnect,
    mark('journey-ended', END),
  ].sort((a, b) => a.mono - b.mono);
}

/**
 * The held positions in `order`: the first two in one upload 5 s after
 * reconnecting, the rest 12 s after; then heartbeats reporting `queueAfter`.
 */
const flushed = (order = HELD, queueAfter = 0) => [
  ...order.slice(0, 2).map((id) => held(id, ONLINE + 5 * S)),
  ...order.slice(2).map((id) => held(id, ONLINE + 12 * S)),
  ...every(MIN, 9 * MIN, 14 * MIN).map((t) => arrival(t, { queueCount: queueAfter })),
];

test('SPIKE-01-AC8: every held position arrives, in recorded order, and the queue empties: passed, with the flush times recorded', async () => {
  const result = await judgeS4({ records: run(flushed()), held: HELD });
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.missing, []);
  assert.equal(result.outOfOrder, false);
  assert.equal(result.queueEmptied, true);
  assert.equal(result.duplicates, 0);
  assert.equal(result.firstArrivalAfterReconnectMs, 5 * S);
  assert.equal(result.lastArrivalAfterReconnectMs, 12 * S);
});

test('SPIKE-01-AC8: a held position that never arrives fails', async () => {
  const result = await judgeS4({
    records: run(flushed(['held-1', 'held-2', 'held-4'])),
    held: HELD,
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.missing, ['held-3']);
});

test('SPIKE-01-AC8: positions that arrive out of recorded order fail', async () => {
  const result = await judgeS4({
    records: run(flushed(['held-1', 'held-3', 'held-2', 'held-4'])),
    held: HELD,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.outOfOrder, true);
  assert.deepEqual(result.missing, []);
});

test('SPIKE-01-AC8: a queue the app still reports as non-empty after the flush fails', async () => {
  const result = await judgeS4({ records: run(flushed(HELD, 2)), held: HELD });
  assert.equal(result.status, 'failed');
  assert.equal(result.queueEmptied, false);
});

test('SPIKE-01-AC8: duplicates are recorded, not judged', async () => {
  const records = run([...flushed(), held('held-2', ONLINE + 20 * S)]);
  const result = await judgeS4({ records, held: HELD });
  assert.equal(result.status, 'passed');
  assert.equal(result.duplicates, 1);
});

test('SPIKE-01-AC8: a run in which the device held nothing offline has not passed', async () => {
  const records = run(every(MIN, 9 * MIN, 14 * MIN).map((t) => arrival(t)));
  const result = await judgeS4({ records, held: [] });
  assert.equal(result.status, 'failed', 'nothing was tested, so nothing passed');
});

test("SPIKE-01-AC13: a gap in the receiver's ticks, or a break the driver saw, makes an S4 run invalid", async () => {
  const outage = await judgeS4({
    records: run(flushed(), { tickHoles: [[6 * MIN, 7 * MIN]] }),
    held: HELD,
  });
  assert.equal(outage.status, 'invalid');
  assert.match(outage.evidence.join('\n'), /tick/i);

  const broken = await judgeS4({
    records: run(flushed()),
    held: HELD,
    breaks: ['the simulator exited at 9 min'],
  });
  assert.equal(broken.status, 'invalid');
  assert.ok(broken.evidence.includes('the simulator exited at 9 min'), 'the evidence was not kept');
});

// S4 cuts the device off "for 3 minutes", so the offline window, from the
// "offline-started" mark to the "offline-ended" mark, must last 3 min. A
// shorter window means the driver did not run the scenario: the run is
// invalid, never passed or failed, with the measured and the required duration
// as evidence.

/** The same records with the driver's `label` mark moved to `t`. */
const moveMark = (records, label, t) =>
  records
    .map((record) => (record.kind === 'mark' && record.label === label ? mark(label, t) : record))
    .sort((a, b) => a.mono - b.mono);

test('SPIKE-01-AC8: an offline window of exactly 3 min is long enough, and one 1 ms shorter is invalid, not passed', async () => {
  const full = await judgeS4({ records: run(flushed()), held: HELD });
  assert.equal(full.status, 'passed');
  assert.equal(full.offlineMs, 3 * MIN);

  const short = await judgeS4({
    records: moveMark(run(flushed()), 'offline-ended', ONLINE - 1),
    held: HELD,
  });
  assert.equal(short.status, 'invalid', 'an offline window of 2 min 59.999 s was judged');
  assert.ok(short.evidence.length > 0, 'an invalid run needs its evidence');
});

test('SPIKE-01-AC8: a 1-minute offline window is invalid, never passed, with the measured and the required duration as evidence', async () => {
  // Offline 5 min to 6 min: one position held, flushed 5 s after, the queue then empty.
  const records = moveMark(
    run([held('held-1', 6 * MIN + 5 * S), ...every(MIN, 9 * MIN, 14 * MIN).map((t) => arrival(t))]),
    'offline-ended',
    6 * MIN,
  );
  const result = await judgeS4({ records, held: ['held-1'] });
  assert.equal(result.status, 'invalid', 'a flush after 1 min offline passed for one after 3 min');
  const evidence = result.evidence.join('\n');
  assert.match(evidence, /\b1 min\b/, 'the evidence does not say how long the device was offline');
  assert.match(evidence, /\b3 min\b/, 'the evidence does not say how long S4 must cut it off');
});

test('SPIKE-01-AC8: a 10-second offline window in which the device held nothing is invalid, not failed', async () => {
  const records = moveMark(
    run(every(MIN, 9 * MIN, 14 * MIN).map((t) => arrival(t))),
    'offline-ended',
    OFFLINE + 10 * S,
  );
  const result = await judgeS4({ records, held: [] });
  assert.equal(result.status, 'invalid', 'the SDK was blamed for a window the driver cut to 10 s');
  const evidence = result.evidence.join('\n');
  assert.match(evidence, /\b10 s\b/, 'the evidence does not say how long the device was offline');
  assert.match(evidence, /\b3 min\b/, 'the evidence does not say how long S4 must cut it off');
});

// After reconnecting, the run must watch for at least 5 min, D-021's
// lost-contact threshold, from the "offline-ended" mark to the "journey-ended"
// mark. A journey that ends sooner has not given the held positions and the
// queue report time to arrive, so calling them missing would blame the SDK for
// the driver. Such a run is never passed, and it is invalid, with the measured
// and the required duration as evidence. But an out-of-order arrival it has
// already seen is final: more watching could not undo it, and an invalid run
// is re-run, which must never replace a failure (AC13, D-060). That run is
// failed, with the same evidence.

/** The same records with the journey ended `after` ms after reconnecting. */
const endedAfterReconnect = (records, after) => moveMark(records, 'journey-ended', ONLINE + after);

/** Asserts the evidence gives the time watched after reconnecting and the 5 min required. */
function namesBothDurations(result, watched, what) {
  const evidence = result.evidence.join('\n');
  assert.match(evidence, watched, `${what}: the evidence does not say how long the run watched`);
  assert.match(evidence, /\b5 min\b/, `${what}: the evidence does not say how long S4 must watch`);
}

test('SPIKE-01-AC8: watching exactly 5 min after reconnecting is long enough, and 1 ms less is invalid, not passed', async () => {
  const full = await judgeS4({
    records: endedAfterReconnect(run(flushed()), 5 * MIN),
    held: HELD,
  });
  assert.equal(full.status, 'passed');
  assert.deepEqual(full.evidence, []);

  const short = await judgeS4({
    records: endedAfterReconnect(run(flushed()), 5 * MIN - 1),
    held: HELD,
  });
  assert.equal(
    short.status,
    'invalid',
    'a run that watched for 4 min 59.999 s after reconnecting was judged',
  );
  assert.ok(short.evidence.length > 0, 'an invalid run needs its evidence');
});

test('SPIKE-01-AC8: a journey that ends 20 s after reconnecting, before every held position has arrived or the queue is reported empty, is invalid, not failed, with both durations as evidence', async () => {
  const cases = [
    [
      'two held positions still to come',
      [
        ...HELD.slice(0, 2).map((id) => held(id, ONLINE + 5 * S)),
        ...HELD.slice(2).map((id) => held(id, ONLINE + 40 * S)),
        ...every(MIN, 9 * MIN, 14 * MIN).map((t) => arrival(t)),
      ],
    ],
    ['all held positions in, the queue not yet reported', flushed()],
  ];
  for (const [what, afterReconnect] of cases) {
    const result = await judgeS4({
      records: endedAfterReconnect(run(afterReconnect), 20 * S),
      held: HELD,
    });
    assert.equal(
      result.status,
      'invalid',
      `${what}: the SDK was blamed for a run that stopped watching`,
    );
    namesBothDurations(result, /\b20 s\b/, what);
  }
});

test('SPIKE-01-AC8: an out-of-order arrival already seen 20 s after reconnecting is failed, not invalid: more watching could not undo it', async () => {
  const cases = [
    ['all four in, held-3 before held-2', flushed(['held-1', 'held-3', 'held-2', 'held-4'])],
    [
      'held-2 before held-1, two still to come',
      [
        held('held-2', ONLINE + 5 * S),
        held('held-1', ONLINE + 12 * S),
        held('held-3', ONLINE + 40 * S),
        held('held-4', ONLINE + 40 * S),
        ...every(MIN, 9 * MIN, 14 * MIN).map((t) => arrival(t)),
      ],
    ],
  ];
  for (const [what, afterReconnect] of cases) {
    const result = await judgeS4({
      records: endedAfterReconnect(run(afterReconnect), 20 * S),
      held: HELD,
    });
    assert.equal(
      result.status,
      'failed',
      `${what}: a re-run could replace an order already broken`,
    );
    assert.equal(result.outOfOrder, true, what);
    namesBothDurations(result, /\b20 s\b/, what);
  }
});

test("SPIKE-01-AC13: an out-of-order arrival seen 20 s after reconnecting is still invalid when the receiver's ticks stopped", async () => {
  const result = await judgeS4({
    records: endedAfterReconnect(
      run(flushed(['held-1', 'held-3', 'held-2', 'held-4']), {
        tickHoles: [[ONLINE - 5 * S, ONLINE + 25 * S]],
      }),
      20 * S,
    ),
    held: HELD,
  });
  assert.equal(
    result.status,
    'invalid',
    'an order broken while the receiver was down was blamed on the SDK',
  );
  assert.match(result.evidence.join('\n'), /tick/i);
});
