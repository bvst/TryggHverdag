# 4 · Tech stack

**Status:** ✅ Done · SPIKE-01 ran on emulators and simulators (D-037); conditional GO recorded as D-086 · **Last updated:** 2026-10-01

## Summary

React Native + Expo, TypeScript everywhere (D-023). Clever Cloud for hosting
(D-025). Kartverket's tiles drawn with MapLibre, through a tile proxy later
(D-026). Background location: Transistorsoft's
`react-native-background-geolocation`, decided by SPIKE-01 as a
**conditional GO** (D-086) — the emulator and simulator evidence passed with
two conditions: the Android battery-optimisation exemption (asked for in
setup, checked and reported by the app), and iOS running with
`activity.disableStopDetection: true` (not tried in the spike; M3
configures and verifies it on a real phone). The real-device suite (L9)
must still pass — a real iPhone's 5-minute stop, and the Android exemption
on a real Samsung — before the group relies on the app (D-041); if it
fails, D-086 is reopened and D-023's fallback (native modules) is decided
on. The SDK's $399 licence is bought in M5, after L9 passes; M3's demo
builds use a 30-day trial key on the owner's own phones only (A-29). SMS via
LINK Mobility, push straight to APNs and FCM, SMS-code login with
device-bound sessions and an admin passkey, self-hosted EEA crash reporting,
and no over-the-air updates — all five proposed defaults accepted (D-086).
Full spike results: [`04b-spike-results.md`](04b-spike-results.md).

## Goal of this section
Choose the tools for the app, backend, notifications, SMS, maps, hosting and
crash reporting. Then prove the riskiest parts on real phones (the spike)
before committing.

## What the stack must satisfy
- iOS and Android from one team (D-003).
- Background location that survives real phones (F3, F4) and an offline queue
  (REL-02).
- Break-through alerts (D-020) and SMS escalation inside the EEA (D-019).
- All personal data stored and processed by EEA providers (D-016); no
  third-party analytics SDKs (PRIV-06).
- A server-side watchdog that uses the server's clock and survives restarts
  (D-007, REL-01).
- **Built for Claude Code** (D-002): mainstream, strongly typed,
  well-documented technology with good test tooling, and as few languages as
  possible. Fewer languages means fewer conventions for the agents to keep
  straight, and fewer places for regressions to hide.

## Research findings — round 1

### 1. Expo's own background location is not their focus
- Expo's documentation says they are not prioritising improvements to
  background location, and points to the paid
  `react-native-background-geolocation` library, which ships an Expo config
  plugin.
  Source: https://docs.expo.dev/versions/unversioned/sdk/location/
- An open bug report (Expo SDK 56, Samsung S23 and other Android 12+ devices):
  after an app update, the location foreground service keeps its notification
  but stops delivering positions until the app is force-closed.
  Source: https://github.com/MarkusAbtion/expo-location-fgs-update-repro
- **Implication:** Don't build the safety-critical background part on
  `expo-location`.

### 2. A mature background-location SDK exists for every framework
- Transistorsoft's background geolocation SDK works fully in debug builds for
  free; a licence is needed for release builds on both iOS and Android. It is
  available for React Native/Expo, Flutter, and native Swift and Kotlin.
  Sources: https://github.com/transistorsoft/react-native-background-geolocation ·
  https://www.npmjs.com/package/react-native-background-geolocation
- Price: one $399 perpetual licence covers one app on both platforms, for
  unlimited users, with one year of updates.
  Source: https://docs.transistorsoft.com/purchase/
- **Confirmed in its documentation (behaviour on real phones still to measure
  in the spike):** the SDK stores every position in an on-device database and
  uploads it by HTTP POST, from native code, to a server address we configure.
  It uploads nothing to third parties and deletes each position once our server
  confirms receipt. This covers REL-02 (the offline queue).
  Sources: https://www.github.com/transistorsoft/react-native-background-geolocation/blob/master/help/PRIVACY_POLICY.md ·
  https://www.github.com/mtws/react-native-background-geolocation/blob/master/docs/api.md
- **Implication:** The framework choice doesn't lock us out of this SDK, and
  the spike can use it for free in debug builds. The purchase decision can wait
  until the spike results are in.

### 3. EEA-owned hosting options exist with managed databases
- Scaleway (France), Hetzner (Germany) and OVHcloud (France) are EU-owned and
  EU-hosted, with no material exposure to the US CLOUD Act.
  Source: https://euvetted.com/alternatives/aws
- Clever Cloud is a French PaaS that runs only on European infrastructure and
  offers managed PostgreSQL with backups and failover handled for you.
  Source: https://europeanpurpose.com/tool/clever-cloud
- Exoscale is Swiss. Switzerland is not in the EEA, so D-016 excludes it.
- **Implication:** A managed EEA platform (for example Scaleway or Clever
  Cloud) keeps operations work low, which matters when nobody on the team
  operates servers by hand. Detailed comparison in round 2.

### 4. Push notifications always pass through Apple and Google
- **Known platform fact:** every iOS push goes through Apple's service (APNs)
  and every Android push through Google's (FCM). Both are US companies, and
  there is no way around this for a mobile app.
- **Claude's design proposal:**
  - Push messages carry no personal data: "Safety alert — open the app". The
    app fetches the details from our EEA server. Alternatively, the message is
    encrypted and decrypted on the phone (iOS supports this through a
    notification service extension).
  - Our server sends directly to APNs and FCM, with no third-party push relay
    (such as Expo's push service) in between.
  - The DPIA records that device tokens and delivery metadata pass through
    Apple and Google.

### 5. Map tiles reveal location
- **Hypothesis (round 2):** Whoever serves the map tiles learns which area a
  responder is looking at, and that area is the walker's location. Apple's and
  Google's maps are US services.
- **Options to research:** OpenStreetMap vector tiles hosted on our own EEA
  storage, or map tiles from Kartverket, the Norwegian mapping authority.

### 6. Over-the-air updates add risk
- The bug in finding 1 is triggered by app updates, including over-the-air
  JavaScript updates.
- **Implication:** No over-the-air code updates in the MVP. Every release goes
  through the full test gates and the store testing tracks (Section 8).

## Research findings — round 2

### 7. Hosting cost and effort
- Clever Cloud bills per second. The smallest instance (XS) costs roughly €4–5
  per month, and databases are priced separately. One reviewer running a
  moderate-traffic API paid about €40–60 for the app plus €20–30 for managed
  PostgreSQL — much more load than ours.
  Source: https://europeanstack.com/software/clever-cloud
- **Estimate for us (hypothesis, to check in Clever Cloud's calculator):** two
  XS instances (API and watchdog worker), a small managed PostgreSQL, and a
  small crash-report service come to about €25–50 per month, within D-024.
- **Comparison (Claude's assessment):** Scaleway has more building blocks
  (serverless containers, managed PostgreSQL), which means more pieces to wire
  and operate. Hetzner is cheapest for compute, but mostly raw servers, so we
  would run the database ourselves — more operational risk for a team with no
  operator.

### 8. SMS provider
- LINK Mobility, a Norwegian-founded messaging company, documents Norway's
  sender-ID rules: an alphanumeric sender name (for example the app's name)
  avoids extra per-message fees.
  Source: https://docs.linkmobility.com/regulatory-guidelines/sender-id/norway
- Wholesale prices to Norwegian networks are around €0.05 per SMS.
  Source: https://www.budgetsms.net/sms-gateway-pricing/no/norway/
- **Implication:** At our volume (login codes plus rare escalations) the cost is
  negligible.

### 9. Maps from Kartverket
- Kartverket publishes a topographic map of Norway as a tile service with four
  layers, including a colour map and a greyscale map.
  Source: https://data.norge.no/en/datasets/95c43b8f-9873-306b-bd48-f797bd52b741
- Third-party map tools credit it as CC BY 4.0.
  Source: https://git.gpxsee.org/root/GPXSee-maps/commit/dc20cd2364bdaadf6e103b20a072490b94083e6d
  **Verified in SPIKE-01 (S8, 2026-09-30; D-086).** Kartverket's own terms
  page (kartverket.no/en/api-and-data/terms-of-use) confirms CC BY 4.0,
  "released for free use for both commercial and non-commercial purposes",
  credited as "©Kartverket". No rate limit is stated. Tile address:
  `https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png`.
  **Open item for the tile proxy (D-026), not for this section:** at zoom
  levels 12–20 the terms require "special permission" from the Geovekst
  cooperation for anything beyond direct display — a caching proxy must
  settle this with Kartverket before it is built.
- It only covers Norway, which fits the launch market (D-003).
- **Verified in SPIKE-01 (S8).** MapLibre React Native
  (`@maplibre/maplibre-react-native` 11.4.0, MIT) draws Kartverket's tiles on
  both the Android emulator and the iOS simulator, with no native crash, and
  the Android build runs on the 16 KB-page image. Its native libraries are
  confirmed too, at 13.6.1 (Android) and 6.31.0 (iOS), both BSD-2-Clause.
  Our own EEA tile proxy (this finding's original proposal) is confirmed as
  later work, not yet built.

### 10. Critical Alerts: approval takes time and is tied to the app ID
- On Apple's forum it is stated that the entitlement won't be granted purely for
  demos. Some developers wait weeks for an answer, and one was first refused
  and then approved on a narrower request.
  Sources: https://developer.apple.com/forums/thread/106042 ·
  https://developer.apple.com/forums/thread/796105
- The entitlement is granted to a specific app ID on a specific developer team.
  One developer reports it did not follow the app when it was transferred to a
  new account (same source).
- Expo's notification library can request the Critical Alerts permission.
  Source: https://forums.expo.dev/t/critical-alerts/57006
- **Implication:** If the app might later move from a personal account to a
  company account, we may have to request the entitlement again. Time Sensitive
  covers the gap.

### 11. Developer account types
- Apple costs $99 per year either way. An organisation account needs a D-U-N-S
  number and shows the company name; an individual account shows your own name
  and can't give other people access. Google costs $25 once either way, and an
  organisation account also needs a D-U-N-S number.
  Source: https://www.choicely.com/blog/individual-vs-organization-developer-account
- Google's 12-tester rule applies to personal accounts (Section 1, finding 9).

### 12. Using the owner's existing AS
- An organisation enrolment needs a D-U-N-S number, the enroller's authority
  to bind the company, a work email on the company's domain, and a public,
  working website on that domain.
  Source: https://developer.apple.com/help/account/membership/program-enrollment/
- The D-U-N-S number is free. A new one can take up to 5 business days, plus
  up to 2 business days before Apple sees it.
  Source: https://developer.apple.com/help/account/membership/D-U-N-S/
- Individual accounts can't invite collaborators and publish under a personal
  name. Organisation accounts publish under the company name and support team
  members.
  Source: https://www.choicely.com/tutorials/how-to-create-an-apple-developer-account-for-your-organization
- In the EU, an individual trader account must show an address, phone number
  and email on the App Store product page. For organisations, the address comes
  from the D-U-N-S record. Sole proprietorships (ENK) are not accepted as
  organisations.
  Source: https://viblo.asia/p/apple-developer-program-enrollment-what-apple-actually-requires-and-where-people-get-stuck-pPLkNbBGJRZ
- Google's 12-tester rule is documented for personal accounts; organisation
  accounts fall outside its stated scope.
  Source: https://primetestlab.com/blog/google-play-12-testers-closed-testing-guide
- **Claude's assessment (not legal advice):** Using the AS from the start avoids
  a later app transfer, and with it a new Critical Alerts request (finding 10).
  It also keeps the owner's home address off the store, and makes the AS the
  GDPR controller (D-015).

## Options: app framework

| | **A. React Native + Expo** | **B. Flutter** | **C. Native (Swift + Kotlin)** |
|---|---|---|---|
| One codebase for both platforms | Yes | Yes | No — every feature and test written twice |
| Same language as the backend | Yes (TypeScript everywhere) | No (Dart + backend language) | No (three languages) |
| Claude Code strength | Very high — TypeScript and React are extremely common | High | High, but two codebases have to stay in sync |
| Access to native APIs | Via libraries and small native modules (Swift/Kotlin) | Via plugins and platform channels | Full |
| Background location | Transistorsoft SDK | Transistorsoft SDK | Transistorsoft SDK or custom |
| Test tooling | Jest, React Native Testing Library, Maestro for end-to-end | flutter_test, integration_test, Maestro | XCTest and Espresso, separately |
| Builds and native config | Expo config plugins keep native settings in reviewed code; cloud builds available | Standard Flutter tooling | Xcode and Gradle projects |
| Main risk | Background edge cases — covered by the SDK and the spike | A second language next to the backend | Feature and behaviour drift between platforms: the opposite of our regression goal |

### Recommendation: A — React Native with Expo, TypeScript everywhere
- Development builds (not Expo Go), strict TypeScript, and the Transistorsoft
  SDK for journeys and heartbeats.
- Small custom native modules (Swift/Kotlin, via the Expo Modules API) for
  anything libraries don't cover, for example the REL-04 reminder if needed.
- One language across the app, backend, shared validation schemas and tests.
  API types are shared, so a change that breaks the contract between app and
  server fails the type check before it reaches a test.
- **Fallback:** if the spike shows background behaviour can't be made reliable
  this way, keep React Native for the UI and write the background part as
  native modules.

## Backend — recommended direction (details in round 2 and Section 5)
- **Language:** TypeScript on Node.js, sharing types with the app.
- **Data:** PostgreSQL as the single source of truth, on a managed EEA service
  with automatic backups.
- **Watchdog:** a worker checks active journeys every ⚙️ 10–15 seconds against
  the database clock (REL-01). All state lives in the database, not in
  in-memory timers, so a restart loses nothing.
- **Sending:** a Postgres-backed job queue sends push and SMS messages with
  retries, straight to APNs, FCM and an EEA SMS provider.
- **Login:** phone-number verification by SMS code with device-bound sessions
  (SEC-01); passkey for the admin (SEC-05).
- **Crash reporting:** self-hosted in the EEA, or none, to satisfy PRIV-06 and
  PRIV-07. Decided in round 2.
- **Monitoring:** an external EEA uptime monitor (REL-08) plus the canary
  journey (REL-10).

## Rough costs — estimates, verified in round 2

| Item | Estimate |
|------|----------|
| Apple Developer Program | about $99 per year |
| Google Play developer account | about $25, one-time |
| Background location SDK (after the spike) | $399 one-time, including one year of updates |
| Hosting: app, worker and managed Postgres (private phase) | roughly €20–60 per month |
| SMS: login codes and escalations for 12–20 people | a few NOK per month |

## Spike plan — SPIKE-01: prove the risky parts on emulators and simulators (D-037)
Throwaway code in `/spikes/background-safety/`, never shipped. Uses debug
builds, so no SDK licence is needed yet. **Fully automated (D-035):** no one
walks with a phone. Emulators and simulators replay recorded GPS routes
(D-037); the real-device suite (L9) is separate work, switched on before the
group relies on the app (D-041). Every test below is a script, and the
server measures the heartbeat gaps.

| Test | What we check | Pass when |
|------|---------------|-----------|
| S1 | 45-minute scripted journey, screen off, heartbeat every 60 s — simulated GPS route on the Android emulator and the iOS simulator (D-037); the real-phone cases (a real iPhone, a real Samsung) are L9's | No gap longer than 2 minutes; battery use ≤ ⚙️ 10 % (measured by script where the platform allows) |
| S2 | Swipe the app away mid-journey | The REL-04 reminder fires on both platforms |
| S3 | Manufacturer battery managers, with and without the exemption | The service survives 45 minutes with the exemption; the failure without it is detectable |
| S4 | Airplane mode for 3 minutes mid-walk | Queued positions arrive in order afterwards (REL-02) |
| S5 | Alerts: iOS Time Sensitive (Critical once Apple approves); Android high-priority channel with Do Not Disturb override; content-free payload | The alert is seen and heard on a silenced phone where the platform allows it |
| S6 | One-tap call | Behaviour documented for both platforms (CALL-01) |
| S7 | Reduce location permission mid-journey | Detected within 1 minute (REL-05) |

**Scope change (D-037):** Until real-device tests are switched on, the spike
ran on emulators and simulators only. The real-phone parts of S1–S3 (the
Samsung battery manager, real iPhone background limits) stay open until L9
runs them.

**Licence note:** Test builds distributed through TestFlight and Google Play
testing tracks are *release* builds, so the location SDK needs a licence (or
its free 30-day trial licence) before the app can be shown on real phones.
Source: https://github.com/transistorsoft/react-native-background-geolocation
**Settled by D-086:** M3's demo builds use a 30-day trial key, on the
owner's own phones only; the $399 licence itself is bought in M5, after L9
passes.

## Spike results — conditional GO (D-086)

SPIKE-01 ran S1–S7 on the Android emulator and the iOS simulator (D-037),
and S8 checked MapLibre with Kartverket's tiles. Full results:
[`04b-spike-results.md`](04b-spike-results.md).

**The go/no-go rule gave NO-GO** (S1 iOS failed and stayed deciding; the
Android capture showed an unattributed Firebase Installations session).
**The owner chose the recommended conditional GO instead (D-086,
2026-10-01):**
1. **Android:** setup asks the user for the battery-optimisation exemption,
   and the app checks and reports it, failing loudly when it is missing. S1
   passed only with it granted: 109 s against the 120 s limit, an 11 s
   margin, on emulator evidence.
2. **iOS:** journeys run with `activity.disableStopDetection: true`, not
   tried in the spike. M3 configures and verifies it on a real phone.
3. **L9:** a real iPhone's 5-minute stop (unplugged, screen off) and the
   Android exemption on a real Samsung must pass before the group relies on
   the app (D-041). If L9 fails, D-086 is reopened and D-023's fallback
   (native modules) is decided on.
4. **The capture's Firebase Installations session** is counted as Google
   Play Services' own traffic, not the SDK's, on the evidence in the
   results document, part 4.4.

**The sharing-is-visible mechanism** (the JRN section's second story), as
the spike's app used it: on Android, the SDK's own location foreground
service notification (`app.notification`, a fixed title and text); on iOS,
the system's background-location indicator, turned on with
`geolocation.showsBackgroundLocationIndicator: true`. Both are visible to
the person carrying the phone for as long as a journey is active.

**Needed before the spike started:** an Apple Developer account was expected
to install test builds on iPhones, but the spike used an EAS simulator
build instead (the spec's Q2), so no Apple account was needed for the spike
itself. An account is still needed to request the Critical Alerts
entitlement (D-020) and for real test builds.

## Open questions for the owner

**Round 2 (asked 2026-09-20, answered — the account type was confirmed in Section 5, round 1, as D-027):**
1. Developer accounts: private person or company? (Recommendation: private
   person now, and decide on a company before any public launch. Simplest and
   fastest. Cost: the app shows your name to testers, and Critical Alerts may
   need a new request after a later transfer.)
2. Hosting provider? (Recommendation: Clever Cloud — least operations work,
   within budget.)
3. Map tiles? (Recommendation: Kartverket's map, served through our own EEA tile
   proxy.)

**Proposed defaults — all five accepted as written (D-086, 2026-10-01):**
- **SMS:** LINK Mobility, with an alphanumeric sender name.
- **Push:** straight from our server to APNs and FCM, with content-free
  payloads. **Note, added with D-086:** FCM push brings Firebase into the
  Android app itself (a Google Services configuration, and Firebase
  Installations). That is push plumbing, not analytics, but it is still a
  data flow to Google, for the privacy assessment (PRIV-06, D-016).
  SPIKE-01's own network-capture classifier, which flags Firebase hosts as
  analytics, describes the spike's own evidence only, not this product
  integration.
- **Login:** SMS code plus device-bound sessions (SEC-01), and a passkey for the
  admin (SEC-05). Built into our own backend with an established library, so no
  third-party login provider holds user data. The library is chosen in
  Section 5.
- **Crash reporting:** a self-hosted, Sentry-compatible service in the EEA,
  opt-in only, off for members under 15 (PRIV-12), and scrubbed of locations and
  phone numbers (PRIV-07).
- **Over-the-air updates:** none in the MVP.

**Round 1 (asked 2026-09-20, answered):**
1. Which app framework?
2. What monthly running budget is acceptable for the private phase?
3. What phones does the group use?

## Rounds

### Round 1 — 2026-09-20
- **Questions:** framework · monthly budget · phones in the group.
- **Answers (owner):** React Native + Expo · €30–100 per month · don't know yet.
- **Outcome:** D-023 and D-024 recorded. The phone mix is unknown, so owner
  action A-01 surveys the group. The spike device list is set once the answers
  are in; until then it covers at least one iPhone and one Samsung.

### Round 2 — 2026-09-20
- **Questions:** account type · hosting provider · map tiles.
- **Answers (owner):** "What are the differences? I already have an AS, so I
  can use it." · Clever Cloud · Kartverket via our own server.
- **Outcome:** D-025 (Clever Cloud) and D-026 (maps) recorded. Differences
  explained in finding 12. Claude recommends the AS; the owner confirms in
  Section 5, round 1. Owner actions A-02 and A-03 updated for an organisation
  enrolment.

## Next steps
Section 4 is closed. What D-086 hands to later milestones:
1. **M3** configures the two conditions: the Android battery-optimisation
   exemption in setup, with the app checking and reporting it; and iOS's
   `activity.disableStopDetection: true`, verified on a real phone.
2. **M3** also: posts the alert with `CATEGORY_ALARM` (S5 "heard"); decides
   what the app does when Android's precise location is reduced and the
   process never comes back (S7's "fine" case); makes the on-device
   retention settings explicit; reviews the SDK's release merged manifest;
   and handles the native engines' and MapLibre's licences by hand, since
   `licenses:check` cannot see them.
3. **L9**, the real-device suite, must pass before the group relies on the
   app: a real iPhone's 5-minute stop (unplugged, screen off) and the
   Android exemption on a real Samsung (D-041). If it fails, D-086 is
   reopened.
4. **Owner:** request the SDK's 30-day trial key shortly before M3's demo
   (A-29), and buy the $399 licence in M5, after L9 passes (D-086).
5. **Owner:** send the phone survey (A-01) and start the Apple and Google
   developer account enrolments (A-02, A-03) — still needed for the
   Critical Alerts request and for real test builds.
