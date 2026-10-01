---
name: store01-critical-alerts-review
description: STORE-01 (Critical Alerts request to Apple, docs only) reviewed 2026-10-01 at ca72239 — PASS with should-fixes; the open items, and checks that apply to any later store or claims document
metadata:
  type: project
---

Branch feat/STORE-01-critical-alerts-request, HEAD ca72239, run by hand (docs-only; ai-review's `safety`
filter does not match docs/). PASS. Should-fixes left open, to check on any loop 2 or the PR that updates Part A
before sending (Part D step 4):
- Part A ans. 3 / Part B C5 / spec C5: "alert will still go out when the phone is ... taken". Contradicts F10 (the
  taker can tap "I'm home") and a taken phone that keeps reporting raises nothing. LOST-02 says only
  "off, broken or out of coverage"; "taken" came from D-007's context line.
- SM-02's "no responder left" warning is promised to Apple as never critical. It is the one walker-facing notice
  whose miss is fail-SILENT (no responder left, so a later silence alerts nobody). REL-04 reminder and LOST-05
  offline are fail-safe (the lost-contact alert follows). Q1's options never named it. Fix: the owner confirms
  it explicitly in Q1's decision; SM-02's spec makes the state loud on the journey screen.
- Part E item 6 says "L2 or L6"; a level change is alert behaviour, so it needs L6. The test should cover every
  outbox message type, so a notice added later (SEC-01, M4) cannot pick up the critical level.
- "once per lost-contact event" must not be implemented as at-most-once delivery (AR-05 retries); collapse
  duplicates instead.
- Readiness: re-read at app start and foreground (critical can be switched off in Settings); Time Sensitive-only
  responders shown as not sounding on silent; what iOS does with a critical push to a device that has not
  authorised critical is "to verify". Late approval (M5/M6) means existing responders must re-enter setup.
- AC10 forces "M3 or M4" on Part E item 7, but L9 is M5 (roadmap). Spec never-say #9 says "the two numbers";
  Part A also uses 24 hours (SM-06, not a ⚙️, so acceptable).

**Why:** Apple approves on Part A's promises; a later product change has to keep them or go back to Apple.
**How to apply:** for any claims document (App Store notes, privacy notice, store listing in M5), check each
capability claim against the F1–F10 "known limitation" rows, and sort every never-loud notice by whether a
missed one ends in a false alarm (fine) or in no alert at all (raise it). See [[unowned-gate-configs]].
