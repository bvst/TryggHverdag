// RG-03: tests may not be quietly weakened.
//
// One implementation, two callers: the post-edit hook uses it on the file that
// was just edited, and `pnpm run tests:changes` uses it on every test file in a
// pull request. A gate that is enforced twice by two different rules is a gate
// that disagrees with itself eventually.

/** Files these rules apply to. */
export const TEST_GLOBS = ['**/*.test.ts', '**/*.test.tsx', '**/*.test.mjs', 'apps/mobile/e2e/**'];

const TESTS = /\b(it|test)(\.each\([^)]*\))?\s*\(/g;
const ASSERTIONS = /\bexpect\s*\(|\bassert(Visible|NotVisible|True)?\b/g;
const SKIPS =
  /\b(it|test|describe)\.(skip|only|todo)\b|\bx(it|test|describe)\b|\bf(it|describe)\b/g;

/** How much a test file actually checks. */
export function strengthOf(source) {
  const count = (pattern) => (source.match(pattern) ?? []).length;
  return { tests: count(TESTS), assertions: count(ASSERTIONS), skips: count(SKIPS) };
}

/**
 * What got weaker between two versions of a test file. An empty list means the
 * change is fine; each entry is a plain-language reason it is not.
 *
 * @param {string} before contents in git
 * @param {string} after contents now ('' when the file was deleted)
 */
export function weakenings(before, after) {
  const was = strengthOf(before);
  const now = strengthOf(after);
  const issues = [];
  if (now.skips > was.skips) {
    issues.push('skipped, focused or todo tests were added');
  }
  if (now.tests < was.tests) {
    issues.push('the number of tests went down');
  }
  if (now.assertions < was.assertions) {
    issues.push('the number of assertions went down');
  }
  return issues;
}

/** The sentence a gate shows when a test file got weaker. */
export function weakeningMessage(file, issues) {
  return (
    `RG-03: possible test weakening in ${file}: ${issues.join('; ')}. ` +
    'This must be justified in the pull request under "Test changes", and test-auditor will review it. ' +
    'If it was not intended, restore the test.'
  );
}
