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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('stryker.config.mjs', () => {
  test('with no run named, the config is the one before the grouping: every safety path, the whole suite', async () => {
    const config = await configFor(undefined);

    expect(config.mutate).toEqual([...globs(SAFETY_PATHS), ...EXCLUSIONS]);
    expect(config.commandRunner.command).toBe('pnpm exec vitest run apps packages');
    expect(config.incrementalFile).toBe('reports/stryker-incremental.json');
    expect(config).toMatchObject({
      testRunner: 'command',
      coverageAnalysis: 'all',
      thresholds: { high: 90, low: 80, break: 80 },
    });
  });

  test('the domain run mutates the domain and runs only the domain tests', async () => {
    const whole = await configFor(undefined);
    const config = await configFor('domain');

    expect(config).toEqual({
      ...whole,
      mutate: ['apps/server/src/domain/**/*.ts', ...EXCLUSIONS],
      commandRunner: {
        ...whole.commandRunner,
        command: 'pnpm exec vitest run apps/server/src/domain',
      },
      incrementalFile: 'reports/stryker-domain.json',
    });
  });

  test('the healthchecks run mutates the adapter and runs its tests and the worker tests', async () => {
    const whole = await configFor(undefined);
    const config = await configFor('healthchecks');

    expect(config).toEqual({
      ...whole,
      mutate: ['apps/server/src/adapters/healthchecks.ts', ...EXCLUSIONS],
      commandRunner: {
        ...whole.commandRunner,
        command:
          'pnpm exec vitest run apps/server/src/adapters/healthchecks.test.ts apps/server/src/worker.test.ts',
      },
      incrementalFile: 'reports/stryker-healthchecks.json',
    });
  });

  test("BUG-10: the journeys run mutates modules/journeys/ and runs the journey system tests, under the system tests' configuration", async () => {
    // D-095. The root configuration leaves *.system.test.ts out, and Vitest
    // does not run an excluded file even when it is named: under that
    // configuration this run would find no test file at all. So the command
    // is asked what it would run, not only read for what it says.
    const whole = await configFor(undefined);
    const config = await configFor('journeys');

    expect(config).toEqual({
      ...whole,
      mutate: ['apps/server/src/modules/journeys/**/*.ts', ...EXCLUSIONS],
      commandRunner: {
        ...whole.commandRunner,
        command: expect.stringMatching(/^pnpm exec vitest run /),
      },
      incrementalFile: 'reports/stryker-journeys.json',
    });
    const args = vitestArgs(config.commandRunner.command);
    expect(configNamedIn(args)).toBe('vitest.system.config.mjs');
    expect(filesRunWith(args)).toEqual(['apps/server/src/journeys.system.test.ts']);
  });

  test('the whole-suite run mutates every safety path no group claims, against the whole suite', async () => {
    const whole = await configFor(undefined);
    const config = await configFor('whole-suite');
    const left = mutationRuns().find((run) => run.name === 'whole-suite')?.paths ?? [];

    expect(left).toContain('apps/server/src/worker.ts');
    expect(config).toEqual({
      ...whole,
      mutate: [...globs(left), ...EXCLUSIONS],
      commandRunner: { ...whole.commandRunner, command: 'pnpm exec vitest run apps packages' },
      incrementalFile: 'reports/stryker-whole-suite.json',
    });
  });

  test('across the runs, every safety path is mutated exactly once', async () => {
    const whole = await configFor(undefined);
    const mutated = [];
    for (const run of mutationRuns()) {
      const config = await configFor(run.name);
      mutated.push(...config.mutate.filter((glob) => !glob.startsWith('!')));
    }

    expect(mutationRuns().map((run) => run.name)).toEqual([
      'domain',
      'healthchecks',
      'journeys',
      'whole-suite',
    ]);
    expect(mutated.toSorted()).toEqual(
      whole.mutate.filter((glob) => !glob.startsWith('!')).toSorted(),
    );
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
