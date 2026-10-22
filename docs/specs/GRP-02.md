# GRP-02 · Choose my #1 contact: who the call button calls, kept on the walker's phone

**Milestone:** M3, task 2 of 12 (D-134), with CALL-01 and CALL-02 ·
**Delivers:** GRP-02: the walker chooses their #1 contact (a name and any
phone number), the home screen shows who it is, and with no #1 the call button
explains how to set one. The call itself is `docs/specs/CALL-01.md`, 112 is
`docs/specs/CALL-02.md` · **Decisions:** D-010, D-012, D-013, D-014, D-016,
D-023, D-031, D-055, D-134, D-136, D-137, D-138, D-139, D-141 · **Written:**
2026-10-22, step 1 of `/feature` for task 2, for this cloud session's branch
(D-055). **Settled** the same day on the owner's answers (D-141). Neither pass
had a shell: the branch was not checked, `pnpm run decision` and
`req:coverage` were not run, the decisions were read in
`docs/plan/decisions.md` by line, and D-141, written in parallel by
plan-keeper, was not read here · **Status:** Settled. The owner's answers are
in D-141; every criterion is written on them.

## Why three specs, not one

The house convention is one spec per requirement ID, and the three stories
separate cleanly enough to keep it:

- **GRP-02** is about data: what #1 is, where it is kept, how it is chosen and
  changed, and what the home screen says about it.
- **CALL-01** is about one button: its size, and how the phone places the call
  on each platform, with and without the permission that takes.
- **CALL-02** is about another button: 112, where it shows, how it reaches the
  phone's own dialer, and the screen it sits on at night.

They share one screen, the home screen. What the three share is written once,
here, under "The home screen task 2 builds", and the other two specs point to
it. The owner's seven answers for the whole task are listed at the end of this
spec; each spec lists the ones it concerns.

## Requirement

### The story this spec delivers

**GRP-02** (`docs/plan/01b-mvp-scope.md`, GRP section, 2nd story; Must):

> **GRP-02 · Choose my #1 contact** (Must)
> As a walker, I pick my #1 contact, so the call button always knows who to call.
> - #1 can be any phone number, in the group or not.
> - The home screen shows who #1 is.
> - If no #1 is set, the call button explains how to set one. It is never a dead
>   button.

### The owner's scope (D-134, D-141)

> 2. **GRP-02, CALL-01, CALL-02 — The home screen.** The #1 contact, the call
>    button, and 112 always visible.

D-134 also says "UI work runs on the Mac, where the simulators are (D-055);
server parts may run in cloud sessions". **The owner chose this cloud session
for task 2 (D-141)**, as for GRP-01 (D-137, item 5): jest-expo (L5) runs here,
CI's `android-e2e` runs the Maestro flows (L7), and iOS, the EAS builds and
VoiceOver wait for task 12.

### What the plan fixed around it

- **D-013** (the owner): "The #1 contact for calling can be any phone number."
  Responders are group members with the app; #1 need not be.
- **D-010** (the owner) and the call-sharing story (`01b-mvp-scope.md`, CALL
  section, 3rd story; task 11): when #1 is a group member, calling #1 will also
  share the walker's location with #1, and "Setup (GRP-02) recommends picking a
  group member as #1". Both are task 11's (D-134), read below.
- **D-014** (the owner): bokmål first, then English; no hard-coded text.
- **D-016, the EEA rule, the no-analytics rule, the encryption rule, the
  data-rights rule** (`02-norway-law-privacy.md`, privacy table, 5th, 6th, 8th
  and 9th rows) and **PRIV-07**: no phone number in a log line or an error
  report.
- **D-136, answer 4, and D-137** (GRP-01): membership is the session; a 401
  signs the phone out (GRP-01-AC29).
- **D-138** (delegated): the app's API client is plain `fetch`.
- **D-139** (the owner): `apps/mobile/package.json`,
  `apps/mobile/src/shared/secure-storage.ts`,
  `apps/mobile/src/shared/api/client.ts` and
  `apps/mobile/src/features/grp/session.tsx` are code-owner paths. This task
  touches the first, second and fourth, so its pull request needs the owner's
  approval (D-042).
- **D-141** (the owner): #1 is kept on the phone only (Q1); it is typed (Q2);
  `features/call/` is a code-owner and safety-review path from a step-1 pull
  request (Q7, `CALL-01.md`, "Step 1").
- **GRP-01's spec, "Left for later tasks", task 2:** dark-first screens
  (`a11y-i18n-reviewer` S1, "will block task 2's home screen if it is
  light-only"); the waiting indicator's colour from the palette; and "a
  signed-in phone opens on GRP-01's member screen (`home-screen.tsx`), which
  has no 112 button … Task 2's home screen replaces it and shows 112 always;
  its a11y review blocks if 112 is missing." CALL-02's spec meets these.

### What exists today

Read on 2026-10-22, in the files themselves:

- **The app opens on one route** (`src/app/index.tsx` → `HomeScreen` in
  `features/grp/home-screen.tsx`). By session phase: `starting` (a waiting
  indicator while secure storage is read and, with a credential, while
  `GET /v1/me` answers, up to the client's 20 s); `joining` (the join screen);
  `unreachable` (a line and a retry, nothing else); `member` (the member
  screen: a heading, "Denne telefonen er logget inn i gruppen.", and for the
  admin "Inviter noen" and "Se medlemmene", which open the invite and members
  screens inside the same route).
- **No #1, no call button, no 112** anywhere in the app.
- **`features/grp/ui.tsx`** is the shared kit: `Screen` is a `SafeAreaView`
  around a `ScrollView`; buttons at least 56 points tall; hard-coded colours
  (`#1f4e79`, light only), no background colour. `app.config.ts` sets no
  `userInterfaceStyle`.
- **`shared/secure-storage.ts`** keeps the credential and the join key in
  `expo-secure-store`, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`;
  `allowBackup: false`.
- **No phone number is stored anywhere,** on the phone or the server: GRP-01's
  tables hold none, and responder setup's confirmed SMS number is task 9's.
- **The server has nothing for #1**, and needs nothing (Q1).
- **The app's dependencies** (`apps/mobile/package.json`): no persistent store
  but `expo-secure-store`.

### Readings this spec makes

Each is stated so the reviewers can check it.

1. **"#1 can be any phone number, in the group or not"** means the app does not
   ask whether the number belongs to a member, and cannot: no member's number
   is stored anywhere before task 9. The walker types a group member's number
   as they would anyone's.
2. **"Who #1 is"** is a name and a number, both typed by the walker (Q2). The
   home screen shows the name, large, and the number under it exactly as it is
   dialled, so the walker can see which number the button calls.
3. **"Never a dead button"**: with no #1, the call button is the same large
   button, says what is missing, and opens the setup on a tap. It never does
   nothing, and never calls anyone.
4. **"The home screen"** is the screen a signed-in phone opens on: today's
   member screen, with the call button, 112 and #1 on it (CALL-02's spec,
   approach 2, decides when it shows).
5. **The recommendation to pick a group member as #1** is the call-sharing
   story's criterion, and means something only once calling a member shares the
   location with them (task 11). Shown now, it would suggest a protection the
   app does not give, so it waits for task 11 (Out of scope).
6. **Changing #1** is choosing again, which "I pick my #1 contact" covers.
   Removing #1 without choosing another is in no story (Out of scope).

### How this spec names requirements, and why

The `traceability` job runs `req:coverage --fail-on-uncovered-changed`, which
refuses a changed spec that names a tracked requirement, or a criterion
written as ID, "-AC", number, that no test names (`docs/progress.md`, "Live
gotchas").

- **Delivered by task 2, and named by its tests:** GRP-02, CALL-01, CALL-02.
- **Cited, already covered, not claimed:** GRP-01, PRIV-07, SEC-03, SEC-06.
- **Untracked, named freely:** AR-, D-, F-, RG-, INF-, BUG-, A-, CI-, HK-, L-,
  SPIKE- and STORE- IDs.
- **Every other tracked requirement is named in words:**

| Name used here | Where it lives |
|---|---|
| the permission-check story; responder setup | `01b-mvp-scope.md`, GRP section, 3rd and 4th stories |
| the call-sharing story | CALL section, 3rd story |
| the start-a-journey story; the journey screen's stories; "I'm home"; the two-hour stop | JRN section, 1st, 2nd, 5th and 6th stories |
| the offline notice | LOST section, 5th story |
| the guidance story | HELP section |
| the unreachable-service rule | `03-safety-reliability-security.md`, reliability table, 9th row |
| the EEA rule; the no-analytics rule; the encryption rule; the data-rights rule; the privacy-notice rule; the DPIA rule; the retention rule | `02-norway-law-privacy.md`, privacy table, 5th, 6th, 8th, 9th, 10th, 11th and 4th rows |

## The home screen task 2 builds (shared by the three specs)

Technical choices delegated to Claude (D-031), on the owner's answers in D-141.

1. **Where the code goes** (`05-architecture.md`: `features/` "match story
   IDs"; AR-10).
   - `features/grp/`: #1's rule, its storage, the setup screen, and the home
     screen itself, which grows from today's member screen.
   - `features/call/` (new; a code-owner and safety-review path from step 1,
     `CALL-01.md`): the call button, the 112 bar, the phone's calling path
     behind one small module (`phone.ts`: place a call, open the dialer, ask
     for and read the call permission, open the app's settings), and its
     public `index.ts`.
   - One direction only: `grp` imports `call` through `call`'s index; `call`
     imports nothing from any other feature or from `safety-core/`. The call
     button takes #1 as a prop.
   - The existing rules in `packages/config/dependency-cruiser.cjs` hold half
     of this: `no-cross-feature-internals` lets `grp` reach `call` only through
     its index. **They do not stop `call` importing another feature's index or
     `safety-core/index.ts`** (`ui-cannot-reach-the-safety-core` allows the
     index). So task 2 adds one rule there, which forbids any import from
     `apps/mobile/src/features/call/` into `apps/mobile/src/features/` outside
     `call/`, or into `apps/mobile/src/safety-core/`. It gets fixture tests
     beside the existing rules' tests in `packages/config/`
     (CALL-01-AC6). `packages/config/` is a code-owner path.
   - Not the safety core (AR-09): calling is not background location,
     heartbeats, the reminder or the permission checks.
2. **No server work** (Q1). No route, no table, no contract change;
   `GET /v1/me` is unchanged.
3. **The home screen's layout, top to bottom:** the 112 bar (CALL-02), fixed,
   outside the scrolling content; then, in the scrolling content: who #1 is
   (GRP-02; only when #1 is set); the call button (CALL-01), full width, the
   largest element; "Bytt nummer 1-kontakt" (only when #1 is set); then, for the
   admin, "Inviter noen" and "Se medlemmene" (GRP-01, unchanged). Nothing on it
   says or implies that anyone is looked after, alerted, following, or can see
   where the walker is (CALL-01-AC7): no journey exists in the app yet, and
   calling #1 shares nothing until task 11.
4. **The home screen does not wait for the server** (CALL-02's spec, approach
   2): once secure storage holds a credential, the home screen shows, with #1,
   the call button and 112, while `GET /v1/me` answers; the admin's two choices
   appear when it has.
5. **Dark-first, one palette** (Q5: always dark): the shared kit moves from
   `features/grp/ui.tsx` to `src/shared/ui/`, so `call` and `grp` draw with the
   same pieces without importing each other, and every colour comes from one
   palette module.
6. **Sizes** (Q6, as proposed): ordinary controls at least 56 dp tall (as
   today); the 112 button at least 64 dp tall and 96 dp wide; the call button
   at least 120 dp tall and the screen's full width less its margins; at least
   24 dp between the 112 button and the call button. React Native's style
   units are dp on Android.

## Approach for GRP-02 (technical choices delegated to Claude, D-031)

1. **What #1 is.** `{ name, number }`: the name after trimming, the number in
   its normalised form (below). Nothing else: no contact ID, no photo, no link
   to a member.
2. **The name** uses the contract's own display-name rule,
   `isUsableDisplayName` (`packages/contracts/src/display-name.ts`): 1 to 40
   characters after trimming, something visible, no bidirectional control or
   other format character but ZWNJ and ZWJ. One rule for every name the app
   shows, so #1's name cannot read as someone else's (GRP-01-AC31's reasoning).
   The app imports it; the file is not changed.
3. **The number** (any phone number, reading 1). A pure function in
   `features/grp/first-contact.ts`:
   - whitespace (JavaScript's `\s`), hyphens (`-`), full stops (`.`) and
     parentheses are dropped; nothing else is changed: no country code is
     added, removed or rewritten, so a number typed with `0047` keeps it;
   - what is left must be an optional `+` as its first character, then digits
     `0`–`9` only;
   - with 3 to 15 digits (15 is E.164's longest; 3 lets a short service number
     through);
   - anything else is refused, with one message, and nothing is saved.
   It accepts a Norwegian eight-digit number, one with `+47` or `0047` in
   front, and a foreign one with its country code. It does not refuse 110, 112
   or 113: the walker chooses whom they call first. The call button sends
   those three to the dialer and never through `ACTION_CALL` (`CALL-01.md`,
   approach 2), because Android's documented rule is that `ACTION_CALL`
   "cannot be used to call emergency numbers".
4. **Where it is kept** (Q1: on the phone only).
   - In `expo-secure-store`, beside the credential, under its own key, as one
     JSON value, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (the encryption rule;
     readable after the first unlock, as the credential is, so the button works
     on a phone that restarted in a pocket). `shared/secure-storage.ts` gains
     `readFirstContact`, `saveFirstContact` and `deleteFirstContact`.
   - Never sent to the server, never written to another store, a file or a log.
     The app gains no other persistent store (AC6).
   - `allowBackup: false` stays, so a reinstall or a new phone starts with no
     #1, and the home screen says so (reading 3). That is the cost of Q1's
     answer.
   - **Deleted when the phone is signed out** (a 401, GRP-01-AC29), with the
     credential: the home screen it belongs to is gone, and a person who joins
     again joins as a new member and chooses again. Kept through an
     unreachable server, which never signs out.
5. **The setup screen** (`features/grp/first-contact-screen.tsx`), opened from
   the home screen's call button when no #1 is set or #1 cannot be read, and
   from "Bytt nummer 1-kontakt":
   - a heading, one line of explanation, two fields with visible labels (GRP-01's
     `TextField`): "Navn" and "Telefonnummer"; the number field opens the phone
     keypad (`keyboardType="phone-pad"`, `autoComplete="tel"`,
     `textContentType="telephoneNumber"`);
   - "Lagre" and "Avbryt"; Android's back is "Avbryt";
   - opened to change #1, the fields hold the current #1;
   - a refused name or number says which and saves nothing; a save secure
     storage refuses says nothing was saved, and the earlier #1 (or none) stays.
   - On Android, the permission line and request of `CALL-01.md`, approach 3.
6. **How #1 is chosen** (Q2: typed). No contacts permission, no contact
   picker, no new dependency for it.
7. **The home screen, with and without #1.**
   - **With #1:** "Nummer 1: {name}" and, under it, the number in its
     normalised form, exactly what the button dials, labelled for a screen
     reader digit by digit (AC10); the call button reads "Ring {name}"
     (CALL-01); "Bytt nummer 1-kontakt" under it.
   - **Without #1:** no "Nummer 1" line and no "Bytt nummer 1-kontakt"; the
     call button, the same size and place, reads "Velg hvem du vil ringe" with
     one line under it, "Du har ikke valgt en nummer 1-kontakt. Trykk for å
     velge.", and opens the setup screen.
   - **If #1 cannot be read** (secure storage's read rejects, or the stored
     value is not JSON, or its name or number fails the rules above): as
     without #1, but the line under the button is "Vi fikk ikke lest hvem du
     skal ringe. Trykk for å velge på nytt."; saving on the setup screen
     replaces the stored value. Never a blank button and never a stale name.
8. **No number in a log** (PRIV-07). The app has no logger, and none is added.
   No `console` call or error that leaves the app's code holds the number or
   the name; an L5 test holds it over every path (AC9).

## Acceptance criteria

Each is proven by at least one test whose name starts with its ID. Names and
numbers are synthetic, from the test kit's phone-number fixtures (RG-07,
HK-07); the walker is a synthetic member. Below, `d` stands for any digit, so
no number is written here. Quoted texts are the bokmål in `CALL-02.md`'s
translations table; the tests assert them in full, and the keys may be
renamed but not the texts' meanings.

**GRP-02-AC1 — With no #1, the call button explains how to set one, and opens
the setup.** (L5; L7)
- **Given** a signed-in phone with no #1 stored
- **Then** the home screen shows the call button, reading "Velg hvem du vil
  ringe" with "Du har ikke valgt en nummer 1-kontakt. Trykk for å velge." under
  it; it is the same component, with the same size style, in the same place in
  the screen's order as the call button with a #1 (CALL-01-AC1 holds for both)
- **And** neither "Nummer 1: …" nor "Bytt nummer 1-kontakt" shows
- **When** it is tapped
- **Then** the setup screen opens, and the phone module's `callNumber`,
  `openDialer` and `askCallPermission` are not called (L5).

**GRP-02-AC2 — The walker chooses #1 by name and number, and the home screen
shows who #1 is.** (L5; L7)
- **Given** the setup screen
- **When** a usable name and number are typed and "Lagre" is tapped
- **Then** secure storage holds, under #1's key, with
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, exactly `{ name, number }`: the
  trimmed name and the normalised number
- **And** the home screen shows "Nummer 1: {name}", the normalised number under
  it, and the call button reading "Ring {name}"
- **And** after the app is restarted (a fresh module registry, secure storage
  kept), the same.

**GRP-02-AC3 — Any phone number, and only a phone number.** (L5, table-driven;
the numbers from the fixtures, in these shapes)
- **Given** the number rule
- **Then** it accepts, and normalises as shown: `ddd dd ddd` → the eight
  digits; `+47 ddd-dd-ddd` → `+47` and the eight digits; `0047 (ddd) dd.ddd` →
  `0047` and the eight digits; a `+`, a foreign country code and a number; a
  number of exactly 3 digits; a number of exactly 15
- **And** it refuses: an empty field; only whitespace; a letter anywhere; any
  character other than digits, the dropped separators and a first `+`
  (`*` and `#` among them); a `+` anywhere but first; two `+`; 2 digits; 16
  digits
- **And** on the setup screen, a refused number shows "Nummeret ser ikke riktig
  ut. Bruk bare sifre, gjerne med + og landskode først.", and secure storage's
  `setItemAsync` is not called
- **And** the fake API records no request while a number is typed, checked or
  saved (reading 1).

**GRP-02-AC4 — #1's name follows the contract's display-name rule.** (L5)
- **When** the name is empty, only whitespace, longer than 40 characters after
  trimming, or holds a bidirectional control
- **Then** "Navnet kan ikke brukes. Det må ha minst ett synlig tegn, og ingen
  skjulte tegn." shows, and secure storage's `setItemAsync` is not called
- **And** "Åse", "O'Brien" and "Anne-Marit" are accepted, as GRP-01-AC31 holds
  for the rule itself.

**GRP-02-AC5 — The walker changes #1, or leaves it as it was.** (L5)
- **Given** #1 is set
- **When** "Bytt nummer 1-kontakt" is tapped
- **Then** the setup screen opens with the current name and number in its fields
- **And** saving a new name and number replaces #1 in secure storage, and the
  home screen and the call button show the new one
- **And** "Avbryt", or Android's back, returns to the home screen with secure
  storage's value and the screen's #1 unchanged.

**GRP-02-AC6 — #1 stays on the phone.** (L5)
- **Given** a run through choosing, changing and calling #1
- **Then** no request the app makes to the server holds #1's name or number, in
  its path, headers or body (the fake API's record)
- **And** the secure-store fake records #1's name and number under #1's key
  alone
- **And** `apps/mobile/package.json` declares none of
  `@react-native-async-storage/async-storage`, `expo-file-system`,
  `expo-sqlite` and `react-native-mmkv`, so the app has no other store #1
  could be written to
- **When** any request answers 401
- **Then** #1's key is deleted with the credential, the join screen shows
  (GRP-01-AC29), and after a new join the home screen shows no #1 (AC1)
- **When** a request gets no answer within 20 s, a network error, or a 5xx
- **Then** #1's key is not deleted, and the home screen shows #1.

**GRP-02-AC7 — The home screen shows who #1 is without waiting for the
server.** (L5)
- **Given** a phone holding a credential and a #1
- **When** the app starts and `GET /v1/me` has not answered, or gets no answer
  within 20 s, a network error, or a 5xx
- **Then** the home screen shows "Nummer 1: {name}", the number, and the call
  button reading "Ring {name}"
- **And** once the request has failed, "Vi fikk ikke kontakt med serveren. Prøv
  igjen om litt." and "Prøv igjen" show on the home screen too (GRP-01-AC29
  holds).

**GRP-02-AC8 — A #1 that cannot be saved or read is said, never hidden.** (L5)
- **When** secure storage's `setItemAsync` rejects on "Lagre"
- **Then** the setup screen shows "Nummeret ble ikke lagret. Prøv igjen.", and
  the home screen, once returned to, shows the earlier #1, or none
- **When** at start secure storage's read of #1 rejects, or returns a value that
  is not JSON, or one whose name or number fails the rules
- **Then** the call button reads "Velg hvem du vil ringe" with "Vi fikk ikke
  lest hvem du skal ringe. Trykk for å velge på nytt." under it, no "Nummer 1"
  line shows, and a tap opens the setup screen and calls neither `callNumber`
  nor `openDialer`.

**GRP-02-AC9 — No phone number or name in a log or an escaping error.** (L5;
PRIV-07)
- **Given** `console.log`, `info`, `warn`, `error` and `debug` spied on, and the
  secure-store fake and the phone-module fake rejecting, on the failure paths,
  with errors whose messages hold #1's number and name
- **When** #1 is chosen, changed, refused, failed to save, read, failed to
  read, and called (CALL-01's paths, the permission refused and both call
  paths failing included)
- **Then** no spied call, and no error that escapes to the test's global
  handlers (an unhandled rejection, or an error thrown out of a render), holds
  #1's name or its number in any form: as typed, normalised, or as the
  digit-by-digit label.

**GRP-02-AC10 — Every word is translated, every field labelled.** (L5)
- **Then** every string on the setup screen and the home screen's #1 lines
  comes from `nb.json` and `en.json`, with the same keys (the existing
  translations test)
- **And** each field has a visible label, rendered whether or not the field
  holds text (not a placeholder), and the field's `accessibilityLabel` is the
  same text; the number field has `keyboardType="phone-pad"`
- **And** the shown number's `accessibilityLabel` is its characters separated
  by single spaces (`+ddd` → `+ d d d`), so a screen reader reads it digit by
  digit.

## Test plan

| Level | Where | Criteria | Runs here? |
|---|---|---|---|
| L1 static | `tsc`, ESLint, dependency-cruiser (the new rule is CALL-01-AC6's) | — (CALL-01-AC6) | Yes |
| L5 app | `features/grp/first-contact.test.ts` (the number rule, table-driven); `features/grp/home.test.tsx` (the whole app through Expo Router's testing library, as `grp.test.tsx` does, with `expo-secure-store`, `fetch`, `expo-localization` and the phone module faked) | AC1 to AC10 | Yes |
| L7 Android | Maestro, in `apps/mobile/e2e/`: a signed-in phone with no #1 sees the explaining call button; chooses #1; sees "Nummer 1: {name}" and "Ring {name}" | AC1, AC2 | **No**: CI's `android-e2e` |
| L7 iOS | none | — | Task 12 (D-134): no `ios` configuration yet |

No L2, L3, L4 or L6 test: nothing on the server changes (Q1).

**L7 needs a signed-in phone.** The bootstrap code opens only an empty group
(GRP-01, approach 8), so a second flow cannot join with it on the same
database. The new flows either continue from `first-admin-invites.yaml`'s state
or join with an invitation that flow made; which is the implementer's, and no
flow may depend on another's order without saying so in its header. The
number typed is synthetic and passed in by `scripts/e2e-android.mjs` (owned), as
every string is; no flow file holds a number (HK-07).

**What this cloud session cannot verify:** L7 (no emulator; CI's
`android-e2e`); anything on iOS; how a real phone's keypad and secure storage
behave after a reboot before the first unlock.

### Existing assertions that change by design (RG-03)

Each a change of meaning made by this task's specs, so `test-author` writes it
with the reason beside it and `test-auditor` can check none is a weakening:

- **GRP-01's L5 tests of the member screen and the unreachable screen**
  (`features/grp/grp.test.tsx`): the member screen becomes the home screen
  (#1, the call button and 112 on it); a phone holding a credential shows it
  before `GET /v1/me` answers (CALL-02's spec, approach 2), where it showed
  only a waiting indicator; and "could not be reached" with "Prøv igjen" shows
  on the home screen, where it was a screen of its own. GRP-01-AC29's two
  halves are unchanged: only a 401 signs out, and an unreachable server keeps
  the credential and says so.
- **`first-admin-invites.yaml`**: if the home screen's heading changes from
  `grp.member.title`, the flow's `MEMBER_TITLE` step follows it.
- **The shared kit moves** from `features/grp/ui.tsx` to `src/shared/ui/`, and
  its colours to the palette: imports change, no assertion.

## Modules and files affected

**App (`apps/mobile/`):** `src/features/grp/` (`first-contact.ts`,
`first-contact-screen.tsx`, `home-screen.tsx`, `session.tsx` for #1's deletion
on sign-out and the home screen's start, and their tests); `src/shared/secure-
storage.ts` (#1's three functions); `src/shared/translations/nb.json` and
`en.json`; `e2e/` (the new flows). `session.tsx`, `secure-storage.ts` and
`package.json` are code-owner paths (D-139).

**Test kit (owned):** `packages/test-kit/src/fixtures/phone-numbers.ts`, the
one file HK-07 lets hold numbers that look Norwegian, with synthetic numbers
in the shapes AC3 lists; the app's tests and the L7 script read them from
there. Whether the app's jest can import the test kit, or the fixture is read
another way, is the implementer's to settle without a second copy of the
numbers.

**Scripts (owned):** `scripts/e2e-android.mjs` passes the new flows their
strings from `nb.json` and the synthetic number.

**Server, contracts, infra:** nothing (Q1).

## Contract changes

None (Q1). `api:diff` must show no change.

## Risks and failure modes

- **[F6](../plan/03-safety-reliability-security.md#failure-modes), the call
  reaches nobody.** A mistyped number calls a stranger or no one. Mitigated
  only in part: the home screen shows the number exactly as it is dialled, so
  the walker can see it. A "test call" is in no story.
- **[F7](../plan/03-safety-reliability-security.md#failure-modes), the server
  down.** With #1 on the phone, the call button works with no server (AC7 and
  CALL-01-AC6).
- **A lost #1 after a reinstall or a new phone** (`allowBackup: false`): the
  home screen says no #1 is chosen (AC1). Not silent; the cost of Q1's answer.
- **#1 is a third party's personal data,** a name and a number, about someone
  who may not use the app (D-013). On the phone only, it never reaches the
  server or a provider; the privacy notice and the DPIA (M4) should still say
  the app keeps it on the walker's phone.
- **Someone else's unlocked phone**
  ([F10](../plan/03-safety-reliability-security.md#failure-modes)): whoever
  holds it can change #1. A known limitation, as with "I'm home".
- **A #1 who is 110, 112 or 113:** accepted (approach 3); the call button then
  opens the dialer with that number, as the 112 button does, and never uses
  `ACTION_CALL` (CALL-01-AC2). Not refused, not encouraged.

## Out of scope

- **The recommendation to pick a group member as #1, and calling a member
  sharing the location with them:** the call-sharing story, task 11 (reading
  5). Task 11 decides how #1 is linked to a member, once responder setup
  (task 9) stores members' confirmed numbers.
- **Removing #1 without choosing another** (reading 6), a contact picker (Q2),
  more than one contact, and calling anyone else from the app.
- **The journey screen's call button** (the start-a-journey story, task 3):
  task 3 keeps the call button and 112 on the journey screen.
- **iOS** (task 12): secure storage in the Keychain, the keypad, VoiceOver.

### Left for later tasks

- **Task 3:** the app's sign-out on any 401 must change before a removed member
  can walk (GRP-01's spec). When it does, it decides whether #1 is kept while a
  journey the phone has not seen end is running; on this spec, #1 goes with the
  credential.
- **Task 11:** the member link and the recommendation (above).
- **M4:** the privacy notice and the DPIA name #1 as data kept on the walker's
  phone only.

## Settled by the plan, so not asked

- **Any phone number, in the group or not:** D-013 and the story.
- **The recommendation to pick a member waits for task 11:** it is the
  call-sharing story's criterion, and D-134 puts that story in task 11.
- **The name rule:** GRP-01's display-name rule, for the reason in GRP-01-AC31.

## Where the plan disagrees with itself

1. **D-134's "UI work runs on the Mac" against this session.** Settled by the
   owner: task 2 is built in the cloud session (D-141), as GRP-01 was (D-137,
   item 5). Nothing in this spec needs the Mac.
2. **"Setup (GRP-02) recommends picking a group member as #1"** sits in the
   call-sharing story (task 11), while GRP-02 is built in task 2. Read as task
   11's (reading 5).

## Answered (D-141)

The owner answered task 2's seven questions on 2026-10-22, each with the
recommendation:

| # | Question | Answer | Spec |
|---|---|---|---|
| Q1 | Where #1 is kept | On the phone only | This spec |
| Q2 | How #1 is entered | Typed: a name and a number | This spec |
| Q3 | 112 on Android opens the dialer with 112 filled in | Accepted: that is "one tap away" | `CALL-02.md` |
| Q4 | Which screens show the 112 button | Every screen, the join screen included | `CALL-02.md` |
| Q5 | Dark-first | Always dark | `CALL-02.md` |
| Q6 | The minimum target sizes | As proposed | `CALL-01.md` |
| Q7 | `features/call/` a code-owner and safety-review path | Yes, in a hand-merged step-1 pull request before task 2's | `CALL-01.md`, "Step 1" |

Also in D-141: task 2 is built in this cloud session, and step 1 comes from
the branch `claude/busy-faraday-40n2zl-ai-review`, batched with Dependabot #95.

**Considered, and not taken (Q2):** picking #1 from the phone's contacts.
Whether Android's contact picker needs the contacts permission was never
checked, and with typing it does not matter.
