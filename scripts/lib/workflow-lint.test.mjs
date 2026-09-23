// CI-01, second half: the workflow files themselves. Three ways a green tick
// can be a lie — an action that is whatever its author pushed this morning, a
// job that calls a script nobody wrote, and a check that no job produces.
import { describe, expect, test } from 'vitest';
import { findActionUses, findJobIds, findPnpmScripts, reviewWorkflows } from './workflow-lint.mjs';

const SHA = 'd23441a48e516b6c34aea4fa41551a30e30af803';

describe('findActionUses', () => {
  test('reads every action, pinned or not, with the line it is on', () => {
    const text = ['jobs:', '  a:', '    steps:', `      - uses: actions/checkout@${SHA}`].join(
      '\n',
    );

    expect(findActionUses(text)).toEqual([
      { line: 4, ref: `actions/checkout@${SHA}`, pinned: true },
    ]);
  });

  test('a version tag is not a pin: the code behind v4 can change tonight', () => {
    expect(findActionUses('      - uses: actions/checkout@v4')[0]?.pinned).toBe(false);
  });

  test('a branch is not a pin either', () => {
    expect(findActionUses('      - uses: some/action@main')[0]?.pinned).toBe(false);
  });

  test('a short SHA is not a pin, because it is not unambiguous forever', () => {
    expect(findActionUses('      - uses: some/action@d23441a')[0]?.pinned).toBe(false);
  });

  test('an action in this repository has nothing to pin', () => {
    expect(findActionUses('      - uses: ./.github/actions/setup')[0]?.pinned).toBe(true);
  });

  test('the trailing version comment is not mistaken for part of the reference', () => {
    expect(findActionUses(`      - uses: actions/checkout@${SHA} # v6.1.0`)[0]).toEqual({
      line: 1,
      ref: `actions/checkout@${SHA}`,
      pinned: true,
    });
  });

  test('a commented-out step is not an action', () => {
    expect(findActionUses('      # - uses: actions/checkout@v4')).toEqual([]);
  });
});

describe('findPnpmScripts', () => {
  test('finds the scripts a workflow runs, without duplicates', () => {
    const text = ['      - run: pnpm run gate:static', '      - run: pnpm run gate:static'].join(
      '\n',
    );

    expect(findPnpmScripts(text)).toEqual(['gate:static']);
  });

  test('reads a script that is given arguments', () => {
    expect(
      findPnpmScripts('      - run: pnpm run req:coverage -- --fail-on-uncovered-changed'),
    ).toEqual(['req:coverage']);
  });

  test("ignores pnpm's own commands, which are not our scripts", () => {
    expect(findPnpmScripts('      - run: pnpm install --frozen-lockfile')).toEqual([]);
  });
});

describe('findJobIds', () => {
  test('reads the job names, and only the top level of them', () => {
    const text = [
      'name: ci',
      'jobs:',
      '  static:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: pnpm run lint',
      '  unit:',
      '    runs-on: ubuntu-latest',
    ].join('\n');

    expect(findJobIds(text)).toEqual(['static', 'unit']);
  });

  test('a job whose line carries a trailing comment is still a job', () => {
    const text = [
      'jobs:',
      '  gate-integrity: # CI-01: the merge rules are real',
      '    steps: []',
    ].join('\n');

    expect(findJobIds(text)).toEqual(['gate-integrity']);
  });

  test('a key before "jobs:" is not a job', () => {
    const text = ['on:', '  pull_request:', 'jobs:', '  static:'].join('\n');

    expect(findJobIds(text)).toEqual(['static']);
  });
});

describe('reviewWorkflows', () => {
  const scripts = { 'gate:static': 'x', 'test:unit': 'x' };
  const ci = {
    path: '.github/workflows/ci.yml',
    text: [
      'jobs:',
      '  static:',
      '    steps:',
      `      - uses: actions/checkout@${SHA}`,
      '      - run: pnpm run gate:static',
      '  unit:',
      '    steps:',
      '      - run: pnpm run test:unit',
    ].join('\n'),
  };
  const review = (files, required) => reviewWorkflows({ files, scripts, required });

  test('a workflow that pins its actions and calls scripts that exist is clean', () => {
    expect(review([ci], ['static', 'unit'])).toEqual([]);
  });

  test('an unpinned action is named with its file and line', () => {
    const files = [{ ...ci, text: ci.text.replace(`@${SHA}`, '@v6') }];
    const problems = review(files, ['static', 'unit']);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.what).toContain('.github/workflows/ci.yml:4');
    expect(problems[0]?.what).toContain('actions/checkout@v6');
  });

  test('a job calling a script that does not exist would fail with a confusing error', () => {
    const files = [{ ...ci, text: ci.text.replace('pnpm run test:unit', 'pnpm run test:sytem') }];

    expect(review(files, ['static', 'unit'])[0]?.what).toContain('test:sytem');
  });

  test('a required check that no job produces is named (CI-01)', () => {
    expect(review([ci], ['static', 'unit', 'security'])[0]?.what).toContain('security');
  });

  test('a matrix reviewer counts as produced when the workflow names the agent', () => {
    const aiReview = {
      path: '.github/workflows/ai-review.yml',
      text: [
        'jobs:',
        '  review:',
        '    strategy:',
        '      matrix:',
        '        include:',
        '          - { agent: test-auditor }',
      ].join('\n'),
    };

    expect(review([ci, aiReview], ['static', 'unit', 'ai-review (test-auditor)'])).toEqual([]);
  });

  test('a missing reviewer is named by the check it should have produced', () => {
    const problems = review([ci], ['static', 'ai-review (safety-reviewer)']);

    expect(problems[0]?.what).toContain('ai-review (safety-reviewer)');
  });

  test('a job in ci.yml that no check requires runs for nobody, and is reported', () => {
    const files = [{ ...ci, text: `${ci.text}\n  leftover:\n    steps:\n      - run: echo hi` }];

    expect(review(files, ['static', 'unit'])[0]?.what).toContain('leftover');
  });

  test('no workflow files at all is one problem, not silence', () => {
    expect(review([], ['static'])[0]?.what).toContain('No workflow files');
  });
});
