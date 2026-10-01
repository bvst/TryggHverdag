# Critical Alerts request — the draft and the owner's steps (STORE-01)

**Draft — not sent** · **Written:** 2026-10-01 · Spec:
[`../specs/STORE-01.md`](../specs/STORE-01.md) · Decisions: D-003, D-004,
D-005, D-007, D-008, D-009, D-013, D-014, D-016, D-019, D-020, D-021, D-022,
D-025, D-027, D-033, D-035, D-037, D-041, D-046, D-057, D-081, D-086, and the
owner's answers of 2026-10-01 to the spec's Q1 to Q3 (Q1's and Q3's are
recorded as decisions when STORE-01's records are updated)

This file holds the text of the request to Apple for the Critical Alerts
entitlement, and the owner's steps for sending it. **Nothing here has been
sent.** Sending needs A-02, the AS's Apple Developer enrolment, and is due by
M4 at the latest.

- **Part A** is the text for Apple. It is the only part that is sent.
- **Part B** gives each claim in Part A its source in the plan.
- **Part C** is what is known, and not known, about Apple's form, and Apple's
  own words.
- **Part D** is the owner's eight steps to send it.
- **Part E** is what follows Apple's answer, and what the app then needs.

**How Part A is written:**
- The app does not exist yet, so every sentence about what it does says
  "will".
- Only the lost-contact alert will use Critical Alerts (the owner's answer to
  Q1). The call notice to #1 stays Time Sensitive.
- No guarantee, no measured figure and no usage number. No SOS button: the MVP
  has none.
- The AS's details and both identifiers are placeholders in square brackets.
  They are filled in in Apple's form only, never in this repository.
- It names no requirement or decision ID, because Apple does not know them.
  Part B maps every claim to its ID.
- It is in English, because it goes to Apple. D-014's bokmål-first rule is for
  app text.

## Part A — the request text

Each answer is short, because the form's length limits are unknown (Part C).
The numbered headings are topics, not the form's fields: fit the answers to
the fields without changing what they say (Part D, step 5).

---

**Start of the request text.** Copy from the next line down to "End of the
request text".

**1. The app and its developer**

The app will help people in Norway get home safely at night. A walker, the
person on their way home, will share their live location with group members
they choose, the journey's responders, for one journey at a time.

The app is in development and has no users yet. It will first be used by a
small private group of invited friends and family, at least 12 people, through
TestFlight.

It is developed by [the AS's name, as enrolled with Apple].

**2. The apps this request is for**

This request is for two builds of the same app:
- the production app, [production identifier];
- one test build of it, [production identifier].test.

The test build will be used for automated tests of exactly this alert on real
iPhones. Those tests must pass before the group relies on the app. It is not a
demo.

**3. Why the app needs Critical Alerts**

During a journey, the walker's phone will report to our server regularly. If
the server hears nothing from it for 5 minutes, the server will alert the
journey's responders. The server will decide, not the phone, so the alert will
still go out when the phone is off, broken, out of coverage or taken.

This alert will be how responders learn that a walker's phone went silent in
the middle of a journey. A missed alert is the failure the app is being built
to prevent.

The alert will matter most at night, when a responder's phone may be set to
silent or in a Focus. Apple's guidelines describe the Critical level as the
one that can override the Ring/Silent switch. That is why we are asking for
Critical Alerts for this one alert.

**4. The one notification that will use Critical Alerts**

Only one notification will use Critical Alerts: the lost-contact alert. It
will go to a journey's responders when our server has heard nothing from the
walker's phone for 5 minutes.

When a responder opens the alert, the app will tell them what to do: call the
person; if there is no answer and they are worried, call the emergency number
112 and give the last known position; and do not put themselves in danger.
The app will not contact emergency services, and it will not replace them.

**5. The notifications that will never use Critical Alerts**

When a walker calls their chosen #1 contact, that contact will get a notice
that the walker is calling and sharing their location. That notice will use
Time Sensitive, not Critical Alerts.

None of these will use Critical Alerts either:
- the notices that a journey started, and that it ended;
- the notice that the walker is home;
- the question to the walker, on a long journey, whether to extend or end it,
  and the notice to responders that a journey ended without confirmation;
- the notice that the walker's phone is back in contact;
- the low-battery notice;
- the notice that the walker's location is unavailable;
- the notices to responders of who is handling an alert, and of who closed it;
- the walker's own reminder that their journey protection stopped, the
  warning that they are offline, and the warning that their journey has no
  responder left;
- the notice that a journey ended automatically 24 hours after an alert;
- the notice of a login on a new device.

No other notification will use Critical Alerts.

**6. How often**

- The alert will fire only during an active journey, and only after the server
  has heard nothing from the walker's phone for 5 minutes.
- Only that journey's responders will get it, once for each lost-contact
  event. If nobody taps "I'm on it" within 2 minutes, every responder will get
  an SMS instead of further alerts. The SMS will hold no location.
- The app will first be used by a private group of at least 12 people.
- Some alerts will be false alarms. To the server, a flat battery, no
  coverage, or the phone's system stopping the app will look the same as an
  emergency. Our starting target is fewer than one false lost-contact alert per
  20 journeys, and it will be measured during the private phase.
- No alert has been counted yet, because the app is not in use. The private
  phase will count them.

These points are about the production app. The test build's purpose is in
answer 2.

**7. Who receives it, and how they control it**

- Only responders will receive it: members of the private, invitation-only
  group whom the walker chose for that journey. Nobody outside the group will.
- The app will ask for Critical Alerts only in responder setup, through iOS's
  own permission request. Each responder will decide for their own phone.
- A responder who declines will still get the strongest level they allow, Time
  Sensitive. When choosing responders, the walker will see who cannot receive
  break-through alerts.
- A person will receive Critical Alerts only as someone else's responder.
  Nothing about their own journey will use them.

**8. What the notification carries**

- The push message that passes through Apple's push service will carry no
  personal details: no name, no location and no phone number. Its text will be
  fixed, such as "Safety alert — open the app".
- The responder will open the app to see who and where, from our server in the
  EEA.
- Our server will send straight to Apple's push service, with no third-party
  relay. The app will have no analytics or advertising SDKs.
- Location will be collected only during a journey the walker starts, and the
  phone will show that it is being shared for as long as the journey runs.

**End of the request text.**

---

## Part B — each claim and its source

Not sent. One row per claim in Part A, in the spec's numbering (C1 to C20).
"Answer" is the numbered answer in Part A. "Built in" is the milestone that
will make the claim true; until then, every claim is a promise.

| # | Answer | What Part A says | Source in the plan | Built in |
|---|--------|------------------|--------------------|----------|
| C1 | 1 | The app will help people in Norway get home safely at night. A walker will share their live location with responders they choose, for one journey at a time | `01b-mvp-scope.md`, "The MVP in one sentence"; D-003; D-005; JRN-01 | M3 |
| C2 | 1, 6 | In development, no users yet. First used by a small private group of invited friends and family, at least 12 people, through TestFlight | D-004; D-009; `10-roadmap.md`, M5 and M6 | M5, M6 |
| C3 | 1 | Developed by [the AS's name, as enrolled with Apple] | D-027 | A placeholder, filled in Apple's form only |
| C4 | 3, 4, 6 | During a journey the phone will report regularly. If the server hears nothing for 5 minutes, it will alert the journey's responders. Only during an active journey | LOST-01; D-021; LOST-02 | M2, M3 |
| C5 | 3 | The server will decide, not the phone, so the alert still goes out when the phone is off, broken, out of coverage or taken | LOST-02; D-007 | M2 |
| C6 | 4, 5 | The lost-contact alert is the only notification that will use Critical Alerts. The notice to #1 when a walker calls them will use Time Sensitive | REL-06, as the owner's answer to Q1 settles it (a decision when STORE-01's records are updated); CALL-03 for the notice | M3, tested there (Part E, item 6) |
| C7 | 5 | The notifications that never will, by name, and that no other notification will | JRN-04; JRN-05; JRN-06; LOST-03; LOST-04; REL-05; LOST-06; LOST-08; CALL-03; REL-04; LOST-05; SM-02; SM-06; SEC-01; the owner's answer to Q1 | M3 |
| C8 | 6 | Each responder alerted once for each lost-contact event. If nobody taps "I'm on it" within 2 minutes, every responder gets an SMS instead of further alerts, and the SMS holds no location | The state machine table in `05-architecture.md` (D-033); D-019; REL-07; REL-12 | M2 |
| C9 | 4 | The app will tell the responder what to do: call; if no answer and worried, call 112 with the last known position; do not put themselves in danger. It will not contact or replace emergency services | HELP-01; no story in `01b-mvp-scope.md` contacts emergency services; `01-product-vision.md`, "Explicitly out of scope" | M3 |
| C10 | 6 | Some alerts will be false alarms: a flat battery, no coverage or the system stopping the app looks the same to the server. Starting target: fewer than one per 20 journeys, measured during the private phase. No alert counted yet | `03-safety-reliability-security.md`, F1 to F4 and the reliability targets (D-022); "no alert counted yet" follows from C2 | Measured in M6 |
| C11 | 7 | Only responders: members of the private, invitation-only group whom the walker chose for that journey. Nobody outside the group | D-008; D-013; GRP-01; JRN-01 | M3 |
| C12 | 7 | Asked for only in responder setup, through iOS's own permission request. Each responder decides for their own phone | D-020; GRP-04; Apple's documentation of the entitlement (an app that has it "can request" the `criticalAlert` authorisation, Part C) | M3 |
| C13 | 7 | A responder who declines still gets Time Sensitive. The walker sees who cannot receive break-through alerts | REL-06; GRP-04 | M3 |
| C14 | 7 | Critical Alerts only as someone else's responder. Nothing about their own journey uses them | REL-06 ("alerts to responders") | M3 |
| C15 | 8 | The push message will carry no name, no location and no phone number; fixed text, such as "Safety alert — open the app". The responder opens the app to see who and where, from our server in the EEA | `04-tech-stack.md` finding 4 (the example text is its own); D-086 (content-free payloads); D-016; D-025 | M2, M3 |
| C16 | 8 | Straight to Apple's push service, no third-party relay. No analytics or advertising SDKs | D-086 (push straight to APNs and FCM); PRIV-06 | M2, M3 |
| C17 | 8 | Location collected only during a journey the walker starts; the phone shows it is shared for as long as the journey runs | PRIV-01; JRN-02; D-086 (the mechanism) | M3 |
| C18 | 3 | The alert matters most at night, when a phone may be on silent or in a Focus. Apple's guidelines describe the Critical level as the one that can override the Ring/Silent switch | Apple's Human Interface Guidelines (Part C); `03-safety-reliability-security.md` finding 3 | — |
| C19 | 3 | This alert will be how responders learn a walker's phone went silent. A missed alert is the failure the app is being built to prevent | `03-safety-reliability-security.md`, "The promise we are protecting", and F6 | — |
| C20 | 2 | The request is for [production identifier] and one test build, [production identifier].test, for automated tests of exactly this alert on real iPhones, which must pass before the group relies on the app. Not a demo | The owner's answer to Q2; D-041; D-035; `06-testing-strategy.md`, L9 ("permission states for Critical Alerts", "real push delivery to the phone") | M5 (L9) |

**Nothing in Part A falls outside C1 to C20.** Three wordings only explain a
term for a reader who does not know the plan: "the person on their way home"
(the walker, `01b-mvp-scope.md`, "People"), "their chosen #1 contact" (GRP-02)
and "the emergency number 112" (CALL-02, HELP-01).

**C18 goes no further than Apple's own sentence.** That Time Sensitive keeps
to the silent switch comes from third-party sources (finding 3), so Part A
does not state it as Apple's behaviour.

## Part C — Apple's form and Apple's words

### The form

`https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement/`

It is behind an Apple sign-in. **Its fields were not read.** Every field is
**to be verified when A-02 exists**. In particular, none of these is known:
- the form's fields, their length limits, and any attachments;
- whether one request can name more than one bundle identifier;
- who in the AS's account may send it.

This is why Part A is written by topic, not field by field.

**If the form asks for something Part A does not answer,** for example a live
app, a video or a usage figure, **stop and tell Claude.** Do not write an
answer the plan does not back, in the form or in this file. The answer then
comes from the owner, through Part D's step 4.

### Apple's words, as read on 2026-10-01

These were read from Apple on 2026-10-01 by the session that commissioned
STORE-01's spec, and are quoted exactly as the spec gives them. Nothing else
in this file is Apple's word.

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

### What comes from Apple's forum, not from Apple

`04-tech-stack.md` finding 10 rests on two threads on Apple's developer forum,
not on Apple's documentation. **These are forum reports, not Apple's rules:**
- the entitlement is said not to be granted purely for demos;
- some developers wait weeks for an answer;
- one was first refused, then approved on a narrower request;
- the entitlement is granted to a specific App ID on a specific developer
  team;
- one developer reports that it did not follow the app when the app was
  transferred to a new account.

Finding 10 also reports, from Expo's forum, that Expo's notification library
can request the Critical Alerts permission.

### Not read from Apple, so to verify

Wherever this file relies on one of these, it says "to verify":
- whether the entitlement is granted per App ID or per team (finding 10 says
  per App ID, from a forum report);
- how the App ID's capability and the provisioning profile change after
  approval;
- the push payload's keys for the critical level, and for its sound;
- whether Time Sensitive needs a capability enabled on the App ID;
- whether a registered App ID's identifier can be changed later;
- how long Apple takes.

## Part D — the owner's steps to send it

Only the owner can do these. In this order.

### 1. A-02 is done, as the AS

**What:** the Apple Developer Program enrolment is the AS's organisation
enrolment (D-027), not an individual account.

**Why:** the entitlement is granted to an App ID on a team (finding 10, a forum
report). So the team must be the one that will publish the app.

### 2. Fix both identifiers

**What:** choose both bundle identifiers, by the rule the owner chose on
2026-10-01 (Q3):
- **production:** the AS's own domain, reversed, plus a neutral word;
- **the test build:** the same, plus `.test`.

Record the values with `/decision`. Part A keeps its placeholders; the values
go into the form at step 5, and nowhere else in this file.

**Why now:** neither identifier is set today. `apps/mobile/app.config.ts` has
no `ios` section, so no iOS bundle identifier exists, and Android's,
`no.trygghverdag.placeholder`, is a placeholder (D-081). The entitlement is
tied to the App ID (finding 10), and whether a registered identifier can be
changed later is to verify. So the values are chosen once, with care, before
the App IDs are registered. The identifier is not the app's name: the name
people see is set separately (`name` in `app.config.ts`), and the public name
is still open (D-057). That is why production's last word is neutral.

**Why `.test`:** the location SDK's licence, clause 1.9, says an Application
Identifier "includes the same identifier with any of the development suffixes
.dev, .development, .staging, .stage, .qa, .uat, .test or .debug". So the test
build falls under the same licence (read 2026-09-30, from D-086's sources).

### 3. Register both App IDs

**What:** register both App IDs in the AS's account. How is to verify when
A-02 exists.

**Why:** the entitlement attaches to an App ID on the AS's team (finding 10, a
forum report), so both must exist on that team before the request names them.

### 4. Re-check Part B against the plan as it then stands

**What:** check each row of Part B against its source. If a source has
changed, for example D-021's 5 minutes, changed with the owner's approval,
Part A is updated first, in a pull request. **Run `safety-reviewer` by hand on
that pull request:** CI's path filter (`.github/workflows/ai-review.yml`) does
not select it for a docs-only change, and Part A makes safety claims.

**Why:** this draft was written in M1, and the plan may have moved by the time
A-02 exists. A request that describes another app is a promise the app may
later break, and Apple would have approved it on that promise.

### 5. Send it

**What:**
- Sign in, open the form (Part C), and fit Part A's answers to its fields
  without changing what they say.
- Name the production app first and the test build second (Q2). Whether one
  request can name more than one identifier is to be verified when A-02
  exists. **If the form takes only one, send two requests, production first,**
  each with the same Part A.
- Put the AS's details **into the form only, never into this repository**.
- If the form asks for something Part A does not answer, **stop and tell
  Claude**. Nothing is made up in the form either.

**Why:** every claim in Part A has a source (Part B), and changing it in the
form would lose that. Production goes first so the test build's request can
never hold up production's. The repository is public, so the AS's details stay
out of it.

### 6. Record it

**What:** write the date or dates sent in the owner to-do row for this request
in [`README.md`](README.md). When Apple answers, record the answer for each
identifier as a decision (`/decision`).

**Why:** so the sending and its outcome cannot be lost, and Part E starts from
a recorded answer.

### 7. The deadline: M4 at the latest

**What:** send as early as possible once steps 1 to 4 are done (D-020), and by
M4 at the latest (the owner, 2026-10-01; the roadmap's M4 row).

**Why:** approval can take weeks (finding 10, a forum report), and the roadmap
revisits the outcome before M5.

### 8. No transfer, ever

**What:** the app stays on the AS's team (D-027).

**Why:** a transfer would probably need a new request (finding 10, one
developer's report on Apple's forum). The GitHub repository's possible move
(D-029) has nothing to do with Apple.

## Part E — after Apple answers, and what the app then needs

Listed so it is not lost. **None of it is STORE-01's work.** Each item is M3
or M4 work, outside STORE-01.

### Each outcome

- **Approved:** the work below becomes part of GRP-04's and REL-06's work in M3
  or M4.
- **Refused:** nothing is removed. The lost-contact alert stays at Time
  Sensitive (D-020). The readiness status shows walkers which responders
  cannot receive break-through alerts (GRP-04). The roadmap revisits the
  outcome before M5. What a refusal leaves open: a responder's iPhone set to
  silent may not sound at night, and the SMS escalation reaches the same
  silenced phone (the spec's R1). Finding 10 reports, from Apple's forum, one
  refusal turned into approval by a narrower request; whether to try that is
  the owner's choice.
- **No answer by the start of M5:** treated as not approved until it comes.
- **Only one of the two identifiers approved:** production's answer decides
  what the group gets. Without the test build's approval, L9 cannot show a
  Critical Alert on a real iPhone, and the owner is told before go-live,
  because D-041 asks L9 to pass first.

### The work, once approved

1. **The builds carry the entitlement,**
   `com.apple.developer.usernotifications.critical-alerts`, for the production
   identifier and the `.test` identifier. This goes in
   `apps/mobile/app.config.ts`, which is code-owned (owner approval). How the
   App IDs' capability is switched on, and how EAS's provisioning profiles
   pick it up, are to verify. Which of the plan's app variants (D-046) carries
   the `.test` identifier is for L9's planning to settle. If that build would
   also be used to show the app, the owner is told before it ships, because
   Part A says the test build is for testing this alert (the spec's R14).
   *M3 or M4, outside STORE-01.*
2. **Responder setup requests the `criticalAlert` authorisation,** in responder
   setup only: never at first launch, and never on the walker's own path.
   Expo's notification library can request it (finding 10, a forum source); to
   verify at M3. *M3 or M4, outside STORE-01.*
3. **Readiness reflects the level granted.** Each device reports whether it can
   receive Critical, Time Sensitive or neither, so the walker sees it (GRP-04).
   The data model sketch in `05-architecture.md` already gives the `devices`
   table an "alert readiness" field. *M3 or M4, outside STORE-01.*
4. **The server sends the lost-contact alert at the `critical` interruption
   level** to iOS devices that granted it, and no other message at that level.
   The payload stays content-free (C15). Its keys, and the rules for a
   critical sound and its volume, are to verify against Apple's push
   documentation. *M3 or M4, outside STORE-01.*
5. **Time Sensitive is the path** for a refused entitlement, a declined
   permission, the call-sharing notice to #1 (Q1), and any build whose
   identifier the request does not name. Whether the App ID needs the Time
   Sensitive capability is to verify. *M3 or M4, outside STORE-01.*
6. **Tests that hold Part A's promises, written in M3** (named there, not
   here):
   - only the lost-contact message carries the critical level (L2 or L6);
   - each responder gets it once per lost-contact event, with SMS, not further
     alerts, when nobody acknowledges (L2 or L6);
   - the permission is requested only in responder setup (L5 or L7);
   - readiness follows the granted level (L5).

   *M3 or M4, outside STORE-01.*
7. **L9 on a real iPhone, with the `.test` build:** the permission states for
   Critical Alerts (`06-testing-strategy.md`, L9), and RR-01's closest
   automated check: the alert was sent at the critical level and the
   permission was granted. This is what the test build is in the request for
   (C20). *M3 or M4, outside STORE-01;* L9 itself runs in M5 (D-041).
8. **Android, for completeness:** post the alert with `CATEGORY_ALARM`
   (D-086). It has nothing to do with Apple's request. *M3 or M4, outside
   STORE-01.*

**Flagged for the canary rule's own spec (REL-10).** If the canary's test
responder were a person's iPhone at the critical level, it would break through
silence at every canary run, and Part A's picture of rarity would be wrong. So
that spec should keep its test responder from being a person's phone at the
critical level (the spec's R7). This is a flag, not a change to the canary.
