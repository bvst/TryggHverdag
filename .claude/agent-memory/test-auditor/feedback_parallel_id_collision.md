---
name: parallel-id-collision
description: Parallel sessions claim the same next D-0xx and BUG-n; check the branch's new IDs against fetched main and open PRs; a conflicting ("dirty") PR runs no workflows, so its head has zero check runs
metadata:
  type: feedback
---

Found on PR #43 (2026-09-29, head d6d28b5). The branch added D-083 (CI on ubuntu-26.04) and used BUG-8 for the
android-e2e install's session refusal. Meanwhile main merged #44 (its own D-083, "M0 closes") and #45, and main's
D-084 gave BUG-8 to "the remaining gate files need the owner". Open PR #46 adds `test("BUG-8: …")` tests for that.
A "take both" conflict resolution would leave two `## D-083` headings and two unrelated sets of `BUG-8:` tests.

**Why:** bug tests are traced by their `BUG-<n>:` name and decisions are binding by number. A reused ID breaks
the link for good, and neither git nor any gate catches it.
**How to apply:** for every new D-0xx or BUG-n on the branch, `git grep` it on freshly fetched origin/main, and
look at open PRs (`curl -sS https://api.github.com/repos/bvst/TryggHverdag/pulls?state=open | jq`). Graded
Blocking (RG-01). The fix is to merge main and renumber everywhere: test names, fixture comments, JSDoc, spec
amendments, decision amendments, workflow comments, and the PR title and body.
Detect conflicts without merge-tree (the guard blocks it): `GIT_INDEX_FILE=<scratch>/idx git read-tree origin/main`,
then `git diff origin/main...HEAD -- <file> | GIT_INDEX_FILE=<scratch>/idx git apply --cached --check -`. Confirm
with the API: `pulls/<n>` shows `mergeable_state: "dirty"`.
A conflicting PR gets no `pull_request` workflows, so `commits/<sha>/check-runs` shows total_count 0. That also
explains a record saying "a push started nothing". RG-05 then has no result to read. Say so; it is not the 403 case.
Related: [[stale-base]], [[gate-integrity-local]]
