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

**Loop-1 delta PASS at d2a55ca (2026-10-23)**, `git diff 9820f78..HEAD` (bc656cb/d2a55ca docs excluded). Read-only, no
runs (gate:full running). All 5 findings closed with tests: (1) emergency-112.yaml asserts id trygghverdag-emergency-button
visible, taps, extendedWaitUntil notVisible id (15 s) before the dialer regex; emergency.test.tsx reads the ID from the
flow and pins it on exactly the 112 button; L7 still unobserved (spec says so). (2) phone.ts heldForCall try/catch ->
false -> dialer; phone.test.tsx "CALL-01-AC4: when reading the permission (PermissionsAndroid.check) rejects". (3) 403/404/
409 -> 'refused' -> unreachable line, nothing deleted: home.test.tsx (unowned grp) AND emergency.test.tsx CALL-02-AC8
(owned). (4) fake-secure-store key /^[\w.-]+$/ + string value, matches expo-secure-store 57.0.4 build. (5) ESLint
no-restricted-imports CALLING_PIECES outside phone.ts + packages/config/calling-imports.test.mjs.
a54f735 = only drops { virtual: true }; same factory; failure mode was red (real module), not green -> weakens nothing.
New: join deletes #1 best effort (privacy S1); new-view.tsx (ScreenViews context inside ScrollView, no host element,
scrollTo y0 + sendAccessibilityEvent focus) cannot touch the bar. Notes given: import rule misses dynamic import(),
react-native/Libraries/Linking deep path, NativeModules/requireNativeModule, namespace import untested; call-button
hint says "Ringer" while permission null (read failed) though the tap goes to the dialer; home-screen.tsx still unowned.

**Loop-2 delta PASS at 9c7c498 (2026-10-23)**, `git diff d2a55ca..HEAD -- apps packages scripts eslint.config.mjs docs/specs`.
Read-only, no test runs (gate:full running); one `npx eslint --print-config` per path was enough to read effective rules.
- session.tsx start(): stored===null -> await deleteFirstContact() in try/catch, then joining. Read reject -> home with #1,
  no delete. A delete that never settles would hold the waiting view, but the real expo-secure-store 57.0.4 Android
  deleteValueWithKeyAsync = synchronous SharedPreferences removeItem/commit (resolve or DeleteException): always settles;
  readCredential was already awaited the same way. Note given: no timeout pins it.
- call-button hint: only 'granted' -> "Ringer"; null/notGranted/read-failed -> permission.missing. Tap path unchanged,
  phone.ts untouched (git diff --stat empty).
- ESLint: print-config verified: safety-core probe path (folder does not exist yet) gets AR-03 3 selectors + 3 calling
  selectors + no-restricted-globals; phone.ts keeps FRAME_PIECES + SCREEN and no calling rule; routes/shared-ui/features
  get CALLING_SYNTAX + deep-path pattern. esquery 1.7.0 parses the `\/` inside the regex fine (probed). Gaps noted:
  globalThis.expo.modules / nativeModuleProxy JSI globals, deep paths of `expo` itself.
- 4c38bb2 + guard: non-virtual mocks keyed by real path; phone.ts virtual-by-relative-path keys = real path. Guard test
  refuses planted bare-name virtual mocks of installed packages (REFUSED_PROBES) and asserts the walk read app files.
- test-kit fake-phone holdPermission: a test control (pending read), accepts nothing the real refuses (D-100 ok).
