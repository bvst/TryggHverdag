---
name: ci-fanout-matrix-review
description: BUG-45 mutation plan/matrix/aggregator review (PASS) — GITHUB_OUTPUT and workflow-command injection reasoning, artifact poisoning checks, aggregator truth-table probe, pin verification
metadata:
  type: reference
---

BUG-45 (2026-10-13, branch claude/busy-faraday-40n2zl, 89688b1): `mutation` split into mutation-plan, mutation-group (matrix), mutation (aggregator, `if: always()`). PASS.

**Threat model first:** ci.yml runs on `pull_request` only, so the PR's own ci.yml and scripts run. Injection matters only for values that are DATA a reviewer would not read (changed file paths, branch names), not for values defined by code (group names are constants in scripts/lib/gate-decisions.mjs MUTATION_GROUPS + WHOLE_SUITE_RUN). Protection of the code itself is CODEOWNERS on /.github/ and /scripts/.

**GITHUB_OUTPUT injection recipe:** runner on Linux splits the file on `\n` only; a `key=value` line splits at the first `=` when it comes before any `<<`. So stripping `[\r\n]+` from a value written as `reason=...` is sufficient; JSON.stringify output has no raw newline. git `diff --name-only` (no -z) C-quotes paths with control chars anyway. File commands are applied at step end and override stdout `::set-output`. Workflow commands need the trimmed line to START with `::`, so a printed message line starting `mutation:` cannot carry one.

**Artifact poisoning checks:** download-artifact with no `run-id`/`github-token` reads only this run (all attempts; re-run legs overwrite with `overwrite: true`). grep every upload-artifact name in all workflows for the pattern. merge-multiple collisions: each leg uploads only `<group>.json` and `<group>.verdict.json`; a group named `x.verdict` would collide but is fail-closed (reports ending `.verdict` dropped).

**Aggregator probe:** import `aggregateMutationJobs` from scripts/mutation.mjs in a scratch .mjs and run a 13-case truth table (leg failure/cancelled/skipped-on-run, plan dropping a group with and without the reports, skip with legs run, empty decision, verdict-says-ok-report-fails, extra report). All failed except all-good and consistent skip. Aggregator re-derives the groups from code but trusts the plan's `skip` (same trust the old single job had).

**Pins:** download-artifact and upload-artifact v7 tags are lightweight (no `^{}` line in ls-remote), so the tag SHA is the commit.

Notes left (not blocking): matrix.group in `run:` (code-defined; route via env for hygiene), artifacts in a PUBLIC repo with default retention (set retention-days like android-e2e's 7), checkout persist-credentials in legs that run PR code (read-only token, pre-existing everywhere).

Related: [[action-pin-bump-review]], [[hook-gate-bypass-review]]
