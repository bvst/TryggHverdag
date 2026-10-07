---
name: time-equality-kills
description: Database-clock and one-transaction faults are often killed only incidentally by a millisecond-floor equality between two now() readings; check which test kills them and ask for µs text or xmin equality
metadata:
  type: feedback
---
LOST-06 (2026-10-07): acknowledged_at from the app clock (new Date()), statement_timestamp() or clock_timestamp(), and the notices
inserted through `db` instead of `tx` (AR-05), all survived the tests written for them: AC9's "between two select now() readings"
(the app and the database share one host clock) and AC11's trigger that fails the second notice (a failing multi-row insert rolls back
as one statement, so outside-the-tx looks identical). They died only because the shared AC2 behaviour compares acknowledged_at with
the notices' times after flooring to ms, and three round-trips took 2-10 ms on the stand-in.

**Why:** a kill that depends on statement latency is not a test of the property; a fast CI runner can land both in one ms.
**How to apply:** for any "database time" or "one transaction" claim, plant new Date(), statement_timestamp(), clock_timestamp() and
db-for-tx on the write, and read which test kills them. If only a ms-floor equality does, ask for `::text` (µs) equality between values
the same transaction's now() wrote, and `xmin` equality between the rows that must share a transaction (or a deferred constraint
trigger that fails at commit). Report it as should-fix unless a run shows it surviving.
Related: [[lost06-audit]], [[rollback-and-hangs]]
