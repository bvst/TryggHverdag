---
name: grp01-audit
description: GRP-01 (join by invitation, membership as session, admin removal, walker's responder removal) test audit, BLOCK at a762276 (tests 5880361): modules/groups/ unmutated and the journeys group's tests omit groups.system.test.ts; closeAlert open to WALKER_ONLY unpinned
metadata:
  type: project
---
Audited 2026-10-20 (cloud). Red a6c815d (tests + signature-only stubs), green 8cd7704/0ce3eb1/a5fd8cf, coverage tests 5880361,
HEAD a762276 (report regenerated; matches req:coverage computed for HEAD). gate:integrity 5 of 5 (NODE_USE_ENV_PROXY=1).
No open PR (all PRs from this branch name are closed, earlier tasks), check-runs 0.
- RG-01: all 30 ACs named in test titles. RG-02 replay in a `git archive a6c815d` tree (node_modules dirs `cp -a`'d per
  workspace package so @trygghverdag/* resolve inside the copy): unit 104 red/57 green, system 58/0, L3 50/13, jest 50/0.
  The 57 green are test-kit fakes' own suites (implemented in red by design), guards for unchanged behaviour, stub
  constants. Every AC has a red test; AC4/AC15/AC20 only at L3, AC26-30 only in jest (red at the first nb.json lookup).
- RG-03: tests:changes 56 files none weakened; by hand all fine. Slight loosening (note): contracts alerts/home pins hold
  method+path and the 6 old keys, not the new keys' names. Shared suite: 24 removed lines all accounted.
- BLOCK: modules/groups/ not in SAFETY_PATHS/MUTATION_GROUPS (spec Mutation section requires it; also no 95% floor).
  Implementer's reports/mutation/journeys.json: removal.ts 5 survivors = the walker check; service.ts 7 = AC13 refusal;
  my R1/R2/S1 survive journeys+contact+removal.system, die to groups.system.test.ts. Domain report listed
  `caller === null || !mayAdminister(caller)`->false as Survived; my plant was killed 6x: local report partly stale.
- Should fix: closeAlert via WALKER_ONLY (Z11) survives groups.system, all 828 system tests and L3; AC21's route list is
  hand-written (probe adding closure passes HEAD, kills Z11). App: join key reuse unpinned (P4; probe seeding
  mockSecureItems joinKey kills it); 20 s answer limit unpinned (P17); domain ASCII filter unpinned (D7; probe with
  ı / ſ kills it).
- ~95 faults: harness scratchpad/ta-grp01/run.mjs (tree copy t-head, edit file, spawn vitest/jest with --reporter=json,
  restore in finally) + m-server/m-extra/m-rest/m-app/m-probe*.mjs. Equivalent: G3, G4; G5 only unbounds the
  membership-row wait (removeInside sets its own lock_timeout).
Related: [[narrowed-mutation-group]], [[shared-suite-rg03-blind]], [[in-memory-mutation]], [[bug51-audit]]
