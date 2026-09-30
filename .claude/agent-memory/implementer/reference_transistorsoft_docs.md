---
name: transistorsoft-docs
description: Where the location SDK's v5 behaviour is documented; its shipped .d.ts files carry no doc comments, and src/declarations holds v4-era docs
metadata:
  type: reference
---

For `react-native-background-geolocation` 5.x (SPIKE-01, 2026-09-30):

- **Per-type reference pages:** `https://docs.transistorsoft.com/react-native/<Type>/`, for example `AppConfig`, `HttpConfig`, `GeoConfig`, `ActivityConfig`, `PersistenceConfig`, `BackgroundGeolocation`, `ProviderChangeEvent`, `DeviceSettings`. Fetch with `curl` and strip the `<article>` to text.
- **The installed types don't help:** `@transistorsoft/background-geolocation-types` ships bare `.d.ts` files with no comments. `react-native-background-geolocation/src/declarations/interfaces/*.d.ts` has long comments, but for the v4 flat config, not v5's nested `{ logger, geolocation, http, app, persistence, activity }`.
- **Facts that took a while to find:** `onHeartbeat` fires only in the stationary state (iOS also needs `app.preventSuspend`); Android's `locationUpdateInterval` is ignored unless `distanceFilter` is 0; `ProviderChangeEvent.accuracyAuthorization` is always Full on Android; `http.params` are merged at the body's root beside `location`; the SDK runs RPC commands (`background_geolocation`) found in *any* HTTP response body; `transistorAuthorizationToken` points uploads at the vendor's demo server.
- **Gradle:** the package's `android/build.gradle` reads `playServicesLocationVersion`, then `googlePlayServicesLocationVersion`, and enforces a floor on `tslocationmanagerVersion`. The iOS podspec reads the environment variable `TSLOCATIONMANAGER_VERSION` (default `~> 4.7.1`).

Related: [[coverage-and-guard-quirks]], [[mac-android-toolchain]].
