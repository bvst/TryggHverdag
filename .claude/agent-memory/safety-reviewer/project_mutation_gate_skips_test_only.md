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
