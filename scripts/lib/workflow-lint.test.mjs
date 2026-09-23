// CI-01, second half: the workflow files themselves. Three ways a green tick
// can be a lie — an action that is whatever its author pushed this morning, a
// job that calls a script nobody wrote, and a check that no job produces.
import { describe, expect, test } from 'vitest';
import {
  findActionUses,
  findJobIds,
  findPnpmScripts,
  findUnboundedJobs,
  findUngroupedEcosystems,
  reviewWorkflows,
} from './workflow-lint.mjs';

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

describe('findUnboundedJobs', () => {
  test('a job with no timeout is named', () => {
    const text = ['jobs:', '  a:', '    runs-on: ubuntu-latest'].join('\n');

    expect(findUnboundedJobs(text)).toEqual(['a']);
  });

  test('a job with a timeout is not', () => {
    const text = ['jobs:', '  a:', '    runs-on: ubuntu-latest', '    timeout-minutes: 10'].join(
      '\n',
    );

    expect(findUnboundedJobs(text)).toEqual([]);
  });

  test("a step's own timeout does not count as the job's", () => {
    // The one way this check could pass while the job is still unbounded. Step
    // keys sit at eight spaces under `      - `; job keys sit at four. Reading
    // the indentation is what tells them apart, so the wrong one has to fail
    // here or the whole check is decorative.
    const text = [
      'jobs:',
      '  a:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - name: slow',
      '        timeout-minutes: 5',
    ].join('\n');

    expect(findUnboundedJobs(text)).toEqual(['a']);
  });

  test('every job is judged, not just the first', () => {
    const text = [
      'jobs:',
      '  a:',
      '    timeout-minutes: 10',
      '  b:',
      '    runs-on: ubuntu-latest',
      '  c:',
      '    timeout-minutes: 5',
    ].join('\n');

    expect(findUnboundedJobs(text)).toEqual(['b']);
  });

  test('a commented-out timeout bounds nothing', () => {
    const text = ['jobs:', '  a:', '    # timeout-minutes: 10'].join('\n');

    expect(findUnboundedJobs(text)).toEqual(['a']);
  });

  test('keys after the jobs block are not mistaken for jobs', () => {
    const text = ['jobs:', '  a:', '    timeout-minutes: 10', 'concurrency:', '  group: x'].join(
      '\n',
    );

    expect(findUnboundedJobs(text)).toEqual([]);
  });
});

describe('findUngroupedEcosystems', () => {
  const grouped = (eco) =>
    [
      `  - package-ecosystem: ${eco}`,
      '    directory: /',
      '    groups:',
      '      non-major:',
      '        patterns:',
      "          - '*'",
      '        update-types:',
      '          - minor',
      '          - patch',
    ].join('\n');

  test('an ecosystem that groups every non-major update passes', () => {
    expect(findUngroupedEcosystems(`updates:\n${grouped('npm')}`)).toEqual([]);
  });

  test('an ecosystem with no groups at all is named', () => {
    const text = ['updates:', '  - package-ecosystem: github-actions', '    directory: /'].join(
      '\n',
    );

    expect(findUngroupedEcosystems(text)).toEqual(['github-actions']);
  });

  test('a group that names only some packages does not cover the ecosystem', () => {
    // The shape this replaced: a `dev-tooling` group listing eslint, vitest and
    // friends, which left every runtime dependency arriving on its own. That is
    // most of the churn, and exactly the part the grouping is for.
    const text = [
      'updates:',
      '  - package-ecosystem: npm',
      '    groups:',
      '      dev-tooling:',
      '        patterns:',
      "          - 'eslint*'",
      '        update-types:',
      '          - minor',
      '          - patch',
    ].join('\n');

    expect(findUngroupedEcosystems(text)).toEqual(['npm']);
  });

  test('a group covering everything but only patch leaves minors loose', () => {
    const text = [
      'updates:',
      '  - package-ecosystem: npm',
      '    groups:',
      '      patches:',
      '        patterns:',
      "          - '*'",
      '        update-types:',
      '          - patch',
    ].join('\n');

    expect(findUngroupedEcosystems(text)).toEqual(['npm']);
  });

  test('every ecosystem is judged, not just the first', () => {
    const text = [
      'updates:',
      grouped('npm'),
      '  - package-ecosystem: github-actions',
      '    directory: /',
    ].join('\n');

    expect(findUngroupedEcosystems(text)).toEqual(['github-actions']);
  });

  test('two groups that each cover half do not add up to coverage', () => {
    // code-reviewer found this on #11, and it is the exact failure this
    // function exists to catch: flags were tracked per ECOSYSTEM, so a group
    // taking '*' for majors and a separate group taking minor+patch for
    // eslint* looked, added together, like full coverage. Neither group alone
    // catches every non-major update, which is the thing being asserted.
    const text = [
      'updates:',
      '  - package-ecosystem: npm',
      '    groups:',
      '      majors:',
      '        patterns:',
      "          - '*'",
      '        update-types:',
      '          - major',
      '      tooling:',
      '        patterns:',
      "          - 'eslint*'",
      '        update-types:',
      '          - minor',
      '          - patch',
    ].join('\n');

    expect(findUngroupedEcosystems(text)).toEqual(['npm']);
  });

  test('a group that sweeps majors in too is not the policy', () => {
    // Majors are deliberately ungrouped: a major is where behaviour may change
    // and is the one that earns a whole reading. A group taking '*' for all
    // three update types is not "covered", it is the policy inverted.
    const text = [
      'updates:',
      '  - package-ecosystem: npm',
      '    groups:',
      '      everything:',
      '        patterns:',
      "          - '*'",
      '        update-types:',
      '          - minor',
      '          - patch',
      '          - major',
    ].join('\n');

    expect(findUngroupedEcosystems(text)).toEqual(['npm']);
  });

  test('a double-quoted wildcard counts, because YAML does not care', () => {
    const text = [
      'updates:',
      '  - package-ecosystem: npm',
      '    groups:',
      '      non-major:',
      '        patterns:',
      '          - "*"',
      '        update-types:',
      '          - minor',
      '          - patch',
    ].join('\n');

    expect(findUngroupedEcosystems(text)).toEqual([]);
  });

  test('quoted update-types count, as the quoted wildcard already did', () => {
    // code-reviewer hand-verified this on #11: the wildcard tolerated both
    // quote styles while minor/patch/major accepted unquoted scalars only, so
    // a quoted `- 'minor'` read as absent. It failed loud rather than silent —
    // an over-strict red gate — but an inconsistency in what counts as the
    // same value is a trap either way.
    const text = [
      'updates:',
      '  - package-ecosystem: npm',
      '    groups:',
      '      non-major:',
      '        patterns:',
      "          - '*'",
      '        update-types:',
      "          - 'minor'",
      '          - "patch"',
    ].join('\n');

    expect(findUngroupedEcosystems(text)).toEqual([]);
  });

  test('a quoted major is still a major', () => {
    const text = [
      'updates:',
      '  - package-ecosystem: npm',
      '    groups:',
      '      everything:',
      '        patterns:',
      '          - "*"',
      '        update-types:',
      "          - 'minor'",
      "          - 'patch'",
      "          - 'major'",
    ].join('\n');

    expect(findUngroupedEcosystems(text)).toEqual(['npm']);
  });

  test('a key at group depth outside the groups block is not a group', () => {
    // `commit-message:` has `prefix:` at the same indentation a group name
    // sits at. Reading that as a group would silently split the real one.
    const text = [
      'updates:',
      '  - package-ecosystem: npm',
      '    commit-message:',
      "      prefix: 'chore(deps)'",
      '    groups:',
      '      non-major:',
      '        patterns:',
      "          - '*'",
      '        update-types:',
      '          - minor',
      '          - patch',
    ].join('\n');

    expect(findUngroupedEcosystems(text)).toEqual([]);
  });

  test('a commented-out group covers nothing', () => {
    const text = [
      'updates:',
      '  - package-ecosystem: npm',
      '    # groups:',
      "    #   non-major: { patterns: ['*'], update-types: [minor, patch] }",
    ].join('\n');

    expect(findUngroupedEcosystems(text)).toEqual(['npm']);
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
