# code-reviewer — notes

Recurring problems, so the next review starts where the last one ended.
Newest first.

## Patterns worth checking every time

- **A path added to the ai-review `safety` filter summons safety-reviewer, whose brief
  covers only SM/REL/LOST product code.** BUG-14 (D-100) added mutation-gate files and
  test-kit fakes; the brief had no line for either, so the review risked being a PASS with
  nothing checked (D-045). When a filter grows a new kind of file, check the brief has a
  line for it. When a decision enumerates "X's own files", diff it against the code's own
  list (D-100 took 4 of `MUTATION_INPUTS`' 6), and diff its Context against the pull
  request's comments (`api.github.com/repos/bvst/TryggHverdag/issues/<n>/comments`). A
  CODEOWNERS test that orders two disjoint patterns pins layout, not ownership.

### A Stryker "Killed" can be a false kill from a slow child-process test
stryker.config.mjs uses the command runner, so every mutant runs the whole
suite and any failing test counts as a kill. In the INF-08 review the mutant
`createCheckIn = (url) => healthchecksCheckIn({})` in worker.ts was "Killed"
only because `bin/bin.test.ts` "BUG-3: on Clever Cloud's build machine…"
(a fixed 1.5 s sleep before reading the child's output) timed out under
mutation load. The mutant survives on merit. Check suspicious kills by reading
`statusReason` in `reports/mutation/RUN.json` (node one-liner:
filter `files[f].mutants` by line, print `statusReason`); a kill whose only
failure is an unrelated child-process test is not a kill.

### Node fetch follows redirects, so "only a 2xx counts" needs redirect: manual
Verified: a HEAD answered 302 → 200 elsewhere resolves with `ok: true`.
`redirect: 'manual'` gives the 302 back as `ok: false`. Also verified:
fetch to port 1 fails before connecting ("fetch failed", cause "bad port",
no `code`); an undefined URL fails with cause code ERR_INVALID_URL.

### A missing GitHub secret is "", and Terraform treats "" as a value
A workflow env line `TF_VAR_x: ${{ secrets.X }}` with no secret set gives
Terraform an empty string: the error is "Invalid value for variable" (the
validation message), not "No value for required variable". Terraform side
verified with the pinned binary at node_modules/.cache/terraform/1.16.4 in a
scratch dir. Check owner docs that quote the error.

### The scratchpad is shared with reviewers running in parallel
Another agent wrote main.tf/variables.tf into the same scratch subfolder
mid-probe ("Duplicate variable declaration"). Use a unique subfolder name.

### `echo "key=$(cmd)" >> "$GITHUB_OUTPUT"` swallows cmd's failure
GitHub's default `run:` shell is `bash -e`, and `-e` does not see a failed
command substitution inside another command's arguments: the step goes green
and writes `key=`. Verified with `bash -e` in the INF-07 review
(`infra-staging.yml`, step "The plan the owner read"). Assign first
(`fp=$(cmd)` does propagate the failure), then echo. Check every `$(...)` in a
workflow `run:` block.

### A test that "holds two files together" by copying the literal holds nothing
`scripts/staging-workflows.test.mjs` looks for the string
`TRYGGHVERDAG_PLAN_FINGERPRINT=` in the YAML instead of building it from the
exported `FINGERPRINT_MARKER`, so renaming the constant passes every test and
breaks the workflow. When a test claims to pin a cross-file constant, check that
it imports the constant rather than restating it. Same shape in INF-07: the
workflow name `infra-staging` and job id `plan` hard-coded in
`scripts/lib/plan-approval.mjs`, with no test tying them to the YAML.

### "A session cannot X": check every route to X
D-077 says sessions cannot start a workflow run. HK-03 and the settings deny
cover dispatch, but `gh run rerun` and the REST `.../runs/<id>/rerun` route get
through (verified in the INF-07 review by piping hook JSON into
`.claude/hooks/guard-bash.mjs --global`). When a decision states a session
boundary, list the routes (CLI, REST through `gh api`, MCP tool) and test each
one against the hook.

### HK-03 matches text, so it blocks reviewers too
Any Bash command that merely names the deploy wrapper (the staging-deploy entry
file under scripts/) or the Terraform apply/destroy routes is refused, including
a plain `cat` of the file. Use the Read tool for those files.

### Generated files compared with `git diff --exit-code` in CI
`scripts/req-coverage.mjs` stamps `new Date()` into `docs/requirements-status.md`.
Any CI step that regenerates such a file and demands no diff goes red on the
first day after the file was committed, for a reason unrelated to the change.
Check: does the generator read the wall clock, and does anything compare its
output byte for byte? (AR-03 — the clock is injected precisely so decisions do
not drift with the calendar.) Found in INF-04 (`.github/workflows/ci.yml`,
`traceability` job).

### A skipped GitHub job is reported as a green tick
D-060 records this, and the repository's own workflows can still fall into it:
a job with `needs: <x>` is *skipped* when `<x>` fails, and a skipped required
check passes. Check every `needs:` on a job that produces a blocking check
(`ai-review.yml` `review` needs `changes`). The fix is `if: always()` plus a
first step that fails when `needs.<x>.result != 'success'`. Also check
`if:` at job level, matrix jobs, and path filters.

### Check names vs job ids
`scripts/lib/workflow-lint.mjs` compares merge-rule check names against job
*ids* in `ci.yml` and against a loose `agent:\s*<name>` regex in
`ai-review.yml`. A job that gains `name:` or `strategy:`, or a change to
`name: ai-review (${{ matrix.agent }})`, silently breaks the mapping — the
required check then never arrives and every pull request waits forever. When
reviewing workflow changes, re-derive the check name GitHub will actually
report.

### The safety paths are copied, and have already drifted
Five copies today: `scripts/lib/gate-decisions.mjs` (SAFETY_PATHS, 4 entries),
`scripts/lib/coverage.mjs` (SAFETY_PATHS, **3 — missing
`apps/server/src/worker.ts`**), `scripts/lib/merge-rules.mjs`
(OWNER_APPROVAL_PATHS), `.github/CODEOWNERS`, and the `safety:` filter in
`.github/workflows/ai-review.yml`. The worker hosts the watchdog and the outbox
(AR-05, AR-06), so the missing entry means the 95 % safety branch floor does not
apply to it. Push for one exported list that the others derive from.
Update (INF-07 review): `coverage.mjs` now imports `SAFETY_PATHS` from
`gate-decisions.mjs`, so that copy is gone. Four remain (gate-decisions,
merge-rules, CODEOWNERS, the ai-review filter). The worker's entry and exit path
(`apps/server/src/bin/worker.ts`, `apps/server/src/process.ts`) is in none of
them.

### `pnpm run <script> -- --flag` passes the `--` through
Verified against pnpm 10: argv becomes `['--', '--flag']`. Harmless for the
scripts that use `argv.includes` / `indexOf`, fatal for vitest (reads
`--coverage` as a filename) and would silently disable every flag for anything
that later moves to `node:util parseArgs`. Flag stray `--` in workflows and in
`scripts/gate.mjs`.

### Drafts left beside the installed file
`docs/plan/08b-ci-files/.github/` still holds the pre-INF-04 drafts of
`ci.yml`, `ai-review.yml` and `dependabot.yml`, now superseded and wrong (the
README there still names `CLAUDE_BOT_TOKEN`). When a draft is installed, the
draft should go. Check `08b-ci-files/` on every infrastructure change.
Happened again in INF-07: `08b-ci-files/.github/workflows/deploy-staging.yml`
stayed behind when the real one was installed. It uses `clever-tools@latest`,
`--force` and a database-URL secret, and D-077 rejects all three.

## Conventions this repository actually keeps
- Pure decision modules (`scripts/lib/*.mjs`) take state and return
  `{ what, fix }` problems; all IO lives in the `scripts/*.mjs` entry point.
  New tooling that mixes the two is worth a comment.
- A gate that cannot check something must fail, never pass quietly. `null` from
  an API means "unknown" and must not be rendered as "none" (D-029).
- Tests read as prose and name the requirement ID in the file header. That
  convention is well kept; do not spend review budget on it.
