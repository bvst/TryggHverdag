// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
//
// BUG-36 (D-120): a tool call could change .claude/settings.local.json and the
// hooks' own records in .claude/state/, and nothing stopped it.
//
//   - settings.local.json with `"disableAllHooks": true` turns every guard in
//     this folder off, for every session after it.
//   - .claude/state/gate-passed holding the right fingerprint tells the stop
//     gate the work already passed (D-119); a subagent that writes `red:` into
//     .claude/state/phase makes the main session's stop gate run only the
//     static checks.
//
// D-120: no tool call changes settings.local.json; nothing in .claude/state/
// changes except phase; and only the main session changes phase. Claude Code
// puts agent_id in a hook's input only when a subagent made the call
// (code.claude.com/docs/en/hooks, "Common input fields"). The two existing
// guards enforce it from .claude/settings.json, the hooks every session and
// every subagent runs.
//
// So these read the PreToolUse hooks from settings.json and run them as
// Claude Code does, as the HK drills in scripts/drills.test.mjs do: each
// command through the shell, from the project folder, with the tool call on
// stdin. The guards' own option tests are in guard-paths.test.mjs and
// guard-bash.test.mjs; this file holds the wiring, so a hook line dropped or
// narrowed in settings.json cannot leave the guards tested and unused.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterAll, describe, expect, test } from 'vitest';
import { ALLOWED, BLOCKED } from './test-helpers.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const SETTINGS = path.join(REPO, '.claude', 'settings.json');

const scratch = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** Whether a matcher picks `tool`, as Claude Code reads one: everything when empty or *. */
const picks = (matcher, tool) =>
  matcher === undefined ||
  matcher === '' ||
  matcher === '*' ||
  new RegExp(`^(?:${matcher})$`).test(tool);

/** Every PreToolUse command settings.json runs for `tool`, in the order declared. */
function declaredFor(tool) {
  const settings = JSON.parse(readFileSync(SETTINGS, 'utf8'));
  return (settings.hooks?.PreToolUse ?? [])
    .filter((entry) => picks(entry.matcher, tool))
    .flatMap((entry) =>
      (entry.hooks ?? []).filter((hook) => hook.type === 'command').map((hook) => hook.command),
    );
}

/** The environment a hook gets, without the CI review job's stand-down (D-119). */
function hookEnv(extra = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: REPO, ...extra };
  delete env.TRYGGHVERDAG_REVIEW_JOB;
  return env;
}

/**
 * Runs the hooks settings.json declares for the call's tool, as Claude Code
 * runs them, for a session whose folder is `from`: the repository unless a
 * test moves the session into a subfolder. CLAUDE_PROJECT_DIR stays the
 * repository either way, as Claude Code keeps it.
 */
function runDeclared(call, from = REPO) {
  const commands = declaredFor(call.tool_name);
  if (commands.length === 0) {
    throw new Error(`settings.json declares no PreToolUse hook for ${call.tool_name}.`);
  }
  const input = JSON.stringify({
    session_id: 'bug-36',
    transcript_path: '',
    cwd: from,
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    ...call,
  });
  return commands.map((command) => {
    const run = spawnSync('sh', ['-c', command], {
      cwd: from,
      env: hookEnv(),
      input,
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (run.error) throw run.error;
    return { command, status: run.status, stderr: run.stderr ?? '' };
  });
}

/** What the hooks answered, for a failure message. */
const said = (runs) =>
  runs
    .map((run) => `${run.command}\n  exit ${String(run.status)}: ${run.stderr.trim()}`)
    .join('\n');

/** The hook that refused the call in D-120's name, if one did. */
const refusal = (runs) =>
  runs.find((run) => run.status === BLOCKED && run.stderr.includes('D-120'));

/** Whether every hook let the call through. */
const allPass = (runs) => runs.length > 0 && runs.every((run) => run.status === ALLOWED);

/** The same call made by a subagent, the only time Claude Code adds agent_id. */
const bySubagent = (call) => ({
  ...call,
  agent_id: 'synthetic-subagent-1',
  agent_type: 'implementer',
});

const CALLERS = [
  { who: 'the main session', as: (call) => call },
  { who: 'a subagent', as: bySubagent },
];

const inRepo = (file) => path.join(REPO, file);
const editOf = (file) => ({
  tool_name: 'Edit',
  tool_input: { file_path: inRepo(file), old_string: 'one', new_string: 'two' },
});
const writeOf = (file) => ({
  tool_name: 'Write',
  tool_input: { file_path: inRepo(file), content: 'synthetic\n' },
});
const notebookOf = (file) => ({
  tool_name: 'NotebookEdit',
  tool_input: { notebook_path: inRepo(file), new_source: 'synthetic' },
});
const bashOf = (command) => ({ tool_name: 'Bash', tool_input: { command } });

// ---------------------------------------------------------------------------
// Edit, Write and NotebookEdit
// ---------------------------------------------------------------------------

describe('BUG-36: the Edit, Write and NotebookEdit hooks in settings.json hold D-120', () => {
  test('BUG-36: an Edit, a Write and a NotebookEdit of .claude/settings.local.json are refused for the main session and a subagent, naming D-120 and that the owner changes it by hand', () => {
    for (const make of [editOf, writeOf, notebookOf]) {
      for (const { who, as } of CALLERS) {
        const call = as(make('.claude/settings.local.json'));
        const runs = runDeclared(call);
        const refusing = refusal(runs);

        expect(
          refusing,
          `${call.tool_name} by ${who}; the hooks answered:\n${said(runs)}`,
        ).toBeDefined();
        expect(refusing?.stderr).toContain('settings.local.json');
        expect(refusing?.stderr).toMatch(/\bowner\b/);
        expect(refusing?.stderr).toMatch(/by hand/i);
      }
    }
  });

  test('BUG-36: a Write of .claude/state/gate-passed and an Edit of .claude/state/gate-failed are refused for the main session and a subagent, naming D-120', () => {
    for (const call of [
      writeOf('.claude/state/gate-passed'),
      editOf('.claude/state/gate-failed'),
    ]) {
      for (const { who, as } of CALLERS) {
        const runs = runDeclared(as(call));

        expect(
          refusal(runs),
          `${call.tool_name} of ${call.tool_input.file_path} by ${who}; the hooks answered:\n${said(runs)}`,
        ).toBeDefined();
      }
    }
  });

  test('BUG-36: a subagent may not write .claude/state/phase: refused, naming D-120', () => {
    for (const make of [writeOf, editOf]) {
      const runs = runDeclared(bySubagent(make('.claude/state/phase')));

      expect(refusal(runs), `the hooks answered:\n${said(runs)}`).toBeDefined();
    }
  });

  test('BUG-36: the main session may write .claude/state/phase: every hook lets it through', () => {
    // Passes today, on purpose: settings.json has no path guard yet. It holds
    // that the new one leaves /feature's and /bugfix's phase step working.
    for (const make of [writeOf, editOf]) {
      const runs = runDeclared(make('.claude/state/phase'));

      expect(allPass(runs), `the hooks answered:\n${said(runs)}`).toBe(true);
    }
  });

  test('BUG-36: every other path is left alone, for the main session and a subagent: agent memory, production code, and a file outside the repository', () => {
    // Passes today, on purpose. The file outside the repository is the one
    // most likely to break: guard-paths refuses any path outside the
    // repository, which is right for a role's own guard and wrong for every
    // session, whose scratchpad and plan files live outside it. D-120 protects
    // two paths; it does not take anything else away from anyone.
    const outside = path.join(tmpdir(), 'bug-36-scratchpad', 'notes.md');
    const calls = [
      writeOf('.claude/agent-memory/x/MEMORY.md'),
      editOf('.claude/agent-memory/x/MEMORY.md'),
      writeOf('apps/server/src/worker.ts'),
      editOf('apps/server/src/worker.ts'),
      { tool_name: 'Write', tool_input: { file_path: outside, content: 'synthetic\n' } },
    ];
    for (const call of calls) {
      for (const { who, as } of CALLERS) {
        const runs = runDeclared(as(call));

        expect(
          allPass(runs),
          `${call.tool_name} of ${call.tool_input.file_path} by ${who}; the hooks answered:\n${said(runs)}`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Bash
// ---------------------------------------------------------------------------

const SETTINGS_LOCAL_COMMANDS = [
  `echo '{"disableAllHooks": true}' > .claude/settings.local.json`,
  'tee .claude/settings.local.json',
];
const STATE_COMMANDS = [
  'printf x > .claude/state/gate-passed',
  'rm .claude/state/gate-passed',
  'rm -rf .claude/state',
  'rm -rf .claude/state/',
];
const PHASE_COMMANDS = ["printf 'red:BUG-1\\n' > .claude/state/phase", 'rm .claude/state/phase'];
const READ_COMMANDS = ['cat .claude/state/phase', 'cat .claude/settings.local.json'];

describe('BUG-36: the Bash hooks in settings.json hold D-120', () => {
  test.each(SETTINGS_LOCAL_COMMANDS)(
    'BUG-36: refused for the main session and a subagent, naming D-120 and that the owner changes settings.local.json by hand: %s',
    (command) => {
      for (const { who, as } of CALLERS) {
        const runs = runDeclared(as(bashOf(command)));
        const refusing = refusal(runs);

        expect(refusing, `by ${who}; the hooks answered:\n${said(runs)}`).toBeDefined();
        expect(refusing?.stderr).toMatch(/\bowner\b/);
        expect(refusing?.stderr).toMatch(/by hand/i);
      }
    },
  );

  test.each(STATE_COMMANDS)(
    'BUG-36: refused for the main session and a subagent, naming D-120: %s',
    (command) => {
      for (const { who, as } of CALLERS) {
        const runs = runDeclared(as(bashOf(command)));

        expect(refusal(runs), `by ${who}; the hooks answered:\n${said(runs)}`).toBeDefined();
      }
    },
  );

  test.each(PHASE_COMMANDS)('BUG-36: refused for a subagent, naming D-120: %s', (command) => {
    const runs = runDeclared(bySubagent(bashOf(command)));

    expect(refusal(runs), `the hooks answered:\n${said(runs)}`).toBeDefined();
  });

  // Passes today, on purpose: it holds that the main session keeps its phase step.
  test.each(PHASE_COMMANDS)('BUG-36: allowed for the main session: %s', (command) => {
    const runs = runDeclared(bashOf(command));

    expect(allPass(runs), `the hooks answered:\n${said(runs)}`).toBe(true);
  });

  // Passes today, on purpose: reading stays allowed for everyone.
  test.each(READ_COMMANDS)(
    'BUG-36: allowed for the main session and a subagent, because it only reads: %s',
    (command) => {
      for (const { who, as } of CALLERS) {
        const runs = runDeclared(as(bashOf(command)));

        expect(allPass(runs), `by ${who}; the hooks answered:\n${said(runs)}`).toBe(true);
      }
    },
  );
});

// A redirect with no space after `>` writes to its target all the same. The
// guard split the command on whitespace, so it saw `>.claude/state/gate-passed`,
// which no deny glob matches, and let the write through for everyone.
const NO_SPACE_COMMANDS = [
  'printf x >.claude/state/gate-passed',
  `echo '{"disableAllHooks": true}' >.claude/settings.local.json`,
  'printf x>>.claude/state/gate-passed',
];
const NO_SPACE_PHASE_COMMANDS = ["printf 'red:BUG-1\\n' >.claude/state/phase"];

describe('BUG-36: the Bash hooks in settings.json judge a redirect with no space by its target', () => {
  test.each(NO_SPACE_COMMANDS)(
    'BUG-36: a redirect with no space is refused for the main session and a subagent, naming D-120: %s',
    (command) => {
      for (const { who, as } of CALLERS) {
        const runs = runDeclared(as(bashOf(command)));

        expect(refusal(runs), `by ${who}; the hooks answered:\n${said(runs)}`).toBeDefined();
      }
    },
  );

  test.each(NO_SPACE_PHASE_COMMANDS)(
    'BUG-36: a redirect with no space into phase is refused for a subagent, naming D-120: %s',
    (command) => {
      const runs = runDeclared(bySubagent(bashOf(command)));

      expect(refusal(runs), `the hooks answered:\n${said(runs)}`).toBeDefined();
    },
  );

  // Passes today, on purpose: the main session keeps its phase step.
  test.each(NO_SPACE_PHASE_COMMANDS)(
    'BUG-36: a redirect with no space into phase is allowed for the main session: %s',
    (command) => {
      const runs = runDeclared(bashOf(command));

      expect(allPass(runs), `the hooks answered:\n${said(runs)}`).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// Review loop 1: the folder itself, and punctuation stuck to a path
// ---------------------------------------------------------------------------

// BUG-36, review loop 1, privacy-security-reviewer. A copy into the .claude
// folder (`cp /tmp/s/settings.local.json .claude/`) lands on
// settings.local.json without naming it, and `rm -rf .claude` removes both of
// D-120's paths; neither matches a glob settings.json passes today. And the
// guard keeps shell punctuation stuck to a path, so `rm
// .claude/settings.local.json; echo done` names `.claude/settings.local.json;`,
// which no glob matches either. guard-bash.test.mjs holds the guard's side;
// these hold that settings.json, as Claude Code runs it, refuses them.
const LOOP1_FOLDER_COMMANDS = ['cp /tmp/s/settings.local.json .claude/', 'rm -rf .claude'];
const LOOP1_PUNCTUATION_COMMANDS = [
  'rm .claude/settings.local.json; echo done',
  '(rm .claude/settings.local.json)',
  'rm -rf .claude/state; echo ok',
];
const LOOP1_UNPROTECTED_COMMANDS = [
  'rm .claude/agent-memory/x.md',
  'rm .claude/agents/x.md',
  'cp /tmp/x .claude/agents/x.md; echo ok',
];

describe('BUG-36, review loop 1: the Bash hooks in settings.json refuse a write into the .claude folder itself and a path with punctuation stuck to it', () => {
  // Fails today: no hook refuses it, for the main session or a subagent.
  test.each(LOOP1_FOLDER_COMMANDS)(
    'BUG-36: refused for the main session and a subagent, naming D-120: %s',
    (command) => {
      for (const { who, as } of CALLERS) {
        const runs = runDeclared(as(bashOf(command)));

        expect(refusal(runs), `by ${who}; the hooks answered:\n${said(runs)}`).toBeDefined();
      }
    },
  );

  // Fails today: no hook refuses it, for the main session or a subagent.
  test.each(LOOP1_PUNCTUATION_COMMANDS)(
    'BUG-36: with punctuation stuck to the path, refused for the main session and a subagent, naming D-120: %s',
    (command) => {
      for (const { who, as } of CALLERS) {
        const runs = runDeclared(as(bashOf(command)));

        expect(refusal(runs), `by ${who}; the hooks answered:\n${said(runs)}`).toBeDefined();
      }
    },
  );

  // Passes today, on purpose: naming the folder itself must not take agent
  // memory or the agents' own files away from anyone. Those are not D-120's.
  test.each(LOOP1_UNPROTECTED_COMMANDS)(
    'BUG-36: allowed for the main session and a subagent, because it names no path D-120 protects: %s',
    (command) => {
      for (const { who, as } of CALLERS) {
        const runs = runDeclared(as(bashOf(command)));

        expect(allPass(runs), `by ${who}; the hooks answered:\n${said(runs)}`).toBe(true);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// From a subfolder
// ---------------------------------------------------------------------------

// BUG-36 (D-120): a session that has moved into apps/server still has the
// repository's .claude/state/ and settings.local.json to protect. Relative to
// its folder those are ../../.claude/…, which no deny glob matches, and the
// global guards leave a path outside their folder alone, so from there every
// write below got through. The guards judge a path from the repository,
// CLAUDE_PROJECT_DIR, whatever folder the session is in; a relative path
// still starts from the session's folder, where the write would land.
const SUBFOLDER = path.join(REPO, 'apps', 'server');

/** `file` as the session in apps/server can name it: absolute, and relative to its folder. */
const bothWays = (file) => [inRepo(file), path.relative(SUBFOLDER, inRepo(file))];

/** A Write and an Edit of `target`, exactly as named. */
const writeAndEditOf = (target) => [
  { tool_name: 'Write', tool_input: { file_path: target, content: 'synthetic\n' } },
  { tool_name: 'Edit', tool_input: { file_path: target, old_string: 'one', new_string: 'two' } },
];

/** `command` with <repo> put back as the repository's absolute path. */
const inRepoCommand = (command) => command.replaceAll('<repo>', REPO);

describe('BUG-36: from a subfolder, the Edit and Write hooks in settings.json still hold D-120', () => {
  test('BUG-36: from apps/server, a Write and an Edit of .claude/state/gate-passed and .claude/settings.local.json, by absolute and by relative path, are refused for the main session and a subagent, naming D-120', () => {
    for (const file of ['.claude/state/gate-passed', '.claude/settings.local.json']) {
      for (const target of bothWays(file)) {
        for (const call of writeAndEditOf(target)) {
          for (const { who, as } of CALLERS) {
            const runs = runDeclared(as(call), SUBFOLDER);

            expect(
              refusal(runs),
              `${call.tool_name} of ${target} from apps/server by ${who}; the hooks answered:\n${said(runs)}`,
            ).toBeDefined();
          }
        }
      }
    }
  });

  test('BUG-36: from apps/server, a subagent may not write .claude/state/phase by absolute or relative path: refused, naming D-120', () => {
    for (const target of bothWays('.claude/state/phase')) {
      for (const call of writeAndEditOf(target)) {
        const runs = runDeclared(bySubagent(call), SUBFOLDER);

        expect(
          refusal(runs),
          `${call.tool_name} of ${target} from apps/server; the hooks answered:\n${said(runs)}`,
        ).toBeDefined();
      }
    }
  });

  test('BUG-36: from apps/server, the main session may write .claude/state/phase by absolute or relative path, and a file outside the repository is left alone for both: every hook lets it through', () => {
    // Passes today, on purpose: it holds that judging from the repository
    // keeps the main session's phase step, and takes nothing outside the
    // repository away from anyone.
    for (const target of bothWays('.claude/state/phase')) {
      for (const call of writeAndEditOf(target)) {
        const runs = runDeclared(call, SUBFOLDER);

        expect(
          allPass(runs),
          `${call.tool_name} of ${target} from apps/server; the hooks answered:\n${said(runs)}`,
        ).toBe(true);
      }
    }
    const outside = path.join(tmpdir(), 'bug-36-scratchpad', 'notes.md');
    for (const call of writeAndEditOf(outside)) {
      for (const { who, as } of CALLERS) {
        const runs = runDeclared(as(call), SUBFOLDER);

        expect(
          allPass(runs),
          `${call.tool_name} of ${outside} from apps/server by ${who}; the hooks answered:\n${said(runs)}`,
        ).toBe(true);
      }
    }
  });
});

// <repo> is the repository's absolute path, put back when the test runs.
const FROM_SUBFOLDER_REFUSED = [
  'printf x > ../../.claude/state/gate-passed',
  'printf x > <repo>/.claude/state/gate-passed',
  `echo '{"disableAllHooks": true}' > ../../.claude/settings.local.json`,
  `echo '{"disableAllHooks": true}' > <repo>/.claude/settings.local.json`,
];
const FROM_SUBFOLDER_PHASE = [
  "printf 'red:BUG-1\\n' > ../../.claude/state/phase",
  "printf 'red:BUG-1\\n' > <repo>/.claude/state/phase",
];

describe('BUG-36: from a subfolder, the Bash hooks in settings.json still hold D-120', () => {
  test.each(FROM_SUBFOLDER_REFUSED)(
    'BUG-36: from apps/server, refused for the main session and a subagent, naming D-120: %s',
    (command) => {
      for (const { who, as } of CALLERS) {
        const runs = runDeclared(as(bashOf(inRepoCommand(command))), SUBFOLDER);

        expect(refusal(runs), `by ${who}; the hooks answered:\n${said(runs)}`).toBeDefined();
      }
    },
  );

  test.each(FROM_SUBFOLDER_PHASE)(
    'BUG-36: from apps/server, refused for a subagent, naming D-120: %s',
    (command) => {
      const runs = runDeclared(bySubagent(bashOf(inRepoCommand(command))), SUBFOLDER);

      expect(refusal(runs), `the hooks answered:\n${said(runs)}`).toBeDefined();
    },
  );

  // Passes today, on purpose: the main session keeps its phase step.
  test.each(FROM_SUBFOLDER_PHASE)(
    'BUG-36: from apps/server, allowed for the main session: %s',
    (command) => {
      const runs = runDeclared(bashOf(inRepoCommand(command)), SUBFOLDER);

      expect(allPass(runs), `the hooks answered:\n${said(runs)}`).toBe(true);
    },
  );

  // Passes today, on purpose: a path outside the repository is left alone.
  test('BUG-36: from apps/server, a write outside the repository is allowed for the main session and a subagent', () => {
    const outside = path.join(tmpdir(), 'bug-36-scratchpad', 'notes.md');
    for (const { who, as } of CALLERS) {
      const runs = runDeclared(as(bashOf(`printf x > ${outside}`)), SUBFOLDER);

      expect(allPass(runs), `by ${who}; the hooks answered:\n${said(runs)}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The wiring: which guard settings.json runs, with which arguments
// ---------------------------------------------------------------------------

/**
 * The arguments a declared command hands to node, as the shell expands them.
 *
 * A stand-in `node` first on PATH prints its arguments instead of running the
 * guard. It runs in a scratch folder that holds .claude/state/gate-passed and
 * .claude/state/phase, as a session's folder does, so a glob left unquoted in
 * settings.json is expanded by the shell here too, rather than reaching the
 * guard as written.
 *
 * The stand-in reads no input, so it gets none: stdin is /dev/null. Sending
 * it the hook's JSON raced the stand-in's exit, and when the stand-in won,
 * spawnSync threw EPIPE (RG-06). What the shell hands to node does not
 * depend on stdin.
 */
function argvOf(command) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bug-36-argv-'));
  scratch.push(dir);
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'node'), '#!/bin/sh\nprintf \'%s\\0\' "$@"\n', { mode: 0o755 });
  const folder = path.join(dir, 'session');
  mkdirSync(path.join(folder, '.claude', 'state'), { recursive: true });
  writeFileSync(path.join(folder, '.claude', 'state', 'gate-passed'), 'synthetic\n');
  writeFileSync(path.join(folder, '.claude', 'state', 'phase'), 'red:BUG-1\n');
  const run = spawnSync('sh', ['-c', command], {
    cwd: folder,
    env: hookEnv({ PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` }),
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (run.error) throw run.error;
  return run.stdout.split('\0').slice(0, -1);
}

/** Every value given to `flag`. */
const valuesOf = (argv, flag) =>
  argv.flatMap((arg, at) => (arg === flag && at + 1 < argv.length ? [argv[at + 1]] : []));

/** The argument lists of every `script` hook settings.json runs for `tool`. */
const guardsFor = (tool, script) =>
  declaredFor(tool)
    .map(argvOf)
    .filter((argv) => argv[0]?.endsWith(`/.claude/hooks/${script}`));

describe('BUG-36: settings.json runs the two guards with the arguments D-120 gives them', () => {
  test.each(['Edit', 'Write', 'NotebookEdit'])(
    'BUG-36: for %s, guard-paths runs with --deny .claude/settings.local.json, --deny .claude/state/** and --allow-main-session .claude/state/phase alone',
    (tool) => {
      const found = guardsFor(tool, 'guard-paths.mjs').map((argv) => ({
        deny: valuesOf(argv, '--deny'),
        allowMainSession: valuesOf(argv, '--allow-main-session'),
      }));

      expect(found, `guard-paths as settings.json runs it for ${tool}`).toContainEqual({
        deny: expect.arrayContaining(['.claude/settings.local.json', '.claude/state/**']),
        allowMainSession: ['.claude/state/phase'],
      });
    },
  );

  // RG-03, BUG-36 review loop 1: this test now also expects `.claude`, the
  // folder itself, among the Bash guard's --deny-write-glob values, and its
  // name says so. privacy-security-reviewer found that `cp … .claude/` and
  // `rm -rf .claude` change what D-120 protects while matching none of the
  // three globs; D-120's fix names the folder exactly. Stricter, not looser:
  // the three globs it held before are all still required.
  test('BUG-36: for Bash, guard-bash runs with --deny-write-glob for .claude/settings.local.json, .claude/state/**, .claude/state itself and the .claude folder itself, and --allow-main-session .claude/state/phase alone', () => {
    const found = guardsFor('Bash', 'guard-bash.mjs').map((argv) => ({
      denyWrite: valuesOf(argv, '--deny-write-glob'),
      allowMainSession: valuesOf(argv, '--allow-main-session'),
    }));

    expect(found, 'guard-bash as settings.json runs it for Bash').toContainEqual({
      denyWrite: expect.arrayContaining([
        '.claude/settings.local.json',
        '.claude/state/**',
        '.claude/state',
        '.claude',
      ]),
      allowMainSession: ['.claude/state/phase'],
    });
  });

  test("BUG-36: the stand-in reads settings.json's arguments: the global Bash guard is found with --global", () => {
    // Passes today, on purpose. It shows argvOf reads what settings.json
    // declares, so the two tests above fail on missing arguments, not on a
    // helper that finds nothing.
    expect(guardsFor('Bash', 'guard-bash.mjs').some((argv) => argv.includes('--global'))).toBe(
      true,
    );
  });
});
