#!/usr/bin/env node
/**
 * The per-file gate (HK-04) — what runs after every edit, and what CI runs on
 * the same file later. Fast on purpose: it is in the way of every keystroke a
 * session makes, so it checks the file, not the world.
 *
 * Usage: pnpm run gate:file <path>...
 */
import process from 'node:process';
import { run } from './lib/proc.mjs';
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

function main() {
  const files = filesToCheck(process.argv.slice(2));
  if (files.length === 0) {
    return;
  }

  const failures = [];
  for (const step of stepsFor(files)) {
    const [program, ...args] = step.command;
    const result = run(program, args, { timeout: 160_000 });
    if (!result.ok) {
      failures.push({ ...step, output: result.output });
    }
  }

  if (failures.length === 0) {
    return;
  }
  for (const failure of failures) {
    process.stdout.write(`\n--- ${failure.name} ---\n${failure.output.trim()}\n`);
  }
  process.stdout.write(
    `\n${String(failures.length)} check(s) failed for: ${files.join(', ')}\n` +
      'Fix them before moving on — CI runs exactly the same checks.\n',
  );
  process.exitCode = 1;
}

if (import.meta.filename === process.argv[1]) {
  main();
}
