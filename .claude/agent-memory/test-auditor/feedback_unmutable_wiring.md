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
REL-10 AC9 follow-up (2026-10-10): the canary's wait handover `wait: CANARY_WAIT` (worker.ts:454) is the same kind: swapping it for a wait that ignores its signal survives worker.test.ts 190/190 and L3. Tests of an exported constant do not pin that the caller hands it over.
