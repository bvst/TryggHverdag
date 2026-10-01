---
name: device-harness-review
description: Where positions and telemetry slip through in emulator/simulator harnesses (spikes, drivers, receivers, capture readers): child_process error messages, host-based capture classification, table-only renderers
metadata:
  type: feedback
---

Seen on SPIKE-01 (2026-09-30). The happy path was clean, and the leaks were on the failure paths and in how results were classified.

**Why:** the receiver, the app and the replay loop all dropped positions correctly. But:
- `execFile`/`execFileSync` errors carry the full argv in `error.message` ("Command failed: adb emu geo fix <lon> <lat>"). The replay loop logged only `error.code`, but the one-off `setPosition(firstPoint())` in setup was not caught. `main()` printed `error.stack`, and the runner copied the stderr tail into the manifest's evidence, which is what the results are written from.
- The capture reader put `googleapis.com` under "platform". That also hides Firebase telemetry (firebaseinstallations, fcm, fcmtoken, firebaselogging-pa), and `expo-notifications` links firebase-messaging on Android.
- The results renderer checked only its tables. The hand-written sections, such as invalid-run evidence, went unchecked. Its 4-decimal "coordinate" rule also missed the route's 3-decimal start point.

**How to apply:**
- Trace every place that sets a position (`geo fix`, `simctl location`) to every catch, and on to stderr, logs, manifests and summaries.
- Check each capture or host classifier's platform bucket for Firebase hosts.
- Check which parts of a public results document bypass the renderer's guard.
- Check the merged debug manifest. `blockedPermissions` does not remove SYSTEM_ALERT_WINDOW from the debug overlay, and expo-notifications adds c2dm RECEIVE, the Install Referrer permission and about 20 launcher-badge permissions.
- Rank synthetic-only leaks outside the repository as Should fix, not Blocking.
- Attributing a Firebase lookup in a capture (loop 1, 2026-10-01): the static check decides. The app can only reach Firebase Installations with a default FirebaseApp, so look for `google_app_id` and `gcm_defaultSenderId` in `app/build/intermediates/runtime_symbol_list/*/R.txt`, the google-services Gradle plugin, and `googleServicesFile`. A tag-filtered logcat can show the app *did* call it (a line from the app's pid), never that it *did not*: Firebase SDKs log little at INFO, and Play Services' own FIS tag is unknown. expo-notifications 57 reaches `FirebaseMessaging.getInstance()` only through getDevicePushTokenAsync and the topic functions.
- `geomobileservices-pa.googleapis.com` in an emulator capture is Play Services' network location (platform). That makes it a DPIA note for the product, not a finding against the harness.
- Since loop 2, `analysis/capture.mjs` matches Firebase by pattern (`^firebase[^.]*\.…googleapis\.com$`), plus fcm, fcmtoken and crashlyticsreports-pa. Names are lowercased and the trailing dot is stripped first. `fcmregistrations.googleapis.com` is still not listed. Re-check if more Firebase modules get linked.
- Hand-written prose in results documents drifts from the code (loop 2, 04b-spike-results.md). It called the Firebase family "analytics/platform", "distinct from" the FIS session that is itself in that family. It also put the merged-manifest permissions on the location SDK, though they come from expo-notifications and the debug overlay. Check every sentence that restates a classifier or an attribution against the code and evidence.

Related: [[mobile-release-review]], [[reviewer-sandbox-quirks]], [[tooling-scripts-review]]
