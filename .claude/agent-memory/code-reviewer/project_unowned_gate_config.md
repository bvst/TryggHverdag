---
name: unowned-gate-config
description: As of 2026-09-26, packages/config (AR-03 lint, AR-09/AR-10 import rules), the root vitest/eslint/depcruise/stryker configs and coverage-baseline.json have no CODEOWNERS entry
metadata:
  type: project
---

D-061 item 8 made `/scripts/` and `/package.json` owner-approved because "they decide what every gate does". The same is true of `packages/config/`, which holds the AR-03 clock rule and the AR-09/AR-10 dependency-cruiser rules. It is also true of root `eslint.config.mjs`, `.dependency-cruiser.cjs`, `vitest*.mjs`, `stryker.config.mjs` and `coverage-baseline.json`. None of them had a CODEOWNERS line on 2026-09-26. I raised this as a Note on INF-06. It is a repository-rules gap, which is the reviewer's business, not a finding against that branch.

Also open at that date: CLOCK_FREE_PATHS lists `apps/mobile/src/safety-core/**/*.ts`, so `.tsx` files escape AR-03 and AR-06. No dependency-cruiser rule stops `apps/mobile` from importing `apps/server` by a relative path (AR-07/AR-10).

**Why:** a pull request that narrows a rule in an unowned file can auto-merge with no human review, and the later change that relies on the narrowed rule looks clean.

**How to apply:** before repeating these notes, check `git show HEAD:.github/CODEOWNERS`, `packages/config/eslint/index.mjs` and `packages/config/dependency-cruiser.cjs`. If they are fixed, delete this memory. If not, mention them briefly and don't block on them. Related: [[spec-promises-vs-head]].
