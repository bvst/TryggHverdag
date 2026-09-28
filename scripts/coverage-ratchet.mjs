#!/usr/bin/env node
/**
 * RG-04: coverage on changed files may not go down, and safety code has a floor.
 *
 * Reads both coverage summaries that `pnpm run test:coverage` writes, Vitest's
 * and the app's jest-expo one (COVERAGE_SUMMARIES), and compares them with the
 * committed baseline. Either one missing is a failure, never "nothing to
 * measure".
 *
 * Usage:
 *   pnpm run coverage:ratchet [--base origin/main]
 *   pnpm run coverage:ratchet --update     record today's numbers as the baseline
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { changedFiles } from './lib/git.mjs';
import {
  COVERAGE_SUMMARIES,
  floorBreaches,
  mergeSummaries,
  ratchetDrops,
} from './lib/coverage.mjs';

export const BASELINE = 'coverage-baseline.json';

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function main() {
  const cwd = process.cwd();
  const merged = mergeSummaries(
    COVERAGE_SUMMARIES.map(({ runner, file }) => {
      const summaryPath = path.join(cwd, file);
      return {
        runner,
        file,
        summary: existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null,
      };
    }),
    cwd,
  );
  if (!merged.ok) {
    process.stdout.write(`${merged.message}\n`);
    process.exitCode = 1;
    return;
  }

  const current = merged.files;

  if (process.argv.includes('--update')) {
    writeFileSync(
      path.join(cwd, BASELINE),
      JSON.stringify(
        { generated: new Date().toISOString().slice(0, 10), files: current },
        null,
        2,
      ) + '\n',
    );
    process.stdout.write(
      `coverage:ratchet: baseline updated from today's run (${String(Object.keys(current).length)} files).\n`,
    );
    return;
  }

  const baselinePath = path.join(cwd, BASELINE);
  const baseline = existsSync(baselinePath)
    ? (JSON.parse(readFileSync(baselinePath, 'utf8')).files ?? {})
    : {};
  const changed = changedFiles({ base: argValue('--base', 'origin/main'), cwd });

  const drops = ratchetDrops({ current, baseline, changed });
  const { breaches, notApplicable } = floorBreaches(current);

  for (const reason of notApplicable) {
    process.stdout.write(`coverage:ratchet: floor not in force — ${reason}.\n`);
  }

  if (drops.length === 0 && breaches.length === 0) {
    process.stdout.write(
      `coverage:ratchet: ${String(changed.length)} changed file(s), no coverage went down (RG-04).\n`,
    );
    return;
  }

  for (const drop of drops) {
    process.stdout.write(
      `↓ ${drop.file}: ${drop.metric} ${String(drop.was)}% → ${String(drop.now)}%\n`,
    );
  }
  for (const breach of breaches) {
    process.stdout.write(
      `✗ ${breach.scope}: ${breach.metric} ${String(breach.value)}% is below the floor of ${String(breach.floor)}%\n`,
    );
  }
  process.stdout.write(
    '\nRG-04: coverage on changed files may not go down, and safety code must stay above its floor. ' +
      'Add the missing tests, or raise the baseline deliberately with `--update` and explain why in the pull request.\n',
  );
  process.exitCode = 1;
}

if (import.meta.filename === process.argv[1]) {
  main();
}
