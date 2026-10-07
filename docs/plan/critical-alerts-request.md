# Critical Alerts request — the draft and the owner's steps (STORE-01)

**Draft — not sent** · **Written:** 2026-10-01 · Spec:
[`../specs/STORE-01.md`](../specs/STORE-01.md) · Decisions: D-003, D-004,
D-005, D-007, D-008, D-009, D-013, D-014, D-016, D-019, D-020, D-021, D-022,
D-025, D-027, D-033, D-035, D-037, D-041, D-046, D-057, D-081, D-086, and the
owner's answers of 2026-10-01 to the spec's Q1 to Q4 (Q1's and Q4's become one
decision when STORE-01's records are updated; Q3's goes with it or on its own)

This file holds the text of the request to Apple for the Critical Alerts
entitlement, and the owner's steps for sending it. **Nothing here has been
sent.** Sending needs A-02, the AS's Apple Developer enrolment, and is due by
M4 at the latest.

**Where the details go:**
- **The AS's details go into Apple's form only,** never into this repository.
- **The two bundle identifiers are placeholders in this file.** Their values
  are recorded publicly, with `/decision`, at Part D, step 2.

**The parts:**
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
  Q1). The call notice to #1 stays Time Sensitive, and so does the warning that
  a journey has no responder left (Q4).
- No guarantee, no measured figure and no usage number. No SOS button: the MVP
  has none. Only the numbers the spec allows, each with its source (Part B).
- No answer points to another, by number or by place, because the answers may
  be split across the form's fields. A term is explained where Part A first
  uses it.
- It names no requirement or decision ID, because Apple does not know them.
  Part B maps every claim to its ID.
- It is in English, because it goes to Apple. D-014's bokmål-first rule is for
  app text.

## Part A — the request text

Each answer is short, because the form's length limits are unknown (Part C).
The numbered headings are topics, not the form's fields: fit the answers to
the fields without changing what they say (Part D, step 5). **Copy from the
rendered GitHub page, not the raw file,** which carries `**` and hard line
breaks.

---

**Start of the request text.** Copy from the next line down to "End of the
request text".

**1. The app and its developer**

The app will help people in Norway get home safely at night. A walker, the
person on their way home, will share their live location with group members
they choose, for one journey at a time. Those group members are the journey's
responders.

The app is in development and has no users yet. It will first be used by a
small private group of invited friends and family, at least 12 people, through
TestFlight.

It is developed by [the AS's name, as enrolled with Apple].

**2. The apps this request is for**

This request is for two builds of the same app:
- the production app, [production identifier];
- one test build of it, [production identifier].test.

The test build will be used for automated tests, on real iPhones, of the
lost-contact alert, which will go to a walker's responders when our server
stops hearing from the walker's phone. Those tests must pass before the group
relies on the app. It is not a demo.

**3. Why the app needs Critical Alerts**

During a journey, the walker's phone will report to our server regularly. If
the server hears nothing from it for 5 minutes, the server will alert the
journey's responders. The server will decide, not the phone, so the alert will
still go out when the phone is off, broken or out of coverage.

This alert will be how responders learn that a walker's phone went silent in
the middle of a journey. A missed alert is the failure the app is being built
to prevent.

The alert will matter most at night, when a responder's phone may be set to
silent or in a Focus. Apple's guidelines say a Critical notification can
override the Ring/Silent switch. That is why we are asking for Critical Alerts
for this one alert.

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

- The lost-contact alert will fire only during an active journey, and only
  after the server has heard nothing from the walker's phone for 5 minutes.
- Only that journey's responders will get it, once for each lost-contact
  event. If nobody taps "I'm on it" within 2 minutes, every responder will get
  an SMS instead of further alerts. The SMS will hold no location.
- The app will first be used by a private group of at least 12 people.
- Some alerts will be false alarms. To the server, a flat battery, no
  coverage, or the phone's system stopping the app will look the same as an
  emergency. Our starting target is fewer than one false lost-contact alert per
  20 journeys, and it will be measured while the private group uses the app.
- No alert has been counted yet, because the app is not in use. Alerts will be
  counted while the private group uses it.

These points are about the production app.

**7. Who receives it, and how they control it**

- Only responders will receive the lost-contact alert: members of the
  private, invitation-only group whom the walker chose for that journey.
  Nobody outside the group will.
- The app will ask for Critical Alerts only in responder setup, through iOS's
  own permission request. Each responder will decide for their own phone.
- A responder who declines will still get the strongest level they allow,
  usually Time Sensitive. When choosing responders, the walker will see who
  cannot receive break-through alerts.
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
| C1 | 1 | The app will help people in Norway get home safely at night. A walker will share their live location with group members they choose, for one journey at a time | `01b-mvp-scope.md`, "The MVP in one sentence"; D-003; D-005; JRN-01 | M3 |
| C2 | 1, 6 | In development, no users yet. First used by a small private group of invited friends and family, at least 12 people, through TestFlight | D-004; D-009; `10-roadmap.md`, M5 and M6 | M5, M6 |
| C3 | 1 | Developed by [the AS's name, as enrolled with Apple] | D-027 | A placeholder, filled in Apple's form only |
| C4 | 3, 4, 6 | During a journey the phone will report regularly. If the server hears nothing for 5 minutes, it will alert the journey's responders. Only during an active journey | LOST-01; D-021; LOST-02 | M2, M3 |
| C5 | 3 | The server will decide, not the phone, so the alert will still go out when the phone is off, broken or out of coverage | LOST-02; D-007 | M2 |
| C6 | 4, 5 | The lost-contact alert is the only notification that will use Critical Alerts. The notice to #1 when a walker calls them will use Time Sensitive | REL-06, as the owner's answer to Q1 settles it (a decision when STORE-01's records are updated); CALL-03 for the notice | M3, tested there (Part E, item 6) |
| C7 | 5 | The notifications that never will, by name, and that no other notification will | JRN-04; JRN-05; JRN-06; LOST-03; LOST-04; REL-05; LOST-06; LOST-08; CALL-03; REL-04; LOST-05; SM-02; SM-06; SEC-01; the owner's answers to Q1 and Q4 | M3 |
| C8 | 6 | Each responder alerted once for each lost-contact event. If nobody taps "I'm on it" within 2 minutes, every responder gets an SMS instead of further alerts, and the SMS holds no location | The state machine table in `05-architecture.md` (D-033); D-019; REL-07; REL-12 | M2 |
| C9 | 4 | When a responder opens the alert, the app will tell them what to do: call; if no answer and worried, call 112 with the last known position; do not put themselves in danger. It will not contact or replace emergency services | HELP-01; no story in `01b-mvp-scope.md` contacts emergency services; `01-product-vision.md`, "Explicitly out of scope" | M3 |
| C10 | 6 | Some alerts will be false alarms: a flat battery, no coverage or the system stopping the app looks the same to the server. Starting target: fewer than one per 20 journeys, measured while the private group uses the app. No alert counted yet | `03-safety-reliability-security.md`, F1 to F4 and the reliability targets (D-022); "no alert counted yet" follows from C2 | Measured in M6 |
| C11 | 7 | Only responders: members of the private, invitation-only group whom the walker chose for that journey. Nobody outside the group | D-008; D-013; GRP-01; JRN-01 | M3 |
| C12 | 7 | Asked for only in responder setup, through iOS's own permission request. Each responder decides for their own phone | D-020; GRP-04; Apple's documentation of the entitlement (an app that has it "can request" the `criticalAlert` authorisation, Part C) | M3 |
| C13 | 7 | A responder who declines still gets the strongest level they allow, usually Time Sensitive. The walker sees who cannot receive break-through alerts | REL-06; GRP-04 | M3 |
| C14 | 7 | Critical Alerts only as someone else's responder. Nothing about their own journey uses them | REL-06 ("alerts to responders") | M3 |
| C15 | 8 | The push message will carry no name, no location and no phone number; fixed text, such as "Safety alert — open the app". The responder opens the app to see who and where, from our server in the EEA | `04-tech-stack.md` finding 4 (the example text is its own); D-086 (content-free payloads); D-016; D-025 | M2, M3 |
| C16 | 8 | Straight to Apple's push service, no third-party relay. No analytics or advertising SDKs | D-086 (push straight to APNs and FCM); PRIV-06 | M3; tested in M4 (PRIV-06) |
| C17 | 8 | Location collected only during a journey the walker starts; the phone shows it is shared for as long as the journey runs | PRIV-01; JRN-02; the mechanism, as the spike's app used it: `04-tech-stack.md`, "Spike results" (`app.notification` on Android, `geolocation.showsBackgroundLocationIndicator` on iOS), and `04b-spike-results.md`, part 4.6 | M3; tested in M4 |
| C18 | 3 | The alert matters most at night, when a phone may be on silent or in a Focus. Apple's guidelines say a Critical notification can override the Ring/Silent switch | Apple's Human Interface Guidelines (Part C); `03-safety-reliability-security.md` finding 3 | — |
| C19 | 3 | This alert will be how responders learn a walker's phone went silent. A missed alert is the failure the app is being built to prevent | `03-safety-reliability-security.md`, "The promise we are protecting", and F6 | — |
| C20 | 2 | The request is for [production identifier] and one test build, [production identifier].test, for automated tests, on real iPhones, of the lost-contact alert, which will go to a walker's responders when our server stops hearing from the walker's phone. Those tests must pass before the group relies on the app. Not a demo | The owner's answer to Q2; D-041; D-035; `06-testing-strategy.md`, L9 ("permission states for Critical Alerts", "real push delivery to the phone") | M5 (L9) |

**Nothing in Part A falls outside C1 to C20.** Three wordings only explain a
term for a reader who does not know the plan: "the person on their way home"
(the walker, `01b-mvp-scope.md`, "People"), "their chosen #1 contact" (GRP-02)
and "the emergency number 112" (CALL-02, HELP-01).

**Part A's numbers, each with its source, and no other:**
- 5 minutes: D-021;
- 2 minutes: REL-07, from D-019;
- 24 hours: SM-06, binding under D-033, with no ⚙️;
- at least 12: the private group, D-009;
- fewer than one in 20: the starting target for false lost-contact alerts,
  D-022, and Part A calls it a target.

None of them is a ⚙️ setting. The first four change only with the owner. 112,
the "#1" of the #1 contact, and the counts that say what the request is (one
journey at a time, one notification, once for each event, two builds) are not
numbers in this sense.

**C5 never says "or taken".** The server alerts only on silence (D-007; LOST-02
says "off, broken or out of coverage"). A taken phone that keeps reporting
raises nothing, and someone holding the walker's unlocked phone can end the
journey (F10, a known limitation).

**C16 and C17 are built in M3.** M2 has only the fake push; real APNs comes in
M3, with the Apple push key (A-11). PRIV-06 and PRIV-01 are tested in M4 (the
roadmap's M4 row).

**C18 goes no further than Apple's own sentence.** Part A says Apple's
guidelines say a Critical notification "can override" the Ring/Silent switch,
never that it is "the one that" can. That Time Sensitive keeps to the silent
switch comes from third-party sources (finding 3), so Part A does not state it
as Apple's behaviour.

## Part C — Apple's form and Apple's words

### The form

<https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement/>

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
- **Relay the form's question, not its prefilled contact fields.**
- **If a video is asked for,** any video made uses synthetic names, phone
  numbers and positions only, and is kept out of the repository.

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
- the form's fields, length limits and attachments (above);
- whether one request can name more than one bundle identifier (above);
- whether the entitlement is granted per App ID or per team (finding 10 says
  per App ID, from a forum report);
- who in the AS's account may send it (above);
- how the App ID's capability and the provisioning profile change after
  approval;
- the push payload's keys for the critical level, and for its sound;
- whether APNs collapses a duplicate push by a collapse ID (Part E, item 6);
- whether Time Sensitive needs a capability enabled on the App ID;
- whether a registered App ID's identifier can be changed later;
- how long Apple takes;
- what iOS does with a critical-level push to a device that has not
  authorised critical alerts (Part E, item 4);
- whether iOS lets the app read which level the user granted. Part E's
  readiness (items 3 and 6) assumes it can.

**The L9 device farm, to verify too.** Whether the farm (Firebase Test Lab, in
M5, the roadmap's M5 row) can grant the critical permission on an iPhone and
receive real APNs pushes is unknown. If it cannot, the owner is told before
go-live, as in the spec's R14, because D-041 asks L9 to pass first.

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

**The identifiers become public.** Their values are recorded in
`docs/plan/decisions.md`, in the public repository, and later in
`apps/mobile/app.config.ts`. Under this rule they show the AS's domain. Choose
them knowing that.

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
- **Copy Part A from the rendered GitHub page, not the raw file.** The raw
  file carries `**` and hard line breaks.
- **If an answer does not fit a field, stop and tell Claude.** Never shorten
  it in the form.
- Name the production app first and the test build second (Q2). Whether one
  request can name more than one identifier is to be verified when A-02
  exists. **If the form takes only one, send two requests, production first,**
  each with the same Part A.
- The AS's details go **into the form only, never into this repository**: the
  D-U-N-S and organisation numbers, the address, contact names and email
  addresses.
- If the form asks for something Part A does not answer, **stop and tell
  Claude**. Nothing is made up in the form either. **Relay the form's
  question, not its prefilled contact fields.** If a video is asked for, any
  video made uses synthetic names, phone numbers and positions only, and is
  kept out of the repository.

**Why:** every claim in Part A has a source (Part B), and changing or
shortening it in the form would lose that. Production goes first so the test
build's request can never hold up production's. The repository is public, so
the AS's details, and anything copied from the form, stay out of it.

### 6. Record it

**What:**
- Write the date or dates sent in the owner to-do row for this request,
  **A-30**, in [`README.md`](README.md).
- When Apple answers, record **only its outcome** as a decision (`/decision`):
  approved, refused or partial for each identifier, the date, and any
  condition Apple sets.
- **Never** record Apple's message itself, or any name, email address or case
  number from it.

**Why:** so the sending and its outcome cannot be lost, and Part E starts from
a recorded answer. The repository is public, and the outcome is all the plan
needs.

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

## Part E — what the app needs once Apple answers

Listed so it is not lost.
- **None of it is STORE-01's work.**
- **The work follows approval,** except three items that say why: item 5 (the
  Time Sensitive path, needed whatever Apple answers), item 6 (the tests M3
  writes whatever Apple answers) and item 8 (Android, which has nothing to do
  with Apple's request).

### Each outcome

- **Approved:** the work below becomes part of GRP-04's and REL-06's work, in
  whichever milestone the answer arrives.
- **Approved late, in M5 or M6, after responders have done setup:** readiness
  flags the existing iPhone responders and offers them setup again. That is
  still "in responder setup", so C12 holds.
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

### The work

1. **The builds carry the entitlement,**
   `com.apple.developer.usernotifications.critical-alerts`, for the production
   identifier and the `.test` identifier. This goes in
   `apps/mobile/app.config.ts`, which is code-owned (owner approval). How the
   App IDs' capability is switched on, and how EAS's provisioning profiles
   pick it up, are to verify. Which of the plan's app variants (D-046) carries
   the `.test` identifier is for L9's planning to settle. If that build would
   also be used to show the app, the owner is told before it ships, because
   Part A says the test build is for testing this alert (the spec's R14).
2. **Responder setup requests the `criticalAlert` authorisation,** in responder
   setup only: never at first launch, and never on the walker's own path.
   Expo's notification library can request it (finding 10, a forum source); to
   verify.
3. **Readiness reflects the level granted.** Each device reports whether it can
   receive Critical, Time Sensitive or neither, so the walker sees it (GRP-04).
   The data model sketch in `05-architecture.md` already gives the `devices`
   table an "alert readiness" field. Whether iOS lets the app read which level
   the user granted is to verify (Part C); this item assumes it can.
4. **The server sends the lost-contact alert at the `critical` interruption
   level** to iOS devices that granted it, and no other message at that level.
   The payload stays content-free (C15). Its keys, and the rules for a
   critical sound and its volume, are to verify against Apple's push
   documentation. So is what iOS does with a critical-level push to a device
   that has not authorised critical alerts (Part C).
5. **Time Sensitive is the path** for a refused entitlement, a declined
   permission, the call-sharing notice to #1 (Q1), and any build whose
   identifier the request does not name. It is needed whatever Apple answers,
   so it does not wait for approval. Whether the App ID needs the Time
   Sensitive capability is to verify.
6. **Tests that hold Part A's promises, written in M3 whatever Apple
   answers.** Q1's rule (only the lost-contact alert is critical) and Q4's (the
   no-responder warning is not) bind either way, so these tests do not wait for
   approval. They are named in M3, not here; the decision that records Q1's
   and Q4's answers lists them, or points to this item, so M3 finds them. Each
   bullet names its carrier: the requirement whose test names carry it.
   - **Only the lost-contact message carries the critical level.** L6, with
     the recording push fake, over **every** message type the outbox can hold,
     so a notice added later (for example SEC-01's new-device notice, which
     comes in M4) cannot pick up the critical level unnoticed. Plus L2 for the
     pure rule. Carriers: REL-06, and the decision that records Q1's and Q4's
     answers.
   - **No notification the app schedules itself uses the critical level.**
     This covers the walker's reminder that protection stopped (REL-04), and
     any offline warning that becomes a local notification (LOST-05). Held by
     an L1 rule: no app module sets the critical interruption level or a
     critical sound; the notifications library's keys are to verify. Or by an
     L2 test on the safety core's reminder builder; only the L1 rule also
     covers a local notification built elsewhere. Carriers: REL-04 and REL-06.
   - **Exactly one lost-contact message per responder per event is written to
     the outbox, and the outbox's retries still deliver it.** A duplicate is
     collapsed (by a collapse ID, to verify), never avoided by skipping a
     retry. The collapse ID is opaque and per message, for example the outbox
     row's own random ID, never a walker, user or journey ID. **No further
     critical push follows the SMS:** C8 promises Apple an SMS "instead of
     further alerts". L6: time runs past the 2-minute SMS, through the resumed
     escalation (SM-10), and with the watchdog run twice, and the test still
     finds exactly one lost-contact message per responder. Carriers: LOST-02
     (its state-machine step that opens the alert and pushes to the
     responders), REL-07, LOST-07 and SM-10; plus AR-05 (the outbox) and AR-06
     (the watchdog), which are not tracked. **No gate enforces the untracked
     ones:** `req:coverage` asks for a test only for tracked requirements, and
     for an untracked one the test-name prefix is practice, not an obligation
     (D-074).
   - **The critical permission is requested only in responder setup.** An L1
     import rule: only the responder-setup module may request it, because L5
     and L7 can show that setup asks but cannot prove an "only". Plus L5 that
     setup asks. Carrier: GRP-04.
   - **Readiness follows the granted level.** L6: the level the server sends
     follows the level the device reports. Readiness is re-read at app start
     and when the app comes to the foreground, and a change is reported,
     because a responder can switch Critical Alerts off in Settings. The
     walker sees a responder with Time Sensitive only, and after a refusal
     every iPhone responder, as **not sounding on a silenced phone**.
     Readiness can go stale while a responder does not open the app (the
     GRP-04 flag below). Carrier: GRP-04, whose own spec decides how the
     app-side parts are tested.
   - **No push carries personal details, in its payload or its request
     headers.** L6, on what the push adapter builds, with the recording push
     fake, over **every** push message type the outbox can hold, headers
     included: no name, position or phone number, and no walker, user or
     journey ID. The collapse ID is checked here too. The lost-contact push
     holds only its fixed text. A notice whose plan text shows a name, such as
     the call notice to #1, gets the name on the phone (the CALL-03 flag
     below). The SMS messages are not pushes: LOST-07's SMS says who, and
     holds no location (REL-12). **Carrier: none tracked.** The source is
     D-086 (content-free payloads) and `04-tech-stack.md` finding 4.
   - **Push goes straight to APNs: no FCM and no Expo push token on iOS.**
     That is a "never", which L5 and L6 cannot prove, so it is held by an L1
     rule: no module asks for an Expo push token or sends through Expo's push
     service, and no iOS path uses FCM; the exact imports and calls the rule
     bans are to verify. Plus L5 or L6 that the iOS path registers the native
     APNs device token. Carrier: none tracked; the source is D-086 (push
     straight to APNs and FCM).
   - **The alert is distinct.** The critical sound at full volume, and a fixed
     lost-contact text different from every routine notice's. L6, on the push
     adapter's payload builder, with the recording push fake; the sound's keys
     and volume are to verify (item 4). Carrier: REL-06.
   - **No non-critical push sent while an alert is open displaces an
     undelivered critical one** (D-113's amendment, the owner, 2026-10-07).
     APNs stores one notification per app for an offline device, "in most
     cases the latest", so LOST-06's "someone is on it" notice could replace
     a responder's critical lost-contact push that has not yet arrived. M3's
     push task does not send that notice on a platform until this passes
     there: L9 on a real phone, offline when the critical push is accepted,
     then sent the notice, then online; and the reverse order, the notice
     accepted seconds before the critical push. Apple keeps the latest only
     "in most cases" and "may reorder notifications". A candidate on iOS is
     sending the notice with `apns-expiration` 0, which Apple says is
     delivered once and not stored; whether it still removes a stored one is
     what the device test decides. Android is gated the same way (the owner,
     2026-10-07): FCM's notification messages are always collapsible, so the
     test runs on a real Android phone too. If it can't be shown on a
     platform, the app shows the acknowledgement when opened instead.
     Carriers: LOST-06, REL-06.

   **"Instead of further alerts" is now a promise to Apple** (C8: no re-alert
   after the SMS). If the private phase shows that a single critical sound
   gets missed, re-alerting at the critical level changes what Apple approved,
   so Apple is asked again first.
7. **L9 on a real iPhone, with the `.test` build: M5** (the roadmap's M5 row;
   D-041 is the gate). The permission states for Critical Alerts
   (`06-testing-strategy.md`, L9), and RR-01's closest automated check: the
   alert was sent at the critical level and the permission was granted. This
   is what the test build is in the request for (C20). Whether the device farm
   can grant the critical permission and receive real APNs pushes is to verify
   (Part C); if it cannot, the owner is told, as in the spec's R14.
8. **Android, for completeness:** post the alert with `CATEGORY_ALARM`
   (D-086). It has nothing to do with Apple's request, so it does not wait for
   Apple's answer.

### Flags for other requirements' own specs

STORE-01 changes none of these requirements; each flag is for the spec that
will:
- **REL-10, the canary:** the canary never uses the critical level (the spec's
  R7). If it did, it would break through silence at every canary run, and
  Part A's picture of rarity would be wrong.
- **SM-02, the last-responder rule:** the no-responder state is loud on the
  walker's journey screen, and does not rely on a notification alone (the
  owner's answer to Q4; the spec's R15). It is the one walker-facing notice
  where missing it means a later silence alerts nobody. The decision that
  records Q1's and Q4's answers records this as a requirement on that rule's
  design.
- **GRP-04, the responder-setup story:** readiness can go stale while a
  responder does not open the app, because it is re-read only at app start and
  in the foreground (item 6). The walker's view shows how old a responder's
  readiness is, or treats old readiness as unknown; that spec chooses which.
- **CALL-03, the call-sharing story:** the call notice to #1,
  `"<name> is calling you and sharing their location"`, carries a name. The
  name is filled in on the phone, fetched from the EEA server or by a
  notification service extension, and never sent in clear (item 6's
  content-free test covers every push type).
