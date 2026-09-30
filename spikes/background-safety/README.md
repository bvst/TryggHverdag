# SPIKE-01: background safety on emulators and simulators

Throwaway code for milestone M1. It checks, on the Android emulator and the iOS
simulator, whether the location SDK keeps a journey alive in the background
(S1 to S7), and whether MapLibre draws Kartverket's tiles (S8, outside the
go/no-go). The spec is [`docs/specs/SPIKE-01.md`](../../docs/specs/SPIKE-01.md);
the results will go in `docs/plan/04b-spike-results.md`.

It is never shipped and never imported: nothing under `apps/` or `packages/`
may import it (the `spikes-are-throwaway` rule), and it is not a workspace
package. Deleting this folder removes the spike completely.

## What is here

| Folder      | What                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| `receiver/` | The receiver: takes the SDK's uploads on loopback and keeps no position     |
| `routes/`   | The synthetic route: made-up waypoints and a fixed seed                     |
| `analysis/` | Pure functions: the verdicts, the results tables and the go/no-go rule      |
| `app/`      | The spike app: Expo SDK 57, its own `package.json` and `pnpm-lock.yaml`     |
| `drivers/`  | One script per scenario and platform, and the Maestro flows (to come)       |

Plain `.mjs` on Node 22, with no dependencies outside the app.

**`app/src/fixed.json`** holds the values the app bundles and the drivers must
use too: the receiver's port, the synthetic number, the fixed alert and
reminder texts, and the map's sentinel colour. Change them there only, and
rebuild the app.

## Running the tests

From this folder:

```sh
node --run test
```

or `npm test`. Both run `node --test` on `receiver/`, `routes/` and `analysis/`
only, so an installed `app/node_modules` is never collected. Nothing in CI runs
these tests, and the root `test:unit` does not collect them: run them before
every commit, and quote the output in the pull request.

## The app

A journey screen and a map screen, switched with plain state (no router):

- **Journey:** start and stop; counts of locations, heartbeats and uploads;
  the status the app reports (queue count, permission, exemption); a short
  event list. It never shows a position.
- **Call (S6):** dials only the synthetic number. On Android it tries
  `ACTION_CALL` (needs `CALL_PHONE`), and falls back to the dialer, which waits
  for a second tap. The screen says which ran.
- **Alert (S5):** on Android, posts the fixed alert on the high-priority alert
  channel 10 s after the tap. On both platforms, the screen shows the last
  notification received, with a pushed payload exactly as it arrived.
- **Delivered notifications:** the platform's own list, with delivery times,
  read whenever the app comes to the front (S2 on iOS).
- **Map (S8):** MapLibre with a style written in the app: Kartverket's topo
  tiles as the only source, "©Kartverket" shown, and a sentinel background.
  Three zoom levels around Galdhøpiggen; no user-location layer. Never opened
  during S1 to S7.

**How the status reaches the receiver.** The app keeps the SDK's
`http.params.app` current with `setConfig`, so every upload the SDK sends
carries it, even when no JavaScript runs. A change of permission or exemption
is also posted straight to the receiver as `{ app }`, and so is the status at
journey start: S3 and S7 need that report even when the SDK cannot record a
position. Those direct posts happen only on a change, never on a timer, so they
cannot fill a gap in the SDK's own uploads.

## Building the app

**Android, on the Mac.** Stop Colima first (16 GB is not enough for both), and
use a JDK 17: the Mac's default Java (Android Studio's JBR 25) cannot build it.

```sh
cd app
pnpm install --ignore-workspace --frozen-lockfile
EXPO_NO_TELEMETRY=1 ./node_modules/.bin/expo prebuild --platform android --clean --no-install
cd android
JAVA_HOME="$HOME/jdks/jdk-17.0.20.1+1/Contents/Home" EXPO_NO_TELEMETRY=1 \
  ./gradlew assembleDebug -PreactNativeArchitectures=x86_64
```

The debug APK carries its JavaScript, so it runs with no Metro. The local
config plugin `app/plugins/with-spike-android.js` sets that up at every
prebuild, together with cleartext HTTP to `10.0.2.2` only.

**iOS, on EAS** (the Mac's Xcode 26.0.1 cannot build Expo SDK 57): the
`simulator` profile in `app/eas.json` builds a Debug simulator app, as the
project `@urso-as/spike-background-safety`. It needs the owner's robot token,
passed only as an environment variable, never as an argument:

```sh
cd app
DISABLE_EAS_ANALYTICS=1 EXPO_NO_TELEMETRY=1 EXPO_TOKEN="$(cat ~/.config/trygghverdag/expo-token)" \
  ./node_modules/.bin/eas build --platform ios --profile simulator --non-interactive --wait
```

- **`DISABLE_EAS_ANALYTICS=1` and `EXPO_NO_TELEMETRY=1` on every `eas`
  command.** Without the first, eas-cli sends usage analytics to Expo
  (Rudderstack, `cdp.expo.dev`).
- **What EAS receives:** eas-cli uploads a depth-1 `git clone` of the whole
  repository (the committed working tree and one commit of history). Commit
  first; the repository is public.
- **The profile's environment** pins the SDK's iOS engine exactly
  (`TSLOCATIONMANAGER_VERSION=4.7.1`; the podspec's default is a range), asks
  React Native to bundle for the simulator (`FORCE_BUNDLING=1`), and turns
  Expo's telemetry off. It also pins Node 22.23.2 and pnpm 10.33.0.
- **Bundled JavaScript on iOS** also needs `app/plugins/with-spike-ios-bundling.js`.
  Expo's bundling build phase sets `SKIP_BUNDLING=1` in every Debug build, and
  React Native checks that before `FORCE_BUNDLING`. The plugin replaces that
  one line at prebuild, and throws if the template no longer has it exactly
  once.
- **`app/pnpm-workspace.yaml`** makes the app its own pnpm workspace root.
  Without it, a plain `pnpm install` in `app/`, which is what EAS runs, finds
  the repository's workspace further up, installs that instead, and never
  reads the app's lockfile. The app stays outside the repository's workspace
  (AC1).

## Running the receiver

```sh
node receiver/main.mjs --run <run-id>
```

It listens on 127.0.0.1 at the port in `app/src/fixed.json`, and writes its
records to `~/spike-runs/<run-id>/`, outside the repository. Ctrl-C closes it
cleanly. The emulator reaches it as `10.0.2.2`; the simulator as `127.0.0.1`.

## Running the scenarios

To come. Before each run, clear the app's data (`pm clear`): positions the SDK
could not upload stay queued, and would arrive in the next run.

## Settings used (for M3)

Pinned exactly: `react-native-background-geolocation` 5.7.0, its Android
engine `com.transistorsoft:tslocationmanager` 4.6.1 with
`play-services-location` 21.3.0 (through `expo-gradle-ext-vars`), and its iOS
engine `TSLocationManager` 4.7.1 (through `eas.json`). No licence key.

The SDK's settings (`app/src/journey.js`). Anything not listed is the SDK's
default:

| Setting                                         | Value                    | Why                                                                                          |
| ----------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `logger.debug`                                  | `false`                  | Its sounds and notifications could be taken for S2's or S5's                                  |
| `logger.logLevel`                               | `Error`                  | More verbose levels may write positions to the device log                                    |
| `geolocation.desiredAccuracy`                   | `High`                   | A walk                                                                                       |
| `geolocation.distanceFilter`                    | `0`                      | Time-based sampling while moving, so standing still before the SDK notices the stop uploads |
| `geolocation.locationUpdateInterval`            | `30000` (Android)        | An upload at least every 60 s while moving. iOS has no interval, and delivers continuously   |
| `geolocation.disableLocationAuthorizationAlert` | `true`                   | The app reports a reduced permission itself; the SDK's pop-up would block the drivers        |
| `geolocation.locationAuthorizationRequest`      | `Always`                 | Background tracking                                                                          |
| `geolocation.showsBackgroundLocationIndicator`  | `true`                   | The sharing-is-visible story, on the iPhone                                                  |
| `app.stopOnTerminate`                           | `false`                  | S2: tracking may carry on after a swipe                                                      |
| `app.enableHeadless`                            | `true`                   | Android: after a swipe, events reach the headless task, which carries on as the app would   |
| `app.heartbeatInterval`                         | `60`                     | In the stationary state, an event every 60 s (Android's minimum), answered with a position   |
| `app.preventSuspend`                            | `true`                   | iOS fires heartbeats only with this on (vendor, `AppConfig.heartbeatInterval`)              |
| `app.notification`                              | a fixed title and text   | Android's location-service notification: the sharing-is-visible story                       |
| `http.url`                                      | the receiver             | Uploads go nowhere else                                                                      |
| `http.autoSync`, `http.batchSync`               | `true`, `false`          | One POST per record, as soon as it is recorded                                               |
| `http.params.app`                               | the status, kept current | See "How the status reaches the receiver"                                                    |

At journey start the app calls `changePace(true)`, because neither device has
real motion detection. On each heartbeat it calls `getCurrentPosition` with
`persist: true`, so the position is recorded and uploaded.

**`preventSuspend` costs battery on a real iPhone** (the vendor warns against
leaving it on). S1 measures the configuration a product would ship, and M3
decides whether it keeps it.

## Never copy into the product

These are for the spike only (spec, risk R13). None of them may reach
`apps/mobile` or `apps/server` when the SDK is brought in:

- **Cleartext HTTP to the loopback address:** the network security config for
  `10.0.2.2`, and on iOS `NSAllowsLocalNetworking`. The product talks HTTPS and
  authenticates each device. The receiver is not the heartbeat endpoint.
- **Debug builds that carry their JavaScript** (`debuggableVariants = []`,
  `FORCE_BUNDLING=1`, and the iOS plugin that unsets Expo's `SKIP_BUNDLING`).
  The product ships release builds.
- **The app's direct status posts.** They carry no authentication.
- **Permissions and grants made by script:** `adb` and `simctl privacy`, and
  the drivers' grants of `CALL_PHONE`, `SCHEDULE_EXACT_ALARM` and the alert
  channel's Do Not Disturb override. In the product the person grants them,
  and the app checks and reports them. Without the exact-alarm grant, Android
  schedules the reminder with an inexact alarm: a finding for the owner, not
  tested here.
- **`disableLocationAuthorizationAlert: true`** without the product's own
  warning to the walker (the location-loss rule).
- **Forced device states:** Doze forced idle, the standby bucket, the battery
  unplugged, airplane mode, Do Not Disturb and the ringer set by script.
- **The receiver itself,** its records and its refuse switch.
- **The SDK in debug builds without a licence.** Release builds need the
  licence (D-023).
