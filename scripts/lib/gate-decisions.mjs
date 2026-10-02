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
  // The journey service, and the one place the database clock is wired into
  // it. Only these two of D-092's six journey files are here, because their
  // tests run in-process (D-095). Not every mutant of theirs is killed there:
  // 3 of api-process.ts's 8 wire its services empty and are killed only at L3,
  // which no mutation run starts. BUG-12 closes them. The two database
  // adapters, db/schema.ts and the migrations are proved by L3 tests alone:
  // here, every mutant in them would survive. They need the owner and the
  // safety review all the same (merge-rules.mjs), and are to be mutated by
  // D-036's nightly run, which does not exist yet (an open follow-up).
  'apps/server/src/modules/journeys/',
  'apps/server/src/api-process.ts',
  'apps/mobile/src/safety-core/',
];

/** The tests a mutant in safety code no group claims runs against: every product test. */
export const WHOLE_SUITE = ['apps', 'packages'];

/**
 * Safety paths whose mutants only some tests can kill, each run against only
 * those tests (D-066, amended by the owner 2026-09-25). Every mutant running the
 * whole suite outran the mutation job on PR #31. A group only narrows the tests:
 * a test left out can lower the score, never raise it.
 *
 * `config` names the Vitest configuration a group's tests run under, when it
 * is not the root one. The root one leaves *.system.test.ts out, and Vitest
 * runs no excluded file even when it is named, so the journeys group, whose
 * tests are system tests, says which configuration collects them (D-095).
 *
 * @type {{ name: string, paths: string[], tests: string[], config?: string }[]}
 */
export const MUTATION_GROUPS = [
  { name: 'domain', paths: ['apps/server/src/domain/'], tests: ['apps/server/src/domain'] },
  {
    name: 'healthchecks',
    paths: ['apps/server/src/adapters/healthchecks.ts'],
    tests: ['apps/server/src/adapters/healthchecks.test.ts', 'apps/server/src/worker.test.ts'],
  },
  {
    name: 'journeys',
    paths: ['apps/server/src/modules/journeys/'],
    tests: ['apps/server/src/journeys.system.test.ts'],
    config: 'vitest.system.config.mjs',
  },
];

/**
 * The Stryker runs that together mutate every safety path exactly once: the
 * groups, in order, then one whole-suite run for every path no group claims.
 *
 * A group may only claim a safety path exactly as it is listed. A wider path
 * would mutate code that is not safety code; a file inside a safety folder
 * would be mutated twice, once by its group and once with the folder.
 *
 * A group's `config` goes with it unchanged; the whole-suite run has none, so
 * it runs under the root configuration, as it always has.
 *
 * @param {string[]} safetyPaths
 * @param {{ name: string, paths: string[], tests: string[], config?: string }[]} groups
 * @returns {{ name: string, paths: string[], tests: string[], config?: string }[]}
 */
export function mutationRuns(safetyPaths = SAFETY_PATHS, groups = MUTATION_GROUPS) {
  const claimed = new Map();
  for (const group of groups) {
    for (const p of group.paths) {
      if (!safetyPaths.includes(p)) {
        throw new Error(
          `mutation group "${group.name}" claims ${p}, which is not one of the safety paths ` +
            `(${safetyPaths.join(', ')}). A group takes a whole safety path as listed, or nothing (D-066).`,
        );
      }
      const other = claimed.get(p);
      if (other !== undefined) {
        throw new Error(
          `mutation groups "${other}" and "${group.name}" both claim ${p}, so it would be ` +
            'mutated twice. Give it to one of them (D-066).',
        );
      }
      claimed.set(p, group.name);
    }
  }
  const rest = safetyPaths.filter((p) => !claimed.has(p));
  return rest.length === 0
    ? [...groups]
    : [...groups, { name: 'whole-suite', paths: rest, tests: [...WHOLE_SUITE] }];
}

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
 * How long Stryker may run, across all the runs of mutationRuns together: each
 * run gets what the ones before it left. In the whole-suite run each mutant
 * runs the whole product suite (the command runner in stryker.config.mjs):
 * about 7 s once INF-07 added tests that start real processes, and 119 mutants
 * on CI's two cores outran proc.mjs's default of 590 s. The groups run only
 * their own tests (D-066, amended 2026-09-25). A test in scripts/gate.test.mjs
 * keeps this inside ci.yml's mutation job, with room for checkout and install.
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
