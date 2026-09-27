---
name: coverage-and-guard-quirks
description: Updating coverage-baseline.json when a baseline test is red needs a one-off --coverage.reportOnFailure run; guard-bash reads `=>` or `>` near a *.test.* path as a write, blocks any `.env` text, and the implementer cannot Write to the scratchpad
metadata:
  type: project
---

Two tooling quirks met in INF-06 (2026-09-25):

1. **The coverage baseline can be circular to update.** When a test that asserts on `coverage-baseline.json` is red, the Vitest coverage run fails, and Vitest writes no `coverage-summary.json` (`reportOnFailure` defaults to false), so `coverage:ratchet --update` has nothing to read. Break it once, outside the scripts, with `pnpm exec vitest run --coverage --config vitest.coverage.config.mjs --coverage.reportOnFailure`, then the app's `jest --ci --coverage`. Run `pnpm run coverage:ratchet` without `--update` first, so a real drop is seen before it is absorbed. On 2026-09-25 the baseline dated from 2026-09-23, and `--update` also added 27 server and script files that had none.
2. **guard-bash false positives.** A Bash command that names a `*.test.mjs` path *and* has an inline `node -e '… => …'` was blocked as "changes scripts/…test.mjs": it reads the `>` in `=>` as a redirect. Run the test command and the inline script as separate calls. Don't count on the scratchpad: on 2026-09-27, guard-paths blocked the implementer's Write to the session scratchpad as "outside the repository". Seen again 2026-09-26: `vitest run <test files> > scratchpad/out.txt` is blocked the same way, even though the redirect targets the scratchpad; pipe to `grep`/`tail` instead. An awk filter with `$1>1900` next to a test path is blocked the same way. And the global guard blocks any command containing the text `.env` ("Reading .env files is not allowed"): `process.env`, even a `grep` of a downloaded source, and also a plain property access such as `step.env` in an inline `node -e`. Grep for the variable names instead, or print the whole object with `JSON.stringify`.

**Why:** both cost a retry before the cause was clear.

**How to apply:** when a baseline or guard error looks impossible, check these first. Neither is a reason to edit a test or a hook. Related: [[red-phase-typed-lint]].
