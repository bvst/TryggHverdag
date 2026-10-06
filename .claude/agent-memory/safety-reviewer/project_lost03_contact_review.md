---
name: lost03-contact-review
description: LOST-03 review 2026-10-06 (PASS 3471859, code = 6add162) — back in contact, "I'm home", withdrawal + hold; should-fix: an earlier alert's stand-down can reach the port after a newer alert's LOST_CONTACT (verified in-process); notes: worker mark waits on API withdrawal, deploy overlap, home rule decided twice
metadata:
  type: project
---

Reviewed origin/main(5cd5d24)...3471859 on claude/busy-faraday-40n2zl. PASS. Code unchanged since 6add162
(73c2d74, 3471859 touch docs/requirements-status.md only). No PR open, no check runs on the head yet.

Verified myself:
- L6: contact/journeys/alerts/api system tests 323/323; domain, log, http, test-kit, contracts, gate-decisions 735/735.
- L3 on the PG16 stand-in (127.0.0.1:55432) with the implementer's scratch shim
  (scratchpad/l3/vitest.l3.config.mjs aliases @testcontainers/postgresql): contact, adapters/journeys, alerts,
  deploy integration 185/185. CI's PG15 run not yet happened.
- Mutation reports in reports/mutation/*.json: source == HEAD; journey.ts 134/135 (:272 throw text),
  service.ts 121/122 (:130 pre-existing literal), watchdog 87/87, outbox 37/38, 0 timeout kills.
- Contact rule '<' vs silence '>=' at LOST_CONTACT_AFTER_MS: consistent at the boundary. now() is transaction
  START (before the 5 s row wait): resolved_at can precede opened_at by microseconds; harmless.
- Withdrawal CTE + stand-down insert one statement; EPQ re-check after a claim/mark (L3 AC7 with pg_stat_activity).
  Claim's due CTE skip-locks an uncommitted withdrawal; FIND_LAST_VERSION + EPQ excludes a committed one.
- Hold bound: max(CLAIM_LEASE_MS 30 s, retry cap 60 s) pinned in domain/watchdog.test.ts.
- No code takes FOR UPDATE on users; stand-down FK key-share does not conflict.
- API + worker are ONE Clever Cloud app (CC_WORKER_COMMAND in infra/staging/main.tf).

Findings given (check before repeating):
1. Should fix: cross-alert overtaking. Stand-downs are never withdrawn when a NEW alert opens on the same journey.
   Probe (in-process, real API/module/watchdog/sender, fakePush.failFor(r,'UNAVAILABLE') across resolve -> 7 min
   silence -> A2 opens -> recover): port accepted ["LOST_CONTACT"(A2), "BACK_IN_CONTACT"(A1)] while J LOST_CONTACT.
   Not live until M3 configures push. Fix: openInside withdraws the journey's unsent earlier stand-downs (AR-05),
   L6 test of the probe; or record as must-close-before-push in spec Left-for-later + progress/m2.md.
   "Claim alerts before stand-downs" (M3 idea) would make this order certain.
   With a healthy provider + slow API (4:59 resolve) the order stayed right (hold not engaged).
2. Note: worker's markSent/markFailed (worker pool has NO lock_timeout) now waits on the API's withdrawal row lock;
   bounded by API idle 10 s / lock 5 s; delivery loop only. Spec item 8 / adapter header don't say it.
3. Note: deploy overlap: old worker's claim lacks withdrawn_at filter -> can send a withdrawn LOST_CONTACT (safe dir).
4. Note: home's resolvesAlert decided by domain on the unlocked read, but the adapter hardcodes
   from === 'LOST_CONTACT' under the lock (L3-only, adapter not mutated). Contact asks the domain under the lock.
5. Note: contact.system.test.ts (a mutation group test) unowned, like its siblings (BUG-14 open item).
6. Note: 05-architecture.md row "LOST_CONTACT | Heartbeat | ACTIVE" now fresh-only (D-112), table not annotated.
Related: [[lost02-alert-review]], [[reviewer-sandbox-limits]].
