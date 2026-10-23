# CALL-01 · Call my #1 contact: one large button, and on Android the call starts on the tap

**Milestone:** M3, task 2 of 12 (D-134), with GRP-02 and CALL-02 ·
**Delivers:** CALL-01 on Android: the call button, the largest element on the
home screen, places the call to #1 on the tap when the app holds Android's call
permission, and says plainly when it does not. Who #1 is, and the home screen
the three specs share, are in `docs/specs/GRP-02.md` ("The home screen task 2
builds"); 112 is `docs/specs/CALL-02.md`. This spec also carries step 1, the
pull request that makes `features/call/`, `shared/ui/`, `apps/mobile/e2e/` and
`apps/mobile/src/app/` code-owner and safety-review paths before task 2's
(CALL-01-AC9, CALL-02-AC10, AC11 and AC12) · **Decisions:** D-010, D-012, D-014, D-023,
D-031, D-037, D-042, D-055, D-075, D-128, D-134, D-139, D-141 ·
**Written:** 2026-10-22, step 1 of `/feature` for task 2, for this cloud
session's branch (D-055). **Settled** the same day on the owner's answers
(D-141). Neither pass had a shell: the branch was not checked, `pnpm run
decision` and `req:coverage` were not run, decisions were read in
`docs/plan/decisions.md` by line, and D-141, written in parallel, was not read
here. **Amended** the same day on the owner's answer about `shared/ui/` (D-141
item 7, as amended) and on safety-reviewer's notes on step 1's pull request.
That pass had no shell either: it read `.github/CODEOWNERS`, the `safety`
filter and the version comment in `.github/workflows/ai-review.yml`, the
failure-modes table in `docs/plan/03-safety-reliability-security.md`, D-141 as
it stood before the amendment, and the files under `apps/mobile/src/app/` and
`apps/mobile/src/shared/`, in this session's worktree; it did not read step 1's
branch. **Amended again** the same day on the owner's answer about
`apps/mobile/e2e/` ("Ja, ta med e2e/"), after reading that folder's file list
in the worktree. **Amended a third time** the same day on the owner's answer
about `apps/mobile/src/app/` ("Ja, ta med src/app/") and on safety-reviewer's
delta notes for task 2: `phone.ts` cleans the number itself and builds every
`tel:` URI from the cleaned string, and the emergency set grows (approach 2,
AC2). The Norwegian numbering facts behind the narrowed prefix rule are
Nkom's, from a web search's summary of two Nkom pages, read on 2026-10-22 by
the session that coordinated this pass (approach 2 cites them); Nkom's
current allocation file was not read. **Amended a fourth time** on
safety-reviewer's smaller notes after #100 passed: the reduction loops
(approach 2, AC2), and a pasted invisible character is named as a risk.
**Amended a fifth time** in review loop 1 (2026-10-23), from the five reviews
of the green code at `0930b86`; listed under "Review loop 1" below and marked
*Review loop 1* where made. What that pass read is in `CALL-02.md`'s header.
**Amended a sixth time** in review loop 2 (2026-10-23), from the delta
reviews of `d2a55ca`; listed under "Review loop 2" below and marked *Review
loop 2* where made. What that pass read is in `CALL-02.md`'s header ·
**Status:** Settled, and amended. The owner's answers are in D-141.

### Review loop 1 (2026-10-23), from the reviews of `0930b86`

Five reviewers passed `0930b86`. Each change below is Claude's choice under
D-031, from a reviewer's should-fix. AC2, AC4, AC5, AC6 and AC8 are amended,
and approaches 1, 2, 4, 5, 7 and 9; no criterion is new.

| Finding | Decision | Criterion |
|---|---|---|
| `safety-reviewer` 2: reading the permission can reject | `callNumber` treats a rejected read as not granted and opens the dialer; it does not fail | Approach 2; AC4 |
| `safety-reviewer` 5: any file could place a call | An ESLint `no-restricted-imports` rule allows `expo-intent-launcher`, and `PermissionsAndroid` and `Linking` from `react-native`, only in `features/call/phone.ts`, with fixture tests | Approach 1; AC6 |
| The spec pass's note on that rule: `expo-linking`, an app dependency, is not in it | The rule also allows `expo-linking` only in `features/call/phone.ts` (Claude's choice under D-031, after the review) | Approach 1; AC6; test plan, L1 |
| `code-reviewer` 1: a missing or untagged scripted flow is only printed | A flow named in the script's order that is absent, or present but not tagged `scripted`, stops the run with a message naming it | Approach 9 |
| `code-reviewer` 2: the script imports a `.ts` fixture | The root `package.json`'s `engines.node` floor rises to `>=22.18.0` | Approach 9; Modules |
| `code-reviewer` 4: iOS | `CallPermissionLine` renders nothing when the platform is not Android | Approach 4; AC4 |
| `a11y-i18n-reviewer` 3: the hint promises a call the tap does not place | While `CALL_PHONE` is not granted, the call button's hint is the "permission missing" text | Approach 5; AC4, AC8 |
| `a11y-i18n-reviewer` 4: the failure line's number is read as a figure | The failed-call message's `accessibilityLabel` spells the number digit by digit; the visible text is unchanged | AC5 |
| `test-auditor` 2: the URI from the cleaned string, for a number that is not plain | `112 ,5` proves its URI is built from the cleaned string | AC2 |
| `test-auditor` 3 (RG-04): the coverage baseline lags | `coverage-baseline.json`'s entry for `scripts/lib/e2e-android.mjs` rises to the measured 98.33 lines / 92.59 branches; test-author makes the change | Test plan; Modules |
| `a11y-i18n-reviewer` 1: `expo-system-ui` | A second new app dependency, CALL-02's | Approach 7 (`CALL-02.md`, AC7) |

### Review loop 2 (2026-10-23), from the delta reviews of `d2a55ca`

The delta reviews of loop 1's changes, at `d2a55ca`, all passed. Each change
below is Claude's choice under D-031, from a reviewer's note or should-fix.
AC4, AC6 and AC8 are amended, and approaches 1 and 5; no criterion is new.

| Finding | Decision | Criterion |
|---|---|---|
| `safety-reviewer` note and `a11y-i18n-reviewer` note: while the permission is `null` (not read yet, or every read so far failed), the hint says "Ringer …", though nothing has shown the permission is held, and when `phone.ts`'s own read at the tap fails (`heldForCall()` false) the tap opens the dialer | The call hint only while the permission reads `granted`; "Knappen åpner telefonappen, og du må trykke ring der." otherwise: `notGranted`, not yet read, or no read answered. The visible text does not change | Approach 5; AC4, AC8 |
| `safety-reviewer` note and `privacy-security-reviewer` N1: the calling-imports rule matches exact module names only | It also refuses, outside `phone.ts`: a deep path into the calling packages; `NativeModules` from `react-native`; `requireNativeModule` from `expo-modules-core` and `expo`; a dynamic `import()` of any of them; and a namespace import of `react-native`, `expo` or `expo-modules-core`, which `no-restricted-imports` refuses as a whole because it cannot see a member access such as `RN.Linking`. Claude's additions under D-031, the same kind of way round: `TurboModuleRegistry` from `react-native`, `requireOptionalNativeModule` from `expo-modules-core` and `expo`, a default import of the three, and an `import()` whose source the rule cannot read | Approach 1; AC6; test plan, L1; Risks |
| `privacy-security-reviewer` N1, recorded, not fixed: expo-router's `router.push('tel:…')` and `<Link href="tel:…">` reach `Linking.openURL` without awaiting it, and on Android its rejection's text holds the full `tel:` URL | A rule on `tel:` strings is left for later: it would also match comments in tests and fixtures, and nothing uses it today | Risks |
| `code-reviewer` should-fix 1: `scriptedFlowsToRun` in `scripts/lib/e2e-android.mjs` still returns `absent`, always `[]` now that a missing scripted flow stops the run | No spec change: this spec never names `absent` (approach 9 says only that a missing or untagged flow stops the run). Removing the field, so the return value is what the caller reads, is a code and test change in `scripts/lib/`, with no criterion of its own | None |

## Requirement

### The story this spec delivers

**CALL-01** (`docs/plan/01b-mvp-scope.md`, CALL section, 1st story; Must):

> **CALL-01 · Call my #1 contact** (Must)
> As a walker, I tap one button to call my #1 contact.
> - It is the largest element on the home screen and easy to hit one-handed with
>   gloves (⚙️ minimum target size).
> - Android: the call starts on the tap. iPhone: at most one system confirmation
>   (to verify in the Section 4 spike).
> - Works whether or not a journey is running.

And from the non-functional requirements in the same file: "Safety-critical
stories (CALL-01, CALL-02, …) have automated end-to-end tests that run on every
change"; "Accessibility: large targets, screen-reader labels, works with large
text."

### The owner's scope (D-134, D-141)

Task 2: "**GRP-02, CALL-01, CALL-02 — The home screen.** The #1 contact, the
call button, and 112 always visible." Built in this cloud session (D-141). iOS
waits for task 12. The ⚙️ sizes are Q6's, as proposed (D-141), and
`features/call/` needs the owner and the safety review (Q7, D-141; "Step 1"),
and so do the whole of `shared/ui/`, `apps/mobile/e2e/` and
`apps/mobile/src/app/` (D-141 item 7, amended).

### What the plan fixed around it

- **SPIKE-01, S6** (`docs/plan/04b-spike-results.md`, "S6 — one-tap
  calling"): on the Android emulator, **with `CALL_PHONE` granted, the tap
  alone started the call (2 of 2 runs); without it, the dialer opened and
  waited for a second tap (2 of 2).** The spike's app used `ACTION_CALL`
  through `expo-intent-launcher`, and fell back to the dialer with a `tel:`
  link, `Linking.openURL`, which Android opens as `ACTION_VIEW`
  (`spikes/background-safety/app/src/call.js`). iOS: **documented, not
  observed**: Apple's "Phone Links" says a `tel:` link needs one confirmation
  from iOS 10.3 on, within the story's "at most one"; open until a real phone
  (L9, deferred by D-037).
- **Android's documented rule for `Intent.ACTION_CALL`**
  (developer.android.com/reference/android/content/Intent#ACTION_CALL): the
  intent "cannot be used to call emergency numbers. Applications can dial
  emergency numbers using `ACTION_DIAL`, however." Cited as the documented
  rule; the page was not re-fetched in this session. What `ACTION_CALL` does
  when given an emergency number anyway is not documented, so the app never
  gives it one (approach 2).
- **D-010** (the owner) and the call-sharing story (task 11): pressing the call
  button will also share the location with #1 when #1 is a member. Not in this
  task; nothing in this task may say it does.
- **D-023** (the owner): Expo, development builds; no over-the-air updates.
- **D-139** (the owner): `apps/mobile/package.json` is a code-owner path; a
  new app dependency waits for the owner's approval.
- **D-141** (the owner): Q6's sizes; Q7, `features/call/` a code-owner and
  safety-review path, from a step-1 pull request on
  `claude/busy-faraday-40n2zl-ai-review`, batched with Dependabot #95.
  Amended (the owner, 2026-10-22, "Ja, hele shared/ui/"): the whole
  `apps/mobile/src/shared/ui/` folder too, in the same pull request, with
  Claude's two choices under D-031 that came with the answer: `phone.ts`
  checks for 110, 112 and 113 itself (approach 2), and a task-2 test requires
  every route to be drawn through `Screen` (CALL-02-AC1). Amended again (the
  owner, 2026-10-22, "Ja, ta med e2e/"): `apps/mobile/e2e/`, the Maestro
  flows, too, in the same pull request (CALL-02-AC11). Amended a third time
  (the owner, 2026-10-22, "Ja, ta med src/app/"): `apps/mobile/src/app/`,
  Expo Router's routes and the root layout around every screen, too, in the
  same pull request (CALL-02-AC12).
- **The UI rules** (`.claude/rules/ui-i18n.md`): "Designed for night, stress
  and gloves: large touch targets … Every interactive element has a
  screen-reader label."

### What exists today

- No call button, no calling code, no call permission in `app.config.ts`
  (`blockedPermissions` lists four others; `CALL_PHONE` is neither asked for
  nor blocked).
- `expo-intent-launcher` is not a dependency of the app (it is the spike's).
  `expo-linking` is.
- GRP-01's buttons are at least 56 points tall (`features/grp/ui.tsx`).
- `apps/mobile/src/features/call/` does not exist, and no merge rule names it.
- `apps/mobile/src/shared/ui/` does not exist either, and no merge rule names
  it. `src/shared/` holds `translations/`, `api/client.ts` and
  `secure-storage.ts`; the last two are code-owner paths (D-139), and no
  CODEOWNERS line matches `translations/` (read 2026-10-22).
- `apps/mobile/e2e/` exists, with three flow files (`app-starts.yaml`,
  `wrong-code.yaml`, `first-admin-invites.yaml`, listed on disk in the
  worktree; whether git tracks each was not checked: no shell). No
  CODEOWNERS line and no ai-review filter matches it (the `ui` filter's app
  entry is `apps/mobile/src/**/*.tsx`).
- `apps/mobile/src/app/` holds `_layout.tsx` and `index.tsx`, and
  `apps/mobile/src/app.test.tsx` sits beside the folder (listed on disk). No
  CODEOWNERS line matches any of them, and only the `ui` filter covers the
  two `.tsx` routes.

### Readings this spec makes

1. **"The call starts on the tap"** needs Android's `CALL_PHONE` permission
   (S6). Without it, the app can only open the dialer, which waits for a second
   tap. So the app asks for it, and when it does not hold it, the button still
   calls through the dialer and the home screen says so plainly: a degraded
   button is said, never hidden.
2. **"The largest element on the home screen"**: taller than every other
   control there, and the screen's full width less its margins.
3. **"Easy to hit one-handed with gloves"**: Q6's sizes, and the button sits
   below #1's name, in the scrolling content under the 112 bar.
4. **"Works whether or not a journey is running"**: no journey exists in the
   app before task 3. What this task can hold is that calling reads nothing of
   a journey and asks nothing of the server, so it works in any state the app
   is in; task 3 keeps it on the journey screen.
5. **"iPhone: at most one system confirmation"** cannot be built or checked
   before the app has an iOS configuration (task 12, D-134). Left to task 12,
   with its check on a real iPhone.

Requirements are named as in `GRP-02.md`, "How this spec names requirements,
and why": tracked requirements this task does not deliver are named in words.

## Approach (technical choices delegated to Claude, D-031)

1. **One module for the phone's calling path,** `features/call/phone.ts`, the
   only file that imports `expo-intent-launcher`, `PermissionsAndroid` or
   `Linking` for calls. Its functions: `callNumber(number)`,
   `openDialer(number)`, `callPermission()` (`granted` or `notGranted`),
   `askCallPermission()` (`granted`, `denied`, or `neverAskAgain`: Android's
   answer once it will no longer show its dialog), and `openAppSettings()`.
   Screens never touch the platform directly, so L5 fakes this one module and
   nothing else. *Review loop 1, `safety-reviewer` 5:* "the only file" is
   enforced, not only intended. An ESLint `no-restricted-imports` rule in the
   owned `eslint.config.mjs` refuses an import of `expo-intent-launcher` or
   `expo-linking`, or of `PermissionsAndroid` or `Linking` from
   `react-native`, in any file under
   `apps/mobile/src/` but `features/call/phone.ts`, so no other file can place
   a call (AC6).
   *Review loop 2, `safety-reviewer` note and `privacy-security-reviewer` N1:*
   a rule's `paths` match a module's exact name, so the rule also refuses,
   in the same files, the other ways to reach the same native code:
   - **a deep path** into `expo-intent-launcher`, `expo-linking`,
     `react-native` or `expo-modules-core` (any subpath, for example
     `expo-intent-launcher/build/…` or
     `react-native/Libraries/Linking/Linking`);
   - **`NativeModules`** and, Claude's addition, **`TurboModuleRegistry`**
     from `react-native`, which reach the native modules `Linking` and
     `PermissionsAndroid` wrap;
   - **`requireNativeModule`** and, Claude's addition,
     **`requireOptionalNativeModule`** from `expo-modules-core` and from
     `expo`, which reach the native module `expo-intent-launcher` wraps;
   - **a namespace import** of `react-native`, `expo` or `expo-modules-core`
     (`import * as RN from 'react-native'`, then `RN.Linking`).
     `no-restricted-imports` does not look at a member access, so it cannot
     refuse `RN.Linking` itself. It refuses the namespace import as a whole
     wherever `importNames` restricts a name of that module, as ESLint's
     documentation for `importNames` shows; so a namespace import of the
     three is refused outside `phone.ts`. If the installed ESLint does not do
     this, the rule refuses it by another means; it is not left as a risk;
   - **a default import** of the same three (Claude's addition): `default`
     is among the refused names, so `import RN from 'react-native'` cannot
     stand in for the namespace;
   - **a dynamic `import()`** of any of these packages or a subpath, written
     as a string or as a template with no expressions, and, Claude's
     addition, an `import()` whose source is not such a string (a variable,
     a template with expressions), because what it loads cannot be checked.
     `no-restricted-imports` checks import and export declarations, not
     `import()` expressions, so this part needs `no-restricted-syntax` or
     another rule; which is the implementer's. A TypeScript type query,
     `typeof import('react-native')`, which four test files use, is not an
     `import()` expression and stays allowed.
   Nothing in `apps/mobile/src` uses any of these today (searched
   2026-10-23). ESLint gives a file one set of options for a rule, so every
   block of `eslint.config.mjs` that refuses the calling imports carries the
   new refusals too; and the shared configuration's AR-03 clock selectors,
   which use `no-restricted-syntax` in `apps/mobile/src/safety-core/`, must
   still apply there if `no-restricted-syntax` carries the dynamic-import
   part (AC6).
2. **Placing the call, on Android** (`callNumber`). `phone.ts` handles the
   number itself, as it is given, and relies on no other module's
   normalisation (D-141 item 7, amended: Claude's choice (a), and
   safety-reviewer's delta notes on task 2, also Claude's choices under
   D-031). In this order:
   - **It cleans the number.** It removes whitespace (`\s`), `-`, `.`, `(`
     and `)`, and nothing else. Every `tel:` URI it builds, for `ACTION_CALL`
     and for the dialer, comes from this cleaned string (or, for an emergency
     number, from its reduction below), never from the string it was given.
   - **What is not a plain number goes to the dialer.** If the cleaned string
     does not match `^\+?[0-9]+$` (ASCII digits only), `callNumber` opens the
     dialer and never starts `ACTION_CALL`, whatever the permission. The URI
     holds the cleaned string with every character but the digits and a first
     `+` percent-encoded, so none is read as a URI delimiter. *Why:* Android
     reads a `tel:` string its own way. A comma or a semicolon ends the number
     that is dialled (`112,5` dials 112), letters count as keypad digits
     (`11A` is 112), digits from other scripts count as digits (`١١٢`, in
     Arabic-Indic digits, is 112), and `#` starts a URI fragment (`*31#112`).
     Each of these can reach an emergency number through `ACTION_CALL`
     without looking like one. Today only `features/grp/first-contact.ts`,
     which is not a code-owner path, keeps such strings out of #1.
   - **It reduces a plain number for the emergency check,** in a loop until
     nothing changes: a leading `+47` is dropped, else a leading `0047`, else
     a leading `+`. (So `+47 112` reduces to `112`, `+112` to `112`, and
     `+0047112` to `112`: the check errs towards the dialer.)
   - **Emergency numbers go to the dialer.** The reduced number is an
     emergency number if it is exactly one of: `112` and `911`, which 3GPP
     TS 22.101 makes emergency numbers on every phone; `110` and `113`,
     Norway's own; and `000`, `08`, `118`, `119` and `999`, which a phone with
     no SIM card treats as emergency numbers. It is one too if it *begins*
     with `110`, `112`, `113`, `000`, `118` or `119` and has more digits,
     because Android may match emergency numbers by prefix. An emergency
     number gets the dialer with the reduced digits in it (`tel:112`, for
     example), exactly as `openDialer`; never `ACTION_CALL`, whatever the
     permission (Android's documented rule above).
     - *The prefix rule is narrowed for `911`, `999` and `08`.* Norwegian
       mobile numbers are eight digits beginning with 4 or 9 (blocks 40–49
       and 90–99), so `911ddddd` and `999ddddd` are the shapes of real mobile
       numbers; and 02000–09999 are five-digit special numbers, so `08ddd` is
       a real shape too. Sending those to the dialer would take "the call
       starts on the tap" from real #1s, so they go to `ACTION_CALL` unless
       they are exactly `911`, `999` or `08`.
     - *The prefix rule stands for `110`, `112`, `113`, `118`, `119` and
       `000`.* No subscriber number begins with 1. Numbers beginning with 1
       are 100–115 and 117–179 (three-digit standardised special numbers),
       116 000–116 999 (six-digit EEA-harmonised numbers), 1800–1899
       (four-digit directory enquiries) and 190–199 (provider-specific), so
       none is longer than three digits and begins `110`, `112`, `113`, `118`
       or `119`; the three-digit numbers themselves are in the exact set.
       `00` is the international prefix and `01` is reserved, so no
       Norwegian number begins `000`. If a later allocation adds one, the
       prefix rule narrows for it as for `911`; a wrong match costs one tap,
       never a failed call.
     - *Source:* Nkom, "Alle nummerserier for norske telefonnumre"
       (nkom.no/telefoni-og-telefonnummer/telefonnummer-og-den-norske-nummerplan/alle-nummerserier-for-norske-telefonnumre)
       and "5-sifrede nummer" (the same path, `/5-sifrede-nummer`), as a web
       search summarised them on 2026-10-22. The pages themselves were not
       opened, the summary notes they may be years old, and Nkom's current
       allocation file (nkom.no/files/nummerplaner/E164.csv) was not read.
     - The check errs towards the dialer: a wrong match costs the walker one
       tap more in a dialer that places no call by itself; a missed match
       sends an emergency number to `ACTION_CALL`, whose behaviour then is
       undocumented.
     - `first-contact.ts` (GRP-02, approach 3) still normalises #1 for storage
       and display, and is not a code-owner path. Because the cleaning, the
       URI and the emergency rule now live wholly in `phone.ts`, which is, no
       change to `first-contact.ts` can send an emergency number, or a string
       Android would read as one, to `ACTION_CALL`.
   - with `CALL_PHONE` granted, for any other plain number: `ACTION_CALL` with
     `tel:` and the cleaned string, through `expo-intent-launcher`, as
     SPIKE-01's app did;
   - without it, or if `ACTION_CALL` is refused (rejects): the dialer with the
     cleaned string in it (`Linking.openURL('tel:' + cleaned)`), and the home
     screen's line (item 4);
   - if reading the permission rejects: as without it. `callNumber` treats
     the failed read as not granted and opens the dialer; it does not fail
     because of the read (*Review loop 1*, `safety-reviewer` 2; AC4);
   - if both fail: a message that the phone could not start the call, with the
     number shown so the walker can dial it by hand.
   - The app does not ask `Linking.canOpenURL` first: on Android 11 and later it
     answers false without a `<queries>` entry, which would turn a working
     button into a refusal.
   - **One call at a time:** a tap while a call is being started does not start
     a second. "Being started" ends when `callNumber` settles or when the app
     next comes to the foreground, whichever is first, so a promise that never
     settles cannot leave the button dead. (SPIKE-01 notes that
     `startActivityAsync` resolves when the call screen is left.)
3. **Asking for the permission.** `CALL_PHONE` is added to `app.config.ts`'s
   Android permissions. The app asks with Android's own dialog only when the
   walker saves a #1 where none was stored and the permission is not granted.
   Before that save, on Android, the setup screen shows one line saying why:
   "Tillat telefonsamtaler, så ringer knappen med ett trykk." The app asks
   nothing at start, nothing when #1 is changed, and nothing on a call tap. If
   that request answers `neverAskAgain`, the save is done and nothing more is
   opened; the home screen's line (item 4) shows.
4. **When the app does not hold it** (refused, or revoked later in Android's
   settings): with #1 set, the home screen shows, under the call button,
   "Knappen åpner telefonappen, og du må trykke ring der." with a button
   "Tillat telefonsamtaler". Its tap calls `askCallPermission`; if that answers
   `neverAskAgain`, the same tap opens the app's settings, and from then until
   the app restarts or the permission is granted the button reads "Åpne
   innstillinger" and opens them directly. The permission is read at start and
   every time the app comes to the foreground (`AppState` becomes `active`),
   so the line comes and goes with the setting. Rejected: refusing to save #1
   until the permission is given (a walker who says no would have no button at
   all). *Review loop 1, `code-reviewer` 4:* the line (`CallPermissionLine`,
   in `features/call/permission.tsx`) renders nothing when the platform is not
   Android; iOS is task 12's.
5. **The button** (`features/call/call-button.tsx`): a `Pressable` with the
   role "button"; the visible text "Ring {name}"; the screen-reader label "Ring
   {name}" and the hint "Ringer {number}", the number digit by digit (while
   `CALL_PHONE` is not granted, the hint is item 4's "Knappen åpner
   telefonappen, og du må trykke ring der." instead, because the tap then
   places no call: *Review loop 1*, `a11y-i18n-reviewer` 3). *Review loop 2,
   `safety-reviewer` and `a11y-i18n-reviewer` notes:* "Ringer {number}" only
   while the permission reads `granted`; item 4's text whenever it does not:
   `notGranted`, not yet read, or no read answered yet (the permission state
   is `null`). Unread, the app does not know the tap places a call:
   `phone.ts` reads the permission again at the tap, and a read that fails
   opens the dialer. The hint may then promise less than the tap does, never
   more. The visible text is the same in every case. Q6's
   sizes; the palette's colours (CALL-02's spec, approach 5); its text allowed
   to grow with the phone's font size and to wrap, never cut off (no
   `numberOfLines`, no `allowFontScaling={false}`). With no #1, or #1
   unreadable, it is GRP-02's explaining button (GRP-02-AC1, AC8), the same
   size and place.
6. **No server, no journey.** Calling makes no API request, needs no answer
   from `GET /v1/me`, and imports nothing from `safety-core/` or another
   feature. The existing import rules do not hold the last part (`GRP-02.md`,
   "The home screen task 2 builds", item 1), so task 2 adds one
   dependency-cruiser rule for it in `packages/config/dependency-cruiser.cjs`,
   with fixture tests in `packages/config/`.
7. **New dependency:** `expo-intent-launcher` (first-party Expo, MIT, used in
   SPIKE-01), through `licenses:check`; `package.json` needs the owner's
   approval (D-139). Nothing else for calling. *Review loop 1:* task 2 adds
   one more app dependency, `expo-system-ui`, for the dark screens, not for
   calling (`CALL-02.md`, approach 5, AC7); it needs the same approval.
8. **Mutation testing** of the app is set up with the safety core in task 3
   (D-134). `features/call/` should join it then; this task adds no mutation
   run, and step 1 adds no safety path for mutation (`SAFETY_PATHS`) for
   any of its four folders.
9. **How `pnpm run e2e:android` runs the flows** (`scripts/e2e-android.mjs`,
   owned; the main session's choice under D-031, after test-author's red
   found that today's script runs the whole `apps/mobile/e2e/` folder in one
   Maestro run, which leaves no point between flows for the script's steps):
   - **First, one Maestro run** over every flow **not** tagged `scripted`, as
     today: one `maestro test` with the JUnit report, judged by INF-06's rules
     (Maestro's exit status and the report; zero flows is a failure).
   - **Then each flow tagged `scripted`, one at a time,** one
     `maestro test <flow>` each, in a fixed order that the script holds (not
     the folder's listing order). The order meets what each flow's header
     says it needs before it (for example, #1 chosen first).
   - **Before each scripted flow, the script's steps for it:** grant or revoke
     `CALL_PHONE` (`adb shell pm grant` / `pm revoke`), set the font scale
     (`settings put system font_scale`, with the value printed in the job
     log), and read Telecom's record (`dumpsys telecom`) as the baseline.
   - **After it:** read Telecom's record again and compare it with the
     baseline (AC2: exactly one new outgoing call to #1's number, then the
     call is ended; AC4 and CALL-02-AC3: no new call), and check that the
     focused window belongs to the default dialer wherever the flow expects
     the dialer in front (AC4; CALL-02-AC3).
   - **The font scale is always reset** at the end, even after a failed step
     or flow.
   - **A failed step or flow fails the run,** and the message names the flow
     and the step.
   - **An awake, unlocked phone before each scripted flow, and evidence when
     one fails** (*PR #101's first `android-e2e`*, 2026-10-23, the
     coordinating session's choice under D-031). That run's job log
     (run 39956809738, job 120424570385) shows `call-with-permission`
     passing with its call placed, then `call-without-permission` failing
     at its first wait: `Assertion is false: "Knappen åpner telefonappen, og
     du må trykke ring der\." is visible`, after 30 s. Between the two, the
     script pressed `KEYCODE_ENDCALL`. Android's end-call key hangs up a
     call in progress, but with no call in progress its default behaviour
     (`END_BUTTON_BEHAVIOR_SLEEP`) puts the phone to sleep, and a sleeping
     phone shows Maestro nothing. That the call had already ended, and that
     the phone slept, is inferred, not seen: the job log holds neither, and
     the debug artifact could not be read from the session. So:
     - **Before each scripted flow,** the script reads whether the phone is
       awake (`dumpsys power`, its wakefulness) and whether the keyguard is
       showing; if it is asleep or locked, it wakes it
       (`input keyevent KEYCODE_WAKEUP`, `wm dismiss-keyguard`) and says so
       in the job log, naming the flow; if it is still not awake and
       unlocked after that, the run stops there, naming the flow and the
       step. Output it cannot read stops the run too, never read as awake.
     - **The end-call key only while Telecom shows the call in progress.**
       After `call-with-permission`, the script reads the new call's events
       in Telecom's record: while the call has not ended, it presses
       `KEYCODE_ENDCALL` and says so; once the record shows it ended
       (disconnected or destroyed), it presses nothing and says that the
       call had already ended. The job log names the events it read, never
       the number (PRIV-07).
     - **When a scripted flow fails,** before the run stops, the script
       prints the phone's wakefulness and the package of the focused
       window, so the job log itself says what the phone was showing.
       Reading them is best effort: what cannot be read is printed as
       unread, and the failure stays the flow's.
   - **A scripted flow that is not there stops the run** (*Review loop 1*,
     `code-reviewer` 1). A flow named in the script's order that is absent
     from `apps/mobile/e2e/`, or present but not tagged `scripted`, stops the
     run before any flow runs, with a message naming the flow and which of
     the two it is. It is not merely printed as "not run": a flow that
     silently drops out of the order would take its Telecom and dialer
     checks with it.
   - **Node 22.18 or later** (*Review loop 1*, `code-reviewer` 2).
     `scripts/e2e-android.mjs` imports the test kit's `.ts` phone-number
     fixture, which Node runs only with type stripping on by default, from
     22.18. So the root `package.json`'s `engines.node` floor rises from
     `>=22.13.0` to `>=22.18.0` (the `<23` ceiling stays). CI reads `.nvmrc`,
     "22", which installs the latest 22. `scripts/doctor.mjs` names the same
     floor, and a test holds the two together (D-031).
   - **After a flow that leaves the dialer in front** (`dialerInFront`), the
     script reads the focused window first and, only once that check passes,
     presses back (`KEYCODE_BACK`) as its last step for the flow. The flows
     themselves never press anything in the dialer (*review loop 1*, D-031).
   - **Flows find the call button by its ID,**
     `testID="trygghverdag-call-button"`, the same on the explaining and the
     "Ring {name}" forms, because its screen-reader label now carries its
     line (GRP-02-AC1) and a text match would depend on Maestro reading the
     child view (*review loop 1*, D-031).
   - **A flow is tagged `scripted` exactly when it needs one of these steps,
     or a place in the script's order.** `first-admin-invites.yaml` needs
     no step but runs first, because `first-contact.yaml` continues from its
     signed-in state. The first run's order is not fixed (Maestro 2.10.0 walks
     the folder unsorted), and `app-starts.yaml` and `wrong-code.yaml` clear
     the app's state. The tag is Maestro's `tags:` in the flow's header. How the first run
     leaves those flows out (for example, `--exclude-tags scripted`) is the
     implementer's choice.
   - **Every call flow names its permissions in `launchApp`.** Maestro 2.10.0's
     `launchApp` grants every permission unless the flow names them, which
     would grant `CALL_PHONE` behind the script's revoke and hide AC3's
     dialog and AC4's line. So each flow that relies on the permission's
     state says that state itself.
   - **This changes INF-06's single-run assertion by design** (RG-03):
     INF-06-AC9's "runs the pinned Maestro over every flow in
     apps/mobile/e2e" (`scripts/lib/e2e-android.test.mjs`) becomes one run
     over the flows not tagged `scripted`, followed by one run per scripted
     flow. test-author writes these tests in the same file.

## Step 1: `features/call/`, `shared/ui/`, `e2e/` and `src/app/` need the owner and the safety review (Q7 and its amendments, D-141)

A pull request of its own, merged by hand before task 2's (D-075), as D-128's
step 1 (#76) and D-137's were for their paths. It edits
`.github/workflows/ai-review.yml`, which stops `claude-code-action` running on
that pull request, so it is opened from the second branch,
`claude/busy-faraday-40n2zl-ai-review`, batched with Dependabot #95 (which
edits the same workflow), so one hand merge carries both (D-141).

**Why `shared/ui/` too.** The 112 bar is in `features/call/`, but `Screen`,
which draws it on every screen (CALL-02, approach 1), moves in task 2 to
`apps/mobile/src/shared/ui/` (`GRP-02.md`, "The home screen task 2 builds",
item 5). With only `features/call/` owned, a later change to `Screen` could
drop 112 from every screen with no owner's approval and no `safety-reviewer`,
seen only by the advisory `a11y-i18n-reviewer`; and the easy way out of an
import loop would move `EmergencyBar` into `shared/ui/` as well
(safety-reviewer, should-fix 1, on step 1's pull request). The owner's
answer, 2026-10-22: "Ja, hele shared/ui/", the whole folder, in this same pull
request (D-141 item 7, amended).

**Why `e2e/` too.** The Maestro flows in `apps/mobile/e2e/` (L7) are the only
end-to-end proof that the 112 button opens the phone's dialer (CALL-02-AC3),
and they carry the rule never to tap call in the dialer (SPIKE-01-AC10's
rule; CALL-02, "The L7 112 step"). Unowned, a change could drop a flow's 112
assertions, or tap in the dialer, with no owner's approval and no
`safety-reviewer`. The owner's answer, 2026-10-22: "Ja, ta med e2e/", in this
same pull request (D-141 item 7, amended).

**Why `src/app/` too.** `apps/mobile/src/app/` holds Expo Router's routes:
`_layout.tsx`, the frame every screen is drawn inside, and `index.tsx`. A
change there could draw something over the 112 bar on every screen, or a
route that does not use `Screen`, and only the advisory `a11y-i18n-reviewer`
would see it. From task 2 on, `_layout.tsx` also holds the error boundary
that keeps 112 on a screen that crashes (CALL-02-AC13). The owner's answer,
2026-10-22: "Ja, ta med src/app/", in this same pull request, #100 (D-141
item 7, amended).

**What it changes, and nothing else:**

- **`.github/CODEOWNERS`**: four lines, `/apps/mobile/src/features/call/
  @bvst @urso-agent`, `/apps/mobile/src/shared/ui/  @bvst @urso-agent`,
  `/apps/mobile/e2e/  @bvst @urso-agent` and
  `/apps/mobile/src/app/  @bvst @urso-agent`, each with a comment naming
  CALL-01, CALL-02 and D-141 (the second also `Screen` and the 112 bar; the
  third the flows as the only end-to-end proof of 112 and the
  never-tap-in-the-dialer rule; the fourth the routes and the root layout
  around every screen), among the other `/apps/mobile/` lines (before the
  ownerless `/.claude/agent-memory/` line, which matches none of them anyway).
- **`OWNER_APPROVAL_PATHS`** in `scripts/lib/merge-rules.mjs`:
  `'/apps/mobile/src/features/call/'`, `'/apps/mobile/src/shared/ui/'`,
  `'/apps/mobile/e2e/'` and `'/apps/mobile/src/app/'`.
- **The `safety` filter in `.github/workflows/ai-review.yml`**:
  `- 'apps/mobile/src/features/call/**'`,
  `- 'apps/mobile/src/shared/ui/**'`, `- 'apps/mobile/e2e/**'` and
  `- 'apps/mobile/src/app/**'`.
- **Not** D-139's named exceptions in `scripts/gate.test.mjs` (all four
  folders are safety-review paths, unlike those ten), **not** `SAFETY_PATHS`
  or a mutation group (approach 8).
- **Two fixes from the step-1 reviews**, in the same pull request:
  - *test-auditor's guard note:* the test that no safety path covers a folder
    now checks both directions for each of the four: no `SAFETY_PATHS` entry is
    the folder or a parent of it, and none lies inside it, so an entry naming
    one file in the folder is caught too;
  - *the stale version comments:* the comment in `ai-review.yml` that names the
    Claude Code version the pinned action installs, and any other the batch's
    bump leaves stale, reads Claude Code 2.1.304 at `claude-code-action`
    v1.0.254, the version Dependabot #95 pins. (In this worktree it reads
    "2.1.301 at v1.0.251", `ai-review.yml` line 206; the 2.1.304 pairing is
    the review's, not checked in this pass.)

**Its tests** (gate tests under `scripts/`, named for CALL-01-AC9 for
`features/call/`, CALL-02-AC10 for `shared/ui/`, CALL-02-AC11 for `e2e/` and
CALL-02-AC12 for `src/app/`, as REL-10-AC18's are, and like them; the same
checks for each folder, except that the last-match and filter checks of
`e2e/` and `src/app/`, which exist today, run on the files git tracks there
rather than on synthetic paths, as the next paragraph says):

- in `scripts/lib/merge-rules.test.mjs`, as REL-10-AC18's block for the
  canary: `OWNER_APPROVAL_PATHS` holds the folder; `.github/CODEOWNERS` gives
  it exactly one line, owners `@bvst @urso-agent`, and `reviewCodeowners` of
  the file finds no problem; the workflow holds the folder's `**` entry; no
  `SAFETY_PATHS` entry covers the folder or lies inside it, and no mutation
  group covers it;
- in `scripts/gate.test.mjs`, as BUG-10's and REL-10-AC18's last-match and
  filter checks: under GitHub's last-match reading (`lastMatchOwners`), a file
  directly in the folder and one nested below it each belong to
  `@bvst @urso-agent`; the `safety` filter covers both (`globCovers`); and the
  folder is not among the named exceptions;
- for `shared/ui/` alone, a control: `apps/mobile/src/shared/translations/en.json`,
  under `shared/` but outside `ui/`, keeps its present owners (today none: no
  CODEOWNERS line matches it), so the new line is not `/apps/mobile/src/shared/`
  by mistake;
- for `src/app/` alone, a control: `apps/mobile/src/app.test.tsx`, beside the
  folder in `src/` and not in it, keeps the owners it has today (none), so a
  line wider than the folder, such as `/apps/mobile/src/app*` or
  `/apps/mobile/src/`, is caught. A line written without the trailing slash
  matches the same files as the folder's line (git's own matcher, checked by
  test-author) and is caught by the exact-line check and `reviewCodeowners`
  instead.
- The general tests already there hold the rest, unchanged: every `/apps/`
  owner path outside the ten named exceptions must be in the `safety` filter,
  and every `/apps/` entry in the filter must be an owner path (BUG-10).

**What step 1 pins for `e2e/` and `src/app/` itself.** Those folders exist
today, so step 1 pins them as REL-10-AC18's last test does for the canary:
git tracks at least one `.yaml` file under `apps/mobile/e2e/`
(CALL-02-AC11), and at least one `.tsx` file under `apps/mobile/src/app/`,
`_layout.tsx` among them (CALL-02-AC12); and every file git tracks in either
belongs to `@bvst @urso-agent` under last-match and is covered by the
`safety` filter. A typo in their CODEOWNERS lines or filter entries fails in
step 1's own pull request.

**What step 1 cannot pin.** Neither `features/call/` nor `shared/ui/` exists
until task 2 creates it, so step 1 cannot test that git tracks a file under
them. The file paths step 1's last-match and filter tests use for them are
synthetic. Until task 2 merges, their CODEOWNERS lines and filter entries
match nothing, so a typo in either path would not show yet. **That pin comes
with task 2's own tests** (the last part of CALL-01-AC9 and of
CALL-02-AC10): git tracks at least one `.ts` or `.tsx` file under each
folder, and every file git tracks there is owned under last-match and covered
by the filter.

## Acceptance criteria

Each is proven by at least one test whose name starts with its ID. Numbers are
synthetic, from the test kit's fixtures; on the emulator, from a range reserved
for fiction, never 112 or any emergency number (SPIKE-01-AC10's rule). Quoted
texts are the bokmål in `CALL-02.md`'s translations table, asserted in full.

**CALL-01-AC1 — The call button is the largest element on the home screen.**
(L5)
- **Given** the home screen: with #1 set, without, and with #1 unreadable; as a
  member and as the admin; with `GET /v1/me` unanswered and with the server
  unreachable
- **Then**, read from the rendered tree's flattened styles (jest has no layout
  engine), the call button's `minHeight` is at least 120, and greater than the
  `minHeight` of every other pressable on the screen, the 112 button included
- **And** it sets no `width` or `maxWidth`, its `alignSelf` is unset or
  `stretch`, and its container's `alignItems` is unset or `stretch`, so it
  spans the content's width less the content's horizontal padding
- **And** the space between the 112 button's lower edge and the top of the
  scrolling area, which no scroll can reduce (the bar's bottom padding plus any
  margin between the bar and the scrolling area), is at least 24
- **And** every other pressable on the screen has a `minHeight` of at least 56.

**CALL-01-AC2 — On Android, with the call permission, the tap starts the call to
#1; an emergency number goes to the dialer.** (L5; L7)
- **Given** #1 set and `CALL_PHONE` granted
- **When** the call button is tapped once
- **Then** the phone-module fake records exactly one `callNumber` with #1's
  normalised number, and no `openDialer` (L5, the screen)
- **And** `phone.ts`'s `callNumber` starts `android.intent.action.CALL` with
  `tel:` and that number, once, and does not call `Linking.openURL`
  (L5, `phone.test.tsx`, `expo-intent-launcher` and `Linking` mocked)
- **And** on the emulator, Telecom's record (`dumpsys telecom`) shows one
  outgoing call to that number, placed with no second tap (L7, read as SPIKE-01
  read it)
- **And** a second tap before the first `callNumber` has settled, and before
  the app has come back to the foreground, records no second call; a tap after
  either calls again (L5)
- **And**, in `phone.test.tsx` (L5), which does not import
  `features/grp/first-contact.ts` and passes every number in as written, so
  nothing leans on GRP-02's normalisation; each case with the permission
  granted and without:
  - *the emergency set:* `callNumber` given `112`, `911`, `110`, `113`, `000`,
    `08`, `118`, `119` or `999` opens `tel:` with that number through
    `Linking.openURL` and never starts `ACTION_CALL`;
  - *written other ways:* the same for each written with spaces between the
    digits, with dashes between them, with a leading `+47` (with and without a
    space after it), with a leading `0047`, and with a leading `+0047`: the
    dialer with the reduced digits alone (`tel:112`), never `ACTION_CALL`;
  - *by prefix:* the same, the dialer, for `110`, `112`, `113`, `000`, `118`
    and `119` each followed by more digits (shapes `112d`, `113dd`). This
    replaces the earlier pin that one of 110, 112 or 113 followed by a digit
    went to `ACTION_CALL`: Android may match emergency numbers by prefix, and,
    by Nkom's numbering plan as approach 2 cites it, no Norwegian number
    longer than three digits begins with these;
  - *the narrowed prefixes:* `911` and `999` followed by five digits
    (`911ddddd`, `999ddddd`, the shape of Norwegian mobile numbers) and `08`
    followed by three (`08ddd`) start `ACTION_CALL` with the permission, as
    any other #1 does (approach 2 says why);
  - *not a plain number:* `112,5`, `11A`, `١١٢` (Arabic-Indic digits) and
    `*31#112` each open the dialer and never start `ACTION_CALL`, and the
    URI holds no unencoded `,`, `;` or `#`;
  - *a not-plain number with a separator* (*Review loop 1*, `test-auditor`
    2): `112 ,5` opens the dialer with a URI built from the cleaned string,
    `112,5` with its comma encoded (`tel:112%2C5`), holding no space and no
    encoded space, and never starts `ACTION_CALL`; so the cleaning is shown
    to run before the dialer's URI on this path too, not only on a plain
    number's;
  - *the URI from the cleaned string:* given `ddd dd ddd` or
    `(ddd) dd-ddd` with the permission, `ACTION_CALL`'s data is `tel:` and the
    eight digits, with no space, dash or parenthesis; without it, the dialer's
    URI is the same;
  - *not emergency numbers:* the fixtures' eight-digit numbers, one of them
    shaped `ddd112dd`, and `47` followed by one of 110, 112 or 113 with no
    `+`, start `ACTION_CALL` with the permission.

**CALL-01-AC3 — The app asks for the call permission when the first #1 is
saved, and only then.** (L5; L7)
- **Given** Android, no #1 stored, and `callPermission()` answering
  `notGranted`
- **Then** the setup screen shows "Tillat telefonsamtaler, så ringer knappen
  med ett trykk."
- **When** a usable #1 is saved
- **Then** #1 is saved first, then `askCallPermission` is called once, and
  Android's dialog shows (L7, tapped by its resource ID so the phone's language
  does not matter)
- **And** `askCallPermission` is not called at start, when #1 is changed, when
  the first #1 is saved with the permission already granted, or on a tap of the
  call button
- **And** if it answers `neverAskAgain`, the save completes, `openAppSettings`
  is not called, and the home screen shows AC4's line.

**CALL-01-AC4 — Without the permission, the button still calls, and the home
screen says a second tap is needed.** (L5; L7)
- **Given** #1 set and `CALL_PHONE` not granted: refused, or revoked in
  Android's settings while the app was in the background
- **Then** at start, and when `AppState` next becomes `active`, the home screen
  shows "Knappen åpner telefonappen, og du må trykke ring der." and "Tillat
  telefonsamtaler"
- **When** the call button is tapped
- **Then** the dialer opens with #1's number in it, and no call is placed (L5:
  `phone.ts` calls `Linking.openURL` with `tel:` and the number, after
  `ACTION_CALL` is refused or without trying it; L7: Telecom has no call)
- **When** "Tillat telefonsamtaler" is tapped
- **Then** `askCallPermission` is called; if it answers `neverAskAgain`,
  `openAppSettings` is called in the same tap, and the button reads "Åpne
  innstillinger" and calls `openAppSettings` alone until the app restarts or
  the permission is granted
- **And** once `callPermission()` answers `granted` (after the dialog, or when
  `AppState` becomes `active` after the settings), the line and its button are
  gone and a tap calls as in AC2
- **And** with no #1 set, the line does not show
- **And** while the permission does not read `granted`, the call button's
  `accessibilityHint` is "Knappen åpner telefonappen, og du må trykke ring
  der.", not "Ringer …"; once it reads `granted`, AC8's hint returns (L5;
  *Review loop 1*, `a11y-i18n-reviewer` 3). *Review loop 2*,
  `safety-reviewer` and `a11y-i18n-reviewer` notes: "does not read
  `granted`" covers three cases, each a test in `call.test.tsx` with #1 set,
  the phone-module fake's `callPermission` answering per test: it answers
  `notGranted`; it has not settled yet (the permission state is `null`, not
  yet read); it rejects, at start and at every read since (`null`, no read
  answered). In each, the hint is that text, the visible text is still
  "Ring {name}", and once the fake answers `granted` (and `AppState` becomes
  `active`), the hint is "Ringer " and the spelled number
- **And**, in `phone.test.tsx`, when reading the permission
  (`PermissionsAndroid.check`) rejects, `callNumber` treats it as not
  granted: it calls `Linking.openURL` with `tel:` and the cleaned number,
  never starts `ACTION_CALL`, and does not reject (L5; *Review loop 1*,
  `safety-reviewer` 2)
- **And** with the platform faked as iOS, `CallPermissionLine` renders
  nothing, whatever the permission state it is given (L5; *Review loop 1*,
  `code-reviewer` 4; iOS is task 12's).

**CALL-01-AC5 — A call the phone cannot start is said, with the number.** (L5)
- **Given** the phone module's `callNumber` rejects (with the permission it
  tries `ACTION_CALL` and then the dialer; without, the dialer alone)
- **When** the call button is tapped
- **Then** "Telefonen kunne ikke starte samtalen. Ring {number} selv." shows,
  with #1's normalised number, in an element with
  `accessibilityLiveRegion="assertive"` so it is read out when it appears
- **And** that element's `accessibilityLabel` is the same sentence with the
  number's characters separated by single spaces, as GRP-02-AC10 spells #1's
  number, so a screen reader reads it digit by digit; the visible text is
  unchanged (*Review loop 1*, `a11y-i18n-reviewer` 4)
- **And** the call button stays, and a later tap calls `callNumber` again.

**CALL-01-AC6 — Calling needs no server and no journey.** (L5; L1)
- **Given** #1 set, and `GET /v1/me` unanswered, failed with no answer within
  20 s or a network error, or answered with a 5xx
- **When** the call button is tapped
- **Then** the call starts as in AC2 (or AC4), and the fake API records no
  request made between the tap and the call's start
- **And** the new dependency-cruiser rule refuses an import from
  `apps/mobile/src/features/call/` into `apps/mobile/src/features/<another>/`
  (its index included) or into `apps/mobile/src/safety-core/` (its index
  included), and allows imports within `call/` and into `src/shared/`
  (L1; fixture tests in `packages/config/`, with a control that the rule fires
  against a probe file)
- **And** `pnpm run gate:static`'s dependency-cruiser run passes on the
  repository with the rule in place
- **And** an ESLint `no-restricted-imports` rule in `eslint.config.mjs`
  refuses an import of `expo-intent-launcher` or `expo-linking`, or of
  `PermissionsAndroid` or `Linking` from `react-native`, in any file under
  `apps/mobile/src/` but `apps/mobile/src/features/call/phone.ts`, and allows
  them there, so no other file can place a call or open the dialer.
  `expo-linking` is an app dependency that no file under `apps/mobile/src/`
  imports today; its `openURL` would open a `tel:` link as `Linking`'s does
  (Claude's choice under D-031, after review loop 1). Fixture tests in
  `packages/config/`, beside CALL-02-AC2's: a probe file standing as
  `features/call/phone.ts` (no error), and probes elsewhere under
  `features/call/` and under `features/grp/` (an error for each of the four
  imports), with a control
  that the rule fires; and `pnpm run gate:static`'s lint passes on the
  repository with the rule in place (L1; *Review loop 1*, `safety-reviewer`
  5).
- **And** the same refusal, allowed in `phone.ts` alone, covers the other
  ways in that approach 1 lists (L1; *Review loop 2*, `safety-reviewer` note
  and `privacy-security-reviewer` N1). In
  `packages/config/calling-imports.test.mjs`, each probe below is refused
  (an error on its line, from `no-restricted-imports` or from the rule that
  carries the dynamic-import part), with the existing control showing the
  probe was linted, in at least one file under `features/` outside `call/`,
  one under `features/call/` other than `phone.ts`, one under `src/app/`, and
  one under `src/shared/ui/` (each a block of `eslint.config.mjs` with its
  own options):
  - *a deep path of each module:* `expo-intent-launcher/build/…`,
    `expo-linking/build/…`, `react-native/Libraries/Linking/Linking`,
    `react-native/Libraries/PermissionsAndroid/PermissionsAndroid` and
    `expo-modules-core/build/…` (any subpath the implementer chooses, at least
    two levels deep);
  - *`NativeModules`*, and `TurboModuleRegistry`, from `react-native`;
  - *`requireNativeModule`*, and `requireOptionalNativeModule`, from
    `expo-modules-core` and from `expo`;
  - *a dynamic import:* `import('expo-linking')`,
    `` import(`expo-intent-launcher`) ``, `import('react-native')`,
    `import('react-native/Libraries/Linking/Linking')`, and an `import()`
    whose source is a variable;
  - *a namespace import:* `import * as RN from 'react-native';` followed by
    `RN.Linking.openURL(…)`: the import line is refused (the member access
    is not what the rule sees); and the same for `expo` and
    `expo-modules-core`;
  - *a default import* of `react-native`, `expo` and `expo-modules-core`.
- **And** the controls hold: in the same files, `type RN = typeof
  import('react-native');` and `import('./local-module')` are not refused,
  nor are `AppState`, `Platform`, `Pressable`, `Text` and `View` from
  `react-native` (as today); in `phone.ts` the calling rule refuses none of
  the probes above (CALL-02-AC2's frame rule still refuses a namespace
  import of `react-native` there, because it restricts `Modal` and
  `ScrollView` by name, and ESLint refuses a namespace import of a module
  whose names it restricts; so the test checks that every refusal in
  `phone.ts` carries the `CALL-02-AC2:` message: red phase of loop 2); in a
  probe under `apps/mobile/src/safety-core/`, the AR-03 clock
  rule still refuses `Date.now()` beside a refused dynamic import, so the
  calling rule's options did not replace the clock rule's; and the
  repository's own app still passes (*Review loop 2*).

**CALL-01-AC7 — Nothing says the call does more than call.** (L5)
- **Then** no text the home screen or the setup screen renders, in any state
  of AC1 (collected from the rendered tree, in bokmål and in English), and no
  value under `call.` or `grp.firstContact.` in `nb.json` and `en.json`,
  contains, case-insensitively, any of: `posisjon`, `plassering`, `deler`,
  `varsl`, `følger`, `sporer`, `location`, `share`, `alert`, `notif`,
  `follow`, `track`.

**CALL-01-AC8 — The button is found and read as what it is, at any text size.**
(L5; L7)
- **Then** it has the role "button", the `accessibilityLabel` "Ring {name}",
  and, with `CALL_PHONE` read as granted, the `accessibilityHint` "Ringer "
  followed by #1's number with its characters separated by single spaces (L5;
  without the permission, AC4's hint: *Review loop 1*; and while it is not
  yet read, or no read has answered, AC4's hint too: *Review loop 2*)
- **And** its text sets no `numberOfLines` and no `allowFontScaling={false}`
  (L5)
- **And** with Android's font size at the largest the emulator image's
  Settings offer (set by the script with `settings put system font_scale`
  before the flow, reset at the end of the run even after a failure (approach
  9), and the value printed in the job log), the call
  button with its text "Ring {name}" is visible on the home screen without
  scrolling (L7, with a short synthetic name).

**CALL-01-AC9 — `features/call/` needs the owner and the safety review, and holds
code.** (scripts' gate tests; Q7, D-141)
- **Step 1** ("Step 1" above): `OWNER_APPROVAL_PATHS` holds
  `/apps/mobile/src/features/call/`; `.github/CODEOWNERS` has exactly one line
  for it, owners `@bvst @urso-agent`, and `reviewCodeowners` finds no problem;
  the `safety` filter in `ai-review.yml` lists
  `apps/mobile/src/features/call/**`; under last-match, a file in the folder
  and one nested below it belong to `@bvst @urso-agent` and are covered by the
  filter; the folder is not among D-139's named exceptions; it is no safety
  path (no `SAFETY_PATHS` entry covers it or lies inside it), and no mutation
  group covers it
- **Task 2:** git tracks at least one `.ts` or `.tsx` file under
  `apps/mobile/src/features/call/`, and every file git tracks there belongs to
  `@bvst @urso-agent` under last-match and is covered by the `safety` filter.
- CALL-02-AC10 holds the same for `apps/mobile/src/shared/ui/`, CALL-02-AC11
  for `apps/mobile/e2e/` and CALL-02-AC12 for `apps/mobile/src/app/`, in the
  same step-1 pull request.

## Test plan

| Level | Where | Criteria | Runs here? |
|---|---|---|---|
| L1 static | the new dependency-cruiser rule, with fixture tests in `packages/config/` beside LOST-02-AC25's; ESLint, with the `no-restricted-imports` rule that keeps the calling imports (`expo-intent-launcher`, `expo-linking`, and `PermissionsAndroid` and `Linking` from `react-native`) in `phone.ts` and its fixture tests (*review loop 1*); *review loop 2:* the same rule's deep paths, `NativeModules` and `TurboModuleRegistry`, `requireNativeModule` and `requireOptionalNativeModule`, dynamic, namespace and default imports, with their controls, in `packages/config/calling-imports.test.mjs` | AC6 (imports) | Yes |
| L5 app | `features/call/call.test.tsx` (the whole app through Expo Router's testing library, the phone module faked with a recording fake whose answers are set per test; `AppState` driven for the foreground check); `features/call/phone.test.tsx` (`.tsx`, not `.ts`, because as `.ts` it changed how the app's TypeScript program types `process.env`, test-author's red; the module's own choices: `ACTION_CALL` with the permission, the dialer without, the fallback when `ACTION_CALL` rejects, the cleaning and the URI built from it, the emergency set and its prefixes to the dialer, written plainly and with spaces, dashes, `+47` or `0047`, strings that are not a plain number to the dialer, the permission's answers, with `expo-intent-launcher`, `PermissionsAndroid` and `Linking` mocked) | AC1 to AC8 | Yes |
| L7 Android | Maestro, `apps/mobile/e2e/`, run by `scripts/e2e-android.mjs` as approach 9 says: one run over the flows not tagged `scripted`, then each `scripted` flow alone in the script's fixed order, with the script's steps before it (grant or revoke `CALL_PHONE`, the font scale, Telecom read) and after it (Telecom read again, the dialer in front where expected), the font scale reset at the end even after a failure. The flows: grant through Android's own dialog (tapped by its resource ID); tap and read Telecom's record; revoke with `adb shell pm revoke`, relaunch, see the line, tap, see the dialer and no call; at the largest font size, the button visible. Each call flow names its permissions in `launchApp`. The orchestration's own tests are in `scripts/lib/e2e-android.test.mjs`, a scripted flow absent or untagged stopping the run among them (*review loop 1*); RG-04: `coverage-baseline.json`'s entry for `scripts/lib/e2e-android.mjs` rises to the measured 98.33 lines and 92.59 branches, a change test-author makes (*review loop 1*, `test-auditor` 3) | AC2, AC3, AC4, AC8 | **No**: CI's `android-e2e` (the orchestration's tests in `scripts/lib/`: yes) |
| Gate tests | `scripts/lib/merge-rules.test.mjs`, `scripts/gate.test.mjs` | AC9, and CALL-02-AC10, AC11 and AC12 beside it (step 1's part in step 1's pull request; the tracked-file part in task 2's, but for `e2e/` and `src/app/`, which step 1 pins itself) | Yes |
| L7 iOS; L9 | none | — | Task 12, and a real iPhone (D-037) |

**L7 reads Telecom's record** (`adb shell dumpsys telecom`), as SPIKE-01's S6
drivers did, because Maestro cannot see a call. That reading, the permission
revoke, the font size and ending the emulated call belong in
`scripts/e2e-android.mjs` or a helper it runs (owned paths), around each flow
tagged `scripted` (approach 9), and the readers get tests in `scripts/lib/`, as
S6's did. The flows themselves, in
`apps/mobile/e2e/`, are owned and safety-reviewed from step 1 on
(CALL-02-AC11). The emulator has no real network; a call
there reaches no one. The number dialled is from a range reserved for fiction.

**What this cloud session cannot verify:** any call (no emulator; CI's
`android-e2e`); iOS at all; a real phone's dialer, which may differ from the
emulator's; whether text is clipped on a real screen (jest has no layout, and
Maestro reads text, not pixels); gloves.

## Modules and files affected

**Step 1 (its own pull request, #100), for the four folders:** `.github/CODEOWNERS`,
`scripts/lib/merge-rules.mjs` (`OWNER_APPROVAL_PATHS`),
`.github/workflows/ai-review.yml` (the `safety` filter, and the stale version
comment), `scripts/lib/merge-rules.test.mjs`, `scripts/gate.test.mjs`. All
owned.

**App:** `src/features/call/` (new: `phone.ts`, `call-button.tsx`, the
permission line, `index.ts`, tests); `src/features/grp/home-screen.tsx` and
the setup screen (the permission line and request on the first save);
`app.config.ts` (`CALL_PHONE`; its test that release builds ask for it and
still block the four it blocks); `package.json` (`expo-intent-launcher`,
owned, D-139); `nb.json`, `en.json`; `e2e/` flows (owned after step 1,
CALL-02-AC11).

**Who reviews what, after step 1:** `features/call/`, `shared/ui/`,
`apps/mobile/e2e/` and `apps/mobile/src/app/` are code-owner and
safety-review paths (`shared/ui/` holds `Screen`, CALL-02; `e2e/` holds the
L7 flows of AC2, AC3, AC4 and AC8; `src/app/` the routes and the root layout
around every screen).
`features/grp/home-screen.tsx` and `features/grp/first-contact.ts` stay
unowned. That is acceptable because neither can now take away a call path
unseen: the 112 bar is drawn by `Screen`, and the call button's size, its
calls and the emergency rule are in `features/call/`; the tests that would
fail if `home-screen.tsx` dropped either button (AC1, CALL-02-AC1) live in
`features/call/` and `shared/ui/`, both owned; and `phone.ts` cleans the
number, builds the URI and checks for emergency numbers itself (approach 2).
What stays unowned is what #1 is and how it is shown (GRP-02), which the
walker sees on the home screen. `nb.json` and `en.json` stay unowned too:
the owned tests in `features/call/` assert the 112 button's texts in full in
both languages (CALL-02-AC6) and the call button's in bokmål (the quoted
texts above); the call button's English is held only by AC7's word list,
which reads every value under `call.` in both files.

**Config (owned):** `packages/config/dependency-cruiser.cjs` (the new rule)
and its fixture tests; *review loop 1:* `eslint.config.mjs` (the
`no-restricted-imports` rule for the calling imports, AC6) and its fixture
tests in `packages/config/`; *review loop 2:* the same rule widened, with any
companion rule for `import()` (approach 1), and its probes in
`packages/config/calling-imports.test.mjs`.

**Scripts (owned):** `scripts/e2e-android.mjs` and a tested reader for
Telecom's record; the font-size step; task 2's tracked-file pins for
`features/call/` (AC9) and `shared/ui/` (CALL-02-AC10); *review loop 1:* the
stop on a scripted flow that is absent or untagged (approach 9).

**Root (owned), review loop 1:** `package.json`'s `engines.node`, from
`>=22.13.0 <23` to `>=22.18.0 <23` (approach 9); `coverage-baseline.json`'s
entry for `scripts/lib/e2e-android.mjs`, to 98.33 / 92.59 (RG-04; test-author's
change). Both are code-owner paths (`.github/CODEOWNERS`, read 2026-10-23).

**Server, contracts, infra:** nothing.

## Contract changes

None.

## Risks and failure modes

- **The walker's own call path failing: a call that does not happen when it
  should.** None of the F1–F10 failure modes
  ([table](../plan/03-safety-reliability-security.md#failure-modes)) is this
  one: they are about journeys and the alerts to responders, and F6 is "Alert not
  noticed". (An earlier version of this spec called this F6; safety-reviewer
  noted the error.)
  - *The permission refused or revoked:* the call needs a second tap in the
    dialer. Said on the home screen (AC4), with the way to fix it. Not silent.
  - *A failure to start the call at all:* said, with the number (AC5).
  - *A double tap with gloves:* one call (AC2).
  - *A start that never settles:* the next return to the foreground frees the
    button (AC2).
  - *A #1 that is an emergency number, or that Android would read as one:*
    never given to `ACTION_CALL`, whose documented rule excludes emergency
    numbers; the dialer opens (AC2). `phone.ts` cleans the number, builds the
    URI from the cleaned string, sends anything that is not a plain number to
    the dialer, and recognises the emergency set (112, 911, 110, 113, and the
    no-SIM numbers 000, 08, 118, 119, 999) however it is written, without
    relying on `first-contact.ts` (approach 2). Left over: `911`, `999` and
    `08` followed by more digits go to `ACTION_CALL`, because those are the
    shapes of real Norwegian numbers; and another country's own emergency
    number outside the set goes to `ACTION_CALL` too. What Android does then
    is undocumented: a refusal reaches the dialer through the fallback, but a
    silent no-op would not. Accepted as unlikely for a walker in Norway; not
    observable before L9. The numbering facts behind the narrowed prefix rule
    are Nkom's overview pages as a web search summarised them on 2026-10-22
    (approach 2); the pages may be old, and Nkom's current allocation file was
    not read, so a newer allocation beginning with a prefix in the rule would
    send that #1 to the dialer: one tap more, never a failed call.
  - *An invisible character in the number:* a bidirectional mark (U+200E,
    say) pasted with a number is not whitespace, so the cleaned string fails
    `^\+?[0-9]+$` and the #1 goes to the dialer: one tap more, the safe
    direction. `first-contact.ts` refuses such a number today (GRP-02-AC3),
    so it reaches `phone.ts` only if that rule changes.
- **The 112 bar or the call button removed by a change outside
  `features/call/`.** `Screen` draws the bar on every screen, from
  `shared/ui/`; after step 1 that folder needs the owner and
  `safety-reviewer` too (CALL-02-AC10), and task 2's test that every route is
  drawn through `Screen` (CALL-02-AC1) catches a screen added later without
  it. The routes and the root layout in `src/app/` need both as well
  (CALL-02-AC12), and they, not the features, draw `Screen`; nothing outside
  `shared/ui/` may import `Modal`, `Alert`, `SafeAreaView` or `ScrollView`,
  and a child of `Screen` is clipped below the bar (CALL-02-AC1, AC2). `home-screen.tsx` and
  `first-contact.ts` stay unowned ("Modules and files affected" says why that
  is acceptable).
- **[F7](../plan/03-safety-reliability-security.md#failure-modes), the server
  down:** calling needs no server (AC6), and the home screen does not wait for
  it (CALL-02's spec, approach 2).
- **A pocket call.** A large button on an unlocked screen can be pressed by
  accident, and with the permission it calls at once, which is what the story
  asks. Accepted; the phone's own lock screen is the guard.
- **The permission itself.** `CALL_PHONE` lets the app place calls without the
  walker's tap in the dialer. The app places one only from the call button
  (AC2's single `ACTION_CALL`), and `phone.ts` is the one place that can.
  After step 1 every change to it needs the owner and `safety-reviewer` (AC9).
- **What the calling-imports rule does not see** (*Review loop 2*,
  `safety-reviewer` note and `privacy-security-reviewer` N1). AC6's rule,
  widened, refuses the direct ways to the call and the dialer, but it is a
  guard against an honest mistake in a file outside `features/call/`, not
  against a determined change. Left over:
  - *Another package that opens a link itself.* expo-router's
    `router.push('tel:…')` and `<Link href="tel:…">` reach `Linking.openURL`
    without awaiting it (as the reviewer reported; not read here), and
    expo-router is imported by the routes and the features, so it cannot be
    refused. On Android, `openURL`'s rejection's text holds the full `tel:`
    URL, so an un-awaited rejection could carry #1's number to an error
    report or a log: a PRIV-07 risk if anything used it. Nothing does today.
    A rule refusing `tel:` strings outside `phone.ts` is left for later: it
    would also match comments in tests and fixtures, and nothing uses it
    today. Recorded, not fixed.
  - *`require()`.* Expected to be refused in every `.ts` and `.tsx` file by
    typescript-eslint's `no-require-imports`, which its strict type-checked
    set includes in version 8, the set the shared configuration extends
    (`packages/config/eslint/index.mjs`; neither that file nor
    `eslint.config.mjs` turns it off, read 2026-10-23). No probe of AC6
    shows it, and it was not run in this pass.
  - *Test files* reach the modules through `jest.requireActual`, which the
    rule does not see. Test files are not bundled into the app.
  - *Globals* that hold native modules (React Native's and Expo's module
    proxies on `global`) are not refused.
  - *A deep path into `expo` itself* (on the delta reviews of `9c7c498`,
    `safety-reviewer` N4 and `privacy-security-reviewer` N-A). The rule
    refuses `expo`'s `requireNativeModule`, `requireOptionalNativeModule`,
    and its default and namespace imports, but its deep-path pattern names
    only `expo-intent-launcher`, `expo-linking`, `expo-modules-core` and
    `react-native`, so `import { requireNativeModule } from
    'expo/build/Expo'` (which `expo`, with no `exports` field, allows) gets
    through; the privacy reviewer probed it. Nothing imports it today. The
    fix is one pattern, `^expo/(?:build|src)/`, which leaves room for
    `expo`'s public subpaths such as `expo/fetch`, and one probe in
    `calling-imports.test.mjs`. Recorded, not fixed in this task, by the
    coordinating session's choice (both reviewers offered recording it);
    queued as a follow-up.
- **The permission hint after a failed read** (*Review loop 2*; approach 5).
  The permission state keeps the last read that answered, so the
  permission line does not vanish on a failed read (`permission.tsx`). A
  read that fails after one that answered `granted` leaves "Ringer …" in the
  hint while the tap's own read fails and opens the dialer. The tap still
  reaches the dialer, the safe direction, and no call is lost; a check that
  fails after one that answered has not been observed. Not changed in loop
  2, whose finding was the unread state.
- **The L7 flows changed unseen.** `apps/mobile/e2e/` holds the only
  end-to-end proof that a tap places the call (AC2) and that 112 opens the
  dialer (CALL-02-AC3), and the rule never to tap call in the dialer. After
  step 1 a change to them needs the owner and `safety-reviewer`
  (CALL-02-AC11). The scripts that drive them were owned already.
- **The step-1 lines for `features/call/` and `shared/ui/` match nothing until
  task 2 merges.** A misspelt path would not show until then; task 2's
  tracked-file pins (AC9, CALL-02-AC10) are what catch it. The lines for
  `e2e/` and `src/app/` are pinned against their tracked files in step 1
  itself (CALL-02-AC11, AC12).
- **Emulator against real phone.** S6 was observed on the emulator only; some
  manufacturers' dialers may differ. The private test and L9 (deferred,
  D-037) are where that shows.

## Out of scope

- **iOS** (task 12): the `tel:` link and its one confirmation, checked on a real
  iPhone.
- **Calling #1 sharing the location with #1, and starting a journey with #1**:
  the call-sharing story, task 11. Until then the button only calls.
- **The journey screen's call button**: task 3 keeps it working there
  (reading 4).
- **The permission-check story's checks** (task 4): location, notifications
  and battery. The call permission is this spec's own, said on the home screen.
- **Mutation testing of `features/call/`**: task 3 (approach 8).

## Settled by the plan, so not asked

- **`ACTION_CALL` with `CALL_PHONE`, and the dialer without it:** the story's
  "the call starts on the tap" and S6's observation.
- **Emergency numbers never through `ACTION_CALL`:** Android's documented rule
  for the intent.
- **`expo-intent-launcher`:** the spike's mechanism, first-party Expo; D-031
  delegates the library.

## Answered (D-141)

The full list of task 2's answers is at the end of `GRP-02.md`.

- **Q6, the minimum target sizes: as proposed.** The call button at least
  120 dp tall and the screen's full width less its margins; the 112 button at
  least 64 × 96 dp; every other control at least 56 dp tall; at least 24 dp
  between the 112 button and the call button (AC1, CALL-02-AC6). On a small
  phone at the largest font size, the home screen scrolls below the call
  button; 112 never scrolls (CALL-02).
- **Q7, `features/call/` a code-owner and safety-review path: yes,** in a
  hand-merged step-1 pull request before task 2's, from
  `claude/busy-faraday-40n2zl-ai-review`, batched with Dependabot #95 ("Step
  1", AC9).
- **Amendment to Q7 (the owner, 2026-10-22): "Ja, hele shared/ui/".** The whole
  `apps/mobile/src/shared/ui/` folder too, in the same step-1 pull request; no
  named exception, no safety path, no mutation group ("Step 1",
  CALL-02-AC10). With it, Claude's choices under D-031: `phone.ts` checks for
  110, 112 and 113 itself (approach 2, AC2), and a task-2 test requires every
  route to be drawn through `Screen` (CALL-02-AC1).
- **Second amendment to Q7 (the owner, 2026-10-22): "Ja, ta med e2e/".**
  `apps/mobile/e2e/`, the Maestro flows, too, in the same step-1 pull request;
  no named exception, no safety path, no mutation group; pinned against its
  tracked flows in step 1 itself ("Step 1", CALL-02-AC11).
- **Third amendment to Q7 (the owner, 2026-10-22): "Ja, ta med src/app/".**
  `apps/mobile/src/app/`, Expo Router's routes and the root layout, too, in
  the same step-1 pull request, #100; no named exception, no safety path, no
  mutation group; pinned against its tracked files in step 1 itself ("Step
  1", CALL-02-AC12).
