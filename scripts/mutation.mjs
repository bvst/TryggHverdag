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
 * Every run is fresh (D-099): `--incremental` is refused, before any run
 * starts. With the command runner Stryker has no coverage data, so its
 * incremental mode reuses every earlier result in code that has not changed,
 * whatever happened to the tests.
 *
 * Usage:
 *   pnpm run mutation [--only-if-safety-paths-changed] [--base origin/main]
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { changedFiles } from './lib/git.mjs';
import { run } from './lib/proc.mjs';
import {
  MUTATION_TIMEOUT_MS,
  WHOLE_SUITE_RUN,
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
 * Does any of these safety paths hold a file Stryker would mutate? By the
 * rule stryker.config.mjs mutates by: a folder (ending in /) means every .ts
 * file under it but its tests, and a file means itself.
 *
 * A path that is not there, or is neither a file nor a folder holding one,
 * gives false because Stryker's own glob would match nothing for it either:
 * false means "Stryker would mutate nothing here", never a guess.
 * runMutationGroups asks one path at a time, and for a group, a false fails
 * the gate, naming the path: a group's path with nothing in it is a safety
 * file gone missing.
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
 * Always a fresh run (D-099): Stryker is never asked for incremental mode,
 * and an `incremental` option a caller still passes is not read.
 *
 * @param {{ run: typeof run, cwd: string }} options
 * @returns {(runOf: { name: string, timeout: number }) => ReturnType<typeof run>}
 */
export function strykerRunner({ run, cwd }) {
  return ({ name, timeout }) =>
    run('pnpm', ['exec', 'stryker', 'run'], {
      cwd,
      timeout,
      env: { STRYKER_RUN: name },
    });
}

/**
 * Why `--incremental` is refused (D-099), or null when it was not passed.
 * Any spelling of it, `--incremental=true` too.
 *
 * @param {string[]} args — the script's arguments
 * @returns {string | null}
 */
export function refuseIncremental(args) {
  const asked = args.filter((arg) => arg === '--incremental' || arg.startsWith('--incremental='));
  if (asked.length === 0) return null;
  return (
    `mutation: ${asked.join(' ')} is refused, and no run was started (D-099). With the ` +
    'command runner Stryker has no coverage data, so its incremental mode reuses every ' +
    'earlier result in code that has not changed, whatever happened to the tests: a test ' +
    'file gutted to assert nothing scored 100 % that way, and 0 % fresh. Every run is ' +
    'fresh: run it without --incremental.'
  );
}

/**
 * Runs every run in order, each with what is left of one shared budget, and
 * judges each: by Stryker's exit code, and by the JSON report the run wrote
 * (D-098). Stryker exits 0 for a run whose every mutant timed out, so the exit
 * code alone is not enough. A failed run does not stop the ones after it; a
 * spent budget does, and the runs it stopped are failures, never passes.
 *
 * Each run's paths are asked about one at a time. Only the whole-suite run,
 * which takes the safety paths no group claims, may have nothing to mutate
 * yet. When none of its paths holds a source file, it is not started:
 * Stryker 10 would find nothing to mutate, score NaN and exit 0, since NaN is
 * not below its `break`, and judgeMutationReport would fail the run as having
 * measured nothing, blocking every pull request for code that does not exist.
 * Passing it would claim a score for that code. So it is named, and decides
 * nothing. A gate in which no run had anything to mutate measured nothing, and
 * fails.
 *
 * A group exists because its files do, so a group's path that holds no source
 * file is a safety file gone missing (renamed, moved or deleted), and fails
 * the gate, named. The group still runs on its paths that hold files, so their
 * scores are in the same log; a group none of whose paths holds one is not
 * started.
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
 * }} options — `hasSourceFiles` is asked about one path at a time
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
  const missing = [];
  for (const group of runs) {
    const nothingIn = group.paths.filter((p) => !hasSourceFiles([p]));
    const withFiles = group.paths.filter((p) => !nothingIn.includes(p));
    if (group.name !== WHOLE_SUITE_RUN && nothingIn.length > 0) {
      write(
        `\nmutation: the ${group.name} group claims ${nothingIn.join(', ')}, where there is no ` +
          'source file: safety code gone missing, which fails the gate (D-098).' +
          (withFiles.length === 0 ? ' Nothing else is left in it, so it is not started.\n' : '\n'),
      );
      missing.push(`${group.name}: ${nothingIn.join(', ')}`);
      if (withFiles.length === 0) continue;
    } else if (withFiles.length === 0) {
      write(
        `\nmutation: the ${group.name} run has nothing to mutate: ${group.paths.join(', ')} ` +
          'hold no source file yet, so it is not started, and has no score.\n',
      );
      empty.push(group.name);
      continue;
    } else if (nothingIn.length > 0) {
      write(
        `\nmutation: the ${group.name} run has nothing to mutate yet in ${nothingIn.join(', ')}: ` +
          'there is no source file there.\n',
      );
    }
    // spawnSync reads 0 as no limit at all, so a spent budget starts nothing.
    const timeout = budgetMs - (now() - start);
    if (timeout <= 0) {
      notRun.push(group.name);
      continue;
    }
    write(
      `\nmutation: the ${group.name} run mutates ${withFiles.join(', ')} ` +
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
  if (missing.length > 0) {
    problems.push(
      `these groups claim safety paths that hold no source file: ${missing.join('; ')}. A ` +
        'group exists because its files do, so each is a safety file renamed, moved or ' +
        "deleted, which nothing mutated. Move the safety path and the group's path with it " +
        '(D-098).',
    );
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
  const refusal = refuseIncremental(process.argv.slice(2));
  if (refusal !== null) {
    process.stdout.write(refusal + '\n');
    process.exitCode = 1;
    return;
  }
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
    runStryker: strykerRunner({ run, cwd }),
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
