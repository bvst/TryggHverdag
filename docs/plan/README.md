# Planning hub — walk-home safety app (working title)

**Last updated:** 2026-10-27 · **Phase:** ✅ Planning complete → ✅ **M0 closed** (2026-09-29, D-083) → ✅ **M1 closed** (2026-10-01, D-088) → ✅ **M2 closed** (2026-10-23, D-142): the core safety loop on the server, all nine tasks done (D-090, D-115), closed on window B of REL-10-AC19, the staging canary on time for 24 hours, with BUG-63 open → 🟡 **M3 started** (2026-10-20, D-134): tasks 1 and 2 of 12 are done: GRP-01 (#96, squashed as `bd83b21` on 2026-10-21) and the home screen (GRP-02, CALL-01, CALL-02; #101, squashed as `05bfb73` on 2026-10-25, its step 1 #100, `50214c0`); task 3, start a journey (JRN-01, JRN-02, LOST-01's phone half), is next in D-134's order and not started; BUG-64, the dependency audit red on `main` after #101 merged, is done (#104, squashed as `35a3290` on 2026-10-26; the owner's answer is D-143, 2026-10-25); BUG-65 to BUG-67 and D-144 are done (#105, squashed as `57e3a3e` on 2026-10-27), BUG-69 is mitigated by D-144 with its check before pnpm queued, and BUG-68's `ci.yml` part is done (#106, squashed as `67492e5` on 2026-10-27, after `urso-agent` approved it: the ten installs take `--ignore-scripts`), with its `ai-review.yml:180` part open, to batch with Dependabot #102 (a hand merge, D-075); BUG-70 is open (`android-e2e` failed once on #106's branch, cause not known; the fix, which makes the next failure print its screen, is written and reviewed on the session branch and goes in the pull request after #106); `deploy-staging` failed on `main` at `67492e5` on a cut-off git push to Clever Cloud (not re-run; no bug number); A-03, the Google Play account, is done (the owner, 2026-10-27); [../progress.md](../progress.md) has where the rest stands

**Current section:** milestone M3, started 2026-10-20 (D-134). **Milestone M2
is closed** (2026-10-23, D-142). It started 2026-10-01 with SM-01; all nine
tasks are done (D-090, D-115; the task list is in
[10-roadmap.md](10-roadmap.md)). Task 9, REL-10 (the staging canary), is done
(#77, 2026-10-10; D-127 and D-128), and the owner's A-35 is done. The owner
chose on 2026-10-22 to close M2 on window B of REL-10-AC19 (12:22:54 UTC on
2026-10-21 to the same time on the 22nd): 96 `canary_run` lines in Clever Cloud's
log, all `ON_TIME`, the largest gap 15.04 minutes and the largest `alertMs`
310 041 ms; Healthchecks.io's log was seen for the last 28 of those 96 runs, all
OK, and not before (the owner can no longer see back that far). The meaning is
D-127's: the alert reaches the push port on time. **BUG-63 is open:** staging's
API gave the canary no answer three times on 2026-10-21 and the cause is unknown;
whether the API should log one line per request is the owner's question
([../progress.md](../progress.md)). D-142 also corrects D-128: a canary whose
"I'm home" fails does escalate and does page the SMS check.
**M3's order is decided** (D-134, 2026-10-20): twelve tasks, GRP-01 first,
sign-in without SMS first, one task at a time; the demo may use the owner's
own data on staging (D-135). The task list is in [10-roadmap.md](10-roadmap.md).
**GRP-01, task 1, is done:** [#96](https://github.com/bvst/TryggHverdag/pull/96)
was squash-merged as `bd83b21` on 2026-10-21, after `urso-agent` approved it, and
its `deploy-staging` (run 39557013621) passed. Step 1 was #94 (`60b46ee`); the
owner's five answers are D-136, the delegated choices D-137 and the app's plain
`fetch` client D-138; the record is [../progress/m3.md](../progress/m3.md).
**GRP-02, CALL-01 and CALL-02, task 2, the home screen, is done:**
[#101](https://github.com/bvst/TryggHverdag/pull/101) was squash-merged as `05bfb73`
on 2026-10-25, after `urso-agent` approved it. Its three specs are settled on the
owner's answers (D-141, 2026-10-22), and its step 1, which makes four folders of
`apps/mobile` (`src/features/call/`, `src/shared/ui/`, `src/app/` and `e2e/`)
code-owner and safety-review paths, was merged as #100 (`50214c0`, 2026-10-22). The
owner kept the 112 button's name on WCAG 2.5.3 (2026-10-23). **`main`'s dependency
audit was red from #101's merge until BUG-64** (two high advisories, one in zod and
one in undici, published or changed in npm's data after #101's last green run). The
owner answered on 2026-10-25 (D-143): fix what has a patch, and accept
GHSA-mrhx-c7xc-m3w5 for Expo's tool's own zod only. BUG-64 is done: #104 was
squash-merged as `35a3290` on 2026-10-26, after `urso-agent` approved it, and
`main`'s `ci` run (40279208647) succeeded, `security` included. The next task is
task 3 in D-134's order, start a
journey (JRN-01, JRN-02, LOST-01's phone half). The owner's other part is A-36
(below): its plan and apply are done (2026-10-21), and the join in the app is left.
The code-owner question from
#96 (the owner's question 1) is answered, D-139: eleven sign-in files got a code
owner in #98 (`a2457b5`, 2026-10-21).
Bugs found and fixed since the last update (2026-10-10), with the pull request
and its squash commit: BUG-43 (a test picked an outbox row by random order;
#79, `85426bf`, which carried REL-10's record), BUG-42 and BUG-26 (the gate's
lint read Stryker's sandbox; both in #82, `69370a2`), BUG-45 (the mutation check
as one CI job per group; #83, `9cc74b7`), BUG-46 (four gates passed quietly on a
base git cannot resolve; #84, `595c584`), BUG-48 (the stop and progress hooks
did the same; #85, `85aa8fb`), BUG-47 (no test pinned which folders
`req:coverage` treats as product code; #86, `f1bfb5e`), BUG-44 (no test held
that `startWorker` hands the canary its real wait; #87, `111815d`) and BUG-21
(three Android-script tests failed under load on a correct script; #88,
`0c0b239`, 2026-10-18) and BUG-34 (the worker's start hung silently on a
database that never answers; #89, `1151d18`, 2026-10-18) and BUG-28 (no test held
two journeys past the watchdog's stuck threshold; #90, `c94e908`, 2026-10-18) and
BUG-51 (a query the database never answered held a sweep for ever; #92,
`0df5737`, 2026-10-19, D-132) and BUG-52 (`gate:file` checked nothing for an
edited L6 or L3 test file, and exited 1; #93, `20af31a`, 2026-10-20, D-133)
and BUG-61 (a new `vite` advisory failed the dependency audit; fixed in
GRP-01's #96, `bd83b21`, 2026-10-21) and BUG-17 (the Android emulator sometimes
stayed in English past the wait; `e2e:android` now switches it to bokmål itself;
#99, `3d2255c`, 2026-10-22, D-140) and BUG-64 (a new zod advisory and an undici one
failed the dependency audit on `main`; #104, `35a3290`, 2026-10-26, D-143) and
BUG-65, BUG-66 and BUG-67 (the audit-settings check read `pnpm-workspace.yaml` and
`.npmrc` as text where pnpm decodes them, and a `registry=` line or a `registries:`
key redirects the audit; each is caught by a test; [#105](https://github.com/bvst/TryggHverdag/pull/105),
squashed as `57e3a3e` at about 05:59 UTC on 2026-10-27, after `urso-agent` approved
it, with D-144).
**BUG-69 is mitigated, not closed:** one line in `pnpm-workspace.yaml` or `.npmrc`, or a
root `.pnpmfile.cjs`, makes `pnpm run` run nothing, so every CI check goes green
(`privacy-security-reviewer`'s BLOCK on #105, open on `main` before it). D-144, merged
in #105, gives six pnpm files the owner as code owner and names the workspace's five
packages by folder; the owner's review of those files counts from `57e3a3e` and is a
person, not a check that runs. Its check before pnpm, a dependency-free Node script
that runs ahead of the first pnpm command in every job that gates a merge, is queued
as its own pull request. **BUG-68's `ci.yml` part is done: [#106](https://github.com/bvst/TryggHverdag/pull/106)
is squashed as `67492e5` (2026-10-27), after `urso-agent` approved it; its `ai-review.yml:180` part is open**
(a workspace package's install script ran in CI before the audit and every other
check): `--ignore-scripts` on the ten installs in `ci.yml`, with `test-author`'s tests
(`576efa4`) and a change to the CI-03 drill that the flag made necessary (`753553e`; it
also explains the old jest-expo drill failure in `progress/m2.md`), the fix in `258941a`;
`ci` run 40493742910 on `main` at `67492e5` succeeded, `android-e2e` included, the first run on `main` of a flagged install.
`ai-review.yml:180`'s install goes in a separate batch with Dependabot #102, a hand merge under D-075 (that batch must get
opened; #102 also edits `daily-status.yml`); `daily-status.yml:81` runs on a schedule and by hand (`workflow_dispatch`, with the
Claude secrets), so it is not only `main`'s reviewed code, and it gets the flag the next time that file is touched.
**BUG-70 is open:** `android-e2e` failed on #106's branch (`00542de`, run 40469535686) at `first-contact`'s
first wait for the call button, with the phone awake and the app's package focused, and which screen the app showed is
unknown. The fix is evidence, not a cause: a failed Maestro run prints its screen as translation keys and resource IDs
(`scripts/lib/screen-dump.mjs`, `scripts/e2e-android.mjs`). It is written and reviewed on the session branch (red `182c8ad`,
`dd2b182`, `51ced5d`, `00049da`; green `d88a877`, `749bfc9`, `c50d5c6`; 160 of 160 tests pass in the four files; the in-session
reviews of `d88a877`, `code-reviewer`, `privacy-security-reviewer` and `test-auditor`, and `safety-reviewer`'s of `b44a986`, all
PASS) and goes in the pull request after #106, not opened
yet: `gate:full` has not completed on this head. Whether uiautomator can read the screen right after Maestro exits on CI's
emulator is not verified; the cause stays open until a failure prints its screen. **`deploy-staging` failed on
`main` at `67492e5`** (run 40493742912, the "Deploy" step): the coordinating session read the job's log, and the git push of the
source to Clever Cloud was cut off about a second in ("unexpected disconnect while reading sideband packet"). One transport
failure, outside this repository's code; not re-run, the next merge to `main` deploys again; no bug number, one to be given if it
happens again. Whether staging serves `57e3a3e` now was not checked. Detail: `progress.md` ("In flight") and `progress/m3.md`.
Queued for the owner to schedule: BUG-13 (`gate:full` miscounts the steps that
did not run after a failure), BUG-16 (`req:coverage` counts an ID named in a
comment), BUG-19 (no test checks every owner-approval path keeps its owners),
BUG-20 (graphile-worker's own logger prints its error object, past `log.ts`),
BUG-22 (the test-weakening check does not see the shared behaviour suites),
BUG-25 (an override in `pnpm-workspace.yaml` could hide an advisory; D-144
gave the file a code owner in #105, `57e3a3e`, and no test yet pins the
lockfile's `link:` and `file:` resolutions), BUG-27 (whether the worker's session limits are in force on a deploy
is seen only by chance), BUG-35 (a
second stop signal ends the process before the pool is closed) and BUG-40
(`affected.mjs` counts the agent-memory files and `decisions.md` as inert, so
CI's `unit` job is skipped for a change to only them), BUG-53 (two hooks fail
open when the repository code they import cannot load), BUG-54 (the
test-weakening check reads the word "fit" as a focused test), BUG-55 (a gate
that hangs leaves its node process running past the post-edit hook's limit),
BUG-56 (guard-bash judges the quoted pieces of a path one by one, so a
joined path escapes it), BUG-57 (`api.ts`, whose middleware decides full versus
walker-only access, is mutated by no run), BUG-58 (guard-bash refuses a
`git commit` line with `-n` anywhere after it, and any command that only
mentions its rule), BUG-59 (the post-edit hook checks a file outside the
repository and reports false failures) and BUG-60 (test-author's shell guard
does not mirror its Edit hook's allow-list; BUG-57 to BUG-60 came from GRP-01,
and BUG-58 to BUG-60 are in `.claude/`) and BUG-62 (`pnpm audit` reports a
moderate advisory in `hono`, GHSA-5r4p-p66f-jhc7, patched in 4.13.11; not
exploitable in the API today, which does not use `serveStatic`). For the owner
to decide:
BUG-49 (moving `origin/main` gets a session past the stop and progress hooks;
its fix is in `.claude/`, which needs the owner's approval), BUG-50 (no test checks that
`req:coverage --fail-on-uncovered-changed` leaves changed test files out of
product code) and BUG-63 (staging's API gave the canary no answer three times
on 2026-10-21, and the API writes no per-request log to say why; the log line
Claude proposes touches `apps/server/src/log.ts`, which needs the owner). The owner starts `/bugfix` and `/feature` (the session was
refused starting `/bugfix` itself on 2026-10-14; see
[../progress/m2.md](../progress/m2.md), BUG-44). LOST-08, "They're safe",
is done (#75, 2026-10-09; D-125 and D-126). SM-10, removing a responder, is done (#74,
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
the safety review (D-100; #58), both 2026-10-02.
M1 closed with all four roadmap items done:
SPIKE-01 (S1–S8), Section 4 closed with a conditional GO for the location SDK
(D-086, full results in [04b-spike-results.md](04b-spike-results.md)), and the
Critical Alerts entitlement request drafted
([critical-alerts-request.md](critical-alerts-request.md), D-087, STORE-01).
Open item (e), the public repository, is answered (D-089). Status:
[../progress.md](../progress.md) · Build log: [../progress/m3.md](../progress/m3.md)
(M2's: [../progress/m2.md](../progress/m2.md); M1's: [../progress/m1.md](../progress/m1.md); M0's: [../progress/m0.md](../progress/m0.md))

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

**Milestone M2 is closed** (2026-10-23, D-142; started 2026-10-01 under D-090):
the core safety loop on the server (state machine, watchdog, outbox, fake push
and SMS; the staging canary), in nine tasks (eight by D-090, one more by D-115),
SM-01 first. Devices authenticated with a hashed per-device credential until
login arrived with GRP-01 (D-091). The journey files became safety paths in
BUG-10 (D-092, done). The story is in [../progress/m2.md](../progress/m2.md);
what Claude needs from the owner is in [../progress.md](../progress.md).

**Milestone M3 has started** (2026-10-20, D-134): the app MVP, demo-able, in
twelve tasks, one at a time, GRP-01 first. GRP-01 (sign-in and groups) is done:
#96, squashed as `bd83b21` on 2026-10-21. Its record is
[../progress/m3.md](../progress/m3.md); the owner's part is A-36: its plan and
apply are done, and the join in the app is left. Task 2, the home screen, is done
too: #101, squashed as `05bfb73` on 2026-10-25 (D-141; step 1 was #100,
`50214c0`). BUG-64, the dependency audit red on `main` after it, is done
(#104, `35a3290`, 2026-10-26; the owner's answer is D-143), and so are BUG-65 to
BUG-67 with D-144 (#105, `57e3a3e`, 2026-10-27: six pnpm files need the owner's
approval). BUG-69 is mitigated by D-144, BUG-68's `ci.yml` part is done (#106, `67492e5`, 2026-10-27) and its `ai-review.yml:180`
part is open, BUG-70 (one `android-e2e` failure, cause not known) is open, `deploy-staging` failed on `main` at `67492e5` on a
cut-off git push to Clever Cloud (not re-run), and A-03, the Google Play account, is done (the owner, 2026-10-27).
Task 3, start a journey, is next in D-134's order:
[../progress.md](../progress.md).

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
helped on record). **Since LOST-08** (D-125, D-126), a journey can end
`SAFE` (closed by the responder who acknowledged) or `EXPIRED` (24 hours after
its alert opened), and its alert resolves the same way, with `SAFE` and
`EXPIRED` stand-downs in the outbox: alert records under the 30-day rule. Who
closed a journey is the `acknowledged_by` of its alert resolved `SAFE`, so
that field is how the record names the closer. **Since REL-10** (D-128), each
staging canary run leaves synthetic rows (a journey, its responder row, a
heartbeat, an alert and two outbox messages), about 580 a day, plus two fixed
`users` rows and one `devices` row written once; they are kept until M4's
retention job, which must delete the run rows by `CANARY_WALKER_ID` and never
the canary's two users or its device (the worker registers them once per
process, on its first canary run, so deleting them stops the canary until it
restarts), and M6's reliability figures leave the same rows out by the same
ID. **Since GRP-01** (D-136, D-137), the group adds account data the
retention rule and the DPIA must name, and the data-rights rule must be able
to erase: `memberships.display_name` (the name a person typed for
themselves; deleted with the membership when the admin removes them);
`invitations.created_by`, `used_by`, `used_at` and `join_key_hash` (who
invited whom, and when, kept after the invitation is used or expires;
`created_by` and `used_by` reference `users` too);
`groups.bootstrap_join_key_hash` (the SHA-256 of the first admin's join key,
kept so the first join can be retried); the
`audit_log` rows (`GROUP_CREATED`, `INVITATION_CREATED`, `MEMBER_REMOVED`:
who did what to whom, and when), whose `actor_id` references `users`, so
erasing a user who ever acted as admin is blocked until that reference is
dealt with, as LOST-02 found for outbox rows; and a removed member's `users`
and `devices` rows, which stay after the removal (journeys, alerts and
messages reference them), with a device's credential hash that no longer
authenticates. Neither the removal nor anything else in M3 deletes them.

## Owner to-do
Things only the owner can do. Claude checks this list at the start of every
session.

| ID | Action | Why | Status |
|----|--------|-----|--------|
| A-01 | Ask the group which phones they use (iPhone or Android; brand and model) and who wants to join the private group | Which phone models the automated real-device tests cover; Google's 12-tester rule | ⬜ Open |
| A-02 | Enrol the AS in the Apple Developer Program: look up the AS's D-U-N-S number (Apple has a lookup tool), and check that the AS has a public website and an email address on its own domain | Test builds on iPhones; Critical Alerts request | ✅ **Done** — the owner, 2026-10-20: the AS is enrolled (D-027) |
| A-03 | Create a Google Play developer account for the AS (same D-U-N-S number) | Android test track | ✅ **Done** (D-027) — the owner, in session, 2026-10-27: "A-03 er gjort: Google Play-kontoen er reaktivert, den tilhører AS-et med samme D-U-N-S-nummer" (A-03 is done: the Google Play account is reactivated, and it belongs to the AS with the same D-U-N-S number). That answers the wait on Google that began when the owner asked on 2026-10-20 about an earlier account: the earlier account was reactivated, so the fallback, a new account made with the AS's Workspace user, is not needed. The row asked for an **organisation** account; that follows from the account belonging to the AS under its D-U-N-S number. The owner did not state the account's name, type or verification status, so none is recorded, and a session cannot check them. No longer a blocker for M3's task 12 (D-134) |
| A-04 | Create a Clever Cloud account for the AS | Hosting (D-025) | ✅ Done (2026-09-20) |
| A-05 | Create a repository on your paid GitHub account and give Claude Code access | Code and CI (D-029); public since 2026-09-28 (D-089) | ✅ Done (2026-09-20) |
| A-06 | Create a separate GitHub account for Claude (a "machine user"), add it to the repository with write access (not admin), and give Claude Code its token | Your approvals count as real approvals, and the merge rules can't be bypassed (D-042) | ✅ Done (2026-09-20) |
| A-07 | Create an Expo account for the AS | iOS builds without a Mac; app builds and store submission (Section 8) | ✅ Done (2026-09-20) |
| A-08 | Create Healthchecks.io and UptimeRobot accounts, with alerts to your phone | Get paged if the safety system stops (REL-08) | ✅ Done (2026-09-26) — both alert by email, which the owner accepts for now (2026-09-28); UptimeRobot's monitor was A-25 |
| A-09 | Run `claude setup-token` and save the token as the repository secret `CLAUDE_CODE_OAUTH_TOKEN` | AI reviews and the daily report in CI (D-045, D-050) | ✅ Done — 2026-09-23. `CLAUDE_CODE_OAUTH_TOKEN` is set and `ANTHROPIC_API_KEY` is not |
| A-10 | Set up the Mac: separate `claude-dev` Standard user, FileVault, no sleep on power, shared tools — see [M0-kickoff.md](M0-kickoff.md) Part 2 | Hybrid sessions (D-055, D-056) | ✅ Done (2026-09-25) — `pnpm run doctor` passes 9 of 9 (INF-00); `claude-dev` is on GitHub as `urso-agent` only |
| A-11 | Create a Firebase project for the AS (Android push), and an APNs authentication key in the Apple Developer account (iPhone push). The secret names and the exact steps come with M3's push task | M3's task 6, real push to your phone (D-134). Firebase brings a data flow to Google, so its data processing terms belong with it (D-016, PRIV-06) | ⬜ Open — needed before M3's task 6 |
| A-12 | Create an SMS account with LINK Mobility for the AS, and sign its data processing agreement | M3's task 10: SMS escalation and the SMS sign-in code, sent only to your own number on staging (D-134, D-135, LOST-07) | ⬜ Open — needed before M3's task 10 |
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
| A-31 | In GitHub, **Settings → Code security**: turn on **Dependabot alerts** and **Dependabot security updates** (the setup guide, [`merge-rules.md`](merge-rules.md), says they are on; GitHub's API said on 2026-10-03: "Dependabot alerts are disabled for this repository") | Between pull requests nothing else watches the dependencies, and the audit now ignores three advisories that have no fix yet (D-093, D-104, D-143): alerts are what will say when braces, node-forge or a patched zod 3.x for `@expo/cli` ships one (found in BUG-15's privacy review). GitHub's API answered 403 "Dependabot alerts are disabled for this repository" on 2026-10-25 and again on 2026-10-26 | ⬜ Open |
| A-32 | In Healthchecks.io, add a check named `staging-sms`: **Period 1 minute, Grace 2 minutes**, alerts to the same place as the others. Save its ping URL as the `staging` environment secret `HEALTHCHECKS_SMS_URL` | A failed SMS pages you through its own check (D-115, LOST-07). Needed before LOST-07's `infra-staging` plan, which stops with "Invalid value for variable" without it | ✅ Done — the owner, 2026-10-07. Not verified from a session: the secrets API is refused here. LOST-07's `infra-staging` plan is the first real check |
| A-33 | After LOST-07 merges: run `infra-staging` with `plan`, then `apply`, and check within about 3 minutes that `staging-sms` has left `new` and shows a ping every minute, and that the worker's check still gets one ping a minute, not two (the two URLs must differ). **Do it straight after the merge's `deploy-staging` run:** the new code reads the worker's existing secret before any plan. If `staging-worker` pages first, read the worker's start lines in Clever Cloud's log for the staging app (the deploy job's log can end before them, BUG-27). A line beginning `worker: not checking in with Healthchecks.io: HEALTHCHECKS_WORKER_URL` means the watchdog is running and only its check-in stopped; the rest of the line says what is wrong with the secret. Re-copy it in the UUID form Healthchecks.io shows (`https://hc-ping.com/<uuid>`), then plan and apply. If the plan stops with "Invalid value for variable", read the message under it: it names the secret and what is wrong (D-116) | Puts the SMS check live. There is no live drill of a failing SMS in M2: staging has no journeys before task 9 (D-091) | ✅ Done — the owner, 2026-10-07: `infra-staging` plan (run 37678574920) and apply (run 37678702578, "Apply complete! Resources: 0 added, 1 changed", the app's environment, values hidden). Both ping URLs passed Terraform's UUID-only check. That `staging-sms` left `new` and each check gets one ping a minute is the owner's observation, not verified from a session (Healthchecks.io is not reachable from one) |
| A-34 | **Before the plan:** in Healthchecks.io, add a check named `staging-canary`, **Period 15 minutes, Grace 20 minutes**, alerts to the same place as the others. Save its ping URL, in the UUID form Healthchecks.io shows (`https://hc-ping.com/<uuid>`), as the `staging` environment secret `HEALTHCHECKS_CANARY_URL`. Never another check's URL. About 3 minutes | A failed or stopped canary pages you through its own check (D-127 Q3, D-128, REL-10). Needed before REL-10's `infra-staging` plan, which stops with "Invalid value for variable" without it | ✅ **Done** — 2026-10-20: `staging-canary` created and its ping URL saved as the `staging` secret; the plan then read it |
| A-35 | **After the merge:** straight after the merge's `deploy-staging`, run `infra-staging` with `plan` (it shows the app's environment changing and a new `random_password`, values hidden), then `apply`. Within about 21 minutes check that `staging-canary` has left `new` and shows a success ping. 24 hours later, report the window, the number of success and failure pings, any down event, and the largest `alertMs` in the `canary_run` lines of Clever Cloud's log. If the plan stops with "Invalid value for variable", the message names the secret. Until the apply, the deployed worker says at start that the canary is not running: expected | Puts the staging canary live and records M2's exit: the canary runs on time for 24 hours (D-090, D-127 Q1, REL-10-AC19). Only you can read Healthchecks.io and Clever Cloud's log | ✅ **Done** — 2026-10-23, and M2 is closed (D-142). **Plan and apply, 2026-10-20:** plan run 39381315279 ("1 to add, 1 to change"), apply run 39381374851 ("Same plan as the one read in run 39381315279"; "Apply complete! Resources: 1 added, 1 changed, 0 destroyed." at 06:36:55 UTC). **The reading:** window A (from the apply) did not count, because the outage of 2026-10-21 (BUG-63) broke it. The owner chose on 2026-10-22 to close on **window B**, 12:22:54 UTC on 2026-10-21 to the same time on the 22nd. Clever Cloud, the owner's lines (68 sent on the 22nd, 28 on the 23rd): 96 `canary_run` lines, all `ON_TIME`, the largest gap 15.04 minutes, the largest `alertMs` 310 041 ms, at 09:35:20 UTC on 2026-10-22. Healthchecks.io `staging-canary`: pings #186 to #219 seen, every one OK, of which #186 to #213 (05:35 to 12:20 UTC on the 22nd) are inside the window; the owner can no longer see back past 07:35 Norwegian time on the 22nd, so the first 68 runs' pings were not seen. The figures are the owner's, counted by the coordinating session and again by the session that wrote D-142. The full account: [../progress/m2.md](../progress/m2.md) |
| A-36 | **GRP-01 has merged (`bd83b21`) and its `deploy-staging` passed (run 39557013621, 06:45:21 UTC on 2026-10-21). The plan and apply are done (below); the join is yours:** read `ADMIN_BOOTSTRAP_CODE` once from the staging app's environment variables in Clever Cloud's console, and join in the app on your own phone with that code and your name. You become the group's admin; for anyone else the code stops working the moment the group exists. **Open, checked 2026-10-20: how the app gets onto your phone.** Nothing in the repository builds it for a phone before M3's task 12 (`apps/mobile` has no `eas.json`; CI's `android-e2e` build is for the emulator). The route that exists is a development build made on the Mac (INF-06-AC16); the app talks to staging unless `EXPO_PUBLIC_API_URL` says otherwise. Tell Claude if you want the steps written before you do it. If the join gets no answer or a server error, use the screen's retry: it sends the same join again and works while you are the only member. Never share the code or put it anywhere else; if it leaks, see "If `ADMIN_BOOTSTRAP_CODE` leaks" in [monitoring-setup.md](monitoring-setup.md). If the console does not show the value, say so: that was not checked from a session | Nobody can join without an invitation, and nobody exists yet to invite you: the bootstrap code makes you the first member and admin (D-136, answer 1; GRP-01). Only your own data goes on staging (D-135) | 🟡 **Plan and apply done, 2026-10-21; the join is still to do.** **Plan:** run 39564821518 (job 119104478062), "Plan: 1 to add, 1 to change, 0 to destroy." The staging app's `environment` and the bootstrap code's `base64` and `hex` print as "(sensitive value)", and no code appears in the log; the only long hex string is the plan fingerprint `92bd5a13…`, a SHA-256. **Apply:** run 39564903393 (job 119104742624), "Same plan as the one read in run 39564821518: 92bd5a13…", then "Apply complete! Resources: 1 added, 1 changed, 0 destroyed." at 07:51:29 UTC on 2026-10-21. Both come from the coordinating session's reading of the job logs. **Not verified from a session:** that the API now logs "api: the first admin can join with ADMIN_BOOTSTRAP_CODE while no group exists." (the line in `apps/server/src/bin/api.ts`); a session cannot read Clever Cloud's log. **Still the owner's:** reading the code in the console, and the join on the phone, which needs a development build from the Mac |

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
