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
**Visibility changes: check it, don't recall it.** It was private on 2026-09-26 (anonymous curl gave 404), and
`gh api repos/bvst/TryggHverdag --jq .visibility` said **public** on 2026-10-01. So a doc saying "the repository is
public" was true at STORE-01 (ca72239). Use `gh api
repos/bvst/TryggHverdag/rules/branches/main` either way; it lists the 12 required contexts (mutation, traceability, unit,
integration and system among them). `gh api .../rulesets/23864486` shows `bypass_actors: null` with this token, so
bypass stays unverified.
Still 3 of 5 on 2026-09-26 (INF-06 audit at 6938a37). The branch was not pushed, so `gh api .../commits/<sha>/check-runs`
answered 422 "No commit found": there was no check to read. Once the branch adds `e2e:android`, gate:integrity lists 13
required checks while the live ruleset has 12 (no `android-e2e` until the owner does A-28). That mismatch is
the designed reminder in AC14, not a finding.
Unchanged at fa607f3 (INF-06 re-audit, 2026-09-26): 3 of 5, the branch still unpushed, no PR, and check-runs 422.
2026-09-29 cloud session (PR #43 audit): `gh` is not installed, but GH_TOKEN is set and `curl` through the proxy
reads `rules/branches/main`. It showed 13 required contexts, now including `android-e2e`. It also reads
`rulesets/23864486`: `bypass_actors: []`, `current_user_can_bypass: never`, enforcement active. gate:integrity itself
was still 3 of 5 in the session, so verify the premise with curl, not with the script.
2026-10-01 on the Mac (SPIKE-01 at 8a37a5e): still 3 of 5. `gh api …/rules/branches/main` lists 13 contexts
(gate-integrity, static, unit, integration, system, contract, traceability, mutation, security, the three blocking
ai-reviews, android-e2e). The branch was unpushed (check-runs 422, no PR), so no check existed on the commit.
Same at 6ae585f (SPIKE-01 re-audit, later on 2026-10-01): 3 of 5, the same 13 contexts live, unpushed, no PR, 422.
Same at ca72239 (STORE-01, docs only, 2026-10-01): 3 of 5, 13 contexts live, unpushed, no PR, 422. For a docs-only
diff, traceability's cheap steps are enough to run by hand: `req:coverage --fail-on-uncovered-changed`,
`tests:changes --base origin/main` and `node scripts/affected.mjs --base origin/main`. With `code=false`,
test:coverage, the ratchet and mutation all take "nothing to check".
`req:coverage` rewrites docs/requirements-status.md. If `git status` shows it unchanged afterwards, the run
changed nothing.
2026-10-02 cloud session (BUG-11 at 786a5e4): gate:integrity 3 of 5 again; curl showed the same 13 contexts, `require_code_owner_review: true`, `bypass_actors: []`, `current_user_can_bypass: never`. The branch was pushed but had no PR, so check-runs gave total_count 0 (not 422, not 403).
2026-10-02 cloud session (BUG-12 at 6a3d606): gate:integrity 3 of 5; curl showed the same 13 contexts and require_code_owner_review true; branch pushed, no PR, check-runs total_count 0.
2026-10-02 cloud session (BUG-14 at 49d66ae): gate:integrity 3 of 5; curl showed the same 13 contexts, require_code_owner_review
true, bypass_actors [], current_user_can_bypass never. Pushed, no PR, check-runs total_count 0. Main's ai-review.yml review job
now grants `checks: read`, so a CI test-auditor should no longer get the 403 the brief still describes.
2026-10-03 cloud session (BUG-15 at 0ccd0f5): gate:integrity 3 of 5; `gh api` (built-in client) showed the same 13 contexts,
require_code_owner_review true, bypass_actors [], current_user_can_bypass never, enforcement active. Pushed, no PR, check-runs
total_count 0. Zero open PRs, so "CI already ran it" is false until the PR exists; for a scripts/package.json diff run the unit
file, traceability's cheap steps and decideMutation inline instead.
2026-10-03 cloud (LOST-01 loop 1 at 19db407): 3 of 5 again; `gh api` showed the same 13 contexts (mutation, traceability among them), code-owner review true. Branch pushed at 19db407, no open PR (only #59 BUG-15), check-runs total_count 0, so RG-05 was read from the local reports, not CI.
