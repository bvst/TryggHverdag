#!/usr/bin/env node
/**
 * SEC-06: every dependency's licence is one we can actually ship.
 *
 * Usage: pnpm run licenses:check
 */
import process from 'node:process';
import { run } from './lib/proc.mjs';
import { ALLOWED_LICENCES, reviewLicences } from './lib/licenses.mjs';

function main() {
  const result = run('pnpm', ['licenses', 'list', '--json'], { timeout: 300_000 });
  if (!result.ok) {
    process.stdout.write(`licenses:check: could not read the licences.\n${result.output}\n`);
    process.exitCode = 1;
    return;
  }

  let report;
  try {
    report = JSON.parse(result.output.slice(result.output.indexOf('{')));
  } catch (error) {
    process.stdout.write(`licenses:check: could not parse pnpm's output: ${String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const problems = reviewLicences(report);
  const packageCount = Object.values(report).reduce((sum, list) => sum + list.length, 0);

  if (problems.length === 0) {
    process.stdout.write(
      `licenses:check: ${String(packageCount)} dependencies, all under licences we can ship ` +
        `(${ALLOWED_LICENCES.join(', ')}).\n`,
    );
    return;
  }

  for (const problem of problems) {
    process.stdout.write(
      `✗ ${problem.package}@${problem.versions.join(', ')} — ${problem.licence || 'none stated'}: ${problem.reason}\n`,
    );
  }
  process.stdout.write(
    '\nSEC-06: replace the dependency, or add the licence to ALLOWED_LICENCES in ' +
      'scripts/lib/licenses.mjs with a note in the pull request saying why it is safe to ship.\n',
  );
  process.exitCode = 1;
}

if (import.meta.filename === process.argv[1]) {
  main();
}
