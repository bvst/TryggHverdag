#!/usr/bin/env node
/**
 * RG-01: every requirement has at least one test that names it.
 *
 * Reads the requirement IDs out of the plan, looks for them in the test suite,
 * and writes docs/requirements-status.md. This report is also how progress is
 * measured (Section 9) — by tests, not by claims.
 *
 * Usage:
 *   pnpm run req:coverage                          write the report
 *   pnpm run req:coverage --fail-on-uncovered-changed   also fail when this
 *       branch touches a requirement that still has no test (used in CI)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { changedFiles } from './lib/git.mjs';
import { matchesAnyGlob } from './lib/glob.mjs';
import { run } from './lib/proc.mjs';
import { TEST_GLOBS } from './lib/test-strength.mjs';
import {
  collectRequirements,
  coverage,
  renderStatus,
  uncoveredInChanges,
} from './lib/requirements.mjs';

const REPORT = 'docs/requirements-status.md';

function readOrNull(cwd, file) {
  try {
    return readFileSync(path.join(cwd, file), 'utf8');
  } catch {
    return null;
  }
}

/** Every file git knows about, which is every file a requirement could be named in. */
export function trackedFiles(cwd) {
  const result = run('git', ['ls-files'], { cwd, timeout: 60_000 });
  return result.ok ? result.output.split('\n').filter((line) => line.trim() !== '') : [];
}

function main() {
  const cwd = process.cwd();
  const failOnUncovered = process.argv.includes('--fail-on-uncovered-changed');
  const read = (file) => readOrNull(cwd, file);

  const requirements = collectRequirements(read);
  if (requirements.length === 0) {
    process.stdout.write(
      'req:coverage: no requirements found in docs/plan. Either the plan moved or the parser is wrong — ' +
        'refusing to write an empty report.\n',
    );
    process.exitCode = 1;
    return;
  }

  const tracked = trackedFiles(cwd);
  const withText = (files) =>
    files.map((file) => ({ file, text: read(file) ?? '' })).filter((f) => f.text !== '');
  const testFiles = withText(tracked.filter((file) => matchesAnyGlob(file, TEST_GLOBS)));
  const specFiles = withText(tracked.filter((file) => file.startsWith('docs/specs/')));

  const rows = coverage(requirements, testFiles, specFiles);
  const report = renderStatus(rows);
  writeFileSync(path.join(cwd, REPORT), report);

  const covered = rows.filter((row) => row.tests.length > 0).length;
  const live = rows.filter((row) => row.priority !== 'parked').length;
  process.stdout.write(
    `req:coverage: ${String(covered)} of ${String(live)} live requirements have a test that names them. ` +
      `Report written to ${REPORT}.\n`,
  );

  if (!failOnUncovered) {
    return;
  }

  // Only product code and specs can implement a requirement. The repository's own
  // tooling mentions requirement IDs constantly — in comments explaining why a
  // guard exists — and counting those would make this gate cry wolf until nobody
  // listened to it.
  const changed = changedFiles({ cwd }).filter(
    (file) =>
      !matchesAnyGlob(file, TEST_GLOBS) &&
      (file.startsWith('apps/') || file.startsWith('packages/') || file.startsWith('docs/specs/')),
  );
  const changedText = changed.map((file) => read(file) ?? '').join('\n');
  const missing = uncoveredInChanges(rows, changedText);
  if (missing.length > 0) {
    process.stdout.write(
      `\nRG-01: this branch touches ${String(missing.length)} requirement(s) that no test names:\n` +
        missing.map((row) => `  ${row.id} — ${row.title}`).join('\n') +
        '\n\nWrite the failing test first (RG-02), or say in the pull request why this requirement ' +
        'cannot be tested automatically.\n',
    );
    process.exitCode = 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  main();
}
