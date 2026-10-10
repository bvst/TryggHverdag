// req-coverage: fixtures-only — the IDs below name decisions, not the product.
//
// stryker.config.mjs is the one place that says what a mutation run mutates
// and which tests every mutant runs against. Since the owner's grouping
// decision of 2026-09-25, an amendment to D-066, it answers per run:
// scripts/mutation.mjs names the run in STRYKER_RUN, and the config narrows the
// tests to the ones that can kill that run's mutants.
//
// Two things must never happen here. A safety file must not fall out of every
// run, or land in two. And a run must not quietly change anything else: the
// thresholds, the command runner, or "every test against every mutant", which
// is what makes the score honest. Each run is therefore compared with the whole
// config, not with the three settings it is meant to change.
//
// BUG-12 (D-098) changed what the runs are compared with, and how. Before, the
// config with no run named was the yardstick. Now it throws, because a run
// outside `pnpm run mutation` is judged by nothing, and Stryker counts a
// timed-out mutant as caught. So the runs are compared with each other: every
// run must have the same config apart from what it mutates, the tests it
// runs, and the report it writes. Each run also writes a JSON report the
// gate reads, and gives Vitest a per-test timeout well inside Stryker's, so a
// test that would wait forever fails in Vitest and kills its mutant.
//
// D-099 (owner, 2026-10-02): every run is fresh, so no run writes or reads an
// incremental file. With the command runner Stryker has no coverage data, and
// its incremental mode reused every earlier result in unchanged code whatever
// happened to the tests: a gutted test file scored 100 %, and 0 % fresh.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SAFETY_PATHS, mutationRuns } from './lib/gate-decisions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXCLUSIONS = ['!**/*.test.ts', '!**/*.integration.test.ts', '!**/*.system.test.ts'];

/**
 * What a run's command hands Vitest: everything after
 * `node node_modules/vitest/vitest.mjs run`.
 *
 * RG-03 (BUG-29, D-117): this was `pnpm exec vitest run `. D-117 starts
 * Vitest by its own bin, because `pnpm exec` cost about 12 % of each mutant's
 * CPU for nothing a run needs, and the mutation check ran out of its 25
 * minutes on LOST-07's pull request. What follows the prefix, and what the
 * tests below ask of it, is unchanged.
 */
const VITEST_RUN = 'node node_modules/vitest/vitest.mjs run ';

/**
 * BUG-29 (RG-03): this sliced VITEST_RUN's length off any command. A command
 * that starts some other way would have been cut at the wrong place and read
 * as other arguments, so it now throws, naming the command. Stricter.
 */
function vitestArgs(command) {
  if (!command.startsWith(VITEST_RUN)) {
    throw new Error(`the command does not start with "${VITEST_RUN}": ${command}`);
  }
  return command.slice(VITEST_RUN.length).trim().split(/\s+/);
}

/** The configuration file Vitest's arguments `args` name, by --config or -c, or undefined. */
function configNamedIn(args) {
  for (const [at, arg] of args.entries()) {
    const joined = /^(?:--config|-c)=(.+)$/.exec(arg);
    if (joined?.[1] !== undefined) return path.normalize(joined[1]);
    if (arg === '--config' || arg === '-c') {
      const next = args[at + 1];
      return next === undefined ? undefined : path.normalize(next);
    }
  }
  return undefined;
}

/** An argument naming where Vitest keeps its module cache (D-124), in either spelling, with its value after `=`. */
const CACHE_PATH_ARG = /^--(?:fsModuleCachePath|fs-module-cache-path)=/;

/**
 * The test files Vitest would run with the arguments `args`, as `vitest list`
 * reports them, relative to the repository. `--json` comes last on purpose:
 * followed by a path, it takes that path as a file to write the list into.
 *
 * RG-03 (BUG-41, D-124): the arguments are handed over as the command gives
 * them, apart from the module cache's path, which is now a fresh directory of
 * the test's own, removed afterwards. Every run's command gains
 * `--fsModuleCache --fsModuleCachePath=.vitest-fs-cache`, a path relative to
 * where Vitest starts. Stryker starts it in a run's sandbox, but this lists
 * from the repository, and `vitest list` with those flags writes the cache
 * there (measured with Vitest 5.0.1: `_metadata.json`): every unit run would
 * leave a `.vitest-fs-cache/` in the repository's root. Which files Vitest
 * collects does not depend on where it keeps transforms, and the flags still
 * reach Vitest, so a Vitest that no longer takes them still fails here; what
 * they must be is pinned by BUG-41's own tests below.
 */
function filesRunWith(args) {
  const cache = mkdtempSync(path.join(os.tmpdir(), 'stryker-config-list-'));
  try {
    const listed = args.map((arg) =>
      CACHE_PATH_ARG.test(arg) ? `--fsModuleCachePath=${cache}` : arg,
    );
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
        'list',
        ...listed,
        '--filesOnly',
        '--json',
      ],
      { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } },
    );
    if (result.status !== 0) {
      throw new Error(`vitest list ${listed.join(' ')} failed:\n${result.stderr}`);
    }
    return JSON.parse(result.stdout).map((entry) => path.relative(root, entry.file));
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

/** The rule the config has always used: a folder means every .ts file under it. */
const globs = (paths) => paths.map((p) => (p.endsWith('/') ? `${p}**/*.ts` : p));

/** The config as Stryker would load it, with STRYKER_RUN set to `run`, or unset. */
async function configFor(run) {
  vi.stubEnv('STRYKER_RUN', run);
  vi.resetModules();
  const module = await import('../stryker.config.mjs');
  return module.default;
}

/**
 * The Vitest options BUG-12 adds to every run's command, each as Vitest
 * accepts it: `--name value` or `--name=value`, in camel or kebab case.
 */
const MUTATION_OPTIONS = {
  testTimeout: '--test(?:Timeout|-timeout)',
  hookTimeout: '--hook(?:Timeout|-timeout)',
  bail: '--bail',
};

const optionPattern = (flag, flags = '') =>
  new RegExp(`\\s${flag}(?:=|\\s+)(\\d+)(?=\\s|$)`, flags);

/** The number a run's command gives a Vitest option, or undefined when it gives none. */
function optionIn(command, option) {
  const match = optionPattern(MUTATION_OPTIONS[option]).exec(command);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** The per-test timeout a run's command gives Vitest, in milliseconds, or undefined. */
const testTimeoutIn = (command) => optionIn(command, 'testTimeout');

/**
 * The Vitest options D-124 adds to every run's command (BUG-41), each as
 * Vitest accepts it, in camel or kebab case: the module cache, where it is
 * kept, and one test file at a time. BUG-41's own tests pin what they are,
 * where they stand, and that each is given once.
 */
const RUN_SPEED_OPTIONS = {
  fsModuleCache: /\s--(?:fsModuleCache|fs-module-cache)(?=\s|$)/g,
  fsModuleCachePath: /\s--(?:fsModuleCachePath|fs-module-cache-path)(?:=|\s+)\S+(?=\s|$)/g,
  maxWorkers: /\s--(?:maxWorkers|max-workers)(?:=|\s+)\d+(?=\s|$)/g,
};

/**
 * A run's command without the options BUG-12 adds to every run: the per-test
 * and hook timeouts and `--bail`, which BUG-12's own tests pin. What is left
 * says which configuration the run uses and which tests it runs.
 *
 * RG-03 (BUG-41, D-124): it now also leaves out the three options D-124 adds
 * to every run, `--fsModuleCache --fsModuleCachePath=.vitest-fs-cache
 * --maxWorkers=1`, which BUG-41's own tests pin, as BUG-12's are. So each
 * run's test still pins its configuration and its tests, exactly as before,
 * and no run's expected command is written again. Nothing else is left out:
 * an option of any other kind still fails every run's test.
 */
const withoutMutationOptions = (command) =>
  [
    ...Object.values(MUTATION_OPTIONS).map((flag) => optionPattern(flag, 'g')),
    ...Object.values(RUN_SPEED_OPTIONS),
  ].reduce((rest, pattern) => rest.replace(pattern, ''), command);

/**
 * The config with what a run is meant to change taken out: what it mutates,
 * the tests its command runs, and the report it writes. What is left must be
 * the same in every run.
 *
 * BUG-12 (RG-03): this also took out each run's incremental file. D-099 (the
 * owner's) leaves no run one, so it stays in, and a run that wrote its own
 * would now differ from the others here. Stricter: less is left out.
 */
function apartFromTheRun(config) {
  const shared = structuredClone(config);
  delete shared.mutate;
  delete shared.commandRunner.command;
  if (shared.jsonReporter !== undefined) delete shared.jsonReporter.fileName;
  return shared;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('stryker.config.mjs', () => {
  // BUG-12 (RG-03): this replaces "with no run named, the config is the one
  // before the grouping: every safety path, the whole suite". It is stricter.
  // That config was the one Stryker ran when started by hand, and nothing
  // judged it: its score was Stryker's own, in which a timed-out mutant is
  // caught, so 84 timeouts and no kill scored 100 % (D-098). An unjudged run
  // is a silent pass, so with no run named Stryker now refuses to start.
  // What that test also pinned, the thresholds, the command runner and every
  // test against every mutant, is now pinned for every run, in the test
  // after this one.
  test('BUG-12: with no run named, the config throws, and says to run `pnpm run mutation`', async () => {
    const error = await configFor(undefined).then(
      () => null,
      (thrown) => thrown,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('pnpm run mutation');
  });

  test('every run has the same config apart from what it mutates, the tests it runs and the report it writes', async () => {
    // BUG-12 (RG-03): this holds what each run's "equals the config with no
    // run named, apart from three settings" held before, now that that config
    // throws. The honest settings that test pinned on the unnamed config are
    // pinned here on every run.
    const shared = [];
    for (const run of mutationRuns()) {
      shared.push({ run: run.name, config: apartFromTheRun(await configFor(run.name)) });
    }

    expect(shared.length).toBeGreaterThan(1);
    for (const { config } of shared) {
      expect(config).toEqual(shared[0]?.config);
      expect(config).toMatchObject({
        testRunner: 'command',
        coverageAnalysis: 'all',
        thresholds: { high: 90, low: 80, break: 80 },
      });
    }
  });

  // BUG-12 (RG-03) for the four tests that follow, each of which compared its
  // run with the config with no run named. That config now throws, so each
  // pins its own three settings here and leaves the rest to the test above,
  // which holds them for every run. Its command is read without the options
  // BUG-12 adds to every run (the per-test and hook timeouts and --bail),
  // which BUG-12's own tests pin.
  //
  // BUG-12 (RG-03), D-099, for the six run tests that follow: each pinned its
  // run's own incremental file, reports/stryker-<run>.json. The owner's D-099
  // (2026-10-02) makes every run fresh, so each now pins that its run has
  // none. The change only removes the reuse of earlier results, so the run is
  // stricter. The test after them holds the same for every run, and that
  // `incremental` is never switched on.
  //
  // RG-03 (BUG-29, D-117), for every run test that follows: each command
  // started `pnpm exec vitest run `, and now starts
  // `node node_modules/vitest/vitest.mjs run `, Vitest's own bin. On LOST-07's
  // pull request the mutation check ran out of its 25 minutes, and
  // `pnpm exec` cost about 12 % of each mutant's CPU for nothing a run needs.
  // Only the prefix changes: what each run mutates, its configuration, its
  // options and its tests are pinned as before. The worker run's test is new
  // with BUG-29, so it is not one of the six above.
  test('the domain run mutates the domain and runs only the domain tests', async () => {
    const config = await configFor('domain');

    expect(config.mutate).toEqual(['apps/server/src/domain/**/*.ts', ...EXCLUSIONS]);
    expect(withoutMutationOptions(config.commandRunner.command)).toBe(
      'node node_modules/vitest/vitest.mjs run apps/server/src/domain',
    );
    expect(config.incrementalFile).toBeUndefined();
  });

  test('the healthchecks run mutates the adapter and runs its tests and the worker tests', async () => {
    const config = await configFor('healthchecks');

    expect(config.mutate).toEqual(['apps/server/src/adapters/healthchecks.ts', ...EXCLUSIONS]);
    expect(withoutMutationOptions(config.commandRunner.command)).toBe(
      'node node_modules/vitest/vitest.mjs run apps/server/src/adapters/healthchecks.test.ts apps/server/src/worker.test.ts',
    );
    expect(config.incrementalFile).toBeUndefined();
  });

  test("BUG-10: the journeys run mutates modules/journeys/ and runs the journey system tests, under the system tests' configuration", async () => {
    // D-095. The root configuration leaves *.system.test.ts out, and Vitest
    // does not run an excluded file even when it is named: under that
    // configuration this run would find no test file at all. So the command
    // is asked what it would run, not only read for what it says.
    //
    // RG-03 (LOST-03, D-112): the journey system tests are two files now:
    // contact.system.test.ts joins the group, as the spec's Mutation section
    // says. The run still mutates the same files, under the same config.
    //
    // RG-03 (SM-10, named in the spec's "Existing assertions that change by
    // design" and its Mutation section): removal.system.test.ts joins the
    // group too, as the removal module lives in modules/journeys/. The run
    // still mutates the same files, under the same config.
    const config = await configFor('journeys');

    expect(config.mutate).toEqual(['apps/server/src/modules/journeys/**/*.ts', ...EXCLUSIONS]);
    // RG-03 (BUG-29, D-117): was /^pnpm exec vitest run /.
    expect(config.commandRunner.command).toMatch(/^node node_modules\/vitest\/vitest\.mjs run /);
    expect(config.incrementalFile).toBeUndefined();
    const args = vitestArgs(config.commandRunner.command);
    expect(configNamedIn(args)).toBe('vitest.system.config.mjs');
    // Compared in any order: `vitest list` reports the files in its own.
    expect([...filesRunWith(args)].sort()).toEqual(
      [
        'apps/server/src/journeys.system.test.ts',
        'apps/server/src/contact.system.test.ts',
        'apps/server/src/removal.system.test.ts',
      ].sort(),
    );
  });

  test("LOST-02: the alerts run mutates modules/alerts/ and runs alerts.system.test.ts, under the system tests' configuration", async () => {
    // As the journeys run: the root configuration leaves *.system.test.ts
    // out, so the command is asked what it would run, not only read. Kept
    // apart from journeys.system.test.ts so each alerts mutant stays cheap
    // (the spec's Mutation section).
    //
    // RG-03 (LOST-06, the spec's "Existing assertions that change by
    // design"): "I'm on it" adds acknowledgement.ts to modules/alerts/, and
    // with it its system tests to this run, so the run is two files, not
    // one; "alone" leaves the title. Compared sorted, as the journeys run's
    // are: `vitest list` reports the files in an order of its own. What it
    // mutates and its configuration do not change.
    //
    // RG-03 (LOST-07, the spec's "Existing assertions that change by
    // design"): the escalation, the SMS sender and the SMS check live in
    // modules/alerts/, so the run's files gain escalation.system.test.ts,
    // compared sorted as before. What it mutates and its configuration do not
    // change.
    //
    // RG-03 (LOST-08, the spec's Mutation section and its "Modules and files
    // affected", which lists this pin as test-author's): "They're safe" and
    // the 24-hour end put closure.ts and expiry.ts in modules/alerts/, so the
    // run's files gain closure.system.test.ts and expiry.system.test.ts,
    // compared sorted as before. What it mutates and its configuration do not
    // change.
    const config = await configFor('alerts');

    expect(config.mutate).toEqual(['apps/server/src/modules/alerts/**/*.ts', ...EXCLUSIONS]);
    // RG-03 (BUG-29, D-117): was /^pnpm exec vitest run /.
    expect(config.commandRunner.command).toMatch(/^node node_modules\/vitest\/vitest\.mjs run /);
    expect(config.incrementalFile).toBeUndefined();
    const args = vitestArgs(config.commandRunner.command);
    expect(configNamedIn(args)).toBe('vitest.system.config.mjs');
    expect([...filesRunWith(args)].sort()).toEqual(
      [
        'apps/server/src/alerts.system.test.ts',
        'apps/server/src/acknowledgement.system.test.ts',
        'apps/server/src/escalation.system.test.ts',
        'apps/server/src/closure.system.test.ts',
        'apps/server/src/expiry.system.test.ts',
      ].sort(),
    );
  });

  test("REL-10-AC18: the canary run mutates modules/canary/ and runs canary.system.test.ts alone, under the system tests' configuration", async () => {
    // As the alerts run: the root configuration leaves *.system.test.ts out,
    // so the command is asked what it would run, not only read. Its own run,
    // apart from modules/alerts/, so no canary mutant first runs that
    // group's five system files (the spec's Mutation section, D-124).
    const config = await configFor('canary');

    expect(config.mutate).toEqual(['apps/server/src/modules/canary/**/*.ts', ...EXCLUSIONS]);
    expect(config.commandRunner.command).toMatch(/^node node_modules\/vitest\/vitest\.mjs run /);
    expect(config.incrementalFile).toBeUndefined();
    const args = vitestArgs(config.commandRunner.command);
    expect(configNamedIn(args)).toBe('vitest.system.config.mjs');
    expect([...filesRunWith(args)].sort()).toEqual(['apps/server/src/canary.system.test.ts']);
  });

  test('BUG-29: the worker run mutates worker.ts against worker.test.ts and process.test.ts, not bin.test.ts, under the root configuration (D-117)', async () => {
    // On LOST-07's pull request the mutation check ran out of its 25 minutes
    // inside the process run. bin.test.ts is about 8 s of CPU per mutant, and
    // without it each of worker.ts's 189 mutants ended with the same status.
    // As the process run: no --config, so it is asked what it would run.
    const config = await configFor('worker');

    expect(config.mutate).toEqual(['apps/server/src/worker.ts', ...EXCLUSIONS]);
    expect(withoutMutationOptions(config.commandRunner.command)).toBe(
      'node node_modules/vitest/vitest.mjs run apps/server/src/worker.test.ts apps/server/src/process.test.ts',
    );
    expect(config.incrementalFile).toBeUndefined();
    const args = vitestArgs(config.commandRunner.command);
    expect(configNamedIn(args)).toBeUndefined();
    expect(filesRunWith(args).toSorted()).toEqual([
      'apps/server/src/process.test.ts',
      'apps/server/src/worker.test.ts',
    ]);
  });

  test('BUG-12: the process run mutates bin/worker.ts and process.ts, against bin.test.ts and the worker and process tests', async () => {
    // D-098 gives the three files of #53's timed-out whole-suite run a group.
    // bin.test.ts is the only test that runs the real worker process (D-066's
    // amendment). Under the root configuration, so no --config: it is asked
    // what it would run, as the journeys run is.
    //
    // RG-03 (BUG-29, D-117): worker.ts leaves this run, and its title, for
    // the worker run above. bin.test.ts killed none of worker.ts's mutants on
    // its own, and cost every one of them about 8 s of CPU; the mutation
    // check ran out of its 25 minutes in this run on LOST-07's pull request.
    // What is left, bin/worker.ts and process.ts, runs the same three tests
    // as before.
    const config = await configFor('process');

    expect(config.mutate).toEqual([
      'apps/server/src/bin/worker.ts',
      'apps/server/src/process.ts',
      ...EXCLUSIONS,
    ]);
    expect(withoutMutationOptions(config.commandRunner.command)).toBe(
      'node node_modules/vitest/vitest.mjs run apps/server/src/bin/bin.test.ts apps/server/src/worker.test.ts apps/server/src/process.test.ts',
    );
    expect(config.incrementalFile).toBeUndefined();
    expect(filesRunWith(vitestArgs(config.commandRunner.command)).toSorted()).toEqual([
      'apps/server/src/bin/bin.test.ts',
      'apps/server/src/process.test.ts',
      'apps/server/src/worker.test.ts',
    ]);
  });

  test('BUG-12: the api-process run mutates api-process.ts against its own tests', async () => {
    const config = await configFor('api-process');

    expect(config.mutate).toEqual(['apps/server/src/api-process.ts', ...EXCLUSIONS]);
    expect(withoutMutationOptions(config.commandRunner.command)).toBe(
      'node node_modules/vitest/vitest.mjs run apps/server/src/api-process.test.ts',
    );
    expect(config.incrementalFile).toBeUndefined();
    expect(filesRunWith(vitestArgs(config.commandRunner.command))).toEqual([
      'apps/server/src/api-process.test.ts',
    ]);
  });

  test('the whole-suite run mutates every safety path no group claims, against the whole suite', async () => {
    // BUG-12 (RG-03): `left` was only required to contain worker.ts. D-098
    // gives worker.ts a group, and every other safety file that exists, so
    // what is left is pinned exactly: the two safety paths that hold no file
    // yet.
    //
    // LOST-02 (RG-03): modules/alerts/ now holds files and has its own group,
    // as the spec's Mutation section says, so what is left is the one safety
    // path that holds no file yet. Still pinned exactly.
    const config = await configFor('whole-suite');
    const left = mutationRuns().find((run) => run.name === 'whole-suite')?.paths ?? [];

    expect(left).toEqual(['apps/mobile/src/safety-core/']);
    expect(config.mutate).toEqual([...globs(left), ...EXCLUSIONS]);
    expect(withoutMutationOptions(config.commandRunner.command)).toBe(
      'node node_modules/vitest/vitest.mjs run apps packages',
    );
    expect(config.incrementalFile).toBeUndefined();
  });

  test('across the runs, every safety path is mutated exactly once', async () => {
    // BUG-12 (RG-03): two changes, neither looser. The run names gained the
    // process and api-process groups (D-098). And the expected union was the
    // config with no run named, which now throws; that config's `mutate` was
    // every safety path, which is what is compared here directly, as its own
    // test used to pin it.
    const mutated = [];
    for (const run of mutationRuns()) {
      const config = await configFor(run.name);
      mutated.push(...config.mutate.filter((glob) => !glob.startsWith('!')));
    }

    // LOST-02 (RG-03): the alerts group joins the runs, after journeys; the
    // others keep their names and their order.
    //
    // RG-03 (BUG-29, D-117): the worker group joins the runs, immediately
    // before process, which gives it worker.ts: the mutation check ran out of
    // its 25 minutes in the process run on LOST-07's pull request. The others
    // keep their names and their order, and the union below is still every
    // safety path, each once.
    //
    // RG-03 (REL-10, named in the spec's "Existing assertions that change by
    // design": the group pins in scripts/ are added to, not changed; its
    // Mutation section): the canary group joins the runs, right after
    // alerts, which gives it modules/canary/. The others keep their names
    // and their order, and the union below is still every safety path, each
    // once.
    expect(mutationRuns().map((run) => run.name)).toEqual([
      'domain',
      'healthchecks',
      'journeys',
      'alerts',
      'canary',
      'worker',
      'process',
      'api-process',
      'whole-suite',
    ]);
    expect(mutated.toSorted()).toEqual(globs(SAFETY_PATHS).toSorted());
  });

  test('BUG-12: each run writes a JSON report the gate can read, at reports/mutation/<run>.json', async () => {
    // D-098: the gate judges each run from its report, file by file, because
    // Stryker's exit code passed a run whose every mutant timed out. One file
    // per run, so a run never reads another's. The clear-text report stays:
    // it names each surviving mutant in the log.
    for (const run of mutationRuns()) {
      const config = await configFor(run.name);

      expect(config.reporters, run.name).toEqual(expect.arrayContaining(['clear-text', 'json']));
      expect(config.jsonReporter?.fileName, run.name).toBe(`reports/mutation/${run.name}.json`);
    }
  });

  test('BUG-12: no run writes or reads an incremental file: no run has an incrementalFile, and none switches incremental on (D-099)', async () => {
    // With the command runner Stryker has no coverage data, so an incremental
    // run reuses every earlier result in code that has not changed, whatever
    // happened to the tests. safety-reviewer replaced api-process.test.ts with
    // a test asserting nothing: the incremental run scored 100 %, a fresh one
    // 0 %. The owner's D-099: every run is fresh.
    for (const run of mutationRuns()) {
      const config = await configFor(run.name);

      expect(config.incrementalFile, `${run.name}: incrementalFile`).toBeUndefined();
      expect(config.incremental, `${run.name}: incremental`).not.toBe(true);
    }
  });

  test("BUG-12: each run gives Vitest a per-test timeout at least 10 s inside Stryker's", async () => {
    // vitest.config.mjs gives a test 60 s. Stryker stops a mutant after about
    // 1.5 times the clean run plus timeoutMS, so a mutant that makes a test
    // wait forever, such as process.exit(code) planted as nothing, was
    // stopped by Stryker first and recorded as a timeout, never as a failed
    // test. With Vitest's limit at least 10 s below Stryker's, the test fails
    // inside Vitest, and the mutant is killed (D-098).
    for (const run of mutationRuns()) {
      const config = await configFor(run.name);
      const testTimeout = testTimeoutIn(config.commandRunner.command);

      expect(testTimeout, `${run.name}: the command gives Vitest no --testTimeout`).toBeDefined();
      expect(testTimeout, run.name).toBeGreaterThan(0);
      expect(config.timeoutMS, `${run.name}: Stryker's timeoutMS`).toBeGreaterThanOrEqual(
        (testTimeout ?? Number.POSITIVE_INFINITY) + 10_000,
      );
    }
  });

  test('BUG-12: each run stops Vitest at its first failed test, with --bail 1', async () => {
    // Vitest runs one file's tests one after another. A mutant that makes k
    // of them wait, as process.exit(code) planted as nothing can in
    // bin.test.ts, would take k times the per-test timeout, and Stryker
    // would stop it as a timeout after all. The command runner reads only
    // the exit code, so the first failure is all it needs: --bail 1 ends the
    // run there, and the mutant is killed.
    for (const run of mutationRuns()) {
      const config = await configFor(run.name);

      expect(
        optionIn(config.commandRunner.command, 'bail'),
        `${run.name}: the command does not give Vitest --bail 1`,
      ).toBe(1);
    }
  });

  test("BUG-12: each run gives Vitest a hook timeout too, and Stryker's timeoutMS is at least 10 s more than the longer of the two", async () => {
    // Stricter than the test above, which it leaves as it is: an afterEach
    // that waits forever must also fail inside Vitest, with time to spare,
    // before Stryker stops the mutant.
    for (const run of mutationRuns()) {
      const config = await configFor(run.name);
      const testTimeout = optionIn(config.commandRunner.command, 'testTimeout');
      const hookTimeout = optionIn(config.commandRunner.command, 'hookTimeout');

      expect(hookTimeout, `${run.name}: the command gives Vitest no --hookTimeout`).toBeDefined();
      expect(hookTimeout, run.name).toBeGreaterThan(0);
      expect(testTimeout, `${run.name}: the command gives Vitest no --testTimeout`).toBeDefined();
      expect(config.timeoutMS, `${run.name}: Stryker's timeoutMS`).toBeGreaterThanOrEqual(
        Math.max(testTimeout ?? Number.POSITIVE_INFINITY, hookTimeout ?? Number.POSITIVE_INFINITY) +
          10_000,
      );
    }
  });

  test('BUG-29: every run starts Vitest by its own bin, `node node_modules/vitest/vitest.mjs run`, not by `pnpm exec` (D-117)', async () => {
    // pnpm exec cost about 12 % of each mutant's CPU (3 % to 19 % by run),
    // for nothing a run needs: no test depends on the PATH it sets, and
    // bin.test.ts starts its processes with process.execPath. On LOST-07's
    // pull request the mutation check ran out of its 25 minutes.
    for (const run of mutationRuns()) {
      const config = await configFor(run.name);

      expect(config.commandRunner.command, run.name).toMatch(
        /^node node_modules\/vitest\/vitest\.mjs run /,
      );
    }
  });

  test("BUG-29: the file each run's command starts is the bin.vitest node_modules/vitest/package.json declares, it exists, and it starts this Vitest (D-117)", async () => {
    // So a Vitest upgrade that moves its bin fails here, by name, and not in
    // CI's mutation job, where every mutant's run would fail to start.
    const manifest = JSON.parse(
      readFileSync(path.join(root, 'node_modules', 'vitest', 'package.json'), 'utf8'),
    );
    const declared = manifest.bin?.vitest;
    expect(typeof declared, 'node_modules/vitest/package.json declares no bin.vitest').toBe(
      'string',
    );
    const bin = path.posix.join('node_modules/vitest', declared);
    expect(
      existsSync(path.join(root, bin)) && statSync(path.join(root, bin)).isFile(),
      `${bin}, Vitest's declared bin, is not a file`,
    ).toBe(true);

    for (const run of mutationRuns()) {
      const config = await configFor(run.name);
      const [interpreter, script, subcommand] = config.commandRunner.command.split(/\s+/);

      expect({ interpreter, script, subcommand }, run.name).toEqual({
        interpreter: 'node',
        script: bin,
        subcommand: 'run',
      });
    }

    // Started as every command starts it, from the repository, with `node`
    // found on the PATH: it answers with the installed version.
    const version = spawnSync('node', [bin, '--version'], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    expect(version.error, `node ${bin} --version did not start`).toBeUndefined();
    expect(version.status, version.stderr).toBe(0);
    expect(version.stdout).toContain(`vitest/${String(manifest.version)}`);
  });

  test('BUG-41: every run’s command gives Vitest `--fsModuleCache --fsModuleCachePath=.vitest-fs-cache --maxWorkers=1` right after `run`, in that order, and each of the three once (D-124)', async () => {
    // SM-10's mutation run ran out of its 25 minutes, about 32 in all on a
    // quiet machine. Each mutant's run spent most of its time transforming
    // the same code again, and started one Vitest worker per test file
    // beside Stryker's four runners. With Vitest's module cache, kept in the
    // run's sandbox, and one worker, the same mutants took about 16 minutes,
    // each with the status it had before (1,170 of 1,170).
    //
    // Once each, in any spelling: a second --maxWorkers, or a
    // --no-fsModuleCache, later on the line would quietly undo the first.
    const once = {
      fsModuleCache: /^--(?:no-)?(?:fsModuleCache|fs-module-cache)(?:=.*)?$/,
      fsModuleCachePath: /^--(?:fsModuleCachePath|fs-module-cache-path)(?:=.*)?$/,
      maxWorkers: /^--(?:maxWorkers|max-workers)(?:=.*)?$/,
    };
    for (const run of mutationRuns()) {
      const config = await configFor(run.name);
      const args = vitestArgs(config.commandRunner.command);

      expect(args.slice(0, 3), run.name).toEqual([
        '--fsModuleCache',
        '--fsModuleCachePath=.vitest-fs-cache',
        '--maxWorkers=1',
      ]);
      for (const [option, pattern] of Object.entries(once)) {
        expect(
          args.filter((arg) => pattern.test(arg)),
          `${run.name}: ${option} given once`,
        ).toHaveLength(1);
      }
    }
  });

  // RG-03, a title correction; no assertion changed (CI's safety-reviewer on
  // #74, D-124 as amended). The title ended "…goes with it: every run starts
  // with an empty cache, and none reads another's". Not exactly true: Stryker
  // does not read .gitignore, so a stray .vitest-fs-cache/ in the repository
  // root would be copied into the sandbox. No run reads another's entries
  // because each key includes the module's absolute path, sandbox and all,
  // the file's content and the config. The title now claims only what the
  // assertions check and what D-124 says, and the comment inside is corrected
  // the same way.
  test('BUG-41: every run’s module cache is a relative path, neither absolute nor under node_modules, so it is made in the run’s own Stryker sandbox and goes with it, and no run reads another’s entries (D-099, D-124)', async () => {
    // Stryker starts each mutant's command in the run's sandbox,
    // .stryker-tmp/sandbox-*, and removes the sandbox when the run ends. A
    // relative path is made there. An absolute one would outlive the run and
    // pile up outside it, and node_modules in a sandbox is a link to the
    // repository's own, so a cache under it would too: either way the run
    // would not be self-contained, as D-099 wants. Whether a later run could
    // use those entries is not what this test guards. The cache is made in the
    // run's own sandbox and goes with it, and no run can use another's
    // entries, since each key includes the module's absolute path, sandbox and
    // all. A stray copy carried in from the repository root could never match.
    for (const run of mutationRuns()) {
      const config = await configFor(run.name);
      const given = vitestArgs(config.commandRunner.command)
        .filter((arg) => CACHE_PATH_ARG.test(arg))
        .map((arg) => arg.replace(CACHE_PATH_ARG, ''));

      expect(given, `${run.name}: one --fsModuleCachePath=<path>`).toHaveLength(1);
      const [cachePath = ''] = given;
      expect(cachePath, `${run.name}: a path`).not.toBe('');
      expect(
        path.posix.isAbsolute(cachePath) || path.win32.isAbsolute(cachePath),
        `${run.name}: ${cachePath} is absolute`,
      ).toBe(false);
      expect(cachePath.startsWith('~'), `${run.name}: ${cachePath} is in a home`).toBe(false);
      const segments = path.posix.normalize(cachePath.replaceAll('\\', '/')).split('/');
      expect(segments[0], `${run.name}: ${cachePath} leaves the sandbox`).not.toBe('..');
      expect(segments, `${run.name}: ${cachePath} is under node_modules`).not.toContain(
        'node_modules',
      );
    }
  });

  test('an unknown run throws, naming it and the runs there are', async () => {
    // A misspelt name must not fall back to the whole config: that would run
    // every safety path against the whole suite once per misspelling, and the
    // log would never say why.
    const error = await configFor('everything').then(
      () => null,
      (thrown) => thrown,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('everything');
    for (const name of ['domain', 'healthchecks', 'whole-suite']) {
      expect(error?.message).toContain(name);
    }
  });
});
