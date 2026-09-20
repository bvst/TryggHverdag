#!/usr/bin/env node
// Flags possible test weakening right after a test file is edited (RG-03).
//
// The detection itself lives in scripts/lib/test-strength.mjs, which is also
// what `pnpm run tests:changes` uses on a whole pull request — one rule, two
// places it is enforced, no chance of the two disagreeing.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TEST_GLOBS, weakeningMessage, weakenings } from '../../scripts/lib/test-strength.mjs';
import { block, matchesAny, readInput, relPath } from './lib.mjs';

const input = await readInput();
const file = input?.tool_input?.file_path;
if (!file) process.exit(0);
const cwd = input.cwd || process.cwd();
const rel = relPath(file, cwd);
if (!matchesAny(rel, TEST_GLOBS)) process.exit(0);

const now = existsSync(path.join(cwd, rel)) ? readFileSync(path.join(cwd, rel), 'utf8') : '';
const old = spawnSync('git', ['show', `HEAD:${rel}`], { cwd, encoding: 'utf8' });
if (old.status !== 0) process.exit(0); // a new file can't be weakened

const issues = weakenings(old.stdout, now);
if (issues.length) block(weakeningMessage(rel, issues));
process.exit(0);
