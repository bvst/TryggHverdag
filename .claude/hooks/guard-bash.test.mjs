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

describe('HK-03: an empty command', () => {
  test('passes through', () => {
    const result = runHook('guard-bash.mjs', { args: ['--global'], input: bash('') });
    expect(result.status).toBe(ALLOWED);
  });
});
