#!/usr/bin/env node
/**
 * The gates, as lists of steps (Section 6, test levels L1–L6).
 *
 *   quick — what a session must pass before it can call a task done (HK-06)
 *   full  — everything that is not a device or a deployment; what CI repeats
 *
 * Steps whose script does not exist yet are reported as "not possible yet",
 * with the task that adds them. They are never reported as passed.
 *
 * Usage: pnpm run gate:quick · pnpm run gate:full
 */
import process from 'node:process';
import { packageScripts, run } from './lib/proc.mjs';
import { planSteps, runPlan, summarize } from './lib/steps.mjs';

const pnpmRun = (script, ...args) => ['pnpm', 'run', script, ...args];

/** L1 and L2: fast enough to run before finishing any piece of work. */
export const QUICK_STEPS = [
  {
    name: 'static checks (types, lint, imports, formatting)',
    command: pnpmRun('gate:static'),
    needsScript: 'gate:static',
  },
  { name: 'unit tests', command: pnpmRun('test:unit'), needsScript: 'test:unit' },
  {
    name: 'no test was weakened (RG-03)',
    command: pnpmRun('tests:changes'),
    needsScript: 'tests:changes',
  },
];

/** Everything that runs without a phone or a deployment. */
export const FULL_STEPS = [
  ...QUICK_STEPS.slice(0, 2),
  {
    // No `--` before the flag: `pnpm run test:unit -- --coverage` reaches vitest
    // as `vitest run -- --coverage`, where `--coverage` is read as a filename to
    // filter tests by rather than as a flag. The suite then passes, no coverage
    // is written, and the ratchet below fails saying it has nothing to measure.
    name: 'unit tests with coverage',
    command: pnpmRun('test:unit', '--coverage'),
    needsScript: 'test:unit',
  },
  {
    name: 'integration tests (real PostgreSQL)',
    command: pnpmRun('test:integration'),
    needsScript: 'test:integration',
    arrivesIn: 'INF-05',
  },
  {
    name: 'system tests (the alert path end to end)',
    command: pnpmRun('test:system'),
    needsScript: 'test:system',
    arrivesIn: 'INF-05',
  },
  {
    name: 'requirement coverage (RG-01)',
    command: pnpmRun('req:coverage', '--', '--fail-on-uncovered-changed'),
    needsScript: 'req:coverage',
  },
  {
    name: 'no test was weakened (RG-03)',
    command: pnpmRun('tests:changes'),
    needsScript: 'tests:changes',
  },
  {
    name: 'coverage ratchet (RG-04)',
    command: pnpmRun('coverage:ratchet'),
    needsScript: 'coverage:ratchet',
  },
  { name: 'API compatibility (AR-08)', command: pnpmRun('api:diff'), needsScript: 'api:diff' },
  {
    name: 'mutation score on safety code (D-036)',
    command: pnpmRun('mutation', '--', '--incremental', '--only-if-safety-paths-changed'),
    needsScript: 'mutation',
  },
  {
    name: 'dependency licences (SEC-06)',
    command: pnpmRun('licenses:check'),
    needsScript: 'licenses:check',
  },
];

function main() {
  const which = process.argv[2] === 'full' ? 'full' : 'quick';
  const steps = which === 'full' ? FULL_STEPS : QUICK_STEPS;
  const cwd = process.cwd();

  const plan = planSteps(steps, packageScripts(cwd));
  for (const planned of plan) {
    process.stdout.write(
      planned.willRun ? `▶ ${planned.step.name}\n` : `· ${planned.step.name} — ${planned.reason}\n`,
    );
  }

  const results = runPlan(plan, (command) => {
    const [program, ...args] = command;
    const result = run(program, args, { cwd });
    return { ok: result.ok, output: result.output };
  });

  const summary = summarize(results, `gate:${which}`);
  process.stdout.write(summary.text);
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  main();
}
