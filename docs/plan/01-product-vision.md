# 1 · Product vision, users & MVP scope

**Status:** ✅ Done · **Last updated:** 2026-09-20

**MVP user stories:** [01b-mvp-scope.md](01b-mvp-scope.md)

## Summary
- **Who:** a private group of friends and family (12+) first (D-004, D-009).
  SSB data says young women aged 16–24 are the group most afraid when walking
  alone, so the group should include them.
- **Problem:** people want someone they trust to know where they are and to
  notice quickly if something goes wrong.
- **MVP** (D-005, D-007, D-010, D-011; stories in
  [01b-mvp-scope.md](01b-mvp-scope.md), approved in D-012):
  - one tap to call your #1 contact, which also shares your live location with them;
  - journeys that share your location with chosen group members, ended with
    "I'm home" or an automatic stop;
  - a server-side lost-contact alert if the phone goes silent;
  - 112 always one tap away.
- **Responders:** group members act as volunteers for each other (D-008).
  Everyone who gets alerts has the app (D-013).
- **Differentiation:** a cross-platform tool for a mixed iPhone/Android group,
  built to fail loudly instead of silently.
- **Languages:** bokmål first, then English, then nynorsk (D-014).
- **Out of the MVP:** see "Parked" in `01b-mvp-scope.md`.

## Goal of this section
Agree on who the app is for, which problem it solves, what the first version
(MVP) contains, what is explicitly out, and how we will know it works.

## Problem statement (draft)
Walking home alone late in the evening — especially in Norway's long, dark
autumn and winter — makes many people feel exposed. What people want is
simple: **someone I trust knows where I am, and will notice quickly if
something goes wrong.** The hard part is not sharing a location; it is reliably
*noticing* a problem, even if the phone dies, is taken, or loses signal.

## Research findings — round 1

### 1. Norway's emergency system already locates callers
- Norway's telecom regulator (Nkom) describes AML (Advanced Mobile Location):
  modern phones automatically send their position to the emergency centre when
  you call 110, 112 or 113, with no app required, and it is in operation across
  most of the country. Position is only sent while the emergency call is active.
  Source: https://nkom.no/aktuelt/forbedret-posisjonering-av-nodsamtaler-fra-mobiltelefon
- **Implication:** Our SOS should be "one tap to call 112" and let the phone's
  built-in AML do the locating. We should not build our own channel to the
  emergency services.

### 2. Texting emergency services is not an option for general users
- Nød-SMS to 110/112/113 exists, but it is a service for registered deaf,
  hard-of-hearing and speech-impaired people.
  Source: https://nkom.no/telefoni-og-telefonnummer/nodnummer-nodanrop-og-lokalisering
- **Implication:** Silent alerts (when you can't talk) must go to the user's
  personal contacts, not to 112.

### 3. "Hjelp 113" is already the national emergency app
- Norsk Luftambulanse's app gathers all emergency numbers, shows your
  coordinates and nearby defibrillators, and reports about 2.7 million
  downloads. Source: https://norskluftambulanse.no/hjelp/
- **Implication:** Don't compete on "call the right emergency number". Our job is
  the part *before* an emergency: the walk itself, and friends noticing.

### 4. The classic safety-app feature set already exists — and was born in Norway
- bSafe was launched in 2011 by the Norwegian company Bipper. It offers
  guardians, a "Follow Me" live trace, a timer that alerts guardians if you
  don't check in, SOS with audio/video, and fake calls. It was relaunched under
  new ownership in 2019 and is freemium.
  Sources: https://www.prnewswire.com/news-releases/take-safety-into-your-own-hands-with-free-new-bsafe-app-135093883.html ·
  https://localsinsider.com/apps/app-with-personal-safety-features-sos-alerts-and-live-tracking-bsafe-review-pricing/
- **Implication:** A feature list alone won't differentiate us. Reliability,
  simplicity, Norwegian focus and social design have to.

### 5. Apple's built-in "Check In" is strong — but iPhone-only
- iOS Check In (Messages) tells a contact when you arrive, and alerts them with
  your location, battery and signal if you don't; it can also prompt you when
  you're delayed. It lives inside iMessage.
  Sources: https://www.stuff.tv/features/what-is-apple-check-in-the-new-are-you-home-yet-messages-feature-explained ·
  https://www.whistleout.com/CellPhones/Guides/how-to-use-iphone-check-in
- **Verified (round 3):** Apple's own guide says Check In needs iOS 17 or
  later on both the sender's and the recipient's phone — iPhone to iPhone only.
  Source: https://support.apple.com/guide/iphone/use-check-in-iphc143bb7e9/ios
- **Verified (round 3):** Google's Personal Safety app has Safety Check: a timer
  that starts emergency location sharing if you don't respond. The app is on all
  Pixels and, since it stopped being Pixel-only, on some other Android phones
  (Android 12+). Samsung has its own SOS feature.
  Sources: https://play.google.com/store/apps/details?id=com.google.android.apps.safetyhub&hl=en_IN ·
  https://www.androidauthority.com/personal-safety-app-3463214/ ·
  https://www.androidpolice.com/pixel-personal-safety-app-explainer/
- **Conclusion:** Each platform's built-in tool is tied to its own ecosystem and
  built for one person and their contacts. A friend group with mixed phones has
  no shared tool where everyone sees the same thing.
- **Implication:** A cross-platform check-in that works for a *group* of friends
  is a plausible gap.

### 6. A Norwegian crowdsourced approach has been tried
- Flare, built by NTNU students in Trondheim, alerted all app users within a
  set radius when someone pressed "help", and partnered with Faddervakt,
  Natteravnene and the police. The team had to address misuse, prank alarms and
  vigilantism risk (they required phone-number verification).
  Source: https://norwegianscitechnews.com/?p=44773
- **Implication:** Stranger-to-stranger help depends on many nearby users and
  brings misuse and liability problems. Not an MVP feature. Organisations like
  Natteravnene and student welfare groups are potential distribution partners.

### 7. Who feels unsafe
- In SSB's living-conditions surveys (1997–2004 data), women were more than four
  times as likely as men to report worry about violence or threats when walking
  alone where they live (14.2 % vs 3.4 %).
  Source: https://www.ssb.no/sosiale-forhold-og-kriminalitet/artikler-og-publikasjoner/i-familiefasens-vold
- **Current figures (2023):** In SSB's 2023 survey, more than 18 % of women
  aged 16–24 had recently felt afraid of violence or threats, against just over
  4 % of men the same age. Almost all of the recent increase was in this group
  of young women. The survey question asks specifically about walking alone
  where you live.
  Sources: https://www.ssb.no/sosiale-forhold-og-kriminalitet/kriminalitet-og-rettsvesen/statistikk/utsatthet-og-uro-for-lovbrudd-levekarsundersokelsen/artikler/flere-opplever-vold-og-trusler ·
  https://www.ssb.no/sosiale-forhold-og-kriminalitet/artikler-og-publikasjoner/vold-og-trusler-i-20-aar
- **Implication:** Young women are the group most likely to want this app. The
  private friends-and-family group is a good test bed, but we should check it
  includes people from this group.

### 8. Norway-specific risks beyond crime
- **Hypothesis (to verify in Section 2):** Late-night risk in Norway also
  includes ice, falls and cold — e.g. an intoxicated person sitting down on the
  way home in winter. A "did they get home?" check covers these cases too,
  which crime-focused apps don't emphasise.

## Research findings — round 2

### 9. "Private group first" fits Google Play's rules for new accounts
- Google Play requires personal developer accounts created after 13 Nov 2023
  to run a closed test with at least 12 testers, opted in continuously for 14
  days, before they can apply for production access. Organisation accounts are
  outside that stated scope.
  Source: https://support.google.com/googleplay/android-developer/answer/14151465?hl=en
- **Implication:** The private-group phase can double as this gate, if the
  group has at least 12 Android users (or we recruit extra Android testers).
  On iOS the equivalent route is TestFlight. Details in Section 8.

### 10. "One tap" may be two taps on iPhone
- **Hypothesis (verify in the Section 4 spike):** iOS asks the user to confirm
  before an app starts a phone call, while Android can place a call directly if
  the app has the call permission. The button design must work either way.

## Key product insight
The feeling of safety comes from *being noticed*, not from a panic button. So
the MVP's core is a **journey with an automatic safety net**: if you don't
arrive, don't respond, or your phone goes silent, your people find out —
automatically. The "phone goes silent" case means the watchdog must run on a
**server**, not on the phone. This is the most important requirement for
Section 3 and the stack choice.

## Candidate features

| Feature | What it does | Proposed |
|---------|--------------|----------|
| Journey ("Walk me home") | Set destination; app detects arrival; if overdue it asks "Are you OK?", then alerts contacts | **MVP** |
| Lost-contact watchdog | Server alerts contacts if the phone stops reporting during a journey (battery, theft, no signal) | **MVP — non-negotiable** |
| SOS | One action calls 112 (AML locates you) and alerts contacts with your position | **MVP** |
| Live location during journey | Chosen contacts can follow you until you arrive; stops automatically | **MVP** |
| Group "Everyone home?" | A friend group after a night out sees each person's status until all are home | **MVP candidate — likely differentiator** |
| Discreet trigger (button presses, voice, shake) | Raise an alarm without unlocking the phone | Later — platform limits, false alarms |
| Fake incoming call | Excuse to leave an uncomfortable situation | Later |
| Audio/video recording | Evidence capture during SOS | Out for now — legal/privacy check in Section 2 |
| Nearby-helper network | Alert strangers nearby | Out — network effect, misuse, liability |
| Safer-route suggestions | Lit streets, open places, taxi ranks | Later — data availability unknown |
| Smartwatch support | Trigger/check-in from watch | Later |

## Explicitly out of scope (proposed)
- Replacing or intermediating emergency services.
- A professional 24/7 monitoring centre.
- Any way to track someone without their ongoing, visible consent. The app
  must not become a tool for controlling a partner or family member.

## Draft success measures
- Share of journeys that end in a confirmed arrival with no false alarm.
- False-alarm rate, and time from missed check-in to contact notified.
- Zero silent failures in safety-critical flows (tracked in Section 3).
- Crash-free sessions; users who start a second journey within 30 days.

## Open questions for the owner

**Round 3 (asked 2026-09-20, answered):**
1. What should happen when the walker taps "call #1", besides the call?
   (Recommendation: also share the walker's live location with #1, if #1 is in
   the group.)
2. How does a journey end? (Recommendation: the "I'm home" button, plus
   automatic end on reaching a saved home address.)
3. Do the MVP user stories in `01b-mvp-scope.md` look right? Approving them
   closes Section 1.

**Round 2 (asked 2026-09-20, answered):**
1. Should the MVP include an automatic safety net? (Recommendation: at least a
   lost-contact alert — see round 1 outcome for why.)
2. Who are the volunteers in the "volunteer network"? (Recommendation: members
   of the private group, acting as responders for each other.)
3. Who is in the first private group, and roughly how many? (Needed for device
   mix, the Play testing rule, and whether volunteers make sense.)

**Round 1 (asked 2026-09-20, answered):**
1. Which features belong in the MVP? (Recommendation: journey + watchdog + SOS
   + live location; add group "Everyone home?" if you want a clear
   differentiator.)
2. Who responds when something is wrong? (Recommendation: the user's own
   contacts only.)
3. What is the launch ambition? (Recommendation: a free public app in Norway,
   which keeps the bar high without the complexity of payments.)

**Later rounds (no need to answer yet):**
- Working name for the app.
- App languages: bokmål only, or bokmål + nynorsk + English?
- Minimum age. (Section 2 will check Norway's age rules for consent.)
- Budget for running costs (servers, SMS, maps).
- Do you already have Apple Developer and Google Play developer accounts?
- Any launch city or partner in mind (a student welfare organisation, a city)?

## Rounds

### Round 1 — 2026-09-20
- **Questions:** MVP features · who responds · launch ambition.
- **Answers (owner):**
  - MVP: "One-tap call #1 on your list. Share location for the journey."
  - Responders: contacts + volunteer network.
  - Launch: small private group first.
- **Claude's reading:** The MVP is (a) one tap to call the user's #1 (primary)
  contact, and (b) sharing location with contacts for the length of a journey.
  The group "Everyone home?" feature and the automatic safety net were not
  selected. *Alternative reading:* "#1 on your list" meant option 1 (journey +
  safety net). Round 2, question 1 settles this either way.
- **Concerns and proposals from Claude:**
  1. **Location sharing alone can fail silently.** If the phone dies or is
     taken, the dot on the map just stops moving, and a contact who looked away
     won't notice. That breaks principle 1 ("fail loudly"). Proposal: at minimum
     a server-side *lost-contact alert* that notifies contacts when the phone
     stops reporting during a journey.
  2. **Calling a friend is not the same as calling 112.** Proposal: the big
     button calls the #1 contact; 112 is always visible on the same screen, one
     tap away. What happens if #1 doesn't answer is decided in the MVP user
     stories.
  3. **The volunteer network needs a definition.** Volunteers from an
     organisation or nearby strangers bring vetting, liability and misuse
     problems (see finding 6) and legal questions for Section 2. Members of the
     private group helping each other avoids most of that.
- **Outcome:** D-004 (launch), D-005 (MVP core), D-006 (responders) recorded.
  Safety net and volunteer definition open → round 2.

### Round 2 — 2026-09-20
- **Questions:** safety net in MVP · who the volunteers are · first group.
- **Answers (owner):** lost-contact alert only · members of the private group ·
  friends & family, 12 or more.
- **Outcome:** D-007, D-008, D-009 recorded. Claude drafted MVP scope v1 as user
  stories with acceptance criteria (`01b-mvp-scope.md`), verified the Apple and
  Google findings, and added the 2023 SSB figures.

### Round 3 — 2026-09-20
- **Questions:** extra behaviour of "call #1" · how a journey ends · approve
  the MVP stories.
- **Answers (owner):** also share live location with #1 · "I'm home" button
  only · stories look right, close Section 1.
- **Outcome:** D-010 to D-014 recorded. CALL-03 written, JRN-07 parked, the
  proposed defaults accepted. Section 1 closed.

## Next steps
Section closed. Continue in [02-norway-law-privacy.md](02-norway-law-privacy.md).
