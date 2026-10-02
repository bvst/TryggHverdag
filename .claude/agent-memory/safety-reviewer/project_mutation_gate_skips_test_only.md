---
name: mutation-gate-skips-test-only-changes
description: CI's mutation gate runs only when a SAFETY_PATHS source file changes; test-only edits to safety tests (bin.test.ts, worker.test.ts) skip it, and no nightly full run exists yet
metadata:
  type: project
---

`pnpm run mutation --only-if-safety-paths-changed` (ci.yml, scripts/gate.mjs) filters changed files with
`file.startsWith(p)` over SAFETY_PATHS in scripts/lib/gate-decisions.mjs. `apps/server/src/bin/bin.test.ts`
and `apps/server/src/worker.test.ts` do not match, so a PR that only edits them prints "touches no safety
code". D-036's nightly full run is planned (nightly.yml, later milestone) but did not exist on 2026-09-26.

**Why:** a weakened safety test would pass CI's mutation gate and only surface on the next PR that touches
safety source — late and misattributed. First seen reviewing BUG-5 (2026-09-26); reported as Should fix.

**How to apply:** on any test-only change to tests guarding SAFETY_PATHS, do the strength comparison
yourself (old vs new assertions, timing windows, which mutants each kills) instead of trusting the gate.
Check whether the gap has been closed (gate-decisions.mjs, a nightly workflow) before repeating the finding.
See [[spawned-process-test-review]] and [[reviewer-sandbox-limits]].

**Also config-only changes (2026-10-02, BUG-10):** a PR changing stryker.config.mjs, MUTATION_GROUPS
or a group's vitest config touches no SAFETY_PATHS file, so CI skips mutation and the new config is first
run on the next safety PR. Still no nightly workflow (only daily-status.yml is scheduled). Emulate with
`node --input-type=module -e` importing decideMutation and changedFiles from scripts/lib.

**Closed by D-098 (BUG-12, checked 2026-10-02):** decideMutation now also runs on a change to any group's tests or config, packages/test-kit/, stryker.config.mjs, gate-decisions.mjs, mutation.mjs, vitest.config.mjs and vitest.shared.mjs (emulated: bin.test.ts-only and worker.test.ts-only now run). Still skipped: product files outside SAFETY_PATHS (config.ts, adapters/clock.ts, api.ts), scripts/lib/proc.mjs and git.mjs, package.json (the last three owner-gated via /scripts/ and /package.json), the lockfile (owner cost question). Still no nightly workflow.
