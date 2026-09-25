# Progress log

**Last updated:** 2026-09-24 · **Milestone:** M0 (foundations)

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
| INF-00 | Mac environment check | ⬜ Waits for the Mac (A-10). `pnpm run doctor` is ready for it |
| INF-01 | Monorepo skeleton | ✅ Done — 2026-09-20 ([#2](https://github.com/bvst/TryggHverdag/pull/2)) |
| INF-02 | Claude Code configuration + hook tests | ✅ Done — 2026-09-20 ([#2](https://github.com/bvst/TryggHverdag/pull/2)) |
| INF-03 | Gate scripts + HK-08 | ✅ Done — 2026-09-20 ([#2](https://github.com/bvst/TryggHverdag/pull/2)) |
| INF-04 | CI workflows, merge rules, CODEOWNERS | ✅ Done — 2026-09-23 ([#3](https://github.com/bvst/TryggHverdag/pull/3)) |
| INF-05 | Server skeleton | ✅ Done — 2026-09-23 ([#6](https://github.com/bvst/TryggHverdag/pull/6)); four test levels green, mutation 100 % |
| INF-06 | App skeleton | ⬜ Waits for the Mac |
| INF-07 | Staging on Clever Cloud | 🟡 Merged 2026-09-24 ([#22](https://github.com/bvst/TryggHverdag/pull/22)). The first plan run planned staging (2 to add) and then failed on BUG-1, fixed on `fix/BUG-1-plan-stdin`. Done when staging is applied, a deploy runs and the smoke test passes (A-22) |
| INF-08 | Monitoring | ⬜ Next after INF-07: UptimeRobot will watch `https://trygghverdag-staging.cleverapps.io/v1/health` |
| INF-09 | Daily status workflow | 🟡 Merged 2026-09-24 ([#18](https://github.com/bvst/TryggHverdag/pull/18)). First report posted to [#19](https://github.com/bvst/TryggHverdag/issues/19) at 05:23 UTC, every step verified in the log. Done when the owner confirms it reached the phone (A-17) |
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

**A-22 — after INF-07 merges, create staging**: `infra-staging` with `plan`,
read it, then with `apply` and that run's ID. Then re-run the deploy that failed
on merge because there was nothing yet to deploy to.

**A-14 — the cloud environment's allowlist is applied** (2026-09-24); it
reached the running session without a restart. A setup script is still to come.

**A-17 — confirm the first daily report reached the phone.** It was posted to
[#19](https://github.com/bvst/TryggHverdag/issues/19) at 05:23 UTC on
2026-09-24, mentioning `@bvst`. That is INF-09's done-criterion, and only the
owner can see it. The 05:00 slot had not fired by 05:21, so the owner's fallback
applied and the run was started by hand. The slot did fire in the end — at
09:52, 4 h 52 min late — and posted a second report (see D-078).

**A-16 is done, and now verified** (2026-09-24). The first run's post step saw
`PING_CONFIGURED: true`, and its ping step logged
`Pinged Healthchecks.io with exit status 0`. That ping also armed the check:
Healthchecks.io never alerts on a check that has not been pinged — a `new`
check stays `new` (its own source, `hc/api/models.py`, `get_status`; the site's
docs are blocked from sessions).

**A-09 is done** (2026-09-23). `CLAUDE_CODE_OAUTH_TOKEN` is set;
`ANTHROPIC_API_KEY` is not.

**A-10 — the Mac.** Blocks INF-00 and INF-06, which is the app skeleton.

**A-01, A-02, A-03 — phones, Apple, Google Play.** Not blocking today; they
block the first real device build.

**A-08 — UptimeRobot** can watch staging once A-22 has created it.

**Dependabot and the reviewer gate.** `CLAUDE_CODE_OAUTH_TOKEN` is now in the
Dependabot secret store, which unblocks npm updates. **github-actions updates
still cannot pass**, structurally: `ai-review.yml` pins `actions/checkout`,
`actions/setup-node` and `pnpm/action-setup`, so bumping any of them edits that
workflow, and `claude-code-action` refuses to run when the workflow differs from
the default branch. Those pull requests need a manual merge (D-075).

## Live gotchas

The things that still bite, and cost a session hours the first time.

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

## In flight

**INF-07 — staging on Clever Cloud** (D-077), merged as
[#22](https://github.com/bvst/TryggHverdag/pull/22) on 2026-09-24.

**Its first runs on `main`, read from their logs:**
- `deploy-staging` failed as designed: `[ERROR] Application not found`, because
  nothing had created staging yet. Clever Cloud answered the CI user's key,
  which suggests A-19 and A-21 work.
- The owner then started `infra-staging` with `plan`
  ([run 36024686949](https://github.com/bvst/TryggHverdag/actions/runs/36024686949)).
  Terraform read its state from Cellar and planned `2 to add, 0 to change, 0 to
  destroy`, with the database password and URI shown as `(sensitive value)`. So
  the CI user's key, the Cellar keys, the bucket and the organisation all work,
  and the plan summary hides what it should.
- The step after it failed: `plan-approval: EAGAIN: resource temporarily
  unavailable, read`. **BUG-1**: the script read stdin with one synchronous
  read, which a pipe answers with EAGAIN while `terraform show` is still
  writing. `apply` would have failed the same way. Reproduced locally, then
  fixed test-first by reading stdin as a stream.
- **Next, after the BUG-1 fix merges:** `plan` again, then `apply` with that
  run's ID, then re-run `deploy-staging`.

**What it built:** three runnable server processes (migrate as the pre-run
hook, the API, and the worker beside it); Terraform for one nano instance and
the DEV PostgreSQL; a deploy on every merge to `main`, with a smoke test that
waits for a heartbeat well *after* the deploy; and a Terraform apply that takes
two runs the owner starts and applies only the plan the owner read. The
`ai-review.yml` change it needed shipped first, in
[#21](https://github.com/bvst/TryggHverdag/pull/21). **What only the first real
runs can verify** is listed at the end of D-077, with the follow-ups.

**INF-10 was parked for it.** Before switching, Claude found that
`req:coverage` counts requirement IDs, not acceptance criteria. RG-01 says the
same, but the roadmap's drill ("a new acceptance criterion without a test")
asks for more, so that drill would pass for a requirement that already has one
test. Raise it when INF-10 resumes.

**INF-09 — the daily status report** (D-076) is merged
([#18](https://github.com/bvst/TryggHverdag/pull/18)) and ran for the first time
at 05:21 UTC, by hand. Two of the three open questions are answered by its log:
the action ran on the read-only token (`Using provided GITHUB_TOKEN for
authentication`; the app-token revoke step `skipped`), and `gh issue pin` worked
with `GITHUB_TOKEN`. The third — does the mention reach the phone — is A-17.
The last open question is answered too: the **`schedule`** run at 09:52 passed
the action's human-actor check (`Auto-detected mode: agent for event: schedule`
· `Actor type: User` · `Verified human actor: bvst`), posted to #19, and pinged
Healthchecks.io with exit status 0. It ran 4 h 52 min late; GitHub names the top
of the hour as its high-load time, so the report moves to 04:47 UTC (**D-078**,
owner's decision 2026-09-25).

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

**After INF-06 lands**, `gate:integrity` will fail until `android-e2e` joins the
required list. Expected, not a defect.

## History

[`progress/m0.md`](progress/m0.md) — the full narrative, including the wrong
turns. Several entries exist only so the next session does not repeat them.
