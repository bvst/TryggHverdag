# 8 · CI/CD, environments & releases

**Status:** ✅ Done — draft v0 files in [08b-ci-files/](08b-ci-files/README.md) · **Last updated:** 2026-09-23

## Summary
- **Every local gate runs again in CI:** 11 required checks, including one
  status check per AI reviewer. Safety, privacy and the test auditor block
  merges (D-043).
- **Phased environments (D-046):** until go-live, only a low-cost staging
  exists (synthetic data, free DEV database, one small instance, about €5 a
  month). Production is created at go-live. Separation comes from structure,
  not from cost.
- **Releases:** the owner approves each release pull request; everything after
  that is automatic (D-047). iOS builds run on EAS, so no Mac is needed.
- **Monitoring:** two independent EU monitors — Healthchecks.io as a dead man's
  switch for the watchdog and canary, and UptimeRobot from outside.
- **Budget:** up to about €165 a month once real-phone tests switch on (D-048).
- Draft workflow files are in `08b-ci-files/` (D-049).

## Goal of this section
An automated path from pull request to testers to production, where:
- every local gate runs again, independently, in CI;
- releases are repeatable and reversible where possible;
- secrets never touch the repository or the app;
- nothing reaches real users without passing the gates.

## Research findings — round 1

### 1. Claude Code can review pull requests in CI using the Max subscription
- The official Claude Code GitHub Action accepts either an API key or an OAuth
  token tied to a Claude subscription (Pro, Max, Team or Enterprise). The token
  is generated locally with `claude setup-token`.
  Source: https://docs.claude.com/en/docs/claude-code/github-actions
- One user reported that subscription authentication failed after upgrading
  from Pro to Max, and only an API key worked.
  Source: https://github.com/anthropics/claude-code-action/issues/1281
- GitHub doesn't trigger workflows for commits made with the default workflow
  token. Pushes must use an app or bot token.
  Source: https://docs.claude.com/en/docs/claude-code/github-actions
- **Implication:** Blocking AI reviews (D-043) run in CI on the Max plan
  (D-045), with an API key as the fallback. Claude's own account (A-06) pushes,
  so CI always triggers.

### 2. GitHub Pro includes 3,000 CI minutes a month; macOS minutes count 10×
- Private repositories on GitHub Pro get 3,000 Actions minutes and 1 GB of
  storage per month.
  Source: https://docs.github.com/en/enterprise-server@3.15/get-started/learning-about-github/githubs-plans
- Linux minutes count 1×, Windows 2× and macOS 10×.
  Source: https://help.github.com/en/enterprise-cloud@latest/billing/managing-billing-for-github-actions/about-billing-for-github-actions
- Monthly-billed accounts have a default spending limit of $0, so CI simply
  stops when the minutes run out.
  Source: https://goo.gle/31h5f4P
- **Implication:** Run almost everything on Linux. Build iOS elsewhere. Set a
  small spending limit so CI doesn't stop mid-month (a stopped CI blocks merges,
  which is safe but halts all work).

### 3. Expo's build service handles iOS without a Mac
- Expo's free plan includes 15 Android and 15 iOS builds a month and 60 minutes
  of CI workflows. The Starter plan costs $19 a month plus usage and includes
  $45 of build credit.
  Source: https://expo.dev/pricing
- iOS builds use more credit than Android builds because they need macOS
  machines. The free plan has a 45-minute build timeout.
  Source: https://toolradar.com/tools/expo
- **Implication:** iOS builds and the weekly iOS simulator tests run on EAS.
  Android builds for pull-request UI tests run on GitHub's Linux runners. Start
  on the free plan; move to Starter if the queue or timeout becomes a problem.
  Builds contain no personal data (D-016 reasoning, Section 6).

### 4. EEA monitoring for the watchdog and the canary (REL-08, REL-10)
- Healthchecks.io works as a dead man's switch: the monitored system checks in
  on a schedule, and a missed check-in triggers an alert.
  Source: https://canary.healthchecks.io/faq/
- It is registered in Latvia with servers in Germany, and the free plan covers
  20 checks.
  Source: https://canary.healthchecks.io/docs/healthchecks_cronitor_comparison
- It is free for hobby projects and paid for commercial use.
  Source: https://mythos.one/me/brianswichkow/76da7f
  **Amended by D-079** (2026-09-25): checked against Healthchecks.io's own
  terms, FAQ and About page — this secondary-source claim does not hold as
  written.
- UptimeRobot, based in Slovakia, is an EU option for outside-in uptime checks.
  Source: https://eualternative.eu/service/healthchecks-io/
- **Implication:** Two independent monitors:
  - The watchdog checks in with Healthchecks.io every minute, and the canary
    checks in after each successful run. A missed check-in means "the safety
    system is down", and the owner is alerted by phone.
  - UptimeRobot checks the API from outside.

## Environments — phased (D-046)

**Phase A — now until go-live (no real users, so no production yet):**
- Only **staging** is deployed: synthetic data only, one XS instance running
  the API and worker together, and Clever Cloud's free DEV PostgreSQL.
  Estimated **about €5 a month**.
- The DEV database is free and meant for testing: lower performance, no
  backups, no extensions, no SLA.
  Source: https://www.clever.cloud/developers/doc/addons/postgresql/
- Reported limits are 256 MB and at most 5 connections, so connection pools
  must be small (API 2, worker 2).
  Source: https://gist.github.com/bmaupin/0ce79806467804fdbbf8761970511b8c?permalink_comment_id=5125231
- Demos ("showing the app") use preview builds that talk to staging.
- **Separation without cost:** staging lives in its own Clever Cloud
  organisation, with its own secrets, domain and app variant. When production
  is created, nothing is shared.
- **Known difference:** the DEV plan runs PostgreSQL 15 only. CI runs the
  integration tests on production's exact version, so migrations are always
  proven on the right version.

**Phase B — from go-live** (gates: real-phone tests on and passing, D-041;
DPIA written, PRIV-11):
- **Production** is created with a dedicated database (with backups) and
  separate API and worker instances.
- Staging keeps the free database and can be stopped outside test runs to save
  cost (billing is per second).

**All environments:**

| Environment | Purpose | Data | Where |
|-------------|---------|------|-------|
| local | Claude Code sessions; PostgreSQL in containers | Synthetic only | Owner's machine |
| ci | One per pull request, thrown away afterwards | Synthetic only | GitHub Actions |
| staging | Always-on copy of production: demos, UI tests, its own canary | **Synthetic only** | Clever Cloud (EEA), small instances |
| production | Real users | Real personal data | Clever Cloud (EEA) |

There are three app variants — development, preview (talks to staging) and
production — each with its own app ID, so they can be installed side by side on
one phone.

## Required checks on every pull request

| ID | Check | Gate |
|----|-------|------|
| CI-01 | Gate integrity: merge rules are active (read through GitHub's API), CODEOWNERS present, hook scripts' own tests pass | D-029, D-042 |
| CI-02 | Static: types, lint, import rules, formatting | L1 |
| CI-03 | Unit and property-based tests (server and app) | L2, L5 |
| CI-04 | Integration tests with real PostgreSQL (containers) | L3 |
| CI-05 | System tests: full flows with fakes and a controlled clock | L6 |
| CI-06 | API compatibility with every supported app version | L4, RG-08 |
| CI-07 | Requirement coverage, test-change detector, coverage ratchet | RG-01, RG-03, RG-04 |
| CI-08 | Mutation testing, always a fresh run, when safety paths or the run's inputs change | RG-05, D-036, D-098, D-099 |
| CI-09 | Android UI tests (Maestro on an emulator) against a test server | L7 |
| CI-10 | Security: dependency audit, secret scan, licence check | SEC-06 |
| CI-11 | AI reviews: safety, privacy and test-auditor are **blocking**; code and a11y-i18n are advisory | D-043 |
| CI-12 | A gate with nothing to check runs anyway, says so, and passes — it is never skipped | the rule below |

**CI-12, and why it is not a `paths:` filter.** A documentation-only change does
not need the unit, integration, system or contract suites, and running them costs
Actions minutes this repository pays for. The obvious implementations are both
wrong here:

- a **`paths:` filter** stops the workflow producing the check at all, and a
  required check that never reports leaves the pull request unmergeable for ever;
- a **job-level `if:`** reports the job as *skipped*, which GitHub counts as
  passing a required check — a green tick for work nobody did.

So the condition lives on **steps**, never on jobs. Every job still runs, asks
`scripts/affected.mjs` whether this diff holds anything it could fail on, and
either does its work or prints that it had nothing to check. `mutation` has
worked this way since INF-04 (`--only-if-safety-paths-changed`); CI-12
generalises it.

The classification is deliberately conservative: only markdown outside
`.claude/` and reviewer memory count as inert, because the cost of being wrong
is not symmetric. Running a gate that had nothing to find wastes a minute;
skipping one that did puts a defect on `main` with a green tick over it.
`CLAUDE.md` and everything else under `.claude/` are excluded — `scripts/ai-review.test.mjs`
reads the agent briefs and asserts on them, so editing one really can fail
`unit`.

**Scheduled:**
- Nightly: full mutation run, staging canary report, dependency update pull
  requests (they go through the same checks).
- Weekly and before each release: iOS simulator UI tests on EAS.
- Once switched on (D-041): the real-phone suite (L9).

## Deployment flow
1. **Merge to `main`** → the backend deploys to **staging** automatically:
   - database migrations run first, and are always backward-compatible
     (expand, then contract);
   - smoke tests run, and the staging canary keeps running.
2. **Release** → `release-engineer` opens a release pull request (version,
   plain-language release notes, the API snapshot in `released/`). It needs the
   owner's approval through CODEOWNERS (round 1, question 2).
3. **After merging the release pull request**, CI:
   - deploys the backend to **production** (blue/green on Clever Cloud) and
     checks the production canary;
   - builds both apps on EAS;
   - submits them to **TestFlight** and **Google Play testing**.
4. **Rollback:**
   - Backend: redeploy the previous version. The database is only ever fixed
     forward.
   - Installed apps can't be rolled back. That is why the server must keep
     serving older app versions (AR-08, CI-06).

## Release gates (proposed — they fill in `/release`)

| ID | Gate |
|----|------|
| RL-01 | Every required check is green on the release commit |
| RL-02 | The staging canary has been green for the last ⚙️ 24 hours |
| RL-03 | Real-phone suite (L9) green — required from the first release the group uses for real walks (D-041) |
| RL-04 | The released OpenAPI file is saved and becomes a CI-06 baseline |
| RL-05 | If data processing changed: the DPIA and privacy notice are updated (PRIV-11) |
| RL-06 | Plain-language release notes for testers |
| RL-07 | No open BLOCK findings; owner approval collected for safety paths |

## Secrets
- **Stored:** GitHub Actions secrets (for CI) and Clever Cloud environment
  variables (at runtime). Never in the repository, and never in the app bundle
  (anything in the app can be extracted).
- **Inventory:**
  - Apple push key and Google push credentials
  - SMS provider key
  - location SDK licence keys
  - login secret
  - database URLs
  - EAS token
  - `CLEVER_TOKEN`, `CLEVER_SECRET` — the staging CI user's Clever Cloud key
    (A-19). A user that is a Manager of the staging organisation and of
    nothing else; the key expires after a year. Stored as secrets of the
    GitHub environment `staging`, which only `main` can read (A-21, D-077).
    Production gets its own user and key at go-live
  - `CELLAR_KEY_ID`, `CELLAR_KEY_SECRET` — the Cellar add-on holding
    Terraform's staging state (A-20). Same store (A-21, D-077)
  - Healthchecks check-in URLs. Anyone holding one can keep its check green
    while the thing it watches is dead, so each is a secret:
    - `HEALTHCHECKS_DAILY_STATUS_URL` — the daily report's check. A repository
      secret (A-16, D-076)
    - `HEALTHCHECKS_WORKER_URL` — the staging worker's check. It is in three
      places: a secret of the GitHub environment `staging` (main only, A-21),
      the staging app's environment on Clever Cloud (set by Terraform), and in
      plain text in Terraform's state in Cellar, as the database password is
      (A-23, INF-08, D-079). Rotating it means a new check, not a new value:
      the steps are under "If the ping URL ever leaks" in
      [monitoring-setup.md](monitoring-setup.md)
  - Claude OAuth token
  - Claude's GitHub token (A-06)
  - `RULES_READ_TOKEN` — **normally not needed.** CI-01 reads the merge rules
    with the ordinary Actions token, which GitHub accepts (`metadata=read`).
    Only if that stops working: fine-grained, this repository only, Metadata:
    Read-only (A-15, D-062)
- **Rotation:** yearly, and immediately if a secret leaks. The secret scan
  (CI-10) plus the local hook (HK-07) make leaks unlikely.

## Versioning and dependencies
- The app uses semantic versioning, with build numbers managed by EAS. The API
  is versioned by path (`/v1`). An "oldest supported app version" list sets the
  CI-06 baselines.
- Dependabot opens update pull requests. Patch and minor updates auto-merge
  when all gates pass; major updates go through `/feature`-level review.

## Backups and restore (PRIV-04)
- Managed PostgreSQL backups are kept for a short time (⚙️ 7 days), because a
  backup still holds data that retention has deleted. This is recorded in the
  DPIA.
- A monthly automated restore drill restores into a temporary, isolated
  database inside the production environment, checks it, and deletes it. Real
  data never goes to staging.

## Accounts needed at setup (added to owner to-dos in Section 10)
Expo (for the AS) · Healthchecks.io and UptimeRobot · a Firebase project for
Android push (for the AS) · an Apple push key · the SMS provider (LINK
Mobility) · a Claude OAuth token (`claude setup-token`).

## Estimated monthly running cost

| Item | Estimate |
|------|----------|
| Clever Cloud production | €25–50 |
| Clever Cloud staging (small) | €15–25 |
| GitHub Actions beyond the included minutes | €0–10 |
| EAS | $0 (Starter: $19 if needed) |
| Healthchecks.io | $0–20 (paid if it counts as commercial use) |
| SMS | a few NOK |
| **Phase A total (until go-live)** | **about €5–10 a month** (staging only) |
| **Phase B total (from go-live)** | **about €80–120 a month**, including real-phone tests; within the €165 ceiling (D-048) |

## Open questions for the owner

**Round 1 (asked 2026-09-20, answered):**
1. Run a separate staging environment? (Recommendation: yes. It is the only
   safe place for demos, UI tests and a second canary without touching real
   data. It costs about €15–25 a month.)
2. How do production releases happen? (Recommendation: you approve each
   release pull request; everything after that is automatic.)
3. Once the real-phone tests switch on (D-041), the total is about €100–165 a
   month. Is that acceptable? (Recommendation: yes. It is the price of
   verifying on real phones before people rely on the app.)

## Rounds

### Round 1 — 2026-09-20
- **Questions:** staging environment · production releases · budget with
  real-phone tests.
- **Answers (owner):** "Yes, let's do that. But in the beginning I want
  separation but without the cost." · I approve each release PR · yes, up to
  about €165 a month.
- **Outcome:** D-046 to D-049 recorded. Phased environments designed: staging
  only until go-live, on a free database. CI workflow drafts written and
  validated, and `/release` filled in. Section 8 closed.

## Next steps
Section closed. Continue in [09-workflow-progress.md](09-workflow-progress.md).
