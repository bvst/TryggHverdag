// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-04: every edit is checked immediately, by the same script CI runs.
import { afterEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
    expect(source).toMatch(
      /import\s*\{[^}]*\bGATE_FILE_LIMIT_MS\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/scripts\/gate-file\.mjs['"]/,
    );
    expect(source).toMatch(/\btimeout:\s*GATE_FILE_LIMIT_MS\b/);
    expect(source, 'a timeout typed as a number').not.toMatch(/\btimeout:\s*\d/);
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
