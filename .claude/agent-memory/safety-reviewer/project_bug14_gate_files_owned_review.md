---
name: bug14-gate-files-owned-review
description: BUG-14 / D-100 review 2026-10-02 (PASS at ef0c1cf) — test kit owner-approved, four mutation entries in the ai-review safety filter; open: Vitest configs not in filter, group tests in no list, package.json mutation script unpinned
metadata:
  type: project
---

Reviewed origin/main(a47334f)...ef0c1cf on fix/BUG-14-gate-files-owned. PASS. CODEOWNERS +/packages/test-kit/,
OWNER_APPROVAL_PATHS + same, ai-review safety filter + scripts/mutation.mjs, scripts/lib/gate-decisions.mjs,
stryker.config.mjs, packages/test-kit/**. 1260/1260 scripts tests green; 8 BUG-14 tests.

Verified (all file-free):
- ai-review.yml: numstat 4/0; js-yaml (node_modules/.pnpm/js-yaml@4.3.2) parse of the workflow AND of the inner
  `filters` string: safety 19 -> 23, nothing removed, rest of workflow deep-equal to origin/main.
- picomatch 4.0.7 {dot:true}: packages/test-kit/** matches all 22 tracked files, not packages/test-kitchen/.
- Every mutation group's test imports fakes only from @trygghverdag/test-kit (readlink -> packages/test-kit).
  test-kit depends on @trygghverdag/contracts (in filter, src unowned by D-094) and fast-check (lockfile).

Open (check before repeating):
1. vitest.config.mjs, vitest.shared.mjs (root, 4 groups run under it) and vitest.system.config.mjs (journeys
   group config) are owner-approved and D-098 inputs but NOT in the safety filter. Vitest silently drops a
   named test file its config excludes (exit 0, no warning) — shown with CLI --exclude on the process group.
   Changed 4/2/1 times on main since 2026-09-01: cheap to add. Raised as Should fix (owner amends D-100).
2. Group tests outside domain/ (worker.test.ts, bin/bin.test.ts, process.test.ts, adapters/healthchecks.test.ts,
   journeys.system.test.ts, api-process.test.ts): no owner, not in filter. test-auditor (always), tests:changes
   and D-098's trigger do see them. Owner question; recommended filter yes, CODEOWNERS no.
3. package.json "mutation" script text is pinned by no test (only toHaveProperty at gate.test.mjs:76);
   "echo" there would pass CI's required mutation check on every PR, guarded only by owner approval.
   Recommended a pin test like gate:drills' (gate.test.mjs:3136).
Left out on purpose: proc.mjs (cannot inflate a score: report cleared then read, mutation.mjs:197/203),
git.mjs/affected.mjs (whether, not how; own tests), steps.mjs/gate.mjs (local gate:full only), ci.yml (flags and
timeout pinned at gate.test.mjs:440/447; 10 commits since 09-01).

**How to apply:** on any later mutation-gate or test-kit PR, check whether 1-3 landed before raising them again.
Related: [[mutation-gate-checks]], [[unowned-gate-configs]], [[bug12-mutation-gate-review]].

**Loop 1 (3e1babb), PASS.** Open item 1 CLOSED: D-100 amended, the three Vitest configs are in the filter and
a test holds the filter to MUTATION_INPUTS (now exported) plus every group's config, read from the code. Item 2:
the owner kept group tests out (pinned by a test). Item 3 (package.json mutation script) not taken up.
My brief (.claude/agents/safety-reviewer.md) gained a D-100 line: kill rule, dropped safety file or group test,
lenient fake. Suggested additions not yet in it: the 80 % per-file bar, when the run starts (decideMutation /
MUTATION_INPUTS / SAFETY_PATHS), every run fresh (D-099), a run that measured nothing fails.
