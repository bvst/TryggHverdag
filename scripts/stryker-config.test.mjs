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
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SAFETY_PATHS, mutationRuns } from './lib/gate-decisions.mjs';

const EXCLUSIONS = ['!**/*.test.ts', '!**/*.integration.test.ts', '!**/*.system.test.ts'];

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
