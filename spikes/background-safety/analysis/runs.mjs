// SPIKE-01-AC13: every run counts. A scenario's verdict on one platform comes
// from all of its runs. Pure.
//
// - A failed run is final: re-runs that pass never replace it (D-060).
// - An invalid run (the harness broke) is listed with its evidence, and never
//   counted as passed.
// - A pass needs at least two valid runs of each case.

const RUN_STATUSES = new Set(['passed', 'failed', 'invalid']);
const MIN_VALID_RUNS = 2;

function checkRun(run, i) {
  if (typeof run?.id !== 'string' || run.id === '') throw new Error(`run ${i + 1} has no id`);
  if (!RUN_STATUSES.has(run.status)) {
    throw new Error(`run ${run.id}: its status must be passed, failed or invalid`);
  }
  if (run.status === 'invalid') {
    const evidence = run.evidence;
    if (!Array.isArray(evidence) || evidence.length === 0) {
      throw new Error(`run ${run.id} is invalid without evidence of what broke`);
    }
  }
}

/**
 * @param {{ scenario: string, platform: string,
 *   runs: { id: string, status: string, case?: string, evidence?: string[] }[] }} input
 * @returns {{ scenario: string, platform: string, verdict: 'passed' | 'failed',
 *   validRuns: number, invalidRuns: number, runs: object[] }}
 */
export function judgeScenario({ scenario, platform, runs }) {
  if (!Array.isArray(runs)) throw new Error(`${scenario} on ${platform}: runs must be a list`);
  runs.forEach(checkRun);
  const valid = runs.filter((run) => run.status !== 'invalid');
  const result = {
    scenario,
    platform,
    validRuns: valid.length,
    invalidRuns: runs.length - valid.length,
    runs: runs.map((run) => ({ ...run })),
  };
  if (valid.some((run) => run.status === 'failed')) return { ...result, verdict: 'failed' };

  const perCase = new Map();
  for (const run of runs) {
    const name = run.case ?? '';
    perCase.set(name, (perCase.get(name) ?? 0) + (run.status === 'invalid' ? 0 : 1));
  }
  if (perCase.size === 0) perCase.set('', 0);
  for (const [name, count] of perCase) {
    if (count < MIN_VALID_RUNS) {
      const which = name === '' ? '' : ` (case ${name})`;
      throw new Error(
        `${scenario} on ${platform}${which} has ${count} valid run(s); ` +
          `a verdict needs at least ${MIN_VALID_RUNS}`,
      );
    }
  }
  return { ...result, verdict: 'passed' };
}
