// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-06: "done" means the gate passed. A session cannot finish on a red gate
// without that being written down where the next session will see it.
import { afterEach, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ALLOWED,
  BLOCKED,
  fakeScripts,
  makeRepo,
  removeRepo,
  runHook,
  write,
} from './test-helpers.mjs';

const PASSES = {};
const FAILS = { exitCode: 1, output: '2 tests failed' };

const repos = [];
function repoWith(scripts, extraFiles = {}) {
  const dir = makeRepo(fakeScripts(scripts));
  repos.push(dir);
  write(dir, extraFiles);
  return dir;
}

function ranLog(dir) {
  try {
    return readFileSync(path.join(dir, 'ran.txt'), 'utf8');
  } catch {
    return '';
  }
}

const stop = (dir, input = {}, args = []) => runHook('stop-gate.mjs', { args, input, cwd: dir });

afterEach(() => {
  while (repos.length > 0) {
    removeRepo(repos.pop());
  }
});

describe('HK-06: with code changed', () => {
  test('a passing gate lets the session finish', () => {
    const dir = repoWith(
      { 'gate:quick': PASSES },
      { 'apps/server/src/api.ts': 'export const a = 1;' },
    );
    expect(stop(dir).status).toBe(ALLOWED);
    expect(ranLog(dir)).toContain('gate:quick');
  });

  test('a failing gate refuses, and says which gate and why', () => {
    const dir = repoWith(
      { 'gate:quick': FAILS },
      { 'apps/server/src/api.ts': 'export const a = 1;' },
    );
    const result = stop(dir);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('gate:quick');
    expect(result.stderr).toContain('RG-01');
    expect(result.stderr).toContain('2 tests failed');
  });

  test('a passing gate clears an old failure note', () => {
    const dir = repoWith(
      { 'gate:quick': PASSES },
      { 'apps/server/src/api.ts': 'export const a = 1;', '.claude/state/gate-failed': 'old' },
    );
    expect(stop(dir).status).toBe(ALLOWED);
    expect(existsSync(path.join(dir, '.claude/state/gate-failed'))).toBe(false);
  });
});

describe('HK-06: when Claude has already been asked to continue once', () => {
  test('it writes the failure down instead of looping forever', () => {
    const dir = repoWith(
      { 'gate:quick': FAILS },
      { 'apps/server/src/api.ts': 'export const a = 1;' },
    );
    const result = stop(dir, { stop_hook_active: true });
    expect(result.status).toBe(ALLOWED);
    const note = readFileSync(path.join(dir, '.claude/state/gate-failed'), 'utf8');
    expect(note).toContain('gate:quick failed');
    expect(note).toContain('2 tests failed');
  });
});

describe('HK-06: during the red phase of /feature', () => {
  test('only the static checks run, because the tests are meant to fail', () => {
    const dir = repoWith(
      { 'gate:quick': FAILS, 'gate:static': PASSES },
      { 'apps/server/src/api.ts': 'export const a = 1;', '.claude/state/phase': 'red:LOST-02' },
    );
    expect(stop(dir).status).toBe(ALLOWED);
    expect(ranLog(dir)).toContain('gate:static');
    expect(ranLog(dir)).not.toContain('gate:quick');
  });

  test('but a subagent finishing still faces the full gate', () => {
    const dir = repoWith(
      { 'gate:quick': FAILS, 'gate:static': PASSES },
      { 'apps/server/src/api.ts': 'export const a = 1;', '.claude/state/phase': 'red:LOST-02' },
    );
    expect(stop(dir, {}, ['--subagent']).status).toBe(BLOCKED);
    expect(ranLog(dir)).toContain('gate:quick');
  });
});

describe('HK-06: when there is nothing to check', () => {
  test('an unchanged repository finishes without running the gate', () => {
    const dir = repoWith({ 'gate:quick': FAILS });
    expect(stop(dir).status).toBe(ALLOWED);
    expect(ranLog(dir)).toBe('');
  });

  test('a documents-only change finishes without running the gate', () => {
    const dir = repoWith({ 'gate:quick': FAILS }, { 'docs/progress.md': '# progress' });
    expect(stop(dir).status).toBe(ALLOWED);
    expect(ranLog(dir)).toBe('');
  });
});

// BUG-7: code moved into docs/ is a code change. The hook asked git for the
// changed paths with rename detection on, which is git's default, and git
// reported the move only under docs/. So the one path that makes it a code
// change never reached the check above, and the session finished without the
// gate. safety-reviewer found this on INF-06, 2026-09-26, beside the same flaw
// in scripts/lib/git.mjs.
const CODE_MOVED_TO_DOCS = [
  { how: 'staged with git mv and not yet committed', committed: false },
  { how: 'committed on a branch', committed: true },
];

describe('HK-06: a move from code to docs/', () => {
  test.each(CODE_MOVED_TO_DOCS)(
    'BUG-7: code moved to docs/, $how, is a code change, so the gate runs',
    ({ committed }) => {
      const from = 'apps/server/src/api.ts';
      const to = 'docs/old-api.md';
      const dir = makeRepo({
        ...fakeScripts({ 'gate:quick': FAILS }),
        [from]: 'export const a = 1;\n',
      });
      repos.push(dir);
      const git = (...args) =>
        execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
      // git's own default, pinned so that a global config cannot hide the move.
      git('config', 'diff.renames', 'true');
      // origin/main at the first commit, as on a pull request's branch.
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      git('checkout', '-q', '-b', 'the-branch');
      mkdirSync(path.join(dir, 'docs'), { recursive: true });
      git('mv', from, to);
      if (committed) {
        git('commit', '-qm', 'move the code into docs');
      }
      // The condition itself: git pairs the two paths as one move.
      expect(git('diff', '--name-status', 'origin/main')).toMatch(
        new RegExp(`^R100\\t${from}\\t${to}$`, 'm'),
      );

      const result = stop(dir);

      expect(ranLog(dir)).toContain('gate:quick');
      expect(result.status).toBe(BLOCKED);
      expect(result.stderr).toContain('2 tests failed');
    },
  );
});
