---
name: lost07-review
description: LOST-07 review (2026-10-07) — a request field one side ignores, a departure forced by an exact-set test, two monitoring URLs that must differ, hand-added baselines, sqlstateOf and Node error codes
metadata:
  type: project
---

- **A port field one side ignores.** When an adapter asks the domain rule under the lock, a threshold in the request (`afterMs`) is easily left unused there while the fake decides by it. Grep each request field's uses in both the adapter and the fake.
- **A departure forced by an exact-set test.** An existing test's exact set of log events (`toEqual(new Set([...]))`) can force a design departure that the code then justifies with another reason. Check whether a departure's stated reason is the real one.
- **Two monitoring URLs from two secrets.** Look for a guard that they differ; one green ping can mask the other check. Terraform 1.16.4 accepts `var.a != var.b` in a validation (verified).
- **Hand-added baseline entries.** Compare them with `coverage/coverage-summary.json` from a run after the commit; LOST-07's `escalation.ts` entry was lower than measured, and below the 95 % floor.
- **`sqlstateOf` and Node error codes.** Its pattern accepts 5-letter Node codes (`EPIPE`, `EPERM`, `EBADF`), so a network error passed through it can be logged as a SQLSTATE.
