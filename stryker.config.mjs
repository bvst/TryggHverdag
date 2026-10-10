// D-036: on safety code, the tests must catch planted bugs — at least 80 % of
// them. Coverage says a line ran; the mutation score says a bug in that line
// would have been noticed. For a system whose whole job is to notice silence,
// the difference between those two is the difference between a test suite and
// a decoration.
//
// The paths come from scripts/lib/gate-decisions.mjs rather than being listed
// again here. That file already decides *whether* this gate runs; if it and
// this config could disagree, a safety path could be gated by one and ignored
// by the other, which is the worst of both.
//
// So do the runs (D-066, amended by the owner 2026-09-25). scripts/mutation.mjs
// runs Stryker once per run of mutationRuns() and names it in STRYKER_RUN; the
// config then mutates that run's paths against that run's tests, and writes
// the JSON report the gate judges the run by (D-098).
import process from 'node:process';
import {
  THRESHOLD_PERCENT,
  mutationReportFile,
  mutationRuns,
} from './scripts/lib/gate-decisions.mjs';

/**
 * The run STRYKER_RUN names. Unset, Stryker refuses to start: a run outside
 * `pnpm run mutation` is judged by nothing but Stryker's own score, in which a
 * timed-out mutant counts as caught, so 84 timeouts and no kill scored 100 %
 * on #53 (D-098). A name no run has throws too, rather than falling back to
 * every path against the whole suite, which the log would never explain.
 *
 * @param {string | undefined} name
 */
function chosenRun(name) {
  if (name === undefined) {
    throw new Error(
      'STRYKER_RUN is not set, so no mutation run is named. Run mutation testing with ' +
        '`pnpm run mutation`: it starts each run, names it here, and judges its report file ' +
        'by file. Stryker on its own counts a timed-out mutant as caught, and nothing would ' +
        'judge it (D-098).',
    );
  }
  const runs = mutationRuns();
  const run = runs.find((candidate) => candidate.name === name);
  if (run === undefined) {
    throw new Error(
      `STRYKER_RUN is "${name}", and no mutation run has that name. The runs are: ` +
        `${runs.map((candidate) => candidate.name).join(', ')} (D-066).`,
    );
  }
  return run;
}

const run = chosenRun(process.env.STRYKER_RUN);

/** A safety path is either a folder (ends in /) or a single file. */
const mutate = run.paths.map((path) => (path.endsWith('/') ? `${path}**/*.ts` : path));

/**
 * A run whose tests the root configuration leaves out names the one that
 * collects them, such as the journeys run's system tests (D-095). The others
 * run under the root configuration, so their command is the one it always was.
 */
const vitestConfig = run.config === undefined ? '' : `--config ${run.config} `;

/**
 * How long Vitest lets one test, and one hook, run (D-098). Without these,
 * vitest.config.mjs gives a test 60 s, and Stryker stops a mutant long
 * before: a mutant that makes a test wait forever was recorded as a timeout,
 * which Stryker counts as caught, rather than as the failed test it is.
 *
 * Above the longest any test waits on purpose, so that test still fails by
 * its own assertion: bin.test.ts waits up to 15 s for a process to start,
 * then 1.5 s more. And far above how long a test takes on a busy machine: on
 * two cores, with ten of these runs at once (Stryker runs two), the slowest
 * test of every group took 4.1 s, bin.test.ts's BUG-3 test (2.3 s alone).
 * The hooks get the same limit, and take milliseconds: healthchecks.test.ts's
 * afterEach closes servers, and bin.test.ts's onTestFinished kills a child
 * still running, synchronously, without waiting for it to end. Measured for
 * BUG-12, 2026-10-02.
 */
const VITEST_TIMEOUT_MS = 20_000;

/**
 * Stryker's own allowance on top of 1.5 times the clean run. Inside it, Vitest
 * must start, fail the waiting test, stop at --bail 1 and exit. With a hang
 * planted by hand, two runs at once on two cores, that took 23.3 s in the
 * process run (allowed 51 s) and 22.7 s in the api-process run (allowed 39 s),
 * with a server and a pool left open. Under the ten-run load above, the
 * api-process run's start alone rose to 9 s: about 31 s in all, which 10 s
 * over Vitest's limit would leave almost no room for. Measured for BUG-12.
 */
const STRYKER_TIMEOUT_MS = VITEST_TIMEOUT_MS + 15_000;

/**
 * --bail 1: a mutant that makes several tests wait would otherwise take
 * several times the per-test timeout, and Stryker would stop it as a timeout
 * after all. The command runner reads only the exit code, so the first
 * failure is all it needs.
 */
const vitestOptions =
  `--testTimeout=${String(VITEST_TIMEOUT_MS)} --hookTimeout=${String(VITEST_TIMEOUT_MS)} ` +
  '--bail=1 ';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'pnpm',

  // The command runner, not the vitest runner.
  //
  // The vitest runner is the faster one: it picks, per mutant, the tests that
  // cover it. Against vitest 5 it reported every mutant as covered and none as
  // killed — a 4 % score on tests that kill those same mutants when they are
  // planted by hand. Its peer range says `vitest >=2`, which is not the same as
  // anyone having run it against 5.
  //
  // A mutation score that is wrong in the reassuring direction would be worse
  // than no gate at all, and this one was wrong in the other direction while
  // looking exactly as authoritative. So: run the suite, read the exit code.
  // Slower, and it cannot be quietly wrong. Each run of a group runs that
  // group's tests, the ones that can kill its mutants (D-066, amended
  // 2026-09-25).
  testRunner: 'command',
  commandRunner: {
    // The whole suite is apps and packages only. A mutant in safety code can
    // only be killed by a test of the product; the hook and script tests would
    // add seconds per mutant and could never fail because of one.
    //
    // Vitest's own bin, started directly, because `pnpm exec` cost about 12 %
    // of each mutant's CPU for nothing a run needs (D-117).
    //
    // Vitest's module cache (D-124). Stryker instruments every mutant into one
    // copy of the code and picks the active one by an environment variable, so
    // the transforms are the same for every mutant: the first test run fills
    // the cache, and each mutant's run reads it. The path is relative, so the
    // cache is kept in the run's own Stryker sandbox and removed with it. No
    // run reads another's entries (D-099): each key includes the module's
    // absolute path, sandbox and all, the file's content and the config.
    // Stryker does not read .gitignore, so a stray .vitest-fs-cache/ in the
    // repository root would be copied in, but its keys could never match. One
    // worker, because Stryker's runners already fill the cores, and --bail=1
    // then stops at the first test file that kills the mutant.
    command: `node node_modules/vitest/vitest.mjs run --fsModuleCache --fsModuleCachePath=.vitest-fs-cache --maxWorkers=1 ${vitestConfig}${vitestOptions}${run.tests.join(' ')}`,
  },
  timeoutMS: STRYKER_TIMEOUT_MS,

  // Tests are not mutated, and neither is anything outside a safety path: the
  // score has to mean "the safety rules are protected", not be diluted by
  // wiring that is protected some other way.
  mutate: [...mutate, '!**/*.test.ts', '!**/*.integration.test.ts', '!**/*.system.test.ts'],

  // Terraform's working state is never an input of a mutation run, and
  // Stryker cannot copy it: a provider that infra:check links from its plugin
  // cache is a symbolic link to a directory, so every run failed with EISDIR
  // (found by REL-10's gate:full). Stryker does not read .gitignore (see the
  // module cache, above), so it is left out here. infra/'s tracked files are
  // still copied.
  ignorePatterns: ['infra/**/.terraform'],

  // Run every test against every mutant. The default picks tests per mutant
  // from coverage, which needs the runner to report which test touched which
  // line — and here it reported almost nothing, so mutants survived because no
  // test ran rather than because no test noticed. That distinction is the
  // whole point of this gate, so it is not left to an optimisation. The safety
  // suite is milliseconds; when it stops being, revisit this rather than the
  // threshold.
  coverageAnalysis: 'all',

  // `break` is Stryker's own backstop to the gate's check: Stryker pools every
  // file into one score and counts a timed-out mutant as caught, so the gate
  // judges each file from the JSON report (D-098). The same number, so the
  // two never disagree about the threshold.
  thresholds: { high: 90, low: 80, break: THRESHOLD_PERCENT },

  // No incrementalFile, and incremental is never switched on (D-099): every
  // run is fresh. With the command runner Stryker has no coverage data, so an
  // incremental run reuses every earlier result in code that has not changed,
  // whatever happened to the tests. scripts/mutation.mjs refuses the flag.
  //
  // The JSON report is what the gate judges, file by file (D-098). One per
  // run, so a run never reads another's.
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: mutationReportFile(run.name) },

  // A surviving mutant is a real finding, so the report has to name it rather
  // than summarise it away.
  clearTextReporter: { allowColor: false, maxTestsToLog: 3 },
};
