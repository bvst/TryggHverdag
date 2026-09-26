---
name: coverage-and-guard-quirks
description: Updating coverage-baseline.json when a baseline test is red needs a one-off --coverage.reportOnFailure run; guard-bash reads `=>` near a *.test.* path as a write
metadata:
  type: project
---

Two tooling quirks met in INF-06 (2026-09-25):

1. **The coverage baseline can be circular to update.** When a test that asserts on `coverage-baseline.json` is red, the Vitest coverage run fails, and Vitest writes no `coverage-summary.json` (`reportOnFailure` defaults to false), so `coverage:ratchet --update` has nothing to read. Break it once, outside the scripts, with `pnpm exec vitest run --coverage --config vitest.coverage.config.mjs --coverage.reportOnFailure`, then the app's `jest --ci --coverage`. Run `pnpm run coverage:ratchet` without `--update` first, so a real drop is seen before it is absorbed. On 2026-09-25 the baseline dated from 2026-09-23, and `--update` also added 27 server and script files that had none.
2. **guard-bash false positive.** A Bash command that names a `*.test.mjs` path *and* has an inline `node -e '… => …'` was blocked as "changes scripts/…test.mjs": it reads the `>` in `=>` as a redirect. Run the test command and the inline script as separate calls, or write the script to the scratchpad first.

**Why:** both cost a retry before the cause was clear.

**How to apply:** when a baseline or guard error looks impossible, check these first. Neither is a reason to edit a test or a hook. Related: [[red-phase-typed-lint]].
