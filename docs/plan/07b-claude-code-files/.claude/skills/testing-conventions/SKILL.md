---
name: testing-conventions
description: "Test levels L1–L10, naming with requirement IDs, fakes, fake clock, property-based and container tests, and regression gates RG-01 to RG-08."
---

# testing-conventions

Read `docs/plan/06-testing-strategy.md`. Checklist: name tests `<ID>-ACn: …` · use the lowest level that can catch the failure · fake clock for anything time-based · fast-check for time and ordering rules · Testcontainers for SQL, locking and outbox · L6 for every alert behaviour · never weaken a test.
