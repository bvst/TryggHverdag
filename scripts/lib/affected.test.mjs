// CI-12: which diffs leave the code gates nothing to check.
//
// Test names carry no <ID>-ACn: prefix. CI- is not a tracked requirement —
// req:coverage does not collect the prefix and it appears zero times in
// docs/requirements-status.md — so these prove nothing it counts. That is the
// exemption D-074 keys to what a test proves rather than to a directory.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

  test('an issue template is configuration, not prose', () => {
    // scripts/daily-status.test.mjs holds the owner-question template's label
    // to the ones the daily report creates, so changing the template alone
    // really can fail `unit`. Before INF-09 this read as markdown and was
    // inert — the .claude/agents/*.md mistake again, one directory over.
    expect(onlyInert(['.github/ISSUE_TEMPLATE/owner-question.md'])).toBe(false);
    expect(onlyInert(['.github/pull_request_template.md'])).toBe(false);
  });

  test('a lockfile change is never inert', () => {
    // security runs pnpm audit and licenses:check against exactly this.
    expect(onlyInert(['pnpm-lock.yaml'])).toBe(false);
  });

  test('an empty diff has nothing to check, and says so rather than guessing', () => {
    // Safe only because scripts/affected.mjs refuses to call this at all when
    // the merge base will not resolve. Without that guard this answer is the
    // most dangerous one in the file: changedFiles() swallows a failed git call,
    // so "could not work out what changed" and "nothing changed" arrive here as
    // the same empty list — and every gate in every job would report nothing to
    // check and pass. The guard is tested below.
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

// Every run of scripts/affected.mjs in this file goes through runAffected, and
// the environment it runs in is pinned rather than inherited.
//
// The script reads two variables. GITHUB_EVENT_NAME picks its path: any value
// but pull_request is an event with no base to compare with, so the script
// prints code=true and exits 0 before it looks at the merge base at all. That is
// correct for a push. GITHUB_OUTPUT is a file the script appends its answer to.
// A run that inherits the environment inherits both from whatever is running
// the tests, and in CI that is a GitHub Actions job.
//
// That is how main went red on every push from #17 on. The unresolvable-base
// test inherited GITHUB_EVENT_NAME=push from the push-to-main run, took the push
// shortcut, exited 0, and failed. On a pull request the variable says
// pull_request and on a laptop it is unset, so the test passed in both places
// and nobody saw it before merge. The resolvable-base test had the same flaw
// with the opposite symptom: on a push it took the shortcut too, and passed
// without testing what its name says. That silent twin is the worse of the two,
// because nothing turned red. And every run inherited GITHUB_OUTPUT, the ones
// that did pin the event included, so in CI each run that got as far as an
// answer appended a code= line to the outputs of the step running the tests. No
// step reads those today, and a test has no business writing them.
//
// So `event` is required and has no default: every test states which path it
// exercises. A string sets GITHUB_EVENT_NAME. null removes it, which is a local
// run, and the script treats that like pull_request. GITHUB_OUTPUT is always
// removed. The last test in this file runs all of this inside a push job's
// environment, so that it stays true.
function runAffected(args, { event, cwd }) {
  if (event === undefined) {
    throw new Error('runAffected needs an event: "pull_request", "push", or null for a local run.');
  }
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  if (event === null) {
    delete env.GITHUB_EVENT_NAME;
  } else {
    env.GITHUB_EVENT_NAME = event;
  }
  // Resolved against this process's working directory, the repository root, so
  // the script is still found when cwd points somewhere else.
  return spawnSync(process.execPath, [resolve('scripts/affected.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
    env,
  });
}

// The two paths on which the merge-base guard applies. A push never reaches it,
// and the push-to-main test below covers that path.
const GUARDED = [
  { event: 'pull_request', label: 'a pull request' },
  { event: null, label: 'a local run' },
];

describe('the script refuses to guess', () => {
  test.each(GUARDED)(
    'an unresolvable base fails loudly instead of reporting "nothing to check", on $label',
    ({ event }) => {
      // The whole design rests on changedFiles(), which swallows a git call that
      // fails. If the base cannot resolve, it returns an empty list on a clean
      // checkout, onlyInert([]) is true, and every guarded step in every job sits
      // out and passes. This runs the real script against a branch that does not
      // exist, and requires it to exit non-zero rather than print code=false.
      const result = runAffected(['--base', 'origin/no-such-branch-exists'], { event });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).not.toContain('code=false');
      expect(`${result.stdout}${result.stderr}`).toContain('not knowing is not the same');
    },
  );

  test('a push to main runs everything, because it has no base to compare with', () => {
    // ci.yml runs on push to main as well as on pull requests. There,
    // github.base_ref is empty, the base falls back to origin/main — and
    // origin/main IS the commit just pushed. HEAD against itself is empty, so
    // every guarded step in six of seven jobs would sit out while each job
    // reported success: every required check on main's own commits decorative.
    // code-reviewer blocked #17 over it.
    //
    // This builds the condition rather than approximating it. A first draft ran
    // the script here with --base HEAD and asserted code=true — and passed with
    // the guard removed, because this working tree is dirty and so the diff was
    // never empty. A test of a silent-pass bug that cannot see the bug is the
    // thing this whole pull request is about.
    const dir = mkdtempSync(join(tmpdir(), 'affected-push-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      git('init', '-q', '-b', 'main');
      git('config', 'user.email', 'test@example.invalid');
      git('config', 'user.name', 'Test');
      writeFileSync(join(dir, 'app.ts'), 'export const x = 1;\n');
      git('add', '-A');
      git('commit', '-qm', 'initial');
      // origin/main at the same commit: exactly what a push-to-main checkout has.
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');

      const run = (event) => runAffected(['--base', 'origin/main'], { event, cwd: dir });

      // The condition really is an empty diff: a pull_request event here says
      // there is nothing to check. That is the false green the guard prevents.
      expect(run('pull_request').stdout).toContain('code=false');
      // And on a push, the guard turns it into "run everything".
      const push = run('push');
      expect(push.status).toBe(0);
      expect(push.stdout).toContain('code=true');
      expect(push.stdout).not.toContain('code=false');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a pull request event still classifies normally', () => {
    // The guard must not swallow the case it exists to serve. Asserted on the
    // guard not firing, rather than on a particular verdict: the verdict
    // depends on the working tree, and a first draft of this test assumed a
    // clean one and failed on a dirty one. What matters here is which path was
    // taken, so that is what it checks.
    const result = runAffected(['--base', 'HEAD'], { event: 'pull_request' });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('not a pull request');
    expect(result.stdout).toMatch(/^code=(true|false)$/m);
  });

  test('it imports nothing the runner might not have', () => {
    // This script runs before actions/setup-node, on whatever Node the runner
    // ships. 8a7280e wrote that constraint into a comment — "stable Node
    // built-ins and repository-local modules, never a dependency" — and nothing
    // enforced it, which test-auditor pointed out is a claim rather than a
    // check. A dependency here would not fail a test; it would fail on the
    // runner, before any gate had a chance to report.
    const source = readFileSync('scripts/affected.mjs', 'utf8');
    const specifiers = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);

    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier, `${specifier} is neither a Node built-in nor a local module`).toMatch(
        /^(node:|\.\/)/,
      );
    }
  });

  test.each(GUARDED)('a resolvable base still answers, on $label', ({ event }) => {
    // The contrast: the guard must reject only the unanswerable case, not
    // every case. HEAD always resolves against itself.
    //
    // The push shortcut also exits 0 with a code= line, so the status and the
    // code= line cannot tell the paths apart. This test passed through the
    // shortcut on every push to main while checking nothing its name says. The
    // pinned event stops that, and the expectation on "not a pull request"
    // makes sure it stays stopped.
    const result = runAffected(['--base', 'HEAD'], { event });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('not a pull request');
    expect(result.stdout).toMatch(/^code=(true|false)$/m);
  });
});

describe('the environment these tests run in', () => {
  test('cannot pick the path a test takes, or receive its output', () => {
    // The conditions main went red in, rebuilt in this process: a push-to-main
    // job with a step-output file of its own. Every run below must behave as if
    // neither were there. Both variables are restored however this ends, so
    // nothing that runs after this test inherits them.
    const dir = mkdtempSync(join(tmpdir(), 'affected-job-'));
    const output = join(dir, 'github-output');
    writeFileSync(output, '');
    const before = {
      GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME,
      GITHUB_OUTPUT: process.env.GITHUB_OUTPUT,
    };
    process.env.GITHUB_EVENT_NAME = 'push';
    process.env.GITHUB_OUTPUT = output;
    try {
      // The failure itself: a run that names pull_request meets the guard, not
      // the push shortcut this job's own event would have picked. And a run
      // that names no event at all, because null has to remove the job's value
      // rather than keep it, and only a job that has one can show the difference.
      for (const { event, label } of GUARDED) {
        const guarded = runAffected(['--base', 'origin/no-such-branch-exists'], { event });
        expect(guarded.status, label).not.toBe(0);
        expect(`${guarded.stdout}${guarded.stderr}`, label).toContain(
          'not knowing is not the same',
        );
      }

      // The guard exits before the script writes anything, so those runs would
      // leave the file empty even if GITHUB_OUTPUT leaked through. These two
      // runs reach the two places the script does write, the push shortcut and
      // the normal answer, and each prints its answer just before writing it.
      const shortcut = runAffected(['--base', 'HEAD'], { event: 'push' });
      expect(shortcut.stdout).toMatch(/^code=true$/m);
      const answered = runAffected(['--base', 'HEAD'], { event: 'pull_request' });
      expect(answered.stdout).toMatch(/^code=(true|false)$/m);

      expect(readFileSync(output, 'utf8')).toBe('');
    } finally {
      for (const [name, value] of Object.entries(before)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
