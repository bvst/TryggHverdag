// req-coverage: fixtures-only — the IDs below name the gates, not the product.
//
// The gates are lists of steps, and a list is easy to get quietly wrong: a typo
// in a script name drops a step, and the gate then reports "not possible yet"
// and passes. These tests hold the lists to the repository they describe.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FULL_STEPS, QUICK_STEPS, availableTools } from './gate.mjs';
import { packageScripts } from './lib/proc.mjs';
import { findActionUses, findUnboundedJobs } from './lib/workflow-lint.mjs';
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
