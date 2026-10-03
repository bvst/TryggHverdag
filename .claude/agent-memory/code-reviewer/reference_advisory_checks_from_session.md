---
name: advisory-checks-from-session
description: BUG-15 review (2026-10-03) — how to read an audit advisory from a session, what pnpm why --prod means in apps/mobile, and how to check an allowlist pin
metadata:
  type: reference
---

Saved by the orchestrating session from code-reviewer's report (the role has no write tool).

- **Advisory facts from a session:** `gh api /advisories/<GHSA>`, the github.com/advisories pages and api.osv.dev are blocked. `curl -X POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk -d '{"<pkg>":["<ver>"]}'` works and returns exactly what `pnpm audit` reads (severity, range, CWE, CVSS 3.1). `pnpm audit --json` leaves ignored advisories out (`muted: []`). (WebFetch of the github.com advisory page worked for the orchestrating session on 2026-10-03; it gave the CVSS 4.0 score.)
- **`pnpm why <pkg> --prod` (pnpm 10)** prints an inverted tree, dependents beneath. In `apps/mobile`, `--prod` includes jest (through react-native's `@react-native/jest-preset` peer) and Metro's `metro-file-map`, so `--prod` does not mean runtime. Check "runtime package X doesn't reach Y" claims against that tree. The app's routes are in `apps/mobile/src/app`; there is no `apps/mobile/app`.
- **Allowlist pins:** when a comment says a pin "fails until a premise test exists", check what the assertion actually compares — usually just a map.
- **Advisory exceptions (D-093, D-104)** are parallel blocks by design; recommend generalising at the third, not before.
