---
name: disarm-faults
description: For any per-operation timer/limit a fix adds, plant "never disarmed" and "armed per hand-out/session" - tests written from the hang only exercise the firing side and pass on a limit that kills healthy work
metadata:
  type: feedback
---
BUG-51 (2026-10-18): 328 tests passed with the query limit's clearTimeout removed (every connection ended 15 s after
any query) and with a second timer armed per pool hand-out (D-132 says "per query, never per hand-out"). Every
BUG-51 test starts from a database that never answers, so nothing ran a healthy query and then waited past the limit.
**Why:** red tests reproduce the bug's symptom; the fix's harm to the healthy path is nobody's red test, and
adapter files like db.ts sit in no mutation group, so no gate sees it.
**How to apply:** for a timeout/limit/watchdog added by a fix, plant: clear removed (each settle path separately:
promise, callback, sync throw), armed at the wrong scope (per hand-out, per session), and a sync throw before the
clear. Ask for a probe of the shape "answered in time, advance 2x the limit on fake timers, the same resource still
works". Blocking when the faulted form would hit every healthy operation and no gate covers the file.
Related: [[bug51-audit]], [[rejected-alternative]], [[load-proof-floors]]
Loop 1 lesson: a fix that splits settle paths (resolve vs reject handlers, callback wrapper) needs each side planted on
its own - the resolve side died, the reject side (F13b) survived. And check the test-kit fake can reach a path before
asking for a test of it (the fake throws on pg's Close after a bind failure).
