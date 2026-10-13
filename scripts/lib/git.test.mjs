// BUG-7: a moved file was listed only under its new path.
//
// changedFiles() asks `git diff --name-only`, and git's rename detection (on by
// default since git 2.9) reports a moved file once, under the path it moved
// to. Every gate that asks "what does this change touch?" then never hears the
// path it moved from. safety-reviewer found it on INF-06 (2026-09-26) and
// measured it with the real modules:
//
//   - moving the Maestro flow from apps/mobile/e2e/ to a folder outside the
//     app gives app=false;
//   - moving apps/mobile/src/app/index.tsx to docs/old-index.md gives app=false
//     and code=false, so every code gate on that pull request prints "nothing
//     to check".
//
// The full run on main catches it after the merge, but the pull request is
// green. A file that leaves a path has changed that path as surely as a file
// deleted from it, so both paths belong in the list.
//
// Test names carry no <ID>-ACn: prefix: a bug's tests are named BUG-<n>, and
// BUG- is not a requirement prefix req:coverage collects.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { decideMutation } from './gate-decisions.mjs';
import { changedFiles, mergeBase, requireMergeBase } from './git.mjs';

const repos = [];
afterEach(() => {
  for (const dir of repos.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Twenty lines, so that changing one of them leaves the file 95 % similar to
// what it was. git pairs a deletion and an addition as a rename when they are
// at least 50 % alike, so this edit is still reported as a move (R095), not as
// a deletion and an addition. A two-line file with one line changed would fall
// under the threshold and be listed under both paths already, testing nothing.
const TWENTY_LINES = `${Array.from({ length: 20 }, (_, n) => `export const line${String(n)} = ${String(n)};`).join('\n')}\n`;

/**
 * A repository checked out the way a pull request is: origin/main at the first
 * commit, which holds `from`, and the branch `the-pull-request` on top of it.
 * The branch moves `from` to `to` with `git mv`, changes one line of it when
 * `edited`, and commits the move when `committed`. Left uncommitted, the move
 * is staged, as `git mv` leaves it, and any edit is not.
 */
function movingRepo({ from, to, edited, committed }) {
  const dir = mkdtempSync(join(tmpdir(), 'bug7-git-'));
  repos.push(dir);
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  // git's own default, set here so that a developer whose global config turns
  // rename detection off does not see these tests pass on a list that is
  // still wrong everywhere else.
  git('config', 'diff.renames', 'true');
  mkdirSync(dirname(join(dir, from)), { recursive: true });
  writeFileSync(join(dir, from), TWENTY_LINES);
  writeFileSync(join(dir, 'README.md'), '# Fixture\n');
  git('add', '-A');
  git('commit', '-qm', 'main');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'the-pull-request');
  mkdirSync(dirname(join(dir, to)), { recursive: true });
  git('mv', from, to);
  if (edited) {
    const text = readFileSync(join(dir, to), 'utf8');
    writeFileSync(join(dir, to), text.replace('line3 = 3;', 'line3 = 33;'));
  }
  if (committed) {
    git('add', '-A');
    git('commit', '-qm', 'the pull request');
  }
  return dir;
}

// safety-reviewer's second measurement: the app's entry point, moved to docs/.
const FROM = 'apps/mobile/src/app/index.tsx';
const TO = 'docs/old-index.md';

// Every way a move reaches changedFiles: committed on the branch, so through
// the diff against the merge base, or still in the working tree, so through the
// diff against HEAD; and a pure move or one with an edit, which git reports
// with different similarity scores.
const MOVES = [
  { how: 'a pure move, committed on the branch', edited: false, committed: true },
  { how: 'a move with an edit, committed on the branch', edited: true, committed: true },
  { how: 'a pure move, not yet committed', edited: false, committed: false },
  { how: 'a move with an edit, not yet committed', edited: true, committed: false },
];

describe('changedFiles', () => {
  test.each(MOVES)(
    'BUG-7: $how lists the path the file left as well as the path it went to',
    ({ edited, committed }) => {
      const dir = movingRepo({ from: FROM, to: TO, edited, committed });
      // The condition itself: git pairs the two paths as one move, R100 for
      // the pure one and R095 for the edited one. origin/main against the
      // working tree covers both the committed and the uncommitted case.
      const status = execFileSync('git', ['diff', '--name-status', 'origin/main'], {
        cwd: dir,
        encoding: 'utf8',
      });
      expect(status).toMatch(new RegExp(`^R\\d{3}\\t${FROM}\\t${TO}$`, 'm'));

      const changed = changedFiles({ base: 'origin/main', cwd: dir });

      expect(changed).toContain(TO);
      expect(changed).toContain(FROM);
      // And nothing else: README.md did not change, and a list padded with
      // every file in the repository would pass the two lines above.
      expect(changed).toEqual([FROM, TO]);
    },
  );
});

// mutation.mjs hands changedFiles() straight to decideMutation(), so this is
// the decision the mutation job makes on such a pull request, from the same
// two functions it uses. Safety code moved out of SAFETY_PATHS is safety code
// this change touched: its tests may have gone with it, and a mutation run is
// how anyone would find out.
describe('the mutation decision on a pull request that moves safety code out', () => {
  test('BUG-7: moving a safety file to docs/ is a change to safety code, not "touches no safety code"', () => {
    const safetyFile = 'apps/server/src/domain/journey.ts';
    const dir = movingRepo({
      from: safetyFile,
      to: 'docs/old-journey.md',
      edited: false,
      committed: true,
    });

    const decision = decideMutation({
      changed: changedFiles({ base: 'origin/main', cwd: dir }),
      onlyIfSafetyPathsChanged: true,
      configured: true,
    });

    expect(decision.message).not.toContain('touches no safety code');
    expect(decision).toMatchObject({ ok: true, action: 'run' });
    expect(decision.message).toContain('1 changed safety file');
  });
});

// BUG-46 (D-131): three gates passed quietly on a base git cannot resolve.
//
// mutation.mjs (--only-if-safety-paths-changed and --plan), tests-changes.mjs
// (RG-03) and coverage-ratchet.mjs (RG-04) read what changed against a base
// branch. When `git merge-base HEAD <base>` fails, changedFiles() drops the
// committed diff, and each gate then said what an empty diff says: "nothing
// to mutate", "nothing to compare against", "0 changed file(s), no coverage
// went down", and exited 0. All three were reproduced on 2026-10-13 with
// `--base origin/no-such-branch`. affected.mjs already refused this case.
//
// The owner's answer, D-131: each refuses such a base, exiting 1 with a plain
// message that names the base and says it could not tell, rather than
// reporting nothing to check, through one shared helper in git.mjs. These
// tests hold the helper's contract; the entry-point tests in
// scripts/mutation.test.mjs, scripts/tests-changes.test.mjs and
// scripts/lib/coverage.test.mjs hold each gate to it:
//
//   requireMergeBase(base, cwd = process.cwd())
//     → { ok: true, mergeBase }   the commit `git merge-base HEAD <base>` names
//     | { ok: false, message }    names `base`, says it could not tell what
//                                 changed, and never that nothing did
//
// requireMergeBase is a new export; until it exists, these tests fail on that.

/** "Could not tell", in D-131's words or close to them. */
const COULD_NOT_TELL = /\b(could not|cannot|can not|can't) tell\b/i;

/** What the three gates said of a base they could not resolve: each a claim that nothing changed. */
const NOTHING_CHANGED = [
  'nothing to compare against',
  'none weakened',
  'no coverage went down',
  '0 changed file(s)',
  'nothing to mutate',
  'touches no safety code',
];

/**
 * A repository checked out the way a pull request is: origin/main at a first
 * commit, and the branch `the-pull-request` one commit on top of it.
 */
function pullRequestRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'bug46-git-'));
  repos.push(dir);
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README.md'), '# Fixture\n');
  git('add', '-A');
  git('commit', '-qm', 'main');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'the-pull-request');
  writeFileSync(join(dir, 'notes.md'), 'A synthetic change.\n');
  git('add', '-A');
  git('commit', '-qm', 'the pull request');
  return { dir, git };
}

/** Every way `git merge-base HEAD <base>` fails, so that mergeBase() gives null. */
const UNRESOLVABLE = [
  {
    what: 'a branch that does not exist',
    base: 'origin/no-such-branch',
    make: () => pullRequestRepo().dir,
  },
  {
    // What tests:changes called "no common history".
    what: 'a branch that shares no history with HEAD',
    base: 'unrelated',
    make: () => {
      const { dir, git } = pullRequestRepo();
      const root = git('commit-tree', 'HEAD^{tree}', '-m', 'unrelated').trim();
      git('update-ref', 'refs/heads/unrelated', root);
      return dir;
    },
  },
  {
    what: 'a repository with no commit yet',
    base: 'origin/main',
    make: () => {
      const dir = mkdtempSync(join(tmpdir(), 'bug46-git-'));
      repos.push(dir);
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' });
      return dir;
    },
  },
  {
    // How coverage:ratchet's own tests ran it until BUG-46.
    what: 'a folder that is not a git repository',
    base: 'origin/main',
    make: () => {
      const dir = mkdtempSync(join(tmpdir(), 'bug46-git-'));
      repos.push(dir);
      return dir;
    },
  },
];

describe('BUG-46: requireMergeBase, the one check the gates that compare against a base share (D-131)', () => {
  test('BUG-46: a base that resolves gives the commit `git merge-base HEAD <base>` names', () => {
    const { dir, git } = pullRequestRepo();
    const expected = git('merge-base', 'HEAD', 'origin/main').trim();
    // The condition: the merge base is origin/main itself, not HEAD.
    expect(expected).toBe(git('rev-parse', 'origin/main').trim());
    expect(expected).not.toBe(git('rev-parse', 'HEAD').trim());

    expect(requireMergeBase('origin/main', dir)).toEqual({ ok: true, mergeBase: expected });
  });

  test.each(UNRESOLVABLE)(
    'BUG-46: $what: it refuses, naming the base and saying it could not tell, never that nothing changed',
    ({ base, make }) => {
      const dir = make();
      // The condition itself: this is a base mergeBase() cannot resolve.
      expect(mergeBase(base, dir)).toBeNull();

      const result = requireMergeBase(base, dir);

      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty('mergeBase');
      expect(result.message).toContain(base);
      expect(result.message).toMatch(COULD_NOT_TELL);
      for (const claim of NOTHING_CHANGED) {
        expect(result.message).not.toContain(claim);
      }
    },
  );
});
