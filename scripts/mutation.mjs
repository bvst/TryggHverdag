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
 * In CI the same check is three jobs (BUG-45, D-129): `--plan` decides once,
 * by the rules the sequential run uses, and lists the groups from the code
 * that defines them; one job per group runs `--group <name>`; and the
 * required check, `--aggregate <dir>`, judges every group's report again and
 * passes only when every group this commit expects reported and passed.
 *
 * Usage:
 *   pnpm run mutation [--only-if-safety-paths-changed] [--base origin/main]
 *   pnpm run mutation --plan [--only-if-safety-paths-changed] [--base origin/main]
 *   pnpm run mutation --group <name>
 *   pnpm run mutation --aggregate <dir>
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
  mutationVerdictFile,
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

/** @typedef {{ name: string, paths: string[], tests: string[], config?: string }} Run */

/**
 * Which runs have something to mutate, asked about one path at a time, and
 * decided in one place for the sequential run, the plan and the aggregator
 * (BUG-45, D-129), so the three cannot disagree.
 *
 * - A group's path that holds no source file is a safety file gone missing
 *   (`missing`): the gate fails, naming it. The group stays in `groups`, so it
 *   still runs on its paths that hold files, and its scores are in the log.
 * - A run none of whose paths holds a file, and that is not a group with a
 *   path gone missing, has nothing to mutate (`empty`): today only the
 *   whole-suite run can be. It is left out of `groups`, never started, and
 *   decides nothing.
 *
 * @param {{ runs: Run[], hasSourceFiles: (paths: string[]) => boolean }} options
 * @returns {{
 *   groups: string[],
 *   classified: { run: Run, withFiles: string[], nothingIn: string[], missing: string[], empty: boolean }[],
 * }} — `groups`: the names of the runs to start, in the runs' order
 */
export function classifyRuns({ runs, hasSourceFiles }) {
  const classified = runs.map((each) => {
    const nothingIn = each.paths.filter((p) => !hasSourceFiles([p]));
    const withFiles = each.paths.filter((p) => !nothingIn.includes(p));
    const missing = each.name === WHOLE_SUITE_RUN ? [] : nothingIn;
    return {
      run: each,
      withFiles,
      nothingIn,
      missing,
      empty: missing.length === 0 && withFiles.length === 0,
    };
  });
  return {
    groups: classified.filter((entry) => !entry.empty).map((entry) => entry.run.name),
    classified,
  };
}

/**
 * What the log says about a run's paths, before it starts or instead of
 * starting it; '' when there is nothing to say.
 *
 * @param {ReturnType<typeof classifyRuns>['classified'][number]} entry
 */
function pathsNote({ run, withFiles, nothingIn, missing, empty }) {
  if (missing.length > 0) {
    return (
      `\nmutation: the ${run.name} group claims ${missing.join(', ')}, where there is no ` +
      'source file: safety code gone missing, which fails the gate (D-098).' +
      (withFiles.length === 0 ? ' Nothing else is left in it, so it is not started.\n' : '\n')
    );
  }
  if (empty) {
    return (
      `\nmutation: the ${run.name} run has nothing to mutate: ${run.paths.join(', ')} ` +
      'hold no source file yet, so it is not started, and has no score.\n'
    );
  }
  if (nothingIn.length > 0) {
    return (
      `\nmutation: the ${run.name} run has nothing to mutate yet in ${nothingIn.join(', ')}: ` +
      'there is no source file there.\n'
    );
  }
  return '';
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
 * started. classifyRuns sorts the runs this way.
 *
 * @param {{
 *   runs: Run[],
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
  for (const entry of classifyRuns({ runs, hasSourceFiles }).classified) {
    const { run: group, withFiles } = entry;
    const note = pathsNote(entry);
    if (note !== '') write(note);
    if (entry.missing.length > 0) missing.push(`${group.name}: ${entry.missing.join(', ')}`);
    if (entry.empty) empty.push(group.name);
    if (withFiles.length === 0) continue;
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

/** A value GitHub handed over, as a message shows it: quoted, or "empty". */
const shown = (value) => (value === undefined || value === '' ? 'empty' : `"${value}"`);

/** JSON.parse that gives null for text that does not parse. */
function parsedOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * What is wrong with the plan's `groups` output, measured against the groups
 * this commit's runs expect: [] when it is exactly them.
 *
 * @param {string | undefined} text — the output, as GitHub hands it over
 * @param {string[]} expected — from classifyRuns
 */
function groupsProblems(text, expected) {
  const listed = parsedOrNull(text ?? '');
  if (!Array.isArray(listed) || !listed.every((name) => typeof name === 'string')) {
    return [`the plan's groups, ${shown(text)}, are not a JSON list of run names.`];
  }
  const problems = [];
  const twice = [...new Set(listed.filter((name, at) => listed.indexOf(name) !== at))];
  if (twice.length > 0) {
    problems.push(`the plan's groups name ${twice.join(', ')} more than once.`);
  }
  const left = expected.filter((name) => !listed.includes(name));
  if (left.length > 0) {
    problems.push(`the plan's groups leave out ${left.join(', ')}, which this commit expects.`);
  }
  const extra = [...new Set(listed.filter((name) => !expected.includes(name)))];
  if (extra.length > 0) {
    problems.push(`the plan's groups name ${extra.join(', ')}, which this commit does not expect.`);
  }
  return problems;
}

/**
 * One group's verdict file and report, as its leg uploaded them: what is
 * wrong with them, and the report judged again here, so that a pass rests
 * on the report itself, not on what the leg or GitHub said of it.
 *
 * @param {string} name
 * @param {string | undefined} verdictText
 * @param {string | undefined} reportText
 * @returns {{ problems: string[], judged: string }}
 */
function judgeGroup(name, verdictText, reportText) {
  const problems = [];
  const verdict = verdictText === undefined ? undefined : parsedOrNull(verdictText);
  if (verdict === undefined) {
    problems.push(
      `the ${name} group left no verdict file (${mutationVerdictFile(name)}), so how its run ` +
        'ended is unknown.',
    );
  } else if (verdict === null || typeof verdict !== 'object') {
    problems.push(`the ${name} group's verdict file does not parse as JSON.`);
  } else if (verdict.name !== name || verdict.status !== 0 || verdict.ok !== true) {
    problems.push(
      `the ${name} group's verdict file does not say it passed: its name is ` +
        `${JSON.stringify(verdict.name)}, Stryker's exit status ${JSON.stringify(verdict.status)}, ` +
        `and ok ${JSON.stringify(verdict.ok)}.`,
    );
  }
  if (reportText === undefined) {
    problems.push(
      `the ${name} group left no report (${mutationReportFile(name)}), so nothing here measured it.`,
    );
    return { problems, judged: '' };
  }
  let judgement;
  try {
    judgement = judgeMutationReport(JSON.parse(reportText));
  } catch (error) {
    problems.push(
      `the ${name} group's report does not parse as a Stryker JSON report ` +
        `(${error instanceof Error ? error.message : String(error)}).`,
    );
    return { problems, judged: '' };
  }
  if (!judgement.ok) {
    problems.push(`the ${name} group's report fails, judged here: its lines above say why.`);
  }
  return {
    problems,
    judged: `\nmutation: the ${name} group, judged here:\n${judgement.message}\n`,
  };
}

/**
 * The verdict of the required `mutation` check in CI (BUG-45, D-129). The
 * plan decided whether the groups run and listed them; one leg per group ran
 * `--group` and uploaded its report and verdict file. This passes only when
 * every group this commit expects reported and passed, and fails, naming
 * every cause, on anything less.
 *
 * It trusts neither the plan's list nor GitHub's roll-up of the legs. The
 * groups it expects come from the runs and the paths at this commit, through
 * classifyRuns, as the plan's did: a plan and legs that agree with each other
 * and leave a group out still fail. Each report is judged again here by
 * judgeMutationReport, the rule the sequential run uses.
 *
 * - The plan's job must have succeeded, and its decision be exactly `run` or
 *   `skip`: anything else, the empty string too, is a wiring fault.
 * - `skip` passes, as nothing to mutate passes today, only with the group job
 *   skipped: any other result is inconsistent.
 * - `run` needs the group job's success, and every expected group's verdict
 *   and report, passing; no group with a safety path gone missing; no report
 *   for a group not expected; and at least one group.
 *
 * @param {{
 *   runs: Run[],
 *   hasSourceFiles: (paths: string[]) => boolean,
 *   plan: { result?: string, decision?: string, reason?: string, groups?: string },
 *   groupResult?: string,
 *   reports: Record<string, string>,
 *   verdicts: Record<string, string>,
 * }} options — the plan job's result and its three outputs, and the group
 *   job's result, as GitHub hands them over; each group's report and verdict
 *   file, raw, by run name
 * @returns {{ ok: boolean, message: string }}
 */
export function aggregateMutationJobs({
  runs,
  hasSourceFiles,
  plan,
  groupResult,
  reports,
  verdicts,
}) {
  const problems = [];
  let judged = '';
  if (plan.result !== 'success') {
    problems.push(
      `the mutation-plan job's result is ${shown(plan.result)}, not "success", so nothing it ` +
        'decided can be relied on.',
    );
  }
  if (plan.decision !== 'run' && plan.decision !== 'skip') {
    problems.push(
      `the plan's decision is ${shown(plan.decision)}, neither "run" nor "skip": the jobs are ` +
        'wired wrong.',
    );
  }
  const { groups: expected, classified } = classifyRuns({ runs, hasSourceFiles });
  problems.push(...groupsProblems(plan.groups, expected));
  if (plan.decision === 'skip' && groupResult !== 'skipped') {
    problems.push(
      `the plan said skip, but the mutation-group job's result is ${shown(groupResult)}, not ` +
        '"skipped": the two are inconsistent, so neither can be relied on.',
    );
  }
  if (plan.decision === 'run') {
    if (groupResult !== 'success') {
      problems.push(`the mutation-group job's result is ${shown(groupResult)}, not "success".`);
    }
    for (const { run, missing } of classified) {
      if (missing.length > 0) {
        problems.push(
          `the ${run.name} group claims ${missing.join(', ')}, where there is no source file: a ` +
            'safety file renamed, moved or deleted, which nothing mutated (D-098).',
        );
      }
    }
    if (expected.length === 0) {
      problems.push('no run has anything to mutate, so nothing was measured (D-098).');
    }
    for (const name of expected) {
      const group = judgeGroup(name, verdicts[name], reports[name]);
      problems.push(...group.problems);
      judged += group.judged;
    }
    const unexpected = [...new Set([...Object.keys(reports), ...Object.keys(verdicts)])].filter(
      (name) => !expected.includes(name),
    );
    if (unexpected.length > 0) {
      problems.push(
        'there are reports or verdicts for runs this commit does not expect: ' +
          `${unexpected.join(', ')}.`,
      );
    }
  }

  const reason = plan.reason === undefined || plan.reason === '' ? '' : `${plan.reason}\n`;
  if (problems.length > 0) {
    return {
      ok: false,
      message:
        `${reason}${judged}\nmutation: the check fails (D-036, D-129):\n` +
        problems.map((problem) => `  - ${problem}\n`).join(''),
    };
  }
  if (plan.decision === 'skip') {
    return {
      ok: true,
      message: `${reason}mutation: the plan said skip, and no group ran: nothing to mutate.`,
    };
  }
  return {
    ok: true,
    message:
      `${reason}${judged}\nmutation: every group this commit expects reported and passed, ` +
      `judged here: ${expected.join(', ')}.`,
  };
}

/** `--plan`, `--group` and `--aggregate`: the three steps of the check in CI, one at a time. */
const STEPS = ['--plan', '--group', '--aggregate'];

/**
 * What `pnpm run mutation` was asked to do, or why it refuses, before
 * anything starts.
 *
 * `--group <name>` runs that one group, whatever changed, and takes no other
 * argument: a group asked for by name always runs (BUG-45).
 *
 * @param {string[]} args — the script's arguments
 * @param {string[]} runNames — the names of mutationRuns()
 * @returns {{ refusal: string }
 *   | { step: 'all' | 'plan', base: string, onlyIfSafetyPathsChanged: boolean }
 *   | { step: 'group', name: string }
 *   | { step: 'aggregate', folder: string }}
 */
function readArgs(args, runNames) {
  const incremental = refuseIncremental(args);
  if (incremental !== null) {
    return { refusal: incremental };
  }
  const steps = STEPS.filter((step) => args.includes(step));
  if (steps.length > 1) {
    return {
      refusal:
        `mutation: ${steps.join(' and ')} are separate steps of the check, run one at a time, ` +
        'so nothing was started.',
    };
  }
  const [step] = steps;
  if (step === undefined || step === '--plan') {
    const base = args.indexOf('--base');
    return {
      step: step === undefined ? 'all' : 'plan',
      base: base === -1 ? 'origin/main' : (args[base + 1] ?? 'origin/main'),
      onlyIfSafetyPathsChanged: args.includes('--only-if-safety-paths-changed'),
    };
  }
  // --group and --aggregate each take one value, and nothing else.
  const at = args.indexOf(step);
  const value = args[at + 1];
  const rest = args.filter((_, index) => index !== at && index !== at + 1);
  if (step === '--aggregate') {
    if (value === undefined || value.startsWith('--') || rest.length > 0) {
      return {
        refusal:
          "mutation: --aggregate takes one argument, the folder the legs' reports were " +
          'downloaded into, and nothing else, so nothing was read.',
      };
    }
    return { step: 'aggregate', folder: value };
  }
  const names = `The runs are: ${runNames.join(', ')}.`;
  if (args.filter((arg) => arg === '--group').length > 1) {
    return {
      refusal:
        'mutation: --group was given more than once, and runs one group, so nothing was ' +
        `started. ${names}`,
    };
  }
  if (value === undefined || value.startsWith('--')) {
    return {
      refusal:
        'mutation: --group needs the name of the run to start, and none was given, so ' +
        `nothing was started. ${names}`,
    };
  }
  if (rest.length > 0) {
    return {
      refusal:
        `mutation: --group ${value} runs that one group, whatever changed, and takes no other ` +
        `argument, so ${rest.join(' ')} is refused and nothing was started.`,
    };
  }
  if (!runNames.includes(value)) {
    return {
      refusal: `mutation: there is no run named "${value}", so nothing was started. ${names}`,
    };
  }
  return { step: 'group', name: value };
}

/** Prints to the log. */
const print = (text) => {
  process.stdout.write(text);
};

/** What runMutationGroups reads and writes on this machine, in `cwd`, beside Stryker and the runs. */
function onThisMachine(cwd) {
  return {
    now: Date.now,
    write: print,
    clearReport: (name) => {
      rmSync(path.join(cwd, mutationReportFile(name)), { force: true });
    },
    readReport: (name) => {
      const file = path.join(cwd, mutationReportFile(name));
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    },
    hasSourceFiles: (paths) => hasSourceFiles(paths, cwd),
  };
}

/** Today's rules for whether to run: decideMutation, on this branch's changes. */
function decide({ cwd, base, onlyIfSafetyPathsChanged }) {
  return decideMutation({
    changed: changedFiles({ base, cwd }),
    onlyIfSafetyPathsChanged,
    configured: strykerConfigured(cwd),
  });
}

/** `pnpm run mutation`: every run, in sequence, in one shared budget. */
function runAll({ cwd, base, onlyIfSafetyPathsChanged }) {
  const decision = decide({ cwd, base, onlyIfSafetyPathsChanged });
  print(decision.message + '\n');
  if (!decision.ok || decision.action === 'skip') {
    return decision.ok;
  }
  const outcome = runMutationGroups({
    runs: mutationRuns(),
    runStryker: strykerRunner({ run, cwd }),
    budgetMs: MUTATION_TIMEOUT_MS,
    ...onThisMachine(cwd),
  });
  print(`\n${outcome.message}\n`);
  return outcome.ok;
}

/**
 * `--plan`: the decision, by today's rules, and the groups, as GitHub job
 * outputs. `groups` is always the full list, so the matrix it feeds is never
 * empty whatever the decision. The reason is one line, since an output is
 * one: it names changed files, which a pull request chooses.
 */
function writePlan({ cwd, base, onlyIfSafetyPathsChanged }) {
  const decision = decide({ cwd, base, onlyIfSafetyPathsChanged });
  print(decision.message + '\n');
  if (!decision.ok) {
    return false;
  }
  const { groups, classified } = classifyRuns({
    runs: mutationRuns(),
    hasSourceFiles: (paths) => hasSourceFiles(paths, cwd),
  });
  for (const entry of classified) {
    print(pathsNote(entry));
  }
  const outputs =
    `decision=${decision.action}\n` +
    `reason=${decision.message.replace(/[\r\n]+/g, ' ')}\n` +
    `groups=${JSON.stringify(groups)}\n`;
  print(`\nmutation: the plan's outputs:\n${outputs}`);
  const file = process.env.GITHUB_OUTPUT;
  if (file === undefined || file === '') {
    print('GITHUB_OUTPUT is not set, so they are printed here, and written nowhere else.\n');
    return true;
  }
  try {
    appendFileSync(file, outputs);
  } catch (error) {
    print(
      `mutation: the plan could not write its outputs to GITHUB_OUTPUT (${file}): ` +
        `${error instanceof Error ? error.message : String(error)}. Outputs nobody can read are ` +
        'a decision nobody made, so the plan fails.\n',
    );
    return false;
  }
  return true;
}

/**
 * `--group <name>`: that one run, with the whole budget, judged as every run
 * is, and its verdict written beside its report for the aggregator. Its last
 * line says it is not the mutation gate.
 */
function runGroup({ cwd, name }) {
  const verdictFile = path.join(cwd, mutationVerdictFile(name));
  rmSync(verdictFile, { force: true });
  const runStryker = strykerRunner({ run, cwd });
  let status = null;
  const outcome = runMutationGroups({
    runs: mutationRuns().filter((each) => each.name === name),
    runStryker: (runOf) => {
      const result = runStryker(runOf);
      status = result.status;
      return result;
    },
    budgetMs: MUTATION_TIMEOUT_MS,
    ...onThisMachine(cwd),
  });
  mkdirSync(path.dirname(verdictFile), { recursive: true });
  // The three facts the aggregator checks; it judges the report again itself,
  // so the leg's message is printed here and not kept.
  writeFileSync(verdictFile, `${JSON.stringify({ name, status, ok: outcome.ok }, null, 2)}\n`);
  print(`\n${outcome.message}\n`);
  print(
    `mutation: the ${name} group ${outcome.ok ? 'passed' : 'failed'}. Only that group ran, so ` +
      'this is not the mutation gate, which judges every group together.\n',
  );
  return outcome.ok;
}

/** `--aggregate <dir>`: the verdict of the required check, from the folder the legs' artifacts were downloaded into, flat. */
function aggregateFolder({ cwd, folder }) {
  const at = path.resolve(cwd, folder);
  const files = existsSync(at)
    ? readdirSync(at, { withFileTypes: true }).filter((entry) => entry.isFile())
    : [];
  const VERDICT = '.verdict.json';
  const REPORT = '.json';
  /** A file's kind by its name alone: a verdict, a report, or neither. */
  const kindOf = (name) =>
    name.endsWith(VERDICT) ? VERDICT : name.endsWith(REPORT) ? REPORT : null;
  /** [name, text] for each file of that kind, picked by name before it is read, the name without its suffix. */
  const named = (suffix) =>
    files
      .filter(({ name }) => kindOf(name) === suffix)
      .map(({ name }) => [
        name.slice(0, -suffix.length),
        readFileSync(path.join(at, name), 'utf8'),
      ]);
  const verdicts = Object.fromEntries(named(VERDICT));
  const reports = Object.fromEntries(named(REPORT));
  const env = process.env;
  const outcome = aggregateMutationJobs({
    runs: mutationRuns(),
    hasSourceFiles: (paths) => hasSourceFiles(paths, cwd),
    plan: {
      result: env.MUTATION_PLAN_RESULT,
      decision: env.MUTATION_PLAN_DECISION,
      reason: env.MUTATION_PLAN_REASON,
      groups: env.MUTATION_PLAN_GROUPS,
    },
    groupResult: env.MUTATION_GROUP_RESULT,
    reports,
    verdicts,
  });
  print(`${outcome.message}\n`);
  return outcome.ok;
}

function main() {
  const cwd = process.cwd();
  const asked = readArgs(
    process.argv.slice(2),
    mutationRuns().map((each) => each.name),
  );
  let ok;
  if ('refusal' in asked) {
    print(asked.refusal + '\n');
    ok = false;
  } else if (asked.step === 'plan') {
    ok = writePlan({ cwd, ...asked });
  } else if (asked.step === 'group') {
    ok = runGroup({ cwd, name: asked.name });
  } else if (asked.step === 'aggregate') {
    ok = aggregateFolder({ cwd, folder: asked.folder });
  } else {
    ok = runAll({ cwd, ...asked });
  }
  if (!ok) {
    process.exitCode = 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  main();
}
