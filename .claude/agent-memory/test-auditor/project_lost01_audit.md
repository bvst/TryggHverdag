---
name: lost01-audit
description: LOST-01 heartbeat test audit (PASS at 7ddcd72, code ff583fb): RG-02 replay matched 96+1/129 red; 59 in-memory faults (log, api, service, adapter on a PG16 stand-in, fake, gate, L1 types), 57 killed, 2 survivors graded Note; Notes only
metadata:
  type: project
---

Audited 2026-10-03 (cloud session), branch claude/busy-faraday-40n2zl. Tests d21afbd == HEAD's; code 01de08b; HEAD moved to
7ddcd72 during the audit (agent memory only). PASS.

- RG-02 replay (tests at HEAD, production files at d4f643a, via Vite load hook; openapi.json and CODEOWNERS via the
  readFileSync override): unit 96 tests + log.test.ts file error, system 129, each on the missing route (404), missing
  exports, the start rule answering a heartbeat, or the fake refusing a deviceless start (the 15 SM-01 L6 starts). Passing
  at base, by design: the fake's own behaviour-suite tests (test-author's code), two AC17 self-checks, the D-102 "not in the
  filter" pin. L3 not replayed: drizzle reads the migrations folder from disk, which a Vite hook cannot swap.
- Faults KILLED: log.ts L1-L6 (pino.destination(1), writer bound at creation, SQLSTATE regex loosened, code passed
  through, stderr); api.ts A1-A7 (fixed-400 encoder removed or keeping data, deviceId from userId, DUPLICATE as RECORDED,
  every refusal 404, ended as 200, start without device); service S1-S5, S7, S8 (console.error / stderr of the error,
  eventId in the log line, clock read after journey read, phone time as receive time, race-ended path without the line);
  adapter J1-J13 on a PG16 stand-in (cause kept, raw error, message or detail leaked, SQLSTATE not walked, no
  transaction, greatest() removed, for update removed (killed only by api-process's fake PG), ENDED unchecked, dup as
  recorded, latest ordering, deviceId from walkerId, dup advancing contact); fake F1-F9 (more lenient than PG, killed by
  the shared behaviour suite); gate G1-G8 (D-102 exception cannot grow: a second unfiltered /apps/ owner path is killed);
  ports.ts LogEvent widened six ways (tsc in memory: TS2578 unused @ts-expect-error in log.test.ts).
- SURVIVED (Notes): service.ts codeOf `?.` (a stage rejecting with null/undefined loses its heartbeat_failed line, API
  still 500); a deferred `setTimeout(console.error)` escapes captured(), which closes when the request resolves.
- RG-05: no PR, check-runs total_count 0. reports/mutation/*.json sources equal HEAD byte for byte; journey.ts 72/73,
  service.ts 66/68, api-process 8/8. gate:integrity 3/5 locally; gh api showed the 13 contexts, bypass_actors [].
- RG-04: coverage-baseline.json untouched since INF-10 (c24d725): no M2 file is ratcheted; domain/ and
  modules/journeys/ have the 95 % floor, log.ts and contracts/heartbeats.ts have neither.
Related: [[in-memory-mutation]], [[bug14-audit]], [[baseline-vs-main]]
