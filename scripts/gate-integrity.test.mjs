// CI-01, the part a person reads. A gate that finds a problem and then buries
// it in output nobody scrolls to has not really found anything.
import { describe, expect, test } from 'vitest';
import { renderReport, repoSlug, sectionsFor } from './gate-integrity.mjs';

describe('sectionsFor', () => {
  const plan = { required: ['static'], waiting: [], advisory: [] };
  const base = {
    plan,
    workflowProblems: [],
    codeownersText: null,
    slug: { owner: 'bvst', repo: 'TryggHverdag' },
    branchRules: [],
    ruleset: null,
  };
  const section = (sections, needle) =>
    sections.find((s) => s.title.includes(needle)) ?? { problems: [], notes: [] };

  test('rules that were read and found empty say the ruleset is missing', () => {
    const problems = section(sectionsFor(base), 'bypass').problems;

    expect(problems[0]?.what).toContain('nothing to bypass');
  });

  test('rules that could NOT be read never claim the ruleset is missing', () => {
    // The distinction the whole gate turns on: null is "unknown", not "none".
    const problems = section(sectionsFor({ ...base, branchRules: null }), 'bypass').problems;

    expect(problems[0]?.what).toContain('could not be checked');
    expect(problems[0]?.what).not.toContain('nothing to bypass');
  });

  test('rules present but the bypass list unreadable asks for the token', () => {
    const sections = sectionsFor({ ...base, branchRules: [{ type: 'deletion' }] });

    expect(section(sections, 'bypass').problems[0]?.fix).toContain('RULES_READ_TOKEN');
  });

  test('not knowing which repository this is does not quietly pass the rules', () => {
    const sections = sectionsFor({ ...base, slug: null });

    expect(sections.some((s) => s.problems.length > 0)).toBe(true);
    expect(sections.every((s) => !s.title.includes('bypass'))).toBe(true);
  });

  test('the checks waiting for a later task are notes, not failures', () => {
    const sections = sectionsFor({
      ...base,
      plan: {
        required: ['static'],
        waiting: [{ check: 'system', reason: 'no script yet' }],
        advisory: ['ai-review (code-reviewer)'],
      },
    });
    const checks = section(sections, 'required today');

    expect(checks.problems).toEqual([]);
    expect(checks.notes?.join(' ')).toContain('system');
    expect(checks.notes?.join(' ')).toContain('ai-review (code-reviewer)');
  });
});

describe('repoSlug', () => {
  test('uses what the CI runner already knows', () => {
    expect(repoSlug({ env: { GITHUB_REPOSITORY: 'bvst/TryggHverdag' }, remoteUrl: null })).toEqual({
      owner: 'bvst',
      repo: 'TryggHverdag',
    });
  });

  test.each([
    'https://github.com/bvst/TryggHverdag',
    'https://github.com/bvst/TryggHverdag.git',
    'git@github.com:bvst/TryggHverdag.git',
    'ssh://git@github.com/bvst/TryggHverdag.git',
  ])('falls back to the git remote: %s', (remoteUrl) => {
    expect(repoSlug({ env: {}, remoteUrl })).toEqual({ owner: 'bvst', repo: 'TryggHverdag' });
  });

  test('a remote that is not GitHub is not guessed at', () => {
    expect(repoSlug({ env: {}, remoteUrl: 'https://gitlab.com/bvst/TryggHverdag' })).toBe(null);
  });

  test('nothing to go on returns null rather than a plausible-looking guess', () => {
    expect(repoSlug({ env: {}, remoteUrl: null })).toBe(null);
  });
});

describe('renderReport', () => {
  const clean = [{ title: 'CODEOWNERS', problems: [] }];

  test('everything clean passes, and says what it checked', () => {
    const report = renderReport(clean);

    expect(report.ok).toBe(true);
    expect(report.text).toContain('CODEOWNERS');
    expect(report.text).toContain('1 of 1');
  });

  test('one problem fails the whole gate', () => {
    const report = renderReport([
      ...clean,
      {
        title: "main's merge rules",
        problems: [{ what: 'main can be deleted.', fix: 'Switch on "Restrict deletions".' }],
      },
    ]);

    expect(report.ok).toBe(false);
    expect(report.text).toContain('main can be deleted.');
  });

  test('every problem carries the fix, because the person reading it has to act', () => {
    const report = renderReport([
      {
        title: 'x',
        problems: [
          { what: 'a', fix: 'do b' },
          { what: 'c', fix: 'do d' },
        ],
      },
    ]);

    expect(report.text).toContain('do b');
    expect(report.text).toContain('do d');
  });

  test('notes are shown but never fail the gate', () => {
    const report = renderReport([
      { title: 'checks', problems: [], notes: ['integration — no "test:integration" script yet'] },
    ]);

    expect(report.ok).toBe(true);
    expect(report.text).toContain('no "test:integration" script yet');
  });

  test('a section with no problems still appears, so "checked" and "not checked" look different', () => {
    expect(renderReport(clean).text).toContain('✓');
  });
});
