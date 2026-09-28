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
import { changedFiles } from './git.mjs';

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
