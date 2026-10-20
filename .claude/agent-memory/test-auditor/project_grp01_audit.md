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

**Loop 1 (delta 5880361..3fac8fb, HEAD 0ce82fa), PASS, 2026-10-20.** gate:integrity 5 of 5 (NODE_USE_ENV_PROXY=1); no PR,
check-runs 0, so RG-05 read from the fresh local reports (D-099, no incremental). Correction to the line above: the domain
report's L129 survivor is Stryker's mutant of the LEFT operand only (`caller === null` -> false, span 129:7-22), which is
equivalent (mayAdminister(null) is false and refuses); the whole-condition plant dies to 6 domain tests. Read each survivor's
span (location start-end), never just its start column: most "reason"/"type" StringLiteral survivors here were the
`type: 'refused'` discriminant, equivalent because api.ts tests `type === 'removed'/'started'` and reads `reason` only.
membership survivors: join.ts L76 `code === null` unreachable at L6 (contract INVITATION_CODE_PATTERN admits only strings
the normaliser accepts) and killed by join.test.ts (L2, outside the group: should-fix, group could run under
vitest.coverage.config.mjs, needs AC32 + merge-rules pin amended); invitations.ts `stage: 'store'` pinned by no test at any level.
Planted on a git-archive tree (ta-grp01/run-l1.mjs, m-l1*.mjs): AC21 closure/me opened -> killed; P4 join key, P17 20 s
(10/19/21/30 s, none) -> killed; D7/D7u ASCII filter -> killed; timingSafeEqual -> === killed; display-name N1-N4 killed;
Maestro pattern E1-E4 killed. RG-02 replay at b62ce4c: all loop-1 tests red on assertions (noise from no .git in the copy).
req-status was stale at 3fac8fb (PRIV-07 14 vs 15; CI traceability diffs it) and fixed by 0ce82fa during the audit.
