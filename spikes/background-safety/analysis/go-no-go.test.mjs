// SPIKE-01: the go/no-go rule (analysis/go-no-go.mjs), applied item by item.
//
// The items that decide the SDK: the build (AC2), S1, S3 (Android only), S4,
// S7, the capture (AC12) and the licence as read by hand. "Not shown" is never
// a pass and never a NO-GO. S2, S5, S6 and S8 give findings, not a NO-GO, and
// so does S7 where the platform ended the app's process.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const goNoGo = async (verdicts) => (await import('./go-no-go.mjs')).goNoGo(verdicts);

const P = 'passed';
const F = 'failed';
const N = 'not shown on simulators';

/** Every verdict as the rule reads it, all passed where the device can show it, changed by `change`. */
function verdicts(change = () => {}) {
  const all = {
    build: { android: P, ios: P },
    S1: { android: P, ios: P },
    S2: { android: P, ios: P },
    S3: { android: P },
    S4: { android: P, ios: P },
    S5: { android: P, ios: P },
    S6: { android: P, ios: N },
    S7: { android: P, ios: P, processEnded: { android: false, ios: false } },
    S8: { android: P, ios: P },
    capture: { android: P, ios: N },
    licence: P,
  };
  change(all);
  return all;
}

/** The items that decide, with their platform (none for the licence). */
const DECIDING = [
  ['build', 'android'],
  ['build', 'ios'],
  ['S1', 'android'],
  ['S1', 'ios'],
  ['S3', 'android'],
  ['S4', 'android'],
  ['S4', 'ios'],
  ['S7', 'android'],
  ['S7', 'ios'],
  ['capture', 'android'],
  ['licence', null],
];
const NOT_DECIDING = [
  ['S2', 'android'],
  ['S2', 'ios'],
  ['S5', 'android'],
  ['S5', 'ios'],
  ['S6', 'android'],
  ['S8', 'android'],
  ['S8', 'ios'],
];

const find = (list, item, platform) =>
  list.find((entry) => entry.item === item && (entry.platform ?? null) === platform);
const fail = (item, platform) => (all) => {
  if (platform === null) all[item] = F;
  else all[item][platform] = F;
};

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

test("SPIKE-01-AC15: every deciding item passed gives GO, printed with each item's result", async () => {
  const result = await goNoGo(verdicts());
  assert.equal(result.recommendation, 'GO');
  assert.deepEqual(result.findings, []);
  const lines = result.text.split('\n');
  assert.ok(
    lines.some((line) => /\bGO\b/.test(line)),
    'the printed text does not say GO',
  );
  assert.equal(result.text.includes('NO-GO'), false);
  for (const [item, platform] of DECIDING) {
    const entry = find(result.items, item, platform);
    assert.ok(entry, `${item} ${platform ?? ''} is not among the items`);
    assert.equal(entry.verdict, P);
    assert.ok(
      lines.some(
        (line) =>
          line.includes(item) && line.includes(P) && (platform === null || line.includes(platform)),
      ),
      `the printed text has no line for ${item} ${platform ?? ''}`,
    );
  }
});

test('SPIKE-01-AC15: "not shown" never passes an item and never gives NO-GO: it is listed as open, until L9', async () => {
  const result = await goNoGo(
    verdicts((all) => {
      all.S1.ios = N;
      all.S4.ios = N;
    }),
  );
  assert.equal(result.recommendation, 'GO');
  assert.equal(find(result.items, 'S1', 'ios').verdict, N, 'a "not shown" item was passed');
  assert.equal(find(result.items, 'S4', 'ios').verdict, N, 'a "not shown" item was passed');
  for (const [item, platform] of [
    ['S1', 'ios'],
    ['S4', 'ios'],
    ['capture', 'ios'],
    ['S6', 'ios'],
  ]) {
    assert.ok(find(result.open, item, platform), `${item} ${platform} is not listed as open`);
  }
  assert.match(result.text, /\bL9\b/, 'the GO does not say what stays open until L9');
});

test('SPIKE-01-AC15: any failed SDK item gives NO-GO', async () => {
  for (const [item, platform] of DECIDING) {
    const result = await goNoGo(verdicts(fail(item, platform)));
    assert.equal(result.recommendation, 'NO-GO', `${item} ${platform ?? ''} failed, yet GO`);
    assert.ok(result.text.includes('NO-GO'), 'the printed text does not say NO-GO');
  }
});

test('SPIKE-01-AC15: S7 failing where the platform ended the process is a finding, not NO-GO', async () => {
  const result = await goNoGo(
    verdicts((all) => {
      all.S7.ios = F;
      all.S7.processEnded.ios = true;
    }),
  );
  assert.equal(result.recommendation, 'GO');
  assert.ok(find(result.findings, 'S7', 'ios'), 'the ended process is not reported as a finding');
});

test('SPIKE-01-AC15: S2, S5, S6 and S8 give findings, not NO-GO', async () => {
  for (const [item, platform] of NOT_DECIDING) {
    const result = await goNoGo(verdicts(fail(item, platform)));
    assert.equal(result.recommendation, 'GO', `${item} ${platform} decided the SDK`);
    assert.ok(find(result.findings, item, platform), `${item} ${platform} is not a finding`);
  }
});

test('SPIKE-01-AC15: a missing or unknown verdict is refused, never read as GO', async () => {
  const broken = [
    ['S4 missing', (all) => delete all.S4],
    ['S3 on Android missing', (all) => delete all.S3.android],
    ['no licence verdict', (all) => delete all.licence],
    ['the word "pass"', (all) => (all.S1.android = 'pass')],
    ['a run status as a verdict', (all) => (all.S7.ios = 'invalid')],
  ];
  for (const [what, change] of broken) {
    await refuses(goNoGo(verdicts(change)), what);
  }
});
