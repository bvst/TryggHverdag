// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-04 runs after every single edit, so what it decides to check — and what it
// leaves alone — shapes how the whole project feels to work in.
import { describe, expect, test } from 'vitest';
import { filesToCheck, stepsFor } from './gate-file.mjs';

const names = (files) => stepsFor(files).map((step) => step.name);

describe('filesToCheck', () => {
  test('keeps our own code', () => {
    expect(filesToCheck(['apps/server/src/api.ts', 'packages/contracts/src/index.ts'])).toEqual([
      'apps/server/src/api.ts',
      'packages/contracts/src/index.ts',
    ]);
  });

  test('drops the separator pnpm passes through', () => {
    expect(filesToCheck(['--', 'apps/server/src/api.ts'])).toEqual(['apps/server/src/api.ts']);
  });

  test.each([
    'docs/progress.md',
    'docs/plan/decisions.md',
    'spikes/background/index.ts',
    'README.md',
    'coverage/coverage-summary.json',
  ])('leaves %s alone', (file) => {
    expect(filesToCheck([file])).toEqual([]);
  });
});

describe('stepsFor', () => {
  test('code gets formatting, lint, types, import rules and its tests', () => {
    expect(names(['apps/server/src/api.ts'])).toEqual([
      'formatting',
      'lint',
      'types',
      'import rules (AR-10)',
      'tests that cover this file',
    ]);
  });

  test('a configuration file is only formatted — there is nothing else to say about it', () => {
    expect(names(['turbo.json'])).toEqual(['formatting']);
  });

  test('editing a test runs that test, rather than looking for tests of a test', () => {
    const steps = names(['apps/server/src/journey.test.ts']);
    expect(steps).toContain('the edited tests');
    expect(steps).not.toContain('tests that cover this file');
  });

  test('the file being checked is passed to the tools, not the whole repository', () => {
    const [formatting] = stepsFor(['apps/server/src/api.ts']);
    expect(formatting?.command).toContain('apps/server/src/api.ts');
  });
});

// INF-06-AC7: the app's tests run on jest-expo, the server's on Vitest, and a
// file is sent to the runner that can run its tests. Vitest's `related` run
// against React Native code would fail on every edit for a reason that has
// nothing to do with the edit, and a gate that is always red is soon ignored.
describe('stepsFor, for the app', () => {
  const runs = (files, runner) =>
    stepsFor(files).filter((step) => step.command.some((arg) => arg === runner));
  // The file may be handed over relative to the repository, relative to the
  // app (jest runs there), or absolute: any of the three names it, and only at
  // a path boundary.
  const namesFile = (arg, file) => {
    const given = arg.replace(/^\.\//, '');
    return given === file || file.endsWith(`/${given}`) || given.endsWith(`/${file}`);
  };
  const passes = (step, file) =>
    step !== undefined && step.command.some((arg) => namesFile(arg, file));

  test.each([
    'apps/mobile/src/app/index.tsx',
    'apps/mobile/src/shared/translations/language.ts',
    'apps/mobile/app.config.ts',
  ])('INF-06-AC7: an edited app file %s runs the jest-expo tests related to it', (file) => {
    const jest = runs([file], 'jest');

    expect(jest).toHaveLength(1);
    expect(jest[0]?.command).toContain('--findRelatedTests');
    expect(passes(jest[0], file)).toBe(true);
    expect(runs([file], 'vitest')).toEqual([]);
  });

  test('INF-06-AC7: an edited app test runs on jest-expo too, never on Vitest', () => {
    const file = 'apps/mobile/src/shared/translations/language.test.ts';
    const jest = runs([file], 'jest');

    expect(jest).toHaveLength(1);
    expect(passes(jest[0], file)).toBe(true);
    expect(runs([file], 'vitest')).toEqual([]);
  });

  test('INF-06-AC7: an edited server file still gets Vitest’s related tests, and jest is not asked', () => {
    const vitest = runs(['apps/server/src/api.ts'], 'vitest');

    expect(vitest).toHaveLength(1);
    expect(vitest[0]?.command).toEqual(
      expect.arrayContaining(['related', '--run', 'apps/server/src/api.ts']),
    );
    expect(runs(['apps/server/src/api.ts'], 'jest')).toEqual([]);
  });

  test('INF-06-AC7: an edit to both sends each file to its own runner and to no other', () => {
    const app = 'apps/mobile/src/app/index.tsx';
    const server = 'apps/server/src/api.ts';
    const jestSteps = runs([app, server], 'jest');
    const vitestSteps = runs([app, server], 'vitest');
    const [jest] = jestSteps;
    const [vitest] = vitestSteps;

    expect(jestSteps).toHaveLength(1);
    expect(vitestSteps).toHaveLength(1);
    expect(passes(jest, app)).toBe(true);
    expect(passes(jest, server)).toBe(false);
    expect(vitest?.command).toContain(server);
    expect(vitest?.command).not.toContain(app);
  });

  test('INF-06-AC7: app files still get formatting, lint, types and the import rules', () => {
    expect(names(['apps/mobile/src/app/index.tsx'])).toEqual(
      expect.arrayContaining(['formatting', 'lint', 'types', 'import rules (AR-10)']),
    );
  });
});
