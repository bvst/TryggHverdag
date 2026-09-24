# Progress log

**Last updated:** 2026-09-23 · **Milestone:** M0 (foundations)

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
| INF-07 | Staging on Clever Cloud | ⬜ Blocked: Clever Cloud API token |
| INF-08 | Monitoring | ⬜ Blocked: UptimeRobot needs a URL to watch (comes with INF-07) |
| INF-09 | Daily status workflow | 🟡 Merged 2026-09-24 ([#18](https://github.com/bvst/TryggHverdag/pull/18)); all three reviewers PASS. Done when the first report reaches the owner's phone (A-17) |
| INF-10 | Gate drills | ⬜ Not started. The first real test of the merge rules under load |

**The reviewer gate works.** As of 2026-09-23 it reviews real code and returns
verdicts. On its first working day it caught two genuine bugs, a half-finished
decision and a factually wrong count — all in Claude's own work. Before that it
could not record a verdict at all (D-069, D-070, D-073).

## What the owner still needs to do

**A-17 — the first daily report.** Check that it reaches the phone. That is
INF-09's done-criterion, and only the owner can see it. #18 merged at 04:57 UTC
on 2026-09-24; the owner chose to let the 05:00 slot run it, with a start by
hand as the fallback, because a scheduled run tests the one path a manual run
cannot.

**A-16 is done** (2026-09-24, reported by the owner). A session cannot read
secrets, so this is the owner's word until the first run's ping step passes.
Healthchecks.io does not alert on a check that has never been pinged — a `new`
check stays `new` (its own source, `hc/api/models.py`, `get_status`; the site's
docs are blocked from sessions) — so the dead-man's switch is armed by that
run, not by adding the secret.

**A-09 is done** (2026-09-23). `CLAUDE_CODE_OAUTH_TOKEN` is set;
`ANTHROPIC_API_KEY` is not.

**A-10 — the Mac.** Blocks INF-00 and INF-06, which is the app skeleton.

**A-01, A-02, A-03 — phones, Apple, Google Play.** Not blocking today; they
block the first real device build.

**A-08 — UptimeRobot** needs a URL to watch, so it follows INF-07.

**Dependabot and the reviewer gate.** `CLAUDE_CODE_OAUTH_TOKEN` is now in the
Dependabot secret store, which unblocks npm updates. **github-actions updates
still cannot pass**, structurally: `ai-review.yml` pins `actions/checkout`,
`actions/setup-node` and `pnpm/action-setup`, so bumping any of them edits that
workflow, and `claude-code-action` refuses to run when the workflow differs from
the default branch. Those pull requests need a manual merge (D-075).

## Live gotchas

The things that still bite, and cost a session hours the first time.

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
  looking for it and correctly reported finding nothing.
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
- **Read the job log before theorising** (D-070) and **say what you checked, not
  what you assume** — both are non-negotiables in `CLAUDE.md` because three
  hypotheses about one failing gate were wrong in a single morning.

## In flight

**INF-09 — the daily status report** (D-076) is merged
([#18](https://github.com/bvst/TryggHverdag/pull/18)) and waiting for its first
run. Three questions only that run can answer: does the action accept a
read-only token, does `gh issue pin` work with `GITHUB_TOKEN`, and does the
mention reach the phone.

**Merged:** 2026-09-23 — #13 (progress-log restructure, D-075), #14 (the
retraction that had only reached the archive), #15 (HK-09, the pre-commit hook),
#16 (the reviewer verdict must now be corroborated; `/.githooks/` owned;
`pnpm exec`), #17 (CI-12). 2026-09-24 — #18 (INF-09).

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

**After INF-06 lands**, `gate:integrity` will fail until `android-e2e` joins the
required list. Expected, not a defect.

## History

[`progress/m0.md`](progress/m0.md) — the full narrative, including the wrong
turns. Several entries exist only so the next session does not repeat them.
