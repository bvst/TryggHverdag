---
name: merge-rules-codeowners-review
description: Reviewing CODEOWNERS / OWNER_APPROVAL_PATHS / ai-review safety-filter changes — how to verify last-match, CODEOWNERS syntax and the live ruleset without a token, and the owner-path gaps still open around the journey files
metadata:
  type: feedback
---

First seen on BUG-10 (2026-10-02, head 82c7a63). Verdict PASS with should-fixes.

**Why:** a merge-rules PR is reviewed for what it leaves unowned as much as for what it adds, and gate:integrity's own CODEOWNERS check does not model last-match.

**How to verify (all worked from the Linux cloud session):**
- Last-match: a scratch node script that parses CODEOWNERS (anchored `/dir/` = prefix, `/file` = exact), takes the LAST matching line per `git ls-files` file, and reports any file under OWNER_APPROVAL_PATHS whose last match has no owners. Also probe new not-yet-existing files under each owned dir.
- CODEOWNERS syntax and owner validity: `curl https://api.github.com/repos/bvst/TryggHverdag/codeowners/errors?ref=<branch>` works UNAUTHENTICATED through the proxy (public repo since D-089). `{"errors":[]}` = valid.
- Live ruleset: `rules/branches/main` and `rulesets/<id>` also work unauthenticated. They show enforcement, pull_request params (code owner, dismiss stale, count, last_push) and required checks. **`bypass_actors` is absent without auth**, so D-029's bypass check stays unverified from a session. Say so. Ruleset id 23864486 ("main", ~DEFAULT_BRANCH).
- `pnpm run gate:integrity` in session: 3 of 5. The file checks pass; the two API checks fail for lack of a token, not for the rules.
- `scripts/gate.test.mjs` "the safety filter in ai-review.yml matches the paths the owner must approve" pins every `/apps/` owner path into the ai-review `safety` filter, so new owned app paths cannot silently miss the filter.
- HEAD can move during a review (the orchestrator commits docs). Re-check `git rev-parse HEAD` before the verdict and name the reviewed SHA.

**Owner-path gaps still open after BUG-10** (pre-existing, outside D-092/D-094's owner-chosen scope, so should-fix plus a /decision, not BLOCK):
- `apps/server/src/api.ts`: the SEC-07 `fromKnownDevice` middleware and `walkerId: context.device.userId`. It is in the safety filter but NOT in CODEOWNERS. Pinned by `journeys.system.test.ts` SM-01-AC9 (unowned test file).
- `apps/server/src/adapters/clock.ts`: the database clock. Not owned, not in the safety filter, not in CLOCK_FREE_PATHS. Its REL-01 L3 tests (`database.integration.test.ts`: within 60 s of process time, monotonic) would PASS with `new Date()`. This is D-094's api-process.ts reasoning applied one file down.
- `adapters/migrations.ts` (`MIGRATIONS` path) and `apps/server/drizzle.config.ts` (`out`): unowned. Changing both redirects future migrations out of the owned `/db/migrations/`. Also `bin/migrate.ts` and `bin/api.ts`.

**D-075 PRs:** an ai-review.yml change merges with the blocking AI checks red, so the session review is the record for the WHOLE diff, not just the workflow. Confirm the workflow hunk is additions inside `safety:` only (diff hunk header plus 0 deletions).

Related: [[tooling-scripts-review]], [[dependency-audit-ignore-review]], [[reviewer-sandbox-quirks]]

**BUG-14 (2026-10-02, head ef0c1cf, D-100) — PASS.** Added `/packages/test-kit/` to CODEOWNERS + OWNER_APPROVAL_PATHS and 4 safety-filter entries.
- Reusable last-match script: anchored-only matcher that THROWS on unanchored or glob patterns (so a silent mis-model is impossible), compares `origin/main` vs `HEAD` CODEOWNERS over `git ls-files` ∪ both trees + probes for not-yet-existing files (new file in owned dir, deep path, `packages/test-kitten/` sibling, new agent-memory file). Result shape to report: files checked, owner-set changed (all inside the new dir?), lost owners = 0.
- **Workflow-edit proof that beats reading the hunk:** load both versions with `node_modules/.pnpm/js-yaml@4.*` (what dorny/paths-filter uses), `yaml.load` the `filters:` string too, diff safety/ui lists, then blank `filters` in both and compare the whole parsed workflow with JSON.stringify — "everything else identical" covers on/permissions/jobs/actions/secrets in one line.
- Ruleset read unauthenticated (rules/branches/main) still: code_owner true, count 1, dismiss_stale true, last_push false; 13 required contexts incl. the 3 blocking ai-review jobs and gate-integrity. bypass_actors still unverifiable without auth.
- **Open after D-100 (note, not block — all already owner-gated):** the mutation verdict also depends on `scripts/lib/git.mjs` (`changedFiles` decides whether `--only-if-safety-paths-changed` starts a run), `scripts/lib/proc.mjs` (`run`), the vitest configs Stryker's command runner invokes (`vitest.system.config.mjs` for the journeys run, D-096) and ci.yml's mutation job. None in the `safety` filter. Extending needs a /decision.
- `pnpm run gate:integrity | tail` prints tail's exit 0; read ELIFECYCLE for pnpm's real exit 1.
- **Closed (seen on main a47334f):** the BUG-10 "still open" gaps above — `api.ts`, `adapters/clock.ts`, `adapters/migrations.ts`, `drizzle.config.ts` — are now owned and in the safety filter (D-097). Do not re-flag. `bin/migrate.ts` and `bin/api.ts` remain unowned.
