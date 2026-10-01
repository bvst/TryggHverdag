// SPIKE-01-AC15: the night's manifest into the go/no-go's input, so that the
// input is computed and tested rather than written by hand (the code review's
// S7). Pure.
//
// - Each item's verdict per platform comes from its runs, as judgeScenario
//   gives it: a failed run is final, an invalid run never counts, and fewer
//   than two valid runs of a case is "no verdict". Runs recorded and not judged
//   (S2's Force stop) never count.
// - S3 decides with the exemption alone; without it, "S3 not exempt" is a line
//   of its own.
// - The capture (AC12) is its own item, from the S1 runs that carried it, and
//   never touches S1. The simulator's traffic cannot be told apart.
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

/** The judged runs of a scenario on a platform, of one case when `runCase` is given. */
function runsOf(entries, scenario, platform, runCase) {
  return entries.filter(
    (entry) =>
      entry?.kind === 'run' &&
      entry.judged !== false &&
      entry.scenario === scenario &&
      entry.platform === platform &&
      (runCase === undefined || entry.case === runCase),
  );
}

/** A manifest line as judgeScenario takes a run, with its status changed by `statusOf`. */
const asRun = (entry, statusOf = (run) => run.status) => ({
  id: entry.runId,
  case: entry.case ?? undefined,
  status: entry.status === INVALID ? INVALID : statusOf(entry),
  evidence: entry.evidence,
});

/** The verdict of a scenario on one platform, from its runs. */
function verdictOf(scenario, platform, runs, statusOf) {
  return judgeScenario({ scenario, platform, runs: runs.map((run) => asRun(run, statusOf)) })
    .verdict;
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

/** The capture, from the S1 runs that carried it: any failure is final; unread is no verdict. */
function captureVerdict(runs) {
  const captured = runs.filter((run) => run.tcpdump === true);
  const statuses = captured.map((run) => run.details?.capture?.status);
  if (statuses.includes(FAILED)) return FAILED;
  if (captured.length === 0 || statuses.some((status) => status !== PASSED)) return NO_VERDICT;
  return PASSED;
}

/**
 * @param {{ entries: object[], build: { android: string, ios: string }, licence: string }} input
 *   `entries`: the manifest's lines; `build` and `licence`: read by hand (AC2, AC15)
 * @returns {object} the verdicts goNoGo takes
 */
export function goNoGoInput({ entries, build, licence }) {
  if (!Array.isArray(entries)) throw new Error("entries must be the manifest's lines");
  const per = (scenario, runCase, statusOf) =>
    Object.fromEntries(
      PLATFORMS.map((platform) => [
        platform,
        verdictOf(
          scenario,
          platform,
          runsOf(entries, scenario, platform, runCase),
          statusOf?.(platform),
        ),
      ]),
    );

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

  return {
    build,
    S1: per('s1'),
    S2: per('s2'),
    S3: { android: verdictOf('S3', 'android', runsOf(entries, 's3', 'android', 'exempt')) },
    'S3 not exempt': {
      android: verdictOf(
        'S3 not exempt',
        'android',
        runsOf(entries, 's3', 'android', 'not-exempt'),
      ),
    },
    S4: per('s4'),
    S5: per('s5', undefined, s5Status),
    'S5 heard': { android: heardVerdict(runsOf(entries, 's5', 'android')), ios: NOT_SHOWN },
    S6: { android: verdictOf('S6', 'android', runsOf(entries, 's6', 'android')), ios: NOT_SHOWN },
    S7: { ...per('s7'), runs: s7Runs },
    S8: per('s8'),
    capture: { android: captureVerdict(runsOf(entries, 's1', 'android')), ios: NOT_SHOWN },
    licence,
    findings,
  };
}
