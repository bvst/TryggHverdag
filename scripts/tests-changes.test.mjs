// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// RG-03 over a whole pull request. The per-file hook is tested separately; what
// matters here is that nothing slips through by being deleted or renamed.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
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

// BUG-7: a test file moved and weakened in the same pull request escaped.
//
// git reported the move only under the path the file went to. That path has no
// "before", so weakenedFiles() took it for a new file with nothing to weaken,
// and the path it left was never in the list at all. safety-reviewer found this
// on INF-06, 2026-09-26, with the rest of BUG-7: changedFiles() in
// scripts/lib/git.mjs, which this script reads its list from, heard of a moved
// file only under its new path.
//
// This runs the real script, on a repository built the way a pull request is.

const repos = [];
afterEach(() => {
  for (const dir of repos.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Four tests, so that dropping one leaves the file about 75 % like it was, and
// git still pairs the two paths as a move rather than a deletion and an
// addition. The test below checks that it does.
const RULES = [1, 2, 3, 4].map(
  (n) => `test('rule ${String(n)} holds', () => {\n  expect(rule${String(n)}()).toBe(true);\n});\n`,
);

/**
 * origin/main holds `from` with the four tests in RULES. The branch moves it to
 * `to` with `git mv`, writes `now` there, and commits.
 */
function movedTestRepo({ from, to, now }) {
  const dir = mkdtempSync(join(tmpdir(), 'bug7-tests-changes-'));
  repos.push(dir);
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  const write = (file, text) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  // git's own default, pinned so that a global config cannot hide the move.
  git('config', 'diff.renames', 'true');
  write(from, RULES.join('\n'));
  git('add', '-A');
  git('commit', '-qm', 'main');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'the-pull-request');
  mkdirSync(dirname(join(dir, to)), { recursive: true });
  git('mv', from, to);
  write(to, now);
  git('add', '-A');
  git('commit', '-qm', 'the pull request');
  return { dir, git };
}

/**
 * Runs scripts/tests-changes.mjs in `cwd`. The script reads neither
 * GITHUB_EVENT_NAME nor GITHUB_OUTPUT; both are removed all the same, so that
 * a CI job running these tests cannot hand it values of its own.
 */
function runTestsChanges(cwd) {
  const env = { ...process.env };
  delete env.GITHUB_EVENT_NAME;
  delete env.GITHUB_OUTPUT;
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/tests-changes.mjs'), '--base', 'origin/main'],
    { cwd, encoding: 'utf8', env },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('tests:changes on a pull request that moves a test file', () => {
  test('BUG-7: a test file moved and weakened in the same pull request is reported as weakened', () => {
    // After the fix, a test file that is only moved, with every test intact,
    // is reported too: the path it left reads like a deleted file whose tests
    // all went. That is deliberate. Moving a test file then needs the same
    // written RG-03 reason under "Test changes" that removing one already
    // needs, and test-auditor reads it. What must not happen again is the
    // silence below, where a weakened file passed for being in a new place.
    const from = 'apps/server/src/journey.test.ts';
    const to = 'apps/server/src/journeys/journey.test.ts';
    const { dir, git } = movedTestRepo({ from, to, now: RULES.slice(0, 3).join('\n') });
    // The condition itself: git pairs the two paths as one move.
    expect(git('diff', '--name-status', 'origin/main', 'HEAD')).toMatch(
      new RegExp(`^R\\d{3}\\t${from}\\t${to}$`, 'm'),
    );

    const result = runTestsChanges(dir);

    expect(result.output).not.toContain('none weakened');
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('the number of tests went down');
    expect(result.output).toMatch(/apps\/server\/src\/(journeys\/)?journey\.test\.ts/);
    expect(result.output).toContain('RG-03');
  });
});
