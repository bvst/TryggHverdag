# 6 · Testing strategy & regression protection

**Status:** ✅ Done (the switch-on point for real-device tests is asked in Section 7, round 1) · **Last updated:** 2026-09-20

## Summary
- Ten test levels (L1–L10), from type checks on every edit to production
  monitoring. Safety-critical flows are proven at the system level (L6) with a
  controlled clock.
- Regression gates RG-01 to RG-08 are binding (D-040):
  - every requirement ID has a test that names it;
  - tests come first;
  - tests can't be quietly weakened;
  - coverage can only go up;
  - mutation score ≥ 80 % on safety code blocks the build (D-036).
- No manual testing by people (D-035). **Real-phone tests (L9) are deferred:
  emulators and simulators only until the app has been shown (D-037).**
- Residual risks RR-01 to RR-04 are accepted, with automatic production
  monitoring (D-038).
- Test tools are delegated (D-039): Vitest, fast-check, Testcontainers,
  jest-expo with React Native Testing Library, Maestro, StrykerJS and oasdiff.

## Goal of this section
- Every requirement is protected by automated tests, at the cheapest level
  that can catch its failure.
- The tests are measurably trustworthy, and fast enough to run on every change.
- We are honest about what automation can't cover — real background behaviour
  on real phones — and cover that another way.

## Research findings — round 1

### 1. Maestro is Expo's preferred end-to-end test tool
- Maestro describes itself as Expo's preferred end-to-end testing platform. It
  runs the same YAML test flows on emulators, simulators and physical Android
  devices, but not on physical iPhones. It also offers an MCP server so coding
  agents can drive UI tests.
  Source: https://github.com/mobile-dev-inc/maestro
- **Implication:** Maestro for app UI tests, plus the MCP server for Claude
  Code (Section 7). Real-iPhone behaviour stays in field tests (L9).

### 2. App tests can run in CI on every pull request
- Expo's CI service (EAS Workflows) can run Maestro tests on Android emulators
  and iOS simulators, triggered by GitHub pull requests.
  Source: https://docs.expo.dev/eas/workflows/introduction
- Android emulators with Maestro can also run in GitHub Actions.
  Source: https://dev.to/peakiqofficial/e2e-testing-react-native-with-maestro-a-practical-guide-1g79
- **Claude's assessment:** EAS is a US service, but builds and test runs contain
  no personal data (test data is always synthetic), so this is consistent with
  D-016. The final choice is made in Section 8.

### 3. Mutation testing measures whether tests would catch a bug
- StrykerJS makes many small changes to the code, runs the tests after each
  one, and measures how many changes the tests notice. Coverage says a line ran;
  the mutation score says a bug in that line would have been caught. Version 10
  was released on 14 August 2026 and works with Vitest.
  Source: https://nevercodealone.de/de/frontend-development/strykerjs-mutation-testing-javascript-typescript-2026
- An incremental mode only re-tests what changed, which keeps pull-request
  runs fast, and a threshold can fail the build.
  Sources: https://github.com/stryker-mutator/stryker-js/commit/82bea5604c81c1ccf76d44827ad3922cfb61463b ·
  https://oneuptime.com/blog/post/2026-01-25-mutation-testing-with-stryker/view
- **Implication:** This is how we can be confident the tests are "sufficient",
  not just numerous — especially important when an AI writes both the code and
  its tests.

## Research findings — round 2

### 4. Cloud device farms run scripted tests on real phones
- Firebase Test Lab runs automated tests on real Android and iOS devices, using
  the platforms' own test frameworks (Espresso, UI Automator, XCUITest) or
  automatic app crawling. Physical devices cost $5 per device-hour after a free
  daily allowance. BrowserStack App Automate starts at $249 per month.
  Source: https://www.drizz.dev/post/firebase-test-lab-guide
- AWS Device Farm charges $0.17 per device-minute, or $250 per device slot per
  month unmetered.
  Source: https://testgrid.io/blog/best-device-farms/
- Maestro can't drive physical iPhones (finding 1), so the real-device suite is
  written in XCUITest (iOS) and UI Automator (Android). It is a small suite,
  written by Claude.
- **Estimate (hypothesis):** the real-device suite runs about 45 minutes on two
  phones (one iPhone and one Samsung), about 1.5 device-hours per run. Run on the
  trigger rule (below), about 6–8 times a month, that is roughly $45–60 per
  month on Firebase Test Lab.

### 5. Android's background restrictions can be forced from scripts
- **Known platform tooling (cite at setup):** Android's debugging tools can
  force the phone into its deep-sleep mode (Doze) and into restrictive app
  standby buckets. This lets emulator tests in CI reproduce much of what a phone
  in a pocket does, on every pull request.

## What mutation testing means
Mutation testing **tests the tests**. A tool plants one small bug at a time in
the code and runs the test suite after each one. For example:
- changes "silent for 5 minutes **or more**" to "**more than** 5 minutes";
- deletes the line that sends the escalation SMS;
- flips "acknowledged" to "not acknowledged".

If the tests still pass with the planted bug, it has "survived": that bug could
be introduced tomorrow and nothing would notice. The **mutation score** is the
share of planted bugs the tests caught.

This matters here because the same AI writes the code and its tests. It can
produce tests that run every line (so coverage looks perfect) but check too
little. Mutation testing exposes that. It is slow, so it runs only on
safety-critical code: incrementally on each pull request, fully every night.

## Test levels

| Level | What it covers | Tools (delegated, D-031) | When it runs |
|-------|----------------|--------------------------|--------------|
| L1 Static | Strict types, lint, import rules (AR-10), "no direct clock reads" (AR-03) | TypeScript, ESLint, dependency-cruiser | Every edit (hook) and in CI |
| L2 Domain | State machine, alert rules and retention rules with a fake clock, plus **property-based tests**, e.g. "for any sequence of events, a journey silent for 5 minutes is always LOST_CONTACT after the next sweep" | Vitest, fast-check | Every edit (affected tests) and in CI |
| L3 Server integration | Real PostgreSQL in a container: watchdog SQL, two competing workers, outbox atomicity, retention deletes, access control (PRIV-03), log scrubbing (PRIV-07) | Vitest, Testcontainers | Every pull request; before a task is "done" |
| L4 Contract | No breaking API changes against any supported app version | oasdiff, generated client | Every pull request |
| L5 App unit and component | Screens and logic, the safety core with a fake location SDK, every text key present in nb and en | jest-expo, React Native Testing Library | Every edit (affected tests) and in CI |
| L6 System | Complete flows through the real API with recording fakes for push and SMS and a controlled clock: LOST-02, LOST-07, SM rules. **The most important tests live here.** | Vitest against the running server | Every pull request |
| L7 App end-to-end | UI flows on an Android emulator and iOS simulator against a test server: setup, start journey, "I'm home", 112 always visible, responder acknowledges | Maestro | Android on every pull request; iOS nightly and before releases |
| L8 Production canary | REL-10: the real alert path, every 15 minutes | Worker plus external monitor | Continuously |
| L9 Automated real-device tests — **deferred (D-037)** | Background survival with the screen off, the force-quit reminder, the Samsung battery manager, real iOS background limits, real push delivery to the phone, permission states for Critical Alerts | XCUITest and UI Automator in a cloud device farm (round 2, question 2); the server measures heartbeat gaps | When safety-core code, native dependencies or the Expo SDK change; weekly; before every release |
| L10 Production reliability monitoring | Heartbeat gaps, lost-contact false alarms and alert delivery times, per phone model and OS version, computed from data the server already has (no location) | Worker job plus alert to the owner | Continuously. Any anomaly gets an automated regression test (D-035) |

## Regression gates (proposed)

| ID | Gate |
|----|------|
| RG-01 | Every story ID in `01b-mvp-scope.md`, and every SM, REL and PRIV rule that can be tested automatically, has at least one test that names it. CI generates a **requirement coverage report** listing requirements without tests. Safety-critical stories must be covered before any release. This report doubles as progress tracking (Section 9). |
| RG-02 | **Test first.** New behaviour starts with acceptance criteria turned into failing tests. Every bug fix, and every failure found at release or in production (D-035), starts with an automated test that reproduces it. |
| RG-03 | **Tests can't be quietly weakened.** CI flags skipped or focused tests, a drop in the number of tests, and changes to existing assertions. Any such change needs a written reason and a review by the reviewer agent (Section 7). This guards against an AI "fixing" a failing test by loosening it. |
| RG-04 | **Coverage ratchet:** coverage on changed files may not go down. Floors: ⚙️ 95 % branches for domain and safety-core code, ⚙️ 80 % lines overall. |
| RG-05 | **Mutation score floor** for domain, alert and safety-core code (round 1, question 2). |
| RG-06 | Flaky tests are quarantined and fixed within ⚙️ one week. A flaky safety test blocks releases. |
| RG-07 | Test data is always synthetic, built with the test kit; never copied from real users. |
| RG-08 | API compatibility check against every supported app version (D-030). |

## Residual risks — what no automation can fully prove (D-035)
Most of what earlier looked like "manual walk tests" is now automated (L7, L9,
L10). What remains:

| ID | Residual risk | Closest automated check |
|----|---------------|-------------------------|
| RR-01 | Whether a Critical Alert is actually **audible** on a physically silenced iPhone | Test confirms the alert was sent at the critical level and the permission is granted |
| RR-02 | Phone brands and models not available in the device farm | L10 flags any model with unusual heartbeat gaps; a regression test is then added on the closest farm model |
| RR-03 | Real outdoor GPS behaviour (tunnels, tall buildings, handovers between cell towers) | Simulated routes with gaps; L10 in production |
| RR-04 | Future OS updates that change background rules | Weekly L9 run on the newest OS versions in the farm; L10 alerts on changes |

The owner accepts these residual risks explicitly (round 2, question 3).

## Open questions for the owner

**Round 2 (asked 2026-09-20, answered):**
1. Now that mutation testing is explained above: should it block the build?
   (Recommendation: yes, block below ⚙️ 80 % on domain, alert and safety-core
   code, and only report elsewhere.)
2. Which platform runs the automated real-device tests (L9)?
   (Recommendation: Firebase Test Lab, pay per use, about $45–60 per month at
   the planned frequency. Builds use synthetic test data only, consistent with
   D-016. Together with hosting, this puts the total near the top of the D-024
   budget.)
3. Do you accept the residual risks RR-01 to RR-04, covered by automatic
   production monitoring? (Recommendation: yes.)

**Round 1 (asked 2026-09-20, answered):**
1. LOST-08: can the responder who tapped "I'm on it" close a lost-contact alert?
2. Should mutation testing block the build?
3. When should the manual walk test run?

## Rounds

### Round 1 — 2026-09-20
- **Questions:** LOST-08 · mutation testing gate · walk-test trigger.
- **Answers (owner):** yes, the responder can close it · "What does mutation
  testing mean?" · "What do you mean? Someone has to try it out manually on their
  phone? I want everything automated with tests. If something doesn't work when
  releasing, we should add tests to cover it. We should never rely on manual
  testing from people."
- **Outcome:**
  - D-034 (LOST-08) and D-035 (no manual testing) recorded.
  - Mutation testing is explained above.
  - Manual walk tests are replaced by automated real-device tests (L9) and
    production monitoring (L10). What remains is listed as residual risks
    RR-01 to RR-04.
  - SPIKE-01 is now automated (Section 4).

### Round 2 — 2026-09-20
- **Questions:** mutation testing gate · real-device platform · residual risks.
- **Answers (owner):** block below 80 % on safety code · "Start with
  emulators/simulators until we have shown the app." · accept, with automatic
  monitoring.
- **Outcome:** D-036 to D-040 recorded.
- **Claude's note on D-037:** Emulators can't reproduce Samsung's battery
  manager or real iPhone background limits. Until L9 is switched on, those risks
  are covered only by L10, meaning failures would first be seen in real use.
  Claude recommends switching L9 on before the private group relies on the app
  for real walks home; this is asked in Section 7, round 1. Section 6 closed.

## Next steps
Section closed. Continue in [07-claude-code-setup.md](07-claude-code-setup.md).
