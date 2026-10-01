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

Related: [[mobile-release-review]], [[reviewer-sandbox-quirks]], [[tooling-scripts-review]]
