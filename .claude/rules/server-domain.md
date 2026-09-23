---
paths:
  - "apps/server/src/domain/**"
---
# Server domain rules
- Pure functions only: no I/O, and never `Date.now()` or `new Date()`. `now`
  is always passed in (AR-02, AR-03).
- Journey and alert changes go through the transition function, and must match
  SM-01 to SM-10 in `docs/plan/05-architecture.md`.
- Every new transition or rule gets a test that names its ID, plus a
  property-based test where the rule is about time or ordering.
- This path needs the owner's approval before merge (CODEOWNERS).
