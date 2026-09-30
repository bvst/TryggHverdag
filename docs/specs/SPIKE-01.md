# SPIKE-01 · Background safety on emulators and simulators

**Status:** 📝 Spec. The owner answered Q1 on 2026-09-29: S8, the map check, is added. Q2 on 2026-09-30: iOS builds on EAS. Q3 on 2026-09-30: continue, and ask the SDK's vendor about its high-risk clause · **Last updated:** 2026-09-30 ·
**Branch:** this spec on `claude/busy-faraday-40n2zl` (cloud session, docs only); the
spike on `feat/SPIKE-01-background-safety` (the Mac, `claude-dev`, D-055/D-056) ·
**Milestone:** M1

## Requirement

From `docs/plan/10-roadmap.md`:

> | **M1** | Spike (emulators and simulators) | SPIKE-01, S1–S7 on emulators and
> simulators (D-037); location SDK in debug mode; Critical Alerts request drafted |
> Spike results recorded; SDK go/no-go decision; Section 4 closed |

From `docs/plan/04-tech-stack.md`, "Spike plan — SPIKE-01". Three requirement IDs
in the table are replaced by a name in square brackets; the next section says why.

> Throwaway code in `/spikes/background-safety/`, never shipped. Uses debug
> builds, so no SDK licence is needed yet. **Fully automated (D-035):** no one
> walks with a phone. Emulators and simulators replay recorded GPS routes, and a
> cloud device farm runs scripted tests on real phones (Section 6). Every test
> below is a script, and the server measures the heartbeat gaps.
>
> | Test | What we check | Pass when |
> |------|---------------|-----------|
> | S1 | 45-minute scripted journey, screen off, heartbeat every 60 s — real iPhone and real Samsung in the device farm; simulated GPS route on emulator and simulator | No gap longer than 2 minutes; battery use ≤ ⚙️ 10 % (measured by script where the platform allows) |
> | S2 | Swipe the app away mid-journey | The [reminder rule's] reminder fires on both platforms |
> | S3 | Manufacturer battery managers, with and without the exemption | The service survives 45 minutes with the exemption; the failure without it is detectable |
> | S4 | Airplane mode for 3 minutes mid-walk | Queued positions arrive in order afterwards ([offline-queue rule]) |
> | S5 | Alerts: iOS Time Sensitive (Critical once Apple approves); Android high-priority channel with Do Not Disturb override; content-free payload | The alert is seen and heard on a silenced phone where the platform allows it |
> | S6 | One-tap call | Behaviour documented for both platforms ([one-tap call story]) |
> | S7 | Reduce location permission mid-journey | Detected within 1 minute ([location-loss rule]) |
>
> Results go in `docs/plan/04b-spike-results.md`. If S1–S3 fail, we revisit the
> fallback in the recommendation above.
>
> **Scope change (D-037):** Until real-device tests are switched on, the spike
> runs on emulators and simulators only. The real-phone parts of S1–S3 (the
> Samsung battery manager, real iPhone background limits) stay open until then.

And finding 2 of the same file, which says what the spike measures about the SDK:

> **Confirmed in its documentation (behaviour on real phones still to measure in
> the spike):** the SDK stores every position in an on-device database and
> uploads it by HTTP POST, from native code, to a server address we configure.
> It uploads nothing to third parties and deletes each position once our server
> confirms receipt.

S8 comes from D-026 and finding 9. It was added by the owner's answer to Q1
(2026-09-29):

> **D-026, Consequences:** Map coverage is Norway only, which fits D-003.
> Verify Kartverket's terms and rate limits, and MapLibre support for its tile
> format, in the spike.

> **Finding 9:** Third-party map tools credit it as CC BY 4.0. **To verify:**
> Kartverket's own terms, including any rate limits. … Render them with
> MapLibre, an open-source map library (support for this tile type to be
> verified in the spike).

### Decisions this spec builds on (binding)

| Decision | What it fixes for SPIKE-01 |
|----------|----------------------------|
| D-016 | Personal data stays in the EEA; no third-party analytics or advertising SDKs |
| D-020 | Critical Alerts applied for, Time Sensitive as the fallback; on Android a high-priority channel that can override Do Not Disturb |
| D-021 | Lost contact after 5 minutes of silence; changing it after the spike needs the owner |
| D-023 | The Transistorsoft SDK, evaluated for free in the spike; not `expo-location`; fallback: native modules; a $399 licence before release builds; no over-the-air updates |
| D-026 | Maps are Kartverket's tiles through our own tile proxy, drawn with MapLibre. Kartverket's terms and rate limits, and MapLibre's support for the tile format, are verified in the spike (S8) |
| D-031 | Library and tool choices are Claude's, recorded with reasons; cost, privacy and safety stay with the owner |
| D-032 | MapLibre React Native is in the library set |
| D-035, D-037 | Everything automated; emulators and simulators only; the real-phone parts of S1–S3 stay open |
| D-041 | The real-device suite (L9) must pass before the group relies on the app |
| D-042, D-043 | CODEOWNERS paths need the owner; three blocking reviewers |
| D-055, D-056 | The spike runs on the Mac as `claude-dev`, a Standard user with no admin rights |
| D-060 | A run in which nothing ran has not passed; a failed run is never retried to replace it |
| D-074 | Untracked IDs: the test-name prefix is practice, not an obligation |
| D-075 | `ai-review.yml` changes are merged by hand. SPIKE-01 does not touch it |
| D-081 | Expo SDK 57, React Native 0.86.3, React 19.2.3; Java 17 to 21; Maestro 2.10.0 with its analytics and update check off; the Pixel 8 emulator on `android-37.2` `google_apis_ps16k` x86_64 |
| D-085 | CI runs on `ubuntu-26.04`. SPIKE-01 adds nothing to CI |

### How this spec names requirements, and why

`pnpm run req:coverage --fail-on-uncovered-changed` runs on every diff, docs-only
ones included (`.github/workflows/ci.yml`, the `traceability` job). It fails if
a changed file under `docs/specs/` names a **tracked** requirement that no test
names (`scripts/req-coverage.mjs`). Of the tracked IDs this spike touches, only
REL-01 and SEC-06 have tests today (`docs/requirements-status.md`). So, as in
INF-06, this spec names the others in words:

| Name used here | Where it lives |
|----------------|----------------|
| the offline-queue rule | `03-safety-reliability-security.md`, reliability table, 2nd row |
| the reminder rule | same table, 4th row |
| the location-loss rule | same table, 5th row |
| the alert-level rule | same table, 6th row |
| the faked-heartbeats threat | same file, SEC table, 7th row |
| the no-third-party-SDK rule | `02-norway-law-privacy.md`, privacy table, 6th row |
| the no-locations-in-logs rule | same table, 7th row |
| the one-tap call story | `01b-mvp-scope.md`, first story under "CALL" |
| the heartbeat story, the lost-contact story | first and second stories under "LOST" |
| the permission-check story, the responder-setup story | third and fourth stories under "GRP" |
| the sharing-is-visible story | second story under "JRN" |

**SPIKE is not a tracked prefix.** `collectRequirements`
(`scripts/lib/requirements.mjs`) reads stories written `**ID · title**` from
`01b-mvp-scope.md`, plus the REL, SEC, PRIV and SM tables. SPIKE-01 is in none of
them, and `docs/requirements-status.md` has no row for it. So `req:coverage`
asks for no test per criterion. Tests still carry `SPIKE-01-ACn:` names, by
practice (D-074).

**A spike test must never name a tracked requirement.** `TEST_GLOBS`
(`scripts/lib/test-strength.mjs`) matches `spikes/**/*.test.mjs`. So
`req:coverage` would count such a test as that requirement's coverage, and the
requirement would look tested by code that never ships and never runs in CI.
The results document may name them. `docs/plan/` is not read as a change by
`--fail-on-uncovered-changed`, and it is not a test file.

### What this spec checked, and what it did not

- **Checked in the repository:** the plan files and decisions above;
  `spikes/README.md`; the `spikes-are-throwaway` rule
  (`packages/config/dependency-cruiser.cjs`); ESLint's ignore of `spikes/**`;
  `gate-file.mjs` skipping `spikes/`; `vitest.shared.mjs` not collecting
  `spikes/`; `.prettierignore` not excluding it; `.gitignore` naming only
  `apps/mobile/ios/` and `apps/mobile/android/`; `pnpm-workspace.yaml`;
  `touchesApp` in `scripts/lib/affected.mjs`; `licenses-check.mjs`; the agents'
  path guards; `scan-sensitive.mjs`; `.github/CODEOWNERS`.
- **Not checked:** anything outside the repository. This session has no
  simulator, no emulator and no access to outside documentation. Every
  platform command below (`adb`, the emulator console, `simctl`, Maestro) is
  written from knowledge and marked **verify**. The SDK's current version, its
  support for Expo SDK 57, its licence text and its price are all unverified.
  So are MapLibre's current version, its support for the New Architecture and
  its licence, and Kartverket's tile address, terms and rate limits.
  Step 2 checks each one and records what it found. A command that does not
  exist changes how a criterion is shown. It never changes the pass condition.

## Scope

The spike builds a throwaway app with the location SDK in a debug build, and a
throwaway receiver that measures what the app sends. It runs S1–S7 by script on
the Android emulator and the iOS simulator on the Mac. It also measures what
finding 2 says about the SDK. S8, added by the owner's answer to Q1, checks
that MapLibre draws Kartverket's tiles on both devices. S8 is outside the
location SDK's go/no-go. Then the spike records the results and a go/no-go
recommendation, and lists what closing Section 4 needs.

**Verdicts.** Each scenario gets one of three verdicts on each platform:
**passed**, **failed** or **not shown on simulators**. "Not shown" never counts
as a pass. A proxy that only looks like the real thing is not used to fill a
gap: when a device cannot show something, the verdict says so.

**What each platform can show** (details in each criterion):

| | Android emulator | iOS simulator |
|---|---|---|
| S1 | 45 minutes, screen off, on (virtual) battery. Not battery use, a real phone, or motion detection | The app in the background on a simulated route. Not real iOS limits, battery use, or motion detection |
| S2 | A swipe, and a killed process | A terminated app (`simctl terminate`, not proven equal to a user's swipe) |
| S3 | Stock Android's own restrictions, with and without the exemption. Not any phone maker's battery manager | Not applicable |
| S4 | Airplane mode | The receiver refuses connections; the radio is not off |
| S5 | Seen with Do Not Disturb on; "heard" only as the system's own record | Delivered and presented. Not silent switch, Focus, Critical Alerts, or sound |
| S6 | Whether the call starts on the tap | Not shown: no Phone app |
| S7 | Both kinds of reduction | What `simctl` can change |
| S8 (outside the go/no-go) | MapLibre draws Kartverket's tiles on the 16 KB-page image, with its libraries aligned for it | MapLibre draws Kartverket's tiles |

## Acceptance criteria

**SPIKE-01-AC1: the spike stands alone and is never shipped.**
Given the spike's code in `spikes/background-safety/`,
when the root gates run on the pull request and on the Mac
(`pnpm install --frozen-lockfile`, `gate:static`, `imports:check`,
`licenses:check`),
then:
- nothing under `apps/` or `packages/` imports it (the existing
  `spikes-are-throwaway` rule), and it imports nothing from `apps/`,
  `packages/` or `scripts/`;
- it is not a workspace package. The root `package.json`,
  `pnpm-workspace.yaml` and `pnpm-lock.yaml` do not change. Its dependencies
  are installed inside its own folder only, from its own lockfile;
- after a build on the Mac, `git status` shows no generated native folder and
  no raw results.

**SPIKE-01-AC2: debug builds of the spike app run the pinned SDK on both platforms.**
Given the spike app built on the Mac as a debug build with its JavaScript
bundled in,
on Expo SDK 57 with D-081's versions and the New Architecture,
with the SDK at one exact version and no licence key,
when it is installed on the Pixel 8 emulator (`android-37.2`,
`google_apis_ps16k`, x86_64) and on an iPhone simulator from the Mac's
Xcode 26.0.1, and a journey is started,
then on each device the SDK starts tracking and the receiver gets its first
upload. This happens with no licence failure from the SDK, no Metro server
running, and no Apple, Google or Expo account.

If the pinned SDK does not support Expo SDK 57 or the New Architecture, AC2 has
**failed**. It has also failed if its native code does not load on the 16 KB-page
image, or loads only in a compatibility mode because its native libraries are
not aligned for 16 KB pages (verify: `zipalign -c -P 16` on the APK). Newer
Android versions may run unaligned apps in such a mode (verify), so running
alone does not prove alignment. Step 2 stops and reports a failure. It is not
worked around.

**SPIKE-01-AC3: the receiver measures on one clock and keeps no location.**
Given the throwaway receiver, listening on the Mac's loopback address only,
when the SDK uploads to it,
then for each request it:
- records the arrival time on the Mac's clock, taking durations from a
  monotonic source, so a clock correction mid-run cannot create or hide a gap;
- records only what the checks need: the platform, the SDK's record ID, the
  time the phone recorded it, whether it carried a position (yes or no), and
  the status fields the app adds (the SDK's queue count, the location
  permission, the battery-optimisation exemption);
- drops latitude, longitude and anything else that locates the device before
  anything is stored or printed;
- prints no request body;
- confirms receipt the way the SDK expects, except while a scenario tells it
  to refuse;
- writes a tick of its own every 10 s, so the analysis can tell a receiver
  outage from a silent phone;
- writes its records outside the repository, in `claude-dev`'s home.

**SPIKE-01-AC4: every route is synthetic.**
Given the route generator,
when it builds the journey from its made-up waypoints and a fixed seed,
then:
- the route lasts 45 minutes at walking pace;
- it includes at least one stop of 5 minutes or more. D-021's threshold is 5
  minutes, a stop is where a false lost-contact alert would come from, and it
  is where the SDK changes state;
- it is the same on every run and on both platforms.

No recorded track is used or committed. No waypoint is anyone's home or a
route anyone walks.

**SPIKE-01-AC5 (S1): 45 minutes in the background, no gap longer than 2 minutes.**
Given a journey started in the spike app and the route (AC4) replaying,
when the app runs for 45 minutes:
- on the Android emulator, with the screen off and the virtual battery
  unplugged, and nothing else forced (verify: `dumpsys battery unplug`,
  `input keyevent KEYCODE_SLEEP`);
- on the iOS simulator, with the app in the background, and the device locked
  if a script can lock it (the results say which);

then no two consecutive arrivals at the receiver are more than 120 s apart.

- **Shown:** the SDK's background configuration and upload path, stock
  Android with the screen off on battery, and how the SDK behaves at the stop.
- **Not shown on simulators:**
  - battery use (S1's ⚙️ 10 % limit): the emulator's battery is simulated and
    the simulator has none, and no other figure stands in for it;
  - real iPhone background limits, and any real Android phone;
  - the SDK's motion detection: neither device has a real accelerometer or
    activity recognition. The spike puts the SDK in its moving state at
    journey start, and records what the SDK did at the stop;
  - other OS versions: one Android API level and one iOS runtime.
- **Recorded:** the largest gap, the number of gaps over 60 s and over 120 s,
  and the SDK's state changes.

**SPIKE-01-AC6 (S2): after a swipe, the reminder fires before the lost-contact threshold.**
Given a running journey, with the app keeping a local reminder scheduled
⚙️ 2 minutes ahead and moving it forward on each heartbeat (the reminder rule),
when the app is ended mid-journey, one way per run:
- Android: swiped away from the recent-apps screen by script; and, separately,
  its process killed the way Android's low-memory killer would;
- iOS: `simctl terminate` (verify). The results say that this is not proven to
  be what iOS does on a user's swipe;

then, in every case where arrivals at the receiver stop, the reminder is
delivered within 5 minutes of the last arrival. That is before the lost-contact
alert that D-021 sets. The results record the actual delay against the
⚙️ 2 minutes the rule schedules. Delivery is read from the platform's own record
of delivered notifications, with its time (verify: the notification service's
dump on Android; on iOS, the app's list of delivered notifications, read when
the app is next opened).

- **Where arrivals do not stop** (Android may keep a location service running
  after a swipe), the case passes if no gap exceeds 120 s. The results say
  whether the reminder fired anyway. "Protection stopped" shown while
  protection runs is a finding for the owner, not a pass.
- **Recorded, not judged:** Android's Force stop, from Settings. By Android's
  design it cancels the app's scheduled alarms, so the reminder is expected not
  to fire. The results say what happened.
- **Not shown on simulators:**
  - phone makers that treat a swipe as a force stop;
  - whether iOS treats `simctl terminate` like a user's swipe;
  - whether a real iPhone delivers the reminder on time.

**SPIKE-01-AC7 (S3, Android): stock Android's restrictions, with and without the exemption.**
Given the journey and the route on the Android emulator,
when for 45 minutes the device is held in Android's own restrictions (screen
off, battery unplugged, deep Doze forced, the app in the restricted standby
bucket; verify: `dumpsys deviceidle force-idle`, `am set-standby-bucket`),
once with the app exempt from battery optimisation and once without,
then:
- with the exemption, no gap between arrivals exceeds 120 s;
- without it, the app's own check reports that it is not exempt, and that
  report reaches the receiver before the restrictions start. So the missing
  exemption is detectable before a walk goes wrong. The results record what
  the restrictions then did to the arrivals.

- **Not shown on simulators:** every phone maker's battery manager, Samsung's
  included. That is the failure S3 is about, and it stays open under D-037.
  Also not shown: real Doze timing in a pocket.
- **iOS:** not applicable. iOS has no per-app battery exemption, and S3 is
  about Android phone makers.

**SPIKE-01-AC8 (S4): positions recorded offline arrive, in order, after 3 minutes offline.**
Given a journey moving along the route,
when the device is cut off from the receiver for 3 minutes mid-walk and then
reconnected:
- Android emulator: airplane mode on, then off (verify:
  `cmd connectivity airplane-mode`);
- iOS simulator: it has no airplane mode and shares the Mac's network, so the
  receiver refuses connections for the 3 minutes instead. The results say
  that the radio was not off;

then, after reconnecting:
- every position the SDK held in its on-device queue when the window closed
  reaches the receiver, with none missing;
- they arrive in the order the device recorded them;
- once the receiver confirms them, the SDK's queue on the device is empty, as
  the app reads it from the SDK and reports it.

- **Recorded, not judged:**
  - the time from reconnecting to the first and the last arrival. 3 minutes
    offline plus this must stay under D-021's 5 minutes, or a tunnel becomes a
    false alarm (F2);
  - duplicates;
  - whether heartbeats while offline were queued too.
- **Not shown on simulators:** iOS with its radio off; real coverage loss such
  as tunnels, lifts and cell handovers (RR-03).

**SPIKE-01-AC9 (S5): the alert is seen, and heard where the platform allows it, on a silenced device.**
Given the spike app's alert, a fixed content-free text with no name, no number
and no position,
when it arrives while the device is silenced:
- Android emulator: posted by the app on its high-priority alert channel, with
  Do Not Disturb on and the ringer silent. The channel's permission to override
  Do Not Disturb is granted by script, the way a responder would grant it in
  setup (verify: `cmd notification set_dnd`, `cmd notification allow_dnd`). If
  the grant cannot be scripted, the override is not shown;
- iOS simulator: delivered as a push with `simctl push` (no Apple servers
  involved), at the Time Sensitive interruption level;

then:
- **Android:** the system's own notification record shows the alert was shown
  and not suppressed by Do Not Disturb. The platform's own audio record shows
  its sound started on a stream that the silent ringer does not mute. If no
  such record exists, "heard" is not shown on the emulator;
- **iOS:** the alert is delivered and presented, as read from the platform's
  own list of delivered notifications;
- **both:** the payload and the shown text match the fixed text exactly, with
  no other keys or values.

- **Not shown on simulators:**
  - anything actually heard. Nothing listens to either device's audio; for
    the iPhone this is RR-01;
  - the iPhone's silent switch (the simulator has none);
  - Time Sensitive breaking through a Focus, unless a script can set one;
  - Critical Alerts. They need Apple's entitlement, whose request is its own
    M1 item and needs the Apple Developer account (A-02) to be sent;
  - real push delivery through APNs and FCM (A-02, A-11).

**SPIKE-01-AC10 (S6): one-tap calling is written down for both platforms.**
Given the spike app's call button and a synthetic number from a range reserved
for fiction (never 112 or any emergency number, and never a Norwegian mobile
number, which HK-07 blocks outside the test kit's fixtures file),
when the button is tapped on the Android emulator,
then the results record, from the emulator's own list of calls (verify: the
emulator console's `gsm list`):
- whether the call started on the tap alone;
- which Android mechanism and permission that took;
- what happens without that permission (the dialer opens and waits for a
  second tap).

On iOS the simulator has no Phone app, so the call is **not shown on
simulators**. The results write down Apple's documented behaviour for opening a
`tel:` link, cite the source, and mark it "documented, not observed". The
one-tap call story expects at most one system confirmation on an iPhone; that
stays open.

Pass: the behaviour is documented for both platforms, and Android's is observed.

**SPIKE-01-AC11 (S7): reduced location permission is detected within 1 minute.**
Given a journey moving along the route,
when the app's location permission is reduced mid-journey, one way per run:
- Android: from "all the time" to "only while using", and from precise to
  approximate (verify: `pm revoke` of the background and fine location
  permissions, which Android handles like the change in Settings);
- iOS: from "Always" to "While using", with `simctl privacy` (verify). Any
  change `simctl` cannot make is not shown on simulators;

then within 60 s of the change, on the Mac's clock, the receiver gets a report
from the app that location access was reduced.

- **Recorded, not judged:**
  - whether the platform ended the app's process on the change;
  - whether heartbeats kept arriving without positions;
  - if the app could not report, what did notice: the reminder (AC6), or only
    the server's silence after 5 minutes.
- **Not shown on simulators:** the real Settings screens on phones, and the
  iPhone's precise-to-approximate change if `simctl` cannot make it.

**SPIKE-01-AC12: the SDK sends to our receiver and to no one else, and the tools send nothing.**
Given one S1 run on the Android emulator with its network traffic captured
(verify: the emulator's `-tcpdump` option) and no Google account on the device,
when the capture is read after the run,
then:
- every destination is listed in the results;
- the app's uploads go only to the receiver;
- no destination belongs to the SDK's vendor or to an analytics or advertising
  service. Google's own services on the image are listed as the platform's.

Wherever the spike runs:
- Maestro runs with `MAESTRO_CLI_NO_ANALYTICS` and
  `MAESTRO_DISABLE_UPDATE_CHECK=true` (D-081 item 6), and Expo with
  `EXPO_NO_TELEMETRY=1`;
- the app never asks for an Expo push token. That would go through Expo's push
  service, which `04-tech-stack.md` finding 4 rules out;
- the SDK's own log is kept at the level that reports errors only, because
  more verbose levels may write positions to the device log.

- **Not shown:**
  - iOS: the simulator shares the Mac's network, so its traffic cannot be told
    apart without admin rights;
  - what a release build with a licence key sends.

**SPIKE-01-AC13: every run counts.**
Given the scenarios S1–S8 and each of their cases,
when they run,
then:
- each runs at least twice on each platform it applies to;
- every run is reported;
- a scenario passes on a platform only if every valid run passed.

A run is **invalid** only when the harness broke: the emulator or simulator
exited, the receiver's ticks stopped, or the Mac slept. It is reported as
invalid, with that evidence, and run again. A failed run is never re-run to
replace it (D-060).

**SPIKE-01-AC14: the results document.**
Given the runs are done,
when `docs/plan/04b-spike-results.md` is written,
then:
- it follows the structure under "The results document";
- every verdict is passed, failed or not shown on simulators;
- every number comes from the analysis's output, with the run it came from;
- every "not shown" says where it will be shown: L9, which must pass before the
  group relies on the app (D-041);
- it contains no coordinates, no phone number and nothing about a real person.
  The repository is public (since 2026-09-28, `docs/progress/m0.md`).

**SPIKE-01-AC15: the go/no-go recommendation follows the rule, and the owner decides.**
Given the verdicts,
when the go/no-go rule (under "The results document") is applied,
then:
- the analysis prints the recommendation the rule gives, GO or NO-GO, with
  each item's result;
- the licence terms and the price are read by hand and recorded;
- the owner is asked, with that recommendation, because the $399 is a cost
  (D-023, D-031);
- the answer is recorded as a decision, with the SDK's version, its licence
  terms and the spike's tool choices (D-031).

**SPIKE-01-AC16 (S8): MapLibre draws Kartverket's tiles on both devices. This is outside the go/no-go.**
Given:
- the spike app's map screen, with MapLibre React Native pinned to one exact
  version, on Expo SDK 57 and the New Architecture;
- a style written in the app, whose only source is Kartverket's topographic
  raster tiles, fetched straight from Kartverket;
- a public landmark area as the tile source: **Galdhøpiggen**, Norway's highest
  mountain, where nobody lives and nobody walks home. No made-up coordinates
  are needed, and no place of a real person is shown;

when the screen opens on the Pixel 8 emulator (`android-37.2`,
`google_apis_ps16k`, x86_64) and on the iPhone simulator, centred on that area,
at three zoom levels whose view lies wholly inside Norway, down to the most
detailed level Kartverket serves,

then on each device:
- **the tiles are drawn.** Once MapLibre reports that the map has finished
  rendering, a screenshot of the map shows Kartverket's tiles, not the style's
  background. The background is a sentinel colour that Kartverket's map does
  not use, so a map with no tiles is nearly all sentinel. Pass: at most 1 % of
  the map's pixels are the sentinel colour (verify the screenshot format: raw
  `screencap` on Android, `simctl io … screenshot` on iOS);
- **there is no native crash.** The app's process is still running, and there
  is no crash for it in Android's crash log or in the simulator's crash
  reports;
- **on Android, the build works on the 16 KB-page image**, and MapLibre's
  native libraries are aligned for 16 KB pages (verify: `zipalign -c -P 16`).
  The app is therefore not running in a compatibility mode.

Also read by hand, and quoted with their source in the results:
- Kartverket's own terms and licence for the tiles, its rate limits, and the
  attribution it asks for. Finding 9 only says that third parties credit the
  tiles as CC BY 4.0. The map shows the attribution the terms ask for;
- MapLibre's licence at the pinned version, for the JavaScript package and for
  the native libraries it pulls in through Gradle and CocoaPods;
- **stop and ask the owner** if Kartverket's terms forbid direct use from an
  app, need an account or a key, or cost money.

- **Recorded, not judged:**
  - the tile address and format used;
  - the destinations in a network capture of one Android run. Only Kartverket
    is expected, because the style is written in the app and uses raster tiles
    only: no fonts, sprites or demo servers are fetched.
- **Privacy.** Tiles come straight from Kartverket for now, because the tile
  proxy (D-026) is later work. So the Mac's IP address reaches Kartverket. No
  personal data goes with it: the requests name only the landmark area, and
  the map shows no device location (no user-location layer). The screen is
  never opened during S1–S7 runs.
- **Not shown on simulators:** rendering speed and memory on real phones, and
  the tile proxy.
- **Pass:** on both devices the tiles are drawn with no native crash, and the
  Android build works on the 16 KB-page image.
- **Fail:** recorded as a finding for D-026, for the owner. It is **not** a
  NO-GO for the location SDK.

## Test plan

The spike's runs use L7's tools: Maestro, the emulator and the simulator. They
are not L7 tests: they run on the Mac, not in CI, and they are not kept. What
they cannot show belongs to L9 (D-037, D-041).

The judging code gets unit tests. These are pure functions over synthetic
records, like L2, but they live in the spike. They are `*.test.mjs` files run
with Node's built-in test runner (`node --test`) by the spike's own script.

| AC | Test (`test-author`) | Evidence | Where |
|----|----------------------|----------|-------|
| AC1 | None new: the `spikes-are-throwaway` rule and the root gates | `static`, `unit` and `security` green on the PR; `git status` after a build, quoted in the PR | CI; the Mac |
| AC2 | None: the build runs or it does not | The first upload from each device, and the versions | The Mac |
| AC3 | Receiver: a request with coordinates leaves none in the record or the output; loopback only; refuses on command; ticks | Receiver output | The Mac |
| AC4 | Route: same seed, same route; 45 min; a stop of 5 min or more; walking pace | — | The Mac |
| AC5 | S1 verdict: a 120 s gap passes and 121 s fails; missing receiver ticks make a run invalid, not failed | At least 2 runs per device | The Mac |
| AC6 | S2 verdict: a reminder at 5 min 1 s fails; arrivals that never stop pass under the 120 s rule; a reminder while arrivals continue is a finding | Runs | The Mac |
| AC7 | S3 verdict: with the exemption, one gap over 120 s fails; without it, no "not exempt" report before the restrictions fails | Runs | The Mac |
| AC8 | S4 verdict: a missing position, an out-of-order arrival, or a queue left non-empty each fail | Runs | The Mac |
| AC9 | Payload check: an extra key, or any change to the fixed text, fails | Runs | The Mac |
| AC10 | The call-record reader, on sample output | Runs; the cited source for iOS | The Mac |
| AC11 | S7 verdict: a report at 60 s passes and at 61 s fails | Runs | The Mac |
| AC12 | Capture reader: lists destinations and flags a vendor host | One capture | The Mac |
| AC13 | Two runs with one failed gives failed; an invalid run is listed, never counted as passed | — | The Mac |
| AC14 | Results renderer: uses only the three verdict words; refuses a number shaped like a coordinate | The results document | The Mac |
| AC15 | The rule: "not shown" never passes an item; any failed SDK item gives NO-GO; S2, S5, S6 and S8 give findings, not NO-GO | The recommendation | The Mac |
| AC16 | Sentinel check on sample screenshots: all sentinel fails, drawn tiles pass, the 1 % boundary holds; the crash-log reader, on sample output | At least 2 runs per device; the terms and licences quoted by hand | The Mac |

**Nothing in CI runs these tests, and the stop gate does not either.** The root
`test:unit` does not collect `spikes/` (`vitest.shared.mjs`), and the per-edit
gate skips it (`gate-file.mjs`). So the main session runs them before every
commit and quotes the output in the pull request. **Red first:** the pull
request shows them failing before the analysis exists (DOD-02).

**Separation of duties.** `test-author` writes the `*.test.mjs` files, which
its path guard allows. `implementer` writes everything else, the Maestro flows
included. The flows only act: start a journey, lock, swipe, tap. They never
decide a verdict. Every verdict comes from the analysis, which works from the
receiver's records and the driver's timestamps, and `test-author`'s tests hold
the analysis. (`test-author`'s guard does not allow `spikes/**/e2e/**`, so a
verdict written into a flow would be in `implementer`'s hands.)

## Approach

### Where the code lives

```
spikes/background-safety/
├── README.md     what it is, how to run it, what must never be copied into the product
├── app/          Expo app: its own package.json, lockfile and app.config.ts; a journey screen and a map screen (S8)
├── receiver/     node:http, no dependencies
├── routes/       the generator and its made-up waypoints
├── drivers/      one script per scenario and platform, and the Maestro flows
└── analysis/     pure functions: verdicts, results tables, the go/no-go rule; *.test.mjs
```

- **The app is outside the workspace.** `pnpm-workspace.yaml` lists `apps/*`
  and `packages/*`, so `spikes/` is not a member. The app is installed on its
  own, for example with `pnpm install --ignore-workspace` and its own lockfile.
  Step 2 checks that the root stays untouched (AC1). A proprietary SDK
  therefore never enters the root lockfile, and deleting the folder removes the
  spike completely.
- **It uses the app's stack.** Expo SDK 57 and React Native 0.86.3, installed
  with `expo install` (D-081 item 1), so the result speaks for `apps/mobile`.
- **No Expo Router.** There is a journey screen and a map screen for S8,
  switched with plain state. This leaves out the drawer dependencies that D-081
  item 3 had to hold back. The root's `packageExtensions` would not reach an
  install outside the workspace anyway.
- **No 112 button.** The spike's call button dials only the synthetic number.
- **The rest is plain `.mjs` on Node 22** with no dependencies, like
  `scripts/`.
- **How the root tools treat it.** ESLint ignores `spikes/**`. Type checks and
  import rules do not read it. Prettier does: `static` runs
  `prettier --check .`, and `.prettierignore` does not exclude `spikes/`. So
  spike files are kept formatted.
- **The root `.gitignore` gains the spike app's generated `ios/` and
  `android/` folders.** Today it names only `apps/mobile/ios/` and
  `apps/mobile/android/`. Without this line, git and Prettier would both see
  the generated projects after a build.

### Builds on the Mac

**Android:**
1. `expo prebuild --platform android --clean` in `app/`.
2. Gradle builds the debug variant for x86_64 only, with the JavaScript bundle
   embedded (verify: React Native's Gradle setting for which variants skip
   bundling). It uses JDK 17 (D-081 item 10).
3. `adb install -r` on the Pixel 8 virtual device, started with no window.
   Colima is stopped first: with 16 GB, the two do not fit together (INF-06
   risk R14).

**iOS:**
1. `expo prebuild --platform ios --clean`, then CocoaPods.
2. `xcodebuild`, Debug configuration, for the simulator SDK on x86_64 (an Intel
   Mac), with the JavaScript bundle embedded (verify).
3. `xcrun simctl install`, then `launch`, on an iPhone simulator. This needs no
   signing identity and no Apple account.

**Why debug builds:** the SDK is free in debug builds and needs a licence in
release builds (finding 2).

**Why bundled JavaScript:** a 45-minute run cannot depend on Metro staying up.
A Metro failure would look like a background failure.

**First job at step 2: prove the iOS toolchain.** `claude-dev` has never built
for iOS; INF-00 only checked that a simulator exists. Stop and report if:
- Expo SDK 57 needs a newer Xcode than 26.0.1, which is this Mac's ceiling
  (`M0-kickoff.md`);
- CocoaPods is missing. Installing it needs admin rights, so it is an owner
  action (D-056);
- the simulator will not boot in `claude-dev`'s session while another user is
  at the screen.

The fallback is an EAS simulator build. It needs Expo's account (A-07) and a
token on the Mac, and it uploads the spike's code to Expo, so the owner is
asked first.

### The SDK

- **What:** `react-native-background-geolocation` from npm, and the companion
  package it requires (verify: `react-native-background-fetch`).
- **Pinned:** each at one exact version, no range, with the spike's lockfile
  committed.
- **Which version:** the newest whose documentation supports Expo SDK 57, React
  Native 0.86 and the New Architecture. Step 2 checks this and records it
  (D-031).
- **Native settings:** the Expo config plugin that ships with the package sets
  the permissions and background modes.
- **Uploads:** each record goes by HTTP POST to the receiver, at least once
  every 60 s in both the moving and the stationary state. On Android the
  address is `http://10.0.2.2:<port>` (the emulator's name for the Mac's
  loopback); on iOS it is `http://localhost:<port>`. The results record the
  settings used, for M3.
- **"Debug mode" means debug builds.** The SDK's own `debug` option plays
  sounds and posts its own notifications. It stays off, so nothing it posts can
  be mistaken for S2's or S5's notifications.
- **Cleartext HTTP to the loopback address is for the spike only.** The
  product talks HTTPS and authenticates each device (the faked-heartbeats
  threat). That is M2's endpoint, not this one.

**Licence and cost (D-031, SEC-06, `licenses:check`):**
- **The spike costs $0.** Debug builds need no licence (finding 2, D-023). The
  $399 licence is for release builds. It is bought only after a GO, and the
  owner decides (D-023, D-024, A-13).
- **The licence has not been read in this session.** Step 2 reads the
  package's licence file and its `package.json` licence field at the pinned
  version, and the vendor's terms. It quotes them in the decision. **Stop and
  ask the owner** if:
  - the terms restrict evaluation in debug builds;
  - the SDK sends data to its vendor or anyone else;
  - the price is no longer $399.
- **`licenses:check` cannot see the spike.** It lists the root workspace
  (`pnpm licenses list`).
- **A gap to flag for later.** `licenses:check` reads the licence npm declares.
  If the JavaScript package declares a permissive licence while its native
  libraries are under the vendor's own terms, `licenses:check` would pass the
  SDK in M3 without a word. The go/no-go decision records the real terms. The
  M3 task that brings the SDK into `apps/mobile` must handle them explicitly.
- **SEC-06 ("keep dependencies few").** The spike's dependencies stay outside
  the product and never reach CI's audit. They are pinned exactly, and the
  lockfile is committed. pnpm 10 skips install scripts by default. The results
  list the Maven and CocoaPods sources the builds fetched from, since Gradle and
  CocoaPods dependencies are not audited yet (INF-06's open follow-up).

### The map (S8)

- **What:** MapLibre React Native, the library D-032 chose (verify the package
  name, `@maplibre/maplibre-react-native`), with its Expo config plugin.
- **Pinned:** one exact version, in the spike's lockfile.
- **Which version:** the newest that supports Expo SDK 57 and the New
  Architecture (D-031). If none does, S8 has failed: a finding for D-026.
- **The style is written in the app.** It has one raster source, Kartverket's
  topographic tiles, with the attribution Kartverket asks for, and a sentinel
  background colour. No style, fonts or sprites are fetched from anyone, so
  MapLibre's own demo servers are never contacted.
- **The screen is separate from the journey.** It has no user-location layer,
  and it is never opened during S1–S7 runs, so it cannot affect the location
  SDK's results.
- **Licence and cost (SEC-06, `licenses:check`):**
  - **It costs $0.** MapLibre is open source (D-026), and Kartverket's tiles
    are free, under terms that step 2 reads and quotes (finding 9).
  - **SEC-06.** MapLibre is one more native dependency, but it stays in the
    spike and never reaches CI's audit.
  - **`licenses:check` cannot see it,** because the spike is outside the
    workspace.
  - **The same gap as the SDK's.** When MapLibre enters `apps/mobile` in M3,
    `licenses:check` will read the npm package's declared licence. It will not
    read the licences of the native libraries that Gradle and CocoaPods fetch.
    The decision records both, and the M3 task handles them explicitly.

### The receiver, and why not staging

`04-tech-stack.md` says the server measures the heartbeat gaps. Three places
could play the server:

| | Staging | `apps/server` locally on the Mac | A throwaway receiver in the spike |
|---|---|---|---|
| New product code | Yes. A heartbeat endpoint in `apps/server`, with its contract and tests, is M2's design. Built now, it would go live without per-device authentication | Yes, the same endpoint | None |
| Where synthetic positions go | Clever Cloud's database and logs | A local PostgreSQL in Colima, which cannot run beside the emulator on 16 GB | Nowhere: dropped on arrival |
| Clocks | The server's for arrivals, the Mac's for the driver's actions: two clocks | One | One: the Mac's |
| Exposure | An endpoint on the internet | Local | Loopback only |

**Chosen: the throwaway receiver.** Against the privacy rules:
- **Synthetic only (RG-07).** The route is generated from made-up waypoints and
  a seed (AC4). Nothing is recorded from a walk.
- **The no-locations-in-logs rule.** The receiver never stores or prints a
  position. It does not need one: gaps, order, queue and detection are all
  worked out from times, IDs and flags.
- **Nothing leaves the Mac.** The receiver listens on loopback only, and its
  records stay in `claude-dev`'s home.
- **The server's clock.** Gaps are measured on the receiver's clock, never the
  device's. That is the principle REL-01 sets for the product. The device's own
  timestamps are used only to check order.

### Runs, and Mac time

Two runs each (AC13):
- S1: 45 minutes × 2 devices × 2 runs = 3 hours;
- S3: 45 minutes × 2 cases × 2 runs = 3 hours;
- S2, S4 and S7: about 10 to 15 minutes per case and run, about 2 hours in all;
- S5, S6 and S8: minutes.

That is about **8 to 9 hours of Mac time**, one device at a time. Overnight is
fine. The Mac stays on power and awake (A-10), and each run holds a
`caffeinate`. Between runs, every forced state is reset (Doze, standby bucket,
battery, Do Not Disturb, ringer, airplane mode, permissions), and the app's
data is cleared.

### CI

**Nothing new.** No workflow is edited, no required check is added, and
`ai-review.yml` is not touched (D-075). On the spike's pull requests:
- `static` checks the spike files' formatting (Prettier);
- `unit` does not collect spike tests;
- `traceability` counts spike tests as test files, which is why they never name
  a tracked requirement;
- `security` runs gitleaks over the repository's git history, spike files
  included, while `licenses:check` and `pnpm audit` read the root workspace
  only;
- `android-e2e` finds nothing to check. `touchesApp` looks at `apps/mobile/`,
  the app's workspace closure, the root install files, `ci.yml` and the e2e
  script's imports.

**CODEOWNERS** (read from `.github/CODEOWNERS`): `spikes/`, `docs/specs/`,
`docs/plan/04b-spike-results.md` and `.gitignore` are not owned.
`docs/plan/decisions.md` is. So the go/no-go decision needs the owner's
approval, which is right, because the decision is the owner's.

**Reviews at step 5:** `code-reviewer`, and also `safety-reviewer` and
`privacy-security-reviewer`, whether or not ai-review's path filters select
them. The results are the evidence for a safety decision. The spike also
brings a proprietary SDK, a network capture, route data, and a map that fetches
tiles from a third party.

## The results document

`docs/plan/04b-spike-results.md` has these parts:

1. **Header:** date, the spike's commit, every version (SDK, Expo, React
   Native, Xcode, simulator runtime, emulator image, JDK, Maestro), and how to
   re-run it.
2. **Summary:** S1–S8 against the Android emulator and the iOS simulator. Each
   cell holds a verdict and its runs (valid and invalid). S8 is marked as
   outside the go/no-go.
3. **One section per scenario:**
   - what ran: script, route, actions and their times;
   - the numbers, from the analysis;
   - what was not shown, and where it will be;
   - findings.
4. **The SDK:**
   - its version and pin, its licence terms quoted, and its price as checked;
   - what it sent (AC12);
   - the shape of its upload request, as field names only, for M2's endpoint;
   - the settings used, for M3.
5. **The map (S8), outside the go/no-go:**
   - MapLibre's version, and its licence for the JavaScript package and the
     native libraries;
   - Kartverket's terms, licence, rate limits and attribution, quoted with
     their source;
   - the tile address and format, and the area used;
   - the verdict on each device, including the 16 KB alignment;
   - the destinations the capture saw;
   - any finding for D-026.
6. **Findings against binding rules.** Wherever a platform cannot do what a
   rule asks, that is written down for the owner. This covers the reminder
   rule, the alert-level rule, the one-tap call story, the location-loss rule
   and the offline-queue rule.
7. **Open under D-037.** Every "not shown", with where it will be shown (L9,
   D-041), and RR-01 to RR-04 where they apply.
8. **Invalid runs**, each with its evidence.
9. **Go/no-go:** the rule applied item by item, the recommendation, and the
   owner's answer with its decision number.

Any ⚙️ threshold the results suggest changing is a proposal for the owner. This
covers the heartbeat interval, the 5-minute threshold and the reminder's
2 minutes. The spike itself changes none (D-021).

### The go/no-go rule

**GO** needs every one of these items, on both devices unless marked:
1. AC2: the pinned SDK builds and runs in debug builds on Expo SDK 57, with the
   New Architecture, and on the 16 KB-page image.
2. S1 passed (AC5).
3. S4 passed, including the queue emptying (AC8).
4. S3 passed with the exemption (AC7). Android only.
5. S7 (AC11): wherever the platform keeps the app's process running after the
   change, the SDK reported the change within 60 s. A platform that ends the
   process does so for any SDK, so that is recorded as a finding and not
   counted against this SDK.
6. AC12: nothing is uploaded to anyone but our receiver.
7. The licence and price, read at step 2 (read, not computed): nothing
   restricts the intended use, nothing sends data out, and the price is still
   $399.

**NO-GO** follows when any item fails and none of the SDK's documented settings
fixes it. Every setting tried is recorded. NO-GO leads to D-023's fallback:
native modules for the background part. That needs its own owner decision and
plan, and M1's exit is not met until it has one.

**What never decides:**
- **"Not shown" is never a pass and never a NO-GO.** It is listed as open. A GO
  means "GO on emulator and simulator evidence, with these parts open until L9".
- **S2, S5 and S6 do not decide the SDK.** They test notifications and calling,
  not the SDK. Their failures are findings for the owner, against the rules
  they test.
- **S8 does not decide the SDK.** It tests the map library and Kartverket's
  tiles. A fail is a finding for D-026.

**The owner decides**, because the $399 is a cost (D-031). The recommendation
goes to the owner as one question, with the rule's result.

**When the licence is bought is settled with the go/no-go.** The plan
disagrees with itself here (see the last section).

### What "Section 4 closed" requires

1. `04b-spike-results.md` is merged and linked from the spike section of
   `04-tech-stack.md`.
2. The go/no-go decision is recorded and approved by the owner.
3. `04-tech-stack.md`:
   - status ✅, and the Summary filled in;
   - the spike section's stale lines corrected: the heading "on real phones",
     the device-farm sentence and S1's "real iPhone and real Samsung" (all
     superseded by D-037), and "tested on real walks" in Next steps (against
     D-035);
   - the "Proposed defaults" put to the owner and marked accepted or changed,
     since they are "accepted when Section 4 closes unless the owner objects";
   - Next steps rewritten.
4. D-026's spike items are answered by S8 (AC16) and quoted in the results,
   and finding 9's "To verify" is closed. If S8 failed, its finding goes to the
   owner with Section 4's close, because D-026 is binding and only the owner
   changes it.
5. The mechanism that the sharing-is-visible story leaves to Section 4 is
   written down: Android's location-service notification and the iPhone's
   background-location indicator, as the spike app used them.
6. `docs/plan/README.md` shows Section 4 as ✅, and there is a progress entry.
7. If the result is NO-GO, Section 4 stays open until the fallback is decided.

`plan-keeper` does this at step 8. It happens in the spike's pull request if
the owner has answered by then, or in a docs-only follow-up if not.

## Modules and files affected

**New**
- `spikes/background-safety/**`, as laid out above. `implementer` writes it,
  except the `*.test.mjs` files, which `test-author` writes.
- `docs/specs/SPIKE-01.md` (this file).
- `docs/plan/04b-spike-results.md` (`plan-keeper`).

**Changed.** The path marked ◆ needs the owner's approval (CODEOWNERS, D-042).

| Path | Change |
|------|--------|
| `.gitignore` | The spike app's generated `ios/` and `android/` folders |
| `spikes/README.md` | SPIKE-01 exists, and where its results are |
| ◆ `docs/plan/decisions.md` | The go/no-go decision (the owner's), with the SDK's version, its licence terms and the spike's tool choices; MapLibre's version and licences, and S8's result for D-026 |
| `docs/plan/04-tech-stack.md`, `docs/plan/README.md`, `docs/progress.md`, M1's progress log | Section 4's close, including finding 9's "To verify"; progress |
| `docs/plan/10-roadmap.md` | Only if the owner moves the licence purchase |

**Deliberately not touched:** `apps/**`, `packages/**`, `scripts/**`,
`.github/**`, `.claude/**`, the root `package.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, `vitest*.mjs` and `infra/**`. `CLAUDE.md` is not touched
either: its command list is the root's scripts, and the spike's commands are in
its own README.

## Contract changes

None. The receiver is not the API, and `packages/contracts` does not change.
The results record the shape of the SDK's upload request. That is input for
M2's heartbeat endpoint, which must take plain HTTP from native code
(`05-architecture.md` finding 3) and authenticate each device.

## Risks and failure modes

The spike touches no server, alert path or release. So F7 (server down), F8 (a
bad release) and F10 cannot be reached through it. F9 is not measured, because
the receiver keeps no positions. What the spike can do is **produce false
confidence** about F1 to F6.

| # | Risk | What it would look like | F | Mitigation |
|---|------|-------------------------|---|------------|
| R1 | A simulator pass read as a phone pass | "S1 passed" taken to mean background location survives on the group's phones | F3, F4 | Three verdict words; every "not shown" listed with L9; the decision says "on emulator and simulator evidence"; D-041 gates real use |
| R2 | The harness decides the result | Metro dies mid-run; the receiver stops; the Mac sleeps; a forced state leaks into the next run | F3 | Bundled JavaScript; receiver ticks; `caffeinate`; states reset between runs; invalid runs reported with their evidence; two runs each |
| R3 | The simulator is kinder than an iPhone | S1 passes on iOS where a phone would suspend the app | F3 | Said in AC5; the iOS side of a GO is weaker, and the results say so; L9 |
| R4 | Motion detection untested | On a phone, the SDK stops GPS at a stop and never restarts it | F3 | The route's 5-minute stop; the SDK's state changes recorded; listed as not shown |
| R5 | Swipe and force stop differ | The reminder fires after a swipe on the emulator but never after a force stop, which some phones do on a swipe | F4 | Force stop recorded (AC6); a finding for the owner |
| R6 | Permission loss ends the process | The app cannot report the change itself | F5 | Recorded (AC11); what noticed instead is recorded; a finding for the owner |
| R7 | "Seen" read as "heard" | S5 passes and the alert is assumed audible | F6 | "Heard" is its own line, not shown on simulators; RR-01 |
| R8 | Tunnels become false alarms | The flush after reconnecting takes too long | F2 | Measured and recorded (AC8); any threshold change goes to the owner (D-021) |
| R9 | A proprietary licence slips past `licenses:check` later | npm declares a permissive licence while the native terms are the vendor's | — | The decision records the real terms; the M3 task handles them explicitly |
| R10 | Positions leak | Synthetic coordinates in a log, a committed file, or the public results | — | Receiver drops coordinates; loopback only; raw data outside the repository; the SDK's log at errors only; results hold no coordinates; the route is generated |
| R11 | False coverage | A spike test names a tracked requirement, which then looks tested | — | Spike tests name `SPIKE-01-ACn` only; this spec names requirements in words |
| R12 | The Mac cannot build iOS | Xcode 26.0.1 is below Expo SDK 57's minimum; no CocoaPods; the simulator will not boot in `claude-dev`'s session | — | Prove the iOS toolchain first; stop and report; EAS simulator builds only after asking the owner |
| R13 | A spike-only setting reaches the product | Cleartext HTTP, permissions granted with `adb`, or forced states copied into `apps/mobile` in M3 | F8, later | The spike's README and the decision list them; the spike is never imported |
| R14 | Supply chain on the Mac | A compromised package runs as `claude-dev` | — | Exact pins and a committed lockfile; pnpm 10 skips install scripts; a Standard user with no admin rights (D-056); no secrets involved |
| R15 | Two sessions take the same decision number | The go/no-go decision collides with another pull request's | — | Check the open pull requests' `decisions.md` first (`docs/progress.md`, "Live gotchas") |
| R16 | A map that runs is taken for a map that works | MapLibre draws only its background, or the app runs in a 16 KB compatibility mode | — | The sentinel colour and the alignment check (AC16) |
| R17 | Kartverket's terms do not allow direct use | A key, an account, registration or a fee is needed, or the rate limit is tight | — | Stop and ask the owner; recorded as a finding for D-026 |
| R18 | The Mac's IP address reaches Kartverket | Tile requests go out from the owner's connection | — | No personal data: a public landmark area, no device location, no user; the tile proxy (D-026) that hides users' addresses is later work |
| R19 | S8's failure read as the SDK's | A MapLibre problem turns into a NO-GO for the location SDK | — | S8 is outside the go/no-go by the rule, and marked so in the results |

## Out of scope

- **Real phones and device farms,** and any account for one (D-037, D-041).
  The real-phone parts of S1–S3 stay open.
- **Buying the licence**, or its 30-day trial.
- **Any change to** `apps/`, `packages/`, the server, contracts, staging or CI.
- **Real push through APNs or FCM** (needs A-02 and A-11), and **the Critical
  Alerts request itself**, which is its own M1 item.
- **Measuring battery use.** No device here can.
- **Changing any ⚙️ threshold.**
- **Position accuracy** (F9).
- **Maps beyond S8:** the tile proxy (D-026), tile caching and offline maps,
  and the map responders see, with its design.
- **Translations, accessibility and design** of the spike's screen. It is a
  test fixture that nobody outside the spike sees. The rule that all app text
  goes through translation files (D-014) applies to `apps/mobile`.
- **Keeping any scenario as a permanent test.** The safety core's tests are
  M3's, and the real-phone suite is L9's.
- **iOS end-to-end tests in CI** (`e2e:ios`), which are their own task before
  M3's exit.

## Owner actions

- **Nothing is needed to start,** unless step 2 finds CocoaPods missing.
  Installing it needs the owner's admin account (D-056).
- **Only if Kartverket's terms ask for it:** an account or key for its tiles.
  S8 stops and asks first (AC16).
- **A-02 and A-03 are not needed for the spike.** Simulators and emulators need
  no developer account. A-02 is still needed to send the Critical Alerts
  request.
- **About 8 to 9 hours of Mac time**, on power, preferably overnight.

## Questions for the owner

None open now. Q1, Q2 and Q3 were asked and answered, and are kept below as
the record. One more question is asked later, with the go/no-go. The vendor answered
Q3 on 2026-09-30, and its licence now permits safety apps.

### Answered

**Q1: Does SPIKE-01 also check the map library and Kartverket's tiles
(scope)?**

**Answered by the owner 2026-09-29: (a).** S8 is SPIKE-01-AC16.

D-026 is binding. It says: "Verify Kartverket's terms and rate limits, and
MapLibre support for its tile format, in the spike." `04-tech-stack.md`
finding 9 says the same, and INF-06's spec expects "the M1 spike" to judge
MapLibre on the New Architecture. But the SPIKE-01 table (S1–S7) and the M1 row
of the roadmap do not list it. The first version of this spec left it out
until the owner decided.

Options:
- **(a) Yes, as a small separate check, S8.**
  - MapLibre is pinned in the spike app and shows Kartverket's tiles for a
    made-up area, on the emulator and the simulator, on the New Architecture
    and the 16 KB-page image.
  - Kartverket's terms and rate limits are read and quoted.
  - It does not count towards the location SDK's go/no-go.
  - Tiles come straight from Kartverket, because the tile proxy is later work.
    So the Mac's IP address reaches Kartverket, with no personal data.
  - It costs nothing, and about half a day.
- **(b) No; move it to the first map task in M3,** with a new decision
  amending D-026. The spike stays on S1–S7. A build problem with MapLibre is
  then found in M3, when changing library costs more.
- **(c) No, and leave it open.** Section 4 then closes with a binding decision
  unmet.

**Recommendation: (a).** D-026 already puts the check in the spike, the spike
app already has the right stack, and a map library that fails with Expo SDK 57
or the 16 KB image is cheapest to find now. S8 would get its own criterion, in
the same shape as the others.

**Q2: The Mac cannot build Expo SDK 57 for iOS. How does the spike get its iOS
build?**

**Answered by the owner 2026-09-30: an EAS simulator build.**

Step 2's first job, proving the iOS toolchain, was run on the Mac as
`claude-dev` on 2026-09-30. Two of its three stop conditions were met:
- **Xcode is too old.** Expo's SDK table (docs.expo.dev/versions/latest, read
  2026-09-30) lists "57.0.0 … iOS 16.4+ … Xcode 26.4+". The Mac has Xcode
  26.0.1 (17A400) with the iOS 26.0 simulator SDK, which `M0-kickoff.md`
  records as this Intel Mac's ceiling.
- **CocoaPods is missing** (`pod not found`, no gem). Homebrew's Cellar
  belongs to the owner's admin account, so `claude-dev` cannot install it.
  It would not help on its own, because Xcode would still be below Expo's
  minimum.
- **The simulator boots.** The iPhone 17 simulator (iOS 26.0.1) booted in 59 s,
  opened Settings, and took a screenshot. `claude-dev` was the console user at
  the time and no other user was logged in, so "while another user is at the
  screen" was **not** tested.

Options put to the owner: (a) an EAS simulator build; (b) Android only for now,
with iOS decided later; (c) the owner installs CocoaPods and the spike builds
with Xcode 26.0.1 below Expo's documented minimum. The recommendation was (a),
because under (c) a failure could not be told apart from a problem with the SDK.

What (a) means:
- The owner creates an Expo access token and puts it on the Mac for
  `claude-dev`. It is never committed or printed.
- The spike's code is uploaded to Expo's build servers. It holds no personal
  data: the routes are synthetic (AC4). It costs $0 on the free plan
  (`08-cicd-releases.md`).
- Expo's build machines, not the Mac, run Xcode and CocoaPods. The simulator
  build is then installed and run on the Mac's simulator with `simctl`, as
  above.
- **Not verified:** whether EAS's simulator build carries the x86_64 slice
  that this Intel Mac's simulator needs. EAS builds on Apple silicon. The
  first build is checked with `lipo -archs`; if x86_64 is missing, the spike
  stops and reports again.
- The versions in the results header (AC14) name the Xcode that EAS used,
  not the Mac's.

**Q3: The SDK's licence forbids "high-risk use" (its clause 9.5). What does
the spike do?**

**Answered by the owner 2026-09-30: continue the spike, and ask the vendor in
writing.** The vendor's answer decides go/no-go item 7.

Read at step 2 on 2026-09-30, from the vendor's licence agreement
(docs.transistorsoft.com/license, which the iOS podspec's licence text links
to):
- **Evaluation in debug builds is allowed.** 3.5: "The Software is fully
  functional in DEBUG builds without a License Key; the license-validation
  warning shown in DEBUG builds does not restrict functionality. DEBUG builds
  may be used for development and testing only and may not be distributed to
  End Users."
- **No data to the vendor, by the terms.** 7.1: "It transmits location and
  related data only to the server endpoints that Licensee configures in its
  Application. Licensor operates no server that receives that data". 7.2: the
  licence check "involves no network request to Licensor and transmits no
  data". AC12 still measures this.
- **The price is $399.** The product page lists "Starter - $399.00", for one
  app on both platforms.
- **The tracking engine is commercial on both platforms.** The npm package
  (5.7.0) declares MIT, and its `LICENSE` file is MIT. That covers only the
  wrapper. The engine it pulls in is separate:
  - `TSLocationManager` from CocoaPods, `~> 4.7.1`. Its podspec says
    `"type": "Commercial"`.
  - `com.transistorsoft:tslocationmanager` from Maven Central, `4.6.+`. Its
    POM names the licence "Commercial".

  This is R9, confirmed. Both are version ranges, so the spike pins them
  itself.
- **High-risk use is forbidden.** 9.5: "The Software is not designed or
  intended for use in any application in which its failure could lead to death,
  personal injury or severe physical or environmental damage, including
  life-support, safety-critical navigation, or use as the sole means of
  emergency response. Licensee shall not use the Software in such
  applications." The plan never weighed this. D-023 chose the SDK without it,
  and on a plain reading it covers this app. Only the vendor can say whether it
  does.

None of step 2's stop conditions was met: evaluation is allowed, no data goes
to the vendor, and the price is $399. So the spike goes on. Options put to the
owner: (a) continue, and ask the vendor; (b) pause the SDK runs until the
vendor answers; (c) treat it as NO-GO now and move to D-023's fallback. The
recommendation was (a). The terms allow the evaluation, the vendor's answer
takes days, and the receiver, the analysis, S5, S6 and S8 are needed whatever
the answer. The owner writes to the vendor at the notice address in its 14.5.

**The vendor's answer (2026-09-30).** The vendor replied that it had not been
aware of the clause and would change it, and that the licence was already
updated. Checked the same evening: the licence page read at 19:21 differs from
the 14:10 copy in two places only.
- **9.5 is now "Safety-related applications":** "Licensee may use the Software
  in Applications intended to help keep people safe, such as personal-safety,
  lone-worker, family location-sharing and check-in Applications." It also
  says the Software "is not designed, tested or certified as a safety-critical
  system", and that the Licensee is solely responsible "for designing the
  Application to allow for delayed, missing or inaccurate location data, and
  for anything the Application tells End Users about its reliability or about
  how to obtain emergency assistance".
- **The summary gained a line:** "Safety apps are welcome, including
  personal-safety, lone-worker and family location-sharing apps."

So the prohibition that concerned go/no-go item 7 is gone. What remains are two
duties that match the plan: fail loudly when locations are late or missing, and
say nothing in the app that overstates its reliability. Both versions are kept,
dated and with checksums, outside the repository (`~/spike-runs/licence/`), for
the results. The terms can change again, so the go/no-go decision quotes the
version read at the time.

### Asked with the go/no-go, not now

**When is the licence bought?** The plan disagrees with itself:
- the licence note in `04-tech-stack.md` says TestFlight and Google Play
  testing builds are release builds, so they need a licence (or the 30-day
  trial);
- the roadmap's M3 exit has the owner showing the app through those same
  tracks;
- but the roadmap buys the licence in M5 (A-13).

With a GO, the licence is needed by the first testing-track build that
includes the SDK. That point is M3, not M5. It does not block the spike, so it
is asked together with the go/no-go.
