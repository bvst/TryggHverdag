---
name: grp01-review
description: GRP-01 sign-in and groups review 2026-10-20, PASS at a5fd8cf; membership-as-session design facts, AC13 lock reasoning, AC25 withheld check-in, L6 mutant probes; should-fixes are hand-offs (app 401 vs WALKER_ONLY, task-6 push to walker-only device), runbook, mutation-group gaps
metadata:
  type: project
---

## Round 1: 60b46ee...a5fd8cf, PASS
Design: authenticate = devices LEFT JOIN memberships LEFT JOIN journeys(device_id = device, unended) -> FULL
(member or CANARY_DEVICE_ID) | WALKER_ONLY (removed member's own unended journey) | null. api.ts fromKnownDevice =
FULL only; fromWalkingDevice (any) only on recordHeartbeat + reportHome. eligibleResponders = mayName(): members of
walker's group minus walker; canary walker -> {CANARY_RESPONDER_ID} only; non-member walker -> none. insertStarted
re-asks under memberships FOR SHARE (walker + named) -> {inserted:false, refused:'INVALID_RESPONDER'}.
adapters/groups.ts removeMember: one tx, lock_timeout 5 s, caller memberOf (no lock) -> member FOR UPDATE -> domain
decideMemberRemoval -> delete membership -> read unended journeys followed (AFTER the lock, new snapshot) -> SM-10
removeInside per journey in ID order (exported from adapters/journeys.ts) -> MEMBER_REMOVED audit. 55P03 or any throw
rolls all back, member_removal_failed line, 500. removal.ts walker check: journey.walkerId !== caller -> JOURNEY_NOT_FOUND,
no line. worker.ts AC25: check-in only if worker URL usable AND SMS check reports (own UUID); else withheld line ->
staging-worker pages (Period 1 + Grace 2 min). Closes my SM-10 loop-1 should-fix (start line alone not enough).
Lock reasoning (READ COMMITTED): removal first -> start's FOR SHARE on the deleted row returns nothing -> refused;
start first -> removal waits, its journeys read is a new statement and sees the start's journey. No cycle: start holds
membership rows only before writing new rows; watchdog/ack/heartbeat take journey rows only; removals take journeys
in ID order. Admin removal holds earlier journeys' rows while waiting (5 s each) for later ones: watchdog skips them.
Verified myself: L6 groups/removal/journeys/canary/alerts/escalation system 580/580; L2 worker, domain, device-
credentials, groups adapter unit, fakes, api-process 1019/1019. L3 NOT run: /tmp/claude-0 is 0700 again (initdb as
postgres: Permission denied), no implementer PG on 55432. Mutants planted (scratch config + enforce:'pre' transform,
scratchpad/grp01/): walker check -> if(false) and api FULL gate -> ()=>true both SURVIVE journeys group's 3 tests,
killed by groups.system (AC23 x3, AC21). AC25 check-in always -> killed by worker.test (8 tests).
Should-fix given: (1) app signs out on ANY 401 but /v1/me is FULL-only, so a removed walker's app restart deletes the
credential mid-walk (heartbeats stop, no "I'm home"): hand-off to task 3 / safety-core missing from spec. (2) spec's
task-6 line "a removed member's device gets nothing" contradicts D-136 a5: NO_RESPONDER to a walking removed member
must reach the WALKER_ONLY device. (3) monitoring-setup.md has no "When staging-worker pages you" naming the withheld
line (/v1/health stays green meanwhile; HC "new" checks never page). (4) modules/groups/ in no SAFETY_PATHS/group
despite settled spec; add groups.system.test.ts to journeys group (walker-check survivor).
Notes: authenticate's journeys join has no device_id index (seq scan per request; join on walker_id to use the partial
unique index); affected.mjs skips android-e2e on server-only changes; FakeDeviceAuthenticator defaults FULL with no
membership (real refuses) -- simple stand-in, membership-aware auth is the fake journey store's.
Related: [[sm10-removal-review]], [[rel10-canary-review]], [[reviewer-sandbox-limits]].
