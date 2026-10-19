---
name: hook-import-fail-open
description: A Claude Code hook that statically imports repo code exits 1 (non-blocking) when that code fails to load, so the gate goes silent toward the model; plant a broken import in the chain and compare exit codes old vs new
metadata:
  type: feedback
---
BUG-52 loop 1 (2026-10-19): post-edit.mjs began importing scripts/gate-file.mjs for one constant. Any file in the
import chain that fails to load (syntax error, or an import of a not-yet-added export, which is normal mid-TDD)
makes node exit 1 before the hook reads its input. Claude Code treats exit 1 as non-blocking, so the model is told
nothing and every later edit runs unchecked until the file is fixed. The old hook spawned the gate and blocked (exit 2).
**Why:** the gate's purpose is to catch exactly the broken edit, and it now fails open on edits to its own dependencies.
**How to apply:** when a diff adds a static import to a hook from scripts/ or any edited code, run the hook in a tree
copy with `import { NOT_YET_EXPORTED } from './lib/steps.mjs'` planted in the chain, old commit vs new, and compare
exit codes. Ask for a guarded dynamic import (try/catch -> block) or a literal pinned by a test. Grade by backstop:
stop-gate.mjs is self-contained (spawns gate:quick), so it is should-fix. Pre-existing in progress-gate.mjs and
test-weakening.mjs (static imports from scripts/lib).
Related: [[bug52-audit]], [[entry-script-wiring]]
Loop 2: the guarded dynamic import closed it. Plant also a fallback (`?? literal`) for the imported constant: a source
regex that matches `timeout: x.CONST\b` lets it through; ask for a behaviour check (export renamed in a temp copy ->
block) or an anchored regex (`CONST\s*,`).
Loop 3: the runtime check (`Number.isInteger(x) && x > 0`, else block) killed every fallback form. A planted fault
must not create a SyntaxError of its own (e.g. a second `const r`): that "kills" through a crash, not a test.
