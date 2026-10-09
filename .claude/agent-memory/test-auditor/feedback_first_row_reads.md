---
name: first-row-reads
description: An adapter read that takes [first] of a filtered select (the journey's one unresolved alert) needs a seed with a second, filtered-out row first; one-alert fixtures let a dropped filter survive
metadata:
  type: feedback
---
SM-10 (2026-10-09): removeInside reads `const [unresolvedAlert] = select ... where journey_id = X and state <> 'RESOLVED'`. Dropping the
state filter survived every L3 test, because every fixture had one alert per journey. In production a journey that came back in contact and
went silent again has two alerts; [first] is the RESOLVED one, the rule answers unchanged, and the reset silently never happens.
**Why:** "one X per Y" invariants (a partial unique index) make the filter look redundant to fixtures, and adapters are not mutated (D-095).
**How to apply:** for every `[first]`/`limit 1`/`.find(...)` read keyed by a parent ID plus a state filter, plant the filter's removal in the
adapter AND the fake, and check a fixture puts a filtered-out sibling row in first (seeded earlier, so heap order returns it first).
The fake's twin can die for an unrelated reason (its own copy of the rule): judge each side by its own kill.
Related: [[sm10-audit]], [[equal-seed-columns]], [[isolating-values]]
