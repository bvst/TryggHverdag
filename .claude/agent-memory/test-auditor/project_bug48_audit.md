---
name: bug48-audit
description: BUG-48 (D-131 for stop-gate.mjs and progress-gate.mjs, unresolvable origin/main) audit at 636d804/aa4c1c8 - PASS; RG-02 replay 11/11 right reasons, 17/20 faults killed
metadata:
  type: project
---
2026-10-14 cloud, branch claude/busy-faraday-40n2zl, red 636d804, fix aa4c1c8. **PASS.**
- Harness: scratchpad/ta-bug48 (run.mjs copied from ta-bug46, mutants.mjs). Trees from `git archive aa4c1c8` + node_modules
  symlink + `git init`/commit/update-ref origin/main: t-RED (prod hooks from 636d804), t-oldtests (tests from 636d804^),
  t-crlf (stop-gate from b6ee158^).
- RG-02 replay: exactly 11 red, each on the commit's assertion; 5 controls green pre-fix.
- RG-03: old tests vs fixed hooks = 18 red, all on the missing-base refusal / forced gate run, so the origin/main fixture
  edits were needed. Every makeRepo fixture in both files now resolves origin/main (repoWith, projectWith, branchRepo,
  BUG-7 move, CRLF, BUG-36 untracked) - no test left that passes merely because the base is missing (shadowed-guard check).
  Only removed expect: CRLF precondition `no origin/main`, replaced by `merge-base diff empty`. CRLF test vs b6ee158^ hook:
  fails "expected '' to contain 'gate:quick'" (commit claim verified); fault "drop RAW_BYTES from the change check" killed
  by exactly the two rewritten CRLF tests.
- Faults: stop-gate 10/10 killed (baseKnown true/inverted, clause dropped, early exit, committed diff dropped, red phase
  forced to quick, merge-base HEAD HEAD / origin/master, untrimmed sha, RAW_BYTES). progress-gate 7/10: P4 changedFiles
  without base (equivalent), P6 no-base message without `HK-08: ` prefix (unpinned, note), P8 requireMergeBase without cwd
  (near-equivalent: hook spawned inside the repo in every test).
- Hooks outside coverage (vitest.coverage.config include scripts/packages/apps); baseline unchanged vs origin/main 595c584.
  test:hooks runs in the required gate-integrity CI job (ci.yml:66). .claude/hooks not in SAFETY_PATHS.
- Branch pushed, no open PR, 0 check runs on aa4c1c8: mutation result absent (not 403). gate:integrity 5/5 (NODE_USE_ENV_PROXY=1).
Related: [[bug46-audit]], [[shadowed-guards]], [[bug30-31-audit]]
