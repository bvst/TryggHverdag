---
name: inf06-placeholder-screen
description: How the INF-06 app-skeleton placeholder screen was judged on dark mode, status bar contrast, and CALL-02 — reference for later app-skeleton or early-screen reviews.
metadata:
  type: project
---

INF-06 (`apps/mobile/src/app/index.tsx`, `_layout.tsx`,
`shared/translations/{nb,en}.json`) is a single placeholder screen: a heading
(`accessibilityRole="header"`) with the app's working title, and one static
status line saying the app is under development. No buttons, no navigation,
no interactive elements at all.

Findings from that review, for reuse:

- **No dark-mode / `userInterfaceStyle` support, no `expo-status-bar`
  dependency, no explicit status-bar style anywhere.** The screen is
  permanently light (default RN black-on-white), regardless of the device's
  system theme. This is a real gap against the product's "dark-first design
  for night use" goal (`docs/plan/01b-mvp-scope.md` line ~192), but
  `docs/specs/INF-06.md`'s own "Out of scope" section explicitly names
  "Nynorsk, dark-first design and a UI kit" as deferred, and says the
  placeholder "is not the product's home screen, and no one outside the
  emulators ever sees it." Given that explicit scoping, judged **non-blocking,
  should-fix-later** rather than a BLOCK.

  **Why:** dark-first is real (CALL-02/mvp-scope), so it must not be
  forgotten — but penalizing a task for not doing work its own reviewed spec
  said it would not do is exactly the "rules haven't run yet" trap, not a
  real violation.

  **How to apply:** when a future spec explicitly scopes out an a11y/i18n
  checklist item (dark-first, 112 visibility, etc.) with a stated reason
  (not just silence), don't BLOCK on that item's absence — note it as a
  tracked follow-up instead. Do check whether a *later* spec that claims to
  build the real home/journey screen still lacks it; that is the point to
  block.

- **CALL-02 (112 visibility) does not apply to a skeleton/placeholder
  screen.** `docs/plan/01b-mvp-scope.md` CALL-02 text says "the home screen
  and the journey screen always show a 112 button" — a placeholder that is
  neither is out of scope by the requirement's own wording, and INF-06's spec
  says so explicitly (112 is its own M3 story). Don't flag missing 112 on a
  screen that isn't the home or journey screen.

- **Status-bar icon contrast on a light screen** (implementer-flagged): with
  no `expo-status-bar` and no theming, status-bar icon color is left to OS
  defaults, which can mismatch a plain white background (e.g. under
  Android 15 edge-to-edge). Judged a minor, non-blocking polish note for a
  screen no real user sees — worth fixing when the real (dark-first) home
  screen is built, not for a throwaway skeleton screen.

- **No touch-target / screen-reader-label findings apply when a screen has
  zero interactive elements** — don't invent findings for checklist items
  that have nothing to check; say "N/A, no interactive elements" instead.

See [[feedback_scope_vs_missing_approval]] for the general principle this
generalizes from (spec-scoped absence is not a rule violation).
