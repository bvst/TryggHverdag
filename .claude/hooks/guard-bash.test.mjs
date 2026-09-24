// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-03: the shell is the way around every other guard, so it has its own.
// Two independent layers protect the same rules: these checks and the deny list
// in .claude/settings.json.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { ALLOWED, BLOCKED, bash, runHook } from './test-helpers.mjs';

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
    'gh workflow list',
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
  });
});

describe('HK-03: an empty command', () => {
  test('passes through', () => {
    const result = runHook('guard-bash.mjs', { args: ['--global'], input: bash('') });
    expect(result.status).toBe(ALLOWED);
  });
});
