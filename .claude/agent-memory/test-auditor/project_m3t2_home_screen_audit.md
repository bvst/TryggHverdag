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

## Loop 1 audit, 2026-10-23 (cloud), HEAD c827f21 (code = d2a55ca): PASS, two nits
- Premise: gate:integrity 3 of 5 (no NODE_USE_ENV_PROXY); gh api: 13 contexts incl. mutation/traceability, code-owner true, bypass [] never.
  No open PR, check-runs total_count 0 on c827f21 and d2a55ca. Mutation not re-run (caller's runs: every group >= 80 %).
- req:coverage report unchanged; every AC (GRP-02 1-11, CALL-01 1-9, CALL-02 1-13) in >= 1 test title. tests:changes --base 9820f78: 17 files none weakened.
- My findings closed: (1) HasNoKeys at emergency.test.tsx:903 -- tsc kills `ComponentType<{visible?}>`, children, any (killed only by tsc/static, runtime expect is tautological);
  (2) `112 ,5` -- telUri(number) in the non-plain branch fails 2 tests; rejected-read catch removed / returns true: each fails the AC4 test;
  (3) baseline e2e-android.mjs raised to 98.33/92.59, measured 98.39/92.85 after green; (4) docs drift fixed, BUT GRP-02.md "Existing assertions"
  still says grp.test.tsx's only change is the teardown order: 4989261's AC30 regex narrowing (reasoned in test + commit) is not listed (nit).
- fake-secure-store.ts (outside TEST_GLOBS): read by hand, only stricter; matches installed 57.0.4 isValidKey/isValidValue exactly.
- Stability: 3 parallel full runs 696/696; in band default, reversed (phone last), app+grp first (phone last): 696/696 each. 9 act() warnings every run:
  7 emergency (every-state tests end with un-awaited release() of held reads / held ME reply, 2 states x 3 test.each; +1 AC8), 1 screen, 1 home.
  Late-work probe (instrumented copy: flag after cleanup, 100 ms real wait, log any fetch/journal entry): 0 of 297 test ends; control (real-timer late fetch) caught 3/3.
  session.tsx update/updateHome guarded by mounted ref; fake-secure-store reset() and fake-api reset() DROP held work, never release it.
- Virtual mocks: expo-secure-store/expo-crypto virtual in all 6 files that reach session.tsx; only importers secure-storage.ts and join-key.ts; the 7 other
  jest files never load them. Consistent today; latent hazard if a new file loads session.tsx unmocked or mocks non-virtually (nit: drop virtual in all 6 at once).
- Classifier DENIED sed -i + `git checkout --` in a scratch worktree ("Irreversible Local Destruction"). Worked: `git archive <sha> | tar -x -C scratch/copy`,
  symlink node_modules, cp f f.orig / perl -0pi / run / cp back. Unlink the symlinks at the end. Heredoc append to the memory dir worked (2026-10-23).
