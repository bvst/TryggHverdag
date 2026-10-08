# Progress log

**Last updated:** 2026-10-08 · **Milestone:** M2 started (2026-10-01, D-090): the core safety loop on the server, nine tasks (D-115 added one), **SM-01 done** ([#53](https://github.com/bvst/TryggHverdag/pull/53), `2db7046`), with BUG-11 in it; **BUG-10 done** ([#56](https://github.com/bvst/TryggHverdag/pull/56), `348f620`); **BUG-12 done** ([#57](https://github.com/bvst/TryggHverdag/pull/57), `a47334f`; D-098, D-099); **BUG-14 done** ([#58](https://github.com/bvst/TryggHverdag/pull/58), `34bc460`; D-100); **BUG-15 done** ([#59](https://github.com/bvst/TryggHverdag/pull/59), `c46b3b3`; D-104); **LOST-01 done** ([#60](https://github.com/bvst/TryggHverdag/pull/60), `fe384c5`; D-101 to D-103); **BUG-18 done** ([#61](https://github.com/bvst/TryggHverdag/pull/61), `7e05c8e`; D-105); **LOST-02 done** ([#63](https://github.com/bvst/TryggHverdag/pull/63), `5cd5d24`; D-106 to D-109); **LOST-03 done** ([#64](https://github.com/bvst/TryggHverdag/pull/64), `57502b8`; D-110 to D-112), with BUG-23 and BUG-24 in it; **LOST-06 done** ([#66](https://github.com/bvst/TryggHverdag/pull/66), `e695e8a`; D-113, D-114); **LOST-07 done** ([#67](https://github.com/bvst/TryggHverdag/pull/67), `1c4bc8b`; D-115, D-116); **BUG-30 and BUG-31 done** ([#68](https://github.com/bvst/TryggHverdag/pull/68), `5f4bdc1`; D-118, D-119), their workflow half done too ([#69](https://github.com/bvst/TryggHverdag/pull/69), `2c9808f`), review loops 2 and 3 in their own pull request (#70) · M1 closed 2026-10-01 (D-088) · M0 closed 2026-09-29 (D-083)

What is true **right now**. The narrative — why each thing was built and what
went wrong on the way — is in [`progress/m0.md`](progress/m0.md) for M0,
[`progress/m1.md`](progress/m1.md) for M1 and [`progress/m2.md`](progress/m2.md)
for M2.

This file is kept short on purpose. `CLAUDE.md` tells every session to read it
before doing anything, and a thousand-line file that is read under protest stops
being read at all. It reached 1,336 lines and, more to the point, **went stale
where it mattered**: four items under "In flight" described work that was already
done. Length was the symptom; a status nobody trusts was the cost.

The plan is in [`plan/README.md`](plan/README.md); the milestone task lists are in
[`plan/10-roadmap.md`](plan/10-roadmap.md). One task per pull request (D-052).

## M2 at a glance

**M2 started on 2026-10-01** (**D-090**). The core safety loop on the server,
in eight tasks, one pull request each, SM-01 first; nine since D-115 (2026-10-07)
gave SM-10 and the last-responder warning a task of their own. The owner chose this order;
the alternative was seven tasks with LOST-01 first. Exit: L6 green; mutation
≥ 80 %; the staging canary on time for 24 hours. Until GRP-01 brings logins
in M3, devices authenticate with a hashed per-device credential (**D-091**).
The task list is in [`plan/10-roadmap.md`](plan/10-roadmap.md); the story is in
[`progress/m2.md`](progress/m2.md).

| # | ID | Task | Status |
|---|----|------|--------|
| 1 | SM-01 | Start a journey: the base tables, per-device authentication (SEC-07), the state machine module (AR-04), one active journey per walker, at least one responder | ✅ **Done** — 2026-10-02, [#53](https://github.com/bvst/TryggHverdag/pull/53), merged as `2db7046`. On `main` after the merge: `ci` 10 of 10 jobs passed (run 36978813054), and `deploy-staging` ran the first migration with journey tables and passed its smoke test (run 36978812889). In CI, L3 ran under Testcontainers for the first time, 49 of 49. Reviews, all PASS: safety, privacy-security, code, test-auditor, in the session and in CI. BUG-11 (D-093) merged with it. Its record: `progress/m2.md` |
| | BUG-10 | The journey files need the owner and the safety review (D-092, D-094 to D-097): the six journey files, `api.ts`, `adapters/clock.ts`, the migrations' location and the system and integration Vitest configs in CODEOWNERS and `OWNER_APPROVAL_PATHS`, and in the ai-review `safety` filter; `modules/**` in `CLOCK_FREE_PATHS`; `modules/journeys/` and `api-process.ts` in `SAFETY_PATHS`, the first with its own mutation run under the system-test config | ✅ **Done** — 2026-10-02, [#56](https://github.com/bvst/TryggHverdag/pull/56), merged by the owner by hand (D-075) as `348f620`. Approved by `urso-agent`; all four session reviewers PASS (CI's AI reviewers cannot run on a pull request that edits `ai-review.yml`; their skip was read in each job log). In CI before the merge: `integration` 50 of 50, the new REL-01 clock test among them. On `main` after the merge: `ci` 10 of 10 jobs passed (run 37005844364), and `deploy-staging` passed with its smoke test (run 37005844368) |
| | BUG-12 | The mutation gate fails silently: on CI the whole-suite run's mutants all time out, and Stryker scores timeouts as detected | ✅ **Done** — 2026-10-02, [#57](https://github.com/bvst/TryggHverdag/pull/57), merged as `a47334f` after `urso-agent` approved it (D-098, D-099). Only a kill counts, each file ≥ 80 %, every run fresh. On CI's four CPUs (#57's job 110875720392): 265 mutants, 0 timed out, about 3 minutes of 25. Reviews PASS in the session (safety, test-auditor, code) and in CI (privacy-security, test-auditor, code). On `main` after the merge: `ci` 10 of 10 jobs passed (run 37040515081), and `deploy-staging` passed (run 37040515144). Record: `progress/m2.md` |
| | BUG-13 | `gate:full` says "0 step(s) after it did not run" after a failure, even when steps did not run: `summarize` in `scripts/lib/steps.mjs` subtracts the counts of `results`, which never holds the steps after a failure, so the number is always 0. On 2026-10-02 four steps did not run and it said 0 | ⚪ **Queued**, for the owner to schedule. On `main`. A reporting bug in what a gate says it skipped, not in what it checks |
| | BUG-14 | The test kit needs the owner, and the mutation check's own files and the test kit join the ai-review `safety` filter (D-100, the owner's answer of 2026-10-02 to CI's `code-reviewer` and `test-auditor` on #57) | ✅ **Done** — 2026-10-02, [#58](https://github.com/bvst/TryggHverdag/pull/58), merged by the owner by hand (D-075) as `34bc460` after `urso-agent` approved. D-100 and its amendment: `/packages/test-kit/` needs the owner; the mutation check's own files, the test kit and the three Vitest configs are in the safety filter. All four session reviewers PASS; CI's four AI reviewers skipped, as expected for a pull request that edits `ai-review.yml` (read in each job log). On #58, the new filter matched `gate-decisions.mjs` and started the safety review, and `mutation` ran fresh, identical to BUG-12 (job 110964175819). On `main` after the merge: `ci` 10 of 10 jobs passed (run 37058587754), and `deploy-staging` passed with its smoke test (run 37058587803). Record: `progress/m2.md` |
| | BUG-15 | CI's required `security` check (`pnpm audit --audit-level high`) failed on `main` and every pull request from 2026-10-02: braces GHSA-vfj7-8cjw-p6xm, no patched version, reached only through Jest and Metro tooling (D-104) | ✅ **Done** — 2026-10-03, [#59](https://github.com/bvst/TryggHverdag/pull/59), merged as `c46b3b3` after `urso-agent` approved; `main`'s tree is the reviewed head `10a1af4`. D-104 (owner, 2026-10-03: accept this one, recorded): one ID in `ignoreGhsas`, and a lockfile test that only `apps/mobile` reaches braces. Reviews PASS in the session (privacy and security, test audit, code) and in CI (all five AI reviewers). On `main` after the merge: `ci` 10 of 10 jobs passed (run 37125357152), and `deploy-staging` passed with its smoke test (run 37125357148). Record: `progress/m2.md` |
| | BUG-16 | `req:coverage` counts a requirement as tested when any test file names its ID, in a comment too: `mentions()` in `scripts/lib/requirements.mjs` searches the file's whole text. Found by CI's `test-auditor` on #60, which checked LOST-01's 20 criteria by hand and found a real test behind each | ⚪ **Queued**, for the owner to schedule. On `main` |
| | BUG-17 | `android-e2e` fails before the app is installed: the emulator still reports `en-rUS` 120 s after the switch to nb-NO. Twice so far: #57 (job 110875720264) and #60 (job 111180346250). A re-run passed on #57 | ⚪ **Queued**, for the owner to schedule. `progress/m2.md` said a second time would make it a bug of its own |
| | BUG-18 | Three files that decide whether a missed alert or a stopped watchdog can go unseen need the owner and the safety review (D-105 and its two amendments, the owner's answers of 2026-10-03 and 2026-10-04): `apps/server/src/adapters/db.ts` (every pool's size, and LOST-02's session limits), `adapters/worker-heartbeats.ts` (the worker's check-in row) and `modules/health/` (which turns it into `/v1/health`'s answer) | ✅ **Done** — 2026-10-04, [#61](https://github.com/bvst/TryggHverdag/pull/61), merged by the owner by hand (D-075) as `7e05c8e` at 11:48 UTC, with no review on the pull request; `main`'s tree is the reviewed head `974e6e8`. The merge rules were updated at 11:49 UTC and read active with no bypass actors. All four session reviewers PASS; CI's three AI reviewers that apply skipped, as expected (read in each job log). On `main` after the merge: `ci` 10 of 10 jobs passed (run 37199989215), `gate-integrity` among them, and `deploy-staging` passed (run 37199989255). Record: `progress/m2.md` |
| | BUG-19 | No test checks that every file git tracks under every owner-approval path still has owners under CODEOWNERS' last-match rule. Pins exist per file family (since BUG-8), so an ownerless later line for another owned file (for example `/?ackage.json`) un-owns it with every test green. Found by `test-auditor` on BUG-18; replacing the hand-written glob readers with real matchers (`git check-ignore`, picomatch) would also fit here | ⚪ **Queued**, for the owner to schedule. `/.github/` needs the owner, so such a line needs the owner's approval anyway |
| | BUG-20 | graphile-worker's own LISTEN connection prints its error object to the console when it drops or cannot connect (`@graphile/logger` prints meta with `%O`), at start and at every retry while the database is out of reach. The object can name the database's host, port or user, never personal data or the password; it bypasses `log.ts`'s closed events, so for that one connection AC18's "one `database_error` line" is not the only line. Pre-existing (the same on `main` before LOST-02). Found by `privacy-security-reviewer` in LOST-02's reviews and raised again by CI's on [#63](https://github.com/bvst/TryggHverdag/pull/63). The fix the spec names: give Graphile a logger that writes closed events only, without dropping the lines that make a stopped worker loud | ⚪ **Queued**, for the owner to schedule. Claude recommends it before M3, as its own small task |
| | BUG-21 | `scripts/e2e-android.test.mjs`, "INF-06-AC9: when the emulator never applies bokmål, it stops after the deadline …", is load-sensitive: it measures `askedFor`, the span between the first and last device readings, each stamped by a stand-in the test spawns, and allows three 100 ms intervals (`WAITED_OUT` = 700 ms) for start-up. Under `gate:full`'s full-suite load on 2026-10-06 (84 workers) it measured 639 ms and failed; alone it passed 3 of 3, and the same gate passed on its re-run. The script itself said "Waited 1 s". Found while running LOST-03's checks; this file is not in LOST-03's diff | ⚪ **Queued**, for the owner to schedule. Claude recommends taking the span from the script's own clock, or widening the margin with a written reason, so a slow spawn cannot read as a wait that stopped early |
| | BUG-22 | The test-weakening check (RG-03) does not see the shared behaviour suites. `TEST_GLOBS` in `scripts/lib/test-strength.mjs` and `.claude/hooks/test-weakening.mjs` match `*.test.*` files and `apps/mobile/e2e/**`, so `packages/test-kit/src/journey-store-behaviour.ts`, which holds every L2/L3 journey-store behaviour, the alert and outbox ones among them, is never checked; it also uses `{ name, run }` entries, not `test(` calls. In LOST-03's loop 3, `tests:changes` reported "2 changed test file(s), none weakened" while the real edits were in that suite. Ownership is fine: `implementer` cannot edit `packages/test-kit/`. Found by `test-auditor` on LOST-03 | ⚪ **Queued**, for the owner to schedule. Claude recommends adding the shared suites to the check's files and teaching it the `{ name, run }` form |
| | BUG-23 | `pnpm audit --audit-level high` failed on `main` and every pull request on a new advisory, GHSA-68fv-2mgg-jv7q: `source-map-js` before 1.2.2, an event-loop denial of service, reached only through dev tooling (`@vitest/coverage-v8` › `magicast`, and `postcss`). Found on LOST-03's pull request (#64), 2026-10-06 | ✅ **Done** — 2026-10-06, in LOST-03's merge, [#64](https://github.com/bvst/TryggHverdag/pull/64), `57502b8`. Its own pull request, [#65](https://github.com/bvst/TryggHverdag/pull/65), passed all 16 checks and its three applicable AI reviewers, and was closed as superseded once `main` held it byte for byte. `security` passes on `main` |
| | BUG-24 | The same audit also failed on GHSA-pqg4-j6r4-53mv, published 2026-10-06: `shell-quote` before 1.11.0, critical, command injection through `quote()`, reached only through the mobile app's dev tooling (`react-native` › `react-devtools-core`) | ✅ **Done** — 2026-10-06, in LOST-03's merge, [#64](https://github.com/bvst/TryggHverdag/pull/64), `57502b8`. Its own pull request, [#65](https://github.com/bvst/TryggHverdag/pull/65), passed all 16 checks and its three applicable AI reviewers, and was closed as superseded once `main` held it byte for byte. `security` passes on `main` |
| | BUG-25 | An override in a file nobody owns can hide an advisory from the audit: pnpm 10.33 also reads `overrides:` from `pnpm-workspace.yaml`, which has no CODEOWNERS entry, and `privacy-security-reviewer` showed (in a probe project) that an override to a `link:` copy makes `pnpm audit` report nothing. BUG-11's audit-settings test does not look for `overrides`, `packageExtensions` or `patchedDependencies` there, nor for `link:`/`file:` resolutions in the lockfile. Found while reviewing BUG-23/24; predates them | ⚪ **Queued**, for the owner to schedule. Claude recommends a test that keeps those keys in the owned root `package.json` and refuses non-workspace `link:`/`file:` resolutions, or a CODEOWNERS line for `/pnpm-workspace.yaml` |
| | BUG-26 | A lint run during a mutation run fails on Stryker's sandbox: `.stryker-tmp/` is in `.gitignore`, but ESLint does not read it, and `IGNORED_PATHS` (`packages/config/eslint/index.mjs`) does not list it. While `gate:full`'s mutation step ran, the stop gate's `gate:quick` reported 480 errors, every one `@ts-nocheck` in `.stryker-tmp/sandbox-*`. A false red, never a false green, and gone once Stryker deletes its sandbox; a sandbox left behind by a crashed run would keep it red. Found during LOST-06, 2026-10-06; predates it | ⚪ **Queued**, for the owner to schedule. Claude recommends adding `.stryker-tmp/**` (and `reports/**`, Stryker's report folder) to `IGNORED_PATHS`, with a test beside the existing ignore tests |
| | BUG-27 | Whether the worker's session limits are in force on a deploy is seen only by chance. The deploy job's log is Clever Cloud's stream, which ends when Clever Cloud reports the deploy done: on LOST-06's deploy (run 37595559908) "Successfully deployed" came 21 ms after "Starting worker", and the worker's `session limit` read-back line (D-109) was never in the log. The API's was. Earlier deploys caught both only because the timing fell right. The worker ran (its beat moved every 10 s and it checked in). Found 2026-10-07 | ⚪ **Queued**, for the owner to schedule. Claude recommends that each process records its read-back where the smoke test can check it (for example, the worker beside its beat, read through `/v1/health`), so every deploy fails loudly if either process's limits are not in force |
| | BUG-28 | The watchdog's waiting loop (`modules/alerts/watchdog.ts:116-123` on `main`, LOST-02) has no test with two journeys held past the stuck threshold, so a loop that stops early goes unseen, in either order: a `break` after the first stuck journey survives `main`'s three L6 alert suites and `alerts.integration.test.ts`, and so does a `break` after the first journey opened within its wait. Later journeys would lose this sweep's retry: their `watchdog_overdue` line, or their open, comes one sweep (about 10 s) later, and `stuck` can be undercounted. With the first break the sweep still fails and pages; with the second, it can record one beat while a journey is held. Found by `test-auditor` in LOST-07's loop-2 and loop-3 audits, 2026-10-07; LOST-07 adds the tests for the escalation's twin loop | ⚪ **Queued**, for the owner to schedule. Claude recommends two L6 tests with two journeys past the threshold, one held through the wait and one let go within it, in both orders |
| | BUG-29 | The required `mutation` check ran out of its 25-minute budget on LOST-07's pull request (#67): `spawnSync pnpm ETIMEDOUT`, twice (jobs 112914873757 and 112942878321, about 25:00 each). Every group that finished passed. LOST-07 added about 170 mutants, and every `worker.ts` mutant paid for `bin.test.ts`, which kills none of them on its own | 🟡 **Fixed in LOST-07's pull request, waiting on CI's run:** `worker.ts` has a group of its own, and each mutant's run starts Vitest directly (D-117; the owner agreed). Tests `7e2d2bc`, code in the next commit. A fresh local run took 18:57 with every score unchanged. The budget is not raised |
| | BUG-36 | Any tool call could change `.claude/settings.local.json` (`disableAllHooks` turns every hook off) or the hooks' own records in `.claude/state/` (a written `gate-passed` skips the stop gate, `red:` in `phase` downgrades it), and Claude Code's own protection of `.claude/` is a classifier's call in auto mode. From `privacy-security-reviewer` on #68 | 🟡 **In review**, D-120: the global guards refuse it from every session and subagent, `phase` the main session's only, paths judged from the repository whatever the session's folder |
| | BUG-37 | The five reviewer briefs said the gate reads the verdict's last line; CI reads structured output and checks the comment | 🟡 **In review**: the paragraph says who reads the last line now |
| | BUG-38 | Four reviewers kept a loose memory file (`.claude/agent-memory/<agent>.md`, 577 lines in all) that Claude Code never loads | 🟡 **In review**: each moved, byte-for-byte, into its agent's folder as a topic file with an index line; a test keeps the folder tidy |
| | BUG-39 | Agents were sent to `docs/plan/decisions.md`, over 4,400 lines, to read one decision | 🟡 **In review**: `pnpm run decision D-NNN` prints just the decisions asked for; CLAUDE.md and `architecture-rules` point to it |
| | BUG-11 | The dependency audit accepts one advisory, GHSA-86w9-cpqp-85rv in `node-forge` (D-093) | ✅ **Done** — merged with SM-01 in [#53](https://github.com/bvst/TryggHverdag/pull/53) (`2db7046`). Its own pull request, [#54](https://github.com/bvst/TryggHverdag/pull/54), was closed as superseded: every file it held was already on `main` |
| 2 | LOST-01 | Heartbeat, with or without position | ✅ **Done** — 2026-10-03, [#60](https://github.com/bvst/TryggHverdag/pull/60), merged as `fe384c5` after `urso-agent` approved; `main`'s tree is the reviewed head `5aa074c`. D-101 to D-103 (D-102 amended); 20 acceptance criteria. Reviews PASS in the session (all four, and the three blocking ones again after loop 1) and in CI (all five AI reviewers). In CI before the merge: `integration` 103 of 103 on PostgreSQL 15; `mutation` every safety file ≥ 96 %, 0 timed out. On `main` after the merge: `ci` 10 of 10 jobs passed (run 37144094720), and `deploy-staging` ran migration `0002` and passed its smoke test (run 37144094724). Record: `progress/m2.md` |
| 3 | LOST-02 | Lost-contact alert: the watchdog, the outbox, a recording push fake | ✅ **Done** — 2026-10-05, [#63](https://github.com/bvst/TryggHverdag/pull/63), merged as `5cd5d24` at 06:50 UTC after `urso-agent` approved; `main`'s tree is the reviewed head `6527e38`. 25 acceptance criteria; D-106, D-107 and D-109 (owner), D-108 (delegated, amended). Session reviews: `test-auditor` blocked the first round, fixed in loop 1; all three blocking reviewers PASS after loops 1 and 2. In CI on `6527e38`: all 16 checks passed, all five AI reviewers PASS; `integration` on PostgreSQL 15; `mutation` every run passed (`watchdog.ts` 87 of 87, `outbox.ts` 37 of 38, `worker.ts` 140 of 146). On `main` after the merge: `ci` 10 of 10 jobs passed (run 37274508925), and `deploy-staging` passed (run 37274508942), with both session-limit lines in force. Record: `progress/m2.md` |
| 4 | LOST-03 | Back in contact | ✅ **Done** — 2026-10-06, [#64](https://github.com/bvst/TryggHverdag/pull/64), merged as `57502b8` at 17:56 UTC after `urso-agent` approved; `main`'s tree is the reviewed head `53bf338`. 20 acceptance criteria; D-110 and D-111 (owner), D-112 (delegated, amended in three review loops). Session reviews: all four PASS in the first round; the three blocking ones PASS after loops 1, 2 and 3 (the process's limit). In CI on `53bf338`, with BUG-23/24's fix merged in: all 16 checks passed, and the four AI reviewers that review its paths PASS; `integration` on PostgreSQL 15; `mutation` every run passed (`journey.ts` 134 of 135, `service.ts` 122 of 123, `outbox.ts` 37 of 38, `worker.ts` 140 of 146). On `main` after the merge: `ci` 10 of 10 jobs passed (run 37507461460), and `deploy-staging` passed (run 37507461487), with both session-limit lines in force and migration 0004 applied. Record: `progress/m2.md` |
| 5 | LOST-06 | "I'm on it" | ✅ **Done** — 2026-10-07, [#66](https://github.com/bvst/TryggHverdag/pull/66), merged as `e695e8a` at 08:42 UTC after `urso-agent` approved; `main`'s tree is the reviewed head `5925938`. 17 acceptance criteria; D-113 (owner) with its amendment (the notice is not pushed on a platform until a real-phone test shows it never displaces an undelivered critical alert), D-114 (delegated). Session reviews: all three PASS in the first round; two review loops; `test-auditor` PASS, then a delta audit PASS. In CI on `5925938`: all 16 checks passed, all five AI reviewers PASS; `integration` on PostgreSQL 15, migration 0005 included; `mutation` every run passed (`acknowledgement.ts` 37 of 37, `journey.ts` 176 of 177). On `main` after the merge: `ci` 10 of 10 jobs passed (run 37595559915), and `deploy-staging` passed (run 37595559908); the worker's session-limit line was not in the deploy's log (BUG-27). Record: `progress/m2.md` |
| 6 | LOST-07 | SMS escalation at 2 minutes | ✅ **Done** — 2026-10-07, [#67](https://github.com/bvst/TryggHverdag/pull/67), merged as `1c4bc8b` at 19:43 UTC. 20 acceptance criteria; D-115 (owner, five answers, each Claude's recommendation), D-116 (delegated) with three review-loop amendments. All three reviewers PASS in the first round; three review loops; `test-auditor` blocked loop 1's head (three safety clauses with no test) and passed loops 2 and 3. One spelling per check: both ping URLs only as `https://hc-ping.com/<uuid>`. `gate:full` at `ef8a8e4` 11 passed, the one failure `gate:integrity`'s API checks; mutation passed inside its budget, the `alerts` group 291 of 291. L3 282 of 282 on a PostgreSQL 16 stand-in locally. Every check run on `main`'s `1c4bc8b` that ran passed (16 passed, 2 skipped; read through the REST API), `integration`, `mutation` and `deploy` among them. **A-33 is the owner's next step, straight after the merge's `deploy-staging`** (the stricter check reads the worker's existing secret first). Record: `progress/m2.md` |
| 7 | SM-10 | Removing a responder: resumed escalation and the last-responder warning (D-115) | ⚪ Not started |
| 8 | LOST-08 | "They're safe" | ⚪ Not started |
| 9 | REL-10 | The staging canary | ⚪ Not started |

## M1 at a glance

**M1 is closed** (2026-10-01, **D-088**). Its exit — spike results recorded,
the SDK go/no-go decision, and Section 4 closed — is met (D-086), and the
roadmap's fourth M1 item, the Critical Alerts request, is drafted and merged
too (D-087, STORE-01). As with M0 (D-083), the owner made the call. **M2,
the core safety loop on the server, started on 2026-10-01 (above).**

| ID | Task | Status |
|----|------|--------|
| SPIKE-01 | Background safety on emulators and simulators: S1–S7, and S8, MapLibre with Kartverket's tiles | ✅ Done (2026-10-01) — both nights ran (`night-20260930`, 38 runs; `night-20261001-s1-exempt`, 2 runs; none invalid), all four reviewers passed through review loop 2, and the owner chose a **conditional GO** over the rule's NO-GO, recorded as **D-086**. Results: `docs/plan/04b-spike-results.md`. Section 4 is closed Merged as `d6a2dff` ([#49](https://github.com/bvst/TryggHverdag/pull/49), 2026-10-01); CI on `main` green, 10 of 10 jobs; the raw network captures deleted, as D-086 says |
| STORE-01 | Critical Alerts entitlement request drafted | ✅ Done (2026-10-01) — `docs/plan/critical-alerts-request.md`, from the spec `docs/specs/STORE-01.md`. The owner answered Q1–Q4; **D-087** records them. Safety, privacy, test-auditor and code reviews all PASS (safety and privacy re-checked after fixes, and passed again). The owner's to-do to send it once A-02 exists is **A-30**, due M4 at the latest. Merged as [#51](https://github.com/bvst/TryggHverdag/pull/51) (`881c780`, 2026-10-01); CI green on `main` — `ci` (10 of 10 jobs) and `deploy-staging` both passed |

**M1's five open items, found while planning SPIKE-01, are now all answered**
(full account in [`progress/m1.md`](progress/m1.md)): (a) and (c) when
Section 4 closed; (b) by the licence timing in D-086; (d) by STORE-01
getting an ID and being drafted; (e), the public repository with no
decision recording it, by **D-089**.

**What stays open does not block M2:** D-086's conditions (L9 on real
devices), A-30 (send the request once A-02 exists), the spike harness's
known limits, and three `.claude/` configuration gaps needing the owner's
approval (below, under "Live gotchas").

## M0 at a glance

| ID | Task | Status |
|----|------|--------|
| INF-00 | Mac environment check | ✅ Done — 2026-09-25. `pnpm run doctor` passes 9 of 9 on `claude-dev`, and the owner confirmed Remote Control |
| INF-01 | Monorepo skeleton | ✅ Done — 2026-09-20 ([#2](https://github.com/bvst/TryggHverdag/pull/2)) |
| INF-02 | Claude Code configuration + hook tests | ✅ Done — 2026-09-20 ([#2](https://github.com/bvst/TryggHverdag/pull/2)) |
| INF-03 | Gate scripts + HK-08 | ✅ Done — 2026-09-20 ([#2](https://github.com/bvst/TryggHverdag/pull/2)) |
| INF-04 | CI workflows, merge rules, CODEOWNERS | ✅ Done — 2026-09-23 ([#3](https://github.com/bvst/TryggHverdag/pull/3)) |
| INF-05 | Server skeleton | ✅ Done — 2026-09-23 ([#6](https://github.com/bvst/TryggHverdag/pull/6)); four test levels green, mutation 100 % |
| INF-06 | App skeleton | ✅ Done — 2026-09-28 ([#34](https://github.com/bvst/TryggHverdag/pull/34)). L5 and L7 pass in CI: `android-e2e` "1 of 1 flow passed" on runs 7 and 9. The first run on `main` failed on a 2-core emulator; BUG-6 ([#37](https://github.com/bvst/TryggHverdag/pull/37)) gave it 4 cores, and `main` is green again |
| INF-07 | Staging on Clever Cloud | ✅ Done — 2026-09-25 ([#22](https://github.com/bvst/TryggHverdag/pull/22), fixes [#23](https://github.com/bvst/TryggHverdag/pull/23) [#24](https://github.com/bvst/TryggHverdag/pull/24), names [#25](https://github.com/bvst/TryggHverdag/pull/25)). A merge deployed and the smoke test passed; BUG-3 fixed ([#27](https://github.com/bvst/TryggHverdag/pull/27)) |
| INF-08 | Monitoring | ✅ Done — 2026-09-28 ([#31](https://github.com/bvst/TryggHverdag/pull/31)). In the owner's drill (2026-09-26) Healthchecks.io alerted about 3 minutes after the worker's last ping, and UptimeRobot alerted too, both by email. The owner accepted it with no UptimeRobot app; UptimeRobot's recovery and its keyword rule were not checked |
| INF-09 | Daily status workflow | ✅ Done — 2026-09-25 ([#18](https://github.com/bvst/TryggHverdag/pull/18)). Since D-080 ([#32](https://github.com/bvst/TryggHverdag/pull/32)) a dashboard: the description of the pinned issue [#35](https://github.com/bvst/TryggHverdag/issues/35), replaced every run. It is scheduled at 01:07 UTC, but GitHub starts it about 5½ hours late, so it lands around 08:30 in Oslo. The missed-run alarm is proven (2026-09-25) |
| INF-10 | Gate drills | ✅ Done — 2026-09-29 ([#42](https://github.com/bvst/TryggHverdag/pull/42)). Seven offline drills run on every pull request that can change a gate, and each is shown to go red when its gate is made to pass. The push to `main` and the merge without owner approval are covered by `gate:integrity`; their one live attempt is an M5 go-live item (D-083) |

**M0 is closed** (2026-09-29, D-083):
- every INF task above is done;
- the seven offline gate drills pass on every pull request that can change a
  gate;
- CI is green on `main` after #42 and #41.

The owner chose to move the live attempt at the two GitHub-only drills to M5's
go-live checklist. So D-071's question, whether GitHub enforces code-owner
review, stays open until then.

**Done since M0 closed** (2026-09-29; the account is in
[`progress/m0.md`](progress/m0.md)):
- **BUG-8:** six more gate files need the owner's approval (D-084).
  [#46](https://github.com/bvst/TryggHverdag/pull/46), merged at 15:45 UTC as
  `ba94a45`.
- **D-085 and BUG-9:** CI names `ubuntu-26.04` ahead of GitHub's move, and the
  emulator install waits through a refused session.
  [#43](https://github.com/bvst/TryggHverdag/pull/43), merged at 19:42 UTC as
  `0637482`. Its loose ends are under "In flight".
- **The D-075 batch:** `ai-review.yml` on `ubuntu-26.04`, and three Dependabot
  bumps. [#48](https://github.com/bvst/TryggHverdag/pull/48), merged as
  `05ca463` (checked with `git log` and `git show --stat`: it changed all
  five workflows).

**The reviewer gate works.** As of 2026-09-23 it reviews real code and returns
verdicts. On its first working day it caught two genuine bugs, a half-finished
decision and a factually wrong count — all in Claude's own work. Before that it
could not record a verdict at all (D-069, D-070, D-073).

## What the owner still needs to do

**A-29 — request the location SDK's 30-day trial key shortly before M3's
demo** (transistorsoft.com/shop/trials/new; owner's own phones only; D-086).
Due M3, not now.

**A-30 — send the Critical Alerts entitlement request**
(`docs/plan/critical-alerts-request.md`, Part D) once the Apple Developer
account (A-02) exists; D-087. Due M4 at the latest; record only the outcome.

**A-27 — raise the daily-status check's grace in Healthchecks.io to 8 hours**
(about a minute; agreed 2026-09-26). GitHub starts the report hours late by
varying amounts, and 3 hours' grace could page for a run that happened (D-080).

**A-22's leftover:** delete the first apply's `trygghverdag-staging` app and
database in the Clever Cloud console. They are outside Terraform, and the app
costs money.

**A-14 — the cloud environment's allowlist is applied** (2026-09-24). A setup
script is still to come.

**A-01, A-02, A-03 — phones, Apple, Google Play.** Not needed for SPIKE-01:
simulators and emulators need no account. A-02 is needed to send the Critical
Alerts request (**A-30**, above). The rest block the first real device build.

**Dependabot and the reviewer gate.** `CLAUDE_CODE_OAUTH_TOKEN` is in the
Dependabot secret store, which unblocks npm updates. **github-actions updates
still cannot pass**, structurally: `ai-review.yml` pins actions such as
`actions/checkout`, `actions/setup-node` and `pnpm/action-setup`, so bumping any
of them edits that workflow, and `claude-code-action` refuses to run when the
workflow differs from the default branch. Those pull requests need a manual merge
(D-075). **The three that were open are no longer:** #4 (`actions/setup-node`),
#5 (`actions/checkout`) and #36 (`anthropics/claude-code-action`). Their
changes went into #48 (`05ca463`, 2026-09-30), pinned to the commits Dependabot
proposed. **Checked:** the workflows now pin setup-node v7.0.0, checkout v7.0.1
and claude-code-action v1.0.235. **Not checked from this session:** each pull
request's own state on GitHub (no `gh` here). The orchestrating session found no
open pull requests on 2026-10-01 and 2026-10-02.

**Done, and recorded elsewhere:** A-04 to A-10, A-15 to A-26 (bar A-22's leftover)
and A-28. Each row is in [`plan/README.md`](plan/README.md), and the evidence is
in [`progress/m0.md`](progress/m0.md). Still true from them:
`CLAUDE_CODE_OAUTH_TOKEN` is set and `ANTHROPIC_API_KEY` is not; `claude-dev` acts
on GitHub as `urso-agent` only; the owner accepted the INF-08 drill with no
UptimeRobot app ("it is enough for now").

## Live gotchas

The things that still bite, and cost a session hours the first time.

- **Naming a requirement that has no test yet, in a changed spec or source
  file, fails `req:coverage --fail-on-uncovered-changed`** (and with it
  `gate:full` and CI's `traceability`). LOST-01's loop 1 wrote "task 3
  (LOST-02)" in a code comment and in its spec; LOST-02 went to 📝 and the gate
  stopped at that step. Name a later task in words ("task 3, the lost-contact
  watchdog"). Docs under `progress/` are not read for this.
- **Don't run two gates at once in one checkout.** The drill test INF-10-AC11
  compares `git status` before and after, so a background `gate:full`
  rewriting `docs/requirements-status.md` fails a concurrent `gate:quick`;
  and a `gate:quick` (or the stop hook) during a mutation run lints Stryker's
  `.stryker-tmp/sandbox-*` copy, which carries `@ts-nocheck`. Let one finish.
- **A git worktree outside the project gets no post-edit checks.** The
  post-edit hook runs in `$CLAUDE_PROJECT_DIR`, so edits in a scratchpad
  worktree are checked against the main checkout (reporting its errors, or
  "No test files found"). Run the gates in the worktree yourself (BUG-15).

- **On the Mac, hooks run with the PATH Claude Code started with.** A stop
  hook that fails with no output, or with `git init -b` refused, is this
  machine's old `/usr/local/bin` Node 20 or git 2.23, not the change. Restart
  Claude Code after editing `~/.zshrc`; `claude-dev`'s pnpm shim also forces
  Homebrew's Node and git (BUG-4's log).
- **HK-03 matches text, not intent.** A shell command that merely *mentions*
  starting a workflow run from the command line, a Clever Cloud deploy,
  `scripts/staging-deploy.mjs`, or Terraform apply/destroy is blocked — a
  heredoc writing documentation included. Write such text with the Edit or
  Write tools instead.
- **HK-05 counts a `test.each` only up to its first `)`.** A comment with
  parentheses inside a `test.each([...])` array hides that test from the
  counter, which then reports "the number of tests went down". Keep
  parentheses out of those comments.
- **Clever Cloud's CLI is a pinned binary, not an npm package.** The package
  needs Node 24 and the repository is on 22, so the deploy runs the standalone
  clever-tools 5.0.2 binary, checked by hash (`scripts/lib/clever-tools.mjs`).
  The hash is trust-on-first-use: a version bump means downloading the new
  archive and recording its hash by hand (D-077 item 16). It ran on
  `ubuntu-26.04` for the first time on 2026-09-29, and worked.
- **Sessions reach `www.clever.cloud` and `registry.terraform.io`, and never
  `api.clever-cloud.com`** — on purpose (`plan/cloud-environment.md`).
  `pnpm run infra:check` works in a session; `plan` and `apply` do not, and
  must not.

- **Every job failing in ~2 seconds means the Actions budget, not the code.**
  On 2026-09-23 all fifteen checks went red for two and a half hours. The
  signature: `runner_id: 0`, empty `runner_name`, **no `steps` array at all** —
  not even GitHub's own "Set up job" — and a job log returning HTTP 404, because
  nothing ran to write one. The included minutes had run out against a spending
  limit, and the owner raising it fixed it within minutes. **Since 2026-09-28
  the repository is public**, so standard runners are free and unlimited, and
  have 4 CPUs and 16 GB RAM instead of 2 and 8 (GitHub's docs). This cannot
  happen on standard runners any more; if the signature ever returns, check
  Settings → Billing and licensing → Plans and usage first. Re-running is pointless and consumes more
  of what is already gone. Sixteen jobs fire on every push (ten `ci`, six
  `ai-review`), so a day of many small pushes was expensive — which is the
  argument for path filters on the docs-only ones.
- **A green `ai-review` tick is not proof a review happened, and a red one can
  be advisory.** Twice on #15 a reviewer returned a verdict without having
  reviewed: `test-auditor` emitted `{"verdict":"PASS","summary":"Placeholder —
  waiting for test-auditor subagent to finish before posting PR comment and final
  verdict."}`, and the gate, which only grepped for `^(PASS|BLOCK)$`, accepted it.
  Since #16 a verdict must be corroborated by a comment, and that works.
  **The tell is still a reviewer that goes green without commenting**, in well
  under the four to six minutes a real review takes. Read the job log's
  `STRUCTURED:` line before trusting any verdict. The other way round,
  `code-reviewer` can end with no verdict at all (`--json-schema was provided but
  Claude did not return structured_output`, on #43's `f22d5ee`). It is advisory,
  so the three blocking reviewers decide.
- **`ai-review.yml` cannot be reviewed by the reviewers.** Editing it stops the
  action running at all, so every change to that file is merged by hand, on
  purpose (**D-075**). Batch changes to it rather than spending a manual merge
  each time.
- **`.claude/**` and `CLAUDE.md` are reverted in a reviewer's working tree**
  before it reads them, so the `Read` tool shows stale text. Use
  `git show HEAD:<path>` or `git diff origin/main...HEAD -- <path>`. This is
  behaviour of the environment the reviewer runs in, **not** automation in this
  repository — a reviewer grepped the workflows, hooks, settings and `.git/hooks`
  looking for it and correctly reported finding nothing. **It can produce a false
  BLOCK**: on #22, safety-reviewer read the revert as "uncommitted changes strip
  the D-077 guardrails" while the committed head had all of them. Check any
  `.claude/` finding against `git show HEAD:<path>` before acting on it.
- **A superseded run posts five red `ai-review` checks.** The guard fires on
  `needs.changes.result != 'success'`, and a cancelled duplicate run is not
  `success`. They look exactly like real failures. Check whether a newer run for
  the same SHA exists before believing them.
- **A pull request with a merge conflict gets no workflows at all.** GitHub runs
  no `pull_request` workflow while the pull request cannot merge cleanly. Two
  pushes to #43 started nothing, and the pulls API showed `mergeable: false`,
  `mergeable_state: dirty`. If a push starts no checks, look there before
  suspecting CI. Merge `main` in.
- **A green `android-e2e` can hide a refused first install.** On `ubuntu-26.04`
  the install was refused on attempt 1 in 3 of 6 runs. The wait got past
  the ones it knew and the check stayed green, so only the job's log shows which
  attempt succeeded. A session once read a run from its check alone and nearly
  reported one refusal where there were two (`progress/m0.md`).
- **`gate:quick` does not run the coverage ratchet.** For a file the baseline
  tracks, run `test:coverage` then `coverage:ratchet` before pushing, or CI finds
  it for you.
- **Pushing while a reviewer run is in flight** cancels it and manufactures the
  false reds above. Wait for the run, then push.
- **`daily-status.yml` cannot run from a pull request.** GitHub runs scheduled
  and manual workflows only from the default branch, so its first real run is
  after merge. Its tests hold its shape and run its scripts; they cannot run it.
- **Owner questions filed from a session do not notify the owner.** The GitHub
  tools here act as `@bvst`, so the issue is the owner's own, and GitHub does not
  notify anyone of their own actions. The daily report lists open ones (D-076).
- **A test that spawns a script inherits the runner's environment.** On a push
  to `main` that means `GITHUB_EVENT_NAME=push` and a live `GITHUB_OUTPUT`, so a
  test green on its pull request can be red on `main` — one was, from #17 until
  #20 fixed it. Set the environment in the spawn; don't inherit it.
- **Read the job log before theorising** (D-070) and **say what you checked, not
  what you assume** — both are non-negotiables in `CLAUDE.md` because three
  hypotheses about one failing gate were wrong in a single morning.
- **Vitest's coverage cannot see a spawned process.** Logic that runs only in
  an entry script that tests spawn counts as uncovered, and the ratchet drops.
  Keep entry scripts to IO and put decisions in `scripts/lib/`, as INF-10's
  `req-coverage.mjs` shows.
- **A session reaches GitHub release assets but not release pages.** The proxy
  answers 403 for `…/releases/latest` and 200 for `…/releases/download/…`.
  Probe the asset, not the page.
- **The Bash guard reads `rm -f` beside a `git push` as a force push.** Keep a
  push in a command of its own.
- **The bash guard (`guard-bash.mjs --global`) reads the whole command.** A
  `sed` pattern containing `main` in the same command as a `git push` was
  refused as a push to main, and a pattern containing `.env` (as in
  `process.env`) as reading an env file. Split such commands.
- **Writing "close #19" in a pull request's description closes #19 when it
  merges.** GitHub reads close, fix and resolve, in any of their forms, as a
  closing keyword when an issue number follows, even inside advice to the
  owner. #32 said "If you'd like a clean issue, close #19", and merging it
  closed the daily-status issue. Put the number first ("#19 can be closed"),
  or leave the keyword out. The same goes for commit messages, which a squash
  merge copies into its own.
- **`req:coverage` counts the requirement a spec names, not the task ID.**
  INF-08's spec names REL-08, so its tests had to name REL-08 too, or RG-01
  fails on the branch.
- **Two sessions can take the same decision number.** On 2026-09-29, #43 and #44
  both wrote a D-083, each the next number after `main`'s last at the time. #44
  merged first, and #43 renumbered to D-085 and BUG-9. Before taking a number,
  check the open pull requests' `decisions.md` too, and check it again before
  each push.
- **The agent briefs still send the narrative to `m0.md`.** `plan-keeper`,
  `/status` and `/bugfix` name `docs/progress/m0.md` (D-088 lists it among the
  `.claude/` gaps). M2's narrative is [`progress/m2.md`](progress/m2.md) and
  M1's is [`progress/m1.md`](progress/m1.md), so a bug's next `BUG-<n>` has to
  be looked for in all three files, in this one and in `decisions.md`. The
  next one is **BUG-40** (BUG-13 to BUG-39 are taken; BUG-32 to BUG-35 are in #71). The last paragraph of
  `progress/m1.md` says why.
- **The write-time sensitive-data hook catches only `+47`/`0047` phone
  numbers, on Write and Edit.** `scan-sensitive.mjs` does not look for 8-digit
  domestic numbers, email addresses, postal addresses, D-U-N-S or
  organisation numbers, or coordinates in prose, and it does not see a file
  written from a shell. Found by `test-author` while checking STORE-01's
  AC11, 2026-10-01. Review carries the rest; a `.claude/` fix needs the
  owner's approval and has no ID yet.
- **`planner`'s and `test-author`'s own `guard-paths` hooks block them from
  writing their own agent memory.** `planner` may only write
  `docs/specs/**`, and `test-author` only test files and `packages/test-kit/**`
  — neither allowlist covers `.claude/agent-memory/<agent>/**`, so a memory
  write from either agent is blocked and the session must stop and report it
  (never work around a guard block). It has fired: `test-author` three times
  in SPIKE-01 and `planner` twice in STORE-01, each stopped and reported. The
  reviewers and `implementer` write their own memory without trouble. A
  configuration gap for the owner, with no ID yet.
- **Red-phase TypeScript tests cannot be committed alone.** The pre-commit
  hook (HK-09) lints staged files with type information, and a test that
  imports modules which do not exist fails `no-unsafe-*`. SM-01's way: write
  the code, then commit the tests first by explicit path, with the code
  present but unstaged, and the code after them. The history keeps the order
  that RG-02 asks for.
- **Background agents hang on git's pager.** Run `git --no-pager …`, or pipe
  to `cat`. One session lost an hour to it.
- **An agent worktree fails the stop gate.** `isolation: worktree` puts a
  checkout in `.claude/worktrees/`, inside the repository: git sees it as
  untracked, and `prettier --check .` reads its generated files, which
  `.prettierignore`'s paths no longer match. The role guards refuse any path
  outside the repository, so a worktree elsewhere doesn't work for
  `test-author` or `implementer` either. Have `planner` write a draft to the
  scratchpad instead (LOST-06).
- **The session's disk allowance runs out.** Reviewers' scratch copies of the
  repository (about 280 MB to 1 GB each) pile up across tasks; one filled the
  allowance during `gate:full`'s mutation step (ENOSPC). Delete finished
  copies between tasks.
- **A container restart stops background agents and loses uncommitted work.**
  One attempt at a records task was cut off before it wrote anything. Commit
  and push in small steps.
- **A Vitest JSON reporter writes `.vitest/json/output.json` into the repo
  root,** and `gate:quick`'s formatting step fails on it. Agents give an
  `--outputFile` in the scratchpad, and point `TMPDIR` there too, so Vite's
  `ssr` folders don't pile up in `/tmp` (LOST-07).
- **Run `gate:full` on a quiet machine.** Its mutation step runs the groups
  one after another inside a 25-minute budget. With reviewers running beside
  it, LOST-07's groups overran it; alone, they passed (LOST-07).
- **Agents can sit for hours on an approval prompt.** Edits to `.claude/**`
  and `docs/plan/decisions.md` always ask (`settings.json`), and a background
  agent waiting on one shows no sign of it: no file changes, no processes. On
  2026-10-07/08 `plan-keeper` and `test-author` each waited over four hours.
  When an agent goes quiet, ask the owner about pending prompts first.

## In flight

**BUG-30 and BUG-31** (the agents' models and thinking levels, and the gates'
speed; D-118, D-119) are done: [#68](https://github.com/bvst/TryggHverdag/pull/68),
`5f4bdc1`, 2026-10-08. **The workflow half is done too:
[#69](https://github.com/bvst/TryggHverdag/pull/69), `2c9808f`**, merged by
the owner by hand (D-075): `--model claude-opus-5-5` for CI's reviews,
`--model claude-sonnet-5-5` for the daily report, and `TRYGGHVERDAG_REVIEW_JOB=1`
on the review step only. **Checked on the first review run after it** (#70 at
`6ae6a68`, job 113295185327): the log says `"model": "claude-opus-5-5"` (it
said `claude-sonnet-5` before), with `claude-sonnet-5-5` for `code-reviewer`
itself; the whole review session took 35 s (`duration_ms` 35428), which a
`gate:quick` run at its end (88–112 s) could not fit in, so the stop gate stood
down: an inference from the timing, as the hooks' output is not in the log.
`code-reviewer`'s job took 83 s (5 min 14 s at `c626578`) and its session
cost $0.30, against $1.11 on Sonnet 5 on #68 (job 113210298189).
Dependabot's #62 (claude-code-action v1.0.239, Claude Code 2.1.287) is still
open. **Review loops 2 to 4** (D-119's amendment: the stop gate reads raw
line endings, in its early check and its fingerprint; the stand-down rule
lives once in `inReviewJob()`; a guard test fails if the repository ever sets
a line-ending attribute, which would blind the fingerprint again) are
[#70](https://github.com/bvst/TryggHverdag/pull/70), from
`fix/BUG-31-review-loop-2`.

Left for later, from BUG-30 and BUG-31's reviews: **all taken up on
2026-10-08** (the owner: "Do the follow ups"), in
`fix/BUG-36-39-claude-follow-ups`: BUG-36 (D-120, a guard on
`.claude/settings.local.json` and the hooks' records in `.claude/state/`),
BUG-37 (the reviewer briefs' verdict paragraph), BUG-38 (the loose memory
files moved into their folders) and BUG-39 (`pnpm run decision D-NNN`).
Running CI's reviewers as `claude --agent` was measured and not adopted
(D-121).

**LOST-07** (M2 task 6 of 9, SMS escalation) is done
([#67](https://github.com/bvst/TryggHverdag/pull/67), `1c4bc8b`, 2026-10-07;
D-115, D-116). **A-32** is done (the owner). **A-33** is the owner's next step:
run it straight after the merge's `deploy-staging`, because the stricter
ping-URL check reads the worker's existing secret before any plan. Next: task
7, SM-10 (D-115). **LOST-06** (task 5,
"I'm on it") is done ([#66](https://github.com/bvst/TryggHverdag/pull/66),
`e695e8a`). Before M3 pushes its notice on either platform, a real-phone test
must show the notice never displaces an undelivered critical alert (D-113's
amendment). **LOST-03** (task 4, back in contact, and "I'm home") is done
([#64](https://github.com/bvst/TryggHverdag/pull/64), `57502b8`), with
**BUG-23** and **BUG-24** (the dependency audit's two new advisories) in it.
**LOST-02** ([#63](https://github.com/bvst/TryggHverdag/pull/63), `5cd5d24`),
**BUG-18** ([#61](https://github.com/bvst/TryggHverdag/pull/61), `7e05c8e`),
**LOST-01** ([#60](https://github.com/bvst/TryggHverdag/pull/60), `fe384c5`)
and **BUG-15** ([#59](https://github.com/bvst/TryggHverdag/pull/59),
`c46b3b3`) are done too. **A-31** (Dependabot alerts are off) is the owner's.
LOST-01's to LOST-07's reviews leave items for later tasks, listed in
`progress/m2.md` ("Left for later tasks").

**For the owner, from #70's `integration` check:** the D-068 test
("on SIGTERM the real worker exits with 0") failed once at `6ae6a68` with
`{ code: null, signal: 'SIGTERM' }`, and passed at `271b99e`. Read from the
code, not reproduced (no Docker here): `runWorkerProcess` in
`apps/server/src/worker.ts` installs its signal handler only after
`startWorker` returns, and Graphile Worker opens connections before that, so a
SIGTERM in between kills the worker by the signal. The test waits for a
connection, so it can land there; so can a real redeploy. Claude recommends
**BUG-32**: install the handler before the start and let the stop wait for it
(patch in #70's comment), with `safety-reviewer`. Not started: it needs the
owner's go-ahead.

**For the owner, from CI's `test-auditor` on #60:** should
`apps/server/src/log.ts` be mutation-tested? It is the one place that keeps
locations and phone numbers out of the server's logs (PRIV-07), and
`SAFETY_PATHS` holds only code where a missed bug is a missed alert (D-036).
Claude recommends a mutation group for it on every pull request, under a new
decision, as its own task after LOST-01. The alternative is to wait for D-036's
nightly run, which does not exist yet.

**For the owner, from `safety-reviewer` on LOST-02:** the same question for
`apps/server/src/adapters/db.ts`. It holds every pool's session limits and
the start-up read-back that says whether they are in force (D-109), and it is
not in `SAFETY_PATHS`, so no mutation run measures its tests. Claude would
answer both questions in one decision.

Still open from BUG-14's reviews, for the owner:
- nothing pins what `package.json`'s `mutation` script runs (`safety-reviewer`
  on BUG-14, for the owner): changed to `echo`, CI's required check would pass
  with only the owner's approval in the way;
- an extra unowned entry in the safety filter is not caught by a test
  (`test-auditor`; the safe direction, and `/.github/` needs the owner anyway).

Still open from D-098's consequences (BUG-12, done):
- imports do not trigger the run (`api.ts`, `http.ts`, the adapters, contracts);
- dependency updates do not trigger it either (a cost question);
- the whole-suite run is now unreachable, and removing it needs a decision;
- mobile `.tsx` safety files will need a jest-expo group.

**BUG-13**, **BUG-16**, **BUG-17**, **BUG-19**, **BUG-20**, **BUG-21**, **BUG-22** and **BUG-25** are queued for the owner to schedule (the rows under M2, above).

**D-085's loose ends** (the pull request merged, [#43](https://github.com/bvst/TryggHverdag/pull/43)).
- **Verified:** `deploy-staging` on `ubuntu-26.04`. Run 36621209842, for
  `0637482`, succeeded, and so did its Deploy step and its smoke test.
- **Verified:** `daily-status` on `ubuntu-26.04`, 2026-09-30 06:34 UTC, both
  jobs.
- **Verified:** every workflow names `ubuntu-26.04` since #48 (`05ca463`,
  which moved `ai-review.yml`): `grep` finds `ubuntu-latest` only in a comment
  in `ci.yml`.
- **Not verified yet:** `infra-staging`, on the owner's next `plan`.
- **On 26.04, `android-e2e`'s install was refused on attempt 1 in 3 of 6
  runs:** BUG-9's session error once, run 8's `NullPointerException` twice. The
  wait got past the NPE both times. BUG-9's own signature has not come back.
- **`ci.yml`'s comment on the emulator snapshot** ("a clean snapshot for later
  runs to start from") is not borne out by the logs, and is left for a follow-up
  (D-085).

**Open follow-ups from M0,** recorded in [`progress/m0.md`](progress/m0.md):
- **INF-08's two unverified things.** UptimeRobot's recovery was not captured.
  Its keyword rule was not looked at: the alert gave the root cause "Keyword
  Exists", while A-25 asked for an alert when `"status":"ok"` does *not* exist.
  The alert came during the stop, which is what A-25's rule does, so the setting
  is probably right and the wording is UptimeRobot's. If the monitor ever shows
  Down while staging is healthy, the rule is inverted.
- ~~The local mutation reports reuse old results for unchanged code.~~
  Resolved by D-099 (BUG-12, merged as `a47334f`).
- D-036's nightly full mutation run.
- D-079's hand-offs to M2.
- AR-10's import rule, which nothing enforces.
- ESLint reading Stryker's `.stryker-tmp/` during a run.
- **From INF-10:**
  - the live attempt at drills 6 and 8 is an M5 go-live item (D-083). It runs
    once from the Mac as `urso-agent`, with the owner watching;
  - `reviewCodeowners` ignores GitHub's last-match rule for CODEOWNERS, found by
    `test-author`. BUG-8's test covers the six new paths and `packages/config`
    (D-084); everywhere else it is a `/bugfix` candidate;
  - the drills and `gate.test.mjs` each hold copies of the workflow-reading
    helpers. One tested reader should replace them (`code-reviewer`);
  - the drills do not carry a workflow's `env:` into the gates. A gate that
    honoured an env toggle set in the workflow would get past them; none does
    today;
  - when the test kit's phone-number builder lands, the drills' number should
    come from it (`privacy-security-reviewer`).

**An unmerged branch exists: `claude/inf-04-follow-through`.** It closes INF-04's
record and widens `engines.node` so Dependabot can run. It holds **D-063 and
D-064**, which is why INF-05's decisions start at D-065. Deliberately parked, not
forgotten.

**The `ai-review.yml` batch — three items left.** The
verdict corroboration shipped in #16 and works: every reviewer on #18 went green
only with a corroborating comment (read in `test-auditor`'s log; the others by
their green checks). `checks: read` also shipped in #16, and **does not work** —
the first item below. What remains:

- **`checks: read` never reaches the reviewer.** It is on the job's token, and
  the reviewer's `gh` does not use that token. With no `github_token` input the
  action mints the Claude app's token — `contents`, `pull_requests` and `issues`
  only (`src/github/token.ts:69-73` at the pinned commit) — and sets `GH_TOKEN`
  to it (`src/entrypoints/run.ts:189-191`). The action's documented route is
  `additional_permissions: | actions: read`. **Evidence:** that source, read on
  2026-09-24, and `test-auditor` reporting a 403 reading check results on #18.
  **Not in the evidence:** the 403 itself — the action does not print the
  agent's tool calls, so the job log cannot show it. Also unknown: whether the
  Claude app's installation may grant `actions: read` at all.

- **The Dependabot guard message.** It fires when neither
  `CLAUDE_CODE_OAUTH_TOKEN` nor `ANTHROPIC_API_KEY` is visible and then advises
  running `claude setup-token`. A-09 is done and the repository secret is set,
  so the only way it can fire now is a context where repository secrets are not
  passed at all — a Dependabot pull request being the one that happens here.
  The advice is wrong for that case and should name it. **Grounded**, since the
  owner confirmed which secrets exist.
- **The cancelled-versus-failed guard condition.** `needs.changes.result != 'success'`
  treats a cancelled duplicate run as a failure, producing reds that look real.
  **Not re-verified today**, so it waits: changing an unreviewable file on an
  unverified claim is how the placeholder verdict got in.

Three small changes to `ai-review.yml`'s safety filter shipped ahead of the
batch, each merged by hand (D-075): [#21](https://github.com/bvst/TryggHverdag/pull/21)
(the worker files), [#30](https://github.com/bvst/TryggHverdag/pull/30)
(`healthchecks.ts`, D-079) and [#45](https://github.com/bvst/TryggHverdag/pull/45)
(`apps/mobile/app.config.ts`, D-084). The runner label and the three action
bumps went in as [#48](https://github.com/bvst/TryggHverdag/pull/48). BUG-10's
filter (D-092) went in as [#56](https://github.com/bvst/TryggHverdag/pull/56),
and BUG-14's (D-100: the mutation check's own files, the test kit and the three
Vitest configs) as [#58](https://github.com/bvst/TryggHverdag/pull/58), both
merged by hand.

## History

[`progress/m0.md`](progress/m0.md) — the full narrative of M0, including the wrong
turns. Several entries exist only so the next session does not repeat them.
[`progress/m1.md`](progress/m1.md) — M1, from 2026-09-29.
[`progress/m2.md`](progress/m2.md) — M2, from 2026-10-01.
