// The runner behind gate:quick and gate:full. The case worth guarding is the
// one that looks harmless: a step that cannot run must never read as a pass.
import { describe, expect, test } from 'vitest';
import { planSteps, runPlan, summarize } from './steps.mjs';

const STEPS = [
  { name: 'static checks', command: ['pnpm', 'run', 'gate:static'], needsScript: 'gate:static' },
  {
    name: 'integration tests',
    command: ['pnpm', 'run', 'test:integration'],
    needsScript: 'test:integration',
    arrivesIn: 'INF-05',
  },
];

describe('planSteps', () => {
  test('runs what exists and skips what does not, saying what will bring it', () => {
    const plan = planSteps(STEPS, { 'gate:static': 'echo' });
    expect(plan[0]?.willRun).toBe(true);
    expect(plan[1]?.willRun).toBe(false);
    expect(plan[1]?.reason).toContain('INF-05');
  });

  test('a step with no script requirement always runs', () => {
    const plan = planSteps([{ name: 'always', command: ['true'] }], {});
    expect(plan[0]?.willRun).toBe(true);
  });
});

describe('runPlan', () => {
  test('stops at the first failure, because later output is noise', () => {
    const plan = planSteps(
      [
        { name: 'one', command: ['one'] },
        { name: 'two', command: ['two'] },
        { name: 'three', command: ['three'] },
      ],
      {},
    );
    const results = runPlan(plan, (command) => ({ ok: command[0] !== 'two', output: command[0] }));
    expect(results.map((result) => result.status)).toEqual(['passed', 'failed']);
  });

  test('skipped steps do not stop the run', () => {
    const plan = planSteps(STEPS, {});
    const results = runPlan(plan, () => ({ ok: true, output: '' }));
    expect(results.map((result) => result.status)).toEqual(['skipped', 'skipped']);
  });
});

describe('summarize', () => {
  test('a skipped step is counted as "not possible yet", never as passed', () => {
    const results = [
      { name: 'static checks', status: 'passed', detail: '' },
      {
        name: 'integration tests',
        status: 'skipped',
        detail: 'no "test:integration" script yet — INF-05 adds it',
      },
    ];
    const summary = summarize(results, 'gate:full');
    expect(summary.ok).toBe(true);
    expect(summary.text).toContain('1 passed, 0 failed, 1 not possible yet');
    expect(summary.text).toContain('INF-05 adds it');
  });

  test('a failure shows its output and fails the gate', () => {
    const results = [{ name: 'unit tests', status: 'failed', detail: '2 tests failed' }];
    const summary = summarize(results, 'gate:quick');
    expect(summary.ok).toBe(false);
    expect(summary.text).toContain('2 tests failed');
  });
});
