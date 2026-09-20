---
name: feature
description: "Build one requirement end to end — spec, failing tests, code, reviews, audit, progress, pull request. Usage: /feature <ID>"
disable-model-invocation: true
---

# /feature $ARGUMENTS

Build requirement **$ARGUMENTS** end to end. Stop and report to the owner
whenever a step can't be completed; never skip a step.

0. **Preconditions.** The working tree is clean; `main` is up to date; the ID
   exists in the plan. Create the branch `feat/$ARGUMENTS-<short-name>`.
1. **Spec** — delegate to `planner`. If it lists questions for the owner, ask
   them (one at a time, each with its recommendation). If the owner isn't in the
   session, open one GitHub issue per question with the `owner-question`
   template (D-051), and stop work on this ID.
2. **Red** — write `red:$ARGUMENTS` to `.claude/state/phase`, then delegate to
   `test-author`. Confirm every acceptance criterion has a failing test that
   fails for the right reason.
3. **Green** — delegate to `implementer`. Its stop gate must pass. Then delete
   `.claude/state/phase`.
4. **Full checks** — `pnpm gate:full` (includes `req:coverage` and `api:diff`;
   includes `mutation --incremental` when safety paths changed).
5. **Reviews, in parallel** — `code-reviewer` always; `safety-reviewer` if domain,
   alerts, worker or safety-core changed; `privacy-security-reviewer` if data,
   auth, logging, storage or dependencies changed; `a11y-i18n-reviewer` if UI
   changed.
6. **Audit** — `test-auditor`.
7. **Loop** — a BLOCK from a blocking reviewer or the auditor sends the work back
   to step 3 (or to step 2 for a missing or wrong test). After 3 loops, stop and
   report to the owner.
8. **Record** — delegate to `plan-keeper` (progress entry, requirement status).
9. **Pull request** — push the branch and open a PR whose description is written
   for the owner: what changed and why (plain language), requirement IDs, test
   evidence, each reviewer's verdict, a "Test changes" section (RG-03), and
   whether owner approval is needed (CODEOWNERS paths). Enable auto-merge with
   `gh pr merge --auto --squash`. Never merge yourself.
