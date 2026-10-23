---
name: home-screen-grp02-review
description: M3 task 2 (GRP-02, CALL-01, CALL-02) PASS cff3021: a third party's data kept on the phone only; deletion promised on sign-out but join does not clear a #1 a failed delete left; expo-intent-launcher facts; Linking/Intent error texts; L7 synthetic #1 in the job log
metadata:
  type: feedback
---

Reviewed 2026-10-23, HEAD cff3021, base 50214c0. Verdict PASS, one should-fix.

**Why / what held:** #1 lives only in expo-secure-store under `firstContact` as exactly `{ name, number }`
(destructured before JSON.stringify), AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY; no server, contract,
.github or infra change; no console call in apps/mobile/src; every phone.ts rejection is caught
by its caller (call-button keeps only the number for the on-screen message, emergency bar a flag,
permission line swallows); ErrorFallback never shows the error.

**Should-fix found (S1):** session.signOut deletes the credential and #1 in separate swallowed
try/catches, and join() sets state `firstContact: none` WITHOUT touching storage. If #1's delete
fails (or an in-flight saveFirstContact lands after it), the old #1 resurfaces at the next start
after a new join. Fix: join() (after the credential is saved) or start()'s no-credential path
deletes #1, best-effort; test with the store fake refusing #1's delete on the 401.
How to apply: on any "deleted with X" promise, check every path back IN (join, restart), not
only the delete path, and what happens when the delete itself fails.

**Facts worth reusing:**
- expo-intent-launcher 57.0.1: MIT, zero deps, empty library AndroidManifest (adds no permission),
  no network; integrity matched `npm view ... dist.integrity`. It uses startActivityForResult and
  keeps one pendingPromise: a result that never arrives makes the next call throw
  E_ACTIVITY_ALREADY_STARTED (phone.ts falls back to the dialer; a safety-reviewer topic).
- Android's ActivityNotFoundException text uses Intent.toString (secure), whose Uri.toSafeString
  masks tel: digits. RN's Linking.openURL rejection on Android DOES hold the full URL
  ("Could not open URL 'tel:...'"), so every caller must swallow it.
- `expo config --type introspect` merged permissions after this task: INTERNET, CALL_PHONE, and the
  four blocked ones with tools:node=remove; allowBackup false; queries only https VIEW.
- L7: scripts/e2e-android.mjs prints the whole Maestro command line, which now carries
  FIRST_CONTACT_NUMBER (Ofcom drama range +44 7700 900nnn, synthetic) into the public job log;
  acceptable under RG-07, re-check if a non-reserved number ever goes there.
- Fixture numbers shaped as Norwegian mobiles (L5 only) are not from a reserved range; Note only.

Related: [[grp01-join-review]], [[mobile-release-review]], [[device-harness-review]]

**Loop 1 delta (2026-10-23, HEAD d2a55ca, base 9820f78): PASS.** S1 fixed: join() deletes #1
(best effort) BEFORE saveCredential, tested with the fake refusing the 401's delete and with both
refused. Left: start()'s no-credential path still never deletes #1, so a single refused delete on
a phone that never rejoins keeps #1 hidden under the join screen (Should-fix, low; or name it in
the spec's Risks). Pattern: a "deleted again at X" fix covers only users who reach X; ask what
happens to one who never does.
- expo-system-ui 57.0.4 added (a11y: userInterfaceStyle on Android): MIT, SDK-pinned
  (bundledNativeModules.json ~57.0.4), lock integrity == npm view; empty manifest in source AND in
  the prebuilt AAR under local-maven-repo (unzip -p the .aar AndroidManifest.xml); deps
  normalize-colors and debug were already in the tree; no network.
- CALL-01-AC6 ESLint rule (no-restricted-imports `paths`) misses: dynamic import(), deep subpaths
  (expo-intent-launcher/build/..., react-native/Libraries/Linking/...), NativeModules /
  requireNativeModule, and expo-router's router.push/Link with an external href, which calls
  Linking.openURL(href) un-awaited (build/global-state/router.js:143). require() is caught by
  strictTypeChecked's no-require-imports. None used today.
- jest.mock virtual vs installed: a virtual mock of an installed bare name is skipped once the
  worker resolver cached the real path (a54f735).

**Loop 2 delta (2026-10-23, HEAD 9c7c498, base d2a55ca): PASS.** S1 closed: start()'s
`stored === null` path deletes #1 best effort (silent catch, comment cites PRIV-07) before
`phase: 'joining'`; a REJECTED credential read keeps #1 (home screen shows it). Tests: refused-then-
allowed restart, refused twice then allowed, read-rejects-no-delete, and AC9 with a leaking error.
GRP-02 Risks records the delete-refused-every-start case honestly. Lockfile and every package.json
unchanged; no server/contracts/infra/.github change; no new digit strings in the diff.
- ESLint probe recipe that works with typed rules on: a scratchpad .mjs that createRequire's
  eslint from the repo root, `new ESLint({cwd, overrideConfig: {languageOptions: {parserOptions:
  {projectService: false, project: null}}}, ruleFilter})`, lintText with a filePath under
  apps/mobile/src. (`npx eslint --stdin --parser-options=projectService:false` dies on
  await-thenable needing type info.)
- Probe results at 9c7c498: refused outside phone.ts: namespace, default, `export *`,
  `export {Linking}`, NativeModules/TurboModuleRegistry, `expo` requireNativeModule, import() with
  a variable or a react-native deep path, `react-native/index`, require() and `import x = require`
  (no-require-imports). OPEN: deep path into `expo` itself (`expo/build/Expo`, `expo/src/Expo`
  re-export requireNativeModule; CALLING_PACKAGES omits `expo`), and `globalThis.expo.modules.X`
  (recorded in Risks as globals). safety-core keeps the AR-03 Date.now refusal beside the calling
  selectors. expo-router tel: path recorded in CALL-01 Risks; nothing in src uses router.push/Link.
Pattern: an "exact-name list plus deep-path list" rule must carry the SAME package list in both;
check every package in the named-import list also appears in the deep-path regex.
