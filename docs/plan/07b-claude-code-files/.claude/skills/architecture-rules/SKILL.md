---
name: architecture-rules
description: "Architecture rules AR-01 to AR-12, repository layout and where code goes. Use when designing or reviewing any code change."
---

# architecture-rules

Read `docs/plan/05-architecture.md` (design principles, layout, state machine, library set) and `docs/plan/decisions.md` D-030 to D-033. Checklist: pure domain with no I/O and no clock reads · adapters behind interfaces, with fakes in the test kit · state machine transitions only · outbox written in the same transaction · lock-safe, idempotent watchdog · shared contracts · import boundaries · privacy by construction.
