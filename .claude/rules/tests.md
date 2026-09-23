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
- **A test that proves no tracked requirement is exempt from that naming rule**
  and describes the behaviour it holds instead — gate, hook and tooling tests,
  wherever they live. Today that is `scripts/` and `.claude/hooks/`, and also
  `packages/config/eslint/index.test.mjs`, but the exemption is keyed to what
  the test proves, not to a directory: a tooling test in a new place should not
  need this rule amended again. **Tracked** means `req:coverage` counts the ID:
  its prefix is one `collectRequirements` collects, which is narrower than its
  document being listed in `SOURCES`. `AR-` is the case that shows the
  difference — it lives in `docs/plan/05-architecture.md`, which *is* a source,
  but that entry collects `prefixes: ['SM']` only. `CI-`, `HK-` and `AR-` are
  all untracked; `docs/requirements-status.md` is the check, and none of them
  appear in it. Requiring a prefix here produces the look
  of traceability over a number that does not move: the exact shape of
  decorative check this repository keeps having to dig out (D-074).
- The hook tests already carry `HK-01`-style prefixes and **should keep them**.
  Exempt is not forbidden: `HK-01` names a real hook requirement in
  `docs/plan/07-claude-code-setup.md` and makes the test findable. What the
  exemption removes is the *obligation*, and with it the implication that a
  prefix creates coverage — it does not. `mentions()` counts an ID anywhere in
  a test file's text, never in the test name, so no prefix has ever moved
  `req:coverage` by itself.
- Use the fake clock and the test-kit builders. Never use real personal data
  (RG-07).
- Never add `.skip` or `.only`, remove assertions, or delete tests without a
  written reason in the pull request (RG-03). Hooks and `test-auditor` check
  this.
- A test that only *quotes* requirement IDs as sample data — the tests of the
  gates themselves do — starts with the line
  `// req-coverage: fixtures-only`, so `pnpm run req:coverage` never counts
  sample data as coverage (RG-01).
