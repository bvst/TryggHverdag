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

// BUG-36, review loop 1, privacy-security-reviewer: the owner's Mac file
// system ignores case, so `.CLAUDE/settings.local.json` there is the very file
// D-120 protects, and the global guard let an Edit or a Write of it through.
// The global guard matches its paths without regard to case. A role's own
// guard, which has no --global, keeps matching case exactly: on an --allow
// list, ignoring case would widen what the role may change.
const CASE_VARIANTS = [
  { file: '.CLAUDE/settings.local.json', main: 'refused', subagent: 'refused' },
  { file: '.claude/Settings.Local.json', main: 'refused', subagent: 'refused' },
  { file: '.Claude/State/gate-passed', main: 'refused', subagent: 'refused' },
];

describe('BUG-36, review loop 1: the global guard-paths ignores case in the paths D-120 protects', () => {
  // Fails today: every row is allowed, for the main session and a subagent.
  test.each(CASE_VARIANTS)(
    'BUG-36: an Edit and a Write of $file — main session $main, subagent $subagent, naming D-120',
    ({ file, main, subagent }) => {
      for (const make of [edit, writeOf]) {
        const call = make(`/repo/${file}`, 'synthetic\n');
        const args = ['--global', ...d120];
        const asMain = runHook('guard-paths.mjs', { args, input: call, cwd: '/repo' });
        const asSubagent = runHook('guard-paths.mjs', {
          args,
          input: bySubagent(call),
          cwd: '/repo',
        });

        expect({
          tool: call.tool_name,
          file,
          main: d120VerdictOf(asMain),
          subagent: d120VerdictOf(asSubagent),
        }).toEqual({ tool: call.tool_name, file, main, subagent });
      }
    },
  );

  // Fails today: allowed. Only the subagent's verdict is held: whether the
  // main session's exemption also ignores case is not what this is about.
  test('BUG-36: a subagent may not Edit or Write .Claude/State/Phase: refused, naming D-120', () => {
    for (const make of [edit, writeOf]) {
      const result = runHook('guard-paths.mjs', {
        args: ['--global', ...d120],
        input: bySubagent(make('/repo/.Claude/State/Phase', 'red:BUG-1\n')),
        cwd: '/repo',
      });

      expect({ tool: make('x').tool_name, subagent: d120VerdictOf(result) }).toEqual({
        tool: make('x').tool_name,
        subagent: 'refused',
      });
    }
  });

  // Passes today, on purpose: a role's guard keeps exact case, so test-author's
  // `--allow '**/*.test.ts'` does not take in a file whose name only looks like
  // a test to a file system that ignores case.
  test('BUG-36: a role guard keeps matching case exactly: test-author may not change journey.TEST.ts', () => {
    const result = runHook('guard-paths.mjs', {
      args: testAuthor,
      input: edit('/repo/apps/server/src/journey.TEST.ts'),
      cwd: '/repo',
    });

    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('test-author');
  });
});

// BUG-36, review loop 1, test-auditor: lib.mjs says any agent_id, even an
// empty one, is a subagent, and no test held it: a guard that tested agent_id
// for truth would hand the main session's exemption to a subagent whose
// agent_id is "". Passes today, on purpose: it is the test that kills that
// fault.
describe('BUG-36, review loop 1: an empty agent_id is still a subagent (D-120)', () => {
  test('BUG-36: with agent_id "", guard-paths refuses an Edit and a Write of .claude/state/phase, naming D-120', () => {
    for (const make of [edit, writeOf]) {
      const call = { ...make('/repo/.claude/state/phase', 'red:BUG-1\n'), agent_id: '' };
      const result = runHook('guard-paths.mjs', {
        args: ['--global', ...d120],
        input: call,
        cwd: '/repo',
      });

      expect({ tool: call.tool_name, verdict: d120VerdictOf(result) }).toEqual({
        tool: call.tool_name,
        verdict: 'refused',
      });
    }
  });
});

// BUG-36, review loop 2, test-auditor: D-120 says the global guards ignore
// case in the main session's exemption for the phase file too, and no test
// held it. Pass today, on purpose: a guard whose exemption kept exact case
// would refuse the main session's own phase step on the owner's Mac, where
// .Claude/State/Phase is the phase file.
const LOOP2_CASE_PHASE = ['.Claude/State/Phase', '.CLAUDE/STATE/PHASE'];

describe("BUG-36, review loop 2: the global guard-paths ignores case in the main session's exemption too (D-120)", () => {
  test.each(LOOP2_CASE_PHASE)(
    'BUG-36: an Edit and a Write of %s — main session allowed, subagent refused, naming D-120 (review loop 2, test-auditor)',
    (file) => {
      for (const make of [edit, writeOf]) {
        const call = make(`/repo/${file}`, 'red:BUG-1\n');
        const args = ['--global', ...d120];
        const asMain = runHook('guard-paths.mjs', { args, input: call, cwd: '/repo' });
        const asSubagent = runHook('guard-paths.mjs', {
          args,
          input: bySubagent(call),
          cwd: '/repo',
        });

        expect(
          {
            tool: call.tool_name,
            file,
            main: d120VerdictOf(asMain),
            subagent: d120VerdictOf(asSubagent),
          },
          `main session said: ${asMain.stderr}`,
        ).toEqual({ tool: call.tool_name, file, main: 'allowed', subagent: 'refused' });
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
