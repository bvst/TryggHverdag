# CALL-02 · 112 is always one tap away: a 112 button on every screen, reaching the phone's own dialer, on a screen made for the dark

**Milestone:** M3, task 2 of 12 (D-134), with GRP-02 and CALL-01 ·
**Delivers:** CALL-02 on Android: a 112 button that never scrolls away or hides,
on every screen of the app, the join screen included (Q4), opening the phone's
own dialer with 112 in it, so the emergency call and its AML position go
through the phone's normal path. With it come the home screen that does not
wait for the server, and the always-dark palette (Q5) GRP-01 left to this task.
The shared home screen is described in `docs/specs/GRP-02.md` ("The home screen
task 2 builds") · **Decisions:** D-012, D-014, D-023, D-031, D-055, D-134,
D-136, D-137, D-138, D-139, D-141 · **Written:** 2026-10-22, step 1 of
`/feature` for task 2, for this cloud session's branch (D-055). **Settled** the
same day on the owner's answers (D-141). Neither pass had a shell: the branch
was not checked, `pnpm run decision` and `req:coverage` were not run, decisions
were read in `docs/plan/decisions.md` by line, and D-141, written in parallel,
was not read here. **Amended** the same day on the owner's answer about
`shared/ui/` (D-141 item 7, as amended): AC10, the route pin in AC1, and the
risk renamed from F6. That pass had no shell either; what it read is listed in
`CALL-01.md`'s header. **Amended again** the same day on the owner's answer
about `apps/mobile/e2e/` ("Ja, ta med e2e/"): AC11. **Amended a third time**
the same day on the owner's answer about `apps/mobile/src/app/` ("Ja, ta med
src/app/"): AC12; and on safety-reviewer's delta notes for task 2: the route
pin renders the real root layout and finds nothing drawn outside `Screen`
(AC1), an import rule keeps `Modal`, `SafeAreaView` and `ScrollView` in
`shared/ui/` (AC2), the English 112 texts asserted in full (AC6), and a crash
keeps 112 (AC13) · **Status:** Settled, and amended. The owner's answers are
in D-141.

## Requirement

### The story this spec delivers

**CALL-02** (`docs/plan/01b-mvp-scope.md`, CALL section, 2nd story; Must):

> **CALL-02 · 112 is always one tap away** (Must)
> - The home screen and the journey screen always show a 112 button.
> - It calls 112 through the phone's normal calling path, so AML sends the
>   position to the emergency centre automatically.
> - It is never hidden in a menu or behind a setting.

From the non-functional requirements in the same file: safety-critical stories,
CALL-02 among them, "have automated end-to-end tests that run on every change";
"Dark-first design for night use (**hypothesis** — a bright screen draws
attention in the dark)"; "Accessibility: large targets, screen-reader labels,
works with large text."

### The owner's scope (D-134, D-141)

Task 2: "the call button, and 112 always visible". Built in this cloud session
(D-141). iOS, EAS builds and VoiceOver wait for task 12. The owner's answers:
the dialer with 112 filled in is "one tap away" (Q3); 112 on every screen, the
join screen included (Q4); always dark (Q5); Q6's sizes as proposed.

### What the plan fixed around it

- **`01-product-vision.md`, finding 1** (Nkom): phones send their position to
  the emergency centre (AML) when 110, 112 or 113 is called, "with no app
  required … Our SOS should be 'one tap to call 112' and let the phone's
  built-in AML do the locating. We should not build our own channel to the
  emergency services." And `00-working-agreement.md`, principle 2: "Don't
  replace emergency services. Make calling 112/113 faster".
- **D-012's MVP and `STORE-01.md`:** "the 112 button calls 112 and alerts no
  group member." Nothing in the app may suggest otherwise.
- **The UI rules and `ui-i18n-a11y`:** "112 always visible on the home and
  journey screens"; dark-first; large targets; screen-reader labels.
- **GRP-01's spec, "Left for later tasks", task 2** (D-137's loop-1
  amendment): "dark-first screens … the reviewer will block task 2 if it is
  light-only"; "INF-06 deferred dark mode, status-bar contrast and
  `SafeAreaProvider` to the real home screen, which is task 2's"; the waiting
  indicator's colour "takes the palette's colour with the rest"; and "a
  signed-in phone opens on GRP-01's member screen …, which has no 112 button
  … Task 2's home screen replaces it and shows 112 always; its a11y review
  blocks if 112 is missing."
- **D-136, answer 4; GRP-01-AC29** (the owner; GRP-01): only a 401 signs a
  phone out; an unreachable server or a 5xx never does.
- **SPIKE-01-AC10's rule:** tests never dial 112 or any emergency number.
- **Android's documented rule for `Intent.ACTION_CALL`**
  (developer.android.com/reference/android/content/Intent#ACTION_CALL): the
  intent "cannot be used to call emergency numbers. Applications can dial
  emergency numbers using `ACTION_DIAL`, however." Cited as the documented
  rule; the page was not re-fetched in this session.
- **D-141** (the owner): Q3, Q4 and Q5 as above; `features/call/` is a
  code-owner and safety-review path (`CALL-01.md`, "Step 1"). Amended (the
  owner, 2026-10-22, "Ja, hele shared/ui/"): so is the whole
  `apps/mobile/src/shared/ui/` folder, where `Screen` goes, in the same step-1
  pull request (AC10); with Claude's choice under D-031 that a task-2 test
  requires every route to be drawn through `Screen` (AC1). Amended again (the
  owner, 2026-10-22, "Ja, ta med e2e/"): so is `apps/mobile/e2e/`, the Maestro
  flows, in the same pull request (AC11). Amended a third time (the owner,
  2026-10-22, "Ja, ta med src/app/"): so is `apps/mobile/src/app/`, the routes
  and the root layout around every screen, in the same pull request, #100
  (AC12).

### What exists today

- No 112 button anywhere. A phone holding a credential shows only a waiting
  indicator until `GET /v1/me` answers (up to the client's 20 s), and, if the
  server cannot be reached, a screen with one line and "Prøv igjen"
  (`features/grp/home-screen.tsx`).
- The screens are light: `features/grp/ui.tsx` hard-codes `#1f4e79` and sets
  no background; `app.config.ts` sets no `userInterfaceStyle`.
- `Screen` (`features/grp/ui.tsx`) is a `SafeAreaView` from
  `react-native-safe-area-context` around a `ScrollView`. The root layout has
  no `SafeAreaProvider` of its own, and needs none: **Expo Router 57.0.23's
  `ExpoRoot` wraps every app in one** (read in the installed
  `expo-router/build/ExpoRoot.js`, 2026-10-22).
- `src/app/` holds two files: `_layout.tsx`, the root layout, which renders
  `Slot` inside the translations and the group session and draws nothing of
  its own; and `index.tsx`, the one route, which renders `HomeScreen`. The
  invite and members screens are drawn inside that route, not as routes of
  their own (read 2026-10-22). No CODEOWNERS line matches the folder, or
  `src/app.test.tsx` beside it; neither route exports an `ErrorBoundary`.
- `src/shared/ui/` does not exist, and no merge rule names it.
- `apps/mobile/e2e/` holds three flows (`app-starts.yaml`, `wrong-code.yaml`,
  `first-admin-invites.yaml`, listed on disk 2026-10-22); no CODEOWNERS line
  and no ai-review filter matches it.
- GRP-01's removal confirmation on the members screen is drawn inline, not in
  a `Modal` (no `Modal` or `Alert` in `src/`, searched 2026-10-22).

### Readings this spec makes

1. **"Calls 112 through the phone's normal calling path"**: Android's
   documented rule is that an app cannot use `ACTION_CALL` for an emergency
   number, and dials one by opening the dialer. So the 112 button opens the
   phone's own dialer with 112 in it, and the walker taps call there: the
   phone's normal path, with AML. That is our tap and then the dialer's, which
   the owner accepts as "one tap away" (Q3, D-141). *Documented, not observed
   here:* no emulator runs in this session. The documentation names
   `ACTION_DIAL`, while `Linking.openURL('tel:112')` sends `ACTION_VIEW`, which
   S6 saw the dialer answer for an ordinary number. The L7 flow is the first
   observation of `tel:112` on Android.
2. **"Always show"** means: on the screen, without scrolling, at any font size,
   with the keyboard up, whatever the app is waiting for. So the 112 button
   sits in a bar fixed at the **top** of the screen, outside the scrolling
   content: a keyboard opens from the bottom and would cover a bar there.
3. **"The home screen"** is the screen a signed-in phone opens on, in every
   state it has: waiting for the server, the server unreachable, with or without
   #1. A home screen that waits 20 s behind a spinner does not "always show" a
   112 button (approach 2).
4. **"The journey screen"** comes with the start-a-journey story (task 3),
   which must carry the bar; this task cannot.
5. **"Never hidden in a menu or behind a setting"**: the bar has no prop, flag,
   setting or state that removes it, and 112 is never a menu item.
6. **Where else it shows** (Q4, D-141): every screen the app shows, the join
   screen and the brief start included.

Requirements are named as in `GRP-02.md`, "How this spec names requirements,
and why".

## Approach (technical choices delegated to Claude, D-031)

1. **The 112 bar** (`features/call/emergency-bar.tsx`, through `call`'s index).
   - A bar at the top of the screen, inside the safe area, outside every
     `ScrollView`, holding one button: visible text "112", red fill from the
     palette, at least 64 dp tall and 96 dp wide (Q6).
   - Screen-reader label "Ring 112, nødnummeret", and a hint: "Åpner
     telefonappen med 112. Trykk ring der."
   - `EmergencyBar` takes no props. The shared kit's `Screen`
     (`src/shared/ui/`) renders it unconditionally above its `ScrollView`, so
     a screen built on `Screen` cannot leave it out (reading 5). Every screen
     of the app, the brief start's waiting indicator included, is drawn on
     `Screen` (Q4), and every route file renders through it (AC1).
   - Both files are in owned, safety-reviewed folders after step 1: `Screen`
     in `shared/ui/`, and `EmergencyBar` in `features/call/`, or in
     `shared/ui/` if the import rules make that the cleaner home (AC10). The
     routes and the root layout are too (`src/app/`, AC12).
   - **Nothing covers the bar** (safety-reviewer's delta notes; Claude's
     choices under D-031):
     - only files in `src/shared/ui/` may import `Modal`, `SafeAreaView` or
       `ScrollView` from `react-native`, or `SafeAreaView` from
       `react-native-safe-area-context` (the one `Screen` uses today): an
       ESLint `no-restricted-imports` rule in the owned `eslint.config.mjs`
       (AC2);
     - nothing the app draws sits outside `Screen` but the root layout's
       `StatusBar` (AC1);
     - `_layout.tsx` exports an `ErrorBoundary` whose fallback is drawn on
       `Screen`, so a screen that throws while rendering still shows 112
       (AC13). The fallback says, in one line, that something went wrong on
       the screen, with "Prøv igjen", which calls the boundary's retry; it
       never shows the error's message, which could hold #1's number
       (GRP-02-AC9).
2. **The home screen does not wait for the server** (reading 3; changes GRP-01's
   start). The session's start becomes:
   - storage read, no credential: the join screen (unchanged; with the bar);
   - storage read, a credential: **the home screen at once**, with #1 (GRP-02),
     the call button and 112, and `GET /v1/me` asked in the background;
     - a member: the heading and status line appear, and the admin's two
       choices if the role is `ADMIN`;
     - a 401: signed out, the join screen with its line (GRP-01-AC29,
       unchanged);
     - no answer within 20 s, a network error, or a 5xx: the home screen stays,
       with "Vi fikk ikke kontakt med serveren. Prøv igjen om litt." and "Prøv
       igjen" on it, and the credential kept (GRP-01-AC29, unchanged).
   - storage unreadable: the home screen, as for no answer, with #1 as
     GRP-02-AC8 says.
   - The waiting indicator alone shows only while storage itself is being read,
     and then on `Screen`, with the 112 bar.
   - Nothing on the home screen says the phone is signed in, or anything about
     the group (`grp.member.title`, `grp.member.status`, the admin's choices),
     until `GET /v1/me` has answered with the member.
3. **Opening the dialer:** `phone.ts`'s `openDialer('112')`, that is
   `Linking.openURL('tel:112')`. Never `ACTION_CALL`, never `CALL_PHONE`,
   never a call placed by the app, never a number but 112. 112 is a constant
   in `features/call/` (or beside the bar, if the bar's home is `shared/ui/`:
   approach 1, AC10), not a translation and not a setting. It needs no #1,
   no permission, no credential and no server.
4. **When the dialer cannot be opened:** a message, read out when it appears
   (`accessibilityLiveRegion="assertive"`): "Telefonen kunne ikke åpne 112.
   Ring 112 selv." The button stays.
5. **Dark-first, one palette** (Q5: always dark).
   - `src/shared/ui/palette.ts`: a near-black background, light text, the
     accent, and the 112 red; and the list of colour pairs the app draws, each
     with the contrast it must meet (AC7).
   - `app.config.ts`: `userInterfaceStyle: 'dark'`. The root layout renders
     React Native's `StatusBar` with `barStyle="light-content"`. Whether
     Android's navigation-bar buttons follow `userInterfaceStyle` on the
     installed SDK was not checked here; if they do not, the implementer sets
     them light by the means the SDK offers, and AC7's config test reads that
     setting.
   - The shared kit moves from `features/grp/ui.tsx` to `src/shared/ui/`
     (`GRP-02.md`, "The home screen task 2 builds", item 5); every colour in it
     comes from the palette, the waiting indicator's included. GRP-01's
     screens become dark with it.
   - No `SafeAreaProvider` is added: Expo Router provides one ("What exists
     today").
6. **Large text:** every text may grow with the phone's font size (no
   `allowFontScaling={false}`), and wraps rather than being cut off (no
   `numberOfLines` on the bar's or the call button's text). The bar grows with
   it and stays fixed.

## Acceptance criteria

Each is proven by at least one test whose name starts with its ID. No test
dials 112: L5 fakes the phone module; L7 opens the dialer and never taps
anything in it (SPIKE-01-AC10's rule). Quoted texts are the bokmål in the
translations table below, asserted in full.

**CALL-02-AC1 — The 112 button is on every screen the app shows.** (L5; L7)
- **Given** each screen and state: the brief start while storage is read; the
  join screen (fresh, and after a sign-out); the home screen waiting for
  `GET /v1/me`, after a member's answer, after an admin's answer, and with the
  server unreachable; with #1, without, and with #1 unreadable; #1's setup
  screen (choosing and changing); the admin's invite screen, before and after a
  code is made; the members screen, with the removal's confirmation open
- **Then** each shows exactly one element with the `accessibilityLabel` "Ring
  112, nødnummeret" and the role "button" (L5)
- **And** L7 asserts it visible on the join screen, the home screen, the setup
  screen and the invite screen as the flows reach them
- **And** every route file under `apps/mobile/src/app/` renders through
  `Screen`, a route added later included (choice (b), D-141 item 7 as
  amended): a test lists the route files when it runs, from the file system
  (every `.ts` and `.tsx` file under `src/app/`, at any depth, but test files,
  `_layout` files, and any other file Expo Router does not render as a screen,
  each such exclusion named in the test with its reason); fails if the list is
  empty; and renders each file through Expo Router's testing library at its
  own path (a dynamic segment given a synthetic value), inside the real
  `src/app/_layout.tsx`, not a stand-in, once with no credential stored and
  once with a credential stored and `GET /v1/me` held unanswered. Each time
  the rendered tree holds exactly one `Screen`, found by its component type,
  with the 112 button inside it; and every host element in the tree is inside
  that `Screen`, or is an ancestor of it (the wrappers Expo Router and the
  layout put around every screen), or is on a short allow-list named in the
  test with its reason: the root layout's `StatusBar` (L5,
  `src/shared/ui/screen.test.tsx`).

*Why L5, and why this way.* Whether a route draws `Screen` is a property of
what it renders through every component between the route file and the screen
(`index.tsx` renders `HomeScreen`, which chooses among several screens), which
a search of the source cannot follow and a render can. L7 reaches only the
screens its flows reach, so a route with no flow would escape it. Listing the
files when the test runs, rather than naming them in it, is what catches a
route added later with no edit to the test; the empty-list failure stops the
check from passing on nothing if `src/app/` moves. Rendering the real root
layout, and finding no host element beside `Screen`, is what catches
something drawn over the bar from outside a route: an overlay in the layout,
or a sibling of `Screen` that covers it, which the ancestor checks of AC2
cannot see. The test sits in `shared/ui/`, an owned, safety-reviewed path
(AC10), so loosening it needs the owner and `safety-reviewer`. The screens
drawn inside a route (the join, setup, invite and members screens) are held
by the state list above, not by this test.

**CALL-02-AC2 — The 112 button is never hidden.** (L5; L7)
- **Then** on every screen and state of AC1, no ancestor of the 112 button in
  the rendered tree is a `ScrollView` or a `Modal`, or has `display: 'none'`,
  `opacity: 0`, a `height` or `maxHeight` of 0,
  `accessibilityElementsHidden`, or
  `importantForAccessibility="no-hide-descendants"` (L5)
- **And** `EmergencyBar` accepts no props: a typed test passes it one under
  `@ts-expect-error`, so `tsc` fails if it ever accepts any (L1)
- **And** a `no-restricted-imports` rule in `eslint.config.mjs` refuses an
  import of `Modal`, `SafeAreaView` or `ScrollView` from `react-native`, or of
  `SafeAreaView` from `react-native-safe-area-context`, in any file under
  `apps/mobile/src/` outside `src/shared/ui/`, and allows it inside; fixture
  tests in `packages/config/`, in the style of LOST-02-AC25's, run ESLint on
  a probe file inside `shared/ui/` (no error) and one outside (an error for
  each of the four), with a control that the rule fires; and
  `pnpm run gate:static`'s lint passes on the repository with the rule in
  place (L1)
- **And** `Screen`, rendered with each of its optional props set and unset,
  holds the 112 button every time (L5)
- **And** on #1's setup screen with the keyboard open, it is visible (L7)
- **And** with Android's font size at the largest the emulator image's Settings
  offer (as CALL-01-AC8 sets it), it is visible on the home screen without
  scrolling, and its text sets no `numberOfLines` (L7; L5).

**CALL-02-AC3 — It opens the phone's own dialer with 112, and places no call.**
(L5; L7)
- **When** the 112 button is tapped
- **Then** the phone-module fake records exactly one `openDialer('112')`, and
  no `callNumber`, whether `callPermission()` answers `granted` or
  `notGranted` (L5)
- **And** `phone.ts`'s `openDialer('112')` calls `Linking.openURL('tel:112')`
  once and never starts `ACTION_CALL` (L5, `phone.test.ts`)
- **And** on the emulator, the focused window belongs to the phone's default
  dialer (the script reads `dumpsys window` against the holder of the dialer
  role), "112" is visible on it, and Telecom's record shows no call (L7); the
  flow then presses back and taps nothing in the dialer.

**CALL-02-AC4 — 112 needs nothing else.** (L5)
- **Given** each in turn: no #1; the call permission not granted; no credential
  (the join screen); `GET /v1/me` unanswered; the server unreachable; secure
  storage unreadable
- **When** the 112 button is tapped
- **Then** AC3's L5 half holds, and the fake API records no request made
  between the tap and `openDialer`.

**CALL-02-AC5 — A dialer that cannot open is said.** (L5)
- **Given** `openDialer` rejects
- **When** the 112 button is tapped
- **Then** "Telefonen kunne ikke åpne 112. Ring 112 selv." shows, in an element
  with `accessibilityLiveRegion="assertive"`, and the 112 button stays and a
  later tap calls `openDialer('112')` again.

**CALL-02-AC6 — The 112 button says what it is, and nothing more.** (L5)
- **Then** its visible text is "112", its role "button", its
  `accessibilityLabel` "Ring 112, nødnummeret" and its `accessibilityHint`
  "Åpner telefonappen med 112. Trykk ring der.", with the English in `en.json`
  under the same keys
- **And**, in the same owned test (`features/call/emergency.test.tsx`), with
  the app's language set to English as the existing language test sets it,
  the label reads "Call 112, the emergency number", the hint "Opens your phone
  app with 112. Tap call there.", and AC5's line "Your phone could not open
  112. Dial 112 yourself.", each in full. `nb.json` and `en.json` are not
  code-owner paths, so these assertions, in an owned folder, are what keep a
  change to either file from altering what the 112 button says without the
  owner and `safety-reviewer`
- **And** its flattened style has a `minHeight` of at least 64 and a
  `minWidth` of at least 96 (Q6)
- **And** none of its texts, in either language, contains a word on
  CALL-01-AC7's list, so none says pressing 112 tells the group, shares a
  location, or starts a journey.

**CALL-02-AC7 — Every screen is dark, and readable at night.** (L5; L1)
- **Then** `app.config.ts` sets `userInterfaceStyle: 'dark'` (its test), and the
  root layout renders `StatusBar` with `barStyle="light-content"` (L5)
- **And** no file in `apps/mobile/src/` but `src/shared/ui/palette.ts` holds a
  colour literal: a hex colour (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), or a
  string starting `rgb(`, `rgba(`, `hsl(` or `hsla(` (a test over the source
  files, or an ESLint rule)
- **And** a unit test computes WCAG 2 contrast for every pair the palette
  lists: text on a background at least 4.5:1; a button's text on its fill at
  least 4.5:1, and at least 7:1 for the call button's and the 112 button's; a
  control's fill or edge against the background at least 3:1
- **And** the waiting indicator's `color` is the palette's.

**CALL-02-AC8 — The home screen shows 112 and the call button at once, without
waiting for the server.** (L5)
- **Given** a phone holding a credential
- **When** the app starts and `GET /v1/me` is held unanswered
- **Then** once secure storage's reads have resolved, the home screen shows the
  112 button and the call button, and neither "Du er med i gruppen", nor
  "Denne telefonen er logget inn i gruppen.", nor the admin's choices
- **And** an answer naming a member then adds the heading and the status line,
  and one naming an admin also "Inviter noen" and "Se medlemmene"
- **And** a 401 signs out to the join screen with its line
- **And** no answer within 20 s, a network error, or a 5xx leaves the home
  screen, with "Vi fikk ikke kontakt med serveren. Prøv igjen om litt." and
  "Prøv igjen", and the credential kept (GRP-01-AC29 unchanged).

**CALL-02-AC9 — Every word is translated, bokmål first.** (L5)
- **Then** every key in the translations table below is in `nb.json` and
  `en.json` with the same keys (the existing translations test)
- **And** no JSX text node in `apps/mobile/src/features/` or
  `apps/mobile/src/shared/ui/` is a literal other than "112": every other
  visible text comes from `t()` (a test over the source files, or an ESLint
  rule).

**CALL-02-AC10 — `shared/ui/` needs the owner and the safety review, and holds
code.** (scripts' gate tests; D-141 as amended)
- **Step 1** (`CALL-01.md`, "Step 1"): `OWNER_APPROVAL_PATHS` holds
  `/apps/mobile/src/shared/ui/`; `.github/CODEOWNERS` has exactly one line for
  it, owners `@bvst @urso-agent`, and `reviewCodeowners` finds no problem; the
  `safety` filter in `ai-review.yml` lists `apps/mobile/src/shared/ui/**`;
  under last-match, a file in the folder and one nested below it belong to
  `@bvst @urso-agent` and are covered by the filter; the folder is not among
  D-139's named exceptions; it is no safety path (no `SAFETY_PATHS` entry
  covers it or lies inside it), and no mutation group covers it; and
  `apps/mobile/src/shared/translations/en.json`, under `shared/` but outside
  `ui/`, keeps its present owners (today none: no CODEOWNERS line matches it)
- **Task 2:** git tracks at least one `.ts` or `.tsx` file under
  `apps/mobile/src/shared/ui/`; every file git tracks there belongs to
  `@bvst @urso-agent` under last-match and is covered by the `safety` filter;
  and the file that defines `Screen` is under `shared/ui/`, and `EmergencyBar`
  is defined in a file under `features/call/` or `shared/ui/` (both owned).

**CALL-02-AC11 — `apps/mobile/e2e/` needs the owner and the safety review.**
(scripts' gate tests; D-141 as amended)
- **Then** `OWNER_APPROVAL_PATHS` holds `/apps/mobile/e2e/`
- **And** `.github/CODEOWNERS` has exactly one line for it, owners
  `@bvst @urso-agent`, and `reviewCodeowners` finds no problem
- **And** the `safety` filter lists `apps/mobile/e2e/**`
- **And**, as the folder exists today, step 1 pins it itself: git tracks at
  least one `.yaml` file under `apps/mobile/e2e/`, and every file git tracks
  there belongs to `@bvst @urso-agent` under last-match and is covered by the
  `safety` filter
- **And** it is not among D-139's named exceptions, and no `SAFETY_PATHS`
  entry and no mutation group covers it, the folder or a path in it.

**CALL-02-AC12 — `apps/mobile/src/app/` needs the owner and the safety
review.** (scripts' gate tests; D-141 as amended)
- **Then** `OWNER_APPROVAL_PATHS` holds `/apps/mobile/src/app/`
- **And** `.github/CODEOWNERS` has exactly one line for it, owners
  `@bvst @urso-agent`, and `reviewCodeowners` finds no problem
- **And** the `safety` filter lists `apps/mobile/src/app/**`
- **And**, as the folder exists today, step 1 pins it itself: git tracks at
  least one `.tsx` file under `apps/mobile/src/app/`, `_layout.tsx` among
  them, and every file git tracks there belongs to `@bvst @urso-agent` under
  last-match and is covered by the `safety` filter
- **And** it is not among D-139's named exceptions, and no `SAFETY_PATHS`
  entry and no mutation group covers it, in either direction
- **And** `apps/mobile/src/app.test.tsx`, beside the folder in `src/` and not
  in it, keeps the owners it has today (none), so a line wider than the
  folder, such as `/apps/mobile/src/app*` or `/apps/mobile/src/`, is caught. A
  line written without the trailing slash is caught by the exact-line check.

**CALL-02-AC13 — A screen that crashes still shows 112.** (L5)
- **Given** the real `src/app/_layout.tsx`, which exports an `ErrorBoundary`
- **When** a route throws while rendering (a faked module the index route
  renders throws an error whose message holds a synthetic #1 number)
- **Then** the fallback shows, drawn on `Screen`: exactly one 112 button, with
  the `accessibilityLabel` "Ring 112, nødnummeret", that still calls
  `openDialer('112')` when tapped, and AC2's ancestor checks hold for it
- **And** the fallback shows "Noe gikk galt på denne skjermen." and "Prøv
  igjen"; a tap on "Prøv igjen", with the module no longer throwing, renders
  the route again
- **And** no text the fallback renders holds the error's message or the
  number (GRP-02-AC9's rule) (L5, `src/shared/ui/screen.test.tsx`).

## Translations (D-014): bokmål first, then English

Keys for the three specs; the implementer may rename keys, not texts.
`a11y-i18n-reviewer` checks that the bokmål reads naturally.

| Key | nb | en |
|---|---|---|
| `call.emergency.text` | 112 (a constant, not a key: approach 3) | — |
| `call.emergency.label` | Ring 112, nødnummeret | Call 112, the emergency number |
| `call.emergency.hint` | Åpner telefonappen med 112. Trykk ring der. | Opens your phone app with 112. Tap call there. |
| `call.emergency.failed` | Telefonen kunne ikke åpne 112. Ring 112 selv. | Your phone could not open 112. Dial 112 yourself. |
| `call.button.call` | Ring {{name}} | Call {{name}} |
| `call.button.hint` | Ringer {{number}} | Calls {{number}} |
| `call.button.failed` | Telefonen kunne ikke starte samtalen. Ring {{number}} selv. | Your phone could not start the call. Dial {{number}} yourself. |
| `call.permission.why` | Tillat telefonsamtaler, så ringer knappen med ett trykk. | Allow phone calls, so the button calls with one tap. |
| `call.permission.missing` | Knappen åpner telefonappen, og du må trykke ring der. | The button opens your phone app, where you tap call. |
| `call.permission.allow` | Tillat telefonsamtaler | Allow phone calls |
| `call.permission.settings` | Åpne innstillinger | Open settings |
| `grp.firstContact.none` | Velg hvem du vil ringe | Choose who to call |
| `grp.firstContact.noneHint` | Du har ikke valgt en nummer 1-kontakt. Trykk for å velge. | You have not chosen a #1 contact. Tap to choose. |
| `grp.firstContact.unreadable` | Vi fikk ikke lest hvem du skal ringe. Trykk for å velge på nytt. | We could not read who to call. Tap to choose again. |
| `grp.firstContact.shown` | Nummer 1: {{name}} | #1: {{name}} |
| `grp.firstContact.change` | Bytt nummer 1-kontakt | Change your #1 contact |
| `grp.firstContact.title` | Hvem vil du ringe først? | Who do you call first? |
| `grp.firstContact.intro` | Den store knappen ringer denne personen. Det kan være hvem som helst du stoler på. | The big button calls this person. It can be anyone you trust. |
| `grp.firstContact.nameLabel` | Navn | Name |
| `grp.firstContact.numberLabel` | Telefonnummer | Phone number |
| `grp.firstContact.save` | Lagre | Save |
| `grp.firstContact.cancel` | Avbryt | Cancel |
| `grp.firstContact.numberNotUsable` | Nummeret ser ikke riktig ut. Bruk bare sifre, gjerne med + og landskode først. | That number doesn't look right. Use digits only, with + and the country code first if needed. |
| `grp.firstContact.nameNotUsable` | Navnet kan ikke brukes. Det må ha minst ett synlig tegn, og ingen skjulte tegn. | That name can't be used. It needs at least one visible character, and no hidden ones. |
| `grp.firstContact.notSaved` | Nummeret ble ikke lagret. Prøv igjen. | The number was not saved. Try again. |
| `grp.member.unreachable` | (unchanged) Vi fikk ikke kontakt med serveren. Prøv igjen om litt. | (unchanged) |
| `app.error.screen` | Noe gikk galt på denne skjermen. | Something went wrong on this screen. |

"Prøv igjen" / "Try again" stays one wording (GRP-01-AC30), the error
fallback's included (AC13).

## Accessibility and night use (all three specs)

- **Targets:** Q6's sizes; the call button the largest; 24 dp between it and
  112 (CALL-01-AC1).
- **Always reachable:** 112 in a fixed top bar on every screen (Q4), never
  scrolled, never under the keyboard.
- **Screen readers:** every control has a role and a label; #1's number and the
  call button's hint are read digit by digit; messages after an action are read
  out when they appear (`accessibilityLiveRegion="assertive"`, Android). On
  iOS, live regions are silent (GRP-01's spec, task 12); task 12 announces them.
- **Large text:** nothing turns font scaling off; text wraps; checked at
  Android's largest size at L7 (CALL-01-AC8, AC2 above).
- **Dark-first:** always dark (Q5), AC7.
- **No false reassurance:** no screen says anyone is alerted, following or
  seeing the walker's location (CALL-01-AC7, AC6 above).

## Test plan

| Level | Where | Criteria | Runs here? |
|---|---|---|---|
| L1 static | `tsc` (the `@ts-expect-error` on `EmergencyBar`'s props); ESLint or a source test for colour literals and raw JSX text; the `no-restricted-imports` rule in `eslint.config.mjs`, with fixture tests in `packages/config/` | AC2 (props, imports), AC7 (palette only), AC9 (raw text) | Yes |
| L5 app | `features/call/emergency.test.tsx` and the shared home tests (the whole app through Expo Router's testing library, the phone module and `fetch` faked, `GET /v1/me` held unanswered, answered as member and admin, 401, 5xx, no answer, network error; the English 112 texts); `features/call/phone.test.ts`; `src/shared/ui/palette.test.ts` (contrast); `src/shared/ui/screen.test.tsx` (every route through `Screen` inside the real root layout, nothing drawn beside it, and the error fallback); the `app.config` test | AC1 to AC9, AC13 | Yes |
| L7 Android | Maestro, `apps/mobile/e2e/`: 112 visible on the join, home, setup (keyboard up) and invite screens; tap 112, the dialer in front with 112, Telecom with no call, back; at the largest font size, 112 visible on the home screen | AC1, AC2, AC3 | **No**: CI's `android-e2e` |
| Gate tests | `scripts/lib/merge-rules.test.mjs`, `scripts/gate.test.mjs`, beside CALL-01-AC9's | AC10 (step 1's part in step 1's pull request; the tracked-file and defining-file parts in task 2's); AC11 and AC12 (all of them in step 1's pull request) | Yes |
| L7 iOS; L9 | none | — | Task 12; a real iPhone (D-037) |

**The L7 112 step** taps the app's 112 button and then only reads: the dialer's
screen through Maestro, and the focused window and Telecom's record through
the script; then `pressKey: back`. The flow's header says it must never tap
anything in the dialer. The dialer places no call by itself, and the emulator
has no network, so a mistake here could not reach an emergency centre; the
rule stands anyway. From step 1 on, a change to the flows, this one's header
included, needs the owner and `safety-reviewer` (AC11). A change to
`scripts/e2e-android.mjs` needs the owner (`/scripts/`) but does not bring
`safety-reviewer`: the `safety` filter lists only `scripts/mutation.mjs` and
`scripts/lib/gate-decisions.mjs` among the scripts (`ai-review.yml`, read on
2026-10-22).

**What this cloud session cannot verify:** that Android's dialer takes `tel:112`
as this spec reads it (first seen in CI's `android-e2e`); that AML sends a
position (only a real emergency call would show it, and none is made); whether
the navigation bar's buttons follow `userInterfaceStyle` (approach 5); any iOS
behaviour, including whether iOS opens `tel:112` from an app with its one
confirmation (task 12); how the dark palette looks on a real screen at night.

### Existing assertions that change by design (RG-03)

- **GRP-01's start** (`features/grp/grp.test.tsx`, and `home-screen.tsx`'s
  header): "Nothing but a waiting indicator shows until … the server has said
  who it is" becomes: the home screen shows once storage is read (AC8).
  GRP-01-AC29 and AC30 hold as written: only a 401 signs out; a waiting
  indicator shows while a request is in flight, now beside the home screen,
  not instead of it. A signed-in phone still never shows the join screen
  before a 401, and still shows nothing of the group before the server's
  answer.
- **GRP-01's colours**: the kit's hard-coded colours become the palette's. No
  assertion names a colour today (read in `grp.test.tsx`'s header, not every
  line).
- **INF-06-AC11's flow** (`e2e/app-starts.yaml`) holds a title, the line under
  it and no raw key; with 112 on the join screen (Q4) it gains nothing it must
  change. Its `assertNotVisible` of a dotted key still holds: "112" is not one.

## Modules and files affected

**App:** `src/features/call/` (`emergency-bar.tsx`, `phone.ts`'s `openDialer`,
tests); `src/shared/ui/` (the kit moved from `features/grp/ui.tsx`,
`palette.ts`, `screen.test.tsx`, tests); `src/features/grp/` (every screen on
the moved kit; `session.tsx` and `home-screen.tsx` for approach 2;
`session.tsx` owned, D-139); `src/app/_layout.tsx` (the `StatusBar` and the
`ErrorBoundary`; owned after step 1, AC12); `app.config.ts` (dark; owned);
`nb.json`, `en.json` (the fallback's line among the new keys); `e2e/` flows
(owned after step 1, AC11).

**Config (owned):** `eslint.config.mjs` (the `no-restricted-imports` rule,
AC2) and its fixture tests in `packages/config/`.

**Who reviews what, after step 1:** `src/shared/ui/` is now an owned,
safety-reviewed path (AC10), as `src/features/call/` is (CALL-01-AC9), so
`Screen`, the palette and the kit cannot change without the owner and
`safety-reviewer`; and so is `apps/mobile/e2e/` (AC11), so the L7 flows of
AC1 to AC3, and the 112 step's never-tap-in-the-dialer header, cannot either. `features/grp/home-screen.tsx` and
`features/grp/first-contact.ts` stay unowned; acceptable, because 112 does not
depend on them: the bar comes from `Screen`, the route pin and AC1 to AC5's
tests live in owned folders, and the dialer's number is a constant beside the
bar, in an owned folder (`CALL-01.md`, "Modules and files affected", says the same
for the call button). `src/app/`, the routes and the root layout, is owned
and safety-reviewed after step 1 too (AC12), and a route added there is
caught by AC1's route pin, which is in `shared/ui/`. `nb.json` and `en.json`
stay unowned; the 112 button's texts in both languages are asserted in full
in an owned test (AC6), so a change to them fails there.

**Step 1 (owned; `CALL-01.md`, "Step 1"):** `.github/CODEOWNERS`,
`scripts/lib/merge-rules.mjs`, `.github/workflows/ai-review.yml`, and their
gate tests in `scripts/lib/merge-rules.test.mjs` and `scripts/gate.test.mjs`
(AC10's step-1 part, and all of AC11 and AC12).

**Scripts (owned):** `scripts/e2e-android.mjs` (the strings, Telecom's record,
the focused window, the font size) and its tests; task 2's tracked-file and
defining-file pins for `shared/ui/` (AC10).

**Server, contracts, infra:** nothing.

## Contract changes

None.

## Risks and failure modes

- **The walker's own call path failing: 112 not there when needed.** None of
  the F1–F10 failure modes
  ([table](../plan/03-safety-reliability-security.md#failure-modes)) is this
  one: they are about journeys and the alerts to responders, and F6 is "Alert not
  noticed". (An earlier version of this spec called this F6; safety-reviewer
  noted the error.) A screen that forgets the bar (approach 1: `Screen` draws
  it, with no props to remove it; AC1's route pin catches a route that does
  not draw `Screen`); something drawn over it from the root layout or beside
  `Screen` (AC1's host-element check, AC2's import rule); a screen that
  crashes (AC13); a home screen held behind a spinner (approach 2); a
  keyboard over it (reading 2); a font size that pushes it off (AC2). Each has
  a criterion.
- **A crash outside the route.** AC13 covers an error thrown while a route
  renders. Whether the root layout's own boundary also catches an error in
  the layout itself or its providers depends on Expo Router's wiring, not
  checked here; if it does not, React unmounts the app and 112 goes with it.
  The implementer finds out in AC13's test, adds that case if the boundary
  catches it, and says so plainly if it does not.
- **`src/app/` changed unseen.** Before the third amendment, a change to the
  root layout could draw over the bar on every screen with only the advisory
  `a11y-i18n-reviewer` seeing it. After step 1 it needs the owner and
  `safety-reviewer` (AC12), and AC1's host-element check fails.
- **A later change to `Screen` that drops 112 from every screen.** Before the
  amendment, `shared/ui/` had no owner and no safety review, so only the
  advisory `a11y-i18n-reviewer` would have seen it. After step 1 it needs the
  owner and `safety-reviewer` (AC10), and AC1 and AC2's tests fail.
- **The step-1 line for `shared/ui/` matches nothing until task 2 merges.** A
  misspelt path would not show until then; task 2's tracked-file pin (AC10) is
  what catches it.
- **The L7 flows changed unseen.** `apps/mobile/e2e/` is the only end-to-end
  proof that the 112 button opens the dialer (AC3), and its 112 step carries
  the rule never to tap call in the dialer. Unowned, a change could drop the
  112 assertions or tap in the dialer with no owner and no
  `safety-reviewer`. After step 1 it needs both (AC11); its line is pinned
  against the flows git tracks in step 1 itself, so a misspelt path fails
  there.
- **[F7](../plan/03-safety-reliability-security.md#failure-modes), the server
  down:** 112 needs no server (AC4); the home screen does not wait (AC8). The
  unreachable-service rule's full notice is the offline notice's (task 11);
  this task keeps GRP-01's line.
- **Our tap, then the dialer's** (reading 1, Q3): the platform's documented
  rule, which the owner accepts as "one tap away". It also guards against a
  112 call from a glove pressed by mistake. Said in the button's hint.
- **`ACTION_VIEW` rather than `ACTION_DIAL`:** the documented rule names
  `ACTION_DIAL`; the app sends `ACTION_VIEW` through `Linking`, as S6's dialer
  path did. If a dialer refuses it, AC5 says so on the screen; L7 is the first
  observation, and a manufacturer's dialer is not observable before the
  private test or L9.
- **Dark-first is a hypothesis** (the MVP scope says so). Q5's answer is
  revisited after the private test.
- **A GRP-01 regression from approach 2:** a phone that shows the home screen
  before the server answers could, for a removed member, show it for up to 20 s
  before the 401 signs it out. It shows nothing of the group in that time
  (AC8), and calling and 112 are the walker's own; no data is exposed.

## Out of scope

- **The journey screen's 112 bar** (task 3, the start-a-journey story; and
  "I'm home" and the two-hour stop's screens, task 5): they use `Screen`, so
  they get it, and their own specs assert it.
- **iOS** (task 12): `tel:112`, VoiceOver, the live-region announcements.
- **113 and 110** as buttons, an SOS that also alerts the group, and anything
  that contacts the emergency services itself: parked or out of scope
  (`01-product-vision.md`; D-012's "Parked").
- **The offline notice and the unreachable-service rule's full notice** (task
  11).

## Settled by the plan, so not asked

- **No channel of our own to the emergency services:** `01-product-vision.md`,
  finding 1; the working agreement's principle 2.
- **112 needs nothing from the app's other parts:** the story's "always" and
  "never hidden".
- **Dark-first screens are this task's:** GRP-01's spec and D-137's loop-1
  amendment.

## Answered (D-141)

The full list of task 2's answers is at the end of `GRP-02.md`.

- **Q3: accepted.** On Android the 112 button opens the phone's dialer with 112
  filled in, and the walker taps call there; that counts as "one tap away"
  (reading 1, AC3).
- **Q4: every screen the app shows, the join screen included** (reading 6,
  approach 1, AC1).
- **Q5: always dark** in the MVP (approach 5, AC7); revisited after the private
  test.
- **Amendment to Q7 (the owner, 2026-10-22): "Ja, hele shared/ui/".** The whole
  `apps/mobile/src/shared/ui/` folder is a code-owner and safety-review path,
  from the same step-1 pull request as `features/call/`; no named exception,
  no safety path, no mutation group (AC10). With it, Claude's choice under
  D-031 that every route is drawn through `Screen` (AC1).
- **Second amendment to Q7 (the owner, 2026-10-22): "Ja, ta med e2e/".**
  `apps/mobile/e2e/`, the Maestro flows, is a code-owner and safety-review
  path, from the same step-1 pull request: the flows are the only end-to-end
  proof that 112 opens the dialer, and carry the rule never to tap call in the
  dialer (AC11).
- **Third amendment to Q7 (the owner, 2026-10-22): "Ja, ta med src/app/".**
  `apps/mobile/src/app/`, Expo Router's routes and the root layout around
  every screen, is a code-owner and safety-review path, from the same step-1
  pull request, #100; no named exception, no safety path, no mutation group
  (AC12).
