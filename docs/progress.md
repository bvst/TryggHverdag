# Progress log

**Last updated:** 2026-09-30 · **Milestone:** M1 started (owner, 2026-09-29): SPIKE-01's spec is written, and the spike is built next, on the Mac · M0 closed 2026-09-29 (D-083)

What is true **right now**. The narrative — why each thing was built and what
went wrong on the way — is in [`progress/m0.md`](progress/m0.md) for M0 and
[`progress/m1.md`](progress/m1.md) for M1.

This file is kept short on purpose. `CLAUDE.md` tells every session to read it
before doing anything, and a thousand-line file that is read under protest stops
being read at all. It reached 1,336 lines and, more to the point, **went stale
where it mattered**: four items under "In flight" described work that was already
done. Length was the symptom; a status nobody trusts was the cost.

The plan is in [`plan/README.md`](plan/README.md); the milestone task lists are in
[`plan/10-roadmap.md`](plan/10-roadmap.md). One task per pull request (D-052).

## M1 at a glance

M1's exit: spike results recorded, the SDK go/no-go decision, and Section 4
closed.

| ID | Task | Status |
|----|------|--------|
| SPIKE-01 | Background safety on emulators and simulators: S1–S7, and S8, MapLibre with Kartverket's tiles | 🟡 In flight — the spec is written ([`specs/SPIKE-01.md`](specs/SPIKE-01.md), 16 acceptance criteria, commit `27873bf`). Its docs-only pull request is next, then the build and the runs in a Mac session |
| — | Critical Alerts request drafted | ⚪ Not started. The roadmap lists it under M1, but it has no ID and no spec (an open item in [`progress/m1.md`](progress/m1.md)) |

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

**The reviewer gate works.** As of 2026-09-23 it reviews real code and returns
verdicts. On its first working day it caught two genuine bugs, a half-finished
decision and a factually wrong count — all in Claude's own work. Before that it
could not record a verdict at all (D-069, D-070, D-073).

## What the owner still needs to do

**The SPIKE-01 spec's pull request, when it is open.** The spec is
[`specs/SPIKE-01.md`](specs/SPIKE-01.md). Five open items came out of planning it
and wait for the owner, in [`progress/m1.md`](progress/m1.md). One is to be asked
with the go/no-go: when the licence is bought. Nothing else is needed to start
the spike, except:
- **the Mac:** about 8 to 9 hours of Mac time, on power and awake, preferably
  overnight;
- **CocoaPods,** only if the Mac lacks it: installing it needs the owner's admin
  account (D-056);
- **a Kartverket account or key,** only if its terms ask for one. The spike stops
  and asks first.

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
Alerts request, and when that is sent is an open item in
[`progress/m1.md`](progress/m1.md). The rest block the first real device build.

**Dependabot and the reviewer gate.** `CLAUDE_CODE_OAUTH_TOKEN` is in the
Dependabot secret store, which unblocks npm updates. **github-actions updates
still cannot pass**, structurally: `ai-review.yml` pins actions such as
`actions/checkout`, `actions/setup-node` and `pnpm/action-setup`, so bumping any
of them edits that workflow, and `claude-code-action` refuses to run when the
workflow differs from the default branch. Those pull requests need a manual merge
(D-075). Three are open, and GitHub's pulls API reported each as mergeable but
blocked when they were checked for this record (2026-09-30):
- [#4](https://github.com/bvst/TryggHverdag/pull/4): `actions/setup-node` 6.5.0
  to 7.0.0;
- [#5](https://github.com/bvst/TryggHverdag/pull/5): `actions/checkout` 6.1.0 to
  7.0.1;
- [#36](https://github.com/bvst/TryggHverdag/pull/36): the non-major group,
  `anthropics/claude-code-action` 1.0.231 to 1.0.235.

All three change `ai-review.yml`, and #4 and #5 also change the four workflows
that #43 moved to `ubuntu-26.04`.

**Done, and recorded elsewhere:** A-04 to A-10, A-15 to A-26 (bar A-22's leftover)
and A-28. Each row is in [`plan/README.md`](plan/README.md), and the evidence is
in [`progress/m0.md`](progress/m0.md). Still true from them:
`CLAUDE_CODE_OAUTH_TOKEN` is set and `ANTHROPIC_API_KEY` is not; `claude-dev` acts
on GitHub as `urso-agent` only; the owner accepted the INF-08 drill with no
UptimeRobot app ("it is enough for now").

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
- **Two sessions can take the same decision number.** On 2026-09-29, #43 and #44
  both wrote a D-083, each the next number after `main`'s last at the time. #44
  merged first, and #43 renumbered to D-085 and BUG-9. Before taking a number,
  check the open pull requests' `decisions.md` too, and check it again before
  each push.
- **The agent briefs still send the narrative to `m0.md`.** `plan-keeper`,
  `/status` and `/bugfix` name `docs/progress/m0.md`. M1's narrative is
  [`progress/m1.md`](progress/m1.md), and a bug's next `BUG-<n>` has to be
  looked for in both files. The last paragraph of `progress/m1.md` says why.

## In flight

**SPIKE-01: the spec is written, its pull request is next, and the Mac session
follows** ([`specs/SPIKE-01.md`](specs/SPIKE-01.md), commit `27873bf` on
`claude/busy-faraday-40n2zl`). Look for that pull request before opening another.
- **The owner's choices (2026-09-29):**
  - the spec is written in a cloud session and reviewed as a docs-only pull
    request;
  - the spike is built and run in a Mac session (D-055);
  - S8 is in. It checks MapLibre with Kartverket's tiles at Galdhøpiggen, as
    D-026 asks. It does not count toward the location SDK's go/no-go.
- **The spec has 16 acceptance criteria:** AC1–AC4 are the setup, AC5–AC11 are
  S1–S7, AC12–AC15 are the rules and the go/no-go, and AC16 is S8.
- **Not started:** the spike's code (`spikes/` holds only its README), its tests
  and its results (`docs/plan/04b-spike-results.md`).
- **Not checked:** the spec was written with no simulator, emulator or outside
  documentation. Every platform command in it is marked "verify", and the SDK's
  version, licence and price, MapLibre's version and Kartverket's terms are all
  unverified until the Mac session.
- **Open for the owner:** five items found in the plan, in
  [`progress/m1.md`](progress/m1.md).

**D-085's loose ends** (the pull request merged, [#43](https://github.com/bvst/TryggHverdag/pull/43)).
- **Verified:** `deploy-staging` on `ubuntu-26.04`. Run 36621209842, for
  `0637482`, succeeded, and so did its Deploy step and its smoke test.
- **Verified:** `daily-status` on `ubuntu-26.04`, 2026-09-30 06:34 UTC, both
  jobs.
- **Not verified yet:** `infra-staging`, on the owner's next `plan`.
- **The D-075 batch is in flight** (branch `claude/busy-faraday-40n2zl`):
  `ai-review.yml` on `ubuntu-26.04`, and the three Dependabot bumps that also
  edit it (setup-node 7.0.0, checkout 7.0.1, claude-code-action 1.0.235) in
  all five workflows. It is merged by hand; #4, #5 and #36 close with it.
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
- The local mutation reports reuse old results for unchanged code.
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

**The `ai-review.yml` batch — three items left, and the runner label.** The
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
- **The runner label,** `ubuntu-latest` to `ubuntu-26.04` (D-085, above). D-085
  puts it in a pull request of its own.

Three small changes to `ai-review.yml`'s safety filter shipped ahead of the
batch, each merged by hand (D-075): [#21](https://github.com/bvst/TryggHverdag/pull/21)
(the worker files), [#30](https://github.com/bvst/TryggHverdag/pull/30)
(`healthchecks.ts`, D-079) and [#45](https://github.com/bvst/TryggHverdag/pull/45)
(`apps/mobile/app.config.ts`, D-084).

## History

[`progress/m0.md`](progress/m0.md) — the full narrative of M0, including the wrong
turns. Several entries exist only so the next session does not repeat them.
[`progress/m1.md`](progress/m1.md) — M1, from 2026-09-29.
