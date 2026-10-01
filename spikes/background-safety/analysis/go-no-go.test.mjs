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

// The SDK's documented settings (the spec's go/no-go rule: "NO-GO follows
// when any item fails and none of the SDK's documented settings fixes it.
// Every setting tried is recorded"; the code review's SF3, review loop 2).
// goNoGo takes each setting tried as `verdicts.settings`, a list of
// { item, platform, setting, verdict }, the verdict being one of the four.
// - A failed item whose setting passed is "passed with <setting>": not NO-GO,
//   and listed among `conditions` ({ item, platform, setting }), which the
//   text names as conditions.
// - A setting that failed, or has no verdict, leaves the item as it was:
//   failed, or with no verdict.
// - A setting covers its own item on its own platform only.
// - Every setting tried is printed, with its verdict.
// iOS S1 has no documented setting (the owner's Q4): failed, it stays failed
// and deciding, and is never listed as open until L9 (the safety review's
// loop 1, item 2): it failed, so it is not "not shown".

const EXEMPTION = 'the battery-optimisation exemption';
/** Adds the exemption, tried for `item` on `platform`, with `verdict`. */
const tried =
  (verdict, item = 'S1', platform = 'android') =>
  (all) => {
    all.settings = [...(all.settings ?? []), { item, platform, setting: EXEMPTION, verdict }];
  };
/** The lines of `text` that hold every one of `parts`. */
const linesWith = (text, ...parts) =>
  text.split('\n').filter((line) => parts.every((part) => line.includes(part)));
/** The lines of the "open until L9" list, up to the blank line after it. */
function openSection(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => /open until L9/i.test(line));
  if (at < 0) return [];
  const end = lines.findIndex((line, i) => i > at && line.trim() === '');
  return lines.slice(at + 1, end < 0 ? lines.length : end);
}

test('SPIKE-01-AC15: a failed item whose documented setting passed is "passed with" that setting: not NO-GO, and listed as a condition', async () => {
  const result = await goNoGo(
    verdicts((all) => {
      all.S1.android = F;
      tried(P)(all);
    }),
  );
  assert.equal(result.recommendation, 'GO', 'a failure the setting fixed gave NO-GO');
  assert.equal(
    find(result.conditions ?? [], 'S1', 'android')?.setting,
    EXEMPTION,
    'the setting is not listed as a condition',
  );
  assert.ok(
    linesWith(result.text, 'S1', 'android', `passed with ${EXEMPTION}`).length > 0,
    `S1 on Android is not reported as "passed with ${EXEMPTION}"`,
  );
  assert.match(result.text, /condition/i, 'the text does not name the conditions');
  assert.equal(find(result.open, 'S1', 'android'), undefined, 'S1 on Android is listed as open');

  // The control: on an item that passed, the setting is no condition.
  const passed = await goNoGo(verdicts(tried(P)));
  assert.equal(passed.recommendation, 'GO');
  assert.deepEqual(passed.conditions ?? [], [], 'a setting on a passed item became a condition');
});

test('SPIKE-01-AC15: a setting that failed, or has no verdict, leaves its item as it was: failed gives NO-GO, no verdict gives no recommendation; and the setting is printed with its verdict', async () => {
  const cases = [
    ['failed, the setting failed', F, F, 'NO-GO'],
    ['failed, the setting with no verdict', F, NV, 'NO-GO'],
    ['no verdict, the setting failed', NV, F, null],
    ['no verdict, the setting with no verdict', NV, NV, null],
  ];
  for (const [what, item, setting, recommendation] of cases) {
    const result = await goNoGo(
      verdicts((all) => {
        all.S1.android = item;
        tried(setting)(all);
      }),
    );
    assert.equal(result.recommendation, recommendation, what);
    assert.equal(find(result.conditions ?? [], 'S1', 'android'), undefined, `${what}: a condition`);
    assert.ok(
      linesWith(result.text, EXEMPTION, setting).length > 0,
      `${what}: the setting tried is not printed with its verdict`,
    );
  }
});

test('SPIKE-01-AC15: a setting covers its own item on its own platform only', async () => {
  const otherPlatform = await goNoGo(
    verdicts((all) => {
      all.S1.ios = F;
      tried(P, 'S1', 'android')(all);
    }),
  );
  assert.equal(otherPlatform.recommendation, 'NO-GO', "Android's setting fixed S1 on iOS");

  const otherItem = await goNoGo(
    verdicts((all) => {
      all.S4.android = F;
      tried(P, 'S1', 'android')(all);
    }),
  );
  assert.equal(otherItem.recommendation, 'NO-GO', "S1's setting fixed S4");
});

test('SPIKE-01-AC15: iOS S1, failed with no setting, stays failed and deciding: NO-GO with Android passed with its setting, and never listed as open until L9', async () => {
  const result = await goNoGo(
    verdicts((all) => {
      all.S1.android = F;
      all.S1.ios = F;
      tried(P)(all);
    }),
  );
  assert.equal(result.recommendation, 'NO-GO');
  const ios = find(result.items, 'S1', 'ios');
  assert.equal(ios?.verdict, F, 'iOS S1 is no longer failed');
  assert.equal(ios?.deciding, true, 'iOS S1 no longer decides');
  assert.equal(find(result.open, 'S1', 'ios'), undefined, 'iOS S1 is listed as open');
  assert.deepEqual(
    openSection(result.text).filter((line) => /\bS1\b/.test(line)),
    [],
    'S1 is in the printed "open until L9" list',
  );
  assert.ok(openSection(result.text).length > 0, 'the control: the open list is printed');
});

test('SPIKE-01-AC15: a setting that is not { item, platform, setting, verdict }, with one of the four verdicts, is refused', async () => {
  const broken = [
    ['settings that are not a list', (all) => (all.settings = 'the exemption')],
    [
      'no setting named',
      (all) => (all.settings = [{ item: 'S1', platform: 'android', setting: '', verdict: P }]),
    ],
    [
      'the word "pass"',
      (all) =>
        (all.settings = [{ item: 'S1', platform: 'android', setting: EXEMPTION, verdict: 'pass' }]),
    ],
    [
      'no item',
      (all) => (all.settings = [{ platform: 'android', setting: EXEMPTION, verdict: P }]),
    ],
  ];
  for (const [what, change] of broken) {
    await refuses(
      goNoGo(
        verdicts((all) => {
          all.S1.android = F;
          change(all);
        }),
      ),
      what,
    );
  }
});

// "S1 exempt" is a line only when its case was planned (implementer's loop-2
// green pass, RG-02). With no such key, the night did not plan the exempt
// case: the item is left out, not made up as no verdict or as open.

test('SPIKE-01-AC15: with no "S1 exempt" verdict given, the item is left out: not among the items, not printed, and not listed as no verdict or as open', async () => {
  const given = await goNoGo(verdicts((all) => (all['S1 exempt'] = { android: P })));
  assert.ok(find(given.items, 'S1 exempt', 'android'), 'the control: given, it is an item');
  assert.ok(linesWith(given.text, 'S1 exempt').length > 0, 'the control: given, it is printed');

  const result = await goNoGo(verdicts());
  assert.equal(result.recommendation, 'GO');
  const named = (list) => list.filter((entry) => entry.item === 'S1 exempt');
  assert.deepEqual(named(result.items), [], '"S1 exempt" is an item without a verdict given');
  assert.deepEqual(named(result.noVerdict), [], '"S1 exempt" is listed as no verdict');
  assert.deepEqual(named(result.open), [], '"S1 exempt" is listed as open until L9');
  assert.deepEqual(linesWith(result.text, 'S1 exempt'), [], '"S1 exempt" is printed');
});
