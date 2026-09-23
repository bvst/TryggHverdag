// CI-12: which diffs leave the code gates nothing to check.
//
// Test names carry no <ID>-ACn: prefix. CI- is not a tracked requirement —
// req:coverage does not collect the prefix and it appears zero times in
// docs/requirements-status.md — so these prove nothing it counts. That is the
// exemption D-074 keys to what a test proves rather than to a directory.
import { describe, expect, test } from 'vitest';
import { onlyInert, reasons } from './affected.mjs';

describe('onlyInert', () => {
  test('a documentation-only diff leaves the code gates nothing to check', () => {
    expect(onlyInert(['docs/progress.md', 'docs/plan/decisions.md', 'README.md'])).toBe(true);
  });

  test('one source file among the documents makes the whole diff count', () => {
    // The asymmetry this repository cares about: running a gate that had
    // nothing to find costs a minute; skipping one that did costs a defect on
    // main with a green tick over it.
    expect(onlyInert(['docs/progress.md', 'apps/server/src/domain/journey.ts'])).toBe(false);
  });

  test('a hook change is never inert, however small', () => {
    // .claude/hooks/ is tested by test:hooks and linted by gate:static. It sits
    // under .claude/, which is otherwise full of prose, so it is the easiest
    // thing here to get wrong.
    expect(onlyInert(['.claude/hooks/progress-gate.mjs'])).toBe(false);
  });

  test('the gates themselves are never inert', () => {
    expect(onlyInert(['scripts/lib/merge-rules.mjs'])).toBe(false);
    expect(onlyInert(['.github/workflows/ci.yml'])).toBe(false);
  });

  test('reviewer memory is inert; a reviewer brief is not', () => {
    // .claude/agent-memory/ is written by reviewers between runs and read by
    // nobody else — CODEOWNERS exempts it for the same reason. A brief under
    // .claude/agents/ decides what a reviewer does, and is not inert.
    expect(onlyInert(['.claude/agent-memory/code-reviewer.md'])).toBe(true);
    expect(onlyInert(['.claude/agents/code-reviewer.md'])).toBe(false);
  });

  test('markdown anywhere is inert, matching what .prettierignore excludes', () => {
    expect(onlyInert(['apps/mobile/README.md', 'packages/test-kit/NOTES.md'])).toBe(true);
  });

  test('the merge ruleset under docs/ is never inert, because a test reads it', () => {
    // docs/plan/main-ruleset.json is parsed and asserted on by
    // scripts/gate.test.mjs, so a change to it really can fail `unit`. An
    // earlier draft treated everything under docs/ as prose and would have
    // marked a change to the merge rules as nothing to check. Restricting the
    // rule to markdown excludes this file for free.
    expect(onlyInert(['docs/plan/main-ruleset.json'])).toBe(false);
    expect(onlyInert(['docs/plan/decisions.md'])).toBe(true);
  });

  test('CLAUDE.md is configuration, not prose', () => {
    // It states the non-negotiables and is loaded into every session. It is
    // also, inconveniently, a markdown file at the repository root.
    expect(onlyInert(['CLAUDE.md'])).toBe(false);
    expect(onlyInert(['.claude/rules/tests.md'])).toBe(false);
    expect(onlyInert(['.claude/skills/status/SKILL.md'])).toBe(false);
    // And the contrast that makes the rule a rule rather than a list:
    expect(onlyInert(['README.md'])).toBe(true);
  });

  test('a lockfile change is never inert', () => {
    // security runs pnpm audit and licenses:check against exactly this.
    expect(onlyInert(['pnpm-lock.yaml'])).toBe(false);
  });

  test('an empty diff has nothing to check, and says so rather than guessing', () => {
    expect(onlyInert([])).toBe(true);
  });
});

describe('reasons', () => {
  test('names the files that made the diff count', () => {
    // So a job log can answer "why did the whole suite run for a typo fix"
    // without anyone reconstructing it from the diff.
    expect(reasons(['docs/progress.md', 'scripts/gate.mjs', 'README.md'])).toEqual([
      'scripts/gate.mjs',
    ]);
  });

  test('is empty exactly when the diff is inert', () => {
    expect(reasons(['docs/progress.md'])).toEqual([]);
  });
});
