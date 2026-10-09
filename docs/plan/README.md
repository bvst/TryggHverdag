# Planning hub — walk-home safety app (working title)

**Last updated:** 2026-10-09 · **Phase:** ✅ Planning complete → ✅ **M0 closed** (2026-09-29, D-083) → ✅ **M1 closed** (2026-10-01, D-088) → 🟡 **M2 in progress**: the core safety loop on the server; SM-01, BUG-10, BUG-12, BUG-14, BUG-15, LOST-01, BUG-18, LOST-02, LOST-03, BUG-23, BUG-24, LOST-06, LOST-07, BUG-29, SM-10 and BUG-41 done (D-090, D-115)

**Current section:** milestone M2, started 2026-10-01 with SM-01; task 8,
LOST-08 ("They're safe"), is in progress (D-090, D-115; the task list is in
[10-roadmap.md](10-roadmap.md)): the owner answered its two questions on
2026-10-09, each with the recommendation (D-125), and D-126 records the
delegated choices. SM-10, removing a responder, is done (#74,
2026-10-09; D-122 to D-124), with BUG-41, the mutation budget, in it.
LOST-07, SMS escalation, is done (#67,
2026-10-07; D-115 to D-117), with BUG-29, the mutation budget, in it.
A-33 is done (the owner): the SMS check is live on staging. LOST-06,
"I'm on it", is done (#66, 2026-10-07; D-113 and its amendment, D-114). LOST-03,
back in contact and "I'm home", is done (#64, 2026-10-06; D-110 to D-112),
with BUG-23 and BUG-24, two new advisories that failed the dependency audit,
in it. LOST-02, the lost-contact alert, is done
(#63, 2026-10-05; D-106 to D-109). BUG-18, three files that decide whether a
stopped watchdog is seen under the owner's approval and the safety review, is
done (#61, 2026-10-04; D-105). LOST-01, the
heartbeat, is done (#60, 2026-10-03; D-101 to D-103), and so is BUG-15, the
dependency audit's braces advisory (#59, 2026-10-03; D-104). SM-01 is done
(#53, 2026-10-02). BUG-10, the journey files under the owner's approval and the
safety review (D-092, D-094 to D-097), is done (#56, 2026-10-02); so are
BUG-12, the mutation gate's silent false green (D-098, D-099; #57), and
BUG-14, the test kit and the mutation check's own files under the owner and
the safety review (D-100; #58), both 2026-10-02. BUG-13 (`gate:full` miscounts
the steps that did not run after a failure) is queued for the owner to
schedule, and so are BUG-16 (`req:coverage` counts an ID named in a comment),
BUG-17 (the Android emulator sometimes stays in English past the wait),
BUG-19 (no test checks every owner-approval path keeps its owners), BUG-20
(graphile-worker's own logger prints its error object, past `log.ts`) and
BUG-21 (an Android script test's timing margin fails under full-suite load),
BUG-22 (the test-weakening check does not see the shared behaviour suites),
BUG-25 (an override in the unowned `pnpm-workspace.yaml` could hide an advisory),
BUG-26 (a lint run during a mutation run fails on Stryker's sandbox) and
BUG-27 (whether the worker's session limits are in force on a deploy is seen
only by chance) and BUG-28 (no test holds two journeys past the watchdog's
stuck threshold, so a waiting loop that stops early goes unseen).
M1 closed with all four roadmap items done:
SPIKE-01 (S1–S8), Section 4 closed with a conditional GO for the location SDK
(D-086, full results in [04b-spike-results.md](04b-spike-results.md)), and the
Critical Alerts entitlement request drafted
([critical-alerts-request.md](critical-alerts-request.md), D-087, STORE-01).
Open item (e), the public repository, is answered (D-089). Status:
[../progress.md](../progress.md) · Build log: [../progress/m2.md](../progress/m2.md)
(M1's: [../progress/m1.md](../progress/m1.md); M0's: [../progress/m0.md](../progress/m0.md))

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
| 4 | Tech stack: app framework, backend, maps/location, push (incl. background-location spike) | ✅ Done — SPIKE-01 ran ([spec](../specs/SPIKE-01.md), [results](04b-spike-results.md)); conditional GO for the location SDK (D-086) | [04-tech-stack.md](04-tech-stack.md) |
| 5 | Architecture & code structure — modularity, boundaries, how to change things safely | ✅ Done | [05-architecture.md](05-architecture.md) |
| 6 | Testing strategy & regression protection | ✅ Done | [06-testing-strategy.md](06-testing-strategy.md) |
| 7 | Claude Code setup: CLAUDE.md, subagents, skills, hooks, commands | ✅ Done (draft v0 files) | [07-claude-code-setup.md](07-claude-code-setup.md) · [07b files](07b-claude-code-files/README.md) |
| 8 | CI/CD, environments & releases (TestFlight, Play testing tracks) | ✅ Done (draft v0 files) | [08-cicd-releases.md](08-cicd-releases.md) · [08b files](08b-ci-files/README.md) |
| 9 | Development workflow & progress tracking — specs, definition of done, progress log | ✅ Done | [09-workflow-progress.md](09-workflow-progress.md) |
| 10 | Roadmap & first milestone | ✅ Done | [10-roadmap.md](10-roadmap.md) · [M0-kickoff.md](M0-kickoff.md) |

Legend: ⚪ Not started · 🟡 In progress · 🔵 Waiting for owner · ✅ Done

Decisions so far: [decisions.md](decisions.md)

**Milestone M0 is closed** (2026-09-29, D-083): every INF task is done, the
seven offline gate drills pass, and CI is green on `main`. The live attempt at
the two GitHub-only drills is an M5 go-live item.

**Milestone M1 is closed** (2026-10-01, D-088). SPIKE-01 ran on the Mac
(D-055), and Section 4 is closed: a conditional GO for the location SDK,
recorded as D-086, with full results in
[04b-spike-results.md](04b-spike-results.md). The Critical Alerts request is
drafted (D-087, STORE-01):
[critical-alerts-request.md](critical-alerts-request.md) holds the text and
the owner's steps to send it, due by M4 at the latest (**A-30**, above). All
five open items found while planning SPIKE-01 are now answered, including
(e), the public repository, recorded as **D-089** — see
[../progress/m1.md](../progress/m1.md). What stays open does not block M2:
D-086's conditions, A-30, and three `.claude/` configuration gaps, each
needing the owner's approval and an ID.

**Milestone M2 is in progress** (D-090): the core safety loop on the server
(state machine, watchdog, outbox, fake push and SMS; the staging canary), in
nine tasks (eight by D-090, one more by D-115), SM-01 first. Devices authenticate with a hashed per-device
credential until login arrives with GRP-01 (D-091). The journey files become
safety paths in BUG-10 (D-092, done). What Claude needs
from the owner: [../progress.md](../progress.md).

**Open for M4** (not an owner action, so not in the to-do table below; it sits
here so that M4's planning, which starts from this file and the roadmap's M4
row, finds it): **how long are journey records kept** (who walked, when, in
which state, and who followed)? The retention rule sets times for positions,
alerts and account data, not for the journey row. Recommendation (SM-01's spec,
the question at its end): delete a journey and its responder rows with its alert
records, 30 days after it ends. **Since LOST-01, the same question covers the
`heartbeats` rows:** a receive time about every 60 seconds and a battery level,
a timeline of the walker's activity that fits none of the retention rule's
three categories (positions, alert records, account data). Positions already
fall under the rule (24 hours after the journey ends). Decide it in M4, and
write it into the DPIA. **Since LOST-03** (D-110, D-112), a journey that ends
records when, in `journeys.ended_at`: that is what the retention rule's
24-hour clock for positions (PRIV-04) counts from. An `ENDED` journey whose
`ended_at` is null (one put in directly, never by the code) must be handled
loudly by the retention job, never skipped or deleted on a guess. The
stand-down messages, the withdrawn lost-contact messages and each alert's
`resolved_at` and `resolution` are alert records under the 30-day rule.
**Since LOST-06** (D-113, D-114), so are `alerts.acknowledged_by` and
`acknowledged_at` (who helped whom, and when) and the `ACKNOWLEDGED` notices.
`acknowledged_by` references `users`, so deleting a member who acknowledged
an alert that is still kept must deal with that reference first, as LOST-02
found for outbox rows. **Since LOST-07** (D-115, D-116), so are
`alerts.sms_raised_at` and the `LOST_CONTACT_SMS` outbox rows (who was texted,
and when); those rows reference `users` too. The DPIA must cover M3's SMS data
flow: the walker's name in clear through LINK Mobility (D-115), walkers under
18 included. **Since SM-10** (D-122, D-123), `alerts.round` and
`outbox.round` (how many times an alert went back to unacknowledged) are
alert records too, and so are the walker's `NO_RESPONDER` warnings: outbox
rows that name a journey (`outbox.journey_id`) and no alert, so a retention
job that deletes by alert would miss them. A responder removed during a
journey has their `journey_responders` row deleted at once, so the record of
who followed a journey no longer holds anyone removed from it, with two
exceptions that stay as alert records: messages already written to them, and
`acknowledged_by` on a resolved alert they had acknowledged (SM-10 keeps who
helped on record).

## Owner to-do
Things only the owner can do. Claude checks this list at the start of every
session.

| ID | Action | Why | Status |
|----|--------|-----|--------|
| A-01 | Ask the group which phones they use (iPhone or Android; brand and model) and who wants to join the private group | Which phone models the automated real-device tests cover; Google's 12-tester rule | ⬜ Open |
| A-02 | Enrol the AS in the Apple Developer Program: look up the AS's D-U-N-S number (Apple has a lookup tool), and check that the AS has a public website and an email address on its own domain | Test builds on iPhones; Critical Alerts request | ⬜ Open (D-027) |
| A-03 | Create a Google Play developer account for the AS (same D-U-N-S number) | Android test track | ⬜ Open (D-027) |
| A-04 | Create a Clever Cloud account for the AS | Hosting (D-025) | ✅ Done (2026-09-20) |
| A-05 | Create a repository on your paid GitHub account and give Claude Code access | Code and CI (D-029); public since 2026-09-28 (D-089) | ✅ Done (2026-09-20) |
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
| A-28 | Add `android-e2e` to the existing `main` ruleset's required checks (Settings → Rules → Rulesets → `main` → required status checks; edit the existing ruleset, do not import a second one), then re-run only the `gate-integrity` job on the INF-06 pull request. Open Dependabot pull requests will need a `@dependabot rebase` afterwards | INF-06 cannot merge otherwise: `gate:integrity` reads the branch's own `package.json` and goes red the moment `e2e:android` exists (D-042, D-060, CI-09) | ✅ Done (2026-09-28) — `android-e2e` is a required check on `main`, read back through the API; `gate-integrity` passed on #34 after it |
| A-29 | Request a 30-day trial key for the location SDK shortly before M3's demo (transistorsoft.com/shop/trials/new); owner's own phones only | M3's internal demo (TestFlight, Google Play internal testing) needs the SDK to run in a release build, without buying the $399 licence yet (D-086) | ⬜ Open — due M3 |
| A-30 | Send the Critical Alerts entitlement request ([`critical-alerts-request.md`](critical-alerts-request.md), Part D) once the Apple Developer account (A-02) exists | The app's lost-contact alert needs Apple's approval to break through a silenced iPhone (D-020, D-087, STORE-01) | ⬜ Open — due M4 at the latest |
| A-31 | In GitHub, **Settings → Code security**: turn on **Dependabot alerts** and **Dependabot security updates** (the setup guide, [`merge-rules.md`](merge-rules.md), says they are on; GitHub's API said on 2026-10-03: "Dependabot alerts are disabled for this repository") | Between pull requests nothing else watches the dependencies, and the audit now ignores two advisories that have no fix yet (D-093, D-104): alerts are what will say when braces or node-forge ships one (found in BUG-15's privacy review) | ⬜ Open |
| A-32 | In Healthchecks.io, add a check named `staging-sms`: **Period 1 minute, Grace 2 minutes**, alerts to the same place as the others. Save its ping URL as the `staging` environment secret `HEALTHCHECKS_SMS_URL` | A failed SMS pages you through its own check (D-115, LOST-07). Needed before LOST-07's `infra-staging` plan, which stops with "Invalid value for variable" without it | ✅ Done — the owner, 2026-10-07. Not verified from a session: the secrets API is refused here. LOST-07's `infra-staging` plan is the first real check |
| A-33 | After LOST-07 merges: run `infra-staging` with `plan`, then `apply`, and check within about 3 minutes that `staging-sms` has left `new` and shows a ping every minute, and that the worker's check still gets one ping a minute, not two (the two URLs must differ). **Do it straight after the merge's `deploy-staging` run:** the new code reads the worker's existing secret before any plan. If `staging-worker` pages first, read the worker's start lines in Clever Cloud's log for the staging app (the deploy job's log can end before them, BUG-27). A line beginning `worker: not checking in with Healthchecks.io: HEALTHCHECKS_WORKER_URL` means the watchdog is running and only its check-in stopped; the rest of the line says what is wrong with the secret. Re-copy it in the UUID form Healthchecks.io shows (`https://hc-ping.com/<uuid>`), then plan and apply. If the plan stops with "Invalid value for variable", read the message under it: it names the secret and what is wrong (D-116) | Puts the SMS check live. There is no live drill of a failing SMS in M2: staging has no journeys before task 9 (D-091) | ✅ Done — the owner, 2026-10-07: `infra-staging` plan (run 37678574920) and apply (run 37678702578, "Apply complete! Resources: 0 added, 1 changed", the app's environment, values hidden). Both ping URLs passed Terraform's UUID-only check. That `staging-sms` left `new` and each check gets one ping a minute is the owner's observation, not verified from a session (Healthchecks.io is not reachable from one) |

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
