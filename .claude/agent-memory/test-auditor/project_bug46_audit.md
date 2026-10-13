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
