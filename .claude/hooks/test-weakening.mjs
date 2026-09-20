#!/usr/bin/env node
// Flags possible test weakening right after a test file is edited (RG-03).
// CI runs the same detection on the whole pull request.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { readInput, relPath, matchesAny, block } from './lib.mjs';

const TEST_GLOBS = ['**/*.test.ts', '**/*.test.tsx', '**/*.test.mjs', 'apps/mobile/e2e/**'];
const input = await readInput();
const file = input?.tool_input?.file_path;
if (!file) process.exit(0);
const cwd = input.cwd || process.cwd();
const rel = relPath(file, cwd);
if (!matchesAny(rel, TEST_GLOBS)) process.exit(0);

const now = existsSync(path.join(cwd, rel)) ? readFileSync(path.join(cwd, rel), 'utf8') : '';
const old = spawnSync('git', ['show', `HEAD:${rel}`], { cwd, encoding: 'utf8' });
if (old.status !== 0) process.exit(0); // a new file can't be weakened
const before = old.stdout;

const count = (s, re) => (s.match(re) || []).length;
const TESTS = /\b(it|test)(\.each\([^)]*\))?\s*\(/g;
const EXPECTS = /\bexpect\s*\(|\bassert(Visible|NotVisible|True)?\b/g;
const SKIPS =
  /\b(it|test|describe)\.(skip|only|todo)\b|\bx(it|test|describe)\b|\bf(it|describe)\b/g;

const issues = [];
if (count(now, SKIPS) > count(before, SKIPS))
  issues.push('skipped, focused or todo tests were added');
if (count(now, TESTS) < count(before, TESTS)) issues.push('the number of tests went down');
if (count(now, EXPECTS) < count(before, EXPECTS)) issues.push('the number of assertions went down');
if (issues.length) {
  block(
    `RG-03: possible test weakening in ${rel}: ${issues.join('; ')}. ` +
      'This must be justified in the pull request under "Test changes", and test-auditor will review it. ' +
      'If it was not intended, restore the test.',
  );
}
process.exit(0);
