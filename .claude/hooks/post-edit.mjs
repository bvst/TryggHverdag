#!/usr/bin/env node
// After each edit: run the per-file gate (format, lint, types, import rules, related tests).
// The gate logic lives in the repo (`pnpm gate:file`) so CI runs exactly the same checks.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { readInput, relPath, block, tail } from './lib.mjs';

// BUG-52: the project root from the hook's own place, not from cwd. Node names a
// broken module by its real path, and cwd can be a symlink (/var on macOS).
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GATE_URL = new URL('../../scripts/gate-file.mjs', import.meta.url).href;
const RELOAD_LIMIT_MS = 10_000;
const AT_LINE = /^(file:\/\/\/\S+):(\d+)$/m;

// BUG-52: where the gate broke, as path:line from the project root, or '' if node
// names no file. A caught SyntaxError has none in its stack (Node 22), so the
// gate is loaded again in a node of its own, which prints file:///…:line when it
// fails uncaught. Never throws: this runs only on the way to block().
function whereItBroke(error) {
  try {
    const first = error instanceof Error ? String(error.stack).split('\n', 1)[0] : '';
    const reload = () =>
      spawnSync(
        process.execPath,
        ['--input-type=module', '-e', `await import(${JSON.stringify(GATE_URL)})`],
        { encoding: 'utf8', timeout: RELOAD_LIMIT_MS },
      ).stderr ?? '';
    const found = AT_LINE.exec(first) ?? AT_LINE.exec(reload());
    return found ? `${relPath(fileURLToPath(found[1]), ROOT)}:${found[2]}` : '';
  } catch {
    return '';
  }
}

const input = await readInput();
const file = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
if (!file) process.exit(0);
const cwd = input.cwd || process.cwd();
const rel = relPath(file, cwd);
if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|json|ya?ml)$/.test(rel) || rel.startsWith('docs/'))
  process.exit(0);

const pkgJson = path.join(cwd, 'package.json');
if (!existsSync(pkgJson)) process.exit(0); // before the repository is bootstrapped
const scripts = JSON.parse(readFileSync(pkgJson, 'utf8')).scripts ?? {};
if (!scripts['gate:file']) {
  block(
    'The "gate:file" script is missing, so no checks ran on this edit. Gates are not active: create it (Section 7 setup).',
  );
}

// BUG-52 (D-133): loaded here, guarded, not by a static import. A gate whose code
// cannot load made node exit 1, which Claude Code does not block on: it must block.
let gate;
try {
  gate = await import('../../scripts/gate-file.mjs');
} catch (error) {
  const why = error instanceof Error ? `${error.name}: ${error.message}` : inspect(error);
  const where = whereItBroke(error);
  block(
    `gate:file could not be loaded, so no checks ran after editing ${rel}. ` +
      `scripts/gate-file.mjs or a file it loads failed${where ? `, at ${where}` : ''}: ${why}`,
  );
}

// BUG-52 (D-133): spawnSync takes only a whole number of ms above 0 as a limit.
// It runs with no limit on undefined, null or 0, and throws (exit 1) on anything
// else: both fail open. So any other value blocks, never a number of our own.
if (!Number.isInteger(gate.GATE_FILE_LIMIT_MS) || gate.GATE_FILE_LIMIT_MS <= 0) {
  block(
    `gate:file has no usable time limit, so no checks ran after editing ${rel}. ` +
      `scripts/gate-file.mjs must export GATE_FILE_LIMIT_MS as a whole number of milliseconds above 0, ` +
      `and it gave ${inspect(gate.GATE_FILE_LIMIT_MS)}.`,
  );
}

const r = spawnSync('pnpm', ['-s', 'gate:file', '--', rel], {
  cwd,
  encoding: 'utf8',
  timeout: gate.GATE_FILE_LIMIT_MS,
});
if (r.error) block(`Checks could not run for ${rel}: ${r.error.message}`);
if (r.status !== 0)
  block(`Checks failed after editing ${rel}:\n${tail((r.stdout ?? '') + (r.stderr ?? ''))}`);

// BUG-52: what a passing gate prints goes to the session as context (D-133).
const said = (r.stdout ?? '').trim();
if (!said) process.exit(0);
const additionalContext = `No check failed after editing ${rel}. The gate also said:\n${said}`;
// No process.exit after this write: on macOS, exiting at once can cut the JSON short.
process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }) +
    '\n',
);
