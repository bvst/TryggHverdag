#!/usr/bin/env node
/**
 * RG-03 across a whole pull request: no test was quietly weakened.
 *
 * The post-edit hook checks the file being edited; this checks every test file
 * the branch touches, including ones deleted outright, using the same rules
 * (scripts/lib/test-strength.mjs).
 *
 * Usage: pnpm run tests:changes [--base origin/main]
 */
import process from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { changedFiles, fileAt, requireMergeBase } from './lib/git.mjs';
import { TEST_GLOBS, weakenings } from './lib/test-strength.mjs';
import { matchesGlob } from './lib/glob.mjs';

export function isTestFile(file) {
  return TEST_GLOBS.some((glob) => matchesGlob(file, glob));
}

/**
 * Compares every changed test file with its state at `ref`.
 *
 * @param {{ files: string[], contentsNow: (f: string) => string, contentsBefore: (f: string) => string | null }} sources
 * @returns {{ file: string, issues: string[] }[]}
 */
export function weakenedFiles({ files, contentsNow, contentsBefore }) {
  const found = [];
  for (const file of files.filter(isTestFile)) {
    const before = contentsBefore(file);
    if (before === null) {
      continue; // new file: nothing to weaken
    }
    const issues = weakenings(before, contentsNow(file));
    if (issues.length > 0) {
      found.push({ file, issues });
    }
  }
  return found;
}

/** The exit code: 0 when no changed test file was weakened, 1 otherwise. */
function main() {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf('--base');
  const base = baseIndex === -1 ? 'origin/main' : (args[baseIndex + 1] ?? 'origin/main');
  const cwd = process.cwd();

  // D-131 (BUG-46): with no merge base there is no "before" to compare with,
  // and the committed diff is dropped, so could-not-tell is a failure.
  const required = requireMergeBase(base, cwd);
  if (!required.ok) {
    process.stderr.write(`tests:changes: ${required.message}\n`);
    return 1;
  }

  const files = changedFiles({ base, cwd });
  const found = weakenedFiles({
    files,
    contentsNow: (file) =>
      existsSync(path.join(cwd, file)) ? readFileSync(path.join(cwd, file), 'utf8') : '',
    contentsBefore: (file) => fileAt(required.mergeBase, file, cwd),
  });

  if (found.length === 0) {
    const checked = files.filter(isTestFile).length;
    process.stdout.write(
      `tests:changes: ${String(checked)} changed test file(s), none weakened (RG-03).\n`,
    );
    return 0;
  }

  for (const { file, issues } of found) {
    process.stdout.write(`\n${file}\n  ${issues.join('\n  ')}\n`);
  }
  process.stdout.write(
    '\nRG-03: tests may not be weakened to make a change pass. Either restore what was ' +
      'removed, or justify each case in the pull request under "Test changes" for test-auditor to review.\n',
  );
  return 1;
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main();
}
