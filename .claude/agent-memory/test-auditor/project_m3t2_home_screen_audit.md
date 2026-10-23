---
name: m3t2-home-screen-audit
description: M3 task 2 (GRP-02, CALL-01, CALL-02 home screen) at cff3021, PASS; phone.ts probes, the narrow @ts-expect-error survivor, the StatusBar teardown hang, decideMutation 'run' via test-kit
metadata:
  type: project
---
Audited 2026-10-23 (cloud), branch claude/busy-faraday-40n2zl, HEAD cff3021, main 50214c0. PASS, three should-fixes.
- Premise: gate:integrity 3 of 5 (brief forbids NODE_USE_ENV_PROXY); gh api: 13 contexts incl. mutation/traceability, code-owner true.
  Branch pushed, NO open PR (#100 closed), check-runs total_count 0, so ran the cheap gates and targeted jest myself.
- req:coverage --fail-on-uncovered-changed exit 0, report unchanged; every AC of GRP-02 1-10, CALL-01 1-9, CALL-02 1-13 is in >=1 test title.
- tests:changes 31 files none weakened. Removed lines only in grp.test.tsx (describe afterEach useRealTimers moved to file afterEach),
  lib/e2e-android.test.mjs (INF-06-AC9 "folder on argv" -> flowsRunBy(argv) toEqual unscripted list: stronger), e2e-android.test.mjs
  (cpSync filter drops scripted flows unless copyFlows:'all'; scripted phase covered by APP_FLOWS tests; real-folder "none absent" pinned at lib 3305).
- Teardown proof: main's grp.test.tsx on HEAD code HANGS (>600 s, terminated, no per-test timeout fires); HEAD 103/103.
- RG-02 replay at ebf2faf (worktree + node_modules symlinks, jest --json): 494 failed / 151 passed, 0 suite errors; failures = missing module,
  assertion, or the tests' own descriptive throws. New-suite passes at red are guards/existing keys only.
- RG-04: baseline untouched vs main. Measured: app.config.ts, src/app/_layout.tsx, index.tsx 100/100; lib/e2e-android.mjs 98.33/92.59
  (baseline 95.16/85.71: gain not locked, note).
- decideMutation = RUN (not skip): new packages/test-kit/src/* files are mutation inputs (D-098). All 14 are added files, none imported
  by apps/server, safety-core or test-kit index, so the score cannot move. No SAFETY_PATHS added (D-141: features/call not mutated yet).
- Probes phone.ts (phone.test.tsx, 200 tests, ~10 s): reduction loop off/one pass/+47 only, ACTION_CALL URI raw, emergency dial from plain,
  911/999/08 removed, prefix check off, PLAIN unanchored, catch->throw, no percent-encode, + anywhere: all killed.
  SURVIVE: line 154 non-plain dialer telUri(number) (NOT_PLAIN cases have no separators) -> should-fix; openDialer uncleaned (only
  caller passes '112', equivalent); `length >` dropped (prefixes all in EMERGENCY, equivalent); skip permission read (mock rejects
  ACTION_CALL without permission, spec allows "after ACTION_CALL is refused", equivalent).
- EmergencyBar typed test: @ts-expect-error on `<Bar hidden />` is satisfied by ANY props type lacking `hidden`.
  `ComponentType<{ visible?: boolean }>` with `if (!visible) return null` passes tsc and 106 tests -> should-fix
  (assert keyof ComponentProps is never). Backstops: AC1 renders every route/state, Screen has no prop.
- Route/Screen probes (screen.test.tsx, 13 tests): index without Screen, Screen without bar, bar inside ScrollView, overlay in layout,
  overflow visible, NEW nested route src/app/later/probe.tsx without Screen: all killed.
- RG-07: Norwegian-shaped L5 fixtures (90374815 etc.) are invented, NOT in a fiction range; only EMULATOR_FIRST_CONTACT (+44 7700 900318)
  reaches scripts/e2e. Brief's "fixtures in Ofcom's range" is true only for the L7 one.
- The branch moved to 0581abe mid-audit (other reviewers' memory notes only).
Related: [[call01-step1-audit]], [[gate-integrity-local]], [[shared-scratchpad-worktree]]
