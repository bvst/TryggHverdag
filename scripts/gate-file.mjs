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
import { matchesAnyGlob } from './lib/glob.mjs';
import { TEST_GLOBS } from './lib/test-strength.mjs';

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
  const testable = vitestCode.filter((file) => !matchesAnyGlob(file, TEST_GLOBS));
  if (testable.length > 0) {
    steps.push({
      name: 'tests that cover this file',
      command: ['pnpm', 'exec', 'vitest', 'related', '--run', ...testable],
    });
  } else if (vitestCode.some((file) => matchesAnyGlob(file, TEST_GLOBS))) {
    steps.push({
      name: 'the edited tests',
      command: [
        'pnpm',
        'exec',
        'vitest',
        'run',
        ...vitestCode.filter((file) => matchesAnyGlob(file, TEST_GLOBS)),
      ],
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
 * Runs every step at the same time and waits for all of them (D-119): after an
 * edit, no check waits for the one before it. Never rejects. A step passes on
 * exit code 0 and nothing else, so one that cannot start, is ended by a signal
 * or is still running at `timeout` (and is then killed, together with every
 * process it started) is a failure.
 *
 * @param {{ name: string, command: string[] }[]} steps
 * @param {{ cwd?: string, timeout?: number }} [options]
 * @returns {Promise<{ name: string, ok: boolean, output: string }[]>} in the order of `steps`
 */
export async function runSteps(steps, { cwd = process.cwd(), timeout = 160_000 } = {}) {
  return Promise.all(steps.map((step) => runStep(step, { cwd, timeout })));
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
 * What main() prints after the steps have run: nothing when every step passed;
 * otherwise each failing step with its output trimmed, in the order of the
 * steps, then the count and the files.
 *
 * @param {{ name: string, ok: boolean, output: string }[]} results
 * @param {string[]} files
 * @returns {{ text: string, exitCode: number }}
 */
export function report(results, files) {
  const failures = results.filter((result) => !result.ok);
  if (failures.length === 0) {
    return { text: '', exitCode: 0 };
  }
  const text =
    failures.map((failure) => `\n--- ${failure.name} ---\n${failure.output.trim()}\n`).join('') +
    `\n${String(failures.length)} check(s) failed for: ${files.join(', ')}\n` +
    'Fix them before moving on — CI runs exactly the same checks.\n';
  return { text, exitCode: 1 };
}

async function main() {
  const files = filesToCheck(process.argv.slice(2));
  if (files.length === 0) {
    return;
  }

  const { text, exitCode } = report(await runSteps(stepsFor(files)), files);
  process.stdout.write(text);
  process.exitCode = exitCode;
}

if (import.meta.filename === process.argv[1]) {
  await main();
}
