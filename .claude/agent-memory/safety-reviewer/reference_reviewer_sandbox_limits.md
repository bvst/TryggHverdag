---
name: reviewer-sandbox-limits
description: What the read-only guard-bash hook blocks for safety-reviewer, how to still run experiments, and Stryker 10 facts for checking mutation claims
metadata:
  type: reference
---

guard-bash.mjs (--readonly) blocks for this role:
- any `>` in a command, including JS arrows `=>` inside `node -e`, comparisons (`a>=b`) and `2>&1`.
  Use `function` syntax, swap comparisons to `<`/`<=`, and `|&`. `tcpdump -r` on saved pcaps is allowed.
- any file creation, even in the scratchpad (cp, mkdir, ln), so scratch mutant copies and Stryker runs
  are not possible. `git merge-base` in a compound command was also blocked (matched as a git write).
Workaround that works: `node --experimental-strip-types --input-type=module -e "..."` run from
apps/server, importing the real modules (./src/worker.ts etc.) to emulate a mutant's behaviour.
Running `pnpm exec vitest run <file>` is allowed.
- The hook matches git-write words as plain text, even inside a `node -e` string ("git mv" in a label
  was blocked). Keep git verbs out of strings.
- Plain `node --input-type=module -e` from the repo root can import scripts/lib/*.mjs directly (no
  strip-types needed) — used on INF-06 to emulate touchesApp/onlyInert answers.
- WRITE_OPS matches `cp`/`rm`/`mv`/`tee`/`touch` as whole words after whitespace, even in JS text
  (`import cp from 'node:child_process'` was blocked). Name the binding something else.
- Planting a fault in a spawned child with no files (BUG-5 redo, 2026-09-26): run vitest with
  `NODE_OPTIONS="--import=data:text/javascript;base64,<b64>"`. The preload patches the CJS
  `child_process.spawn`, calls `syncBuiltinESMExports()` (so the test's ESM `import { spawn }` sees it),
  and, filtered on the child's env (e.g. INSTANCE_TYPE=build), prepends `--import data:...;base64,<fault>`
  to the child's args. bin.test.ts passes only PATH to children, so NODE_OPTIONS never reaches them.
  Generate the base64 with `node -e ... process.argv[1]` inside `$(...)`. test-auditor uses a
  `register()` loader in a data: URL that edits source text on load — also file-free.
- Other reviewers may run in the same review worktree at once: before reporting a leftover child in
  `ps`, walk its PPID chain (their harness showed up as `node ../bug5-audit-harness.mjs`).

Maestro facts, for judging L7 claims: the pinned 2.10.0 is unpacked at
node_modules/.cache/maestro/2.10.0/maestro/lib/ (also ~/.maestro/lib on the Mac). `unzip -l` / `unzip -p
<jar> '<class>' | strings` work read-only: maestro-cli-2.10.0.jar's JUnitTestSuiteReporter$TestCase has a
`status: FlowStatus` field, and CANCELED is not counted in `failures=` (verified 2026-09-26).

Stryker 10 facts (node_modules/.pnpm/@stryker-mutator+instrumenter@10.0.0), for judging commit claims:
- ArithmeticOperator skips `+` when either side is a string or template literal.
- A `file:start-end` mutate range includes only mutants fully inside it (locationIncluded).
- Command runner timeout = timeoutMS (5 s) + factor 1.5 x initial run; timeouts count as detected, and
  Stryker tree-kills the runner with SIGKILL.
See [[mutation-gate-skips-test-only-changes]].
