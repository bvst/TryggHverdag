---
name: gate-integrity-local
description: Locally, pnpm run gate:integrity reports 3 of 5 because main's rulesets cannot be read without a token, so "required check" premises stay unverified
metadata:
  type: project
---

On the Mac (claude-dev, 2026-09-25) `pnpm run gate:integrity` lists `mutation`, `traceability`, `unit` and the other
checks as "required today", but that list comes from the repository's own expectations. The two checks that read
the live ruleset ("main requires review, the checks…" and "nobody can bypass") fail with "main's rules could not
be read from the GitHub API". Result: 3 of 5, red.

**Why:** the brief says that if gate:integrity is red, the "CI gates it anyway" reasoning does not hold, so run the
relevant gates directly.
**How to apply:** report plainly that the premise was not verified against the live rules. Then run whichever
gates actually bear on the diff. For scripts/-only changes that means the unit tests, plus the baseline and
mutation-path reasoning; `scripts/` is not in SAFETY_PATHS (scripts/lib/gate-decisions.mjs), so mutation does not
mutate it. Check again each time: CI with RULES_READ_TOKEN may give 5 of 5.
Still 3 of 5 locally on 2026-09-26 (BUG-5 audit and re-audit). Also check whether the branch has been pushed or has a PR
(`gh pr list --head <branch>`). If not, no check exists on the commit, so "CI already ran it" is false too. ci.yml runs
only on `pull_request` and push to main, so a pushed branch with no PR has zero check runs.
**The repository is private as of 2026-09-26.** Anonymous `curl` to api.github.com returns 404. Use `gh api
repos/bvst/TryggHverdag/rules/branches/main` instead; it lists the 12 required contexts (mutation, traceability, unit,
integration and system among them). `gh api .../rulesets/23864486` shows `bypass_actors: null` with this token, so
bypass stays unverified.
Still 3 of 5 on 2026-09-26 (INF-06 audit at 6938a37). The branch was not pushed, so `gh api .../commits/<sha>/check-runs`
answered 422 "No commit found": there was no check to read. Once the branch adds `e2e:android`, gate:integrity lists 13
required checks while the live ruleset has 12 (no `android-e2e` until the owner does A-28). That mismatch is
the designed reminder in AC14, not a finding.
