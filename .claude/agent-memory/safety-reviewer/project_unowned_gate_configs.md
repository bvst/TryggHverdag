---
name: unowned-gate-configs
description: Gate configuration outside /scripts/ has no CODEOWNERS entry — packages/config/dependency-cruiser.cjs (AR-09/AR-10 rules), root vitest*.config.mjs (coverage excludes), apps/mobile/package.json's jest block (collectCoverageFrom for the safety-core floor)
metadata:
  type: project
---

As of 2026-09-26 (INF-06 review), OWNER_APPROVAL_PATHS (scripts/lib/merge-rules.mjs) and .github/CODEOWNERS
own /scripts/, /.github/, /.claude/, /package.json and the safety paths, but not:
- `packages/config/dependency-cruiser.cjs` and `/.dependency-cruiser.cjs` — the AR-09 import boundary that
  keeps the UI (now including src/app/ routes) out of safety-core internals;
- `vitest.coverage.config.mjs` — its coverage `exclude` decides what the 95 % safety branch floor sees;
- `apps/mobile/package.json` — its jest `collectCoverageFrom` decides whether safety-core files are measured.
  Owning the whole file would put every Expo dependency bump behind the owner; moving jest config to
  `apps/mobile/jest.config.js` and owning that is the cheaper option.
D-042 says "the gates themselves" need the owner's approval, so this is a gap in the rules, not a style point.

**Why:** a narrowed path pattern or an extra coverage exclude weakens a safety gate with no owner approval,
and the depcruise/coverage checks stay green (a rule that stops matching fails nothing).

**How to apply:** report as Should fix (owner decision, via OWNER_APPROVAL_PATHS + CODEOWNERS together, which
gate:integrity compares) until it lands; check merge-rules.mjs first. Related: [[changed-files-rename-blind-spot]].
