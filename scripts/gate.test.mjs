// req-coverage: fixtures-only — the IDs below name the gates, not the product.
//
// The gates are lists of steps, and a list is easy to get quietly wrong: a typo
// in a script name drops a step, and the gate then reports "not possible yet"
// and passes. These tests hold the lists to the repository they describe.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FULL_STEPS, QUICK_STEPS } from './gate.mjs';
import { packageScripts } from './lib/proc.mjs';
import { findActionUses } from './lib/workflow-lint.mjs';
import {
  OWNER_APPROVAL_PATHS,
  planChecks,
  reviewBypass,
  reviewRuleset,
} from './lib/merge-rules.mjs';

const WORKFLOWS = '.github/workflows';
const scripts = packageScripts(process.cwd());

describe('the gate step lists', () => {
  test('the coverage step passes --coverage to vitest as a flag, not as a filename', () => {
    // `pnpm run test:unit -- --coverage` reaches vitest as `vitest run --
    // --coverage`, where --coverage is read as a path to filter tests by. The
    // suite then passes, no coverage is written, and the ratchet below has
    // nothing to measure. This is the shape of that bug, pinned.
    const step = FULL_STEPS.find((s) => s.name.includes('with coverage'));

    expect(step?.command).toEqual(['pnpm', 'run', 'test:unit', '--coverage']);
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
