#!/usr/bin/env node
/**
 * D-036: on safety code, the tests must catch planted bugs — at least 80 % of
 * them. Coverage says a line ran; the mutation score says a bug in that line
 * would have been noticed.
 *
 * Stryker runs once per run of mutationRuns(), each group against only the
 * tests that can kill its mutants, one after another inside one budget (D-066,
 * amended by the owner 2026-09-25).
 *
 * Usage:
 *   pnpm run mutation [--incremental] [--only-if-safety-paths-changed] [--base origin/main]
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { changedFiles } from './lib/git.mjs';
import { run } from './lib/proc.mjs';
import {
  MUTATION_TIMEOUT_MS,
  decideMutation,
  judgeMutationRun,
  mutationRuns,
} from './lib/gate-decisions.mjs';

const CONFIGS = ['stryker.config.mjs', 'stryker.config.json', 'stryker.conf.json'];

export function strykerConfigured(cwd) {
  return CONFIGS.some((file) => existsSync(path.join(cwd, file)));
}

/**
 * Starts one Stryker run. stryker.config.mjs reads the run's name from
 * STRYKER_RUN to pick its paths and tests.
 *
 * @param {{ run: typeof run, cwd: string, incremental: boolean }} options
 * @returns {(runOf: { name: string, timeout: number }) => ReturnType<typeof run>}
 */
export function strykerRunner({ run, cwd, incremental }) {
  return ({ name, timeout }) =>
    run('pnpm', ['exec', 'stryker', 'run', ...(incremental ? ['--incremental'] : [])], {
      cwd,
      timeout,
      env: { STRYKER_RUN: name },
    });
}

/**
 * Runs every run in order, each with what is left of one shared budget, and
 * judges each. A failed run does not stop the ones after it; a spent budget
 * does, and the runs it stopped are failures, never passes.
 *
 * @param {{
 *   runs: { name: string, paths: string[], tests: string[] }[],
 *   runStryker: (runOf: { name: string, timeout: number }) => { ok: boolean, status: number | null, output: string },
 *   budgetMs: number,
 *   now: () => number,
 *   write: (text: string) => void,
 * }} options
 * @returns {{ ok: boolean, message: string }}
 */
export function runMutationGroups({ runs, runStryker, budgetMs, now, write }) {
  if (runs.length === 0) {
    return {
      ok: false,
      message: 'mutation: there were no runs, so nothing was mutated and nothing measured (D-036).',
    };
  }
  const start = now();
  const failed = [];
  const notRun = [];
  for (const group of runs) {
    // spawnSync reads 0 as no limit at all, so a spent budget starts nothing.
    const timeout = budgetMs - (now() - start);
    if (timeout <= 0) {
      notRun.push(group.name);
      continue;
    }
    write(
      `\nmutation: the ${group.name} run mutates ${group.paths.join(', ')} ` +
        `against ${group.tests.join(' ')}.\n`,
    );
    const result = runStryker({ name: group.name, timeout });
    write(result.output);
    const verdict = judgeMutationRun(result);
    if (!verdict.ok) {
      write(`\n${verdict.message}\n`);
      failed.push(group.name);
    }
  }

  const problems = [];
  if (failed.length > 0) {
    problems.push(`these runs failed, and their reports above say why: ${failed.join(', ')}.`);
  }
  if (notRun.length > 0) {
    problems.push(
      `these runs were not run, because the ${String(Math.round(budgetMs / 60_000))}-minute ` +
        `budget was spent, so their safety files have no score: ${notRun.join(', ')}.`,
    );
  }
  if (problems.length > 0) {
    return { ok: false, message: `mutation: ${problems.join(' And ')}` };
  }
  return {
    ok: true,
    message: `mutation: every run passed (${runs.map((group) => group.name).join(', ')}).`,
  };
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function main() {
  const cwd = process.cwd();
  const decision = decideMutation({
    changed: changedFiles({ base: argValue('--base', 'origin/main'), cwd }),
    onlyIfSafetyPathsChanged: process.argv.includes('--only-if-safety-paths-changed'),
    configured: strykerConfigured(cwd),
  });

  process.stdout.write(decision.message + '\n');
  if (!decision.ok) {
    process.exitCode = 1;
    return;
  }
  if (decision.action === 'skip') {
    return;
  }

  const outcome = runMutationGroups({
    runs: mutationRuns(),
    runStryker: strykerRunner({ run, cwd, incremental: process.argv.includes('--incremental') }),
    budgetMs: MUTATION_TIMEOUT_MS,
    now: Date.now,
    write: (text) => {
      process.stdout.write(text);
    },
  });
  process.stdout.write(`\n${outcome.message}\n`);
  if (!outcome.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  main();
}
