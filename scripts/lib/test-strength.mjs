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

/** One property access, as `.name` or as `['name']` in any of the three quotes. */
const access = (name) => `(?:\\.${name}\\b|\\[['"\`]${name}['"\`]\\])`;

/**
 * A modifier among `names`, reached the ways a test file reaches one (D-082):
 * behind any other modifiers, such as concurrent, on it, test, describe or
 * suite; or on any other test object, such as one made with test.extend, when
 * it is called. On any other object the call is what makes it a test's:
 * `options.skip = true` and `database.failing === 'time'` are not.
 */
const modifier = (names) => {
  const chain = `${access('\\w+')}*${access(`(?:${names})`)}`;
  return `\\b(?:it|test|describe|suite)${chain}|\\b\\w+${chain}\\s*\\(`;
};

// A test is switched off by a skip, focus or todo, or on a condition (skipIf,
// runIf); by the x- and f- prefixes; or from inside its body, by a call to its
// context's skip, whatever the context is called (D-082). One alternation,
// matched left to right, so each form counts once: a skip on a test is matched
// from the test's name, never again as a call. Early returns and swallowed
// failures stay with test-auditor: no pattern sees them all.
const SKIPS = new RegExp(
  `${modifier('skip|only|todo|skipIf|runIf')}|\\bx(?:it|test|describe)\\b|\\bf(?:it|describe)\\b|\\bskip\\s*\\(`,
  'g',
);
// A test inverted to expect failure passes when it fails, and the run reports
// it as passed: counted apart, and said in its own words (D-082).
const INVERTED = new RegExp(modifier('fails|failing'), 'g');

/** How much a test file actually checks. */
export function strengthOf(source) {
  const count = (pattern) => (source.match(pattern) ?? []).length;
  return {
    tests: count(TESTS),
    assertions: count(ASSERTIONS),
    skips: count(SKIPS),
    inverted: count(INVERTED),
  };
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
  if (now.inverted > was.inverted) {
    issues.push('tests were inverted to expect failure (.fails or .failing)');
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
