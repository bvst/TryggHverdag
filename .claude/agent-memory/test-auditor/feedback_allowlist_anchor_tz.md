---
name: allowlist-anchor-tz
description: Run-time allowlists (regex) need a refused value on each side of the anchor; UTC-vs-local date code survives in UTC CI
metadata:
  type: feedback
---

LOST-01 loop 1 (2026-10-03). Two fault classes that the authors' own tables missed and that Stryker either cannot see or does
not run on:
- **Regex allowlist anchors.** log.ts writes journeyId only if `/^…uuid…$/` matches. The test table had "UUID followed by a
  coordinate" (kills `$` removal) but nothing with text *before* the UUID, so dropping `^` survived. For any allowlist regex,
  plant `^` and `$` removal separately and look for a refused row on each side. Matters most in files outside the mutation
  scope (log.ts is an owner path but not a safety path, so Stryker never mutates it).
- **UTC vs local.** `getUTCFullYear()` -> `getFullYear()` survives whenever the run's TZ is UTC, which CI and the cloud session
  are. Run the same mutant with `TZ=Europe/Oslo` prefixed to the driver (env inherits into Vitest workers) to show the test can
  catch it at all; the fix is a pinned non-UTC TZ for that test, not a new case.
How to apply: when a diff adds a regex allowlist or a date-range check, add these two mutants to the batch by default.
Related: [[in-memory-mutation]], [[lost01-audit]]
