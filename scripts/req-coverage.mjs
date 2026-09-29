#!/usr/bin/env node
/**
 * RG-01: every requirement has at least one test that names it.
 *
 * Reads the requirement IDs out of the plan, looks for them in the test suite,
 * and writes docs/requirements-status.md. This report is also how progress is
 * measured (Section 9) — by tests, not by claims.
 *
 * Every run also prints each criterion a spec lets through untested with a
 * `req-coverage: not automated <ID>-ACn: <reason>` line, and its reason (D-082).
 *
 * Usage:
 *   pnpm run req:coverage                          write the report
 *   pnpm run req:coverage --fail-on-uncovered-changed   also fail when this
 *       branch touches a requirement that still has no test, a changed spec
 *       names an acceptance criterion no test names, or a not-automated line
 *       gives no reason (used in CI)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { changedFiles } from './lib/git.mjs';
import { matchesAnyGlob } from './lib/glob.mjs';
import { run } from './lib/proc.mjs';
import { TEST_GLOBS } from './lib/test-strength.mjs';
import {
  SPECS_DIR,
  collectRequirements,
  coverage,
  notAutomatedLines,
  notAutomatedNotices,
  renderStatus,
  rg01Message,
  rg01Refusals,
} from './lib/requirements.mjs';

const REPORT = 'docs/requirements-status.md';

function readOrNull(cwd, file) {
  try {
    return readFileSync(path.join(cwd, file), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Every file a requirement could be named in.
 *
 * `--others --exclude-standard` as well as the tracked ones, because a plain
 * `git ls-files` sees only what has already been added — and the file that most
 * often names a requirement for the first time is a test written minutes ago
 * and not yet staged. Without this the report counts it as missing, the run
 * before `git add` and the run after disagree, and the disagreement surfaces as
 * a CI failure on a report that was correct when it was written. A requirement
 * reported as uncovered when it is covered is the milder half; the same gap
 * would let `--fail-on-uncovered-changed` pass a change whose only test is new.
 */
export function trackedFiles(cwd) {
  const result = run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd,
    timeout: 60_000,
  });
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
  const specFiles = withText(tracked.filter((file) => file.startsWith(SPECS_DIR)));

  const rows = coverage(requirements, testFiles, specFiles);
  const report = renderStatus(rows);
  writeFileSync(path.join(cwd, REPORT), report);

  const covered = rows.filter((row) => row.tests.length > 0).length;
  const live = rows.filter((row) => row.priority !== 'parked').length;
  process.stdout.write(
    `req:coverage: ${String(covered)} of ${String(live)} live requirements have a test that names them. ` +
      `Report written to ${REPORT}.\n`,
  );

  // The way out is never taken quietly: every criterion a spec lets through
  // untested is printed with its reason, quoted, on every run (D-082).
  const notAutomated = notAutomatedLines(specFiles);
  for (const notice of notAutomatedNotices(notAutomated)) process.stdout.write(`${notice}\n`);

  if (!failOnUncovered) {
    return;
  }

  // Only product code and specs can implement a requirement. The repository's own
  // tooling mentions requirement IDs constantly — in comments explaining why a
  // guard exists — and counting those would make this gate cry wolf until nobody
  // listened to it.
  const changed = withText(
    changedFiles({ cwd }).filter(
      (file) =>
        !matchesAnyGlob(file, TEST_GLOBS) &&
        (file.startsWith('apps/') || file.startsWith('packages/') || file.startsWith(SPECS_DIR)),
    ),
  );
  // What RG-01 refuses is decided in requirements.mjs; this prints it and fails.
  const refusals = rg01Refusals({ rows, changed, testFiles, notAutomated });
  if (refusals.length > 0) {
    process.stdout.write(rg01Message(refusals));
    process.exitCode = 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  main();
}
