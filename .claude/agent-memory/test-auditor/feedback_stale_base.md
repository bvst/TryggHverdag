---
name: stale-base
description: Fetch origin/main before auditing a branch; a branch whose target moved can conflict in the audited lines, and a conflicting PR is never reviewed by CI
metadata:
  type: feedback
---

Run `git fetch origin main` first, then `git log --oneline HEAD..origin/main` and
`git diff HEAD...origin/main -- <files the branch touches>`. The local origin/main can be a day stale.

**Why:** BUG-5 (2026-09-26) was written against b80e6d0. Main had already merged INF-08 (#31, f004300), and that
PR fixed the same flaky BUG-3 test in `bin.test.ts` (`untilOutputContains`, with the 1.5 s counted from the line).
So the branch conflicted in the exact lines under audit. Its RG-03 justification ("slept a fixed 1.5 s", "origin/main
passed 3 of 3") was also false against the real main. GitHub does not run `pull_request` workflows on a PR with
merge conflicts, so no CI reviewer would ever see that commit. Verdict: BLOCK until it is rebased, the justification
is rewritten against main's version, and the branch is audited again. The test change itself was sound.

**How to apply:** if main changed the same test, treat the RG-03 reason as unverified until it is written against
main's version of the test. Say that the audited diff is not the diff that will merge. Surface it as a scope
question, whether the fix is still needed, instead of leaving the caller to find the conflict.
Related: [[bug-test-patterns]], [[gate-integrity-local]]
