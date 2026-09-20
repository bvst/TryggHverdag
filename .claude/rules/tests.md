---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.test.mjs"
  - "apps/mobile/e2e/**"
  - "packages/test-kit/**"
---
# Test rules (Section 6)
- Every test name starts with the requirement ID and acceptance criterion,
  e.g. `LOST-02-AC1: alerts every responder after 5 minutes of silence`.
- Use the fake clock and the test-kit builders. Never use real personal data
  (RG-07).
- Never add `.skip` or `.only`, remove assertions, or delete tests without a
  written reason in the pull request (RG-03). Hooks and `test-auditor` check
  this.
- A test that only *quotes* requirement IDs as sample data — the tests of the
  gates themselves do — starts with the line
  `// req-coverage: fixtures-only`, so `pnpm run req:coverage` never counts
  sample data as coverage (RG-01).
