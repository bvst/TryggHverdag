# 2 · Norway context: emergency services, law & privacy

**Status:** ✅ Done · **Last updated:** 2026-09-20

> **Not legal advice.** This is a planning-level overview written by Claude,
> which is not a lawyer. It is enough to design the MVP responsibly. Before any
> public launch, a Norwegian privacy lawyer should review it.

## Summary
- GDPR is followed fully from day one, even in the private phase (D-015).
- A DPIA is required and must be written before the group starts (PRIV-11).
- Personal data is stored inside the EEA (D-016).
- Minimum age is 13, with extra safeguards for members under 18 (D-017,
  PRIV-12).
- Twelve privacy requirements, PRIV-01 to PRIV-12, are binding (D-018).
- **Before any public launch:** a Norwegian privacy lawyer reviews the legal
  basis, the treatment of minors, and the DPIA. The status of the proposed
  15-year age limit is checked at the same time.

## Goal of this section
Know which rules apply to the private MVP and to a later public app, and turn
them into concrete, testable requirements for the build.

## Emergency services — already covered
Section 1 established that phones send their position to the emergency centre
automatically (AML) when calling 110/112/113; that emergency SMS is limited to
registered users; and that Hjelp 113 already covers "call the right number".
These are reflected in CALL-02. Nothing further to decide here.

## Research findings — round 1

### 1. Does GDPR apply to a private friends-and-family app?
- GDPR does not apply to "purely personal or household" activity.
- **Claude's assessment (not legal advice):** A server-based service that the
  owner runs for 12+ people, deciding how their location data is processed, is
  at best a grey zone. It becomes clearly covered the moment the group grows or
  the app goes public.
- **Recommendation:** Build as if GDPR applies from day one. At this size it
  costs little, retrofitting privacy later is expensive, and it is needed for
  the public app anyway. The owner is the data controller (personally, or
  through a company if one is formed).

### 2. A DPIA (data protection impact assessment) is required
- Datatilsynet's list of processing that always requires a DPIA includes
  processing location data combined with at least one other risk criterion.
  Datatilsynet also recommends doing one whenever it is unclear.
  Source: https://www.datatilsynet.no/rettigheter-og-plikter/virksomhetenes-plikter/vurdering-av-personvernkonsekvenser/nar-ma-man-gjennomfore-en-vurdering-av-personvernkonsekvenser/
- Our app processes location data *and* follows people continuously during a
  journey (systematic monitoring), and may include minors. That is at least two
  criteria.
- **Implication:** A DPIA must be written before the private group starts using
  the app. For 12 people it can be short, but it must exist. Claude can draft it
  once the architecture is known (after Section 5).

### 3. Legal basis — proposal
- **Proposal (verify with a lawyer before public launch):**
  - The walker's location during a journey they start themselves, and
    responders' names, phone numbers and notification tokens: *necessary to
    provide the service the user asked for* (GDPR art. 6(1)(b)).
  - Anything optional (for example crash reports beyond the strictly necessary):
    *consent* (art. 6(1)(a)).
- This keeps consent pop-ups to a minimum and makes the rules for each data
  type clear.

### 4. Age limits
- Today, Norway's age limit for a child to consent to online services is 13
  (personopplysningsloven § 5). Below that, parents must consent. It only
  applies when consent is the legal basis.
  Source: https://stortinget.no/no/Saker-og-publikasjoner/Vedtak/Beslutninger/Lovvedtak/2017-2018/vedtak-201718-054/
- The government has proposed raising this limit from 13 to 15, requiring
  parental consent for 13–14-year-olds as well. **Status of the change to be
  checked before any public launch.**
  Source: https://www.regjeringen.no/contentassets/5e962c4eb5d94132a7c53ba849f4fe34/horingsnotat-forslag-til-endringer-i-personopplysningsloven-aldersgrense-for-barns-samtykke-ved-bruk-av-informasjonssamfunnstjenester-sosiale-medier-mv..pdf
- Minors' data counts as "vulnerable data subjects" in a DPIA, which raises the
  bar for security and clear information.

### 5. Children, privacy and control
- Datatilsynet's director has stressed that being able to move freely without
  being controlled matters for children too, and has been sceptical of parents
  tracking their children.
  Source: https://www.tek.no/nyheter/nyhet/i/K3e1Wo/6-av-10-norske-foreldre-synes-det-er-greit-aa-spore-barna
- **Implication:** This supports principle 3 in the working agreement. Only the
  walker can start sharing their own location. There is no "parent mode" where
  someone else switches tracking on.

### 6. Hosting outside the EEA is legal today, but uncertain
- The EU–US Data Privacy Framework (which also applies in Norway via the EEA)
  was upheld by the EU General Court in September 2025. The ruling was appealed
  to the Court of Justice in October 2025, and no hearing date had been set by
  mid-2026. The Court of Justice struck down both previous EU–US frameworks.
  Sources: https://secureprivacy.ai/blog/is-the-eu-us-data-privacy-framework-at-risk-the-ftc-ruling-explained-2026 ·
  https://iapp.org/news/a/european-general-court-dismisses-latombe-challenge-upholds-eu-us-data-privacy-framework
- **Implication for Section 4:** Keeping personal data (especially location)
  with a provider and region inside the EEA removes this risk entirely. A US
  provider with an EU region is legal today, but needs a plan B.

### 7. Norway's new "cookie" rule also affects app SDKs
- Since 1 January 2025, the new ekomloven § 3-15 requires GDPR-grade consent
  for storing or reading information on a user's device, unless it is strictly
  necessary. Datatilsynet and Nkom share supervision.
  Source: https://www.securityworldmarket.com/no/Nyheter/Bedriftsnyheter/nye-cookie-regler-fra-1-januar
- **Claude's understanding:** This covers apps as well as websites, so
  analytics, advertising and many crash-reporting SDKs need opt-in consent.
- **Implication:** No third-party analytics or advertising SDKs in the MVP.
  Crash reporting is either built to be strictly necessary or made opt-in —
  decided in Section 4.

### 8. Store rules for background location
- Apple and Google both have their own review rules for apps that use location
  in the background. **To research in Section 4** (they affect the stack), and
  again in Section 8 (store submission).

## Privacy requirements (binding — D-018)
Tests and reviews reference these IDs.

| ID | Requirement |
|----|-------------|
| PRIV-01 | Location is collected only while a journey is running (including one started by CALL-03). Never in the background otherwise. |
| PRIV-02 | Only the walker can start sharing their own location. No one can switch on tracking for someone else. |
| PRIV-03 | Only the responders on a journey can see it, and only while it runs. |
| PRIV-04 | Retention: precise positions deleted ⚙️ 24 hours after a journey ends; alert records (who was alerted, when, last known position) deleted after ⚙️ 30 days; account data deleted when a member leaves. Deletion is automatic and tested. |
| PRIV-05 | Personal data is stored inside the EEA, with a provider and region chosen in Section 4 (D-016). |
| PRIV-06 | No third-party analytics or advertising SDKs. Any optional data collection is opt-in. |
| PRIV-07 | Logs and error reports never contain precise locations or phone numbers. |
| PRIV-08 | Encryption in transit and at rest. |
| PRIV-09 | Users can see, export and delete their own data from within the app. |
| PRIV-10 | A plain-language privacy notice in bokmål, shown before the first journey. |
| PRIV-11 | A DPIA is written and kept in `docs/` before the private group starts. |
| PRIV-12 | Members under 18 (D-017): the admin records only an age band at invitation (under 15 / 15–17 / 18+), never a birth date. Members under 18 join with a parent's or guardian's knowledge — this gives the parent **no** access to their location (PRIV-02 still applies). Consent-based features stay off for members under 15, so the app stays compliant if the age limit rises to 15. The privacy notice has a version written for teenagers. |

## Open questions for the owner

**Round 1 (asked 2026-09-20, answered):**
1. How strict should the private phase be? (Recommendation: full GDPR from day
   one, as argued in finding 1.)
2. Where should personal data live? (Recommendation: inside the EEA — finding 6.)
3. What is the minimum age for the group? (Recommendation: 15+. It works under
   both today's rule and the proposed one, and avoids building a parental
   consent flow.)

**Moved to Section 8:**
- Will the owner act as a private person or set up a company? This decides who
  the GDPR controller is, and also which kind of Apple and Google developer
  accounts to create.

## Rounds

### Round 1 — 2026-09-20
- **Questions:** strictness in the private phase · where data lives · minimum
  age.
- **Answers (owner):** full GDPR from day one · inside the EEA · 13+.
- **Claude's note on 13+:** Claude recommended 15+. 13+ is valid under today's
  rule. The added safeguards in PRIV-12 keep it workable if the limit rises to
  15, and minors raise the bar in the DPIA.
- **Outcome:** D-015 to D-018 recorded. PRIV-12 added. Section 2 closed.

## Next steps
Section closed. Continue in
[03-safety-reliability-security.md](03-safety-reliability-security.md).
