# 10 · Roadmap & first milestone

**Status:** ✅ Done — **planning complete**; next: [M0 kickoff](M0-kickoff.md) · **Last updated:** 2026-09-20

## Summary
- Roadmap M0 → M6 approved (D-053). No fixed dates; quality first (D-054).
- **M0** sets up the repository, gates, CI, staging and monitoring, and ends
  with gate drills that prove every gate blocks.
- **M2** proves the core safety promise on the server before any screens.
- **M3** makes the app demo-able through internal TestFlight and Google Play
  testing.
- **M5** is go-live, gated by real-phone tests, the DPIA and the release gates.
- **Sessions are hybrid (D-055):** the Mac for setup, the spike and UI work;
  the cloud for everyday work. On the Mac, Claude runs under a separate
  Standard user with no admin rights (D-056).
- The owner's step-by-step start is in [M0-kickoff.md](M0-kickoff.md).

## Goal of this section
Turn Sections 1–9 into an ordered plan:
- milestones with objective exit criteria;
- a detailed first milestone that sets up the repository and **proves the gates
  work before any feature is built**;
- the owner actions each milestone needs, in time.

## Research findings — round 1

### 1. The app can be shown early without Apple's review
- TestFlight builds for internal testers (the owner's own App Store Connect
  team, up to 100 people) are available as soon as processing finishes. Builds
  for external testers need Apple's beta review for the first build in a group.
  Sources: https://docs.expo.dev/submit/testflight.md ·
  https://www.developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview
- External testing allows up to 10,000 testers, by email or a public link.
  Source: https://docs.thunkable.com/publishing-apps/publish-to-app-store-ios/testflight-overview
- **Implication:**
  - The owner can install and demo the app from milestone M3 as an internal
    tester, with no review wait.
  - The friends-and-family group are external testers, so the first build they
    get needs Apple's beta review. It is planned in M5, before go-live.

## Research findings — round 2: the Mac or Claude Code in the cloud?

### 2. Cloud sessions carry the whole setup and gates
- Claude Code on the web runs on Anthropic-managed cloud machines. Sessions
  keep running after the browser is closed and can be followed from the Claude
  mobile app.
  Source: https://code.claude.com/docs/en/claude-code-on-the-web.md
- Each session starts from a fresh clone of the repository. The repository's
  CLAUDE.md, rules, skills, agents, and the hooks and permission rules in
  `.claude/settings.json` all apply (for a single-repository session).
- The machine is Ubuntu 24.04 with Node 22, pnpm and Docker pre-installed, so
  the container-based integration tests can run.
- Limits are about 4 CPUs, 16 GB of memory and 30 GB of disk, and very heavy
  jobs may be stopped.
- Network access is limited to an allowlist (package registries, GitHub, cloud
  SDKs) unless you add domains.
- `git push` works only to the session's own working branch, which is an extra
  guard.
- On Pro and Max, API keys can be stored so that the session uses them without
  ever seeing them.
- Commits link back to the session transcript.
  Source (all of the above): https://code.claude.com/docs/en/cloud-environments
- **Claude's assessment (verify at setup):**
  - Cloud machines are Linux, so there is no iOS simulator. An Android
    emulator is unlikely.
  - Pushes go through a proxy with the owner's GitHub login. Pull requests
    must be opened with Claude's own account's token (A-06), so the owner's
    approvals still count (D-042).

### 3. Remote Control runs on your own machine
- A session on your own computer can be continued, and since August 2026
  started, from the phone. It uses the computer's own files and network (see
  Section 9). Closing the terminal ends it.
  Source: https://code.claude.com/docs/en/cloud-environments

## Mac vs cloud — pros and cons

| | **Your Mac (with Remote Control)** | **Claude Code in the cloud** |
|---|---|---|
| Must be kept on | Yes — asleep or closed means no work | No — runs on Anthropic's machines |
| Start and steer from the phone | Yes | Yes |
| Your gates (hooks, agents, skills) | Yes | Yes (from the repository) |
| Integration tests with Docker | Yes (install Docker) | Yes (pre-installed) |
| **iOS simulator and Android emulator** | **Yes** — Claude can run and debug UI tests itself, which is much faster than waiting for CI | **No** — UI tests only through CI |
| Access to your personal files | Possible — needs a separate macOS user to isolate | None — a fresh isolated machine every time |
| Resource limits | Your Mac's | About 4 CPUs and 16 GB |
| Parallel work later | Limited by one machine | Easy |
| Maturity | Stable | Research preview |

**Either way, nothing reaches `main` without passing CI**, so where a session
runs never changes what is allowed to merge.

### Recommendation: hybrid
- **Mac for M0 and M1, and for UI work (M3):** setting everything up, the
  emulator and simulator spike, and debugging screens. Run Claude under a
  **separate macOS user account** with no access to your personal files, with
  FileVault on.
- **Cloud for everyday work from M2:** server-side safety logic, contracts,
  docs, reviews, and anything else when the Mac is off.

## Principles for the order
1. **Prove the gates before building on them.** If a gate doesn't block, every
   later feature is unprotected. M0 ends with "gate drills".
2. **The core promise first, server-side.** The lost-contact alert (LOST-02) is
   the hardest and most important behaviour. It is built and proven with a
   simulated phone in M2, before any screens.
3. **Privacy and real-phone verification before real people.** Go-live (M5) is
   gated by D-041 (real-phone tests), PRIV-11 (DPIA) and RL-01 to RL-07.
4. **One feature at a time** (D-052).

## Milestones

| # | Milestone | Main content | Exit criteria (all automated) |
|---|-----------|--------------|-------------------------------|
| **M0** | Foundations | Repository, toolchain, Claude Code configuration, CI, merge rules, staging, monitoring, daily report | All INF tasks done; **gate drills pass**; CI green on `main`. The push to `main` and the merge without code-owner approval count as covered by `gate:integrity`'s live read until their live attempt at M5 (D-083) |
| **M1** | Spike (emulators and simulators) — ✅ **closed** (2026-10-01, D-088) | SPIKE-01, S1–S7 on emulators and simulators (D-037); location SDK in debug mode; Critical Alerts request drafted (STORE-01) | Spike results recorded; SDK go/no-go decision; Section 4 closed — all met |
| **M2** | Core safety loop (server) | State machine, watchdog, outbox, fake push and SMS; LOST-01 to LOST-03, LOST-06 to LOST-08, SM-01 to SM-10; staging canary (REL-10) | L6 tests green; mutation ≥ 80 %; the staging canary alerts on time for 24 hours |
| **M3** | App MVP (demo-able) | GRP-01 to GRP-04, CALL-01 to CALL-03, JRN-01 to JRN-06, LOST-04, LOST-05, HELP-01; real push to the owner's phone; SMS to the owner's own number only | L7 green on Android (every PR) and iOS (weekly); **the owner can show the app** via internal TestFlight and Google Play internal testing |
| **M4** | Privacy, security and compliance | PRIV-01 to PRIV-12 (retention jobs, export and delete, privacy notice in nb and en, age bands); SEC-01 to SEC-07; DPIA; Critical Alerts entitlement requested | Every PRIV and SEC ID covered by tests; DPIA in `docs/dpia/` |
| **M5** | Go-live readiness | Real-phone suite L9 on Firebase Test Lab (D-041); production environment (D-046, phase B); location SDK licence; Apple beta review; release 1.0 | RL-01 to RL-07 pass; owner approves the release pull request |
| **M6** | Private group phase | Friends and family use it for real; L10 monitoring; tuning ⚙️ thresholds; every failure becomes a test (D-035) | Reliability targets from Section 3 met for ⚙️ 4 weeks |

Before M5, the plan revisits: the Critical Alerts outcome, Google's 12-tester
rule (not needed with an organisation account), and the group's actual phones
(A-01).

## M0 — Foundations in detail

Each task has an ID so it flows through `/feature` like any requirement.

| ID | Task | Done when |
|----|------|-----------|
| INF-00 | Mac environment check: toolchain for the `claude-dev` user (D-056), see `M0-kickoff.md` | `pnpm run doctor` passes on the Mac |
| INF-01 | Monorepo skeleton: pnpm workspaces, Turborepo, strict TypeScript, shared lint and import-rule config | `pnpm gate:static` passes on the empty skeleton |
| INF-02 | Copy in the Claude Code configuration (`07b`) and write unit tests for every hook | `pnpm test:hooks` passes; `claude plugin validate .claude/agents` is clean |
| INF-03 | Gate scripts: `gate:file`, `gate:static`, `gate:quick`, `gate:full`, `req:coverage`, `tests:changes`, `coverage:ratchet`, `api:diff`, `mutation`, `licenses:check` | Each script has its own tests |
| INF-04 | CI workflows (`08b`), merge rules with no admin bypass, required checks, CODEOWNERS | `gate:integrity` confirms the rules through GitHub's API |
| INF-05 | Server skeleton: Hono + oRPC contract + health endpoint; Drizzle; Testcontainers; Graphile Worker; injected clock | Contract, integration and system test levels each have one passing example |
| INF-06 | App skeleton: Expo development build, Expo Router, nb and en translations, jest-expo, one Maestro flow | L5 and L7 (Android emulator) pass in CI |
| INF-07 | Staging on Clever Cloud via Terraform: one XS instance, DEV database, deploy workflow, smoke test | Merging to `main` deploys to staging and the smoke test passes |
| INF-08 | Monitoring: the worker checks in with Healthchecks.io; UptimeRobot watches the API; owner paging tested | A deliberately stopped worker pages the owner within 5 minutes |
| INF-09 | Daily status workflow and the owner-question issue template | The first daily report arrives on the owner's phone |
| INF-10 | **Gate drills:** automated tests that try to break each gate and expect to be blocked | All drills pass (see below) |

**Gate drills (INF-10).** Each drill is a scripted attempt that must fail:
- a pull request with a `.skip` added to a test (RG-03);
- a failing test (CI-03);
- a new acceptance criterion without a test (RG-01);
- a breaking API change (CI-06);
- `implementer` editing a test file (HK-02);
- a push to `main` (D-029);
- a hard-coded secret or a real-looking phone number (HK-07);
- a safety-path change without owner approval (CODEOWNERS);
- a blocking AI review verdict (CI-11).

If any drill *succeeds*, M0 is not done.

## Owner actions by milestone

| Needed by | Action | To-do ID |
|-----------|--------|----------|
| M0 | Repository on your paid GitHub account (public since 2026-09-28, D-089) | A-05 |
| M0 | Separate GitHub account for Claude, with write access (not admin) | A-06 |
| M0 | Clever Cloud account for the AS | A-04 |
| M0 | Expo account for the AS | A-07 |
| M0 | Healthchecks.io and UptimeRobot accounts, alerts to your phone | A-08 |
| M0 | Run `claude setup-token` and store the token as a repository secret (D-045) | A-09 |
| M0 | A computer that stays on for Claude Code sessions (Remote Control) | A-10 |
| M1 | Ask the group about their phones | A-01 |
| M1 | Apple Developer and Google Play accounts for the AS | A-02, A-03 |
| M3 | Firebase project for Android push; Apple push key | A-11 |
| M3 | SMS provider account (LINK Mobility) | A-12 |
| M5 | Buy the location SDK licence ($399) if the spike passed | A-13 |
| M5 | UptimeRobot Solo (60-second checks, about $12 a month), so REL-08's "every minute" holds for the API too; and decide whether Healthchecks.io Business ($20 a month, SMS and phone-call alerts) is worth it (D-079) | — (gate item, D-079) |
| M5 | The live gate drills: watch GitHub refuse a push to `main` and a merge without code-owner approval, run once from the Mac as `urso-agent` (D-082, D-083) | — (gate item, D-083) |

## Open questions for the owner

**Round 2 (asked 2026-09-20, answered):**
1. Where should the sessions run? (Recommendation: hybrid — the Mac for setup,
   the spike and UI work; the cloud for everyday work.)
2. On the Mac, should Claude run under a separate macOS user account?
   (Recommendation: yes. Claude then can't see your personal files, photos,
   keychain or browser sessions. It costs a few minutes to set up.)

**Round 1 (asked 2026-09-20, answered):**
1. Do you approve the milestone order M0 → M6? (Recommendation: yes. It proves
   the gates first and the core safety promise second, and keeps real people
   out until privacy and real-phone checks are done.)
2. Which computer will run the Claude Code sessions? (Integration tests need
   Docker locally, and the setup differs slightly between macOS, Windows and
   Linux. On Windows, Claude recommends running inside WSL.)
3. Is there a target date for showing the app (M3) or for go-live (M5)?
   (Recommendation: no fixed date — quality first. `/status` will show a
   forecast based on actual pace after M0 and M2.)

## Rounds

### Round 1 — 2026-09-20
- **Questions:** milestone order · which computer · target date.
- **Answers (owner):** approve M0 → M6 · "I have a Mac. Should it be used? We
  can also use Claude Code in the cloud. What are the pros and cons?" · no
  fixed date, quality first.
- **Outcome:** D-053 (roadmap) and D-054 (no fixed date) recorded. Mac and cloud
  compared above; the choice goes to round 2.

### Round 2 — 2026-09-20
- **Questions:** where sessions run · separate macOS user.
- **Answers (owner):** hybrid ("I will set up my Mac at home… tonight or
  tomorrow") · yes, a separate macOS user.
- **Outcome:** D-055 and D-056 recorded. `M0-kickoff.md` written: phone tasks
  for now, Mac setup, and the first prompt. INF-00 (Mac environment check) added
  to M0. **Section 10 closed; the planning phase is complete.**

## Next steps
Follow [M0-kickoff.md](M0-kickoff.md): Part 1 from the phone now, Part 2 at
the Mac, then paste the first prompt.
