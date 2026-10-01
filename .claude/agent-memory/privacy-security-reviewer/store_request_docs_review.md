---
name: store-request-docs-review
description: Docs-only drafts sent to Apple/Google (entitlement requests, store/review notes) — where placeholders leak later, and which privacy promises need a test listed
metadata:
  type: feedback
---

First seen on STORE-01 (2026-10-01): a Critical Alerts request draft in `docs/plan/` plus the owner's steps for sending it. It verdicted PASS. The files were clean, and the findings were about the process around them.

**Why:** the text itself used only placeholders. The leaks were in the steps that come later:
- The header said the identifiers are filled in "in Apple's form only, never in this repository". But a later step records them with `/decision`, and they must land in `app.config.ts` anyway. Q3's rule (the AS's own domain, reversed) therefore puts the AS's domain into the public repository.
- "Record Apple's answer as a decision" did not say to leave out the email itself. Apple's reply names the account holder, and this project tends to quote its sources verbatim.
- The forward test list (Part E) covered the safety promises made to Apple but not the privacy ones: a content-free payload, and APNs direct with no Expo push token or FCM on iOS.

**How to apply:**
- Scan without `>`: mask digit groups with `sed -E 's/[0-9]/#/g'`. Grep `-o` for domains, `[A-Z][a-z]+ (AS|ASA|ENK)`, handles and `~/` paths. List every `\[[^]]+\]` placeholder.
- Check "never in this repository" statements against every later step that writes a value (`/decision`, `app.config.ts`, README rows).
- Check that "record the outcome" steps exclude vendor emails, names and case numbers.
- Push claims to Apple are iOS-scoped. FCM brings Firebase into Android only (D-086), so "no analytics SDKs" holds only while Android links firebase-messaging alone.
- Rank process gaps in owner steps as Should fix. BLOCK only for real data in the file or a claim that contradicts the PRIV rules or D-086.

Related: [[device-harness-review]], [[mobile-release-review]], [[reviewer-sandbox-quirks]]
