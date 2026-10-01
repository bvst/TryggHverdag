---
name: store01-critical-alerts-review
description: STORE-01 (Critical Alerts request to Apple, docs only) — PASS at ca72239 and loop 2 PASS at 44b85b8 (2026-10-01); what is still open, and checks that apply to any later store or claims document
metadata:
  type: project
---

Branch feat/STORE-01-critical-alerts-request. Docs only, so it is run by hand (ai-review's `safety` filter
does not match docs/).

**Loop 1, ca72239: PASS, six should-fixes.** All six were closed at 44b85b8 (loop 2, PASS):
- "or taken" was removed from Part A ans. 3, C5 and the spec. F10: a taken phone that keeps reporting raises
  nothing.
- The owner's Q4 answer was "Non-critical; loud in-app" for SM-02's no-responder warning. That is the one
  walker-facing notice whose miss is fail-SILENT. It is recorded as spec R15, a Part E flag and the step-8 decision.
- Part E item 6 is now L6 over every outbox type, plus L2. "Once per event" is collapsed by a collapse ID, never
  done by skipping a retry. Readiness is re-read on start and on foreground. Late approval offers setup again.

**Open after loop 2.** These are should-fixes for M3's specs or for plan-keeper at step 8:
- Item 6's "only lost-contact is critical" test is server-side, over the outbox. It cannot hold Part A's
  "never" for notifications the app schedules itself: the REL-04 local reminder, and possibly LOST-05/REL-09.
  A walker who is also someone's responder has granted critical, so a slip would really sound. This needs an L1
  rule or an L2 test on the app side.
- The "exactly one per responder per event" carriers were REL-07, LOST-07 and AR-05. Two problems: AR is not a
  tracked prefix, and LOST-02, which writes the push, is missing. The L6 test should also run the watchdog twice
  (AR-06), duplicate events (SM-08), SM-10's resumed escalation, and past the 2-minute SMS.
- "described below" in ans. 2, and "walker"/"responders" defined only in ans. 1, still tie the answers together.
  This is wording, not safety.

**Why:** Apple approves on Part A's promises. A later product change has to keep them, or go back to Apple.

**How to apply:** for any claims document (App Store notes, the privacy notice, the M5 store listing):
- Check each capability claim against the "known limitation" rows of F1–F10.
- Sort every notice that is never loud: does a missed one end in a false alarm (fine), or in no alert at all
  (raise it)?
- For each promised "never/only" test, ask whether the named level reaches every path that could break the
  promise: server outbox vs app-local notifications, and watchdog reruns vs state-machine re-entries.
- Check that the carriers named are tracked IDs (scripts/lib/requirements.mjs SOURCES). See [[unowned-gate-configs]].
