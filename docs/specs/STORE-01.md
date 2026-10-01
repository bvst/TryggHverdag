# STORE-01 · Critical Alerts entitlement request drafted

**Status:** 📝 Spec written. The owner answered Q1 to Q3 on 2026-10-01: only
the lost-contact alert; production and a test build; identifiers fixed at
sending, name-neutral · **Milestone:** M1 · **Branch:**
`feat/STORE-01-critical-alerts-request`, from `main` at `f46660c` ·
**Written:** 2026-10-01

## Requirement

From `docs/plan/10-roadmap.md`, M1's row:

> | **M1** | Spike (emulators and simulators) | SPIKE-01, S1–S7 on emulators and
> simulators (D-037); location SDK in debug mode; Critical Alerts request drafted
> (STORE-01) | Spike results recorded; SDK go/no-go decision; Section 4 closed |

and, from M4's row, the item that stays the latest point for sending it:

> … Critical Alerts entitlement requested

From `docs/progress/m1.md`, open item (d), answered by the owner on 2026-10-01:

> it gets an ID, **STORE-01**, and is drafted now, in M1. The owner sends it once
> A-02 exists; the roadmap's M4 "Critical Alerts entitlement requested" stays as
> the latest point.

From `docs/plan/decisions.md`, D-020. One story ID is replaced by its name in
square brackets; "How this spec names requirements" says why.

> **Decision:** Apply to Apple for the Critical Alerts entitlement as early as
> possible, with Time Sensitive as the fallback. On Android, use a high-priority
> alert channel that can override Do Not Disturb. Responders opt in during setup
> ([the responder-setup story]).

**So STORE-01 is a document:** the text of the request, ready for the owner to
paste into Apple's form, and the owner's steps for sending it. It is not the
sending, which needs A-02, and it changes no code.

### The plan text it rests on

- **The alert-level rule** (`03-safety-reliability-security.md`, binding under
  D-022):
  > Lost-contact and SOS-related alerts to responders use the strongest
  > notification level the platform and the responder allow (Critical Alerts on
  > iOS if approved, else Time Sensitive; a high-priority channel on Android).
- **The responder-setup story** (`01b-mvp-scope.md`, added by D-020; one ID
  replaced):
  > Setup asks for Critical Alerts on iPhone (if Apple grants the entitlement;
  > otherwise Time Sensitive), and for the high-priority alert channel with
  > permission to override Do Not Disturb on Android. The responder confirms the
  > phone number used for SMS escalation ([the SMS-escalation story]). Each
  > responder has an "alert readiness" status. When choosing responders, the
  > walker sees who can't receive break-through alerts.
- **"Apply early"** (`03-safety-reliability-security.md`, finding 3):
  > Apply for Apple's Critical Alerts entitlement early. It is a genuine safety
  > use, but approval isn't guaranteed, so Time Sensitive is the fallback.
- **Finding 10** (`04-tech-stack.md`), "Critical Alerts: approval takes time and
  is tied to the app ID". Its sources are two threads on Apple's developer
  forum, not Apple's documentation:
  > On Apple's forum it is stated that the entitlement won't be granted purely
  > for demos. Some developers wait weeks for an answer, and one was first
  > refused and then approved on a narrower request. … The entitlement is granted
  > to a specific app ID on a specific developer team. One developer reports it
  > did not follow the app when it was transferred to a new account (same
  > source).
- **D-027:** the Apple account is the AS's organisation account, and "No later
  app transfer, so no second Critical Alerts request." Finding 12 of
  `04-tech-stack.md` lists what the enrolment needs: a D-U-N-S number, the
  enroller's authority to bind the company, a work email on the company's
  domain, and a public website on that domain.
- **S5 on iOS** (`04b-spike-results.md`, part 3): the content-free alert was
  delivered and presented at the Time Sensitive level on the simulator.
  Critical Alerts were not shown, because they "need Apple's entitlement (its
  own M1 item, needing A-02)". Nothing was heard on either device; for the
  iPhone that is RR-01.
- **Content-free push.** D-086 accepted Section 4's default "Push: straight from
  our server to APNs and FCM, with content-free payloads". The design is
  `04-tech-stack.md` finding 4: "Push messages carry no personal data: 'Safety
  alert — open the app'. The app fetches the details from our EEA server."

### Decisions this spec builds on (binding)

| Decision | What it fixes for STORE-01 |
| -------- | -------------------------- |
| D-003 | The launch market is Norway |
| D-004 | A small private group first; iOS through TestFlight |
| D-007 | The lost-contact alert is decided on the server, because the phone may be dead or taken |
| D-008, D-013 | Responders are members of the private group, and all have the app |
| D-009 | The first group is friends and family, at least 12 people |
| D-014 | Bokmål first for **app text**. The request is not app text; it goes to Apple, whose form is in English |
| D-016, D-025 | Personal data stays in the EEA, on Clever Cloud |
| D-019 | An SMS to every responder if nobody acknowledges within 2 minutes |
| D-020 | Apply as early as possible; Time Sensitive as the fallback; responders opt in during setup |
| D-021 | Responders are alerted after 5 minutes of silence; changing it needs the owner |
| D-022 | The reliability rules and targets are binding, the false-alarm target among them |
| D-027 | The AS's organisation account holds the Apple account; no later app transfer, so no second request |
| D-033 | The state machine: entering lost contact opens one alert and pushes to the responders |
| D-037, D-041 | Nothing has been shown on a real phone; the real-device suite (L9) must pass before the group relies on the app |
| D-046 | Separate app variants per environment |
| D-057, D-081 | The public name is still open; Android's application ID is a placeholder until the first store upload |
| D-074 | Untracked IDs: the test-name prefix is practice, not an obligation |
| D-086 | Push straight to APNs and FCM with content-free payloads; M3 posts the Android alert with `CATEGORY_ALARM`. Its sources include the location SDK's licence, read 2026-09-30, whose clause 1.9 covers identifiers with development suffixes (Q3) |

**The owner's answers of 2026-10-01** (under "Answered", at the end) are binding
for this spec. Q1's and Q3's become decisions at step 8.

### What Apple says, as read on 2026-10-01

This planning session has no web access. The quotes below were read from Apple
on 2026-10-01 by the session that commissioned this spec, and are used exactly
as given. Nothing else in this spec is Apple's word.

- **The request form,**
  `https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement/`,
  is behind an Apple sign-in. **Its fields could not be read.** Every field is
  "to be verified when A-02 exists".
- **`UNAuthorizationOptions.criticalAlert`** (Apple developer documentation):
  "Critical alerts ignore the mute switch and Do Not Disturb; the system plays a
  critical alert's sound regardless of the device's mute or Do Not Disturb
  settings. You can specify a custom sound and volume. Critical alerts require a
  special entitlement issued by Apple."
- **The entitlement `com.apple.developer.usernotifications.critical-alerts`:**
  "An entitlement that permits an app to receive critical alert notifications.
  If your app has this entitlement, then it can request [criticalAlert]
  authorization to receive push notifications that cause the system to play a
  sound even when the app is locked, muted, or a person uses Do Not Disturb
  focus."
- **`UNNotificationInterruptionLevel.critical`:** "The system presents the
  notification immediately, lights up the screen, and bypasses the mute switch
  to play a sound. This interruption level requires an approved entitlement. The
  system always presents this notification, even when Do Not Disturb is
  active."
- **Human Interface Guidelines, "Managing notifications":**
  - "Critical: Urgent information about health and safety that directly
    impacts the person and demands their immediate attention. Critical
    notifications are extremely rare and typically come from governmental and
    public agencies or apps that help people manage their health or home."
  - "Because a Critical notification can override the Ring/Silent switch and
    break through scheduled delivery and Focus you must get an entitlement to
    send one."
  - Best practice: "Build trust by accurately representing the urgency of each
    notification."

### How this spec names requirements, and why

`pnpm run req:coverage --fail-on-uncovered-changed` runs on every diff,
docs-only ones included (the `traceability` job). It reads the changed files
under `apps/`, `packages/` and `docs/specs/` only (`scripts/req-coverage.mjs`),
and fails if one of them names a **tracked** requirement that no test names.
Four tracked requirements have a test today (`docs/requirements-status.md`),
and none of them is one this spec needs. So, as in SPIKE-01, this spec names
the others in words:

| Name used here | Where it lives |
| -------------- | -------------- |
| the invitation story | `01b-mvp-scope.md`, GRP section, 1st story |
| the responder-setup story | GRP section, 4th story |
| the 112 story, the call-sharing story | CALL section, 2nd and 3rd stories |
| the start-a-journey story, the sharing-is-visible story | JRN section, 1st and 2nd stories |
| the start-and-end story, the "I'm home" story, the automatic-stop story | JRN section, 4th, 5th and 6th stories |
| the heartbeat story, the lost-contact story, the back-in-contact story | LOST section, 1st, 2nd and 3rd stories |
| the low-battery story, the offline story | LOST section, 4th and 5th stories |
| the "I'm on it" story, the SMS-escalation story, the "they're safe" story | LOST section, 6th, 7th and 8th stories |
| the guidance story | HELP section, 1st story |
| the reminder rule, the location-loss rule | `03-safety-reliability-security.md`, reliability table, 4th and 5th rows |
| the alert-level rule, the acknowledgement rule | same table, 6th and 7th rows |
| the canary rule, the SMS-content rule | same table, 10th and 12th rows |
| the new-device notice | same file, SEC table, 1st row |
| the journey-only-location rule | `02-norway-law-privacy.md`, privacy table, 1st row |
| the no-third-party-SDK rule | same table, 6th row |
| the last-responder rule, the 24-hour rule | `05-architecture.md`, edge-case rules, 2nd and 6th rows |

**STORE is not a tracked prefix.** `collectRequirements`
(`scripts/lib/requirements.mjs`) reads stories written `**ID · title**` from
`01b-mvp-scope.md`, plus the REL, SEC, PRIV and SM tables. STORE-01 is in none
of them, and `docs/requirements-status.md` has no row for it. So `req:coverage`
asks for no test per criterion. No `req-coverage: not automated` line is
written here either: that is D-082's way out for criteria of tracked
requirements, and for an untracked one it would only print a notice on every
run.

**The deliverable may name tracked IDs.** It lives in `docs/plan/`, which
`--fail-on-uncovered-changed` does not read as a change, and the report's
📝 status counts only `docs/specs/`. So the owner's guide and the claims table
can cite story and rule IDs directly, which is more useful to the owner. The
text for Apple names none, because Apple does not know them.

### What this spec checked, and what it did not

**Checked in the repository, by reading:**
- `apps/mobile/app.config.ts` (read only). It has **no `ios` section**, so **no
  iOS bundle identifier is set**; its comment says "`ios`. Android only for now;
  iOS is its own later task." Android's `package` is
  `no.trygghverdag.placeholder`, a placeholder until the first store upload
  (D-081). The display name, `name: 'TryggHverdag'`, is set separately from
  the identifier.
- `.github/CODEOWNERS`: under `docs/`, only `docs/plan/decisions.md` is owned.
  `apps/mobile/app.config.ts` and `scripts/` are owned.
- `scripts/req-coverage.mjs` and `scripts/lib/requirements.mjs`: which files
  count as a change, and how an ID is matched (`mentions`). This spec was
  checked against that logic by reading. The planning session has no shell, so
  it did not run the gate. The coordinating session ran
  `pnpm run req:coverage --fail-on-uncovered-changed` on 2026-10-01, and it
  exited 0.
- `.prettierignore` lists `**/*.md` and `docs/`. Prettier skips both this spec
  and the deliverable, so `prettier --check` is not a formatting gate for
  either.
- `.github/workflows/ai-review.yml`: `safety-reviewer` runs in CI only when its
  path filter (server domain, alerts, worker, `api.ts`, the safety core,
  `app.config.ts`, contracts) matches. A docs-only pull request does not match
  it. `privacy-security-reviewer`, `test-auditor` and `code-reviewer` always
  run.
- `.claude/hooks/scan-sensitive.mjs`, run on every Write and Edit
  (`.claude/settings.json`). It blocks private keys, hard-coded secrets,
  locations in log statements, and real-looking Norwegian mobile numbers
  outside the test kit's fixtures file. It does not look for email addresses,
  postal addresses, D-U-N-S or organisation numbers, or coordinates in prose.
- `08-cicd-releases.md`: three app variants (development, preview, production),
  "each with its own app ID".
- The location SDK's licence, clause 1.9, was quoted verbatim by the
  coordinating session on 2026-10-01, from the dated copy D-086 keeps outside
  the repository (`~/spike-runs/licence/`, the version read at 19:21 on
  2026-09-30):
  > "Application Identifier" means the Android application ID (applicationId)
  > and the iOS bundle identifier (bundleIdentifier) under which an Application
  > is published, as registered in the Customer Dashboard when License Keys are
  > generated. An Application Identifier includes the same identifier with any
  > of the development suffixes .dev, .development, .staging, .stage, .qa, .uat,
  > .test or .debug, and any further suffix Licensor agrees to on request.

**Not checked: anything on Apple's side** beyond the quotes above. In
particular:
- the form's fields, length limits and attachments;
- whether one request can name more than one bundle identifier;
- whether the entitlement is granted per App ID or per team. Finding 10 says
  per App ID, from a forum report;
- who in the AS's account may send it;
- how the App ID's capability and the provisioning profile change after
  approval;
- the push payload's keys for the critical level and its sound;
- whether Time Sensitive needs a capability enabled on the App ID;
- whether a registered App ID's identifier can be changed later;
- how long Apple takes.

Each is marked "to verify" where the deliverable uses it.

## The deliverable

### One file: `docs/plan/critical-alerts-request.md`

**Why `docs/plan/`:**
- **It is where owner guides already live.** `merge-rules.md`,
  `staging-setup.md` and `monitoring-setup.md` each walk the owner through one
  owner to-do. This is the same kind of document: a text to send, and the steps
  to send it.
- **`docs/plan/` is the project's memory.** `plan/README.md` and its owner
  to-do list can link the file, and every session reads that list.
- **It can cite requirement IDs** (above), which the owner needs in order to
  check the claims.
- **It is not code-owned,** so a later fill-in, for example Apple's answer, does
  not need the owner's approval. The owner reads the text before sending it,
  and sending is the real gate.

**Why not `docs/store/`:** that would be a new folder for one file, built for
store work (listings, review notes, the beta review) that has no ID yet.
Keeping `CLAUDE.md`'s map true would also mean editing a code-owned file. If
store work gets IDs later, moving one file is cheap.

**Who writes it:** `implementer`, at `/feature`'s step 3, with the session's
model (D-045). STORE-01 has no test to write (see "Test plan"); at step 2,
`test-author` confirms that.

### Its parts, in order

- **Header.** "Draft — not sent", the date, a link to this spec, and the
  decisions it rests on.
- **Part A, the request text.** English, set apart with a clear start and end so
  the owner can copy it without the notes around it. It answers, in this order:
  1. what the app is, and who makes it (a placeholder);
  2. which apps the request is for: the production app, and one test build of
     it, each by a placeholder identifier, and what the test build is for;
  3. why it needs Critical Alerts;
  4. the one notification that will use them;
  5. the notifications that never will;
  6. how often;
  7. who receives it, and how they control it;
  8. what the notification carries.

  Each answer is short, because the form's limits are unknown.
- **Part B, claims and sources.** One row per claim in Part A, with its source
  in the plan and the milestone that will build it. This part is not sent.
- **Part C, Apple's form and Apple's words.** The form's address and what is
  unknown about it, and the Apple quotes above with their documents and the
  date read.
- **Part D, the owner's steps to send it** ("What sending needs", below).
- **Part E, after Apple answers.** What follows approval, a refusal, or no
  answer, and what the app then needs ("What the app needs once approved",
  below).

### Which notifications will use Critical Alerts

**Settled by the owner's answer to Q1 (2026-10-01): only the lost-contact
alert.** The alert-level rule says "Lost-contact and SOS-related alerts to
responders", and the MVP has no SOS story:
- discreet triggers are parked;
- the 112 story calls 112 through the phone's normal calling path, and alerts
  no group member.

The nearest thing was the call-sharing story's notice to #1 ("<name> is calling
you and sharing their location"). **It stays at Time Sensitive.** The answer
becomes a decision at step 8, because it settles how a binding rule reads.

So **exactly one notification uses Critical Alerts: the lost-contact alert,**
sent to a journey's responders when the server has heard nothing from the
walker's phone for 5 minutes (D-021). Part A lists every other notification in
the plan as one that never will, and adds that no other notification will:
- "journey started" and "journey ended" (the start-and-end story);
- "<name> is home" (the "I'm home" story);
- the automatic stop's question to the walker, and "ended without confirmation"
  (the automatic-stop story);
- "<name> is back in contact" (the back-in-contact story);
- the low-battery notice (the low-battery story);
- "location unavailable" (the location-loss rule);
- who is on it, and who closed the alert (the "I'm on it" and "they're safe"
  stories);
- the call-sharing notice to #1 (the call-sharing story), which uses Time
  Sensitive;
- the walker's own reminder that protection stopped (the reminder rule), the
  offline warning (the offline story), and the warning that a journey has no
  responder left (the last-responder rule);
- the notice of the automatic end 24 hours after an alert (the 24-hour rule);
- the new-device login notice (the new-device notice).

The SMS messages (the SMS-escalation story) are not notifications and have no
level.

### What Part A may say: the permitted claims

Every claim is about what the app **will** do; nothing exists yet. Part A may
word these freely, but may not add to their substance. A claim outside this
table needs a source of the same kind, and is listed in the pull request for
the owner (STORE-01-AC7).

| # | Part A may say | Source in the plan | Built in |
|---|----------------|--------------------|----------|
| C1 | The app helps people in Norway get home safely at night. A walker shares their live location with group members they choose, for one journey at a time | `01b-mvp-scope.md`, "The MVP in one sentence"; D-003; D-005; the start-a-journey story | M3 |
| C2 | It is in development and has no users yet. It will first be used by a small private group of invited friends and family, at least 12 people, through TestFlight | D-004; D-009; the roadmap | M5, M6 |
| C3 | It is developed by [the AS, as enrolled] | D-027 | A placeholder, filled in Apple's form only |
| C4 | During a journey the phone reports to our server regularly. If the server hears nothing for 5 minutes, it alerts the journey's responders | The heartbeat story; D-021; the lost-contact story | M2, M3 |
| C5 | The server decides, not the phone, so the alert still goes out when the phone is off, broken, out of coverage or taken | The lost-contact story; D-007 | M2 |
| C6 | That lost-contact alert is the only notification that will use Critical Alerts. The notice to #1 when a walker calls them will use Time Sensitive | The alert-level rule, as the owner's answer to Q1 settles it (a decision at step 8) | M3, tested there (Part E) |
| C7 | The notifications that never will, by name (the list above), and that no other notification will | The stories and rules named in that list; the owner's answer to Q1 | M3 |
| C8 | Each responder is alerted once for each lost-contact event. If nobody taps "I'm on it" within 2 minutes, every responder gets an SMS instead of further alerts, and the SMS holds no location | The state machine table in `05-architecture.md` (D-033); D-019; the acknowledgement rule; the SMS-content rule | M2 |
| C9 | The alert tells the responder what to do: call the person; if there is no answer and they are worried, call 112 and give the last known position; do not put themselves in danger. The app does not replace or contact emergency services | The guidance story; the MVP scope has no story that contacts emergency services; `01-product-vision.md`, "Explicitly out of scope" | M3 |
| C10 | Some alerts will be false alarms: to the server, a flat battery, no coverage, or the phone's system stopping the app looks the same as an emergency. The starting target is fewer than one false lost-contact alert per 20 journeys, measured during the private phase | Section 3, failure modes F1–F4, and its reliability targets (D-022) | Measured in M6 |
| C11 | Only responders receive it: members of the private, invitation-only group whom the walker chose for that journey. Nobody outside the group | D-008; D-013; the invitation story; the start-a-journey story | M3 |
| C12 | The app asks for Critical Alerts only in responder setup, through iOS's own permission request. Each responder decides for their own phone | D-020; the responder-setup story; Apple's documentation of the entitlement (an app that has it "can request" the `criticalAlert` authorisation) | M3 |
| C13 | A responder who declines still gets the strongest level they allow, Time Sensitive. When choosing responders, the walker sees who cannot receive break-through alerts | The alert-level rule; the responder-setup story | M3 |
| C14 | A person receives Critical Alerts only as someone else's responder. Nothing about their own journey uses them | The alert-level rule ("alerts to responders") | M3 |
| C15 | The push message that passes through Apple's push service will carry no personal details: no name, no location, no phone number. The responder opens the app to see who and where, from our server in the EEA | `04-tech-stack.md` finding 4; D-086 (content-free payloads); D-016; D-025 | M2, M3 |
| C16 | Our server sends straight to Apple's push service, with no third-party relay. The app has no analytics or advertising SDKs | D-086 (push straight to APNs and FCM); the no-third-party-SDK rule | M2, M3 |
| C17 | Location is collected only during a journey the walker starts, and the phone shows that it is shared for as long as the journey runs | The journey-only-location rule; the sharing-is-visible story; D-086 (the mechanism) | M3 |
| C18 | Why Time Sensitive is not enough: the alert matters most at night, when a responder's phone may be set to silent or in a Focus, and Apple's guidelines describe the Critical level as the one that can override the Ring/Silent switch | Apple's guidelines (quoted above); `03-safety-reliability-security.md` finding 3 | — |
| C19 | Why the sound matters: this alert is how responders learn that a walker's phone went silent mid-journey. A missed alert is the failure the app exists to prevent | `03-safety-reliability-security.md`, "The promise we are protecting", and F6 | — |
| C20 | The request is for the production app, [production identifier], and for one test build of the same app, [production identifier].test. The test build is for automated tests of exactly this alert on real iPhones, which must pass before the group relies on the app. It is not a demo | The owner's answer to Q2; D-041; D-035; `06-testing-strategy.md`, L9 ("permission states for Critical Alerts", "real push delivery to the phone") | M5 (L9) |

C18's second half rests on Apple's own sentence and goes no further. That Time
Sensitive keeps to the silent switch comes from third-party sources (finding 3).
Part A does not state it as Apple's behaviour.

### What Part A must never say

1. That the app is released, in use, or has users.
2. That anything has been tested on a real phone, or that an alert has been
   heard. The spike ran on emulators and simulators only (D-037). In S5,
   "heard" failed on Android and was not shown on iOS.
3. Any guarantee: that an alert will always arrive, be heard, or arrive in time.
   The plan treats push delivery as best effort and designs around it with
   acknowledgement and SMS (`03-safety-reliability-security.md`, finding 4, a
   hypothesis there). The location SDK's licence leaves to us "anything the
   Application tells End Users about its reliability or about how to obtain
   emergency assistance" (D-086's quote of its clause 9.5). The same honesty is
   owed to Apple.
4. An SOS, help, panic or emergency button, or any alert a walker sends by hand.
   The MVP has none.
5. That the app contacts emergency services, or replaces them.
6. Health or medical monitoring.
7. Organisations, volunteers outside the group, or strangers (D-008).
8. Any measured figure. No alert has been counted yet.
9. A ⚙️ setting as if it were fixed. The two numbers Part A uses, 5 minutes and
   2 minutes, are decisions (D-021, D-019) that only the owner changes.
10. A bundle identifier, the AS's details, or any person's details. These stay
    placeholders until the form.
11. Apple's process as Apple's rule when the source is a forum report
    (finding 10).
12. That the test build is for demos, or for showing the app to anyone. It is
    for testing this alert (C20). Nor that it is used only on test devices: the
    plan has not yet said which build carries the `.test` identifier, so Part
    A says what the test build is for and claims nothing about where it runs.

### How often: the estimate, and its limits

Apple's guidelines say Critical notifications are "extremely rare". Part A
answers with what the plan holds, and no more:
- **When it fires:** only during an active journey, and only after the server
  has heard nothing from the phone for 5 minutes (C4).
- **Who gets it:** only that journey's responders, once per lost-contact event.
  If nobody acknowledges within 2 minutes, the next step is SMS, not more
  alerts (C8).
- **How many people:** a private group of at least 12 (C2).
- **False alarms:** they will happen, and the starting target is fewer than one
  per 20 journeys (C10).
- **No count yet:** no alert has been counted, so the private phase will
  measure them.

This estimate is about the production app. For the test build, Part A gives
its purpose (C20) and no figure. The plan gives the real-device suite a
schedule (`06-testing-strategy.md`, L9: weekly, before every release, and when
safety-core code, native dependencies or the Expo SDK change), but not how many
alerts a run sends.

**What Part A does not do:** invent a usage figure, such as journeys a week or
alerts a month. The plan has none, and a guess presented as an estimate is a
claim the app cannot back up. If Apple's form asks for a number, the owner
stops and reports (STORE-01-AC8); the answer then comes from the owner, not
from the draft.

### What sending needs (Part D)

In this order:
1. **A-02 is done,** as the AS's organisation enrolment (D-027), not an
   individual account. The entitlement is granted to an App ID on a team
   (finding 10), so the team must be the one that will publish the app.
2. **Both identifiers are fixed at this step, by the rule the owner chose**
   (Q3, recorded as a decision at `/feature`'s step 8):
   - **production:** the AS's own domain, reversed, plus a neutral word;
   - **the test build:** the same, plus `.test`.

   **Neither is set today.** `apps/mobile/app.config.ts` has no `ios` section,
   and Android's identifier, `no.trygghverdag.placeholder`, is a placeholder
   (D-081). The values are recorded with `/decision` when the owner fixes them.
   Part A keeps its placeholders; the owner puts the values into the form at
   step 5. Whether a
   registered identifier can be changed later is to verify; the entitlement is
   tied to the App ID (finding 10).

   **Why `.test`:** the location SDK's licence, clause 1.9, includes an
   Application Identifier "with any of the development suffixes .dev,
   .development, .staging, .stage, .qa, .uat, .test or .debug". So the test
   build falls under the same licence (read 2026-09-30, from D-086's sources).
3. **Both App IDs are registered** in the AS's account. How is to verify when
   A-02 exists.
4. **Re-check Part B against the plan as it then stands.** If a source has
   changed, for example D-021's 5 minutes with the owner's approval, Part A is
   updated first, in a pull request.
5. **Send it.**
   - Sign in, open the form (Part C), and fit Part A's answers to its fields
     without changing what they say.
   - The request names the production app first and the test build second
     (Q2). Whether one request can name more than one identifier is to be
     verified when A-02 exists. **If the form takes only one, send two
     requests, production first,** each with the same Part A. That way the test
     build's request can never hold up production's.
   - The AS's details go **into the form only, never into the repository**.
   - If the form asks for something Part A does not answer, stop and tell
     Claude; nothing is made up in the form either.
6. **Record it:** the date or dates sent, in the owner to-do row in
   `docs/plan/README.md` (STORE-01-AC12). Apple's answer for each identifier is
   recorded as a decision (`/decision`) when it comes.
7. **The deadline** is M4 at the latest (the owner, 2026-10-01). Approval can
   take weeks (finding 10), and the roadmap revisits the outcome before M5.
8. **No transfer, ever.** The app stays on the AS's team (D-027). A transfer
   would probably need a new request (finding 10, one developer's report). The
   GitHub repository's possible move (D-029) has nothing to do with Apple.

### What the app needs once approved (Part E: M3 and M4, outside STORE-01)

Listed so it is not lost. None of it is STORE-01's work.

**Each outcome:**
- **Approved:** the work below becomes part of the responder-setup story and
  the alert-level rule's work in M3 or M4.
- **Refused:** nothing is removed. The lost-contact alert stays at Time
  Sensitive (D-020), the readiness status shows walkers which responders cannot
  receive break-through alerts, and the roadmap revisits the outcome before M5.
  Finding 10 reports one refusal turned into approval by a narrower request;
  whether to try that is the owner's choice.
- **No answer by the start of M5:** treated as not approved until it comes.
- **Only one of the two identifiers approved:** production's answer decides
  what the group gets. Without the test build's approval, L9 cannot show a
  Critical Alert on a real iPhone, and the owner is told before go-live,
  because D-041 asks L9 to pass first.

**The work, once approved:**
1. **The builds carry the entitlement,**
   `com.apple.developer.usernotifications.critical-alerts`, for the production
   identifier and the `.test` identifier. This goes in
   `apps/mobile/app.config.ts`, which is code-owned (owner approval). How the
   App IDs' capability is switched on, and how EAS's provisioning profiles pick
   it up, are to verify. Which of the plan's app variants (D-046) carries the
   `.test` identifier is for L9's planning to settle.
2. **Responder setup requests the `criticalAlert` authorisation,** in responder
   setup only: never at first launch, and never on the walker's own path.
   Expo's notifications library can request it (finding 10, a forum source); to
   verify at M3.
3. **Readiness reflects the level granted.** Each device reports whether it can
   receive Critical, Time Sensitive or neither, so the walker sees it (the
   responder-setup story). The data model sketch in `05-architecture.md` already
   gives the `devices` table an "alert readiness" field.
4. **The server sends the lost-contact alert at the `critical` interruption
   level** to iOS devices that granted it, and no other message at that level.
   The payload stays content-free (C15). Its keys, and the rules for a critical
   sound and its volume, are to verify against Apple's push documentation.
5. **Time Sensitive is the path** for a refused entitlement, a declined
   permission, the call-sharing notice to #1 (Q1), and any build whose
   identifier the request does not name. Whether the App ID needs the Time
   Sensitive capability is to verify.
6. **Tests that hold Part A's promises, written in M3** (named there, not
   here):
   - only the lost-contact message carries the critical level (L2 or L6);
   - each responder gets it once per lost-contact event, with SMS, not further
     alerts, when nobody acknowledges (L2 or L6);
   - the permission is requested only in responder setup (L5 or L7);
   - readiness follows the granted level (L5).
7. **L9 on a real iPhone, with the `.test` build:** the permission states for
   Critical Alerts (`06-testing-strategy.md`, L9), and RR-01's closest
   automated check: the alert was sent at the critical level and the permission
   was granted. This is what the test build is in the request for (C20).
8. **Android, for completeness:** post the alert with `CATEGORY_ALARM` (D-086).
   It has nothing to do with Apple's request.

## Acceptance criteria

**STORE-01-AC1: one file, in five parts.**
Given STORE-01's deliverable,
when it is written,
then it is the one file `docs/plan/critical-alerts-request.md`, and:
- its header says "Draft — not sent", with the date, a link to this spec, and
  the decisions it rests on;
- it has the header and Parts A to E, in the order under "Its parts, in order";
- Part A is set apart with a clear start and end, so it can be copied without
  the notes around it.

**STORE-01-AC2: Part A is honest about what exists.**
Given Part A,
when it is read on its own, as Apple would read it,
then:
- it is in English;
- it says the app is in development, has no users yet, and will first be used
  by a small private group of invited friends and family (C2);
- every sentence about what the app does says "will";
- it says none of the things under "What Part A must never say";
- wherever the developer's details or a bundle identifier would go, it has a
  placeholder in square brackets, never a value.

**STORE-01-AC3: one notification, and a named list of the rest.**
Given Part A's answer to which notifications will use Critical Alerts,
and the owner's answer to Q1 (only the lost-contact alert),
when it is read,
then:
- it names one notification only: the lost-contact alert to a journey's
  responders after 5 minutes of silence (C4 to C6);
- it says the notice to #1 when a walker calls them will use Time Sensitive
  (C6);
- it lists by name every other notification under "Which notifications will
  use Critical Alerts" as one that never will;
- it says that no other notification will.

**STORE-01-AC4: an honest estimate of how often.**
Given Part A's answer to how often,
when it is read,
then:
- it states when the alert fires and who gets it (C4, C8), the group's size
  (C2), that false alarms will happen, with the starting target (C10), and that
  no alert has been counted yet;
- it gives no usage figure that the plan does not hold.

**STORE-01-AC5: who receives it, and their control.**
Given Part A's answers on who receives the alert and how they control it,
when they are read,
then they say C11 to C14:
- only responders receive it, chosen for each journey from the private group;
- it is asked for only in responder setup, through iOS's own request, and each
  responder decides;
- a responder who declines gets Time Sensitive, and the walker sees who cannot
  receive break-through alerts;
- nobody receives a Critical Alert about their own journey.

**STORE-01-AC6: the push message carries no personal details.**
Given Part A's answer on what the notification carries,
when it is read,
then it says C15 and C16:
- the push message carries no name, no location and no phone number;
- the details are shown only in the app, from the server in the EEA;
- there is no third-party push relay and no analytics or advertising SDK.

Any example text it gives is fixed, with no personal details, like S5's.

**STORE-01-AC7: every claim has a source.**
Given Part B,
when each claim in Part A is looked up in it,
then:
- each claim has a row naming its source in the plan (a decision, a story, a
  rule, a finding or a spike result, by ID) and the milestone that will build
  it;
- a claim outside C1 to C20 has a source of the same kind, and the pull request
  lists it for the owner;
- no claim rests on Claude's assessment alone.

**STORE-01-AC8: Apple's form is not invented.**
Given Part C,
when it is read,
then:
- it gives the form's address, says the form is behind an Apple sign-in and its
  fields were not read, and marks every field "to be verified when A-02
  exists";
- it presents no field as fact;
- every Apple quote in the file is one of those under "What Apple says, as read
  on 2026-10-01", with its document and the date;
- what finding 10 says about Apple's process is labelled a forum report;
- it tells the owner to stop and report if the form asks for something Part A
  does not answer, rather than write an answer the plan does not back.

**STORE-01-AC9: the owner's steps to send it.**
Given Part D,
when it is read,
then it lists the eight steps under "What sending needs", in that order, each
with what to do and why, including that:
- no iOS bundle identifier is set today, and both are fixed at sending by the
  owner's rule: production name-neutral, the test build the same plus `.test`;
- the entitlement is tied to the App ID on the AS's team;
- if the form takes only one identifier, two requests go, production first;
- the app is never transferred;
- M4 is the latest point;
- where the date sent and Apple's answer are recorded.

**STORE-01-AC10: after Apple answers, and what the app then needs.**
Given Part E,
when it is read,
then:
- it says what follows approval, a refusal, no answer by the start of M5, and
  approval of only one of the two identifiers;
- it lists the eight items under "What the app needs once approved", each
  marked "M3 or M4, outside STORE-01";
- every Apple-side detail not read from Apple is marked "to verify".

**STORE-01-AC11: no personal data in the repository.**
Given the deliverable and this spec,
when they are committed to the public repository,
then neither holds a phone number, an email address, a postal address, a
D-U-N-S or organisation number, a person's name, coordinates, or a place where
anyone lives. The AS's details are placeholders, filled in only in Apple's
form. The two identifiers stay placeholders in Part A; their values are
recorded with `/decision` when the owner fixes them (Part D, step 2).

**STORE-01-AC12: the sending cannot be forgotten.**
Given the draft is merged,
when the records are updated,
then:
- `docs/plan/README.md`'s owner to-do list has a row for sending it, with the
  next free A-number. The row depends on A-02 and on fixing the two
  identifiers, is due by M4 at the latest, and links the file;
- `docs/progress.md` shows STORE-01's status;
- `docs/progress/m1.md` has the entry, and says whether M1's exit is now met.
  Closing M1 is the owner's call, as M0's was (D-083).

**STORE-01-AC13: the test build is named for what it is for.**
Given Part A's answer on which apps the request is for, and Part D,
when they are read,
then:
- Part A names the production app first and one test build second. Each is
  named by a placeholder identifier, the test build's being production's plus
  `.test`;
- it gives the test build's purpose: automated tests of exactly this alert on
  real iPhones, which must pass before the group relies on the app (C20). It
  never calls the test build a demo, and claims nothing about where the build
  runs;
- Part D says that whether one request can name both identifiers is to be
  verified when A-02 exists, and that if the form takes only one, the owner
  sends two requests, production first.

## Test plan

**STORE-01 changes no code, so no test level from L2 to L7 applies.** Every
criterion is about the content of one document. Whether a claim is honest,
whether it is sourced, and whether it fits Apple's bar are judgements that
only review can make.

| AC | L2–L7 | Automated today | Checked by review |
| -- | ----- | --------------- | ----------------- |
| AC1 | none | — | `code-reviewer`; the owner |
| AC2 | none | — | `safety-reviewer`; the owner |
| AC3 | none | — | `safety-reviewer` |
| AC4 | none | — | `safety-reviewer` |
| AC5 | none | — | `safety-reviewer`, `privacy-security-reviewer` |
| AC6 | none | — | `privacy-security-reviewer` |
| AC7 | none | — | `safety-reviewer` and `privacy-security-reviewer`, each row against its source |
| AC8 | none | — | `code-reviewer` |
| AC9 | none | — | `code-reviewer`; the owner |
| AC10 | none | — | `safety-reviewer` |
| AC11 | none | In part: `scan-sensitive.mjs` blocks `+47`/`0047`-prefixed Norwegian mobile numbers and secrets on Write and Edit (not 8-digit domestic numbers, email addresses or organisation numbers, and not files written from a shell), and gitleaks (`security`) scans for secrets | `privacy-security-reviewer`, for the rest |
| AC12 | none | — | `code-reviewer` |
| AC13 | none | — | `safety-reviewer`; the owner |
| This spec | — | `req:coverage --fail-on-uncovered-changed` (`traceability`): it names no tracked requirement without a test | — |

**Why no new automated test.** Two candidates were weighed and rejected.
- **A scan of the draft for personal data,** for example in
  `scripts/store-docs.test.mjs`, written by `test-author`, which would need the
  owner's approval (`scripts/` is code-owned). It would catch email addresses,
  9-digit numbers and coordinate-shaped numbers in one file. But:
  - the file is a one-off, written once and filled in once;
  - the leak-prone fields are kept out by design (placeholders, AC11);
  - a phone number written with `+47` or `0047` is blocked on Write and Edit;
    a domestic 8-digit number, an email address or an organisation number is
    not (checked by `test-author` at step 2, 2026-10-01), so review carries
    those;
  - a regex over prose would be the kind of decorative check D-074 describes:
    traceability in appearance, over a number that cannot move.
- **A required-sections check** would prove that headings exist, not that what
  sits under them is true.

**`/feature`'s red step has nothing to write.** Step 2 delegates to
`test-author` to turn criteria into failing tests. RG-02 asks this of new
behaviour, and STORE-01 adds none. At step 2, `test-author` confirms this test
plan instead of writing tests. The pull request says so plainly rather than
inventing a test. `test-auditor` still runs in CI. What it should confirm:
- no criterion here claims a test that does not exist;
- the reasons above hold.

**`safety-reviewer` is run by the main session at step 5,** as in SPIKE-01,
because CI's path filter will not select it for a docs-only pull request, and
Part A makes safety claims.

**What protects the promises later is M3's tests,** listed in Part E, item 6.
They make sure the app does what Part A told Apple it will do.

## Modules and files affected

**New**
- `docs/specs/STORE-01.md` (this file; `planner`).
- `docs/plan/critical-alerts-request.md` (`implementer`, `/feature` step 3).

**Changed** by `plan-keeper` at step 8. The path marked ◆ needs the owner's
approval (CODEOWNERS, D-042).

| Path | Change |
| ---- | ------ |
| ◆ `docs/plan/decisions.md` | Q1's answer (only the lost-contact alert; the call notice to #1 stays Time Sensitive), because it settles how a binding rule reads. Q3's answer (both identifiers fixed at sending, name-neutral, the test build with `.test`). Together or separately, as `plan-keeper` sees fit. The identifiers' values get their own decision when the owner fixes them, at sending |
| `docs/plan/README.md` | The owner to-do for sending it (STORE-01-AC12); the status line |
| `docs/progress.md`, `docs/progress/m1.md` | STORE-01's status and entry; whether M1's exit is met |
| `docs/requirements-status.md` | Regenerated by `req:coverage`. It should come out unchanged, because this spec names no tracked requirement |

**Deliberately not touched:**
- `apps/**`, including `apps/mobile/app.config.ts`. The bundle identifier and
  the entitlement are later work, with the owner's approval.
- `packages/**`, `scripts/**`, `.github/**`, `.claude/**`, `CLAUDE.md`,
  `infra/**` and the root `package.json`.
- `docs/plan/10-roadmap.md`, whose M1 and M4 rows already say what STORE-01
  needs.
- `docs/plan/04-tech-stack.md`.

## Contract changes

None. `packages/contracts` does not change. Two later changes are noted for M2
and M3, outside STORE-01:
- the level of the lost-contact push travels from our server to Apple, not
  through our API;
- each device's readiness reaching the server is part of the responder-setup
  story's contract work.

## Risks and failure modes

The failure modes are F1 to F10 in
[`03-safety-reliability-security.md`](../plan/03-safety-reliability-security.md#failure-modes).
STORE-01 changes no running system. Its risks are about what the request
promises, and about what happens if it is late or refused.

| # | Risk | What it would look like | F | Mitigation |
|---|------|-------------------------|---|------------|
| R1 | Apple refuses | Lost-contact alerts stay at Time Sensitive. A responder's iPhone set to silent may not sound at night, and the SMS escalation reaches the same silenced phone | F6 | D-020's fallback; SMS escalation (D-019); readiness shows the walker who cannot receive break-through alerts; the roadmap revisits before M5. Part E says plainly what a refusal leaves open |
| R2 | Sent late | The group starts in M6 without Critical Alerts, because approval takes weeks | F6 | Drafted now; an owner to-do (AC12); M4 at the latest |
| R3 | An overclaim | Apple approves on a promise M3 later breaks, for example routine notices at the critical level. Responders then silence the app | F6 | Permitted claims only; "will" throughout; Part B's sources; M3's tests (Part E, item 6); Q1's answer recorded as a decision |
| R4 | The wrong App ID or team | The entitlement sits on a placeholder, on a build the group never installs, on an individual account, or on an app later transferred | F6 | A-02 as the AS (D-027); both identifiers fixed before the App IDs are registered (Q3); production named first (Q2); no transfer, ever |
| R5 | Personal data in the public repository | The AS's numbers, an email address or the owner's name committed with the draft | — | Placeholders, filled in Apple's form only (AC11); review; the write-time hook for `+47`/`0047` phone numbers only |
| R6 | Alert fatigue | False alarms at the critical level wake responders, who switch Critical Alerts off or leave the group | F6, caused by F1 to F4 | C10 says so honestly; the false-alarm target is measured (D-022); the threshold is the owner's to tune (D-021); readiness shows who has it off |
| R7 | The canary at the critical level | If the canary journey's test responder were a person's iPhone, it would break through silence at every canary run, and Part A's picture of rarity would be wrong | F8 | Flagged for the canary rule's own spec: its test responder is not a person's phone at the critical level |
| R8 | Approved, but not heard | The entitlement is granted, and nobody has shown the alert sounding on a silenced iPhone (RR-01) | F6 | L9 checks the permission states, plus RR-01's closest automated check (Part E, item 7). Part A never says it has been heard |
| R9 | A stale draft | By the time A-02 exists, the plan has changed (a threshold, a story), and Part A describes another app | F6, through R3 | Part D, step 5: re-check Part B against the plan before sending |
| R10 | The form asks for what does not exist | A live app, a video or a usage figure, so sending stalls | F6, through R2 | Stop and report (AC8); M4 at the latest leaves time |
| R11 | False coverage, or a red gate | This spec names a tracked requirement with no test, and `traceability` fails or the report shows a false 📝 | — | Requirements are named in words here; IDs appear only in `docs/plan/` |
| R12 | A hurried identifier | A permanent bundle identifier is chosen in a hurry at sending time | — | The rule is settled now (Q3: name-neutral, the test build with `.test`) and recorded as a decision at step 8; only the values are chosen at sending |
| R13 | The test build weakens the request | Apple's forum reports the entitlement is not granted "purely for demos" (finding 10), and a second, test identifier invites that reading. **A known trade-off the owner chose on 2026-10-01** (Q2), against the recommendation, so that L9 can show this alert on a real iPhone | F6, through R1 | Part A states the test build's purpose exactly (C20) and never calls it a demo (AC13); production is named first; if two requests are needed, production goes first, so the test build's request cannot hold it up |
| R14 | The test build becomes a demo build | The `.test` identifier ends up on the build used to show the app, and C20's statement of purpose stops being true | F6, through R3 | Which build carries `.test` is for L9's planning (Part E, item 1). If it would also serve demos, the owner is told before that build ships, because the request said otherwise |

## Out of scope

- **Sending the request.** That is the owner's, once A-02 exists, by M4 at the
  latest.
- **A-02 itself,** choosing the identifiers' values (the owner, at sending, by
  Q3's rule), and the public name.
- **Which of the plan's app variants carries the `.test` identifier** (D-046).
  That is for L9's planning.
- **Any code or configuration:** the entitlement in the build, the
  authorisation in setup, the interruption level, readiness, the Time Sensitive
  path, and `apps/mobile/app.config.ts` (Part E; M3 and M4).
- **Android's alert channel and `CATEGORY_ALARM`** (D-086, M3). The plan has no
  request to Google for it.
- **Any SOS or help feature.** The request adds no notification that the plan
  does not have.
- **Translating the request.** It goes to Apple, in English; D-014 covers app
  text.
- **Store listings, App Store review notes and the beta review** (M5).
- **The canary's design.** R7 is a flag for it, not a change to it.

## Owner actions

- **Q1 to Q3: answered** on 2026-10-01 (below).
- **Approve the decisions** that record Q1's and Q3's answers at step 8
  (`docs/plan/decisions.md` is code-owned).
- **Later:** A-02, then fix the two identifiers and send the request (the new
  to-do), by M4 at the latest.

## Questions for the owner

None open now. Q1 to Q3 were asked on 2026-10-01 and answered the same day.
They are kept below as the record.

### Answered

**Q1: Which notifications will use Critical Alerts? (blocked the draft)**

**Answered by the owner 2026-10-01: (a), only the lost-contact alert.** The
alert is sent after 5 minutes of silence (D-021). The call notice to #1 stays at
Time Sensitive. The answer is recorded as a decision at step 8, because it
settles how the alert-level rule reads: its "SOS-related" part has no MVP story.
Part A says exactly this (C6, C7, STORE-01-AC3).

The question, its options and the recommendation, as asked:

The alert-level rule says "Lost-contact and SOS-related alerts to responders"
use the strongest level. The MVP has no SOS story: discreet triggers are
parked, and the 112 button calls 112 and alerts no group member. The nearest
thing is the call-sharing story's notice to #1, "<name> is calling you and
sharing their location".

Options:
- **(a) Only the lost-contact alert.** Everything else, the call-sharing notice
  included, will never use Critical Alerts. Recorded as a decision, because it
  settles how a binding rule reads, and Part A promises it to Apple.
- **(b) The lost-contact alert and the call-sharing notice.**

**Recommendation: (a).**
- **Apple's bar.** Apple's guidelines ask for "extremely rare" use and for
  "accurately representing the urgency of each notification". A call to #1 is
  often routine, and it would make every call a break-through alert.
- **A missed call fails loudly; a silent phone does not.** When #1 does not
  answer, the walker sees it at once and can call someone else, or 112. When a
  walker's phone goes silent, nobody sees anything unless the alert gets
  through (F6).
- **Later features decide for themselves.** If an SOS feature is ever added, its
  own story decides its level then.

**Q2: Which app does the request name? (needed before sending)**

**Answered by the owner 2026-10-01: production and a test build.** The owner
did not take the recommendation. The answer is close to (b), except that the
test build is named by its `.test` identifier rather than as the preview
variant. Which variant carries that identifier is for L9's planning (Part E,
item 1). What the answer brings:
- **The request names the production app and one test build.** The test build's
  identifier is production's plus `.test` (Q3).
- **Part A justifies the test build by its purpose:** automated tests of
  exactly this alert on real iPhones, which must pass before the group relies
  on the app (L9, D-041). It is not a demo (C20, STORE-01-AC13).
- **One request or two.** Whether one request can name more than one
  identifier stays "to be verified when A-02 exists". If the form takes only
  one, the owner sends two requests, production first (Part D, step 5).
- **The risk is a known trade-off the owner chose.** The recommendation's
  concern, that a test build could weaken the case, is now R13.

The question, its options and the recommendation, as asked:

The plan has three app variants, each with its own app ID (D-046,
`08-cicd-releases.md`):
- development;
- preview, which talks to staging and is what M3's demo uses;
- production.

The entitlement is granted to one App ID on one team (finding 10, a forum
report). Whether Apple's form takes more than one identifier is unknown,
because the form is behind sign-in.

Options:
- **(a) The production app only.** Preview and development builds use Time
  Sensitive. If L9 needs a build with the entitlement to check Critical Alerts
  on a real iPhone, that is settled when L9 is planned, with a second request
  if needed.
- **(b) Production and preview together,** with the preview described as the
  internal test build of the same app.

**Recommendation: (a).**
- **The production app is the one the group will rely on.**
- **A test build could weaken the case.** Apple's forum reports the entitlement
  is not granted "purely for demos", and a test build in the same request
  invites that reading.
- **A second request costs little.** If one is ever needed, it does not delay
  the first.

**Q3: When is the production bundle identifier fixed? (needed before sending)**

**Answered by the owner 2026-10-01: (a), at sending, name-neutral.** Both
identifiers are fixed when the owner sends:
- **production:** the AS's own domain, reversed, plus a neutral word;
- **the test build:** the same, plus `.test`.

**The SDK's licence covers the test build.** Its clause 1.9 includes an
Application Identifier "with any of the development suffixes .dev,
.development, .staging, .stage, .qa, .uat, .test or .debug". The licence was
read on 2026-09-30, from D-086's sources; this planning session did not read
the copy itself (see "What this spec checked").

**Recording it.** The answer is recorded as a decision at step 8, together with
Q1's or separately, as `plan-keeper` sees fit. Part A keeps placeholders for
both identifiers. Part D, step 2, fixes their values, and step 5 puts them into
the form.

The question, its options and the recommendation, as asked:

No iOS bundle identifier is set: `apps/mobile/app.config.ts` has no `ios`
section. Android's identifier, `no.trygghverdag.placeholder`, stays a
placeholder "until the first store upload, when the owner fixes it together
with the public name" (D-081). The entitlement is tied to the App ID. So
sending fixes the production identifier, possibly a milestone or more before
the public name is chosen (D-057).

Options:
- **(a) Fix it when sending, independent of the public name.** For example, the
  AS's own domain, reversed, plus a neutral word. Recorded as a decision then.
  Whether Android follows it stays D-081's own question.
- **(b) Choose the public name first,** derive the identifier from it, then
  send.
- **(c) Wait** until the first production store upload in M5. That is after M4,
  the latest point the owner set.

**Recommendation: (a).**
- **The identifier is not the app's name.** The name people see is set
  separately (`name` in `app.config.ts`).
- **Waiting costs weeks.** Tying the identifier to a name not yet chosen only
  delays a request that already takes weeks.
- **Still to verify:** whether a registered identifier can be changed later.
  The entitlement is tied to the App ID either way (finding 10).
