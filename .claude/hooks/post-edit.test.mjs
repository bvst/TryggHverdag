// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-04: every edit is checked immediately, by the same script CI runs.
import { afterEach, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
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

// BUG-52, review loop 4 (privacy-security-reviewer's should-fix on loop 3).
// Loops 1 to 3 had the hook load scripts/gate-file.mjs in its own process for
// GATE_FILE_LIMIT_MS, by a static import and then by a guarded `await
// import()`. A guard catches a load that throws. It cannot catch a load that
// never finishes, and a timer cannot catch a synchronous hang. The reviewer
// appended each of these to the gate's code in a scratch copy:
// - `await new Promise(function () {})`: node exits 13, "Detected unsettled
//   top-level await";
// - the same with a live setInterval, or `while (true) {}`: the hook hangs
//   until Claude Code's own limit on it (180 s) ends it.
// Claude Code blocks on neither, so the edit that broke the gate went through,
// and so did every later edit until the file was fixed.
//
// The fix (the reviewer's option (a), D-031): the hook loads no code of the
// repository. The gate's code then runs only in the gate:file child, which the
// hook stops at a limit of its own, and each way that child can end other than
// exit 0 blocks the edit: a non-zero exit, a signal, or an error from spawnSync
// itself, such as ETIMEDOUT. The tests below hold the hook to that.
//
// Decided here (test-author, D-031): the hook's source is read as the parser
// sees it (TypeScript's, a dependency of the repository already), not with a
// regular expression. So a mention in a comment or a string does not count,
// and a dynamic import whose specifier is computed at run time does: it could
// load anything. What the hook may load: node: built-ins, except the three
// that load or run code in the hook's own process (node:module, node:vm,
// node:worker_threads), and files in .claude/hooks, followed through every
// file it loads, so lib.mjs, or anything it comes to load later, is held to
// the same. require() and createRequire count as loads too.
const REPO = path.resolve(import.meta.dirname, '..', '..');
const HOOK = '.claude/hooks/post-edit.mjs';
const HOOKS_FOLDER = '.claude/hooks';
const GATE = 'scripts/gate-file.mjs';

/** A JavaScript module parsed, by default the repository's file `rel`. */
function parse(rel, text = readFileSync(path.join(REPO, rel), 'utf8')) {
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

/** The nodes of `source` that `keep` accepts, in the order they appear. */
function nodesIn(source, keep) {
  const found = [];
  const visit = (node) => {
    if (keep(node)) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * How a parsed module loads code: each import and export … from, static or
 * dynamic, each require() and each createRequire. `specifier` is undefined
 * where it is not a string literal, that is, where it is computed at run time.
 */
function loadsIn(source) {
  const literal = (node) =>
    node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;
  const loads = [];
  nodesIn(source, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      loads.push({ how: 'import', specifier: literal(node.moduleSpecifier) });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      loads.push({ how: 'import()', specifier: literal(node.arguments[0]) });
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      loads.push({ how: 'require()', specifier: literal(node.arguments[0]) });
    } else if (ts.isIdentifier(node) && node.text === 'createRequire') {
      loads.push({ how: 'createRequire', specifier: undefined });
    }
    return false;
  });
  return loads;
}

/**
 * The repository's modules loaded from `start`, followed through relative
 * specifiers, and each load `allowed` refuses, as "file: how 'specifier'". A
 * refused load is not followed.
 */
function follow(start, allowed = () => true) {
  const modules = [];
  const refused = [];
  const visit = (rel) => {
    if (modules.includes(rel)) {
      return;
    }
    modules.push(rel);
    for (const load of loadsIn(parse(rel))) {
      const target =
        load.specifier !== undefined && /^\.{1,2}\//.test(load.specifier)
          ? path.posix.normalize(path.posix.join(path.posix.dirname(rel), load.specifier))
          : undefined;
      if (!allowed(load, target)) {
        const what =
          load.specifier === undefined
            ? '(a specifier computed at run time)'
            : `'${load.specifier}'`;
        refused.push(`${rel}: ${load.how} ${what}`);
      } else if (target !== undefined) {
        visit(target);
      }
    }
  };
  visit(start);
  return { modules, refused };
}

/** node: built-ins that load or run code in the hook's own process. */
const RUNS_CODE_IN_PROCESS = new Set(['node:module', 'node:vm', 'node:worker_threads']);

/** What the hook may load: a node: built-in that runs no code in its process, or a file in .claude/hooks. */
function hookMayLoad({ how, specifier }, target) {
  if ((how !== 'import' && how !== 'import()') || specifier === undefined) {
    return false;
  }
  if (specifier.startsWith('node:')) {
    return !RUNS_CODE_IN_PROCESS.has(specifier);
  }
  return target !== undefined && target.startsWith(`${HOOKS_FOLDER}/`);
}

describe('HK-04 (BUG-52): the post-edit hook loads no code of the repository', () => {
  test('BUG-52: the scan sees each way a module loads code, and not a mention in a comment or a string', () => {
    // The check below is only as good as this scan, so the scan is checked
    // first, on synthetic source: each form the hook has used or could use.
    const text = [
      "import { spawnSync } from 'node:child_process';",
      "import { GATE_FILE_LIMIT_MS } from '../../scripts/gate-file.mjs';",
      "import '../../vitest.shared.mjs';",
      "export { run } from '../../scripts/lib/proc.mjs';",
      "const gate = await import('../../scripts/gate-file.mjs');",
      "const later = await import(new URL('../../scripts/lib/steps.mjs', import.meta.url).href);",
      'const load = createRequire(import.meta.url);',
      "const cjs = require('../../scripts/a-commonjs-file.cjs');",
      "// import { x } from '../../scripts/in-a-comment.mjs'; await import('../../scripts/in-a-comment.mjs');",
      "spawnSync(process.execPath, ['-e', \"await import('../../scripts/in-a-child.mjs')\"]);",
    ].join('\n');

    expect(loadsIn(parse('synthetic.mjs', text))).toEqual([
      { how: 'import', specifier: 'node:child_process' },
      { how: 'import', specifier: '../../scripts/gate-file.mjs' },
      { how: 'import', specifier: '../../vitest.shared.mjs' },
      { how: 'import', specifier: '../../scripts/lib/proc.mjs' },
      { how: 'import()', specifier: '../../scripts/gate-file.mjs' },
      { how: 'import()', specifier: undefined },
      { how: 'createRequire', specifier: undefined },
      { how: 'require()', specifier: '../../scripts/a-commonjs-file.cjs' },
    ]);
  });

  test('BUG-52: the hook loads only node: built-ins and files beside it in .claude/hooks, followed through each file it loads, so none of the repository’s code runs in its process', () => {
    const { modules, refused } = follow(HOOK, hookMayLoad);

    expect(
      refused,
      `what the hook loads besides node: built-ins and files in ${HOOKS_FOLDER}:\n${refused.join('\n')}`,
    ).toEqual([]);
    expect(modules, 'the scan followed the hook into lib.mjs, which it imports').toContain(
      `${HOOKS_FOLDER}/lib.mjs`,
    );
  });
});

// BUG-52, review loops 1 and 4. The hook stops gate:file at a limit, and the
// gate's own budget (the Docker probe and its steps) is checked against
// GATE_FILE_LIMIT_MS in scripts/gate-file.test.mjs. Loop 1 had the hook take
// the limit from there by importing it, so the two could not drift. Loop 4 (the
// review above) forbids the import. So the hook holds the limit as a number of
// its own, and these tests hold that number to the gate's:
// - the gate's export is a safe whole number of milliseconds above 0, the
//   values spawnSync takes as a limit. It runs with no limit on undefined, null
//   and 0, and throws on a string, NaN, a negative number, Infinity or a
//   fraction (Node 22, checked in loop 3). 1e300 is a whole number too, and
//   spawnSync takes it without a word, as no limit in effect (the reviewer,
//   loop 3; checked again: it throws nothing). A safe integer leaves it out, and
//   the settings.json test bounds the number from above;
// - the hook declares GATE_FILE_LIMIT_MS once, at its top level, as a const
//   holding a plain number, the gate's number. A value read at run time, from
//   an environment variable or anything else, could differ from what is pinned
//   here, so it does not count;
// - the spawnSync that runs gate:file has `timeout: GATE_FILE_LIMIT_MS`. A
//   fallback such as `?? 170_000` got past loop 1's regex, so the parser reads
//   the whole value. What the hook really asks spawnSync for is pinned too,
//   below, from a run of the hook ("asks spawnSync to stop gate:file at").
// - Claude Code's own limit on the hook (settings.json) is at least 5 s longer,
//   so the hook lives to report a gate it stopped.
describe('HK-04 (BUG-52): the hook’s limit on gate:file', () => {
  const HOOK_MARGIN_MS = 5_000;

  test('BUG-52: GATE_FILE_LIMIT_MS, exported by scripts/gate-file.mjs, is a safe whole number of milliseconds above 0, a value spawnSync takes as a limit', () => {
    expect(
      Number.isSafeInteger(GATE_FILE_LIMIT_MS),
      `GATE_FILE_LIMIT_MS is ${String(GATE_FILE_LIMIT_MS)}`,
    ).toBe(true);
    expect(GATE_FILE_LIMIT_MS).toBeGreaterThan(0);
  });

  test('BUG-52: the hook holds its limit as a number of its own, GATE_FILE_LIMIT_MS: declared once, at its top level, as a const holding a plain number, the number scripts/gate-file.mjs exports', () => {
    const source = parse(HOOK);
    const declarations = nodesIn(
      source,
      (node) =>
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'GATE_FILE_LIMIT_MS',
    );

    expect(
      declarations.map((node) => node.getText(source)),
      'the declarations of GATE_FILE_LIMIT_MS in the hook',
    ).toHaveLength(1);
    const [declaration] = declarations;
    const list = declaration.parent;
    expect(
      ts.isVariableStatement(list.parent) && list.parent.parent === source,
      'declared at the hook’s top level',
    ).toBe(true);
    expect((list.flags & ts.NodeFlags.Const) !== 0, 'declared with const').toBe(true);
    const value = declaration.initializer;
    expect(
      value !== undefined && ts.isNumericLiteral(value),
      `GATE_FILE_LIMIT_MS = ${String(value?.getText(source))}: a plain number, read from nothing at run time`,
    ).toBe(true);
    expect(
      Number(value.text),
      'the hook’s GATE_FILE_LIMIT_MS, against the one scripts/gate-file.mjs exports',
    ).toBe(GATE_FILE_LIMIT_MS);
  });

  test('BUG-52: the spawnSync that runs gate:file is stopped at the hook’s GATE_FILE_LIMIT_MS: `timeout: GATE_FILE_LIMIT_MS`, once, with nothing spread over it', () => {
    const source = parse(HOOK);
    const runsGate = nodesIn(
      source,
      (node) =>
        ts.isCallExpression(node) &&
        /\bspawnSync$/.test(node.expression.getText(source)) &&
        node.arguments.some(
          (argument) =>
            ts.isArrayLiteralExpression(argument) &&
            argument.elements.some(
              (element) => ts.isStringLiteralLike(element) && element.text === 'gate:file',
            ),
        ),
    );

    expect(
      runsGate.map((node) => node.getText(source)),
      'the spawnSync calls in the hook that run gate:file',
    ).toHaveLength(1);
    const options = runsGate[0].arguments[2];
    expect(
      options !== undefined && ts.isObjectLiteralExpression(options),
      `its options, an object written out: ${String(options?.getText(source))}`,
    ).toBe(true);
    expect(
      options.properties.filter((property) => ts.isSpreadAssignment(property)).length,
      'options spread into it, which could set another limit',
    ).toBe(0);
    const timeouts = options.properties.filter(
      (property) => property.name?.getText(source) === 'timeout',
    );
    expect(
      timeouts.map((property) =>
        ts.isPropertyAssignment(property)
          ? property.initializer.getText(source)
          : property.getText(source),
      ),
      'the timeout spawnSync is given',
    ).toEqual(['GATE_FILE_LIMIT_MS']);
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

// BUG-52, review loops 2 to 4 (privacy-security-reviewer and test-auditor). A
// gate whose code cannot load, or never finishes loading, must block the edit,
// and say why. If any of the files the gate loads cannot load (a syntax error,
// or, mid-TDD, an import of a name not exported yet), or its load never ends,
// the edit that broke it must not go through, nor any checked edit after it.
// Loops 2 and 3 caught that in the hook. Loop 4 moved it into the gate:file
// child, where the hook's limit holds: the hook loads none of the gate's code
// (above), so whatever the gate's code does ends the child, and the hook blocks
// on every end but exit 0. What node prints when a module fails uncaught,
// file:///…:line included, reaches the session in the block message, which
// carries the end of the gate's output.
//
// These run a copy of the hook in a temporary folder that holds the files the
// hook loads and the files the gate loads, each followed from its own imports,
// so a file either comes to load later is copied too. gate:file there is
// load-gate.mjs. It loads the copy's gate code, as `node scripts/gate-file.mjs`
// does, runs no check, and passes. It writes to ran.txt that it started and,
// once the gate's code has loaded, that it loaded. So a block that came through
// the child shows the first and not the second; a hook that loads the gate's
// code itself blocks before the child starts, or never ends.
//
// A gate that never finishes. The hook's limit is 170 s, which a test cannot
// wait out, and production code gets no knob for tests. So these runs can load
// record-spawn.mjs into the hook's node first (node --import). It writes down
// each spawnSync the hook makes, and in the two hang tests it stops gate:file
// after 3 s instead of the limit the hook asked for, which is pinned to
// GATE_FILE_LIMIT_MS from what it wrote down. In those two tests pnpm is a shim
// on PATH that execs node in its own place: checked by hand (pnpm 10.33), pnpm
// stopped at a limit leaves its node child running, and a gate that spins
// would outlive the test. Two more shims pin the hook's other ways out: a pnpm
// ended by a signal (no exit code), and no pnpm at all (spawnSync's ENOENT).
//
// Decided in loop 2 (test-author, D-031), and unchanged: an edit to a file the
// gate does not check, such as a .md file, still exits 0 and prints nothing
// when the gate's code is broken. The gate has nothing to say about such a
// file, so the hook's early exit comes before it starts the gate. That hides
// nothing: the edit that broke the gate is to a file the gate checks (.mjs)
// and blocks, and so does every checked edit after it. And while the gate is
// down, a session can still write down in docs/ what broke.
describe('HK-04 (BUG-52): a gate:file whose code cannot load, or never finishes, blocks the edit, through the child', () => {
  const SOURCE = 'apps/server/src/api.ts';
  const SYNTAX_ERROR = '\nexport const broken = ;\n';
  const NEVER_SETTLES = '\nawait new Promise(function () {});\n';
  const STARTED = 'gate:file started';
  const LOADED = 'gate:file loaded the gate';
  const SHORT_LIMIT_MS = 3_000;
  const HANG_ENDS_AFTER_MS = 60_000;

  /** The files the gate loads, followed from scripts/gate-file.mjs. */
  const GATE_MODULES = follow(GATE).modules;

  /** A temporary project: the files the hook and the gate load, and a gate:file that only loads the gate's code. */
  function projectCopy() {
    const dir = dirWith({
      'package.json': JSON.stringify({
        name: 'fake',
        private: true,
        scripts: { 'gate:file': 'node load-gate.mjs' },
      }),
      'load-gate.mjs': [
        "import { appendFileSync } from 'node:fs';",
        `appendFileSync('ran.txt', ${JSON.stringify(STARTED)} + ' ' + process.argv.slice(2).join(' ') + '\\n');`,
        `await import('./${GATE}');`,
        `appendFileSync('ran.txt', ${JSON.stringify(LOADED)} + '\\n');`,
      ].join('\n'),
    });
    for (const rel of new Set([...follow(HOOK).modules, ...GATE_MODULES])) {
      mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
      copyFileSync(path.join(REPO, rel), path.join(dir, rel));
    }
    return dir;
  }

  /** A project copy with `text` appended to `target`, one of the files the gate loads. */
  function brokenCopy(target, text) {
    expect(
      GATE_MODULES,
      `the gate does not load ${target}, so breaking it proves nothing`,
    ).toContain(target);
    const dir = projectCopy();
    appendFileSync(path.join(dir, target), text);
    return dir;
  }

  /** A shell script as `pnpm` in the copy's bin/, and a PATH that finds it first. */
  function fakePnpm(dir, lines) {
    const bin = path.join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'pnpm'), ['#!/bin/sh', ...lines, ''].join('\n'), { mode: 0o755 });
    return { bin, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` };
  }

  /**
   * record-spawn.mjs in the copy, for the hook's node to load first. It writes
   * each spawnSync the hook makes to spawned.jsonl and, given `limitMs`, stops
   * it after that many ms instead of the limit the hook asked for.
   */
  function recordSpawns(dir, limitMs) {
    const file = path.join(dir, 'record-spawn.mjs');
    writeFileSync(
      file,
      [
        "import { appendFileSync } from 'node:fs';",
        "import childProcess from 'node:child_process';",
        "import { syncBuiltinESMExports } from 'node:module';",
        'const spawnSync = childProcess.spawnSync;',
        'childProcess.spawnSync = (command, args, options) => {',
        "  const call = { command, args, timeout: options?.timeout ?? 'none' };",
        "  appendFileSync(new URL('spawned.jsonl', import.meta.url), JSON.stringify(call) + '\\n');",
        limitMs === undefined
          ? '  return spawnSync(command, args, options);'
          : `  return spawnSync(command, args, { ...options, timeout: ${String(limitMs)} });`,
        '};',
        'syncBuiltinESMExports();',
      ].join('\n'),
    );
    return file;
  }

  /** What record-spawn.mjs wrote down about the spawnSync calls that ran gate:file. */
  function gateSpawns(dir) {
    let text;
    try {
      text = readFileSync(path.join(dir, 'spawned.jsonl'), 'utf8');
    } catch {
      return [];
    }
    return text
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line))
      .filter((call) => Array.isArray(call.args) && call.args.includes('gate:file'));
  }

  /**
   * Runs the copy's hook on an edit of `file`, the way runHook runs the real
   * one. `hung` is true if the hook itself did not end within `limitMs`.
   */
  function hookIn(dir, file, { PATH = process.env.PATH, preload, limitMs = 60_000 } = {}) {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, PATH };
    delete env.TRYGGHVERDAG_REVIEW_JOB;
    const result = spawnSync(
      process.execPath,
      [...(preload ? ['--import', pathToFileURL(preload).href] : []), path.join(dir, HOOK)],
      {
        input: JSON.stringify({ cwd: dir, ...edit(path.join(dir, file)) }),
        cwd: dir,
        env,
        encoding: 'utf8',
        timeout: limitMs,
      },
    );
    if (result.error && result.error.code !== 'ETIMEDOUT') {
      throw result.error;
    }
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      hung: result.error !== undefined,
    };
  }

  /**
   * What each block below holds: the hook ended, with exit 2, naming the
   * edited file and printing nothing for the session; gate:file started, so
   * the block came through the child; and the gate's code never loaded.
   */
  function expectBlockedThroughTheChild(dir, result, edited) {
    expect(
      result.hung,
      'the hook itself did not end: Claude Code’s own limit would end it, and that is no block',
    ).toBe(false);
    expect(result.status, `stderr:\n${result.stderr}`).toBe(BLOCKED);
    expect(result.stderr, 'the block message names the edited file').toContain(edited);
    expect(result.stdout).toBe('');
    expect(
      ranLog(dir),
      'gate:file never started: the hook blocked without it, so it loaded the gate’s code itself',
    ).toContain(STARTED);
    expect(ranLog(dir), 'gate:file ran on, though the gate’s code did not load').not.toContain(
      LOADED,
    );
  }

  /** The 1-based number of the last line of the copy's `rel` that is exactly `text`. */
  function lineOf(dir, rel, text) {
    const index = readFileSync(path.join(dir, rel), 'utf8').split('\n').lastIndexOf(text);
    expect(index, `"${text}" is not a line of ${rel}`).toBeGreaterThanOrEqual(0);
    return index + 1;
  }

  const escaped = (text) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  /** How node names line `line` of the copy's `rel`: the end of its file:///…:line, in this copy. */
  const nodeNames = (dir, rel, line) =>
    new RegExp(String.raw`/${escaped(path.basename(dir))}/${escaped(rel)}:${String(line)}(?!\d)`);

  test('BUG-52: the copy’s control: with the gate’s code intact, an edit to a source file starts gate:file, which loads the gate’s code and passes, and the hook exits 0 and prints nothing', () => {
    // If the copy lacked a file the gate or the hook loads, this would fail
    // too, so the blocks below come from the breaks, not an incomplete copy.
    const dir = projectCopy();

    const result = hookIn(dir, SOURCE);

    expect(result.status, `stderr:\n${result.stderr}`).toBe(ALLOWED);
    expect(result.stdout).toBe('');
    expect(ranLog(dir)).toContain(STARTED);
    expect(ranLog(dir)).toContain(SOURCE);
    expect(ranLog(dir)).toContain(LOADED);
  });

  test('BUG-52: the hook asks spawnSync to stop gate:file at GATE_FILE_LIMIT_MS, the number scripts/gate-file.mjs exports', () => {
    const dir = projectCopy();

    const result = hookIn(dir, SOURCE, { preload: recordSpawns(dir) });

    expect(result.status, `stderr:\n${result.stderr}`).toBe(ALLOWED);
    expect(gateSpawns(dir)).toEqual([
      {
        command: 'pnpm',
        args: expect.arrayContaining(['gate:file', SOURCE]),
        timeout: GATE_FILE_LIMIT_MS,
      },
    ]);
  });

  test('BUG-52: the files below are the gate’s own: gate-file.mjs, vitest.shared.mjs and scripts/lib modules, so the test.each is never empty', () => {
    expect(GATE_MODULES).toContain(GATE);
    expect(GATE_MODULES).toContain('vitest.shared.mjs');
    expect(GATE_MODULES.filter((rel) => rel.startsWith('scripts/lib/')).length).toBeGreaterThan(0);
    expect(GATE_MODULES.filter((rel) => rel.startsWith(`${HOOKS_FOLDER}/`))).toEqual([]);
  });

  test.each(GATE_MODULES)(
    'BUG-52: with a syntax error in %s, an edit to a source file blocks (exit 2) through gate:file, and the block message carries node’s file and line for the broken file',
    (target) => {
      const dir = brokenCopy(target, SYNTAX_ERROR);
      const line = lineOf(dir, target, SYNTAX_ERROR.trim());

      const result = hookIn(dir, SOURCE);

      expectBlockedThroughTheChild(dir, result, SOURCE);
      expect(result.stderr).toContain('Unexpected token');
      expect(result.stderr, `no …/${target}:${String(line)} in the message`).toMatch(
        nodeNames(dir, target, line),
      );
    },
  );

  test.each([
    { target: GATE, from: './lib/steps.mjs' },
    { target: 'scripts/lib/steps.mjs', from: './glob.mjs' },
  ])(
    'BUG-52: with an import of a name not exported yet in $target, an edit to a source file blocks (exit 2) through gate:file, and the block message carries node’s file and line for the import',
    ({ target, from }) => {
      const statement = `import { NOT_EXPORTED_YET } from '${from}';`;
      const dir = brokenCopy(target, `\n${statement}\n`);
      const line = lineOf(dir, target, statement);

      const result = hookIn(dir, SOURCE);

      expectBlockedThroughTheChild(dir, result, SOURCE);
      expect(result.stderr).toContain('NOT_EXPORTED_YET');
      expect(result.stderr, `no …/${target}:${String(line)} in the message`).toMatch(
        nodeNames(dir, target, line),
      );
    },
  );

  const BREAKS = [
    {
      broken: 'a syntax error in gate-file.mjs',
      target: GATE,
      text: SYNTAX_ERROR,
      said: /Unexpected token/,
    },
    {
      broken: 'an import of a name not exported yet',
      target: GATE,
      text: "\nimport { NOT_EXPORTED_YET } from './lib/steps.mjs';\n",
      said: /NOT_EXPORTED_YET/,
    },
    {
      // No stack and no file to name: node prints the thrown value only.
      broken: '`throw 42` in scripts/lib/glob.mjs',
      target: 'scripts/lib/glob.mjs',
      text: '\nthrow 42;\n',
      said: /\b42\b/,
    },
    {
      broken: 'an await that never settles (exit 13)',
      target: GATE,
      text: NEVER_SETTLES,
      said: /unsettled top-level await/i,
    },
  ];
  const CASES = BREAKS.flatMap((each) => [GATE, SOURCE].map((edited) => ({ ...each, edited })));

  test.each(CASES)(
    'BUG-52: with $broken, an edit to $edited blocks (exit 2) through gate:file, names the edited file, and carries what node said',
    ({ target, text, said, edited }) => {
      const dir = brokenCopy(target, text);

      const result = hookIn(dir, edited);

      expectBlockedThroughTheChild(dir, result, edited);
      expect(result.stderr).toMatch(said);
    },
  );

  test.each([
    {
      hang: 'a busy loop',
      text: `\nconst until = Date.now() + ${String(HANG_ENDS_AFTER_MS)};\nwhile (Date.now() < until) {}\n`,
    },
    {
      hang: 'an await that never settles, and a timer',
      text: `\nconst timer = setInterval(() => {}, 1_000);\nsetTimeout(() => clearInterval(timer), ${String(HANG_ENDS_AFTER_MS)});\nawait new Promise(function () {});\n`,
    },
  ])(
    'BUG-52: with $hang in scripts/gate-file.mjs, gate:file never finishes: the hook stops it at its limit and blocks (exit 2), saying ETIMEDOUT, and does not hang itself',
    ({ text }) => {
      // Each hang ends by itself after a minute, so even if something here goes
      // wrong, nothing it starts spins on for longer than that.
      const dir = brokenCopy(GATE, text);
      const { PATH } = fakePnpm(dir, [
        `exec ${JSON.stringify(process.execPath)} load-gate.mjs "$@"`,
      ]);

      const result = hookIn(dir, SOURCE, {
        PATH,
        preload: recordSpawns(dir, SHORT_LIMIT_MS),
        limitMs: 30_000,
      });

      expectBlockedThroughTheChild(dir, result, SOURCE);
      expect(result.stderr, 'the block message says gate:file ran out of time').toMatch(
        /ETIMEDOUT/,
      );
      expect(
        gateSpawns(dir).map((call) => call.timeout),
        'the limit the hook asked for, before record-spawn.mjs shortened it',
      ).toEqual([GATE_FILE_LIMIT_MS]);
    },
  );

  test('BUG-52: a gate:file ended by a signal, with no exit code, blocks (exit 2) and names the edited file', () => {
    const dir = projectCopy();
    const { bin, PATH } = fakePnpm(dir, [`echo '${STARTED}' >> ran.txt`, 'kill -KILL $$']);
    const fixture = spawnSync(path.join(bin, 'pnpm'), [], { cwd: dirWith({}) });
    expect(
      { status: fixture.status, signal: fixture.signal },
      'the fixture: this pnpm ends by a signal',
    ).toEqual({ status: null, signal: 'SIGKILL' });

    const result = hookIn(dir, SOURCE, { PATH });

    expect(result.status, `stderr:\n${result.stderr}`).toBe(BLOCKED);
    expect(result.stderr).toContain(SOURCE);
    expect(result.stdout).toBe('');
    expect(ranLog(dir), 'the hook never ran this pnpm').toContain(STARTED);
  });

  test('BUG-52: with no pnpm to run gate:file, spawnSync’s own error blocks (exit 2), and the block message names it (ENOENT) and the edited file', () => {
    const dir = projectCopy();
    const empty = path.join(dir, 'empty-bin');
    mkdirSync(empty);

    const result = hookIn(dir, SOURCE, { PATH: empty });

    expect(result.status, `stderr:\n${result.stderr}`).toBe(BLOCKED);
    expect(result.stderr).toContain(SOURCE);
    expect(result.stderr, 'the block message names spawnSync’s error').toMatch(/ENOENT/);
    expect(result.stdout).toBe('');
    expect(ranLog(dir)).toBe('');
  });

  test.each(
    [
      { broken: 'a syntax error', text: SYNTAX_ERROR },
      { broken: 'an await that never settles', text: NEVER_SETTLES },
    ].flatMap((each) => ['docs/plan/README.md', 'README.md'].map((file) => ({ ...each, file }))),
  )(
    'BUG-52: with $broken in scripts/gate-file.mjs, an edit to $file, which the gate does not check, still exits 0, prints nothing and starts no gate:file',
    ({ text, file }) => {
      const dir = brokenCopy(GATE, text);

      const result = hookIn(dir, file);

      expect(result.status, `stderr:\n${result.stderr}`).toBe(ALLOWED);
      expect(result.stdout).toBe('');
      expect(ranLog(dir)).toBe('');
      // The control: in this same copy a checked edit blocks, so the 0 above is
      // the hook's early exit, not a gate that loaded after all.
      expect(hookIn(dir, SOURCE).status).toBe(BLOCKED);
    },
  );

  test.each(['docs/plan/README.md', 'README.md'])(
    'BUG-52: with the gate’s code intact, an edit to %s, which the gate does not check, exits 0, prints nothing and runs nothing',
    (file) => {
      const dir = projectCopy();

      const result = hookIn(dir, file);

      expect(result.status, `stderr:\n${result.stderr}`).toBe(ALLOWED);
      expect(result.stdout).toBe('');
      expect(ranLog(dir)).toBe('');
    },
  );
});
