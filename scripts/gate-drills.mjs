#!/usr/bin/env node
/**
 * INF-10: the gate drills' verdict (D-082). Runs this folder's
 * scripts/drills.test.mjs with its own Vitest configuration, then prints the
 * roadmap's nine drills, each blocked, got through, or not run here, and exits
 * 0 only when every offline drill ran and every test in the file passed
 * (scripts/lib/gate-drills.mjs decides).
 *
 * The drills also run in test:unit, wherever it runs. This is the table for
 * people: the owner, the pull request, and gate:full.
 *
 * Usage: pnpm run gate:drills
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { DRILL_FILE, drillReport } from './lib/gate-drills.mjs';
import { run } from './lib/proc.mjs';

/** Every test in Vitest's JSON report, as its full name and status; none when there is no report. */
function resultsIn(file) {
  if (!existsSync(file)) {
    return [];
  }
  return JSON.parse(readFileSync(file, 'utf8')).testResults.flatMap((module) =>
    module.assertionResults.map((test) => ({ name: test.fullName, status: test.status })),
  );
}

function main() {
  const cwd = process.cwd();
  // Outside the repository, so the run leaves nothing behind in it.
  const scratch = mkdtempSync(path.join(tmpdir(), 'gate-drills-'));
  const report = path.join(scratch, 'results.json');
  try {
    // Vitest's own output comes through as it runs: a drill that got through
    // shows why above the table.
    const vitest = spawnSync(
      process.execPath,
      [
        path.join(cwd, 'node_modules', 'vitest', 'vitest.mjs'),
        'run',
        DRILL_FILE,
        '--reporter=default',
        '--reporter=json',
        `--outputFile.json=${report}`,
      ],
      { cwd, stdio: 'inherit', timeout: 590_000 },
    );
    // Asked by running it, as gate:full asks Docker: a binary that does not
    // answer is no oasdiff.
    const oasdiff = run('oasdiff', ['--version'], { cwd, timeout: 15_000 }).ok;
    const verdict = drillReport(resultsIn(report), { oasdiff });
    process.stdout.write(`\n${verdict.text}`);
    process.exitCode = verdict.exitCode;
    // Every test passing is not enough if Vitest itself says the run failed,
    // for an error outside any test: that run is not trusted either.
    if (verdict.exitCode === 0 && vitest.status !== 0) {
      process.stdout.write(
        `gate:drills: Vitest exited with ${String(vitest.status ?? vitest.signal)} although every test passed, so the run is not trusted. Its output above says why.\n`,
      );
      process.exitCode = 1;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.filename === process.argv[1]) {
  main();
}
