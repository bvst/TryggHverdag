---
paths:
  - "apps/mobile/src/safety-core/**"
---
# Safety core rules (AR-09)
- The UI talks to the safety core only through `safety-core/index.ts`. Nothing
  else may import the location SDK.
- Every failure path must be visible to the walker (fail loudly): missing
  permission, offline, service stopped (GRP-03, LOST-05, REL-04, REL-05).
- The SDK sits behind an adapter with a fake in `packages/test-kit`.
- Read the `platform-notes` skill before changing background behaviour.
- This path needs the owner's approval before merge (CODEOWNERS).
