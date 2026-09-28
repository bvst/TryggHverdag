// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// RG-04. The two questions are tested apart: has this change made things worse,
// and is safety code tested well enough to trust.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import vitestCoverageConfig from '../../vitest.coverage.config.mjs';
import {
  COVERAGE_SUMMARIES,
  floorBreaches,
  linesAcross,
  mergeSummaries,
  ratchetDrops,
  summarize,
} from './coverage.mjs';
import { matchesAnyGlob } from './glob.mjs';

const SUMMARY = {
  total: { lines: { pct: 50 } },
  '/repo/apps/server/src/domain/journey.ts': {
    lines: { pct: 90, covered: 90, total: 100 },
    branches: { pct: 92 },
  },
  '/repo/scripts/req-coverage.mjs': {
    lines: { pct: 70, covered: 7, total: 10 },
    branches: { pct: 60 },
  },
};

describe('summarize', () => {
  test('makes paths relative to the repository', () => {
    const files = summarize(SUMMARY, '/repo');
    expect(Object.keys(files)).toEqual([
      'apps/server/src/domain/journey.ts',
      'scripts/req-coverage.mjs',
    ]);
    expect(files['apps/server/src/domain/journey.ts']?.branches).toBe(92);
  });

  test('leaves the totals row out; it answers a different question', () => {
    expect(summarize(SUMMARY, '/repo').total).toBeUndefined();
  });
});

describe('ratchetDrops', () => {
  const baseline = { 'apps/server/src/api.ts': { lines: 80, branches: 70 } };

  test('catches a changed file that covers less than it did', () => {
    const current = { 'apps/server/src/api.ts': { lines: 60, branches: 70 } };
    expect(ratchetDrops({ current, baseline, changed: ['apps/server/src/api.ts'] })).toEqual([
      { file: 'apps/server/src/api.ts', metric: 'lines', was: 80, now: 60 },
    ]);
  });

  test('allows coverage to go up', () => {
    const current = { 'apps/server/src/api.ts': { lines: 95, branches: 90 } };
    expect(ratchetDrops({ current, baseline, changed: ['apps/server/src/api.ts'] })).toEqual([]);
  });

  test('ignores files the branch did not touch', () => {
    const current = { 'apps/server/src/api.ts': { lines: 10, branches: 10 } };
    expect(ratchetDrops({ current, baseline, changed: ['docs/progress.md'] })).toEqual([]);
  });

  test('says nothing about a new file — the floors judge those', () => {
    const current = { 'apps/server/src/new.ts': { lines: 0, branches: 0 } };
    expect(ratchetDrops({ current, baseline, changed: ['apps/server/src/new.ts'] })).toEqual([]);
  });
});

describe('floorBreaches', () => {
  test('safety code below 95 % branches is a breach', () => {
    const current = {
      'apps/server/src/domain/journey.ts': {
        branches: 80,
        lines: 99,
        coveredLines: 99,
        totalLines: 100,
      },
    };
    const { breaches } = floorBreaches(current);
    expect(breaches[0]).toMatchObject({ metric: 'branches', floor: 95, value: 80 });
  });

  test('safety code above the floor passes', () => {
    const current = {
      'apps/server/src/domain/journey.ts': {
        branches: 96,
        lines: 99,
        coveredLines: 99,
        totalLines: 100,
      },
    };
    expect(floorBreaches(current).breaches).toEqual([]);
  });

  test('product code below 80 % lines is a breach, measured across the whole of it', () => {
    const current = {
      'apps/server/src/a.ts': { branches: 100, lines: 50, coveredLines: 50, totalLines: 100 },
      'packages/contracts/src/b.ts': {
        branches: 100,
        lines: 100,
        coveredLines: 10,
        totalLines: 10,
      },
    };
    const { breaches } = floorBreaches(current);
    expect(breaches[0]).toMatchObject({ scope: 'all product code', metric: 'lines', floor: 80 });
  });

  test('when there is no such code yet, the floor is reported as not in force, never as passed', () => {
    const { breaches, notApplicable } = floorBreaches({
      'scripts/doctor.mjs': { branches: 0, lines: 0, coveredLines: 0, totalLines: 10 },
    });
    expect(breaches).toEqual([]);
    expect(notApplicable).toHaveLength(2);
    expect(notApplicable.join(' ')).toContain('none exists yet');
  });
});

describe('linesAcross', () => {
  test('weights by size, so one tiny well-covered file cannot hide a big bare one', () => {
    const current = {
      'apps/a.ts': { coveredLines: 0, totalLines: 100, lines: 0, branches: 0 },
      'apps/b.ts': { coveredLines: 10, totalLines: 10, lines: 100, branches: 100 },
    };
    expect(linesAcross(current, () => true)).toBeCloseTo(9.09, 1);
  });

  test('is null when nothing matches', () => {
    expect(linesAcross({}, () => true)).toBeNull();
  });
});

// INF-06-AC8: two runners, one ratchet. Vitest measures the server, the
// packages and the scripts; jest-expo measures the app. Each file is measured
// by exactly one of them, and a summary that is not there is not "nothing to
// measure" — it is a run that did not happen.
const VITEST_SUMMARY = {
  total: { lines: { pct: 90 } },
  '/repo/apps/server/src/api.ts': {
    lines: { pct: 100, covered: 11, total: 11 },
    branches: { pct: 100 },
  },
  '/repo/scripts/gate.mjs': { lines: { pct: 25, covered: 5, total: 20 }, branches: { pct: 25 } },
};
const JEST_SUMMARY = {
  total: { lines: { pct: 95 } },
  '/repo/apps/mobile/src/shared/translations/language.ts': {
    lines: { pct: 100, covered: 8, total: 8 },
    branches: { pct: 100 },
  },
};
const VITEST_FILE = 'coverage/coverage-summary.json';
const JEST_FILE = 'apps/mobile/coverage/coverage-summary.json';

describe('the two coverage summaries', () => {
  test("INF-06-AC8: the ratchet reads Vitest's summary and the app's jest-expo summary", () => {
    expect(COVERAGE_SUMMARIES.map((summary) => summary.file).sort()).toEqual(
      [JEST_FILE, VITEST_FILE].sort(),
    );
  });

  test('INF-06-AC8: they merge into one set of files, relative to the repository', () => {
    const result = mergeSummaries(
      [
        { runner: 'vitest', file: VITEST_FILE, summary: VITEST_SUMMARY },
        { runner: 'jest-expo', file: JEST_FILE, summary: JEST_SUMMARY },
      ],
      '/repo',
    );

    expect(result.ok).toBe(true);
    expect(Object.keys(result.files).sort()).toEqual([
      'apps/mobile/src/shared/translations/language.ts',
      'apps/server/src/api.ts',
      'scripts/gate.mjs',
    ]);
    expect(result.files['apps/mobile/src/shared/translations/language.ts']).toMatchObject({
      lines: 100,
      coveredLines: 8,
      totalLines: 8,
    });
  });

  test('INF-06-AC8: a missing summary is refused, naming the file, rather than measured as nothing', () => {
    const result = mergeSummaries(
      [
        { runner: 'vitest', file: VITEST_FILE, summary: VITEST_SUMMARY },
        { runner: 'jest-expo', file: JEST_FILE, summary: null },
      ],
      '/repo',
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain(JEST_FILE);
    expect(result.files).toBeUndefined();
  });

  test('INF-06-AC8: with both missing, both are named', () => {
    const result = mergeSummaries(
      [
        { runner: 'vitest', file: VITEST_FILE, summary: null },
        { runner: 'jest-expo', file: JEST_FILE, summary: null },
      ],
      '/repo',
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain(VITEST_FILE);
    expect(result.message).toContain(JEST_FILE);
  });

  test('INF-06-AC8: a file both runners measured is refused, because one of them measured it wrongly', () => {
    // The shape this takes in practice: Vitest's include pattern reaches into
    // apps/mobile, finds files it cannot run, and reports them at 0 % beside
    // jest-expo's real figure. Whichever number won, the ratchet would be
    // measuring something other than the tests.
    const result = mergeSummaries(
      [
        {
          runner: 'vitest',
          file: VITEST_FILE,
          summary: {
            ...VITEST_SUMMARY,
            '/repo/apps/mobile/src/shared/translations/language.ts': {
              lines: { pct: 0, covered: 0, total: 8 },
              branches: { pct: 0 },
            },
          },
        },
        { runner: 'jest-expo', file: JEST_FILE, summary: JEST_SUMMARY },
      ],
      '/repo',
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('apps/mobile/src/shared/translations/language.ts');
  });

  test("INF-06-AC8: Vitest's coverage run leaves the app out, so it cannot count it at 0 %", () => {
    const { include, exclude } = vitestCoverageConfig.test.coverage;
    const appFile = 'apps/mobile/src/shared/translations/language.ts';

    // Included by the pattern that measures the server's source, which is
    // exactly why the exclusion has to exist.
    expect(matchesAnyGlob(appFile, include)).toBe(true);
    expect(matchesAnyGlob(appFile, exclude)).toBe(true);
    expect(matchesAnyGlob('apps/server/src/api.ts', exclude)).toBe(false);
  });

  test("INF-06-AC8: the committed baseline includes the app's files", () => {
    const baseline = JSON.parse(readFileSync('coverage-baseline.json', 'utf8'));

    expect(
      Object.keys(baseline.files).filter((file) => file.startsWith('apps/mobile/src/')),
    ).not.toEqual([]);
  });
});

describe('pnpm run coverage:ratchet', () => {
  /**
   * Runs the ratchet in a folder holding only the summaries given. The folder
   * is not a git repository, so no file counts as changed and only the
   * summaries and the floors decide the answer.
   */
  function ratchet(summaries) {
    const dir = mkdtempSync(path.join(tmpdir(), 'coverage-ratchet-'));
    try {
      for (const [file, summary] of Object.entries(summaries)) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        const absolute = Object.fromEntries(
          Object.entries(summary).map(([key, value]) => [
            key.replace(/^\/repo\//, `${dir}/`),
            value,
          ]),
        );
        writeFileSync(path.join(dir, file), JSON.stringify(absolute));
      }
      const result = spawnSync(process.execPath, [path.resolve('scripts/coverage-ratchet.mjs')], {
        cwd: dir,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      });
      return { code: result.status, output: `${result.stdout}${result.stderr}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("INF-06-AC8: refuses to pass when the app's summary is missing, and names it", () => {
    const { code, output } = ratchet({ [VITEST_FILE]: VITEST_SUMMARY });

    expect(code).toBe(1);
    expect(output).toContain(JEST_FILE);
  });

  test("INF-06-AC8: refuses to pass when Vitest's summary is missing, and names it", () => {
    const { code, output } = ratchet({ [JEST_FILE]: JEST_SUMMARY });

    expect(code).toBe(1);
    expect(output).toContain(VITEST_FILE);
  });

  test('INF-06-AC8: with both summaries present and nothing below a floor, it passes', () => {
    const { code, output } = ratchet({ [VITEST_FILE]: VITEST_SUMMARY, [JEST_FILE]: JEST_SUMMARY });

    expect(code, output).toBe(0);
  });
});
