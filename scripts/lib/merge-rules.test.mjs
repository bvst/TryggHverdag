// CI-01. These tests are about one thing: the difference between "the merge
// rules are enforced" and "nobody could tell". A gate that reports the second as
// the first is worse than no gate, because it is believed.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { MUTATION_GROUPS, SAFETY_PATHS, decideMutation, mutationRuns } from './gate-decisions.mjs';
import {
  CHECKS,
  OWNER_APPROVAL_PATHS,
  fanOutOf,
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

// CALL-01-AC9 (D-141 item 7, the owner's answer to Q7): the call button's code,
// apps/mobile/src/features/call/, places a phone call to the walker's #1, so it
// needs the owner and the safety review. Step 1 gives the folder a line in
// .github/CODEOWNERS, an entry in OWNER_APPROVAL_PATHS and an entry in the
// ai-review safety filter, before task 2 creates it (D-075). It is no D-139
// named exception, no safety path and no mutation group: the app's mutation
// testing comes with the safety core in task 3 (D-134), which is for that task
// to consider. The folder does not exist yet, so the pin that git tracks a
// file under it, as REL-10-AC18's last test does for the canary, comes with
// task 2's own tests. Read from the repository itself, beside the canary's.
describe('CALL-01-AC9: features/call/ needs the owner and the safety review (step 1, D-141)', () => {
  const CALL = 'apps/mobile/src/features/call/';

  test('CALL-01-AC9: OWNER_APPROVAL_PATHS holds /apps/mobile/src/features/call/', () => {
    expect(OWNER_APPROVAL_PATHS).toContain(`/${CALL}`);
  });

  test('CALL-01-AC9: .github/CODEOWNERS gives the folder exactly one line, naming @bvst and @urso-agent, and every path the owner must approve is owned', () => {
    const text = readFileSync('.github/CODEOWNERS', 'utf8');
    const owners = (path) =>
      text
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter(([pattern]) => pattern === path)
        .map(([, ...names]) => names.join(' '));

    expect(reviewCodeowners(text)).toEqual([]);
    expect(owners(`/${CALL}`)).toEqual(['@bvst @urso-agent']);
  });

  test('CALL-01-AC9: the ai-review safety filter lists the folder’s files', () => {
    const workflow = readFileSync('.github/workflows/ai-review.yml', 'utf8');

    expect(workflow).toContain(`- '${CALL}**'`);
  });

  test('CALL-01-AC9: the folder is no safety path and no mutation group lists it, as D-141 decided for step 1', () => {
    // A guard, not a red test: it passes before step 1's code as after it, by
    // design. It pins what step 1 must not do (D-141 item 7: "It is not a
    // mutation path"), so that putting features/call/ among the safety paths
    // or in a mutation group, as task 3 may later decide, shows itself as a
    // change to this test with its own reason (RG-03). A safety path or a
    // group path that is the folder, or a folder above it, would make it one.
    // RG-03 (test-auditor's note 1 on step 1): so would a file or a folder
    // inside it, such as 'apps/mobile/src/features/call/phone.ts', which the
    // check read one way only, CALL.startsWith(path), let through with every
    // test green. It reads both ways now; it is no looser for the folder or a
    // folder above it.
    const covers = (path) => CALL.startsWith(path) || path.startsWith(CALL);

    expect(SAFETY_PATHS).not.toContain(CALL);
    expect(SAFETY_PATHS.filter(covers)).toEqual([]);
    expect(
      MUTATION_GROUPS.filter((group) => group.paths.some(covers)).map((group) => group.name),
    ).toEqual([]);
  });

  // Task 2's part of CALL-01-AC9 (CALL-01.md, "What step 1 cannot pin"): the
  // folder did not exist when step 1's lines were written, so a misspelt line
  // or filter entry matched nothing and showed nothing. Once task 2 creates
  // it, git tracks code under it, and scripts/gate.test.mjs holds every such
  // file to its owners and the filter. Test files do not count as the code it
  // holds (D-141: the pin "is what shows the folder holds code"): task 2's own
  // tests sit in the folder before its code does.
  test('CALL-01-AC9: git tracks at least one .ts or .tsx file under apps/mobile/src/features/call/ that is code, not a test (task 2)', () => {
    const listed = spawnSync('git', ['ls-files', '--', CALL], { encoding: 'utf8' });

    expect(listed.status, listed.stderr).toBe(0);
    expect(
      listed.stdout
        .split('\n')
        .filter((file) => /\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file)).length,
      `${CALL} holds no .ts or .tsx file git tracks but tests`,
    ).toBeGreaterThan(0);
  });
});

/** Every non-test .ts and .tsx file git tracks under apps/mobile/src/, with its text. */
function trackedAppSources() {
  const listed = spawnSync('git', ['ls-files', '--', 'apps/mobile/src/'], { encoding: 'utf8' });
  return listed.stdout
    .split('\n')
    .filter((file) => /\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file))
    .map((file) => ({ file, text: readFileSync(file, 'utf8') }));
}

/** The files that define a component named `name`: a function, a class, or a const or let given one. */
function definersOf(name) {
  const defines = new RegExp(
    `(^|\\n)\\s*(export\\s+)?(default\\s+)?(function\\s+${name}\\b|class\\s+${name}\\b|(const|let|var)\\s+${name}\\s*[=:])`,
  );
  return trackedAppSources()
    .filter(({ text }) => defines.test(text))
    .map(({ file }) => file);
}

// CALL-02-AC10 (D-141 item 7, as the owner amended it on 2026-10-22: "Ja, hele
// shared/ui/"): Screen, in apps/mobile/src/shared/ui/, draws the 112 bar on
// every screen (CALL-02, approach 1), so a change there could drop 112 from
// every screen at once. safety-reviewer found the folder had no owner and no
// safety review. Step 1 gives the whole folder a line in .github/CODEOWNERS,
// an entry in OWNER_APPROVAL_PATHS and an entry in the ai-review safety
// filter, as it does for features/call/ above, before task 2 creates it by
// moving the UI kit there from features/grp/ui.tsx. It is no D-139 named
// exception, no safety path and no mutation group. Only ui/ is new:
// apps/mobile/src/shared/ itself stays unowned, and its two owned files keep
// their own lines (scripts/gate.test.mjs pins a file outside ui/). The pin
// that git tracks a file under the folder comes with task 2's own tests.
describe('CALL-02-AC10: shared/ui/, where Screen draws the 112 bar, needs the owner and the safety review (step 1, D-141)', () => {
  const SHARED_UI = 'apps/mobile/src/shared/ui/';

  test('CALL-02-AC10: OWNER_APPROVAL_PATHS holds /apps/mobile/src/shared/ui/', () => {
    expect(OWNER_APPROVAL_PATHS).toContain(`/${SHARED_UI}`);
  });

  test('CALL-02-AC10: .github/CODEOWNERS gives the folder exactly one line, naming @bvst and @urso-agent, and every path the owner must approve is owned', () => {
    const text = readFileSync('.github/CODEOWNERS', 'utf8');
    const owners = (path) =>
      text
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter(([pattern]) => pattern === path)
        .map(([, ...names]) => names.join(' '));

    expect(reviewCodeowners(text)).toEqual([]);
    expect(owners(`/${SHARED_UI}`)).toEqual(['@bvst @urso-agent']);
  });

  test('CALL-02-AC10: the ai-review safety filter lists the folder’s files', () => {
    const workflow = readFileSync('.github/workflows/ai-review.yml', 'utf8');

    expect(workflow).toContain(`- '${SHARED_UI}**'`);
  });

  test('CALL-02-AC10: the folder is no safety path and no mutation group lists it, a folder above it or a path in it, as D-141 decided for step 1', () => {
    // A guard, not a red test: it passes before step 1's code as after it, by
    // design, as CALL-01-AC9's above does, and reads both ways for the same
    // reason (test-auditor's note 1). It pins what step 1 must not do, so that
    // putting shared/ui/, a folder above it or a file in it among the safety
    // paths or in a mutation group shows itself as a change to this test with
    // its own reason (RG-03).
    const covers = (path) => SHARED_UI.startsWith(path) || path.startsWith(SHARED_UI);

    expect(SAFETY_PATHS).not.toContain(SHARED_UI);
    expect(SAFETY_PATHS.filter(covers)).toEqual([]);
    expect(
      MUTATION_GROUPS.filter((group) => group.paths.some(covers)).map((group) => group.name),
    ).toEqual([]);
  });

  // Task 2's part of CALL-02-AC10: as for features/call/ above, the folder's
  // lines matched nothing until task 2 created it. And the two components the
  // 112 bar depends on must be defined in owned folders: Screen, which draws
  // the bar on every screen, under shared/ui/; EmergencyBar, the bar itself,
  // under features/call/ or shared/ui/ (CALL-02, approach 1). A Screen left in
  // features/grp/ui.tsx, or a second one elsewhere, would draw 112 from an
  // unowned file.
  test('CALL-02-AC10: git tracks at least one .ts or .tsx file under apps/mobile/src/shared/ui/ that is code, not a test (task 2)', () => {
    const listed = spawnSync('git', ['ls-files', '--', SHARED_UI], { encoding: 'utf8' });

    expect(listed.status, listed.stderr).toBe(0);
    expect(
      listed.stdout
        .split('\n')
        .filter((file) => /\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file)).length,
      `${SHARED_UI} holds no .ts or .tsx file git tracks but tests`,
    ).toBeGreaterThan(0);
  });

  test('CALL-02-AC10: Screen is defined under apps/mobile/src/shared/ui/, and nowhere else in the app (task 2)', () => {
    const definers = definersOf('Screen');

    expect(
      definers.length,
      'no file git tracks under apps/mobile/src/ defines Screen',
    ).toBeGreaterThan(0);
    expect(definers.filter((file) => !file.startsWith(SHARED_UI))).toEqual([]);
  });

  test('CALL-02-AC10: EmergencyBar is defined under apps/mobile/src/features/call/ or apps/mobile/src/shared/ui/, both owned, and nowhere else (task 2)', () => {
    const definers = definersOf('EmergencyBar');

    expect(
      definers.length,
      'no file git tracks under apps/mobile/src/ defines EmergencyBar',
    ).toBeGreaterThan(0);
    expect(
      definers.filter(
        (file) => !file.startsWith('apps/mobile/src/features/call/') && !file.startsWith(SHARED_UI),
      ),
    ).toEqual([]);
  });

  test('CALL-02-AC10: the check finds a component’s definition in each of the ways one is written, and nothing else', () => {
    // The pattern definersOf uses, held on text made here, so that a pattern
    // that matched nothing could not pass the two tests above by finding no
    // file outside the owned folders.
    const defines = (text, name) =>
      new RegExp(
        `(^|\\n)\\s*(export\\s+)?(default\\s+)?(function\\s+${name}\\b|class\\s+${name}\\b|(const|let|var)\\s+${name}\\s*[=:])`,
      ).test(text);

    for (const text of [
      'export function Screen({ children }) {}',
      'export default function Screen() {}',
      'function Screen() {}',
      'export const Screen = memo(() => null);',
      'const Screen: FC = () => null;',
      'export class Screen extends Component {}',
    ]) {
      expect({ text, found: defines(text, 'Screen') }).toEqual({ text, found: true });
    }
    for (const text of [
      "import { Screen } from './screen';",
      '<Screen>',
      'export { Screen } from "./screen";',
      'const ScreenReader = 1;',
      '// function Screen() is drawn by the route',
    ]) {
      expect({ text, found: defines(text, 'Screen') }).toEqual({ text, found: false });
    }
  });
});

// CALL-02-AC11 (D-141 item 7, amended a second time on 2026-10-22: "Ja, ta med
// e2e/"): the Maestro flows in apps/mobile/e2e/ are the only end-to-end proof
// that 112 opens the dialer, and they carry the rule that a test never taps
// call there, yet the folder had no owner and no safety review. Unlike the two
// folders above it exists today, so step 1 pins the files git tracks in it.
describe('CALL-02-AC11: apps/mobile/e2e/, the flows that prove 112 opens the dialer, needs the owner and the safety review (step 1, D-141)', () => {
  const E2E = 'apps/mobile/e2e/';

  test('CALL-02-AC11: OWNER_APPROVAL_PATHS holds /apps/mobile/e2e/', () => {
    expect(OWNER_APPROVAL_PATHS).toContain(`/${E2E}`);
  });

  test('CALL-02-AC11: .github/CODEOWNERS gives the folder exactly one line, naming @bvst and @urso-agent, and every path the owner must approve is owned', () => {
    const text = readFileSync('.github/CODEOWNERS', 'utf8');
    const owners = (path) =>
      text
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter(([pattern]) => pattern === path)
        .map(([, ...names]) => names.join(' '));

    expect(reviewCodeowners(text)).toEqual([]);
    expect(owners(`/${E2E}`)).toEqual(['@bvst @urso-agent']);
  });

  test('CALL-02-AC11: the ai-review safety filter lists the folder’s files', () => {
    const workflow = readFileSync('.github/workflows/ai-review.yml', 'utf8');

    expect(workflow).toContain(`- '${E2E}**'`);
  });

  test('CALL-02-AC11: git tracks at least one .yaml file under apps/mobile/e2e/', () => {
    // Passes before step 1's code as after it, by design: the flows exist
    // today. It keeps the last-match and filter tests in scripts/gate.test.mjs,
    // which read the same list, from passing over an empty one.
    const listed = spawnSync('git', ['ls-files', '--', E2E], { encoding: 'utf8' });

    expect(listed.status, listed.stderr).toBe(0);
    expect(
      listed.stdout.split('\n').filter((file) => file.endsWith('.yaml')).length,
      `${E2E} holds no .yaml file git tracks`,
    ).toBeGreaterThan(0);
  });

  test('CALL-02-AC11: the folder is no safety path and no mutation group lists it, a folder above it or a path in it, as D-141 decided for step 1', () => {
    // A guard, not a red test: it passes before step 1's code as after it, by
    // design, and reads both ways as CALL-01-AC9's and CALL-02-AC10's do. The
    // flows are run at L7, not mutated, so a safety path or a group here shows
    // itself as a change to this test with its own reason (RG-03).
    const covers = (path) => E2E.startsWith(path) || path.startsWith(E2E);

    expect(SAFETY_PATHS).not.toContain(E2E);
    expect(SAFETY_PATHS.filter(covers)).toEqual([]);
    expect(
      MUTATION_GROUPS.filter((group) => group.paths.some(covers)).map((group) => group.name),
    ).toEqual([]);
  });
});

// CALL-02-AC12 (D-141 item 7, amended a third time on 2026-10-22: "Ja, ta med
// src/app/"): Expo Router's routes in apps/mobile/src/app/, _layout.tsx the
// frame around every screen among them, could draw over the 112 button or show
// an error screen without it, yet the folder had no owner and no safety review.
// It exists today, as e2e/ does, so step 1 pins the files git tracks in it.
describe('CALL-02-AC12: apps/mobile/src/app/, the routes and the frame around every screen, needs the owner and the safety review (step 1, D-141)', () => {
  const APP = 'apps/mobile/src/app/';

  test('CALL-02-AC12: OWNER_APPROVAL_PATHS holds /apps/mobile/src/app/', () => {
    expect(OWNER_APPROVAL_PATHS).toContain(`/${APP}`);
  });

  test('CALL-02-AC12: .github/CODEOWNERS gives the folder exactly one line, naming @bvst and @urso-agent, and every path the owner must approve is owned', () => {
    const text = readFileSync('.github/CODEOWNERS', 'utf8');
    const owners = (path) =>
      text
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter(([pattern]) => pattern === path)
        .map(([, ...names]) => names.join(' '));

    expect(reviewCodeowners(text)).toEqual([]);
    expect(owners(`/${APP}`)).toEqual(['@bvst @urso-agent']);
  });

  test('CALL-02-AC12: the ai-review safety filter lists the folder’s files', () => {
    const workflow = readFileSync('.github/workflows/ai-review.yml', 'utf8');

    expect(workflow).toContain(`- '${APP}**'`);
  });

  test('CALL-02-AC12: git tracks at least one .tsx file under apps/mobile/src/app/, _layout.tsx among them', () => {
    // Passes before step 1's code as after it, by design: the routes exist
    // today. It keeps the last-match and filter tests in scripts/gate.test.mjs,
    // which read the same list, from passing over an empty one, or over a
    // list without the frame around every screen.
    const listed = spawnSync('git', ['ls-files', '--', APP], { encoding: 'utf8' });
    const files = listed.stdout.split('\n').filter((file) => file !== '');

    expect(listed.status, listed.stderr).toBe(0);
    expect(
      files.filter((file) => file.endsWith('.tsx')).length,
      `${APP} holds no .tsx file git tracks`,
    ).toBeGreaterThan(0);
    expect(files).toContain(`${APP}_layout.tsx`);
  });

  test('CALL-02-AC12: the folder is no safety path and no mutation group lists it, a folder above it or a path in it, as D-141 decided for step 1', () => {
    // A guard, not a red test: it passes before step 1's code as after it, by
    // design, and reads both ways as CALL-02-AC11's does. The routes are not
    // mutated in step 1, so a safety path or a group here shows itself as a
    // change to this test with its own reason (RG-03).
    const covers = (path) => APP.startsWith(path) || path.startsWith(APP);

    expect(SAFETY_PATHS).not.toContain(APP);
    expect(SAFETY_PATHS.filter(covers)).toEqual([]);
    expect(
      MUTATION_GROUPS.filter((group) => group.paths.some(covers)).map((group) => group.name),
    ).toEqual([]);
  });
});

// SEC-06 (privacy-security-reviewer on PR #96, raised twice): the secret scan
// on every change is CI's required `security` check, run as `./gitleaks git .`
// with no --config (ci.yml, "Secret scan (gitleaks)"). So gitleaks takes its
// ignore list, /.gitleaksignore, and its configuration, /.gitleaks.toml when
// there is one, from the pull request's own tree: a pull request could add a
// fingerprint or an allowlist that silences the scan on itself, and pass it.
// Owned, neither can change without the owner seeing it. /.gitleaks.toml is
// owned before it exists, since the pull request that adds one is the one to
// stop. Read from the repository itself, beside the canary's pins above.
describe('SEC-06: the files that tell gitleaks what to skip need the owner', () => {
  const GITLEAKS_FILES = ['/.gitleaksignore', '/.gitleaks.toml'];

  test('SEC-06: OWNER_APPROVAL_PATHS holds /.gitleaksignore and /.gitleaks.toml', () => {
    expect(GITLEAKS_FILES.filter((path) => !OWNER_APPROVAL_PATHS.includes(path))).toEqual([]);
  });

  test('SEC-06: .github/CODEOWNERS gives each a line naming @bvst and @urso-agent, and every path the owner must approve is owned', () => {
    const text = readFileSync('.github/CODEOWNERS', 'utf8');
    const owners = (path) =>
      text
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter(([pattern]) => pattern === path)
        .map(([, ...names]) => names.join(' '));

    expect(reviewCodeowners(text)).toEqual([]);
    for (const path of GITLEAKS_FILES) {
      expect(owners(path), path).toEqual(['@bvst @urso-agent']);
    }
  });
});

// GRP-01 (D-139; privacy-security-reviewer's N5 on PR #96, and the owner's
// answer to that pull request's question 1): eleven files that carry sign-in or
// device credentials, make one, or keep a secret out of the logs had no code
// owner when GRP-01 merged, so a change to any of them merged without the
// owner seeing it, while the server's credential check (api.ts and
// adapters/device-credentials.ts, D-097) and the groups code (D-137) were
// owner paths. Each is an owner path now, owned by @bvst @urso-agent like
// every other (D-071), in both lists gate:integrity holds equal:
// OWNER_APPROVAL_PATHS and .github/CODEOWNERS. They are owner paths, not
// safety paths, and the ai-review safety filter is left as it was, as D-102
// left it for log.ts; scripts/gate.test.mjs pins that half, and the last-match
// reading of CODEOWNERS for all eleven, beside D-102's pins. Read from the
// repository itself, beside SEC-06's pins above.
//
// The first nine came from N5. The last two, join-key.ts and redact.ts, came
// with D-139's amendment: privacy-security-reviewer's S1 and N2 on the
// follow-up pull request, and the owner's answer, "Begge to." (both),
// 2026-10-21. join-key.ts makes the join key, from which a retried join gets a
// fresh credential; redact.ts strips the database password from the failure
// lines process.ts and worker.ts print.
describe('GRP-01 (D-139): the eleven files that carry sign-in or device credentials, make one, or keep a secret out of the logs need the owner', () => {
  const D139_FILES = [
    '/apps/server/src/config.ts',
    '/apps/server/src/bin/api.ts',
    '/apps/server/src/ports.ts',
    '/packages/contracts/src/groups.ts',
    '/packages/contracts/src/display-name.ts',
    '/apps/mobile/src/shared/secure-storage.ts',
    '/apps/mobile/src/shared/api/client.ts',
    '/apps/mobile/src/features/grp/session.tsx',
    '/apps/mobile/package.json',
    '/apps/mobile/src/features/grp/join-key.ts',
    '/apps/server/src/redact.ts',
  ];

  test('GRP-01 (D-139): OWNER_APPROVAL_PATHS holds all eleven', () => {
    expect(
      D139_FILES.filter((path) => !OWNER_APPROVAL_PATHS.includes(path)),
      'paths D-139 gives the owner that OWNER_APPROVAL_PATHS does not hold',
    ).toEqual([]);
  });

  test('GRP-01 (D-139): .github/CODEOWNERS gives each a line naming @bvst and @urso-agent, and every path the owner must approve is owned', () => {
    // Each path's own line, read as SEC-06's test reads it. Whether a later
    // line takes a file back under GitHub's last-match rule is asked in
    // scripts/gate.test.mjs, with the CODEOWNERS reader its last-match tests
    // share.
    const text = readFileSync('.github/CODEOWNERS', 'utf8');
    const owners = (path) =>
      text
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter(([pattern]) => pattern === path)
        .map(([, ...names]) => names.join(' '));

    expect(reviewCodeowners(text)).toEqual([]);
    expect(D139_FILES.map((path) => [path, owners(path)])).toEqual(
      D139_FILES.map((path) => [path, ['@bvst @urso-agent']]),
    );
  });

  test('GRP-01 (D-139): git tracks each of the eleven as a file of its own, and each is the path OWNER_APPROVAL_PATHS holds, so a misspelt path cannot pass as owned', () => {
    // The two tests above compare the merge rules' lists with this one. This
    // compares it with the tree: a path misspelt alike in all three would
    // pass both while the real file stayed unowned.
    const listed = spawnSync(
      'git',
      ['ls-files', '--', ...D139_FILES.map((path) => path.slice(1))],
      { encoding: 'utf8' },
    );

    expect(listed.status, listed.stderr).toBe(0);
    expect(listed.stdout.split('\n').filter((file) => file !== '')).toEqual(
      D139_FILES.map((path) => path.slice(1)).toSorted(),
    );
    expect(
      D139_FILES.filter((path) => !OWNER_APPROVAL_PATHS.includes(path)),
      'tracked files D-139 gives the owner that OWNER_APPROVAL_PATHS does not hold',
    ).toEqual([]);
  });

  test("GRP-01 (D-139): scripts/gate.test.mjs's D139_FILES holds the same eleven paths as this file's, so a path dropped from one copy alone cannot pass", () => {
    // test-auditor's N9: the list is written out twice, here and in
    // scripts/gate.test.mjs, and nothing held the two copies equal. Any path
    // dropped from this copy alone leaves the pins above silent about that
    // file, with every test green. One dropped from gate.test.mjs's copy alone
    // does the same to its last-match pin; its exceptions pin notices an
    // /apps/ path missing, but it reads no other, so a /packages/contracts/
    // path would go unnoticed. The other copy is read from that file's text, its one
    // `const D139_FILES = [ ... ];` literal, one quoted path per line, and
    // compared both ways. A line of that literal this cannot read, or a
    // second literal or none, fails here rather than letting the comparison
    // pass over a list it did not read.
    const text = readFileSync('scripts/gate.test.mjs', 'utf8');
    const literals = [...text.matchAll(/^\s*const D139_FILES = \[\n(?<body>[^\]]*)^\s*\];$/gm)];

    expect(literals.length, 'how many D139_FILES literals scripts/gate.test.mjs has').toBe(1);
    const lines = literals[0].groups.body.split('\n').filter((line) => line.trim() !== '');
    const paths = lines.map((line) => /^\s*'(?<path>[^']+)',$/.exec(line)?.groups?.path);

    expect(
      lines.filter((_, index) => paths[index] === undefined),
      'lines of that literal that are not one quoted path',
    ).toEqual([]);
    expect(paths.toSorted()).toEqual(D139_FILES.toSorted());
  });
});

// GRP-01-AC32 (review loop 1, safety-reviewer S4): the groups module decides
// who receives alerts (who joins, who is removed, and with them whose devices
// authenticate), and the green head left it out of SAFETY_PATHS and out of
// every mutation group, so no mutation run read it and no branch floor held
// it. It is a safety path, as a folder, with a group of its own after
// journeys, named membership, not groups: that word is the mutation plan's
// output key in ci.yml's three mutation jobs, where BUG-45-AC8 refuses any
// group's name (the spec's AC32). Its adapter is not: proved at L3 and by
// the shared group suite,
// as adapters/journeys.ts is (D-095's reading). And the journeys group runs
// groups.system.test.ts too: the reviewer's planted mutant, the walker check
// in modules/journeys/removal.ts skipped, survived the group's three files
// and died to that one alone. Read from the repository itself, beside the
// canary's pins above.
describe('GRP-01-AC32: the groups module is a safety path, and its mutants are run by the tests that kill them', () => {
  const MODULE = 'apps/server/src/modules/groups/';
  const ADAPTER = 'apps/server/src/adapters/groups.ts';
  const SYSTEM_TESTS = 'apps/server/src/groups.system.test.ts';
  const safety = (file) =>
    decideMutation({ changed: [file], onlyIfSafetyPathsChanged: true, configured: false });
  /** The module's source files git tracks, its tests left out: what a run mutates. */
  const moduleFiles = () =>
    spawnSync('git', ['ls-files', '--', MODULE], { encoding: 'utf8' })
      .stdout.split('\n')
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
  const covers = (p, file) => file === p || (p.endsWith('/') && file.startsWith(p));

  test('GRP-01-AC32: apps/server/src/modules/groups/ is in SAFETY_PATHS, as a folder; apps/server/src/adapters/groups.ts is not, and no safety path covers it', () => {
    expect(SAFETY_PATHS).toContain(MODULE);
    expect(SAFETY_PATHS.filter((p) => covers(p, ADAPTER))).toEqual([]);
  });

  test('GRP-01-AC32: every file of the module is a safety path, so a pull request that changes any of them is mutation-tested; the adapter alone starts no mutation run', () => {
    const files = moduleFiles();

    expect(files, 'git tracks no file under the module').toEqual(
      expect.arrayContaining([
        'apps/server/src/modules/groups/join.ts',
        'apps/server/src/modules/groups/invitations.ts',
        'apps/server/src/modules/groups/members.ts',
      ]),
    );
    for (const file of files) {
      expect({ file, ok: safety(file).ok }).toEqual({ file, ok: false });
    }
    expect(safety(ADAPTER)).toMatchObject({ ok: true, action: 'skip' });
  });

  test('GRP-01-AC32: modules/groups/ is mutated in one run, its own, membership, against groups.system.test.ts under the system tests’ configuration, and in no other run', () => {
    const runs = mutationRuns().filter((run) => run.paths.includes(MODULE));

    expect(runs).toEqual([
      {
        name: 'membership',
        paths: [MODULE],
        tests: [SYSTEM_TESTS],
        config: 'vitest.system.config.mjs',
      },
    ]);
  });

  test('GRP-01-AC32: mutationRuns mutates each file of the membership group exactly once, in that group’s run', () => {
    const files = moduleFiles();

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const runs = mutationRuns()
        .filter((run) => run.paths.some((p) => covers(p, file)))
        .map((run) => run.name);
      expect({ file, runs }).toEqual({ file, runs: ['membership'] });
    }
  });

  test('GRP-01-AC32: the membership group comes right after the journeys group', () => {
    const names = MUTATION_GROUPS.map((group) => group.name);

    expect(names, 'there is no membership group').toContain('membership');
    expect(names.indexOf('membership') - names.indexOf('journeys')).toBe(1);
  });

  test('GRP-01-AC32: the journeys group runs groups.system.test.ts fourth, after its three files, since only that file kills the walker check in modules/journeys/removal.ts', () => {
    expect(MUTATION_GROUPS.find((group) => group.name === 'journeys')?.tests).toEqual([
      'apps/server/src/journeys.system.test.ts',
      'apps/server/src/contact.system.test.ts',
      'apps/server/src/removal.system.test.ts',
      SYSTEM_TESTS,
    ]);
  });
});

describe('BUG-45: the mutation check fans out into two jobs no rule requires (AC10, D-129)', () => {
  // The required check keeps its name, `mutation`, now the aggregator's, so the
  // ruleset does not change. The plan and the legs are declared as its
  // fan-out, which gate:integrity accepts only on terms (workflow-lint.mjs).
  test('BUG-45-AC10: CHECKS’ mutation entry declares its fan-out, mutation-plan then mutation-group, and keeps its name, requirement, script and blocking', () => {
    expect(CHECKS.find((check) => check.check === 'mutation')).toEqual({
      check: 'mutation',
      requirement: 'CI-08',
      needsScript: 'mutation',
      blocking: true,
      fanOut: ['mutation-plan', 'mutation-group'],
    });
  });

  test('BUG-45-AC10: no other check fans out', () => {
    expect(
      CHECKS.filter((check) => check.fanOut !== undefined).map((check) => check.check),
    ).toEqual(['mutation']);
  });

  test('BUG-45-AC10: the fan-out jobs are never checks of their own, required or advisory, so the ruleset the owner imported does not change', () => {
    const { required, advisory, waiting } = planChecks(SCRIPTS_TODAY);

    expect(required).toContain('mutation');
    for (const job of ['mutation-plan', 'mutation-group']) {
      expect(CHECKS.map((check) => check.check)).not.toContain(job);
      expect(required).not.toContain(job);
      expect(advisory).not.toContain(job);
      expect(waiting.map((entry) => entry.check)).not.toContain(job);
    }
  });
});

describe('BUG-45: fanOutOf, the map gate:integrity hands reviewWorkflows, from CHECKS (AC10, review loop 1)', () => {
  // test-auditor B1: gate:integrity built this map inline in main(), which no
  // test reached in-process, so a fault there (a check dropped, its jobs
  // swapped for another's) would show only as a red gate:integrity in CI. It
  // is now a pure helper: every check that declares a fanOut, to its jobs in
  // order, and nothing for a check that declares none.
  test('BUG-45-AC10: with this repository’s CHECKS it is exactly mutation, to mutation-plan then mutation-group', () => {
    expect(fanOutOf(CHECKS)).toEqual({ mutation: ['mutation-plan', 'mutation-group'] });
  });

  test('BUG-45-AC10: with a synthetic list, every check that declares a fanOut is there, with its own jobs in order, and no other check', () => {
    const checks = [
      { check: 'alpha', requirement: 'CI-91', blocking: true },
      {
        check: 'beta',
        requirement: 'CI-92',
        needsScript: 'beta',
        blocking: true,
        fanOut: ['beta-plan', 'beta-leg'],
      },
      { check: 'gamma', requirement: 'CI-93', needsScript: 'gamma', blocking: true },
      { check: 'delta', requirement: 'CI-94', blocking: false, fanOut: ['delta-leg'] },
    ];

    expect(fanOutOf(checks)).toEqual({ beta: ['beta-plan', 'beta-leg'], delta: ['delta-leg'] });
  });

  test('BUG-45-AC10: no check that declares a fanOut, or no checks at all, is an empty map, so every helper job is reported as today', () => {
    expect(fanOutOf([{ check: 'alpha', requirement: 'CI-91', blocking: true }])).toEqual({});
    expect(fanOutOf([])).toEqual({});
  });
});
