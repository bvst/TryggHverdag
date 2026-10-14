---
name: bug44-canary-wait-wiring-review
description: BUG-44 (two worker.test.ts tests pinning that startWorker hands createCanary CANARY_WAIT) — PASS d560734; residual wrong-length wait survives (loud); counting-timers technique
metadata:
  type: project
---

PASS at d560734 (2026-10-14), branch claude/busy-faraday-40n2zl. Test only (+155 in worker.test.ts), docs row to "In progress".

Verified by planting (scratch vitest config spreading vitest.config.mjs + enforce:'pre' transform replacing the anchor
`wait: CANARY_WAIT }` in worker.ts, MUTANT env):
- killed: signal-ignoring delay, no-timer never-resolving wait, Promise.resolve wait, delay(1), unref'd delay.
- survive: delay(50) (test 1's registration over the fake PG ends inside 50 ms; test 2 is microtask-only),
  delay(ms*10), and a wait that respects the signal only for ms === 600000 (contrived).
- without the two BUG-44 tests (-t '^(?!.*BUG-44)') the signal-ignoring mutant passes 192/192: the new tests are the kill.
Why the counts are not flaky: each pair of pendingTimers reads brackets either synchronous code or a microtask-only
chain (no timer/I/O phase can run). 15x under 6 busy loops on 4 CPUs, 3 whole-file runs under load, 4 shuffled seeds: green.

Residual judged acceptable (Note, no new bug): a wrong-length signal-respecting run limit is loud — too short makes
every run RUN_LIMIT, which reports failing and pages; too long leaves a hung run unreported, so staging-canary pages
after Period 15 + Grace 20 min. A cheap pin, if ever wanted: an async_hooks init hook reading the Timeout's
_idleTimeout (600000).

Technique: "counted, never timed" — compare process.getActiveResourcesInfo() 'Timeout' counts across a stretch that
is synchronous or microtask-only. Check every such claim by tracing the stretch for any I/O or timer await.
