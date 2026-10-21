---
name: grp01-first-real-screens
description: What the GRP-01 review (a11y, night use, bokmål/English) found on the app's first real screens, and the patterns to look for on later screens (task 2's home, journey, alert screens).
metadata:
  type: project
---

GRP-01 (`apps/mobile/src/features/grp/`, `ui.tsx` is the shared kit) is the first
real UI. Reviewed at a5fd8cf, advisory (D-043), verdict PASS with should-fix items.

What was already good, so do not re-flag it: every `Button` is a `Pressable` with
`role="button"`, `accessibilityLabel`, `accessibilityState`, `minHeight: 56`, full
width, gaps 12-16; `TextField` has `accessibilityLabel`; headings have
`accessibilityRole="header"`; text scales (sp, minHeight, ScrollView, no
`maxFontSizeMultiplier`); nb and en have the same 27 keys and placeholders
(check with a small node script over flattened keys); i18n has
`escapeValue: false`, so names with `&` or `'` render right; Crockford base32
codes have no I, L, O or U, so O/0 and I/1 cannot be confused in a generated code
and the server normaliser maps O to 0 and I, L to 1 on input.

Recurring patterns to check on every later screen:

- **Dark-first is not built.** `ui.tsx` hard-codes `#1f4e79` (button fill, quiet
  button text and border) and `#5a5a5a` (field border), sets no screen background
  and no text colour, and `app.config.ts` has no `userInterfaceStyle` (Expo
  defaults to `light`; `expo-system-ui` is not installed; verified in
  `@expo/config-types`). `#1f4e79` on black is 2.4:1. INF-06's spec deferred
  "dark mode, status-bar contrast and SafeAreaProvider for the real home screen";
  the real home is M3 task 2 (GRP-02, CALL-01, CALL-02). GRP-01's spec is silent.
  Judged should-fix, not block, because the roadmap gives the home screen to
  task 2. **Block at task 2 if the home screen is still light-only.**
- **112 (CALL-02) is not on GRP-01's member screen.** Belongs to task 2
  (roadmap row 2). Invite and members screens are neither home nor journey.
- **Placeholder used as the only visible label** (`ui.tsx` TextField): the label
  vanishes once text is typed, placeholder colour is the unset platform default.
- **Content that appears above the focused control is not announced** (the new
  invitation code appears above "Lag en invitasjon"). Only `Message` has a live
  region (Android only; iOS needs `announceForAccessibility`, task 12).
- **Confirmation placed after a list** (members screen): other Remove buttons
  vanish and the confirm block is below the fold with more than about 4 members.
- **Long codes wrap by Unicode line-breaking rules**: a hyphen before a digit is
  not a break opportunity, so a code shown as one `Text` can break mid-group.
  Reasoned, not seen on a device.
- **Busy state is only a dimmed button**, with a 20 s timeout in `client.ts`.
- **Error copy reused across causes**: a local secure-storage failure shows
  "Vi fikk ikke kontakt med serveren". Check each message is true for every path
  that shows it.
- **Copy that stops being true later**: "telefonen deres logges ut" is not true
  for a removed member who is walking (AC21: signed out when the walk ends).
  "deres" for one person reads as plural or formal; use the name or "vedkommende".
- Wording drift: "Prøv igjen" / "Prøv på nytt", en "Try again" / "Try once more".

## Loop 2 delta review (3fac8fb..879096f): PASS, S1 and S2 met

Checked by reading the diff, running `pnpm exec jest src/features/grp` in
`apps/mobile` (100 tests) and `pnpm exec vitest run scripts/lib/e2e-android.test.mjs`
(149); not run: Maestro/L7 (CI only), any device.

- The code's label and announcement are now "Invitasjonskode: K 7 Q 2 M, …"
  (`named()` in `invite-screen.tsx`, key `grp.join.codeLabel`, nb and en keys
  still 31 and 31). The ": " is hard-coded punctuation, fine for nb and en.
- RN 0.86.3 `ActivityIndicator` puts `accessible`, role and label on the native
  indicator inside a plain wrapper View (`style` goes on the wrapper). So
  `accessible` on `Waiting` does reach the element a screen reader focuses.
- Still true after loop 2, check on every later screen: `Waiting` has no live
  region, so a screen-reader user is not told when it appears; focus stays on the
  pressed button, and the indicator is only reached by swiping. A one-line
  `accessibilityLiveRegion="polite"` would announce it on Android (iOS is task 12).
- When a busy indicator lives inside a conditional block (the removal's
  confirmation), anything that closes the block mid-flight makes the indicator
  vanish, so `disabled={busy}` on the block's buttons becomes load-bearing for
  AC30. grp.test.tsx pins no `disabled` and never touches the cancel button
  (grep `disabled|cancel` finds only the translation-key list). Look for this
  whenever an indicator is moved into a block.
- A removal that gets no answer (5xx, network) is said after the list
  (`members-screen.tsx`, the `failed` block), not in the member's row as a
  refusal is; and its "Prøv igjen" reloads the list, it does not repeat the
  removal. Pre-existing from loop 1, outside the delta; reasoned, not seen.
- A new in-flight indicator below two 56 pt buttons is about 130 pt below the
  confirm button's top: on a screen where the confirm sits at the fold, the
  dimmed buttons are the only sighted cue. Reasoned from the layout.
