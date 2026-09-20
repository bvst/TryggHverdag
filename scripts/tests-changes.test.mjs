// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// RG-03 over a whole pull request. The per-file hook is tested separately; what
// matters here is that nothing slips through by being deleted or renamed.
import { describe, expect, test } from 'vitest';
import { isTestFile, weakenedFiles } from './tests-changes.mjs';

const BEFORE = `
test('LOST-02-AC1: silence opens an alert', () => {
  expect(alert.state).toBe('OPEN');
  expect(responder.notified).toBe(true);
});
`;

function sources(before, now) {
  return {
    files: ['apps/server/src/journey.test.ts'],
    contentsBefore: (file) => before[file] ?? null,
    contentsNow: (file) => now[file] ?? '',
  };
}

describe('isTestFile', () => {
  test.each([
    ['apps/server/src/journey.test.ts', true],
    ['apps/mobile/src/screens/home.test.tsx', true],
    ['.claude/hooks/guard-bash.test.mjs', true],
    ['apps/mobile/e2e/start-journey.yaml', true],
    ['apps/server/src/journey.ts', false],
    ['docs/progress.md', false],
  ])('%s → %s', (file, expected) => {
    expect(isTestFile(file)).toBe(expected);
  });
});

describe('weakenedFiles', () => {
  const file = 'apps/server/src/journey.test.ts';

  test('reports a weakened file with the reason', () => {
    const now = BEFORE.replace('  expect(responder.notified).toBe(true);\n', '');
    const found = weakenedFiles(sources({ [file]: BEFORE }, { [file]: now }));
    expect(found).toEqual([{ file, issues: ['the number of assertions went down'] }]);
  });

  test('a deleted test file is caught — the case the per-file hook cannot see', () => {
    const found = weakenedFiles(sources({ [file]: BEFORE }, {}));
    expect(found[0]?.file).toBe(file);
    expect(found[0]?.issues).toContain('the number of tests went down');
  });

  test('a new test file is not a weakening', () => {
    expect(weakenedFiles(sources({}, { [file]: BEFORE }))).toEqual([]);
  });

  test('an unchanged file passes', () => {
    expect(weakenedFiles(sources({ [file]: BEFORE }, { [file]: BEFORE }))).toEqual([]);
  });

  test('files that are not tests are ignored', () => {
    const found = weakenedFiles({
      files: ['apps/server/src/journey.ts', 'docs/progress.md'],
      contentsBefore: () => BEFORE,
      contentsNow: () => '',
    });
    expect(found).toEqual([]);
  });
});
