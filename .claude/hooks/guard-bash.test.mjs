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
