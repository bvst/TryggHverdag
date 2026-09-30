---
name: eas-ios-builds
description: EAS iOS builds for an Expo SDK 57 app outside the pnpm workspace: FORCE_BUNDLING cannot bundle a Debug build, a nested app needs its own pnpm-workspace.yaml, eas-cli sends analytics unless DISABLE_EAS_ANALYTICS, EAS logs are Brotli
metadata:
  type: project
---

Found building SPIKE-01's simulator app on EAS (2026-09-30, eas-cli 24.8.0, Expo SDK 57, build `8acc62f7`):

- **`FORCE_BUNDLING=1` cannot bundle a Debug build.** Expo's template bundling step exports `SKIP_BUNDLING=1` whenever `CONFIGURATION` is Debug, and React Native's `react-native-xcode.sh` checks `SKIP_BUNDLING` before `FORCE_BUNDLING`. The log says `SKIP_BUNDLING enabled; skipping.`, the `.app` has no `main.jsbundle`, and the app opens on "No script URL provided". The only overrides are files that step sources afterwards, in the generated `ios/` folder (the `.updates` and `.local` variants of the Xcode env file). Writing them means touching the iOS bundling step, which is the coordinator's decision.
- **An app inside the repository but outside its workspace needs its own `pnpm-workspace.yaml`.** A plain `pnpm install` in `spikes/background-safety/app` installed the root workspace ("Scope: all 6 workspace projects"), ignoring the app's own lockfile. EAS runs exactly that, `pnpm install --frozen-lockfile`. `--ignore-workspace` only helps on the Mac.
- **eas-cli sends Rudderstack analytics to cdp.expo.dev** unless `DISABLE_EAS_ANALYTICS` is set (which also stores the opt-out in `~/.expo/state.json`). Set it, and `EXPO_NO_TELEMETRY=1`, on every `eas` command.
- **eas-cli's upload** is a tar.gz of a depth-1 `git clone` of the repository root: the whole clean working tree plus a shallow `.git` (2.2 MB for this repository).
- **EAS log files download Brotli-compressed** with no gzip header: decode them with Node's `zlib.brotliDecompressSync`. `logFiles[1]` equals the `xcodeBuildLogsUrl` artifact: the raw xcodebuild log.
- **An EAS simulator build is universal** (`x86_64 arm64`): the generic simulator destination overrides `ONLY_ACTIVE_ARCH=YES`. Every prebuilt framework involved has an x86_64 simulator slice (React, ReactNativeDependencies, Hermes, Expo's precompiled modules, TSLocationManager 4.7.1, MapLibre 6.31.0).
- **`eas init --non-interactive`** needs `--force` to create a project, and cannot write the project ID into `app.config.ts`: add `extra.eas.projectId` by hand.

**Why:** the first iOS build was spent before the bundling mechanism was checked in a real build log. Expo's template script is what decides, not React Native's.

**How to apply:** before any EAS iOS build, read the template's bundling-step script and prove the bundle lands in the `.app`. Related: [[coverage-and-guard-quirks]], [[transistorsoft-docs]].
