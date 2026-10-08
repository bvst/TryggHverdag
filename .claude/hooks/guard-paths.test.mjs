// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-02: separation of duties. The agent that writes code cannot touch tests,
// and the agent that writes tests cannot touch production code (RG-03).
import { describe, expect, test } from 'vitest';
import { ALLOWED, BLOCKED, edit, runHook } from './test-helpers.mjs';

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
