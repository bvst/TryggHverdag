// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-06: "done" means the gate passed. A session cannot finish on a red gate
// without that being written down where the next session will see it.
import { afterEach, describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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
