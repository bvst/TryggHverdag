---
name: task2-home-screen
description: What the M3 task 2 review (home screen, call button, 112 bar, dark palette; GRP-02, CALL-01, CALL-02) found at cff3021, which GRP-01 points it closed, and the patterns to check on the journey and alert screens.
metadata:
  type: project
---

M3 task 2 reviewed at cff3021 (main 50214c0), advisory (D-043): PASS with should-fix
items. jest 645 of 645 re-run here (`pnpm exec jest` in apps/mobile, about 75 s);
not run: Maestro/L7 (CI only), any device, TalkBack, a Norwegian TTS.

Closed from GRP-01 (do not re-flag): S1 dark-first (palette.ts, Screen background,
StatusBar light-content), 112 on every screen (the route draws `Screen`; GRP-01's
views are fragments), visible field labels, every `Text` has a palette colour.

Checked and good, so do not redo from scratch:
- Sizes from source: call button minHeight 120 and stretches; 112 64x96; every
  Button/TextField 56; bar paddingBottom 24 plus content padding 24; no
  numberOfLines, allowFontScaling or maxFontSizeMultiplier anywhere in src.
- Palette ratios (computed in node, WCAG 2): text 17.4, accent/bg 11.7, onAccent
  on accent 11.7, white on 112 red 8.1, field edge 6.0, 112 red fill alone vs bg
  only 2.4 (carried by the 2 dp white border, 19.5). Pressed (opacity .7) stays
  above 4.5 for 112; disabled (.5) text is 3.7, exempt.
- nb and en: 57 and 57 keys, placeholders equal, no CALL-01-AC7 word under
  `call.` or `grp.firstContact.`, no "på nytt" under `grp.`. The new bokmål reads
  naturally; only "Vi fikk ikke lest hvem du skal ringe" is a little stiff
  (spec-asserted text; "Vi klarte ikke å lese ..." is the smoother option).

Findings (all should-fix, none blocking), for reuse as patterns:
- **`userInterfaceStyle: 'dark'` does nothing on Android without `expo-system-ui`**
  (`@expo/config-types` ExpoConfig.d.ts lines 56 and 495 say so); the package is
  not installed and `app.config.ts` claims "the system's own pieces are drawn
  dark too". CALL-02 approach 5 asked the implementer to check the navigation bar
  and set it light; not done. New dependency, so D-139 owner approval.
- **A hint that carries essential information**: the explaining call button
  (none/unreadable) puts "Vi fikk ikke lest ..." only in `accessibilityHint`, and
  the label overrides the child Text; TalkBack can switch hints off. The call
  button's hint says "Ringer {nr}" even when CALL_PHONE is missing and the tap only
  opens the dialer (the truth is in a line below the button).
- **Numbers in live-region messages are not spelled**: `call.button.failed` shows
  the digits as one string; the shown number and the hint are spelled digit by
  digit (GRP-02-AC10), the one message where the walker must dial by hand is not.
- **ErrorFallback's `Message` is polite**, a crash that replaces the screen should
  be assertive.
- **View changes inside one route** (home to setup, invite, members): CALL-02
  approach 1 says "keyed by view, so each view starts at the top of the scroll";
  nothing is keyed and the ScrollView lives in `Screen`, so the scroll offset
  stays; and no focus move or announcement of the new view's heading. Reasoned.
- **Setup with the keyboard up**: 112 is fine (fixed bar outside the ScrollView,
  Expo's default adjustResize; L7 asserts it). But Lagre can sit under/below the
  keyboard (first-contact.yaml calls hideKeyboard before tapping it) and the
  validation `Message` is rendered after Lagre. Fix: Keyboard.dismiss on Lagre,
  or messages above the button.
- "112" in a label is likely read "hundre og tolv" by Norwegian TTS; "1 1 2" in
  the label (visible text stays "112") is the owner-level fix (spec asserts text).
- `autoComplete="tel"` / `textContentType="telephoneNumber"` on #1's number field
  invite autofill of the walker's OWN number (spec-mandated). Reasoned.

Still open from GRP-01, check on later screens: `Waiting` has no live region;
content that appears above the focused control is not announced; the members
screen's confirmation sits after the list and the 112 bar now takes about 100 dp
of the viewport; the unreachable line sits under the call button and does not say
calling still works.

Method that worked: a 20-line node script for contrast and one for flattened key
parity, forbidden words and placeholders (kept in the scratchpad, not the repo).
