# Planning hub — walk-home safety app (working title)

**Last updated:** 2026-09-20 · **Phase:** ✅ Planning complete → **next: milestone M0** — start with [M0-kickoff.md](M0-kickoff.md) · Section 4 closes after the spike in M1

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
| A-08 | Create Healthchecks.io and UptimeRobot accounts, with alerts to your phone | Get paged if the safety system stops (REL-08) | 🟡 Healthchecks.io done · UptimeRobot waits for a URL to monitor (the staging API in INF-07, or the AS's website) |
| A-09 | Run `claude setup-token` and save the token as the repository secret `CLAUDE_CODE_OAUTH_TOKEN` | AI reviews and the daily report in CI (D-045, D-050) | ⬜ Open (M0) |
| A-10 | Set up the Mac: separate `claude-dev` Standard user, FileVault, no sleep on power, shared tools — see [M0-kickoff.md](M0-kickoff.md) Part 2 | Hybrid sessions (D-055, D-056) | ⬜ Open (M0 — tonight or tomorrow) |
| A-14 | Create a cloud environment at claude.ai/code (Claude prepares the settings) | Everyday cloud sessions (D-055) | ⬜ Later (M2) |
| A-15 | Switch on the merge rules and add the two secrets — every step is written out in [merge-rules.md](merge-rules.md), about 10 minutes | Without them no gate can stop a merge, and `gate-integrity` stays red (D-029, D-042) | ✅ Done (2026-09-23) — `gate:integrity` reports 5 of 5 against the live rules, including that nobody can bypass them |

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
