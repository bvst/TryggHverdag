// SPIKE-01-AC15: the nights' manifests into the go/no-go's input, so that the
// input is computed and tested rather than written by hand (the code review's
// S7). Pure.
//
// - Each item's verdict per platform comes from the runs of its planned cases
//   (`expected`, the runner's plan), as judgeScenario gives it: a failed run is
//   final, an invalid run never counts, and fewer than two valid runs of a
//   case is "no verdict". A planned case with no run at all is "no verdict"
//   too, never a pass (review loop 2). Runs recorded and not judged (S2's
//   Force stop) never count.
// - S1 is its plain case alone. With the exemption planned, "S1 exempt" is a
//   line of its own, and the exemption is given as the setting tried for S1 on
//   Android (one of the SDK's documented settings), with that line's verdict.
// - S3 decides with the exemption alone; without it, "S3 not exempt" is a line
//   of its own.
// - The capture (AC12) is its own item, from every S1 run that carried one, of
//   either case: failed if any capture failed, "no verdict" if any could not be
//   read. It never touches S1. The simulator's traffic cannot be told apart.
// - S5 is the alert seen with its text; "S5 heard" is a line of its own.
// - S7 goes per run, with whether its process ended and what arrived after the
//   change, for the go/no-go to excuse a run or not.
// - S2's findings are listed, each with its run.
import { judgeScenario } from './runs.mjs';

const PASSED = 'passed';
const FAILED = 'failed';
const INVALID = 'invalid';
const NOT_SHOWN = 'not shown on simulators';
const NO_VERDICT = 'no verdict';
const PLATFORMS = ['android', 'ios'];
/** The setting S1's exempt case tries: one of the SDK's documented settings. */
const EXEMPTION = 'the battery-optimisation exemption';

/** The planned cases: { scenario: { platform: [case or null, …] } }. Refused when not that. */
function checkExpected(expected) {
  const ok =
    typeof expected === 'object' &&
    expected !== null &&
    Object.values(expected).every(
      (platforms) =>
        typeof platforms === 'object' &&
        platforms !== null &&
        Object.values(platforms).every(
          (cases) =>
            Array.isArray(cases) &&
            cases.every((name) => name === null || (typeof name === 'string' && name !== '')),
        ),
    );
  if (!ok) {
    throw new Error(
      'expected must be the planned cases, { scenario: { platform: [case or null] } }, ' +
        'so that a case that never ran is not judged as passed',
    );
  }
}

/** The judged runs of a scenario on a platform, of one case when `runCase` is given. */
function runsOf(entries, scenario, platform, runCase) {
  return entries.filter(
    (entry) =>
      entry?.kind === 'run' &&
      entry.judged !== false &&
      entry.scenario === scenario &&
      entry.platform === platform &&
      (runCase === undefined || (entry.case ?? null) === runCase),
  );
}

/** A manifest line as judgeScenario takes a run, with its status changed by `statusOf`. */
const asRun = (entry, statusOf = (run) => run.status) => ({
  id: entry.runId,
  case: entry.case ?? undefined,
  status: entry.status === INVALID ? INVALID : statusOf(entry),
  evidence: entry.evidence,
});

/**
 * The verdict of the planned `cases` of a scenario on one platform, from their
 * runs. A failed run is final; otherwise a planned case with no run, or none
 * planned, is no verdict.
 */
function verdictOf(scenario, platform, runs, cases, statusOf) {
  const planned = runs.filter((run) => cases.includes(run.case ?? null));
  const { verdict } = judgeScenario({
    scenario,
    platform,
    runs: planned.map((run) => asRun(run, statusOf)),
  });
  if (verdict === FAILED) return FAILED;
  const missing =
    cases.length === 0 || cases.some((name) => !planned.some((run) => (run.case ?? null) === name));
  return missing ? NO_VERDICT : verdict;
}

/** S5: the alert seen (Android) or presented (iOS), with its text. "Heard" is not part of it. */
function s5Status(platform) {
  if (platform === 'android') {
    return ({ details }) =>
      details?.seen === PASSED && details?.text === PASSED ? PASSED : FAILED;
  }
  return ({ details }) =>
    details?.presented === true && details?.text === PASSED ? PASSED : FAILED;
}

/** "S5 heard" on Android: any valid run not heard fails it; two valid runs heard pass it. */
function heardVerdict(runs) {
  const valid = runs.filter((run) => run.status !== INVALID);
  const heard = valid.map((run) => run.details?.heard);
  if (heard.includes(FAILED)) return FAILED;
  if (valid.length < 2) return NO_VERDICT;
  if (heard.every((value) => value === PASSED)) return PASSED;
  return NOT_SHOWN;
}

/** The capture, from every S1 run that carried one: any failure is final; unread is no verdict. */
function captureVerdict(runs) {
  const captured = runs.filter((run) => run.tcpdump === true);
  const statuses = captured.map((run) => run.details?.capture?.status);
  if (statuses.includes(FAILED)) return FAILED;
  if (captured.length === 0 || statuses.some((status) => status !== PASSED)) return NO_VERDICT;
  return PASSED;
}

/**
 * @param {{ entries: object[], expected: object, build: { android: string, ios: string },
 *   licence: string }} input
 *   `entries`: the manifests' lines; `expected`: the planned cases, judged ones
 *   only, { scenario: { platform: [case or null] } }; `build` and `licence`:
 *   read by hand (AC2, AC15)
 * @returns {object} the verdicts goNoGo takes
 */
export function goNoGoInput({ entries, expected, build, licence }) {
  if (!Array.isArray(entries)) throw new Error("entries must be the manifest's lines");
  checkExpected(expected);
  const cases = (scenario, platform, only) =>
    (expected[scenario]?.[platform] ?? []).filter((name) => only === undefined || name === only);
  const per = (scenario, only, statusOf) =>
    Object.fromEntries(
      PLATFORMS.map((platform) => [
        platform,
        verdictOf(
          scenario,
          platform,
          runsOf(entries, scenario, platform),
          cases(scenario, platform, only),
          statusOf?.(platform),
        ),
      ]),
    );
  const one = (item, scenario, platform, only) =>
    verdictOf(item, platform, runsOf(entries, scenario, platform), cases(scenario, platform, only));

  const s7Runs = PLATFORMS.flatMap((platform) => runsOf(entries, 's7', platform)).map((run) => ({
    id: run.runId,
    platform: run.platform,
    case: run.case,
    status: run.status,
    processEnded: run.details?.processEnded,
    arrivalsAfterChange: run.details?.arrivalsAfterChange,
  }));

  const findings = PLATFORMS.flatMap((platform) =>
    runsOf(entries, 's2', platform).flatMap((run) =>
      (run.details?.findings ?? []).map((why) => ({
        item: 'S2',
        platform,
        run: run.runId,
        why,
      })),
    ),
  );

  const verdicts = {
    build,
    S1: per('s1', null),
    S2: per('s2'),
    S3: { android: one('S3', 's3', 'android', 'exempt') },
    'S3 not exempt': { android: one('S3 not exempt', 's3', 'android', 'not-exempt') },
    S4: per('s4'),
    S5: per('s5', undefined, s5Status),
    'S5 heard': { android: heardVerdict(runsOf(entries, 's5', 'android')), ios: NOT_SHOWN },
    S6: { android: one('S6', 's6', 'android'), ios: NOT_SHOWN },
    S7: { ...per('s7'), runs: s7Runs },
    S8: per('s8'),
    capture: { android: captureVerdict(runsOf(entries, 's1', 'android')), ios: NOT_SHOWN },
    licence,
    findings,
    settings: [],
  };
  if (cases('s1', 'android', 'exempt').length > 0) {
    const exempt = one('S1 exempt', 's1', 'android', 'exempt');
    verdicts['S1 exempt'] = { android: exempt };
    verdicts.settings.push({
      item: 'S1',
      platform: 'android',
      setting: EXEMPTION,
      verdict: exempt,
    });
  }
  return verdicts;
}
