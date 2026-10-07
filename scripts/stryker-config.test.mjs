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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SAFETY_PATHS, mutationRuns } from './lib/gate-decisions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXCLUSIONS = ['!**/*.test.ts', '!**/*.integration.test.ts', '!**/*.system.test.ts'];

/** What a run's command hands Vitest: everything after `pnpm exec vitest run`. */
const VITEST_RUN = 'pnpm exec vitest run ';
const vitestArgs = (command) => command.slice(VITEST_RUN.length).trim().split(/\s+/);

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

/**
 * The test files Vitest would run with the arguments `args`, as `vitest list`
 * reports them, relative to the repository. `--json` comes last on purpose:
 * followed by a path, it takes that path as a file to write the list into.
 */
function filesRunWith(args) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
      'list',
      ...args,
      '--filesOnly',
      '--json',
    ],
    { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } },
  );
  if (result.status !== 0) {
    throw new Error(`vitest list ${args.join(' ')} failed:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout).map((entry) => path.relative(root, entry.file));
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
 * A run's command without the options BUG-12 adds to every run: the per-test
 * and hook timeouts and `--bail`, which BUG-12's own tests pin. What is left
 * says which configuration the run uses and which tests it runs.
 */
const withoutMutationOptions = (command) =>
  Object.values(MUTATION_OPTIONS).reduce(
    (rest, flag) => rest.replace(optionPattern(flag, 'g'), ''),
    command,
  );

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
  test('the domain run mutates the domain and runs only the domain tests', async () => {
    const config = await configFor('domain');

    expect(config.mutate).toEqual(['apps/server/src/domain/**/*.ts', ...EXCLUSIONS]);
    expect(withoutMutationOptions(config.commandRunner.command)).toBe(
      'pnpm exec vitest run apps/server/src/domain',
    );
    expect(config.incrementalFile).toBeUndefined();
  });

  test('the healthchecks run mutates the adapter and runs its tests and the worker tests', async () => {
    const config = await configFor('healthchecks');

    expect(config.mutate).toEqual(['apps/server/src/adapters/healthchecks.ts', ...EXCLUSIONS]);
    expect(withoutMutationOptions(config.commandRunner.command)).toBe(
      'pnpm exec vitest run apps/server/src/adapters/healthchecks.test.ts apps/server/src/worker.test.ts',
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
    const config = await configFor('journeys');

    expect(config.mutate).toEqual(['apps/server/src/modules/journeys/**/*.ts', ...EXCLUSIONS]);
    expect(config.commandRunner.command).toMatch(/^pnpm exec vitest run /);
    expect(config.incrementalFile).toBeUndefined();
    const args = vitestArgs(config.commandRunner.command);
    expect(configNamedIn(args)).toBe('vitest.system.config.mjs');
    // Compared in any order: `vitest list` reports the files in its own.
    expect([...filesRunWith(args)].sort()).toEqual(
      ['apps/server/src/journeys.system.test.ts', 'apps/server/src/contact.system.test.ts'].sort(),
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
    const config = await configFor('alerts');

    expect(config.mutate).toEqual(['apps/server/src/modules/alerts/**/*.ts', ...EXCLUSIONS]);
    expect(config.commandRunner.command).toMatch(/^pnpm exec vitest run /);
    expect(config.incrementalFile).toBeUndefined();
    const args = vitestArgs(config.commandRunner.command);
    expect(configNamedIn(args)).toBe('vitest.system.config.mjs');
    expect([...filesRunWith(args)].sort()).toEqual(
      [
        'apps/server/src/alerts.system.test.ts',
        'apps/server/src/acknowledgement.system.test.ts',
        'apps/server/src/escalation.system.test.ts',
      ].sort(),
    );
  });

  test('BUG-12: the process run mutates worker.ts, bin/worker.ts and process.ts, against bin.test.ts and the worker and process tests', async () => {
    // D-098 gives the three files of #53's timed-out whole-suite run a group.
    // bin.test.ts is the only test that runs the real worker process (D-066's
    // amendment). Under the root configuration, so no --config: it is asked
    // what it would run, as the journeys run is.
    const config = await configFor('process');

    expect(config.mutate).toEqual([
      'apps/server/src/worker.ts',
      'apps/server/src/bin/worker.ts',
      'apps/server/src/process.ts',
      ...EXCLUSIONS,
    ]);
    expect(withoutMutationOptions(config.commandRunner.command)).toBe(
      'pnpm exec vitest run apps/server/src/bin/bin.test.ts apps/server/src/worker.test.ts apps/server/src/process.test.ts',
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
      'pnpm exec vitest run apps/server/src/api-process.test.ts',
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
      'pnpm exec vitest run apps packages',
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
    expect(mutationRuns().map((run) => run.name)).toEqual([
      'domain',
      'healthchecks',
      'journeys',
      'alerts',
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
