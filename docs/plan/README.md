# Planning hub — walk-home safety app (working title)

**Last updated:** 2026-09-28 · **Phase:** ✅ Planning complete → **next: milestone M0** — start with [M0-kickoff.md](M0-kickoff.md) · Section 4 closes after the spike in M1

**Current section:** milestone M0 — foundations. Status: [../progress.md](../progress.md) · Build log: [../progress/m0.md](../progress/m0.md)

This folder is the project's memory. Everything we research, discuss and decide
ends up here, so any session (in Claude Code or claude.ai) can pick up exactly
where the last one stopped.

## How to resume
Start a new session with:

> Read `docs/plan/README.md` and continue the planning where we left off.

Claude reads this file, `decisions.md`, and the section marked 🟡/🔵, then
continues from that section's **Next steps**.

## Status

| # | Section | Status | File |
|---|---------|--------|------|
| 0 | Working agreement — how we plan, decide and resume | ✅ Done (v1) | [00-working-agreement.md](00-working-agreement.md) |
| 1 | Product vision, users & MVP scope | ✅ Done | [01-product-vision.md](01-product-vision.md) · [01b-mvp-scope.md](01b-mvp-scope.md) |
| 2 | Norway context: emergency services, law & privacy (GDPR, Datatilsynet, age limits, hosting) | ✅ Done | [02-norway-law-privacy.md](02-norway-law-privacy.md) |
| 3 | Safety, reliability & security requirements — what must never fail silently | ✅ Done | [03-safety-reliability-security.md](03-safety-reliability-security.md) |
| 4 | Tech stack: app framework, backend, maps/location, push (incl. background-location spike) | 🟡 Providers chosen · spike (emulators/simulators) not started | [04-tech-stack.md](04-tech-stack.md) |
| 5 | Architecture & code structure — modularity, boundaries, how to change things safely | ✅ Done | [05-architecture.md](05-architecture.md) |
| 6 | Testing strategy & regression protection | ✅ Done | [06-testing-strategy.md](06-testing-strategy.md) |
| 7 | Claude Code setup: CLAUDE.md, subagents, skills, hooks, commands | ✅ Done (draft v0 files) | [07-claude-code-setup.md](07-claude-code-setup.md) · [07b files](07b-claude-code-files/README.md) |
| 8 | CI/CD, environments & releases (TestFlight, Play testing tracks) | ✅ Done (draft v0 files) | [08-cicd-releases.md](08-cicd-releases.md) · [08b files](08b-ci-files/README.md) |
| 9 | Development workflow & progress tracking — specs, definition of done, progress log | ✅ Done | [09-workflow-progress.md](09-workflow-progress.md) |
| 10 | Roadmap & first milestone | ✅ Done | [10-roadmap.md](10-roadmap.md) · [M0-kickoff.md](M0-kickoff.md) |

Legend: ⚪ Not started · 🟡 In progress · 🔵 Waiting for owner · ✅ Done

Decisions so far: [decisions.md](decisions.md)

**Milestone M0 is under way.** What has been built, what is next and what
Claude needs from the owner: [../progress.md](../progress.md).

## Owner to-do
Things only the owner can do. Claude checks this list at the start of every
session.

| ID | Action | Why | Status |
|----|--------|-----|--------|
| A-01 | Ask the group which phones they use (iPhone or Android; brand and model) and who wants to join the private group | Which phone models the automated real-device tests cover; Google's 12-tester rule | ⬜ Open |
| A-02 | Enrol the AS in the Apple Developer Program: look up the AS's D-U-N-S number (Apple has a lookup tool), and check that the AS has a public website and an email address on its own domain | Test builds on iPhones; Critical Alerts request | ⬜ Open (D-027) |
| A-03 | Create a Google Play developer account for the AS (same D-U-N-S number) | Android test track | ⬜ Open (D-027) |
| A-04 | Create a Clever Cloud account for the AS | Hosting (D-025) | ✅ Done (2026-09-20) |
| A-05 | Create a private repository on your paid GitHub account and give Claude Code access | Code and CI (D-029) | ✅ Done (2026-09-20) |
| A-06 | Create a separate GitHub account for Claude (a "machine user"), add it to the repository with write access (not admin), and give Claude Code its token | Your approvals count as real approvals, and the merge rules can't be bypassed (D-042) | ✅ Done (2026-09-20) |
| A-07 | Create an Expo account for the AS | iOS builds without a Mac; app builds and store submission (Section 8) | ✅ Done (2026-09-20) |
| A-08 | Create Healthchecks.io and UptimeRobot accounts, with alerts to your phone | Get paged if the safety system stops (REL-08) | ✅ Done (2026-09-26) — both alert by email, which the owner accepts for now (2026-09-28); UptimeRobot's monitor was A-25 |
| A-09 | Run `claude setup-token` and save the token as the repository secret `CLAUDE_CODE_OAUTH_TOKEN` | AI reviews and the daily report in CI (D-045, D-050) | ✅ Done — 2026-09-23. `CLAUDE_CODE_OAUTH_TOKEN` is set and `ANTHROPIC_API_KEY` is not |
| A-10 | Set up the Mac: separate `claude-dev` Standard user, FileVault, no sleep on power, shared tools — see [M0-kickoff.md](M0-kickoff.md) Part 2 | Hybrid sessions (D-055, D-056) | ✅ Done (2026-09-25) — `pnpm run doctor` passes 9 of 9 (INF-00); `claude-dev` is on GitHub as `urso-agent` only |
| A-14 | Create a cloud environment at claude.ai/code (Claude prepares the settings) | Everyday cloud sessions (D-055) | 🟡 Network allowlist applied by the owner (2026-09-24, [cloud-environment.md](cloud-environment.md)); it reached the running session. Setup script still to come |
| A-15 | Switch on the merge rules and add the two secrets — every step is written out in [merge-rules.md](merge-rules.md), about 10 minutes | Without them no gate can stop a merge, and `gate-integrity` stays red (D-029, D-042) | ✅ Done (2026-09-23) — `gate:integrity` reports 5 of 5 against the live rules, including that nobody can bypass them |
| A-16 | In Healthchecks.io, add a check named `daily-status` with **Period 1 day** and **Grace 3 hours**, copy its ping URL, and save it as the repository secret `HEALTHCHECKS_DAILY_STATUS_URL` (Settings → Secrets and variables → Actions). About 3 minutes | Pages you when a morning passes with no daily report at all — the one failure the report cannot tell you about itself (D-076). Until then every report says it is missing and the run is red | ✅ Done (2026-09-24) — verified by the first run: `PING_CONFIGURED: true`, and the ping logged exit status 0 |
| A-17 | Check that the report reaches your phone. If it does not, turn on push notifications for mentions in GitHub Mobile | INF-09 is done when the first report arrives on your phone, and only you can see that (D-050) | ✅ Done (2026-09-25) — the owner sees the report on the phone, as the GitHub issue #19. Since D-080 it is the description of [#35](https://github.com/bvst/TryggHverdag/issues/35): merging #32 closed #19 |
| A-18 | Create the Clever Cloud organisation `TryggHverdag Staging` and send Claude its ID — steps in [staging-setup.md](staging-setup.md) | Staging lives in its own organisation (D-046, D-077) | ✅ Done (2026-09-24) — its ID is committed in `infra/staging/staging.auto.tfvars` |
| A-19 | Create a Clever Cloud CI user that is a Manager of the staging organisation only, and get its key | CI's key must reach staging and nothing else (D-077) | ✅ Done (2026-09-24), reported by the owner. Not checkable from a session; the first `infra-staging` plan run proves the key works |
| A-20 | Create the Cellar add-on and bucket for Terraform's state, and send Claude its host | Terraform cannot create the place it keeps its own state | ✅ Done (2026-09-24) — host `cellar-c2.services.clever-cloud.com`, as `infra/staging/versions.tf` already had it |
| A-21 | Create the GitHub environment `staging`, limited to `main`, with the four secrets | No pull request branch can reach the keys | ✅ Done (2026-09-24), reported by the owner. A session's GitHub access may not read environment settings, so Claude could not confirm the `main` limit or the secret names; the first plan run proves the four keys are there, and `gate:integrity` should check the rest (D-077 follow-up) |
| A-22 | After INF-07 merges: run `infra-staging` with `plan`, read it, then run it with `apply` | Creates staging; the two runs are the approval (D-077) | ✅ Done (2026-09-25) — staging is created and a merge deploys to it with the smoke test passing. Left over: delete the first apply's `trygghverdag-staging` app and database in the console (outside Terraform; the app costs money) |
| A-23 | Add the worker's check in Healthchecks.io and the `HEALTHCHECKS_WORKER_URL` environment secret, before the next `infra-staging` plan — see [monitoring-setup.md](monitoring-setup.md) | Monitoring (INF-08, REL-08) | ✅ Done — the drill's alert names the `staging-worker` check, created 2026-09-25 and pinged 18 times before the stop |
| A-24 | After the INF-08 pull request merges: run `infra-staging` with `plan`, then `apply`, then confirm the check leaves `new` — see [monitoring-setup.md](monitoring-setup.md) | Monitoring (INF-08, REL-08) | ✅ Done (2026-09-26) — the check went down and back up in the drill, which a check still in `new` never does |
| A-25 | Add the UptimeRobot keyword monitor and install its mobile app — see [monitoring-setup.md](monitoring-setup.md) | Monitoring (INF-08, REL-08, D-079) | ✅ Done, as the owner accepted it (2026-09-28): the monitor alerts by email, and the app was not installed — "it is enough for now". Its **Keyword** and **Alert when** settings were not checked (A-26) |
| A-26 | The drill: stop the staging app and confirm both monitors page you within 5 minutes — see [monitoring-setup.md](monitoring-setup.md) | INF-08's done-criterion | ✅ Done — ran 2026-09-26, accepted by the owner 2026-09-28. Healthchecks.io went down at 14:36:16 UTC, about 3 minutes after the last ping, and up at 14:44:00; UptimeRobot alerted at 14:37:04 UTC. **Not checked:** UptimeRobot's recovery, and why its alert gave the root cause "Keyword Exists" when A-25 asked for an alert when the keyword does *not* exist |
| A-27 | In Healthchecks.io, open the `daily-status` check and set **Grace** to **8 hours** (Period stays 1 day). About a minute | GitHub starts the daily report about 4¾ hours late, by amounts that vary; with 3 hours' grace an on-time run followed by a late one could page you for a run that happened, and a false page teaches you to ignore the real one. A genuinely missed report now pages at about 32 hours instead of 27 (D-080) | ⬜ Open — agreed by the owner 2026-09-26 |
| A-28 | Add `android-e2e` to the existing `main` ruleset's required checks (Settings → Rules → Rulesets → `main` → required status checks; edit the existing ruleset, do not import a second one), then re-run only the `gate-integrity` job on the INF-06 pull request. Open Dependabot pull requests will need a `@dependabot rebase` afterwards | INF-06 cannot merge otherwise: `gate:integrity` reads the branch's own `package.json` and goes red the moment `e2e:android` exists (D-042, D-060, CI-09) | ⬜ Open |

## Why this order
The specialised agents and skills (Section 7) are where your quality bar gets
enforced, but they can only encode decisions that already exist: which
framework, which folder structure, which test tools, which failure modes are
unacceptable. Writing agents first would mean rewriting them after every later
decision. So we decide *what* (1–3), then *with what* (4–6), then build the
*team and guardrails* that enforce it (7–9), then plan the work (10).

Section 3 comes before the stack on purpose: a safety app's hardest requirement
is noticing when something has gone wrong even if the phone dies. That
requirement will shape the backend choice more than any feature will.

## Where things are decided
- **What we build:** Section 1 and the MVP stories in `01b-mvp-scope.md`.
- **Rules the code must follow:** PRIV (Section 2), F, REL and SEC (Section 3),
  AR and SM (Section 5), RG (Section 6).
- **Claude Code team, skills and hooks:** Section 7; files in
  `07b-claude-code-files/`.
- **CI, environments and releases:** Section 8; files in `08b-ci-files/`.
- **How work flows and how progress is measured:** Section 9.
- **What happens next:** Section 10, the milestones M0–M6.
