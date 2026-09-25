// req-coverage: fixtures-only — the IDs below name the gates, not the product.
//
// The gates are lists of steps, and a list is easy to get quietly wrong: a typo
// in a script name drops a step, and the gate then reports "not possible yet"
// and passes. These tests hold the lists to the repository they describe.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FULL_STEPS, QUICK_STEPS, availableTools } from './gate.mjs';
import { MUTATION_TIMEOUT_MS, SAFETY_PATHS } from './lib/gate-decisions.mjs';
import { packageScripts } from './lib/proc.mjs';
import {
  findActionUses,
  findUnboundedJobs,
  findUngroupedEcosystems,
} from './lib/workflow-lint.mjs';
import {
  OWNER_APPROVAL_PATHS,
  planChecks,
  reviewBypass,
  reviewRuleset,
} from './lib/merge-rules.mjs';

const WORKFLOWS = '.github/workflows';
const scripts = packageScripts(process.cwd());

describe('the gate step lists', () => {
  test('coverage is measured by the one script whose config the baseline came from', () => {
    // Two bugs are pinned here, and both of them passed quietly.
    //
    // `pnpm run test:unit -- --coverage` reaches vitest as `vitest run --
    // --coverage`, where --coverage is read as a path to filter tests by: the
    // suite passes, nothing is written, and the ratchet has nothing to measure.
    //
    // Then `pnpm run test:unit --coverage` measured the right way but the wrong
    // tests. The baseline was recorded from unit *and* system tests, because
    // the API and the health service are reached at L6 and nowhere else, so the
    // unit run alone reported 58.73 % against an 80 % floor — a red gate about
    // nothing. Naming the script, not the flags, is what stops a third version.
    const step = FULL_STEPS.find((s) => s.name.startsWith('coverage'));

    expect(step?.command).toEqual(['pnpm', 'run', 'test:coverage']);
    expect(scripts['test:coverage']).toContain('vitest.coverage.config.mjs');
  });

  test('no step separates its flags with --, which would hide them from the script', () => {
    for (const step of [...QUICK_STEPS, ...FULL_STEPS]) {
      expect(step.command).not.toContain('--');
    }
  });

  test('every step that should be runnable today names a script that exists', () => {
    const shouldRun = [...QUICK_STEPS, ...FULL_STEPS].filter((s) => s.arrivesIn === undefined);

    expect(shouldRun.length).toBeGreaterThan(0);
    for (const step of shouldRun) {
      expect(scripts).toHaveProperty(step.needsScript);
    }
  });

  test('a step that cannot run yet says which task brings it', () => {
    for (const step of FULL_STEPS.filter((s) => s.arrivesIn !== undefined)) {
      expect(step.arrivesIn).toMatch(/^INF-\d\d$/);
    }
  });
});

describe('availableTools', () => {
  test('asks whether the docker daemon answers, not whether the binary exists', () => {
    // A cloud session has /usr/bin/docker and no daemon. `which docker` would
    // say yes and the integration step would then fail inside Testcontainers,
    // which reads as broken code rather than as a machine that cannot run L3.
    const asked = [];
    const tools = availableTools((command, args) => {
      asked.push([command, ...args].join(' '));
      return { ok: true };
    }, '/tmp');

    expect(asked).toEqual(['docker info']);
    expect(tools).toEqual({ docker: true });
  });

  test('a daemon that does not answer means the tool is not available', () => {
    expect(availableTools(() => ({ ok: false }), '/tmp')).toEqual({ docker: false });
  });
});

describe("this repository's own workflows", () => {
  const files = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name));

  test('there are workflow files to check at all', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files)('%s pins every action to a commit', (name) => {
    // gate:integrity checks this too, but it is red until the owner switches
    // the merge rules on — so until then this is the only thing that would
    // notice an unpinned action arriving.
    for (const use of findActionUses(readFileSync(`${WORKFLOWS}/${name}`, 'utf8'))) {
      expect({ ref: use.ref, pinned: use.pinned }).toMatchObject({ pinned: true });
    }
  });

  test('the job that works out which reviewers apply can read the pull request', () => {
    // dorny/paths-filter asks the API which files the pull request touches, so
    // `contents: read` alone fails the job with "Resource not accessible by
    // integration" — and that failure takes all five reviewers down with it.
    // Narrowing this job's permissions is right; narrowing it past this is not.
    const text = readFileSync(`${WORKFLOWS}/ai-review.yml`, 'utf8');
    const changesJob = text.slice(text.indexOf('  changes:'), text.indexOf('  review:'));

    expect(changesJob).toContain('pull-requests: read');
  });

  test('the reviewers are granted the tools their prompt needs', () => {
    // The action gives a plain-text prompt no tools at all unless claude_args
    // lists them, so the reviewer needs its read tools and the comment tool
    // that carries findings to a person.
    //
    // This test required Write as well, for a reason that no longer holds:
    // the verdict used to reach CI as review-<agent>.md, so without Write the
    // review happened and its evidence did not survive. The verdict now comes
    // back through --json-schema, so there is no file and no reason for the
    // harness to hold a write tool. Changed because the premise was removed,
    // not to make a failure go away — and the constraint got stricter, since
    // `ai-review.test.mjs` now asserts Write is *absent* rather than this one
    // merely tolerating it.
    const text = readFileSync(`${WORKFLOWS}/ai-review.yml`, 'utf8');
    const allowed = /--allowedTools\s+"(?<tools>[^"]+)"/.exec(text)?.groups?.tools ?? '';

    expect(allowed.split(',').map((s) => s.trim())).toEqual(
      expect.arrayContaining(['Read', 'Grep', 'Glob', 'Bash', 'mcp__github__add_issue_comment']),
    );
  });

  test('no ci job can be skipped into a green tick (CI-12)', () => {
    // The saving here is real but the failure mode is worse than the cost. A
    // required check that GitHub reports as *skipped* counts as passing, so
    // `paths:` or a job-level `if:` would hand out green ticks for work nobody
    // did — which ci.yml's own header calls the one thing this repository must
    // not produce. And a required check that never reports at all deadlocks
    // the pull request: #16 sat unmergeable on exactly that.
    //
    // So the conditionality lives on steps, never on jobs. This asserts the
    // shape rather than the intent, because intent is what erodes.
    const text = readFileSync(`${WORKFLOWS}/ci.yml`, 'utf8');
    const workflow = text.slice(text.indexOf('\njobs:'));

    // No job-level `if:` anywhere (four spaces of indent = job key).
    expect(workflow).not.toMatch(/^ {4}if:/m);
    // No paths filters, which would stop the workflow producing the check at all.
    expect(workflow).not.toMatch(/^\s*paths(-ignore)?:/m);
  });

  test('every gate that can sit out a diff first asks whether it should', () => {
    // A guarded step with no classify step above it would never run at all —
    // `steps.affected.outputs.code` would simply be empty, and empty is not
    // 'true'. That fails silently in the worst direction: the gate stops
    // running and still reports success.
    const text = readFileSync(`${WORKFLOWS}/ci.yml`, 'utf8');
    const jobs = text.slice(text.indexOf('\njobs:')).split(/(?=^ {2}[a-z-]+:)/m);

    for (const job of jobs) {
      const firstGuard = job.indexOf("steps.affected.outputs.code == 'true'");
      if (firstGuard === -1) continue;
      const name = /^ {2}([a-z-]+):/.exec(job)?.[1];
      const classify = job.indexOf('- id: affected');

      expect(classify, `${name} guards steps without classifying the diff`).toBeGreaterThan(-1);
      // Order, not merely presence. An earlier version of this test asserted
      // only that the classify step existed somewhere in the job, and
      // code-reviewer showed on #17 that moving it below the guarded steps
      // left the test passing — which is the precise bug it exists to catch.
      // A guard that reads steps.affected.outputs.code before the step that
      // sets it reads an empty string, so every guarded step sits out, and the
      // job still reports success: a gate switched off with a green tick over
      // it. Comparing positions is the cheap check that actually holds.
      expect(classify, `${name} classifies the diff after already guarding on it`).toBeLessThan(
        firstGuard,
      );
      // And the classify step itself must never be guarded, or it cannot run:
      // a guard on it would read the output it is supposed to set, find an
      // empty string, skip the step, and leave every guarded step below it
      // skipping too — the job green having done nothing.
      //
      // This began as a regex looking for an `if:` line immediately followed by
      // `- id: affected`, which only ever caught a guard on the *preceding*
      // step. Writing it the natural way, with `if:` under the `id:`, sailed
      // past. test-auditor blocked #17 over it, and was right to: the sibling
      // assertion above had already been found broken the same way one commit
      // earlier, and fixing the instance rather than the class left this one
      // sitting there. Reading the step's own block is not pattern-matching
      // around the problem, so there is no second shape to miss.
      const nextStep = job.indexOf('\n      - ', classify);
      const classifyStep = job.slice(classify, nextStep === -1 ? undefined : nextStep);
      expect(classifyStep, `${name} puts a condition on its own classify step`).not.toMatch(
        /^\s*if:/m,
      );
    }
  });

  test('a verdict is only accepted with the comment that proves a review happened', () => {
    // On 2026-09-23 this gate accepted
    //   {"verdict":"PASS","summary":"Placeholder — waiting for test-auditor
    //    subagent to finish before posting PR comment and final verdict."}
    // and went green. test-auditor is one of the three blocking reviewers, so a
    // blocking check reported success over a review that had not happened —
    // worse than a red, which would have been investigated.
    //
    // The gate asked whether the answer had the right shape. It never asked
    // whether anyone did the work. The comment is what a finished review leaves
    // behind and a cut-off one does not, so commentUrl is what makes the
    // verdict corroborable rather than merely well-formed.
    //
    // ai-review.yml is the one file the reviewers structurally cannot review
    // (D-075), so this test is the only thing standing behind the change.
    const text = readFileSync(`${WORKFLOWS}/ai-review.yml`, 'utf8');
    const schema = /--json-schema\s+'(?<schema>[^']+)'/.exec(text)?.groups?.schema ?? '';

    expect(schema).not.toBe('');
    const parsed = JSON.parse(schema);
    expect(parsed.required).toEqual(expect.arrayContaining(['verdict', 'summary', 'commentUrl']));
    expect(parsed.properties.commentUrl.pattern).toContain('issuecomment-');
  });

  test('the verdict gate reads the comment back rather than trusting the URL', () => {
    // A URL is a claim like any other. Three separate things have to hold, and
    // each closes a different route to passing without reviewing: the comment
    // exists (read back through the API), it is on THIS pull request rather
    // than some other one, and its body names the same verdict — so an agent
    // that posts "I could not finish" and returns PASS is caught by the two
    // artefacts disagreeing.
    const text = readFileSync(`${WORKFLOWS}/ai-review.yml`, 'utf8');
    const enforce = text.slice(text.indexOf('Enforce the verdict'));

    expect(enforce).toContain('issues/comments/');
    expect(enforce).toContain('issue_url');
    expect(enforce).toContain('PR_NUMBER');
    // The body check: whatever verdict was reported has to appear in the
    // comment. Asserted on the shell variable, so rewording the message cannot
    // quietly drop the check.
    expect(enforce).toMatch(/jq -r '\.body[^|]*\| grep -qiE "[^"]*\$\{verdict\}/);
  });

  test('every ecosystem groups its non-major updates into one pull request', () => {
    // Twelve patch bumps as twelve pull requests are reviewed by nobody, and a
    // dependency stream nobody reads is a security gate in name only (SEC-06).
    // Majors stay ungrouped on purpose: that is where behaviour may change.
    expect(findUngroupedEcosystems(readFileSync('.github/dependabot.yml', 'utf8'))).toEqual([]);
  });

  test('every workflow job is bounded by a timeout', () => {
    // Without timeout-minutes a job gets GitHub's six-hour default, and a job
    // that hangs is indistinguishable from one that is working — so it is not
    // investigated, it is waited on. The two jobs that had a bound were the two
    // added last; the other nine inherited the default by nobody deciding.
    const unbounded = readdirSync(WORKFLOWS)
      .filter((name) => name.endsWith('.yml'))
      .flatMap((name) =>
        findUnboundedJobs(readFileSync(`${WORKFLOWS}/${name}`, 'utf8')).map(
          (id) => `${name}: ${id}`,
        ),
      );

    expect(unbounded).toEqual([]);
  });

  test('the mutation run is given time to finish, inside the job that runs it', () => {
    // proc.mjs gives every command 590 s unless told otherwise. On INF-07's
    // first CI run Stryker needed longer, was killed, and the job failed on a
    // score nobody measured. The limit must also stay inside the job's own
    // timeout, with room for checkout and install, or GitHub kills the job
    // first and nothing explains why.
    const ci = readFileSync(`${WORKFLOWS}/ci.yml`, 'utf8');
    const job = /^ {2}mutation:.*\n(?:(?! {2}\S).*\n)*? {4}timeout-minutes: (\d+)/m.exec(ci);

    expect(job).not.toBeNull();
    const jobMinutes = Number(job?.[1]);
    expect(MUTATION_TIMEOUT_MS).toBeGreaterThan(590_000);
    expect(MUTATION_TIMEOUT_MS).toBeLessThanOrEqual((jobMinutes - 3) * 60_000);
  });

  test('the mutation budget stays 25 minutes for all the runs together, inside the 30-minute job', () => {
    // The owner's grouping decision of 2026-09-25 split one Stryker run into
    // several and kept the budget as it was: 25 minutes across all of them,
    // not per run, because the job around them still has 30. A slow run is
    // fixed by making its tests faster, which is what the grouping did; this
    // number moving is a decision for the owner, not a fix.
    const ci = readFileSync(`${WORKFLOWS}/ci.yml`, 'utf8');
    const job = /^ {2}mutation:.*\n(?:(?! {2}\S).*\n)*? {4}timeout-minutes: (\d+)/m.exec(ci);

    expect(MUTATION_TIMEOUT_MS).toBe(25 * 60_000);
    expect(Number(job?.[1])).toBe(30);
  });

  test('the safety filter in ai-review.yml matches the paths the owner must approve', () => {
    // Two copies of the same list: the paths CODEOWNERS holds for the owner,
    // and the paths that summon safety-reviewer. If they drift, a safety change
    // either merges with no safety review, or waits for a review nobody asked
    // for. Either way one of the two is lying.
    const text = readFileSync(`${WORKFLOWS}/ai-review.yml`, 'utf8');
    const safetyPaths = OWNER_APPROVAL_PATHS.filter((p) => p.startsWith('/apps/'));

    expect(safetyPaths.length).toBeGreaterThan(0);
    for (const path of safetyPaths) {
      const glob = path.replace(/^\//, '').replace(/\/$/, '/**');
      expect(text).toContain(`'${glob}'`);
    }
  });

  test('every safety path needs the owner to approve a change to it', () => {
    // Two more copies of one list, and nothing tied them together: the paths
    // the gates treat as safety code, mutated by Stryker and held to the 95 %
    // branch floor, and the paths CODEOWNERS must hold for the owner. A safety
    // path the owner does not approve is a rule that a single pull request can
    // change without them. The Healthchecks.io adapter, a safety path by the
    // owner's decision D-079, reached SAFETY_PATHS and CODEOWNERS but not
    // OWNER_APPROVAL_PATHS, the list CI-01 holds CODEOWNERS to, so its line in
    // CODEOWNERS was one that nothing checked.
    //
    // The two are written differently. An owner path starts with / and is
    // anchored at the root, and one that ends in / covers every file under it.
    const covers = (owned, path) => {
      const relative = owned.replace(/^\//, '');
      return relative === path || (relative.endsWith('/') && path.startsWith(relative));
    };
    const unapproved = SAFETY_PATHS.filter(
      (path) => !OWNER_APPROVAL_PATHS.some((owned) => covers(owned, path)),
    );

    expect(SAFETY_PATHS.length).toBeGreaterThan(0);
    expect(unapproved).toEqual([]);
  });
});

describe('the ruleset the owner imports', () => {
  // docs/plan/main-ruleset.json is what the owner uploads to GitHub, so it is a
  // copy of the required-check list — the kind of copy that goes stale quietly.
  // Rather than compare it field by field, put it through the very functions
  // that will later judge the live repository: if the file would not satisfy
  // gate:integrity, it is wrong now, and this says so before the owner imports
  // it rather than after.
  const ruleset = JSON.parse(readFileSync('docs/plan/main-ruleset.json', 'utf8'));
  const required = planChecks(scripts).required;

  test('it satisfies the same check that CI-01 runs against the live repository', () => {
    expect(reviewRuleset({ branchRules: ruleset.rules, required })).toEqual([]);
  });

  test('nobody may bypass it (D-029)', () => {
    expect(reviewBypass({ rulesets: [ruleset] })).toEqual([]);
  });

  test('it targets the default branch', () => {
    expect(ruleset.target).toBe('branch');
    expect(ruleset.conditions.ref_name.include).toEqual(['~DEFAULT_BRANCH']);
  });

  test('it requires every check that must be required today, and no others', () => {
    const contexts = ruleset.rules
      .find((rule) => rule.type === 'required_status_checks')
      .parameters.required_status_checks.map((entry) => entry.context);

    expect(contexts).toEqual(required);
  });
});
