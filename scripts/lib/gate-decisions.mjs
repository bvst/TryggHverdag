// Two gates whose subject does not exist yet: the API compatibility check
// (AR-08, D-030) and mutation testing (D-036).
//
// Both have the same trap. A gate that passes because there is nothing to check
// looks exactly like a gate that passes because the code is good — until the day
// it was supposed to catch something. So each decision below says which of the
// two it is, in words, and refuses to pass quietly when the check *should* have
// run but cannot.

/** Code where a missed bug is a missed alert (D-036). */
export const SAFETY_PATHS = [
  'apps/server/src/domain/',
  'apps/server/src/modules/alerts/',
  'apps/server/src/worker.ts',
  // Whether a worker that stopped is restarted: bin/worker.ts starts it, and
  // process.ts chooses its exit code (D-077). Both reviewers of INF-07 found
  // this contract had moved out of worker.ts and out of every safety check.
  'apps/server/src/bin/worker.ts',
  'apps/server/src/process.ts',
  // The one file that can ping Healthchecks.io: a ping it sent on its own would
  // keep a dead worker's check green (D-079, the owner's decision).
  'apps/server/src/adapters/healthchecks.ts',
  'apps/mobile/src/safety-core/',
];

/**
 * Should `pnpm run api:diff` compare anything, and can it?
 *
 * @param {{ releasedSpecs: string[], currentSpec: string | null, toolAvailable: boolean }} state
 * @returns {{ ok: boolean, action: 'skip' | 'compare', message: string }}
 */
export function decideApiDiff({ releasedSpecs, currentSpec, toolAvailable }) {
  if (releasedSpecs.length === 0) {
    return {
      ok: true,
      action: 'skip',
      message:
        'api:diff: no released API versions yet, so nothing can be broken. The first snapshot ' +
        'is added when the server ships (INF-05, then the first release).',
    };
  }
  if (currentSpec === null) {
    return {
      ok: false,
      action: 'skip',
      message:
        'api:diff: there are released API versions but no current OpenAPI description to compare ' +
        'them with. Generate it from the contract package before this check can mean anything (AR-08).',
    };
  }
  if (!toolAvailable) {
    return {
      ok: false,
      action: 'skip',
      message:
        'api:diff: oasdiff is not installed, so compatibility was NOT checked. Install it ' +
        '(https://github.com/oasdiff/oasdiff) or run the oasdiff action in CI. This check is required ' +
        'by D-030; it must not be skipped quietly.',
    };
  }
  return {
    ok: true,
    action: 'compare',
    message: `api:diff: comparing the current API with ${String(releasedSpecs.length)} released version(s).`,
  };
}

/**
 * Should `pnpm run mutation` run, and can it?
 *
 * @param {{ changed: string[], onlyIfSafetyPathsChanged: boolean, configured: boolean }} state
 * @returns {{ ok: boolean, action: 'skip' | 'run', message: string }}
 */
export function decideMutation({ changed, onlyIfSafetyPathsChanged, configured }) {
  const safetyChanges = changed.filter((file) => SAFETY_PATHS.some((p) => file.startsWith(p)));
  if (onlyIfSafetyPathsChanged && safetyChanges.length === 0) {
    return {
      ok: true,
      action: 'skip',
      message:
        'mutation: this change touches no safety code, so there is nothing to mutate (D-036).',
    };
  }
  if (!configured) {
    const why = onlyIfSafetyPathsChanged
      ? `this change touches safety code (${safetyChanges.join(', ')})`
      : 'mutation testing was asked for';
    return {
      ok: false,
      action: 'skip',
      message:
        `mutation: ${why}, but Stryker is not set up, so the mutation score is unknown. ` +
        'D-036 makes this a blocking gate for safety code — set Stryker up before merging work ' +
        'that touches it (planned with the server skeleton, INF-05).',
    };
  }
  return {
    ok: true,
    action: 'run',
    message:
      safetyChanges.length > 0
        ? `mutation: running on ${String(safetyChanges.length)} changed safety file(s).`
        : 'mutation: running.',
  };
}

/**
 * How long Stryker may run. Each mutant runs the whole product suite (the
 * command runner in stryker.config.mjs): about 7 s once INF-07 added tests that
 * start real processes, and 119 mutants on CI's two cores outran proc.mjs's
 * default of 590 s. A test in scripts/gate.test.mjs keeps this inside ci.yml's
 * mutation job, with room for checkout and install.
 */
export const MUTATION_TIMEOUT_MS = 25 * 60_000;

/**
 * What a Stryker run means for the gate. A run that did not finish measured
 * nothing, and is never reported as a low score: INF-07's first CI run was, and
 * the advice that came with it — strengthen the tests — was the wrong fix.
 *
 * @param {{ ok: boolean, status: number | null, output: string }} result — from proc.mjs `run`
 * @returns {{ ok: boolean, message: string }}
 */
export function judgeMutationRun(result) {
  if (result.ok) {
    return { ok: true, message: '' };
  }
  if (result.status === null) {
    return {
      ok: false,
      message:
        `D-036: Stryker did not finish (${result.output.trim()}), so no mutation score was ` +
        'measured. That is a failed run, not a low score. If it ran out of time, the suite each ' +
        'mutant runs has grown: make that faster before raising MUTATION_TIMEOUT_MS.',
    };
  }
  return {
    ok: false,
    message:
      `D-036: Stryker exited with ${String(result.status)}. If the report above ends with a ` +
      'score, it is below 80 %: tests that run the code but would not notice it breaking are ' +
      'not protection — strengthen them. If it ends without one, Stryker could not run, and ' +
      'the log above says why.',
  };
}
