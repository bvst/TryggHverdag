---
name: mutation-proof-recipe
description: How test-author proves a new test kills a mutant without touching production code — Vite transform for in-process modules, scratch copy + in-memory path rewrite for spawned scripts and the Expo app (INF-06, 2026-09-26)
metadata:
  type: reference
---

Callers (after a test-auditor BLOCK) ask for "prove it kills the mutant". What worked, all in one
scratchpad harness (`node <scratch>/mutate.mjs <mutants.mjs>`), written via Bash heredoc:

- **Runner:** `startVitest('test', [testFile], { run: true, watch: false, testNamePattern, reporters: [{}] },
  { plugins: [plugin] })` imported from `<checkout>/node_modules/vitest/dist/node.js`; walk `v.state.getFiles()`
  for per-test state and `task.result.errors[0].message`, then `await v.close()`. One startVitest per mutant.
- **In-process module** (a `scripts/lib/*.mjs` the test imports): Vite plugin `{ enforce: 'pre', transform }`
  that string-replaces in that file's code.
- **Spawned script** (`scripts/e2e-android.mjs`, `scripts/affected.mjs`): `cpSync` the whole `scripts/` dir to a
  temp dir, apply the mutant there, and have the plugin rewrite the test's path expression
  (`path.resolve('scripts/e2e-android.mjs')`, `resolve('scripts/affected.mjs')`, 2 matches) to the copy. Works even
  when the test sets the child's env in full, where NODE_OPTIONS loader tricks do not.
- **App config** (Expo CLI loads it itself, so no loader hook reaches it): copy the app's package.json,
  app.config.ts, tsconfig.json to `<tmp>/apps/mobile`, symlink its node_modules, rewrite the test's `APP` constant.
  `expo config --type introspect --json` then runs against the copy; `_internal.modResults.android.manifest`
  is the generated manifest. It reads an existing android/ folder if present, else Expo's template, and writes
  nothing.
- **Always:** a control (unmutated copy) that must pass, and count matches per mutant, reporting NOT APPLIED
  unless exactly 1. A mis-indented pattern once showed as "SURVIVED" before that check existed.
- Report the assertion line, not the first line: tests that pass `output` as the expect message put it first.

Related: [[hook-quirks-for-test-author]], [[main-checkout-shared]]
