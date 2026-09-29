# Progress log

**Last updated:** 2026-09-29 · **Milestone:** M0 closed (2026-09-29, D-083) · next: M1, the spike

What is true **right now**. The narrative — why each thing was built and what
went wrong on the way — is in [`progress/m0.md`](progress/m0.md).

This file is kept short on purpose. `CLAUDE.md` tells every session to read it
before doing anything, and a thousand-line file that is read under protest stops
being read at all. It reached 1,336 lines and, more to the point, **went stale
where it mattered**: four items under "In flight" described work that was already
done. Length was the symptom; a status nobody trusts was the cost.

The plan is in [`plan/README.md`](plan/README.md); the M0 task list is in
[`plan/10-roadmap.md`](plan/10-roadmap.md). One task per pull request (D-052).

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

**Next:**
- **BUG-8.** The remaining gate files need the owner (D-084). Step 1 merged
  as #45; step 2 is #46.
- **M1, the spike,** when the owner starts it.

**The reviewer gate works.** As of 2026-09-23 it reviews real code and returns
verdicts. On its first working day it caught two genuine bugs, a half-finished
decision and a factually wrong count — all in Claude's own work. Before that it
could not record a verdict at all (D-069, D-070, D-073).

## What the owner still needs to do

**A-18 to A-21 — staging's accounts and keys are done** (2026-09-24): the
`TryggHverdag Staging` organisation (its ID committed), the Cellar bucket at the
host `versions.tf` already used, the CI user, and the `staging` environment with
its four keys. A-19 and A-21 are the owner's report: a session's GitHub access
may not read environment settings, so neither the `main` limit nor the secret
names were confirmed from here. The first `infra-staging` plan run proves the
keys work.

**A-22 is done** (2026-09-25). The owner's `plan`, `apply` and re-run deploy
created staging at `https://trygg-hverdag-staging.cleverapps.io`, and the
keys, the state bucket and the approval all worked in real runs. Left over:
delete the first apply's `trygghverdag-staging` app and database in the
console. They are outside Terraform, and the app costs money.

**A-14 — the cloud environment's allowlist is applied** (2026-09-24); it
reached the running session without a restart. A setup script is still to come.

**A-27 — raise the daily-status check's grace in Healthchecks.io to 8 hours**
(about a minute; agreed 2026-09-26). GitHub starts the report hours late by
varying amounts, and 3 hours' grace could page for a run that happened (D-080).

**A-17 is done** (2026-09-25): the owner sees the daily report on the phone,
as the GitHub issue [#19](https://github.com/bvst/TryggHverdag/issues/19). That
was INF-09's done-criterion, so INF-09 is done. Since D-080 the report is the
description of [#35](https://github.com/bvst/TryggHverdag/issues/35). Merging
#32 closed #19 (see "Live gotchas"), and the next run opened #35, pinned and
assigned to the owner.

**A-16 is done, and now verified** (2026-09-24). The first run's post step saw
`PING_CONFIGURED: true`, and its ping step logged
`Pinged Healthchecks.io with exit status 0`. That ping also armed the check:
Healthchecks.io never alerts on a check that has not been pinged — a `new`
check stays `new` (its own source, `hc/api/models.py`, `get_status`; the site's
docs are blocked from sessions).

**A-09 is done** (2026-09-23). `CLAUDE_CODE_OAUTH_TOKEN` is set;
`ANTHROPIC_API_KEY` is not.

**A-10 is done** (2026-09-25). `claude-dev` acts on GitHub as `urso-agent` only — `gh`, SSH and the HTTPS remote were each checked — and the owner removed the old `bvst` key from this user.

**A-01, A-02, A-03 — phones, Apple, Google Play.** Not blocking today; they
block the first real device build.

**A-08 and A-23 to A-26 are done** (INF-08). The owner followed
[`plan/monitoring-setup.md`](plan/monitoring-setup.md) and ran the drill on
2026-09-26. On 2026-09-28 the owner accepted it: both monitors alert by email,
and UptimeRobot's app was not installed ("it is enough for now"). What the
drill showed is under INF-08 below.

**Dependabot and the reviewer gate.** `CLAUDE_CODE_OAUTH_TOKEN` is now in the
Dependabot secret store, which unblocks npm updates. **github-actions updates
still cannot pass**, structurally: `ai-review.yml` pins `actions/checkout`,
`actions/setup-node` and `pnpm/action-setup`, so bumping any of them edits that
workflow, and `claude-code-action` refuses to run when the workflow differs from
the default branch. Those pull requests need a manual merge (D-075).

## Live gotchas

The things that still bite, and cost a session hours the first time.

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
  archive and recording its hash by hand (D-077 item 16).
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
  of what is already gone. Fifteen jobs fire on every push (nine `ci`, six
  `ai-review`), so a day of many small pushes is expensive — which is the
  argument for path filters on the docs-only ones.
- **A green `ai-review` tick is not proof a review happened.** Twice on #15 a
  reviewer returned a verdict without having reviewed. `test-auditor` — one of
  the three *blocking* reviewers — emitted
  `{"verdict":"PASS","summary":"Placeholder — waiting for test-auditor subagent
  to finish before posting PR comment and final verdict."}`, and the gate, which
  only greps for `^(PASS|BLOCK)$`, accepted it. `code-reviewer` hit the same
  cut-off and honestly returned `BLOCK`, but it is advisory, so the job warned,
  exited 0 and pointed at a comment that was never posted. **The tell is a
  reviewer that goes green without commenting**, in well under the four to six
  minutes a real review takes. Read the job log's `STRUCTURED:` line before
  trusting any verdict. The fix belongs in `ai-review.yml`, so it waits for a
  D-075 batch — which is also why it went unnoticed.
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
  the fix on this branch. Set the environment in the spawn; don't inherit it.
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
- **Stryker's local incremental report reuses old results for unchanged
  code.** With the command runner, `mutantCanBeReused` is always true — the
  command runner never reports coverage, so every mutant outside the diff
  keeps its previous status whether or not it is still killed. Confirmed on
  INF-08: `worker.ts:208` showed Survived in `reports/stryker-incremental.json`
  while a hand mutant proved it killed. Never cite that file as current for
  code the branch did not change; plant a hand mutant to check. CI is
  unaffected — nothing caches `reports/`.
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
- **Two sessions can take the same decision number.** On 2026-09-29, #43
  (another session, still open) and #44 (merged) both wrote a D-083, each
  the next number after `main`'s last at the time. Before taking a number,
  check the open pull requests' `decisions.md` too.

## In flight

**BUG-8, step 2 of 2: the remaining gate files need the owner (D-084),
[#46](https://github.com/bvst/TryggHverdag/pull/46).** Auto-merge is on, and
`urso-agent` approves automatically (D-072).
- **Step 1 is merged:** [#45](https://github.com/bvst/TryggHverdag/pull/45),
  the owner's decision (2026-09-29). It adds `apps/mobile/app.config.ts` to
  ai-review's safety filter. The owner merged it by hand at 13:19 UTC (D-075).
- **Step 2, test-first:** six paths join `OWNER_APPROVAL_PATHS` and
  `.github/CODEOWNERS`: `eslint.config.mjs`, `.dependency-cruiser.cjs`,
  `stryker.config.mjs`, `coverage-baseline.json`, `packages/config/` and
  `apps/mobile/app.config.ts`.
- **Verified in session:** 1497 of 1497 tests pass. `gate:quick`,
  `tests:changes`, `req:coverage` and the coverage ratchet are green.
- **Not verified here:** `gate:integrity`'s two GitHub API sections. CI's
  `gate-integrity` job runs them with its token.

**D-085: CI moves to `ubuntu-26.04` before GitHub moves `ubuntu-latest`**
(branch `claude/busy-faraday-40n2zl`). GitHub moves `ubuntu-latest` to 26.04
between 19 October and 19 November 2026. Every job in `ci.yml`,
`deploy-staging.yml`, `infra-staging.yml` and `daily-status.yml` now names
`ubuntu-26.04`, so the pull request's own CI is the test. `ai-review.yml` stays
on `ubuntu-latest` and moves in its own hand-merged pull request afterwards
(D-075). Not verified until after merge: `deploy-staging` (the merge is its
first run), `daily-status` (the next morning) and `infra-staging` (the owner's
next `plan`). On the first 26.04 run, 9 of 10 `ci` jobs were green.
`android-e2e` failed its install with a third not-ready signature, a
`SecurityException` refusing the install's own session. BUG-9 makes the install
wait through it, as it does for the other two. The IDs were D-083 and BUG-8
until `main` took both (#44). On four 26.04 runs the install was refused on
attempt 1 twice: once with BUG-9's session error, once with run 8's known NPE,
which the wait got past on attempt 2. The later three runs were green. The three
blocking reviewers gave PASS in CI. It waits on the owner's approval.

**INF-08 is done** (2026-09-28).
[#30](https://github.com/bvst/TryggHverdag/pull/30) and
[#31](https://github.com/bvst/TryggHverdag/pull/31) merged on 2026-09-25. The
owner ran the drill on 2026-09-26 and accepted it on 2026-09-28. The times come
from the three alert emails, in UTC:

| What | When |
|---|---|
| The worker's last ping, L | about 14:33 (the down email: "3 minutes ago") |
| Healthchecks.io down, alert by email | 14:36:16, about 3 minutes after L, inside REL-08's 5 |
| UptimeRobot incident, alert by email | 14:37:04 |
| Healthchecks.io up | 14:44:00, after 7 min 44 s down |
| UptimeRobot up | not captured |

The owner accepted it as is: both monitors alert by email, and UptimeRobot's app
was not installed ("it is enough for now"). Two things are unverified:
- **UptimeRobot's recovery** was not captured.
- **Its keyword rule.** The alert gave the root cause "Keyword Exists", while
  A-25 asked for an alert when `"status":"ok"` does *not* exist. The alert came
  during the stop, which is what A-25's rule does; a monitor with that rule
  inverted would have alerted while staging was healthy. So the setting is
  probably right and the wording is UptimeRobot's, but nobody has looked at the
  setting. If the monitor ever shows Down while staging is healthy, the rule is
  inverted.

Open follow-ups, recorded in [`progress/m0.md`](progress/m0.md):
- The local mutation reports reuse old results for unchanged code.
- D-036's nightly full mutation run.
- D-079's hand-offs to M2.
- AR-10's import rule, which nothing enforces.
- ESLint reading Stryker's `.stryker-tmp/` during a run.

**INF-07 is done** (2026-09-25). A merge (#26) deployed staging and the smoke
test passed ([run 36096293539](https://github.com/bvst/TryggHverdag/actions/runs/36096293539)),
after three bugs, each found in a real run's log and fixed test-first:
- BUG-1, plan approval reading stdin;
- BUG-2, Cellar refusing the state checksum;
- BUG-3, the worker also starting on Clever Cloud's build machine — fixed and
  merged ([#27](https://github.com/bvst/TryggHverdag/pull/27)).

The staging names were changed to `trygg-hverdag` before the working apply
(#25). What the real runs settled, from their logs, is recorded in D-077 and
[`progress/m0.md`](progress/m0.md). Two old resources from the first apply
(`trygghverdag-staging` and `-db`) are outside Terraform and should be deleted
in the console. The app costs money.

**INF-10 is done** (2026-09-29, [#42](https://github.com/bvst/TryggHverdag/pull/42)).
`pnpm run gate:drills` tries a bad change against each gate and prints nine
rows. The drill file, `scripts/drills.test.mjs`, runs in CI's `unit` job on
every pull request that can change a gate. Each drill:
- reads its command from where the real system does: `ci.yml`,
  `package.json`, `settings.json`, the agent's definition or `ai-review.yml`;
- also fails when that step or its job is made to tolerate the gate (`|| true`,
  `continue-on-error`, or an `if:` or `needs:` that is not its own).

The owner answered seven questions, each with the recommended option, in
**D-082**:
1. offline drills now, and one live attempt at the two GitHub-only drills
   later;
2. `req:coverage` checks each acceptance criterion (RG-01 amended);
3. oasdiff 1.32.1 is installed in `unit` and `contract`, pinned by its
   published SHA-256;
4. and 5. RG-03's check also counts conditional, chained and in-body skips,
   the same forms on `suite` and on any test object, and tests inverted with
   `.fails`/`.failing`;
6. and 7. the three root Vitest configurations need the owner's approval.

Evidence, all re-run by the main session rather than taken from a report:
- **Red first,** in four rounds, each checked independently. The first had 68
  failing tests of 1364, all INF-10.
- **Green:** 1495 of 1495, with the whole suite and `gate:quick` passing.
- **The ratchet was not lowered.** When the entry script `req-coverage.mjs`
  dropped to 4/44 lines, its decisions moved into `requirements.mjs`, which is
  tested in-process. D-060 raised the baseline for INF-10's own files only.
- **Red when forced.** Each drill went red when its real gate was made to
  always pass, and CI-06 proved detection with the real oasdiff.
- **Reviews:** `code-reviewer`, `test-auditor` and `privacy-security-reviewer`
  all passed. Every should-fix went into this pull request.

**Open follow-ups:**
- the live attempt at drills 6 and 8 is an M5 go-live item (D-083). It runs
  once from the Mac as `urso-agent`, with the owner watching;
- `reviewCodeowners` ignores GitHub's last-match rule for CODEOWNERS, found
  by `test-author`. This predates INF-10 and is a `/bugfix` candidate;
- the drills and `gate.test.mjs` each hold copies of the workflow-reading
  helpers. One tested reader should replace them (`code-reviewer`);
- the drills do not carry a workflow's `env:` into the gates. A gate that
  honoured an env toggle set in the workflow would get past them; none does
  today;
- when the test kit's phone-number builder lands, the drills' number should
  come from it (`privacy-security-reviewer`).

**The daily report becomes a dashboard (D-080, owner's decision 2026-09-26).**
Each run replaces the pinned issue's description with the current state, like
Renovate's Dependency Dashboard, instead of adding a comment; and it runs at
01:07 UTC. Why: the comments were turning the issue into a log, and GitHub
started both scheduled slots about 4¾ h late (05:00 → 09:52; 04:47 → 09:32), so
D-078's move off the hour did not help, as D-078 allowed. What stops: the daily
push — an edited description notifies nobody. What still pages: a failed run
(Healthchecks.io gets `/1`) and a missing one (the grace period).

**It has been live since 2026-09-27, as
[#35](https://github.com/bvst/TryggHverdag/issues/35).** Merging #32 closed #19,
and the next run opened #35 ("Created issue #35 for the daily report."), pinned
it, and ended with a ping of `exit status 0`. The first two scheduled runs
started at 06:29 and 06:38 UTC, 5 h 22 min and 5 h 31 min late, so the report
lands around 08:30 in Oslo. A-27 (grace 8 hours) is still open.

**The missed-run alarm is proven** (2026-09-25). #26 merged at 04:53, between the
old slot and the new, so no run happened that day; Healthchecks.io paged the
owner, who confirmed it. The next run (09:32, 2026-09-26) posted and pinged
`exit status 0`. #19's description had been updated to 04:47 on 2026-09-25,
identical to what `issueBody()` rendered; D-080 replaces it with the dashboard.

**INF-09 is done** (2026-09-25). Every open question was answered by a real run's
log: the read-only token (`Using provided GITHUB_TOKEN for authentication`;
app-token revoke `skipped`), `gh issue pin` with `GITHUB_TOKEN`, a `schedule`
run passing the action's human-actor check (`Actor type: User` · `Verified human
actor: bvst`), the Healthchecks.io ping (exit status 0), and — from the owner —
the report reaching the phone.

**Merged:** 2026-09-23 — #13 (progress-log restructure, D-075), #14 (the
retraction that had only reached the archive), #15 (HK-09, the pre-commit hook),
#16 (the reviewer verdict must now be corroborated; `/.githooks/` owned;
`pnpm exec`), #17 (CI-12). 2026-09-24 — #18 (INF-09), #20 (CI-12: the test that
had kept `main` red since #17 inherited the runner's `GITHUB_EVENT_NAME`).
2026-09-25 — [#31](https://github.com/bvst/TryggHverdag/pull/31) (INF-08).
2026-09-26 — [#32](https://github.com/bvst/TryggHverdag/pull/32) (D-080: the
daily report is a dashboard) and [#33](https://github.com/bvst/TryggHverdag/pull/33) (BUG-5: a
failed BUG-3 worker test no longer leaves its worker running; test-only,
merged by the owner 17:16:26Z). 2026-09-28 —
[#34](https://github.com/bvst/TryggHverdag/pull/34) (INF-06),
[#37](https://github.com/bvst/TryggHverdag/pull/37) (BUG-6: the emulator gets
4 cores) and [#39](https://github.com/bvst/TryggHverdag/pull/39) (record).
2026-09-29 — [#40](https://github.com/bvst/TryggHverdag/pull/40) (BUG-7:
every changed-file list names both paths of a move),
[#41](https://github.com/bvst/TryggHverdag/pull/41) (BUG-7's record) and
[#42](https://github.com/bvst/TryggHverdag/pull/42) (INF-10: the gate drills).
Full account in [`progress/m0.md`](progress/m0.md).


**An unmerged branch exists: `claude/inf-04-follow-through`.** It closes INF-04's
record and widens `engines.node` so Dependabot can run. It holds **D-063 and
D-064**, which is why INF-05's decisions start at D-065. Deliberately parked, not
forgotten.

**Two Dependabot branches are open** (`actions/checkout`, `actions/setup-node`).
Both bump actions that `ai-review.yml` pins, so both edit that workflow and
neither can pass the reviewers. They need a manual merge (D-075).

**The `ai-review.yml` batch — three items left.** The verdict corroboration
shipped in #16 and works: every reviewer on #18 went green only with a
corroborating comment (read in `test-auditor`'s log; the others by their green
checks). `checks: read` also shipped in #16, and **does not work** — the
first item below. What remains:

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

**One change to `ai-review.yml` shipped on its own, ahead of the batch**
(owner's decision, 2026-09-24). INF-07 makes `apps/server/src/bin/worker.ts`
and `apps/server/src/process.ts` safety code: they decide whether a stopped
worker is restarted. The safety filter lists them first, in a two-line pull
request merged by hand (D-075, [#21](https://github.com/bvst/TryggHverdag/pull/21),
merged 2026-09-24). INF-07 then adds them to CODEOWNERS and the owner-approval
list, and keeps its own AI reviews. The three items above still wait.
A second one-line change follows the same route (owner's decision,
2026-09-25): the filter lists `apps/server/src/adapters/healthchecks.ts`,
INF-08's Healthchecks.io adapter. A ping it sent on its own would keep a dead
worker's check green, so INF-08 makes it a safety path, owned by the owner.
`config.ts` stays out on purpose: a mistake there fails loudly.

**INF-06's own pull request** turns `gate:integrity` red as soon as it adds
`e2e:android`: the check reads the branch's `package.json`
(`scripts/gate-integrity.mjs:255`). The owner adds `android-e2e` to the live
ruleset before merge (A-28). This is expected, not a defect.

## History

[`progress/m0.md`](progress/m0.md) — the full narrative, including the wrong
turns. Several entries exist only so the next session does not repeat them.
