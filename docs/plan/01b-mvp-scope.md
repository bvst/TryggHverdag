# 1b · MVP scope v1 — user stories & acceptance criteria

**Status:** ✅ Approved v1 (D-012), amended by D-019 to D-021 and D-034 · **Last updated:** 2026-09-20
**Based on:** D-004 to D-014, D-019 to D-021, D-034

## How to read this
- Every story has a **stable ID** (e.g. `LOST-02`). IDs never change or get
  reused. Tests will carry the ID in their name, so we can always see which
  requirement a test protects and which requirements have no test yet. This is
  the backbone of regression tracking (Sections 6 and 9).
- **Must** = in the MVP. **Should** = in the MVP if it doesn't delay it.
- ⚙️ marks a placeholder number. It gets tuned in Section 3 and in the
  background-location spike in Section 4.
- Each story becomes a spec in `docs/specs/` in Section 9. Each acceptance
  criterion becomes at least one automated test.

## The MVP in one sentence
Invited friends and family can call their #1 contact with one tap, share their
location with chosen group members while walking home, and if their phone goes
silent during the walk, the group is alerted automatically.

## People
- **Walker** — the person on their way home.
- **Responder** — a group member who follows a walker's journey and receives
  alerts. Responders *are* the volunteer network (D-008).
- **Admin** — the owner, who invites and removes members.

---

## GRP — Group and setup

**GRP-01 · Join by invitation** (Must)
As an invited person, I can join the group from an invitation, so only people
the admin trusts are in it.
- Nobody can join without a valid invitation.
- An invitation works once and expires after ⚙️ 7 days.
- The admin can remove a member. A removed member immediately stops seeing any
  location and stops receiving alerts.

**GRP-02 · Choose my #1 contact** (Must)
As a walker, I pick my #1 contact, so the call button always knows who to call.
- #1 can be any phone number, in the group or not.
- The home screen shows who #1 is.
- If no #1 is set, the call button explains how to set one. It is never a dead
  button.

**GRP-03 · Safety permission check** (Must)
As a walker, I'm told clearly when something the safety features depend on is
switched off, so I never believe I'm protected when I'm not.
- Checked at app start and at journey start: location, background location,
  notifications, and (Android) battery optimisation.
- Each problem shows what will not work and a one-tap path to fix it.
- A journey cannot start in a silently degraded state.

**GRP-04 · Responder setup** (Must — D-020)
As a responder, I set up my phone so I will actually notice an alert at night.
- Setup asks for Critical Alerts on iPhone (if Apple grants the entitlement;
  otherwise Time Sensitive), and for the high-priority alert channel with
  permission to override Do Not Disturb on Android.
- The responder confirms the phone number used for SMS escalation (LOST-07).
- Each responder has an "alert readiness" status. When choosing responders, the
  walker sees who can't receive break-through alerts.

## CALL — One-tap call

**CALL-01 · Call my #1 contact** (Must)
As a walker, I tap one button to call my #1 contact.
- It is the largest element on the home screen and easy to hit one-handed with
  gloves (⚙️ minimum target size).
- Android: the call starts on the tap. iPhone: at most one system confirmation
  (to verify in the Section 4 spike).
- Works whether or not a journey is running.

**CALL-02 · 112 is always one tap away** (Must)
- The home screen and the journey screen always show a 112 button.
- It calls 112 through the phone's normal calling path, so AML sends the
  position to the emergency centre automatically.
- It is never hidden in a menu or behind a setting.

**CALL-03 · Calling #1 also shares my location with #1** (Must — D-010)
As a walker, when I call my #1 contact, they can also see where I am, so they
can help without asking.
- If #1 is a group member: tapping the call button also starts sharing my live
  location with #1. If no journey is running, a journey starts with #1 as
  responder (so LOST alerts and JRN-06 apply). If a journey is running, #1 is
  added to it.
- #1 gets a notification: "<name> is calling you and sharing their location".
- If #1 is not a group member, only the call happens, and the walker sees that
  location could not be shared with #1. Setup (GRP-02) recommends picking a
  group member as #1.
- Sharing started this way ends like any journey (JRN-05, JRN-06).

## JRN — Journey with shared location

**JRN-01 · Start a journey** (Must)
- Starts in at most 2 taps from the home screen.
- Shares with my default responders (group members I've chosen). I can change
  them before starting.

**JRN-02 · Sharing is always visible** (Must)
- While a journey runs, the phone shows it at all times (Android: persistent
  notification; iPhone: system indicator — exact mechanism chosen in Section 4).

**JRN-03 · What responders see** (Must)
- Position on a map, time of the last update, and battery level.
- If the last update is older than ⚙️ 2 minutes, the map says so plainly
  ("last seen 4 min ago") instead of showing a normal-looking dot.

**JRN-04 · Start and end notifications** (Must)
- Responders are notified when a journey starts and when it ends.

**JRN-05 · "I'm home"** (Must)
- One tap ends the journey. Sharing stops immediately, responders get
  "<name> is home", and the live position is no longer visible to anyone.

**JRN-06 · Journeys never run forever** (Must)
- After ⚙️ 2 hours the walker is asked to extend or end.
- If there is no answer within ⚙️ 10 minutes, the journey ends, sharing stops,
  and responders are told it ended without confirmation, so they can check in.

**JRN-07 · Automatic arrival** — ⛔ Parked (D-011). Journeys end with
"I'm home" (JRN-05) or the automatic stop (JRN-06). Because nothing detects
arrival, JRN-06 is the backstop against forgotten journeys; the private test
should measure how often it triggers.

## LOST — Lost-contact alert (runs on the server)

**LOST-01 · Heartbeat** (Must)
- During a journey the phone sends position and battery level at least every
  ⚙️ 60 seconds.

**LOST-02 · Lost-contact alert** (Must)
- If the server gets no heartbeat for 5 minutes (D-021), every responder on the
  journey is alerted with the last known position, time and battery level,
  plus the guidance in HELP-01.
- It works even if the phone is off, broken or out of coverage, because the
  server decides, not the phone.
- **The most important test in the project:** start a journey, silence the
  simulated phone, advance time, and assert that every responder was alerted.

**LOST-03 · Back in contact** (Must)
- When heartbeats resume, responders get "<name> is back in contact" with the
  current position.

**LOST-04 · Low battery warning** (Must)
- When the battery drops below ⚙️ 15 % during a journey, responders are told.
  This makes a later lost-contact alert easier to interpret.

**LOST-05 · The walker knows when they're offline** (Must)
- If the phone can't reach the server for ⚙️ 2 minutes, the walker sees
  "Offline — your group may get an alert", and the app keeps retrying.

**LOST-06 · "I'm on it"** (Must — D-019)
- A responder can mark an alert as "I'm on it", so other responders see that
  someone is handling it. This reduces the "someone else will call" effect.
- Acknowledging stops the SMS escalation in LOST-07.

**LOST-07 · SMS escalation** (Must — D-019)
- If no responder acknowledges a lost-contact alert within 2 minutes, every
  responder on the journey gets an SMS.
- The SMS says who and what happened and asks the responder to open the app.
  It contains no location (REL-12).
- Escalation stops as soon as anyone acknowledges.
- If an SMS can't be sent, the owner is alerted.
- Tests: with no acknowledgement, an SMS goes to every responder after
  2 minutes; with an acknowledgement at 1 minute, no SMS is sent.

**LOST-08 · "They're safe"** (Must — D-034)
As the responder who tapped "I'm on it", I can close a lost-contact alert once
I know the walker is safe.
- Only the responder who acknowledged can close the alert.
- Closing ends the journey (SM-06) and tells the other responders who closed it.
- If the walker's phone reconnects later, the walker sees that the journey was
  closed by that responder.

## HELP — Guidance for responders

**HELP-01 · What to do** (Must)
Every alert shows short guidance:
1. Call the person.
2. If they don't answer and you're worried, call 112 and give the last known
   position.
3. Don't put yourself in danger.

---

## Non-functional requirements (MVP)
- Safety-critical stories (CALL-01, CALL-02, JRN-03, JRN-05, JRN-06, LOST-01 to
  LOST-08) have automated end-to-end tests that run on every change.
- Battery: ⚙️ at most 10 % drain on a 45-minute journey (measured in the
  Section 4 spike).
- Dark-first design for night use (**hypothesis** — a bright screen draws
  attention in the dark).
- Accessibility: large targets, screen-reader labels, works with large text.
- Privacy: location is collected only during a journey. How long it is kept is
  decided in Section 2.
- All app text goes through translation files from day one; nothing is
  hard-coded.

## Parked — not in the MVP
- Group "Everyone home?" overview (D-005)
- Overdue check and "Are you OK?" prompts (D-007)
- Organisation volunteers and nearby strangers (D-008)
- Discreet triggers, fake call, audio/video recording, safer routes, smartwatch
- Automatic arrival detection (D-011)
- Web links for people without the app (D-013)
- Public store release (D-004)

## Defaults (accepted when Section 1 closed)
1. Everyone who follows journeys or gets alerts has the app (they are all group
   members). The #1 contact for calling can be any phone number. → D-013
2. App languages: Norwegian bokmål at launch, English next, nynorsk later. → D-014
3. The minimum age for the group is decided in Section 2, because a family group
   may include teenagers.
