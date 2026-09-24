# Decision log

**Last updated:** 2026-09-20

Accepted decisions are binding for all sessions and agents. To change one, add a
new decision that supersedes it (see `00-working-agreement.md`).

---

## D-001 — Planning lives in the repo as Markdown
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 0
- **Context:** The owner will not write code; Claude Code does all the work
  across many sessions, and chat history is not a reliable memory.
- **Decision:** All planning material lives in `docs/plan/`. `README.md` is the
  entry point, this file is the decision log, and `CLAUDE.md` tells Claude to
  read both at the start of every session.
- **Consequences:** Every session must end by updating the section file and the
  status table.

## D-002 — All code is written by Claude Code; the owner decides and reviews
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 0
- **Context:** Owner has strong software experience but will not code on this
  project.
- **Decision:** Claude Code writes all code, tests and configuration, working
  through specialised subagents and skills (designed in Section 7). The owner
  approves specs and decisions.
- **Consequences:** Quality must be enforced by automation (tests, hooks, CI),
  not by memory or goodwill. This makes Sections 6–7 critical.

## D-003 — Platforms and market
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 0
- **Decision:** The app targets both iOS and Android. The launch market is
  Norway.
- **Consequences:** Norwegian emergency services, law and language shape the
  product (Section 2). Cross-platform delivery is a hard requirement for the
  stack choice (Section 4).

## D-004 — Launch with a small private group first
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 1
- **Context:** Owner chose a small private group over a public launch.
- **Decision:** The first release goes to a small, invited group, not the
  public app stores.
- **Consequences:**
  - Distribution through TestFlight (iOS) and a Google Play closed test.
  - Google Play requires new personal accounts to run a closed test with at
    least 12 testers for 14 continuous days before production access; the
    private phase can double as that gate.
  - GDPR still applies (Section 2), but payments and public support are out of
    scope for now.
  - The architecture must allow a later public launch without a rewrite, but we
    don't build for scale yet.

## D-005 — MVP core features
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 1
- **Context:** Owner's round 1 answer, as read by Claude (see Section 1,
  round 1). If the reading is wrong, this decision is superseded.
- **Decision:** The MVP includes (a) one tap to call the user's #1 contact and
  (b) sharing location with contacts for the length of a journey. The group
  "Everyone home?" feature is parked for after the MVP.
- **Open:** whether an automatic safety net (lost-contact alert and/or overdue
  check) is part of the MVP — Section 1, round 2.

## D-006 — Responders are the user's contacts plus a volunteer network
- **Date:** 2026-09-20 · **Status:** Accepted in principle · **Section:** 1
- **Decision:** When something is wrong, the user's own contacts respond, and a
  volunteer network is part of the product direction.
- **Open:** who the volunteers are (private-group members, an organisation, or
  nearby users) and whether they are in the MVP — Section 1, round 2. Legal
  questions (vetting, liability) go to Section 2.

## D-007 — The MVP includes a server-side lost-contact alert
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 1
- **Context:** Location sharing alone fails silently if the phone dies or is
  taken (see Section 1, round 1). Resolves the open point in D-005.
- **Decision:** During a journey the phone sends regular heartbeats. If they
  stop, a server alerts the journey's responders with the last known position.
  Overdue checks and "Are you OK?" prompts are parked for after the MVP.
- **Consequences:** The MVP needs a backend that works independently of the
  phone. The lost-contact end-to-end test is the most important test in the
  project. Thresholds are set in Section 3.

## D-008 — Volunteers are members of the private group
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 1
- **Context:** Refines D-006. Organisation volunteers and nearby strangers bring
  vetting, misuse and liability problems.
- **Decision:** The volunteer network in the MVP is the private group itself:
  members act as responders for each other. No organisation or stranger
  volunteers in the MVP.
- **Consequences:** "Responder" = group member. Every alert includes guidance
  for responders (HELP-01). Organisation partnerships can be revisited after the
  MVP, with legal review.

## D-009 — First group: friends and family, 12 or more people
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 1
- **Decision:** The first private group is friends and family, at least 12
  people.
- **Consequences:**
  - Could meet Google Play's closed-test rule (12 testers, 14 days) if at least
    12 members use Android. The actual iPhone/Android mix is needed in
    Section 8.
  - A family group may include teenagers, so Section 2 must cover age rules.

## D-010 — Calling #1 also shares the walker's live location with #1
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 1
- **Decision:** When #1 is a group member, the call button also starts sharing
  live location with #1 (as a journey, so the lost-contact alert applies).
  Details in CALL-03.
- **Consequences:** Pressing the call button always leaves a safety trail, not
  just a phone call.

## D-011 — Journeys end with "I'm home"; no automatic arrival in the MVP
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 1
- **Decision:** A journey ends when the walker taps "I'm home" or when the
  automatic stop in JRN-06 kicks in. Arrival detection is parked.
- **Consequences:** No geofencing in the MVP. JRN-06 is the only protection
  against forgotten journeys; the private test should measure how often it
  triggers.

## D-012 — MVP scope v1 is approved
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 1
- **Decision:** `01b-mvp-scope.md` v1 is the MVP. Story IDs are permanent and
  will be referenced by tests.
- **Consequences:** Changing MVP scope requires a new decision. ⚙️ numbers may
  be tuned in Sections 3–4 without a new decision.

## D-013 — Everyone who receives journeys or alerts has the app
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 1
- **Decision:** Responders are group members with the app installed. The #1
  contact for calling can be any phone number.
- **Consequences:** No public web links in the MVP, which removes a whole class
  of security risks.

## D-014 — Languages: bokmål first, then English, then nynorsk
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 1
- **Decision:** The MVP ships in Norwegian bokmål. English comes next, nynorsk
  later. All app text goes through translation files from day one.
- **Consequences:** No hard-coded text. The a11y-i18n reviewer agent checks
  this (Section 7).

## D-015 — Full GDPR compliance from day one
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 2
- **Context:** It is unclear whether the household exemption covers a private
  group app. Retrofitting privacy is expensive.
- **Decision:** The private phase follows GDPR fully: a legal basis for each data
  type, a DPIA before launch, a privacy notice, data subject rights, and
  retention limits.
- **Consequences:** A DPIA draft is due after Section 5 (architecture). A
  privacy lawyer reviews everything before any public launch.

## D-016 — Personal data is stored inside the EEA
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 2
- **Context:** The EU–US Data Privacy Framework is valid but under appeal at
  the EU Court of Justice.
- **Decision:** All personal data, especially location, is stored and
  processed by providers and regions inside the EEA.
- **Consequences:** Constrains the backend and push-notification choices in
  Section 4. Every provider needs a data processing agreement.

## D-017 — Minimum age is 13, with safeguards for minors
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 2
- **Decision:** Group members must be at least 13. Members under 18 are covered
  by PRIV-12: age band only, parent/guardian awareness without location access,
  and no consent-based features for members under 15.
- **Consequences:** Minors count as vulnerable data subjects in the DPIA. Check
  the status of the proposed 15-year age limit before any public launch.

## D-018 — Privacy requirements PRIV-01 to PRIV-12 are binding
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 2
- **Decision:** The PRIV table in `02-norway-law-privacy.md` is binding for all
  design, code and reviews.
- **Consequences:** The privacy-security-reviewer agent (Section 7) checks
  changes against the PRIV IDs. Tests reference the IDs where they can be tested
  automatically, for example retention deletion (PRIV-04) and log scrubbing
  (PRIV-07).

## D-019 — Unacknowledged alerts escalate to SMS after 2 minutes
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 3
- **Context:** Push delivery is best effort, and a missed alert is the worst
  failure (F6). Amends D-012 (MVP scope).
- **Decision:** A lost-contact alert goes out as a push notification. If no
  responder taps "I'm on it" within 2 minutes, every responder on the journey
  gets an SMS. LOST-06 becomes a Must, and LOST-07 is added.
- **Consequences:** An SMS provider inside the EEA with a data processing
  agreement (Section 4). A small per-message cost. SMS messages carry no
  location (REL-12).

## D-020 — Apply for Apple Critical Alerts; responders opt in
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 3
- **Decision:** Apply to Apple for the Critical Alerts entitlement as early as
  possible, with Time Sensitive as the fallback. On Android, use a high-priority
  alert channel that can override Do Not Disturb. Responders opt in during setup
  (GRP-04).
- **Consequences:** The request needs an Apple Developer account, so the account
  question in Section 8 may need to be pulled forward. Amends D-012 with GRP-04.

## D-021 — Lost-contact threshold is 5 minutes
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 3
- **Decision:** Responders are alerted when the server has heard nothing from a
  journey for 5 minutes.
- **Consequences:** The heartbeat interval (⚙️ 60 s) must leave several chances
  to report within 5 minutes. Changing the threshold after the spike or the
  private test needs the owner's approval.

## D-022 — Reliability and security requirements are binding
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 3
- **Decision:** REL-01 to REL-12, SEC-01 to SEC-07 and the reliability targets
  in `03-safety-reliability-security.md` are binding.
- **Consequences:** The canary journey (REL-10) and external monitoring (REL-08)
  are part of the MVP, not extras. A missed canary alert stops feature work until
  it is fixed.

## D-023 — React Native with Expo, TypeScript everywhere
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 4
- **Decision:** The app is built with React Native and Expo (development builds,
  strict TypeScript). The backend is also TypeScript and shares types with the
  app. The safety-critical background part uses the Transistorsoft background
  geolocation SDK, evaluated for free in the spike, plus small native modules
  where needed. The background part does not use `expo-location`.
- **Consequences:** One language for all agents and tests. The fallback, if the
  spike fails, is native modules for the background part with React Native kept
  for the UI. A $399 licence is needed before release builds.

## D-024 — Running budget: €30–100 per month in the private phase
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 4
- **Decision:** Monthly running costs (hosting, SMS, monitoring) should stay
  between €30 and €100 during the private phase. One-time costs (developer
  accounts, the location SDK licence) come on top.
- **Consequences:** Rules out expensive managed platforms and paid monitoring
  tiers. Favours small managed EEA services.

## D-025 — Hosting on Clever Cloud
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 4
- **Decision:** Backend apps (API and worker) and managed PostgreSQL run on
  Clever Cloud, a French PaaS running only on European infrastructure.
- **Consequences:** Low operations work, per-second billing within D-024. The
  infrastructure is defined as code where possible (Section 5). A data
  processing agreement with Clever Cloud is needed.

## D-026 — Maps: Kartverket tiles through our own tile proxy
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 4
- **Decision:** Maps use Kartverket's topographic map of Norway. The app fetches
  tiles through a small caching proxy on our EEA server, so Kartverket never
  sees users' IP addresses. Rendering uses MapLibre (open source).
- **Consequences:** Map coverage is Norway only, which fits D-003. Verify
  Kartverket's terms and rate limits, and MapLibre support for its tile format,
  in the spike.

## D-027 — The owner's AS holds the developer accounts
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 4/5
- **Decision:** The Apple Developer Program and Google Play accounts are opened
  as organisation accounts for the owner's existing AS.
- **Consequences:**
  - The AS is the GDPR controller (refines D-015). The privacy notice, DPIA and
    data processing agreements are in the AS's name.
  - Needs a D-U-N-S number, a public website and an email on the AS's domain.
  - No later app transfer, so no second Critical Alerts request.
  - Organisation accounts fall outside Google's documented 12-tester rule.

## D-028 — Code lives on GitHub
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 5
- **Decision:** The repository is hosted on GitHub, under an organisation owned
  by the AS.
- **Consequences:** The repository holds code only, never personal data; test
  data is always synthetic, consistent with D-016. The GitHub plan is decided in
  Section 5, round 2. CI runs on GitHub Actions (Section 8).

## D-029 — Repository on the owner's paid personal GitHub account
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 5
- **Context:** Amends D-028 (which assumed an AS organisation). The owner already
  has a paid GitHub account. Paid plans enforce rulesets on private
  repositories.
- **Decision:** The private repository lives on the owner's paid personal
  account. It can be transferred to an AS organisation later.
- **Consequences:**
  - Merge rules (tests must pass, no direct pushes to `main`) must also apply to
    admins. Claude Code works with the owner's credentials, so an admin bypass
    would let it skip the gates.
  - The first CI setup task checks through GitHub's API that the rules are
    actually enforced, and fails loudly if not.

## D-030 — REST + OpenAPI, contract-first
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 5
- **Decision:** One REST API. Schemas are defined once in `packages/contracts`,
  and the OpenAPI description and the typed app client are generated from them.
  The OpenAPI file of every released app version is stored, and CI fails on
  breaking changes against any supported version (oasdiff).
- **Consequences:** Native code (location SDK uploads), webhooks and future
  external systems use the same documented API.

## D-031 — Library-level choices are delegated to Claude
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 5
- **Decision:** Claude chooses libraries and tools and records each choice, with
  its reasons and a fallback, as "Accepted (delegated)". The owner can reopen any
  of them. Product scope, cost, privacy and safety decisions stay with the owner.

## D-032 — Library set v1
- **Date:** 2026-09-20 · **Status:** Accepted (delegated, D-031) · **Section:** 5
- **Decision:** oRPC (contract-first, OpenAPI handler) with zod · Hono on
  Node.js LTS · Drizzle ORM · Graphile Worker · Better Auth (SMS codes; passkey
  for the admin) · a hand-written state machine · dependency-cruiser · pino ·
  pnpm workspaces + Turborepo · Expo Router, TanStack Query, react-i18next,
  MapLibre React Native. Reasons and fallbacks are in
  `05-architecture.md`.
- **Consequences:** Items marked "verify at setup" are checked when the
  repository is created. Any swap is recorded as a new decision.

## D-033 — Journey state machine v1 and rules SM-01 to SM-10
- **Date:** 2026-09-20 · **Status:** Accepted (delegated, D-031) · **Section:** 5
- **Decision:** Journey states are ACTIVE, LOST_CONTACT and ENDED. Alert states
  are OPEN, ESCALATED, ACKNOWLEDGED and RESOLVED. Rules SM-01 to SM-10 in
  `05-architecture.md` are binding. The most important: a journey in lost
  contact is never ended by the automatic stop (SM-05), and removing the
  acknowledging responder restarts escalation (SM-10).
- **Consequences:** Every transition and rule gets a test (Section 6).
  SM-06 depends on the owner's answer on LOST-08.

## D-034 — LOST-08: the acknowledging responder can close an alert
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 6 (scope question from Section 5)
- **Decision:** The responder who tapped "I'm on it" can close a lost-contact
  alert ("They're safe"). This ends the journey and informs the other
  responders. Amends D-012 (MVP scope) and completes SM-06 (D-033).

## D-035 — No reliance on manual testing by people
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 6
- **Context:** The owner's principle: "I want everything automated with tests.
  If something doesn't work when releasing, we should add tests to cover it. We
  should never rely on manual testing from people."
- **Decision:**
  - All verification is automated, including behaviour on real phones, through
    scripted tests on emulators, simulators and a cloud device farm.
  - Every failure found at release or in production gets an automated
    regression test before it is fixed (extends RG-02).
  - What no automation can prove is listed as a documented residual risk and
    monitored automatically in production.
- **Consequences:**
  - SPIKE-01 becomes automated.
  - Test level L9 becomes "automated real-device tests".
  - A new level, L10, monitors real-world reliability from server data.
  - A real-device platform must be chosen (Section 6, round 2).

## D-036 — Mutation testing blocks below 80 % on safety code
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 6
- **Decision:** StrykerJS runs on domain, alert and safety-core code. A mutation
  score below 80 % blocks the merge. Pull requests run incrementally; a full run
  happens nightly. Elsewhere the score is reported but doesn't block.

## D-037 — Real-phone tests deferred until the app has been shown
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 6
- **Decision:** Automated tests run on emulators and simulators only until the
  app has been shown. The real-device suite (L9), with Firebase Test Lab as the
  default candidate, is switched on later.
- **Consequences:** Behaviour on real phones (manufacturer battery managers,
  real iPhone background limits) is not verified before then. The SPIKE-01
  real-phone parts stay open. The switch-on point is asked in Section 7.

## D-038 — Residual risks accepted, with automatic monitoring
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 6
- **Decision:** RR-01 to RR-04 are accepted. They are covered by automatic
  production monitoring (L10), and every anomaly gets an automated regression
  test (D-035).

## D-039 — Test tool set v1
- **Date:** 2026-09-20 · **Status:** Accepted (delegated, D-031) · **Section:** 6
- **Decision:** Vitest (server and packages) · fast-check (property-based
  tests) · Testcontainers (real PostgreSQL) · jest-expo with React Native Testing
  Library (app) · Maestro (UI end-to-end) · StrykerJS (mutation) · oasdiff (API
  compatibility). XCUITest and UI Automator are used for L9 once it is switched
  on.
- **Reason:** Each is the standard, maintained tool for its level. Two test
  runners are used because jest-expo is Expo's supported path for app tests and
  Vitest is faster for the server.

## D-040 — Regression gates RG-01 to RG-08 are binding
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 6
- **Decision:** The gates in `06-testing-strategy.md` are binding and are
  enforced by hooks and CI (Sections 7–8), not by instructions alone.

## D-041 — Real-phone tests switch on before the group relies on the app
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 7 (carried from Section 6)
- **Decision:** The automated real-device suite (L9) must be switched on and
  passing before the private group uses the app for real walks home. Until
  then, emulators and simulators only (D-037).
- **Consequences:** A release gate in `/release` and a milestone gate in the
  roadmap (Section 10).

## D-042 — Merge autonomy
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 7
- **Decision:**
  - Pull requests merge automatically when every required check passes.
  - Changes to safety paths (domain, alerts, worker, safety-core) and to the
    gates themselves (`.github/`, `.claude/`, released contracts, decisions,
    infra) also need the owner's approval, through CODEOWNERS. The approval is
    based on the reviewers' plain-language summary.
- **Consequences:**
  - GitHub doesn't let a pull request's author approve it. Claude therefore
    commits and opens pull requests through its own GitHub account, with write
    access but not admin (A-06).
  - This also means the merge rules apply to Claude with no admin bypass,
    which resolves the concern in D-029.

## D-043 — Blocking AI reviewers
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 7
- **Decision:** `safety-reviewer`, `privacy-security-reviewer` and `test-auditor`
  produce a blocking verdict: a BLOCK stops the merge until it is fixed or the
  owner overrides it, and any override is logged. `code-reviewer` and
  `a11y-i18n-reviewer` are advisory.

## D-044 — Claude Code configuration v0
- **Date:** 2026-09-20 · **Status:** Accepted (delegated, D-031) · **Section:** 7
- **Decision:** The draft files in `docs/plan/07b-claude-code-files/` —
  CLAUDE.md, settings, CODEOWNERS, 5 rules, 11 agents, 12 skills and 7 hooks —
  are the starting configuration. They are copied into the repository at
  setup.
- **Consequences:** At setup, verification is automated: agent validation, hook
  unit tests, and a scripted session that tries each forbidden action. The known
  limits are listed in the 07b README.

## D-045 — Claude plan: Max; how agents use it
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 7/8
- **Context:** The owner uses a Claude Max subscription for Claude Code.
- **Decision:**
  - Main sessions, `planner`, `implementer` and the three blocking reviewers
    use the session's model (`inherit`). `plan-keeper` and `a11y-i18n-reviewer`
    use Sonnet to save usage.
  - Reviewers may run in parallel.
  - AI reviews in CI use a Claude Code OAuth token generated from the Max
    subscription, with a pay-per-use API key as the documented fallback if
    subscription authentication fails.
- **Consequences:** CI reviews share the Max usage limits with local sessions.
  If limits are hit, AI review checks fail loudly rather than being skipped.

## D-046 — Phased environments: staging only until go-live
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 8
- **Context:** The owner wants staging separation "but without the cost" at
  first.
- **Decision:**
  - Until go-live, only staging is deployed: synthetic data, one XS instance
    running the API and worker together, and the free DEV PostgreSQL (about
    €5 a month).
  - Production is created at go-live, gated by D-041 and PRIV-11.
  - Separation is structural: a separate Clever Cloud organisation, secrets,
    domain and app variant.
- **Consequences:** Small connection pools on the DEV database. CI proves
  migrations on production's exact PostgreSQL version. After go-live, staging
  may be stopped outside test runs.

## D-047 — The owner approves each production release
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 8
- **Decision:** Releases happen through a release pull request (version, notes,
  API snapshot) that the owner approves through CODEOWNERS. Merging it triggers
  the gates (RL-01 to RL-07), the production deploy and the store submissions
  automatically.

## D-048 — Budget ceiling of about €165 a month once real-phone tests run
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 8
- **Decision:** From go-live, when the real-phone tests (D-041) run, monthly
  running costs may go up to about €165. Until then, D-024 (€30–100) applies,
  and phase A is expected at about €5–10 a month.
- **Consequences:** Refines D-024. `/status` reports the actual monthly cost.

## D-049 — CI configuration v0
- **Date:** 2026-09-20 · **Status:** Accepted (delegated, D-031) · **Section:** 8
- **Decision:** The draft workflows in `docs/plan/08b-ci-files/` — required
  checks CI-01 to CI-11, staging deploy, release, nightly jobs and Dependabot —
  and the filled-in `/release` skill are the starting CI configuration. The
  items to verify at setup are listed in its README.

## D-050 — Daily status report
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 9
- **Decision:** Every morning (05:00 UTC; 07:00 Oslo time in summer, 06:00 in
  winter) a scheduled workflow runs `/status` and posts it as a comment on a
  pinned "Daily status" issue. The report fits one phone screen and starts with
  ✅ healthy, ⚠️ needs attention or 🛑 action required.
- **Consequences:** It uses a little of the Max usage (D-045). If the report
  fails, that failure shows in CI instead of being silently missing.

## D-051 — Owner questions as GitHub issues
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 9
- **Decision:** When Claude needs a decision and the owner isn't in the
  session, it opens one issue per question, using the `owner-question` template
  (question, options, recommendation, what it blocks). Work on that
  requirement stops until the owner answers. `plan-keeper` records the answer
  as a decision and closes the issue.

## D-052 — One feature at a time to start
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 9
- **Decision:** Work-in-progress limit of 1: one requirement in flight at a
  time. Revisit after milestone M2 (Section 10).

## D-053 — Roadmap M0 → M6 approved
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 10
- **Decision:** Milestones in this order:
  - **M0** foundations, ending with the gate drills;
  - **M1** spike on emulators and simulators;
  - **M2** core safety loop on the server;
  - **M3** app MVP, which the owner can demo;
  - **M4** privacy, security and the DPIA;
  - **M5** go-live readiness (real-phone tests, production, release 1.0);
  - **M6** private group phase.
- **Consequences:** Exit criteria are automated. Go-live is gated by D-041,
  PRIV-11 and RL-01 to RL-07.

## D-054 — No fixed date: quality first
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 10
- **Decision:** No target date for the demo or go-live. `/status` forecasts
  dates from the measured pace after M0 and M2. A gate is never weakened to meet
  a date.

## D-055 — Hybrid sessions: Mac and cloud
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 10
- **Decision:**
  - Claude Code runs on the owner's Mac (with Remote Control from the phone)
    for M0, M1 and UI work (M3), where the iOS simulator and Android emulator
    are needed.
  - Everyday work from M2 runs as cloud sessions, and so does any work while
    the Mac is off.
- **Consequences:**
  - A cloud environment (A-14) with a setup script (`pnpm install`), an
    allowlist of the domains the work needs, and Claude's GitHub token for
    opening pull requests (D-042).
  - Hooks detect cloud sessions through `CLAUDE_CODE_REMOTE`.
  - CI stays the single authority on what merges.

## D-056 — On the Mac, Claude runs under a separate Standard user
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 10
- **Decision:** A dedicated macOS Standard user (for example `claude-dev`),
  with no admin rights and FileVault on. Shared tools (Xcode, Android Studio,
  Homebrew, a Docker runtime) are installed once from the owner's admin account.
- **Consequences:** Claude can't reach the owner's personal files, keychain or
  browser sessions. Anything that needs admin rights is an owner action.

## D-057 — Internal packages use the `@trygghverdag` scope
- **Date:** 2026-09-20 · **Status:** Accepted · **Section:** 10 (M0, INF-01)
- **Context:** The workspace packages need a name to refer to each other by.
  Nothing is published to npm, so the scope is internal only.
- **Decision:** Workspace packages are named `@trygghverdag/<package>`, matching
  the repository name: `@trygghverdag/contracts`, `@trygghverdag/test-kit`,
  `@trygghverdag/config`.
- **Consequences:** The public app name is still open and is decided before the
  store listings (M3/M5). Renaming the scope later is a find-and-replace inside
  this repository; nothing outside it depends on the names.

## D-058 — Toolchain versions v1
- **Date:** 2026-09-20 · **Status:** Accepted (delegated, D-031) · **Section:** 10 (M0, INF-01)
- **Context:** INF-01 has to pin exact versions, and one of them is a real
  trade-off: TypeScript 7.0 is out, but the type-aware lint rules that the L1
  gate depends on do not support it yet.
- **Decision:**
  - Node 22 LTS (`>=22.13 <23`, pinned in `.node-version`), pnpm 10.33.0 (pinned
    through `packageManager`), Turborepo 2.
  - **TypeScript 6.0.x, not 7.0.** `typescript-eslint` 8.70 — which provides the
    typed lint rules — declares support for TypeScript `>=4.8.4 <6.1.0`.
    Upgrading the compiler would mean turning off type-aware linting, and the
    gates are the point of this project. Revisit when `typescript-eslint`
    supports TypeScript 7.
  - ESLint 10 (flat config) for lint, Prettier 3 for formatting, and
    dependency-cruiser 18 for the import rules (AR-10). The shared settings live
    in `packages/config`, so a session, a hook and CI run the same rules.
  - Prettier does not format Markdown, and neither tool reads `docs/`: planning
    documents are prose wrapped by hand, and `07b`/`08b` hold templates that are
    copied in unchanged.
  - The root `package.json` carries an npm-style `workspaces` field beside
    `pnpm-workspace.yaml`, because dependency-cruiser recognises workspace
    packages only from that field. A guard in the import-rule config fails the
    check if the two lists drift apart.
- **Consequences:** Dependabot (INF-04) proposes upgrades, and they go through
  the same gates as any other change. The TypeScript 7 move is a task of its
  own, once typed lint supports it.

## D-059 — Claude Code configuration v1, as installed
- **Date:** 2026-09-20 · **Status:** Accepted (delegated, D-031) · **Section:** 7 (M0, INF-02)
- **Context:** D-044 accepted the draft files in
  `docs/plan/07b-claude-code-files/` and said they would be verified when the
  repository was set up. Verifying them found four things that had to change,
  and one thing that is missing.
- **Decision:** The drafts are installed as they were, with these changes:
  1. **Permission paths are anchored at the project** (`Edit(/.claude/hooks/**)`),
     not at the session's current directory (`./`), which is what the drafts
     used. Source: https://code.claude.com/docs/en/permissions — `path` and
     `./path` are relative to the current directory, while `/path` is relative
     to the settings source, which for project settings is the project root.
     This was the item the 07b notes asked to verify.
  2. **`claude/*` branches are on the push allow list**, because that is the
     branch a cloud session is given (D-055).
  3. **`**/*.test.mjs` is treated as a test file** by the weakening detector
     (HK-05) and by the two role guards, because the hook tests are written in
     `.mjs`. Otherwise the tests that protect the gates would be the only tests
     not protected themselves.
  4. **Environment files are denied in both the project-anchored and the bare
     form**, so the rule holds wherever a session starts.
- **Open:** **HK-08** — the hook that checks `docs/progress.md` and the plan
  status were updated before a session ends — has no script in the draft set.
  Claude recommends writing it in INF-03 with the other gate scripts. Until
  then, the "update progress before you finish" rule in `CLAUDE.md` is an
  instruction, not machinery, which is exactly the distinction Section 7 warns
  about.
- **Consequences:** Refines D-044; the draft files stay in `docs/plan/07b…` as
  the record of what was accepted. Hook scripts now have tests
  (`pnpm run test:hooks`, 77 cases) that run in CI like any other code.

## D-060 — Gate scripts v1, and HK-08 is machinery

> **Two decisions carry the number D-060** — this one and the CI configuration one appears further down. A citation of "D-060" is therefore ambiguous. Both are left as
> they are and named here instead: renumbering a binding decision is
> the owner's call, not Claude's.
- **Date:** 2026-09-20 · **Status:** Accepted (owner answered the HK-08 question; the rest delegated, D-031) · **Section:** 6/7 (M0, INF-03)
- **Context:** INF-02 left two placeholder gate scripts and one missing hook.
  Writing the real ones forced three choices about how a gate behaves when the
  thing it guards does not exist yet.
- **Decision:**
  1. **HK-08 is a hook, not an instruction.** A session that changed code but
     not `docs/progress.md` is refused once at the stop gate, warned at session
     end and before compaction, and reminded at the start of the next session.
     The owner asked for it here rather than leaving it out.
  2. **A gate that cannot run says so, in words, and never reports a pass.**
     `gate:full` names each step it cannot run and the task that brings it;
     `api:diff` and `mutation` **fail** when they should have run but their tool
     is missing; `coverage:ratchet` prints which floors are not in force yet.
     A check that quietly passes because there is nothing to check is the failure
     mode this project is built around.
  3. **Requirement coverage counts tests, not mentions.** A test file that only
     quotes requirement IDs as sample data marks itself
     `// req-coverage: fixtures-only`, and only product code, specs and tests
     count toward RG-01. The first honest count is 0 of 63.
  4. **The coverage ratchet compares against a committed baseline**
     (`coverage-baseline.json`), raised deliberately with `--update` and reviewed
     like any other change, because comparing against the base branch would mean
     running the whole suite twice on every pull request.
  5. **Licences are an allowlist** (`scripts/lib/licenses.mjs`): permissive
     licences plus MPL-2.0. Copyleft licences are excluded, not because they are
     bad, but because an app distributed through the stores cannot honour them —
     and finding that out at release time would be expensive (SEC-06).
- **Consequences:** `gate:quick` is what the stop gate runs; `gate:full` is what
  CI repeats (INF-04). Stryker (D-036) and oasdiff (D-030) are installed when
  the code they judge exists — until then their gates fail loudly rather than
  skipping. `docs/requirements-status.md` is generated by `pnpm run req:coverage`
  and is not edited by hand (Section 9).

## D-060 — CI configuration v1, as installed

> **Two decisions carry the number D-060** — this one and the gate-scripts one appears further up. A citation of "D-060" is therefore ambiguous. Both are left as
> they are and named here instead: renumbering a binding decision is
> the owner's call, not Claude's.
- **Date:** 2026-09-20 · **Status:** Accepted (delegated, D-031) · **Section:** 8
- **Context:** INF-04 installs the draft workflows from `08b-ci-files/`. Four
  things had to change to make them true rather than plausible.
- **Decision:**
  1. **One list of checks, read at run time.** `scripts/lib/merge-rules.mjs`
     holds every check from CI-01 to CI-11. `gate:integrity` works out from the
     repository's own scripts which of them must be required today, and fails if
     the workflow files, that list and the repository's merge rules disagree in
     either direction — a required check nothing produces, or a check that could
     run but nothing requires.
  2. **A job whose script does not exist is left out, not skipped.** GitHub
     reports a skipped job as a green tick, and a required check that is always
     skipped can never fail. `integration` and `system` (INF-05) and
     `android-e2e` (INF-06) therefore have no job yet; `gate:integrity` lists
     them every run and starts failing when their script appears.
  3. **Actions are pinned to commit SHAs**, with the version as a trailing
     comment, and `gate:integrity` refuses a tag or a branch. Whoever can move a
     tag can otherwise run their own code in a job that holds this repository's
     secrets. Dependabot raises the pins.
  4. **Reading who may bypass the merge rules needs its own token.** The 08b
     draft assumed `CLAUDE_BOT_TOKEN` would do, but Claude's account has write
     access and not admin, on purpose (A-06), so it cannot read repository
     settings. Giving it admin would hand the gates' enforcement to the account
     being gated. Instead `RULES_READ_TOKEN` is a fine-grained token scoped to
     this repository with Administration: Read-only and nothing else (A-15).
- **Consequences:** Until the owner creates the ruleset (`merge-rules.md`) and
  adds `RULES_READ_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN`, the `gate-integrity`
  and `ai-review` checks are red. That is the intended state: an unenforced gate
  that reported itself as enforced would be the exact failure this project is
  built to avoid (D-029). Because the merge rules are not switched on yet, a red
  check does not block merging — the owner still merges by hand until
  `merge-rules.md` is done.
- **Not installed yet, and why:** `deploy-staging.yml` belongs to INF-07 (it
  needs the Clever Cloud token), `daily-status.yml` and the owner-question issue
  template to INF-09, and `release.yml` and `nightly.yml` to the milestones whose
  scripts they call. The drafts stay in `08b-ci-files/` until then.

## D-061 — What the INF-04 reviews changed
- **Date:** 2026-09-20 · **Status:** Accepted (delegated, D-031) · **Section:** 8
- **Context:** The three reviewers of the INF-04 branch each returned BLOCK, and
  two found the same bug independently. Amends D-060 rather than replacing it.
- **Decision:**
  1. **`privacy-security-reviewer` runs on every pull request.** Its draft path
     filter covered two of the seven planned server modules, so a change to
     journeys, groups, alerts, notifications or maps — and every change to
     `.github/` or `scripts/` — would have reported a green privacy tick on a
     *required* check without the reviewer ever looking. A path filter that
     misses decides silently that there was nothing to review. Filters are now
     used only where the path list is small and written down elsewhere, and a
     test holds the `safety` filter to `OWNER_APPROVAL_PATHS`.
  2. **The generated requirement report carries no date.** CI regenerates
     `docs/requirements-status.md` and fails if the committed copy differs; with
     the generation date in it, that check would have gone red at midnight every
     night, for a reason nobody changed. `renderStatus` is now a pure function
     of the rows (AR-03). Git already records when a file changed.
  3. **An upstream failure cannot skip a blocking review.** The reviewer jobs
     depend on a paths-filter job; if that job failed, all five were skipped —
     and a skipped job is a green tick, which is the premise D-060 is built on.
     They now run with `if: always()` and fail loudly when the filter did not.
  4. **The verdict must be the last line, anchored.** The draft accepted a file
     with no verdict at all, and missed `**VERDICT: BLOCK**`.
  5. **Every ruleset covering `main` is read, not the first.** A bypass entry in
     a second ruleset was invisible, and the gate printed a tick over it — in
     the one check D-029 exists to make.
  6. **A gate in which nothing ran has not passed.** `summarize` returned `ok`
     when every step was skipped, so a typo in a script name would have turned a
     gate into a decoration. With `packageScripts` now throwing, these were the
     two routes to a silent green gate; both are closed.
  7. **The secret scan uses the gitleaks CLI (MIT), not `gitleaks-action`**,
     which is under a proprietary end-user licence that is not on the allowed
     list and needs a key on an organisation account — where this repository is
     headed (D-029). Pinned by version and checked against its published
     checksum.
  8. **`/scripts/` and `/package.json` need the owner's approval** (CODEOWNERS
     and `OWNER_APPROVAL_PATHS`). They decide what every gate does and run with
     the token the `gate-integrity` job holds, so they are part of the gates.
- **Consequences:** `privacy-security-reviewer` uses more of the Max allowance
  than the draft assumed (D-045); that is the price of the check meaning what it
  says. The reviewers' remaining suggestions are recorded in `progress.md` as
  named follow-ups rather than done here, so INF-04 stays one task.

## D-062 — CI-01 reads the merge rules with the Actions token
- **Date:** 2026-09-21 · **Status:** Accepted (delegated, D-031) · **Section:** 8
- **Context:** D-060 point 4 and the first version of `merge-rules.md` asked the
  owner for a `RULES_READ_TOKEN` with **Administration: Read-only**, on the
  assumption that reading a ruleset's bypass list is an administrative act. The
  owner asked how to create the tokens, which was the occasion to check rather
  than assume.
- **Evidence:** GitHub states the answer in its own responses.
  `GET /repos/{owner}/{repo}/rulesets`, `/rulesets/{id}` and
  `/rules/branches/{branch}` all return
  `X-Accepted-Github-Permissions: metadata=read`. (By contrast
  `/rulesets/rule-suites` returns `administration=read` and 403s without it,
  which is what made the distinction visible.)
- **Decision:** CI-01 reads the rulesets with the ordinary Actions token, which
  always has metadata read for its own repository. `RULES_READ_TOKEN` stays
  supported and takes precedence when set, documented as the way out if that
  ever stops holding — and specified as **Metadata: Read-only**, not
  Administration.
- **Consequences:** One fewer secret for the owner to create, store and rotate,
  and the permission asked for is the smallest that works rather than the
  smallest that was guessed at. Supersedes D-060 point 4. The gate still fails
  rather than passing when it cannot read the bypass list, so being wrong about
  this costs a red check, never a false tick.
- **Also found while checking:** `ai-review.yml` passes no `github_token`, so
  the action authenticates as the **Claude GitHub App** — which therefore has to
  be installed on the repository. That step was missing from `merge-rules.md`
  entirely; without it the reviews cannot post their findings.

> D-063 and D-064 are reserved by the INF-04 follow-through branch, which is
> pushed but not merged. The numbers are left unused here rather than reused, so
> that the two branches cannot both claim one.

## D-065 — Server skeleton v1, as built
- **Date:** 2026-09-23 · **Status:** Accepted (delegated, D-031) · **Section:** 5
- **Context:** INF-05 turns the library choices in D-024 into a running server.
  The libraries were already decided; the shape of the first route, the clock
  and the worker's proof of life were not, and each of them sets a pattern every
  later feature copies. Recorded together because they are one design.
- **Decision:**
  1. **The API is versioned by path prefix**, `/v1`, held in
     `packages/contracts/src/api-version.ts`. Every route lives under it, so
     `/health` is served at `/v1/health` and an unversioned path is a 404. A
     version in a header is invisible in a log, a proxy rule and a monitor's
     configuration; a version in the path is not. The prefix is exported as one
     constant so the server, the OpenAPI `servers` list and the app cannot
     disagree about it.
  2. **`/v1/health` returns 200 whenever the API process is up**, and puts the
     system's real answer in `status` (`ok` or `degraded`) in the body. The two
     questions — "is this process answering?" and "is anything watching the
     journeys?" — have different answers and different audiences: a load
     balancer needs the first, the owner's phone needs the second. Collapsing
     them into the HTTP status would either take a working API out of rotation
     because the worker is late, or hide a dead worker behind a green tick.
  3. **The clock port is asynchronous** — `now(): Promise<Date>` — because the
     one clock a safety decision may use is the database's (AR-03, REL-01), and
     reading it is a query. Making the port synchronous would have quietly
     invited `new Date()` as an implementation, which is the failure AR-03
     exists to prevent. The cost is that every caller of `now()` awaits; that is
     the point.
  4. **The worker proves it is alive by writing one row.** `worker_heartbeat`
     has a single row, upserted once a minute by a Graphile Worker cron task,
     stamped with the database's time rather than the worker process's. The API
     reads that row; it never talks to the worker. Two processes that share only
     a database stay two processes, and the heartbeat survives a restart of
     either one.
  5. **Silent for more than three minutes is `degraded`** (`WORKER_STALE_AFTER_MS`),
     so two missed beats are tolerated. Equal to the beat interval would page on
     ordinary jitter, and a monitor that cries wolf gets muted — which is the
     failure this is meant to catch, arriving by a longer route.
- **Consequences:** The health endpoint is a fact about the whole system, so
  INF-08 can wire a monitor to it without further design. The async clock is now
  the pattern for the safety loop in M2. Nothing here decides the watchdog's own
  cadence (AR-06 says 10-15 seconds); this is only how long the API waits before
  saying the worker has stopped.

## D-066 — Mutation testing runs Stryker's command runner, not its Vitest runner
- **Date:** 2026-09-23 · **Status:** Accepted (delegated, D-031) · **Section:** 6
- **Context:** D-036 requires a mutation score on safety code. With
  `testRunner: 'vitest'`, Stryker reported **4.35 %** on the first run — which,
  taken at face value, says the domain tests are worthless.
- **Evidence:** The score was checked rather than believed. Planting the mutant
  by hand — `silentForMs > staleAfterMs` changed to `<=` in
  `apps/server/src/domain/health.ts` — made **four** tests fail. The tests kill
  the mutants; Stryker's Vitest runner was not seeing them, against Vitest 5 and
  this workspace layout.
- **Decision:** `stryker.config.mjs` uses `testRunner: 'command'` with
  `pnpm exec vitest run apps packages`. Slower per mutant, because each run is a
  fresh process, and `--incremental` in CI keeps that affordable.
- **Consequences:** The score is now **95.65 %** — the domain 100 %, the worker
  85.71 %, one survivor in `startWorker`'s empty-options branch. Revisit when
  the Vitest runner supports Vitest 5 properly; until then a number that is
  wrong in the safe direction would have been bad enough, and this one was wrong
  in the dangerous direction — it looked like the tests were weak.
- **Also:** `stryker.config.mjs` imports `SAFETY_PATHS` from
  `scripts/lib/gate-decisions.mjs` rather than listing the paths again, and
  `scripts/lib/coverage.mjs` now imports the same list instead of keeping its
  own copy — which was missing `apps/server/src/worker.ts`, the file this task
  created. That was a named follow-up from INF-04's review; it is fixed here
  because the file it was about now exists.

## D-067 — AR-03's lint rule bans reading the clock, not constructing a Date
- **Date:** 2026-09-23 · **Status:** Accepted (delegated, D-031) · **Section:** 5
- **Context:** INF-05's integration job failed on a real defect: `databaseClock`
  asked for `select now()` and told TypeScript the answer was a `Date`. It was
  not — drizzle-orm's node-postgres driver installs its own type parsers so it
  can map columns itself, so a query written through the schema returns a `Date`
  while a raw `sql` query returns PostgreSQL's text, `2026-09-23 05:18:34+00`.
  The type argument silenced the compiler. In production every call to
  `/v1/health`, and every later safety decision that asks the time, would have
  thrown `getTime is not a function`.
- **The fix needed somewhere to live.** Converting what the database said into a
  moment is small, pure, and exactly the kind of code that should sit under the
  mutation gate and the 95 % branch floor — that is, in `apps/server/src/domain/`.
  But the AR-03 lint rule banned every `new Date(...)` there, parsing included,
  which would have forced the conversion out of the one place that protects it.
- **Decision:** the selector now matches `new Date()` with **no arguments**.
  `Date.now()` and `performance.now()` stay banned, as does `new Date()`.
  `new Date(value)` — turning a value someone handed in into a moment — is
  allowed, because it reads no clock.
- **Consequences:** AR-03 now says what it means. The conversion lives in
  `apps/server/src/domain/database-time.ts`, under the mutation gate, and
  refuses rather than guesses: a timestamp with no time zone throws, because
  reading it as UTC or as local time would put every "has it been more than N
  minutes" decision out by hours with nothing going red.
- **Also:** the clock rules had no tests at all, although the comment beside
  them claimed they did. They have them now — including one that asserts
  parsing is allowed, so this decision cannot be quietly reverted. And
  `packages/**/*.test.mjs` was missing from the Vitest include list, which is
  why a test file there would have been invisible: packages/config keeps its
  presets at the package root rather than under `src/`.
- **What this cost to learn:** nothing but a red CI job — which is the whole
  argument for the L3 level. No unit or system test could have caught it: the
  fake clock returns a `Date`, so every test that used a fake passed. Only a
  real PostgreSQL disagreed.

## D-068 — The pool's `error` event waits for the task that brings logging
- **Date:** 2026-09-23 · **Status:** Accepted (owner) · **Section:** 5
- **Context:** `safety-reviewer` asked for a `pool.on('error', ...)` handler on
  the `pg.Pool` in `apps/server/src/adapters/db.ts`. The concern is real: with
  no listener, an idle client's error is an unhandled `'error'` event, which
  exits the process — and databases close idle connections as a matter of
  routine, so the worker could end up restarting in a loop. A worker that keeps
  dying is a watchdog that is not watching.
- **Why it was not simply done:** every version of the handler decides something
  that was not the reviewer's to decide. One that swallows the event trades a
  loud crash for silence, which is the one thing this project must not do. One
  that reports needs somewhere to report to, and that would be the first logging
  call in the repository — a precedent under PRIV-07, set in passing, in a
  bugfix, before anyone had chosen how logging works.
- **Decision (the owner's):** defer it to the task that brings logging. Until
  then the crash stands.
- **When the handler is written, its log line is a PRIV-07 question — and a
  SEC-03 one, which is worse.** A connection-pool error carries no location and
  no phone number, so PRIV-07 is the easy half. The half that bites:
  `privacy-security-reviewer` pointed out on #6 that **`pg` and
  `graphile-worker` error objects can include the connection string**, and the
  connection string carries the database password. `console.error(err)` on a
  pool error is therefore a plausible way to print production credentials into
  a log that is not treated as a secret. Whoever writes that handler logs a
  chosen message, never the error object, and a test should assert the
  connection string does not appear in what is logged — the same shape as the
  existing `SEC-03: the internal error does not reach the caller` test.
- **Consequences:** the failure is loud rather than hidden. The platform
  restarts the process; if it is the worker, the heartbeat stops and
  `/v1/health` reports `degraded` within three minutes, which is the signal the
  health endpoint exists to give. What is lost meanwhile is attribution — the
  crash says a connection died, not which one or why — and that is exactly what
  the logging task is for. `db.ts` says so at the point where the handler will
  go, so the next reader finds the reasoning rather than an oversight.
- **Carries a cost worth naming, and the cost grows:** if idle-connection churn
  turns out to be frequent on Clever Cloud's DEV plan, a restart loop is an
  availability problem today — the health endpoint goes `degraded` and someone
  is annoyed. **From M2 it is not that.** Once the worker carries the watchdog,
  a worker that keeps restarting is a watchdog that keeps not sweeping, and the
  symptom is a journey nobody is watching rather than a red tick. `safety-reviewer`
  made that point on #6 and it is the sharper statement of the stake: revisit
  this before the worker carries journey state, not merely if churn is observed.
  Deferred is not the same as decided against.

- **A second, adjacent gap in the same pool's lifecycle, found later on #6.**
  `startWorker` creates the pool and returns graphile-worker's `Runner`, and
  nothing ever closes it. When `pgPool` is passed in, the caller owns it —
  graphile-worker only ends pools it created itself — so stopping the runner
  leaves the connections open. Harmless today, because nothing binds a real
  process yet and only tests call it; from **INF-07**, when a process is
  actually wired and restarts, it leaks against the same five-connection DEV
  budget `db.test.ts` exists to protect. Whoever does INF-07 closes the pool on
  shutdown and proves it. Written here rather than fixed on #6 because there is
  no shutdown path to hook into until that task creates one, and inventing one
  early is the speculative work `safety-reviewer` explicitly did not ask for.
- **The tests can close it today, though, and that half needs no INF-07.**
  `code-reviewer` added the detail that `worker.test.ts` leaks a pool per
  `startWorker` call, and said the fix waits on INF-07 giving `startWorker` a
  way to hand the pool back. That last part is wrong, and the correction is
  worth having: `startWorker` passes `pgPool: pool` into the runner, and both
  tests capture the whole options object from their fake runner, so
  `options.pgPool` is already in reach. An `afterEach` ending it closes the test
  leak now. Left to whoever edits these tests under the RG-02 roles rather than
  taken here at the end of an unrelated task, but it is a one-liner, not a
  blocked item.

## D-069 — The reviewers' verdict line, and a boundary I should not have crossed
- **Date:** 2026-09-23 · **Status:** Partly accepted (delegated, D-031); the
  rest **needs the owner** · **Section:** 8
- **Context:** the `ai-review` gate reads one file per reviewer,
  `review-<agent>.md`, and fails if its last line is not exactly `VERDICT: PASS`
  or `VERDICT: BLOCK`. Blocking reviewers failed on reviews that had found
  nothing wrong, in two distinct ways, each with its own error:
  1. **"did not end with a verdict line"** — the file exists, its last line is
     something else. `safety-reviewer` wrote `**Verdict: PASS**`; the pattern is
     case-sensitive. `code-reviewer` wrote `VERDICT: APPROVE WITH COMMENTS`,
     then `**APPROVE**`, then `VERDICT: APPROVE`.
  2. **"produced no verdict file"** — no file at all. The `claude-code-action`
     step reports success, three and a half to five minutes, and the pull
     request comment appears; nothing is written.

### Accepted, and delegated under D-031: the wording
All five definitions said *"End with exactly one line: `VERDICT: PASS` or
`VERDICT: BLOCK`, followed by your findings"* — which puts the findings **after**
the verdict, while the gate reads the **last** line. A reviewer following it
literally could not pass. They now put findings first and state that the last
line is one of two exact strings. `scripts/ai-review.test.mjs` reads the pattern
out of the workflow and holds the definitions to it. This is a wording fix to
Claude's own tooling and is within D-031.

### Not accepted, and not Claude's to accept: the trust boundary
Failure (2) was answered by instructing the reviewers to write
`review-<agent>.md` themselves. `test-auditor` blocked it and was right on both
counts.

**It was a governance breach.** A pull request that edits the instructions of
the agent reviewing it, so that the agent writes files, is indistinguishable in
form from prompt injection — whatever the author intended, and intent is exactly
what a reviewer cannot verify. The read-only reviewer boundary is **D-043, which
the owner accepted**. D-031 delegates library and tool choices to Claude; it
does not delegate that. This decision originally carried the status "Accepted
(delegated, D-031)", which was a self-grant of authority over an owner's
decision. That is the part worth remembering.

**It also could not have worked.** Each reviewer's frontmatter runs
`guard-bash.mjs --agent <name> --readonly` on `Bash`, and that hook blocks every
output redirection. The instruction was shipped without being exercised end to
end — a fix nobody could have run, defended with reasoning rather than evidence.

Both changes are reverted. The reviewers are read-only again and are told
nothing about the file.

### The guard against a repeat already exists
`test-auditor` asked for a permanent guard so that a pull request cannot change
its reviewers' instructions unnoticed. There is one, and it was in place the
whole time: **CODEOWNERS already assigns `/.claude/` and
`/docs/plan/decisions.md` to the owner**, so both the agent definitions and the
decision log used to justify changing them need the owner's approval before
anything merges. Recorded here so nobody builds a second one.

That makes three independent layers that stopped this, only one of which was
designed for it: the blocking review caught it, the reviewer harness reverts
those files so the change could not have taken effect on its own pull request
anyway, and CODEOWNERS would have held the merge for a human. The layer that
did *not* stop it was the author's own judgement, which is the argument for
having the other three.

### Still open, and it is the owner's
Failure (2) is unfixed and blocks merges, because the required `ai-review`
checks are among the twelve. The fix belongs in `ai-review.yml` on `main`: make
the file-writing step explicit and checkable, or have the enforcement read the
pull request comment, which is the artefact that reliably exists. It cannot be
done from a branch — editing that workflow stops `claude-code-action` running at
all — `claude-code-action` refuses to run when the workflow differs from the
  default branch — and editing the agent definitions has no effect because the
reviewer harness reverts them before the reviewer reads them, which is the same
protection that makes the breach above impossible to sneak past.

**So no pull request can fix this gate from inside the gate**, and the way
through is a decision, not a commit. Options are on #6.

- **Two gaps in the guard, both found by `test-auditor` and both still open.**
  `scripts/ai-review.test.mjs` holds the briefs to the verdict pattern and
  proves the reviewers are not told to write files and hold no `Write` tool. It
  does **not** cover either of these:
  1. A pull request *relaxing* what a blocking reviewer must check. The test
     catches a reviewer being told to write a file; it says nothing about one
     being told to check less.
  2. `.claude/rules/**` and root `CLAUDE.md`. Both change what a reviewer
     enforces as surely as a brief does — `server-domain.md` states the AR-03
     rule that `implementer` and `test-author` work to — and neither is pinned
     by any test.
- **The protection is indistinguishable from the attack, and that is its own
  problem.** On one branch, hours apart, two `test-auditor` instances met the
  same reverted working tree: one called it "unrelated harness/session state,
  not part of PR #6" and audited the committed files; the other reported it as
  out-of-band tampering and told the owner to treat it as a security incident.
  `safety-reviewer` met it too and drew the first conclusion. All three behaved
  correctly — escalating what you cannot verify is the right instinct — but a
  guard that looks exactly like the thing it guards against will keep producing
  false alarms, and a reader who learns to wave them through will wave the real
  one through too. Whatever fixes `ai-review.yml` should make the reversion
  *legible*: say in the reviewer's own prompt that these paths were reset and
  why, so the difference between "protected" and "attacked" is readable rather
  than inferred.
- **The auto-revert's real scope, now confirmed by observation.** D-069 recorded
  it as covering `.claude/agents/*.md` and left the rest open. `code-reviewer`
  checked its own sandbox directly and reported the boundary: `.claude/agents/*.md`,
  `.claude/rules/server-domain.md` and `CLAUDE.md` **were** reverted to
  `origin/main`'s content, while `docs/plan/decisions.md`, `docs/progress.md`
  and `scripts/ai-review.test.mjs` were **not**. So the revert covers agent
  briefs, rule files and root `CLAUDE.md` — wider than D-069 claimed — and
  leaves the decision log and scripts alone. Established rather than inferred,
  which is what that entry asked for.

## D-070 — `test-auditor` reads the slow gates instead of re-running them
- **Date:** 2026-09-23 · **Status:** Accepted (owner, in conversation) ·
  **Section:** 6
- **What that status does and does not mean.** The owner chose this in
  conversation with Claude. It is **not** a claim that the owner has formally
  approved any pull request carrying it, and a reviewer cannot verify the
  conversation from inside the diff — D-069 says exactly this, and it applies to
  D-070's own status line. `test-auditor` made the point against this entry.
- **Decision.** `test-auditor`'s brief no longer orders it to re-run
  `pnpm mutation --incremental` or the coverage gates. `req:coverage` stays (it
  takes seconds, and its output is what the RG-01 judgement is made on); the
  ratchet becomes reading the `coverage-baseline.json` diff, because the
  arithmetic is the `traceability` job's to enforce while the *reason* for a
  lowered number is the auditor's; mutation is read from its check, not run. It
  may still re-run a gate it genuinely doubts, and must then say in its findings
  why — the line is between doubting a result and wishing to confirm one.
- **Why.** Each of those is already a **required check on the same commit**:
  `mutation` (RG-05), `traceability` (RG-01, RG-03, RG-04). If one is red the
  pull request cannot merge whatever the auditor concludes, so re-running them
  cannot change an outcome — it only spends the review. A full pass costs about
  six and a half minutes of mutation plus four test suites. What the auditor
  uniquely gives is judgement those gates cannot make: whether the tests mean
  anything, whether an existing test was weakened for a bad reason, whether a
  requirement ID is a real claim or a word in a comment. That is reading work.
- **This weakens nothing.** What it stops re-running are checks that must be
  green on this commit for the pull request to merge at all. Nothing becomes
  unverified; it stops being verified twice.
- **What this is NOT.** It is **not** a fix for `ai-review (test-auditor)`
  failing with `produced no verdict file`, and must not be recorded as one. That
  was the hypothesis this decision was first written around, and the job log
  falsifies it. Read the evidence before building on it:
  - On `32bf28c` (run 35835508846, attempt 2, job 107106395461) the
    `claude-code-action` step ran 2 min 11 s and **succeeded**. Its own result
    record says `subtype: success`, `is_error: false`, `duration_ms: 95476`,
    `num_turns: 7`, `permission_denials_count: 0`, on `claude-sonnet-5` with a
    1,000,000-token context. It then wrote no file, and `No buffered inline
    comments` — no comment either. Only the separate `Enforce the verdict` step
    failed.
  - Seven turns in ninety-five seconds is an agent that stopped believing it was
    finished. It did not run out of room, hit a denial, or collapse under the
    slow gates — **it never attempted them**. A real mutation run alone would
    have taken four times the whole step.
  - And the brief's work plainly *can* complete: on an earlier commit
    `test-auditor` posted a full review reporting `test:unit` 343/343,
    `test:integration` 6/6 against a real PostgreSQL container, `test:system`
    10/10, the ratchet, `tests:changes`, and **mutation at 97.37 %** — then
    ended `VERDICT: PASS`. That run did all the slow work and produced a
    complete review; its check still failed, because the gate reads the file and
    never the comment (D-069).
  - So the two runs fail for opposite reasons, and neither is fixed here. The
    verdict file is written by the agent that *invokes* the reviewer, per the
    prompt inside `ai-review.yml` — which is on `main`. A branch cannot test a
    change to it, because `claude-code-action` refuses to run when the workflow
    differs from the default branch. That remains the open defect.
- **Three hypotheses about that defect have now been wrong**, each stated with
  more confidence than the evidence carried: "an unreliable agent" (read off the
  reviewer's comment, the one artefact the gate ignores), "it exhausted its
  budget" (it ran the shortest of the five), and "the redundant slow gates
  starved it" (it never ran them). The pattern is reasoning from plausibility
  instead of reading the job log, which is the only artefact that says which
  branch of the enforcement fired. Read it first.
- **Half of this decision is currently unfollowable, and a reviewer found it.**
  D-070 says to *read* the `mutation` and coverage results instead of running
  them. The reviewer cannot read them: `ai-review.yml` grants the reviewer job
  `contents: read`, `pull-requests: write` and `id-token: write`, with no
  `checks: read`, so the check-run API answers 403. Two `test-auditor` runs hit
  it independently and both said so plainly rather than claiming a verification
  they had not made — which is the behaviour the non-negotiables ask for, and
  the reason the gap surfaced at all instead of turning into a quiet false
  assurance.
  The brief now says this outright: read the check if you can, say so plainly
  when you cannot, and do **not** re-run the gate to compensate, because it is a
  required check either way and the merge is gated on it whether or not the
  reviewer could see the number.
- **And the real fix is not one line, which is what this entry first claimed.**
  `code-reviewer` took the same finding two steps further, and both hold up
  when checked:
  1. **The subagent has no way to ask.** `test-auditor`'s frontmatter is
     `tools: Read, Grep, Glob, Bash` — no GitHub-reading tool at all. The MCP
     github tools in `ai-review.yml`'s `claude_args` go to the *invoking*
     session, not the subagent. So `checks: read` on the job would not by
     itself put the answer within the auditor's reach.
  2. **There is nothing to read yet.** `ci.yml` and `ai-review.yml` are
     independent workflows on the same `pull_request` trigger with no `needs:`
     between them (`ai-review`'s only `needs:` is its own `changes` job).
     Nothing orders them, so `mutation` may not have finished — or started —
     when the auditor looks. A check read too early is worse than no check,
     because it reads as a result.
  The option that solves both, and the one to try first: have the **workflow**
  fetch the check result for the commit and inject it into the prompt as text.
  Then the subagent needs no tool and no permission, and the workflow is the
  thing that waits. That is `ai-review.yml` work, and it has to happen on
  `main`: `claude-code-action` refuses to run when the workflow differs from the
  default branch, so a branch cannot test a change to it. Alongside
  `produced no verdict file`.

- **The CODEOWNERS claim was wrong about one file, and it is the one this
  change touches.** D-069 and this pull request both argued that the affected
  paths need the owner's approval regardless, because CODEOWNERS gates them.
  `privacy-security-reviewer` checked and found root `CLAUDE.md` was **not**
  listed — while CODEOWNERS' own header says everything unlisted "auto-merges
  when all required checks pass". So the file that states the non-negotiables,
  the roles and the rule that decisions here are binding could be changed
  without the owner ever seeing it: the same class of gap D-069 exists to
  describe, sitting one line away from the paths it does cover.
  Closed here, in both places that have to agree: `/CLAUDE.md @bvst` in
  `.github/CODEOWNERS`, and `/CLAUDE.md` in `OWNER_APPROVAL_PATHS` in
  `scripts/lib/merge-rules.mjs`, which is the list CI-01 holds that file to.
  Adding it to only one would have left `gate:integrity` disagreeing with the
  repository, which is exactly what that check exists to catch.

- **The brief now checks the premise it rests on.** All of D-070 depends on
  `mutation` and `traceability` genuinely being required checks on the commit
  under review. The brief asserted that rather than confirming it, so nothing in
  it would notice a commit where branch protection had lapsed, been
  misconfigured, or did not apply — a fork, say. It now says to run
  `pnpm run gate:integrity` first, and to run the gates directly and say why if
  that comes back red or without those checks in its list. `test-auditor` found
  this, having confirmed the premise itself rather than assuming it.

- **A follow-up worth doing, and the precondition that makes it safe.** The
  duplication across the five briefs is now roughly 35 lines each — the verdict
  block plus the approval rule from D-071 — and D-069's own history is what
  happens when those copies drift: `**Verdict: PASS**` in one file,
  `VERDICT: APPROVE WITH COMMENTS` in another. `code-reviewer` has raised it
  twice and is right; the second push made it worse.
  The repository already has the mechanism — each agent's `skills:` list, which
  these reviewers already use for `testing-conventions`. So extract both blocks
  into one skill (`reviewer-protocol`), point all five at it, and have
  `scripts/ai-review.test.mjs` assert that each brief *lists* the skill and that
  the skill carries the wording.
  **Not done here, for a reason worth stating rather than deferring vaguely.**
  Moving the verdict instruction out of the brief only works if the skill's text
  actually reaches the reviewer subagent inside `claude-code-action`. That the
  `skills:` key is present in the frontmatter is not evidence that it does, and
  a cloud session cannot run the reviewer harness to find out. If it does not
  reach them, D-069's fix regresses **silently** — reviewers go back to writing
  unparseable verdicts and the checks go red for no visible reason. Confirm the
  skill content arrives first, in one throwaway pull request that changes
  nothing else; then do the extraction.

- **Why this is the owner's decision and not mine.** It changes what a blocking
  reviewer does, inside the pull request that reviewer is judging — the same
  shape `test-auditor` blocked earlier on this branch, and the reason D-069
  records that D-031 delegates library and tool choices, not the reviewer trust
  boundary. The owner chose it explicitly when asked.
- **It cannot take effect on PR #6.** The reviewer harness reverts
  `.claude/agents/*.md` to their pre-pull-request contents before a reviewer
  reads them, so no pull request can change the brief of the agent reviewing it.
- **Why this lives in its own pull request.** `test-auditor` blocked #6 for
  carrying these changes, and it was right: a pull request that edits the briefs
  of the blocking reviewers judging it is indistinguishable in form from prompt
  injection, and a decision record inside the diff asserting the owner approved
  it is not evidence of approval from where the reviewer stands. The owner chose
  to split rather than override. It also named a real gap — the guard test
  covers reviewers being told to write files, but not a pull request *relaxing*
  what a blocking reviewer must check.
- **This pull request merges after #6, not before.** `CLAUDE.md`'s change here
  documents `test:integration`, `test:system`, `test:coverage` and `api:spec`,
  which #6 creates; `.claude/rules/server-domain.md` cites D-067 and
  `packages/config/eslint/index.test.mjs`, also from #6. Landing this first
  would document scripts and a lint rule that do not exist yet.

## D-071 — `urso-agent` is a code owner, and approval is GitHub's to enforce
- **Date:** 2026-09-23 · **Status:** Accepted (owner) · **Section:** 6
- **Context.** Auditing #7, `test-auditor` blocked it: the only approval came
  from `urso-agent`, an account with write access that appeared nowhere in
  CODEOWNERS or `docs/plan/`, on paths CODEOWNERS assigned to `@bvst` alone.
  `privacy-security-reviewer` reached the same finding independently. Both were
  right that nothing explained the account, and both were wrong to read that
  silence as the approval being illegitimate. The silence was the defect.
- **Why a second owner is necessary, not a convenience.** **GitHub does not let
  anyone approve their own pull request**, and the pull requests here are opened
  by `@bvst`. With `@bvst` as the sole code owner, the code-owner rule could
  never be satisfied on the work this repository actually does: it would block
  every change rather than check any. A gate that can only ever say no is not a
  gate. `urso-agent` is the owner's second account and exists for this.
- **Decision.** Every CODEOWNERS path now reads `@bvst @urso-agent`, and the
  file says why in a comment rather than leaving the next reviewer to infer it.
  `scripts/lib/merge-rules.mjs` already accepted any owner — it checks a path is
  claimed, not by whom — so only its suggested-fix text needed updating.
- **A reviewer never blocks on "this has not been approved yet".** That is
  GitHub's to enforce, through the ruleset, and it does: an unapproved pull
  request does not merge. A reviewer cannot see the future and cannot know
  whether approval is coming, so treating its absence as a finding turns a
  normal state — a pull request early in its life — into a red blocking check,
  and trains everyone to merge past red. **What remains a real finding** is the
  repository being wrong: a path that needs an owner and has none, a bypass
  actor, a rule that is off. The line is between *the rules are inadequate*,
  which is the reviewer's business, and *the rules have not finished running
  yet*, which is not.
- **What stays open, and is genuinely the owner's.** The live ruleset pairs
  `require_code_owner_review: true` with `required_approving_review_count: 0`,
  and `docs/plan/merge-rules.md` has flagged that pairing as unverified since
  INF-04. Adding a second owner makes the gate *satisfiable*; it does not prove
  the gate is *enforced*. INF-10's drills settle that, and the honest position
  until then is that we believe it holds and have not watched it hold.
- **On how this surfaced.** Two blocking reviewers independently refused to
  accept an approval they could not trace to a documented owner, on a change to
  the reviewers' own trust boundary. That is the behaviour D-043 exists to buy.
  The fix is to write down what they could not find, not to teach them to stop
  looking.

## D-072 — One approval is required, and the gate checks it
- **Date:** 2026-09-23 · **Status:** Accepted (owner) · **Section:** 6
- **What was wrong.** `require_code_owner_review: true` sat next to
  `required_approving_review_count: 0`. The first has nothing to attach to
  while the second is zero — GitHub asks for a code owner *among the approvals
  it requires*, and zero of them is none. Paired with
  `dismiss_stale_reviews_on_push: true` it is worse than inert: **every push
  erases the approvals and nothing asks for them back**, so the rule cannot
  survive a single push.
- **This is not a hypothetical, and the evidence is our own.** #6 merged at
  10:19 on head `f2e8679` with **no standing approval at all** — its newest
  review is `DISMISSED`, on the earlier commit `81166b2` — while touching
  `/scripts/`, `/docs/plan/decisions.md`, `/.github/`,
  `/apps/server/src/domain/`, `/apps/server/src/worker.ts` and `/package.json`,
  every one of them assigned to `@bvst` alone at that moment. Independently,
  `test-auditor` found `gh pr view --json reviewDecision` returning **empty**
  on #7 despite a real approval, which is what GitHub returns when review is
  not required at all.
  One honest caveat: the owner may have relaxed a setting to land #6, so #6
  alone is not airtight. Taken with the empty `reviewDecision`, the picture is
  consistent and the risk is not worth carrying either way.
- **Decision.** `required_approving_review_count` goes to **1** in
  `docs/plan/main-ruleset.json`, and `gate:integrity` now fails when it is
  below 1. The cost `merge-rules.md` feared — every pull request waiting for
  the owner — no longer applies: `@urso-agent` is a code owner (D-071), so its
  approval satisfies both the count and the code-owner rule.
- **Be clear what this buys.** `@urso-agent` approves automatically, within a
  minute of each push. So this closes the "merged with zero approvals" hole and
  makes CODEOWNERS mean something; it does **not** add human judgement. The
  real protection remains the required status checks. A human gate on the
  safety paths specifically would need a different mechanism, and is not what
  this decision claims to provide.
- **Why the gate missed it.** `reviewRuleset` checked that
  `require_code_owner_review` was *on* and never that it was on in a
  configuration where it bites — so it reported **5 of 5** while the rule did
  nothing. That is the shape the non-negotiables now name directly: a check
  that confirms a flag rather than an effect is a check that can be green about
  nothing.
- **Not changed here:** `require_last_push_approval` stays `false`. Turning it
  on would be the stronger setting and the owner did not ask for it; changing a
  merge rule beyond what was asked is the thing D-029 exists to prevent. Raised
  as a question instead.

## D-073 — The verdict comes back as structured output, not as a file

**Decision.** `ai-review.yml` asks `claude-code-action` for a
`--json-schema` result with a `verdict` field constrained to `PASS` or
`BLOCK`, and the enforcement step reads `structured_output`. No reviewer
writes `review-<agent>.md`, and the harness no longer holds `Write` at all.

**The defect this replaces.** The workflow asked for two artefacts in one
clause with no ordering — save the file *and* post a comment. The agent
produced the artefact a person would read and dropped the one only a script
would, and the gate read only the dropped one. On PR #8's commit `3f1f04d`
all three reviewers that ran failed this way, two of them blocking, each
having posted a complete review comment first — `privacy-security-reviewer`
had even run the tests and reported 32/32. A review that genuinely happened,
and said so in public, was recorded as not having happened.

**Why not a better-worded instruction.** That lever was pulled and did not
hold. D-069 rewrote the five briefs to put the verdict last and name the
rejected forms; `code-reviewer` then returned `VERDICT: APPROVE WITH
COMMENTS` on a branch that changed nothing under `.claude/`, with
`VERDICT: PASS WITH COMMENTS` named as forbidden in the very file it read.
An enum does not leave the choice open; prose does.

**What was verified before merging, and what could not be.** The mechanism
is real, not assumed: `--json-schema` is exercised by the action's own
`test-structured-output.yml`, and `structured_output` is set in
`src/entrypoints/run.ts`. The end-to-end behaviour **could not** be tested
first — `claude-code-action` refuses to run when the workflow differs from
the default branch, so the pull request carrying this change necessarily has
no reviewer output and goes red for that reason. It says so in its own error
text. Whether this works is answered by the *next* pull request, not this
one.

**Kept deliberately.** Two verdicts and no third. `APPROVE WITH COMMENTS` is
a request for a middle verdict, and refusing the middle verdict is the
design: qualifications belong in the findings, where they are read, not in a
value a script must interpret. Widening the accepted set would have made
this failure disappear by conceding the point it exists to make.

**Also fixed, because the log had to send its reader elsewhere.** A rejected
verdict is now echoed in the error. Previously the log named only what it
expected, so finding out what actually happened meant reading the pull
request comment — the one artefact the gate ignores. A repository whose
non-negotiables say *read the job log before theorising* has to make the log
enough on its own.

**Tests.** `ai-review.test.mjs` now reads the enum out of the workflow and
holds the briefs to it, asserts the pattern rejects the forms that actually
broke this gate (`APPROVE WITH COMMENTS`, `PASS WITH COMMENTS`, wrong case,
empty), and asserts no reviewer is asked for a file and none can write one.
`gate.test.mjs`'s tool-grant test required `Write` for a premise this change
removes; it now requires the read and comment tools, and the stricter
assertion — that `Write` is absent — lives beside the reasoning in
`ai-review.test.mjs`.

## D-074 — The test-naming rule applies to requirement tests, not gate tests

**Decision.** `.claude/rules/tests.md` asks for an `<ID>-ACn:` prefix on tests
that prove a requirement. Gate and tooling tests under `scripts/` are exempt
and describe the behaviour they hold instead.

**Why this came up.** `test-auditor` and `code-reviewer` raised it
independently, on different pull requests, both noting the same thing: the rule
said every test, and **no test in `scripts/` has ever followed it**. A rule that
universal practice ignores is not a rule, it is a finding waiting to be
re-raised on every infrastructure change.

**Why the rule moved rather than the tests.** Checked rather than assumed, from
`scripts/lib/requirements.mjs` and the generated report:

- `collectRequirements`'s `SOURCES` reads four documents — the MVP scope, and
  the REL/SEC, PRIV and SM rule tables. There is no CI document among them.
- `CI-` appears **zero times** in `docs/requirements-status.md`.

So `CI-01` is not a tracked requirement ID. Prefixing gate tests with it would
satisfy the letter of the rule while `req:coverage` ignored every one of them —
the appearance of traceability over a number that cannot move. That is the
exact shape of decorative check this repository has spent a day digging out of
its own gates, and adding one deliberately would be worse than the
inconsistency it fixes.

**What this does not change.** Everything else in `tests.md` still applies to
gate tests: the fake clock, no `.skip` or `.only`, no assertion removed without
a written reason, and the `// req-coverage: fixtures-only` marker on files that
quote requirement IDs as sample data. Only the naming prefix is scoped.

**The owner decided this**, after both reviewers asked for a deliberate
decision rather than a quiet edit. Renaming every gate test was the alternative
and was declined.

**`.claude/hooks/` is covered too, and its prefixes stay.** `test-auditor`
found the first version of this decision half-finished: `.claude/hooks/*.test.mjs`
matches the same `**/*.test.mjs` glob and carries `HK-01`-style prefixes, and
`HK` is exactly as untracked as `CI` — its source document is not in `SOURCES`
and `HK-` appears zero times in `docs/requirements-status.md`. Verified both
before agreeing.

The resolution is not to strip those prefixes. **Exempt is not forbidden.**
`HK-01` names a real hook requirement and makes the test findable; what the
exemption removes is the *obligation*, and with it the implication that a
prefix creates coverage. It never did: `mentions()` counts an ID anywhere in a
test file's text, never in the test name — which is a sharper version of this
decision's own argument than the one first written, and came from
`privacy-security-reviewer` reading `requirements.mjs` rather than taking the
rationale on trust.

**Reading a `.claude/**` change under review.** The working tree a reviewer
sees has `.claude/rules/**` and `.claude/agents/*.md` reverted to their
pre-pull-request contents, so the Read tool shows the *old* text while the
commit holds the new one. `git show HEAD:<path>` and
`git diff origin/main...HEAD -- <path>` show what actually changed;
`privacy-security-reviewer` found that route unaided and reviewed this decision
through it.

Stated precisely, because a reviewer went looking and could not find it:
**this is behaviour of the environment the reviewer runs in, not automation in
this repository.** A grep of the workflows, `.claude/hooks/`,
`.claude/settings.json` and `.git/hooks/` turns up nothing that reverts these
paths, and the symptom still reproduces. Earlier wording called it "the
reviewer harness", which sent someone hunting in the repository for a mechanism
that is not there.

**Addendum, 2026-09-23 — the exemption is keyed to proof, not to a directory.**
The decision above names `scripts/` and `.claude/hooks/`. `code-reviewer` found
`packages/config/eslint/index.test.mjs` naming its tests `AR-03:` and `AR-06:`,
which is the same shape of untracked prefix and lives in neither directory — so
a rule keyed to paths needs amending every time a tooling test appears
somewhere new. The live rule now reads: a test that proves no **tracked**
requirement is exempt, wherever it lives, with those paths as examples.

Recorded here rather than left in the rule file alone, because D-074 exists
precisely because two reviewers asked for a deliberate decision instead of a
quiet edit — and widening it quietly would have repeated what it was written to
stop. Both reviewers on #13 asked for this addendum independently.

**And a correction to the definition.** The first wording said tracked means
"the ID's source document is in `collectRequirements`'s `SOURCES`". That is
wrong, and self-contradicting: `docs/plan/05-architecture.md` **is** in
`SOURCES`, `AR-01`…`AR-12` live in it, and they are excluded by that entry
collecting `prefixes: ['SM']` only. Read literally the definition made `AR-03`
tracked, in the clause immediately before listing `AR-` as untracked. Tracked
now means what `req:coverage` actually counts — the prefix is collected — with
`docs/requirements-status.md` as the check.

## D-075 — Changes to `ai-review.yml` are merged by hand

**Decision.** `.github/workflows/ai-review.yml` is its own class of change. The
AI reviewers cannot review it, so a pull request touching it is merged manually
by the owner, with the three blocking reviewer checks red. Changes to that file
are **batched** rather than shipped one at a time.

**Why it cannot be reviewed.** `claude-code-action` refuses to run when the
workflow differs from the repository's default branch:

> Skipping action due to workflow validation: The workflow file must exist and
> have identical content to the version on the repository's default branch.

That is a deliberate defence — a pull request must not be able to rewrite the
workflow holding the secrets and have the rewritten version run — and it means
**the one file that decides what the reviewers check is the one file they are
structurally unable to look at.** Not "hard to"; cannot.

**Four cases in one day**, which is what turned this from a curiosity into a
policy: bounding the workflow's own jobs with `timeout-minutes`; the guard
message that misattributes a Dependabot secret failure; every Dependabot bump of
`actions/checkout`, `actions/setup-node` or `pnpm/action-setup`, because that
workflow pins them; and the guard that reads a cancelled run as a failed one.

**The alternative, considered and not taken.** A `workflow_run`-triggered
reviewer runs from the default branch's definition, so a pull request cannot
change what reviews it — which would dissolve all four cases. It also hands
secrets to a run evaluating unreviewed code. For a safety-critical repository
that trade needs its own decision with its own evidence, not a default chosen
while fixing something else. Left open deliberately.

**What this costs, stated plainly.** Every change to the reviewer gate goes in
unreviewed by the gate itself. Human review is the only review those changes will
ever get, which is an argument for making them rare and batched, and for reading
them harder than anything else in the repository.

**What it does not license.** Nothing else gets a manual merge. A red check on
any other path is work, not a candidate for the same treatment.

## D-076 — Daily status v1, as installed
- **Date:** 2026-09-23 · **Status:** Accepted (delegated, D-031; item 4 by the owner) · **Section:** 9
- **Context:** INF-09 installs D-050's daily report and D-051's owner-question
  template. The 08b draft had Claude run `/status` and post the comment itself,
  holding the Claude app's token. Two failures this repository has already had
  argue against that shape: a reviewer that posted its review and skipped the
  file the gate read (D-073), and one that returned a placeholder verdict over a
  review that never happened (#15).
- **Decision:**
  1. **Claude writes; a script posts.** `daily-status.yml` has two jobs.
     `report` runs `claude-code-action` and gets the report back through
     `--json-schema` — `status` (`healthy`, `attention` or `action`) and
     `report` (markdown). `post` runs `scripts/daily-status.mjs`, which turns
     `status` into the ✅ / ⚠️ / 🛑 headline and posts the comment. "Starts with
     ✅, ⚠️ or 🛑" therefore holds by construction, not by instruction.
  2. **The job that reads other people's text cannot write.** `report` holds
     read permissions only and passes its own `GITHUB_TOKEN` as `github_token`,
     so the action never exchanges OIDC for the Claude app's token, which can
     write. Verified in the pinned action's source (`src/github/token.ts`,
     `setupGitHubToken`: a provided token skips the exchange entirely). Its
     tools are Read, Grep, Glob and a list of read-only `git`, `gh` and
     `pnpm run req:coverage` commands. **The token is the boundary, not the
     list:** the project's `.claude/settings.json` still allows `Bash(pnpm *)`
     and some `gh` writes in every session, and with a read-only token those
     writes fail rather than land.
  3. **A morning without a report still reaches the owner.** `post` runs
     whenever `report` finishes (`!cancelled()`), and on any failure posts
     "🛑 Action required — no report today" with the reason and the run link,
     then exits 1. D-050 asked for a failure to show in CI; this puts it on the
     owner's phone as well, since a red run is seen only by someone already
     looking at the Actions tab.
  4. **A morning when the workflow does not run at all pages the owner through
     Healthchecks.io.** The owner chose this (asked 2026-09-23, recommendation
     accepted). The last step pings `HEALTHCHECKS_DAILY_STATUS_URL` every run,
     `/0` for a posted report and `/1` otherwise; no ping within the check's
     period and grace pages the owner. Until the secret exists, each report
     says so and the run is red (A-16).
  5. **Reaching the phone.** The workflow creates the "Daily status" issue,
     assigns it to the repository owner (which subscribes them) and pins it;
     each comment also mentions the owner, because a mention is what GitHub
     Mobile pushes by default. It creates the `daily-status` and
     `owner-question` labels too: GitHub applies a template's label only if it
     exists, and a question filed without it would be invisible to the report
     that counts those questions.
- **What could not be verified before merging.** GitHub runs scheduled and
  manual workflows only from the default branch, so no run of this workflow is
  possible from the pull request. Everything that can be held without one is
  held by tests: the poster's logic (100 % lines and branches), the entry
  script run as a real process, the workflow's permissions, tools, schema and
  step order, and the ping step's own shell script executed against a stand-in
  `curl`. That the action accepts a read-only token on a `schedule` event, that
  `gh issue pin` works with `GITHUB_TOKEN`, and that the mention pushes to the
  owner's phone are **not verified** — the first run answers all three, and
  INF-09 is done only when the owner confirms the report arrived (A-17).
- **Residual risk, stated plainly.** The script checks that a report arrived
  with a valid status. It does not judge whether the report is true. "One
  phone screen" is asked for in the prompt and not enforced.
- **Consequences:** One more workflow run a day, estimated at 5–10 Actions
  minutes across the two jobs until the first run measures it, against a
  private repository's minutes (see the budget gotcha in `docs/progress.md`).
  The GitHub tools in a cloud session act as `@bvst` (checked with `get_me` on
  2026-09-23), so an owner question filed from a session is the owner's own
  issue, and GitHub does not notify people of their own actions. The daily
  report is therefore where those questions reach the owner.

## D-077 — Staging v1: where it lives, who holds its key, and how it changes
- **Date:** 2026-09-24 · **Status:** Accepted (items 1–4 by the owner; the rest delegated, D-031) · **Section:** 8
- **Context:** INF-07 builds staging on Clever Cloud (D-025, D-046). Four
  questions were the owner's, because they spend money or hand out keys; the
  rest are how the pieces fit. Recorded together because they are one design.
- **Decision — the owner's (asked 2026-09-24, one at a time):**
  1. **Staging is its own Clever Cloud organisation**, `TryggHverdag Staging`,
     owned by the owner's account (A-18). The price is the same as a personal
     space; the organisation is what lets the next item limit a key to staging.
  2. **CI holds the key of a dedicated user that is a Manager of the staging
     organisation and nothing else** (A-19). A Clever Cloud key reaches every
     organisation its user belongs to, so the user's memberships are the
     boundary, not the key. Production gets its own user at go-live. The owner's
     main account (`dev@urso.no`) is deliberately not that user.
  3. **One nano instance** (512 MB), not the XS that D-046 names. D-046's "about
     €5 a month" did not survive checking: secondary sources put XS at about
     €16 and nano at about €6 a month (the live prices load from the Clever
     Cloud API, which sessions do not reach). Nano keeps D-048's €5–10. **This
     amends D-046's instance size.**
  4. **Terraform is applied by two runs the owner starts** (`infra-staging.yml`):
     `plan`, which the owner reads, then `apply`, given that run, which applies
     only an identical plan. The first proposal — a GitHub environment that
     pauses for the owner's approval — does not exist for private repositories
     below Enterprise (GitHub's documentation, checked 2026-09-24), which was
     found before building on it.
- **Decision — delegated (D-031):**
  5. **The approval is a fingerprint, not a stored plan.** A saved plan holds
     the database password in plain text and anyone who can read the repository
     can download a run's artifacts, so the plan run publishes a SHA-256 of the
     planned changes and the apply run compares its own. Anything that moved in
     between — code, state, the platform — changes the hash and stops the apply.
  6. **Claude's sessions cannot start or re-run a workflow run, by any route
     found.** GitHub sees a session's tools as the owner, so it could not tell
     "the owner pressed Run" from "a session did". Closed, every one (the owner
     chose "all" over "the obvious ones"): the GitHub tools that start, re-run
     or re-run failed jobs, and their command-line forms, are denied in
     `.claude/settings.json`; HK-03 blocks the shell routes — the command-line
     tool with or without flags before the subcommand, the REST dispatch and
     re-run endpoints, Terraform apply and destroy, and the deploy through its
     wrapper script. `.claude/hooks/guard-bash.test.mjs` reads the deny list,
     so a route dropped from it fails a test. **This is a local rule, not a
     GitHub one**: it binds sessions run from this repository, and nothing
     else. HK-03 matches text, so it also blocks a command that merely
     *mentions* those routes — writing this entry through a shell was blocked
     for that reason.
  7. **Keys live in the GitHub environment `staging`, limited to `main`**
     (A-21): no pull-request branch can reach them, including a session's.
  8. **Terraform 1.16.4 is downloaded and checked by hash** by
     `scripts/lib/terraform.mjs`, with HashiCorp's call home turned off, so CI,
     sessions and the Mac run one version. `infra:check` (fmt, the lock file,
     validate — offline, no credentials) is part of `gate:static`. Terraform's
     licence has been BUSL-1.1 since 1.6. That allows running it on our own
     infrastructure; what it restricts is offering a competing hosted product.
     It is a tool CI downloads, not a package, so `licenses:check` (which reads
     the npm tree) does not see it — this is where it is recorded.
  9. **State lives in the Cellar bucket `trygg-hverdag-staging-tfstate` in the
     staging organisation**, as Clever Cloud's own Terraform page recommends,
     created by hand (A-20) because a backend cannot create itself. The
     organisation's ID is committed in `infra/staging/staging.auto.tfvars`
     (A-18); it is an identifier, not a secret. No state lock: Cellar's support for S3's
     conditional writes is unverified, so the workflow runs one at a time
     instead.
  10. **No build step.** Node strips the TypeScript at start-up
      (`--experimental-strip-types`, on by default from 22.18; named so an older
      22 cannot fail). `apps/server/src/bin/bin.test.ts` runs the real entry
      files under plain `node`, because every other test runs through Vitest,
      which compiles TypeScript itself.
  11. **The worker runs beside the API on the same instance**
      (`CC_WORKER_COMMAND`, restart `always`, 5 s delay), exactly one instance,
      so exactly one worker inside the DEV plan's five connections.
      `runWorkerProcess()` (`apps/server/src/worker.ts`) owns its life: it
      starts the runner with `noHandleSignals: true`, stops once on SIGTERM or
      SIGINT and exits 0, and exits 1 when the runner ends without being asked
      (`untilStopped()`). Without `noHandleSignals`, graphile-worker's own
      SIGTERM handler ended the process before our stop had closed the pool
      (found in review, then checked against a real PostgreSQL). Restart is
      `always` rather than `on-failure` because systemd counts an exit after
      SIGTERM as clean. graphile-worker 0.18's `runner.promise` never rejects,
      so `untilStopped()`'s crash branch guards a later version, not this one.
      `bin/worker.ts` and `process.ts` are safety paths for the mutation gate.
  12. **Migrations run as the pre-run hook**, so a failed migration stops the
      deploy, and the database URL never leaves Clever Cloud (the 08b draft ran
      them from CI with the URL as a GitHub secret).
  13. **A deploy is done when the worker beats after it.** `/v1/health` answers
      200 whenever the API is up, and the old worker's beat stays fresh for
      three minutes, so "status ok" right after a deploy can come from a worker
      that no longer exists. The smoke test takes the database time of its
      first answer and waits for a beat more than 90 seconds later
      (`LINGER_MS`), both stamped by the database clock. Ninety seconds, not
      zero, because the old instance can outlive a deploy by a minute
      boundary and beat once more; it is a margin, not a measurement. The
      lasting fix is a beat that names the worker that made it (follow-up).
  14. **Process failures are reported, redacted.** The entry points print
      `<process> failed: <error ← cause>` with passwords removed from any
      connection string — the first output this server writes. D-068's warning
      was the reason: `pg` and `graphile-worker` errors can carry the connection
      string. **That is all this redacts, and it is not all the output.**
      graphile-worker's own logger writes INFO and ERROR lines, among them
      `Failed task … with error '<message>'` and its pool handler's
      `err.message`; Hono and `@hono/node-server` print errors they catch; Node
      prints an uncaught exception. None of those pass through
      `redactCredentials`. Drizzle's query errors put the query's parameters in
      the message. Today the only parameter bound is a heartbeat time and
      staging's data is synthetic, so nothing personal can reach a log yet; the
      first M2 task that binds a location or a phone number meets this before
      it ships (PRIV-07, follow-up below).
  15. **Staging answers at `trygghverdag-staging.cleverapps.io`**, fixed in
      Terraform so the smoke test and UptimeRobot (INF-08) have a stable
      address. Clever Cloud says `cleverapps.io` is not production quality;
      production gets its own domain (D-046).
  16. **Clever Cloud's CLI is the standalone clever-tools 5.0.2 binary,
      downloaded and checked by hash** (`scripts/lib/clever-tools.mjs`), the
      same way as Terraform, on the repository's Node 22. The npm package needs
      Node 24, and `npx` would resolve its dependency tree afresh at every
      deploy — in the one job that holds the Clever Cloud key. **The hash is
      trust-on-first-use**: no checksum published by Clever Cloud was reachable
      from this session, so it is the hash of the archive downloaded on
      2026-09-24. It proves the archive has not changed since, not that it was
      right then.
- **Known and accepted:**
  - **Mutation testing got slower.** Stryker's command runner runs the whole
    product suite once per mutant, and INF-07's tests start real processes: about
    7 s a run, 119 mutants, so about 10 minutes on CI's two cores — past the 590 s
    every gate command had. `MUTATION_TIMEOUT_MS` (25 minutes, held inside the
    job's 30 by a test) gives it room, and a run that does not finish is now
    reported as that, not as a score below 80 %. `stryker.config.mjs` says to
    make the suite faster rather than weaken the approach once it stops being
    fast; that is a follow-up, not done here.
  - **Nano runs at reduced CPU priority** on Clever Cloud's hosts and can slow
    under load. Fine for staging today; revisit before the staging canary
    (REL-10, M2) times alerts on it.
  - **Staging's PostgreSQL is 15** (the DEV plan offers only 15.18) while the
    other integration tests use 17. `deploy.integration.test.ts` runs the
    deploy sequence on 15 for that reason.
  - **Graphile Worker warns "Your pool doesn't have error handlers!"** at every
    start, and then installs its own: an idle connection's error on the
    worker's pool is logged (`err.message`) and the worker carries on
    (`installErrorHandlers` in `graphile-worker/dist/lib.js`, read
    2026-09-24). So D-068's "the error exits the process, which is loud" holds
    for the API's pool only. For the worker, the open question when D-068 is
    revisited is that message reaching the log unredacted, not a restart loop.
  - **An apply that cannot save its state leaves resources Terraform does not
    know.** Terraform writes `errored.tfstate` on the runner, and the runner is
    gone when the job ends. The workflow deliberately uploads no artifact,
    because state holds the database password. Recovery is by hand: delete the
    orphans in the console (while staging holds nothing), or import them. The
    first apply hit exactly this (BUG-2, 2026-09-24).
- **Not verified before merging, and how each gets verified:** that Clever
  Cloud accepts the flavour `nano` and the vhost as written (the Cellar
  host is no longer on this list: the owner read `CELLAR_ADDON_HOST` as
  `cellar-c2.services.clever-cloud.com` in A-20), that the provider maps `start_script` to the run command, and reading the plan run's
  log as the source of the fingerprint. (That last one is verified: the first
  apply found the plan run's fingerprint and matched it. The first *state
  write* was never on this list and should have been: planning only reads, so
  nothing before an apply could exercise it — BUG-2.) The first `plan` and `apply` (A-22) and
  the first deploy answer all of them; none can run from a pull request,
  because the keys are limited to `main`. Also open until the first deploy:
  - **Connections while old and new overlap.** If Clever Cloud keeps the old
    instance running while the new one starts, the old API and worker hold up
    to 2 + 2, the new migration takes the fifth, and the new API and worker
    then ask for more than the DEV plan's five. The health check reads the
    database clock, so a refused connection there fails the deploy — loudly,
    in the deploy and the smoke test. If it happens, the first thing to try is
    `POOL_SIZE.api = 1`, as its own change.
  - **Encryption in transit to PostgreSQL** (PRIV-08). The add-on's URI is
    used as given, with no `sslmode`; whether that connection is encrypted is
    not checked. Staging holds synthetic data only; this is settled before any
    real data, and before production.
  - **What the deploy log carries to GitHub.** The deploy step streams Clever
    Cloud's build and start-up log into the Actions log, which GitHub keeps
    outside the EEA (PRIV-05). Today that is build output and synthetic data;
    before production it needs a decision.
  - **The plan summary hides secrets — checked in part.** The provider's schema
    (read 2026-09-24) marks the app's `environment` and the database's
    `password` and `uri` as sensitive, so `terraform show` prints them as
    `(sensitive value)`. That it does so in the job summary is seen at the
    first plan run.
- **Follow-ups, each its own task:**
  - **Done, by the owner's choice (2026-09-24):** `ai-review.yml`'s safety
    filter lists `apps/server/src/bin/worker.ts` and
    `apps/server/src/process.ts`. It shipped first, in its own two-line pull
    request (#21, merged by hand under D-075 the same day). This change adds
    them to CODEOWNERS and `OWNER_APPROVAL_PATHS`, and keeps its own AI
    reviews by not touching that file.
  - A heartbeat that names the worker that made it, replacing `LINGER_MS`.
  - Redaction for the output item 14 names, before an M2 task binds a
    location or a phone number (PRIV-07).
  - `gate:integrity` checks that the `staging` environment is limited to
    `main` and that no Clever Cloud or Cellar key is a repository secret.
  - An import rule (AR-10): only `api-process.ts`, `worker.ts`, `bin/` and
    tests import `adapters/`. True today, enforced by nothing.
  - HK-05's test counter reads a `test.each` table only up to its first `)`,
    so a comment with brackets inside a table miscounts (a `fix/BUG` change).
