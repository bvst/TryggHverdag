# Progress log

**Last updated:** 2026-09-23 · **Milestone:** M0 (foundations)

What has actually been built, task by task. The plan is in
[`plan/README.md`](plan/README.md); the M0 task list is in
[`plan/10-roadmap.md`](plan/10-roadmap.md). One task per pull request (D-052).

## M0 at a glance

| ID | Task | Status |
|----|------|--------|
| INF-00 | Mac environment check | ⬜ Waits for the Mac (A-10). `pnpm run doctor` is ready for it |
| INF-01 | Monorepo skeleton | ✅ Done — 2026-09-20 ([#2](https://github.com/bvst/TryggHverdag/pull/2)) |
| INF-02 | Claude Code configuration + hook tests | ✅ Done — 2026-09-20 ([#2](https://github.com/bvst/TryggHverdag/pull/2)) |
| INF-03 | Gate scripts + HK-08 | ✅ Done — 2026-09-20 ([#2](https://github.com/bvst/TryggHverdag/pull/2)) |
| INF-04 | CI workflows, merge rules, CODEOWNERS | ✅ Done — 2026-09-23 ([#3](https://github.com/bvst/TryggHverdag/pull/3)); `gate:integrity` 5 of 5 against the live rules |
| INF-05 | Server skeleton | 🟡 Built ([#6](https://github.com/bvst/TryggHverdag/pull/6)) — all four test levels green, reviewers passed; waiting on the owner to re-import the ruleset |
| INF-06 | App skeleton | ⬜ Waits for the Mac |
| INF-07 | Staging on Clever Cloud | ⬜ Blocked on owner: Clever Cloud token |
| INF-08 | Monitoring | ⬜ Blocked on owner: Healthchecks.io / UptimeRobot |
| INF-09 | Daily status workflow | ⬜ Blocked on owner: A-09 |
| INF-10 | Gate drills | ⬜ Not started |

## What Claude needs from the owner next

**Re-import the ruleset (1 minute), because INF-05 added two checks.**
`docs/plan/main-ruleset.json` now lists **12** required checks — `integration`
and `system` are new. Import it again the same way as the first time
(Settings → Rules → Rulesets → the existing ruleset → Import). Until then
`gate-integrity` fails and says the live rules and this repository disagree,
which is the point: a check cannot become optional by being forgotten.

**A-15 is the one that matters most, and it is about 10 minutes.** Every step is
written out in [`plan/merge-rules.md`](plan/merge-rules.md):

1. **Create the ruleset on `main`** — nothing else in this repository can do it,
   because Claude's account deliberately has no admin rights (A-06). Until it
   exists, `main` can be pushed to, force-pushed and deleted by anyone with
   write access, and no check has to pass before a merge. `gate:integrity`
   confirmed that against the live API while INF-04 was being built.
2. **Install the [Claude GitHub App](https://github.com/apps/claude)** on this
   repository. `ai-review.yml` passes no `github_token`, so the action signs in
   as that app; without it the reviews cannot post their findings.
3. **A-09 — `claude setup-token`**, saved as `CLAUDE_CODE_OAUTH_TOKEN`. Without
   it the three blocking AI reviews fail rather than pass (D-045).

**No `RULES_READ_TOKEN`** — an earlier version of this list asked for one with
Administration: Read-only. GitHub answers `metadata=read` for the ruleset
endpoints, which the ordinary Actions token already has, so CI-01 needs no extra
secret (D-062).

Later tasks, not blocking anything today:

4. **A token for Claude's GitHub account (A-06)** in the cloud environment, so
   pull requests come from Claude's account and the owner's approvals count
   (D-042). Until then the owner merges the pull requests.
5. **Clever Cloud API token** for the AS's account (A-04) [INF-07].
6. **Healthchecks.io and UptimeRobot API keys** (A-08) [INF-08].

## Log

### 2026-09-20 — INF-01: monorepo skeleton ✅ (pull request [#2](https://github.com/bvst/TryggHverdag/pull/2))

**Built**

- pnpm workspace (`apps/*`, `packages/*`) with Turborepo, Node 22 and pnpm
  pinned, and a catalog so every package shares one TypeScript version.
- `packages/config` — the shared settings, in one place so a session, a hook and
  CI all use the same rules:
  - `tsconfig/base.json`: strict TypeScript plus `noUncheckedIndexedAccess`,
    `exactOptionalPropertyTypes` and `verbatimModuleSyntax`;
  - `eslint/index.mjs`: type-aware lint for every package, and the **AR-03 rule**
    that stops safety code from reading the clock or keeping timers in memory;
  - `dependency-cruiser.cjs`: the **AR-10 import rules** — domain stays pure,
    the UI cannot reach into the safety core, features cannot reach into each
    other's internals, only the safety core may import the location SDK,
    contracts depend on nothing of ours, test fakes never reach shipping code,
    and nothing imports a spike.
- `packages/contracts` and `packages/test-kit` — the two packages the server
  skeleton will fill (INF-05), with just enough in them to prove that one
  workspace package can import another.
- `scripts/doctor.mjs` — the INF-00 environment check: Node, pnpm, git, Claude
  Code everywhere; GitHub CLI, Docker, Xcode with a simulator, the Android SDK
  with an emulator image and Maestro on the Mac. Missing tools print why they
  are needed and how to install them.
- `pnpm run gate:static` — the L1 gate: formatting → types → lint → import
  rules.

**Verified**

- `pnpm run gate:static` passes on the skeleton (the INF-01 exit criterion), and
  `pnpm install --frozen-lockfile` works from the committed lockfile, which is
  what CI will do.
- `pnpm run doctor` passes in a cloud session and reports the Mac-only checks as
  skipped.
- The new gates were made to fail on purpose, by hand, and all blocked:
  - domain code calling `Date.now()` and `new Date()` → AR-03 lint errors;
  - a package importing a spike → `spikes-are-throwaway`;
  - `packages/contracts` importing another of our packages → blocked (it does
    not even resolve, because pnpm only links what a package declares);
  - the two workspace lists made to disagree → the import check stops with an
    explanation instead of silently checking less.
  These were run by hand in the session. INF-10 turns them into automated
  drills; that is where they become permanent.

**Decisions recorded:** D-057 (package names), D-058 (toolchain versions).

**Worth knowing for the next task**

- **TypeScript is pinned to 6.0.x, not 7.** See D-058: typed lint (the L1 gate)
  does not support TypeScript 7 yet.
- **`pnpm run doctor`, not `pnpm doctor`** — pnpm has its own `doctor` command
  and it wins. The two plan documents that said `pnpm doctor` were corrected.
- **The root `package.json` repeats the workspace list** in an npm-style
  `workspaces` field, because dependency-cruiser reads only that field. A guard
  in `packages/config/dependency-cruiser.cjs` fails the import check if the two
  lists ever drift apart.
- **Prettier does not format Markdown**, and neither Prettier nor ESLint looks
  inside `docs/`: the planning documents are prose wrapped by hand, and the
  files in `07b`/`08b` are templates that INF-02 copies in unchanged.
- **One lint error is waiting in a template**: `07b`'s `scan-sensitive.mjs` has
  an unnecessary escape (`no-useless-escape`). It is ignored where it sits now,
  and needs fixing when INF-02 copies it into `.claude/hooks/`.
- **No test runner yet.** Vitest arrives with the hook tests in INF-02
  (`pnpm test:hooks`), which is also when `scripts/doctor.mjs` gets its tests.
- **Docker does not run in this cloud session** (the binary is there, the daemon
  is not). INF-05's integration tests (L3, Testcontainers) will therefore need
  either the Mac or CI, unless the cloud environment (A-14) is set up with
  Docker. Worth checking before INF-05 starts.

### 2026-09-20 — INF-02: the gates are installed ✅ (same pull request [#2](https://github.com/bvst/TryggHverdag/pull/2))

The owner chose to continue in the same session rather than switch, so INF-01
and INF-02 share one pull request. Back to one task per pull request after this.

**Installed**

- `.claude/` — 11 agents, 12 skills, 5 path-scoped rule files, 7 hook scripts
  and the permission settings from `docs/plan/07b-claude-code-files/` (D-044).
- `CLAUDE.md` — replaced by the build-phase version, with the real command list.
- `.github/CODEOWNERS` — `@OWNER` replaced by `@bvst`. Changes to the safety
  paths, the gates themselves and the decision log need the owner's approval
  (D-042). INF-04 wires it into the merge rules.
- `pnpm run gate:file` and `pnpm run gate:quick` — minimal versions, because the
  post-edit and stop hooks call them. INF-03 replaces them with the full ones.
- Vitest, with `pnpm run test:hooks` and `pnpm run test:unit`.

**Tested — 77 cases, one file per hook**

| Hook | What the tests prove |
|------|----------------------|
| `lib.mjs` | Glob matching and path handling: if these are wrong, every gate is wrong |
| `guard-paths.mjs` (HK-02) | `implementer` cannot touch tests or the test kit; `test-author` cannot touch production code; nothing outside the repository can be edited |
| `guard-bash.mjs` (HK-03) | Pushes to `main`, force pushes, skipped git hooks, reading environment files, deploys and admin merges are blocked; reviewers cannot change anything; `implementer` cannot reach tests through `sed` or a redirect either |
| `scan-sensitive.mjs` (HK-07) | Private keys, hard-coded secrets, positions in log lines and real-looking Norwegian numbers are blocked; the one fixtures file is the exception |
| `test-weakening.mjs` (HK-05) | Skipped, focused and deleted tests and removed assertions are caught; honest changes are not |
| `post-edit.mjs` (HK-04) | The gate runs on the edited file, failures stop the work, and a **missing** gate is loud rather than silent |
| `stop-gate.mjs` (HK-06) | "Done" is refused while the gate fails; the red phase of `/feature` runs only the static checks; after being asked to continue once it writes the failure down instead of looping |
| `session-start.mjs` (HK-01) | A session is told the branch, the plan status, the open owner to-dos, and anything left failing last time |

`claude plugin validate .claude` passes (agents, skills and commands).

**Changed from the draft, and why** (recorded as D-059)

1. **Permission paths are anchored at the project.** The drafts used `./x`,
   which the [permissions documentation](https://code.claude.com/docs/en/permissions)
   anchors at the session's *current* directory; `/x` anchors at the project.
   This was the one item the 07b notes asked to verify, and it needed changing.
2. **`claude/*` branches may be pushed**, which is what cloud sessions are given
   (D-055).
3. **The weakening detector and the two role guards now also cover
   `**/*.test.mjs`**, because the hook tests are written in `.mjs`. Without it,
   the tests that protect the gates would have been the one kind of test nobody
   was watching.
4. **Environment files are denied in both forms**, project-anchored and bare.

**Worth knowing for the next task**

- **HK-08 has no script.** Section 7 lists eight hooks; the draft set has seven.
  The missing one checks that `docs/progress.md` and the plan status were
  updated before a session ends. Claude recommends adding it in INF-03, next to
  the other gate scripts, unless the owner would rather leave it out.
- **The gates are live and they bite.** While the tests were being written,
  `guard-bash` twice blocked Claude's own shell commands, because the test data
  contains forbidden commands as strings. The way around it is the ordinary one
  — write the file with the editor instead of the shell — which is exactly the
  shell loophole the 07b notes describe. CODEOWNERS is the backstop: every
  change under `.claude/` needs the owner's approval.
- Hook tests live next to the hooks (`.claude/hooks/*.test.mjs`) and run with
  `pnpm run test:hooks`.

### 2026-09-20 — INF-03: the gate scripts ✅ (same pull request [#2](https://github.com/bvst/TryggHverdag/pull/2))

Third task on this branch, at the owner's request. The gates now have real
implementations instead of the two placeholders INF-02 needed.

**Written, each with its own tests**

| Script | What it enforces |
|--------|------------------|
| `gate:file <path>` | HK-04: formatting, lint, types, import rules and the tests covering that one file — what runs after every edit |
| `gate:quick` | Static checks, unit tests, and "no test was weakened". What a session must pass before calling a task done |
| `gate:full` | Everything that runs without a phone or a deployment: the quick gate plus coverage, requirement coverage, the ratchet, API compatibility, mutation and licences |
| `req:coverage` | RG-01: reads the requirement IDs out of the plan, finds the tests that name them, writes `docs/requirements-status.md`. `--fail-on-uncovered-changed` is what CI uses |
| `tests:changes` | RG-03 across a whole pull request, including test files deleted outright — the case the per-edit hook cannot see |
| `coverage:ratchet` | RG-04: coverage on changed files may not go down; safety code needs 95 % branches; product code 80 % lines |
| `api:diff` | AR-08 / D-030: the current API against every released version still on someone's phone |
| `mutation` | D-036: mutation score on safety code, run only when safety code changed |
| `licenses:check` | SEC-06: every dependency under a licence this app can actually ship |

**HK-08 is now real** (the owner asked for it here rather than later). A session
that changed code but not `docs/progress.md` is refused once at the stop gate,
warned at session end and before compaction, and reminded at the start of the
next session. That rule used to live in `CLAUDE.md` as an instruction; it is
machinery now, which is the whole point of Section 7.

**The rule that shaped all of it**

Four of these gates have nothing to check in M0: there is no server, no released
API, no safety code. A gate with nothing to check looks exactly like a gate that
passed — until the day it was supposed to catch something. So every one of them
distinguishes the two cases in words:

- `gate:full` prints `· integration tests — no "test:integration" script yet — INF-05 adds it`;
- `api:diff` says there are no released versions yet, and **fails** if there are
  released versions it cannot compare against, or if oasdiff is missing;
- `mutation` skips only when no safety code changed, and **fails** if safety code
  changed while Stryker is not set up (D-036);
- `coverage:ratchet` prints "floor not in force — safety code: none exists yet"
  rather than passing silently.

**Two things found while building it**

1. **The first requirement report was wrong, in the flattering direction.** It
   counted LOST-02 and PRIV-07 as covered, because the tests of the *gates* use
   real requirement IDs as sample data. A test file that only quotes IDs now says
   so with `// req-coverage: fixtures-only`, and the honest count is **0 of 63**.
   Over-reporting coverage is the exact false confidence this project exists to
   avoid.
2. **The coverage floor caught real code.** `packages/contracts` and
   `packages/test-kit` were product code with no tests, so the 80 % floor failed
   — correctly. They have tests now, and the floor passes on merit.

**Also**

- The RG-03 detector moved to `scripts/lib/test-strength.mjs`, so the hook and
  `tests:changes` share one implementation and cannot drift apart.
- Vitest coverage (v8) is set up; `coverage-baseline.json` is committed and is
  what the ratchet compares against. Raise it deliberately with
  `pnpm run coverage:ratchet -- --update`.
- `docs/requirements-status.md` is generated — do not edit it by hand.

**Still open**

- `gate:integrity` (CI-01, checks the merge rules through GitHub's API) belongs
  to INF-04, with the workflows.
- Stryker is not installed. It is not needed until safety code exists (INF-05,
  M2), and the gate fails loudly rather than skipping if that changes.
- oasdiff is not an npm package, so CI will install it separately or use the
  oasdiff action (INF-04).

### 2026-09-20 — INF-04: CI, and a gate that checks the gates 🟡 (pull request pending)

The workflows are in and tested. The merge rules themselves need the owner
(A-15), so INF-04 is not finished — and `gate-integrity` is red on purpose until
it is.

**Built**

- `.github/workflows/ci.yml` — seven jobs, each running a repository script, so
  CI runs exactly what a session runs: `gate-integrity` (CI-01), `static`
  (CI-02), `unit` (CI-03), `contract` (CI-06), `traceability` (CI-07),
  `mutation` (CI-08), `security` (CI-10).
- `.github/workflows/ai-review.yml` — CI-11. One job per reviewer, so each is
  its own status check: three blocking, two advisory (D-043).
- `.github/dependabot.yml` — weekly updates for npm and for the actions,
  through the same gates.
- `pnpm run gate:integrity` — reads the merge rules out of GitHub's API and
  compares them with what this repository can actually check today.
- `docs/plan/merge-rules.md` — every setting the owner has to switch on, and
  why each one is there, plus `main-ruleset.json` to import rather than click
  through. A test puts that file through the same `reviewRuleset` and
  `reviewBypass` that CI-01 runs against the live repository, so the file the
  owner uploads cannot drift from the checks that actually exist.

**The rule that shaped it**

INF-03 established that a gate with nothing to check must say so rather than
pass. CI has a sharper version of the same trap: **GitHub reports a skipped job
as a green tick**, and a required check that is always skipped can never fail.

So the jobs whose script does not exist yet — `integration` and `system`
(INF-05), `android-e2e` (INF-06) — are *absent*, not skipped. What keeps that
honest is that the list of checks lives in one place
(`scripts/lib/merge-rules.mjs`) and is read at run time: `gate:integrity` works
out from the repository's own scripts which checks must be required today, and
fails if the workflow files, that list and the repository's merge rules ever
disagree — a required check nothing produces, or a job nothing requires. Nobody
has to remember to add `integration` when INF-05 lands; the gate starts failing
until they do.

**Two bugs found by running things rather than reading them**

1. **`pnpm run test:unit -- --coverage` never measured any coverage.** The `--`
   reaches vitest as part of the command line, so `--coverage` was read as a
   filename to filter tests by. The suite passed, no coverage was written, and
   `coverage:ratchet` (RG-04) then failed saying it had nothing to measure —
   which is how it was found. `gate:full` had been red on this since INF-03.
2. **`packageScripts()` could silently answer "this repository has no
   scripts".** It read `package.json` by spawning node, and `run()` returns
   stdout and stderr glued together — so one warning from node (an experimental
   flag, a deprecation, an environment variable someone exported) landed in the
   middle of the JSON, parsing failed, and the `catch` returned `{}`. Every gate
   asks that function what it may run and skips what is missing, so the result
   would have been **`gate:quick` and `gate:full` passing having run nothing**,
   looking exactly like a clean run. It now reads the file directly and throws
   rather than shrugging. `scripts/lib/proc.mjs` had no tests at all before
   this; it does now.

   This was found by accident, while checking that the API call works through
   this session's proxy. It is the single most dangerous kind of bug this
   project can have, and no gate would have caught it — INF-10's drills are
   what would.

**Verified**

- `pnpm run gate:full` — 9 passed, 0 failed, 2 not possible yet (INF-05's
  levels). Green for the first time since INF-03, because of bug 1 above.
- `pnpm run gate:integrity` run **against the live GitHub API**, not only
  against fixtures. It reports the truth: `main` has no protection at all today.
- 94 new tests across `merge-rules`, `workflow-lint`, `gate-integrity`, `proc`,
  `gate` and `steps`; 275 in the suite. Three of them were checked by mutation
  rather than by reading: a test that cannot fail is worse than no test.
- Actions are pinned to commit SHAs, and `gate:integrity` refuses a tag or a
  branch.

**The Mac (A-10) is a 2019 Intel MacBook Pro**, not Apple silicon —
`plan/M0-kickoff.md` Part 2 is rewritten for it. The parts that differ:
Homebrew lives in `/usr/local`, Android emulator images must be x86_64, Colima
containers run amd64 natively (so the L3 tests are faster here than on Apple
silicon), and 16 GB means not running the emulator and Colima at once. macOS
Tahoe 26 is the last release for Intel, so the machine's Xcode runway is finite
— which does not put the plan at risk, because iOS builds and the weekly
simulator run happen on Expo's machines, not this one.

**Reviewed, and it changed the work**

All three reviewers returned BLOCK (D-043). Two found the same bug
independently. What they caught:

| Found by | The problem | Why it mattered |
|----------|-------------|-----------------|
| privacy | The `privacy` path filter covered 2 of the 7 planned server modules | A change to journeys, groups, alerts, notifications or maps — or to `.github/` — would have shown a **green privacy tick on a required check** with the reviewer never looking. That reviewer now runs on everything |
| code | The requirement report carries its generation date, and CI now compares it | The `traceability` check would have gone red at **midnight every night**, for a reason nobody changed. The report is a pure function of the repository now (AR-03) |
| code | `needs: changes` made the five reviewers skippable | If the filter job failed, all five were **skipped — which is a green tick**. Exactly the premise D-060 is built on, violated in the same commit |
| test-auditor | The verdict check accepted a file with no verdict, and missed `**VERDICT: BLOCK**` | A blocking review passing without a verdict. Now anchored, last line only; the six cases were run by hand |
| code + auditor | Only the first ruleset's bypass list was read | A bypass entry in a second ruleset covering `main` was invisible, and the gate printed ✓ — in the one check D-029 exists to make |
| test-auditor | `summarize` returned "ok" when every step was skipped | A typo in one script name would turn a gate into a decoration. With `packageScripts` throwing, these were the two routes to a silent green gate; both are closed |
| test-auditor | One new test passed for the wrong reason | It asserted "some section has a problem" while the fixture guaranteed one. Proven by mutation, fixed, and the fix proven by mutation again |
| privacy | `gitleaks-action` is under a proprietary end-user licence | The one dependency the project's own licence policy would reject, arriving through the one path that policy does not cover. Replaced with the MIT gitleaks CLI, pinned and checksummed |
| privacy | `/scripts/` and `/package.json` were not owner-approved paths | They decide what every gate does, and run with the token the `gate-integrity` job holds. Added to CODEOWNERS |

Also fixed: the stray `--` in six more places (including the ratchet's own error
message, which recommended the broken form at exactly the moment the bug bit);
two action pins that named the annotated tag rather than the commit, which
Dependabot would have stopped updating; workflow-wide `pull-requests: write`
narrowed to the job that needs it; `node-version` read from `.nvmrc` instead of
repeated seven times; the whole unit suite no longer running twice per pull
request. The superseded `ci.yml`, `ai-review.yml` and `dependabot.yml` drafts
were deleted from `08b-ci-files/`, where they had become a second version to
read by mistake.

**The first CI run, and what it proved**

CI ran for the first time on pull request [#3](https://github.com/bvst/TryggHverdag/pull/3),
after the owner imported the ruleset. Six of the seven `ci` jobs passed, and one
of them settled an open question:

- **`gate-integrity` passed in CI**, reading the live rulesets with the ordinary
  Actions token. That is the live confirmation D-062 was missing: no second
  secret is needed, and `RULES_READ_TOKEN` stays unnecessary.
- **`changes` failed**, and took all five reviewers with it:
  `##[error]Resource not accessible by integration`. `dorny/paths-filter` asks
  the API which files the pull request touches, and the job had only
  `contents: read` — narrowed one field too far when the privacy review asked
  for least privilege. Fixed with `pull-requests: read`, and a test now asserts
  that job keeps it.
- The guard step behaved exactly as designed: an upstream failure made the three
  blocking reviewers **fail**, not skip. Without `if: always()` and that guard
  they would have been green ticks for reviews that never ran.

**The bootstrap deadlock (open, needs the owner)**

With the secret added, the reviewers got as far as the action and then
stopped:

> Skipping action due to workflow validation: The workflow file must exist and
> have identical content to the version on the repository's default branch.
> … your workflow will begin working once you merge your PR.

That is a deliberate defence in `claude-code-action`: a pull request must not be
able to rewrite the workflow that holds the secrets and have the rewritten
version run. `ai-review.yml` is *being added* by this pull request, so it does
not exist on `main`, so the action skips itself — and the three `ai-review`
checks can never pass on the pull request that introduces them.

The ruleset requires those three checks. So the gates are now strong enough to
block the change that creates them. Nobody can bypass it either, which is D-029
working exactly as designed and exactly as inconveniently as designed.

It resolves itself after one merge, and the only way to get that merge is for
the owner to relax enforcement once, deliberately. Written up in
`plan/merge-rules.md`; the owner decides.

Confirmed along the way: the **Claude GitHub App is installed** (the log shows
the OIDC exchange succeeding and the actor as `claude[bot]`), and the
**`CLAUDE_CODE_OAUTH_TOKEN` is valid** — the token guard passed, which it only
does when a credential is present.

Still unverified: whether the `claude_args` tool grant added for the verdict
file is sufficient. The action has never actually run a review, so that fix is
reasoned rather than proven. The first merge is what tests it.

**Follow-ups the reviewers raised that are deliberately not in this task**

- **`apps/server/src/worker.ts` is missing from the safety paths in
  `scripts/lib/coverage.mjs`**, so the 95 % branch floor will not apply to the
  watchdog and outbox sender while mutation testing does. The file does not
  exist yet, so nothing is wrong today — but it will be by INF-05. That list
  lives in five places and two already disagree; it wants one source and its own
  `/bugfix`.
- **RG-01 cannot see the CI requirements.** `CI-01` to `CI-11` live in a table
  `scripts/lib/requirements.mjs` does not read, so the report still says 1 of 63
  after a task that built eleven of them. Adding that source is a scope decision
  for the owner, not a review fix.
- **`workflow-lint` compares job *ids*, not the check *names* GitHub reports.**
  They coincide today. Giving each check in `CHECKS` a `producedBy` would make
  the mapping data instead of a heuristic.
- **The repository settings in `merge-rules.md` are not verified** — auto-merge,
  squash-only, the code-security settings. The document now says so.

**Decisions recorded:** D-060 (CI configuration v1, as installed), including why
reading the bypass list needs its own token rather than Claude's, and D-061
(what the reviews changed).

**Worth knowing for the next task**

- **`gate-integrity` and the three `ai-review` checks are red until A-15 and
  A-09.** That is the designed state, not a regression (D-029). Because the
  merge rules are not on yet, a red check does not block merging — the owner
  still merges by hand.
- **Not installed yet, and why:** `deploy-staging.yml` belongs to INF-07 (it
  needs the Clever Cloud token), `daily-status.yml` and the owner-question issue
  template to INF-09, `release.yml` and `nightly.yml` to the milestones whose
  scripts they call. The drafts stay in `docs/plan/08b-ci-files/`.
- **The requirement report was stale**, claiming 0 of 63 when the true count was
  1 of 63 (`licenses.test.mjs` covers SEC-06). CI now regenerates it and fails
  if the committed copy differs, so it cannot drift again.
- **The coverage baseline was raised** deliberately, twice: for the new files
  and `proc.mjs`, and again after the review round. Nothing was lowered either
  time. The ratchet did its job in between — it refused a drop in
  `gate-integrity.mjs`, which is how the untested ruleset logic ended up
  extracted into pure functions and tested.
- **`pnpm run gate:full` now includes CI-01** and is therefore red until A-15,
  or skipped with its reason where no token is set. `gate:quick` — what the stop
  gate runs — is green.

### 2026-09-23 — INF-05: the server skeleton 🟡 (pull request [#6](https://github.com/bvst/TryggHverdag/pull/6))

**What it is.** Two processes that share a database and nothing else: an API
that answers `/v1/health`, and a worker that proves it is alive by writing a row
once a minute. Small on purpose — the point of this task is not the health
endpoint, it is that every pattern the safety loop will need now exists and is
tested: a contract the app and the server cannot disagree about, a clock that
comes from the database, pure domain logic, adapters behind ports, and three new
test levels with one real example each.

**Built**

- **`packages/contracts`** — the oRPC + zod contract, and the generated OpenAPI
  description committed as `openapi.json` (`pnpm run api:spec` writes it; a test
  fails if the committed copy drifts). Split into four small modules after a
  circular import bit — see below. `API_PREFIX` (`/v1`) is one constant, so the
  server, the OpenAPI `servers` list and the app cannot disagree.
- **`apps/server/src/domain/health.ts`** — pure: milliseconds in, `ok` or
  `degraded` out. No clock, no I/O (AR-02, AR-03).
- **`apps/server/src/ports.ts`** — `Clock` and `WorkerHeartbeats`. `now()`
  returns a `Promise<Date>` because the only clock a safety decision may use is
  the database's, and reading it is a query (D-065).
- **`apps/server/src/adapters/`** — Drizzle over node-postgres, a clock that
  runs `select now()`, and a heartbeat that upserts one row. The clock throws if
  the database returns nothing: a safety decision made on a guessed clock is
  worse than no answer.
- **`apps/server/src/api.ts`** — Hono holding an oRPC `OpenAPIHandler`.
  `createApi` takes its dependencies, so a system test runs the whole API
  in-process against fakes and a clock it controls.
- **`apps/server/src/worker.ts`** — Graphile Worker, one cron task
  (`* * * * * heartbeat`). `startWorker` takes its runner as an argument, so the
  wiring itself is assertable rather than something only production exercises.
- **`packages/test-kit`** — `fakeClock` and `fakeWorkerHeartbeats`, matching the
  ports by shape so the test kit imports nothing from the server.
- **Three new test levels, and the scripts and CI jobs to run them:**
  `test:integration` (L3, Testcontainers), `test:system` (L6), and
  `test:coverage` (the run the ratchet measures). `stryker.config.mjs` is
  installed and configured.

**Verified**

| | |
|---|---|
| L2 unit (domain) | 6 tests, including the boundary — exactly at the limit is `ok`, one millisecond past is not |
| L4 contract | 5 tests; the committed `openapi.json` must equal what the contract generates today |
| L6 system | 6 tests through the real API, including `degraded` still answering 200 and an unversioned path 404ing |
| worker | 3 tests, one of them REL-01: the heartbeat records the time *the database* gave, not this process |
| L3 integration | **Green in CI** — and it found a real bug on its first run; see below |
| `gate:quick` | 3 of 3 pass |
| `gate:full` | 10 pass · 1 not possible here (L3) · 1 fails (`gate:integrity`, waiting on A-15 — the designed state, D-029) |
| Coverage | product code 96.08 % lines against a floor of 80; every file 100 % except the fake clock, which now has its own tests too |
| Mutation | **98.68 %** — one survivor, in the time parser's remaining anchor |

**The integration tests could not run in this session, and on their first run in
CI they found a real bug.** That is the whole argument for the L3 level, made
within an hour of the level existing.

`databaseClock` asked PostgreSQL for `select now()` and told TypeScript the
answer was a `Date`. It was not. Drizzle's node-postgres driver installs its own
type parsers so that it can map columns itself, so a query written through the
schema comes back as a `Date` while a raw `sql` query comes back as PostgreSQL's
text — `2026-09-23 05:18:34.38631+00`. The type argument silenced the compiler.
In production, **every call to `/v1/health` would have thrown `getTime is not a
function`**, and so would every later safety decision that asks what time it is.

No unit or system test could have caught it: they use the fake clock, which
returns a `Date`, so all of them passed. Only a real database disagreed.

The fix is `apps/server/src/domain/database-time.ts` — pure, so it is tested at
L2 on every machine rather than only where Docker runs, and in `domain/` so the
mutation gate and the 95 % branch floor cover it. It refuses rather than
guesses: a timestamp with no time zone throws, because reading it as UTC or as
local time would put every "has it been more than N minutes" decision out by
hours with nothing going red.

Putting it there needed **AR-03's lint rule narrowed** (D-067): it banned every
`new Date(...)` in domain code, parsing included, which would have forced the
one conversion that must be protected out of the only place that protects it.
It now bans `new Date()` with no arguments — the actual clock read — and
`Date.now()` and `performance.now()` as before. Those rules had no tests at all,
although the comment beside them said they did; they have them now, including
one that asserts parsing stays allowed so the decision cannot be quietly undone.

**Three things went wrong, and each left something behind**

1. **A circular import that produced a wrong document rather than an error.**
   `index.ts` re-exported `openapi.ts`, which imported `API_PREFIX` back from
   `index.ts` and read it at module scope. Node's evaluation order happened to
   work; Vitest's did not — and the failure mode was not a crash but a published
   API description whose `servers` list said routes live "under undefined". Now
   `api-version.ts` has no imports at all, and nothing inside the package
   imports `index.ts`.
2. **Stryker reported 4.35 % and was wrong.** Rather than believe it, the mutant
   was planted by hand: `>` changed to `<=` in the domain, and four tests failed.
   The tests kill the mutants; Stryker's Vitest runner could not see them.
   Switched to the command runner — 95.65 % (D-066). A number that is wrong in
   the dangerous direction is worse than no number, because it argues for
   deleting good tests.
3. **The coverage gate measured the wrong tests, twice.** First
   `pnpm run test:unit -- --coverage` measured nothing at all (the `--` turns the
   flag into a filename). That was found in INF-04. Here the fixed version
   measured the right way but the wrong set: unit tests alone report 58.73 % for
   code that is reached at L6, so the gate went red about nothing. `gate:full`
   and CI now both run `test:coverage`, `vitest.config.mjs` has no coverage
   settings at all so there is only one way to produce the number, and the test
   in `scripts/gate.test.mjs` now pins the *script*, not the flags.

**The connection pool was twice the size the plan allows, in two processes**

`privacy-security-reviewer` asked, as a forward-looking note, whether the API
and the worker together would stay under Clever Cloud's DEV-plan ceiling once
more adapters arrive. Checking turned a future question into a present bug:
`08-cicd-releases.md` records the ceiling as **five connections in total** and
says in the same line "API 2, worker 2" — and `createPool` defaulted to
`max: 5`. That is the whole budget for one process and twice the budget between
two, in a file whose own comment warns that a pool exhausting the ceiling
"would take the watchdog down with it".

The plan had written the right numbers down and the code had not read them.
`max` is now a required argument rather than a default, so the next caller
cannot inherit the mistake silently; `POOL_SIZE` and `DEV_PLAN_CONNECTION_LIMIT`
sit beside each other, and `db.test.ts` holds the arithmetic — the budget plus a
spare must fit inside the ceiling, and the spare must exist, so that a migration
or a person with `psql` is not locked out while working out why the worker
stopped. Checked by raising the pools and watching the test fail.

**Two more things CI and the reviewers found, both fixed**

- **`startWorker` could have been wired to nothing.** Mutation testing left one
  survivor: replacing the whole dependency object with `{}` still produced a
  task list with a `heartbeat` key, so every assertion passed — a worker that
  starts, schedules, and then fails every beat, the only symptom being the API
  reporting the system degraded for reasons nobody could see. `test-auditor`
  called it a real wiring gap rather than noise, and it was right. The test now
  invokes the task the worker actually scheduled, against a socket directory
  that does not exist, and asserts on *how* it fails: reaching the query proves
  the real database clock was wired in. Verified by planting the mutant by hand.
  Mutation went from 96.05 % to **97.37 %**.
- **`req:coverage` could not see a brand-new test file.** It listed candidates
  with `git ls-files`, which shows only what has already been added — so a test
  written minutes ago and not yet staged did not exist as far as the requirement
  report was concerned. Running the gate before `git add` and after it gave
  different answers, and the second answer arrived as a red `traceability` job
  on a report that had been correct when it was written. It now lists untracked,
  non-ignored files too. The milder half of that bug is a requirement reported
  as uncovered when it is covered; the other half would let
  `--fail-on-uncovered-changed` pass a change whose only test is new.

**Also fixed here:** `scripts/lib/coverage.mjs` kept its own copy of the safety
paths, and the copy was missing `apps/server/src/worker.ts`. That was a named
follow-up from INF-04's review, listed there as "nothing is wrong today — but it
will be by INF-05". It was, so it is fixed: both that file and
`stryker.config.mjs` now import the one list from `scripts/lib/gate-decisions.mjs`.

**The five AI reviewers ran for the first time, and the deadlock is gone**

D-063 recorded that `claude-code-action` refuses to run when the workflow file
differs from the default branch, so the three blocking reviews could never pass
on the pull request that introduced them. Now that `ai-review.yml` is on `main`,
they ran. All five posted real reviews, which also proves the `claude_args` tool
grant that INF-04 had to leave unproven.

`test-auditor` blocked on the clock bug, having reproduced it against a real
PostgreSQL — the same defect the `integration` job found, reached independently.
It re-ran the mutation suite to completion, the coverage ratchet and
`req:coverage` rather than trusting this log's numbers, and they matched. It
also checked whether narrowing the AR-03 lint rule was a disguised weakening of
a safety rule, and concluded it was not. That is the review working as intended.

**One finding was declined, and the reason is in the file.** `code-reviewer`
asked for requirement IDs on `health.test.ts`'s tests. The rule they cover is
the server side of REL-08 — making "the watchdog has stopped" visible to
something that watches — and the other side, something that polls it and wakes
the owner, is INF-08 and does not exist. RG-01 counts a requirement as covered
the moment a test names it, so naming REL-08 there would turn the report green
for a requirement nothing satisfies. An ID is a claim about what is true, not a
label for what a file is near.

**The requirement gate caught two things in this task's own writing**

Both while adding the note that records D-068, and both worth knowing because
they are easy to repeat.

`RG-01` reads a requirement ID in **product code** as a claim to implement that
requirement. A comment in `db.ts` cited PRIV-07 as the *reason* a handler is
deferred, and the gate read it as a promise the branch had not kept — correctly,
by its own rule. The ID now lives in D-068, where a claim belongs, and the
comment points there.

Worse, and more instructive: `coverage()` counts a test file as covering a
requirement when the file's **text** mentions the ID, and text includes
comments. The first version of the note in `health.test.ts` explained at length
why naming REL-08 there would turn the report green for a requirement nothing
satisfies — and, by writing the ID in order to say that, turned the report green
for it. A comment denying the claim still made it. The report said REL-08 🟢
until it was caught.

The lesson is narrow and sharp: in this repository an ID is a claim wherever it
appears, including in prose that denies it. `req-coverage: fixtures-only` covers
the sample-data case; there is no marker for "explicitly not this", and the
cheapest answer is to describe the requirement instead of naming it.

**The reviewer gate's defects moved to their own pull request.** Investigating
them produced changes to `.claude/agents/*.md`, `.claude/rules/server-domain.md`
and `CLAUDE.md` — and `test-auditor` blocked #6 for carrying them, correctly: a
pull request that edits its own blocking reviewers' briefs is indistinguishable
in form from prompt injection, and a decision record inside the diff claiming
the owner approved it is not evidence of approval from where the reviewer
stands. The owner chose to split them out rather than override. So D-069, D-070,
`scripts/ai-review.test.mjs` and the whole account of that investigation live in
that pull request, which the owner reviews directly; the paths were already
CODEOWNERS-gated to them.

**The typecheck gate could pass code that does not compile.** A privacy review
raised drizzle-kit's telemetry and recommended `telemetry: false` in
`apps/server/drizzle.config.ts`. Both halves turned out to be wrong, and
checking them found something worse.

drizzle-kit 0.31.11 has no telemetry: no `telemetry`, `posthog`, `mixpanel` or
`amplitude` anywhere in the package, and the one `analytics` hit is an entry in
a bundled list of English uncountable nouns. Nor is `telemetry` a valid option —
`Config` has no such key, and tsc rejects it with `TS2353`. The suggested fix
would have broken the build. (Older drizzle-kit did collect telemetry and did
take that option, which is presumably where the advice comes from.)

But `pnpm run typecheck` **accepted it**: `FULL TURBO`, exit 0, on a file tsc
refuses to compile. A deliberately absurd key (`thisIsDefinitelyNotAnOption:
42`) passed too. `turbo.json` gives the typecheck task
`inputs: ["src/**", "tsconfig.json", "package.json"]`, while what tsc reads is
decided by the tsconfig — and this task added `drizzle.config.ts` to
`apps/server`'s `include`, at the package root. It is the only file in the
repository that is typechecked and outside `src/**`, so it was the first one
able to fall through: changing it did not change the cache key, and Turbo
replayed a stale success.

`turbo.json` predates this branch; the exposure does not. Fixed by adding
`*.ts` to the inputs, and guarded by `scripts/turbo-inputs.test.mjs`, which
compares the two lists directly — every file `tsc --showConfig` resolves for a
package must match a turbo input — so the next root-level entry in an `include`
cannot quietly reopen it. `--showConfig` is used rather than reading the
tsconfig, because it resolves `extends` and the include globs into the real file
list. Proven both ways: the test fails on the old `turbo.json` naming
`drizzle.config.ts` exactly, and the same broken file that scored `FULL TURBO`
now fails the gate with `error TS2353` and exit 2.

Worth stating plainly, because it is the shape the non-negotiables are about: a
review comment that was wrong on both its facts still led to a real defect,
because checking it meant running it instead of reasoning about it. The finding
itself is declined, with the evidence above.

**Decisions recorded:** D-065 (the server skeleton as built: `/v1` in the path,
health that answers 200 with the truth in the body, an async clock port, one
heartbeat row, three minutes before `degraded`), D-066 (Stryker's command
runner, with the evidence that the Vitest runner was wrong), D-067 (AR-03 bans
reading the clock, not constructing a Date — with the bug that prompted it) and
D-068 (`pool.on('error')` deferred to the task that brings logging, why it must
never log the raw error, and the pool `startWorker` never closes).

**What the owner has to do before this can merge.** `docs/plan/main-ruleset.json`
now lists **12** required checks — `integration` and `system` are new. Until the
ruleset is re-imported on GitHub, `gate-integrity` will correctly fail, saying
the live rules and the repository disagree. That is the same designed reminder
that fired for INF-04, working as intended: the checks this task added cannot
become optional by being forgotten.


### The reviewer gate — the verdict line, `test-auditor`'s brief, and what is still broken

The work #6 pointed at, in [#7](https://github.com/bvst/TryggHverdag/pull/7).
It is separate because `test-auditor` blocked #6 for carrying it and the owner
chose to split rather than override — and the block was right, for the reason
D-069 already records: a pull request that edits the briefs of the blocking
reviewers judging it is indistinguishable in form from prompt injection, and a
decision record inside the diff asserting the owner approved it is not evidence
of approval from where the reviewer stands.

**What was built.** Five reviewer briefs now put the findings first and the
verdict on the literal last line (D-069), with `Verdict: PASS`, `**APPROVE**`
and `VERDICT: PASS WITH COMMENTS` named as traps. `test-auditor` reads the
`mutation` and coverage results instead of re-running them (D-070), because
they are required checks on the same commit and re-running cannot change an
outcome, only spend the review. `scripts/ai-review.test.mjs` holds every brief
to the verdict pattern read out of `ai-review.yml` and proves the reviewers are
not told to write the verdict file and hold no `Write` tool.
`.claude/rules/server-domain.md` and `CLAUDE.md` came along per the reviewer's
recommended fix.

**What was verified.** `gate:quick` 3 of 3 and `ai-review.test.mjs` 27 of 27
against these briefs — and **10 failing against `main`'s**, which is the point
of the test and the reason it had to move with them rather than stay in #6.
`gate:integrity` cannot run in a cloud session at all (no token to read the
rulesets, which the script says in those words), so CI decides that one.

**Two failure modes, and only one of them is fixed.** They had been treated as
one problem for most of a morning. `did not end with a verdict line` is the
brief's fault and this fixes it: `safety-reviewer` demonstrated it on #6 by
passing on the merits and signing off `PASS — no SM/REL/LOST-relevant…`, which
the anchored pattern rejects. **("This fixes it" turned out to be wrong, on the
very next pull request — see "The brief already said so" below. The paragraph
is left as written so the correction has something to correct.)** `produced no verdict file` is a different thing
and is **not** fixed: the agent writes nothing at all, file or comment, while
its own result record reports `success`, `is_error: false` and no denials. That
write belongs to the agent that *invokes* the reviewer, in `ai-review.yml`.
**("Nothing at all, file or comment" is wrong — see "One sentence, two
artefacts" below, where the comment is complete and only the file is missing.
Left standing so the correction has something to correct.)**

**What is left, and where.** The `produced no verdict file` defect, on `main`,
where D-063 no longer blocks testing a change to the workflow now that it lives
there. Three hypotheses about it have been wrong — an unreliable agent (read off
the reviewer's comment, the one artefact the gate ignores), an exhausted budget
(the failing runs were the *shortest*), and the slow gates starving it (the
failing runs never ran them). D-070 records all three so the next attempt starts
from evidence rather than repeating them. **Read the job log first**; each wrong
guess came from reading something else.

Also left, recorded in D-070 rather than closed: `ai-review.test.mjs` does not
catch a pull request *relaxing* what a blocking reviewer must check, and does
not cover `.claude/rules/**` or root `CLAUDE.md`, which change what a reviewer
enforces as surely as a brief does. And the sharpest one — the harness's
auto-revert is indistinguishable from an attack. Two `test-auditor` instances
met the same reverted tree hours apart; one called it routine harness state, the
other reported tampering and advised treating it as a security incident. Both
behaved correctly. Whatever fixes `ai-review.yml` should make the reversion
legible, so the difference between "protected" and "attacked" is readable rather
than inferred.


### The approval rule was decorative, and the gate said it was fine

`gate:integrity` reported **5 of 5** while `require_code_owner_review: true` sat
beside `required_approving_review_count: 0`. The first has nothing to attach to
at zero — GitHub asks for a code owner *among the approvals it requires*, and
zero of them is none. With `dismiss_stale_reviews_on_push` also on, it is worse
than inert: every push erases the approvals and nothing asks for them back, so
the rule cannot survive one push.

**Our own merge is the evidence.** #6 landed on head `f2e8679` with no standing
approval at all — its newest review is `DISMISSED`, on the earlier commit
`81166b2` — while touching six paths CODEOWNERS assigned to `@bvst` alone.
`test-auditor` had already found the matching signal on #7: `reviewDecision`
returning empty despite a real approval, which is what GitHub returns when
review is not required. (Honest caveat: the owner may have relaxed something to
land #6, so that merge alone is not airtight. The two together are enough.)

**What was built.** `required_approving_review_count` is **1** in
`docs/plan/main-ruleset.json`, and `reviewRuleset` now fails below 1, so the
recorded rules and the live ones cannot drift apart unnoticed again (D-072).
Test first, and it failed for the right reason: `reviewRuleset` returned no
problem at all for a count of zero. The fixture had `0` baked in as its default,
which is how the hole stayed invisible — a test suite that treats the broken
state as normal will never fail about it.

**What it does not buy.** `@urso-agent` approves automatically, so this closes
the "merged with zero approvals" hole and makes CODEOWNERS mean something. It
adds no human judgement. The required status checks remain the real protection,
and D-072 says so rather than letting the change read as stronger than it is.

**Two non-negotiables added, in CLAUDE.md where every session reads them.**
*Read the job log before theorising* — a red check is explained by its job log
and nothing else, not its comment, not its duration, not a script reasoned about
without running. And *say what you checked, not what you assume*: "these paths
are CODEOWNERS-gated" and "this is a required check" are claims, not facts, and
both turned out false this morning. They are written down because a single
session produced eight corrections of exactly that shape, three of them wrong
guesses about one failing gate.

**Left for the owner.** Import the ruleset so the live rules match. And
`require_last_push_approval` is still `false`, so an approval can predate the
final commit — turning it on is the stronger setting, and it is deliberately
untouched here because a merge rule is not Claude's to change beyond what was
asked (D-029).


## In flight

**INF-04 is done.** The owner switched the merge rules on, and `gate:integrity`
now reports **5 of 5 against the live repository** — the required checks match,
the workflows produce them, CODEOWNERS covers the paths that need the owner,
`main` requires review and forbids rewriting history, and **nobody can bypass
those rules** (D-029). That last line is the one the whole task existed for, and
it is the first time it has been true rather than asserted.

**INF-05** is in [#6](https://github.com/bvst/TryggHverdag/pull/6) and its exit
criterion is met: the `integration` job is **green**, so the contract,
integration and system levels each have a passing example — the third one proven
where it can be, which is CI. Eight of nine jobs are green on the current head
and the five reviewers have passed. One check is red, and it is the owner's.

**The merge rules are live, and that changes what a red check means.** Until
now a failing check was a note; from now it stops a merge. The three
`ai-review` checks are among the twelve required — which puts the unfixed
missing-file failure below squarely on the critical path, because a blocking
reviewer that fails for that reason now blocks the pull request rather than
just looking untidy.
The `pool.on('error')` question is **answered: deferred to the task that brings
logging** (D-068, the owner's call). Until then the crash stands, which is loud
rather than hidden — the platform restarts the process, and if it is the worker
the heartbeat stops and `/v1/health` reports `degraded` within three minutes.
`db.ts` says so where the handler will go, so the next reader finds reasoning
rather than an oversight.

**The stake changes at M2, and D-068 now says so.** Today a restart loop from
idle-connection churn is an availability problem: health goes `degraded` and
someone is annoyed. Once the worker carries the watchdog, a worker that keeps
restarting is a watchdog that keeps not sweeping — the symptom is a journey
nobody is watching, not a red tick. Revisit it before the worker carries journey
state, not merely if churn is observed.

**An unmerged branch exists: `claude/inf-04-follow-through`.** It closes INF-04's
record and widens `engines.node` so Dependabot can run (its updater uses Node 24
and `.npmrc` sets `engine-strict=true`). It holds decisions **D-063 and D-064**,
which is why INF-05's decisions start at D-065. The owner has decided to tie it
up **after #6 merges**, so no pull request yet — deliberately, not forgotten.

**A smaller follow-up:** seven CI jobs still have no `timeout-minutes` —
`gate-integrity`, `static`, `unit`, `contract`, `traceability`, `mutation` and
`security`. They came with INF-04 and are left alone here, because the finding
was about the asymmetry between the two jobs INF-05 added and fixing the rest
would widen this task. `mutation` is the one worth a bound first: Stryker is the
only step that can legitimately run for a long time, so it is also the one where
a hang looks most like work.

**A `/bugfix` is waiting to be written:** `ai-review (code-reviewer)` reports red
although it approves, because it writes `VERDICT: APPROVE WITH COMMENTS` and the
enforcement reads only `VERDICT: PASS` or `VERDICT: BLOCK`. Advisory today, and
the reason to fix it is the day a blocking reviewer does the same. The proposed
patch is on #6. It cannot be done by editing `ai-review.yml` on a branch — that
re-triggers the deadlock above — so it has to change the agent definition, which
is repository content and therefore takes effect on the branch that changes it.

**Where the numbers are going.** After INF-06 lands, `gate:integrity` will start
failing again until `android-e2e` joins the required list. That is the same
reminder, and it should be expected rather than debugged.


### The brief already said so, and the reviewer did it anyway

`ai-review (code-reviewer)` went red on #8 (commit `14cacd6`) with
`did not end with a verdict line` — the mode #7 was supposed to have closed.

Read from the job log and the comment it came from, in that order:

```
##[error]code-reviewer did not end with a verdict line, so its verdict is unknown.
```
```
VERDICT: APPROVE WITH COMMENTS
```

So it is not the mode #7 fixed, and not `produced no verdict file` either. The
reviewer wrote a verdict, last line, correct prefix — and **invented a third
value**.

**Why this is worth a paragraph rather than a shrug.** `origin/main`'s
`.claude/agents/code-reviewer.md`, lines 48–49, names `VERDICT: PASS WITH
COMMENTS` as a form that will be read as "this review produced no verdict".
#8 changes nothing under `.claude/` — `git diff origin/main...HEAD -- .claude/`
is empty — so that is the text the reviewer read. It was told, by name, that a
`WITH COMMENTS` suffix would be rejected, and it produced one anyway.

That falsifies the remedy recorded above this entry, which was *"it has to
change the agent definition"*. Changing the agent definition is exactly what #7
did. The instruction-side lever has now been pulled, and observed not to hold.

**What the evidence points at instead.** Both remaining levers are in
`ai-review.yml`, on `main`, alongside the still-open `produced no verdict file`
defect — so one branch off `main` can take both:

- The error should **echo the line it rejected**. Today it prints only what it
  expected, so learning what actually happened means leaving the log for the
  pull request comment — the one artefact the gate ignores. A gate that says
  "read the log first" has to make the log sufficient.
- The invoking agent, not the reviewer, should be the thing that writes a
  verdict it has already checked. The reviewer is a language model asked to end
  on an exact string; three briefs now say so and one still drifted.

**What should not change:** the two permitted values. `APPROVE WITH COMMENTS`
is the reviewer asking for a middle verdict, and the middle verdict is the
thing the design refuses — qualifications belong in the findings, where they
are read, not in a verdict line that a script has to interpret. Widening the
pattern would make this failure disappear by conceding the point it exists to
make.

**Still advisory, still worth fixing.** `code-reviewer` is not a required check
(D-043), so none of this blocked #8. The reason to fix it is the day a
*blocking* reviewer drifts the same way, and the PR stops on a review that
passed.


### One sentence, two artefacts, and the gate reads the forgotten one

The same morning, on #8, `produced no verdict file` took down **two blocking
reviewers** on two different commits: `privacy-security-reviewer` on `c36d21c`
and `test-auditor` on `167c1cd`. Both are required checks, so this is the mode
that actually stops a merge — unlike the verdict-value drift above it, which
only ever hit an advisory one.

**What makes it diagnosable at last.** `test-auditor` posted a *complete*
review comment on `167c1cd` — RG-01 through RG-05, "Blocking: None found",
the parser read rather than assumed — and its job still failed for want of the
file. So the earlier description, "the agent writes nothing at all, file or
comment", is false. It writes the comment. It skips the file.

**And the prompt asks for both in one sentence** (`ai-review.yml`):

> Write its findings and its final verdict line to `review-<agent>.md`, with
> the verdict as the last line, **and post the findings as one pull request
> comment.**

Two artefacts, one clause, no ordering. The agent produces the one a person
will read and drops the one only a script will. The gate reads only the
dropped one — so the load-bearing artefact is the one the agent has least
reason to remember, and a review that genuinely happened, and said so in
public, is recorded as a review that did not happen.

**A proposed patch, not a verified one.** It cannot be tested from a branch:
`claude-code-action` refuses to run when the workflow differs from the default
branch — quoted at "The bootstrap deadlock" above — so editing `ai-review.yml`
here would skip all five reviewers, including the three blocking ones, to fix
one. On a branch off `main`:

1. **Stop asking the agent for the artefact the gate depends on.** The verdict
   should be read from something the reviewer produces as a matter of course —
   its own final output — rather than from a file it has to remember to create
   alongside the comment it would rather write. This is the change worth
   making; the two below are cheap regardless.
2. **Order the sentence, and say which one is load-bearing:** file first, as
   its own step, with the comment named as the copy for people. This is the
   instruction-side lever, which the verdict-value drift above shows is worth
   little on its own — so it is a mitigation, not the fix.
3. **Echo the rejected line** in the `did not end with a verdict line` error,
   so the log stops sending its reader to the pull request comment — the one
   artefact the gate ignores — to find out what happened.

**What this costs today:** #8 cannot merge while a required check fails this
way, and re-pushing is the only lever a branch has. That is not a fix, it is a
retry, and it is worth naming as one.


### The verdict stopped being a file (D-073)

The gate that had blocked every pull request is fixed at the mechanism rather
than the wording. `ai-review.yml` now asks for a `--json-schema` result whose
`verdict` field is constrained to `PASS` or `BLOCK`, and reads it from
`structured_output`. Nothing writes `review-<agent>.md`; the harness no longer
holds `Write`.

**Both failure modes have the same root, and it is a design one.** The prompt
asked for two artefacts in one clause — save the file *and* post a comment —
and the gate read only the file. The agent produced the artefact a person
would read and dropped the one only a script would. Meanwhile the verdict's
*value* was free text, so a reviewer could invent a third one. A schema closes
both: there is nothing to forget, and nothing to invent.

**Verified before writing it, which is the point.** `--json-schema` is not
assumed to exist — it is exercised by the action's own
`.github/workflows/test-structured-output.yml`, and `structured_output` is set
in `src/entrypoints/run.ts:312`. Read from a clone of the action, not from
memory.

**What cannot be verified before merging, stated plainly.**
`claude-code-action` refuses to run when the workflow differs from the default
branch, so the pull request that carries this change has no reviewer output
and goes red for exactly that reason. The new error says so in its own text,
naming the "Skipping action due to workflow validation" line, so the next
person to meet it is not left guessing. **Whether the fix works is answered by
the next pull request, not this one.** That is inherent to the deadlock, not a
shortcut taken here.

**The tests moved with the mechanism, and got stricter.** The old test checked
only that the enforced pattern mentioned `VERDICT`, which every form that
actually broke this gate would have passed. It now reads the enum out of the
workflow, asserts the briefs offer exactly those two words, and asserts the
pattern *rejects* the real offenders: `APPROVE WITH COMMENTS`,
`PASS WITH COMMENTS`, wrong case, and the empty string `jq` yields for a
missing field. Two new tests cover the file and tool grant. Both were
falsified deliberately before being trusted — putting `Write` back, and
widening the enum, each fail the expected test and nothing else.

`gate.test.mjs` required `Write` in `--allowedTools` for a reason this change
removes ("without Write the reviewer cannot produce the verdict file"). It was
changed, not deleted, with the reason written beside it — and the net
constraint is tighter, because `Write` being *absent* is now asserted where
tolerating it used to be.

**Left alone deliberately:** the five briefs still end with `VERDICT: PASS` or
`VERDICT: BLOCK`. That line is how the invoking agent knows which verdict to
return, and changing agent definitions has no effect from a branch anyway —
the reviewer harness reverts them before the reviewer reads them.

**Noticed, not fixed, not this PR's:** `docs/plan/decisions.md` has two
different decisions both numbered **D-060** (lines 601 and 635, "Gate scripts
v1" and "CI configuration v1"). Decisions are binding and cited by ID, so an
ambiguous one is worth the owner's attention; renumbering a binding decision
is not Claude's call.


### Every workflow job now has a timeout, and two docs stopped contradicting themselves

Small cleanup, kept small on purpose — it is also the first pull request after
D-073, so it doubles as the test of whether the reviewers return a verdict
through `structured_output`. A throwaway payload is the right place to find out.

**Nine of eleven jobs had no `timeout-minutes`**, inheriting GitHub's six-hour
default. `integration` and `system` were bounded because they were added last;
the rest inherited the default by nobody deciding. The cost is the shape of the
failure, not the runner minutes: a hung job is indistinguishable from a working
one, so it is waited on rather than investigated. `ai-review`'s `review` job is
the sharpest case — it hands control to a language model, where "thinking" and
"hung" look alike — and `mutation` the next, since Stryker legitimately runs
long, so a hang there is the most believable and the least likely to be chased.

Bounds are roughly an order of magnitude above what these jobs actually take
(30–40s for most, ~90s for a reviewer): 5–30 minutes. `findUnboundedJobs` in
`workflow-lint.mjs` keeps them there, reading indentation line by line so the
gate stays free of a YAML parser, as the rest of that file does. Its tests
include the one way the check could be decorative — a single step's own
`timeout-minutes` being read as the whole job's.

**Two documents were contradicting themselves.** `merge-rules.md` still
described 0 approvals plus code-owner review as the working configuration,
directly above the D-072 paragraphs saying it never was; it now carries the
superseded pointer this repository uses elsewhere. And `decisions.md` has **two
different decisions numbered D-060** (gate scripts, CI configuration), so a
citation of D-060 is ambiguous. Both are named at their headings rather than
renumbered: changing a binding decision's ID is the owner's call.

**Noticed, outside the repository so not fixable here:** the stop hook at
`~/.claude/stop-hook-git-check.sh` reports unpushed commits after every squash
merge, because the pre-squash head is never an ancestor of the squash commit.
With squash merges and auto-delete both on, that is a false alarm on every
pull request — which trains its reader to ignore it. A `git remote prune`, or
comparing against the default branch rather than the same-named remote, fixes
it.


### Dependabot sends one pull request per ecosystem for everything non-major

`github-actions` had no grouping at all, which is why `actions/checkout` and
`actions/setup-node` arrived as two pull requests. `npm` grouped only a named
`dev-tooling` list — `@types/*`, `eslint*`, prettier, vitest, turbo,
dependency-cruiser — leaving every runtime dependency to arrive on its own,
which is most of the churn and exactly the part the old comment said the
grouping was meant to spare people. Both ecosystems now take `'*'` for minor
and patch.

Majors stay ungrouped deliberately: a major is where behaviour is allowed to
change, and is the one that earns a whole reading. The two open right now are
both majors (checkout 6→7, setup-node 6→7), so they would have arrived
separately under this policy anyway — the grouping helps the next fortnight,
not those two.

**The cost, named rather than discovered later:** a grouped update that breaks
something has to be bisected across every bump in the group. CI runs on the
group before it merges, so a break is a red check rather than a surprise, and
a red group can be split by hand.

`findUngroupedEcosystems` holds it there, line by line rather than through a
YAML parser, as the rest of `workflow-lint.mjs` does. Its tests cover the two
ways this check could be decorative: a group that names only some packages,
and one that takes `'*'` but only `patch`.

### Dependabot pull requests cannot pass the reviewer gate at all

Separate finding, and it outlives this change. The `ai-review` jobs fail on a
dependabot pull request at step 5, **"The reviewer can actually run"** — the
token guard — with every later step skipped, `claude-code-action` included.
Dependabot-triggered runs do not receive repository secrets; they have their
own store.

Two consequences:

1. **The guard's message is wrong in this case**, and wrong in the direction
   that wastes someone's afternoon: it blames owner to-do A-09 and asks for a
   repository secret that is already set — which is why reviewers run on every
   other pull request. It should name the Dependabot secret store when the
   actor is `dependabot[bot]`.
2. **Three required blocking checks can never pass there**, so dependency
   updates — a security-relevant stream under SEC-06 — are permanently
   unmergeable without a manual merge.

The fix is the owner's: add `CLAUDE_CODE_OAUTH_TOKEN` to the Dependabot secret
store, or accept that this stream is manual forever. Worth knowing before
deciding: a dependabot bump of `claude-code-action` itself would change
`ai-review.yml`, which makes the action skip — so the token cannot reach an
unreviewed version of it that way. The residual exposure is a poisoned version
of another action in the same job reading the job's secrets.

The message fix lives in `ai-review.yml`, so it is the third change that the
reviewers structurally cannot review. That file is its own class of change and
should be batched.


### D-073 works, and the reviewers earned their keep on the first real pull request

#11 was the first pull request since D-073 that touches no workflow file, so
it is the first one the reviewers could actually run on. The answer, from the
job logs:

**The mechanism works.** `structured_output` came back as valid JSON with the
verdict constrained to the enum, and the enforcement step read it correctly.
No file to forget, no invented third value. Two of the three reviewers that
applied completed real reviews and returned `PASS`.

**They were real reviews, not rubber stamps.** `test-auditor` ran
`req:coverage`, ran 51 tests, independently re-derived `findUngroupedEcosystems`
against the real file, and — this is the part worth noting — reported the 403
on `gh pr checks` as **unverified rather than assumed passing**, which is
exactly what D-070 asked of it.

**`code-reviewer` found two genuine bugs in the function added that same
day**, and both were confirmed by running them:

1. Coverage flags were tracked per **ecosystem**, not per group. A group
   sweeping `'*'` for majors plus a separate group naming `eslint*` for
   minor and patch added up, between them, to a false pass — while neither
   alone caught every non-major update, the thing being asserted. This is the
   exact "decorative check" failure the function exists to catch, written by
   someone who had just written tests against that failure.
2. A group taking `'*'` for `minor`, `patch` **and** `major` also passed, and
   a double-quoted `"*"` would have false-negatived.

Both fixed by tracking all four flags per group and requiring one group to
satisfy every condition, with the two cases reproduced before the fix and
asserted after.

**A fourth failure mode, not predicted and not in the three we were watching
for.** `privacy-security-reviewer` returned:

> `{"verdict":"BLOCK","summary":"The privacy-security-reviewer subagent had not
> finished its review … when a structured-output response was forced; no real
> verdict was available, so this reports BLOCK rather than fabricate a PASS"}`

`--json-schema` changes *when* a verdict is owed: the old design let the agent
finish and then write a file, the new one demands a value the moment the turn
ends. So the trade is "forgets to record a real verdict" for "must produce one
before it has one".

**It failed safe, and that matters.** Asked for a verdict it did not have, the
agent refused to fabricate a PASS and blocked instead — the right direction for
a safety-critical repository, and the opposite of every failure recorded above
it, which all read as green or as noise. Still wrong: it blocks a pull request
nobody reviewed. Worth watching whether it recurs before deciding what it needs
(a turn budget, a prompt that finishes the subagent first, or both).
