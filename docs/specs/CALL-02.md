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
was not read here · **Status:** Settled. The owner's answers are in D-141.

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
  code-owner and safety-review path (`CALL-01.md`, "Step 1").

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
   - `EmergencyBar` takes no props. The shared kit's `Screen` renders it
     unconditionally above its `ScrollView`, so a screen built on `Screen`
     cannot leave it out (reading 5). Every screen of the app, the brief
     start's waiting indicator included, is drawn on `Screen` (Q4).
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
   in `features/call/`, not a translation and not a setting. It needs no #1,
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
  screen and the invite screen as the flows reach them.

**CALL-02-AC2 — The 112 button is never hidden.** (L5; L7)
- **Then** on every screen and state of AC1, no ancestor of the 112 button in
  the rendered tree is a `ScrollView` or a `Modal`, or has `display: 'none'`,
  `opacity: 0`, a `height` or `maxHeight` of 0,
  `accessibilityElementsHidden`, or
  `importantForAccessibility="no-hide-descendants"` (L5)
- **And** `EmergencyBar` accepts no props: a typed test passes it one under
  `@ts-expect-error`, so `tsc` fails if it ever accepts any (L1)
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

"Prøv igjen" / "Try again" stays one wording (GRP-01-AC30).

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
| L1 static | `tsc` (the `@ts-expect-error` on `EmergencyBar`'s props); ESLint or a source test for colour literals and raw JSX text | AC2 (props), AC7 (palette only), AC9 (raw text) | Yes |
| L5 app | `features/call/emergency.test.tsx` and the shared home tests (the whole app through Expo Router's testing library, the phone module and `fetch` faked, `GET /v1/me` held unanswered, answered as member and admin, 401, 5xx, no answer, network error); `features/call/phone.test.ts`; `src/shared/ui/palette.test.ts` (contrast); the `app.config` test | AC1 to AC9 | Yes |
| L7 Android | Maestro, `apps/mobile/e2e/`: 112 visible on the join, home, setup (keyboard up) and invite screens; tap 112, the dialer in front with 112, Telecom with no call, back; at the largest font size, 112 visible on the home screen | AC1, AC2, AC3 | **No**: CI's `android-e2e` |
| L7 iOS; L9 | none | — | Task 12; a real iPhone (D-037) |

**The L7 112 step** taps the app's 112 button and then only reads: the dialer's
screen through Maestro, and the focused window and Telecom's record through
the script; then `pressKey: back`. The flow's header says it must never tap
anything in the dialer. The dialer places no call by itself, and the emulator
has no network, so a mistake here could not reach an emergency centre; the
rule stands anyway.

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
`palette.ts`, tests); `src/features/grp/` (every screen on the moved kit;
`session.tsx` and `home-screen.tsx` for approach 2; `session.tsx` owned,
D-139); `src/app/_layout.tsx` (the `StatusBar`); `app.config.ts` (dark;
owned); `nb.json`, `en.json`; `e2e/` flows.

**Scripts (owned):** `scripts/e2e-android.mjs` (the strings, Telecom's record,
the focused window, the font size) and its tests.

**Server, contracts, infra:** nothing.

## Contract changes

None.

## Risks and failure modes

- **[F6](../plan/03-safety-reliability-security.md#failure-modes) and the
  core promise: 112 not there when needed.** A screen that forgets the bar
  (approach 1: `Screen` draws it, with no props to remove it); a home screen
  held behind a spinner (approach 2); a keyboard over it (reading 2); a font
  size that pushes it off (AC2). Each has a criterion.
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
