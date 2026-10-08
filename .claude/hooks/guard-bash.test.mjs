// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-03: the shell is the way around every other guard, so it has its own.
// Two independent layers protect the same rules: these checks and the deny list
// in .claude/settings.json.
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { afterAll, describe, expect, test } from 'vitest';
import {
  ALLOWED,
  BLOCKED,
  HOOKS_DIR,
  bash,
  makeDir,
  removeRepo,
  runHook,
} from './test-helpers.mjs';

const guard = (command, args = ['--global']) =>
  runHook('guard-bash.mjs', { args, input: bash(command) });

describe('HK-03: rules that apply to every session and every agent', () => {
  test.each([
    ['git push origin main', 'D-029'],
    ['git push --force origin feat/x', 'Force pushing'],
    ['git commit -m "wip" --no-verify', 'git hooks'],
    ['cat .env', '.env'],
    ['clever deploy', 'CI only'],
    ['terraform apply -auto-approve', 'owner'],
    ['gh pr merge 12 --admin', 'D-042'],
    // The pinned Terraform runs through a wrapper, which the rule above would
    // not see: INF-07. No parentheses in these comments — the test counter in
    // scripts/lib/test-strength.mjs reads test.each up to the first one.
    ['node scripts/terraform.mjs -chdir=infra/staging apply', 'owner'],
    ['node scripts/terraform.mjs -chdir=infra/staging destroy -auto-approve', 'owner'],
    ['terraform destroy', 'owner'],
    // Applying staging is two workflow runs the owner starts; GitHub sees a
    // session's tools as the owner, so the session must not start them: D-077.
    ['gh workflow run infra-staging.yml -f action=apply', 'D-077'],
    ['gh api -X POST repos/o/r/actions/workflows/infra-staging.yml/dispatches', 'D-077'],
    // The deploy itself goes through a script too.
    ['node scripts/staging-deploy.mjs', 'CI only'],
    // Forms three reviewers found getting through: a flag between the words,
    // the pinned binary called directly, another repository named, a re-run.
    ['terraform -chdir=infra/staging apply', 'owner'],
    ['terraform -chdir=infra/staging destroy -auto-approve', 'owner'],
    [
      'node_modules/.cache/terraform/1.16.4/linux_amd64/terraform -chdir=infra/staging apply',
      'owner',
    ],
    ['gh -R bvst/TryggHverdag workflow run infra-staging.yml -f action=apply', 'D-077'],
    ['gh --repo bvst/TryggHverdag workflow run deploy-staging.yml', 'D-077'],
    ['gh run rerun 12345678901', 'D-077'],
    ['gh -R bvst/TryggHverdag run rerun 12345678901 --failed', 'D-077'],
    ['gh api -X POST repos/o/r/actions/runs/123/rerun', 'D-077'],
    ['gh api -X POST repos/o/r/actions/runs/123/rerun-failed-jobs', 'D-077'],
    ['gh api -X POST repos/o/r/actions/jobs/456/rerun', 'D-077'],
  ])('blocks: %s', (command, expected) => {
    const result = guard(command);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain(expected);
  });

  test.each([
    'git push -u origin feat/LOST-02-watchdog',
    'pnpm run gate:quick',
    'git status --short',
    'gh pr create --fill',
    'node scripts/terraform.mjs -chdir=infra/staging validate',
    'terraform -chdir=infra/staging plan',
    'gh workflow list',
    'gh run view 12345678901 --log',
  ])('allows: %s', (command) => {
    expect(guard(command).status).toBe(ALLOWED);
  });
});

describe('HK-03: reviewers are read-only', () => {
  const readonly = ['--readonly', '--agent', 'safety-reviewer'];

  test.each([
    ['git commit -m "fix"', 'git write commands'],
    ['rm -rf apps/server/src', 'file-changing commands'],
    ['pnpm add left-pad', 'dependency changes'],
    ['echo "approved" > verdict.txt', 'redirection'],
  ])('blocks: %s', (command, expected) => {
    const result = guard(command, readonly);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain(expected);
  });

  test.each(['pnpm run test:unit', 'git diff main', 'cat apps/server/src/api.ts'])(
    'allows, because it only reads: %s',
    (command) => {
      expect(guard(command, readonly).status).toBe(ALLOWED);
    },
  );
});

describe('HK-03: implementer cannot reach tests through the shell either (RG-03)', () => {
  const noTests = [
    '--agent',
    'implementer',
    '--deny-write-glob',
    '**/*.test.ts',
    '--deny-write-glob',
    'packages/test-kit/**',
  ];

  test('blocks an in-place edit of a test file', () => {
    const result = guard("sed -i 's/toBe(5)/toBe(1)/' apps/server/src/journey.test.ts", noTests);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('RG-03');
  });

  test('blocks writing over a file in the test kit', () => {
    const result = guard('echo "export const x = 1" > packages/test-kit/src/fake.ts', noTests);
    expect(result.status).toBe(BLOCKED);
  });

  test('allows the same command against production code', () => {
    const result = guard("sed -i 's/a/b/' apps/server/src/domain/journey.ts", noTests);
    expect(result.status).toBe(ALLOWED);
  });

  test('allows a command that changes nothing', () => {
    const result = guard('grep -r "toBe(5)" apps/server/src/journey.test.ts', noTests);
    expect(result.status).toBe(ALLOWED);
  });
});

describe('HK-03: the second layer, the deny list in .claude/settings.json', () => {
  // A shell hook cannot see a tool call, and the GitHub tools can start a
  // workflow run without a shell. Staging is applied by runs the owner starts,
  // and GitHub sees a session's tools as the owner — so the tool itself is
  // denied. Nothing else would notice the line being deleted.
  const deny = JSON.parse(
    readFileSync(path.join(import.meta.dirname, '..', 'settings.json'), 'utf8'),
  ).permissions.deny;

  test('D-077: a session cannot start a workflow run through the GitHub tools', () => {
    expect(deny).toContain('mcp__github__actions_run_trigger');
  });

  test('D-077: nor through the GitHub command line', () => {
    expect(deny).toContain('Bash(gh workflow run*)');
    expect(deny).toContain('Bash(gh * workflow run*)');
  });

  test('D-077: nor by re-running a run that already exists', () => {
    expect(deny).toContain('Bash(gh run rerun*)');
    expect(deny).toContain('Bash(gh * run rerun*)');
  });

  test('D-077: nor through older GitHub tool names that start or re-run a run', () => {
    // This server exposes one tool for all of it, denied above. Other versions
    // of the GitHub MCP server split it; denying a name that does not exist
    // costs nothing, and a session on the Mac may run a different version.
    for (const tool of [
      'mcp__github__run_workflow',
      'mcp__github__rerun_workflow_run',
      'mcp__github__rerun_failed_jobs',
    ]) {
      expect(deny).toContain(tool);
    }
  });
});

// BUG-36 (D-120): the shell is the other way to change
// .claude/settings.local.json, where `"disableAllHooks": true` turns every
// guard off, and the hooks' records in .claude/state/. These are the arguments
// D-120 gives the global Bash guard in .claude/settings.json;
// settings-hooks.test.mjs holds that settings.json passes them. The directory
// itself is named too: `.claude/state/**` does not match `rm -rf .claude/state`.
// Claude Code puts agent_id in a hook's input only when a subagent made the
// call (code.claude.com/docs/en/hooks, "Common input fields").
const D120_ARGS = [
  '--global',
  '--deny-write-glob',
  '.claude/settings.local.json',
  '--deny-write-glob',
  '.claude/state/**',
  '--deny-write-glob',
  '.claude/state',
  '--allow-main-session',
  '.claude/state/phase',
];

const D120_REFUSED = [
  `echo '{"disableAllHooks": true}' > .claude/settings.local.json`,
  'tee .claude/settings.local.json',
  'printf x > .claude/state/gate-passed',
  'rm .claude/state/gate-passed',
  'rm -rf .claude/state',
  'rm -rf .claude/state/',
  // The exemption is for the path it names, not for a command that also
  // names it: phase is fine, gate-passed in the same command is not.
  "printf 'red:BUG-1\\n' > .claude/state/phase && rm .claude/state/gate-passed",
];
const D120_MAIN_SESSION_ONLY = [
  "printf 'red:BUG-1\\n' > .claude/state/phase",
  'rm .claude/state/phase',
];
const D120_READS = ['cat .claude/state/phase', 'cat .claude/settings.local.json'];

describe('BUG-36: guard-bash exempts .claude/state/phase for the main session only (D-120)', () => {
  const asMain = (command) => runHook('guard-bash.mjs', { args: D120_ARGS, input: bash(command) });
  const asSubagent = (command) =>
    runHook('guard-bash.mjs', {
      args: D120_ARGS,
      input: { ...bash(command), agent_id: 'synthetic-subagent-1', agent_type: 'implementer' },
    });

  // Passes today, on purpose: --deny-write-glob already refuses these. It
  // holds that the new exemption reaches no further than phase.
  test.each(D120_REFUSED)('BUG-36: refused for the main session and a subagent: %s', (command) => {
    const main = asMain(command);
    const subagent = asSubagent(command);

    expect({ main: main.status, subagent: subagent.status }).toEqual({
      main: BLOCKED,
      subagent: BLOCKED,
    });
  });

  // Fails today: nothing exempts phase for the main session yet.
  test.each(D120_MAIN_SESSION_ONLY)(
    'BUG-36: allowed for the main session, refused for a subagent: %s',
    (command) => {
      const main = asMain(command);
      const subagent = asSubagent(command);

      expect(
        { main: main.status, subagent: subagent.status },
        `main session said: ${main.stderr}`,
      ).toEqual({ main: ALLOWED, subagent: BLOCKED });
    },
  );

  // Passes today, on purpose: reading stays allowed for everyone.
  test.each(D120_READS)('BUG-36: allowed for both, because it only reads: %s', (command) => {
    expect({ main: asMain(command).status, subagent: asSubagent(command).status }).toEqual({
      main: ALLOWED,
      subagent: ALLOWED,
    });
  });
});

// BUG-36 (D-120): the global guard judges a path by where it is in the
// repository, whatever folder the session is in. A session that has run
// `cd apps/server` still has the repository's .claude/state/ to protect, but
// relative to that folder <repo>/.claude/state/gate-passed is
// ../../.claude/state/gate-passed, which no deny glob matches. The repository
// is CLAUDE_PROJECT_DIR, which Claude Code sets for every hook
// (code.claude.com/docs/en/hooks). A relative path still starts from the
// session's folder: that is where the shell would write.
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
 * Runs guard-bash with D-120's arguments as Claude Code does for a session
 * that has moved into apps/server: that folder is the process's and the
 * input's cwd, and CLAUDE_PROJECT_DIR is the project.
 */
function fromSubfolder(input) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: project };
  delete env.TRYGGHVERDAG_REVIEW_JOB;
  const result = spawnSync(
    process.execPath,
    [path.join(HOOKS_DIR, 'guard-bash.mjs'), ...D120_ARGS],
    {
      input: JSON.stringify({ cwd: subfolder, ...input }),
      cwd: subfolder,
      env,
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
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
const BASH_FROM_SUBFOLDER = [
  { command: 'printf x > ../../.claude/state/gate-passed', main: 'refused', subagent: 'refused' },
  { command: 'printf x > <repo>/.claude/state/gate-passed', main: 'refused', subagent: 'refused' },
  { command: 'rm ../../.claude/state/gate-passed', main: 'refused', subagent: 'refused' },
  { command: 'rm -rf ../../.claude/state', main: 'refused', subagent: 'refused' },
  {
    command: `echo '{"disableAllHooks": true}' > ../../.claude/settings.local.json`,
    main: 'refused',
    subagent: 'refused',
  },
  {
    command: `echo '{"disableAllHooks": true}' > <repo>/.claude/settings.local.json`,
    main: 'refused',
    subagent: 'refused',
  },
  {
    command: "printf 'red:BUG-1\\n' > ../../.claude/state/phase",
    main: 'allowed',
    subagent: 'refused',
  },
  {
    command: "printf 'red:BUG-1\\n' > <repo>/.claude/state/phase",
    main: 'allowed',
    subagent: 'refused',
  },
  { command: 'printf x > src/worker.ts', main: 'allowed', subagent: 'allowed' },
  { command: 'printf x > <outside>/notes.md', main: 'allowed', subagent: 'allowed' },
];

describe('BUG-36: the global guard-bash judges a path from the repository, not from the folder the session is in (D-120)', () => {
  // The six protected rows and both phase rows fail today: from apps/server
  // every one of them is let through, for a subagent too. The last two pass
  // on purpose: production code in the subfolder, and a path outside the
  // repository, are still left alone.
  test.each(BASH_FROM_SUBFOLDER)(
    'BUG-36: from apps/server, $command — main session $main, subagent $subagent',
    ({ command, main, subagent }) => {
      const call = bash(command.replace('<repo>', project).replace('<outside>', outside));
      const asMain = fromSubfolder(call);
      const asSubagent = fromSubfolder({
        ...call,
        agent_id: 'synthetic-subagent-1',
        agent_type: 'implementer',
      });

      expect({
        command,
        main: d120VerdictOf(asMain),
        subagent: d120VerdictOf(asSubagent),
      }).toEqual({ command, main, subagent });
    },
  );
});

// BUG-36 (D-120): guard-bash splits a command on whitespace, quotes and `=`,
// so a redirect with no space after `>` leaves a token such as
// `>.claude/state/gate-passed`, which no deny glob matches, and every write
// below got through, for a subagent too. A write by redirect is judged on its
// target, with or without a space; redirectTargets already finds that target
// for --readonly. `2>&1` and /dev/null name no path D-120 protects, so a
// command that only reads a protected file keeps them.
const D120_NO_SPACE_REFUSED = [
  'printf x >.claude/state/gate-passed',
  `echo '{"disableAllHooks": true}' >.claude/settings.local.json`,
  'printf x>>.claude/state/gate-passed',
  'printf x>.claude/state/gate-passed',
  'printf x 1>.claude/state/gate-passed',
  'pnpm run gate:quick 2>.claude/state/gate-failed',
  'printf x &>.claude/state/gate-passed',
  // The exemption is for the path it names here too: phase is fine,
  // gate-passed in the same command is not.
  "printf 'red:BUG-1\\n' >.claude/state/phase && printf x >.claude/state/gate-passed",
];
const D120_NO_SPACE_MAIN_SESSION_ONLY = [
  "printf 'red:BUG-1\\n' >.claude/state/phase",
  "printf 'red:BUG-1\\n'>.claude/state/phase",
];
const D120_NO_PROTECTED_TARGET = [
  'cat .claude/state/phase 2>&1',
  'cat .claude/settings.local.json 2>/dev/null',
  'grep -c x .claude/state/gate-passed >/dev/null',
  'grep -c x .claude/state/gate-passed >/dev/null 2>&1',
  'printf x >notes.md',
];

/** guard-bash with D-120's arguments from the repository, for the main session and a subagent. */
const d120VerdictsOf = (command) => {
  const call = bash(command);
  const main = runHook('guard-bash.mjs', { args: D120_ARGS, input: call });
  const subagent = runHook('guard-bash.mjs', {
    args: D120_ARGS,
    input: { ...call, agent_id: 'synthetic-subagent-1', agent_type: 'implementer' },
  });
  return { command, main: d120VerdictOf(main), subagent: d120VerdictOf(subagent) };
};

describe('BUG-36: the global guard-bash judges a redirect with no space by its target (D-120)', () => {
  // Fails today: every row is allowed, for the main session and a subagent.
  test.each(D120_NO_SPACE_REFUSED)(
    'BUG-36: a redirect with no space is refused for the main session and a subagent, naming D-120: %s',
    (command) => {
      expect(d120VerdictsOf(command)).toEqual({ command, main: 'refused', subagent: 'refused' });
    },
  );

  // Fails today on the subagent, which is allowed.
  test.each(D120_NO_SPACE_MAIN_SESSION_ONLY)(
    'BUG-36: a redirect with no space into phase is allowed for the main session, refused for a subagent: %s',
    (command) => {
      expect(d120VerdictsOf(command)).toEqual({ command, main: 'allowed', subagent: 'refused' });
    },
  );

  // Passes today, on purpose: it holds that judging a redirect by its target
  // does not make a file descriptor, /dev/null or an unprotected file one.
  test.each(D120_NO_PROTECTED_TARGET)(
    'BUG-36: allowed for both, because no redirect targets a path D-120 protects: %s',
    (command) => {
      expect(d120VerdictsOf(command)).toEqual({ command, main: 'allowed', subagent: 'allowed' });
    },
  );
});

// BUG-36 (RG-03): the role guards run the same deny-write loop, so the same
// gap. implementer's `packages/test-kit/**` matches no token that starts with
// `>`. `**/*.test.ts` refuses `>a.test.ts` only because its `*` takes the `>`
// in, and then names `>a.test.ts`, not the file the shell would write.
const IMPLEMENTER_ARGS = [
  '--agent',
  'implementer',
  '--deny-write-glob',
  '**/*.test.ts',
  '--deny-write-glob',
  'packages/test-kit/**',
];
const ROLE_NO_SPACE_TEST_FILE = ['echo x >a.test.ts', 'echo x>>a.test.ts'];
const ROLE_READS_WITH_REDIRECTS = [
  'grep -r "toBe(5)" apps/server/src/journey.test.ts 2>&1',
  'grep -r "toBe(5)" apps/server/src/journey.test.ts >/dev/null',
];

describe('BUG-36: a role guard judges a redirect with no space by its target (RG-03)', () => {
  // Fails today: allowed.
  test('BUG-36: blocks writing over a file in the test kit by a redirect with no space', () => {
    const result = guard(
      'echo "export const x = 1" >packages/test-kit/src/fake.ts',
      IMPLEMENTER_ARGS,
    );

    expect(result.status, `the guard said: ${result.stderr}`).toBe(BLOCKED);
    expect(result.stderr).toContain('RG-03');
    expect(result.stderr).toContain('packages/test-kit/src/fake.ts');
  });

  // Fails today on the path the refusal names: `>a.test.ts` and `x>>a.test.ts`.
  test.each(ROLE_NO_SPACE_TEST_FILE)(
    'BUG-36: blocks a redirect with no space into a test file, naming the file the shell would write: %s',
    (command) => {
      const result = guard(command, IMPLEMENTER_ARGS);

      expect(result.status).toBe(BLOCKED);
      expect(result.stderr).toContain('RG-03');
      expect(result.stderr).toContain('a.test.ts');
      expect(result.stderr).not.toContain('>a.test.ts');
    },
  );

  // Passes today, on purpose: `2>&1` and /dev/null are not writes to a test.
  test.each(ROLE_READS_WITH_REDIRECTS)(
    'BUG-36: allows a command that only reads a test file, whatever it does with its output: %s',
    (command) => {
      expect(guard(command, IMPLEMENTER_ARGS).status).toBe(ALLOWED);
    },
  );
});

describe('HK-03: an empty command', () => {
  test('passes through', () => {
    const result = runHook('guard-bash.mjs', { args: ['--global'], input: bash('') });
    expect(result.status).toBe(ALLOWED);
  });
});

// ---------------------------------------------------------------------------
// BUG-36, review loop 1
// ---------------------------------------------------------------------------

// From review loop 1 on, settings.json also names the .claude folder itself,
// exactly: a copy into it (`cp … .claude/`) and removing it (`rm -rf .claude`)
// change what D-120 protects, and `.claude/state/**` matches neither.
// settings-hooks.test.mjs holds that settings.json passes it.
const D120_ARGS_WITH_FOLDER = [...D120_ARGS, '--deny-write-glob', '.claude'];

/** guard-bash's D-120 verdict for the main session and a subagent, with loop 1's arguments. */
const loop1VerdictsOf = (command) => {
  const call = bash(command);
  const main = runHook('guard-bash.mjs', { args: D120_ARGS_WITH_FOLDER, input: call });
  const subagent = runHook('guard-bash.mjs', {
    args: D120_ARGS_WITH_FOLDER,
    input: { ...call, agent_id: 'synthetic-subagent-1', agent_type: 'implementer' },
  });
  return { command, main: d120VerdictOf(main), subagent: d120VerdictOf(subagent) };
};

// BUG-36, review loop 1, privacy-security-reviewer: guard-bash splits a
// command only on whitespace, quotes and `=`, so shell punctuation stuck to a
// path stays part of the token: `.claude/settings.local.json;` matches no
// deny glob, and every row below got through, for a subagent too. The shell
// ends a word at `;`, `&`, `|`, `<`, a bracket and a backtick, so the guard
// must judge the word the shell would see. The last three rows are the same
// class, added by test-author: a command substitution, a backtick and a
// job sent to the background.
const LOOP1_PUNCTUATION_REFUSED = [
  'rm .claude/settings.local.json; echo done',
  'rm .claude/settings.local.json&&echo done',
  '(rm .claude/settings.local.json)',
  'tee .claude/settings.local.json</tmp/e',
  'rm -rf .claude/state; echo ok',
  'cp /tmp/x .claude/settings.local.json; echo ok',
  'rm .claude/settings.local.json||true',
  'rm -rf .claude/state&&echo ok',
  'rm -rf .claude;echo ok',
  'echo $(rm .claude/settings.local.json)',
  'echo `rm .claude/settings.local.json`',
  'cp /tmp/x .claude/settings.local.json&',
];

// The other side of the same split: `.claude/state/**` takes the punctuation
// in, so `.claude/state/phase;` is refused, while the main session's exemption
// names phase exactly and does not reach it. The main session's own phase
// step is refused today; a subagent must stay refused.
const LOOP1_PUNCTUATION_MAIN_SESSION_ONLY = [
  'rm .claude/state/phase; echo ok',
  '(rm .claude/state/phase)',
  "printf 'red:BUG-1\\n' > .claude/state/phase; echo ok",
];

// The folder itself: refused with loop 1's arguments, which the guard already
// understands. These pass today, on purpose: they hold that the new argument
// becomes a refusal for both callers, with or without a trailing slash.
// settings-hooks.test.mjs holds the part that fails today, the wiring.
const LOOP1_FOLDER_REFUSED = [
  'cp /tmp/s/settings.local.json .claude/',
  'cp /tmp/s/settings.local.json .claude',
  'mv /tmp/s/settings.local.json .claude/',
  'rm -rf .claude',
  'rm -rf .claude/',
];

// Passes today, on purpose: a command that only names a path D-120 does not
// protect is left alone, however its punctuation reads. Naming the folder
// itself must not turn into refusing everything under it: agent memory and
// the agents' own files are not D-120's.
const LOOP1_UNPROTECTED = [
  'rm .claude/agent-memory/x.md',
  'rm .claude/agents/x.md',
  'printf x > .claude/agent-memory/x.md',
  'cp /tmp/x .claude/agents/x.md',
  'mkdir -p .claude/agent-memory/test-author',
  'rm .claude/agent-memory/x.md; echo done',
  'cp /tmp/x .claude/agents/x.md&&echo ok',
  '(rm .claude/agents/x.md)',
];

describe('BUG-36, review loop 1: guard-bash judges the word the shell sees, not a token with punctuation stuck to it (D-120)', () => {
  // Fails today: every row is allowed, for the main session and a subagent.
  test.each(LOOP1_PUNCTUATION_REFUSED)(
    'BUG-36: refused for the main session and a subagent, naming D-120, with punctuation stuck to the path: %s',
    (command) => {
      expect(loop1VerdictsOf(command)).toEqual({ command, main: 'refused', subagent: 'refused' });
    },
  );

  // Fails today on the main session, which is refused.
  test.each(LOOP1_PUNCTUATION_MAIN_SESSION_ONLY)(
    'BUG-36: allowed for the main session, refused for a subagent, with punctuation stuck to phase: %s',
    (command) => {
      expect(loop1VerdictsOf(command)).toEqual({ command, main: 'allowed', subagent: 'refused' });
    },
  );

  test.each(LOOP1_FOLDER_REFUSED)(
    'BUG-36: a write into or a removal of the .claude folder itself is refused for the main session and a subagent, naming D-120: %s',
    (command) => {
      expect(loop1VerdictsOf(command)).toEqual({ command, main: 'refused', subagent: 'refused' });
    },
  );

  test.each(LOOP1_UNPROTECTED)(
    'BUG-36: allowed for the main session and a subagent, because it names no path D-120 protects: %s',
    (command) => {
      expect(loop1VerdictsOf(command)).toEqual({ command, main: 'allowed', subagent: 'allowed' });
    },
  );
});

// BUG-36, review loop 1, privacy-security-reviewer: ln, install and dd write
// the path they are given as surely as cp does, but the guard does not count
// them as writes, so it never looks at the paths. Each row got through, for a
// subagent too.
const LOOP1_OTHER_WRITERS_REFUSED = [
  'ln -sf /tmp/x .claude/settings.local.json',
  'install /tmp/x .claude/settings.local.json',
  'dd if=/tmp/x of=.claude/settings.local.json',
  'ln -s /tmp/x .claude/state/gate-passed',
  'dd if=/tmp/x of=.claude/state/gate-passed',
];

describe('BUG-36, review loop 1: guard-bash counts ln, install and dd as writes (D-120)', () => {
  // Fails today: every row is allowed, for the main session and a subagent.
  test.each(LOOP1_OTHER_WRITERS_REFUSED)(
    'BUG-36: refused for the main session and a subagent, naming D-120: %s',
    (command) => {
      expect(loop1VerdictsOf(command)).toEqual({ command, main: 'refused', subagent: 'refused' });
    },
  );

  // Fails today: allowed. Only the subagent's verdict is held: what the main
  // session may do to its own phase file with install is not what this is about.
  test('BUG-36: a subagent may not install a file over .claude/state/phase: refused, naming D-120', () => {
    expect(loop1VerdictsOf('install /tmp/x .claude/state/phase').subagent).toBe('refused');
  });
});

// BUG-36, review loop 1, privacy-security-reviewer: the owner's Mac file
// system ignores case, so `.CLAUDE/settings.local.json` there is the very file
// D-120 protects. The global guard matches its paths without regard to case;
// a role's own guard, which has no --global, keeps matching case exactly, and
// guard-paths.test.mjs holds that.
const LOOP1_CASE_REFUSED = [
  'rm .CLAUDE/settings.local.json',
  'printf x > .claude/Settings.Local.json',
  'rm .Claude/State/gate-passed',
  'rm -rf .Claude/State',
];

describe('BUG-36, review loop 1: the global guard-bash ignores case in the paths D-120 protects', () => {
  // Fails today: every row is allowed, for the main session and a subagent.
  test.each(LOOP1_CASE_REFUSED)(
    'BUG-36: refused for the main session and a subagent, naming D-120, whatever the case: %s',
    (command) => {
      expect(loop1VerdictsOf(command)).toEqual({ command, main: 'refused', subagent: 'refused' });
    },
  );

  // Fails today: allowed. Only the subagent's verdict is held.
  test('BUG-36: a subagent may not write .Claude/State/Phase: refused, naming D-120', () => {
    expect(loop1VerdictsOf("printf 'red:BUG-1\\n' > .Claude/State/Phase").subagent).toBe('refused');
  });
});

// BUG-36, review loop 1, privacy-security-reviewer: the guard reads the whole
// command, so a command whose text only quotes a protected path next to a
// write, such as a commit message, is refused too (D-120, known limits). The
// refusal must say what to do then, pass the text from a file, so the session
// does not go looking for a phrasing the guard misses.
describe('BUG-36, review loop 1: the refusal tells a session that only quotes the path to pass the text from a file', () => {
  // Fails today on the message: the refusal says nothing about a file.
  test('BUG-36: a commit message that quotes a redirect into .claude/state/ is refused, and the refusal says to pass the text from a file', () => {
    const message = ['note: printf x', '>', ['.claude', 'state', 'gate-passed'].join('/')].join(
      ' ',
    );
    const result = runHook('guard-bash.mjs', {
      args: D120_ARGS_WITH_FOLDER,
      input: bash(`git commit -m "${message}"`),
    });

    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('D-120');
    expect(result.stderr).toMatch(/git commit -F|from a file/);
  });
});

// BUG-36, review loop 1, test-auditor: lib.mjs says any agent_id, even an
// empty one, is a subagent, and no test held it: a guard that tested agent_id
// for truth would hand the main session's exemption to a subagent whose
// agent_id is "". Passes today, on purpose: it is the test that kills that
// fault.
describe('BUG-36, review loop 1: an empty agent_id is still a subagent (D-120)', () => {
  test('BUG-36: with agent_id "", guard-bash refuses a change to .claude/state/phase, naming D-120', () => {
    const result = runHook('guard-bash.mjs', {
      args: D120_ARGS,
      input: { ...bash("printf 'red:BUG-1\\n' > .claude/state/phase"), agent_id: '' },
    });

    expect(d120VerdictOf(result)).toBe('refused');
  });
});

// ---------------------------------------------------------------------------
// BUG-36, review loop 2
// ---------------------------------------------------------------------------

// The paths D-120 protects, put together from their pieces, so that a shell
// command which only quotes this file never names one beside a write.
const LOCAL_SETTINGS = ['.claude', 'settings.local.json'].join('/');
const STATE_DIR = ['.claude', 'state'].join('/');
const GATE_PASSED = `${STATE_DIR}/gate-passed`;
const PHASE = `${STATE_DIR}/phase`;

const REPO = path.resolve(HOOKS_DIR, '..', '..');

/** A frontmatter scalar with its quotes taken off, as scripts/drills.test.mjs reads one. */
function unquoted(value) {
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value);
  }
  return value;
}

/**
 * The Bash hook a role's own frontmatter declares in .claude/agents/<agent>.md,
 * read the way the drills in scripts/drills.test.mjs read implementer's: the
 * hook command under the entry whose matcher is Bash.
 */
function roleBashHook(agent) {
  const file = path.join(REPO, '.claude', 'agents', `${agent}.md`);
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, 'utf8'))?.[1];
  if (front === undefined) {
    throw new Error(`${file} has no frontmatter, where the test reads the role's hooks.`);
  }
  const found = [];
  let matcher = '';
  for (const line of front.split('\n')) {
    const matched = /^\s*-\s*matcher:\s*(.+?)\s*$/.exec(line);
    if (matched !== null) {
      matcher = unquoted(matched[1] ?? '');
      continue;
    }
    const command = /^\s*command:\s*(.+?)\s*$/.exec(line);
    if (command !== null && matcher === 'Bash') {
      found.push(unquoted(command[1] ?? ''));
    }
  }
  const [hook = ''] = found;
  if (
    found.length !== 1 ||
    !hook.includes('guard-bash.mjs') ||
    !hook.includes('--deny-write-glob')
  ) {
    throw new Error(
      `${file} should declare one Bash hook, guard-bash with --deny-write-glob; it declares: ${found.join(' | ') || 'none'}`,
    );
  }
  return hook;
}

/**
 * What a role's own Bash guard answers its subagent, run as Claude Code runs a
 * frontmatter hook: through the shell, from the repository, the call on
 * stdin. A refusal counts only in the role guard's words, RG-03.
 */
function roleVerdictOf(agent, command) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: REPO };
  delete env.TRYGGHVERDAG_REVIEW_JOB;
  const run = spawnSync('sh', ['-c', roleBashHook(agent)], {
    cwd: REPO,
    env,
    input: JSON.stringify({
      cwd: REPO,
      ...bash(command),
      agent_id: 'synthetic-subagent-1',
      agent_type: agent,
    }),
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (run.error) throw run.error;
  const stderr = run.stderr ?? '';
  if (
    run.status === BLOCKED &&
    stderr.includes(`Blocked for ${agent}`) &&
    stderr.includes('RG-03')
  ) {
    return 'refused';
  }
  if (run.status === ALLOWED) return 'allowed';
  return `exit ${String(run.status)}: ${stderr.trim()}`;
}

// BUG-36, review loop 2, privacy-security-reviewer: since loop 1, ln, install
// and dd count as writes wherever they stand in a command, for every guard
// that passes --deny-write-glob. So a command that only mentions one of them
// beside a path the guard protects is refused: a dependency install before a
// test run, a search for the word. A word counts as a write only where the
// shell would run it, as the command word. Each row below is refused today.
const LOOP2_ROLE_MENTIONS = [
  {
    agent: 'implementer',
    command: 'pnpm install && pnpm exec vitest run apps/server/src/x.test.ts',
  },
  {
    agent: 'test-author',
    command: 'pnpm install && pnpm exec vitest run apps/server/src/x.test.ts',
  },
  { agent: 'implementer', command: 'grep -rn install apps/mobile/src/features/x.test.tsx' },
  { agent: 'implementer', command: 'grep -rn ln apps/server/src/x.test.ts' },
  { agent: 'test-author', command: 'grep -rn dd apps/server/src/domain/journey.ts' },
];

// Passes today, on purpose: unlink is no write today, so this holds that
// counting it as a command word does not refuse its mere mention.
const LOOP2_ROLE_UNLINK_MENTION = [
  { agent: 'implementer', command: 'grep -rn unlink apps/server/src/x.test.ts' },
];

// Pass today, on purpose: as the command word, after `;`, `&&`, `|`, a
// bracket, `$(` and a backtick, ln, install and dd still write what they
// are given, also when the same command mentions one first.
const LOOP2_ROLE_WRITERS = [
  { agent: 'implementer', command: 'install /tmp/x apps/server/src/x.test.ts' },
  { agent: 'implementer', command: 'true; ln -sf /tmp/x apps/server/src/x.test.ts' },
  { agent: 'implementer', command: 'true && install /tmp/x apps/server/src/x.test.ts' },
  { agent: 'implementer', command: 'cat /tmp/x | dd of=apps/server/src/x.test.ts' },
  { agent: 'implementer', command: '(ln -s /tmp/x apps/server/src/x.test.ts)' },
  { agent: 'implementer', command: 'echo $(install /tmp/x apps/server/src/x.test.ts)' },
  { agent: 'implementer', command: 'echo `install /tmp/x apps/server/src/x.test.ts`' },
  {
    agent: 'implementer',
    command: 'pnpm install && install /tmp/x packages/test-kit/src/fake.ts',
  },
  {
    agent: 'test-author',
    command: 'pnpm install && dd if=/tmp/x of=apps/server/src/domain/journey.ts',
  },
];

// BUG-36, review loop 2, privacy-security-reviewer: unlink removes the path it
// is given as surely as rm does. Each row is allowed today.
const LOOP2_ROLE_UNLINK = [
  { agent: 'implementer', command: 'unlink apps/server/src/x.test.ts' },
  { agent: 'implementer', command: 'true && unlink packages/test-kit/src/fake.ts' },
  { agent: 'test-author', command: 'unlink packages/contracts/src/journey.ts' },
];

describe("BUG-36, review loop 2: a role's own guard counts ln, install, dd and unlink as writes only as the command word (RG-03)", () => {
  // Fails today: refused, though nothing is written.
  test.each(LOOP2_ROLE_MENTIONS)(
    'BUG-36: allowed for $agent by its own frontmatter guard, because the word is only mentioned: $command (review loop 2, privacy-security-reviewer)',
    ({ agent, command }) => {
      expect({ agent, command, verdict: roleVerdictOf(agent, command) }).toEqual({
        agent,
        command,
        verdict: 'allowed',
      });
    },
  );

  test.each(LOOP2_ROLE_UNLINK_MENTION)(
    'BUG-36: allowed for $agent by its own frontmatter guard, because unlink is only mentioned: $command (review loop 2, privacy-security-reviewer)',
    ({ agent, command }) => {
      expect({ agent, command, verdict: roleVerdictOf(agent, command) }).toEqual({
        agent,
        command,
        verdict: 'allowed',
      });
    },
  );

  test.each(LOOP2_ROLE_WRITERS)(
    'BUG-36: refused for $agent by its own frontmatter guard, naming RG-03, because the command word writes: $command (review loop 2, test-auditor)',
    ({ agent, command }) => {
      expect({ agent, command, verdict: roleVerdictOf(agent, command) }).toEqual({
        agent,
        command,
        verdict: 'refused',
      });
    },
  );

  // Fails today: allowed.
  test.each(LOOP2_ROLE_UNLINK)(
    'BUG-36: refused for $agent by its own frontmatter guard, naming RG-03, because unlink removes the path: $command (review loop 2, privacy-security-reviewer)',
    ({ agent, command }) => {
      expect({ agent, command, verdict: roleVerdictOf(agent, command) }).toEqual({
        agent,
        command,
        verdict: 'refused',
      });
    },
  );
});

// The same false positive in D-120's global guard. The reviewer's own example,
// `echo "make install" | cat && ls .claude/agents`, is allowed today: the
// guard wants whitespace after the word, and there a quote follows it, and
// .claude/agents is no path D-120 protects. These rows, of the same kind, are
// refused today: each mentions the word, then only reads or lists.
const LOOP2_D120_MENTIONS = [
  'echo "make install now" | cat && ls .claude',
  `echo make install | cat && ls ${STATE_DIR}`,
  `pnpm install && cat ${LOCAL_SETTINGS}`,
];

// Passes today, on purpose: the reviewer's own example, kept as written.
const LOOP2_D120_REVIEWERS_EXAMPLE = ['echo "make install" | cat && ls .claude/agents'];

// Pass today, on purpose: the command word still writes, however the command
// reaches it. The newline, `then` and `do` rows go beyond the reviewers'
// list: each makes the word the command word as surely as `;` does, and is
// refused today, so a guard that looks only after punctuation would let them
// through.
const LOOP2_D120_WRITERS = [
  `true; install /tmp/x ${LOCAL_SETTINGS}`,
  `true;install /tmp/x ${LOCAL_SETTINGS}`,
  `true && ln -sf /tmp/x ${LOCAL_SETTINGS}`,
  `cat /tmp/x | dd of=${GATE_PASSED}`,
  `(ln -s /tmp/x ${GATE_PASSED})`,
  `echo $(install /tmp/x ${LOCAL_SETTINGS})`,
  `echo \`install /tmp/x ${LOCAL_SETTINGS}\``,
  `pnpm install && install /tmp/x ${LOCAL_SETTINGS}`,
  `true\ninstall /tmp/x ${LOCAL_SETTINGS}`,
  `if true; then install /tmp/x ${LOCAL_SETTINGS}; fi`,
  `for f in a; do ln -sf /tmp/x ${GATE_PASSED}; done`,
];

// BUG-36, review loop 2, privacy-security-reviewer: unlink, as the command
// word. Each row is allowed today, for the main session and a subagent.
const LOOP2_D120_UNLINK = [
  `unlink ${GATE_PASSED}`,
  `true && unlink ${GATE_PASSED}`,
  `(unlink ${GATE_PASSED})`,
  `echo $(unlink ${LOCAL_SETTINGS})`,
];

describe('BUG-36, review loop 2: the global guard-bash counts ln, install, dd and unlink as writes only as the command word (D-120)', () => {
  // Fails today: refused, for the main session and a subagent.
  test.each(LOOP2_D120_MENTIONS)(
    'BUG-36: allowed for the main session and a subagent, because the word is only mentioned: %s (review loop 2, privacy-security-reviewer)',
    (command) => {
      expect(loop1VerdictsOf(command)).toEqual({ command, main: 'allowed', subagent: 'allowed' });
    },
  );

  test.each(LOOP2_D120_REVIEWERS_EXAMPLE)(
    "BUG-36: the reviewer's own example stays allowed for the main session and a subagent: %s (review loop 2, privacy-security-reviewer)",
    (command) => {
      expect(loop1VerdictsOf(command)).toEqual({ command, main: 'allowed', subagent: 'allowed' });
    },
  );

  test.each(LOOP2_D120_WRITERS)(
    'BUG-36: refused for the main session and a subagent, naming D-120, because the command word writes: %s (review loop 2, test-auditor)',
    (command) => {
      expect(loop1VerdictsOf(command)).toEqual({ command, main: 'refused', subagent: 'refused' });
    },
  );

  // Fails today: allowed, for the main session and a subagent.
  test.each(LOOP2_D120_UNLINK)(
    'BUG-36: refused for the main session and a subagent, naming D-120, because unlink removes the path: %s (review loop 2, privacy-security-reviewer)',
    (command) => {
      expect(loop1VerdictsOf(command)).toEqual({ command, main: 'refused', subagent: 'refused' });
    },
  );

  // Fails today on the subagent, which is allowed.
  test('BUG-36: unlink of the phase file is allowed for the main session, refused for a subagent, naming D-120 (review loop 2, privacy-security-reviewer)', () => {
    const command = `unlink ${PHASE}`;

    expect(loop1VerdictsOf(command)).toEqual({ command, main: 'allowed', subagent: 'refused' });
  });
});

// BUG-36, review loop 2, both reviewers: `>& word` and `[n]>&word` write the
// file `word` when it is not a number or `-`; bash does, test-auditor ran it.
// redirectTargets passes over every target that starts with `&`, so each row
// below gets through today, for a subagent too. `2>&1`, `>&2` and `1>&-` only
// copy or close a file descriptor and stay no target.
const LOOP2_D120_DUP_TO_FILE = [
  { command: `printf x >& ${GATE_PASSED}`, target: GATE_PASSED },
  { command: `printf x >&${GATE_PASSED}`, target: GATE_PASSED },
  { command: `printf x 1>&${GATE_PASSED}`, target: GATE_PASSED },
  { command: `echo '{"disableAllHooks": true}' >&${LOCAL_SETTINGS}`, target: LOCAL_SETTINGS },
];
const LOOP2_D120_DUP_TO_FD = [
  `cat ${PHASE} >&2`,
  `cat ${LOCAL_SETTINGS} >&2`,
  `cat ${LOCAL_SETTINGS} 1>&-`,
  `cat ${LOCAL_SETTINGS} 2>&1`,
  `grep -c x ${GATE_PASSED} 1>&2`,
];

describe('BUG-36, review loop 2: guard-bash judges `>&` followed by a file name as a redirect into that file (D-120, RG-03)', () => {
  // Fails today: allowed, for the main session and a subagent.
  test.each(LOOP2_D120_DUP_TO_FILE)(
    'BUG-36: refused for the main session and a subagent, naming D-120 and the file: $command (review loop 2, privacy-security-reviewer and test-auditor)',
    ({ command, target }) => {
      const verdicts = loop1VerdictsOf(command);
      const main = runHook('guard-bash.mjs', { args: D120_ARGS_WITH_FOLDER, input: bash(command) });

      expect(verdicts).toEqual({ command, main: 'refused', subagent: 'refused' });
      expect(main.stderr).toContain(`this would change ${target},`);
    },
  );

  // Fails today on the subagent, which is allowed.
  test('BUG-36: `>&` into the phase file is allowed for the main session, refused for a subagent, naming D-120 (review loop 2, privacy-security-reviewer and test-auditor)', () => {
    const command = `printf 'red:BUG-1\\n' >&${PHASE}`;

    expect(loop1VerdictsOf(command)).toEqual({ command, main: 'allowed', subagent: 'refused' });
  });

  test.each(LOOP2_D120_DUP_TO_FD)(
    'BUG-36: allowed for the main session and a subagent, because `>&` only copies or closes a file descriptor: %s (review loop 2, test-auditor)',
    (command) => {
      expect(loop1VerdictsOf(command)).toEqual({ command, main: 'allowed', subagent: 'allowed' });
    },
  );
});

const LOOP2_ROLE_DUP_TO_FILE = [
  { agent: 'implementer', command: 'printf x >& apps/server/src/x.test.ts' },
  { agent: 'implementer', command: 'printf x >&packages/test-kit/src/fake.ts' },
  { agent: 'implementer', command: 'printf x 1>&apps/server/src/x.test.ts' },
  { agent: 'test-author', command: 'printf x >&apps/server/src/domain/journey.ts' },
];
const LOOP2_ROLE_DUP_TO_FD = [
  { agent: 'implementer', command: 'grep -c x apps/server/src/x.test.ts >&2' },
  { agent: 'implementer', command: 'grep -c x apps/server/src/x.test.ts 1>&-' },
  { agent: 'test-author', command: 'grep -c x apps/server/src/domain/journey.ts 2>&1' },
];

describe("BUG-36, review loop 2: a role's own guard judges `>&` followed by a file name as a redirect into that file (RG-03)", () => {
  // Fails today: allowed.
  test.each(LOOP2_ROLE_DUP_TO_FILE)(
    'BUG-36: refused for $agent by its own frontmatter guard, naming RG-03: $command (review loop 2, privacy-security-reviewer and test-auditor)',
    ({ agent, command }) => {
      expect({ agent, command, verdict: roleVerdictOf(agent, command) }).toEqual({
        agent,
        command,
        verdict: 'refused',
      });
    },
  );

  test.each(LOOP2_ROLE_DUP_TO_FD)(
    'BUG-36: allowed for $agent by its own frontmatter guard, because `>&` only copies or closes a file descriptor: $command (review loop 2, test-auditor)',
    ({ agent, command }) => {
      expect({ agent, command, verdict: roleVerdictOf(agent, command) }).toEqual({
        agent,
        command,
        verdict: 'allowed',
      });
    },
  );
});

// A reviewer's guard, --readonly, counts `>&` followed by a file name as
// output redirected to a file, and still lets a reviewer search for the word
// install: --readonly never counted ln, install or dd, and no test held that.
const LOOP2_READONLY_ARGS = ['--readonly', '--agent', 'safety-reviewer'];
const LOOP2_READONLY_DUP_TO_FILE = [
  'printf x >& verdict.txt',
  'printf x >&verdict.txt',
  'printf x 1>&verdict.txt',
];
const LOOP2_READONLY_READS = [
  'rg install docs',
  'git diff main 2>&1',
  'git diff main >&2',
  'git diff main 1>&-',
];

describe('BUG-36, review loop 2: a reviewer is refused `>&` into a file, and may still search for install (HK-03)', () => {
  // Fails today: allowed.
  test.each(LOOP2_READONLY_DUP_TO_FILE)(
    'BUG-36: refused for a read-only reviewer as output redirection: %s (review loop 2, privacy-security-reviewer and test-auditor)',
    (command) => {
      const result = guard(command, LOOP2_READONLY_ARGS);

      expect({ command, status: result.status }, `the guard said: ${result.stderr}`).toEqual({
        command,
        status: BLOCKED,
      });
      expect(result.stderr).toContain('redirection');
    },
  );

  test.each(LOOP2_READONLY_READS)(
    'BUG-36: allowed for a read-only reviewer, because it only reads: %s (review loop 2, test-auditor)',
    (command) => {
      const result = guard(command, LOOP2_READONLY_ARGS);

      expect({ command, status: result.status }, `the guard said: ${result.stderr}`).toEqual({
        command,
        status: ALLOWED,
      });
    },
  );
});

// BUG-36, review loop 2, test-auditor: D-120 says the global guards ignore
// case in the main session's exemption for the phase file too, and no test
// held it. Pass today, on purpose: a guard whose exemption kept exact case
// would refuse the main session's own phase step on the owner's Mac, where
// .Claude/State/Phase is the phase file.
const LOOP2_CASE_PHASE = ["printf 'red:BUG-1\\n' > .Claude/State/Phase", 'rm .CLAUDE/STATE/PHASE'];

describe("BUG-36, review loop 2: the global guard-bash ignores case in the main session's exemption too (D-120)", () => {
  test.each(LOOP2_CASE_PHASE)(
    'BUG-36: allowed for the main session, refused for a subagent, naming D-120, whatever the case: %s (review loop 2, test-auditor)',
    (command) => {
      expect(loop1VerdictsOf(command)).toEqual({ command, main: 'allowed', subagent: 'refused' });
    },
  );
});

// BUG-36, review loop 2, privacy-security-reviewer: with the .claude folder
// itself among the deny globs, a command that only names the folder beside a
// redirect is refused, though it changes nothing there. The refusal's advice,
// pass the text from a file, does not help a session that meant a subfolder:
// it must also say to name the subfolder meant.
describe('BUG-36, review loop 2: when the .claude folder itself is what matched, the refusal says to name the subfolder meant (D-120)', () => {
  // Fails today on the message, for the main session and a subagent.
  test('BUG-36: `git diff origin/main...HEAD -- .claude > /tmp/d.txt` is refused, naming D-120 and the folder, and the refusal says to name the subfolder meant (review loop 2, privacy-security-reviewer)', () => {
    const call = bash('git diff origin/main...HEAD -- .claude > /tmp/d.txt');
    for (const input of [call, { ...call, agent_id: 'synthetic-subagent-1' }]) {
      const result = runHook('guard-bash.mjs', { args: D120_ARGS_WITH_FOLDER, input });
      const who = input.agent_id === undefined ? 'main session' : 'subagent';

      expect({ who, verdict: d120VerdictOf(result) }).toEqual({ who, verdict: 'refused' });
      expect(result.stderr).toContain('this would change .claude,');
      expect(result.stderr, `the ${who} was told: ${result.stderr}`).toMatch(/subfolder/i);
    }
  });
});

// ---------------------------------------------------------------------------
// BUG-36, review loop 3
// ---------------------------------------------------------------------------

/** A backtick command substitution that prints `word`, the name bash then writes to. */
const ticked = (word) => `\`printf ${word}\``;

// BUG-36, review loop 3, privacy-security-reviewer: a regression. Loop 1 ends
// a redirect target at a backtick, so in echo x >`printf FILE` the target
// comes out empty and the guard sees no redirect at all. bash writes FILE, the
// word the substitution prints, with or without a space before the backtick
// and inside double quotes alike; test-author ran all three. main refused
// these under --readonly and under test-author's guard, where its target was
// the backtick word itself; at 1f7ce47 and at this branch's head each one is
// allowed. A target in `$(…)` is refused on main and on the branch alike.
const LOOP3_READONLY_TICKED = [
  `echo x >${ticked('apps/server/src/a.ts')}`,
  `echo x > ${ticked('apps/server/src/a.ts')}`,
  `echo x >"${ticked('apps/server/src/a.ts')}"`,
];
const LOOP3_READONLY_DOLLAR = [
  'echo x >$(printf apps/server/src/a.ts)',
  'echo x > "$(printf apps/server/src/a.ts)"',
];

describe('BUG-36, review loop 3: a reviewer is refused a redirect into a command substitution, backtick or $( (HK-03)', () => {
  // Fails today: allowed.
  test.each(LOOP3_READONLY_TICKED)(
    'BUG-36: refused for a read-only reviewer as output redirection, though the target is a backtick substitution: %s (review loop 3, privacy-security-reviewer)',
    (command) => {
      const result = guard(command, LOOP2_READONLY_ARGS);

      expect({ command, status: result.status }, `the guard said: ${result.stderr}`).toEqual({
        command,
        status: BLOCKED,
      });
      expect(result.stderr).toContain('redirection');
    },
  );

  // Passes today, on purpose: a fix for the backtick must keep `$(` a target.
  test.each(LOOP3_READONLY_DOLLAR)(
    'BUG-36: still refused for a read-only reviewer as output redirection when the target is a $( substitution: %s (review loop 3, privacy-security-reviewer)',
    (command) => {
      const result = guard(command, LOOP2_READONLY_ARGS);

      expect({ command, status: result.status }, `the guard said: ${result.stderr}`).toEqual({
        command,
        status: BLOCKED,
      });
      expect(result.stderr).toContain('redirection');
    },
  );
});

// The same through the role guards, as their frontmatter runs them. On main
// the implementer rows with no space and in quotes got through as well: the
// backtick stuck to the test file's name, and no deny glob matched it. The
// branch splits words at a backtick since loop 1, so once the redirect is
// seen, the name the substitution prints is the word judged.
const LOOP3_ROLE_TICKED = [
  { agent: 'test-author', command: `echo x >${ticked('apps/server/src/a.ts')}` },
  { agent: 'test-author', command: `echo x > ${ticked('apps/server/src/domain/journey.ts')}` },
  { agent: 'test-author', command: `echo x >"${ticked('packages/contracts/src/journey.ts')}"` },
  { agent: 'implementer', command: `echo x >${ticked('apps/server/src/x.test.ts')}` },
  { agent: 'implementer', command: `echo x > ${ticked('packages/test-kit/src/fake.ts')}` },
  { agent: 'implementer', command: `echo x >"${ticked('apps/server/src/x.test.ts')}"` },
];
const LOOP3_ROLE_DOLLAR = [
  { agent: 'test-author', command: 'echo x >$(printf apps/server/src/a.ts)' },
  { agent: 'implementer', command: 'echo x >$(printf packages/test-kit/src/fake.ts)' },
];

describe("BUG-36, review loop 3: a role's own guard judges a redirect into a command substitution by the path it names (RG-03)", () => {
  // Fails today: allowed.
  test.each(LOOP3_ROLE_TICKED)(
    'BUG-36: refused for $agent by its own frontmatter guard, naming RG-03, though the target is a backtick substitution: $command (review loop 3, privacy-security-reviewer)',
    ({ agent, command }) => {
      expect({ agent, command, verdict: roleVerdictOf(agent, command) }).toEqual({
        agent,
        command,
        verdict: 'refused',
      });
    },
  );

  // Passes today, on purpose.
  test.each(LOOP3_ROLE_DOLLAR)(
    'BUG-36: still refused for $agent by its own frontmatter guard, naming RG-03, when the target is a $( substitution: $command (review loop 3, privacy-security-reviewer)',
    ({ agent, command }) => {
      expect({ agent, command, verdict: roleVerdictOf(agent, command) }).toEqual({
        agent,
        command,
        verdict: 'refused',
      });
    },
  );
});

// And through D-120's global guard, when the substitution names a path it
// protects. A substitution that names no such path is still left alone: the
// global guard refuses a protected path, not a backtick.
const LOOP3_D120_TICKED = [
  { command: `printf x >${ticked(GATE_PASSED)}`, target: GATE_PASSED },
  { command: `printf x > ${ticked(LOCAL_SETTINGS)}`, target: LOCAL_SETTINGS },
  { command: `printf x >"${ticked(GATE_PASSED)}"`, target: GATE_PASSED },
  {
    command: `echo '{"disableAllHooks": true}' >${ticked(LOCAL_SETTINGS)}`,
    target: LOCAL_SETTINGS,
  },
];
const LOOP3_D120_DOLLAR = [
  { command: `printf x >$(printf ${GATE_PASSED})`, target: GATE_PASSED },
  { command: `printf x > "$(printf ${LOCAL_SETTINGS})"`, target: LOCAL_SETTINGS },
];
const LOOP3_D120_TICKED_UNPROTECTED = [
  `printf x >${ticked('notes.md')}`,
  `printf x > ${ticked('.claude/agents/x.md')}`,
];

describe('BUG-36, review loop 3: the global guard-bash judges a redirect into a command substitution by the path it names (D-120)', () => {
  // Fails today: allowed, for the main session and a subagent.
  test.each(LOOP3_D120_TICKED)(
    'BUG-36: refused for the main session and a subagent, naming D-120 and the file, though the target is a backtick substitution: $command (review loop 3, privacy-security-reviewer)',
    ({ command, target }) => {
      const verdicts = loop1VerdictsOf(command);
      const main = runHook('guard-bash.mjs', { args: D120_ARGS_WITH_FOLDER, input: bash(command) });

      expect(verdicts).toEqual({ command, main: 'refused', subagent: 'refused' });
      expect(main.stderr).toContain(`this would change ${target},`);
    },
  );

  // Fails today: allowed. Only the subagent's verdict is held: what the main
  // session may do to its own phase file this way is not what this is about.
  test('BUG-36: a subagent may not redirect into a backtick substitution that names the phase file: refused, naming D-120 (review loop 3, privacy-security-reviewer)', () => {
    expect(loop1VerdictsOf(`printf 'red:BUG-1\\n' >${ticked(PHASE)}`).subagent).toBe('refused');
  });

  // Passes today, on purpose.
  test.each(LOOP3_D120_DOLLAR)(
    'BUG-36: still refused for the main session and a subagent, naming D-120 and the file, when the target is a $( substitution: $command (review loop 3, privacy-security-reviewer)',
    ({ command, target }) => {
      const verdicts = loop1VerdictsOf(command);
      const main = runHook('guard-bash.mjs', { args: D120_ARGS_WITH_FOLDER, input: bash(command) });

      expect(verdicts).toEqual({ command, main: 'refused', subagent: 'refused' });
      expect(main.stderr).toContain(`this would change ${target},`);
    },
  );

  // Passes today, on purpose: seeing the redirect must not refuse every
  // substitution, only one that names a path D-120 protects.
  test.each(LOOP3_D120_TICKED_UNPROTECTED)(
    'BUG-36: allowed for the main session and a subagent, because the substitution names no path D-120 protects: %s (review loop 3, privacy-security-reviewer)',
    (command) => {
      expect(loop1VerdictsOf(command)).toEqual({ command, main: 'allowed', subagent: 'allowed' });
    },
  );
});

// BUG-36, review loop 3, test-auditor: a false positive. Loop 2's `>&` rule
// reads the target of a quoted 2>&1 with the closing quote stuck to it: in
// bash -c "x 2>&1" the target is `1"`, not a number, so the guard counts a
// write to a file. bash writes no file there: the quote only closes the
// string, and the inner shell copies a file descriptor; test-author ran it.
// So --readonly refuses bash -c "pnpm vitest run 2>&1" | tail, and D-120's
// global guard refuses bash -c "git diff -- .claude 2>&1"; at 1f7ce47 both
// were allowed. The `1>&-` row and the role rows go beyond the reviewer's
// list: the same quote after a descriptor `-` or in a role's guard.
const LOOP3_READONLY_QUOTED_DUP = [
  'bash -c "pnpm vitest run 2>&1" | tail',
  "bash -c 'pnpm vitest run 2>&1' | tail",
  'bash -c "git diff main >&2"',
  "bash -c 'git diff main >&2'",
  'bash -c "git diff main 1>&-"',
];
const LOOP3_D120_QUOTED_DUP = [
  'bash -c "git diff -- .claude 2>&1"',
  "bash -c 'git diff -- .claude 2>&1'",
  `bash -c "cat ${LOCAL_SETTINGS} >&2"`,
  `bash -c 'cat ${GATE_PASSED} >&2'`,
];
const LOOP3_ROLE_QUOTED_DUP = [
  { agent: 'implementer', command: 'bash -c "grep -c x apps/server/src/x.test.ts 2>&1"' },
  { agent: 'test-author', command: "bash -c 'grep -c x apps/server/src/domain/journey.ts >&2'" },
];

// The other side: a quote does not turn a file into a file descriptor.
const LOOP3_READONLY_QUOTED_DUP_TO_FILE = [
  'bash -c "printf x >&verdict.txt"',
  "bash -c 'printf x >&verdict.txt'",
];
const LOOP3_D120_QUOTED_DUP_TO_FILE = [
  { command: `bash -c "printf x >&${GATE_PASSED}"`, target: GATE_PASSED },
  { command: `bash -c 'printf x >&${LOCAL_SETTINGS}'`, target: LOCAL_SETTINGS },
];

// test-auditor: the `$` that ends loop 2's descriptor pattern was pinned by
// no test. bash writes a file named 2file here, test-author ran it; a pattern
// without the `$` reads 2file as descriptor 2 and lets the write through,
// which test-author showed with a copy of the guard that drops it.
const LOOP3_READONLY_DIGIT_FILE = ['printf x >&2file', 'bash -c "printf x >&2file"'];

describe('BUG-36, review loop 3: a quote after `>&` and a file descriptor does not make a write to a file (HK-03, D-120, RG-03)', () => {
  // Fails today: refused as output redirection.
  test.each(LOOP3_READONLY_QUOTED_DUP)(
    'BUG-36: allowed for a read-only reviewer, because the quoted `>&` only copies or closes a file descriptor: %s (review loop 3, test-auditor)',
    (command) => {
      const result = guard(command, LOOP2_READONLY_ARGS);

      expect({ command, status: result.status }, `the guard said: ${result.stderr}`).toEqual({
        command,
        status: ALLOWED,
      });
    },
  );

  // Fails today: refused, for the main session and a subagent.
  test.each(LOOP3_D120_QUOTED_DUP)(
    'BUG-36: allowed for the main session and a subagent, because the quoted `>&` only copies a file descriptor: %s (review loop 3, test-auditor)',
    (command) => {
      expect(loop1VerdictsOf(command)).toEqual({ command, main: 'allowed', subagent: 'allowed' });
    },
  );

  // Fails today: refused.
  test.each(LOOP3_ROLE_QUOTED_DUP)(
    'BUG-36: allowed for $agent by its own frontmatter guard, because the quoted `>&` only copies a file descriptor: $command (review loop 3, test-auditor)',
    ({ agent, command }) => {
      expect({ agent, command, verdict: roleVerdictOf(agent, command) }).toEqual({
        agent,
        command,
        verdict: 'allowed',
      });
    },
  );

  // Passes today, on purpose.
  test.each(LOOP3_READONLY_QUOTED_DUP_TO_FILE)(
    'BUG-36: still refused for a read-only reviewer as output redirection when the quoted `>&` names a file: %s (review loop 3, test-auditor)',
    (command) => {
      const result = guard(command, LOOP2_READONLY_ARGS);

      expect({ command, status: result.status }, `the guard said: ${result.stderr}`).toEqual({
        command,
        status: BLOCKED,
      });
      expect(result.stderr).toContain('redirection');
    },
  );

  // Passes today, on purpose.
  test.each(LOOP3_D120_QUOTED_DUP_TO_FILE)(
    'BUG-36: still refused for the main session and a subagent, naming D-120 and the file, when the quoted `>&` names a file: $command (review loop 3, test-auditor)',
    ({ command, target }) => {
      const verdicts = loop1VerdictsOf(command);
      const main = runHook('guard-bash.mjs', { args: D120_ARGS_WITH_FOLDER, input: bash(command) });

      expect(verdicts).toEqual({ command, main: 'refused', subagent: 'refused' });
      expect(main.stderr).toContain(`this would change ${target},`);
    },
  );

  // Passes today, on purpose: it pins the `$`.
  test.each(LOOP3_READONLY_DIGIT_FILE)(
    'BUG-36: refused for a read-only reviewer as output redirection, because `>&2file` writes a file named 2file: %s (review loop 3, test-auditor)',
    (command) => {
      const result = guard(command, LOOP2_READONLY_ARGS);

      expect({ command, status: result.status }, `the guard said: ${result.stderr}`).toEqual({
        command,
        status: BLOCKED,
      });
      expect(result.stderr).toContain('redirection');
    },
  );
});
