---
name: store-request-docs-review
description: Docs-only drafts sent to Apple/Google (entitlement requests, store/review notes) — where placeholders leak later, which privacy promises need a test listed, and push side channels (headers, other notices)
metadata:
  type: feedback
---

First seen on STORE-01 (2026-10-01): a Critical Alerts request draft in `docs/plan/` plus the owner's steps for sending it. It verdicted PASS. The files were clean, and the findings were about the process around them. A re-check at `44b85b8` the same day was PASS again. All three earlier should-fixes were handled, and the new findings below came from reading the sources the claims cite.

**Why:** the text itself used only placeholders. The leaks were in the steps that come later:
- The header said the identifiers are filled in "in Apple's form only, never in this repository". But a later step records them with `/decision`, and they must land in `app.config.ts` anyway. Q3's rule (the AS's own domain, reversed) therefore puts the AS's domain into the public repository.
- "Record Apple's answer as a decision" did not say to leave out the email itself. Apple's reply names the account holder, and this project tends to quote its sources verbatim.
- The forward test list (Part E) covered the safety promises made to Apple but not the privacy ones: a content-free payload, and APNs direct with no Expo push token or FCM on iOS.
- Re-check: "push carries no name" was true for the alert, but CALL-03 (`01b-mvp-scope.md`) specifies the call notice text as "<name> is calling you…". D-086 binds every push to be content-free. Nothing in the plan says how that name reaches the screen; finding 4 gives the options (fetch from the server, or encrypt and use a notification service extension).
- Re-check: a "collapse ID" added for duplicate pushes is an APNs header. A payload-only test misses it, and a collapse ID shared across responders lets Apple link them.
- Re-check: a video rule saying "synthetic names and positions" left out phone numbers. iOS's call confirmation shows the number.

**How to apply:**
- Scan without `>`: mask digit groups with `sed -E 's/[0-9]/#/g'`. Grep `-o` for domains, `[A-Z][a-z]+ (AS|ASA|ENK)`, handles and `~/` paths. List every `\[[^]]+\]` placeholder. Do not put `====` in `echo` (zsh `=` expansion errors).
- Check "never in this repository" statements against every later step that writes a value (`/decision`, `app.config.ts`, README rows).
- Check that "record the outcome" steps exclude vendor emails, names and case numbers.
- Push claims to Apple are iOS-scoped. FCM brings Firebase into Android only (D-086), so "no analytics SDKs" holds only while Android links firebase-messaging alone.
- For any "push carries no personal data" claim, check every other notice the same text names (CALL-03's) and APNs headers (collapse ID, apns-id), not just the payload.
- Any "synthetic data" rule for screenshots or videos must cover names, phone numbers and positions.
- Rank process gaps in owner steps as Should fix. BLOCK only for real data in the file or a claim that contradicts the PRIV rules or D-086.

Related: [[device-harness-review]], [[mobile-release-review]], [[reviewer-sandbox-quirks]]
