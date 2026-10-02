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
  // tests run in-process (D-095). api-process.ts's tests reach a database
  // through test-kit's fake PostgreSQL server, so they kill its mutants
  // in-process too (BUG-12). The two database adapters, db/schema.ts and the
  // migrations are proved by L3 tests alone: here, every mutant in them would
  // survive. They need the owner and the safety review all the same
  // (merge-rules.mjs), and are to be mutated by D-036's nightly run, which
  // does not exist yet (an open follow-up).
  'apps/server/src/modules/journeys/',
  'apps/server/src/api-process.ts',
  'apps/mobile/src/safety-core/',
];

/** The tests a mutant in safety code no group claims runs against: every product test. */
export const WHOLE_SUITE = ['apps', 'packages'];

/**
 * The name of the run that takes the safety paths no group claims. It is the
 * only run that may have nothing to mutate yet (scripts/mutation.mjs): a
 * group exists because its files do.
 */
export const WHOLE_SUITE_RUN = 'whole-suite';

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
 * Every safety file that exists has a group (D-098). The whole-suite run,
 * whose 84 mutants all timed out on #53, is left only the safety paths that
 * hold no file yet.
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
  {
    // Whether the worker runs, says it is alive, and is restarted when it
    // stops (D-077). worker.ts is the worker process: it starts the runner,
    // records a heartbeat once a minute and checks in with Healthchecks.io,
    // stops on the platform's signal, and fails if it ends any other way.
    // bin/worker.ts starts it, and process.ts chooses its exit code.
    // bin.test.ts is the only test that runs the real worker process, so it
    // goes with these three wherever they are mutated (D-066's amendment).
    name: 'process',
    paths: [
      'apps/server/src/worker.ts',
      'apps/server/src/bin/worker.ts',
      'apps/server/src/process.ts',
    ],
    tests: [
      'apps/server/src/bin/bin.test.ts',
      'apps/server/src/worker.test.ts',
      'apps/server/src/process.test.ts',
    ],
  },
  {
    name: 'api-process',
    paths: ['apps/server/src/api-process.ts'],
    tests: ['apps/server/src/api-process.test.ts'],
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
    : [...groups, { name: WHOLE_SUITE_RUN, paths: rest, tests: [...WHOLE_SUITE] }];
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
 * What the score is measured with, beside the safety code itself (D-098):
 * what builds and judges the runs, and the root Vitest configuration every
 * group without its own runs under. With each group's tests and
 * configuration, these start the run. BUG-10's pull request added the
 * journeys group and its tests, touched no safety file, and so never ran
 * that group on CI.
 *
 * The whole-suite run's tests are not here: they are every product test, so
 * every change to the product would start the run. Nor is the lockfile, which
 * would start it on every dependency update, a cost the owner has not chosen.
 */
export const MUTATION_INPUTS = [
  'stryker.config.mjs',
  'scripts/lib/gate-decisions.mjs',
  'scripts/mutation.mjs',
  'vitest.config.mjs',
  'vitest.shared.mjs',
  // The groups' tests run on the test kit's fakes: the api-process tests
  // reach their database through its fake PostgreSQL server. A changed fake
  // can change a score. Only this package. Of the rest of packages/,
  // contracts is product code, which the whole-suite run's catch-all must not
  // turn into triggers, and config is tooling: the shared lint, TypeScript
  // and import-rule settings (AR-10).
  'packages/test-kit/',
];

/** A path names itself, or the folder it is: `a/b` and `a/b/` both hold `a/b/c.ts`. */
const within = (file, p) => file === p || file.startsWith(p.endsWith('/') ? p : `${p}/`);

/**
 * Should `pnpm run mutation` run, and can it?
 *
 * `onlyIfSafetyPathsChanged` keeps its name, which CI passes, and since D-098
 * also counts a change to what the score is measured with: a group's tests or
 * configuration, or MUTATION_INPUTS. Safety files and inputs are matched
 * by the same rule, `within`.
 *
 * @param {{ changed: string[], onlyIfSafetyPathsChanged: boolean, configured: boolean }} state
 * @returns {{ ok: boolean, action: 'skip' | 'run', message: string }}
 */
export function decideMutation({ changed, onlyIfSafetyPathsChanged, configured }) {
  const safetyChanges = changed.filter((file) => SAFETY_PATHS.some((p) => within(file, p)));
  const inputs = [
    ...MUTATION_INPUTS,
    ...MUTATION_GROUPS.flatMap((group) => [
      ...group.tests,
      ...(group.config === undefined ? [] : [group.config]),
    ]),
  ];
  const inputChanges = changed.filter(
    (file) => !safetyChanges.includes(file) && inputs.some((p) => within(file, p)),
  );
  if (onlyIfSafetyPathsChanged && safetyChanges.length === 0 && inputChanges.length === 0) {
    return {
      ok: true,
      action: 'skip',
      message:
        'mutation: this change touches no safety code, and nothing the score is measured with, ' +
        'so there is nothing to mutate (D-036, D-098).',
    };
  }
  const inputsNamed =
    inputChanges.length > 0
      ? ` What the score is measured with changed: ${inputChanges.join(', ')} (D-098).`
      : '';
  if (!configured) {
    const why = !onlyIfSafetyPathsChanged
      ? 'mutation testing was asked for'
      : safetyChanges.length > 0
        ? `this change touches safety code (${safetyChanges.join(', ')})`
        : `this change touches what the score is measured with (${inputChanges.join(', ')})`;
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
        ? `mutation: running on ${String(safetyChanges.length)} changed safety file(s).${inputsNamed}`
        : `mutation: running.${inputsNamed}`,
  };
}

/**
 * How long Stryker may run, across all the runs of mutationRuns together: each
 * run gets what the ones before it left. In the whole-suite run each mutant
 * runs the whole product suite (the command runner in stryker.config.mjs):
 * about 7 s once INF-07 added tests that start real processes, and 119 mutants
 * on CI's two cores outran proc.mjs's default of 590 s. The groups run only
 * their own tests (D-066, amended 2026-09-25), and since D-098 every safety
 * file that exists is in a group, so no mutant runs the whole suite. A mutant
 * that makes a test wait now costs Vitest's per-test timeout, not Stryker's
 * (stryker.config.mjs). The budget is not raised (D-098). A test in scripts/gate.test.mjs
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

/**
 * Where a run's Stryker JSON report is written (stryker.config.mjs) and read
 * (scripts/mutation.mjs): one file per run, so a run never reads another's.
 *
 * @param {string} name — the run's name, from mutationRuns()
 */
export const mutationReportFile = (name) => `reports/mutation/${name}.json`;

/**
 * D-036's threshold, which D-098 applies to every mutated file on its own.
 * stryker.config.mjs gives Stryker the same number as its `break`.
 */
export const THRESHOLD_PERCENT = 80;

/**
 * Mutants that say nothing about the tests: the code would not compile with
 * them, or a reason in the code excludes them. Neither caught nor missed, and
 * named per file all the same: a score that rests on few mutants says so.
 *
 * Every other status counts, and only Killed counts as caught. A
 * RuntimeError counts against its file: with the command runner it means the
 * command never ran the tests against that mutant (the shell could not start
 * them, or a Stryker worker crashed), so nothing caught it.
 */
const LEFT_OUT = new Set(['CompileError', 'Ignored']);

/** `1 runtime error`, `2 runtime errors`. */
const plural = (n, one, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * 62.5, 70 or 66.66: at most two decimals, cut rather than rounded, so a file
 * that fails is never shown at 80 %.
 */
const percent = (killed, counted) => Math.floor((killed * 10_000) / counted) / 100;

/**
 * What a run's Stryker JSON report means for the gate (D-098). Stryker scores
 * a timed-out mutant as detected, and pools every file into one score, so on
 * #53 a run whose 84 mutants all timed out scored 100 % and exited 0. Here
 * only a killed mutant is caught, and each file must reach 80 % of
 * killed ÷ (killed + survived + timed out + no coverage + runtime error) on
 * its own.
 *
 * A file with no mutant at all, such as one of types alone, has nothing to
 * mutate and is left out: failing it would block for good. A file that had
 * mutants and saw every one left out fails: nothing was measured in it.
 *
 * @param {{ files: Record<string, { mutants: { status: string }[] }> }} report
 *   — mutation-testing-report-schema, as Stryker's json reporter writes it
 * @returns {{ ok: boolean, message: string }}
 */
export function judgeMutationReport(report) {
  const files = Object.entries(report.files)
    .filter(([, { mutants }]) => mutants.length > 0)
    .map(([file, { mutants }]) => {
      const count = (status) => mutants.filter((mutant) => mutant.status === status).length;
      const counted = mutants.filter((mutant) => !LEFT_OUT.has(mutant.status)).length;
      const killed = count('Killed');
      const missed = [count('Survived'), count('Timeout'), count('NoCoverage')];
      const runtimeErrors = count('RuntimeError');
      const counts = [
        `${String(killed)} killed`,
        `${String(missed[0])} survived`,
        `${String(missed[1])} timed out`,
        `${String(missed[2])} no coverage`,
      ];
      if (runtimeErrors > 0) counts.push(plural(runtimeErrors, 'runtime error'));
      // Any other status, such as Pending, counts against the file and is
      // named, rather than passing unseen.
      const other = counted - killed - runtimeErrors - missed.reduce((sum, n) => sum + n, 0);
      if (other > 0) counts.push(`${String(other)} other`);
      const leftOut = [
        plural(count('CompileError'), 'compile error'),
        plural(count('Ignored'), 'ignored', 'ignored'),
      ].filter((text) => !text.startsWith('0 '));
      return {
        file,
        killed,
        counted,
        line:
          counted === 0
            ? `${file}: no score, every one of its ${String(mutants.length)} mutants was left ` +
              `out (${leftOut.join(', ')})`
            : `${file}: ${String(percent(killed, counted))} % (${counts.join(', ')}` +
              `${leftOut.length > 0 ? `; left out of the score: ${leftOut.join(', ')}` : ''})`,
      };
    });

  if (files.length === 0) {
    return {
      ok: false,
      message:
        'mutation: the report has no mutants, so this run measured nothing, and that is a ' +
        'failure, not a pass (D-098).',
    };
  }
  const scored = files.filter((file) => file.counted > 0);
  const unmeasured = files.filter((file) => file.counted === 0);
  const below = scored.filter((file) => file.killed * 100 < THRESHOLD_PERCENT * file.counted);
  const problems = [];
  if (below.length > 0) {
    problems.push(
      `mutation: below ${String(THRESHOLD_PERCENT)} % of mutants killed (D-036), file by file:\n` +
        below.map((file) => `  ${file.line}\n`).join('') +
        'Only a killed mutant counts as caught (D-098): one that survived, timed out, ran no ' +
        'test or hit a runtime error is not caught. The clear-text report above names each. A ' +
        'survivor needs a test that fails on it. A timeout is a test that waited instead of ' +
        'failing: make it fail in time, or, if the mutant can only ever hang, exclude it in the ' +
        'code with a reason. A runtime error means the tests never ran against that mutant: ' +
        'the log above says why.',
    );
  }
  if (unmeasured.length > 0) {
    problems.push(
      'mutation: these files had mutants, and every one failed to compile or was excluded in ' +
        'the code, so nothing was measured in them, and that is a failure, not a pass (D-098):\n' +
        unmeasured.map((file) => `  ${file.line}\n`).join('') +
        'The clear-text report above names each mutant and why it was left out.',
    );
  }
  if (problems.length > 0) {
    return { ok: false, message: problems.join('\n') };
  }
  return {
    ok: true,
    message:
      `mutation: every file reached ${String(THRESHOLD_PERCENT)} % of mutants killed:\n` +
      scored.map((file) => `  ${file.line}\n`).join(''),
  };
}
