// req-coverage: fixtures-only — the IDs below are sample data for this test.
//
// trackedFiles decides what the requirement report is allowed to see. It used
// to run a plain `git ls-files`, so a test file written minutes ago and not yet
// staged did not exist as far as the report was concerned: running the gate
// before `git add` and after it gave different answers, and the second answer
// arrived as a CI failure on a report that had been correct when written.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { trackedFiles } from './req-coverage.mjs';

let repo;

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'req-coverage-test-'));
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');

  writeFileSync(path.join(repo, '.gitignore'), 'ignored.ts\ncoverage/\n');
  writeFileSync(path.join(repo, 'committed.test.ts'), "test('REL-01: named here', () => {});");
  git('add', '.');
  git('commit', '-qm', 'first');

  // The case that broke: a new test, written and not yet staged.
  writeFileSync(path.join(repo, 'brand-new.test.ts'), "test('REL-01: named here too', () => {});");
  writeFileSync(path.join(repo, 'ignored.ts'), 'should not be counted');
  mkdirSync(path.join(repo, 'coverage'), { recursive: true });
  writeFileSync(path.join(repo, 'coverage', 'report.ts'), 'generated, not a source of truth');
});

describe('trackedFiles', () => {
  test('sees a file that is committed', () => {
    expect(trackedFiles(repo)).toContain('committed.test.ts');
  });

  test('sees a new file that has not been staged yet', () => {
    // The whole point. A requirement whose only test is brand new must not read
    // as uncovered just because nobody has run `git add`.
    expect(trackedFiles(repo)).toContain('brand-new.test.ts');
  });

  test('does not see an ignored file', () => {
    // --exclude-standard. Without it, node_modules and build output would be
    // scanned for requirement IDs, which is both slow and wrong.
    expect(trackedFiles(repo)).not.toContain('ignored.ts');
  });

  test('does not see generated output in an ignored directory', () => {
    expect(trackedFiles(repo).filter((f) => f.startsWith('coverage/'))).toEqual([]);
  });

  test('the answer does not change when the new file is staged', () => {
    // The bug was that these two differed, so this is the property that matters.
    const before = trackedFiles(repo).sort();
    git('add', 'brand-new.test.ts');

    expect(trackedFiles(repo).sort()).toEqual(before);
  });
});
