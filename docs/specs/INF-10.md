# INF-10 · Gate drills

**Milestone:** M0, its last task · **Serves:** RG-01, RG-03, CI-03, CI-06,
CI-11, HK-02, HK-07; D-029 and CODEOWNERS by report only · **Decisions:**
D-029, D-031, D-040, D-042, D-043, D-060 (both), D-061, D-071, D-072, D-073,
D-074, D-075 · **Written:** 2026-09-28 · **Status:** 📝 Spec. Three questions
for the owner at the end; AC1, AC3 and AC4 each have a part that waits on one

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
  least one test that names it."
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
plan-keeper records this as a new decision; its number is assigned then.

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
   like any test: deleting a drill, or adding `.skip` to one, turns
   `traceability` red (Q3 names the skip forms it misses). One file gives
   `gate:drills` one thing to count.
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
6. **Bad text is assembled at run time.** scan-sensitive would refuse to
   write a drill file holding a secret or a phone number; gitleaks (the
   `security` job) reads every committed line; and a literal `.skip` or
   `expect(` in the drill file would count toward its own RG-03 numbers.
7. **`pnpm run gate:drills` prints the verdict; `gate:full` runs it.** A table
   for people: the owner, the pull request, a full local run. `gate:full` is
   where a session already reports what it could not check. Not in
   `gate:quick`: `test:unit` already runs the drills at every stop.
8. **CI: the existing `unit` job. No new job.** A new job would be a new
   required check: a ruleset change by the owner and stuck pull requests, as
   A-28 showed. It would also run the drills twice. CI-12's `code` answer is
   already true for every file a drill reads — scripts, everything under
   `.claude/` (agent definitions and settings included), workflows,
   `package.json`. AC14 checks this with `affected.mjs`'s own rule. No new
   classifier: a wrong "no" would skip the drills exactly when a gate changed.
9. **`ai-review.yml` is not edited (D-075).** Drill 9 reads its step and runs
   it. No manual merge, no batch item.

**Cost:** estimated 10–30 seconds on `unit`, mostly the test-runner starts in
drill 2. Not measured; the pull request reports the job's real time.

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
  never blocks" is the gap in Q1. `scripts/req-coverage.test.mjs` tests
  `trackedFiles` only. **Missing:** a run of the entry script with
  `--fail-on-uncovered-changed`.
- **4 · CI-06.** `scripts/lib/gate-decisions.test.mjs` tests `decideApiDiff`,
  including "released versions but no oasdiff: refuses to pass, rather than
  skipping quietly". **Missing:** no test has run `api-diff.mjs`, and oasdiff
  has never run anywhere (Q2).
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

**INF-10-AC1 — Drill 1 (RG-03): a `.skip` in a pull request is blocked.**
- **Given** a scratch git repository: a base commit with a synthetic test
  file holding two tests, and a head commit that adds `.skip` to one of them
- **When** `tests:changes` runs there as the `traceability` job runs it, with
  the scratch base in place of `origin/<base>`
- **Then** it exits non-zero, naming the file and "skipped, focused or todo
  tests were added", with its RG-03 line.
- **Control:** a head commit that adds a third test instead → exit 0, "1
  changed test file(s), none weakened".
- **Depends on Q3.** If (a): the same for `describe.skipIf(true)`,
  `describe.runIf(false)` and `describe.concurrent.skip` wrapped around the
  existing tests.

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

**INF-10-AC3 — Drill 3 (RG-01): a requirement named without a test is blocked.**
- **Given** a scratch git repository whose plan lists one synthetic story,
  with `origin/main` at the base commit
- **When** a head commit adds a spec naming that story and no test, and
  `req:coverage --fail-on-uncovered-changed` runs there as `traceability` runs
  it
- **Then** it exits non-zero, with its RG-01 line naming the story.
- **Control:** the head commit also adds a test naming it → exit 0, "1 of 1
  live requirements".
- **Depends on Q1.** If (a): **given** the story already has a test naming
  `<ID>-AC1`, **when** a changed spec adds `<ID>-AC2` that no test names,
  **then** `req:coverage` exits non-zero naming `<ID>-AC2`; control: a test
  naming `<ID>-AC2` → exit 0. If (b): drill 3 is reworded to the case above,
  in the roadmap and in the report.

**INF-10-AC4 — Drill 4 (CI-06): a breaking API change is blocked.**
- **Given** a scratch folder whose released version is a copy of the
  committed `packages/contracts/openapi.json`, and whose current description
  is that copy with one operation removed
- **When** `api:diff` runs there as the `contract` job runs it, with oasdiff
  installed
- **Then** it exits non-zero, with its AR-08 line naming the released file.
- **Control:** the current description unchanged → exit 0, having compared 1
  released version.
- **Without oasdiff**, the drill requires `api:diff`'s own refusal
  ("compatibility was NOT checked", non-zero), and the report says "fail-closed
  only; detection not proven", never "blocked". **Depends on Q2:** if (a), a
  missing oasdiff in CI (`CI=true`) fails the drill.

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
  examined something: a changed test file, a requirement, a released version,
  a verdict read back.

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

**INF-10-AC11 — Offline, synthetic and tidy.**
- **Given** the drills running in a cloud session or in CI
- **When** they spawn a gate
- **Then** it gets an explicit environment: no token, nothing a gate reads
  from the runner (`GITHUB_*`, `CI`), and a `PATH` whose only GitHub tool is
  the stand-in `gh`, which refuses any call it was not set up for. No Docker,
  no network.
- **And** all data is synthetic (RG-07). No committed file holds a drill's
  secret, phone number or `.skip`.
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
- **And** a test holds this: every source file a drill declares exists, and
  is code under `onlyInert` from `scripts/lib/affected.mjs`.
- No new job and no new required check.

## Test plan

| AC | Level | Where |
|----|-------|-------|
| AC1–AC11, AC14 | L2, tooling: real processes, scratch repositories | `scripts/drills.test.mjs` (new) |
| AC12 | L2 | `scripts/lib/gate-drills.test.mjs` (new): results → rows, verdict and exit code. The entry script is run once against a small scratch drill file |
| AC13 | L2 | `scripts/gate.test.mjs` (`FULL_STEPS`) |

They run in `unit` on every pull request CI-12 calls code, at every stop
through `gate:quick`, and in `gate:full` (twice: `test:unit` and
`gate:drills`).

- **No L3 to L7.** No database, API, app or device is touched.
- **Red phase.** New code gets tests that fail first, as usual: the runner,
  and whatever the answers to Q1–Q3 add. The drills themselves are green on
  their first run against working gates, so their red is shown two ways:
  - AC9, on every run;
  - in the pull request, each drill run once against its real gate made to
    always pass, with the output quoted. For `scripts/`, a local edit that is
    reverted. For `.github/` and `.claude/`, which a session may not edit
    without asking, a changed copy the drill is pointed at. Nothing is
    committed, so no manual merge (D-075). test-auditor reads this evidence
    for DOD-02.
- **Names.** `INF-10-ACn: …`, with the drilled ID in the name, as in
  `INF-10-AC1: RG-03 drill — …` (the INF-06 precedent; D-074 makes it the
  practice, not an obligation). INF is untracked, so nothing moves in
  `req:coverage`. The drill file starts with `// req-coverage: fixtures-only`.
  This spec names no tracked requirement, so `traceability`'s check of changed
  specs has nothing to flag.
- **Mutation.** No safety path changes, so Stryker does not run. The coverage
  ratchet applies to the new runner as to any file.

## Modules and files affected

Paths marked ◆ need a code owner's approval (D-042).

**New**
- ◆ `scripts/drills.test.mjs`: the seven drills, their controls and stand-ins
  (test-author).
- ◆ `scripts/gate-drills.mjs`: `pnpm run gate:drills` (implementer). Its
  decisions go in ◆ `scripts/lib/gate-drills.mjs`, tested by ◆
  `scripts/lib/gate-drills.test.mjs` (test-author).

**Changed**
- ◆ `package.json`: the `gate:drills` script.
- ◆ `scripts/gate.mjs`: the step in `FULL_STEPS`. ◆ `scripts/gate.test.mjs`
  holds it (test-author).
- ◆ `CLAUDE.md`: `gate:drills` in the command list.
- ◆ `docs/plan/decisions.md`: the owner's split, and the choices above
  (plan-keeper).
- `docs/progress.md`, `docs/progress/m0.md`, `docs/plan/README.md`
  (plan-keeper).

**Only if the owner answers (a)**
- Q1: ◆ `scripts/lib/requirements.mjs`, ◆ `scripts/req-coverage.mjs` and
  their tests; RG-01's wording in `docs/plan/06-testing-strategy.md`.
- Q2: ◆ `.github/workflows/ci.yml`: a pinned, hash-checked oasdiff in the
  `unit` and `contract` jobs.
- Q3: ◆ `scripts/lib/test-strength.mjs` and its test.

With (b) to Q1 instead, `docs/plan/10-roadmap.md` rewords drill 3.

**Deliberately unchanged**
- `.github/workflows/ai-review.yml` (D-075): read and run by drill 9, never
  edited.
- `.claude/**`: hooks, agents and settings are read, not changed.
- `scripts/lib/merge-rules.mjs`, `docs/plan/main-ruleset.json`: no new job,
  no new required check.
- `vitest.config.mjs`, `vitest.shared.mjs`: `scripts/**/*.test.mjs` already
  collects the drill file.
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

- **R1. A drill passes vacuously:** nothing ran, the gate crashed, or the
  fixture was wrong. Mitigation: AC8 (status, message, and a control showing
  the gate looked), AC9, AC12's count, and RG-03 over the drill file.
- **R2. A drill tests a copy of its gate.** AC10. The HK-02 hook test shows
  how copies drift.
- **R3. A drill writes into the repository.** AC11. Run in the repository,
  `req:coverage` would rewrite the committed report.
- **R4. A spawned gate inherits the runner's environment.** AC11. On a push to
  `main`, `GITHUB_EVENT_NAME` and `GITHUB_OUTPUT` change what gates do.
- **R5. A reviewer's sandbox reverts `.claude/**`.** Drills 5 and 7 then read
  the old files. They carry the same "differs from HEAD" note as
  `ai-review.test.mjs`.
- **R6. guard-bash matches text.** It sees `sed -i` and redirections, not
  `node -e` or `perl -i`. Drill 5 proves the forms the hook claims, not a
  sealed shell. Backstops: RG-03 in CI, test-auditor, and owner approval on
  `/scripts/` and `/.claude/`.
- **R7. Claude Code not running the hooks at all** cannot be shown offline.
  The drills prove the configuration and the scripts. D-044's scripted
  session is out of scope.
- **R8. HK-03 while building this.** A shell command that merely mentions a
  push to `main`, `--no-verify`, starting a workflow run, or reading `.env`
  is refused, and `grep … process.env` counts. Write commit messages and the
  PR body to a file with Write (`git commit -F`, `--body-file`); search with
  Grep.
- **R9. A drill's assertion rewritten.** `tests:changes` counts; it does not
  read. Guard: test-auditor, and owner approval on `/scripts/`.
- **R10. Friction.** Rewording a gate's message means updating its drill.
  Accepted: changing a gate should be deliberate.
- **R11. The Mac.** An old git on the hook `PATH` refuses `git init -b` (Live
  gotchas), so scratch repositories do not rely on it. `jq` there was not
  checked; if it is missing, drill 9 fails and says so.
- **R12. Flaky spawns.** No clocks, generous process timeouts, and RG-06
  quarantine if it happens anyway.

**The live drills.** Until the live attempt, drills 6 and 8 rest on
`gate:integrity` reading the rules. D-072 records that gate reporting 5 of 5
while a rule did nothing. The live task must also get past urso-agent's
automatic approval (D-072), or it shows nothing about the owner's.

**Found while reading the gates, and not changed here** (Q1–Q3 aside):
`tests:changes` passes, saying "nothing to compare against", when the base
will not resolve. CI's full-history checkout keeps it from biting today.
This is a candidate `/bugfix`.

## Out of scope

- Drills 6 and 8, live: a later task, with the owner watching.
- HK-03's local refusal of a push to `main` as a drill. The owner's split puts
  drill 6 with GitHub. `guard-bash.test.mjs` already runs the hook on it.
- Fixing what the drills find, beyond the owner's answers to Q1–Q3.
- Drills for gates not on the roadmap's list: static checks, the integration
  and system suites, the coverage ratchet, mutation, `android-e2e`, the
  security scan, HK-04/05/06/08/09 and CI-12.
- A scripted Claude Code session that tries each forbidden action (D-044). It
  needs Claude Code itself and a token.
- Any `ai-review.yml` change, the D-075 batch included.
- Putting the drill table in the daily report.

## Questions for the owner

**Q1 — Drill 3: should `req:coverage` check acceptance criteria, not just
requirement IDs? (what a gate enforces)**

Checked in the code: `req:coverage` treats a requirement as covered once any
test names it. `uncoveredInChanges` flags only requirements with no test,
and `mentions` counts `<ID>-AC1` as naming `<ID>`. RG-01 says the same. So a
new `<ID>-AC7` in a spec, with no test, passes `traceability` whenever that
requirement already has one test. The roadmap's drill 3 would get through
today, and by the roadmap's own rule M0 would not be done.

- **(a) Widen the gate.** With `--fail-on-uncovered-changed`, `req:coverage`
  also fails when a changed spec names `<ID>-ACn` for a tracked requirement
  and no test names that exact criterion. Untracked IDs (INF, CI, HK…) stay
  out, as D-074 keeps them. Cost: a small change to
  `scripts/lib/requirements.mjs` and its tests, plus RG-01's wording, amended
  by a new decision (D-040 makes RG-01 binding). A criterion that truly cannot
  be automated needs a written way out, as RG-01 already allows for whole
  requirements.
- **(b) Reword drill 3** to what RG-01 enforces: "a change that names a
  requirement no test names". No cost. Coverage of each criterion stays with
  test-auditor (DOD-02): a reviewer's judgement, not a gate.

**Recommendation: (a).** From M2 on, one alert story carries several criteria
(timings, escalation). A criterion added later without a test is what a
reviewer can miss and a gate cannot. The change is small and fails loudly.

**Q2 — Drill 4: install oasdiff now? (scope, and a small CI cost)**

Checked: nothing installs oasdiff. `ci.yml`'s `contract` job has no install
step; its own comment says it "starts failing the moment there is something
to break and no oasdiff to check it with". It is not in this session either
(`/usr/bin`, `/usr/local/bin`). Once a released version exists, `api:diff`
refuses every change, breaking or not: "compatibility was NOT checked". That
blocks drill 4's attempt, but not for the right reason. Nobody has seen this
gate detect a break, or read the OpenAPI 3.1.1 description our contract
package generates.

- **(a) Install it now**, pinned by version and SHA-256 like gitleaks, in the
  `unit` job (for the drill) and the `contract` job (for the gate). Drill 4
  then proves detection. Cost: a few seconds per run (not measured); the pin
  is raised by hand, since Dependabot cannot see it; its licence goes in the
  decision. A session may be refused the download, and there the drill
  reports "fail-closed only".
- **(b) Wait for the first release.** Drill 4 proves only that `api:diff`
  refuses to run without oasdiff. Its row says "fail-closed only; detection
  not proven" until the first-release task installs it.

**Recommendation: (a).** The first release is the worst moment to learn
whether this gate can read our own API description.

**Q3 — Drill 1: close a way around RG-03 found while writing this spec? (what
a gate enforces)**

Checked in `scripts/lib/test-strength.mjs`: the skip pattern needs a word
boundary right after `skip`. So it does not see `describe.skipIf(true)`,
`describe.runIf(false)`, or a skip behind another modifier such as
`describe.concurrent.skip`. Wrapped around existing tests, these switch off a
whole block while every count stays the same, so `tests:changes` and HK-05
both let it through. Turning one `test(` into `test.skipIf(true)(` is caught,
because the test count drops.

- **(a) Include these forms in drill 1**, and widen the pattern in INF-10.
  Cost: small. One pattern serves both HK-05 and `tests:changes`.
- **(b) A `/bugfix` after INF-10.** M0 closes with this way through RG-03
  written down.

**Recommendation: (a).** The roadmap says a drill that gets through means M0
is not done, and this one would.
