---
name: in-memory-mutation
description: How test-auditor runs hand mutations despite the read-only Bash guard — Vite transform plugin via vitest/node startVitest, no file writes
metadata:
  type: reference
---

The test-auditor's Bash guard (`.claude/hooks/guard-bash.mjs --readonly`) blocks cp/mv/sed -i/git checkout/restore
and **any `>` followed by a token** (its redirect heuristic), so arrow functions (`=>`) in a `node -e` script get
the command blocked too. Editing the file under test to mutate it is therefore not allowed, and it should not be
worked around by writing files.

What works (BUG-4 audit, 2026-09-25): `node --input-type=module -e '...'` that imports `startVitest` from
`vitest/node` and passes, per mutant, a Vite plugin `{enforce:"pre", transform(code,id){...}}` in the 4th
argument (viteOverrides). The plugin rewrites the target module in memory. Read the results from
`v.state.getFiles()` by walking tasks, then `await v.close()`. Write it with `function` rather than `=>`. Count the
matches of each pattern and report "NOT APPLIED" unless there is exactly one, so a mutant that never applied cannot
show up as SURVIVED. Include a no-op baseline mutant. Afterwards `git status --short` shows the tracked tree unchanged.

Commands whose text contains `doctor.test.mjs` are blocked; use `pnpm exec vitest run scripts/doctor`.
The guard also blocks `git merge-base` and `git merge-tree` (even the old read-only form) and `> file`. For
conflicts, read `git diff HEAD...origin/main -- <file>` next to the branch diff. For long runs, use
run_in_background with no redirect and read the task's output file.
In-memory mutants cannot reach `bin.test.ts`: it spawns plain `node` on the files on disk, so a Vite transform never
touches the child. Rely on the author's scratch-copy and Stryker evidence, and say so.

Related: [[gate-integrity-local]]
