#!/usr/bin/env node
/**
 * D-036: on safety code, the tests must catch planted bugs — at least 80 % of
 * them. Coverage says a line ran; the mutation score says a bug in that line
 * would have been noticed.
 *
 * Stryker runs once per run of mutationRuns(), each group against only the
 * tests that can kill its mutants, one after another inside one budget (D-066,
 * amended by the owner 2026-09-25). Each run is judged from its JSON report,
 * file by file, where only a killed mutant counts as caught (D-098).
 *
 * Usage:
 *   pnpm run mutation [--incremental] [--only-if-safety-paths-changed] [--base origin/main]
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { changedFiles } from './lib/git.mjs';
import { run } from './lib/proc.mjs';
import {
  MUTATION_TIMEOUT_MS,
  decideMutation,
  judgeMutationReport,
  judgeMutationRun,
  mutationReportFile,
  mutationRuns,
} from './lib/gate-decisions.mjs';

const CONFIGS = ['stryker.config.mjs', 'stryker.config.json', 'stryker.conf.json'];

export function strykerConfigured(cwd) {
  return CONFIGS.some((file) => existsSync(path.join(cwd, file)));
}

/**
 * Does any of a run's safety paths hold a file Stryker would mutate? By the
 * rule stryker.config.mjs mutates by: a folder (ending in /) means every .ts
 * file under it but its tests, and a file means itself.
 *
 * A wrong false would skip a group that has files and let the gate pass
 * without it, so a path that is neither is no file, never a guess.
 *
 * @param {string[]} paths — relative to `cwd`
 * @param {string} cwd
 */
export function hasSourceFiles(paths, cwd) {
  return paths.some((p) => {
    const at = path.join(cwd, p);
    if (!existsSync(at)) return false;
    if (!p.endsWith('/')) return statSync(at).isFile();
    return readdirSync(at, { recursive: true, withFileTypes: true }).some(
      (entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'),
    );
  });
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
 * judges each: by Stryker's exit code, and by the JSON report the run wrote
 * (D-098). Stryker exits 0 for a run whose every mutant timed out, so the exit
 * code alone is not enough. A failed run does not stop the ones after it; a
 * spent budget does, and the runs it stopped are failures, never passes.
 *
 * A run whose safety paths hold no source file yet is not started: Stryker
 * would find nothing to mutate and fail, blocking every pull request for code
 * that does not exist, and passing it would claim a score for that code. So it
 * is named, and decides nothing. A gate in which no run had anything to
 * mutate measured nothing, and fails.
 *
 * @param {{
 *   runs: { name: string, paths: string[], tests: string[] }[],
 *   runStryker: (runOf: { name: string, timeout: number }) => { ok: boolean, status: number | null, output: string },
 *   budgetMs: number,
 *   now: () => number,
 *   write: (text: string) => void,
 *   clearReport: (name: string) => void,
 *   readReport: (name: string) => { files: Record<string, { mutants: { status: string }[] }> } | null,
 *   hasSourceFiles: (paths: string[]) => boolean,
 * }} options
 * @returns {{ ok: boolean, message: string }}
 */
export function runMutationGroups({
  runs,
  runStryker,
  budgetMs,
  now,
  write,
  clearReport,
  readReport,
  hasSourceFiles,
}) {
  if (runs.length === 0) {
    return {
      ok: false,
      message: 'mutation: there were no runs, so nothing was mutated and nothing measured (D-036).',
    };
  }
  const start = now();
  const failed = [];
  const notRun = [];
  const empty = [];
  for (const group of runs) {
    if (!hasSourceFiles(group.paths)) {
      write(
        `\nmutation: the ${group.name} run has nothing to mutate: ${group.paths.join(', ')} ` +
          'hold no source file yet, so it is not started, and has no score.\n',
      );
      empty.push(group.name);
      continue;
    }
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
    // Cleared first, so that what is read below can only be what this run
    // wrote: a report left from an earlier run must never stand in for it.
    clearReport(group.name);
    const result = runStryker({ name: group.name, timeout });
    write(result.output);
    const report = readReport(group.name);
    const verdicts = [
      judgeMutationRun(result),
      report === null
        ? {
            ok: false,
            message:
              `mutation: the ${group.name} run wrote no JSON report ` +
              `(${mutationReportFile(group.name)}), so the gate has nothing to judge its ` +
              'mutants by, and this run measured nothing (D-098).',
          }
        : judgeMutationReport(report),
    ];
    for (const verdict of verdicts) {
      if (verdict.message !== '') write(`\n${verdict.message}\n`);
    }
    if (verdicts.some((verdict) => !verdict.ok)) {
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
  if (empty.length === runs.length) {
    problems.push('no run had anything to mutate, so nothing was measured (D-098).');
  }
  const nothingToMutate =
    empty.length > 0 && empty.length < runs.length
      ? ` These runs had nothing to mutate, so they have no score: ${empty.join(', ')}.`
      : '';
  if (problems.length > 0) {
    return { ok: false, message: `mutation: ${problems.join(' And ')}${nothingToMutate}` };
  }
  const measured = runs.filter((group) => !empty.includes(group.name));
  return {
    ok: true,
    message:
      `mutation: every run passed (${measured.map((group) => group.name).join(', ')}).` +
      nothingToMutate,
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
    clearReport: (name) => {
      rmSync(path.join(cwd, mutationReportFile(name)), { force: true });
    },
    readReport: (name) => {
      const file = path.join(cwd, mutationReportFile(name));
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    },
    hasSourceFiles: (paths) => hasSourceFiles(paths, cwd),
  });
  process.stdout.write(`\n${outcome.message}\n`);
  if (!outcome.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  main();
}
