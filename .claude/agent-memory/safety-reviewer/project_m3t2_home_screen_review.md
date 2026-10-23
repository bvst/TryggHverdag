---
name: m3t2-home-screen-review
description: M3 task 2 (GRP-02, CALL-01, CALL-02) home screen review 2026-10-23, PASS at cff3021; phone.ts paths, 112 bar/Screen/ErrorBoundary, 401 deletes #1, L7 scripted flows; mutants planted and killed; should-fixes
metadata:
  type: project
---

PASS at cff3021 (branch claude/busy-faraday-40n2zl, main 50214c0). Server/contracts/infra diff empty; api:diff "no released
API versions yet".
Verified in node_modules: expo-intent-launcher 57.0.1 IntentLauncherModule.kt: startActivity throws
ActivityAlreadyStartedException while pendingPromise != null (cleared only in OnActivityResult); startActivityForResult
throw -> promise.reject. So a stuck ACTION_CALL promise makes every later ACTION_CALL reject -> phone.ts falls back to
the dialer (loud, two taps). RN IntentModule.kt openURL = ACTION_VIEW, no resolveActivity gate, reject on exception.
expo-secure-store build/SecureStore.js: isValidKey /^[\w.-]+$/, isValidValue typeof string -> the new test-kit
fake-secure-store accepts both (D-100 leniency; harmless today, keys are constants).
Mutants (scratch worktree, node_modules symlinked, sed): phone.ts raw-uri, no PLAIN check, drop 911, single-pass
reduce, 911 as prefix, emergency uri from plain -> all killed by phone.test.tsx (200). call-button: no lock, no
foreground release, no release on reject, no failure message -> killed by call.test.tsx (88). Screen bar inside
ScrollView, fallback without I18nextProvider, absolute sibling in _layout, no ErrorBoundary export -> killed by
shared/ui + emergency tests (120). session: no #1 delete on 401 killed (1 test); wait-for-server killed (49);
'refused' (non-401 4xx) -> signOut SURVIVES grp+call tests (289): "only a 401 signs out" unpinned for 4xx.
Should-fixes given: emergency-112.yaml's '[^0-9]*112[^0-9]*' also matches the app's own "112" text and the label
"Ring 112, nødnummeret", so it can pass before the dialer is up -> assert the app gone first (D-141's unverified claim
would stay unobserved); callPermission() throw rejects callNumber without trying the dialer; 4xx-refused test; fake
secure store key/value validation; no import rule pins phone.ts as sole importer of expo-intent-launcher/Linking
(D-141 states it). Notes: no +not-found route (no scheme today, so unreachable); lone surrogate -> URIError -> AC5 line;
401 now also deletes #1 (widens GRP-01 WALKER_ONLY hand-off for task 3); scriptedFlowsToRun 'absent' passes but
e2e-android.test.mjs L3305 pins the real folder has none absent.
Related: [[call01-step1-review]], [[grp01-review]].
