# 4b · SPIKE-01 results — background safety on emulators and simulators

This document follows the structure in `docs/specs/SPIKE-01.md`, under "The
results document" (parts 1–9). It records what the spike found about the
location SDK (`react-native-background-geolocation`) and about MapLibre
drawing Kartverket's tiles (S8, outside the go/no-go), and applies the
go/no-go rule. It contains no coordinates and no phone number; Galdhøpiggen is
named only, never located (AC14). The repository is public.

**Three verdicts, plus a separate state, as the spec sets out.** Each
scenario gets one of three verdicts on each platform: passed, failed, or not
shown on simulators. "Not shown" is never a pass. A case with fewer than two
valid runs has **no verdict** at all — read as neither a pass nor "not
shown". Every "not shown" below says where it will be shown: **L9, the
automated real-device suite, which must be switched on and passing before
the group uses the app for real walks home (D-041).**

## 1. Header

**Drafted:** 2026-10-01. **Owner's go/no-go answer:** pending (part 9).

**Commits.**

| What | Commit |
|------|--------|
| Both builds (Android APK, iOS EAS build) built from | `20545d9` |
| `night-20260930` ran at | `e9753cc` |
| `night-20261001-s1-exempt` (the owner's Q4 case) ran at | `7023189` |
| Both nights re-judged (`manifest.rejudged.jsonl`) at | `a8de5ee` |
| The combined summary and the go/no-go output computed at | `0a91285` |

**Builds.** Android: a debug APK with its JavaScript bundled in. iOS: EAS
simulator build `b08e812d`, Debug configuration, also with a production
JavaScript bundle (the spike's own plugin makes that possible in a Debug
build; see `spikes/background-safety/README.md`). Both built from `20545d9`.

**Versions.**

| | |
|---|---|
| SDK (`react-native-background-geolocation`) | 5.7.0 |
| SDK's Android engine | `com.transistorsoft:tslocationmanager` 4.6.1, with `play-services-location` 21.3.0 |
| SDK's iOS engine | `TSLocationManager` 4.7.1 |
| MapLibre (`@maplibre/maplibre-react-native`) | 11.4.0 |
| MapLibre native (Android) | MapLibre Native 13.6.1 |
| MapLibre native (iOS) | MapLibre Native 6.31.0 (SwiftPM) |
| Expo SDK | 57.0.25 |
| React Native | 0.86.3 |
| Android emulator | Pixel 8, `android-37.2` `google_apis_ps16k` x86_64 |
| iOS simulator | iPhone 17, iOS 26.0.1 |
| The Mac's own Xcode (used only for `simctl`) | 26.0.1 (17A400) |
| EAS build image's Xcode (built the iOS app) | 26.6 (17F113), macOS 26.5.2, eas-cli 24.8.0 |
| JDK (Android build) | 17 (`jdk-17.0.20.1+1`) |
| Maestro | 2.10.0, with `MAESTRO_CLI_NO_ANALYTICS` and `MAESTRO_DISABLE_UPDATE_CHECK=true` |
| Node / pnpm pinned for the EAS profile | 22.23.2 / 10.33.0 |

**How to re-run.** From `spikes/background-safety/`:
- `node drivers/run-all.mjs --night night-YYYYMMDD` runs the full plan
  (resumable); `--only s1/android/exempt` runs one case alone, as the owner's
  Q4 case did;
- `node drivers/summarize.mjs --manifest <path> [--manifest <path> …]` prints
  each scenario's verdict, the invalid/valid counts and the go/no-go for one
  or more explicit manifests, read together (used for both nights here),
  against the runner's own plan, so a planned case that never ran shows "no
  verdict", never a silent pass. `summarize.mjs` also takes `--night
  night-YYYYMMDD` alone, for one night by its own manifest path — but it
  **ignores `--night` once any `--manifest` is given**, so the two forms are
  not combined;
- `node drivers/rejudge.mjs --night night-YYYYMMDD` re-judges a night's saved
  run folders against the current analysis code, writing
  `manifest.rejudged.jsonl` with the commit that judged it;
- `node drivers/results-tables.mjs --manifest <path> [--manifest <path> …]`
  prints this document's Summary and Numbers tables.

Full detail, including the build and driver commands, is in
`spikes/background-safety/README.md`.

## 2. Summary

Pasted unchanged from `results-tables.mjs` (`renderResults`, which refuses
coordinate-shaped numbers and phone numbers), computed at commit `0a91285`
from both nights' re-judged manifests:

## Summary

| Scenario | Android emulator | iOS simulator | Notes |
|----------|------------------|---------------|-------|
| S1 | failed (2 valid, 0 invalid) | failed (2 valid, 0 invalid) |  |
| S1 exempt | passed (2 valid, 0 invalid) | not applicable |  |
| S2 | failed (4 valid, 0 invalid) | passed (2 valid, 0 invalid) |  |
| S3 | passed (2 valid, 0 invalid) | not applicable |  |
| S3 not exempt | passed (2 valid, 0 invalid) | not applicable |  |
| S4 | passed (2 valid, 0 invalid) | passed (2 valid, 0 invalid) |  |
| S5 seen | passed (2 valid, 0 invalid) | passed (2 valid, 0 invalid) |  |
| S5 heard | failed (2 valid, 0 invalid) | not shown on simulators (2 valid, 0 invalid); to be shown at L9 (D-041) |  |
| S5 text | passed (2 valid, 0 invalid) | passed (2 valid, 0 invalid) |  |
| S6 | passed (4 valid, 0 invalid) | not shown on simulators (0 valid, 0 invalid); to be shown at L9 (D-041) |  |
| S7 | failed (4 valid, 0 invalid) | passed (2 valid, 0 invalid) |  |
| S8 | passed (2 valid, 0 invalid) | passed (2 valid, 0 invalid) | Outside the go/no-go |

**Reading the row names.** For S1, the bare row is the case **without** the
battery-optimisation exemption (AC5's default case); "S1 exempt" is the extra
case the owner asked for (Q4). For S3, the bare row is the case **with** the
exemption (AC7's go/no-go case); "S3 not exempt" is AC7's detection-only case.
Both are explained side by side in part 3.

## 3. Scenarios

**The route (AC4).** A 45-minute synthetic journey at walking pace, from
made-up waypoints and a fixed seed, the same on every run and on both
platforms. It includes one stop of about 6 minutes. No recorded track is used;
no waypoint is anyone's home.

The figures below are pasted unchanged from `results-tables.mjs`, computed at
commit `0a91285`:

## Numbers

| Scenario | Platform | What | Value | Run |
|----------|----------|------|-------|-----|
| S1 | android | largest gap | 802 s | 2026-09-30 s1-android-1 |
| S1 | android | gaps over 60 s | 2 | 2026-09-30 s1-android-1 |
| S1 | android | gaps over 120 s | 2 | 2026-09-30 s1-android-1 |
| S1 | android | largest gap | 602 s | 2026-09-30 s1-android-2 |
| S1 | android | gaps over 60 s | 2 | 2026-09-30 s1-android-2 |
| S1 | android | gaps over 120 s | 2 | 2026-09-30 s1-android-2 |
| S3 | android | largest gap | 109 s | 2026-09-30 s3-android-exempt-1 |
| S3 | android | gaps over 120 s | 0 | 2026-09-30 s3-android-exempt-1 |
| S3 | android | largest gap | 110 s | 2026-09-30 s3-android-exempt-2 |
| S3 | android | gaps over 120 s | 0 | 2026-09-30 s3-android-exempt-2 |
| S3 | android | largest gap | 967 s | 2026-09-30 s3-android-not-exempt-1 |
| S3 | android | gaps over 120 s | 1 | 2026-09-30 s3-android-not-exempt-1 |
| S3 | android | largest gap | 967 s | 2026-09-30 s3-android-not-exempt-2 |
| S3 | android | gaps over 120 s | 1 | 2026-09-30 s3-android-not-exempt-2 |
| S4 | android | held records missing | 0 | 2026-09-30 s4-android-1 |
| S4 | android | first held record after reconnecting | 3418 ms | 2026-09-30 s4-android-1 |
| S4 | android | last held record after reconnecting | 3673 ms | 2026-09-30 s4-android-1 |
| S4 | android | held records missing | 0 | 2026-09-30 s4-android-2 |
| S4 | android | first held record after reconnecting | 3091 ms | 2026-09-30 s4-android-2 |
| S4 | android | last held record after reconnecting | 3365 ms | 2026-09-30 s4-android-2 |
| S7 | android | report after the change | 6594 ms | 2026-09-30 s7-android-background-1 |
| S7 | android | report after the change | 6816 ms | 2026-09-30 s7-android-background-2 |
| S7 | android | no report of the change; arrivals after it | 0 | 2026-09-30 s7-android-fine-1 |
| S7 | android | no report of the change; arrivals after it | 0 | 2026-09-30 s7-android-fine-2 |
| S2 | android | arrivals continued after the app was ended; largest gap | 34 s | 2026-09-30 s2-android-swipe-1 |
| S2 | android | arrivals continued after the app was ended; largest gap | 34 s | 2026-09-30 s2-android-swipe-2 |
| S2 | android | arrivals continued after the app was ended; largest gap | 123 s | 2026-09-30 s2-android-lmk-1 |
| S2 | android | arrivals continued after the app was ended; largest gap | 122 s | 2026-09-30 s2-android-lmk-2 |
| S2 | android | reminders after the last arrival | 0 | 2026-09-30 s2-android-forcestop-1 |
| S2 | android | reminders after the last arrival | 0 | 2026-09-30 s2-android-forcestop-2 |
| S6 | android | call started on the tap (1 yes, 0 no) | 0 | 2026-09-30 s6-android-without-1 |
| S6 | android | call started on the tap (1 yes, 0 no) | 0 | 2026-09-30 s6-android-without-2 |
| S6 | android | call started on the tap (1 yes, 0 no) | 1 | 2026-09-30 s6-android-with-1 |
| S6 | android | call started on the tap (1 yes, 0 no) | 1 | 2026-09-30 s6-android-with-2 |
| S1 | ios | largest gap | 370 s | 2026-09-30 s1-ios-1 |
| S1 | ios | gaps over 60 s | 1 | 2026-09-30 s1-ios-1 |
| S1 | ios | gaps over 120 s | 1 | 2026-09-30 s1-ios-1 |
| S1 | ios | largest gap | 370 s | 2026-09-30 s1-ios-2 |
| S1 | ios | gaps over 60 s | 1 | 2026-09-30 s1-ios-2 |
| S1 | ios | gaps over 120 s | 1 | 2026-09-30 s1-ios-2 |
| S4 | ios | held records missing | 0 | 2026-09-30 s4-ios-1 |
| S4 | ios | first held record after reconnecting | 9909 ms | 2026-09-30 s4-ios-1 |
| S4 | ios | last held record after reconnecting | 10034 ms | 2026-09-30 s4-ios-1 |
| S4 | ios | held records missing | 0 | 2026-09-30 s4-ios-2 |
| S4 | ios | first held record after reconnecting | 13 ms | 2026-09-30 s4-ios-2 |
| S4 | ios | last held record after reconnecting | 120 ms | 2026-09-30 s4-ios-2 |
| S7 | ios | report after the change | 237 ms | 2026-09-30 s7-ios-always-to-inuse-1 |
| S7 | ios | report after the change | 219 ms | 2026-09-30 s7-ios-always-to-inuse-2 |
| S2 | ios | arrivals continued after the app was ended; largest gap | 91 s | 2026-09-30 s2-ios-1 |
| S2 | ios | arrivals continued after the app was ended; largest gap | 91 s | 2026-09-30 s2-ios-2 |
| S1 exempt | android | largest gap | 109 s | 2026-10-01 s1-android-exempt-1 |
| S1 exempt | android | gaps over 60 s | 3 | 2026-10-01 s1-android-exempt-1 |
| S1 exempt | android | gaps over 120 s | 0 | 2026-10-01 s1-android-exempt-1 |
| S1 exempt | android | largest gap | 109 s | 2026-10-01 s1-android-exempt-2 |
| S1 exempt | android | gaps over 60 s | 3 | 2026-10-01 s1-android-exempt-2 |
| S1 exempt | android | gaps over 120 s | 0 | 2026-10-01 s1-android-exempt-2 |

**Note on the table above, not a change to it:** the two Force stop rows in
S2 (`2026-09-30 s2-android-forcestop-1` and `-2`, "reminders after the last
arrival") are **recorded, not judged**, as AC6 says — by Android's own
design, Force stop cancels the app's scheduled alarms, so 0 reminders was
expected, not a pass or fail condition for this case.

### S1 — 45 minutes in the background (AC5)

**What ran.** `drivers/s1-android.mjs` and `drivers/s1-ios.mjs` replayed the
route for 45 minutes. Android: screen off (`input keyevent KEYCODE_SLEEP`),
virtual battery unplugged, no other restriction forced. iOS: the app
backgrounded; the simulator has no window, so `simctl` cannot lock it, and S1
on iOS ran in the background **unlocked**, not locked. Two runs each, from
`night-20260930` (20:09–05:43 CEST, 18:09:05Z–03:43:07Z).

**Android, without the exemption — failed.** Largest gaps of 802 s (run
2026-09-30 s1-android-1) and 602 s (run 2026-09-30 s1-android-2), both well
over the 120 s limit (2 gaps over 120 s in each run). Both gaps began after
the SDK went stationary at the route's stop, with the screen off on virtual
battery; the SDK never resumed heartbeats once the route moved on, until the
walk's next update reached it.

**Why it did not notice the walk resuming — the vendor's documented
mechanism, read here, not an independently verified cause.** The SDK's own
documentation (`react-native-background-geolocation` 5.7.0,
`src/declarations/interfaces/Config.d.ts`, read 2026-10-01 from the spike's
installed package, the `disableMotionActivityUpdates` entry) says that
without the Motion API, "the Android SDK has a fallback 'stationary
geofence' mechanism just like iOS, the exit of which will cause the plugin
to change to the *moving* state … This will, of course, require the device
moves a distance of typically **200-500 meters** before tracking engages."
Neither emulator has a real accelerometer, so both rely on this fallback.
Read against the 802 s and 602 s gaps: a silent, Doze-limited app without
the exemption has no occasion to notice it has crossed that 200–500 m
geofence until something else wakes it. That is this document's reading of
why the walk's resumption went unnoticed, not a cause confirmed by the SDK
itself or by any test beyond this one.

**Android, with the battery-optimisation exemption — passed.** The owner's
Q4 case (`night-20261001-s1-exempt`, run separately the next morning, started
2026-10-01 05:00:45.744Z). The exemption was granted by script first, as the
app's setup would ask the user to grant it, and the run only started once the
exemption was shown in force (`deviceidle`'s list held the app, and the app's
own `exempt: true` report had reached the receiver). Largest gap **109 s in
both runs**, an **11 s margin** under the 120 s limit; 0 gaps over 120 s.
**Observed:** in both exempt runs the SDK's own state shows it went back to
moving at **30.4–30.5 minutes** into the run. **Inference, not observed:**
read against the mechanism above, this looks like the same stationary
geofence, exited in time because the exemption kept the app able to notice
the exit, where the non-exempt runs could not — but the geofence exit itself
was not separately confirmed. The first exempt run also carried a network
capture (below): it passed, with nothing flagged.

**Side by side:**

| | Without the exemption | With the exemption |
|---|---|---|
| Largest gap | 802 s, 602 s | 109 s, 109 s |
| Gaps over 120 s | 2, 2 | 0, 0 |
| Verdict | failed | passed |

**The exemption depends on the user granting it.** It is a setting, not a
default: nothing in the app can force it. The product's setup must ask for it
and the app must report whether it was granted (as S3 and the exempt case
both already do), so the walk can fail loudly, not silently, when it is
refused.

**iOS — failed, and deciding.** **Observed:** the only gap, 370 s, is the
same in both runs; it is exactly the route's roughly 6-minute stop plus one
10 s step of the route's own replay (the simulator's position is stepped
every 10 s, so the step after the stop is what the SDK finally received).
Across both runs, 235 arrivals each, none had `moving: false`. **Inference,
not observed:** a perfectly still simulated position is read here as giving
the SDK no new fix, with no motion sensor to tell it the device had stopped
another way — so it is read as staying in its "moving" state through the
stop and sending no stationary heartbeat, rather than this chain being
confirmed by anything beyond the `moving: true` reading itself. An earlier,
uncounted dry run on this same simulator went stationary within a minute
(`docs/progress/m1.md`, 2026-09-30, "AC2 shown on both platforms"): that run
is not part of this night's counted evidence, but it shows the SDK's iOS
behaviour on a static position is not perfectly consistent, which is itself
a reason to read "never `moving: false`, 235 for 235" as an observation, not
proof of a fixed mechanism. No documented SDK setting was found that changes
this on a simulator (none was found to try).
**Documented by the vendor, read apart from the observation above.** The
same SDK's own documentation (`react-native-background-geolocation` 5.7.0,
`src/declarations/interfaces/Config.d.ts`, read 2026-10-01 from the spike's
installed package), in the `preventSuspend` entry:

> "When a device is unplugged form [sic] power with the screen off, iOS will
> _still_ throttle [[BackgroundGeolocation.onHeartbeat]] events about 2
> minutes after entering the background state. However, if the screen is lit
> up or even the _slightest_ device-motion is detected,
> [[BackgroundGeolocation.onHeartbeat]] events will immediately resume."
> ("form" is the vendor's own typo, kept as written.)

The same entry warns about the setting this spike runs with,
`app.preventSuspend: true` (part 4.6), which is what gets heartbeats at all
in the background:

> "should **only** be used in **very** specific use-cases … _will_ have a
> **very noticeable impact on battery performance** … You should **not**
> expect to run your app in this mode 24 hours / day, 7 days-a-week."

**Reading the two together is this document's own inference, not the
vendor's claim about this spike.** The vendor's "about 2 minutes" is a delay
after the app enters the background, not a gap length, so it is not
compared to the simulator's 370 s gap here. What it does say is that a real
iPhone, lying still with the screen off, is documented by the SDK's own
engine to throttle heartbeats on its own fixed timer — a different
mechanism from the simulator's, which simply never received a new GPS fix
to notice the stop with at all. Read together, the two amount to **a
different mechanism, with the same outcome**: heartbeats stop at a real
stop, not "for the same reason" as the simulator. That is the safety
reviewer's point: this is evidence against assuming a real phone would do
better than the simulator, not proof that it would fail in exactly the same
way.
**This stays FAILED and deciding — it is not listed as "open until L9".**
What L9 must show: a stop of 5 minutes or more on a real iPhone, unplugged,
with the screen off. M3 should consider a timer-driven upload as a fix that
depends on neither motion detection nor this battery-costly setting.

**Not shown on simulators, open until L9 (D-041):**
- battery use (S1's ⚙️ 10 % limit) — neither device has a real battery;
- real iPhone background limits, and any real Android phone (RR-02);
- the SDK's motion detection — neither device has a real accelerometer or
  activity-recognition sensor;
- other OS versions — one Android API level, one iOS runtime (RR-04);
- the iPhone locked during the run — `simctl` cannot lock this simulator.

### S2 — the reminder after the app is ended (AC6)

**What ran.** Android: `input motionevent` swiped the app away (`input
swipe` alone did not dismiss the card in this launcher); separately, its
process was killed the way Android's low-memory killer would; separately,
Force stop from Settings. iOS: `simctl terminate`, not proven equal to a
user's swipe. Two runs per case, `night-20260930`.

- **Swipe (Android) — arrivals continued, largest gap 34 s** (both runs).
  Passes under AC6's rule: where arrivals do not stop, the case passes if no
  gap exceeds 120 s.
- **Low-memory kill (Android) — failed by 2–3 s.** Largest gaps 123 s (run
  2026-09-30 s2-android-lmk-1) and 122 s (run -lmk-2): arrivals continued,
  but each gap cleared the 120 s limit by 2–3 s.
- **Force stop (Android) — recorded, not judged**, as AC6 says. 0 reminders
  after the last arrival in both runs. By Android's design, Force stop
  cancels the app's scheduled alarms, so no reminder was expected.
- **iOS — passed.** Arrivals continued, largest gap 91 s (both runs).

**Finding.** In both low-memory-kill runs, a reminder fired that said
protection had stopped while arrivals continued to the receiver. AC6 is
explicit that this is a finding for the owner, not a pass: a walker shown
"protection stopped" while the app is still tracking is told something
false.

**Not shown on simulators, open until L9 (D-041):**
- phone makers that treat a swipe as a force stop (RR-02);
- whether iOS treats `simctl terminate` like a user's swipe;
- whether a real iPhone delivers the reminder on time.

### S3 — stock Android's restrictions, with and without the exemption (AC7)

**What ran.** `drivers/s3-android.mjs` held the emulator in Android's own
restrictions for 45 minutes (screen off, battery unplugged, deep Doze
forced), once with the battery-optimisation exemption granted and once
without. Two runs each, `night-20260930`. iOS: not applicable — iOS has no
per-app battery exemption, and S3 is about Android phone makers.

**With the exemption — passed.** Largest gap 109 s (run
2026-09-30 s3-android-exempt-1) and 110 s (run -exempt-2), 0 gaps over 120 s
in either. **Passed by a 10 s margin** (the larger gap, 110 s, against the
120 s limit).

**Without the exemption — passed, on its own criterion.** AC7's pass
condition for this case is not the 120 s gap rule: it is that the app's own
check reports it is not exempt, and that report reaches the receiver *before*
the restrictions start, so the missing exemption is detectable before a walk
goes wrong. Both runs met that. What is recorded, not judged, is what the
restrictions then did: a largest gap of **967 s** in both runs (run
2026-09-30 s3-android-not-exempt-1 and -2), 1 gap over 120 s each. **This
967 s gap is the direct evidence that the exemption matters** — it is not a
failure of this case, it is the finding this case exists to produce.

| | With the exemption | Without the exemption |
|---|---|---|
| Largest gap | 109 s, 110 s | 967 s, 967 s |
| Pass condition | gaps ≤ 120 s | non-exempt status reported before restrictions start |
| Verdict | passed | passed (on its own criterion); the 967 s gap is the finding |

**The restricted standby bucket itself was not shown.** Android re-promotes a
journeying app out of the `restricted` bucket (45) to bucket 10 or 30 within
a second of starting, so the harness could not hold the app in `restricted`
during a run. Deep Doze held in both exempt runs (`in force: deep Doze`); the
standby bucket did not.

**Not shown on simulators, open until L9 (D-041):**
- every phone maker's own battery manager, Samsung's included — that is the
  failure S3 is about, and it stays open under D-037 (RR-02);
- real Doze timing in a pocket.

### S4 — positions held offline arrive in order (AC8)

**What ran.** Android: airplane mode on, then off, 3 minutes mid-walk.
iOS: no airplane mode on a simulator, so the receiver refused connections for
the same 3 minutes instead; the radio itself was never off. Two runs each,
`night-20260930`.

**Both platforms passed, with no positions missing.**

| Platform | Held records missing | First held record after reconnecting | Last held record after reconnecting |
|---|---|---|---|
| Android, run 1 | 0 | 3418 ms | 3673 ms |
| Android, run 2 | 0 | 3091 ms | 3365 ms |
| iOS, run 1 | 0 | 9909 ms | 10034 ms |
| iOS, run 2 | 0 | 13 ms | 120 ms |

Every held position arrived, in the order the device recorded it, and the
SDK's on-device queue was empty afterwards, as the app read and reported it.
These four runs flush quickly, but the margin to D-021's 5-minute (300 s)
lost-contact threshold is narrower than that alone suggests: the worst case
is a last upload up to 60 s stale when the device goes offline (the SDK's
own upload interval while moving, part 4.6), plus the 3 minutes offline,
plus about 10 s to flush — around 250 s in the worst case, **about 50 s of
margin**, not "far under" it. A longer flush, or a longer gap right before
going offline, would close that margin further.

**Not shown on simulators, open until L9 (D-041):**
- iOS with its radio actually off;
- real coverage loss — tunnels, lifts, cell handovers (RR-03).

### S5 — the alert on a silenced device (AC9)

**What ran.** Android: the fixed, content-free alert posted on the
high-priority channel, with Do Not Disturb on and the ringer silent, the
channel's Do Not Disturb override granted by script as a responder's setup
would grant it. iOS: delivered as a push with `simctl push`, no Apple servers
involved, at the Time Sensitive level. Two runs each, `night-20260930`.

**Seen, heard and text are kept as three separate lines, on both platforms,**
as AC9 and the reviewers require:

| | Android | iOS |
|---|---|---|
| Seen | passed | passed |
| Heard | **failed** | not shown on simulators |
| Text (payload and shown text match exactly) | passed | passed |

**Heard failed on Android — the likely cause, not verified.** The alert
channel is created with `USAGE_ALARM`, but the posted alert's effective
audio usage came out as `USAGE_NOTIFICATION`, which the silent ringer mutes.
**What was checked:** Android's flag `restrict_audio_attributes_alarm`
restricts `USAGE_ALARM` to notifications that carry `CATEGORY_ALARM` —
"Only alarm category notifs can use USAGE_ALARM" (AOSP
`core/java/android/app/notification.aconfig`, bug 331793339) — and that our
own alert, posted from `spikes/background-safety/app/src/journey.js`
(`alertSoon`), sets no category. **What was not shown:** whether this flag
is actually on in the `android-37.2` image this spike runs on, where AOSP's
code would enforce it; and a run that posts the alert with `CATEGORY_ALARM`
set and comes back `heard: passed`. Until a run like that exists, this
stays the likely cause, not a verified one, and it is not called "not a
platform limit" either way. The fix to try is posting the alert with
`CATEGORY_ALARM`; `expo-notifications` may need native code for that, M3's
work. What was not found is **AOSP's own enforcement site** inside the
flag's code path — our own posting site, `alertSoon`, is already known and
named above.

**iOS text — checked on the foreground push only.** The exact-text check
(payload and shown text match the fixed text with no other keys) was
confirmed against the push received while the app was in the foreground; it
was not separately re-checked against a background delivery.

**Not shown on simulators, open until L9 (D-041):**
- anything actually heard, by a human ear — nothing listens to either
  device's audio; for the iPhone this is RR-01. (Android's "heard: failed"
  above is a real verdict, read from the platform's own audio and
  notification records, not a simulator limitation — but even it does not
  confirm a human actually heard the sound.)
- the iPhone's silent switch (the simulator has none);
- Time Sensitive breaking through a Focus;
- Critical Alerts, which need Apple's entitlement (its own M1 item, needing
  A-02);
- real push delivery through APNs and FCM (A-02, A-11).

### S6 — one-tap calling (AC10)

**What ran.** Android: the call button tapped with and without the
`CALL_PHONE` permission granted, dialling a synthetic number from a range
reserved for fiction. Two runs each, `night-20260930`. iOS: not shown on
simulators — the simulator has no Phone app.

**Android — stated as observed behaviour, per case, from the emulator's own
call records (`dumpsys telecom`; `gsm list` stays empty on this image and
cannot be used):**

| Case | Call started on the tap alone |
|---|---|
| With `CALL_PHONE` | yes, 2 of 2 runs |
| Without `CALL_PHONE` | no, 0 of 2 runs — the dialer opened and waited for a second tap |

The two cases agree with each other and with AC10: with the permission, the
tap alone places the call; without it, a second tap is needed. "Passed" here
means the behaviour was recorded as AC10 asks, not a judgement that the
behaviour itself is good or bad.

**iOS — documented, not observed.** Read 2026-10-01, from Apple's URL Scheme
Reference, "Phone Links" (developer.apple.com/library/archive/featuredarticles/
iPhoneURLScheme_Reference/PhoneLinks/PhoneLinks.html — an archived Apple
document):

> "When a user opens a URL with the tel scheme in a native app, iOS 10.3 and
> later displays an alert and requires user confirmation before dialing."

So on a real iPhone, a call from the app is a tap plus one system
confirmation — within the one-tap call story's "at most one system
confirmation on an iPhone." This is **documented, not observed**: the
simulator has no Phone app, so it stays open until it is checked against a
real phone (L9).

### S7 — reduced location permission detected within a minute (AC11)

**What ran.** Android: "all the time" → "only while using" (background
revoked; the "background" case), and precise → approximate (the "fine"
case), by `pm revoke`. iOS: "Always" → "While using" only — `simctl privacy`
could not make the precise-to-approximate change, so that case is **not
shown on simulators**. Two runs each case, `night-20260930`.

| | Android, background → in-use | Android, precise → approximate | iOS, Always → While using |
|---|---|---|---|
| Report after the change | 6594 ms, 6816 ms | no report; process ended | 237 ms, 219 ms |
| Process ended by the platform | true (both) | true (both) | false (both) |
| Arrivals after the change | 28, 28 | 0, 0 | 21, 20 |
| Verdict | passed | failed — excused by the rule | passed |

**The "fine" case is a real finding, excused by the go/no-go rule.** Both
runs show the platform itself ending the app's process on the permission
change, with nothing arriving afterwards (2026-09-30 s7-android-fine-1 and
-2). The go/no-go rule's own item 5 says a platform that ends the process
does this for any SDK, so it is recorded as a finding and does not count
against this SDK. **AC11's "what noticed instead" was not recorded for this
case**: with the process gone, neither the reminder (AC6) nor the server's
5-minute silence was captured as the thing that would have noticed in the
walker's place. That gap is a finding for the owner, not just a detail.

**The asymmetry, for the owner, alongside the excuse.** The rule's letter is
followed correctly: a platform ending the process excuses the failure,
whichever case it happens in. But the two cases are not alike once the
process ends. In the background case, the platform also ended the process —
and the **same SDK** came back on its own within 7 s, with 28 arrivals
following. In the fine case, it never came back: 0 arrivals, no report, for
either run. The rule's premise is about the process ending, not about
whether the SDK recovers afterwards — so being excused here does not mean
the two cases behaved the same way, only that neither is counted against
the SDK by the rule as written.

**Not shown on simulators, open until L9 (D-041):**
- the real Settings screens on phones;
- the iPhone's precise-to-approximate change — `simctl` could not make it.

### S8 — MapLibre draws Kartverket's tiles (AC16, outside the go/no-go)

**What ran.** The map screen opened on Galdhøpiggen at three zoom levels
(10, 14, 18), on both devices. Two runs each, `night-20260930`.

| | Android | iOS |
|---|---|---|
| Tiles drawn (≤ 1 % sentinel pixels) | passed | passed |
| No native crash | passed | passed |
| 16 KB page alignment (Android only) | aligned: true, both runs | not applicable |

**"Aligned: true" is the driver's own reading (`meta.aligned16k`), not a
fresh `zipalign` run for these two runs** — the night did not save
`zipalign`'s exit code. AC2's separate, by-hand `zipalign -c -P 16` check at
build time (all 17 native libraries OK) still stands; see part 5.4.

Full detail — MapLibre's and Kartverket's licences, the tile address, and the
capture — is in part 5. **S8 does not decide the location SDK's go/no-go**;
it is a finding for D-026 only, and here it is a pass.

## 4. The SDK

### 4.1 Version and pin

`react-native-background-geolocation` 5.7.0, pinned exactly, with its Android
engine `com.transistorsoft:tslocationmanager` 4.6.1 (with
`play-services-location` 21.3.0, resolved through `expo-gradle-ext-vars`) and
its iOS engine `TSLocationManager` 4.7.1 (pinned through `eas.json`'s
`TSLOCATIONMANAGER_VERSION`, since the podspec's own default is a range). No
licence key is used; none is needed in debug builds (clause 3.5, below).

**What the pinned engine adds to the Android manifest, and what comes from
elsewhere (M3 to review).** Read from
`app/android/app/build/outputs/logs/manifest-merger-debug-report.txt`, the
build of 2026-09-30 17:20:
- **the SDK's own engine** (`com.transistorsoft:tslocationmanager:4.6.1`)
  adds the background location permission, `ACTIVITY_RECOGNITION` (physical
  activity data, which matters for the DPIA), the location foreground
  service, and a boot-completed receiver;
- **`expo-notifications`**, not the location SDK, brings in the FCM receive
  permission (through `firebase-messaging` 25.0.1) and about 20
  badge-related permissions (through `ShortcutBadger` 1.1.22);
- **the Install Referrer permission** (`com.android.installreferrer` 2.2, a
  PRIV-06 question for M3) comes through `expo-application`, itself a
  dependency of `expo-notifications`, not of the location SDK;
- **`SYSTEM_ALERT_WINDOW`** is rejected in the app's own main manifest but
  present in the merged **debug** manifest — a debug-build artefact, not
  necessarily something a release build carries.

M3 must review the merged manifest of the **release** build itself, not
assume this debug-build reading describes it, and not assume any engine's
declared licence covers everything a build actually includes.

### 4.2 Licence, read at step 2 (quoted)

Read from the vendor's licence agreement
(docs.transistorsoft.com/license, linked from the iOS podspec's licence
text), 2026-09-30:

- **3.5 (evaluation in debug builds is allowed):** "The Software is fully
  functional in DEBUG builds without a License Key; the license-validation
  warning shown in DEBUG builds does not restrict functionality. DEBUG builds
  may be used for development and testing only and may not be distributed to
  End Users."
- **7.1 (no data to the vendor, by the terms):** "It transmits location and
  related data only to the server endpoints that Licensee configures in its
  Application. Licensor operates no server that receives that data."
- **7.2:** the licence check itself "involves no network request to Licensor
  and transmits no data." (AC12, part 4.4, still measured this
  independently.)
- **9.5, read at 14:10 on 2026-09-30 (the version that worried the owner,
  Q3):** "The Software is not designed or intended for use in any
  application in which its failure could lead to death, personal injury or
  severe physical or environmental damage, including life-support,
  safety-critical navigation, or use as the sole means of emergency
  response. Licensee shall not use the Software in such applications."
- **9.5, as rewritten by the vendor and read again at 19:21 the same day
  ("Safety-related applications"):** "Licensee may use the Software in
  Applications intended to help keep people safe, such as personal-safety,
  lone-worker, family location-sharing and check-in Applications." It adds
  that the Software "is not designed, tested or certified as a
  safety-critical system", and that the Licensee is solely responsible "for
  designing the Application to allow for delayed, missing or inaccurate
  location data, and for anything the Application tells End Users about its
  reliability or about how to obtain emergency assistance."

Both dated copies are kept with checksums outside the repository
(`~/spike-runs/licence/`), because the terms can change again; this document
quotes the versions read on 2026-09-30. The duties the new 9.5 leaves in
place match the plan already: fail loudly on late or missing locations, and
never overstate reliability to the walker.

### 4.3 Price, as checked

**$399.** The vendor's product page lists "Starter - $399.00", for one app on
both platforms. The spike cost $0: debug builds need no licence (3.5). The
$399 licence is only for release builds, bought after a GO, decided by the
owner (D-023).

**The engines are commercial on both platforms**, even though the npm
wrapper is MIT. The npm package (5.7.0) declares MIT and its `LICENSE` file
is MIT — that covers the JavaScript wrapper only. `TSLocationManager` (iOS,
via CocoaPods) states `"type": "Commercial"` in its podspec.
`com.transistorsoft:tslocationmanager` (Android, via Maven Central) names its
licence "Commercial" in its POM. Both were declared as version ranges
upstream; the spike pins them exactly (4.7.1, 4.6.1). A later `licenses:check`
run over `apps/mobile` will see only the npm package's MIT and miss this: the
M3 task that brings the SDK in must handle the native engines' terms
explicitly, not rely on `licenses:check`.

**Dependency sources (SEC-06).** Android: Maven Central, Google, the Gradle
Plugin Portal, and local AARs; JitPack is declared but unused. iOS:
CocoaPods, for `TSLocationManager` — pinned only through the `eas.json`
environment variable, with no `Podfile.lock` committed. Neither Gradle's nor
CocoaPods' dependencies are audited yet (an open INF-06 follow-up).

### 4.4 What it sent (AC12)

**Given:** one Android run with its network traffic captured
(`-tcpdump`, Wi-Fi off so the capture sees the app's traffic on `eth0`), no
Google account on the device. The capturing run was 2026-09-30 s1-android-1.

**Every destination the app's own uploads reached was the receiver, on
loopback.** No host belonging to the SDK's vendor appears in any capture.

**One finding: an unattributed Firebase Installations TLS session.** At
18:49:22.8Z **on the Mac's clock** (the pcap's own clock ran about 3604 s
behind — "What the harness had to learn", `spikes/background-safety/README.md`),
13 ms after a DNS answer for `firebaseinstallations.googleapis.com`, the
device opened a TLS session to that host's address, `172.217.112.4:443` —
2,649 B sent, 5,846 B received. **Only the SNI in the TLS handshake ties
this session to Firebase:** `172.217.112.4` is one of Google's own shared
front-end addresses, serving many Google services, not a Firebase-only
address; it is the session name, `firebaseinstallations.googleapis.com`,
that identifies it. It is the only such connection in the capture. **The
capture's verdict stays failed, unless the owner decides otherwise.** A full
pass over the run's window (5,820 packets) found nothing with both
endpoints unclassified beyond 26 ICMPv6 neighbour- and router-discovery and
MLD packets — link-local and multicast housekeeping to the emulator's own
gateway, none of them TCP or UDP, and none of them destinations in AC12's
sense. So this is not a gap in the review; it is a real, unexplained
connection.

**The evidence on both sides.**
- *Against the app having started it:* the app cannot start Firebase
  itself. It has no `google-services.json`, no Google Services Gradle
  plugin, and its `R.txt` has neither `google_app_id` nor
  `gcm_defaultSenderId`. It links Firebase only indirectly, through
  `expo-notifications`, with no configuration to start it.
- *Toward the app:* the session opened 6.5 s after the app's own arrival at
  the receiver that ended the 802 s gap (part 3, S1), and Firebase's own
  `FirebaseInitProvider` runs inside every app's process at launch, by
  Android's own design, whether or not Firebase is configured for that app.
- *Against the app, in the same moment:* those same seconds also hold a
  burst of other Google connections — a lookup of `android.apis.google.com`,
  and QUIC traffic — which looks like a Doze maintenance window the platform
  opened for several apps and services at once, not something singling out
  this one connection.
- *Supporting "the app did not start it":* in the exempt night's run
  (below), the app's own process logged that Firebase itself failed to
  start.
- *Against attribution being settled either way:* nothing in the capture
  ties the TLS session to a process. The exempt run's clean capture can only
  speak for its own traffic, not for the night run that showed the
  connection.

**The exempt night's own evidence (run window 05:00–05:48Z, 2026-10-01):**
that run's capture (the exempt case's first run also carries a capture, as
S1's first run does) **passed, with nothing flagged.** Its `firebase-logcat.txt`
— logcat filtered to Firebase-related tags only, each line kept with its pid
and device time — held 9 lines kept, 1 dropped. The app's own process
(pid 3184, launched for the run and still running at its end) logged, during
Firebase's automatic `FirebaseInitProvider` startup sequence, two lines:
"Default FirebaseApp failed to initialize … no default options" and
"FirebaseApp initialization unsuccessful". No other line from any capture or
logcat is quoted here. Other processes on the same device image initialised
Firebase successfully at the same time, and Google Play services' own
measurement component reported itself initialised — neither is quoted, only
noted, because they are not the app's process. The device's own clock
against the Mac's, and the app's process IDs, are recorded in that run's
`meta.json`, for anyone checking this by hand later; no automated judge reads
them.

**Other destinations, classified during the review, to match the judge.**
Every `firebase*.googleapis.com` host, plus `fcm.googleapis.com`,
`fcmtoken.googleapis.com` and `crashlyticsreports-pa.googleapis.com`, is
classified as **analytics, and flagged — never platform.** The session above
is the **only** such destination that actually appears in this window; the
rest of the category is the classification rule standing ready, not more
traffic found. `geomobileservices-pa.googleapis.com` is classified
separately, as Google Play services' own network location provider — a note
for the product's DPIA, not a finding against this SDK. Every other
destination in the window belongs to Google's own platform services on the
emulator image, which AC12 already treats as the platform's, not the app's
or the vendor's.

**iOS — not shown.** The simulator shares the Mac's own network, so its
traffic cannot be told apart from the Mac's without admin rights. This is
open until L9 (D-041).

### 4.5 The shape of the upload, field names only (for M2)

This is input for M2's heartbeat endpoint, which must take plain HTTP from
native code and authenticate each device — it is not a reproduction of the
SDK's full internal schema, only the fields the spike's receiver keeps from
each upload, per AC3 (amended during review loop 1 to add `moving`):

- the platform;
- the SDK's own record ID;
- the time the phone recorded it;
- whether the record carried a position (yes/no) — never the position
  itself;
- `moving` — whether the SDK considered the device in motion. This is
  behavioural data: M2 should keep it only where a rule actually needs it,
  not by default;
- the status fields the app adds on every upload, carried in the SDK's
  `http.params.app`: the SDK's on-device queue count, the location
  permission, and the battery-optimisation exemption.

**A warning for M2.** The SDK can run remote commands that arrive in its own
HTTP response body. M2's heartbeat endpoint must never echo or return a
`background_geolocation` key, or anything that looks like one, in its
response — and it must use TLS with per-device authentication (the
faked-heartbeats threat), which this spike's cleartext loopback deliberately
does not have.

### 4.6 Settings used (for M3)

Reproduced from `spikes/background-safety/README.md`, "Settings used (for
M3)". Anything not listed is the SDK's default.

| Setting | Value | Why |
|---|---|---|
| `logger.debug` | `false` | Its sounds and notifications could be mistaken for S2's or S5's |
| `logger.logLevel` | `Error` | More verbose levels may write positions to the device log |
| `geolocation.desiredAccuracy` | `High` | A walk |
| `geolocation.distanceFilter` | `0` | Time-based sampling while moving, so standing still before the SDK notices uploads |
| `geolocation.locationUpdateInterval` | `30000` (Android) | An upload at least every 60 s while moving; iOS has no interval and delivers continuously |
| `geolocation.disableLocationAuthorizationAlert` | `true` | The app reports a reduced permission itself; the SDK's own pop-up would block the drivers |
| `geolocation.locationAuthorizationRequest` | `Always` | Background tracking |
| `geolocation.showsBackgroundLocationIndicator` | `true` | The sharing-is-visible story, on the iPhone |
| `app.stopOnTerminate` | `false` | S2: tracking may carry on after a swipe |
| `app.enableHeadless` | `true` | Android: after a swipe, events reach the headless task, which carries on as the app would |
| `app.heartbeatInterval` | `60` | In the stationary state, an event every 60 s (Android's minimum), answered with a position |
| `app.preventSuspend` | `true` | iOS fires heartbeats only with this on (vendor, `AppConfig.heartbeatInterval`) |
| `app.notification` | a fixed title and text | Android's location-service notification: the sharing-is-visible story |
| `http.url` | the receiver | Uploads go nowhere else |
| `http.autoSync` / `http.batchSync` | `true` / `false` | One POST per record, as soon as it is recorded |
| `http.params.app` | the status, kept current | See part 4.5 |

At journey start the app calls `changePace(true)` — neither device has real
motion detection. On each heartbeat it calls `getCurrentPosition` with
`persist: true`.

**`app.preventSuspend` costs battery on a real iPhone, by the vendor's own
documentation** (quoted in full in part 3's S1 section): it "should **only**
be used in **very** specific use-cases" and "will have a very noticeable
impact on battery performance". S1 measured the configuration a shipped
product would use; M3 decides whether it keeps it, weighed against S1 iOS's
open failure (part 3).

**On-device retention, left at the SDK's defaults here — for M3.** The spike
does not set how long the SDK keeps data on the device: by default it keeps
every position in its offline queue, and keeps its own log database,
indefinitely. M3 must set, record and test `persistence.maxDaysToPersist`,
`persistence.maxRecordsToPersist` and `persistence.persistMode` (the queue),
and `logger.logMaxDays` (the SDK's own log) — all 5.x setting names, checked
against this pinned version's own type declarations — and must empty the
queue itself when a journey ends, rather than leaving positions to age out
on the SDK's own schedule.

## 5. The map (S8), outside the go/no-go

### 5.1 MapLibre's version and licence

Read 2026-10-01, by hand, at the pinned versions:

- **JavaScript package**, `@maplibre/maplibre-react-native` 11.4.0: **MIT**
  (npm's own licence field).
- **Android native**, `org.maplibre.gl:android-sdk-opengl` 13.6.1: **BSD**,
  `https://opensource.org/licenses/BSD-2-Clause`, from its POM on Maven
  Central.
- **iOS native**, MapLibre Native 6.31.0, pulled in through SwiftPM
  (`maplibre/maplibre-gl-native-distribution`, tag `6.31.0`, its
  `LICENSE.md`): **"BSD 2-Clause License"**, copyright "MapLibre
  contributors", "MapTiler.com" and "Mapbox".

All three are permissive and cost nothing. As with the location SDK's own
engines (part 4.3), `licenses:check` cannot see any of these: it reads the
root workspace, and the spike's app sits outside it. The M3 task that brings
MapLibre into `apps/mobile` must record these licences explicitly, not rely
on `licenses:check` finding them.

### 5.2 Kartverket's terms, licence, rate limits and attribution (quoted)

Read 2026-09-30, by hand, for S8:

- **Kartverket's terms page**
  (kartverket.no/en/api-and-data/terms-of-use): the free products are
  "released for free use for both commercial and non-commercial purposes",
  under CC BY 4.0, credited as "©Kartverket" with a link where possible. The
  map screen shows this attribution.
- **The tile service's own catalogue record** (Geonorge, "Topografisk
  norgeskart WMTS / cache"): "Åpne data", and "UseLimitations: Ingen
  begrensninger". No rate limit is stated there, on the terms page, or on
  `cache.kartverket.no` itself.
- **The Geovekst finding, for D-026, not for S8.** The terms say that at
  zoom levels 12–20 the cache services show data "obtained from the Geovekst
  cooperation", and "special permission must be obtained from the licensees
  if they are to be copied or used in other ways" (contact:
  post@kartverket.no). S8 only displays tiles live from Kartverket, which is
  use on the terms above; a caching tile proxy, D-026's later work, may count
  as copying and must settle this with Kartverket first.

### 5.3 Tile address, format and area

- **Address:**
  `https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png`
  (from `cache.kartverket.no`'s own example).
- **Format:** raster PNG tiles, served over WMTS.
- **Area:** Galdhøpiggen, Norway's highest mountain — named only, never
  located, because nobody lives there and nobody walks home from it.
- **Zoom levels checked:** 10, 14 and 18, the most detailed level
  Kartverket serves for this area, each view lying wholly inside Norway.

### 5.4 Verdict on each device

| | Android | iOS |
|---|---|---|
| Tiles drawn (≤ 1 % sentinel pixels) | passed, both runs | passed, both runs |
| No native crash | passed | passed |
| 16 KB page alignment | aligned: true, both runs | not applicable |

Both devices draw Kartverket's tiles, not the style's sentinel background,
with no native crash, and the Android build runs on the 16 KB-page image
without a compatibility mode.

**On "aligned: true" here.** This reading is the driver's own field,
`meta.aligned16k`, not a fresh `zipalign -c -P 16` run during these two S8
runs: the night did not save `zipalign`'s own exit code, so the analysis's
`readAlignment` could not confirm it independently for S8. The `zipalign -c
-P 16` check that does stand is AC2's, done once by hand at build time (part
1, m1.md 2026-09-30: all 17 native libraries OK) — a separate check, and it
still holds; it is not re-run per S8 run.

### 5.5 Destinations the capture saw

AC16 asks for "the destinations in a network capture of one Android run",
expecting only Kartverket because the style fetches raster tiles alone, no
fonts, sprites or demo servers. Captured on run 2026-09-30 s8-android-1,
re-judged at `a8de5ee`.

**Scope.** This run had too few uploads to place it on the capture's clock
(unlike S1's capture, part 4.4, which has enough uploads to cut the pcap to
its own run window). So the destinations below are the **whole capture
file's**, covering both S8 runs and the emulator's boot — not this one run
alone. That is said here plainly, not rounded up to "this run's traffic
only".

- **Kartverket:** `cache.kartverket.no`, and `atgcp1-prod.kartverket.cloud`
  (the name behind it).
- **Platform (the emulator image, not the app):** `time.android.com`,
  `time.google.com`, `connectivitycheck.gstatic.com`, `www.google.com`,
  `www.gstatic.com`, `mtalk.google.com`, `ts43.eas3.msg.t-mobile.com` (the
  SIM carrier's entitlement service), `android.googleapis.com`,
  `www.googleapis.com`, `remoteprovisioning.googleapis.com`,
  `digitalassetlinks.googleapis.com`.
- **DNS:** the emulator's own resolver, on port 53 and port 853 (DNS over
  TLS).
- **The Mac:** the receiver (port 8765) and the debug build's Metro probe
  (port 8081) — both the harness's, not the map's.
- **No Firebase host, and no host of the SDK's vendor,** in this capture.
- **One name flagged as unplaced:** `_dns.resolver.arpa` — Android looking
  for an encrypted DNS resolver (Discovery of Designated Resolvers, RFC
  9462). It is platform DNS; the reader flags it only because no rule names
  it, not because it is suspicious.

**For AC16:** "only Kartverket is expected" holds for the map's own traffic
— `cache.kartverket.no` and the name behind it are the only hosts the
style's own source, Kartverket's raster tiles, ever reaches. Everything
else above belongs to the platform or to the harness, not to the map.

### 5.6 Finding for D-026

S8 passed on both devices, so it raises no finding of its own against
D-026. The Geovekst clause in part 5.2 is the one finding this spike
produces for D-026: whoever builds the tile proxy must settle the zoom
12–20 question with Kartverket directly before caching its tiles.

## 6. Findings against binding rules

**The reminder rule (S2).** The low-memory-kill case missed the 120 s
threshold by 2–3 s (122 s, 123 s), while the app kept sending arrivals. In
the same runs, a reminder fired saying protection had stopped, while
protection had not. A walker reading that reminder would be told the
opposite of what was true. Force stop cancels the reminder entirely, by
Android's own design, with nothing standing in for it.

**The alert-level rule (S5).** "Heard" failed on Android because the alert's
effective audio usage, `USAGE_NOTIFICATION`, is muted by the silent ringer,
while the channel itself is `USAGE_ALARM`. The likely cause, not verified
(part 3): Android's `restrict_audio_attributes_alarm` flag, which needs
`CATEGORY_ALARM` on the notification itself (AOSP
`core/java/android/app/notification.aconfig`, bug 331793339) — our own alert
is posted with no category, from `alertSoon`. What was not shown is whether
this flag is actually on in the image this spike runs on, and a run with
`CATEGORY_ALARM` set that comes back heard. iOS "heard" stays not shown on
simulators, open until L9.

**The one-tap call story (S6).** Android is observed and matches the story:
with `CALL_PHONE`, the tap alone calls (2 of 2); without it, the dialer waits
for a second tap (2 of 2) — no disagreement between the cases. iOS is
documented, not observed: Apple's own documentation (part 3) says a `tel:`
link needs one confirmation alert from iOS 10.3 on, which fits inside the
story's "at most one system confirmation on an iPhone." That stays open
until it is checked against a real phone (L9), because the simulator has no
Phone app to observe it on.

**The location-loss rule (S7).** Android's background-permission case is
detected and reported within a minute (6.6 s, 6.8 s). Android's precise-to-
approximate case shows the platform ending the app's process before any
report can be made — excused by the go/no-go rule as a platform behaviour
that would affect any SDK, but AC11's "what noticed instead" (the reminder,
or the server's 5-minute silence) was not recorded for this case: a real gap
for the owner. iOS passed, reporting within a quarter of a second, with the
process kept alive throughout.

**The offline-queue rule (S4).** No finding: both platforms passed, with no
positions missing, correct order, and the queue empty once confirmed. The
longest flush (iOS run 1, about 10 s) plus the 3-minute window stays well
under D-021's 5-minute lost-contact threshold.

## 7. Open under D-037

Every item below is "not shown on simulators", open until L9, the automated
real-device suite, which must be switched on and passing before the group
relies on the app (D-041). Residual-risk codes (RR-01 to RR-04, `06-testing-
strategy.md`) are given where the spec ties them.

- **S1:** battery use; real iPhone background limits and any real Android
  phone (RR-02) — **S1 iOS itself is failed, not open; this item is the
  further question of how a real iPhone behaves beyond that**; the SDK's
  motion detection on a real accelerometer; other OS versions (RR-04); the
  iPhone locked during the run.
- **S2:** phone makers that treat a swipe as a force stop (RR-02); whether
  iOS treats `simctl terminate` like a user's swipe; whether a real iPhone
  delivers the reminder on time.
- **S3:** every phone maker's own battery manager, Samsung's included
  (RR-02); real Doze timing in a pocket.
- **S4:** iOS with its radio actually off; real coverage loss — tunnels,
  lifts, cell handovers (RR-03).
- **S5:** anything actually heard by a human ear, on either device (RR-01
  for the iPhone); the iPhone's silent switch; Time Sensitive breaking
  through a Focus; Critical Alerts (needs Apple's entitlement, its own M1
  item, A-02); real push delivery through APNs and FCM (A-02, A-11).
- **S6 (iOS):** the whole scenario — no Phone app on the simulator.
- **S7:** the real Settings screens on phones; the iPhone's precise-to-
  approximate change, which `simctl` could not make.
- **AC12 (iOS):** the capture — the simulator shares the Mac's own network.
- **S8:** rendering speed and memory on real phones; the tile proxy itself
  (D-026's later work).

## 8. Invalid runs

**There were none.** Both manifests together hold 40 runs
(`night-20260930`, 38 runs; `night-20261001-s1-exempt`, 2 runs), and every
scenario's valid/invalid count in part 2 reads "0 invalid". This was checked
two ways:
- the re-judged manifests (`manifest.rejudged.jsonl`) carry each run's
  validity against AC13's own definition — invalid only when the harness
  broke before a failure was shown — and every run in both manifests judges
  as valid;
- `goNoGoInput` compares the manifests against the runner's own plan
  (`drivers/lib/plan.mjs`, including the S1 exemption case): a planned case
  that never ran would show "no verdict", not a silent pass, and no case in
  either manifest does.

No run was repeated to replace a failure (D-060): the night's S1 failures,
the low-memory-kill failures, the precise-to-approximate failure, and the
capture finding all stand as first recorded.

### Known limits of the harness

These are the reviewers' should-fixes from loop 2's audit of the analysis
code. **None of them affects these two nights:** no run had a break, every
run ID is distinct, and every run sits inside a planned case — all three
were checked by hand against this specific evidence before this document
was written. They are listed here because they must be fixed before any
future night runs, not because any of them changes a verdict above:

- duplicate run IDs across manifests would be counted twice;
- runs of an unplanned case drop out of the go/no-go instead of being
  flagged;
- Mac-sleep cuts are measured on the wall clock, compared against a
  monotonic gap;
- an untimed break can make an S1 or S3 failure read as invalid instead of
  failed;
- a GO's headline does not say "with conditions" when a condition applies;
- `drivers/lib/plan.mjs`, which decides which runs count at all, has no
  tests of its own;
- the S1-exempt judge does not check `exemptionInForce` itself — it only
  reads what the driver already recorded;
- `run-all` does not record its own harness commit in the manifest;
- `meta.deviceAddresses` was empty in the exempt runs, and the judge fell
  back to the emulator's default addresses instead of failing loudly;
- the earlier re-judge file is named with the wrong time;
- the S5 seen/text rows come from untested glue code;
- test gaps the audit listed directly: touching breaks in S7 and S4,
  `longestIntact`'s sort and its max, S4 `orderFinal`'s other side, S5's own
  break handling, and the manifest guard for runs that were never judged.

## 9. Go/no-go

### The rule, applied item by item

From the go/no-go output, computed at commit `0a91285` over both nights'
re-judged manifests:

| # | Item | Result |
|---|---|---|
| 1 | AC2: the pinned SDK builds and runs, both platforms, New Architecture, 16 KB-page image | build android: passed; build ios: passed |
| 2 | S1 passed (AC5) | S1 android: **failed**; passed with the battery-optimisation exemption; S1 ios: **failed** |
| 3 | S4 passed, queue emptying included (AC8) | S4 android: passed; S4 ios: passed |
| 4 | S3 passed with the exemption (AC7), Android only | S3 android: passed |
| 5 | S7 (AC11): wherever the process keeps running, the change is reported within 60 s; a platform that ends the process is a finding, not counted | S7 android: **failed**, excused by this item's own exception (the process ended); S7 ios: passed |
| 6 | AC12: nothing uploaded to anyone but our receiver | capture android: **failed**; capture ios: not shown on simulators |
| 7 | Licence and price, read by hand: nothing restricts the intended use, nothing sends data out, price is still $399 | licence: passed |

**Finding only, not deciding:** S1 exempt android (passed); S2 android
(failed) and ios (passed); S3 not exempt android (passed); S5 android
(passed) and ios (passed); S5 heard android (failed) and ios (not shown); S6
android (passed) and ios (not shown); S8 android and ios (both passed).

**Conditions (items that passed only with a setting tried):**
- S1 android: passed with the battery-optimisation exemption.

**Settings tried:**
- S1 android: the battery-optimisation exemption — passed.
- S1 ios: no documented setting was found that changes a static simulated
  position into a moving one; none was found to try. The spec's Q4 offered
  a second option, (b) — an iOS case with GPS-like jitter at the stop,
  alongside the Android exemption case — which the owner did not take; the
  owner took (a), the Android exemption case alone (part 3, S1).
- Capture android (AC12): no setting applies — this is a finding about an
  unattributed connection, not a configurable behaviour.

### What the recommendation actually rests on

**Four failed lines, across three items in the table above, read "failed":**
S1 android and S1 iOS (item 2), S7 android (item 5), and capture android
(item 6). Two of these four lines do not drive the recommendation — though
one of them is a condition the owner must grant, not a resolved line:

- **S1 android** failed without the exemption (802 s, 602 s gaps, part 3).
  With the battery-optimisation exemption, it passed. This makes it **a
  condition of any GO, not a NO-GO driver — and not "resolved" or "fixed"
  either.** The SDK's own documentation
  (`react-native-background-geolocation` 5.7.0,
  `src/declarations/interfaces/DeviceSettings.d.ts`, read 2026-10-01 from
  the spike's installed package) treats this setting as a last resort, not
  a normal mode:

  > "In most cases, the plugin **will perform normally** with battery
  > optimizations. You should only instruct the user to _Ignore Battery
  > Optimizations_ for your app as a last resort to resolve issues with
  > background operation."
  >
  > "**WARNING:** Ignoring battery optimizations _will_ cause your app to
  > consume **much** more power."

  Our own evidence runs against the first sentence: without the exemption,
  S1 failed on stock Android — this was not a case where the plugin
  "performed normally". So a GO would depend on every user granting a
  setting the vendor itself calls a last resort, with a documented battery
  cost. That dependency belongs in front of the owner, not folded into a
  quiet "fixed".
- **S7 android** failed only in the case where the platform itself ended the
  process. The rule's own item 5 excuses this explicitly: "A platform that
  ends the process does so for any SDK, so that is recorded as a finding and
  not counted against this SDK."

**The other two of the four failed lines — S1 iOS and the Android capture
(AC12) — are what the recommendation rests on.** Neither has a documented
SDK setting that fixes it: S1 iOS has no setting that gives a simulator real
motion, and the unattributed Firebase connection is not something any SDK
setting addresses.

### Recommendation

**NO-GO.**

Per D-023's fallback, this leads to native modules for the background part,
which needs its own owner decision and plan; M1's exit is not met until that
decision exists.

### Findings for the owner (not deciding)

Pasted unchanged from the go/no-go output (commit `0a91285`):

- S2 android: failed; it does not decide the SDK
- S5 heard android: failed; it does not decide the SDK
- S7 android: failed because the platform ended the process, and nothing
  arrived after the change (night-20260930-s7-android-fine-1,
  night-20260930-s7-android-fine-2)
- S2 android: 1 reminder(s) said protection had stopped while arrivals
  continued (night-20260930-s2-android-lmk-1)
- S2 android: 1 reminder(s) said protection had stopped while arrivals
  continued (night-20260930-s2-android-lmk-2)

**Added here, not in the go/no-go's own output:** S7 fine's "what noticed
instead" was not recorded for either run (part 3, part 6) — with the
process gone, neither the reminder nor the server's 5-minute silence was
captured as the thing that would have noticed the walker's permission
change in the app's place.

### Open until L9 (D-041)

- S5 heard, iOS
- S6, iOS
- The capture, iOS

### The owner's decision

The recommendation goes to the owner as one question, with this rule's
result: **go ahead with native modules for the background part (D-023's
fallback), or ask more of this SDK first** — for example, confirming the
Android capture's attribution, or a different iOS test. The $399 is a cost,
so the owner decides (D-023, D-031).

**Asked together with this question, not before (spec, "Asked with the
go/no-go"):** when is the SDK's licence bought, if the answer is GO? The plan
currently disagrees with itself — `04-tech-stack.md`'s licence note says
TestFlight and Google Play testing builds need the licence (or its 30-day
trial) because they are release builds; the roadmap's M3 exit shows the app
through those same tracks; but the roadmap buys the licence in M5 (A-13). With
a GO, the licence would be needed at M3, not M5.

**Owner's answer: pending.**
