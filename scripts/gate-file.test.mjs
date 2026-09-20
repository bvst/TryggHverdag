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
