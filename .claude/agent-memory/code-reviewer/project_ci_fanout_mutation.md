---
name: CI fan-out (BUG-45 mutation plan/group/aggregate)
description: review angles for scripts/mutation.mjs --plan/--group/--aggregate and the ci.yml fan-out
type: project
---
- Verdict file carries a `message` the aggregator never reads: check producer fields against consumers.
- Boilerplate CI-12 comment is copied into 6 jobs; edits touch all 6 (churn). Prefer deleting the new sentence.
- `${{ matrix.group }}` is used inside `run:`; names come from code in the PR, so keep them out of shell via env if names ever stop being fixed.
- Aggregator trusts the plan's `skip`; it re-derives groups but not the diff decision.
- gate:integrity locally: 3 of 5 only (no API token); workflow checks still run offline.
