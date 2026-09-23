---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.test.mjs"
  - "apps/mobile/e2e/**"
  - "packages/test-kit/**"
---
# Test rules (Section 6)
- A test that proves a requirement starts its name with that requirement's ID
  and acceptance criterion, e.g.
  `LOST-02-AC1: alerts every responder after 5 minutes of silence`.
- **Gate and tooling tests under `scripts/` are exempt from that naming rule**,
  and describe the behaviour they hold instead. They prove the machinery works,
  not that a requirement is met, and the IDs they would carry — `CI-01` and the
  like — are not in `collectRequirements`'s `SOURCES`, so `req:coverage` never
  counts them. Prefixing them would produce the look of traceability over a
  number that does not move: the exact shape of decorative check this
  repository keeps having to dig out. Two reviewers raised the inconsistency
  independently; the owner scoped the rule rather than rename the tests
  (D-074).
- Use the fake clock and the test-kit builders. Never use real personal data
  (RG-07).
- Never add `.skip` or `.only`, remove assertions, or delete tests without a
  written reason in the pull request (RG-03). Hooks and `test-auditor` check
  this.
- A test that only *quotes* requirement IDs as sample data — the tests of the
  gates themselves do — starts with the line
  `// req-coverage: fixtures-only`, so `pnpm run req:coverage` never counts
  sample data as coverage (RG-01).
