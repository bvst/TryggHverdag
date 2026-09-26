---
name: mobile-release-review
description: How to verify what the Expo/Android release app actually ships (manifest, OTA, dev client, telemetry opt-outs, audit baseline) instead of trusting app.config.ts comments
metadata:
  type: feedback
---

Judge the release app by what Android merges, not by what app.config.ts says. First seen on INF-06 (2026-09-26, Expo SDK 57, RN 0.86).

**Why:** Expo's config plugins and library manifests add things that app.config.ts never mentions. INF-06's config comments were accurate, but the merged manifest also held `android:allowBackup="true"` (Expo's default) and `expo.modules.updates.*` meta-data. The meta-data is inert without the expo-updates module, but it looks alarming until you know that.

**How to apply:**
- Offline and read-only: `EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 pnpm exec expo config --type introspect --json | grep -oE ...` in apps/mobile. If the Mac has built it, read `apps/mobile/android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml`, and check its mtime against the last commit to app.config.ts.
- Check: uses-permission list; exported activities and their intent-filters (a `<data android:scheme>` means a deep link); `allowBackup` (Auto Backup to Google = PRIV-05/SEC-01 risk once tokens or journey data exist); `usesCleartextTraffic`.
- OTA (D-023): autolinking list via `node <expo-modules-autolinking>/bin/expo-modules-autolinking.js resolve --platform android --json`. `expo-updates-interface` is fine, `expo-updates` is not.
- The dev client stays out of release unless gradle.properties sets `expo.devlauncher.configureInRelease=true` (then src/debug is compiled into release).
- Runtime vendor endpoints: `strings` on `android/app/build/generated/assets/react/release/index.android.bundle`. `classic-assets.eascdn.net` is Expo Go-only (ExponentKernel), so it is harmless.
- Telemetry: Expo CLI goes to `cdp.expo.dev`, off with `EXPO_NO_TELEMETRY` (boolish) or `EXPO_OFFLINE`. Maestro 2.x sends PostHog analytics to `us.i.posthog.com`, off with `MAESTRO_CLI_NO_ANALYTICS` set to any value. Its update check is separate: it sends a persistent X-UUID, the version and the OS to api.copilot.mobile.dev, and only `MAESTRO_DISABLE_UPDATE_CHECK=true` stops it (Boolean.parseBoolean, so "1" does NOT work). Grep the jars in node_modules/.cache/maestro/<ver>/maestro/lib to re-check after a version bump.
- pnpm audit baseline before INF-06 (dev tooling, not new): 3x `qs` via @stryker-mutator/core and `esbuild@0.18` via drizzle-kit. INF-06 added `decode-uri-component@0.2.2` (via expo-router > query-string; expo-router's own getStateFromPath does not call qs.parse, and there is no deep-link entry) and `uuid@7.0.3` (xcode, iOS prebuild only). Re-judge decode-uri-component when the first scheme or App Link lands.
- A device probe that accepts any `adb` device can put a real phone into automated runs (D-037 says emulators only), and `adb logcat -b crash` dumps every app's crashes.

Related: [[tooling-scripts-review]], [[reviewer-sandbox-quirks]]
