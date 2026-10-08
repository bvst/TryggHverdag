// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-06: "done" means the gate passed. A session cannot finish on a red gate
// without that being written down where the next session will see it.
import { afterEach, describe, expect, test } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  ALLOWED,
  BLOCKED,
  HOOKS_DIR,
  fakeScripts,
  makeRepo,
  removeRepo,
  runHook,
  write,
} from './test-helpers.mjs';

const PASSES = {};
const FAILS = { exitCode: 1, output: '2 tests failed' };

const repos = [];
function repoWith(scripts, extraFiles = {}) {
  const dir = makeRepo(fakeScripts(scripts));
  repos.push(dir);
  write(dir, extraFiles);
  return dir;
}

function ranLog(dir) {
  try {
    return readFileSync(path.join(dir, 'ran.txt'), 'utf8');
  } catch {
    return '';
  }
}

const stop = (dir, input = {}, args = []) => runHook('stop-gate.mjs', { args, input, cwd: dir });

afterEach(() => {
  while (repos.length > 0) {
    removeRepo(repos.pop());
  }
});

describe('HK-06: with code changed', () => {
  test('a passing gate lets the session finish', () => {
    const dir = repoWith(
      { 'gate:quick': PASSES },
      { 'apps/server/src/api.ts': 'export const a = 1;' },
    );
    expect(stop(dir).status).toBe(ALLOWED);
    expect(ranLog(dir)).toContain('gate:quick');
  });

  test('a failing gate refuses, and says which gate and why', () => {
    const dir = repoWith(
      { 'gate:quick': FAILS },
      { 'apps/server/src/api.ts': 'export const a = 1;' },
    );
    const result = stop(dir);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('gate:quick');
    expect(result.stderr).toContain('RG-01');
    expect(result.stderr).toContain('2 tests failed');
  });

  test('a passing gate clears an old failure note', () => {
    const dir = repoWith(
      { 'gate:quick': PASSES },
      { 'apps/server/src/api.ts': 'export const a = 1;', '.claude/state/gate-failed': 'old' },
    );
    expect(stop(dir).status).toBe(ALLOWED);
    expect(existsSync(path.join(dir, '.claude/state/gate-failed'))).toBe(false);
  });
});

describe('HK-06: when Claude has already been asked to continue once', () => {
  test('it writes the failure down instead of looping forever', () => {
    const dir = repoWith(
      { 'gate:quick': FAILS },
      { 'apps/server/src/api.ts': 'export const a = 1;' },
    );
    const result = stop(dir, { stop_hook_active: true });
    expect(result.status).toBe(ALLOWED);
    const note = readFileSync(path.join(dir, '.claude/state/gate-failed'), 'utf8');
    expect(note).toContain('gate:quick failed');
    expect(note).toContain('2 tests failed');
  });
});

describe('HK-06: during the red phase of /feature', () => {
  test('only the static checks run, because the tests are meant to fail', () => {
    const dir = repoWith(
      { 'gate:quick': FAILS, 'gate:static': PASSES },
      { 'apps/server/src/api.ts': 'export const a = 1;', '.claude/state/phase': 'red:LOST-02' },
    );
    expect(stop(dir).status).toBe(ALLOWED);
    expect(ranLog(dir)).toContain('gate:static');
    expect(ranLog(dir)).not.toContain('gate:quick');
  });

  test('but a subagent finishing still faces the full gate', () => {
    const dir = repoWith(
      { 'gate:quick': FAILS, 'gate:static': PASSES },
      { 'apps/server/src/api.ts': 'export const a = 1;', '.claude/state/phase': 'red:LOST-02' },
    );
    expect(stop(dir, {}, ['--subagent']).status).toBe(BLOCKED);
    expect(ranLog(dir)).toContain('gate:quick');
  });
});

describe('HK-06: when there is nothing to check', () => {
  test('an unchanged repository finishes without running the gate', () => {
    const dir = repoWith({ 'gate:quick': FAILS });
    expect(stop(dir).status).toBe(ALLOWED);
    expect(ranLog(dir)).toBe('');
  });

  test('a documents-only change finishes without running the gate', () => {
    const dir = repoWith({ 'gate:quick': FAILS }, { 'docs/progress.md': '# progress' });
    expect(stop(dir).status).toBe(ALLOWED);
    expect(ranLog(dir)).toBe('');
  });
});

// BUG-7: code moved into docs/ is a code change. The hook asked git for the
// changed paths with rename detection on, which is git's default, and git
// reported the move only under docs/. So the one path that makes it a code
// change never reached the check above, and the session finished without the
// gate. safety-reviewer found this on INF-06, 2026-09-26, beside the same flaw
// in scripts/lib/git.mjs.
const CODE_MOVED_TO_DOCS = [
  { how: 'staged with git mv and not yet committed', committed: false },
  { how: 'committed on a branch', committed: true },
];

describe('HK-06: a move from code to docs/', () => {
  test.each(CODE_MOVED_TO_DOCS)(
    'BUG-7: code moved to docs/, $how, is a code change, so the gate runs',
    ({ committed }) => {
      const from = 'apps/server/src/api.ts';
      const to = 'docs/old-api.md';
      const dir = makeRepo({
        ...fakeScripts({ 'gate:quick': FAILS }),
        [from]: 'export const a = 1;\n',
      });
      repos.push(dir);
      const git = (...args) =>
        execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
      // git's own default, pinned so that a global config cannot hide the move.
      git('config', 'diff.renames', 'true');
      // origin/main at the first commit, as on a pull request's branch.
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      git('checkout', '-q', '-b', 'the-branch');
      mkdirSync(path.join(dir, 'docs'), { recursive: true });
      git('mv', from, to);
      if (committed) {
        git('commit', '-qm', 'move the code into docs');
      }
      // The condition itself: git pairs the two paths as one move.
      expect(git('diff', '--name-status', 'origin/main')).toMatch(
        new RegExp(`^R100\\t${from}\\t${to}$`, 'm'),
      );

      const result = stop(dir);

      expect(ranLog(dir)).toContain('gate:quick');
      expect(result.status).toBe(BLOCKED);
      expect(result.stderr).toContain('2 tests failed');
    },
  );
});

// BUG-31 (HK-06, D-119): the stop gate ran gate:quick at every stop on a branch
// with code changes, even when nothing had changed since it last passed —
// 112 s, then 88 s again with nothing changed. After a green run it now
// remembers which gate ran and a fingerprint of the work as it was before the
// gate ran, and a stop with the same gate and the same fingerprint does not run
// it again. Every test below that *passes* today does so because today's hook
// always runs the gate; those tests are the other half of the change, the
// guard that the memory never skips a gate it must run.

const git = (dir, ...args) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

/** How many times the fake `script` ran, from the log the fake scripts write. */
const runs = (dir, script) =>
  ranLog(dir)
    .split('\n')
    .filter((line) => line.split(' ')[0] === script).length;

/**
 * A feature branch whose committed code differs from origin/main, so the stop
 * gate has work to check with a clean working tree.
 *
 * `ran.txt` is ignored: the fake gate appends its own log there, and without
 * the ignore the gate's run would itself be a new untracked file, a change to
 * the work. `.claude/state/` is deliberately *not* ignored, unlike in this
 * repository, so the hook's own notes show up as untracked files and the tests
 * cover their exclusion from the fingerprint.
 */
function branchRepo(scripts, files = {}) {
  const dir = makeRepo({
    ...fakeScripts(scripts),
    '.gitignore': 'ran.txt\n',
    'apps/server/src/api.ts': 'export const a = 1;\n',
    ...files,
  });
  repos.push(dir);
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(dir, 'checkout', '-q', '-b', 'the-branch');
  write(dir, { 'apps/server/src/api.ts': 'export const a = 2;\n' });
  git(dir, 'commit', '-qam', 'work on the branch');
  return dir;
}

describe('BUG-31: the stop gate does not re-run a gate on unchanged work (HK-06, D-119)', () => {
  test('BUG-31: a second stop with nothing changed does not run the gate again', () => {
    const dir = branchRepo({ 'gate:quick': PASSES });
    write(dir, { 'apps/server/src/journey.ts': 'export const b = 1;\n' });

    expect(stop(dir).status).toBe(ALLOWED);
    expect(stop(dir).status).toBe(ALLOWED);

    expect(runs(dir, 'gate:quick')).toBe(1);
  });

  // Each row: `before` sets up the work the first stop sees, `change` is what
  // happens between the two stops. The rows that edit a file which already
  // differs (a tracked file modified again, an untracked file rewritten) catch
  // a fingerprint built from file names alone; the commit row catches one
  // without HEAD, since the working tree is clean before and after it.
  test.each([
    {
      how: "a tracked file's content changed again",
      before: (dir) => write(dir, { 'apps/server/src/api.ts': 'export const a = 3;\n' }),
      change: (dir) => write(dir, { 'apps/server/src/api.ts': 'export const a = 4;\n' }),
    },
    {
      how: 'a new untracked file',
      before: () => {},
      change: (dir) => write(dir, { 'apps/server/src/journey.ts': 'export const b = 1;\n' }),
    },
    {
      how: "an untracked file's content changed",
      before: (dir) => write(dir, { 'apps/server/src/journey.ts': 'export const b = 1;\n' }),
      change: (dir) => write(dir, { 'apps/server/src/journey.ts': 'export const b = 2;\n' }),
    },
    {
      how: 'a new commit',
      before: () => {},
      change: (dir) => {
        write(dir, { 'apps/server/src/api.ts': 'export const a = 5;\n' });
        git(dir, 'commit', '-qam', 'more work');
      },
    },
    {
      // Passes today, as a guard: the contents hash the same before and after,
      // so only the list of untracked paths tells the two apart. A test that
      // becomes the code it tested is a different piece of work.
      how: 'an untracked file renamed, its contents unchanged',
      before: (dir) => write(dir, { 'apps/server/src/notes.test.ts': 'export const n = 1;\n' }),
      change: (dir) =>
        renameSync(
          path.join(dir, 'apps/server/src/notes.test.ts'),
          path.join(dir, 'apps/server/src/notes.ts'),
        ),
    },
  ])('BUG-31: after a green run, $how runs the gate again', ({ before, change }) => {
    const dir = branchRepo({ 'gate:quick': PASSES });
    before(dir);
    expect(stop(dir).status).toBe(ALLOWED);
    expect(runs(dir, 'gate:quick')).toBe(1);

    change(dir);
    expect(stop(dir).status).toBe(ALLOWED);

    expect(runs(dir, 'gate:quick')).toBe(2);
  });

  test('BUG-31: a failed run is never remembered', () => {
    const dir = branchRepo({ 'gate:quick': FAILS });

    // Already asked to continue once: the hook writes the failure down and
    // lets the session go. That exit 0 must not be mistaken for a pass.
    expect(stop(dir, { stop_hook_active: true }).status).toBe(ALLOWED);
    expect(existsSync(path.join(dir, '.claude/state/gate-failed'))).toBe(true);

    const second = stop(dir);

    expect(runs(dir, 'gate:quick')).toBe(2);
    expect(second.status).toBe(BLOCKED);
    expect(second.stderr).toContain('2 tests failed');
  });

  test("BUG-31: the red phase's static gate and the quick gate are remembered separately", () => {
    const dir = branchRepo({ 'gate:quick': FAILS, 'gate:static': PASSES });
    write(dir, { '.claude/state/phase': 'red:LOST-02' });
    expect(stop(dir).status).toBe(ALLOWED);
    expect(runs(dir, 'gate:static')).toBe(1);

    // The red phase ends; nothing else changes. gate:static passing on this
    // work says nothing about gate:quick, which fails.
    rmSync(path.join(dir, '.claude/state/phase'));
    const result = stop(dir);

    expect(runs(dir, 'gate:quick')).toBe(1);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('2 tests failed');
  });

  test("BUG-31: the main session does not re-run what the implementer's stop just passed", () => {
    const dir = branchRepo({ 'gate:quick': PASSES });

    expect(stop(dir, {}, ['--subagent']).status).toBe(ALLOWED);
    expect(stop(dir).status).toBe(ALLOWED);

    expect(runs(dir, 'gate:quick')).toBe(1);
  });

  // The phase file only ever holds `red:<ID>` while it exists, so the rows that
  // add or remove it give the hook a different gate unless the stop is a
  // subagent's, which always faces gate:quick. Those rows stop as a subagent,
  // so the gate stays the same and only the note changes.
  test.each([
    {
      how: 'a failure note appears',
      args: [],
      change: (dir) => write(dir, { '.claude/state/gate-failed': 'an old failure\n' }),
    },
    {
      how: 'a note of some other hook appears',
      args: [],
      change: (dir) => write(dir, { '.claude/state/progress-missing': 'nothing logged\n' }),
    },
    {
      how: 'the phase marker appears',
      args: ['--subagent'],
      change: (dir) => write(dir, { '.claude/state/phase': 'red:LOST-02' }),
    },
    {
      how: 'the phase marker disappears',
      args: ['--subagent'],
      before: (dir) => write(dir, { '.claude/state/phase': 'red:LOST-02' }),
      change: (dir) => rmSync(path.join(dir, '.claude/state/phase')),
    },
  ])(
    "BUG-31: the hooks' own notes under .claude/state/ are not a change to the work: $how",
    ({ args, before, change }) => {
      const dir = branchRepo({ 'gate:quick': PASSES });
      before?.(dir);
      expect(stop(dir, {}, args).status).toBe(ALLOWED);

      change(dir);
      expect(stop(dir, {}, args).status).toBe(ALLOWED);

      expect(runs(dir, 'gate:quick')).toBe(1);
    },
  );

  test('BUG-31: what is remembered is the work as it was before the gate ran', () => {
    // A file that changes while the gate runs — an editor saving, another
    // process writing — was not what the gate checked. A fingerprint taken
    // after the run would record it as checked, and the next stop would skip
    // the gate on code no gate has seen.
    const dir = branchRepo(
      { 'gate:quick': PASSES },
      {
        'fake-gate-quick.mjs': [
          "import { appendFileSync } from 'node:fs';",
          "appendFileSync('ran.txt', 'gate:quick \\n');",
          "appendFileSync('apps/server/src/journey.ts', '// written while the gate ran\\n');",
        ].join('\n'),
      },
    );

    expect(stop(dir).status).toBe(ALLOWED);
    expect(readFileSync(path.join(dir, 'apps/server/src/journey.ts'), 'utf8')).toContain(
      'written while the gate ran',
    );
    expect(stop(dir).status).toBe(ALLOWED);

    expect(runs(dir, 'gate:quick')).toBe(2);
  });
});

// BUG-31, review loop 1 (D-119): the fingerprint stands for the work only as
// far as git can see it. Whatever git cannot read, or has been told not to look
// at, is something no fingerprint can vouch for, so the gate runs at every stop.
describe('BUG-31: what git cannot vouch for never skips the gate (HK-06, D-119)', () => {
  // Passes today, and is meant to: it is the guard. Today's hook gives up on
  // the fingerprint when git cannot read part of the work, and runs the gate.
  // A fingerprint that fell back to a constant instead would skip the gate for
  // ever after one green run, and no other test here would notice.
  test('BUG-31: an untracked nested repository, which git cannot hash, runs the gate at every stop', () => {
    const dir = branchRepo({ 'gate:quick': PASSES });
    const nested = path.join(dir, 'tools/scratch');
    mkdirSync(nested, { recursive: true });
    git(nested, 'init', '-q');
    write(nested, { 'notes.ts': 'export const c = 1;\n' });
    // The condition itself: git lists the nested repository as one untracked
    // path, and cannot hash it.
    expect(git(dir, 'ls-files', '--others', '--exclude-standard').split('\n')).toContain(
      'tools/scratch/',
    );
    const hashed = spawnSync('git', ['hash-object', '--stdin-paths'], {
      cwd: dir,
      input: 'tools/scratch/\n',
      encoding: 'utf8',
    });
    expect(hashed.status).not.toBe(0);
    expect(hashed.stderr).toContain('Unable to hash');

    expect(stop(dir).status).toBe(ALLOWED);
    expect(stop(dir).status).toBe(ALLOWED);

    expect(runs(dir, 'gate:quick')).toBe(2);
  });

  // A tracked file flagged assume-unchanged or skip-worktree is one git has
  // been told not to look at: a change to it never reaches `git diff`, so a
  // fingerprint built from git's view of the work stays the same while the
  // file does not. With such a flag anywhere, the gate must run.
  test.each([{ flag: '--assume-unchanged' }, { flag: '--skip-worktree' }])(
    'BUG-31: with a tracked file flagged $flag, a change to that file after a green run runs the gate again',
    ({ flag }) => {
      const file = 'apps/server/src/api.ts';
      const dir = branchRepo({ 'gate:quick': PASSES });
      git(dir, 'update-index', flag, file);
      expect(stop(dir).status).toBe(ALLOWED);
      expect(runs(dir, 'gate:quick')).toBe(1);

      write(dir, { [file]: 'export const a = 3;\n' });
      // The condition itself: git does not report the change.
      expect(git(dir, 'diff', '--name-only', 'HEAD')).toBe('');
      expect(stop(dir).status).toBe(ALLOWED);

      expect(runs(dir, 'gate:quick')).toBe(2);
    },
  );
});

// BUG-31, review loop 2 (D-119): a change git normalises away is still a
// change. With core.autocrlf set, `git diff` cleans a file's line endings back
// to LF before it compares, so a tracked file changed only from LF to CRLF has
// an empty diff, though `git status` lists it as modified. The fingerprint is
// built from that diff, so it stayed the same and the second stop skipped the
// gate — while the gate's tools read the file's raw bytes (prettier wants LF)
// and could fail on exactly that change. code-reviewer found it on #68.
describe('BUG-31: a change git normalises away is still a change (HK-06, D-119)', () => {
  test.each([{ autocrlf: 'input' }, { autocrlf: 'true' }])(
    'BUG-31: with core.autocrlf=$autocrlf, a tracked file changed only from LF to CRLF after a green run runs the gate again',
    ({ autocrlf }) => {
      const file = 'apps/server/src/api.ts';
      const dir = branchRepo({ 'gate:quick': PASSES });
      git(dir, 'config', 'core.autocrlf', autocrlf);
      expect(stop(dir).status).toBe(ALLOWED);
      expect(runs(dir, 'gate:quick')).toBe(1);

      // The same text as the branch committed, with CRLF line endings.
      write(dir, { [file]: 'export const a = 2;\r\n' });
      // The condition itself: git lists the file as modified, and its diff
      // against HEAD — the view of the work the fingerprint is built from — is
      // empty.
      expect(git(dir, 'status', '--short', '--', file)).toBe(` M ${file}\n`);
      expect(git(dir, 'diff', 'HEAD', '--binary', '--no-ext-diff', '--no-textconv')).toBe('');
      expect(stop(dir).status).toBe(ALLOWED);

      expect(runs(dir, 'gate:quick')).toBe(2);
    },
  );
});

// BUG-31, review loop 3 (D-119): the same blind spot, one question earlier.
// Before any fingerprint, the hook asks whether any code has changed at all,
// from `git diff --name-only HEAD`, the untracked files and the diff from the
// merge base with origin/main. That diff normalises line endings just as the
// fingerprint's did, so with core.autocrlf set a tracked file changed only
// from LF to CRLF is not listed. When that is the only change — nothing
// untracked, no origin/main — the hook decides nothing changed and exits
// before any gate runs. test-auditor found it on #70.
describe('BUG-31: the check for any code change sees a change git normalises away (HK-06, D-119)', () => {
  test.each([{ autocrlf: 'input' }, { autocrlf: 'true' }])(
    'BUG-31: with core.autocrlf=$autocrlf, a tracked code file changed only from LF to CRLF, and nothing else, runs the gate',
    ({ autocrlf }) => {
      const file = 'apps/server/src/api.ts';
      // Everything committed, the .gitignore for the fake gate's ran.txt too:
      // an untracked .gitignore is not under docs/, so on its own it counts as
      // a code change and the gate would run for that reason instead.
      const dir = makeRepo({
        ...fakeScripts({ 'gate:quick': FAILS }),
        '.gitignore': 'ran.txt\n',
        [file]: 'export const a = 1;\n',
      });
      repos.push(dir);
      git(dir, 'config', 'core.autocrlf', autocrlf);

      // The same text as committed, with CRLF line endings.
      write(dir, { [file]: 'export const a = 1;\r\n' });
      // The condition itself: git lists the file as modified and nothing else,
      // yet every list of changed paths the early check reads is empty —
      // the diff against HEAD, the untracked files, and no origin/main to
      // take a merge base from.
      expect(git(dir, 'status', '--short')).toBe(` M ${file}\n`);
      expect(git(dir, 'diff', '--name-only', '--no-renames', 'HEAD')).toBe('');
      expect(git(dir, 'ls-files', '--others', '--exclude-standard')).toBe('');
      expect(
        spawnSync('git', ['rev-parse', '--verify', '-q', 'refs/remotes/origin/main'], { cwd: dir })
          .status,
      ).not.toBe(0);

      const result = stop(dir);

      expect(ranLog(dir)).toContain('gate:quick');
      expect(result.status).toBe(BLOCKED);
      expect(result.stderr).toContain('2 tests failed');
    },
  );
});

// BUG-31, review loop 4 (D-119): the amendment's known limit, held by a test.
// A `text` or `eol` attribute (such as `* text=auto`) normalises line endings
// out of `git diff` whatever core.autocrlf says, so the hook's
// `-c core.autocrlf=false` does not undo it: a tracked file changed only from
// LF to CRLF would leave the fingerprint the same, and the next stop would
// skip the gate, as in loop 2. The amendment records that the repository sets
// no such attribute, and that adding one needs the fingerprint to hash the
// changed tracked files' contents as well — but nothing held the repository to
// that. CI's test-auditor found it on #70. This test reads the real
// repository, not a fixture, and passes today on purpose: it is the tripwire
// that fails the pull request which adds such an attribute.
const LINE_ENDING_ATTRIBUTES = ['text', 'eol', 'crlf'];

describe("BUG-31: the fingerprint's known limit still holds for this repository (HK-06, D-119)", () => {
  test('BUG-31: no line-ending attribute is set for any tracked file, since the fingerprint cannot see a change one would normalise away (HK-06, D-119)', () => {
    // Only the repository's own attribute files decide, not this machine's:
    // no system-wide attributes file, no global core.attributesFile. A
    // .git/info/attributes is still read; one that sets these attributes
    // blinds the fingerprint on that machine too.
    const env = { ...process.env, GIT_ATTR_NOSYSTEM: '1' };
    const gitHere = (args, options) =>
      spawnSync(
        'git',
        ['-c', 'core.attributesFile=/dev/null', '-c', 'core.autocrlf=false', ...args],
        { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, ...options },
      );
    const top = gitHere(['rev-parse', '--show-toplevel'], { cwd: HOOKS_DIR });
    expect(top.status, top.stderr).toBe(0);
    const root = top.stdout.trim();

    const listed = gitHere(['ls-files', '-z'], { cwd: root });
    expect(listed.status, listed.stderr).toBe(0);
    const files = listed.stdout.split('\0').filter((file) => file !== '');
    expect(files.length).toBeGreaterThan(0);

    const checked = gitHere(['check-attr', '--stdin', '-z', ...LINE_ENDING_ATTRIBUTES], {
      cwd: root,
      input: files.join('\0'),
    });
    expect(checked.status, checked.stderr).toBe(0);
    // `path\0attribute\0value\0` for each file and attribute, in the order
    // asked; the final NUL leaves one empty field at the end.
    const fields = checked.stdout.split('\0');
    expect(fields.pop()).toBe('');
    const triples = [];
    for (let i = 0; i < fields.length; i += 3) {
      triples.push(fields.slice(i, i + 3));
    }
    // Not vacuous: an answer for every listed file and every attribute.
    expect(triples.length).toBe(files.length * LINE_ENDING_ATTRIBUTES.length);
    expect(triples.map(([file, attribute]) => `${file} ${attribute}`)).toEqual(
      files.flatMap((file) => LINE_ENDING_ATTRIBUTES.map((attribute) => `${file} ${attribute}`)),
    );

    // `-text` and `-crlf` read as `unset`: they turn conversion off, which is
    // safe. Anything else (`set`, `auto`, `lf`, `crlf`, …) turns it on.
    const offending = triples
      .filter(([, , value]) => value !== 'unspecified' && value !== 'unset')
      .map(([file, attribute, value]) => `${file} ${attribute}=${value}`);
    expect(
      offending,
      'A line-ending attribute is set for these tracked files. git diff normalises their ' +
        "line endings whatever core.autocrlf says, so the stop gate's fingerprint " +
        '(.claude/hooks/stop-gate.mjs) would not see a change only from LF to CRLF and ' +
        'would skip the gate. Before adding such an attribute, make the fingerprint hash ' +
        "the changed tracked files' contents as well (D-119 amendment, known limit; BUG-31).",
    ).toEqual([]);
  });
});

// BUG-31, part 2 (D-119): the AI reviews in CI load the project's settings, so
// the stop gate ran gate:quick inside every review job. With both
// GITHUB_ACTIONS=true and TRYGGHVERDAG_REVIEW_JOB=1 the hook stands down at
// once: no gate, no note. With only one of them it behaves exactly as before.

/**
 * Runs the stop gate with the two CI variables exactly as `ci` says. runHook
 * passes this process's environment through, and these tests themselves run
 * in GitHub Actions, where GITHUB_ACTIONS=true is already set — so both are
 * removed first and only then set, in every case.
 */
function stopIn(dir, ci, input = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  delete env.GITHUB_ACTIONS;
  delete env.TRYGGHVERDAG_REVIEW_JOB;
  Object.assign(env, ci);
  const result = spawnSync(process.execPath, [path.join(HOOKS_DIR, 'stop-gate.mjs')], {
    input: JSON.stringify({ cwd: dir, ...input }),
    encoding: 'utf8',
    cwd: dir,
    timeout: 120_000,
    env,
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stderr: result.stderr ?? '' };
}

const REVIEW_JOB = { GITHUB_ACTIONS: 'true', TRYGGHVERDAG_REVIEW_JOB: '1' };

describe('BUG-31: the stop gate stands down in a CI review job (D-119)', () => {
  test.each([
    { how: 'at a first stop', input: {} },
    { how: 'after being asked to continue once', input: { stop_hook_active: true } },
  ])(
    'BUG-31: with GITHUB_ACTIONS=true and TRYGGHVERDAG_REVIEW_JOB=1, $how, a failing gate is not run and nothing is written',
    ({ input }) => {
      const dir = branchRepo({ 'gate:quick': FAILS });

      const result = stopIn(dir, REVIEW_JOB, input);

      expect(ranLog(dir)).toBe('');
      expect(result.status).toBe(ALLOWED);
      expect(existsSync(path.join(dir, '.claude/state'))).toBe(false);
    },
  );

  // Pass today, and are meant to: they are the guard that one variable alone —
  // GITHUB_ACTIONS is set in every CI job, not only the reviews — never turns
  // the gate off, and that the review-job switch has to say 1.
  test.each([
    { how: 'only GITHUB_ACTIONS=true', ci: { GITHUB_ACTIONS: 'true' } },
    { how: 'only TRYGGHVERDAG_REVIEW_JOB=1', ci: { TRYGGHVERDAG_REVIEW_JOB: '1' } },
    {
      how: 'GITHUB_ACTIONS=true and TRYGGHVERDAG_REVIEW_JOB=0',
      ci: { GITHUB_ACTIONS: 'true', TRYGGHVERDAG_REVIEW_JOB: '0' },
    },
  ])('BUG-31: with $how, the failing gate runs and blocks, as before', ({ ci }) => {
    const dir = branchRepo({ 'gate:quick': FAILS });

    const result = stopIn(dir, ci);

    expect(runs(dir, 'gate:quick')).toBe(1);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('2 tests failed');
  });
});

// BUG-31, part 3 (D-119): ai-review.yml sets TRYGGHVERDAG_REVIEW_JOB=1 on the
// whole review step, so every command a CI reviewer runs inherits it, together
// with GITHUB_ACTIONS=true. A reviewer that runs these tests there
// (`pnpm run test:hooks`, `test:unit`) must see the same results as anywhere
// else: if runHook passed the two variables on, the hook would stand down and
// every test above that expects a refusal or a gate run would fail — a false
// finding put in front of a blocking reviewer. The tests that want the
// stand-down build their own environment (stopIn); runHook must not hand it to
// the rest.

/**
 * Runs `run` with this process's environment as a CI review job has it, then
 * puts both variables back exactly as they were — deleted if they were absent,
 * because assigning `undefined` to process.env stores the string "undefined".
 */
function asInAReviewJob(run) {
  const before = Object.fromEntries(
    Object.keys(REVIEW_JOB).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, REVIEW_JOB);
  try {
    return run();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

describe("BUG-31: the hook tests do not inherit a CI review job's stand-down (D-119)", () => {
  test("BUG-31: the hook tests do not inherit a CI review job's stand-down: with the review job's variables in the test's own environment, a failing gate:quick with code changed is still run and refused", () => {
    const dir = repoWith(
      { 'gate:quick': FAILS },
      { 'apps/server/src/api.ts': 'export const a = 1;' },
    );

    const result = asInAReviewJob(() => stop(dir));

    expect(result.status).toBe(BLOCKED);
    expect(ranLog(dir)).toContain('gate:quick');
    expect(result.stderr).toContain('2 tests failed');
  });
});

// BUG-36, review loop 1, privacy-security-reviewer: D-120's guards protect the
// repository's .claude/state/, named from CLAUDE_PROJECT_DIR, which Claude
// Code sets for every hook; session-start.mjs reads its notes from there too.
// The stop gate took its records, and the repository it checks, from the
// folder the session is in, the input's cwd. From apps/server, which has a
// package.json of its own, it read apps/server/.claude/state/phase and
// apps/server/.claude/state/gate-passed, which no guard protects, and checked
// apps/server as if it were the repository. The stop gate uses
// CLAUDE_PROJECT_DIR when it is set, else the input's cwd, for both.

const SUBFOLDER = 'apps/server';

/** `files` with each path put under apps/server, which gets a package.json of its own. */
const inSubfolder = (files) =>
  Object.fromEntries(Object.entries(files).map(([file, text]) => [`${SUBFOLDER}/${file}`, text]));

/**
 * Runs the stop gate as Claude Code does for a session whose folder is
 * `folder`: the input's cwd, and the process's unless `processIn` says
 * otherwise. CLAUDE_PROJECT_DIR is `project`, or unset when `project` is null.
 */
function stopFrom({ folder, project, processIn = folder, input = {}, args = [] }) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: project ?? '' };
  if (project === null) {
    delete env.CLAUDE_PROJECT_DIR;
  }
  delete env.TRYGGHVERDAG_REVIEW_JOB;
  const result = spawnSync(process.execPath, [path.join(HOOKS_DIR, 'stop-gate.mjs'), ...args], {
    input: JSON.stringify({ cwd: folder, ...input }),
    encoding: 'utf8',
    cwd: processIn,
    timeout: 120_000,
    env,
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stderr: result.stderr ?? '' };
}

/** Every file called `name` anywhere in `dir`, as absolute paths. */
const filesNamed = (dir, name) =>
  readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => path.basename(file) === name)
    .map((file) => path.join(dir, file));

describe('BUG-36, review loop 1: from a subfolder, the stop gate reads its records from the repository the guards protect (HK-06, D-120)', () => {
  // Fails today: the gate reads apps/server's phase, runs apps/server's
  // gate:static, which passes, and lets the session finish.
  test("BUG-36: a red: phase planted under the subfolder's .claude/state/ is ignored: the repository has none, so gate:quick runs and refuses", () => {
    const scripts = { 'gate:quick': FAILS, 'gate:static': PASSES };
    const dir = branchRepo(scripts, inSubfolder(fakeScripts(scripts)));
    const sub = path.join(dir, SUBFOLDER);
    write(sub, { '.claude/state/phase': 'red:LOST-02' });

    const result = stopFrom({ folder: sub, project: dir });

    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('2 tests failed');
    expect(runs(dir, 'gate:quick')).toBe(1);
    expect(ranLog(sub)).toBe('');
  });

  // Fails today: no phase in apps/server, so its gate:quick runs, and fails.
  test("BUG-36: the repository's red: phase is used: only the static checks run, in the repository", () => {
    const scripts = { 'gate:quick': FAILS, 'gate:static': PASSES };
    const dir = branchRepo(scripts, inSubfolder(fakeScripts(scripts)));
    const sub = path.join(dir, SUBFOLDER);
    write(dir, { '.claude/state/phase': 'red:LOST-02' });

    const result = stopFrom({ folder: sub, project: dir });

    expect(result.status, result.stderr).toBe(ALLOWED);
    expect(runs(dir, 'gate:static')).toBe(1);
    expect(runs(dir, 'gate:quick')).toBe(0);
    expect(ranLog(sub)).toBe('');
  });

  // Fails today: the pass apps/server remembers for itself skips the gate.
  test("BUG-36: a remembered pass planted under the subfolder's .claude/state/ is ignored: the repository's gate runs and refuses", () => {
    const dir = branchRepo(
      { 'gate:quick': FAILS },
      inSubfolder(fakeScripts({ 'gate:quick': PASSES })),
    );
    const sub = path.join(dir, SUBFOLDER);
    // The plant: a stop that takes apps/server for the project remembers a
    // pass there, the same way before and after the fix.
    expect(stopFrom({ folder: sub, project: sub }).status).toBe(ALLOWED);
    expect(existsSync(path.join(sub, '.claude/state/gate-passed'))).toBe(true);
    expect(runs(sub, 'gate:quick')).toBe(1);

    const result = stopFrom({ folder: sub, project: dir });

    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('2 tests failed');
    expect(runs(dir, 'gate:quick')).toBe(1);
    expect(runs(sub, 'gate:quick')).toBe(1);
  });

  // Fails today: the repository's pass is not looked at, and apps/server's
  // gate:quick runs, and fails.
  test("BUG-36: the repository's remembered pass is used: the gate it passed does not run again from the subfolder", () => {
    const dir = branchRepo(
      { 'gate:quick': PASSES },
      inSubfolder(fakeScripts({ 'gate:quick': FAILS })),
    );
    const sub = path.join(dir, SUBFOLDER);
    expect(stop(dir).status).toBe(ALLOWED);
    expect(runs(dir, 'gate:quick')).toBe(1);

    const result = stopFrom({ folder: sub, project: dir });

    expect(result.status, result.stderr).toBe(ALLOWED);
    expect(runs(dir, 'gate:quick')).toBe(1);
    expect(ranLog(sub)).toBe('');
  });

  // Fails today: from apps/server, git lists only the untracked files under
  // apps/server, so the gate decides nothing changed and does not run.
  test('BUG-36: the repository is what is checked: an untracked code file outside the subfolder runs the gate', () => {
    const dir = makeRepo({
      ...fakeScripts({ 'gate:quick': FAILS }),
      '.gitignore': 'ran.txt\n',
      ...inSubfolder(fakeScripts({ 'gate:quick': PASSES })),
    });
    repos.push(dir);
    const sub = path.join(dir, SUBFOLDER);
    write(dir, { 'packages/contracts/src/journey.ts': 'export const c = 1;\n' });

    const result = stopFrom({ folder: sub, project: dir });

    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('2 tests failed');
    expect(runs(dir, 'gate:quick')).toBe(1);
  });

  // Fails today: the stop gate remembers its pass under apps/server, and the
  // guards, which name paths from the repository, have nothing to refuse there.
  test('BUG-36: the stop gate and the global guards share one root: from a subfolder, the file the stop gate remembers its pass in is one the global guards refuse to a subagent, naming D-120', () => {
    const dir = branchRepo(
      { 'gate:quick': PASSES },
      inSubfolder(fakeScripts({ 'gate:quick': PASSES })),
    );
    const sub = path.join(dir, SUBFOLDER);
    expect(stopFrom({ folder: sub, project: dir }).status).toBe(ALLOWED);
    const remembered = filesNamed(dir, 'gate-passed');
    expect(remembered, 'where the stop gate remembered its pass').toHaveLength(1);
    const [file] = remembered;

    // D-120's deny arguments for the two global guards, as settings.json
    // passes them; settings-hooks.test.mjs holds that it does.
    const guardEnv = { ...process.env, CLAUDE_PROJECT_DIR: dir };
    delete guardEnv.TRYGGHVERDAG_REVIEW_JOB;
    const asSubagent = (hook, args, call) => {
      const run = spawnSync(process.execPath, [path.join(HOOKS_DIR, hook), '--global', ...args], {
        input: JSON.stringify({ cwd: sub, ...call, agent_id: 'synthetic-subagent-1' }),
        encoding: 'utf8',
        cwd: sub,
        timeout: 120_000,
        env: guardEnv,
      });
      if (run.error) {
        throw run.error;
      }
      return run.status === BLOCKED && (run.stderr ?? '').includes('D-120')
        ? 'refused'
        : `exit ${String(run.status)}: ${(run.stderr ?? '').trim()}`;
    };
    const byWrite = asSubagent(
      'guard-paths.mjs',
      ['--deny', '.claude/settings.local.json', '--deny', '.claude/state/**'],
      { tool_name: 'Write', tool_input: { file_path: file, content: 'synthetic\n' } },
    );
    const byShell = asSubagent(
      'guard-bash.mjs',
      ['--deny-write-glob', '.claude/state/**', '--deny-write-glob', '.claude/state'],
      { tool_name: 'Bash', tool_input: { command: `printf x > ${file}` } },
    );

    expect(
      { byWrite, byShell },
      `the stop gate remembered its pass in ${path.relative(dir, file)}`,
    ).toEqual({ byWrite: 'refused', byShell: 'refused' });
  });

  // Passes today, on purpose: without CLAUDE_PROJECT_DIR the input's cwd
  // stands in, not the folder the hook's process happens to run in.
  test("BUG-36: without CLAUDE_PROJECT_DIR, the input's cwd is the repository, not the process's folder", () => {
    const scripts = { 'gate:quick': FAILS, 'gate:static': PASSES };
    const dir = branchRepo(scripts, inSubfolder(fakeScripts({ 'gate:quick': FAILS })));
    const sub = path.join(dir, SUBFOLDER);
    write(dir, { '.claude/state/phase': 'red:LOST-02' });

    const result = stopFrom({ folder: dir, project: null, processIn: sub });

    expect(result.status, result.stderr).toBe(ALLOWED);
    expect(runs(dir, 'gate:static')).toBe(1);
    expect(ranLog(sub)).toBe('');
  });
});
