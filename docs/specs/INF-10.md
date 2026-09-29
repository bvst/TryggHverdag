# INF-10 · Gate drills

**Milestone:** M0, its last task · **Serves:** RG-01, RG-03, CI-03, CI-06,
CI-11, HK-02, HK-07; D-029 and CODEOWNERS by report only · **Decisions:**
D-029, D-031, D-040, D-042, D-043, D-060 (both), D-061, D-071, D-072, D-073,
D-074, D-075, D-082 · **Written:** 2026-09-28 · **Status:** 📝 Spec. The
owner's answers are recorded at the end (2026-09-28, D-082)

## Requirement

From `docs/plan/10-roadmap.md`, the M0 table:

> | INF-10 | **Gate drills:** automated tests that try to break each gate and
> expect to be blocked | All drills pass (see below) |

> **Gate drills (INF-10).** Each drill is a scripted attempt that must fail:
> - a pull request with a `.skip` added to a test (RG-03);
> - a failing test (CI-03);
> - a new acceptance criterion without a test (RG-01);
> - a breaking API change (CI-06);
> - `implementer` editing a test file (HK-02);
> - a push to `main` (D-029);
> - a hard-coded secret or a real-looking phone number (HK-07);
> - a safety-path change without owner approval (CODEOWNERS);
> - a blocking AI review verdict (CI-11).
>
> If any drill *succeeds*, M0 is not done.

What each gate promises, where it is defined:
- **RG-01** (`06-testing-strategy.md`): "Every story ID in `01b-mvp-scope.md`,
  and every SM, REL and PRIV rule that can be tested automatically, has at
  least one test that names it." D-082 extends it to each acceptance
  criterion a changed spec names.
- **RG-03** (same): "Tests can't be quietly weakened. CI flags skipped or
  focused tests, a drop in the number of tests, and changes to existing
  assertions."
- **CI-03** (`08-cicd-releases.md`): "Unit and property-based tests (server
  and app)".
- **CI-06** (same): "API compatibility with every supported app version".
- **CI-11** (same): "AI reviews: safety, privacy and test-auditor are
  **blocking**; code and a11y-i18n are advisory".
- **HK-02** (`07-claude-code-setup.md`): "Blocks protected files: test files
  for `implementer`; …".
- **HK-07** (same): "Blocks anything that looks like secrets or real personal
  data (real phone numbers, coordinates in log statements)".
- **D-029**: "Merge rules (tests must pass, no direct pushes to `main`) must
  also apply to admins."
- **CODEOWNERS** (D-042): changes to safety paths and to the gates "also need
  the owner's approval, through CODEOWNERS".

## The owner's decision (2026-09-28)

Asked with Claude's recommendation. The owner chose it, **"Offline now, live
later"**:

> Seven drills become tests that run in CI on every pull request: a .skip
> (RG-03), a failing test (CI-03), a new criterion without a test (RG-01), a
> breaking API change (CI-06), implementer editing a test (HK-02), a secret or
> phone number (HK-07), and a BLOCK verdict failing its check (CI-11). The two
> only GitHub can enforce, a push to main and a merge without your approval,
> stay covered by gate:integrity reading the live rules (5 of 5 today). A real
> attempt at those two happens once, later, with you watching. Needs no tokens
> and adds no noise on the repository.

Not chosen: "All nine now, live included" and "Offline only, never live".
plan-keeper records it as D-082, together with the four answers at the end.

What it means here:
- This task builds seven drills. Drills 6 and 8 are **not run**. The report
  names them as not run, never as passed (AC12).
- D-071 left one question for "INF-10's drills" to settle: is code-owner
  review enforced? Under this split the later live attempt settles it. Until
  then D-071's position stands: believed, not watched.

## Approach (technical choices, delegated under D-031)

1. **One file of drills, collected by `test:unit`.** `scripts/drills.test.mjs`,
   written by test-author. Why: the drills run wherever tests run — the
   required `unit` check, and `gate:quick` at every stop. RG-03 guards them
   like any test: deleting a drill, or skipping one in any form RG-03
   counts, turns `traceability` red. One file gives `gate:drills` one thing
   to count.
2. **A drill tests the path, not the logic.** Each gate's decisions already
   have tests (inventory below). A drill adds what they cannot show: the
   command the system really runs, fed a real bad change, refusing it in its
   own words, plus a control. It does not repeat their cases.
3. **Commands are read, never retyped (AC10).** Why: the existing HK-02 test
   runs guard-paths with arguments copied by hand, and they have drifted from
   `implementer.md` — they lack `**/*.test.tsx` and `apps/mobile/e2e/**`. A
   drill that retypes its gate proves nothing about the gate that runs.
4. **Red first, by stand-ins (AC9) and once for real.** A drill against a
   working gate is green on its first run. So each drill also runs with its
   gate swapped for a stand-in that always passes, and for one that fails with
   another message, and must say "not blocked" both times, on every run. The
   pull request adds a one-off proof against the real gates (Test plan).
5. **Scratch repositories and an explicit environment.** Why: offline and
   synthetic; nothing lands in the repository (`req:coverage` rewrites
   `docs/requirements-status.md` wherever it runs); and "a test that spawns a
   script inherits the runner's environment" (Live gotchas).
6. **Bad text is assembled at run time**, in the drill file and in the
   existing test files this work extends. scan-sensitive would refuse to
   write a secret or a phone number; gitleaks (the `security` job) reads every
   committed line; and a literal skip form or `expect(` counts toward that
   file's own RG-03 numbers. In an existing file, `tests:changes` would then
   refuse the INF-10 pull request itself.
7. **`pnpm run gate:drills` prints the verdict; `gate:full` runs it.** A table
   for people: the owner, the pull request, a full local run. `gate:full` is
   where a session already reports what it could not check. Not in
   `gate:quick`: `test:unit` already runs the drills at every stop.
8. **CI: the existing `unit` job. No new job.** A new job would be a new
   required check: a ruleset change by the owner and stuck pull requests, as
   A-28 showed. CI-12's `code` answer is already true for every file a drill
   reads — scripts, everything under `.claude/` (agent definitions and
   settings included), workflows, `package.json`. AC14 checks it with
   `affected.mjs`'s own rule. No new classifier: a wrong "no" would skip the
   drills exactly when a gate changed. The coverage run in `traceability`
   leaves the drill file out: coverage cannot see the processes a drill
   spawns, a second run costs minutes, and that job has no oasdiff.
9. **`ai-review.yml` is not edited (D-075).** Drill 9 reads its step and runs
   it. No manual merge, no batch item.
10. **oasdiff the gitleaks way (D-082).** In `unit` and `contract`, a step
    downloads the pinned archive, checks its SHA-256 before unpacking, and
    puts the binary on `PATH`. The version and hash are written once, in
    `ci.yml`'s workflow `env` or one equivalent place, and both jobs read
    them. `scripts/lib/pinned-binary.mjs` is not used: `api-diff.mjs` already
    looks for oasdiff on `PATH`, so it stays unchanged. A session can reach
    the release asset (checked below), but the install stays in CI by choice,
    so no drill downloads anything. A session without oasdiff reports drill 4
    as "fail-closed only", as the owner accepted.
11. **The written way out is a line in the spec (D-082).** The form is
    `req-coverage: not automated <ID>-ACn: <reason>`, in plain sight, like
    the existing `req-coverage: fixtures-only` marker. Why: the gate must read
    it, and name every criterion it let through, with the reason, on every
    run. An exemption kept in a pull request description would leave the gate
    red, or get waved through by hand.

**Cost:** estimated 10–30 seconds on `unit`, mostly the test-runner starts in
drill 2, plus oasdiff's download in `unit` and `contract`. Not measured; the
pull request reports the jobs' real times.

### oasdiff, checked on 2026-09-28 by the coordinating session

- **Version 1.32.1:** tag `v1.32.1`, commit
  `a47e8afb47f0aecb3c8903b1de0b6dd00632b7fc`, released 2026-09-15 (Go module
  proxy).
- **Archive:** `oasdiff_1.32.1_linux_amd64.tar.gz`, SHA-256
  `7c8939fc49b75ee11fec66a5b83b37a2fca6aee109fed85013b1ba2ac2a1ee7f`, as the
  release's `checksums.txt` publishes it. The downloaded archive passed
  `sha256sum -c`, and holds `LICENSE` and `oasdiff`. `oasdiff --version`
  prints `oasdiff version 1.32.1`.
- **Licence:** Apache-2.0, from the `LICENSE` file in the module source at
  `v1.32.1`.
- **It reads our description.** The check used `api-diff.mjs`'s own call
  (`oasdiff breaking <released> <current> --fail-on ERR`) on
  `packages/contracts/openapi.json`, which is OpenAPI 3.1.1 with one path,
  `GET /health`:
  - against itself: `No changes detected`, exit 0;
  - against a copy without `GET /health`: `1 changes: 1 error, 0 warning, 0
    info`, with `api-path-removed-without-deprecation` for `GET /health`,
    exit 1.
- **Access from a session:** GitHub's HTML release page answers 403 through
  the proxy, but release assets (`/releases/download/…`) and `checksums.txt`
  answer 200. gitleaks's `checksums.txt` is reachable too, and its linux_x64
  line equals the SHA-256 already pinned in `ci.yml`: the method matches.

### Inventory: which drills already exist

Checked by reading every test beside each gate. **None of the seven exists as
a drill.** Some logic is tested; the entry point, the wiring or the message
is not.

- **1 · RG-03.** `scripts/lib/test-strength.test.mjs` "a skipped test, which
  also stops counting as a test" tests the pure rule.
  `scripts/tests-changes.test.mjs` tests `weakenedFiles` with injected
  sources, and has no skip case. HK-05's `test-weakening.test.mjs` "a skipped
  test" runs the local hook. **Missing:** nothing runs `tests:changes`, which
  the `traceability` job runs, on a real git diff.
- **2 · CI-03.** `scripts/gate.test.mjs`, the INF-06-AC6 tests, hold
  `test:unit`'s shape: both runners, `&&`, `--fail-if-no-match`, no
  `--passWithNoTests`. **Missing:** no test shows a failing test turning a
  runner red.
- **3 · RG-01.** `scripts/lib/requirements.test.mjs` "changed work on an
  untested requirement is what blocks CI" is pure; its "a covered requirement
  never blocks" is the gap D-082 closes. `scripts/req-coverage.test.mjs`
  tests `trackedFiles` only. **Missing:** a run of the entry script with
  `--fail-on-uncovered-changed`.
- **4 · CI-06.** `scripts/lib/gate-decisions.test.mjs` tests `decideApiDiff`,
  including "released versions but no oasdiff: refuses to pass, rather than
  skipping quietly". **Missing:** no test has run `api-diff.mjs`, and oasdiff
  has never run anywhere; D-082 installs it.
- **5 · HK-02.** `.claude/hooks/guard-paths.test.mjs` "HK-02: implementer may
  not change tests › blocks a test file and says why", and
  `guard-bash.test.mjs` "HK-03: implementer cannot reach tests through the
  shell either (RG-03)", run the real hooks, with hand-copied arguments that
  differ from `implementer.md`. **Missing:** no test reads `implementer.md`,
  so deleting or narrowing its hook lines leaves every test green.
- **7 · HK-07.** `.claude/hooks/scan-sensitive.test.mjs` "HK-07: secrets ›
  blocks a hard-coded key and points at the secret store" and "HK-07:
  real-looking personal data (RG-07) › blocks a Norwegian mobile number in
  ordinary code" run the real hook, with the number built at run time.
  **Closest to a drill. Missing:** no test reads the `hooks` in
  `.claude/settings.json` (`guard-bash.test.mjs` reads only its
  `permissions.deny`), so removing scan-sensitive there leaves every test
  green.
- **9 · CI-11.** `scripts/ai-review.test.mjs` reads the verdict pattern and
  schema out of the workflow and tests the pattern in JavaScript.
  `scripts/gate.test.mjs` asserts the step's text ("the verdict gate reads the
  comment back rather than trusting the URL"). **Neither runs the step.**
  `gate.test.mjs` does run `ci.yml` steps on a fake runner, and
  `staging-workflows.test.mjs` runs steps with `bash -e`: the precedent
  exists, for other workflows. **Missing:** a run of "Enforce the verdict"
  with a BLOCK.

## Acceptance criteria

### The seven drills

**INF-10-AC1 — Drill 1 (RG-03): a skip added in a pull request is blocked.**
- **Given** a scratch git repository: a base commit with a synthetic test
  file holding two tests, and a head commit that switches them off — in turn
  with `.skip`; with `describe.skipIf(true)`, `describe.runIf(false)` and
  `describe.concurrent.skip` wrapped around them; and with `ctx.skip()` at
  the start of a test's body
- **When** `tests:changes` runs there as the `traceability` job runs it, with
  the scratch base in place of `origin/<base>`
- **Then** each time it exits non-zero, naming the file and "skipped, focused
  or todo tests were added", with its RG-03 line.
- **Control:** a head commit that adds a third test instead → exit 0, "1
  changed test file(s), none weakened".

**INF-10-AC2 — Drill 2 (CI-03): a failing test turns the unit run red.**
- **Given** a scratch folder holding one failing and one passing synthetic
  test, placed where the repository's own configuration collects tests, for
  each runner `test:unit` hands over to (Vitest; jest-expo since INF-06),
  each configuration used unchanged
- **When** each runner runs there as `test:unit` runs it
- **Then** it exits non-zero, and its own summary reports the drill's test
  failed and its neighbour passed. The neighbour is the control.
- **And** a runner the drill does not know makes it fail, naming the runner.
- The chaining of the runners is held by the INF-06-AC6 tests and is not
  repeated.

**INF-10-AC3 — Drill 3 (RG-01): a new acceptance criterion without a test is blocked.**
- **Given** a scratch git repository whose plan lists one synthetic story, a
  test naming its `<ID>-AC1`, and `origin/main` at the base commit
- **When** a head commit adds `<ID>-AC2` to the story's spec and no test
  names it, and `req:coverage --fail-on-uncovered-changed` runs there as
  `traceability` runs it
- **Then** it exits non-zero, with its RG-01 line naming `<ID>-AC2`.
- **Control:** the head commit also adds a test naming `<ID>-AC2` → exit 0.
- **And** a spec naming a second synthetic story that no test names is
  blocked the same way, naming the story: the check RG-01 made before D-082.

**INF-10-AC4 — Drill 4 (CI-06): a breaking API change is blocked.**
- **Given** a scratch folder whose released version is a copy of the
  committed `packages/contracts/openapi.json`, and whose current description
  is that copy with one operation removed
- **When** `api:diff` runs there as the `contract` job runs it, with the
  pinned oasdiff on `PATH`
- **Then** it exits non-zero, with its AR-08 line naming the released file,
  and oasdiff's `api-path-removed-without-deprecation` in its output: oasdiff
  has read our own OpenAPI 3.1.1 description and found the break.
- **Control:** the current description unchanged → exit 0, having compared 1
  released version.
- **In CI** (`CI=true`, where only `unit` runs the drills), a missing oasdiff
  fails the drill, and so does one whose `oasdiff --version`, resolved on the
  gate's own `PATH`, is not the version pinned in `ci.yml`'s `env`: a binary
  shadowing the pinned one, such as a `node_modules/.bin/oasdiff`, is caught. **Elsewhere**, without oasdiff, the drill requires
  `api:diff`'s own refusal ("compatibility was NOT checked", non-zero), and
  the report says "fail-closed only", never "blocked".

**INF-10-AC5 — Drill 5 (HK-02): `implementer` cannot edit a test file.**
- **Given** every PreToolUse hook Claude Code would run for `implementer`:
  those in `.claude/settings.json` and in `.claude/agents/implementer.md`
- **When** they receive, as Claude Code sends them, an Edit and a Write of one
  sample path for each kind of test file in `TEST_GLOBS`
  (`scripts/lib/test-strength.mjs`, read at run time), and a Bash command
  rewriting each (`sed -i`, and a `>` redirect)
- **Then** for every one a hook exits 2, with guard-paths' or guard-bash's
  message naming implementer, the path and RG-03.
- **Control:** the same edits and commands on a production file → every hook
  exits 0.

**INF-10-AC6 — Drill 7 (HK-07): a secret or a real-looking phone number cannot be written.**
- **Given** every PreToolUse hook `.claude/settings.json` runs for Edit and for
  Write
- **When** they receive a Write (`content`) and an Edit (`new_string`) holding
  a synthetic hard-coded secret, and separately a synthetic Norwegian mobile
  number, each assembled at run time
- **Then** a hook exits 2 each time, with scan-sensitive's message: the
  secret, or the number with RG-07.
- **Control:** the same code reading the secret from the environment, and
  with no number → every hook exits 0.

**INF-10-AC7 — Drill 9 (CI-11): a BLOCK from a blocking reviewer fails its check.**
- **Given** the step "Enforce the verdict" read from
  `.github/workflows/ai-review.yml` and run as GitHub runs it (`bash -e`), with
  `matrix.agent` and `matrix.blocking` taken from that workflow's matrix, a
  stand-in `gh` that answers only the comment read-back, and the real `jq`
- **When** a reviewer that `scripts/lib/merge-rules.mjs` lists as a blocking
  check returns structured output that satisfies the workflow's own schema,
  with verdict BLOCK and a comment on this pull request that says BLOCK
- **Then** the step exits non-zero, with its own "blocks this pull request"
  error naming that reviewer. This holds for each of the three.
- **And** the reviewers the workflow marks `blocking: true` are exactly the
  blocking ai-review checks in `merge-rules.mjs`.
- **Control:** verdict PASS and a comment that says PASS → exit 0, "PASS,
  corroborated by".

### Every drill

**INF-10-AC8 — Blocked for the right reason, never vacuously.**
- **Given** any drill above
- **When** it judges its gate's answer
- **Then** "blocked" needs both the gate's blocking status (non-zero; 2 for a
  hook) and the gate's own message: at least the rule it cites and what it
  refused. A crash, a timeout or another message is not "blocked".
- **And** its control, through the same gate, passes and shows the gate
  examined something: a changed test file, a requirement or criterion, a
  released version, a verdict read back.

**INF-10-AC9 — Each drill can go red.**
- **Given** any drill, with its gate swapped for a stand-in that always
  passes, and then for one that fails with an unrelated message
- **When** the drill runs
- **Then** it reports "not blocked" both times.

**INF-10-AC10 — A drill runs what the real system runs.**
- **Given** any drill
- **When** it builds its command
- **Then** it reads it from where the real system does: the job step in
  `ci.yml` and the `package.json` script it calls (following the hand-over
  into `apps/mobile/package.json`); the hook entries in
  `.claude/settings.json` and the agent's definition; the named step in
  `ai-review.yml`. Only the working folder, the base ref and the stand-ins for
  GitHub differ.
- **And** if that step, script or hook entry is missing, or no longer runs
  its gate, the drill fails and says what it looked for.
- **And** a step made to tolerate its gate's failure no longer runs it:
  - a shell operator on the gate's line, such as `|| true`;
  - `continue-on-error: true`;
  - an `if:` other than the step's own. That is none for `traceability`'s
    steps, and the CI-12 code guard for `unit`'s and `contract`'s. For "Enforce
    the verdict" it is the one the workflow gives it today.

  Each makes the drill fail, naming the step and what it found.
- **And** the same holds one level up, for the job that holds the step.
  - A job-level `continue-on-error`, or a job-level `if:` or `needs:` other
    than the job's own, fails the drill. A job skipped because a job it needs
    failed or was skipped is skipped all the same.
  - The job's own `if:` is none for `ci.yml`'s `traceability`, `unit` and
    `contract`, and `always()` for `ai-review.yml`'s `review`.
  - Its own `needs:` is none for those three, and exactly `changes` for
    `review`.
  - GitHub reports a skipped job as a success, even for a required check. So
    `if: false` on the `traceability` job would switch RG-01 and RG-03 off
    with every check green.

**INF-10-AC11 — Offline, synthetic and tidy.**
- **Given** the drills running in a cloud session or in CI
- **When** they spawn a gate
- **Then** it gets an explicit environment:
  - no token, and nothing a gate reads from the runner (`GITHUB_*`, `CI`);
  - a `PATH` whose first `gh` is the stand-in, which refuses any call it was
    not set up for. The runner's own `gh` stays behind it, shadowed, with no
    token;
  - proxy variables that point at a dead address, with `NODE_USE_ENV_PROXY=1`,
    so that Node's own `fetch` cannot reach the network either;
  - no Docker.
- **And** the check that no token reaches a gate asserts true or false. A
  failure names the variable, never its value (SEC-03).
- **And** all data is synthetic (RG-07). No committed file holds a drill's
  secret or phone number, and no test file holds a skip form. RG-03 counts
  test files only; prose in the docs names the forms on purpose.
- **And** every scratch folder is outside the repository and removed
  afterwards. The repository's `git status` is the same before and after.

### The report and CI

**INF-10-AC12 — `pnpm run gate:drills` gives the verdict, and cannot pass vacuously.**
- **Given** `pnpm run gate:drills`
- **When** it runs the drill file
- **Then** it prints nine rows, in the roadmap's order. Each offline drill
  shows ✓ blocked, with the gate that blocked it, or ✗ got through. The push to
  `main` and the safety-path change without owner approval show "· not run
  here — covered by gate:integrity reading the live rules (CI-01); live
  attempt not yet run".
- **And** it exits 0 only if all seven offline drills ran and every test of
  each passed. It exits non-zero, saying why, if a drill got through, is
  missing or was skipped, if any other test in the file failed, or if nothing
  ran.
- **And** each offline row is backed by its attempt. It needs a passed test
  whose name starts with that drill's attempt criterion:

  | Drill | Attempt |
  |---|---|
  | RG-03 | AC1 |
  | CI-03 | AC2 |
  | RG-01 | AC3 |
  | CI-06 | AC4 |
  | HK-02 | AC5 |
  | HK-07 | AC6 |
  | CI-11 | AC7 |

  Without one, the row reads "✗ missing", whatever else of that drill passed.
- **And** Vitest's own exit status and signal reach the verdict:
  - a run where Vitest exits non-zero although every test passed is not
    trusted, and says so;
  - a run Vitest did not finish, because it was stopped or timed out, says
    that rather than "nothing ran".
- **And** the two live rows are never shown or counted as passed. CI-06's row
  says whether it proved detection or fail-closed only; oasdiff is probed the
  way `gate:full` probes Docker.

**INF-10-AC13 — `gate:full` runs the drills.**
- **Given** `pnpm run gate:full`
- **When** it plans its steps
- **Then** "gate drills (INF-10)" runs `pnpm run gate:drills` after the unit
  tests, and the summary counts it like any other step.

**INF-10-AC14 — CI runs the drills whenever a gate changes.**
- **Given** a pull request that changes any file a drill reads or runs
- **When** CI classifies it (CI-12)
- **Then** `affected.mjs` answers `code=true`, so the required `unit` check
  runs `test:unit`, and the drills with it.
- **And** tests hold this: every source file a drill declares exists and is
  code under `onlyInert` (`scripts/lib/affected.mjs`); `vitest.config.mjs`
  collects the drill file, and the coverage run does not (`vitest list`, as
  the INF-06-AC6 test does).
- No new job and no new required check.

### The three gate changes (D-082)

**INF-10-AC15 — `req:coverage` checks each acceptance criterion.**
- **Given** `req:coverage --fail-on-uncovered-changed`, and a changed spec under
  `docs/specs/` that names `<ID>-ACn` for a tracked requirement
- **When** no counted test names that exact criterion (`<ID>-AC1` is not
  `<ID>-AC10`; a `fixtures-only` test does not count)
- **Then** it exits non-zero, listing each such criterion under its RG-01
  line.
- **And** criteria of untracked IDs (INF, CI, HK…) never block (D-074), and
  neither do a parked requirement's, as today. Only specs are read for
  criteria, and `docs/requirements-status.md` does not change.
- **And** the line `req-coverage: not automated <ID>-ACn: <reason>` in that
  spec lets the criterion through. It counts only at the start of a line, so
  prose naming a criterion mid-line excuses nothing. It counts only in the
  spec that names that criterion: one spec's line never excuses another's. The gate prints every such criterion and
  its reason on every run, and refuses the line if the reason is empty.

**INF-10-AC16 — oasdiff is installed, pinned, where the gate and the drill run.**
- **Given** `ci.yml`'s `unit` and `contract` jobs, on a diff with work to do
  (CI-12)
- **When** they reach the step that needs oasdiff (`test:unit`, `api:diff`)
- **Then** an earlier step under the same guard has installed it and put it
  on `PATH`, from the one version and SHA-256 written once for both jobs
  (1.32.1 and its `checksums.txt` hash today).
- **And** an archive whose SHA-256 differs stops that step, with a message,
  before anything is unpacked.
- **And** `unit` and `contract` check out without persisting credentials
  (`persist-credentials: false`, as `android-e2e` already does), since a
  downloaded binary runs there.
- **And** there is no new job, action or secret. D-082 records the version,
  the hash's source and the licence (Apache-2.0).

**INF-10-AC17 — RG-03's skip pattern sees conditional, chained, in-body and inverted skips.**
- **Given** a test file whose new version switches existing tests off with
  `describe.skipIf(…)`, `describe.runIf(…)`, a skip behind another modifier
  such as `describe.concurrent.skip` (and the same forms on `test` and `it`),
  or any call to `skip(` in a test file, whatever the context is named:
  `ctx.skip()`, `context.skip(…)`, `t.skip()`, or `skip()` destructured from
  the context
- **When** `weakenings` in `scripts/lib/test-strength.mjs` compares it with
  the old version
- **Then** it reports "skipped, focused or todo tests were added", so HK-05
  and `tests:changes` both refuse it.
- **And** focus and todo behind a modifier count too, since they share the
  pattern. That holds behind two or more modifiers, such as
  `describe.shuffle.concurrent.only` and
  `test.concurrent.sequential.skipIf(true)`.
- **And**, since the owner's sixth answer (D-082, 2026-09-29), these count as
  well:
  - the same forms on `suite`, Vitest's other name for `describe`;
  - the same forms on any test object, such as one made with `test.extend`
    (`myTest.skip(…)`), including bracket access (`test['skip']`);
  - `.fails` and `.failing`. These turn a test that fails into one that
    passes, so they are counted on their own, with their own RG-03 message:
    tests were inverted to expect failure.
- **And** every form counted today still is. A name that only contains those
  words, such as `skipIfMissing(` or a lowercase `unskip(`, is not.

**INF-10-AC18 — The files that decide which tests CI runs need the owner.**
- **Given** `vitest.config.mjs`, `vitest.shared.mjs` and
  `vitest.coverage.config.mjs`, whose include and exclude lists decide whether
  the drills run at all
- **When** a pull request changes one
- **Then** it needs the owner's approval: all three are in
  `.github/CODEOWNERS` and in `OWNER_APPROVAL_PATHS`
  (`scripts/lib/merge-rules.mjs`), so `gate:integrity` holds them (D-042,
  D-082).

## Test plan

| AC | Level | Where |
|----|-------|-------|
| AC1–AC11, AC14 | L2, tooling: real processes, scratch repositories | `scripts/drills.test.mjs` (new). AC14's collection check is in `scripts/gate.test.mjs` |
| AC12 | L2 | `scripts/lib/gate-drills.test.mjs` (new): results → rows, verdict and exit code. The entry script is run once against a small scratch drill file |
| AC13 | L2 | `scripts/gate.test.mjs` (`FULL_STEPS`) |
| AC15 | L2 | `scripts/lib/requirements.test.mjs`, one case per bullet. AC3 runs the entry script |
| AC16 | L2 | `scripts/gate.test.mjs`: both steps' place, guard and single pin; each step run on the existing fake runner, where a stand-in archive with the pinned hash lands on `PATH` and one with another hash stops the step. AC4, in CI, proves the real binary |
| AC17 | L2 | `scripts/lib/test-strength.test.mjs` (the rule); `.claude/hooks/test-weakening.test.mjs`, one HK-05 case; AC1 runs `tests:changes` |
| AC18 | L2 | Where `OWNER_APPROVAL_PATHS` and CODEOWNERS coverage are already tested (`scripts/gate.test.mjs` or `scripts/lib/merge-rules` tests) |

They run in `unit` on every pull request CI-12 calls code, at every stop
through `gate:quick`, and in `gate:full` (in `test:unit`, and again in
`gate:drills`).

- **No L3 to L7.** No database, API, app or device is touched.
- **Red phase.** The three gate changes (AC15–AC17) and the runner go red
  first in the usual way: their new cases fail against today's code, and
  AC16's before the steps exist. The drills themselves are green on their
  first run against working gates, so their red is shown two ways:
  - AC9, on every run;
  - in the pull request, each drill run once against its real gate made to
    always pass, with the output quoted. For `scripts/`, a local edit that is
    reverted. For `.github/` and `.claude/`, which a session may not edit
    without asking, a changed copy the drill is pointed at. Nothing is
    committed, so no manual merge (D-075). test-auditor reads this evidence
    for DOD-02.
- **Fixtures.** Skip forms, secrets and phone numbers are assembled at run
  time everywhere, `test-strength.test.mjs` and `test-weakening.test.mjs`
  included (Approach 6). New fixtures use synthetic IDs. Nothing written for
  this work names a real tracked requirement or criterion.
- **Names.** `INF-10-ACn: …`, with the drilled ID in the name, as in
  `INF-10-AC1: RG-03 drill — …` (the INF-06 precedent; D-074 makes it the
  practice, not an obligation). INF is untracked, so nothing moves in
  `req:coverage`. The drill file starts with `// req-coverage: fixtures-only`.
- **Mutation.** No safety path changes, so Stryker does not run. The coverage
  ratchet applies to the changed gate code and the new runner as to any file.

## Modules and files affected

Paths marked ◆ need a code owner's approval (D-042).

**New**
- ◆ `scripts/drills.test.mjs`: the seven drills, their controls and stand-ins
  (test-author).
- ◆ `scripts/gate-drills.mjs`: `pnpm run gate:drills` (implementer). Its
  decisions go in ◆ `scripts/lib/gate-drills.mjs`, tested by ◆
  `scripts/lib/gate-drills.test.mjs` (test-author).

**Changed**
- ◆ `scripts/lib/requirements.mjs`, ◆ `scripts/req-coverage.mjs`: criteria
  (AC15). Tests: ◆ `scripts/lib/requirements.test.mjs`.
- ◆ `scripts/lib/test-strength.mjs`: the pattern (AC17). Tests: ◆
  `scripts/lib/test-strength.test.mjs`, and ◆
  `.claude/hooks/test-weakening.test.mjs` (an edit under `.claude/` asks the
  owner first).
- ◆ `.github/workflows/ci.yml`: oasdiff's version and SHA-256, once; an
  install step in `unit` and in `contract`, whose checkouts stop persisting
  credentials (AC16).
- ◆ `.github/CODEOWNERS` and ◆ `scripts/lib/merge-rules.mjs`
  (`OWNER_APPROVAL_PATHS`): the three root Vitest configurations (AC18).
- ◆ `scripts/gate.test.mjs`: AC13, AC14's collection check, AC16.
- `vitest.coverage.config.mjs`: leaves out the drill file (Approach 8). It
  is owned from this change on (AC18).
- ◆ `package.json`: the `gate:drills` script. ◆ `scripts/gate.mjs`: the step
  in `FULL_STEPS`.
- ◆ `CLAUDE.md`: `gate:drills` in the command list.
- ◆ `docs/plan/decisions.md`: D-082 (plan-keeper).
- `docs/plan/06-testing-strategy.md`: RG-01's row, as D-082 amends it
  (plan-keeper).
- `docs/progress.md`, `docs/progress/m0.md`, `docs/plan/README.md`
  (plan-keeper).

**Deliberately unchanged**
- `.github/workflows/ai-review.yml` (D-075): read and run by drill 9, never
  edited.
- `.claude/**`, except that one HK-05 test: hooks, agents and settings are
  read, not changed.
- `scripts/api-diff.mjs`: it already looks for oasdiff on `PATH`.
- `scripts/lib/pinned-binary.mjs`: not used (Approach 10).
- `docs/plan/main-ruleset.json`: no new job, no new required check.
  `merge-rules.mjs` changes only its owner-approval list (AC18).
- The include lists in `vitest.config.mjs` and `vitest.shared.mjs`:
  `scripts/**/*.test.mjs` already collects the drill file. Both files become
  owned (AC18).
- `packages/contracts/**`: drill 4 copies `openapi.json` into a scratch
  folder.

## Contract changes

None. Nothing under `packages/contracts` changes, and nothing is added under
`released/`.

## Risks and failure modes

INF-10 touches no journey or alert code. It reaches the failure modes only
through the gates: [F8](../plan/03-safety-reliability-security.md#failure-modes),
"A bad release breaks alerts", whose mitigation is the release gates. A gate
that has quietly stopped working lets that release through with a green tick.
The drills are the check on the gates.

- **R1. A drill passes vacuously** (nothing ran, the gate crashed, a wrong
  fixture): AC8, AC9, AC12's count, RG-03 over the drill file, and AC14's
  check that the unit run collects it.
- **R2. A drill tests a copy of its gate:** AC10. The HK-02 hook test shows
  how copies drift.
- **R3. A drill writes into the repository:** AC11. Run there, `req:coverage`
  would rewrite the committed report.
- **R4. A spawned gate inherits the runner's environment:** AC11.
- **R5. A reviewer's sandbox reverts `.claude/**`:** drills 5 and 7, and the
  new HK-05 case, then read old files. They carry the same "differs from HEAD"
  note as `ai-review.test.mjs`.
- **R6. guard-bash matches text:** it sees `sed -i` and redirections, not
  `node -e` or `perl -i`. Drill 5 proves what the hook claims, not a sealed
  shell. Backstops: RG-03 in CI, test-auditor, and owner approval on
  `/scripts/` and `/.claude/`.
- **R7. Claude Code not running the hooks at all** cannot be shown offline.
  D-044's scripted session is out of scope.
- **R8. HK-03 while building this:** a shell command that merely mentions a
  push to `main`, `--no-verify`, starting a workflow run, or reading `.env`
  is refused, and `grep … process.env` counts. Write commit messages and the
  PR body to a file with Write (`git commit -F`, `--body-file`); search with
  Grep.
- **R9. What counting cannot see.** A test can be hollowed out while every
  count stays the same: an assertion rewritten, an early `return`, a failure
  swallowed. No text pattern can catch them all, so they stay with
  test-auditor, as the owner decided, with owner approval on `/scripts/` for
  the drills themselves.
- **R10. The written way out waves a criterion through:** the gate prints
  each one with its reason on every run and refuses an empty reason;
  test-auditor reads them (DOD-02).
- **R11. Specs name criteria as claims:** once AC15 lands, a changed spec that
  names a tracked `<ID>-ACn`, even in passing, needs that criterion's test.
  Examples use placeholders; this spec names no tracked requirement or
  criterion.
- **R12. oasdiff in CI:** it reads our description and finds the removed
  operation (checked above). If CI's result ever differs from that check, the
  implementer stops and reports.
- **R13. The pin is raised by hand:** Dependabot cannot see it. D-082 records
  1.32.1, the hash's source (`checksums.txt`) and Apache-2.0.
- **R14. The wider pattern refuses every new conditional test,** `runIf`
  included, and every call to the context's skip, like any skip. No test uses
  any of them today (checked).
- **R15. The Mac:** an old git on the hook `PATH` refuses `git init -b` (Live
  gotchas), so scratch repositories do not rely on it. `jq` there was not
  checked; drill 9 names it if missing.
- **R16. Friction and flakiness:** rewording a gate's message means updating
  its drill (accepted). Spawned processes get generous timeouts and no
  clocks, and RG-06 applies if one flakes anyway.

**The live drills.** Until the live attempt, drills 6 and 8 rest on
`gate:integrity` reading the rules. D-072 records that gate reporting 5 of 5
while a rule did nothing. The live task must also get past urso-agent's
automatic approval (D-072), or it shows nothing about the owner's.

**Found while reading the gates, and not changed here:** `tests:changes`
passes, saying "nothing to compare against", when the base will not resolve.
CI's full-history checkout keeps it from biting today. A candidate
`/bugfix`. (The in-body skip found at the same time is now in D-082: AC17.)

## Out of scope

- Drills 6 and 8, live: a later task, with the owner watching.
- HK-03's local refusal of a push to `main` as a drill. The owner's split puts
  drill 6 with GitHub. `guard-bash.test.mjs` already runs the hook on it.
- Fixing anything the drills find beyond D-082's gate changes.
- Drills for gates not on the roadmap's list: static checks, the integration
  and system suites, the coverage ratchet, mutation, `android-e2e`, the
  security scan, HK-04/05/06/08/09 and CI-12.
- A scripted Claude Code session that tries each forbidden action (D-044). It
  needs Claude Code itself and a token.
- Any `ai-review.yml` change, the D-075 batch included.
- Criterion coverage in `docs/requirements-status.md`: D-082 changes the
  check, not the report.
- Putting the drill table in the daily report.

## The owner's answers (2026-09-28)

All four were answered with the recommended option, as relayed to the
planner by the coordinating session. D-082 records them, with the
offline/live split above.

- **Q1, drill 3 → (a) "Check each criterion".** `req:coverage` fails when a
  changed spec names a tracked `<ID>-ACn` that no test names. Untracked IDs
  stay out (D-074), and a written way out covers a criterion that truly
  cannot be automated. D-082 amends RG-01, which D-040 makes binding.
  → AC3, AC15.
- **Q2, drill 4 → (a) "Install it now".** oasdiff is pinned by version and
  SHA-256 like gitleaks, written once and read by `unit` (the drill) and
  `contract` (the gate), with its licence in D-082. Where it is not
  installed, the drill says "fail-closed only", never "blocked". → AC4, AC16.
- **Q3, drill 1 → (a) "Close it in INF-10".** The shared skip pattern also
  sees `describe.skipIf(…)`, `describe.runIf(…)` and a skip behind another
  modifier, so HK-05 and `tests:changes` catch them. No test uses `skipIf`
  or `runIf` today. → AC1, AC17.
- **Q4, drill 1's in-body skip → "Include it".** The owner's option read
  "the check also counts a skip() call in a test file", so any call to
  `skip(` counts, whatever the context is named (`ctx.skip()`,
  `context.skip(…)`, `t.skip()`, a destructured `skip()`); names like
  `skipIfMissing(` do not. Other
  ways to hollow out a test, such as an early return, stay with test-auditor
  (R9). → AC1, AC17.
