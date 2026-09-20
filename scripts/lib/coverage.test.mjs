// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// RG-04. The two questions are tested apart: has this change made things worse,
// and is safety code tested well enough to trust.
import { describe, expect, test } from 'vitest';
import { floorBreaches, linesAcross, ratchetDrops, summarize } from './coverage.mjs';

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
