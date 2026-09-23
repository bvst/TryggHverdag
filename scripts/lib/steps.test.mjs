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

describe('planSteps and the environment', () => {
  const step = {
    name: 'merge rules',
    command: ['pnpm', 'run', 'gate:integrity'],
    needsScript: 'gate:integrity',
    needsEnv: ['GITHUB_TOKEN'],
    envReason: 'owner to-do A-15',
  };
  const scripts = { 'gate:integrity': 'x' };

  test('a step whose environment variable is missing is skipped, with the reason', () => {
    const [planned] = planSteps([step], scripts, {});

    expect(planned?.willRun).toBe(false);
    expect(planned?.reason).toContain('GITHUB_TOKEN');
    expect(planned?.reason).toContain('owner to-do A-15');
  });

  test('the same step runs once the variable is there', () => {
    expect(planSteps([step], scripts, { GITHUB_TOKEN: 'x' })[0]?.willRun).toBe(true);
  });

  test('a step with no advice still says which variable is missing', () => {
    const bare = { ...step, envReason: undefined };

    expect(planSteps([bare], scripts, {})[0]?.reason).toBe('needs GITHUB_TOKEN');
  });

  test('a variable set to the empty string counts as missing, as CI leaves it', () => {
    expect(planSteps([step], scripts, { GITHUB_TOKEN: '' })[0]?.willRun).toBe(false);
  });

  test('a step needing a tool this machine does not have is skipped, with the reason', () => {
    // Without this, gate:full on a laptop with no Docker daemon fails with
    // "Could not find a working container runtime strategy" — which reads as
    // "your code is broken" rather than "this machine cannot run this level".
    const containerStep = {
      name: 'integration tests',
      command: ['pnpm', 'run', 'test:integration'],
      needsScript: 'gate:integrity',
      needsTool: 'docker',
      toolReason: 'a real PostgreSQL runs in a container',
    };

    const [planned] = planSteps([containerStep], scripts, {}, { docker: false });

    expect(planned?.willRun).toBe(false);
    expect(planned?.reason).toContain('docker');
    expect(planned?.reason).toContain('a real PostgreSQL runs in a container');
  });

  test('the same step runs where the tool is there', () => {
    const containerStep = {
      name: 'integration tests',
      command: ['x'],
      needsScript: 'gate:integrity',
      needsTool: 'docker',
    };

    expect(planSteps([containerStep], scripts, {}, { docker: true })[0]?.willRun).toBe(true);
  });

  test('a tool-needing step with no reason still says which tool is missing', () => {
    const [planned] = planSteps(
      [{ name: 'x', command: ['x'], needsScript: 'gate:integrity', needsTool: 'docker' }],
      scripts,
      {},
      { docker: false },
    );

    expect(planned?.reason).toBe('needs docker, which is not working on this machine');
  });

  test('a missing script is reported before a missing tool, because it is the bigger problem', () => {
    const [planned] = planSteps(
      [{ name: 'x', command: ['x'], needsScript: 'nope', needsTool: 'docker' }],
      scripts,
      {},
      { docker: false },
    );

    expect(planned?.reason).toContain('no "nope" script yet');
  });

  test('a step that needs no environment runs whatever the environment holds', () => {
    const plain = { name: 'x', command: ['x'], needsScript: 'gate:integrity' };

    expect(planSteps([plain], scripts, {})[0]?.willRun).toBe(true);
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

  test('a gate in which nothing ran at all has not passed', () => {
    // Every step skipped looks identical to every step passing, in the one
    // number a person reads. A typo in a needsScript value, or a package.json
    // that could not be read, would otherwise produce a silent green gate.
    const results = [
      { name: 'static checks', status: 'skipped', detail: 'no script' },
      { name: 'unit tests', status: 'skipped', detail: 'no script' },
    ];
    const summary = summarize(results, 'gate:quick');

    expect(summary.ok).toBe(false);
    expect(summary.text).toContain('nothing ran');
  });

  test('a failure shows its output and fails the gate', () => {
    const results = [{ name: 'unit tests', status: 'failed', detail: '2 tests failed' }];
    const summary = summarize(results, 'gate:quick');
    expect(summary.ok).toBe(false);
    expect(summary.text).toContain('2 tests failed');
  });
});
