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
import { SAFETY_PATHS } from './scripts/lib/gate-decisions.mjs';

/** A safety path is either a folder (ends in /) or a single file. */
const mutate = SAFETY_PATHS.map((path) => (path.endsWith('/') ? `${path}**/*.ts` : path));

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
  // Slower, and it cannot be quietly wrong.
  testRunner: 'command',
  commandRunner: {
    // apps and packages only. A mutant in safety code can only be killed by a
    // test of the product; the hook and script tests would add seconds per
    // mutant and could never fail because of one.
    command: 'pnpm exec vitest run apps packages',
  },

  // Tests are not mutated, and neither is anything outside a safety path: the
  // score has to mean "the safety rules are protected", not be diluted by
  // wiring that is protected some other way.
  mutate: [...mutate, '!**/*.test.ts', '!**/*.integration.test.ts', '!**/*.system.test.ts'],

  // Run every test against every mutant. The default picks tests per mutant
  // from coverage, which needs the runner to report which test touched which
  // line — and here it reported almost nothing, so mutants survived because no
  // test ran rather than because no test noticed. That distinction is the
  // whole point of this gate, so it is not left to an optimisation. The safety
  // suite is milliseconds; when it stops being, revisit this rather than the
  // threshold.
  coverageAnalysis: 'all',

  thresholds: { high: 90, low: 80, break: 80 },

  incrementalFile: 'reports/stryker-incremental.json',
  reporters: ['clear-text', 'progress'],

  // A surviving mutant is a real finding, so the report has to name it rather
  // than summarise it away.
  clearTextReporter: { allowColor: false, maxTestsToLog: 3 },
};
