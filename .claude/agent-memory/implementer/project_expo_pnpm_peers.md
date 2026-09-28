---
name: expo-pnpm-peers
description: pnpm's auto-install-peers in this workspace gives the Expo app wrong peers — Stryker's Babel 8, and Reanimated/Worklets/Gesture Handler via expo-router's drawer-layout; test-renderer must match React's reconciler
metadata:
  type: project
---

Found while scaffolding apps/mobile for INF-06 (2026-09-25, Expo SDK 57, pnpm 10.33, isolated linker):

1. **`@babel/core` must be declared in the app (`^7.20.0`, the range `@expo/metro-config` 57 depends on).** Undeclared, pnpm fills every Babel peer in the app's tree with `@babel/core@8.0.6`, the version `@stryker-mutator/instrumenter@10` brings into the root lockfile. `babel-jest` 29 and `babel-preset-expo` then run on Babel 8 while their peer ranges ask for ^7. Jest happened to work anyway; it is still unsupported.
2. **`expo-router` 57 depends on `react-native-drawer-layout`, whose peers `react-native-reanimated` and `react-native-gesture-handler` are required.** `auto-install-peers` installs the *latest* (4.7.0, 3.3.0, plus `react-native-worklets@0.13.0` and `@react-native/metro-config@0.87.1`), outside SDK 57's list (4.5.1, ~2.32.0, 0.10.1), and Android autolinking links all three. The spec says no Reanimated and no gesture handler. A root `pnpm.packageExtensions` entry marking those two peers optional removes the whole chain. The coordinator chose that on 2026-09-25 (recorded in D-079), and it is now in the root package.json. JSON takes no comments, so the reason lives in D-079 only. Don't remove the entry without re-reading this. Note: pnpm does not re-resolve existing snapshots when packageExtensions changes; resolve from a lockfile without the app entries to see its real effect.
3. **`test-renderer` (RNTL 14's peer) must match React's minor**: 1.2.x uses react-reconciler 0.33 (React ^19.2), 1.3.x uses 0.34 (React ^19.3).

**Why:** each of these looks like a clean install with a few warnings, and each ships something other than what the SDK tested.

**How to apply:** after any change to the app's dependencies, read pnpm's peer report and run `expo-modules-autolinking react-native-config --platform android --json` (from the app, via expo's own copy) to see what Android would link. See also [[red-phase-typed-lint]].
