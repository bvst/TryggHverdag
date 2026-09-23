// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-08: a session that changed code must say so in docs/progress.md. Without
// this, the next session starts by guessing what the last one did.
import { afterEach, describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ALLOWED, BLOCKED, makeRepo, removeRepo, runHook, write } from './test-helpers.mjs';

const repos = [];
function repoWith(files = {}) {
  const dir = makeRepo({ 'docs/progress.md': '# Progress log\n' });
  repos.push(dir);
  write(dir, files);
  return dir;
}

const check = (dir, input = {}, args = []) =>
  runHook('progress-gate.mjs', { args, input, cwd: dir });
const marker = (dir) => path.join(dir, '.claude/state/progress-missing');

afterEach(() => {
  while (repos.length > 0) {
    removeRepo(repos.pop());
  }
});

describe('HK-08: code changed without a word about it', () => {
  test('is refused, and the message says where to write it', () => {
    const dir = repoWith({ 'apps/server/src/api.ts': 'export const api = 1;' });
    const result = check(dir);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('docs/progress.md');
    expect(result.stderr).toContain('HK-08');
  });

  test('counts a change to the gates themselves as code', () => {
    const dir = repoWith({ '.claude/hooks/new-guard.mjs': '// guard' });
    expect(check(dir).status).toBe(BLOCKED);
  });
});

describe('HK-08: work that is written down', () => {
  test('passes when progress.md changed too', () => {
    const dir = repoWith({
      'apps/server/src/api.ts': 'export const api = 1;',
      'docs/progress.md': '# Progress log\n\n- built the API\n',
    });
    expect(check(dir).status).toBe(ALLOWED);
  });

  test('passes when the narrative went to the archive instead', () => {
    // docs/progress.md was split: it is now a short current-state file, and the
    // narrative lives in docs/progress/m0.md. plan-keeper is told never to
    // append to the short one. Without this, a code change that moves no task
    // status would be blocked — or forced into a decorative edit, which is the
    // churn the split removed. Either counts as having written the work down.
    const dir = repoWith({
      'apps/server/src/api.ts': 'export const api = 1;',
      'docs/progress/m0.md': '# M0 build log\n\n- built the API\n',
    });
    expect(check(dir).status).toBe(ALLOWED);
  });

  test("passes for the next milestone's archive, not just M0's", () => {
    // The archive half is matched by shape, not by name. code-reviewer caught
    // the hardcoded 'docs/progress/m0.md' on #13: the day M1 opened its own
    // log, HK-08 would have stopped counting the archive and started demanding
    // a decorative edit of the short file — the exact churn the split removed,
    // and it would have failed silently, which is what this gate exists to
    // prevent. m1.md does not exist yet; that is the point of testing it.
    const dir = repoWith({
      'apps/server/src/api.ts': 'export const api = 1;',
      'docs/progress/m1.md': '# M1 build log\n\n- built the API\n',
    });
    expect(check(dir).status).toBe(ALLOWED);
  });

  test('passes when only documents changed — nothing to log', () => {
    const dir = repoWith({ 'docs/plan/decisions.md': '## D-060' });
    expect(check(dir).status).toBe(ALLOWED);
  });

  test('passes when nothing changed at all', () => {
    expect(check(repoWith()).status).toBe(ALLOWED);
  });

  test("ignores the reviewers' own notes", () => {
    const dir = repoWith({ '.claude/agent-memory/code-reviewer.md': '- prefers small functions' });
    expect(check(dir).status).toBe(ALLOWED);
  });
});

describe('HK-08: when blocking would cost more than it is worth', () => {
  test('after being asked to continue once, it records the gap instead of looping', () => {
    const dir = repoWith({ 'apps/server/src/api.ts': 'export const api = 1;' });
    const result = check(dir, { stop_hook_active: true });
    expect(result.status).toBe(ALLOWED);
    expect(readFileSync(marker(dir), 'utf8')).toContain('docs/progress.md');
  });

  test('at session end and before compaction it warns rather than blocks', () => {
    const dir = repoWith({ 'apps/server/src/api.ts': 'export const api = 1;' });
    const result = check(dir, {}, ['--warn-only']);
    expect(result.status).toBe(ALLOWED);
    // Was `toContain('has not been updated')`, which pinned a phrase rather
    // than a fact. The warning now has to name both halves of the split log,
    // so a reader knows where to write — stricter than the sentence it
    // replaced, not looser.
    expect(result.stdout).toContain('docs/progress.md');
    expect(result.stdout).toContain('docs/progress/m0.md');
    expect(existsSync(marker(dir))).toBe(true);
  });

  test('and the note is cleared once the log is written', () => {
    const dir = repoWith({
      'apps/server/src/api.ts': 'export const api = 1;',
      '.claude/state/progress-missing': 'from last time',
    });
    write(dir, { 'docs/progress.md': '# Progress log\n\n- built the API\n' });
    expect(check(dir).status).toBe(ALLOWED);
    expect(existsSync(marker(dir))).toBe(false);
  });
});
