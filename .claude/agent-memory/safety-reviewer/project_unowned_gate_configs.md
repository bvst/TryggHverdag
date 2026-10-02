---
name: unowned-gate-configs
description: Gate config without a CODEOWNERS entry — as of 2026-10-01 only apps/mobile/package.json's jest block (collectCoverageFrom for the safety-core floor); depcruise, vitest configs and packages/config are now owned
metadata:
  type: project
---

Re-checked 2026-10-01 (STORE-01 review): .github/CODEOWNERS now owns `/.dependency-cruiser.cjs`,
`/packages/config/`, `/vitest.config.mjs`, `/vitest.shared.mjs`, `/vitest.coverage.config.mjs`,
`/eslint.config.mjs`, `/stryker.config.mjs` and `/coverage-baseline.json` (D-084). Still unowned:
- `apps/mobile/package.json` — its jest `collectCoverageFrom` (line ~40) decides whether safety-core files are
  measured. Owning the whole file would put every Expo dependency bump behind the owner; moving jest config to
  `apps/mobile/jest.config.js` and owning that is the cheaper option.
D-042 says "the gates themselves" need the owner's approval, so this is a gap in the rules, not a style point.

Also not owned and not in ai-review's `safety` path filter: `docs/plan/critical-alerts-request.md` (STORE-01's
Apple text). Deliberate per the spec (the owner reads it before sending); see [[store01-critical-alerts-review]].

**Why:** a narrowed coverage include weakens a safety gate with no owner approval, and the coverage check stays
green (a rule that stops matching fails nothing).

**How to apply:** report as Should fix (owner decision, via OWNER_APPROVAL_PATHS + CODEOWNERS together, which
gate:integrity compares) until it lands; check CODEOWNERS and merge-rules.mjs first, since this list shrinks.
Related: [[changed-files-rename-blind-spot]].

**2026-10-02 (BUG-10, D-096):** /vitest.system.config.mjs and /vitest.integration.config.mjs join
CODEOWNERS and OWNER_APPROVAL_PATHS. apps/mobile/package.json jest block still the known gap.

**2026-10-02 (BUG-14, D-100, not merged at review time):** /packages/test-kit/ joins CODEOWNERS and
OWNER_APPROVAL_PATHS. Still in no list: the mutation groups' tests outside domain/ (see
[[bug14-gate-files-owned-review]]). apps/mobile/package.json jest block still the known gap.
