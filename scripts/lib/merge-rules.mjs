// CI-01: are the merge rules actually enforced?
//
// D-029 is the reason this file exists. The repository lives on the owner's
// personal account, where an administrator can normally push past every rule.
// Claude Code works with those credentials. So "the rules are configured" and
// "the rules apply to everyone" are two different claims, and only the second
// one is worth anything.
//
// Everything here is a pure decision: what the GitHub API returned goes in, a
// list of problems comes out. The network lives in scripts/gate-integrity.mjs.
//
// A problem is { what, fix }: what is wrong, and what a person should do.

/**
 * Paths where a change needs the owner's approval before it can merge (D-042).
 * Mirrors .github/CODEOWNERS; this list is what CI-01 holds that file to.
 */
export const OWNER_APPROVAL_PATHS = [
  '/apps/server/src/domain/',
  '/apps/server/src/modules/alerts/',
  '/apps/server/src/worker.ts',
  '/apps/mobile/src/safety-core/',
  '/.github/',
  '/.claude/',
  // Loaded into every agent session, and states the non-negotiables and the
  // binding-decisions rule that the rest of this file assumes.
  '/CLAUDE.md',
  // The gates are not only .github and .claude: these run with the tokens the
  // gate-integrity job holds, and decide what every other check does.
  '/scripts/',
  '/package.json',
  '/packages/contracts/released/',
  '/docs/plan/decisions.md',
  '/infra/',
];

/**
 * Every check from Section 8 (CI-01 to CI-11), in the order they appear there.
 *
 * `needsScript` is how a check proves it can do anything at all: a job that
 * calls a script the repository does not have would be a green tick for work
 * nobody did. Such a check stays out of the required list until the task in
 * `arrivesIn` lands — and goes in by itself when it does, because this list is
 * read at run time rather than copied into the repository settings by hand.
 *
 * @typedef {object} Check
 * @property {string} check the status check's name, exactly as GitHub reports it
 * @property {string} requirement the CI-xx it comes from
 * @property {string} [needsScript] the package.json script the job runs
 * @property {string} [arrivesIn] the task that adds that script
 * @property {boolean} blocking whether it must be a required check (D-043)
 */
/** @type {Check[]} */
export const CHECKS = [
  { check: 'gate-integrity', requirement: 'CI-01', blocking: true },
  { check: 'static', requirement: 'CI-02', needsScript: 'gate:static', blocking: true },
  { check: 'unit', requirement: 'CI-03', needsScript: 'test:unit', blocking: true },
  {
    check: 'integration',
    requirement: 'CI-04',
    needsScript: 'test:integration',
    arrivesIn: 'INF-05',
    blocking: true,
  },
  {
    check: 'system',
    requirement: 'CI-05',
    needsScript: 'test:system',
    arrivesIn: 'INF-05',
    blocking: true,
  },
  { check: 'contract', requirement: 'CI-06', needsScript: 'api:diff', blocking: true },
  { check: 'traceability', requirement: 'CI-07', needsScript: 'req:coverage', blocking: true },
  { check: 'mutation', requirement: 'CI-08', needsScript: 'mutation', blocking: true },
  {
    check: 'android-e2e',
    requirement: 'CI-09',
    needsScript: 'e2e:android',
    arrivesIn: 'INF-06',
    blocking: true,
  },
  { check: 'security', requirement: 'CI-10', needsScript: 'licenses:check', blocking: true },
  { check: 'ai-review (safety-reviewer)', requirement: 'CI-11', blocking: true },
  { check: 'ai-review (privacy-security-reviewer)', requirement: 'CI-11', blocking: true },
  { check: 'ai-review (test-auditor)', requirement: 'CI-11', blocking: true },
  { check: 'ai-review (code-reviewer)', requirement: 'CI-11', blocking: false },
  { check: 'ai-review (a11y-i18n-reviewer)', requirement: 'CI-11', blocking: false },
];

/**
 * Which checks the repository must require today, which are still waiting for
 * the task that makes them real, and which are advisory (D-043).
 *
 * @param {Record<string, string>} scripts the package.json scripts that exist
 */
export function planChecks(scripts) {
  const runnable = (check) =>
    check.needsScript === undefined || scripts[check.needsScript] !== undefined;

  return {
    required: CHECKS.filter((check) => check.blocking && runnable(check)).map((c) => c.check),
    waiting: CHECKS.filter((check) => check.blocking && !runnable(check)).map((check) => ({
      check: check.check,
      reason: `no "${String(check.needsScript)}" script yet${
        check.arrivesIn === undefined ? '' : ` — ${check.arrivesIn} adds it`
      }`,
    })),
    advisory: CHECKS.filter((check) => !check.blocking).map((c) => c.check),
  };
}

const ruleOf = (rules, type) => rules.find((rule) => rule.type === type);

/**
 * The rules that apply to `main`, as `GET /repos/{owner}/{repo}/rules/branches/main`
 * returns them, against the checks that must be required today.
 *
 * @param {{ branchRules: {type: string, parameters?: Record<string, unknown>}[] | null, required: string[] }} state
 */
export function reviewRuleset({ branchRules, required }) {
  if (branchRules === null) {
    return [
      {
        what: "main's rules could not be read from the GitHub API, so nothing here was verified.",
        fix: 'Give the job a token that can read this repository, and run it again. A check that could not run is not a check that passed (D-029).',
      },
    ];
  }
  if (branchRules.length === 0) {
    return [
      {
        what: 'No rule protects main: it can be pushed to, force-pushed and deleted, and no check has to pass first.',
        fix: 'Create the ruleset in docs/plan/merge-rules.md. Until then every gate in this repository is advice, not a gate (D-029).',
      },
    ];
  }

  const problems = [];
  const pullRequest = ruleOf(branchRules, 'pull_request');
  if (pullRequest === undefined) {
    problems.push({
      what: 'No pull-request rule, so code can go straight to main without review or checks.',
      fix: 'Switch on "Require a pull request before merging" for main.',
    });
  } else {
    const parameters = pullRequest.parameters ?? {};
    if (parameters.require_code_owner_review !== true) {
      problems.push({
        what: 'Code owner review is not required, so a change to a safety path could merge without the owner (D-042).',
        fix: 'Switch on "Require review from Code Owners" for main.',
      });
    }
    if (parameters.dismiss_stale_reviews_on_push !== true) {
      problems.push({
        what: 'Stale approvals are not dismissed, so an approval can outlive the code it approved.',
        fix: 'Switch on "Dismiss stale pull request approvals when new commits are pushed".',
      });
    }
    // A required-approval count of zero is not a weaker rule, it is no rule.
    // It also empties "Require review from Code Owners", which asks for a code
    // owner among the approvals it requires — and zero of them is none. Paired
    // with dismiss-on-push that is worse than inert: every push erases the
    // approvals and nothing asks for them back. This check exists because the
    // gate reported the repository healthy while all three were true, and #6
    // merged on owner-gated paths with no approval standing (D-072).
    //
    // The message says "if it is on" rather than asserting it, because this
    // branch reads one parameter and must not claim to have read two. A gate
    // report is the one thing in this repository that has to be literally
    // true, so it may not state as fact something it never tested.
    if ((parameters.required_approving_review_count ?? 0) < 1) {
      problems.push({
        what: 'No approval is required before merging, so nothing has to be reviewed — and "Require review from Code Owners", if it is on, has nothing to attach to: GitHub asks for a code owner among the approvals it requires, and zero of them is none (D-042).',
        fix: 'Set "Required approvals" to at least 1. @urso-agent is a code owner (D-071), so this does not mean waiting for a second person.',
      });
    }
  }

  const statusChecks = ruleOf(branchRules, 'required_status_checks');
  if (statusChecks === undefined) {
    problems.push({
      what: 'No required status checks, so a pull request merges without the checks ever having to be green.',
      fix: `Require these checks on main: ${required.join(', ')}.`,
    });
  } else {
    const parameters = statusChecks.parameters ?? {};
    const configured = (parameters.required_status_checks ?? []).map((entry) => entry.context);
    const missing = required.filter((check) => !configured.includes(check));
    const extra = configured.filter((check) => !required.includes(check));

    if (missing.length > 0) {
      problems.push({
        what: `These checks run in CI but do not have to pass before merging: ${missing.join(', ')}.`,
        fix: 'Add them to the required checks for main. A check nobody requires is a check nobody has to fix.',
      });
    }
    if (extra.length > 0) {
      problems.push({
        what: `These checks are required but are not among the checks CI runs today: ${extra.join(', ')}.`,
        fix: 'Remove them, or add the job that produces them. A required check that cannot run either blocks every merge forever, or is a decoration that can never fail.',
      });
    }
    if (parameters.strict_required_status_checks_policy !== true) {
      problems.push({
        what: 'Branches do not have to be up to date with main before merging, so a green check can describe code that is no longer what would be merged.',
        fix: 'Switch on "Require branches to be up to date before merging".',
      });
    }
  }

  if (ruleOf(branchRules, 'deletion') === undefined) {
    problems.push({
      what: 'main can be deleted.',
      fix: 'Switch on "Restrict deletions" for main.',
    });
  }
  if (ruleOf(branchRules, 'non_fast_forward') === undefined) {
    problems.push({
      what: 'Force pushes to main are allowed, so history — and the evidence in it — can be rewritten.',
      fix: 'Switch on "Block force pushes" for main.',
    });
  }
  return problems;
}

/**
 * The part D-029 is really about: who is allowed to ignore all of the above.
 *
 * `main` can be covered by more than one ruleset, so this takes all of them.
 * Reading only the first would print a tick over a bypass entry sitting in the
 * second — in the one check D-029 exists to make.
 *
 * @param {{
 *   rulesets: { enforcement?: string, bypass_actors?: {actor_type?: string, bypass_mode?: string}[] }[] | null,
 *   rulesExist?: boolean,
 *   status?: number | null,
 * }} state
 */
export function reviewBypass({ rulesets, rulesExist = true, status = null }) {
  if (!rulesExist) {
    return [
      {
        what: 'There is no ruleset on main yet, so there is nothing to bypass — and nothing holding anyone back either.',
        fix: 'Create the ruleset first (docs/plan/merge-rules.md). This check starts reading its bypass list the moment it exists.',
      },
    ];
  }
  if (rulesets === null) {
    if (status === 401 || status === 403) {
      return [
        {
          what: `Who can bypass main's rules could not be checked: GitHub answered ${String(status)}, so the token was rejected.`,
          fix: 'The token was not accepted. If RULES_READ_TOKEN is set it has most likely expired; issue a new fine-grained token with Metadata: Read-only on this repository. If it is not set, the Actions token lacked the access this endpoint asks for — see docs/plan/merge-rules.md.',
        },
      ];
    }
    return [
      {
        what: "Who can bypass main's rules could not be checked, so the most important property of the merge rules is unknown.",
        fix: 'Nothing could read the rulesets. In CI this uses the ordinary Actions token, which normally suffices — GitHub asks only for metadata read. If it does not, add the repository secret RULES_READ_TOKEN: a fine-grained token with Metadata: Read-only on this repository and nothing else. See docs/plan/merge-rules.md.',
      },
    ];
  }

  const problems = [];
  for (const ruleset of rulesets) {
    if (ruleset.enforcement !== 'active') {
      problems.push({
        what: `The ruleset is "${String(ruleset.enforcement)}", not "active": it is reported on but not enforced.`,
        fix: 'Set the ruleset to Active.',
      });
    }
    for (const actor of ruleset.bypass_actors ?? []) {
      problems.push({
        what: `${String(actor.actor_type)} may bypass the rules (${String(actor.bypass_mode)}), so the gates are optional for whoever that is (D-029).`,
        fix: 'Remove every bypass entry. Nobody bypasses the gates — that is the whole point of having them.',
      });
    }
  }
  return problems;
}

/**
 * CODEOWNERS covers every path that needs the owner's approval (D-042).
 *
 * This checks that each path is claimed by someone. It does not model
 * CODEOWNERS' "last match wins", which the file uses deliberately to exempt
 * .claude/agent-memory/; that exemption is reviewed by the owner like any other
 * change under /.github/.
 *
 * @param {string | null} text
 */
export function reviewCodeowners(text) {
  if (text === null || text.trim() === '') {
    return [
      {
        what: 'No CODEOWNERS rules, so no change requires the owner before it merges (D-042).',
        fix: 'Restore .github/CODEOWNERS with the paths listed in OWNER_APPROVAL_PATHS.',
      },
    ];
  }

  const owned = new Set();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const [pattern, ...owners] = trimmed.split(/\s+/);
    if (owners.length > 0) {
      owned.add(pattern);
    }
  }

  return OWNER_APPROVAL_PATHS.filter((path) => !owned.has(path)).map((path) => ({
    what: `${path} has no code owner, so a change there could merge without the owner seeing it (D-042).`,
    fix: `Add a line to .github/CODEOWNERS: "${path} @bvst @urso-agent".`,
  }));
}
