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
import { checkDevices } from './lib/e2e-android.mjs';
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
    // The unit tests have just run the drills with every other test. This is
    // their verdict in the roadmap's nine rows, blocked or not, for the person
    // reading a full run. Not in quick: test:unit already runs them there.
    name: 'gate drills (INF-10)',
    command: pnpmRun('gate:drills'),
    needsScript: 'gate:drills',
  },
  {
    // Its own script and its own config, not `test:unit --coverage`. The floor
    // and the baseline in coverage-baseline.json were recorded from unit *and*
    // system tests, because the API, the router and the health service are
    // reached at L6 and nowhere else. Measuring the unit run alone reports
    // about 59 % for code that is in fact tested, and the ratchet then fails on
    // a number that is not about the code at all.
    name: 'coverage (unit and system, the run the baseline was recorded from)',
    command: pnpmRun('test:coverage'),
    needsScript: 'test:coverage',
  },
  {
    name: 'integration tests (real PostgreSQL)',
    command: pnpmRun('test:integration'),
    needsScript: 'test:integration',
    needsTool: 'docker',
    toolReason: 'a real PostgreSQL runs in a container (L3)',
  },
  {
    name: 'system tests (the alert path end to end)',
    command: pnpmRun('test:system'),
    needsScript: 'test:system',
  },
  {
    // A full native build and an emulator run, so only where a device is
    // connected. Everywhere else it is reported as not possible here, with
    // where it does run, rather than left out of the list.
    name: 'Android end-to-end flows (L7)',
    command: pnpmRun('e2e:android'),
    needsScript: 'e2e:android',
    needsTool: 'android',
    toolReason:
      'no Android device or emulator is connected; the android-e2e check runs it on every pull request that can change the app (CI-09)',
  },
  {
    name: 'requirement coverage (RG-01)',
    command: pnpmRun('req:coverage', '--fail-on-uncovered-changed'),
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
    command: pnpmRun('mutation', '--incremental', '--only-if-safety-paths-changed'),
    needsScript: 'mutation',
  },
  {
    name: 'dependency licences (SEC-06)',
    command: pnpmRun('licenses:check'),
    needsScript: 'licenses:check',
  },
  {
    // CI-01 reads the merge rules over the network, so it can only run where
    // the tokens are. Listed here rather than left out, so that a local run
    // says the merge rules were not checked instead of quietly not checking
    // them — which is the same rule the rest of this file follows.
    name: 'the merge rules are real (CI-01)',
    command: pnpmRun('gate:integrity'),
    needsScript: 'gate:integrity',
    needsEnv: ['GITHUB_TOKEN'],
    envReason: 'it reads GitHub; RULES_READ_TOKEN too (owner to-do A-15)',
  },
];

/**
 * Which tools this machine can actually use. Separate from planSteps so the
 * decision there stays pure, and injectable so this can be tested without
 * depending on whether the machine running the tests happens to have Docker.
 *
 * `docker info`, not `which docker`: a cloud session has the binary and no
 * daemon, and the binary on its own cannot start a container. Asking the wrong
 * question here would let the gate try, fail deep inside Testcontainers, and
 * report it as broken code.
 *
 * The same goes for an Android device: `adb devices` has to list one that is
 * ready, not merely answer. An emulator still booting or a phone that has not
 * accepted debugging would fail L7 deep inside the install step.
 *
 * @param {(command: string, args: string[], options?: object) => { ok: boolean, output: string }} runCommand
 */
export function availableTools(runCommand = run, cwd = process.cwd()) {
  const adb = runCommand('adb', ['devices'], { cwd, timeout: 15_000 });
  return {
    docker: runCommand('docker', ['info'], { cwd, timeout: 15_000 }).ok,
    android: checkDevices(adb.ok ? adb.output : null).ok,
  };
}

function main() {
  const which = process.argv[2] === 'full' ? 'full' : 'quick';
  const steps = which === 'full' ? FULL_STEPS : QUICK_STEPS;
  const cwd = process.cwd();

  const plan = planSteps(steps, packageScripts(cwd), process.env, availableTools(run, cwd));
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
