---
paths:
  - "apps/server/src/domain/**"
---
# Server domain rules
- Pure functions only: no I/O, and never `Date.now()`, `performance.now()` or
  `new Date()` with no arguments. `now` is always passed in (AR-02, AR-03).
- `new Date(value)` is allowed: turning a value someone handed in into a moment
  is a parse, not a clock read (D-067). The lint rule draws the line in the same
  place, and `packages/config/eslint/index.test.mjs` holds it there.
- Journey and alert changes go through the transition function, and must match
  SM-01 to SM-10 in `docs/plan/05-architecture.md`.
- Every new transition or rule gets a test that names its ID, plus a
  property-based test where the rule is about time or ordering.
- This path needs the owner's approval before merge (CODEOWNERS).
