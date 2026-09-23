# Progress log

**Last updated:** 2026-09-20 · **Milestone:** M0 (foundations)

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
| INF-04 | CI workflows, merge rules, CODEOWNERS | 🟡 Built — waiting on the owner (A-15) to switch the rules on |
| INF-05 | Server skeleton | 🔜 Next — the L3 tests need Docker, which only CI has |
| INF-06 | App skeleton | ⬜ Waits for the Mac |
| INF-07 | Staging on Clever Cloud | ⬜ Blocked on owner: Clever Cloud token |
| INF-08 | Monitoring | ⬜ Blocked on owner: Healthchecks.io / UptimeRobot |
| INF-09 | Daily status workflow | ⬜ Blocked on owner: A-09 |
| INF-10 | Gate drills | ⬜ Not started |

## What Claude needs from the owner next

**A-15 is the one that matters now, and it is about 10 minutes.** Every step is
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

## In flight

INF-04 is built but **not done**: it is finished when `gate:integrity` passes,
which needs A-15 from the owner. The pull request can merge before that.

**INF-05 (server skeleton) is next** and needs nothing from the owner. One thing
to know before starting it: its integration tests (L3, Testcontainers) need
Docker, and the Docker daemon does not run in a cloud session — the binary is
there, the socket is not. CI is now the place those tests can run, which is part
of why INF-04 came first.

After INF-05 and INF-06 land, `gate:integrity` will start failing until their
checks are added to the required list; that is the intended reminder.
