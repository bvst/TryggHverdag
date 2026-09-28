---
name: unowned-gate-config
description: As of 2026-09-26, packages/config (AR-03 lint, AR-09/AR-10 import rules), the root vitest/eslint/depcruise/stryker configs, coverage-baseline.json and apps/mobile/app.config.ts have no CODEOWNERS entry; no rule stops apps/mobile importing apps/server
metadata:
  type: project
---

D-061 item 8 made `/scripts/` and `/package.json` owner-approved because "they decide what every gate does". The same is true of `packages/config/`, which holds the AR-03 clock rule and the AR-09/AR-10 dependency-cruiser rules. It is also true of root `eslint.config.mjs`, `.dependency-cruiser.cjs`, `vitest*.mjs`, `stryker.config.mjs`, `coverage-baseline.json` and `apps/mobile/app.config.ts` (it holds allowBackup, blockedPermissions and the no-scheme setting). None of them had a CODEOWNERS line on 2026-09-26. The INF-06 spec lists this as an owner follow-up that needs a `/decision`, not INF-06 work. It is a repository-rules gap, which is the reviewer's business, but it is not a finding against a feature branch.

Still open on that date: no dependency-cruiser rule stops `apps/mobile` from importing `apps/server` by a relative path (AR-07/AR-10). Fixed in INF-06 (6938a37): CLOCK_FREE_PATHS now covers `apps/mobile/src/safety-core/**/*.{ts,tsx}`.

**Why:** a pull request that narrows a rule in an unowned file can auto-merge with no human review, and the later change that relies on the narrowed rule looks clean.

**How to apply:** before repeating these notes, check `git show HEAD:.github/CODEOWNERS` and `packages/config/dependency-cruiser.cjs`. If they are fixed, delete this memory. If not, mention them in one line and don't block on them. Related: [[spec-promises-vs-head]].
