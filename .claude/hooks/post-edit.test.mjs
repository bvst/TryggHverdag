// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-04: every edit is checked immediately, by the same script CI runs.
import { afterEach, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { GATE_FILE_LIMIT_MS, report } from '../../scripts/gate-file.mjs';
import {
  ALLOWED,
  BLOCKED,
  edit,
  fakeScripts,
  makeDir,
  removeRepo,
  runHook,
} from './test-helpers.mjs';

const dirs = [];
function dirWith(files) {
  const dir = makeDir(files);
  dirs.push(dir);
  return dir;
}

function ranLog(dir) {
  try {
    return readFileSync(path.join(dir, 'ran.txt'), 'utf8');
  } catch {
    return '';
  }
}

afterEach(() => {
  while (dirs.length > 0) {
    removeRepo(dirs.pop());
  }
});

describe('HK-04: the gate runs after an edit', () => {
  test('and the edited file is handed to it', () => {
    const dir = dirWith(fakeScripts({ 'gate:file': {} }));
    const result = runHook('post-edit.mjs', {
      input: edit(path.join(dir, 'apps/server/src/api.ts')),
      cwd: dir,
    });
    expect(result.status).toBe(ALLOWED);
    expect(ranLog(dir)).toContain('apps/server/src/api.ts');
  });

  test('a failing check stops the work and shows the output', () => {
    const dir = dirWith(
      fakeScripts({ 'gate:file': { exitCode: 1, output: 'journey.ts(3,1): error TS2322' } }),
    );
    const result = runHook('post-edit.mjs', {
      input: edit(path.join(dir, 'apps/server/src/journey.ts')),
      cwd: dir,
    });
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('error TS2322');
  });
});

describe('HK-04: a missing gate is loud, not silent', () => {
  test('because no checks at all is the failure this project must never have', () => {
    const dir = dirWith({ 'package.json': JSON.stringify({ name: 'no-gate', scripts: {} }) });
    const result = runHook('post-edit.mjs', {
      input: edit(path.join(dir, 'apps/server/src/api.ts')),
      cwd: dir,
    });
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('gate:file');
  });
});

describe('HK-04: edits the gate has nothing to say about', () => {
  test.each([
    ['docs/progress.md', 'a planning document'],
    ['docs/plan/decisions.md', 'the decision log'],
    ['README.md', 'prose'],
  ])('%s (%s) passes without running anything', (file) => {
    const dir = dirWith(fakeScripts({ 'gate:file': {} }));
    const result = runHook('post-edit.mjs', { input: edit(path.join(dir, file)), cwd: dir });
    expect(result.status).toBe(ALLOWED);
    expect(ranLog(dir)).toBe('');
  });

  test('a tool that edits no file at all', () => {
    const dir = dirWith(fakeScripts({ 'gate:file': {} }));
    const result = runHook('post-edit.mjs', {
      input: { tool_name: 'Bash', tool_input: { command: 'ls' } },
      cwd: dir,
    });
    expect(result.status).toBe(ALLOWED);
  });

  test('a folder with no package.json, before the repository is set up', () => {
    const dir = dirWith({});
    const result = runHook('post-edit.mjs', {
      input: edit(path.join(dir, 'apps/server/src/api.ts')),
      cwd: dir,
    });
    expect(result.status).toBe(ALLOWED);
  });
});

// BUG-52 (D-133, the owner: "Yes, change the hook"). gate:file can now pass
// (exit 0) and still have something to say: an edited L3 test whose step was
// not possible here, because Docker does not work on this machine. The hook
// showed the gate's output only when the gate failed, so that note reached
// nobody, and an L3 edit in a session without Docker looked checked. D-133:
// the hook passes the note on as information, not as a failure, in the way
// Claude Code documents for a PostToolUse hook (code.claude.com/docs/en/hooks,
// "Add context for Claude"): exit 0 and one JSON object on stdout,
// {"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":…}}.
// Plain stdout on exit 0 reaches only the debug log. Exit 2 stays for failures.
//
// What the hook keys on (test-author, D-031): nothing but the gate's exit code
// and whether it printed anything. gate:file prints nothing when every step
// passed (scripts/gate-file.test.mjs, "a well-formatted file passes the gate:
// exit code 0 and nothing printed"), so anything it prints on exit 0 is for the
// session. A hook that looked for a phrase would drop a note the gate later
// words differently, silently. The wording the gate prints, "not possible
// here", is pinned once, in scripts/gate-file.test.mjs; the last two tests here
// hand the hook that file's own report() text, so the two cannot drift apart.
describe('HK-04 (D-133): what a passing gate has to say reaches the session', () => {
  const L3_FILE = 'apps/server/src/alerts.integration.test.ts';
  /** A not-possible note in the gate's words. It does not name the file: the hook must. */
  const NOTE =
    '· the edited integration tests (L3) — not possible here: needs docker, which is not working on this machine — a real PostgreSQL runs in a container (L3)';
  const LINT_OUTPUT = 'alerts.integration.test.ts:3:7  error  no-unused-vars';
  const FAILURE = `--- lint ---\n${LINT_OUTPUT}`;

  /** stdout as one JSON value, or undefined if it is anything else (nothing, text, two objects). */
  const parsed = (stdout) => {
    try {
      return JSON.parse(stdout);
    } catch {
      return undefined;
    }
  };

  /** The shape D-133 names, and nothing besides: no decision, no stop. */
  const CONTEXT_ONLY = {
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: expect.any(String) },
  };

  const hookAfter = (gate) => {
    const dir = dirWith(fakeScripts({ 'gate:file': gate }));
    const result = runHook('post-edit.mjs', { input: edit(path.join(dir, L3_FILE)), cwd: dir });
    return { dir, result };
  };

  test('BUG-52: a gate that passes but could not run an L3 step here: exit 0, and one PostToolUse JSON object whose additionalContext names the file and carries the note', () => {
    const { dir, result } = hookAfter({ exitCode: 0, output: `\n${NOTE}\n` });

    expect(ranLog(dir), 'the fake gate never ran').toContain(L3_FILE);
    expect(result.status, result.stderr).toBe(ALLOWED);
    const printed = parsed(result.stdout);
    expect(printed, `the hook's stdout:\n${result.stdout}`).toEqual(CONTEXT_ONLY);
    expect(printed.hookSpecificOutput.additionalContext).toContain(L3_FILE);
    expect(printed.hookSpecificOutput.additionalContext).toContain(NOTE);
  });

  test('BUG-52: anything else a passing gate prints reaches the session too, so a note worded differently later is never dropped', () => {
    const note = 'gate:file: a synthetic note in words no rule in the hook knows';
    const { result } = hookAfter({ exitCode: 0, output: `${note}\n` });

    expect(result.status, result.stderr).toBe(ALLOWED);
    const printed = parsed(result.stdout);
    expect(printed, `the hook's stdout:\n${result.stdout}`).toEqual(CONTEXT_ONLY);
    expect(printed.hookSpecificOutput.additionalContext).toContain(note);
  });

  test('BUG-52: a gate that passes with nothing to say: the hook prints nothing and exits 0, as before', () => {
    const { dir, result } = hookAfter({ exitCode: 0, output: '' });

    expect(ranLog(dir), 'the fake gate never ran').toContain(L3_FILE);
    expect(result.status).toBe(ALLOWED);
    expect(result.stdout).toBe('');
  });

  test('BUG-52: a gate that fails and also could not run a step here: the hook blocks, as before, and the block message carries both the failure and the note', () => {
    // Decided here: the note stays in the block message. Whoever fixes the
    // failure should also learn which edited tests did not run on this machine.
    const { result } = hookAfter({
      exitCode: 1,
      output: `\n${FAILURE}\n\n1 check(s) failed for: ${L3_FILE}\n${NOTE}\n`,
    });

    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('no-unused-vars');
    expect(result.stderr).toContain(NOTE);
  });

  // The gate's own words, not a copy of them: each test below builds the text
  // with scripts/gate-file.mjs's report(), for a step in the shape its runSteps
  // returns when a tool is missing, and hands that text and exit code to the
  // hook through the fake gate:file.
  const NOT_POSSIBLE = {
    name: 'the edited integration tests (L3)',
    ok: false,
    notPossible: true,
    output:
      'needs docker, which is not working on this machine — a real PostgreSQL runs in a container (L3)',
  };
  /** The lines of the gate's text that say a step was not possible here. */
  const notPossibleLines = (text) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /not possible here/i.test(line));

  test("BUG-52: gate-file.mjs's own report of a step not possible here reaches the session, every not-possible line of it", () => {
    const gate = report([{ name: 'formatting', ok: true, output: '' }, NOT_POSSIBLE], [L3_FILE]);
    const { result } = hookAfter({ exitCode: gate.exitCode, output: gate.text });

    expect(result.status, `the hook blocked:\n${result.stderr}`).toBe(ALLOWED);
    const lines = notPossibleLines(gate.text);
    expect(
      lines.length,
      `no "not possible here" line in what report() printed:\n${gate.text}`,
    ).toBeGreaterThan(0);
    const printed = parsed(result.stdout);
    expect(printed, `the hook's stdout:\n${result.stdout}`).toEqual(CONTEXT_ONLY);
    for (const line of lines) {
      expect(printed.hookSpecificOutput.additionalContext).toContain(line);
    }
  });

  test("BUG-52: gate-file.mjs's own report of a failure beside a step not possible here blocks, and the block message keeps the not-possible line", () => {
    const gate = report(
      [{ name: 'lint', ok: false, output: `${LINT_OUTPUT}\n` }, NOT_POSSIBLE],
      [L3_FILE],
    );
    const { result } = hookAfter({ exitCode: gate.exitCode, output: gate.text });

    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('no-unused-vars');
    const lines = notPossibleLines(gate.text);
    expect(
      lines.length,
      `no "not possible here" line in what report() printed:\n${gate.text}`,
    ).toBeGreaterThan(0);
    for (const line of lines) {
      expect(result.stderr).toContain(line);
    }
  });

  test("BUG-52: gate-file.mjs's own report of a failure with more than 4,000 characters of output, beside a step not possible here, blocks, and the block message still keeps the not-possible line", () => {
    // review loop 1 (test-auditor): the hook keeps only the last 4,000
    // characters of the gate's output (tail in lib.mjs), and nothing held that
    // the not-possible lines come where that keeps them. Named before the
    // failures, a long failure pushed them out, and every test still passed.
    const longLint = Array.from(
      { length: 120 },
      (_, index) => `alerts.integration.test.ts:${String(index + 1)}:7  error  no-unused-vars`,
    ).join('\n');
    const gate = report(
      [{ name: 'lint', ok: false, output: `${longLint}\n` }, NOT_POSSIBLE],
      [L3_FILE],
    );
    const { result } = hookAfter({ exitCode: gate.exitCode, output: gate.text });

    expect(gate.text.length, 'the fixture: a report longer than the hook keeps').toBeGreaterThan(
      4_000,
    );
    expect(result.status).toBe(BLOCKED);
    const lines = notPossibleLines(gate.text);
    expect(
      lines.length,
      `no "not possible here" line in what report() printed:\n${gate.text}`,
    ).toBeGreaterThan(0);
    for (const line of lines) {
      expect(result.stderr).toContain(line);
    }
  });

  /** A gate:file that writes `stdout` and `stderr`, notes that it ran, and exits 0. */
  const gateWriting = (stdout, stderr) => ({
    'package.json': JSON.stringify({
      name: 'fake',
      private: true,
      scripts: { 'gate:file': 'node fake-gate.mjs' },
    }),
    'fake-gate.mjs': [
      "import { appendFileSync } from 'node:fs';",
      "appendFileSync('ran.txt', 'gate:file ' + process.argv.slice(2).join(' ') + '\\n');",
      `process.stdout.write(${JSON.stringify(stdout)});`,
      `process.stderr.write(${JSON.stringify(stderr)});`,
      'process.exit(0);',
    ].join('\n'),
  });
  const WARNING = '(node:4242) ExperimentalWarning: a synthetic warning on stderr';

  test('BUG-52: what a passing gate writes to stderr does not reach the session: with nothing on stdout, the hook prints nothing', () => {
    // review loop 1 (test-auditor): only stdout is the gate's report. stderr
    // holds what node and pnpm say on the side, and is not for the session.
    const dir = dirWith(gateWriting('', `${WARNING}\n`));
    const result = runHook('post-edit.mjs', { input: edit(path.join(dir, L3_FILE)), cwd: dir });

    expect(ranLog(dir), 'the fake gate never ran').toContain(L3_FILE);
    expect(result.status).toBe(ALLOWED);
    expect(result.stdout).toBe('');
  });

  test('BUG-52: with a note on stdout and a warning on stderr from a passing gate, the session gets the note and not the warning', () => {
    const dir = dirWith(gateWriting(`\n${NOTE}\n`, `${WARNING}\n`));
    const result = runHook('post-edit.mjs', { input: edit(path.join(dir, L3_FILE)), cwd: dir });

    expect(result.status).toBe(ALLOWED);
    const printed = parsed(result.stdout);
    expect(printed, `the hook's stdout:\n${result.stdout}`).toEqual(CONTEXT_ONLY);
    expect(printed.hookSpecificOutput.additionalContext).toContain(NOTE);
    expect(printed.hookSpecificOutput.additionalContext).not.toContain('ExperimentalWarning');
  });
});

// BUG-52, review loop 1 (privacy-security-reviewer). The hook stops gate:file at
// a limit, and the gate's own budget (the Docker probe and its steps) is checked
// against that limit in scripts/gate-file.test.mjs. So the hook takes the limit
// from there, GATE_FILE_LIMIT_MS, rather than a number of its own that could
// drift from it (it was the literal 170_000); and Claude Code's limit on the hook
// (settings.json) is longer, so the hook lives to report a gate it stopped. The
// hook's limit cannot be watched without waiting it out, so the first test reads
// the hook's source.
describe('HK-04 (BUG-52): the hook’s limit on gate:file', () => {
  const HOOK_MARGIN_MS = 5_000;

  test('BUG-52: the hook stops gate:file at GATE_FILE_LIMIT_MS from scripts/gate-file.mjs, not at a number of its own', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'post-edit.mjs'), 'utf8');

    expect(GATE_FILE_LIMIT_MS, 'GATE_FILE_LIMIT_MS, exported by scripts/gate-file.mjs').toEqual(
      expect.any(Number),
    );
    // Loaded from the gate: by a static import, or (review loop 2) by a guarded
    // dynamic one, so that a gate that cannot load blocks the edit (below).
    expect(source).toMatch(
      /(?:\bfrom\s*|\bimport\s*\(\s*)['"]\.\.\/\.\.\/scripts\/gate-file\.mjs['"]/,
    );
    expect(source).toMatch(/\btimeout:\s*(?:[\w$]+\.)?GATE_FILE_LIMIT_MS\b/);
    expect(source, 'a timeout typed as a number').not.toMatch(/\btimeout:\s*\d/);
    expect(source, 'GATE_FILE_LIMIT_MS given a number of the hook’s own').not.toMatch(
      /\bGATE_FILE_LIMIT_MS\s*=\s*\d/,
    );
  });

  test('BUG-52: Claude Code’s own limit on the post-edit hook is at least 5 s longer than the hook’s limit on gate:file, so the hook lives to report a gate it stopped', () => {
    const settings = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '..', 'settings.json'), 'utf8'),
    );
    const postEdit = Object.values(settings.hooks ?? {})
      .flat()
      .flatMap((matcher) => matcher.hooks ?? [])
      .filter((hook) => String(hook.command).includes('post-edit.mjs'));

    expect(GATE_FILE_LIMIT_MS, 'GATE_FILE_LIMIT_MS, exported by scripts/gate-file.mjs').toEqual(
      expect.any(Number),
    );
    expect(postEdit.length, 'settings.json runs post-edit.mjs').toBeGreaterThan(0);
    for (const hook of postEdit) {
      expect(hook.timeout * 1_000 - GATE_FILE_LIMIT_MS).toBeGreaterThanOrEqual(HOOK_MARGIN_MS);
    }
  });
});

// BUG-52, review loop 2 (privacy-security-reviewer and test-auditor, each on
// its own). The hook imported scripts/gate-file.mjs statically for
// GATE_FILE_LIMIT_MS, and with it vitest.shared.mjs and four scripts/lib files,
// before it read its input. If any of them cannot load (a syntax error, or,
// mid-TDD, an import of a name not exported yet), node exits 1, and Claude Code
// treats exit 1 from a hook as a non-blocking error: the session is told
// nothing, the edit that broke the gate goes through, and no edit after it is
// checked until the file is fixed. A gate that cannot load must block, and say
// so.
//
// These run a copy of the hook in a temporary folder that holds exactly the
// files the hook loads, followed from its own imports, so a file the hook comes
// to load later is copied too. One of them is broken on purpose, and gate:file
// is a fake that passes, so an edit here can only block because the gate's code
// did not load.
//
// Decided here (test-author, D-031): an edit to a file the gate does not check,
// such as a .md file, still exits 0 and prints nothing when the gate's code is
// broken. The gate has nothing to say about such a file, so the hook's early
// exit comes before it loads the gate. That hides nothing: the edit that broke
// the gate is to a file the gate checks (.mjs) and blocks, and so does every
// checked edit after it. And while the gate is down, a session can still write
// down in docs/ what broke.
describe('HK-04 (BUG-52): a gate:file that cannot be loaded blocks the edit, and says so', () => {
  const REPO = path.resolve(import.meta.dirname, '..', '..');
  const HOOK = '.claude/hooks/post-edit.mjs';
  const SOURCE = 'apps/server/src/api.ts';
  const SYNTAX_ERROR = '\nexport const broken = ;\n';

  /** The files the hook loads: its own relative imports, static or dynamic, followed. */
  function hookModules() {
    const seen = new Set();
    const visit = (rel) => {
      if (seen.has(rel)) {
        return;
      }
      seen.add(rel);
      const text = readFileSync(path.join(REPO, rel), 'utf8');
      const imports = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)['"](\.{1,2}\/[^'"]+)['"]/gm;
      for (const [, specifier] of text.matchAll(imports)) {
        visit(path.posix.normalize(path.posix.join(path.posix.dirname(rel), specifier)));
      }
    };
    visit(HOOK);
    return [...seen];
  }

  /** A temporary project: the hook, what it loads, and a gate:file that passes. */
  function projectCopy() {
    const dir = dirWith(fakeScripts({ 'gate:file': {} }));
    const modules = hookModules();
    for (const rel of modules) {
      mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
      copyFileSync(path.join(REPO, rel), path.join(dir, rel));
    }
    return { dir, modules };
  }

  /** A project copy with `text` appended to `target`, one of the files the hook loads. */
  function brokenCopy(target, text) {
    const { dir, modules } = projectCopy();
    expect(modules, `the hook does not load ${target}, so breaking it proves nothing`).toContain(
      target,
    );
    appendFileSync(path.join(dir, target), text);
    return dir;
  }

  /** Runs the copy's hook on an edit of `file`, the way runHook runs the real one. */
  function hookIn(dir, file) {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
    delete env.TRYGGHVERDAG_REVIEW_JOB;
    const result = spawnSync(process.execPath, [path.join(dir, HOOK)], {
      input: JSON.stringify({ cwd: dir, ...edit(path.join(dir, file)) }),
      cwd: dir,
      env,
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (result.error) {
      throw result.error;
    }
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  }

  const BREAKS = [
    {
      broken: 'a syntax error in gate-file.mjs',
      target: 'scripts/gate-file.mjs',
      text: SYNTAX_ERROR,
      said: 'Unexpected token',
    },
    {
      broken: 'a syntax error in vitest.shared.mjs',
      target: 'vitest.shared.mjs',
      text: SYNTAX_ERROR,
      said: 'Unexpected token',
    },
    {
      broken: 'an import of a name not exported yet',
      target: 'scripts/gate-file.mjs',
      text: "\nimport { NOT_EXPORTED_YET } from './lib/steps.mjs';\n",
      said: 'NOT_EXPORTED_YET',
    },
  ];
  const CASES = BREAKS.flatMap((each) =>
    ['scripts/gate-file.mjs', SOURCE].map((edited) => ({ ...each, edited })),
  );

  test.each(CASES)(
    'BUG-52: with $broken, an edit to $edited blocks (exit 2), saying gate:file could not be loaded, and names the file and the error',
    ({ target, text, said, edited }) => {
      const dir = brokenCopy(target, text);

      const result = hookIn(dir, edited);

      expect(result.status, `stderr:\n${result.stderr}`).toBe(BLOCKED);
      expect(result.stderr).toMatch(/gate:file/);
      expect(result.stderr).toMatch(/could not be loaded/i);
      expect(result.stderr).toContain(edited);
      expect(result.stderr).toContain(said);
      expect(ranLog(dir), 'gate:file was run, though its code could not be loaded').toBe('');
    },
  );

  test.each(['docs/plan/README.md', 'README.md'])(
    'BUG-52: with gate:file unable to load, an edit to %s, which the gate does not check, still exits 0 and prints nothing',
    (file) => {
      const dir = brokenCopy('scripts/gate-file.mjs', SYNTAX_ERROR);

      const result = hookIn(dir, file);

      expect(result.status, `stderr:\n${result.stderr}`).toBe(ALLOWED);
      expect(result.stdout).toBe('');
      // The control: in this same copy a checked edit blocks, so the 0 above is
      // the hook's early exit, not a gate that loaded after all.
      expect(hookIn(dir, SOURCE).status).toBe(BLOCKED);
    },
  );

  test.each(['docs/plan/README.md', 'README.md'])(
    'BUG-52: with the gate’s code intact, an edit to %s, which the gate does not check, exits 0, prints nothing and runs nothing',
    (file) => {
      const { dir } = projectCopy();

      const result = hookIn(dir, file);

      expect(result.status, `stderr:\n${result.stderr}`).toBe(ALLOWED);
      expect(result.stdout).toBe('');
      expect(ranLog(dir)).toBe('');
    },
  );

  test('BUG-52: the copy’s control: with the gate’s code intact, an edit to a source file loads the gate, runs gate:file and passes', () => {
    // If the copy lacked a file the hook loads, this would fail too, so the
    // blocks above come from the break, not from an incomplete copy.
    const { dir } = projectCopy();

    const result = hookIn(dir, SOURCE);

    expect(result.status, `stderr:\n${result.stderr}`).toBe(ALLOWED);
    expect(ranLog(dir)).toContain(SOURCE);
  });

  // BUG-52, review loop 3 (test-auditor's should-fix, and the
  // privacy-security-reviewer's note 3, each on its own). The hook stops
  // gate:file at GATE_FILE_LIMIT_MS, and a source regex was all that held it
  // there. It read only the start of the value, so a fallback such as
  // `gate.GATE_FILE_LIMIT_MS ?? 170_000`, `|| 170_000` or `?? LIMIT` got past
  // every test. And if gate-file.mjs loads but no longer exports a usable
  // GATE_FILE_LIMIT_MS, the hook fails open. Checked by hand, on Node 22 (the
  // repository's engines), what spawnSync does with each such value:
  // - missing (undefined), null or 0: it runs gate:file with no limit at all,
  //   until Claude Code's own limit on the hook ends it, and Claude Code does
  //   not treat that as a block;
  // - a string, NaN, a negative number, Infinity or a fraction: it throws
  //   ERR_OUT_OF_RANGE ("It must be an unsigned integer"), node exits 1, and
  //   Claude Code does not block on exit 1 either.
  // Decided here (test-author, D-031): a usable limit is a whole number of
  // milliseconds above 0, the values spawnSync takes as a limit. Any other
  // value blocks the edit, names GATE_FILE_LIMIT_MS and the edited file, says
  // that no checks ran, and runs no gate:file. A fallback number of the hook's
  // own would hide a gate that lost its limit, so these copies leave the hook
  // no way through but to block.
  //
  // Not pinned: a limit so long that Claude Code's limit on the hook ends
  // first. The real value is held below that limit by the settings.json test
  // above; checking it at run time would have the hook read settings.json.
  //
  // As loop 2 decided for a gate that cannot load: an edit to a file the gate
  // does not check still exits 0 at the hook's early exit.
  describe('with a gate-file.mjs that loads but has no usable GATE_FILE_LIMIT_MS', () => {
    const GATE = 'scripts/gate-file.mjs';

    /**
     * A project copy whose gate-file.mjs loads, but exports `declaration` as
     * GATE_FILE_LIMIT_MS, or, with no declaration, has the name renamed away.
     */
    function copyWithLimit(declaration) {
      const { dir } = projectCopy();
      const file = path.join(dir, GATE);
      const text = readFileSync(file, 'utf8');
      const renamed = text.replaceAll(/\bGATE_FILE_LIMIT_MS\b/g, 'GATE_FILE_LIMIT_MS_RENAMED');
      expect(
        renamed,
        `${GATE} does not name GATE_FILE_LIMIT_MS, so renaming it proves nothing`,
      ).not.toBe(text);
      writeFileSync(
        file,
        declaration === undefined
          ? renamed
          : `${renamed}\nexport const GATE_FILE_LIMIT_MS = ${declaration};\n`,
      );
      return dir;
    }

    /** What the copy's gate-file.mjs exports as GATE_FILE_LIMIT_MS, read by loading it in a node of its own. */
    function exportedLimit(dir) {
      const url = pathToFileURL(path.join(dir, GATE)).href;
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `const gate = await import(${JSON.stringify(url)});` +
            'const limit = gate.GATE_FILE_LIMIT_MS;' +
            "process.stdout.write(JSON.stringify({ exported: 'GATE_FILE_LIMIT_MS' in gate, type: typeof limit, value: String(limit) }));",
        ],
        { cwd: dir, encoding: 'utf8', timeout: 60_000 },
      );
      if (result.error) {
        throw result.error;
      }
      expect(
        result.status,
        `the copy's gate-file.mjs did not load, so a block would not be about the limit:\n${result.stderr}`,
      ).toBe(0);
      return JSON.parse(result.stdout);
    }

    const NO_LIMIT = 'runs it with no limit';
    const THROWS = 'throws, and node exits 1';
    const UNUSABLE = [
      {
        limit: 'renamed away',
        declaration: undefined,
        spawnSync: NO_LIMIT,
        exported: false,
        type: 'undefined',
        value: 'undefined',
      },
      {
        limit: 'null',
        declaration: 'null',
        spawnSync: NO_LIMIT,
        exported: true,
        type: 'object',
        value: 'null',
      },
      {
        limit: '0',
        declaration: '0',
        spawnSync: NO_LIMIT,
        exported: true,
        type: 'number',
        value: '0',
      },
      {
        limit: 'a string',
        declaration: "'170000'",
        spawnSync: THROWS,
        exported: true,
        type: 'string',
        value: '170000',
      },
      {
        limit: 'NaN',
        declaration: 'Number.NaN',
        spawnSync: THROWS,
        exported: true,
        type: 'number',
        value: 'NaN',
      },
      {
        limit: 'a negative number',
        declaration: '-170_000',
        spawnSync: THROWS,
        exported: true,
        type: 'number',
        value: '-170000',
      },
      {
        limit: 'Infinity',
        declaration: 'Number.POSITIVE_INFINITY',
        spawnSync: THROWS,
        exported: true,
        type: 'number',
        value: 'Infinity',
      },
      {
        limit: 'a fraction',
        declaration: '170_000.5',
        spawnSync: THROWS,
        exported: true,
        type: 'number',
        value: '170000.5',
      },
    ];

    test.each(UNUSABLE)(
      'BUG-52: with GATE_FILE_LIMIT_MS $limit (spawnSync $spawnSync), an edit to a file the gate checks blocks (exit 2), names GATE_FILE_LIMIT_MS and the file, says no checks ran, and runs no gate:file',
      ({ declaration, exported, type, value }) => {
        const dir = copyWithLimit(declaration);
        expect(
          exportedLimit(dir),
          'the copy: gate-file.mjs loads, with this GATE_FILE_LIMIT_MS',
        ).toEqual({
          exported,
          type,
          value,
        });

        const result = hookIn(dir, SOURCE);

        expect(result.status, `stderr:\n${result.stderr}`).toBe(BLOCKED);
        expect(result.stderr).toContain('GATE_FILE_LIMIT_MS');
        expect(result.stderr).toContain(SOURCE);
        expect(result.stderr).toMatch(/no checks ran/i);
        expect(ranLog(dir), 'gate:file was run without a usable limit').toBe('');
      },
    );

    test('BUG-52: the edit to gate-file.mjs that renamed GATE_FILE_LIMIT_MS away blocks too, and names both', () => {
      const dir = copyWithLimit(undefined);

      const result = hookIn(dir, GATE);

      expect(result.status, `stderr:\n${result.stderr}`).toBe(BLOCKED);
      expect(result.stderr).toContain('GATE_FILE_LIMIT_MS');
      expect(result.stderr).toContain(GATE);
      expect(result.stderr).toMatch(/no checks ran/i);
      expect(ranLog(dir), 'gate:file was run without a limit').toBe('');
    });

    test.each(['docs/plan/README.md', 'README.md'])(
      'BUG-52: with GATE_FILE_LIMIT_MS renamed away, an edit to %s, which the gate does not check, still exits 0 and prints nothing',
      (file) => {
        const dir = copyWithLimit(undefined);

        const result = hookIn(dir, file);

        expect(result.status, `stderr:\n${result.stderr}`).toBe(ALLOWED);
        expect(result.stdout).toBe('');
        expect(ranLog(dir)).toBe('');
        // The control: in this same copy a checked edit blocks, so the 0 above
        // is the hook's early exit, not a limit the hook found after all.
        expect(hookIn(dir, SOURCE).status).toBe(BLOCKED);
      },
    );

    test('BUG-52: the copy’s control: with gate-file.mjs intact, the copy exports the real GATE_FILE_LIMIT_MS, and the hook runs gate:file and passes', () => {
      // If exportedLimit misread the copy, or the intact limit blocked, this
      // fails, so the blocks above come from the planted values alone.
      const { dir } = projectCopy();

      expect(exportedLimit(dir)).toEqual({
        exported: true,
        type: 'number',
        value: String(GATE_FILE_LIMIT_MS),
      });
      const result = hookIn(dir, SOURCE);
      expect(result.status, `stderr:\n${result.stderr}`).toBe(ALLOWED);
      expect(ranLog(dir)).toContain(SOURCE);
    });
  });

  // BUG-52, review loop 3 (privacy-security-reviewer, note 4). The message
  // gave the error's name and message only, so for a syntax error the session
  // was not told which of the files the gate loads broke. What node gives,
  // checked by hand on Node 22 (the repository's engines):
  // - a syntax error: the caught error's stack names no file and no line. It
  //   is "SyntaxError: Unexpected token ';'" and node's own frames. Node prints
  //   the file:///…:line only when the error goes uncaught (for example,
  //   loading the gate in a node of its own), or for `node --check <file>`;
  // - an import of a name not exported: the first line of the stack is the
  //   importing file's file:///…:line;
  // - a top-level `throw 42`: a bare number, with no stack. Node names no file
  //   for it, even uncaught. So the hook is held only to blocking and saying
  //   what was thrown.
  // Decided here (test-author, D-031): the message names the broken file as a
  // path from the project's root, with its line, as path:line. That is how the
  // hook names the edited file, and it is a path Read and Edit take as it is.
  // A file:/// URL or an absolute path alone does not count: it names where
  // this checkout sits on the disk, which the message does not need. The line
  // is required too, because node gives it wherever it gives the file.
  describe('the load-failure message names the file that broke, and the line', () => {
    /** The files the gate loads: what the hook loads, less the hook's own folder. */
    const GATE_MODULES = hookModules().filter((rel) => !rel.startsWith('.claude/'));
    const BROKEN_LINE = SYNTAX_ERROR.trim();

    /** The 1-based number of the last line of the copy's `rel` that is exactly `text`. */
    function lineOf(dir, rel, text) {
      const index = readFileSync(path.join(dir, rel), 'utf8').split('\n').lastIndexOf(text);
      expect(index, `"${text}" is not a line of ${rel}`).toBeGreaterThanOrEqual(0);
      return index + 1;
    }

    const escaped = (text) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    /** `rel:line` as a path of its own, not the end of an absolute path or a file:/// URL. */
    const at = (rel, line) =>
      new RegExp(String.raw`(?<![\w./\\-])${escaped(rel)}:${String(line)}(?!\d)`);

    test('BUG-52: the files below are the gate’s own: gate-file.mjs, vitest.shared.mjs and scripts/lib modules, so the test.each is never empty', () => {
      expect(GATE_MODULES).toContain('scripts/gate-file.mjs');
      expect(GATE_MODULES).toContain('vitest.shared.mjs');
      expect(GATE_MODULES.filter((rel) => rel.startsWith('scripts/lib/')).length).toBeGreaterThan(
        0,
      );
    });

    test.each(GATE_MODULES)(
      'BUG-52: with a syntax error in %s, the block message names that file and the line, as a path from the project root',
      (target) => {
        const dir = brokenCopy(target, SYNTAX_ERROR);
        const line = lineOf(dir, target, BROKEN_LINE);

        const result = hookIn(dir, SOURCE);

        expect(result.status, `stderr:\n${result.stderr}`).toBe(BLOCKED);
        expect(result.stderr).toMatch(/could not be loaded/i);
        expect(result.stderr).toContain('Unexpected token');
        expect(result.stderr, `no ${target}:${String(line)} in the message`).toMatch(
          at(target, line),
        );
        expect(ranLog(dir), 'gate:file was run, though its code could not be loaded').toBe('');
      },
    );

    test.each([
      { target: 'scripts/gate-file.mjs', from: './lib/steps.mjs' },
      { target: 'scripts/lib/steps.mjs', from: './glob.mjs' },
    ])(
      'BUG-52: with an import of a name not exported yet in $target, the block message names that file and the import’s line',
      ({ target, from }) => {
        const statement = `import { NOT_EXPORTED_YET } from '${from}';`;
        const dir = brokenCopy(target, `\n${statement}\n`);
        const line = lineOf(dir, target, statement);

        const result = hookIn(dir, SOURCE);

        expect(result.status, `stderr:\n${result.stderr}`).toBe(BLOCKED);
        expect(result.stderr).toMatch(/could not be loaded/i);
        expect(result.stderr).toContain('NOT_EXPORTED_YET');
        expect(result.stderr, `no ${target}:${String(line)} in the message`).toMatch(
          at(target, line),
        );
        expect(ranLog(dir), 'gate:file was run, though its code could not be loaded').toBe('');
      },
    );

    test('BUG-52: reached through a symlink to the project, as on macOS, where the temporary folder is one, the message still names the broken file from the project root', () => {
      // Node loads a module by its real path, so the file:/// it names for a
      // broken file is the real one; the session's cwd can be the symlink's
      // path. On macOS, /var is a symlink to /private/var. A path taken from
      // cwd then reads ../../private/var/…, so this test runs the hook through
      // a symlink here, rather than passing on Linux and failing on the Mac.
      const target = 'vitest.shared.mjs';
      const dir = brokenCopy(target, SYNTAX_ERROR);
      const line = lineOf(dir, target, BROKEN_LINE);
      const project = path.join(dirWith({}), 'project');
      symlinkSync(dir, project, 'dir');

      const result = hookIn(project, SOURCE);

      expect(result.status, `stderr:\n${result.stderr}`).toBe(BLOCKED);
      expect(result.stderr).toContain(SOURCE);
      expect(result.stderr, `no ${target}:${String(line)} in the message`).toMatch(
        at(target, line),
      );
      expect(ranLog(dir), 'gate:file was run, though its code could not be loaded').toBe('');
    });

    test('BUG-52: with a top-level `throw 42` in a scripts/lib module, which has no stack and no file to name, the edit still blocks and says what was thrown', () => {
      // A guard for the change above: code that reads a file and line out of
      // what was thrown must not itself throw on a value with no stack, or the
      // hook exits 1 and fails open again.
      const dir = brokenCopy('scripts/lib/glob.mjs', '\nthrow 42;\n');

      const result = hookIn(dir, SOURCE);

      expect(result.status, `stderr:\n${result.stderr}`).toBe(BLOCKED);
      expect(result.stderr).toMatch(/could not be loaded/i);
      expect(result.stderr).toContain(SOURCE);
      expect(result.stderr).toMatch(/\b42\b/);
      expect(ranLog(dir), 'gate:file was run, though its code could not be loaded').toBe('');
    });
  });
});
