# CALL-01 · Call my #1 contact: one large button, and on Android the call starts on the tap

**Milestone:** M3, task 2 of 12 (D-134), with GRP-02 and CALL-02 ·
**Delivers:** CALL-01 on Android: the call button, the largest element on the
home screen, places the call to #1 on the tap when the app holds Android's call
permission, and says plainly when it does not. Who #1 is, and the home screen
the three specs share, are in `docs/specs/GRP-02.md` ("The home screen task 2
builds"); 112 is `docs/specs/CALL-02.md`. This spec also carries step 1, the
pull request that makes `features/call/`, `shared/ui/` and `apps/mobile/e2e/`
code-owner and safety-review paths before task 2's (CALL-01-AC9,
CALL-02-AC10 and CALL-02-AC11) · **Decisions:** D-010, D-012, D-014, D-023,
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
in the worktree · **Status:** Settled, and amended. The owner's answers are in D-141.

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
and so does the whole of `shared/ui/` (D-141 item 7, amended).

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
  flows, too, in the same pull request (CALL-02-AC11).
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
  worktree; whether git tracks each was not checked: no shell). No CODEOWNERS line and no ai-review
  filter matches it (the `ui` filter's app entry is `apps/mobile/src/**/*.tsx`).

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
   nothing else.
2. **Placing the call, on Android** (`callNumber`):
   - **110, 112 or 113:** the dialer with the three digits in it (`tel:112`,
     for example), exactly as `openDialer`; never `ACTION_CALL`, whatever the
     permission (Android's documented rule above). `phone.ts` decides this
     itself, on the number exactly as it is given, and relies on no other
     module's normalisation (D-141 item 7, amended; Claude's choice (a)):
     - it keeps only the digits `0`–`9`, noting whether the first character
       that is not whitespace is `+`;
     - if it was, and the digits begin `47`, it drops that `47`; if the digits
       begin `0047`, it drops that `0047`;
     - if what is left is exactly `110`, `112` or `113`, it is an emergency
       number.
     The check errs towards the dialer: a number that reduces to one of the
     three because of a stray character goes to the dialer, which places no
     call by itself and costs the walker one tap more; it never sends an
     emergency number to `ACTION_CALL`, whose behaviour then is undocumented.
     `features/grp/first-contact.ts` (GRP-02, approach 3) still normalises #1
     for storage and display, and is not a code-owner path. Because the
     emergency rule now lives wholly in `phone.ts`, which is, no change to
     `first-contact.ts` can route 110, 112 or 113 to `ACTION_CALL`.
   - with `CALL_PHONE` granted: `ACTION_CALL` with `tel:<number>`, through
     `expo-intent-launcher`, as SPIKE-01's app did;
   - without it, or if `ACTION_CALL` is refused (rejects): the dialer with the
     number in it (`Linking.openURL('tel:<number>')`), and the home screen's
     line (item 4);
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
   all).
5. **The button** (`features/call/call-button.tsx`): a `Pressable` with the
   role "button"; the visible text "Ring {name}"; the screen-reader label "Ring
   {name}" and the hint "Ringer {number}", the number digit by digit; Q6's
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
   approval (D-139). Nothing else.
8. **Mutation testing** of the app is set up with the safety core in task 3
   (D-134). `features/call/` should join it then; this task adds no mutation
   run, and step 1 adds no safety path for mutation (`SAFETY_PATHS`) for
   either folder.

## Step 1: `features/call/`, `shared/ui/` and `e2e/` need the owner and the safety review (Q7 and its amendments, D-141)

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

**What it changes, and nothing else:**

- **`.github/CODEOWNERS`**: three lines, `/apps/mobile/src/features/call/
  @bvst @urso-agent`, `/apps/mobile/src/shared/ui/  @bvst @urso-agent` and
  `/apps/mobile/e2e/  @bvst @urso-agent`, each with a comment naming CALL-01,
  CALL-02 and D-141 (the second also `Screen` and the 112 bar; the third the
  flows as the only end-to-end proof of 112 and the never-tap-in-the-dialer
  rule), among the other `/apps/mobile/` lines (before the ownerless
  `/.claude/agent-memory/` line, which matches none of them anyway).
- **`OWNER_APPROVAL_PATHS`** in `scripts/lib/merge-rules.mjs`:
  `'/apps/mobile/src/features/call/'`, `'/apps/mobile/src/shared/ui/'` and
  `'/apps/mobile/e2e/'`.
- **The `safety` filter in `.github/workflows/ai-review.yml`**:
  `- 'apps/mobile/src/features/call/**'`,
  `- 'apps/mobile/src/shared/ui/**'` and `- 'apps/mobile/e2e/**'`.
- **Not** D-139's named exceptions in `scripts/gate.test.mjs` (all three
  folders are safety-review paths, unlike those ten), **not** `SAFETY_PATHS`
  or a mutation group (approach 8).
- **Two fixes from the step-1 reviews**, in the same pull request:
  - *test-auditor's guard note:* the test that no safety path covers a folder
    now checks both directions for each of the three: no `SAFETY_PATHS` entry is
    the folder or a parent of it, and none lies inside it, so an entry naming
    one file in the folder is caught too;
  - *the stale version comments:* the comment in `ai-review.yml` that names the
    Claude Code version the pinned action installs, and any other the batch's
    bump leaves stale, reads Claude Code 2.1.304 at `claude-code-action`
    v1.0.254, the version Dependabot #95 pins. (In this worktree it reads
    "2.1.301 at v1.0.251", `ai-review.yml` line 206; the 2.1.304 pairing is
    the review's, not checked in this pass.)

**Its tests** (gate tests under `scripts/`, named for CALL-01-AC9 for
`features/call/`, CALL-02-AC10 for `shared/ui/` and CALL-02-AC11 for `e2e/`,
as REL-10-AC18's are, and like them; the same checks for each folder, except
that `e2e/`'s last-match and filter checks run on the files git tracks there
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
  by mistake.
- The general tests already there hold the rest, unchanged: every `/apps/`
  owner path outside the ten named exceptions must be in the `safety` filter,
  and every `/apps/` entry in the filter must be an owner path (BUG-10).

**What step 1 pins for `e2e/` itself.** That folder exists today, so step 1
pins it as REL-10-AC18's last test does for the canary (CALL-02-AC11): git
tracks at least one `.yaml` file under `apps/mobile/e2e/`, and every file git
tracks there belongs to `@bvst @urso-agent` under last-match and is covered
by the `safety` filter. A typo in its CODEOWNERS line or filter entry fails in
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
  (L5, `phone.test.ts`, `expo-intent-launcher` and `Linking` mocked)
- **And** on the emulator, Telecom's record (`dumpsys telecom`) shows one
  outgoing call to that number, placed with no second tap (L7, read as SPIKE-01
  read it)
- **And** a second tap before the first `callNumber` has settled, and before
  the app has come back to the foreground, records no second call; a tap after
  either calls again (L5)
- **And** `callNumber` given `110`, `112` or `113` opens `tel:` with that number
  through `Linking.openURL` and never starts `ACTION_CALL`, with the permission
  granted and without (L5, `phone.test.ts`)
- **And** `phone.ts` reduces the number itself (approach 2): `callNumber` given
  each of the three written with spaces between the digits, with dashes
  between them, with a leading `+47` (with and without a space after it), and
  with a leading `0047`, opens `tel:` with the three digits alone through
  `Linking.openURL` and never starts `ACTION_CALL`, with the permission
  granted and without; and given numbers that do not reduce to one of the
  three (the fixtures' eight-digit numbers, among them one shaped `ddd112dd`;
  `47` followed by one of the three, with no `+`; one of the three followed by
  a digit), it starts `ACTION_CALL` as above (L5, `phone.test.ts`, which does
  not import `features/grp/first-contact.ts` and passes the numbers in as
  written, so the check cannot lean on GRP-02's normalisation).

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
- **And** with no #1 set, the line does not show.

**CALL-01-AC5 — A call the phone cannot start is said, with the number.** (L5)
- **Given** the phone module's `callNumber` rejects (with the permission it
  tries `ACTION_CALL` and then the dialer; without, the dialer alone)
- **When** the call button is tapped
- **Then** "Telefonen kunne ikke starte samtalen. Ring {number} selv." shows,
  with #1's normalised number, in an element with
  `accessibilityLiveRegion="assertive"` so it is read out when it appears
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
  repository with the rule in place.

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
  and the `accessibilityHint` "Ringer " followed by #1's number with its
  characters separated by single spaces (L5)
- **And** its text sets no `numberOfLines` and no `allowFontScaling={false}`
  (L5)
- **And** with Android's font size at the largest the emulator image's
  Settings offer (set by the script with `settings put system font_scale`
  before the flow, reset after, and the value printed in the job log), the call
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
- CALL-02-AC10 holds the same for `apps/mobile/src/shared/ui/`, and
  CALL-02-AC11 for `apps/mobile/e2e/`, in the same step-1 pull request.

## Test plan

| Level | Where | Criteria | Runs here? |
|---|---|---|---|
| L1 static | the new dependency-cruiser rule, with fixture tests in `packages/config/` beside LOST-02-AC25's; ESLint | AC6 (imports) | Yes |
| L5 app | `features/call/call.test.tsx` (the whole app through Expo Router's testing library, the phone module faked with a recording fake whose answers are set per test; `AppState` driven for the foreground check); `features/call/phone.test.ts` (the module's own choices: `ACTION_CALL` with the permission, the dialer without, the fallback when `ACTION_CALL` rejects, 110/112/113 to the dialer, written plainly and with spaces, dashes, `+47` or `0047`, the permission's answers, with `expo-intent-launcher`, `PermissionsAndroid` and `Linking` mocked) | AC1 to AC8 | Yes |
| L7 Android | Maestro, `apps/mobile/e2e/`: grant through Android's own dialog (tapped by its resource ID); tap and read Telecom's record; revoke with `adb shell pm revoke`, relaunch, see the line, tap, see the dialer and no call; at the largest font size, the button visible | AC2, AC3, AC4, AC8 | **No**: CI's `android-e2e` |
| Gate tests | `scripts/lib/merge-rules.test.mjs`, `scripts/gate.test.mjs` | AC9, and CALL-02-AC10 and AC11 beside it (step 1's part in step 1's pull request; the tracked-file part in task 2's, but for `e2e/`, which step 1 pins itself) | Yes |
| L7 iOS; L9 | none | — | Task 12, and a real iPhone (D-037) |

**L7 reads Telecom's record** (`adb shell dumpsys telecom`), as SPIKE-01's S6
drivers did, because Maestro cannot see a call. That reading, the permission
revoke, the font size and ending the emulated call belong in
`scripts/e2e-android.mjs` or a helper it runs (owned paths), and the readers get
tests in `scripts/lib/`, as S6's did. The flows themselves, in
`apps/mobile/e2e/`, are owned and safety-reviewed from step 1 on
(CALL-02-AC11). The emulator has no real network; a call
there reaches no one. The number dialled is from a range reserved for fiction.

**What this cloud session cannot verify:** any call (no emulator; CI's
`android-e2e`); iOS at all; a real phone's dialer, which may differ from the
emulator's; whether text is clipped on a real screen (jest has no layout, and
Maestro reads text, not pixels); gloves.

## Modules and files affected

**Step 1 (its own pull request), for the three folders:** `.github/CODEOWNERS`,
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

**Who reviews what, after step 1:** `features/call/`, `shared/ui/` and
`apps/mobile/e2e/` are code-owner and safety-review paths (`shared/ui/` holds
`Screen`, CALL-02; `e2e/` holds the L7 flows of AC2, AC3, AC4 and AC8).
`features/grp/home-screen.tsx` and `features/grp/first-contact.ts` stay
unowned. That is acceptable because neither can now take away a call path
unseen: the 112 bar is drawn by `Screen`, and the call button's size, its
calls and the emergency rule are in `features/call/`; the tests that would
fail if `home-screen.tsx` dropped either button (AC1, CALL-02-AC1) live in
`features/call/` and `shared/ui/`, both owned; and `phone.ts` checks for 110,
112 and 113 itself (approach 2). What stays unowned is what #1 is and how it
is shown (GRP-02), which the walker sees on the home screen.

**Config (owned):** `packages/config/dependency-cruiser.cjs` (the new rule)
and its fixture tests.

**Scripts (owned):** `scripts/e2e-android.mjs` and a tested reader for
Telecom's record; the font-size step; task 2's tracked-file pins for
`features/call/` (AC9) and `shared/ui/` (CALL-02-AC10).

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
  - *A #1 who is 110, 112 or 113:* never given to `ACTION_CALL`, whose
    documented rule excludes emergency numbers; the dialer opens (AC2).
    `phone.ts` recognises the three however they are written, with spaces,
    dashes, `+47` or `0047`, without relying on `first-contact.ts`
    (approach 2). Another country's emergency number as #1 (other than 112
    itself) is not recognised and goes to `ACTION_CALL`; what Android does
    then is undocumented. A refusal reaches the dialer through the fallback,
    but a silent no-op would not. Accepted as unlikely for a walker in Norway;
    not observable before L9.
- **The 112 bar or the call button removed by a change outside
  `features/call/`.** `Screen` draws the bar on every screen, from
  `shared/ui/`; after step 1 that folder needs the owner and
  `safety-reviewer` too (CALL-02-AC10), and task 2's test that every route is
  drawn through `Screen` (CALL-02-AC1) catches a screen added later without
  it. `home-screen.tsx` and `first-contact.ts` stay unowned ("Modules and
  files affected" says why that is acceptable).
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
- **The L7 flows changed unseen.** `apps/mobile/e2e/` holds the only
  end-to-end proof that a tap places the call (AC2) and that 112 opens the
  dialer (CALL-02-AC3), and the rule never to tap call in the dialer. After
  step 1 a change to them needs the owner and `safety-reviewer`
  (CALL-02-AC11). The scripts that drive them were owned already.
- **The step-1 lines for `features/call/` and `shared/ui/` match nothing until
  task 2 merges.** A misspelt path would not show until then; task 2's
  tracked-file pins (AC9, CALL-02-AC10) are what catch it. `e2e/`'s line is
  pinned against its tracked flows in step 1 itself (CALL-02-AC11).
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
