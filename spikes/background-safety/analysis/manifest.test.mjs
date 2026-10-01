// SPIKE-01: the night's manifest into the go/no-go's input
// (analysis/manifest.mjs), so that the input is computed and tested rather
// than written by hand (the code review's S7, 2026-10-01).
//
//   goNoGoInput({ entries, build, licence }) → the verdicts goNoGo takes
//
// `entries` are the manifest's lines as run-all.mjs writes them; `build` and
// `licence` are read by hand (AC2, AC15). Its rules:
// - each item's verdict per platform comes from its runs, as judgeScenario
//   gives it; runs recorded and not judged (S2's Force stop) never count;
// - S3's deciding item is the case with the exemption alone; the case without
//   it is a line of its own, "S3 not exempt";
// - AC12 is its own item, "capture", from the S1 run that carried the capture
//   (details.capture.status); iOS cannot show it;
// - S5 is the alert seen, with its text; "S5 heard" is a line of its own;
// - S7 goes per run, with whether the process ended and what arrived after
//   the change;
// - S2's findings are listed, each with its run.
// The entries are synthetic, in the manifest's shape (night-20260930).
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const goNoGoInput = async (input) => (await import('./manifest.mjs')).goNoGoInput(input);
const goNoGo = async (verdicts) => (await import('./go-no-go.mjs')).goNoGo(verdicts);

const P = 'passed';
const F = 'failed';
const N = 'not shown on simulators';
const NV = 'no verdict';
const WALL0 = Date.UTC(2031, 0, 1, 21, 0, 0);
const APP = 'org.example.spike.backgroundsafety';
/** Read by hand: the build (AC2) and the licence (AC15). */
const BY_HAND = { build: { android: P, ios: P }, licence: P };

/** One run's line in the manifest, as run-all.mjs writes it. */
function runEntry(scenario, platform, runCase, n, status, details = {}, extra = {}) {
  return {
    kind: 'run',
    key: `${scenario}/${platform}/${runCase ?? '-'}`,
    repeat: n,
    attempt: n,
    runId: `night-20310101-${scenario}-${platform}${runCase ? `-${runCase}` : ''}-${n}`,
    scenario,
    platform,
    case: runCase,
    tcpdump: false,
    judged: true,
    startedAt: WALL0,
    endedAt: WALL0 + 60_000,
    exitCode: 0,
    status,
    evidence: status === 'invalid' ? ['the receiver wrote no tick for 2 min'] : [],
    details,
    ...extra,
  };
}
/** Both planned runs of one case. */
const twice = (scenario, platform, runCase, status, details = {}, extra = {}) =>
  [1, 2].map((n) =>
    runEntry(scenario, platform, runCase, n, status, structuredClone(details), extra),
  );

/** A night in which every judged run passed, in the shapes the per-run judge gives its details. */
function night() {
  return [
    { kind: 'runner', event: 'started', at: WALL0, smoke: false },
    runEntry(
      's1',
      'android',
      null,
      1,
      P,
      {
        largestGapMs: 60_000,
        gapsOver60s: 0,
        gapsOver120s: 0,
        stateChanges: [],
        capture: { status: P, problems: [], flagged: [], destinations: [] },
      },
      { tcpdump: true },
    ),
    runEntry('s1', 'android', null, 2, P, { largestGapMs: 60_000 }),
    ...twice('s3', 'android', 'exempt', P, { exemption: true, notExemptReported: false }),
    ...twice('s3', 'android', 'not-exempt', P, { exemption: false, notExemptReported: true }),
    ...twice('s4', 'android', null, P, { missing: [], outOfOrder: false, queueEmptied: true }),
    ...twice('s7', 'android', 'background', P, {
      reportDelayMs: 6_600,
      arrivalsAfterChange: 28,
      processEnded: true,
    }),
    ...twice('s7', 'android', 'fine', P, {
      reportDelayMs: 20_000,
      arrivalsAfterChange: 9,
      processEnded: false,
    }),
    ...twice('s2', 'android', 'swipe', P, { arrivalsStopped: false, findings: [] }),
    ...twice('s2', 'android', 'lmk', P, { arrivalsStopped: false, findings: [] }),
    ...twice(
      's2',
      'android',
      'forcestop',
      F,
      { arrivalsStopped: true, reminderFired: false, findings: [] },
      { judged: false },
    ),
    ...twice('s5', 'android', null, P, { seen: P, heard: N, text: P }),
    ...twice('s6', 'android', 'without', P, {
      callPhone: false,
      callStarted: false,
      placedBy: null,
    }),
    ...twice('s6', 'android', 'with', P, { callPhone: true, callStarted: true, placedBy: APP }),
    runEntry(
      's8',
      'android',
      null,
      1,
      P,
      { problems: [], destinations: [], flagged: [] },
      { tcpdump: true },
    ),
    runEntry('s8', 'android', null, 2, P, { problems: [] }),
    ...twice('s1', 'ios', null, P, { largestGapMs: 60_000 }),
    ...twice('s4', 'ios', null, P, { missing: [], outOfOrder: false, queueEmptied: true }),
    ...twice('s7', 'ios', 'always-to-inuse', P, {
      reportDelayMs: 237,
      arrivalsAfterChange: 21,
      processEnded: false,
    }),
    ...twice('s2', 'ios', null, P, { arrivalsStopped: false, findings: [] }),
    ...twice('s5', 'ios', null, P, { presented: true, text: P }),
    ...twice('s8', 'ios', null, P, { problems: [] }),
    { kind: 'runner', event: 'finished', at: WALL0 + 10 * 3_600_000 },
  ];
}

/** The runs of one scenario on one platform, of one case when `runCase` is given. */
const runsOf = (entries, scenario, platform, runCase) =>
  entries.filter(
    (entry) =>
      entry.kind === 'run' &&
      entry.scenario === scenario &&
      entry.platform === platform &&
      (runCase === undefined || entry.case === runCase),
  );
/**
 * The night's planned cases, judged ones only, per scenario and platform, as
 * goNoGoInput takes them (`expected`); null is a scenario's plain case. S2's
 * Force stop is recorded, not judged, so it is not among them. This is
 * run-all.mjs's plan for night-20260930 (review loop 2): a case planned here
 * that never ran is not a pass.
 */
const NIGHT_PLAN = {
  s1: { android: [null], ios: [null] },
  s2: { android: ['swipe', 'lmk'], ios: [null] },
  s3: { android: ['exempt', 'not-exempt'] },
  s4: { android: [null], ios: [null] },
  s5: { android: [null], ios: [null] },
  s6: { android: ['without', 'with'] },
  s7: { android: ['background', 'fine'], ios: ['always-to-inuse'] },
  s8: { android: [null], ios: [null] },
};

/** The mapper's input: the night, changed by `change`, its plan, and what was read by hand. */
function input(change = () => {}, expected = NIGHT_PLAN) {
  const entries = night();
  change(entries);
  return { entries, expected, ...BY_HAND };
}

test('SPIKE-01-AC15: a night in which every judged run passed gives each item per platform, the hand-read build and licence, and "not shown" where simulators cannot show it; the go/no-go takes it', async () => {
  const verdicts = await goNoGoInput(input());
  assert.deepEqual(verdicts.build, BY_HAND.build);
  assert.equal(verdicts.licence, P);
  for (const item of ['S1', 'S2', 'S4', 'S5', 'S7', 'S8']) {
    for (const platform of ['android', 'ios']) {
      assert.equal(verdicts[item]?.[platform], P, `${item} on ${platform}`);
    }
  }
  assert.equal(verdicts.S3?.android, P);
  assert.equal(verdicts['S3 not exempt']?.android, P);
  assert.equal(verdicts.S6?.android, P);
  assert.equal(verdicts.S6?.ios, N, 'the simulator has no Phone app');
  assert.equal(verdicts.capture?.android, P);
  assert.equal(verdicts.capture?.ios, N, "the simulator's traffic cannot be told apart");
  assert.equal(verdicts['S5 heard']?.android, N);
  assert.equal(verdicts['S5 heard']?.ios, N);
  assert.equal((await goNoGo(verdicts)).recommendation, 'GO');
});

test("SPIKE-01-AC15: S3's deciding item is the case with the exemption alone; the case without it is a line of its own", async () => {
  const notExemptFailed = await goNoGoInput(
    input((entries) => {
      for (const run of runsOf(entries, 's3', 'android', 'not-exempt')) run.status = F;
    }),
  );
  assert.equal(notExemptFailed.S3.android, P, 'the case without the exemption decided S3');
  assert.equal(notExemptFailed['S3 not exempt'].android, F);
  assert.equal((await goNoGo(notExemptFailed)).recommendation, 'GO');

  const exemptFailed = await goNoGoInput(
    input((entries) => {
      runsOf(entries, 's3', 'android', 'exempt')[0].status = F;
    }),
  );
  assert.equal(exemptFailed.S3.android, F);
  assert.equal(exemptFailed['S3 not exempt'].android, P, 'the exempt case decided the other line');
  assert.equal((await goNoGo(exemptFailed)).recommendation, 'NO-GO');
});

test('SPIKE-01-AC15: AC12 is its own item, from the S1 run that carried the capture: S1 and the capture never decide each other', async () => {
  const s1Failed = await goNoGoInput(
    input((entries) => {
      for (const run of runsOf(entries, 's1', 'android')) run.status = F;
    }),
  );
  assert.equal(s1Failed.S1.android, F);
  assert.equal(s1Failed.capture.android, P, "S1's failure decided the capture");

  const captureFailed = await goNoGoInput(
    input((entries) => {
      runsOf(entries, 's1', 'android')[0].details.capture.status = F;
    }),
  );
  assert.equal(captureFailed.S1.android, P, "the capture's failure decided S1");
  assert.equal(captureFailed.capture.android, F);
  assert.equal((await goNoGo(captureFailed)).recommendation, 'NO-GO');

  const captureInvalid = await goNoGoInput(
    input((entries) => {
      runsOf(entries, 's1', 'android')[0].details.capture.status = 'invalid';
    }),
  );
  assert.equal(
    captureInvalid.capture.android,
    NV,
    'a capture that could not be read has a verdict',
  );
  assert.equal(captureInvalid.S1.android, P);
});

test('SPIKE-01-AC15: S5\'s "heard" is a line of its own, and S5 itself is the alert seen with its text', async () => {
  const heardFailed = await goNoGoInput(
    input((entries) => {
      for (const run of runsOf(entries, 's5', 'android')) {
        run.status = F;
        run.details = { seen: P, heard: F, text: P };
      }
    }),
  );
  assert.equal(heardFailed.S5.android, P, '"heard" decided the line for the alert seen');
  assert.equal(heardFailed['S5 heard'].android, F);
  assert.equal(heardFailed['S5 heard'].ios, N, 'nothing on the simulator shows sound');
  const result = await goNoGo(heardFailed);
  assert.equal(result.recommendation, 'GO');
  assert.ok(
    result.findings.some((f) => f.item === 'S5 heard' && f.platform === 'android'),
    '"heard" failing is not a finding',
  );

  const cases = [
    ['not seen', { seen: F, heard: F, text: P }],
    ['its text changed', { seen: P, heard: N, text: F }],
  ];
  for (const [what, details] of cases) {
    const verdicts = await goNoGoInput(
      input((entries) => {
        const [first] = runsOf(entries, 's5', 'android');
        first.status = F;
        first.details = details;
      }),
    );
    assert.equal(verdicts.S5.android, F, `an alert ${what} passed S5`);
  }
});

test("SPIKE-01-AC15: S2's findings are listed with their runs; Force stop is recorded, not judged", async () => {
  const why = '1 reminder(s) said protection had stopped while arrivals continued';
  const verdicts = await goNoGoInput(
    input((entries) => {
      for (const run of runsOf(entries, 's2', 'android', 'lmk')) {
        run.status = F;
        run.details = { arrivalsStopped: false, reminderFired: true, findings: [why] };
      }
    }),
  );
  assert.equal(verdicts.S2.android, F);
  const s2 = (verdicts.findings ?? []).filter((finding) => finding.item === 'S2');
  assert.deepEqual(s2.map((finding) => [finding.platform, finding.run, finding.why]).sort(), [
    ['android', 'night-20310101-s2-android-lmk-1', why],
    ['android', 'night-20310101-s2-android-lmk-2', why],
  ]);
  const result = await goNoGo(verdicts);
  assert.ok(
    result.findings.some((finding) => finding.item === 'S2' && finding.why === why),
    "S2's finding did not reach the go/no-go",
  );

  const forceStopOnly = await goNoGoInput(input());
  assert.equal(forceStopOnly.S2.android, P, 'Force stop, recorded and not judged, decided S2');
});

test("SPIKE-01-AC15: S7 goes per run; on the night's pattern, the fine case failing with its process ended and nothing after the change is a finding, not NO-GO", async () => {
  const verdicts = await goNoGoInput(
    input((entries) => {
      for (const run of runsOf(entries, 's7', 'android', 'fine')) {
        run.status = F;
        run.details = {
          reportDelayMs: null,
          arrivalsAfterChange: 0,
          withoutPositionAfterChange: 0,
          processEnded: true,
        };
      }
    }),
  );
  assert.equal(verdicts.S7.android, F);
  assert.equal(verdicts.S7.runs.length, 6, 'every S7 run, on both platforms');
  const fine = verdicts.S7.runs.filter((run) => run.platform === 'android' && run.case === 'fine');
  assert.deepEqual(
    fine.map((run) => [run.id, run.status, run.processEnded, run.arrivalsAfterChange]),
    [
      ['night-20310101-s7-android-fine-1', F, true, 0],
      ['night-20310101-s7-android-fine-2', F, true, 0],
    ],
  );
  const result = await goNoGo(verdicts);
  assert.equal(result.recommendation, 'GO');
  assert.ok(result.findings.some((f) => f.item === 'S7' && f.platform === 'android'));
});

test('SPIKE-01-AC15: a case short of two valid runs has no verdict, and the go/no-go then refuses to recommend', async () => {
  const verdicts = await goNoGoInput(
    input((entries) => {
      const [, second] = runsOf(entries, 's4', 'ios');
      Object.assign(second, {
        status: 'invalid',
        evidence: ['the simulator exited at 9 min'],
        details: {},
      });
      entries.push(
        { ...second, attempt: 3, runId: 'night-20310101-s4-ios-3' },
        { ...second, attempt: 4, runId: 'night-20310101-s4-ios-4' },
        {
          kind: 'case-stopped',
          key: 's4/ios/-',
          platform: 'ios',
          scenario: 's4',
          case: null,
          at: WALL0,
          reason: '3 invalid runs: the case has had its two extra runs',
        },
      );
    }),
  );
  assert.equal(verdicts.S4.ios, NV);
  assert.equal((await goNoGo(verdicts)).recommendation, null);
});

// S5 (the test audit's should-fix, review loop 2): an invalid run never counts,
// whatever its details say, and "S5 heard" needs two valid runs like any line.

test('SPIKE-01-AC13: an invalid S5 run whose details say seen, heard and its text passed stays invalid: with one valid run left, S5 and "S5 heard" have no verdict', async () => {
  const verdicts = await goNoGoInput(
    input((entries) => {
      for (const run of runsOf(entries, 's5', 'android'))
        run.details = { seen: P, heard: P, text: P };
      const [, second] = runsOf(entries, 's5', 'android');
      Object.assign(second, {
        status: 'invalid',
        evidence: ['the receiver wrote no tick for 30 s'],
      });
    }),
  );
  assert.equal(verdicts.S5.android, NV, "the invalid run's details counted as a pass");
  assert.equal(verdicts['S5 heard'].android, NV, '"heard" passed on one valid run');

  // The control: with both runs valid, both lines pass.
  const both = await goNoGoInput(
    input((entries) => {
      for (const run of runsOf(entries, 's5', 'android'))
        run.details = { seen: P, heard: P, text: P };
    }),
  );
  assert.equal(both.S5.android, P);
  assert.equal(both['S5 heard'].android, P);
});

// A planned case that never ran is not a pass (the safety review's loop 1,
// item 4; review loop 2). goNoGoInput takes the planned cases (`expected`,
// see NIGHT_PLAN), and a case with no run gives its item no verdict, as a
// case short of two valid runs does. A failed run elsewhere in the item is
// still final. On the night's real manifest, dropping S7's "fine" runs made
// S7 on Android pass.

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

/** Drops every run of one case. */
const without = (scenario, platform, runCase) => (entries) => {
  for (const run of runsOf(entries, scenario, platform, runCase)) {
    entries.splice(entries.indexOf(run), 1);
  }
};

test('SPIKE-01-AC13: a planned case with no run gives its item no verdict, never a pass: S7 on Android without its "fine" runs, and items that only give findings too', async () => {
  const noFine = await goNoGoInput(input(without('s7', 'android', 'fine')));
  assert.equal(noFine.S7.android, NV, 'S7 on Android passed on its background case alone');
  assert.equal((await goNoGo(noFine)).recommendation, null, 'the go/no-go recommended anyway');

  const cases = [
    ['S2', 'android', without('s2', 'android', 'lmk')],
    ['S6', 'android', without('s6', 'android', 'with')],
    ['S4', 'ios', without('s4', 'ios', null)],
  ];
  for (const [item, platform, change] of cases) {
    const verdicts = await goNoGoInput(input(change));
    assert.equal(verdicts[item][platform], NV, `${item} on ${platform} passed with a case missing`);
  }
});

test('SPIKE-01-AC13: a planned case with no run beside a case that failed leaves the item failed: a failure shown is final', async () => {
  const verdicts = await goNoGoInput(
    input((entries) => {
      without('s7', 'android', 'fine')(entries);
      for (const run of runsOf(entries, 's7', 'android', 'background')) {
        run.status = F;
        run.details = { reportDelayMs: 75_000, arrivalsAfterChange: 15, processEnded: false };
      }
    }),
  );
  assert.equal(verdicts.S7.android, F);
  assert.equal((await goNoGo(verdicts)).recommendation, 'NO-GO');
});

test('SPIKE-01-AC13: goNoGoInput without the planned cases is refused, never judged as if every case ran', async () => {
  await refuses(goNoGoInput({ entries: night(), ...BY_HAND }), 'no plan given');
});

// S1 with the battery-optimisation exemption (the owner's Q4, the code
// review's SF3, review loop 2). The night's S1 runs are the plain case
// (`case: null`); the two extra runs are the case "exempt", from their own
// night (night-YYYYMMDD-s1-exempt), whose first run carries a capture, as S1's
// first does. The two cases are kept apart: S1 is the plain case alone, and
// "S1 exempt" is a line of its own. The exemption is one of the SDK's
// documented settings, so goNoGoInput gives it to the go/no-go as the setting
// tried for S1 on Android (`settings`: { item: 'S1', platform: 'android',
// setting, verdict }), with the "S1 exempt" verdict.

const WITH_EXEMPT = { ...NIGHT_PLAN, s1: { android: [null, 'exempt'], ios: [null] } };
/** The entry of `list` for `item` on `platform`. */
const find = (list, item, platform) =>
  list.find((entry) => entry.item === item && (entry.platform ?? null) === platform);
/** The two S1-exempt runs on Android, with `status`. */
const exemptRuns = (status) => [
  runEntry(
    's1',
    'android',
    'exempt',
    1,
    status,
    {
      largestGapMs: status === P ? 104_000 : 610_000,
      capture: { status: P, problems: [], flagged: [], destinations: [] },
    },
    { tcpdump: true },
  ),
  runEntry('s1', 'android', 'exempt', 2, status, {
    largestGapMs: status === P ? 110_000 : 700_000,
  }),
];
/** The plain S1 runs on `platform` failed, as on the night of 2026-09-30. */
const plainS1Failed = (platform) => (entries) => {
  for (const run of runsOf(entries, 's1', platform, null)) {
    run.status = F;
    run.details = { ...run.details, largestGapMs: 802_000, gapsOver120s: 1 };
  }
};
/** The setting goNoGoInput gives for S1 on Android. */
const s1Setting = (verdicts) =>
  (Array.isArray(verdicts.settings) ? verdicts.settings : []).find(
    (setting) => setting?.item === 'S1' && setting?.platform === 'android',
  );
/** The lines of the go/no-go's text that name S1, the exemption and `verdict`. */
const exemptLines = (text, verdict) =>
  text
    .split('\n')
    .filter((line) => /\bS1\b/.test(line) && /exempt/i.test(line) && line.includes(verdict));

test('SPIKE-01-AC15: S1\'s plain case and its exempt case are kept apart; the plain case failing and the exempt case passing is "passed with" the exemption, a condition, not NO-GO', async () => {
  const verdicts = await goNoGoInput(
    input((entries) => {
      plainS1Failed('android')(entries);
      entries.push(...exemptRuns(P));
    }, WITH_EXEMPT),
  );
  assert.equal(verdicts.S1.android, F, 'the exempt runs decided the plain case');
  assert.equal(verdicts['S1 exempt']?.android, P, 'no "S1 exempt" line of its own');
  const setting = s1Setting(verdicts);
  assert.equal(setting?.verdict, P, 'the exemption is not given as the setting tried for S1');
  assert.match(String(setting?.setting), /exempt/i, 'the setting does not say it is the exemption');
  assert.equal(verdicts.capture.android, P, "the exempt run's capture changed the capture");

  const result = await goNoGo(verdicts);
  assert.equal(result.recommendation, 'GO', 'a failure the documented setting fixed gave NO-GO');
  assert.ok(
    find(result.conditions ?? [], 'S1', 'android'),
    'the exemption is not listed as a condition',
  );
  assert.ok(exemptLines(result.text, 'passed').length > 0, 'no "S1 exempt" line is printed');
});

test("SPIKE-01-AC15: S1's exempt case never decides its plain case: a plain S1 that passed stays passed beside an exempt case that failed, which is printed as failed", async () => {
  const verdicts = await goNoGoInput(
    input((entries) => entries.push(...exemptRuns(F)), WITH_EXEMPT),
  );
  assert.equal(verdicts.S1.android, P, "the exempt case's failure decided the plain case");
  assert.equal(verdicts['S1 exempt']?.android, F);
  const result = await goNoGo(verdicts);
  assert.ok(exemptLines(result.text, 'failed').length > 0, 'the failed exempt case is not printed');
});

test('SPIKE-01-AC15: S1 with the exemption failed, or planned and never run, leaves S1 on Android failed: NO-GO', async () => {
  const cases = [
    ['the exempt case failed', (entries) => entries.push(...exemptRuns(F)), F],
    ['the exempt case never ran', () => {}, NV],
  ];
  for (const [what, addExempt, exempt] of cases) {
    const verdicts = await goNoGoInput(
      input((entries) => {
        plainS1Failed('android')(entries);
        addExempt(entries);
      }, WITH_EXEMPT),
    );
    assert.equal(verdicts['S1 exempt']?.android, exempt, what);
    assert.equal(s1Setting(verdicts)?.verdict, exempt, `${what}: the setting's verdict`);
    const result = await goNoGo(verdicts);
    assert.equal(result.recommendation, 'NO-GO', what);
    assert.equal(find(result.conditions ?? [], 'S1', 'android'), undefined, `${what}: a condition`);
  }
});

test("SPIKE-01-AC15: the night's pattern: S1 failed on both devices and passed with the exemption on Android gives NO-GO, and iOS S1 is never listed as open until L9", async () => {
  const verdicts = await goNoGoInput(
    input((entries) => {
      plainS1Failed('android')(entries);
      plainS1Failed('ios')(entries);
      entries.push(...exemptRuns(P));
    }, WITH_EXEMPT),
  );
  assert.equal(verdicts.S1.ios, F);
  const result = await goNoGo(verdicts);
  assert.equal(result.recommendation, 'NO-GO', 'iOS S1, failed with no setting, did not decide');
  assert.equal(find(result.open, 'S1', 'ios'), undefined, 'iOS S1 is listed as open');
  assert.ok(
    find(result.conditions ?? [], 'S1', 'android'),
    'Android S1 is not passed with the exemption',
  );
});

// The coordinator's decisions (review loop 2):
// - "S1 exempt" failing while the plain case passes is a finding for the
//   owner: the exemption the app's setup would ask for made S1 worse. It does
//   not decide the SDK, whose S1 passed.
// - The capture (AC12) is failed if any capture run in the input failed, from
//   either night: the plain case's or the exempt case's. A failed capture is
//   final, whatever another run's capture could not show.

test('SPIKE-01-AC15: "S1 exempt" failing while the plain case passes is listed as a finding, and does not decide the SDK', async () => {
  const verdicts = await goNoGoInput(
    input((entries) => entries.push(...exemptRuns(F)), WITH_EXEMPT),
  );
  const result = await goNoGo(verdicts);
  assert.equal(result.recommendation, 'GO', 'the exempt case decided the SDK, whose S1 passed');
  assert.ok(
    result.findings.some(
      (finding) =>
        finding.platform === 'android' &&
        /\bS1\b/.test(finding.item) &&
        /exempt/i.test(`${finding.item} ${finding.why}`),
    ),
    '"S1 exempt" failing is not a finding',
  );
});

test("SPIKE-01-AC12: the capture is failed if any capture run failed, from either night: the exempt case's capture failing fails it beside the plain case's that passed or could not be read", async () => {
  const cases = [
    ['beside a passed one', P],
    ['beside one that could not be read', 'invalid'],
  ];
  for (const [what, plain] of cases) {
    const verdicts = await goNoGoInput(
      input((entries) => {
        runsOf(entries, 's1', 'android', null)[0].details.capture.status = plain;
        const exempt = exemptRuns(P);
        exempt[0].details.capture.status = F;
        entries.push(...exempt);
      }, WITH_EXEMPT),
    );
    assert.equal(verdicts.capture.android, F, `the exempt run's failed capture, ${what}`);
    assert.equal((await goNoGo(verdicts)).recommendation, 'NO-GO', what);
  }

  // The plain case's capture failing, beside the exempt case's that passed.
  const plainFailed = await goNoGoInput(
    input((entries) => {
      runsOf(entries, 's1', 'android', null)[0].details.capture.status = F;
      entries.push(...exemptRuns(P));
    }, WITH_EXEMPT),
  );
  assert.equal(plainFailed.capture.android, F, "the plain run's failed capture");
});
