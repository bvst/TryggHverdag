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
