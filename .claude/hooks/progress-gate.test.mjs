// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-08: a session that changed code must say so in docs/progress.md. Without
// this, the next session starts by guessing what the last one did.
import { afterEach, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  ALLOWED,
  BLOCKED,
  HOOKS_DIR,
  makeRepo,
  removeRepo,
  runHook,
  write,
} from './test-helpers.mjs';

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

// BUG-31, part 2 (D-119): the AI reviews in CI load the project's settings, so
// the progress gate ran inside every review job as well as the stop gate. With
// both GITHUB_ACTIONS=true and TRYGGHVERDAG_REVIEW_JOB=1 the hook stands down
// at once: it does not refuse, and it leaves no note. With only one of them it
// behaves exactly as before. stop-gate.test.mjs holds the same tests for the
// stop gate.

/**
 * Runs the progress gate with the two CI variables exactly as `ci` says.
 * runHook passes this process's environment through and takes no env of its
 * own, and these tests themselves run in GitHub Actions, where
 * GITHUB_ACTIONS=true is already set — so both are removed first and only then
 * set, in every case.
 */
function checkIn(dir, ci, { input = {}, args = [] } = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  delete env.GITHUB_ACTIONS;
  delete env.TRYGGHVERDAG_REVIEW_JOB;
  Object.assign(env, ci);
  const result = spawnSync(process.execPath, [path.join(HOOKS_DIR, 'progress-gate.mjs'), ...args], {
    input: JSON.stringify({ cwd: dir, ...input }),
    encoding: 'utf8',
    cwd: dir,
    timeout: 120_000,
    env,
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const REVIEW_JOB = { GITHUB_ACTIONS: 'true', TRYGGHVERDAG_REVIEW_JOB: '1' };

describe('BUG-31: the progress gate stands down in a CI review job (D-119)', () => {
  // Each row is one of the three ways the hook can end today on unlogged code:
  // refusing, or (with --warn-only, or once already asked to continue)
  // writing .claude/state/progress-missing. In a review job none of them may
  // happen.
  test.each([
    { how: 'at a stop', args: [], input: {} },
    { how: 'with --warn-only', args: ['--warn-only'], input: {} },
    { how: 'after being asked to continue once', args: [], input: { stop_hook_active: true } },
  ])(
    'BUG-31: with GITHUB_ACTIONS=true and TRYGGHVERDAG_REVIEW_JOB=1, $how, code changed without the progress log is not refused and no note is written',
    ({ args, input }) => {
      const dir = repoWith({ 'apps/server/src/api.ts': 'export const api = 1;' });

      const result = checkIn(dir, REVIEW_JOB, { args, input });

      expect(result.status).toBe(ALLOWED);
      expect(existsSync(marker(dir))).toBe(false);
    },
  );

  // Pass today, and are meant to: they are the guard that one variable alone —
  // GITHUB_ACTIONS is set in every CI job, not only the reviews — never turns
  // the gate off, and that the review-job switch has to say 1.
  test.each([
    { how: 'only GITHUB_ACTIONS=true', ci: { GITHUB_ACTIONS: 'true' } },
    { how: 'only TRYGGHVERDAG_REVIEW_JOB=1', ci: { TRYGGHVERDAG_REVIEW_JOB: '1' } },
    {
      how: 'GITHUB_ACTIONS=true and TRYGGHVERDAG_REVIEW_JOB=0',
      ci: { GITHUB_ACTIONS: 'true', TRYGGHVERDAG_REVIEW_JOB: '0' },
    },
  ])('BUG-31: with $how, code changed without the progress log is refused, as before', ({ ci }) => {
    const dir = repoWith({ 'apps/server/src/api.ts': 'export const api = 1;' });

    const result = checkIn(dir, ci);

    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('HK-08');
    expect(result.stderr).toContain('docs/progress.md');
  });
});

// BUG-31, part 3 (D-119): ai-review.yml sets TRYGGHVERDAG_REVIEW_JOB=1 on the
// whole review step, so every command a CI reviewer runs inherits it, together
// with GITHUB_ACTIONS=true. A reviewer that runs these tests there
// (`pnpm run test:hooks`, `test:unit`) must see the same results as anywhere
// else: if runHook passed the two variables on, the hook would stand down and
// every test above that expects a refusal would fail — a false finding put in
// front of a blocking reviewer. The tests that want the stand-down build their
// own environment (checkIn); runHook must not hand it to the rest.
// stop-gate.test.mjs holds the same test for the stop gate.

/**
 * Runs `run` with this process's environment as a CI review job has it, then
 * puts both variables back exactly as they were — deleted if they were absent,
 * because assigning `undefined` to process.env stores the string "undefined".
 */
function asInAReviewJob(run) {
  const before = Object.fromEntries(
    Object.keys(REVIEW_JOB).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, REVIEW_JOB);
  try {
    return run();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

describe("BUG-31: the hook tests do not inherit a CI review job's stand-down (D-119)", () => {
  test("BUG-31: the hook tests do not inherit a CI review job's stand-down: with the review job's variables in the test's own environment, code changed without the progress log is still refused", () => {
    const dir = repoWith({ 'apps/server/src/api.ts': 'export const api = 1;' });

    const result = asInAReviewJob(() => check(dir));

    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('HK-08');
    expect(result.stderr).toContain('docs/progress.md');
  });
});

// BUG-36, review loop 1, privacy-security-reviewer: D-120's guards protect the
// repository's .claude/state/, named from CLAUDE_PROJECT_DIR, which Claude
// Code sets for every hook; session-start.mjs reads this gate's note from
// there. The progress gate took its note's folder, and the repository it
// checks, from the folder the session is in, the input's cwd: from
// apps/server it wrote apps/server/.claude/state/progress-missing, which
// session-start never reads, and saw only the untracked files under
// apps/server. The progress gate uses CLAUDE_PROJECT_DIR when it is set, else
// the input's cwd, for both. stop-gate.test.mjs holds the same for the stop gate.

const SUBFOLDER = 'apps/server';

/** A repository with a progress log and an apps/server package of its own, then `files` on top, uncommitted. */
function projectWith(files = {}) {
  const dir = makeRepo({
    'docs/progress.md': '# Progress log\n',
    [`${SUBFOLDER}/package.json`]: '{ "name": "server", "private": true }\n',
  });
  repos.push(dir);
  write(dir, files);
  return dir;
}

/**
 * Runs the progress gate as Claude Code does for a session whose folder is
 * `folder`: the input's cwd, and the process's unless `processIn` says
 * otherwise. CLAUDE_PROJECT_DIR is `project`, or unset when `project` is null.
 */
function checkFrom({ folder, project, processIn = folder, input = {}, args = [] }) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: project ?? '' };
  if (project === null) {
    delete env.CLAUDE_PROJECT_DIR;
  }
  delete env.TRYGGHVERDAG_REVIEW_JOB;
  const result = spawnSync(process.execPath, [path.join(HOOKS_DIR, 'progress-gate.mjs'), ...args], {
    input: JSON.stringify({ cwd: folder, ...input }),
    encoding: 'utf8',
    cwd: processIn,
    timeout: 120_000,
    env,
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

describe('BUG-36, review loop 1: from a subfolder, the progress gate keeps its note in the repository and checks the repository (HK-08, D-120)', () => {
  // Fails today: the note goes to apps/server/.claude/state/.
  test("BUG-36: from a subfolder, the note goes to the repository's .claude/state/, not the subfolder's", () => {
    const dir = projectWith({ 'apps/server/src/api.ts': 'export const api = 1;' });
    const sub = path.join(dir, SUBFOLDER);

    const result = checkFrom({ folder: sub, project: dir, args: ['--warn-only'] });

    expect(result.status).toBe(ALLOWED);
    expect({ repository: existsSync(marker(dir)), subfolder: existsSync(marker(sub)) }).toEqual({
      repository: true,
      subfolder: false,
    });
  });

  // Fails today: the gate clears apps/server's note, and the repository's stays.
  test("BUG-36: from a subfolder, the repository's note is cleared once the log is written", () => {
    const dir = projectWith({
      'apps/server/src/api.ts': 'export const api = 1;',
      '.claude/state/progress-missing': 'from last time',
    });
    write(dir, { 'docs/progress.md': '# Progress log\n\n- built the API\n' });
    const sub = path.join(dir, SUBFOLDER);

    const result = checkFrom({ folder: sub, project: dir });

    expect(result.status, result.stderr).toBe(ALLOWED);
    expect(existsSync(marker(dir))).toBe(false);
  });

  // Fails today: from apps/server, git lists only the untracked files under
  // apps/server, so the new milestone log is not seen and the gate refuses.
  test('BUG-36: from a subfolder, a new milestone log outside the subfolder counts as the work written down', () => {
    const dir = projectWith({
      'apps/server/src/api.ts': 'export const api = 1;',
      'docs/progress/m1.md': '# M1 build log\n\n- built the API\n',
    });
    const sub = path.join(dir, SUBFOLDER);

    const result = checkFrom({ folder: sub, project: dir });

    expect(result.status, result.stderr).toBe(ALLOWED);
  });

  // Fails today: the code change outside apps/server is not seen, so nothing
  // is refused.
  test('BUG-36: from a subfolder, code changed outside the subfolder without a word about it is refused', () => {
    const dir = projectWith({ 'packages/contracts/src/journey.ts': 'export const c = 1;' });
    const sub = path.join(dir, SUBFOLDER);

    const result = checkFrom({ folder: sub, project: dir });

    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('HK-08');
  });

  // Passes today, on purpose: without CLAUDE_PROJECT_DIR the input's cwd
  // stands in, not the folder the hook's process happens to run in.
  test("BUG-36: without CLAUDE_PROJECT_DIR, the input's cwd is the repository, not the process's folder", () => {
    const dir = projectWith({ 'packages/contracts/src/journey.ts': 'export const c = 1;' });
    const sub = path.join(dir, SUBFOLDER);

    const result = checkFrom({ folder: dir, project: null, processIn: sub, args: ['--warn-only'] });

    expect(result.status).toBe(ALLOWED);
    expect({ repository: existsSync(marker(dir)), subfolder: existsSync(marker(sub)) }).toEqual({
      repository: true,
      subfolder: false,
    });
  });
});
