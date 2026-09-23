# code-reviewer — notes

Recurring problems, so the next review starts where the last one ended.
Newest first.

## Patterns worth checking every time

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

## Conventions this repository actually keeps
- Pure decision modules (`scripts/lib/*.mjs`) take state and return
  `{ what, fix }` problems; all IO lives in the `scripts/*.mjs` entry point.
  New tooling that mixes the two is worth a comment.
- A gate that cannot check something must fail, never pass quietly. `null` from
  an API means "unknown" and must not be rendered as "none" (D-029).
- Tests read as prose and name the requirement ID in the file header. That
  convention is well kept; do not spend review budget on it.
