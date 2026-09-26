---
name: reviewer-sandbox-limits
description: What the read-only guard-bash hook blocks for safety-reviewer, how to still run experiments, and Stryker 10 facts for checking mutation claims
metadata:
  type: reference
---

guard-bash.mjs (--readonly) blocks for this role:
- any `>` in a command, including JS arrows `=>` inside `node -e` and `2>&1`. Use `function` syntax and `|&`.
- any file creation, even in the scratchpad (cp, mkdir, ln), so scratch mutant copies and Stryker runs
  are not possible. `git merge-base` in a compound command was also blocked (matched as a git write).
Workaround that works: `node --experimental-strip-types --input-type=module -e "..."` run from
apps/server, importing the real modules (./src/worker.ts etc.) to emulate a mutant's behaviour.
Running `pnpm exec vitest run <file>` is allowed.

Stryker 10 facts (node_modules/.pnpm/@stryker-mutator+instrumenter@10.0.0), for judging commit claims:
- ArithmeticOperator skips `+` when either side is a string or template literal.
- A `file:start-end` mutate range includes only mutants fully inside it (locationIncluded).
- Command runner timeout = timeoutMS (5 s) + factor 1.5 x initial run; timeouts count as detected, and
  Stryker tree-kills the runner with SIGKILL.
See [[mutation-gate-skips-test-only-changes]].
