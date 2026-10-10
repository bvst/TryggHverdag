---
name: unmutable-wiring
description: Wiring Stryker cannot mutate — process.env replaced by {} in bin/*.ts, a hash of the wrong value — needs planted faults; check start-line patterns cannot also match a degraded line
metadata:
  type: feedback
---

REL-10 audit (2026-10-10). Two wiring faults no Stryker mutator makes survived every test: bin/worker.ts
reading its settings from `{}` (B1), and the worker hashing the API URL instead of the credential (W3).
B1 survived because bin.test.ts's pattern for the healthy start line also matched the half-configured
one. Plant both kinds by hand, and check each start-line pattern against the degraded lines too.
