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

**Loop 2 (delta 3fac8fb..879096f), PASS, 2026-10-20.** gate:integrity 5 of 5 (NODE_USE_ENV_PROXY=1), 13 required incl.
mutation/traceability; no PR for the branch, check-runs total_count 0, so RG-05 read from local reports (19:46-20:02, after the
revert): membership join.ts 83.3 % (L76 guard + strings), members.ts 85.7 %, invitations.ts 89.7 % (56:56-63 = stage store,
the S2 mutant, still survives the run; pinned at L2 in join.test.ts). S1 (join.test.ts in the group) tried in 1594939 and
withdrawn: a group config is a mutation input, so BUG-14 tests demand it in ai-review.yml (D-075) and safety-reviewer.md
(the owner). Judged acceptable: file >= 80 %, guard unreachable at L6, deferral recorded in the spec api.ts BUG (still no ID).
Verified byte-identity: git diff 639fc12 879096f on the 3 pin tests empty; gate-decisions.mjs unchanged vs 3fac8fb.
RG-02 replay (git archive 1e8ce72 + node_modules symlinks, jest -t 'review loop 2'): 8 red on assertions, 4 other-4xx green.
Plants: any-404-done kills the 404 rows; 400/422 to unreachable kills those rows; invitations.ts stage empty, swallow to refused,
constant SQLSTATE, no log line: all die; main.tf random_string / bare random_integer / indented random_id: die; random_password
passes (sensitive, out of scope). Symlinked node_modules work for both jest-expo and vitest (faster than cp -a).

**D-139 follow-up (nine sign-in files get a code owner; red 2b1d04e, green 0fe7547), PASS, 2026-10-21.** Base = origin/main f3e682c.
gate:integrity 5 of 5 (NODE_USE_ENV_PROXY=1), 13 required incl. mutation/traceability. Branch name reused (PRs #22..#97 all
closed, none for 0fe7547); check-runs total_count 0. decideMutation({changed,...}) = skip (scripts/, .github/ not safety paths).
RG-02 replay (git worktree at 2b1d04e + node_modules symlink, vitest --reporter=json): 6 failed/251 passed, as the commit says;
HEAD 257/257. The 7th GRP-01 test (not in the safety filter) is a guard, green at red by design. RG-03: safety-filter test's
exception pin = [...D102_FILES, ...D139_APPS_FILES] toEqual 8 literals; 25 safety /apps/ entries = 33 owner /apps/ paths - 8.
Probes (scratchpad/harness/probe.mjs, edit/run/restore): later ownerless dir, *.tsx, other-owner dir, misspelt CODEOWNERS line,
misspelt in all 4 lists (ls-files catches), filter glob/name for one of the seven, dropping api.ts/app.config.ts/groups.ts from
the filter, dropping package.json from OWNER_APPROVAL_PATHS, single owner, later ownerless duplicate line, widening D139_FILES,
ownerless /packages/contracts/src/: all 15 caught. Note: D139_FILES is duplicated in gate.test.mjs and merge-rules.test.mjs with
nothing holding them equal (gate.test's /apps/ part is pinned via the exceptions literal). req:coverage unchanged: gate.test.mjs
is fixtures-only and merge-rules.test.mjs already named GRP-01 on main (GRP-01-AC32), so no count moves; SEC-01 stays at 0.
`apps/mobile/src/**/*.tsx` sits in the ui filter, not safety: grep -A40 from "safety:" runs into it, read the block boundaries.

**D-139 amendment (join-key.ts + redact.ts; red aee541f, green 93047f8), PASS, 2026-10-21.** Base origin/main f3e682c. RG-02 replay
(git worktree at aee541f + node_modules symlink, vitest on gate/merge-rules/gate-integrity tests): 6 failed/284 passed; HEAD 290/290.
The new N9 test (merge-rules.test.mjs regex-reads gate.test.mjs's D139_FILES literal, compares sorted both ways) is green at red by
design (an equality guard between two test files). Probes: path dropped from either copy (apps and contracts paths) -> caught;
reorder -> passes (not order-brittle); comment line inside the literal -> fails loudly (documented: one quoted path per line;
prettier singleQuote+trailingComma keeps the shape). Exceptions pin exact at 10; 35 /apps/ owner paths - 10 = 25 still required.
Later single-owner glob over join-key.ts and misspelt redact CODEOWNERS line -> caught. tests:changes 2 files none weakened;
req:coverage unchanged; decideMutation skip (only-if-safety mode).
