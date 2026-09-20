#!/usr/bin/env node
// After each edit: run the per-file gate (format, lint, types, import rules, related tests).
// The gate logic lives in the repo (`pnpm gate:file`) so CI runs exactly the same checks.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readInput, relPath, block, tail } from './lib.mjs';

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

const r = spawnSync('pnpm', ['-s', 'gate:file', '--', rel], {
  cwd,
  encoding: 'utf8',
  timeout: 170_000,
});
if (r.error) block(`Checks could not run for ${rel}: ${r.error.message}`);
if (r.status !== 0)
  block(`Checks failed after editing ${rel}:\n${tail((r.stdout ?? '') + (r.stderr ?? ''))}`);
process.exit(0);
