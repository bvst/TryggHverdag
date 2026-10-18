---
name: test-only-l6-review
description: BUG-28 PASS (7a58b33) - quick checklist for a test-only L6 change; how to run one L6 file; doc lines that restate an open PRIV-08 item
metadata:
  type: reference
---

**BUG-28 (2026-10-18), PASS.** Three L6 tests in alerts.system.test.ts for the watchdog's waiting loop. A five-minute review:
- Log shape: compare the asserted event with `ports.ts` (the LogEvent union) and `log.ts` (the adapter case). `watchdog_overdue` is `{ journeyId }` only, and the adapter passes it through `uuidOf`. The suite's marker test (line ~1441) already covers that event, so nothing new reaches logs.
- RG-07: `world()` makes IDs with `store.addUser()` / `fakeDeviceAuthenticator`; `overdue()` seeds no position. Grep the added lines for 8-digit numbers, `+47`, lat/lon and `@`.
- **Running one L6 file:** run it from the repository root, `npx vitest run --config vitest.system.config.mjs apps/server/src/<f>.system.test.ts -t <ID>`. From apps/server the include glob matches nothing ("No test files found"). `gate:file` has the same gap (BUG-52).
- `git diff origin/main...HEAD` on the session branch also carries the previous task's merge record (here BUG-34's m2.md entry). Read it too: it said the staging DB link is "without TLS". That is a known open item (D-08x "Encryption in transit to PostgreSQL", PRIV-08, staging synthetic only), so it is a Note, not a finding.
