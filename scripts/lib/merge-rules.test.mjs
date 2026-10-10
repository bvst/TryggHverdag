// CI-01. These tests are about one thing: the difference between "the merge
// rules are enforced" and "nobody could tell". A gate that reports the second as
// the first is worse than no gate, because it is believed.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { MUTATION_GROUPS, SAFETY_PATHS } from './gate-decisions.mjs';
import {
  CHECKS,
  OWNER_APPROVAL_PATHS,
  planChecks,
  reviewBypass,
  reviewCodeowners,
  reviewRuleset,
} from './merge-rules.mjs';

/** The scripts this repository has today, as package.json reports them. */
const SCRIPTS_TODAY = {
  'gate:static': 'x',
  'test:unit': 'x',
  'api:diff': 'x',
  'req:coverage': 'x',
  mutation: 'x',
  'licenses:check': 'x',
};

const rulesFor = (checks, overrides = {}) => [
  { type: 'deletion' },
  { type: 'non_fast_forward' },
  {
    type: 'pull_request',
    parameters: {
      require_code_owner_review: true,
      dismiss_stale_reviews_on_push: true,
      required_approving_review_count: 1,
      ...(overrides.pullRequest ?? {}),
    },
  },
  {
    type: 'required_status_checks',
    parameters: {
      strict_required_status_checks_policy: true,
      required_status_checks: checks.map((context) => ({ context })),
      ...(overrides.statusChecks ?? {}),
    },
  },
];

describe('planChecks', () => {
  test('a check whose script does not exist yet is not required, and says which task brings it', () => {
    const plan = planChecks(SCRIPTS_TODAY);

    expect(plan.required).not.toContain('integration');
    expect(plan.waiting).toContainEqual({
      check: 'integration',
      reason: 'no "test:integration" script yet — INF-05 adds it',
    });
  });

  test('every check whose script exists is required today', () => {
    const plan = planChecks(SCRIPTS_TODAY);

    expect(plan.required).toEqual([
      'gate-integrity',
      'static',
      'unit',
      'contract',
      'traceability',
      'mutation',
      'security',
      'ai-review (safety-reviewer)',
      'ai-review (privacy-security-reviewer)',
      'ai-review (test-auditor)',
    ]);
  });

  test('the advisory reviewers are never required (D-043)', () => {
    const plan = planChecks(SCRIPTS_TODAY);

    expect(plan.advisory).toEqual(['ai-review (code-reviewer)', 'ai-review (a11y-i18n-reviewer)']);
    expect(plan.required).not.toContain('ai-review (code-reviewer)');
  });

  test('a check becomes required the moment its script exists — nobody has to remember', () => {
    const plan = planChecks({ ...SCRIPTS_TODAY, 'test:integration': 'x', 'test:system': 'x' });

    expect(plan.required).toContain('integration');
    expect(plan.required).toContain('system');
    expect(plan.waiting.map((w) => w.check)).toEqual(['android-e2e']);
  });

  test('every check names the requirement it comes from', () => {
    for (const check of CHECKS) {
      expect(check.requirement).toMatch(/^CI-\d\d$/);
    }
  });
});

describe('reviewRuleset', () => {
  const required = ['static', 'unit'];

  test('a correctly configured ruleset has no problems', () => {
    expect(reviewRuleset({ branchRules: rulesFor(required), required })).toEqual([]);
  });

  test('no rules at all: main is unprotected, and that is the headline', () => {
    const problems = reviewRuleset({ branchRules: [], required });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.what).toContain('No rule protects main');
  });

  test('rules could not be read: refuses to pass (D-029)', () => {
    const problems = reviewRuleset({ branchRules: null, required });

    expect(problems[0]?.what).toContain('could not be read');
  });

  test('without the pull-request rule, anyone can push straight to main', () => {
    const branchRules = rulesFor(required).filter((rule) => rule.type !== 'pull_request');

    expect(reviewRuleset({ branchRules, required })[0]?.what).toContain('straight to main');
  });

  test('without the code-owner rule, safety paths merge without the owner (D-042)', () => {
    const branchRules = rulesFor(required, { pullRequest: { require_code_owner_review: false } });

    expect(reviewRuleset({ branchRules, required })[0]?.what).toContain(
      'Code owner review is not required',
    );
  });

  test('without dismissing stale reviews, an approval outlives the code it approved', () => {
    const branchRules = rulesFor(required, {
      pullRequest: { dismiss_stale_reviews_on_push: false },
    });

    expect(reviewRuleset({ branchRules, required })[0]?.what).toContain(
      'Stale approvals are not dismissed',
    );
  });

  test('code owner review with no approvals required is a rule that cannot bite', () => {
    // The combination that made CODEOWNERS decorative on this repository:
    // require_code_owner_review was on, so the gate reported it healthy, while
    // required_approving_review_count sat at 0 with dismiss-on-push on. Every
    // push erased the approvals and nothing required them back, so the rule
    // could never survive a push — #6 merged on owner-gated paths with no
    // approval standing at all.
    const branchRules = rulesFor(required, {
      pullRequest: { required_approving_review_count: 0 },
    });

    expect(reviewRuleset({ branchRules, required })[0]?.what).toContain(
      'No approval is required before merging',
    );
  });

  test('a ruleset that omits the approval count entirely is read as zero', () => {
    // GitHub omits the key rather than sending 0 in some ruleset shapes, and a
    // missing requirement is not a satisfied one. Without this the `?? 0`
    // fallback is untested, which is how the branch coverage on this file went
    // down and the traceability gate caught it.
    const branchRules = rulesFor(required);
    const pullRequest = branchRules.find((rule) => rule.type === 'pull_request');
    delete pullRequest.parameters.required_approving_review_count;

    expect(reviewRuleset({ branchRules, required })[0]?.what).toContain(
      'No approval is required before merging',
    );
  });

  test('with code-owner review off as well, both are reported and neither overstates', () => {
    // The report is the one thing here that has to be literally true. With
    // both switched off this branch fires beside the code-owner one, so its
    // wording may not assert that code-owner review is on — it never read it.
    const branchRules = rulesFor(required, {
      pullRequest: { require_code_owner_review: false, required_approving_review_count: 0 },
    });
    const problems = reviewRuleset({ branchRules, required });

    expect(problems.map((p) => p.what)).toEqual([
      expect.stringContaining('Code owner review is not required'),
      expect.stringContaining('No approval is required before merging'),
    ]);
    expect(problems[1]?.what).toContain('if it is on');
  });

  test('without the status-check rule, red checks do not stop a merge', () => {
    const branchRules = rulesFor(required).filter((rule) => rule.type !== 'required_status_checks');

    expect(reviewRuleset({ branchRules, required })[0]?.what).toContain('without the checks');
  });

  test('a required check that is missing from the rule is named, one problem each', () => {
    const problems = reviewRuleset({ branchRules: rulesFor(['static']), required });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.what).toContain('unit');
  });

  test('a required check that CI cannot run is a decoration, and is reported too', () => {
    const problems = reviewRuleset({ branchRules: rulesFor([...required, 'system']), required });

    expect(problems[0]?.what).toContain('system');
    expect(problems[0]?.fix).toContain('cannot run');
  });

  test('without the up-to-date policy, a green check can describe code that is no longer there', () => {
    const branchRules = rulesFor(required, {
      statusChecks: { strict_required_status_checks_policy: false },
    });

    expect(reviewRuleset({ branchRules, required })[0]?.what).toContain('up to date');
  });

  test('force pushes and deleting main are each their own problem', () => {
    const branchRules = rulesFor(required).filter(
      (rule) => rule.type !== 'deletion' && rule.type !== 'non_fast_forward',
    );
    const problems = reviewRuleset({ branchRules, required });

    expect(problems.map((p) => p.what).join(' ')).toContain('deleted');
    expect(problems.map((p) => p.what).join(' ')).toContain('Force pushes');
  });
});

describe('reviewBypass', () => {
  const clean = { enforcement: 'active', bypass_actors: [] };

  test('a ruleset nobody can bypass is what D-029 asks for', () => {
    expect(reviewBypass({ rulesets: [clean] })).toEqual([]);
  });

  test('any bypass actor is a hole, and the report names it', () => {
    const problems = reviewBypass({
      rulesets: [
        {
          enforcement: 'active',
          bypass_actors: [{ actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'always' }],
        },
      ],
    });

    expect(problems[0]?.what).toContain('RepositoryRole');
  });

  test('a second ruleset covering main is read too, not just the first', () => {
    // main can be covered by more than one ruleset. Checking only the first
    // would print a tick over a bypass entry sitting in the second.
    const problems = reviewBypass({
      rulesets: [
        clean,
        {
          enforcement: 'active',
          bypass_actors: [{ actor_type: 'OrganizationAdmin', bypass_mode: 'always' }],
        },
      ],
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.what).toContain('OrganizationAdmin');
  });

  test('a ruleset in evaluate mode reports, but does not block — so it is not enforcement', () => {
    const problems = reviewBypass({ rulesets: [{ enforcement: 'evaluate', bypass_actors: [] }] });

    expect(problems[0]?.what).toContain('not enforced');
  });

  test('unreadable bypass list: says so plainly instead of assuming the best', () => {
    const problems = reviewBypass({ rulesets: null });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.what).toContain('could not be checked');
    expect(problems[0]?.fix).toContain('RULES_READ_TOKEN');
  });

  test('a token that was rejected says so, rather than asking for one that is already there', () => {
    // The secret expires. Without this, the gate tells the owner to add a
    // secret they added a year ago, and they go looking in the wrong place.
    const problems = reviewBypass({ rulesets: null, status: 401 });

    expect(problems[0]?.what).toContain('401');
    expect(problems[0]?.fix).toContain('expired');
  });

  test('no ruleset yet: asks for the ruleset, not for a token that would not help', () => {
    const problems = reviewBypass({ rulesets: null, rulesExist: false });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.what).toContain('nothing to bypass');
    expect(problems[0]?.fix).not.toContain('RULES_READ_TOKEN');
  });
});

describe('reviewCodeowners', () => {
  const complete = OWNER_APPROVAL_PATHS.map((path) => `${path} @bvst`).join('\n');

  test('a file covering every path that needs the owner passes (D-042)', () => {
    expect(reviewCodeowners(complete)).toEqual([]);
  });

  test('a missing safety path is named', () => {
    const text = complete.replace('/apps/mobile/src/safety-core/ @bvst', '');

    expect(reviewCodeowners(text)[0]?.what).toContain('/apps/mobile/src/safety-core/');
  });

  test('a path listed with no owner approves nothing, and does not count', () => {
    const text = complete.replace('/infra/ @bvst', '/infra/');

    expect(reviewCodeowners(text)[0]?.what).toContain('/infra/');
  });

  test('a commented-out path does not count either', () => {
    const text = complete.replace('/.claude/ @bvst', '# /.claude/ @bvst');

    expect(reviewCodeowners(text)[0]?.what).toContain('/.claude/');
  });

  test('an empty or missing file is one loud problem, not nine', () => {
    expect(reviewCodeowners('')).toHaveLength(1);
    expect(reviewCodeowners(null)[0]?.what).toContain('No CODEOWNERS');
  });

  test('extra owners and extra paths are fine — the file may protect more than the minimum', () => {
    expect(reviewCodeowners(`${complete}\n/docs/dpia/ @bvst @someone-else\n`)).toEqual([]);
  });
});

// REL-10-AC18 (D-128): the staging canary is safety code, and is measured. A
// canary that reports ok without looking is the silent failure F8 names, so
// its module needs the owner, the safety review, a place among the safety
// paths and a mutation group of its own; its adapter, which holds the one
// insert of a device credential before the login task, needs the owner and
// the safety review. Step 1 (#76) gave both paths the owner and the review;
// the safety path, the group and the files themselves come with REL-10.
// Read from the repository itself, beside the merge rules' own lists.
describe('REL-10-AC18: the staging canary’s code needs the owner and the safety review, and is measured', () => {
  const MODULE = 'apps/server/src/modules/canary/';
  const ADAPTER = 'apps/server/src/adapters/canary.ts';

  test('REL-10-AC18: OWNER_APPROVAL_PATHS holds the canary’s module folder and its adapter', () => {
    expect(OWNER_APPROVAL_PATHS).toContain(`/${MODULE}`);
    expect(OWNER_APPROVAL_PATHS).toContain(`/${ADAPTER}`);
  });

  test('REL-10-AC18: .github/CODEOWNERS gives each a line naming @bvst and @urso-agent, and every path the owner must approve is owned', () => {
    const text = readFileSync('.github/CODEOWNERS', 'utf8');
    const owners = (path) =>
      text
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter(([pattern]) => pattern === path)
        .map(([, ...names]) => names.join(' '));

    expect(reviewCodeowners(text)).toEqual([]);
    expect(owners(`/${MODULE}`)).toEqual(['@bvst @urso-agent']);
    expect(owners(`/${ADAPTER}`)).toEqual(['@bvst @urso-agent']);
  });

  test('REL-10-AC18: the ai-review safety filter lists the module’s files and the adapter', () => {
    const workflow = readFileSync('.github/workflows/ai-review.yml', 'utf8');

    expect(workflow).toContain(`- '${MODULE}**'`);
    expect(workflow).toContain(`- '${ADAPTER}'`);
  });

  test('REL-10-AC18: the module is a safety path, mutated by a group of its own, canary, against canary.system.test.ts; the adapter is no safety path, proved at L3 and L2 and not mutated', () => {
    expect(SAFETY_PATHS).toContain(MODULE);
    expect(SAFETY_PATHS).not.toContain(ADAPTER);
    expect(MUTATION_GROUPS.filter((group) => group.paths.includes(MODULE))).toEqual([
      expect.objectContaining({
        name: 'canary',
        paths: [MODULE],
        tests: ['apps/server/src/canary.system.test.ts'],
      }),
    ]);
  });

  test('REL-10-AC18: git tracks both owned canary paths: the adapter, and at least one file under the module', () => {
    const tracked = (path) =>
      spawnSync('git', ['ls-files', '--', path], { encoding: 'utf8' })
        .stdout.split('\n')
        .filter((file) => file !== '');

    expect(tracked(ADAPTER)).toEqual([ADAPTER]);
    expect(tracked(MODULE).filter((file) => file.endsWith('.ts')).length).toBeGreaterThan(0);
  });
});
