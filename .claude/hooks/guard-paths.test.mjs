// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-02: separation of duties. The agent that writes code cannot touch tests,
// and the agent that writes tests cannot touch production code (RG-03).
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { afterAll, describe, expect, test } from 'vitest';
import {
  ALLOWED,
  BLOCKED,
  HOOKS_DIR,
  edit,
  makeDir,
  removeRepo,
  runHook,
} from './test-helpers.mjs';

const implementer = [
  '--agent',
  'implementer',
  '--deny',
  '**/*.test.ts',
  '--deny',
  '**/*.test.mjs',
  '--deny',
  'packages/test-kit/**',
];
const testAuthor = [
  '--agent',
  'test-author',
  '--allow',
  '**/*.test.ts',
  '--allow',
  'packages/test-kit/**',
];

describe('HK-02: implementer may not change tests', () => {
  test('blocks a test file and says why', () => {
    const result = runHook('guard-paths.mjs', {
      args: implementer,
      input: edit('/repo/apps/server/src/journey.test.ts'),
      cwd: '/repo',
    });
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('RG-03');
    expect(result.stderr).toContain('journey.test.ts');
  });

  test('blocks the test kit, where the fakes live', () => {
    const result = runHook('guard-paths.mjs', {
      args: implementer,
      input: edit('/repo/packages/test-kit/src/fake-clock.ts'),
      cwd: '/repo',
    });
    expect(result.status).toBe(BLOCKED);
  });

  test('allows production code, which is its job', () => {
    const result = runHook('guard-paths.mjs', {
      args: implementer,
      input: edit('/repo/apps/server/src/domain/journey.ts'),
      cwd: '/repo',
    });
    expect(result.status).toBe(ALLOWED);
  });
});

describe('HK-02: test-author may only change tests', () => {
  test('allows a test file', () => {
    const result = runHook('guard-paths.mjs', {
      args: testAuthor,
      input: edit('/repo/apps/server/src/journey.test.ts'),
      cwd: '/repo',
    });
    expect(result.status).toBe(ALLOWED);
  });

  test('blocks production code and names what it may change', () => {
    const result = runHook('guard-paths.mjs', {
      args: testAuthor,
      input: edit('/repo/apps/server/src/domain/journey.ts'),
      cwd: '/repo',
    });
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('test-author');
  });
});

describe('HK-02: anything outside the repository', () => {
  test('is blocked for every role', () => {
    const result = runHook('guard-paths.mjs', {
      args: implementer,
      input: edit('/etc/passwd'),
      cwd: '/repo',
    });
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('outside the repository');
  });
});

// BUG-36 (D-120): `--allow-main-session <glob>` exempts a path from the deny
// globs when the call comes from the main session. Claude Code puts agent_id
// in a hook's input only when a subagent made the call
// (code.claude.com/docs/en/hooks, "Common input fields"), so its absence is
// what marks the main session. These are the arguments D-120 gives the guard
// in .claude/settings.json; settings-hooks.test.mjs holds that settings.json
// passes them, and runs the hooks as declared there. Why it matters:
// `"disableAllHooks": true` in settings.local.json turns every guard in this
// folder off; a gate-passed holding the right fingerprint tells the stop gate
// the work already passed; and `red:` in phase makes the main session's stop
// gate run only the static checks.
const d120 = [
  '--deny',
  '.claude/settings.local.json',
  '--deny',
  '.claude/state/**',
  '--allow-main-session',
  '.claude/state/phase',
];

/** A Write of `file`, as Claude Code reports it. */
const writeOf = (file, content = '') => ({
  tool_name: 'Write',
  tool_input: { file_path: file, content },
});

/** The same call made by a subagent, which is the only time Claude Code adds agent_id. */
const bySubagent = (call) => ({
  ...call,
  agent_id: 'synthetic-subagent-1',
  agent_type: 'implementer',
});

const D120_FILES = [
  { file: '.claude/settings.local.json', main: 'refused', subagent: 'refused' },
  { file: '.claude/state/gate-passed', main: 'refused', subagent: 'refused' },
  { file: '.claude/state/gate-failed', main: 'refused', subagent: 'refused' },
  { file: '.claude/state/phase', main: 'allowed', subagent: 'refused' },
  { file: '.claude/agent-memory/x/MEMORY.md', main: 'allowed', subagent: 'allowed' },
  { file: 'apps/server/src/worker.ts', main: 'allowed', subagent: 'allowed' },
];

const verdictOf = (result) => {
  if (result.status === BLOCKED) return 'refused';
  return result.status === ALLOWED ? 'allowed' : `exit ${String(result.status)}`;
};

describe('BUG-36: guard-paths exempts .claude/state/phase for the main session only (D-120)', () => {
  // Only the phase row fails today: --deny already refuses the other protected
  // rows, and nothing exempts phase yet. The other rows pass on purpose. They
  // hold that the new option exempts the one path it names and nothing else,
  // and only when no agent_id is present.
  test.each(D120_FILES)(
    'BUG-36: an Edit and a Write of $file — main session $main, subagent $subagent',
    ({ file, main, subagent }) => {
      for (const make of [edit, writeOf]) {
        const call = make(`/repo/${file}`, 'synthetic\n');
        const asMain = runHook('guard-paths.mjs', { args: d120, input: call, cwd: '/repo' });
        const asSubagent = runHook('guard-paths.mjs', {
          args: d120,
          input: bySubagent(call),
          cwd: '/repo',
        });

        expect(
          {
            tool: call.tool_name,
            file,
            main: verdictOf(asMain),
            subagent: verdictOf(asSubagent),
          },
          `main session said: ${asMain.stderr}\nsubagent said: ${asSubagent.stderr}`,
        ).toEqual({ tool: call.tool_name, file, main, subagent });
      }
    },
  );
});

// BUG-36 (D-120): the global guard judges a path by where it is in the
// repository, whatever folder the session is in. A session that has moved
// into apps/server still has the repository's .claude/state/ to protect, but
// relative to that folder <repo>/.claude/state/gate-passed is
// ../../.claude/state/gate-passed, which no deny glob matches, and the global
// guard no longer refuses a path outside its folder. The repository is
// CLAUDE_PROJECT_DIR, which Claude Code sets for every hook
// (code.claude.com/docs/en/hooks). Relative paths still start from the
// session's folder: that is where the write would land.
//
// A real scratch project, so the guard's process can run in the subfolder as
// Claude Code would run it, whether the guard reads the input's cwd or its own.
const project = realpathSync(makeDir({ 'apps/server/.keep': '' }));
const outside = realpathSync(makeDir());
const subfolder = path.join(project, 'apps', 'server');
afterAll(() => {
  removeRepo(project);
  removeRepo(outside);
});

/**
 * Runs guard-paths as Claude Code does for a session that has moved into
 * apps/server: that folder is the process's and the input's cwd, and
 * CLAUDE_PROJECT_DIR is the project.
 */
function fromSubfolder(args, input) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: project };
  delete env.TRYGGHVERDAG_REVIEW_JOB;
  const result = spawnSync(process.execPath, [path.join(HOOKS_DIR, 'guard-paths.mjs'), ...args], {
    input: JSON.stringify({ cwd: subfolder, ...input }),
    cwd: subfolder,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, stderr: result.stderr ?? '' };
}

/** A refusal counts only in D-120's words: any other block is shown as it is. */
const d120VerdictOf = (result) => {
  if (result.status === BLOCKED && result.stderr.includes('D-120')) return 'refused';
  if (result.status === ALLOWED) return 'allowed';
  return `exit ${String(result.status)}: ${result.stderr.trim()}`;
};

// <repo> is the project, <outside> a folder beside it; the rest is relative
// to apps/server.
const FROM_SUBFOLDER = [
  { file: '<repo>/.claude/state/gate-passed', main: 'refused', subagent: 'refused' },
  { file: '../../.claude/state/gate-passed', main: 'refused', subagent: 'refused' },
  { file: '<repo>/.claude/settings.local.json', main: 'refused', subagent: 'refused' },
  { file: '../../.claude/settings.local.json', main: 'refused', subagent: 'refused' },
  { file: '<repo>/.claude/state/phase', main: 'allowed', subagent: 'refused' },
  { file: '../../.claude/state/phase', main: 'allowed', subagent: 'refused' },
  { file: 'src/worker.ts', main: 'allowed', subagent: 'allowed' },
  { file: '<outside>/notes.md', main: 'allowed', subagent: 'allowed' },
];

describe('BUG-36: the global guard-paths judges a path from the repository, not from the folder the session is in (D-120)', () => {
  // The four protected rows and both phase rows fail today: from apps/server
  // every one of them is let through, for a subagent too. The last two pass
  // on purpose: production code in the subfolder, and a path outside the
  // repository, are still left alone.
  test.each(FROM_SUBFOLDER)(
    'BUG-36: from apps/server, an Edit and a Write of $file — main session $main, subagent $subagent',
    ({ file, main, subagent }) => {
      const target = file.replace('<repo>', project).replace('<outside>', outside);
      for (const make of [edit, writeOf]) {
        const call = make(target, 'synthetic\n');
        const asMain = fromSubfolder(['--global', ...d120], call);
        const asSubagent = fromSubfolder(['--global', ...d120], bySubagent(call));

        expect({
          tool: call.tool_name,
          file,
          main: d120VerdictOf(asMain),
          subagent: d120VerdictOf(asSubagent),
        }).toEqual({ tool: call.tool_name, file, main, subagent });
      }
    },
  );
});

describe('HK-02: tools that do not touch a file', () => {
  test('pass straight through', () => {
    const result = runHook('guard-paths.mjs', {
      args: implementer,
      input: { tool_name: 'Bash', tool_input: { command: 'pnpm run test:unit' } },
      cwd: '/repo',
    });
    expect(result.status).toBe(ALLOWED);
  });
});
