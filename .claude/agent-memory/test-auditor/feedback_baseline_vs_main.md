---
name: baseline-vs-main
description: coverage:ratchet compares against the branch's own committed baseline, so a baseline lowered by --update or a merge resolution passes CI; diff it against origin/main and run ratchetDrops with main's numbers
metadata:
  type: feedback
---

`coverage:ratchet` (scripts/coverage-ratchet.mjs) reads `coverage-baseline.json` from the working tree, which is the
branch's own copy. No gate compares it with origin/main's copy. A PR that lowers an entry, with `--update` or while
resolving a merge conflict, therefore passes `traceability`, and "coverage:ratchet: no coverage went down" in a commit
message only means "not below the baseline this branch wrote". The brief's line "the traceability job enforces this"
is not true for a lowered baseline.

Found on INF-06 (2026-09-26): `scripts/lib/affected.mjs` was 100/100 on main (5 lines, added by INF-08) and
94.64/76.59 on the branch. The branch base had no entry for the file, so the implementer's own ratchet never saw a
drop. The merge 87f0601 then took "each file's entry from the side that changed the file", which silently lowered it
against main. No written reason existed. pinned-binary.mjs, lowered the same way, had been caught by code-reviewer
and restored; this one had not.

**Why:** RG-04 says coverage on changed files may not go down, and a lowered number needs a written reason. This is
the one baseline check CI cannot make, so it falls to this audit.
**How to apply:** on every branch, compare `git show origin/main:coverage-baseline.json` with the working copy file by
file. Then run `test:coverage` and call `ratchetDrops({ current, baseline: mainBaseline, changed })` from
scripts/lib/coverage.mjs to get the drops against main. Find the uncovered lines with
`vitest run --config vitest.coverage.config.mjs --coverage --coverage.include=<file> --coverage.reporter=text
--coverage.reportsDirectory=<scratchpad>`. A lowered entry with no reason is Blocking. Check any merge commit's
"conflicts resolved" note for coverage-baseline.json in particular.
Related: [[stale-base]], [[entry-script-wiring]]
