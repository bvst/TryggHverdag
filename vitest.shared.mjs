/**
 * What counts as a test file, in one place.
 *
 * This list lived in both vitest.config.mjs and vitest.coverage.config.mjs,
 * word for word including its comment — which is the same "two lists meant to
 * say the same thing" shape that this branch removed from scripts/lib/coverage.mjs,
 * where a missing entry had quietly left the worker outside the branch floor.
 * code-reviewer pointed out that it had been fixed in one place and recreated
 * in another. It had.
 *
 * The two configs differ in what they *exclude*, not in what they collect:
 * the unit run leaves out the system tests because they are their own gate,
 * and the coverage run keeps them because the API is reached at L6 and nowhere
 * else. That difference is real, so each keeps a list of its own: the coverage
 * run's in its config, the unit run's below (UNIT_EXCLUDE).
 */
export const TEST_FILES = [
  '.claude/hooks/**/*.test.mjs',
  'scripts/**/*.test.mjs',
  // Not every package keeps its code under src/: packages/config holds the
  // eslint and tsconfig presets at its root, and their tests were invisible to
  // this runner until this line existed.
  'packages/**/*.test.mjs',
  'packages/**/src/**/*.test.ts',
  // Matches the system tests too — only *.integration.test.ts is named
  // separately — so each config says which of those it wants by excluding it.
  'apps/**/src/**/*.test.ts',
];

/**
 * The app's tests belong to jest-expo, not to Vitest (INF-06).
 *
 * `apps/**\/src/**\/*.test.ts` above reaches them as well, and Vitest cannot run
 * React Native code: every run would fail on files with nothing wrong in them.
 * Unlike the L3 and L6 exclusions, this one is the same for every config, so
 * it is written once, here.
 */
export const JEST_EXPO_FILES = 'apps/mobile/**';

// What the unit, L6 and L3 configs collect, kept here rather than in each
// config because gate:file sends an edited test to the config that finds it
// (D-133) and reads these to know which one that is. Importing a config would
// load Vitest, in that gate and in the post-edit hook, after every edit.

/**
 * What the unit run (vitest.config.mjs) leaves out. L3 needs Docker and L6 is
 * its own gate, so neither belongs in the run that must stay fast and work on
 * any machine. Without this they would be swept up by TEST_FILES and a laptop
 * with no Docker would see a confusing failure rather than a passing unit suite.
 */
export const UNIT_EXCLUDE = [
  '**/node_modules/**',
  JEST_EXPO_FILES,
  '**/*.integration.test.ts',
  '**/*.system.test.ts',
];

/** L6, vitest.system.config.mjs. */
export const SYSTEM_TEST_FILES = ['apps/**/src/**/*.system.test.ts'];

/** L3, vitest.integration.config.mjs. */
export const INTEGRATION_TEST_FILES = [
  'apps/**/src/**/*.integration.test.ts',
  'packages/**/src/**/*.integration.test.ts',
];
