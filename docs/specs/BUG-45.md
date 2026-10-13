# BUG-45 · The mutation check runs one CI job per group, under an aggregator still named `mutation`; a local `--group`; the six mutants that only time out are fixed

**Raised by:** the owner, 2026-10-13 · **Queued:** after BUG-42 (D-129) ·
**Decisions:** D-029, D-036, D-042, D-043, D-060 (both), D-061, D-066, D-074,
D-075, D-098, D-099, D-100, D-117, D-124, D-129 · **Written:** 2026-10-13 by
the spec-writing agent, as a draft in the scratchpad (another pull request is
open on the branch). That session had no shell: `pnpm run decision` was not
run, so the decisions were read in `docs/plan/decisions.md` itself (last
heading D-129); no test, script or CI run was executed; GitHub's
documentation and the live ruleset were not read. What was read, and what is
assumed, is marked where it matters · **Status:** Spec, draft. Two questions
for the owner at the end; neither blocks the red phase.

## Requirement

BUG-45 (`docs/progress.md`, bug table):

> The mutation check takes 17 to 20 minutes, and every push or fix pays it
> again: its eight groups run one after another in one CI job (1,691 mutants;
> #80 17:20, #77 19:44), it is CI's critical path, and the margin under
> D-098's 25 minutes is closing. Six mutants end only by timing out. Raised by
> the owner, 2026-10-13

The owner's decision, D-129 (binding), in its own words:

> - **One CI job per group, in parallel, under an aggregator job still named
>   `mutation`.** The aggregator fails unless every group's job succeeded and
>   every group's report was judged by the same rule as today
>   (`judgeMutationReport`); a run with nothing to mutate passes as today.
>   The list of groups is generated from the code that defines them, never
>   typed into the workflow by hand. The required check keeps its name, so
>   the ruleset does not change. […] a group that fails can be re-run alone.
> - **`pnpm run mutation --group <name>`** runs one group locally (0:15 to
>   4:00), so a fix is checked before it is pushed. It changes nothing in
>   the gate.
> - **The six mutants that only time out are fixed:** each test that should
>   kill one fails in time, or a mutant that can only hang is excluded with
>   its reason (D-098's rule).

And from its consequences: "Nothing measured changes: the same mutants, the
same threshold, a fresh run every time (D-099). D-098's 25-minute budget
stays for each group. How the jobs share the groups and the aggregator reads
their results is BUG-45's design, recorded with it."

BUG IDs are not tracked by `req:coverage` (D-074), so tests are named
`BUG-45-ACn: …` for findability, as BUG-12's are.

## What exists today (read on 2026-10-13)

- **`ci.yml`, job `mutation`** (lines 325–362): `timeout-minutes: 30`; runs
  `scripts/affected.mjs` (CI-12), then `pnpm install`, then
  `pnpm run mutation --only-if-safety-paths-changed --base origin/<base>`.
  The workflow has `concurrency: ci-${{ github.ref }}`,
  `cancel-in-progress: true`.
- **`scripts/mutation.mjs`**: `runMutationGroups` (lines 140–256) runs every
  run of `mutationRuns()` in order inside one shared budget
  (`MUTATION_TIMEOUT_MS`, 25 min), classifies each run's paths (nothing to
  mutate / missing safety file / runs), clears and reads each run's JSON
  report, and judges it with `judgeMutationRun` and `judgeMutationReport`.
  Its imports, and theirs (`git.mjs`, `proc.mjs`, `gate-decisions.mjs`), are
  Node built-ins only.
- **`scripts/lib/gate-decisions.mjs`**: `MUTATION_GROUPS` (lines 69–151,
  eight groups), `mutationRuns()` (the groups, then a `whole-suite` run for
  safety paths no group claims: today only `apps/mobile/src/safety-core/`,
  which holds no file, so that run is never started), `decideMutation`
  (lines 277–325), `MUTATION_TIMEOUT_MS`, `judgeMutationReport`.
- **`stryker.config.mjs`** picks its run from `STRYKER_RUN`; a missing or
  unknown name throws. Each run writes `reports/mutation/<name>.json`.
- **`scripts/lib/merge-rules.mjs:137`**: `{ check: 'mutation', requirement:
  'CI-08', needsScript: 'mutation', blocking: true }`.
- **`scripts/lib/workflow-lint.mjs` `reviewWorkflows`** (used by
  `gate:integrity`): every required check must be a job id, **and every job
  in `ci.yml` must be a required check** ("ci.yml runs the job X, but no merge
  rule requires it"). New helper jobs in `ci.yml` therefore fail
  `gate:integrity` today.
- **`scripts/gate.test.mjs` pins** that this task must change, each with a
  written reason (RG-03):
  - line 283, "no ci job can be skipped into a green tick (CI-12)": no
    job-level `if:` anywhere in `ci.yml`;
  - line 424, the `mutation` job's `timeout-minutes` is at least the budget
    plus 3 minutes;
  - line 439, "the mutation budget stays 25 minutes for all the runs together,
    inside the 30-minute job";
  - line 452, the `mutation` job has exactly one step running
    `pnpm run mutation`, with `--only-if-safety-paths-changed` and `--base`.
- **`gate:drills`** (`scripts/lib/gate-drills.mjs`) has no mutation drill and
  reads no workflow shape: unchanged.
- **The six timeouts.** Both CI logs (job 114290527930 on #80, job
  114204230196 on #77) give only counts: `run.ts: 95.9 % (234 killed, 6
  survived, 4 timed out)` and `worker.ts: 96.81 % (243 killed, 6 survived, 2
  timed out)` on #80; the same 4 and 2 on #77. Stryker's clear-text reporter
  lists survivors only, and the JSON reports were not kept, so **the logs do
  not say which mutants timed out**. The parsed results in the scratchpad
  (`mutation-speed/out/`) hold no canary or worker report either. Pinning
  them is the red step's first job (AC11). What the numbers do say: each
  took about 40 s, Stryker's allowance (35 s plus 1.5 × the clean run), so
  Vitest's own 20 s per-test timeout did not end them. The same counts on two
  runs and since D-117 (worker) say they are deterministic, not load.
- **A wrong sentence found while reading:** `judgeMutationReport`'s failure
  message says "The clear-text report above names each" of survived, timed
  out, no-coverage and runtime-error mutants. For timeouts it does not (both
  logs). Not changed without the owner (Q1).

## Approach (technical choices delegated to Claude, D-031 and D-129)

1. **Three jobs in `ci.yml`.**
   - `mutation-plan` (10 min): checkout with full history, Node only (no
     `pnpm install`: the scripts use Node built-ins). Runs CI-12's
     `affected.mjs`, then `pnpm run mutation --plan
     --only-if-safety-paths-changed --base origin/<base>`, which writes three
     job outputs: `decision` (`run` or `skip`), `reason` (one line), and
     `groups`, a one-line JSON array of run names.
   - `mutation-group` (30 min): `needs: mutation-plan`, `if:
     needs.mutation-plan.outputs.decision == 'run'`, `strategy: { fail-fast:
     false, matrix: { group: ${{ fromJSON(needs.mutation-plan.outputs.groups)
     }} } }`. Checkout, pnpm, install, `pnpm run mutation --group ${{
     matrix.group }}`, then an upload step with step-level `if: always()`
     (artifact `mutation-report-<group>`, holding the run's JSON report and its
     verdict file; `overwrite: true` so a re-run replaces it; the upload
     action pinned by SHA as ci.yml's existing one is). GitHub names each leg
     `mutation-group (<group>)`; none is a required check.
   - `mutation` (10 min), **the required check, id and name unchanged, no
     `name:` key**: `needs: [mutation-plan, mutation-group]`, `if: always()`.
     Checkout, Node, download every `mutation-report-*` artifact (pinned by
     SHA) when the decision is `run`, then `pnpm run mutation --aggregate
     <dir>` with the plan's outputs and both jobs' `result`s in its
     environment. Its exit code is the check.
   - **Why `if: always()` on the aggregator:** without it, a failed or
     cancelled group skips the aggregator, and a skipped required check is
     reported as passing. That is what `ci.yml`'s header, D-060 (CI) item 2,
     D-061 item 3 and the CI-12 test all state; it was **not** re-read in
     GitHub's documentation in this session. `ai-review.yml`'s `review` job
     already uses the same pattern (D-061).
   - **Why the group job may have a job-level `if:`:** it is not a required
     check, so its "skipped" is never read as a pass by GitHub; only the
     aggregator reads it, and the aggregator accepts "skipped" only when the
     plan said `skip` (item 3). The plan always outputs the full list, so the
     matrix is never empty, whatever the decision.

2. **The group list comes from code, once.** `--plan` takes `mutationRuns()`
   and the same classification `runMutationGroups` uses today, extracted into
   one exported function (`classifyRuns`): runs with something to mutate go
   in `groups`, in order; a run with nothing to mutate (the `whole-suite` run
   today) is left out and named in the log; a group with a missing safety
   file stays in (it runs on its other paths, and fails, as today). Today's
   list is the eight groups. No group name is typed into `ci.yml`.

3. **The aggregator proves every expected group reported and passed.** A pure
   function, `aggregateMutationJobs`, in `scripts/mutation.mjs`. It does not
   trust the plan's list: it derives the expected list itself, from
   `classifyRuns(mutationRuns())` at the same commit, and compares. It
   collects every problem, as `runMutationGroups` does, and passes only when
   there is none:
   - the plan job's result is `success`; its `decision` is exactly `run` or
     `skip` (anything else, the empty string included, is a wiring fault and
     fails);
   - the plan's `groups` parses, has no duplicate, and equals the derived
     list (a missing or extra name is named);
   - **`skip`:** the group job's result is `skipped`. Passes with the plan's
     reason ("nothing to mutate", as today). Any other result fails as
     inconsistent;
   - **`run`:** the group job's result is `success`; every expected group has
     a verdict file saying Stryker finished with 0 and a report that
     `judgeMutationReport` passes, judged **again here** from the raw JSON;
     a report that will not parse, a missing report or verdict, a report for
     a group not expected, a group with a missing safety file, or an empty
     expected list each fail, by name. The output prints every group's
     per-file lines, as the sequential log does today.
   - The per-group verdict files mean the aggregator does not rest on how
     GitHub rolls up a matrix's result alone.

4. **`--group <name>`, one run.** `pnpm run mutation --group <name>` calls
   `runMutationGroups` with that one run and the whole budget, writes the
   report and a verdict file (`reports/mutation/<name>.verdict.json`: the run
   name, Stryker's exit status, the verdict), and exits 0 or 1. Its last line
   says that only this group ran and that this is not the mutation gate.
   Refused, before anything starts, with exit 1 and a reason: an unknown name
   (the message lists the run names), no name, a second `--group`, `--group`
   with `--only-if-safety-paths-changed` (a group asked for by name always
   runs), `--group` with `--plan` or `--aggregate`, and `--incremental`
   (D-099, as today). CI's legs run exactly this, so a local `--group` is
   what CI runs.

5. **`gate:full` is unchanged.** It still runs `pnpm run mutation
   --only-if-safety-paths-changed`: every group, in sequence, inside one
   shared 25-minute budget, with its step's own timeout of the budget plus a
   minute. Locally that is stricter than CI, which gives each group 25
   minutes. Reading D-129's "the budget stays for each group" as also giving
   each group 25 minutes locally would raise the local budget up to eightfold,
   which D-098 leaves to the owner: Q2.

6. **The budget pins.** `MUTATION_TIMEOUT_MS` stays `25 * 60_000`. The pins
   at `gate.test.mjs` lines 424 and 439 now read the `mutation-group` job:
   its `timeout-minutes` is 30, and the budget fits inside it with at least 3
   minutes for checkout and install. A new pin: the plan and aggregator jobs
   are bounded too (the existing "every workflow job is bounded" test already
   requires it).

7. **`gate:integrity` accepts the two helper jobs, and only on terms.**
   `CHECKS`' `mutation` entry in `merge-rules.mjs` gains `fanOut:
   ['mutation-plan', 'mutation-group']`. `reviewWorkflows` accepts a
   `ci.yml` job no check requires only when a required check names it in
   `fanOut`, that check's job `needs` it, and that check's job has `if:
   always()`. A declared fan-out job missing from `ci.yml` is a problem; any
   other unrequired job is still a problem, as today. The CI-12 test in
   `gate.test.mjs` changes from "no job-level `if:`" to "no job-level `if:`
   except `always()` on a required check with a fan-out, and one on a job of
   that fan-out".

8. **Where the code goes.** All new logic lives in `scripts/mutation.mjs` and
   `scripts/lib/gate-decisions.mjs`, which are already mutation inputs and
   already in the ai-review `safety` filter (D-100). A new script file would
   have to join both lists, and editing `ai-review.yml` stops CI's reviewers
   on this pull request (D-075). The YAML stays thin: no logic beyond passing
   values.

9. **The six timeouts.** Order of work:
   1. Red step: a fresh `--group canary` and `--group worker` run (the flag
      is the first thing built), reading each JSON report for status
      `Timeout`; each mutant recorded here and in the pull request: file,
      line and column, mutator, replacement.
   2. Per mutant, why it hangs past Vitest's 20 s. The 40 s says Vitest's
      timeout did not end it. Three shapes fit, and **none is verified**:
      (a) a loop that never yields to the timer queue (a synchronous loop, or
      an async loop over waits that resolve at once, such as a fake `Wait`);
      (b) the test fails at 20 s but Vitest cannot exit (an open handle);
      (c) a loop that does yield but whose test waits on it without a bound.
   3. Per mutant, the fix:
      - **The test fails in time** (`test-author`): a bound on the number of
        polls or waits, for example a fake `Wait` that throws past the most a
        correct run can need, or that yields a macrotask so Vitest's timeout
        can fire; or a teardown that closes what was left open. The test is
        named `BUG-45-AC12: …`.
      - **Excluded with its reason** (`implementer`), only for a mutant that
        can only hang: `// Stryker disable next-line <Mutator>: <why it can
        only hang>` on the line in `run.ts` or `worker.ts`. It then shows as
        "ignored" in the gate's "left out of the score" line, where review
        sees it (D-098).

10. **Decisions recorded.** The design above (items 1–8) as one delegated
    decision, the next free number, checked against the open pull requests'
    `decisions.md` before it is taken (the Live gotchas). Any exclusion in
    item 9 is listed in it, mutant by mutant.

## Acceptance criteria

"The plan", "a group's run" and "the aggregator" are `pnpm run mutation
--plan`, `--group <name>` and `--aggregate <dir>`. Pure functions are tested
directly. The entry points are tested in a scratch repository, as the
existing `pnpm run mutation` tests do.

### The plan

**BUG-45-AC1 — The group list is generated from the code that defines it.**
- **Given** `SAFETY_PATHS` and `MUTATION_GROUPS`, as in this repository and as
  in synthetic lists
- **When** the plan is computed
- **Then** `groups` is the names of `mutationRuns()` that have something to
  mutate, in order, as one line of JSON; a run with nothing to mutate is left
  out and named in the log; a group with a missing safety file stays in
- **And** in this repository it is exactly the eight groups, `whole-suite`
  left out.

**BUG-45-AC2 — The decision is made once, by today's rules, and written as
job outputs.**
- **Given**, in turn: a diff of documentation only (CI-12); a diff touching no
  safety code and no mutation input; a diff touching a safety file; one
  touching only a mutation input; Stryker not configured with a safety change
- **When** the plan runs with `--only-if-safety-paths-changed --base`
- **Then** `decision` is `skip`, `skip`, `run`, `run`, and the last exits 1
  with today's message; `reason` is `decideMutation`'s message on one line
- **And** with `GITHUB_OUTPUT` set the three outputs are appended to it in
  GitHub's `name=value` form, `groups` always the full list; unset, they are
  printed; a `GITHUB_OUTPUT` that cannot be written fails the plan.

### A group's run

**BUG-45-AC3 — `pnpm run mutation --group <name>` runs that group alone, judged
as today.**
- **Given** a scratch repository with two groups
- **When** `--group` names one
- **Then** Stryker starts once, with `STRYKER_RUN` naming it and the whole
  budget as its timeout; its report is cleared first and judged by
  `judgeMutationRun` and `judgeMutationReport`; the verdict file is written
  with the run's name, Stryker's exit status and the verdict
- **And** it exits 0 when the run passes and 1 when it fails, and its last
  line says only this group ran and that this is not the mutation gate.

**BUG-45-AC4 — A wrong `--group` is refused before anything starts.**
- **Given**, in turn: an unknown name; `--group` with no name, or followed by
  another flag; two `--group`s; `--group` with
  `--only-if-safety-paths-changed`, `--plan` or `--aggregate`; `--group` with
  `--incremental`
- **Then** each exits 1, starts no Stryker run, writes no report, and says
  why; the unknown name's message lists every run name.

### The aggregator

**BUG-45-AC5 — It passes only when every expected group reported and
passed.**
- **Given** the plan `success`, `decision` `run`, `groups` equal to the
  derived list, the group job `success`, and for each expected group a
  verdict file with exit 0 and a report every file of which reaches 80 %
- **Then** it exits 0 and prints each group's per-file lines
- **And** it derives the expected list itself, from `mutationRuns()` and the
  paths at that commit, not from the plan's output.

**BUG-45-AC6 — Anything less fails, loudly, naming the cause.** One case each,
each exit 1 with a message that names it:
- the plan job's result `failure`, `cancelled` or `skipped`;
- `decision` empty, missing, or neither `run` nor `skip`;
- `groups` not JSON, with a duplicate, missing an expected group, or naming
  one not expected;
- with `run`: the group job's result `failure`, `cancelled` or `skipped`;
- a group's report or verdict file missing (the group is named, never passed
  over);
- a report that does not parse;
- a verdict file with a non-zero exit or a failed verdict;
- a report with a file below 80 %, **even with the group job `success`**
  (judged again here);
- a report for a group not expected;
- a group whose safety path holds no source file;
- no run with anything to mutate.
- **And** when several hold, every one is named.

**BUG-45-AC7 — Nothing to mutate passes as today, and only then.**
- **Given** `decision` `skip` and the group job `skipped`
- **Then** it exits 0 and prints the plan's reason
- **And given** `skip` with the group job anything but `skipped`, it fails as
  inconsistent.

### The workflow

**BUG-45-AC8 — `ci.yml` has the three jobs, thin, with the list from code.**
- **Then** `mutation-plan` runs `affected.mjs` before its guarded steps and
  `pnpm run mutation --plan --only-if-safety-paths-changed --base origin/${{
  github.base_ref || 'main' }}`
- **And** `mutation-group` needs it, is guarded on `decision == 'run'`, has
  `fail-fast: false` and its matrix from
  `fromJSON(needs.mutation-plan.outputs.groups)`, runs `pnpm run mutation
  --group ${{ matrix.group }}`, and uploads its report and verdict under a
  step-level `if: always()`
- **And** `mutation` needs both, has `if: always()` and no `name:`, and runs
  `pnpm run mutation --aggregate`
- **And** no group name from `MUTATION_GROUPS` appears in the three jobs'
  non-comment lines; no step in them passes `--incremental`
- **And** `timeout-minutes` is 10, 30 and 10
- **And** none of the three jobs reads a secret (`secrets.` in its lines) or
  sets `permissions:` wider than the workflow's `contents: read`
  (`privacy-security-reviewer` on #82: the group jobs run the pull request's
  own code, so they hold nothing a pull request could take).

**BUG-45-AC9 — The 25-minute budget applies to each group, inside its job.**
- **Then** `MUTATION_TIMEOUT_MS` is 25 minutes; `mutation-group`'s
  `timeout-minutes` is 30, and the budget is at most that minus 3 minutes
- **And** `gate:full`'s mutation step is unchanged: `pnpm run mutation
  --only-if-safety-paths-changed`, every group in sequence in one shared
  budget, its timeout at least the budget plus a minute (the BUG-12 tests
  stand unchanged).

**BUG-45-AC10 — `gate:integrity` accepts the fan-out jobs only on terms.**
- **Given** `CHECKS`' `mutation` entry with `fanOut: ['mutation-plan',
  'mutation-group']`
- **Then** `reviewWorkflows` reports no problem for the two jobs when
  `mutation` needs both and has `if: always()`
- **And** it reports a problem, naming it, when: a fan-out job is missing
  from `ci.yml`; `mutation` does not need one; `mutation` lacks `if:
  always()`; any other job in `ci.yml` is not required (as today)
- **And** the CI-12 test allows a job-level `if:` only as `always()` on a
  required check with a fan-out, and on a job of that fan-out.

### The six timeouts

**BUG-45-AC11 — The six are pinned before they are fixed.**
- **Given** a fresh `--group canary` and `--group worker` run on the base of
  this branch
- **Then** each mutant whose status is `Timeout` is recorded in this spec and
  the pull request with its file, line and column, mutator and replacement,
  and the status of every other mutant in the two reports is kept as the
  baseline
- **And** if the count is not 4 and 2, that is reported before anything is
  fixed.

**BUG-45-AC12 — Each is caught in time, or excluded with its reason.**
- **Then** for each of the six, either a test fails on it within Vitest's
  20 s, named `BUG-45-AC12: …`, or the line carries a `Stryker disable
  next-line` comment for that mutator only, with a reason that says why it
  can only hang
- **And** on this branch's head, the `canary` and `worker` reports have no
  `Timeout`; every other mutant's status is the baseline's, mutant by mutant;
  `run.ts` and `worker.ts` each still reach 80 %.

**The six, identified (2026-10-13, AC11's first half).** Fresh runs at
`9dab041` (`STRYKER_RUN=canary`, 3:42; `STRYKER_RUN=worker`, 4:02; both exit
0). The counts match CI's: `run.ts` 234 killed, 6 survived, 4 timed out;
`worker.ts` 243 killed, 6 survived, 2 timed out. The two JSON reports are the
baseline, kept in the scratchpad (`bug45-timeouts/canary.json`,
`worker.json`).

| # | File:line:col | Mutator → replacement | What the mutant does | Kind |
|---|---|---|---|---|
| 1 | `modules/canary/run.ts:202:11` | BlockStatement → `{}` | empties the alert-watch `while` body: `seen` never changes, so the loop spins **synchronously** on an unchanged condition | can only hang: no timer, not even Vitest's, runs again |
| 2 | `modules/canary/run.ts:203:23` | ArrowFunction → `() => undefined` | the poll's `wait(CANARY_POLL_MS)` is dropped: `read` runs again at once, a loop of microtasks with no wait | killable: a test whose store refuses a second read with no wait between |
| 3 | `modules/canary/run.ts:230:18` | BlockStatement → `{}` | empties the stand-down `for (;;)` body: a synchronous spin | can only hang |
| 4 | `modules/canary/run.ts:237:23` | ArrowFunction → `() => undefined` | as 2, in the stand-down wait | killable, as 2 |
| 5 | `worker.ts:271:15` | BooleanLiteral `false` → `true` | `again` is always set, so every run of a loop starts the next at once, with no `WATCHDOG_INTERVAL_MS` timer | killable: a test that one finished run is followed by the interval's timer, not a second run, and that stops the worker in `finally` |
| 6 | `worker.ts:288:15` | ConditionalExpression `again` → `true` | as 5 | killable, as 5 |

The "Kind" column is reasoning from the code, not yet proved: the red step
proves each, and a mutant that turns out not to be killable in time is
excluded with its reason instead. Why 2, 4, 5 and 6 hang today rather than
fail: each turns a wait into a chain
of microtasks, which starves every timer (Vitest's 20 s timeout among them),
so only Stryker's own timeout ends the run. A test kills one in time only if
**every** test that reaches the loop stops it without a timer, because the
files run one after another (`--maxWorkers=1`) and a starved test before the
killing one still hangs. So the red step changes the shared fakes those tests
use (a store or work fake that fails loudly when called again with no wait in
between), not one test alone. For 1 and 3, D-098's exclusion applies: a
`Stryker disable next-line BlockStatement` with the reason, on exactly that
block (the `while`'s `) {` line is inside its condition, so the implementer may
reshape that loop to `for (;;)` with the same behaviour, to put the comment
on a line of its own).

**BUG-45-AC14 — The gate names each mutant that timed out** (Q1, the
owner's answer).
- **Given** a report with one or more mutants whose status is `Timeout`
- **Then** `judgeMutationReport`'s output names each one on its own line:
  file, line and column, and mutator, read from the JSON report
- **And** the verdict and the score are exactly what they are without the
  lines; the message no longer says the clear-text report names mutants it
  does not name (it names survivors only).

### On the pull request's own CI

**BUG-45-AC13 — The new shape works on GitHub.** *(not automated: checked by
hand on the pull request, quoted from the job logs)*
- **Then** the required `mutation` check is the aggregator's; eight
  `mutation-group (<name>)` legs ran at once; the aggregator's log names all
  eight with their files' scores; `gate:integrity` reports every section
  passed; the wall clock from the plan's start to the aggregator's end is
  recorded
- **And** one leg, re-run alone with "Re-run failed jobs" or the leg's own
  re-run, is followed by the aggregator re-running and reading the other
  seven groups' artifacts from the first attempt. If GitHub does not keep
  them, the pull request says so and the design is revisited before merge.

## Test plan

The levels are `06-testing-strategy.md`'s. Tests of `scripts/` are Vitest
tests at L2 (tooling), as INF-10's are; L1 is the static gate.

| Criterion | Level | Where |
|---|---|---|
| AC1, AC2 | L2 | `scripts/mutation.test.mjs` (`--plan`, `classifyRuns`); `scripts/lib/gate-decisions.test.mjs` if `classifyRuns` lives there; one scratch-repository run of the entry point writing to a temporary `GITHUB_OUTPUT` |
| AC3, AC4 | L2 | `scripts/mutation.test.mjs`: `runMutationGroups` with a fake Stryker, the argument parser, and the entry point in a scratch repository |
| AC5–AC7 | L2 | `scripts/mutation.test.mjs`: `aggregateMutationJobs`, one case per bullet of AC6, table-driven; the entry point once in a scratch repository with a reports folder |
| AC8, AC9 | L2 | `scripts/gate.test.mjs`, the `ci.yml` shape tests (lines 283, 424, 439, 452 changed with written reasons; RG-03, `test-author`) |
| AC10 | L2 | `scripts/lib/workflow-lint.test.mjs`, `scripts/lib/merge-rules.test.mjs`; the CI-12 test in `scripts/gate.test.mjs` |
| AC11 | Measurement | The red step's runs; recorded in this spec and the pull request |
| AC12 | L6 / L2, and the mutation run | `apps/server/src/canary.system.test.ts` (L6) for `run.ts`; `apps/server/src/worker.test.ts` or `process.test.ts` (L2) for `worker.ts`; the CI legs' reports are the proof |
| AC13 | CI, by hand | The pull request's own runs |

## Modules and files affected

- `scripts/mutation.mjs` — `--plan`, `--group`, `--aggregate`; the argument
  parser; `aggregateMutationJobs`; the verdict file. Owned, safety filter.
- `scripts/lib/gate-decisions.mjs` — `classifyRuns` extracted from
  `runMutationGroups` (if placed here), the verdict file's path. Owned,
  safety filter.
- `scripts/lib/merge-rules.mjs` — `fanOut` on the `mutation` entry.
- `scripts/lib/workflow-lint.mjs` — the fan-out rule in `reviewWorkflows`.
- `.github/workflows/ci.yml` — the three jobs; the CI-12 comments that say
  "`mutation` has worked this way since INF-04" brought up to date.
- Tests (`test-author`): `scripts/mutation.test.mjs`,
  `scripts/lib/gate-decisions.test.mjs`, `scripts/lib/workflow-lint.test.mjs`,
  `scripts/lib/merge-rules.test.mjs`, `scripts/gate.test.mjs`,
  `apps/server/src/canary.system.test.ts`, `apps/server/src/worker.test.ts`
  and/or `process.test.ts`; possibly a fake in `packages/test-kit/` (owned,
  D-100) if a hang is in a fake.
- Possibly `apps/server/src/modules/canary/run.ts` and
  `apps/server/src/worker.ts`, only for `Stryker disable` comments (owned,
  safety paths).
- `docs/progress.md` (the bug row, the command list: `pnpm run mutation
  --group <name>`), `docs/plan/decisions.md` (approach item 10).

Every one of these but the tests of `apps/` is an owner path (D-042, D-100).

## Contract changes

None. Nothing under `packages/contracts` changes. The required checks keep
their names; the ruleset does not change. That the ruleset requires
`mutation` today rests on `gate:integrity`'s report (CLAUDE.md: 5 of 5),
not read in this session.

## Risks and failure modes

BUG-45 touches no journey or alert code. It reaches the failure modes through
the mutation gate: [F8](../plan/03-safety-reliability-security.md#failure-modes),
"A bad release breaks alerts", whose mitigation is the release gates. A
mutation gate that passes without measuring lets weak tests on safety code
through, and with them the release that breaks alerts.

- **R1. A failed group skips the aggregator, which reads as a pass.** `if:
  always()` on `mutation`, pinned (AC8, AC10).
- **R2. A missing report passes.** The aggregator derives the expected list
  itself and needs a report and a verdict for each (AC5, AC6).
- **R3. The plan's list shrinks, by a bug or a typo in the wiring.** The
  aggregator compares it with its own; an empty or unknown `decision` fails
  (AC6).
- **R4. A wrong `skip` turns the gate off.** The same `decideMutation` as
  today, tested as today; a `skip` with groups that ran is inconsistent and
  fails (AC7).
- **R5. `cancel-in-progress`.** A newer push cancels the older run. Its
  aggregator either runs and fails on cancelled legs, or is cancelled; in
  neither case is it green. Which one GitHub does was not checked here.
- **R6. Re-runs.** That a re-run aggregator sees the first attempt's
  artifacts, and that `overwrite: true` lets a re-run leg replace its own, is
  assumed from memory of GitHub's behaviour, not read. AC13 checks it on the
  pull request.
- **R7. Queueing.** Ten jobs in `ci.yml` become twenty, beside
  `ai-review.yml`'s. If the account's concurrent-job limit is reached, legs
  wait, and the wall clock is longer than D-129's 4 to 4.5 minutes. It costs
  time, not correctness; AC13 measures it. The limit was not checked.
- **R8. Cost.** Free while the repository is public (D-129, from GitHub's
  docs read by the owner's session). If it moves to a private or organisation
  repository (D-029), eight installs per run cost minutes: the owner's then.
- **R9. The local run overruns first.** `gate:full` keeps one shared 25
  minutes (approach item 5) while CI gives each group 25. Growth shows locally
  first; the choice then is the owner's (D-098). Q2.
- **R10. An exclusion hides a real gap.** Only for a mutant that can only
  hang, with its reason, on the line, reviewed by `safety-reviewer`; the
  gate's output already counts "ignored" per file.
- **R11. A test fix for a timeout weakens a test.** Bounds are added, never
  assertions removed (RG-03); `test-auditor` reviews.
- **R12. Artifacts.** The reports hold paths and source fragments of a public
  repository, and synthetic test names (RG-07): no personal data, no
  location, no phone number (PRIV-07 untouched).
- **R13. `--group` read as the gate.** Its last line says it is not, and
  `gate:full` and CI never treat one group's pass as the gate's.

## Out of scope

- Running only the groups a pull request touches (not chosen, D-129).
- The `whole-suite` run's design for `apps/mobile/src/safety-core/` once it
  has a file (D-129's consequences: its Vitest config excludes
  `apps/mobile/**`). This task's plan would put that run in the matrix as it
  stands; its design is that task's.
- Any change to what is measured: the threshold, `judgeMutationReport`'s
  rules, the Stryker command, the groups (D-129: "nothing measured
  changes"). Q1 changes only a message, if the owner says yes.
- The 25-minute budget's size; a local per-group budget (Q2).
- The six survivors in `run.ts` and the six in `worker.ts`: they survive,
  they do not time out.
- Failing the gate on any timeout, or a ratchet on timeouts.
- D-036's nightly full run.
- A gate drill for mutation (INF-10's list is the roadmap's).
- BUG-42, BUG-44.

## Questions for the owner

**Q1. Should the gate's output name each mutant that timed out?**
`judgeMutationReport` says "the clear-text report above names each", but
Stryker's clear-text report names survivors only: both CI logs show the four
and two timeouts as counts, nowhere by line. That is why this task has to
re-run the groups to find them (AC11). Naming them is one line per timed-out
mutant (file, line and column, mutator), read from the JSON report the gate
already reads. It changes no verdict.
**Recommendation: yes,** in this task, as a criterion of its own. Without it
the next timeout is as hard to find as these six.
**Answered (the owner, 2026-10-13): "Yes, in BUG-45 (Recommended)".** See
BUG-45-AC14.

**Q2. Does "the 25-minute budget stays for each group" apply to the local
`gate:full` too?**
In CI each group's job gets 25 minutes. Locally, `gate:full` runs all eight
in sequence; today they share one 25-minute budget (about 16 minutes on a
quiet 4-core machine, D-124).
**Recommendation: keep the local budget as it is,** shared, with `--group`
giving one group 25 minutes. Giving each group 25 minutes locally would raise
the local limit up to eightfold, which D-098 leaves to you. If the local run
starts to overrun, it comes back to you with the numbers.
**Answered (the owner, 2026-10-13): "Keep it shared (Recommended)".**
BUG-45-AC9 stands as written.
