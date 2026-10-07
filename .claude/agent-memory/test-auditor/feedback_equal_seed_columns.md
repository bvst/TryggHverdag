---
name: equal-seed-columns
description: A shared behaviour that seeds two time columns equal (created_at == next_attempt_at) cannot pin which one the adapter reads; plant a column swap on every time filter
metadata:
  type: feedback
---
LOST-07 (2026-10-07): unsentSmsCount must count SMS "written 60 s ago" (created_at). Shared behaviour 10's seed helper set
createdAt and nextAttemptAt to the same moment, so an adapter counting by next_attempt_at survived every L3 test and the fake's twin
survived L2; only L6 (fake) caught it. In production a retried row's next_attempt_at stays <= 60 s ahead, so the page would never fire.

**Why:** D-095 leaves adapters out of mutation; the shared suite is their only proof, and equal seeds make two columns one.
**How to apply:** for every time-filtered read (counts, claims, holds), plant a swap to each sibling time column in the adapter and the
fake, and check the seeds give those columns different values in a state the code really produces (a retried, a leased row).
Related: [[lost07-audit]], [[second-path-isolation]], [[time-equality-kills]]
