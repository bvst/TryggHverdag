// HK-01: a new session starts by being told where the work stands. Sessions are
// short and there are many of them, so this is what keeps them in step.
import { afterEach, describe, expect, test } from 'vitest';
import { ALLOWED, makeRepo, removeRepo, runHook, write } from './test-helpers.mjs';

const README = `# Planning hub

**Current section:** milestone M0 — foundations

| ID | Action | Why | Status |
|----|--------|-----|--------|
| A-09 | Run \`claude setup-token\` and save it as a repository secret | AI reviews | ⬜ Open |
| A-04 | Create a Clever Cloud account | Hosting | ✅ Done |
`;

const repos = [];
function repoWith(extra = {}) {
  const dir = makeRepo({ 'docs/plan/README.md': README });
  repos.push(dir);
  write(dir, extra);
  return dir;
}

afterEach(() => {
  while (repos.length > 0) {
    removeRepo(repos.pop());
  }
});

describe('HK-01: what a session is told at the start', () => {
  test('where the plan stands', () => {
    const result = runHook('session-start.mjs', { cwd: repoWith() });
    expect(result.status).toBe(ALLOWED);
    expect(result.stdout).toContain('milestone M0');
  });

  test('which branch it is on', () => {
    expect(runHook('session-start.mjs', { cwd: repoWith() }).stdout).toContain('Branch: main');
  });

  test('the owner to-dos that are still open, and not the finished ones', () => {
    const output = runHook('session-start.mjs', { cwd: repoWith() }).stdout;
    expect(output).toContain('A-09');
    expect(output).not.toContain('A-04');
  });
});

describe('HK-01: unfinished business from the last session', () => {
  test('a red-phase marker is shown, so failing tests are not mistaken for a broken build', () => {
    const dir = repoWith({ '.claude/state/phase': 'red:LOST-02' });
    const output = runHook('session-start.mjs', { cwd: dir }).stdout;
    expect(output).toContain('Red-phase marker');
    expect(output).toContain('LOST-02');
  });

  test('a gate that was left failing is shown loudly', () => {
    const dir = repoWith({
      '.claude/state/gate-failed': '2026-09-20 gate:quick failed\n2 tests failed',
    });
    const output = runHook('session-start.mjs', { cwd: dir }).stdout;
    expect(output).toContain('stop gate FAILED');
    expect(output).toContain('2 tests failed');
  });

  test('and a clean session is not given false alarms', () => {
    expect(runHook('session-start.mjs', { cwd: repoWith() }).stdout).not.toContain('⚠');
  });
});
