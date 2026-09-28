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
 * else. That difference is real, so it stays visible at each call site.
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
