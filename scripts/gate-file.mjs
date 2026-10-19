#!/usr/bin/env node
/**
 * The per-file gate (HK-04) — what runs after every edit, and what CI runs on
 * the same file later. Fast on purpose: it is in the way of every keystroke a
 * session makes, so it checks the file, not the world.
 *
 * Usage: pnpm run gate:file <path>...
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import {
  INTEGRATION_TEST_FILES,
  SYSTEM_TEST_FILES,
  TEST_FILES,
  UNIT_EXCLUDE,
} from '../vitest.shared.mjs';
import { matchesAnyGlob } from './lib/glob.mjs';
import { run } from './lib/proc.mjs';
import { L3_NEEDS_DOCKER, planSteps } from './lib/steps.mjs';
import { TEST_GLOBS } from './lib/test-strength.mjs';

/**
 * How long gate:file may take (BUG-52). The post-edit hook stops it at
 * GATE_FILE_LIMIT_MS. It may ask `docker info` first and then runs its steps
 * side by side, so the probe and the slowest step end 5 s before the limit,
 * for pnpm and node to start and the report to be printed.
 */
export const DOCKER_PROBE_TIMEOUT_MS = 15_000;
export const STEP_TIMEOUT_MS = 150_000;
export const GATE_FILE_LIMIT_MS = DOCKER_PROBE_TIMEOUT_MS + STEP_TIMEOUT_MS + 5_000;

/** Files these checks apply to: our own code, not planning documents or spikes. */
const CHECKABLE = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|ya?ml)$/;
const NOT_OURS = /^(docs|spikes|node_modules|coverage)\//;

export function filesToCheck(args) {
  return args.filter((arg) => arg !== '--' && CHECKABLE.test(arg) && !NOT_OURS.test(arg));
}

/**
 * The app's tests run on jest-expo, everything else's on Vitest (INF-06).
 * Vitest cannot run React Native code, so an app file sent to `vitest related`
 * would fail after every edit for a reason unrelated to the edit.
 */
const APP = 'apps/mobile/';

/**
 * What to run for these files. Import rules only make sense for code the
 * dependency graph covers, and "related tests" only for files that have any.
 */
export function stepsFor(files) {
  const code = files.filter((file) => /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(file));
  const cruisable = code.filter(
    (file) =>
      file.startsWith('apps/') ||
      file.startsWith('packages/') ||
      file.startsWith('scripts/') ||
      file.startsWith('.claude/'),
  );
  const steps = [
    { name: 'formatting', command: ['pnpm', 'exec', 'prettier', '--check', ...files] },
  ];
  if (code.length > 0) {
    steps.push({ name: 'lint', command: ['pnpm', 'exec', 'eslint', ...code] });
    steps.push({ name: 'types', command: ['pnpm', 'exec', 'turbo', 'run', 'typecheck'] });
  }
  if (cruisable.length > 0) {
    steps.push({
      name: 'import rules (AR-10)',
      command: ['pnpm', 'exec', 'depcruise', '--config', '.dependency-cruiser.cjs', ...cruisable],
    });
  }
  const vitestCode = code.filter((file) => !file.startsWith(APP));
  const tests = vitestCode.filter((file) => matchesAnyGlob(file, TEST_GLOBS));
  const testable = vitestCode.filter((file) => !tests.includes(file));
  if (testable.length > 0) {
    steps.push({
      name: 'tests that cover this file',
      command: ['pnpm', 'exec', 'vitest', 'related', '--run', ...testable],
    });
  }
  // BUG-52 (D-133): every edited test runs itself, whatever else was edited,
  // with the config whose `include` finds it and whose `exclude` does not: the
  // configs' own lists, not the file's name.
  const finds =
    (include, exclude = []) =>
    (file) =>
      matchesAnyGlob(file, include) && !matchesAnyGlob(file, exclude);
  const unit = tests.filter(finds(TEST_FILES, UNIT_EXCLUDE));
  const system = tests.filter(finds(SYSTEM_TEST_FILES));
  const integration = tests.filter(finds(INTEGRATION_TEST_FILES));
  // No config finds these, so nothing would ever run them. Alone, Vitest finds
  // no test file and fails, which says so; beside a file it does find, it would
  // run that one and pass.
  const unfound = tests.filter(
    (file) => !unit.includes(file) && !system.includes(file) && !integration.includes(file),
  );
  if (unit.length > 0) {
    steps.push({ name: 'the edited tests', command: ['pnpm', 'exec', 'vitest', 'run', ...unit] });
  }
  if (system.length > 0) {
    steps.push({
      name: 'the edited system tests (L6)',
      command: ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.system.config.mjs', ...system],
    });
  }
  if (integration.length > 0) {
    // As gate:full's L3 step (scripts/gate.mjs): it runs only where Docker works.
    steps.push({
      name: 'the edited integration tests (L3)',
      command: [
        'pnpm',
        'exec',
        'vitest',
        'run',
        '--config',
        'vitest.integration.config.mjs',
        ...integration,
      ],
      ...L3_NEEDS_DOCKER,
    });
  }
  if (unfound.length > 0) {
    steps.push({
      name: 'the edited tests no Vitest config includes',
      command: ['pnpm', 'exec', 'vitest', 'run', ...unfound],
    });
  }
  // Jest runs in the app, so the files go to it relative to the app. An edited
  // test is related to itself, so one step covers tests and code alike.
  const appCode = code.filter((file) => file.startsWith(APP));
  if (appCode.length > 0) {
    steps.push({
      name: 'app tests related to this file (jest-expo)',
      command: [
        'pnpm',
        '--dir',
        APP,
        'exec',
        'jest',
        '--ci',
        '--findRelatedTests',
        ...appCode.map((file) => file.slice(APP.length)),
      ],
    });
  }
  return steps;
}

/**
 * Runs every step at the same time and waits for all of them (D-119). A step
 * passes on exit code 0 alone; one still running at `timeout` is killed with
 * every process it started.
 *
 * A step that needs a tool `available` does not mark as working is not started
 * (BUG-52). It comes back as not possible, with `ok: false`, so anything that
 * reads only `ok` never takes it for a pass. A step with `needsScript` or
 * `needsEnv`, which this gate cannot judge, rejects before any step starts.
 *
 * @param {import('./lib/steps.mjs').Step[]} steps
 * @param {{ cwd?: string, timeout?: number, available?: Record<string, boolean> }} [options]
 * @returns {Promise<{ name: string, ok: boolean, notPossible?: boolean, output: string }[]>} in the order of `steps`
 */
export async function runSteps(
  steps,
  { cwd = process.cwd(), timeout = STEP_TIMEOUT_MS, available = {} } = {},
) {
  const unjudged = steps.find(
    (step) => step.needsScript !== undefined || step.needsEnv !== undefined,
  );
  if (unjudged !== undefined) {
    const need = unjudged.needsScript === undefined ? 'needsEnv' : 'needsScript';
    throw new Error(
      `"${unjudged.name}" has ${need}, which gate:file cannot judge: it reads no scripts and no environment, so the step would never run.`,
    );
  }
  return Promise.all(
    planSteps(steps, {}, {}, available).map(({ step, willRun, reason }) =>
      willRun
        ? runStep(step, { cwd, timeout })
        : { name: step.name, ok: false, notPossible: true, output: reason },
    ),
  );
}

/**
 * One step, with the environment `run` in lib/proc.mjs gives a tool. Output is
 * stdout, then stderr. Every real step is `pnpm exec <tool>`, so the tool is a
 * grandchild: the step gets its own process group, and a timeout kills the
 * whole group. Killing only pnpm would leave the tool holding the output pipes,
 * and the step would not close until the tool ended by itself.
 */
async function runStep({ name, command: [program, ...args] }, { cwd, timeout }) {
  const child = spawn(program, args, {
    cwd,
    detached: true,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    // No pid: the step never started, so there is nothing to stop. A pid of 0
    // would be this process's own group.
    if (child.pid === undefined) {
      return;
    }
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // The group has already exited.
    }
  }, timeout);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  try {
    const [code, signal] = await once(child, 'close');
    let output = stdout + stderr;
    if (timedOut) {
      output += `\nStill running after ${String(timeout / 1000)} s, so it was stopped.`;
    } else if (signal) {
      output += `\nEnded by ${String(signal)}.`;
    }
    return { name, ok: code === 0 && !timedOut, output };
  } catch (error) {
    return { name, ok: false, output: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What main() prints: nothing when every step passed; otherwise each failure
 * with its output, then the count and the files. A step not possible here
 * (BUG-52) is no failure and leaves the exit code alone, but it is named last,
 * with its reason, so a clean run never quietly means "did not check".
 *
 * @param {{ name: string, ok: boolean, notPossible?: boolean, output: string }[]} results
 * @param {string[]} files
 * @returns {{ text: string, exitCode: number }}
 */
export function report(results, files) {
  const notPossible = results.filter((result) => result.notPossible === true);
  const failures = results.filter((result) => !result.ok && result.notPossible !== true);
  let text = '';
  if (failures.length > 0) {
    text +=
      failures.map((failure) => `\n--- ${failure.name} ---\n${failure.output.trim()}\n`).join('') +
      `\n${String(failures.length)} check(s) failed for: ${files.join(', ')}\n` +
      'Fix them before moving on — CI runs exactly the same checks.\n';
  }
  if (notPossible.length > 0) {
    text +=
      '\n' +
      notPossible
        .map((result) => `· ${result.name} — not possible here: ${result.output.trim()}\n`)
        .join('');
  }
  return { text, exitCode: failures.length === 0 ? 0 : 1 };
}

/**
 * Which tools the steps need that work on this machine, asked the way gate:full
 * asks (availableTools in gate.mjs): `docker info`, because a machine can have
 * the binary and no daemon. Asked only when a step needs Docker: `docker info`
 * can take seconds, and this gate runs after every edit. Docker is the only
 * tool it can ask about, so a step needing any other throws.
 *
 * @param {{ name: string, needsTool?: string }[]} steps
 * @param {string} cwd
 * @returns {Record<string, boolean>}
 */
export function availableFor(steps, cwd) {
  const unknown = steps.find((step) => step.needsTool !== undefined && step.needsTool !== 'docker');
  if (unknown !== undefined) {
    throw new Error(
      `"${unknown.name}" needs ${String(unknown.needsTool)}, and gate:file cannot ask whether it works here: it can ask about docker only.`,
    );
  }
  return steps.some((step) => step.needsTool === 'docker')
    ? { docker: run('docker', ['info'], { cwd, timeout: DOCKER_PROBE_TIMEOUT_MS }).ok }
    : {};
}

export async function main() {
  const files = filesToCheck(process.argv.slice(2));
  if (files.length === 0) {
    return;
  }

  const steps = stepsFor(files);
  const available = availableFor(steps, process.cwd());
  const { text, exitCode } = report(
    await runSteps(steps, { available, timeout: STEP_TIMEOUT_MS }),
    files,
  );
  process.stdout.write(text);
  process.exitCode = exitCode;
}

if (import.meta.filename === process.argv[1]) {
  await main();
}
