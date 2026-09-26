# Progress log

**Last updated:** 2026-09-25 · **Milestone:** M0 (foundations)

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
| INF-06 | App skeleton | 🟡 In progress on `feat/INF-06-app-skeleton`: spec, tests and implementation committed; L7 and the development build proven on the Mac; reviews and pull request next. Needs the owner's A-28 (add `android-e2e` to the live ruleset) before merge |
| INF-07 | Staging on Clever Cloud | ✅ Done — 2026-09-25 ([#22](https://github.com/bvst/TryggHverdag/pull/22), fixes [#23](https://github.com/bvst/TryggHverdag/pull/23) [#24](https://github.com/bvst/TryggHverdag/pull/24), names [#25](https://github.com/bvst/TryggHverdag/pull/25)). A merge deployed and the smoke test passed; BUG-3 fixed ([#27](https://github.com/bvst/TryggHverdag/pull/27)) |
| INF-08 | Monitoring | 🟡 In flight — [#31](https://github.com/bvst/TryggHverdag/pull/31), all four reviews PASS; [#30](https://github.com/bvst/TryggHverdag/pull/30) merged. Done when the owner's drill passes (A-26) |
| INF-09 | Daily status workflow | ✅ Done — 2026-09-25 ([#18](https://github.com/bvst/TryggHverdag/pull/18)). The owner sees the report on the phone, in [#19](https://github.com/bvst/TryggHverdag/issues/19) (A-17). Moves to 04:47 UTC in [#26](https://github.com/bvst/TryggHverdag/pull/26) (D-078) |
| INF-10 | Gate drills | ⬜ Not started. Parked 2026-09-24 for INF-07. Open question to the owner: split into offline drills now and live GitHub drills later? |

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

**A-17 is done** (2026-09-25): the owner sees the daily report on the phone,
as the GitHub issue [#19](https://github.com/bvst/TryggHverdag/issues/19). That
was INF-09's done-criterion, so INF-09 is done.

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

**A-08 — UptimeRobot** can now watch staging: `https://trygg-hverdag-staging.cleverapps.io/v1/health` (INF-08). Its own step is now A-25.

**#30 is merged** (2026-09-25, by hand, D-075): the ai-review safety filter
lists the Healthchecks.io adapter, so #31 now adds it to
`OWNER_APPROVAL_PATHS` too.

**A-23 to A-26 — monitoring (INF-08).** Steps for the owner, written out in
[`plan/monitoring-setup.md`](plan/monitoring-setup.md): the worker's
Healthchecks.io check and the `HEALTHCHECKS_WORKER_URL` secret (A-23, can be
done before #31 merges); after #31 merges,
`infra-staging` plan and apply, then confirming the check leaves `new` (A-24);
the UptimeRobot keyword monitor and its mobile app (A-25); and the drill,
which is INF-08's done-criterion (A-26).

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
  limit, and the owner raising it fixed it within minutes. This repository is
  private, so Actions minutes bill against the account; a public one gets
  standard runners free and cannot fail this way. **Check Settings → Billing and
  licensing → Plans and usage first.** Re-running is pointless and consumes more
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
- **Stryker's local incremental report reuses old results for unchanged
  code.** With the command runner, `mutantCanBeReused` is always true — the
  command runner never reports coverage, so every mutant outside the diff
  keeps its previous status whether or not it is still killed. Confirmed on
  INF-08: `worker.ts:208` showed Survived in `reports/stryker-incremental.json`
  while a hand mutant proved it killed. Never cite that file as current for
  code the branch did not change; plant a hand mutant to check. CI is
  unaffected — nothing caches `reports/`.

## In flight

**INF-08 — monitoring** ([#31](https://github.com/bvst/TryggHverdag/pull/31),
on `claude/busy-faraday-40n2zl`; #30 merged). Reviews and `gate:full` are
done; CI's first run on #31 found the mutation gate out of time, fixed below.

- **The mutation gate ran out of time, and is now grouped** (owner's choice,
  D-066 amended). CI's log: `spawnSync pnpm ETIMEDOUT`, "Stryker did not
  finish … make that faster before raising MUTATION_TIMEOUT_MS". Every pull
  request mutated every safety file (197 mutants) with the whole suite per
  mutant, and INF-08 made that suite 40 % slower. Now domain mutants run the
  domain tests, the adapter's run its tests and the worker's, and the rest
  the whole suite. Measured fresh at two cores: 954 s, every run passing
  (69/69, 44/44, 82/84); it was heading for about 26 minutes. The budget
  stays 25. D-036's nightly full run was never built; grouping keeps every
  pull request a full run meanwhile.
- **`OWNER_APPROVAL_PATHS` lists the adapter**, and a new test holds that
  every safety path is one the owner approves.

- **Reviews: all four PASS, one round.** safety-reviewer, privacy-security-
  reviewer, code-reviewer (advisory), test-auditor. No BLOCK. Round 1 found
  three things, all fixed (`09beb34`, `53a74c2`, `0b434cc`, `06a9ba7`,
  `86c094d`): a followed redirect could count as a ping or leak the URL over
  `http:` — now refused (`redirect: 'manual'`); the drill was timed from the
  stop rather than the last ping — fixed in `monitoring-setup.md`; and the
  owner decided the adapter is a safety path (D-079) — CODEOWNERS and
  `SAFETY_PATHS` cover it here, the ai-review filter line is in #30.
- **Built:** the heartbeat task checks in with Healthchecks.io only after its
  beat is recorded; a failed check-in is one written line, never a failed
  task; `HEALTHCHECKS_WORKER_URL` never stops the worker; the ping URL is
  never written and redirects are refused; the build machine never checks in
  (BUG-3); Terraform requires and hides the URL. D-079: UptimeRobot Free on
  staging now, Solo at go-live.
- **Coverage and mutation:** the adapter is now measured, unlike other
  adapters (L3-only by design; this one is L2-tested) — 100 % branches, 44 of
  44 mutants, after the first pass scored 29.55 % (an emptied catch block
  survived). The coverage baseline was brought current (`86c094d`, dated from
  INF-05): 28 files added, 23 figures raised, none lowered.
- **`gate:full`, this session: 10 passed.** `gate:integrity` could not read
  the rulesets (no token in a session; test-auditor confirmed the required
  checks with an anonymous read, but who can bypass them stays unverified).
  Integration tests are not possible without Docker.
- **A false reading, corrected.** The orchestrator first reported the
  mutation run as "97.0 %, survivors only on untouched lines" from the local
  incremental report; test-auditor showed that report reuses old results for
  code the branch did not change, so `worker.ts:208`, shown as Survived, is in
  fact killed (see "Live gotchas"). CI is unaffected. Full account:
  [`progress/m0.md`](progress/m0.md).
- **Verified:** `gate:quick`, `coverage:ratchet`, `infra:check` green,
  `api:diff` reports no change, `req:coverage` shows REL-08 at 4 of 63 (was 3).
- **Left:** #31 green on CI and merged, then the owner's steps A-23 to A-26
  — the drill (A-26) is INF-08's done-criterion and has not happened yet.
- **Follow-ups, not this PR:** locally, the incremental reports still reuse
  old results for unchanged code — `scripts/mutation.mjs` should drop them
  when a test changed (test-auditor, pre-existing; CI is unaffected); D-036's
  nightly full run; the D-079 M2 hand-offs (already recorded in D-079);
  AR-10's import rule is enforced by nothing (code-reviewer; already a D-077
  follow-up); ESLint reads Stryker's `.stryker-tmp/` sandbox while a run is in
  progress, so `gate:quick` is red locally during one.
- **Gotcha:** `req:coverage` counts REL-08, not INF-08 — a spec that names a
  requirement ID (this one names REL-08) needs its own tests to name that ID
  too, or RG-01 fails on the branch.

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

**INF-10 was parked for it.** Before switching, Claude found that
`req:coverage` counts requirement IDs, not acceptance criteria. RG-01 says the
same, but the roadmap's drill ("a new acceptance criterion without a test")
asks for more, so that drill would pass for a requirement that already has one
test. Raise it when INF-10 resumes.

**[#26](https://github.com/bvst/TryggHverdag/pull/26) — the daily report moves
to 04:47 UTC** (D-078, owner's decision 2026-09-25). The first `schedule` run
came at 09:52 for the 05:00 slot, 4 h 52 min late, and GitHub names the top of
the hour as its high-load time. After it merges, #19's description — written
once, still saying 05:00 — is updated by hand.

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
