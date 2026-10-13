// CI-01, the part a person reads. A gate that finds a problem and then buries
// it in output nobody scrolls to has not really found anything.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  combineRulesetAnswers,
  renderReport,
  repoSlug,
  rulesReadToken,
  rulesetIdsOf,
  sectionsFor,
} from './gate-integrity.mjs';
import { OWNER_APPROVAL_PATHS } from './lib/merge-rules.mjs';

describe('sectionsFor', () => {
  const plan = { required: ['static'], waiting: [], advisory: [] };
  const base = {
    plan,
    workflowProblems: [],
    // A complete CODEOWNERS, so that a section under test is the only thing
    // that can contribute a problem. With this left null, every assertion of
    // the form "some section has a problem" passes no matter what the section
    // under test does.
    codeownersText: OWNER_APPROVAL_PATHS.map((path) => `${path} @bvst`).join('\n'),
    slug: { owner: 'bvst', repo: 'TryggHverdag' },
    branchRules: [],
    rulesets: null,
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

    expect(section(sections, "main's merge rules").problems[0]?.what).toContain(
      'Could not tell which GitHub repository this is',
    );
    expect(sections.every((s) => !s.title.includes('bypass'))).toBe(true);
  });

  test('the checks required today are named, not just counted', () => {
    // The owner copies these into the repository settings. A count would mean
    // copying them out of a hand-maintained table instead, which is the one
    // copy nothing verifies.
    const notes = section(sectionsFor(base), 'required today').notes ?? [];

    expect(notes).toContain('static — required today');
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

describe('rulesReadToken', () => {
  // GitHub answers `X-Accepted-Github-Permissions: metadata=read` for the
  // ruleset endpoints, and the Actions token always has metadata read — so no
  // second secret is normally needed. RULES_READ_TOKEN stays as the way out if
  // that ever stops being true.
  test('the ordinary CI token is enough, so no extra secret is asked for', () => {
    expect(rulesReadToken({ GITHUB_TOKEN: 'ci' })).toBe('ci');
  });

  test('a token added on purpose wins, because it was added to fix something', () => {
    expect(rulesReadToken({ GITHUB_TOKEN: 'ci', RULES_READ_TOKEN: 'narrow' })).toBe('narrow');
  });

  test('an empty secret is not a token — CI sets unset secrets to the empty string', () => {
    expect(rulesReadToken({ GITHUB_TOKEN: 'ci', RULES_READ_TOKEN: '' })).toBe('ci');
  });

  test('nothing at all is undefined, and the caller reports that it could not check', () => {
    expect(rulesReadToken({})).toBe(undefined);
  });
});

describe('rulesetIdsOf', () => {
  test('every distinct ruleset covering the branch, not just the first', () => {
    const rules = [
      { type: 'deletion', ruleset_id: 1 },
      { type: 'pull_request', ruleset_id: 1 },
      { type: 'non_fast_forward', ruleset_id: 2 },
    ];

    expect(rulesetIdsOf(rules)).toEqual([1, 2]);
  });

  test('rules that name no ruleset contribute nothing', () => {
    expect(rulesetIdsOf([{ type: 'deletion' }])).toEqual([]);
  });

  test('rules that could not be read are no ids, not an error', () => {
    expect(rulesetIdsOf(null)).toEqual([]);
  });
});

describe('combineRulesetAnswers', () => {
  const ok = (body) => ({ body, status: 200 });

  test('all readable: the rulesets, and no status to complain about', () => {
    expect(combineRulesetAnswers([ok({ id: 1 }), ok({ id: 2 })])).toEqual({
      rulesets: [{ id: 1 }, { id: 2 }],
      status: null,
    });
  });

  test('one unreadable makes the whole answer unknown, never a partial pass', () => {
    // Reporting the two that were readable as "nobody can bypass" would be a
    // tick over a ruleset nobody saw.
    expect(combineRulesetAnswers([ok({ id: 1 }), { body: null, status: 404 }])).toEqual({
      rulesets: null,
      status: 404,
    });
  });

  test('a rejected token surfaces its status, so the message can name it', () => {
    expect(combineRulesetAnswers([{ body: null, status: 401 }]).status).toBe(401);
  });

  test('no token at all has no status to report', () => {
    expect(combineRulesetAnswers([{ body: null, status: null }])).toEqual({
      rulesets: null,
      status: null,
    });
  });

  test('nothing to ask about is unknown, not an empty pass', () => {
    expect(combineRulesetAnswers([])).toEqual({ rulesets: null, status: null });
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

describe('BUG-45: gate:integrity reads the fan-out from fanOutOf, which is tested, not from code of its own (AC10, review loop 1)', () => {
  // test-auditor B1: main() built the map of required checks to the jobs they
  // fan out into inline, where no test reached it in-process. fanOutOf, in
  // scripts/lib/merge-rules.mjs, is the one place that map is built, and its
  // tests are in merge-rules.test.mjs; that main() hands reviewWorkflows a map
  // the real workflows pass with is held, end to end, by the BUG-45-AC10 test
  // in gate.test.mjs that runs this script on a copy of them. This holds the
  // rest: main() calls the helper, and reads no check's fanOut itself.
  const code = readFileSync(new URL('./gate-integrity.mjs', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\/?\*)/.test(line))
    .join('\n');

  test('BUG-45-AC10: gate-integrity.mjs imports fanOutOf from merge-rules.mjs and calls it on CHECKS', () => {
    const imported = /import\s*\{([^}]*)\}\s*from\s*'\.\/lib\/merge-rules\.mjs'/.exec(code)?.[1];

    expect(imported, 'the import from ./lib/merge-rules.mjs').toBeDefined();
    expect(imported).toMatch(/\bfanOutOf\b/);
    expect(
      /\bfanOutOf\(\s*CHECKS\s*\)/.test(code),
      'gate-integrity.mjs calls fanOutOf(CHECKS)',
    ).toBe(true);
  });

  test('BUG-45-AC10: gate-integrity.mjs reads no check’s fanOut itself', () => {
    const reading = code
      .split('\n')
      .filter((line) => /\.fanOut\b|\[\s*['"`]fanOut['"`]\s*\]/.test(line))
      .map((line) => line.trim());

    expect(reading, 'lines of gate-integrity.mjs that read a fanOut').toEqual([]);
  });
});
