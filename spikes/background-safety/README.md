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
| `drivers/`  | One script per scenario and platform, and the Maestro flows (`maestro/`)    |

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
- **Bundled JavaScript on iOS** also needs `app/plugins/with-spike-ios-bundling.js`,
  because the native build stays Debug (what the SDK's licence lets run without
  a key) and the bundle must still be a production one, as on Android. It makes
  two edits to Expo's bundling build phase at prebuild:
  - Expo sets `SKIP_BUNDLING=1` in every Debug build, and React Native checks
    that before anything else. That line becomes an unset.
  - React Native builds a development bundle for Debug, and Expo SDK 57 refuses
    to start one that Metro did not serve ("Cannot create devtools websocket
    connections in embedded environments"). So `react-native-xcode.sh` runs
    with `CONFIGURATION=Release` in its own environment only. It then bundles
    with `--dev false --minify false` and compiles with `hermesc -O`, to the
    same paths; the rest of the build stays Debug.

  Each edit throws at prebuild unless its text is found exactly once.
  `FORCE_BUNDLING=1` is no longer reached, and is kept as it is harmless.
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

One driver per scenario and platform, in `drivers/`. From this folder:

```sh
node drivers/s1-android.mjs [--case exempt] [--tcpdump] [--dry]
node drivers/s2-android.mjs --case swipe|lmk|forcestop [--dry]
node drivers/s3-android.mjs --case exempt|not-exempt [--dry]
node drivers/s4-android.mjs [--dry]
node drivers/s5-android.mjs [--dry]
node drivers/s6-android.mjs --case without|with [--dry]
node drivers/s7-android.mjs --case background|fine [--dry]
node drivers/s8-android.mjs [--tcpdump] [--dry]
node drivers/s1-ios.mjs | s2-ios.mjs | s4-ios.mjs | s5-ios.mjs | s8-ios.mjs [--dry]
node drivers/s7-ios.mjs --case always-to-inuse [--dry]
```

- **Before running:** Colima stopped; the Android build at
  `~/spike-runs/builds/android-app-debug.apk` and the iOS build at
  `~/spike-runs/builds/ios/SPIKE01.app` (each with its `*-build.json`). Run one
  driver at a time: each starts the receiver on the fixed port. Nothing else
  may use the emulator or the simulator meanwhile.
- **What a driver does:** it opens `~/spike-runs/<run-id>/`, holds a
  `caffeinate`, and starts the receiver in its own process. It resets every
  forced state, installs the app fresh (its data cleared) with its grants, and
  replays the route on the Mac's clock. It posts the marks the judges read,
  then collects the platform's records, `pmset -g log` and `meta.json`, and
  resets everything again. It never prints a position.
- **`--dry`:** a short, uncounted run, whose run id starts with `dry-`. It is
  for checking the harness and collecting sample outputs, never for a verdict.
- **The drivers only act and collect.** Every verdict comes from `analysis/`.
  A driver never throws on a scenario's own outcome (a map that did not
  render, zipalign's "not aligned", a report that never came): it records it
  for the judge. The Maestro flows in `drivers/maestro/`
  (`ios-allow-notifications.yaml`, `ios-tap.yaml`, `ios-zoom.yaml`) only tap
  and wait, each within 3 min. The drivers launch the app with simctl, because
  Maestro's `launchApp` would grant every permission itself.
- **`s1-android --case exempt`:** S1 with the battery-optimisation exemption
  granted by script first, as the app's setup would ask the user (the same
  grant as S3's exempt case). Before the screen goes off it shows the
  exemption in force: deviceidle's list holds the app, and the app's own
  `exempt: true` report has reached the receiver (`meta.json`,
  `exemptionInForce`). If it cannot show that, the run stops with a break,
  which makes it invalid. Everything else is S1's: screen off, battery
  unplugged, no forced Doze, the same route and seed. The runner's first
  exempt run carries the capture, as S1's first run does. Every exempt run
  saves `firebase-logcat.txt`: logcat filtered to the Firebase-related tags
  alone (`FIREBASE_TAGS` in `drivers/lib/android.mjs`), each line with its pid
  and its time on the device's clock, checked again line by line so nothing
  else is kept. `meta.json` records the app's pid (`appPids`) and the device's
  clock against the Mac's (`deviceClock`). It is evidence for telling a
  Firebase lookup in the capture as the app's or Play Services', read by
  hand; no judge reads it.

### The overnight runner

```sh
node drivers/run-all.mjs --plan                  # the plan and its expected time; runs nothing
node drivers/run-all.mjs --night night-YYYYMMDD  # every counted run, resumable
node drivers/run-all.mjs --smoke                 # one real S6 run, in its own smoke- manifest
node drivers/run-all.mjs --night night-YYYYMMDD-s1-exempt --only s1/android/exempt
                                                 # one case outside the plan, twice, in a night of its own
node drivers/summarize.mjs --night night-YYYYMMDD \
  [--build-android passed --build-ios passed --licence passed]
node drivers/summarize.mjs --manifest <path> --manifest <path> …   # several nights as one
node drivers/rejudge.mjs --night night-YYYYMMDD  # re-judge a night from its saved folders
node drivers/results-tables.mjs --manifest <path> [--manifest <path> …]   # the results' tables
```

- **Self-checks first:**
  - Colima stopped, the Mac on AC power, and no emulator or simulator running;
  - the receiver's port free;
  - both builds from `20545d9` with their recorded sha256s;
  - Maestro, JDK 17 and tcpdump present;
  - a driver for every planned case.

  If any fails, nothing runs. A night holds one plan: the full night, or one
  `--only` case. A night that already holds another plan's runs is refused
  before anything is written.
- **One device at a time:** the Android block, then the iOS block. The
  go/no-go scenarios (S1, S3, S4, S7 and the AC12 capture) come first in each
  block, then the findings (S2, S5, S6, S8).
- **Each case twice.** Each run is judged when it ends, by
  `drivers/lib/judge.mjs`, which reads the run's folder and hands it to the
  tested per-run judge, `analysis/judge-run.mjs`. The Mac's sleeps from the
  run's `pmset` log are breaks, each with its span.
- **Every run is judged, however its driver exited.** A failure its records
  show is failed and final, even if the driver then threw or timed out. A
  driver that threw or timed out with no failure shown makes the run invalid.
- **"Invalid" means only that the harness broke:** a break the driver saw, the
  Mac asleep or the receiver silent over the moment that decided the run, a
  driver that did not finish, or a file the judge cannot read. An invalid run
  says nothing about the SDK. It is repeated, at most twice extra per case.
  After that the case stops, and the manifest says why.
- **A failed run is never repeated** (D-060).
- **The emulator is stopped** after each run with a capture, before the run
  is judged, so its pcap is complete and no later run writes into it; and
  after any invalid Android run, killed outright if it does not answer.
- **Everything goes in `~/spike-runs/<night>/`:** `manifest.jsonl` (one line
  per run, and each stopped case), `runner.log`, and each driver's output in
  `logs/`. Restarted with the same `--night`, the runner skips what the
  manifest holds. A run folder with no line (the runner stopped during it) is
  judged as it was left and recorded as interrupted; its id is never reused.

**In the morning:** `tail ~/spike-runs/night-YYYYMMDD/runner.log` shows the
last run started or finished. `node drivers/summarize.mjs --night night-YYYYMMDD`
prints each scenario's verdict per platform (through `judgeScenario`), with
every run's status and evidence. "NO VERDICT" means a case has fewer than two
valid runs: the harness broke, and the case needs runs, not a reading. Given
the build and the licence as read by hand, it also prints the go/no-go, its
input computed from the manifests (`analysis/manifest.mjs`) against the
runner's plan (`drivers/lib/plan.mjs`, with the S1 exempt case), so a planned
case that never ran is "no verdict", never a pass. Several `--manifest`s are
read as one: the night's and the S1-exempt night's together.

**Re-judging:** `drivers/rejudge.mjs` judges every run of a night again from
its saved folder, with the exit its driver had, and writes
`manifest.rejudged.jsonl` beside the manifest, each run with the commit that
judged it and whether the tree was dirty. It only reads the manifest and the
run folders (it checks the manifest's sha256 after writing), and keeps an
earlier re-judge under its own time. Summarize it with `--manifest`.

**What the harness had to learn (2026-09-30), and does:**

- **Android, the swipe:** `input swipe` does not dismiss a card in this
  launcher's recent apps, and a drag of separate touch events does. The driver
  checks that the task is gone, and fails if it is not.
- **Android, the network capture (AC12):** the emulator's `-tcpdump` sees
  only `eth0`, and with Wi-Fi on the app's traffic leaves through `wlan0`. So
  `--tcpdump` runs go without Wi-Fi, and `meta.json` says so.
- **Android, the capture's clock (2026-10-01):** the pcap's times ran about an
  hour (3603.8 s) behind the Mac's on the night of 2026-09-30, and the file
  kept growing as long as its emulator ran. The judge places the run on the
  capture's clock from the run's own uploads to the receiver, and reads only
  the run's window. A run it cannot place (S8 has one arrival) is not guessed:
  its destinations are the whole file's, and the details say so. The device's
  addresses, IPv6 included, are in `meta.json` (`deviceAddresses`).
- **Android, the restricted standby bucket (S3):** Android re-promotes a
  journeying app from `restricted` (45) to 10 or 30 within a second. The
  driver records the bucket actually in force.
- **Android, S6:** the console's `gsm list` never lists a call on this image,
  so calls are read from `dumpsys telecom`.
- **iOS, the route:** stepping `simctl location set` every 10 s is a moving
  replay the SDK follows. A position that stays still, as at the route's stop,
  gives it nothing new.
- **iOS, the lock:** simctl cannot lock the simulator, and this simulator has
  no window, so S1 on iOS runs in the background, unlocked.

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
