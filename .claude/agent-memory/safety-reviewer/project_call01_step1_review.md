---
name: call01-step1-review
description: CALL-01-AC9 step 1 (side branch claude/busy-faraday-40n2zl-ai-review, D-141 item 7) — PASS cb9fbd3; features/call/ owned + safety filter; open: shared/ui Screen (carries the 112 bar) and features/grp home/first-contact unowned, Claude Code version comment stale
metadata:
  type: project
---

PASS at cb9fbd3 (2026-10-22), session review (D-075, edits ai-review.yml).
Verified: worktree of the branch in scratchpad (node_modules symlinked): gate/merge-rules/ai-review tests
334/334; at d308a4c 5 red + 2 guards green. GitHub `codeowners/errors?ref=<branch>` = []. Last match for
features/call/** is CODEOWNERS L84 (nothing later matches). Action SHA = refs/tags/v1.0.254^{} (ls-remote);
`git fetch --depth 1` of both action SHAs: v1.0.254 installs Claude Code 2.1.304 (was 2.1.301), the only change.
Should-fix given:
- ai-review.yml ~L208 and header comments in scripts/ai-review.test.mjs, scripts/ci-models.test.mjs still say
  "2.1.301 at v1.0.251" (same pattern as REL-10 step 1's Dependabot #62).
- CALL-02 spec: `Screen` in src/shared/ui/ renders EmergencyBar unconditionally (the "every screen" guarantee)
  -> unowned, not in safety filter. no-circular (depcruise) + shared/ui <-> call/index cycle may push the bar into
  shared/ui. features/grp/first-contact.ts (normaliser feeding phone.ts's 110/112/113 guard), home-screen.tsx
  (no-wait-for-server) unowned. Owning them later needs the safety filter (BUG-10 general test) -> another
  hand-merged PR (D-075), so the owner should decide before task 2. phone.ts guard should normalise itself.
- SAFETY_PATHS exclusion correct: an app path there today would run Vitest whole-suite Stryker (no jest runner)
  -> nothing killed / measured nothing (D-099). Spec cites F6 for "call not placed"; F6 is "alert not noticed".
Related: [[rel10-canary-filter-review]], [[grp01-review]], [[unowned-gate-configs]].

**Delta PASS at 18007c2 (2026-10-22)**, `git diff cb9fbd3 18007c2`: shared/ui/ (CALL-02-AC10) and e2e/ (CALL-02-AC11)
in CODEOWNERS (L86, L89; nothing later matches), OWNER_APPROVAL_PATHS, safety filter; --model comment fixed (no
2.1.301/v1.0.251 left outside docs). Worktree at 84fc01e: 5 red; at 18007c2 4 files 353/353. GitHub codeowners/errors
on branch = []. The 3 e2e flows read: no tel:, 112, dialer or call step (only join/invite taps).
Should-fixes given (task 2 specs, session branch claude/busy-faraday-40n2zl):
- phone.ts reduction keeps ASCII digits only, but sends the raw/stored string to ACTION_CALL: if unowned
  first-contact.ts is ever loosened, `112,5` / `11A` / Unicode digits / `*31#112` reduce to non-emergency while
  Android's own parse (network portion, keypad letters, Character.digit) sees 112. Fix: anything not `^\+?[0-9]+$`
  after its own separators goes to the dialer; build tel: from phone.ts's cleaned string.
- emergency set lacks 911 (3GPP TS 22.101: 112 + 911 always emergency on every handset); no-SIM list 000/08/110/118/
  119/999. AC2 pins "one of three followed by a digit -> ACTION_CALL" (1120): prefix-matching Telecom may intercept.
- _layout.tsx (unowned): Slot replacement is caught by route pin only if the render uses the real _layout; a sibling
  overlay/Modal or an ErrorBoundary fallback is caught by nothing (AC2 checks ancestors only). Screens drawn inside a
  route by unowned grp code (new states) escape the fixed AC1 state list. Suggested: ESLint no-restricted-imports
  (Modal, SafeAreaView, ScrollView outside shared/ui), "every host element inside Screen" assertion, ErrorBoundary on
  Screen, owner question on owning src/app/.
- Notes: translations nb/en.json and apps/mobile/tsconfig.json unowned (label text; @ts-expect-error vacuous if excluded).

**Delta PASS at 4581520 (2026-10-22)**, `git diff 18007c2 4581520`: src/app/ (CALL-02-AC12) in CODEOWNERS L92 (nothing
later matches), OWNER_APPROVAL_PATHS, safety filter; 3 gate files 359/359 at head (red at 52f21f4 not re-run by me).
GitHub codeowners/errors on branch = []. Specs at 914a72f closed my three points (phone.ts cleans + builds tel: from the
cleaned string, ^\+?[0-9]+$ else dialer; set 112/911/110/113/000/08/118/119/999, prefix for 110/112/113/118/119/000 only;
real-_layout render + host-element check + ESLint Modal/SafeAreaView/ScrollView + ErrorBoundary AC13 + English AC6).
Narrowing for 911/999/08 accepted: a missed match goes to ACTION_CALL, which AOSP Telecom turns into the dialer for a
potential emergency number (from memory, unverified on a device).
VERIFIED in node_modules: expo-router 57.0.23 build/useScreens.js fromImport wraps the LAYOUT COMPONENT in
Try(catch=ErrorBoundary), so _layout's ErrorBoundary catches layout/provider errors too, but its fallback renders OUTSIDE
I18nextProvider and GroupSessionProvider. App i18n = i18next.createInstance(), no initReactI18next, so useTranslation
there returns raw keys (react-i18next 17 notReadyT). AC13's label assertion would catch it for a route throw.
Should-fixes given: spec's "crash outside the route" risk is now answerable (it IS caught) -> add AC13 case for a
provider throw, fallback supplies its own I18nextProvider, uses no session hook; Screen must clip children (absolute
overlay inside Screen passes AC1's host check and AC2's ancestor check); new in-route grp states without Screen still
unpinned (option: owned route files render Screen); Alert not in the restricted list; `+0047112` reduces to 0047112
(order: + then 0047) -> ACTION_CALL (harmless, not emergency to Android); bidi marks (U+200E) -> dialer.
