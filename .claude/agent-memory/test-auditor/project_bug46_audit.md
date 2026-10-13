---
name: bug46-audit
description: BUG-46 (D-131, requireMergeBase; tests:changes, coverage:ratchet, mutation --only-if-safety-paths-changed refuse an unresolvable --base) audit at 25d9272/ecb3f22 - PASS; RG-02 replay 9/9 right reasons, 19 faults all killed
metadata:
  type: project
---
2026-10-13 cloud, branch claude/busy-faraday-40n2zl, red 25d9272, fix ecb3f22 (HEAD 9079b0b adds safety-reviewer memory only). **PASS.**
- RG-02 replay: `git archive 25d9272` tree (tests at red + prod at d038b75) gives exactly the commit's 9 failed / 145 passed,
  each on its own assertion (TypeError for the missing export; not.toContain 'decision=skip' / 'touches no safety code' /
  'nothing to compare against' / 'no coverage went down').
- RG-03: old test files (d038b75) against fixed prod: 12 red, every one on the new refusal message (D-099 x2, BUG-12, 8 BUG-45
  --plan cases, INF-06-AC8 pass case), so the origin/main fixture edits were needed. With origin/main == HEAD (or an empty commit
  under untracked files) changedFiles() is the same set as before, so each case still tests its own subject. No `-` line in the
  test diff held an expect. drills RG03.judge needs the sample name + `^RG-03: ` so the refusal cannot satisfy it vacuously.
- Faults (scratchpad/ta-bug46/run.mjs + mutants.mjs, tree copy with git init + origin/main so affected.test's 6 env tests pass):
  19/19 killed incl. requireMergeBase always ok, message without base, "nothing to compare" message, mergeBase: base, refusal exit 0
  in each gate, gate checking origin/main instead of --base, mutation refusal ok:true, writePlan writing outputs on !ok, decide
  refusing plain runs (killed only by the D-131 plain-run pin), affected never refusing.
- RG-04: targeted coverage (8 importing test files): tests-changes.mjs 11/32 = baseline; git.mjs 85.71/72.22 vs stale 5.88/0
  baseline (gain not locked in, note); mutation.mjs 54/59 vs stale 0/0. main() returning its exit code to keep the statement
  count: judged fair (cleaner, single exitCode write; the new branch is killed by process tests coverage cannot see).
- Untested: `--plan` alone with an unknown base (decision=run, fail-safe); D-131 text says "and --plan". INF-10.md:658 still
  describes the old tests:changes behaviour as a candidate bugfix.
- No PR for the branch, 0 check runs on HEAD: mutation result not readable (absent, not 403). gate:integrity 5/5 with NODE_USE_ENV_PROXY=1.
Related: [[bug45-audit]], [[baseline-vs-main]], [[entry-script-wiring]]

**Loop 1 (e7bbb76 red, 69697bf fix, 2cc8abf message) - PASS.** req:coverage --fail-on-uncovered-changed is the fourth gate.
- RG-02 replay: tree at 2cc8abf with req-coverage.mjs + git.mjs from adbf3b4: exactly the 2 red cases fail, each on
  "expected +0 to be 1" with the old "1 of 1 live requirements" line; HEAD tree 11/11 BUG-46 cases green.
- Faults (ta-bug46/mutants-l1.mjs, tree t-L1): 15/18 killed. Survivors: R3 refusal without `return` (falls through, exit
  stays 1: near-equivalent), R7 refusal on stdout (tests read stdout+stderr), and R10/R11/R13 IMPLEMENTING_DIRS dropping
  apps/ or packages/ or adding scripts/ - pre-existing, the same faults survive at adbf3b4 (mutants-old.mjs O1/O2): no
  entry test changes product code naming an uncovered ID. Plan-only refusal (U2) killed only by the new --plan pin.
  drills INF-10-AC2/AC9 fail in any tree copy (jest-expo, root node_modules only): run a wide no-op control first.
- RG-04: baseline file unchanged vs main (merge base = origin/main 9cc74b7). req-coverage.mjs 6/44 lines, 2/16 branches
  = baseline 12.5. The `||` chain -> IMPLEMENTING_DIRS.some rewrite: istanbul counts every leaf of a nested logical as a
  branch (4 -> 2), offsetting the guard's 2. Judged fair: behaviour-identical, disclosed in the commit, and the guard
  pinned by subprocess tests (faults killed). Rule of thumb: a shape change that offsets uncounted branches is fair only
  if all three hold; otherwise ask for an explained baseline update.
- 0 check runs, no PR at 2cc8abf; gate:integrity 5/5 with NODE_USE_ENV_PROXY=1.
