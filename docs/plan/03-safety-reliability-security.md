# 3 · Safety, reliability & security requirements

**Status:** ✅ Done · **Last updated:** 2026-09-20

## Summary
- The worst failure is a missed alert. Ten failure modes (F1–F10) are mapped to
  required behaviour.
- Responders are alerted after **5 minutes** of silence (D-021). If nobody
  acknowledges within **2 minutes**, every responder gets an **SMS** (D-019).
- Alerts use Apple's **Critical Alerts** if Apple approves the entitlement, with
  Time Sensitive as the fallback. On Android they use a high-priority channel.
  Responders opt in during setup (D-020).
- A **canary journey** tests the real alert path in production every 15 minutes
  (REL-10).
- REL-01 to REL-12, SEC-01 to SEC-07 and the reliability targets are binding
  (D-022). Known limitation: someone with the walker's unlocked phone can end
  the journey (F10).

## Goal of this section
List every way the app's safety promise can break, decide how the app must
behave in each case, set measurable reliability targets, and write a first
threat model. The output is a set of REL and SEC requirements, plus the ⚙️
thresholds that Sections 4–9 must deliver.

## The promise we are protecting
> If you are on a journey and your phone goes silent, your group finds out —
> quickly, and in a way they will notice.

There are two ways to break it:
- **Missed alert:** something is wrong and nobody notices. This is the worst
  failure. It must be designed out, monitored and tested.
- **False alarm:** nothing is wrong, but the group is alarmed. One now and then
  is acceptable. Too many, and people start ignoring alerts or stop using the
  app — which leads back to missed alerts.

## Research findings — round 1

### 1. iOS does not restart an app that has been closed
- Apple's documented behaviour: if an app is terminated, by the user or by the
  system, iOS does not restart it for new location updates. Only region
  monitoring and the significant-change service can relaunch an app, and
  developers report that even these don't relaunch after a user force-quit.
  Sources: https://developer.apple.com/forums/thread/30044 ·
  https://developer.apple.com/forums/thread/701377
- **Implication:** Swiping the app away during a journey stops the heartbeats.
  To the server this looks exactly like a dead phone, so it needs its own
  handling (F4 below).

### 2. Android needs a location foreground service — necessary, not sufficient
- Apps targeting Android 14+ must declare a location foreground service type
  with the matching permission. Play Console requires a declaration of the use
  case; user-initiated location sharing (like "Find my friend") is one of the
  listed uses.
  Sources: https://developer.android.com/develop/background-work/services/fgs/service-types ·
  https://support.google.com/googleplay/android-developer/answer/13392821?hl=en
- Phone makers' own battery managers (Samsung, Xiaomi, Huawei, OnePlus) can
  still stop the service. Each needs its own user guidance, and a foreground
  service alone doesn't protect against that.
  Source: https://www.solutionbox.cz/en/blog/background-location-realne-telefony
- **Implication:** The permission check (GRP-03) needs per-manufacturer
  guidance. The Section 4 spike must test on the phone makers actually used in
  the group.

### 3. Alerts can be made to break through silent mode — with Apple's approval
- iOS has notification levels. *Time Sensitive* notifications break through
  Focus modes, if the user allows it, but respect the silent switch. *Critical
  Alerts* bypass both the silent switch and Focus, but need an entitlement from
  Apple, which is granted only for health, safety and security uses. Users must
  also opt in separately.
  Sources: https://newly.app/how-to/critical-alerts-entitlement ·
  https://documentation.onesignal.com/docs/en/ios-focus-modes-and-interruption-levels
- **Hypothesis (verify in Section 4):** On Android, a notification channel can
  bypass Do Not Disturb if the user allows it for that channel.
- **Implication:** Apply for Apple's Critical Alerts entitlement early. It is a
  genuine safety use, but approval isn't guaranteed, so Time Sensitive is the
  fallback.

### 4. Push delivery is best effort
- **Hypothesis (cite in Section 4):** Apple's and Google's push services don't
  guarantee delivery or timing. A lost-contact alert that relies on one push
  message alone can fail silently.
- **Implication:** For alerts, the system needs to know whether a human actually
  saw them. That means an acknowledgement, and escalation when nobody
  acknowledges.

## Failure modes

| ID | What goes wrong | Without mitigation | Required behaviour | Covered by |
|----|-----------------|--------------------|--------------------|------------|
| F1 | Battery dies | Silence | Lost-contact alert, with the earlier low-battery warning as context | LOST-02, LOST-04 |
| F2 | No coverage (tunnel, basement, lift, cabin) | False alarm | Phone queues positions and sends them on reconnect; "back in contact" message; threshold tuned for this | LOST-03, round 1 Q3 |
| F3 | Operating system kills the app | Silence while the walker is fine → false alarm | Permission and battery checks with per-manufacturer guidance; measured in the spike | GRP-03, REL-03 |
| F4 | Walker swipes the app away | Silence → false alarm, or false confidence | Reminder on the phone that protection stopped; responders alerted if the app isn't reopened | REL-04 |
| F5 | Location permission reduced during a journey | Heartbeats without position | Walker warned at once; responders told "location unavailable" | REL-05 |
| F6 | Alert not noticed (push delayed, phone on silent, responder asleep) | **Missed alert — the core promise fails silently** | Break-through notifications, acknowledgement, escalation | REL-06, REL-07, round 1 Q1–Q2 |
| F7 | Server or watchdog down | **No alerts at all** | Owner alerted by external monitoring; walkers told the safety service is unavailable | REL-08, REL-09 |
| F8 | A bad release breaks alerts | **No alerts at all** | Continuous production test of the alert path; release gates | REL-10, Sections 6 and 8 |
| F9 | Inaccurate position (indoors, between tall buildings) | Responders search in the wrong place | Show accuracy radius and time of each position | REL-11 |
| F10 | Someone else taps "I'm home" on an unlocked phone | False reassurance | **Known limitation in the MVP**, documented. A duress PIN is a possible later feature | — |

## Reliability requirements (binding — D-022)

| ID | Requirement |
|----|-------------|
| REL-01 | The lost-contact decision is made by the server, using the server's clock, never the phone's. |
| REL-02 | Positions recorded while offline are queued on the phone and sent in order when the connection returns. |
| REL-03 | The share of journeys interrupted by the operating system is measured per phone model during the private test. |
| REL-04 | While a journey runs, the app keeps a local reminder scheduled ⚙️ 2 minutes ahead and keeps moving it forward. If the app dies, the reminder fires: "Your journey protection stopped — open the app". If the app isn't reopened, the normal lost-contact alert follows. (**Hypothesis:** verify both platforms allow this in the Section 4 spike.) |
| REL-05 | If location access is lost during a journey, the walker is warned at once and responders see "location unavailable" instead of a frozen dot. |
| REL-06 | Lost-contact and SOS-related alerts to responders use the strongest notification level the platform and the responder allow (Critical Alerts on iOS if approved, else Time Sensitive; a high-priority channel on Android). |
| REL-07 | Alerts need acknowledgement ("I'm on it", LOST-06). If no responder acknowledges within 2 minutes, every responder on the journey gets an SMS (LOST-07, D-019). |
| REL-08 | External uptime monitoring checks the API and the watchdog every minute and alerts the owner within ⚙️ 5 minutes of a failure. |
| REL-09 | If the phone can't reach the safety service, the walker sees it straight away (extends LOST-05). |
| REL-10 | A **canary journey** runs in production every ⚙️ 15 minutes: a test walker goes silent, and the system must alert a test responder in time. If not, the owner is alerted immediately. |
| REL-11 | Every position shown to responders includes its accuracy and age. |
| REL-12 | Escalation SMS messages contain no location, because SMS is not encrypted. They say who and what happened, and point to the app. |

## Reliability targets (binding — D-022)
- **Alert time:** responders alerted within the lost-contact threshold plus
  60 seconds in at least 99 % of cases, measured by the canary (REL-10).
- **Missed alerts:** zero. Any missed canary alert stops all feature work until
  it is fixed and covered by a test.
- **False lost-contact alerts:** measured during the private test. Starting
  target: fewer than 1 per 20 journeys, then tuned.
- **Watchdog availability:** 99.9 % per month (about 43 minutes of downtime).

## Threat model — first version

**What we protect:** live location; short-lived journey records; group
membership and phone numbers; the ability to end journeys and to silence
alerts.

Mitigations are binding (D-022).

| ID | Threat | Mitigation |
|----|--------|---------------------|
| SEC-01 | Account takeover (stolen login code, SIM swap) | Login bound to the device. A login on a new device notifies the member and the admin. The admin can revoke sessions. |
| SEC-02 | An abusive group member, e.g. an ex-partner | The walker picks responders per journey and can remove anyone during a journey. Removal by the admin is immediate (GRP-01). Builds on PRIV-02 and PRIV-03. |
| SEC-03 | Server breach | Least-privilege access, secrets in a managed secret store, no production database access from personal laptops, and an audit log of admin actions. Builds on PRIV-04, PRIV-07 and PRIV-08. |
| SEC-04 | Leaked invitation | Invitations are single-use, expire (GRP-01), and are bound to the invited phone number. |
| SEC-05 | Admin (owner) account compromised | Strongest available login for the admin (passkey or hardware key). |
| SEC-06 | Vulnerable or malicious dependencies | Automated dependency and secret scanning on every change (Section 8). Keep dependencies few. |
| SEC-07 | Faked "I'm fine" heartbeats | Every request is authenticated per device, and the server validates what it receives. |

## Open questions for the owner

**Round 1 (asked 2026-09-20, answered):**
1. What happens when no responder acknowledges a lost-contact alert?
   (Recommendation: push first, then SMS after ⚙️ 2 minutes. SMS costs a
   little and needs an SMS provider inside the EEA. It also makes LOST-06
   "I'm on it" a Must.)
2. Should alerts try to break through silent mode and Do Not Disturb?
   (Recommendation: yes — apply for Apple's Critical Alerts, and each responder
   opts in during setup.)
3. How long should the phone be silent before responders are alerted?
   (Recommendation: 5 minutes, as a balance between speed and false alarms from
   tunnels and basements. The spike and the private test may adjust it.)

## Rounds

### Round 1 — 2026-09-20
- **Questions:** escalation · break-through alerts · lost-contact threshold.
- **Answers (owner):** push, then SMS after 2 minutes · apply for Critical
  Alerts · 5 minutes.
- **Outcome:** D-019 to D-022 recorded. LOST-06 is now a Must. New stories:
  LOST-07 (SMS escalation) and GRP-04 (responder setup). REL-12 added: SMS
  messages carry no location, to stay consistent with the privacy requirements.
  Section 3 closed.

## Next steps
Section closed. Continue in [04-tech-stack.md](04-tech-stack.md).
