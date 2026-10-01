// SPIKE-01: the go/no-go rule (analysis/go-no-go.mjs), applied item by item.
//
// The items that decide the SDK: the build (AC2), S1, S3 (Android only, with
// the exemption), S4, S7, the capture (AC12) and the licence as read by hand.
// "Not shown" is never a pass and never a NO-GO. S2, S5, S6 and S8 give
// findings, not a NO-GO, and so do S3 without the exemption and S5's "heard",
// each a line of its own. An S7 run that failed is a finding only where its
// own process ended and nothing arrived after the change.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const goNoGo = async (verdicts) => (await import('./go-no-go.mjs')).goNoGo(verdicts);

const P = 'passed';
const F = 'failed';
const N = 'not shown on simulators';
const NV = 'no verdict';

/**
 * S7's runs, each with what the go/no-go needs to excuse a failure: whether
 * the platform ended the app's process on the change, and how many arrivals
 * came after it. All passed here. Android's background case ended the process
 * and came back at once (as on the night of 2026-09-30); its fine case kept it.
 */
const S7_RUNS = [
  ['android', 'background', 1, true, 28],
  ['android', 'background', 2, true, 28],
  ['android', 'fine', 1, false, 9],
  ['android', 'fine', 2, false, 9],
  ['ios', 'always-to-inuse', 1, false, 21],
  ['ios', 'always-to-inuse', 2, false, 20],
].map(([platform, name, n, processEnded, arrivalsAfterChange]) => ({
  id: `night-20310101-s7-${platform}-${name}-${n}`,
  platform,
  case: name,
  status: P,
  processEnded,
  arrivalsAfterChange,
}));

/** Every verdict as the rule reads it, all passed where the device can show it, changed by `change`. */
function verdicts(change = () => {}) {
  const all = {
    build: { android: P, ios: P },
    S1: { android: P, ios: P },
    S2: { android: P, ios: P },
    S3: { android: P },
    'S3 not exempt': { android: P },
    S4: { android: P, ios: P },
    S5: { android: P, ios: P },
    'S5 heard': { android: P, ios: N },
    S6: { android: P, ios: N },
    S7: { android: P, ios: P, runs: structuredClone(S7_RUNS) },
    S8: { android: P, ios: P },
    capture: { android: P, ios: N },
    licence: P,
  };
  change(all);
  return all;
}

/** Sets one item's verdict on one platform (none for the licence). */
const set = (item, platform, verdict) => (all) => {
  if (platform === null) all[item] = verdict;
  else all[item][platform] = verdict;
};

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

/** S7 failed on `platform` in `name`'s runs, each run changed to `fields`. */
const s7Failed = (platform, name, fields) => (all) => {
  all.S7[platform] = F;
  for (const run of all.S7.runs.filter((r) => r.platform === platform && r.case === name)) {
    Object.assign(run, { status: F, ...fields });
  }
};
const EXCUSED = { processEnded: true, arrivalsAfterChange: 0 };

test('SPIKE-01-AC15: S7 failing where the platform ended the process is a finding, not NO-GO', async () => {
  const result = await goNoGo(verdicts(s7Failed('ios', 'always-to-inuse', EXCUSED)));
  assert.equal(result.recommendation, 'GO');
  assert.ok(find(result.findings, 'S7', 'ios'), 'the ended process is not reported as a finding');
});

test("SPIKE-01-AC15: S7 per run: Android's fine case failing where its own process ended and nothing arrived after the change is a finding, while its background case passed after a quick restart", async () => {
  const result = await goNoGo(verdicts(s7Failed('android', 'fine', EXCUSED)));
  assert.equal(result.recommendation, 'GO', 'an excused failure decided the SDK');
  assert.ok(find(result.findings, 'S7', 'android'), 'the excused failure is not a finding');
});

test('SPIKE-01-AC15: S7 per run: a failed run is not excused when its process kept running, or when anything arrived after the change, a quick restart included', async () => {
  const cases = [
    [
      'the process kept running, and nothing arrived',
      { processEnded: false, arrivalsAfterChange: 0 },
    ],
    [
      'the process kept running, and heartbeats came',
      { processEnded: false, arrivalsAfterChange: 12 },
    ],
    [
      'the process ended, restarted, and arrivals came',
      { processEnded: true, arrivalsAfterChange: 3 },
    ],
  ];
  for (const [what, fields] of cases) {
    const result = await goNoGo(verdicts(s7Failed('android', 'fine', fields)));
    assert.equal(result.recommendation, 'NO-GO', `${what}, yet GO`);
  }
});

test("SPIKE-01-AC15: S7 per run: one run's excuse never covers another run's failure, in another case or the same one", async () => {
  const otherCase = await goNoGo(
    verdicts((all) => {
      s7Failed('android', 'fine', EXCUSED)(all);
      s7Failed('android', 'background', { processEnded: false, arrivalsAfterChange: 15 })(all);
    }),
  );
  assert.equal(
    otherCase.recommendation,
    'NO-GO',
    "the fine case's excuse covered the background case",
  );

  const sameCase = await goNoGo(
    verdicts((all) => {
      s7Failed('android', 'fine', EXCUSED)(all);
      const second = all.S7.runs.find((r) => r.id.endsWith('-fine-2'));
      Object.assign(second, { processEnded: true, arrivalsAfterChange: 2 });
    }),
  );
  assert.equal(
    sameCase.recommendation,
    'NO-GO',
    "one run's excuse covered the other run of its case",
  );
});

test('SPIKE-01-AC15: S7 failed with no failed run listed has nothing to excuse it, and gives NO-GO', async () => {
  const result = await goNoGo(verdicts(set('S7', 'android', F)));
  assert.equal(result.recommendation, 'NO-GO', 'an empty list of failed runs excused the failure');
});

test('SPIKE-01-AC15: a failed S7 run that does not say whether its process ended, or how many arrivals came after the change, is refused', async () => {
  // The control: with both said, the same failure is judged, not refused.
  const control = await goNoGo(verdicts(s7Failed('android', 'fine', EXCUSED)));
  assert.equal(control.recommendation, 'GO', 'the control was not judged per run');
  const missing = [
    ['no processEnded', { processEnded: undefined, arrivalsAfterChange: 0 }],
    ['no arrivalsAfterChange', { processEnded: true, arrivalsAfterChange: undefined }],
  ];
  for (const [what, fields] of missing) {
    await refuses(goNoGo(verdicts(s7Failed('android', 'fine', fields))), what);
  }
});

// "No verdict" (the safety review's B3): a case with fewer than two valid runs.
// While any deciding item has no verdict, the rule gives neither GO nor NO-GO,
// and says which item stopped it.

test('SPIKE-01-AC15: while any deciding item has no verdict, the rule refuses to recommend, neither GO nor NO-GO, and says which item has none', async () => {
  for (const [item, platform] of DECIDING) {
    const where = `${item} ${platform ?? ''}`;
    const result = await goNoGo(verdicts(set(item, platform, NV)));
    assert.equal(result.recommendation, null, `${where} had no verdict, yet a recommendation`);
    const [headline] = result.text.split('\n');
    assert.match(headline, /no recommendation/i, `${where}: the headline does not say so`);
    assert.doesNotMatch(headline, /\bGO\b/, `${where}: the headline still recommends`);
    assert.ok(
      result.text
        .split('\n')
        .some(
          (line) =>
            line.includes(item) &&
            /no verdict/i.test(line) &&
            (platform === null || line.includes(platform)),
        ),
      `${where}: the text does not say which item has no verdict`,
    );
  }
});

test('SPIKE-01-AC15: an item that does not decide may have no verdict: the rule still recommends, and lists it', async () => {
  const result = await goNoGo(verdicts(set('S5', 'android', NV)));
  assert.equal(result.recommendation, 'GO');
  assert.ok(
    result.text
      .split('\n')
      .some(
        (line) =>
          /\bS5\b/.test(line) &&
          !line.includes('heard') &&
          line.includes('android') &&
          /no verdict/i.test(line),
      ),
    'S5 on Android is not listed with no verdict',
  );
});

test('SPIKE-01-AC15: S3 without the exemption and S5\'s "heard" are lines of their own that do not decide: failing them gives findings, not NO-GO', async () => {
  for (const [item, platform] of [
    ['S3 not exempt', 'android'],
    ['S5 heard', 'android'],
  ]) {
    const result = await goNoGo(verdicts(set(item, platform, F)));
    assert.equal(result.recommendation, 'GO', `${item} decided the SDK`);
    assert.ok(find(result.findings, item, platform), `${item} is not a finding`);
    const entry = find(result.items, item, platform);
    assert.ok(entry, `${item} is not among the items`);
    assert.equal(entry.deciding, false, `${item} is marked as deciding`);
  }
});

test("SPIKE-01-AC15: findings given with the verdicts, such as S2's, are listed with their run", async () => {
  const finding = {
    item: 'S2',
    platform: 'android',
    run: 'night-20310101-s2-android-lmk-1',
    why: '1 reminder(s) said protection had stopped while arrivals continued',
  };
  const result = await goNoGo(
    verdicts((all) => {
      all.findings = [finding];
    }),
  );
  assert.equal(result.recommendation, 'GO');
  assert.ok(
    result.findings.some((f) => f.item === 'S2' && f.run === finding.run && f.why === finding.why),
    "S2's finding is not among the findings",
  );
  assert.ok(result.text.includes(finding.why), "the printed text does not give S2's finding");
  assert.ok(result.text.includes(finding.run), "the printed text does not give the finding's run");
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
