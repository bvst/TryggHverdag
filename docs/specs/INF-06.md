# INF-06 · App skeleton

**Status:** 📝 Spec, owner questions answered 2026-09-25 (at the end) · **Last updated:** 2026-09-25 ·
**Branch:** `feat/INF-06-app-skeleton` (the Mac, `claude-dev`, D-055/D-056) · **Milestone:** M0

## Requirement

From `docs/plan/10-roadmap.md`, the M0 task list:

> | INF-06 | App skeleton: Expo development build, Expo Router, nb and en
> translations, jest-expo, one Maestro flow | L5 and L7 (Android emulator)
> pass in CI |

The two levels, from `docs/plan/06-testing-strategy.md`:

> | L5 App unit and component | Screens and logic, the safety core with a fake
> location SDK, every text key present in nb and en | jest-expo, React Native
> Testing Library | Every edit (affected tests) and in CI |
>
> | L7 App end-to-end | UI flows on an Android emulator and iOS simulator
> against a test server: … | Maestro | Android on every pull request; iOS
> nightly and before releases |

And the check, from `docs/plan/08-cicd-releases.md`:

> | CI-09 | Android UI tests (Maestro on an emulator) against a test server | L7 |

`scripts/lib/merge-rules.mjs` already lists that check as `android-e2e`,
needing the script `e2e:android`, arriving in INF-06.

### Decisions this spec builds on (binding)

| Decision | What it fixes for INF-06 |
|----------|--------------------------|
| D-014 | Bokmål first, then English; all app text in translation files from day one |
| D-016 | Personal data stays in the EEA; no third-party analytics or advertising SDKs (the privacy table in `02-norway-law-privacy.md`) |
| D-023 | React Native with Expo, **development builds** (not Expo Go), strict TypeScript. `04-tech-stack.md` finding 6: no over-the-air updates |
| D-031 | Library and tool choices are Claude's, recorded with reasons and a fallback |
| D-032 | Expo Router and react-i18next are already chosen |
| D-035, D-037 | Everything automated; emulators and simulators only until the app has been shown |
| D-039 | jest-expo with React Native Testing Library at L5; Maestro at L7 |
| D-042, D-043 | CODEOWNERS paths need an owner's approval; three blocking reviewers |
| D-057, D-058 | `@trygghverdag/*` package scope; Node 22, pnpm 10.33.0, TypeScript 6.0 |
| D-060 (CI configuration v1) | One list of checks read at run time; a job whose script is missing is left out, not skipped; actions pinned to commit SHAs |
| D-061, CI-12 | Gates that have nothing to check run and say so. Never a `paths:` filter, never a job-level `if:` |
| D-075 | `ai-review.yml` changes are merged by hand. INF-06 does not touch that file |
| AR-09, AR-10 | The safety core is isolated; import boundaries are enforced by tooling |

### How this spec names requirements, and why

`pnpm run req:coverage --fail-on-uncovered-changed` reads every changed file
under `docs/specs/` and `apps/` (`scripts/req-coverage.mjs`, lines 98–101). It
fails the `traceability` check if one of those files names a **tracked**
requirement that no test names yet. Today only three tracked IDs have tests
(`docs/requirements-status.md`). So this spec names the other tracked
requirements in words and gives the file where each one lives, not its ID.
The same applies to every file INF-06 adds under `apps/mobile/`. A comment
such as "the 112 button goes here later", written with that story's ID,
would turn `traceability` red with nothing wrong in the code. Untracked
prefixes (INF, AR, RG, CI, HK, D, F, L) are safe to name.

## Scope

INF-06 builds an app that starts, shows one translated screen and proves both
at L5 and L7. It also wires that app into the gates the server already goes
through. In scope:

- The `apps/mobile` workspace package (`@trygghverdag/mobile`), set up for
  Expo development builds, with Expo Router and one placeholder route.
- Bokmål and English translation files, and choosing the language from the
  device.
- jest-expo and React Native Testing Library at L5, added to `test:unit`,
  `test:coverage`, the per-edit gate (HK-04) and the coverage ratchet (RG-04).
- One Maestro flow, run on an Android emulator by a new script,
  `e2e:android`.
- A new `android-e2e` job in `ci.yml`. It becomes a required check, which is
  CI-09 switched on.
- Every existing gate keeps working with the app present: static checks,
  import rules, Vitest, coverage, licences, audit and `gate:integrity`.

The placeholder screen shows the working title and one line saying the app
is being built. **It must not say or imply that anyone is protected.** A
safety app that shows reassurance it cannot back up is the false-reassurance
failure in the F10 row of `03-safety-reliability-security.md`, reached by a
different route.

## Acceptance criteria

**INF-06-AC1: the app is a workspace package that every static gate covers.**
Given a clean clone on Node 22 with pnpm 10.33.0,
when `pnpm install --frozen-lockfile` and then `pnpm run gate:static` run at
the root,
then both succeed, and `apps/mobile` is the workspace package
`@trygghverdag/mobile`, which the formatting, type, lint and import-rule
checks in that run include rather than exclude.

**INF-06-AC2: the app opens on its index route, in bokmål.**
Given the device's preferred language is Norwegian bokmål,
when Expo Router renders the app's initial route,
then the index route under the root layout shows the title as a heading and
the status line, both taken from `nb.json`, and no text on the screen is a
raw translation key.

**INF-06-AC3: English devices get English.**
Given the device's preferred language is English,
when the same route renders,
then it shows the strings from `en.json`. At least one visible string differs
between the two files, so the test can tell which file was used.

**INF-06-AC4: the language is chosen from the device's list.**
Given the device's preferred languages, in order,
when the app chooses its language,
then it takes the first one it has: `nb`, `nn` and `no` mean bokmål, and `en`
means English. When none of them match, it uses bokmål.

**INF-06-AC5: every text key exists in both languages.**
Given `nb.json` and `en.json`,
when they are compared,
then they have exactly the same keys, every value is a non-empty string, and
bokmål is the fallback language the translation library is configured with.

**INF-06-AC6: L5 runs wherever the unit tests run.**
Given `pnpm run test:unit`,
when it runs,
then it runs both the Vitest suite and the app's jest-expo suite, and fails
if either fails. It also fails if jest-expo finds no tests, and Vitest
collects no file under `apps/mobile/`.

**INF-06-AC7: the per-edit gate tests app files with the app's runner.**
Given an edited file under `apps/mobile/src/`,
when `pnpm run gate:file <that file>` runs (HK-04, after every edit),
then it runs the jest-expo tests related to that file. An edited server file
still gets Vitest's related tests.

**INF-06-AC8: the app's coverage is measured once, by the right runner.**
Given `pnpm run test:coverage`,
when it finishes,
then code under `apps/mobile/src/` has been measured by jest-expo and by
nothing else. `coverage:ratchet` reads both runners' summaries, and refuses
to pass if either one is missing. `coverage-baseline.json` includes the
app's files.

**INF-06-AC9: `e2e:android` passes only when every flow ran and passed.**
Given `pnpm run e2e:android`,
when any of the following is true, then it exits non-zero with a message
saying which one:
- no Android device is connected;
- the only devices connected are real phones, not emulators (amended
  2026-09-26: it never installs onto, or reads crash logs from, a real phone);
- Maestro is not usable, or Java is not 17 to 21 (amended 2026-09-26: Java 25
  passes a "17 or newer" check and then fails the native build after about 18
  minutes; the message says to set `JAVA_HOME` to a JDK 17);
- the pinned Maestro download does not match its hash;
- Maestro exits non-zero, even if its report shows every flow passed
  (amended 2026-09-26; the message names both the exit status and the report);
- Maestro's report shows zero flows run;
- any flow failed.

Otherwise it passes, and says how many flows ran.

**INF-06-AC10: the test build needs no EAS and no Expo account.**
Given a machine with the Android SDK and Java 17,
when `e2e:android` builds the app,
then it generates the native project from `app.config.ts` (no committed
`android/` folder) and builds the release variant for x86_64 with Gradle on
that machine. It uses no Expo account, token or EAS service.

**INF-06-AC11: the one Maestro flow.**
Given the release build is installed on an Android emulator whose language is
Norwegian bokmål,
when the flow in `apps/mobile/e2e/` launches the app from a cleared state,
then the bokmål title and status line are visible, and no raw translation key
is.

**INF-06-AC12: `android-e2e` runs the flow in CI, the way every other gate
runs.**
Given a pull request, when `ci.yml` runs, then the job named `android-e2e`:
- classifies the diff before any other step;
- if the diff touches nothing that can change the app, prints that and
  passes;
- otherwise enables hardware acceleration, and fails with a message if that
  cannot be done;
- builds the app before the emulator boots, then boots the emulator and runs
  `pnpm run e2e:android`.

On a push to `main` it always does the full run. It has no job-level
condition and no `paths:` filter, is bounded by `timeout-minutes`, and uses
no repository secret.

**INF-06-AC13: what counts as "can change the app" is computed, not listed.**
Given a list of changed files,
when the classifier decides whether `android-e2e` has work,
then it answers yes for any of these:
- anything under `apps/mobile/`;
- any workspace package in the app's dependency closure;
- the root files that decide what is installed (`package.json`,
  `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`,
  `.node-version`);
- `.github/workflows/ci.yml`;
- the e2e script and every repository module it imports.

It answers no for anything else. The dependency closure and the import
closure are worked out from the files themselves, so a new dependency or
import cannot fall outside them unnoticed.

**INF-06-AC14: `android-e2e` is a required check.**
Given that the `e2e:android` script exists,
when `pnpm run gate:integrity` runs,
then `android-e2e` is among the checks that must be required, and
`docs/plan/main-ruleset.json` lists it. The gate fails, naming `android-e2e`,
until the check is on the live ruleset, and reports 5 of 5 once it is.

**INF-06-AC15: `gate:full` says where L7 ran, or that it could not.**
Given `pnpm run gate:full`,
when no Android device is connected,
then it lists the L7 step as not possible on this machine and names the
`android-e2e` check as where it runs. With a device connected, it runs
`e2e:android`.

**INF-06-AC16: the development build works on the Mac.**
Given the Mac with its Pixel 8 emulator running,
when `pnpm run dev` and the app's `android` script run,
then a debug build that includes `expo-dev-client` is installed, loads its
JavaScript from the local Metro server, and shows the index route.

**INF-06-AC17: no over-the-air updates.**
Given the app's declared dependencies and its Android autolinking result,
when they are inspected,
then neither one contains `expo-updates`, and the app config sets no update
URL.

**INF-06-AC18: the safety-core boundary covers the routes.**
Given a file anywhere under `apps/mobile/src/` outside `safety-core/`, routes
under `src/app/` included,
when it imports a safety-core file other than that folder's index,
then `pnpm run imports:check` fails, naming the AR-09 rule.

## Test plan

Test files are written by `test-author` and production code by `implementer`
(RG-02, HK-02). `apps/mobile/e2e/**` is test code under `TEST_GLOBS`, so the
Maestro flow belongs to `test-author`. INF is not a tracked prefix, so these
tests do not move `req:coverage`. They still carry `INF-06-ACn:` names:
D-074 removes the obligation, not the practice.

"Tooling" means Vitest tests of gate scripts, the level `scripts/**/*.test.mjs`
already runs at in the `unit` job.

| AC | Level | Test file | Runs in |
|----|-------|-----------|---------|
| AC1 | L1, plus tooling | the `static` job itself; `scripts/turbo-inputs.test.mjs` extended to `apps/mobile`, so turbo's typecheck key covers every file tsc reads there | `static`, `unit` |
| AC2 | L5 | `apps/mobile/src/app.test.tsx` (outside `src/app/`, see the layout): the route rendered through Expo Router's testing library, queried by role and name | `unit`, HK-04 |
| AC3 | L5 | same file | `unit`, HK-04 |
| AC4 | L5 | `apps/mobile/src/shared/translations/language.test.ts` (pure function, table of device lists) | `unit`, HK-04 |
| AC5 | L5 | `apps/mobile/src/shared/translations/translations.test.ts` | `unit`, HK-04 |
| AC6 | tooling | `scripts/gate.test.mjs`: `test:unit` runs both runners, no `--passWithNoTests`, Vitest configs exclude `apps/mobile/**`. The `unit` job log shows both runners' counts | `unit` |
| AC7 | tooling | `scripts/gate-file.test.mjs` (`stepsFor`) | `unit` |
| AC8 | tooling | `scripts/lib/coverage.test.mjs` (merging two summaries; a missing summary refused) | `unit`, `traceability` |
| AC9 | tooling | `scripts/lib/e2e-android.test.mjs` (pure decisions); `scripts/e2e-android.test.mjs` runs the entry script as a real process against fakes, the way `daily-status` and `doctor` are tested | `unit` |
| AC10 | tooling, plus L7 evidence | `scripts/lib/e2e-android.test.mjs` asserts the build plan (prebuild, then Gradle release for x86_64, no `eas`). The `android-e2e` job log is the real evidence | `unit`, `android-e2e` |
| AC11 | **L7** | `apps/mobile/e2e/app-starts.yaml` | `android-e2e`; on the Mac by `pnpm run e2e:android` |
| AC12 | tooling | `scripts/gate.test.mjs`: the existing CI-12 tests (no job-level `if:`, classify before guard) extended to the new `app` output; the job exists, is bounded, checks KVM, runs `pnpm run e2e:android`, names no `secrets.` | `unit` |
| AC13 | tooling | `scripts/lib/affected.test.mjs` | `unit` |
| AC14 | tooling, plus CI-01 live | the existing test that puts `main-ruleset.json` through `reviewRuleset`. It fails by itself once `e2e:android` exists, until the file lists the check. Then `gate-integrity` against the live repository | `unit`, `gate-integrity` |
| AC15 | tooling | `scripts/gate.test.mjs` (`FULL_STEPS`, and the device probe injected the way `availableTools` injects Docker's) | `unit` |
| AC16 | tooling, plus a one-off L7 on the Mac | a shape test that `expo-dev-client` is a dependency and `dev` starts Metro for it. **The run on the Mac is done once, and its output is quoted in the pull request. It is not repeated in CI** (see approach and cost) | `unit`; the Mac, once |
| AC17 | L5 | `apps/mobile/app.config.test.ts` | `unit` |
| AC18 | L1, plus tooling | `packages/config/dependency-cruiser.test.mjs` (new; no rule in that file has a test today) | `unit` |

Each criterion's test must fail before its code exists, and the pull request
shows it (DOD-02). INF-06 is done only after the merge's staging deploy and
smoke test pass as well (DOD-08). The app's dependencies change what Clever
Cloud installs (see the risks).

## Technical approach

### Versions (delegated, D-031; recorded as D-081, since D-079 and D-080 were taken while INF-06 was open)

- **Expo SDK: the newest stable SDK on the day the red phase starts**, as
  long as it (a) installs on Node 22 under `engine-strict=true` (D-058),
  (b) has a matching `jest-expo`, and (c) builds in this pnpm workspace. The
  newest SDK the plan has evidence of is SDK 56 (`04-tech-stack.md`
  finding 1 cites a bug report against it). If a newer stable SDK exists, it
  is preferred. Check with `npm view expo dist-tags` and Expo's changelog,
  and record the exact Expo, React Native and React versions. **Not verified
  from this session.** Why the newest:
  1. An SDK upgrade means rebuilding all native code. Once real-device tests
     run, it also sets off L9 (`06-testing-strategy.md`: "when … the Expo SDK
     change"). The newest stable SDK gives the longest stretch before go-live
     without one.
  2. Expo supports a limited window of recent SDKs, and D-054 sets no date
     for M5.
  3. Google Play's minimum target API level rises every year, and a current
     SDK targets the current level by default.
  4. From SDK 55 the New Architecture is the only one. The M1 spike judges
     the location SDK and MapLibre against it either way.

  **Fallback:** the previous SDK, if the newest one fails (a) to (c). The
  failure is quoted in the decision.
- **React Native, React and every Expo module are installed with
  `expo install`**, so their versions are the SDK's own list and nobody picks
  them by hand.
- **TypeScript stays at the workspace's 6.0** (catalog, D-058). Babel strips
  the types in the app, so the compiler version only matters to
  `tsc --noEmit`. If Expo's or React Native's types do not check under 6.0,
  stop and report. Do not add a second TypeScript to the workspace.
- **jest-expo** matches the SDK, **Jest** is whatever jest-expo requires, and
  **@testing-library/react-native** is at its current major version (D-039).
- **i18next and react-i18next** (D-032), plus **expo-localization** for the
  device's ordered list of languages.
- **Maestro at a pinned version.** The Mac has 2.10.0, and CI pins the same
  unless there is a reason to move. It is downloaded and checked by SHA-256,
  the way Terraform and clever-tools are (D-077 items 8 and 16,
  `scripts/lib/pinned-binary.mjs`). If Maestro publishes no checksum, the
  hash is trust-on-first-use and the decision says so. Maestro ships as a
  folder of jars, not one binary, so the helper may need to accept a folder.
- **The emulator in CI comes from `reactivecircus/android-emulator-runner`,
  pinned to a commit.** It handles KVM, creating the virtual device, snapshot
  boot and teardown. **Fallback:** our own script around `sdkmanager`,
  `avdmanager` and `emulator`. Its licence goes in the decision:
  `licenses:check` reads the npm tree and cannot see an action, as with
  Terraform (D-077 item 8).
- **`actions/setup-java` for Java 17 and `gradle/actions/setup-gradle` for
  the Gradle cache**, both pinned. setup-gradle writes its cache from `main`
  only, which keeps pull-request branches from filling the cache.
- **Start from Expo's minimal TypeScript template, not the default tabs
  template**, and add only what Expo Router needs. SEC-06 says "keep
  dependencies few". So: no web support, no Reanimated, no gesture handler,
  no haptics, image or webview modules, and no experimental flags (typed
  routes, React Compiler).

### Workspace layout

```
apps/mobile/                      @trygghverdag/mobile
├── package.json                  main: expo-router/entry · no "type": "module"
├── app.config.ts                 the one place native settings live (CNG)
├── app.config.test.ts            AC17
├── tsconfig.json                 extends packages/config/tsconfig/base.json
├── README.md
├── e2e/
│   └── app-starts.yaml           the Maestro flow (AC11)
└── src/
    ├── app/                      Expo Router routes
    │   ├── _layout.tsx           root layout; translations ready before first render
    │   └── index.tsx             the placeholder screen
    ├── app.test.tsx              AC2, AC3. Never inside src/app/: Expo Router
    │                             takes every .ts/.tsx there as a route, and
    │                             Metro then bundles the test into the build
    └── shared/
        └── translations/         already watched by a11y-i18n-reviewer's filter
            ├── nb.json
            ├── en.json
            ├── index.ts          i18next set-up
            ├── language.ts       which language, from the device's list
            ├── language.test.ts
            └── translations.test.ts
```

- **Not created: `src/safety-core/` and `src/features/`.** No feature exists
  yet. `safety-core/` is also a safety path (`SAFETY_PATHS`), and Stryker's
  command runner runs only Vitest (`stryker.config.mjs`). A file there would
  switch on a mutation gate that nothing can yet kill a mutant for. The import
  rules and CODEOWNERS entries already wait for that folder.
- **Routes live in `src/app/`.** Expo Router uses `src/app` when it exists.
  Everything then sits under `src/`, which turbo's typecheck inputs
  (`src/**`), the `ui` filter in `ai-review.yml`
  (`apps/mobile/src/**/*.tsx`) and `.claude/rules/ui-i18n.md` already cover.
  So INF-06 needs **no change to `ai-review.yml`** (D-075).
- **The AR-09 import rule is widened in the same change (AC18).**
  `ui-cannot-reach-the-safety-core` names `features` and `shared` as its
  sources, so a route in `src/app/` could reach into safety-core internals and
  pass `imports:check`. The rule becomes "anything under `apps/mobile/src/`
  except `safety-core/` itself". Future folders are then covered without
  another edit.
- **No `"type": "module"` in the app's `package.json`.** Metro, Babel's
  config lookup and Jest treat `.js` in a React Native project as CommonJS.
  The root's `"type": "module"` does not carry into a package that has its
  own `package.json`.
- **No path aliases.** dependency-cruiser resolves without tsconfig `paths`,
  and relative imports keep AR-10 checkable.
- **tsconfig** extends the repository's base for strictness. It overrides
  module, module resolution, `jsx` and `lib` with the values Expo documents
  for Metro. The typecheck in CI must not depend on files that only
  `expo start` generates (`expo-env.d.ts`, `.expo/types`). If the app needs
  a declaration file, it is committed.
- **Generated native folders are ignored by every tool.** `android/`, `ios/`
  and `.expo/` are already in `.gitignore`. ESLint's `IGNORED_PATHS` and
  dependency-cruiser's `exclude` also get them, because after a local build
  the Mac has them on disk and neither tool reads `.gitignore`.
- **Application ID:** a placeholder in reverse-domain form, marked as a
  placeholder in a comment and defined once in `app.config.ts`. The e2e
  script passes it to Maestro, so the flow never repeats it. It costs nothing
  to change until the first store upload (M3), when the owner fixes it
  together with the public name (D-057).

### Translations

- There are two JSON files with the same keys. i18next is initialised
  synchronously before the first render, with `fallbackLng: 'nb'`.
- Keys are typed from `nb.json` through i18next's TypeScript resources, so a
  misspelt key is a type error at L1. It never reaches the screen as raw
  text.
- **Language choice:** take the first of the device's preferred languages
  that the app has. `nb`, `nn` and `no` mean bokmål. `en` means English.
  Anything else falls back to bokmål. D-014 says the MVP ships in bokmål,
  and nynorsk readers read bokmål; nynorsk itself comes later.
- **Copy:** the working title, plus one line saying the app is under
  development. At least one visible string differs between the files
  (AC3). There is no safety claim (see Scope).

### Tests at L5

- **`test:unit` runs Vitest as today, then `jest --ci` in the app.** Both
  must pass, and "no tests found" is a failure. Vitest's configs exclude
  `apps/mobile/**`: their pattern `apps/**/src/**/*.test.ts` would otherwise
  collect app tests that Vitest cannot run.
- **App tests import `describe`, `test` and `expect` from `@jest/globals`**,
  as the server's tests import from `vitest`. Nothing then depends on ambient
  test globals.
- **`gate:file` sends files under `apps/mobile/` to
  `jest --findRelatedTests`** (AC7). Without this, HK-04 would run Vitest's
  `related` against React Native code after every edit.
- **Coverage (AC8):** jest-expo writes `json-summary` to
  `apps/mobile/coverage/`, and Vitest's coverage config excludes
  `apps/mobile/**`. Otherwise Vitest would count the app's files at 0 % and
  drag the overall line floor (RG-04) down for code that is in fact tested.
  `coverage:ratchet` merges the two summaries and refuses to pass with
  either one missing. The baseline is then raised deliberately with
  `--update`.
- **Mutation testing does not change.** INF-06 adds no safety code. The
  follow-up is recorded under Risks.

### The development build, and the build CI tests

- **`expo-dev-client` is a dependency.** A debug build opens the dev launcher
  and loads its JavaScript from Metro. Release builds leave the dev client
  out (Expo's documented behaviour; check it at setup). That debug build is
  the "Expo development build" of D-023 and the roadmap row.
- **On the Mac:** `pnpm run dev` starts Metro for the dev client. The app's
  `android` script (`expo run:android`) builds and installs the debug variant
  on the running emulator (AC16). This is the Mac's first emulator boot:
  `progress/m0.md` records that INF-00 only checked the virtual device
  exists.
- **In CI, L7 tests the release variant.** The JavaScript is bundled into the
  APK with Hermes: no Metro and no dev menu. It is signed with the debug key
  that the generated project uses. Why:
  1. It is what ships.
  2. There is no Metro server to keep alive on a runner.
  3. It has one fewer moving part, in a job that must not be flaky.

  **The debug variant is not built in CI.** It would be a second native build
  on every run, and it protects only the developer's loop, not anything that
  reaches a phone.
- **Built on GitHub's runner, not on EAS (AC10).** The steps are:
  1. `expo prebuild --platform android --clean` generates the native project
     from `app.config.ts`. This is continuous native generation (CNG): native
     settings stay in reviewed code, as `04-tech-stack.md` wants.
  2. Gradle runs `:app:assembleRelease` for x86_64 only. That is the
     emulator's ABI; building all four would multiply native compile time.

  No Expo account, token or secret is involved. A-07's account exists but
  INF-06 does not need it. `eas build --local` was rejected: it needs the EAS
  CLI and a login for no benefit here.
- **The app is built before the emulator boots.** On a two-core runner,
  Gradle and an emulator running at once starve each other, and a slow build
  turns into a flaky test.

### `e2e:android` and the Maestro flow

`e2e:android` is `node scripts/e2e-android.mjs`, with its decisions pure and
tested in `scripts/lib/e2e-android.mjs`. This is the house pattern, as in
`gate-decisions.mjs` and `daily-status.mjs`. It runs in order:

1. **Preflight.** Checks that:
   - an `adb` device is in the `device` state;
   - Java 17 or newer is usable;
   - pinned Maestro is present, or is downloaded and hash-checked;
   - the device language is bokmål.

   Each failure has its own message.
2. **Build**, unless told the APK already exists. CI runs the build and the
   test as two phases, and the flag names are the implementer's choice.
3. **Install** with `adb install -r`.
4. **Run** `maestro test apps/mobile/e2e` with a JUnit report. The
   application ID and the expected bokmål strings are passed as `-e` values,
   read from `app.config.ts` and `nb.json`. The flow then asserts the text a
   reader sees without keeping a second copy of it.
5. **Read the report.** Zero flows is a failure, and so is any failed flow.
   Otherwise it prints "N of N flows passed". A run in which nothing ran has
   not passed (D-060, gate scripts).

On failure it prints the crash lines from `adb logcat`, and the job uploads
Maestro's debug output. That output shows only synthetic screens (RG-07). It
is kept for 7 days, because artefacts count against the account's storage.
`EXPO_NO_TELEMETRY=1` and Maestro's analytics opt-out
(`MAESTRO_CLI_NO_ANALYTICS=1`) are set wherever it runs; check both names at
setup. No personal data is involved either way. Nothing leaves for a tooling
vendor that does not have to.

**A failed flow is never retried automatically.** A pass on the second try
hides a flaky test, and RG-06 deals with flakiness in the open, by
quarantine. Sessions cannot re-run workflows anyway (D-077 item 6).

The flow, `apps/mobile/e2e/app-starts.yaml`, does three things:
1. launches the app with state cleared;
2. asserts the bokmål title and status line are visible;
3. asserts the raw key is not visible.

It needs no test server, because the skeleton calls no API. The first flow
that talks to the server brings one (M3).

### The `android-e2e` job

It is a single job in `ci.yml`, named exactly `android-e2e`.
`reviewWorkflows` requires every `ci.yml` job to be a required check, so a
separate build job would have to be required too. It has
`permissions: contents: read`, no secrets, and inherits the workflow's
existing `concurrency` with `cancel-in-progress`. Its steps, in order:

1. Checkout with full history, then `node scripts/affected.mjs`, which now
   also prints `app=true|false` (AC13). On any event that is not a pull
   request, `app=true`: the script's existing rule (#17).
2. If `app` is not `true`: print that `android-e2e` has nothing to check on
   this diff (CI-12), and finish.
3. Guarded on `app == 'true'`, all of the following:
   1. Enable KVM with the udev rule, then check `/dev/kvm` is usable, and
      fail with a message if it is not. Without it the emulator runs in
      software, 5 to 10 times slower, and times out looking like a flaky test.
      That GitHub's standard Linux runners expose KVM is **not verified from
      this session**; the first run proves it.
   2. pnpm, Node from `.nvmrc`, `pnpm install --frozen-lockfile`, Java 17 and
      setup-gradle.
   3. Build the release APK (step timeout about 30 minutes).
   4. Restore the virtual device's snapshot cache.
   5. The emulator action, with `pnpm run e2e:android` in its test-only
      phase (step timeout about 15 minutes).
   6. On failure, upload Maestro's debug output.
   7. On a push to `main` only, save the snapshot cache.
4. The job's `timeout-minutes` is 45. The first measured runs set it for
   good.

**The emulator image.** The API level is the newest stable one that has a
`google_apis_ps16k` x86_64 image. If the Mac's image (`android-37.2`) is
stable and available to `sdkmanager` on Linux, CI uses that same image. The
device profile is Pixel 8, with no window, audio or boot animation,
animations off, and the locale set to `nb-NO`. The reasons:

- **16 KB pages:** Google Play requires apps targeting Android 15 and later to
  work on 16 KB memory pages. A native library that is not aligned for them
  fails to load on such devices. The location SDK arrives in M1, and this
  catches such a library on every pull request instead of at store upload.
- **The same image as the Mac:** a flow that passes locally and fails in CI
  only because the images differ costs a debugging session.
- **One API level only,** for cost. More levels are a later decision, once
  A-01 says which phones the group has.

**Fallback:** Google's automated-test (ATD) images boot faster and cost
fewer minutes, but have no 16 KB variant. Use them if boot time turns out to
dominate.

### Making `android-e2e` a required check

**`docs/progress.md` says `gate:integrity` fails "after INF-06 lands". That
timing is off.** Checked in the code: `planChecks` reads the `package.json`
of the branch being tested (`scripts/lib/merge-rules.mjs`). So
`gate-integrity` goes red **on the INF-06 pull request itself**, from the
first commit that adds `e2e:android`. It is a required check with no bypass
(D-029), so INF-06 cannot merge until the live rules agree. This is the same
designed reminder INF-05 met (`progress/m0.md`, the INF-05 entry). The
order:

1. The pull request adds `e2e:android`, the `android-e2e` job and the
   `android-e2e` entry in `docs/plan/main-ruleset.json`. The existing test
   that puts that file through `reviewRuleset` fails until the file lists the
   check. The file then has 13 required checks.
2. `gate-integrity` is red on the pull request, reporting "These checks run
   in CI but do not have to pass before merging: android-e2e". This is
   expected; say so in the pull request.
3. When every other check is green, the **owner adds `android-e2e` to the
   existing `main` ruleset's required checks** (A-28). Edit the
   existing ruleset. Do not import a second one beside it: `gate:integrity`
   reads every ruleset, and two that disagree make its answer harder to read.
4. The owner re-runs only the `gate-integrity` job. A session cannot (D-077
   item 6), and a new push would re-run all 16 jobs.
5. The owner then merges.

**Timing matters.** Once the rule is live, any open pull request based on the
old `main` waits for an `android-e2e` result that its own `ci.yml` never
produces. It stays stuck until it is updated with `main`. Dependabot pull
requests need a `@dependabot rebase`.

## CI cost

This repository is private, so Actions minutes are billed. On 2026-09-23 the
included minutes ran out and every check failed within seconds
(`docs/progress.md`, "Actions budget"). The figures below are **estimates**.
None of them has been measured, because no Android job has run here yet.
**The pull request reports the first cold and the first warm run's real
durations**, read from the job logs, and the decision records them. GitHub
rounds each job up to a whole minute (its billing documentation).

### Per push, `android-e2e` only

| Case | What runs | Estimated billed minutes |
|------|-----------|--------------------------|
| Pull request push that cannot affect the app | checkout and classify | **1** |
| Pull request push that touches the app or the lockfile, caches warm | about 2 install; 1 Java, Gradle and prebuild; 4–8 release build for x86_64; 1–2 emulator boot from snapshot; 1–2 install and flow; 1 overhead | **about 10–16** |
| The same, caches cold (first run, cache evicted, lockfile or SDK change) | adds the Gradle and NDK downloads, a full native compile, creating the virtual device and a cold boot | **about 25–35** |
| Push to `main` (every merge) | always a full run: there is no base to diff against, and it is the backstop for the classifier | as a warm pull-request run |

For scale, from `docs/progress.md`: a real AI review takes four to six
minutes, and five reviewers run on every push. A warm `android-e2e` run costs
about as much as two or three of them.

**The Expo tree also makes every other job's install slower.** Nine jobs run
`pnpm install --frozen-lockfile` at the root, and that installs every
workspace package. If the app's dependencies add half a minute to a minute to
each install, that is **about 5–9 more billed minutes on every push**. In
server-focused months that can cost more than `android-e2e` itself. Measure
it on the pull request. Five jobs never touch the app: `gate-integrity`,
`integration`, `system`, `contract` and `mutation`. If the increase is above
about 30 seconds, those five install without the app (a pnpm `--filter`),
and each of them still passing proves the filter. `static`, `unit`,
`traceability` and `security` need the app: they type-check and test it, and
read its licences.

### Per month, as illustrations

The pushes per month are illustrations, not measurements.

| Phase | Assumption | `android-e2e` | At about $0.006–0.008 per Linux minute* |
|-------|------------|---------------|------------------------------------------|
| M0 rest, M1 (the spike lives in `spikes/`), M2 (server) | 150 pushes, about 10 % touching the app or lockfile (weekly Dependabot included), 25 merges | **about 500–800 minutes** | about $3–6 |
| M3 (building the app) | 150 pushes, about 80 % touching the app, 25 merges | **about 1,500–2,200 minutes** | about $10–18 |
| INF-06 itself | 15–30 pushes, several cold | **about 300–600 minutes** | about $2–5 |

\*GitHub's list price for its standard Linux runner, not checked from this
session. Settings → Billing is the authority. GitHub Pro includes 3,000
minutes a month (`08-cicd-releases.md` finding 2), and five reviewers at
four to six minutes each already use most of that at 150 pushes. **These
minutes are on top of a budget that is already tight**, but D-024/D-048's
€30–100 a month has room for them.

### What keeps it down (proposed in this spec)

- The step-level `app` classification: CI-12's way of doing a path filter
  (AC12, AC13). In server months most pushes cost 1 minute here.
- A release build for x86_64 only, and no debug build in CI.
- Caches for the pnpm store, Gradle and the emulator snapshot. They are
  written from `main` only, so branches do not fill GitHub's 10 GB cache
  limit and evict each other.
- `cancel-in-progress` is already on, so a superseded run stops. Minutes used
  up to that point are still billed.
- The install filter above, if the measurement justifies it.
- Pushing once a piece of work is done rather than after every commit. That
  is a habit, not a mechanism.

### Rejected

- **A `paths:` filter or a job-level `if:`.** A skipped job is a green tick,
  and a required check that never reports deadlocks the pull request. CI-12
  exists because both happened (#16). `scripts/gate.test.mjs` forbids both.
- **EAS Workflows or EAS Build per push.** The free plan's monthly allowance
  is 15 Android builds (`08-cicd-releases.md` finding 3): nowhere near one per
  push. Beyond it, builds cost per build.
- **A self-hosted runner on the Mac.** Code from pull requests would run on
  the owner's machine. A required check would also wait on a Mac that may be
  asleep, which deadlocks merges the way #16 was deadlocked.

## Modules and files affected

**New**
- `apps/mobile/` as laid out above. Production code is `implementer`'s. The
  tests, including `e2e/app-starts.yaml`, are `test-author`'s.
- `scripts/e2e-android.mjs`, `scripts/lib/e2e-android.mjs`, and a Maestro
  fetcher if `pinned-binary.mjs` cannot be reused as it is. Their tests are
  `test-author`'s.
- `packages/config/dependency-cruiser.test.mjs` (`test-author`).
- `docs/specs/INF-06.md` (this file).

**Changed.** Paths marked ◆ need a code owner's approval (CODEOWNERS, D-042).

| Path | Change |
|------|--------|
| ◆ `package.json` | Scripts: `test:unit` and `test:coverage` run both runners; new `e2e:android` and `dev`. `pnpm.onlyBuiltDependencies` only if an app dependency truly needs its install script (pnpm 10 skips them by default), with the reason |
| `pnpm-lock.yaml` | The app's dependency tree |
| `vitest.config.mjs`, `vitest.coverage.config.mjs` | Exclude `apps/mobile/**` |
| ◆ `scripts/affected.mjs`, `scripts/lib/affected.mjs` | The `app` output (AC13) |
| ◆ `scripts/gate-file.mjs` | Send app files to jest (AC7) |
| ◆ `scripts/gate.mjs` | The L7 step in `FULL_STEPS`, with an Android-device probe (AC15) |
| ◆ `scripts/coverage-ratchet.mjs`, `scripts/lib/coverage.mjs` | Read and merge two summaries (AC8) |
| `coverage-baseline.json` | Raised with `--update`, now including the app's files |
| `packages/config/dependency-cruiser.cjs` | The AR-09 rule covers all of `src/` except safety-core; native folders excluded |
| `packages/config/eslint/index.mjs` | Ignore `**/android/**` and `**/ios/**` under `apps/mobile` |
| ◆ `.github/workflows/ci.yml` | The `android-e2e` job; its header's "missing on purpose" note is deleted; possibly the install filter on five jobs |
| `docs/plan/main-ruleset.json` | Adds `android-e2e` (13 required checks) |
| `scripts/gate.test.mjs`, `scripts/lib/affected.test.mjs`, `scripts/gate-file.test.mjs`, `scripts/lib/coverage.test.mjs`, `scripts/turbo-inputs.test.mjs` | Extended (`test-author`) |
| ◆ `docs/plan/decisions.md` | D-081: the app skeleton as built, with each choice above, its reason and its fallback |
| ◆ `CLAUDE.md` | The command list: `dev` and `e2e:android` exist; `e2e:ios` is named with the task that brings it (see Q2) |
| `docs/plan/merge-rules.md`, `apps/README.md`, `docs/progress.md`, `docs/progress/m0.md`, `docs/plan/README.md` | Missing-check prose, the app row, the progress entry, the corrected `gate:integrity` timing, and A-28 |

**Deliberately not touched:** `.github/workflows/ai-review.yml` (D-075: its
filters already cover the app), `.claude/**`, `apps/server/**`,
`packages/contracts/**`, `infra/**` and `scripts/lib/merge-rules.mjs` (its
`android-e2e` entry already waits for `e2e:android`).

## Contract changes

None. The skeleton calls no API. `packages/contracts` and its OpenAPI file
do not change, and `api:diff` is unaffected. The first screen that calls the
server brings the typed client (TanStack Query through oRPC, D-032). It will
also have to handle how Metro resolves the contracts package's `.ts`-suffixed
imports, which Node's resolution needs and Metro's may not.

## Risks and failure modes

INF-06 builds no journey or alert behaviour, so failure modes F1–F7 and F9
cannot be reached through it. What INF-06 can do is make **L7 look green
without proving anything**. That is how F8, "a bad release breaks alerts",
would later reach testers. It could also teach people to wave a red check
through.

| # | Risk | What it would look like | F | Mitigation |
|---|------|-------------------------|---|------------|
| R1 | A green `android-e2e` that proved nothing | Zero flows ran; the emulator never booted; a guarded step skipped for good | F8 | AC9 counts the flows; AC12 forbids job-level conditions and puts classification first; KVM check; `main` always does a full run |
| R2 | The classifier wrongly says "nothing to check" | An app-breaking change merges with a green PR | F8 | AC13 works out the closures from the files; the push to `main` always does a full run and goes red loudly straight after merge. That run is why Q1 recommends keeping it |
| R3 | A flaky emulator | Red for no reason, then people learn to ignore it | F8 | No automatic retry; RG-06 quarantine; the build finishes before boot; KVM required |
| R4 | Minutes run out | Every check fails in about 2 seconds, and all merges stop: safe, but work halts (the 2026-09-23 incident) | — | Cost section; Q1; the owner's spending limit |
| R5 | Supply chain inside CI | A moved action tag or a swapped binary runs in the job | — | Actions pinned by SHA (`gate:integrity` refuses tags); Maestro checked by hash; the job holds no secret; SEC-06's audit and licence checks cover the npm tree |
| R6 | The Expo tree trips existing gates | `licenses:check` meets a licence outside the allowlist; `pnpm audit --audit-level high` finds a high advisory; `imports:check` cannot resolve a React Native package | — | **Stop and ask the owner** rather than widen `ALLOWED_LICENCES` or lower the audit level. Fix resolution by adding the `react-native` condition to dependency-cruiser, never by excluding `apps/mobile` from the import check |
| R7 | Naming an uncovered requirement ID in app code or a spec | `traceability` red with nothing wrong | — | This spec avoids them (see "How this spec names requirements"); the same goes for comments and copy in `apps/mobile/` |
| R8 | Clever Cloud installs the app's dependencies too | Staging's build runs `pnpm install` for the whole workspace with `NODE_ENV=production` (`infra/staging/main.tf`), so every deploy installs Expo and React Native: slower, and more build-instance time billed | — | Before merge, measure `NODE_ENV=production pnpm install --frozen-lockfile` with the app present, and report it in the pull request. The post-merge deploy and smoke test are part of done (DOD-08). If it hurts, filtering Clever Cloud's install is a follow-up under `infra/` |
| R9 | pnpm's isolated layout against React Native tooling | Autolinking, Metro or jest-expo's `transformIgnorePatterns` fail to find packages under `node_modules/.pnpm` | — | Try isolated first. The fallback is `node-linker=hoisted`, but that applies to the whole workspace and loosens the server's strictness, so it gets its own decision. Undeclared imports stay caught by dependency-cruiser either way |
| R10 | TypeScript 6.0 against Expo's and React Native's types | `tsc` errors in configuration the app did not write | — | Stop and report (see Versions) |
| R11 | Node's `Intl` is not Hermes's `Intl` | L5 passes on Node while the phone lacks plural rules or formats | F9, later | No plurals in INF-06. The first plural string is proven at L7 or given a polyfill |
| R12 | Dependabot's weekly npm group bumps Expo-managed packages past what the SDK supports | The whole group goes red and server updates wait behind it | — | **Follow-up, not done here:** an `ignore` for minor and major bumps of `expo`, `expo-*`, `jest-expo`, `react`, `react-native` and `@react-native/*`. SDK upgrades are their own task. Red is loud, so this is noise, not silence |
| R13 | The required-check rollout | Open pull requests based on the old `main` wait for a check that never comes | — | The order in "Making `android-e2e` a required check"; WIP 1 (D-052) keeps it to Dependabot |
| R14 | The Mac's limits | 16 GB, so Colima and the emulator not together; Intel means x86_64 images only; `JAVA_HOME` points at Android Studio's JBR 25, which the project's Gradle may refuse | — | Stop Colima for L7 runs. If Gradle refuses JDK 25, use a JDK 17 unpacked into `claude-dev`'s home: no admin needed (D-056) |
| R15 | Build artefacts and logs live on GitHub, outside the EEA | Screenshots in a failed run's artefact | — | Synthetic screens only (RG-07), 7-day retention. This is D-077's open question about build logs, which is settled before production |
| R16 | The mutation gate cannot see app code | When `safety-core/` gets code (M1 or M3), Stryker's Vitest-only command kills no mutant in it, and the score falls below 80 % | — | Loud, not silent: a red `mutation`. The task that first adds safety-core code makes Stryker run jest too. Recorded as a follow-up in the decision |

## Amendments after review (2026-09-26)

The four reviews of the first implementation passed, except for
`code-reviewer`'s block on the missing decision. These changes are in scope for
INF-06; each gets a test before its code (RG-02).

**INF-06-AC19: the release app keeps nothing in Android's cloud backup.**
Given the generated release manifest, `android:allowBackup` is `false`. Auto
Backup would later copy session tokens or journey data to Google Drive,
outside the providers chosen for the EEA, and a restore would move a
device-bound login to another phone. (`privacy-security-reviewer`.)

**INF-06-AC20: CI and local tooling send nothing to their vendors.**
Wherever Maestro runs (the `android-e2e` job and `e2e-android.mjs`),
`MAESTRO_CLI_NO_ANALYTICS` and `MAESTRO_DISABLE_UPDATE_CHECK=true` are set.
Maestro reads the second one with `Boolean.parseBoolean`, so `'1'` does nothing,
and without it every run sends a persistent ID to `api.copilot.mobile.dev`.
(`privacy-security-reviewer`.)

**AC9, amended above:** emulators only; Java 17 to 21; Maestro's exit status
and its report must both pass. (All three reviewers.)

**Hand-overs fail loudly.** `test:unit` and `test:coverage` hand over to the
app with `pnpm --filter @trygghverdag/mobile --fail-if-no-match`. A filter that
matches nothing exits 0 in pnpm 10, and jest would be silently skipped.
`e2eClosure` in `touchesApp` throws if the `e2e:android` script exists but
names no entry file it can parse, rather than returning an empty closure.
(`safety-reviewer`.)

**Tests pin what a green check means.** The `android-e2e` step that runs the
flows is guarded by exactly `steps.affected.outputs.app == 'true'`, and a test
holds it to that, since a `main`-only guard would pass today.
(`safety-reviewer`.)

**Simpler code, and coverage that does not go down:**
- `pinned-binary.mjs` has one unpack path for a single binary and for a
  folder. The first implementation lowered this file's baseline, from 84.61 to
  78.78 % of lines and from 75 to 66.66 % of branches. The baseline is
  restored and must not go down (RG-04).
- The emulator settings in `ci.yml` (API level, target, profile, locale, the
  snapshot and Gradle cache keys) are written once, as job-level `env`.
- The unreachable `maestro ?? 'maestro'` fallback, which would run an unpinned
  Maestro from `PATH`, is removed.
- The flow's `TITLE` and `STATUS` are escaped before Maestro reads them as
  regular expressions.
- The `android-e2e` checkout sets `persist-credentials: false`.
(`code-reviewer`, `privacy-security-reviewer`.)

**The clock rule covers `.tsx`.** The AR-03 and AR-06 lint rule's
`apps/mobile/src/safety-core/**/*.ts` becomes `**/*.{ts,tsx}`, now that `.tsx`
is normal in the app. (`code-reviewer`.)

**D-081 is written, and A-28 is on the owner's list.** D-081 records each
version and tool choice, and each deviation from this spec, with its reason:
- Expo SDK 57, React Native 0.86.3 and React 19.2.3;
- Maestro 2.10.0, with its hash from Maestro's own checksums;
- the Apache-2.0 licences of `android-emulator-runner` and Maestro, which
  `licenses:check` cannot see;
- the Android SDK and system image, accepted under Google's SDK licence;
- `actions/cache` instead of `setup-gradle`, whose caching component is
  proprietary;
- the `pnpm.packageExtensions` override, and the `@babel/core` pin;
- Java 17 to 21, and emulators only.
It is amended with the measured CI durations after the first run.
(`code-reviewer`, `privacy-security-reviewer`.)

**Not in INF-06; listed for the owner in the pull request:**
- Renames are invisible to the change classifier (`scripts/lib/git.mjs`, no
  `--no-renames`). This predates INF-06 and is its own `/bugfix`.
- Code owners for the gate configuration and `apps/mobile/app.config.ts`
  (a `/decision`).
- Mutation testing and the AI safety filter both skip changes that touch only
  a safety test.
- Maven and Gradle dependency audit and licence checks, before the first
  store upload.
- Dark mode, status-bar contrast and `SafeAreaProvider` for the real home
  screen.

## Out of scope

- **Any journey, alert or safety behaviour.** That means no `safety-core/`
  and no background location, heartbeats, notifications or maps. The story
  that keeps 112 one tap away is not built either: it is its own story in
  `01b-mvp-scope.md`, in M3, with its own tests. The placeholder screen is not
  the product's home screen, and no one outside the emulators ever sees it.
- **Over-the-air updates.** `expo-updates` is not installed, and AC17 holds
  that (D-023, `04-tech-stack.md` finding 6).
- **Analytics, advertising and crash-reporting SDKs.** None are added (D-016
  and the privacy table). `privacy-security-reviewer` runs on every pull
  request and reads dependency changes (D-061).
- **iOS:** `e2e:ios`, simulator builds, EAS, and installing
  `nightly.yml`. Out of scope by the owner's answer to Q2.
- **A test server for L7.** No flow needs one yet.
- **App variants** (development, preview and production with separate IDs,
  `08-cicd-releases.md`), EAS configuration, signing, store builds, icons,
  the splash design, and the public name (D-057).
- **Nynorsk, dark-first design and a UI kit.**
- **A lint rule against hard-coded text in JSX.** D-014 gives that check to
  `a11y-i18n-reviewer`. A lint rule would make it mechanical; recommended as a
  small follow-up.
- **A custom URL scheme.** Deep links are an attack surface, and they arrive
  with the first feature that needs a link. If Expo Router refuses to build
  without one, the pull request says so and names the intent filter it adds.
- **Android's backup and other data-at-rest settings.** The skeleton stores
  nothing; these are decided when the app first stores data. The pull request
  lists the release APK's permissions as evidence. The skeleton should need
  network access only.
- **More than one emulator API level, and real devices** (L9, D-037, D-041).
- **The Dependabot ignore rule (R12) and the Clever Cloud install filter
  (R8).** Both are follow-ups if needed.

## Owner actions

- **A-28: add `android-e2e` to the live `main` ruleset**, at step
  3 of "Making `android-e2e` a required check". It takes about a minute:
  Settings → Rules → Rulesets → `main` → required status checks. Then re-run
  the `gate-integrity` job on the INF-06 pull request.
- **The spending limit:** raise the Actions spending limit by about $20 a
  month before M3 (the owner's answer to Q1).

## Questions for the owner

Both answered by the owner in the session on 2026-09-25; each answer is
under its question.

**Q1: Actions minutes for the Android emulator tests (cost).**
`android-e2e` builds the app and runs it on an emulator. It costs:
- about 1 minute when a change cannot affect the app;
- about 10–16 minutes when it can and the caches are warm;
- 25–35 minutes when the caches are cold.

It runs on every pull-request push that touches the app or the lockfile, and
on every merge to `main`. Estimated: about 500–800 minutes a month in
server-focused months, and about 1,500–2,200 in the app-building months of
M3. That is roughly $3–6 a month now and $10–18 in M3. It comes on top of
usage that already ran past the included minutes once, on 2026-09-23.

Options:
- **(a) As proposed.**
- **(b) Also skip the full run on merges to `main` that do not touch the
  app.** Saves about 12 minutes per such merge, but loses the backstop that
  catches the rare change the classifier wrongly thought irrelevant.
- **(c) Run it only on merges to `main`.** Cheapest, but a broken app is
  found after it has merged. That goes against "Android on every pull
  request" in `06-testing-strategy.md`.

**Recommendation: (a).** Raise the Actions spending limit by about $20 a
month before M3, and revisit once a month of measured numbers is in. The
merge-time run is what makes skipping pull-request runs safe.

**Owner's answer (2026-09-25): (a), as proposed**, including the spending
limit raised by about $20 a month before M3.

**Q2: Does INF-06 also bring iOS end-to-end tests (scope)?**
`CLAUDE.md` lists `e2e:ios` as arriving with INF-06. The roadmap's INF-06
row and its done-criterion name only the Android emulator, and
`06-testing-strategy.md` runs iOS L7 nightly and before releases. On this
repository that means EAS, which needs an Expo token as a secret (A-07's
account), or this Intel Mac's Xcode 26.0.1, which is the last Xcode it will
get.

**Recommendation: Android only in INF-06.** The weekly iOS simulator run and
`e2e:ios` become their own task before M3's exit, which requires "iOS
weekly". INF-06 corrects the line in `CLAUDE.md` to name that task.

**Owner's answer (2026-09-25): Android only.** INF-06 corrects the `e2e:ios`
line in `CLAUDE.md` to name its own later task.
