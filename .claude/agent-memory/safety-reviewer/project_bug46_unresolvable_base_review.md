---
name: bug46-unresolvable-base-review
description: BUG-46 / D-131 review 2026-10-13 (PASS at ecb3f22) — requireMergeBase in git.mjs; mutation (only with --only-if-safety-paths-changed), tests:changes, coverage:ratchet, affected refuse a base git cannot resolve; open: req:coverage is a fourth diff reader with the same quiet pass
metadata:
  type: project
---

Reviewed origin/main(9cc74b7)...ecb3f22 (red 25d9272, fix ecb3f22). PASS.

Verified:
- Red at 25d9272: 9 BUG-46 tests fail, 145 pass (scratch `git worktree add --detach` + symlinked node_modules
  worked this session; the read-only guard did not block writes or `2>&1` here).
- Green: git/tests-changes/coverage/mutation/affected test files 231/231.
- Mutants: decide() guard `if (true)` -> only "plain run not refused" test fails (so the flag-scoping is held);
  affected.mjs refusal off -> 2 affected.test + 1 gate.test fail.
- Push-to-main emulation (clone, main at HEAD, origin/main = HEAD): tests:changes "0 changed ... none weakened"
  exit 0; plan decision=skip exit 0 (as on main's run 38389858532). Unknown base: --plan --only-if prints no
  `decision=`; --plan alone (no --only-if) still decision=run exit 0.
- Fixture edits keep their meaning: an empty commit / committed base with origin/main=HEAD leaves the
  working-tree diff identical, committed diff empty; coverage ratchet scratch dirs still have changed=[].
- CI: every base is origin/${base_ref || 'main'} with fetch-depth 0 (checkout fetches all heads), so it resolves.

Open (check before repeating):
1. scripts/req-coverage.mjs:114 `--fail-on-uncovered-changed` reads changedFiles({cwd}) with no
   requireMergeBase: same quiet pass locally (gate:quick/gate:full); CI safe (fetch-depth 0). Read, not run.
2. No test pins `--plan` WITHOUT --only-if on an unknown base (code is right; a future guard on step would pass).
3. D-131's "(--only-if-safety-paths-changed and --plan)" reads as if --plan alone refuses; code/brief say not.

Related: [[bug45-mutation-fanout-review]], [[mutation-gate-checks]].
