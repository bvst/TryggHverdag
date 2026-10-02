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
- **Amended 2026-09-25 (owner, asked in the INF-08 session with Claude's
  recommendation): the run is grouped.**
  - **Why:** #31's required `mutation` check timed out on CI — its log:
    `spawnSync pnpm ETIMEDOUT`, "Stryker did not finish … make that faster
    before raising MUTATION_TIMEOUT_MS". Two things above did not hold.
    "`--incremental` in CI keeps that affordable" is wrong: CI caches nothing,
    so every pull request was a full run of every safety file (test-auditor,
    INF-08). And each mutant ran the whole suite, which INF-08 made 40 %
    slower (13.2 s against 9.4 s at two cores, mostly real-process tests) while
    adding 44 mutants: 197 in all, about 26 minutes against a 25-minute budget.
  - **Decision:** `MUTATION_GROUPS` in `scripts/lib/gate-decisions.mjs` gives
    each group of safety files the tests that can kill its mutants — `domain`
    runs the domain tests, `healthchecks` runs the adapter's tests and
    `worker.test.ts`, and every other safety path runs the whole suite as
    before (`mutationRuns()`). `stryker.config.mjs` picks its run from
    `STRYKER_RUN`; `scripts/mutation.mjs` runs each in turn inside the one
    25-minute budget, which is not raised. Every safety file is still mutated
    on every pull request, and a test set that is too narrow can only score
    lower, never falsely higher. `worker.ts`, `bin/worker.ts` and `process.ts`
    stay on the whole suite: `bin.test.ts` is the only test that runs the real
    worker process.
  - **Measured** (fresh, no reused results, pinned to two cores like CI):
    954 s in all — domain 69/69, healthchecks 44/44, whole-suite 82/84
    (97.62 %; the two survivors are string literals in `worker.ts` that no
    test reads). The earlier "three survivors in `process.ts`" were stale
    incremental results: fresh, it is 25/25.
  - **Not done, and D-036 still says it:** the nightly full run was never
    built. Grouping keeps every pull request a full run, so nothing is left
    unmeasured meanwhile.

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
      **Corrected by BUG-3 (2026-09-25):** items 11 and 12 held for the app's
      own machine only. Clever Cloud also starts `CC_WORKER_COMMAND` on the
      machine that builds a deploy. Both first deploys log that worker
      connecting 21 and 36 s before the migration ran, beside the old app's
      worker. So on every deploy there was a second worker, running new code
      against the old schema, past the connection budget. The worker now starts
      nothing when `INSTANCE_TYPE=build` (Clever Cloud's documented value) and
      waits to be stopped. `worker.test.ts` and `bin/bin.test.ts` hold it.
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
  15. **Staging answers at `trygg-hverdag-staging.cleverapps.io`**, fixed in
      Terraform so the smoke test and UptimeRobot (INF-08) have a stable
      address. Clever Cloud says `cleverapps.io` is not production quality;
      production gets its own domain (D-046). **Every name staging gets on
      Clever Cloud is spelled `trygg-hverdag`** (the owner, 2026-09-25),
      matching the state bucket: the app `trygg-hverdag-staging`, the database
      `trygg-hverdag-staging-db` and this address. A test in
      `scripts/infra.test.mjs` holds it. Names inside the code, such as the
      `@trygghverdag` package scope (D-057), are not Clever Cloud names and
      keep their spelling.
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
- **Answered by the first real runs** (2026-09-24 and 25, read from their
  logs):
  - **Terraform side:**
    - Clever Cloud accepted nano, the vhost, the hooks and the database link.
    - The fingerprint round trip works, and plans are reproducible
      (`Same plan as the one read in run …`).
    - The state write works since BUG-2 (`Apply complete! Resources: 2 added`).
    - The plan summary prints the password and URI as `(sensitive value)`.
  - **Clever Cloud side:**
    - It runs Node 22.23.3 and pnpm 10.33.0 from the lockfile.
    - `--experimental-strip-types` works with no build step.
    - The pre-run migration runs before start.
    - Its own health check gets 200.
  - **The deploy log in GitHub** carries environment variable *names*, never
    values. The PRIV-05 question stays open for production.
  - **Connections while old and new overlap:** no refused connection in two
    deploys. BUG-3 was the larger overlap, a whole extra worker. Still not a
    proof, and it stays on the list.
  - **Still open:** PRIV-08, encryption in transit to PostgreSQL.
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

## D-078 — The daily report runs at 04:47 UTC, off the top of the hour
- **Date:** 2026-09-25 · **Status:** Accepted (owner) · **Section:** 9
- **Context:** Amends D-050, whose 05:00 UTC was chosen for when the owner reads
  it, not for how GitHub schedules. The first scheduled run (run 35983876995)
  fired at 09:52 UTC on 2026-09-24 for the 05:00 slot — 4 h 52 min late. GitHub's
  documentation for the `schedule` event, read on 2026-09-25: "The `schedule`
  event can be delayed during periods of high loads of GitHub Actions workflow
  runs. High load times include the start of every hour." Its advice is to
  "schedule your workflow to run at a different time of the hour."
- **Decision:** `daily-status.yml` runs at `47 4 * * *` — 04:47 UTC, which is
  06:47 in Oslo in summer and 05:47 in winter, so the report still comes before
  07:00 Oslo time. Everything else in D-050 and D-076 stands.
- **What this does and does not establish.** One late run is one data point, and
  it was also the schedule's first day, which GitHub does not document either
  way. Moving off the hour follows GitHub's own advice at no cost; it does not
  prove the top of the hour caused the delay. The Healthchecks.io check (period
  1 day, grace 3 hours) is unchanged and still pages the owner if a day passes
  with no run at all.
- **Held by tests** in `scripts/daily-status.test.mjs`: the exact cron, a rule
  that no cron minute in the workflow is 0, and that the time the issue states
  is the time the workflow runs.
- **Consequences:** Issue #19's body was written once, at creation, and still
  says 05:00. It is updated after this merges; the code that writes the body
  for any future issue is changed here.

## D-079 — REL-08 on staging: UptimeRobot Free until go-live, Healthchecks.io for the worker
- **Date:** 2026-09-25 · **Status:** Accepted (owner, 2026-09-25; question asked
  in session with Claude's recommendation, answered "Free now, Solo at
  go-live") · **Section:** 8
- **Context:** REL-08 asks for checks every minute. Verified 2026-09-25 on
  uptimerobot.com/pricing: Free = "5 min. monitoring interval", keyword monitor
  included; Solo = "60-second monitoring interval", $12/month billed yearly
  ($144/y) or $13 monthly. Terms (uptimerobot.com/terms): "UptimeRobot is
  available for any use, including commercial and business use."
- **Decision:** staging uses UptimeRobot Free (5-minute keyword monitor on
  `/v1/health`, keyword `"status":"ok"`). The worker half of REL-08 is met
  every minute by Healthchecks.io (Hobbyist, $0): the worker pings after each
  recorded beat; check Period 1 min, Grace 2 min. Buying UptimeRobot Solo is an
  **M5 go-live gate item**. **Amends how REL-08 is met on staging only**;
  production at go-live meets it in full.
- **The adapter is a safety path; `config.ts` is not** (owner, 2026-09-25,
  asked with Claude's recommendation after `safety-reviewer` raised it).
  `apps/server/src/adapters/healthchecks.ts` holds the ping URL and `fetch`, so
  a later edit could make it ping without being asked — say once at start —
  and keep a crash-looping worker's check green: silent, the dangerous
  direction. It joins CODEOWNERS and `SAFETY_PATHS` in INF-08, and the
  ai-review `safety` filter in its own one-line pull request, merged by hand
  (#30, D-075). `OWNER_APPROVAL_PATHS` follows once #30 has merged:
  `scripts/gate.test.mjs` requires every owned `/apps/` path to be in that
  filter too, the same order INF-07 took with #21. `readHealthchecksSetting` stays out: if it ever
  threw, the worker would crash-loop, `/v1/health` would turn `degraded` and
  both monitors would page, so a mistake there fails loudly.
- **Design choices that set a pattern** (delegated, D-031, from the spec's
  Approach): ping only after a recorded beat; a failed ping is a line, never a
  failed task; a monitoring setting never stops the worker (the one exception
  to `config.ts`'s "a bad setting stops the process"); the ping URL is a secret
  and is never written; `http:` is refused and redirects are not followed, so
  the URL is never sent in clear; the Terraform variable is required,
  sensitive and validated, passed from the `staging` environment secret in both
  plan and apply; the provider (2.2.1, `update.go`, read 2026-09-25) restarts
  the app when `environment` changes. The drill is timed from the **last
  ping**, not from the stop: pings land at the start of each minute, so timing
  from the stop would give it up to a minute of luck.
- **Healthchecks.io commercial use, checked 2026-09-25:** its terms say
  nothing on it; its FAQ gives "a Hobbyist account with 20 checks for
  monitoring your company infrastructure" as allowed; the About page says
  "free for hobby use, for open source projects, and for non-profits". So
  Section 8's "paid for commercial use" (from a secondary source) does not
  hold as written; whether the AS pays for Business ($20/month, SMS and
  phone-call alerts) is a go-live question next to Solo.
- **Consequences:** a known gap — an API-only failure on staging may page
  later than 5 minutes (up to ~5–10 min); the drill (A-26) is INF-08's
  done-criterion and has not happened yet.
- **Update 2026-09-28:** the drill ran on 2026-09-26, and the owner accepted
  it on 2026-09-28, which closes INF-08.
  - Healthchecks.io alerted about 3 minutes after the worker's last ping.
    UptimeRobot alerted 48 seconds after that.
  - Both alert by email. UptimeRobot's app was not installed: "it is enough
    for now" (owner).
  - UptimeRobot's recovery and its keyword rule were not checked.
  - How production pages the owner stays the go-live question above.
- **Follow-ups for M2, where the watchdog task will find them:**
  - The check-in follows the **heartbeat**, not the watchdog's sweep. Once the
    watchdog runs in the worker, a broken sweep beside a healthy heartbeat is
    a ping saying a dead watchdog is alive. The watchdog's task must decide
    whether it checks in, or feeds the beat.
  - A slow Healthchecks.io holds one of the worker's two concurrency slots for
    up to 10 seconds a minute, and delays a stop by as much (measured by
    `safety-reviewer`: exit 6.8 s after SIGTERM during a hung check-in).
    Graphile's `helpers.abortSignal` could cancel the ping on stop.

## D-080 — The daily report is a dashboard, refreshed at 01:07 UTC
- **Date:** 2026-09-26 · **Status:** Accepted (owner) · **Section:** 9
- **Context:** Amends D-050 (a comment every morning), D-076 item 5 (the
  mention that made each comment reach the phone) and D-078 (04:47 UTC). Three
  days of running it showed:
  - **The comments pile up.** One a day turns the pinned issue into a log. The
    owner: "I don't need to know the logs of what was missing last time, I just
    need to know the current state of things."
  - **GitHub starts the scheduled run about 4¾ hours late**, at both slots
    tried: 05:00 → 09:52 (run 35983876995), 04:47 → 09:32 (run 36233069263).
    D-078's move off the top of the hour did not change the arrival — which
    D-078 said it could not promise.
  - **The missed-run alarm works.** On 2026-09-25 the switch to 04:47 skipped a
    morning, and Healthchecks.io paged the owner; the owner confirmed it.
- **Decision:**
  1. **Like Renovate's Dependency Dashboard.** Each run replaces the pinned
     "Daily status" issue's description with the current state: the ✅ / ⚠️ /
     🛑 headline, the report, and a short footer — the schedule, that the
     description is replaced every run, that one unchanged for more than a day
     means the workflow did not run, and links to the run. No comments.
  2. **Earlier: `7 1 * * *`** — 01:07 UTC, 03:07 in Oslo in summer and 02:07
     in winter ("make it 3AM", read as Oslo time; GitHub's cron has no time
     zone). With the delay seen so far it would land around 08:00 in Oslo —
     an estimate from two runs, not a promise. D-078's rule that no cron
     minute is 0 stays.
- **What the owner gives up, stated plainly.** An edited description sends no
  notification, so the daily push to the phone stops; the owner opens the
  pinned issue when they want the state. What still pages: a failed or empty
  report exits 1, and the workflow's last step then pings Healthchecks.io with
  `/1`; a morning with no run at all pages after the grace period. The
  description carries no @mention: on an edit it would notify nobody, and D-076
  had it only for the daily push that is gone.
- **The Healthchecks.io grace goes from 3 to 8 hours** (A-27, owner's decision
  2026-09-26). With runs starting about 4¾ hours late by amounts that vary, an
  on-time run followed by a late one can be ~29 hours apart, past 1 day + 3
  hours: a page for a run that happened, which teaches the owner to ignore the
  real one. A genuinely missed report now pages at ~32 hours. The footer's
  "unchanged for more than a day and a half" stays true for any grace up to
  12 hours.
- **Consequences:** #19 keeps the comments from before this decision. Closing it
  makes the next run open a clean dashboard issue; that is the owner's choice.
- **Update 2026-09-28:** #32 closed #19 itself; the owner did not choose to.
  - #32's description suggested "close #19", and GitHub reads those words as
    a closing keyword.
  - The next run (2026-09-27) opened, pinned and assigned #35, as designed.
    #35 is the dashboard now.
  - The first two scheduled runs started at 06:29 and 06:38 UTC, 5 h 22 min
    and 5 h 31 min late. So the report lands around 08:30 in Oslo, not the
    08:00 estimated above.

## D-081 — App skeleton v1: Expo SDK 57 and the toolchain built around it
- **Date:** 2026-09-26 · **Status:** Accepted (delegated, D-031) · **Section:** 4/5/6/8 (M0, INF-06)
- **Context:** INF-06's spec (`docs/specs/INF-06.md`, "Versions") delegated the
  exact Expo SDK, its dependent versions and the L7 toolchain to Claude, asking
  for the newest stable SDK the workspace can install, and for each other
  version to be recorded with its reason and, where relevant, a fallback. The
  spec's own review round (2026-09-26) added more: no Android backup (AC19),
  no vendor calls from Maestro (AC20), Java 17 to 21 and emulators only
  (AC9, amended), and the `actions/cache` choice. This is that record.
- **Decision:**
  1. **Expo SDK 57**, not a preview SDK 58: `expo ~57.0.25`,
     `react-native 0.86.3`, `react 19.2.3`, `expo-router ~57.0.23`,
     `jest-expo ~57.0.5`. Every Expo and React Native package is installed
     with `expo install`, so their versions are the SDK's own list rather than
     picked by hand. **TypeScript stays at the workspace's catalog version,
     `~6.0.3`** (D-058); Babel strips the app's types, so the compiler version
     only matters to `tsc --noEmit`, and the app adds no second TypeScript to
     the workspace. **Fallback**, unexercised: the previous stable SDK, had 57
     failed to install under Node 22 / `engine-strict=true`, lacked a matching
     `jest-expo`, or failed to build in this pnpm workspace.
  2. **Jest and its testing libraries follow jest-expo's own line, not
     Vitest's.** `jest-expo` 57 is built on Jest 29, so the app declares
     `jest ~29.7.0` and `@jest/globals 29.7.0` rather than the newer Jest the
     rest of the tooling could otherwise reach for.
     `@testing-library/react-native` is at its current major, 14, whose peer
     `test-renderer` is pinned to `~1.2.0`: that line matches
     react-reconciler 0.33 for React ^19.2, while `test-renderer` 1.3 targets
     react-reconciler 0.34 for React ^19.3, which SDK 57's React 19.2.3 is
     not. **i18next 26** and **react-i18next 17** (D-032 already chose the
     library; these are its current majors), with `expo-localization` for the
     device's ordered language list.
  3. **`pnpm.packageExtensions` in the root `package.json` marks
     `react-native-drawer-layout`'s peers, `react-native-reanimated` and
     `react-native-gesture-handler`, optional.** `expo-router` 57 hard-depends
     on `react-native-drawer-layout`. Without the override, pnpm's
     auto-install-peers filled those two peers — plus
     `react-native-worklets` — with their latest versions: Reanimated 4.7.0,
     Gesture Handler 3.3.0, Worklets 0.13.0, all outside SDK 57's supported
     versions (4.5.1, `~2.32.0`, 0.10.1 respectively). These are native
     modules the spec's "keep dependencies few" explicitly excludes (SEC-06),
     and Android autolinking would have linked all three into the release
     build whether or not the app ever imports `expo-router/drawer`. With the
     override in place, importing `expo-router/drawer` now fails loudly at
     bundle time instead of silently shipping unsupported native code.
     **Removing this override needs a new decision**, not a quiet edit,
     because it is the thing standing between "no Reanimated" as written in
     the spec and Reanimated arriving as a side effect of an unrelated
     dependency.
  4. **`apps/mobile`'s `package.json` declares `@babel/core ^7.20.0`
     itself.** Left undeclared, `babel-jest` and `babel-preset-expo` resolved
     the workspace root's Babel — version 8, brought in by
     `@stryker-mutator/instrumenter` for mutation testing (D-036) — against
     peer ranges that ask for `^7`. Jest ran anyway; it was still an
     unsupported combination that a lockfile change could break without
     warning.
  5. **The test build is `expo prebuild` plus Gradle, not EAS.** `e2e:android`
     generates the native Android project from `app.config.ts` (continuous
     native generation, no committed `android/` folder) and builds the
     release variant for `x86_64` only, on the runner or the Mac, with no EAS
     CLI, no Expo account or token, and no repository secret. It is what
     ships, has no Metro server to keep alive on a runner, and has one fewer
     moving part in a job that must not be flaky (INF-06-AC10).
  6. **Maestro 2.10.0, pinned and hash-checked.** Its SHA-256 is read from
     Maestro's own `checksums_sha256.txt` and matches the digest GitHub serves
     for the release asset, so the check is against Maestro's stated hash, not
     merely "unchanged since the day this was written". Its licence is
     Apache-2.0. `MAESTRO_CLI_NO_ANALYTICS` and
     `MAESTRO_DISABLE_UPDATE_CHECK=true` are both set wherever Maestro runs.
     The second name matters exactly as written: Maestro reads it with Java's
     `Boolean.parseBoolean`, so `'1'` parses as `false` and does nothing,
     leaving every run sending a persistent ID to `api.copilot.mobile.dev`.
     Only `'true'` (case-insensitively) turns it off.
  7. **`reactivecircus/android-emulator-runner` v2.38.0, pinned by commit SHA**
     (D-060 point 3), licensed Apache-2.0. `licenses:check` reads the npm
     dependency tree and cannot see a GitHub Action, so this decision is where
     that licence is recorded, the same way D-077 recorded Terraform's.
  8. **The Android SDK and the system image
     `system-images;android-37.2;google_apis_ps16k;x86_64` are accepted under
     Google's Android SDK licence, in CI.** This is unavoidable for building
     or testing anything Android at all, and it is written down because
     `setup-gradle`'s own comment (see the next item) treats a proprietary
     licence as disallowed in this repository — Google's SDK licence is a
     different thing from that, and the distinction is worth being explicit
     about rather than leaving a reader to wonder why one non-permissive
     licence is accepted and another is not.
  9. **`actions/cache` (MIT) is used instead of `gradle/actions/setup-gradle`
     for the Gradle cache.** The current `setup-gradle` bundles a caching
     component, `gradle-actions-caching`, under a licence restricted to
     internal use with no redistribution — the same category of licence this
     repository already rejected for `gitleaks-action` (D-061 point 7). The
     cache is restored on every `android-e2e` run that builds the app, and saved
     from `main` only,
     so a pull-request branch cannot fill or poison it.
  10. **Java 17 to 21, and emulators only, for `e2e:android`.** Java 25 —
      which is what Android Studio's JBR ships on the Mac, and therefore the
      Mac's default `JAVA_HOME` — passes a "Java 17 or newer" check and then
      fails the native build's `configureCMake…[x86_64]` tasks after about 18
      minutes, with `WARNING: A restricted method in java.lang.System has been
      called` (JDK 24+'s native-access restriction). CI's `setup-java` step
      pins 17 and is unaffected. On the Mac, a Temurin 17 unpacked into
      `claude-dev`'s own home (`~/jdks/`, no admin rights needed, D-056) is the
      way round it; **the owner should point `JAVA_HOME` at a JDK 17 on the
      Mac** so this does not have to be rediscovered per session.
  11. **The release app's manifest and config carry these settings, each with
      its own reason:**
      - **`allowBackup: false`.** Android's Auto Backup would otherwise copy
        whatever the app later stores — session tokens, journey data — to
        Google Drive, a destination outside the providers chosen for the EEA
        (D-016), and a restore could move a device-bound login to a different
        phone.
      - **Blocked permissions:** `SYSTEM_ALERT_WINDOW`,
        `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `VIBRATE`. Expo's
        template asks for these by default; the skeleton needs network access
        and nothing else, and drawing over other apps or reading shared
        storage is not something a safety app should hold without a reason
        (SEC-06).
      - **No generated deep-link scheme** (`expo-dev-client`'s
        `addGeneratedScheme: false`). Left at its default, the dev client
        registers an `exp+trygghverdag://` link in the *main* manifest, so
        even release builds could be opened from any web page. No scheme
        exists until a feature needs one.
      - **No `expo-updates`** (D-023): a build whose JavaScript a server can
        replace after testing is a build nobody tested.
      - **The application ID, `no.trygghverdag.placeholder`, stays a
        placeholder** until the first store upload, when the owner fixes it
        together with the public name (D-057). It costs nothing to change
        before then.
  12. **What the first CI run proved** (PR #34, run 36267216821, 2026-09-26):
      - **KVM: not settled.** GitHub documents hardware acceleration on its
        2-vCPU Linux runners (changelog, 2024-04-02). On the first run the
        KVM step passed. On the second (run 36298902708), on the same
        `ubuntu-24.04` image, it failed: `/dev/kvm is not usable on this
        runner`, 38 ms after `udevadm trigger`. That command only queues the
        permission change, so the check may have raced it. The step now
        waits with `--settle` and prints `/dev/kvm`'s state when it fails.
        The owner's re-runs will show which it was. An earlier version of
        this item said the runners "expose it" on the strength of one run;
        that was more than one run could show.
      - **Cold build:** the x86_64 release build took 14 min 48 s with no
        Gradle cache (the cache is saved from `main` only).
      - **One API level, `37.2`.** The job failed before any emulator
        started: `Failed to find package 'platforms;android-37'`. The action
        installs `platforms;android-<api-level>`, and since minor Android
        versions there is no bare `android-37`; Google's index has 37.0,
        37.1 and 37.2. `api-level` is now the single `EMULATOR_API_LEVEL:
        '37.2'`, in `major.minor` form, used for the platform and the system
        image alike. The runner's sdkmanager warns that it reads SDK XML only
        up to version 3. That is harmless here: the version-3 index lists
        these packages.
      - **Run 3** (36300860646, after `--settle`): the platform install
        worked, the KVM step passed, and the build took 10 min 14 s. The
        emulator action then failed unpacking the 16 KB-page system image:
        `No space left on device`. The job now frees space before the
        emulator: it removes unused preinstalled toolchains and the app's
        Gradle intermediates, keeps the APK and `~/.gradle`, and prints
        `df -h` so the next log shows the numbers.
      - **Run 4** (36303366850): the KVM step passed again, and `df -h /`
        showed 22 GB free before the emulator, so disk is fixed. The action
        then failed: `No device found matching --device pixel_8`. The runner
        image ships Android command-line tools 12.0, which has no Pixel 8
        profile. The action installs its own 20.0 only when no version is
        present. Both versions' `avdmanager list device` were run on the Mac:
        12.0 stops at pixel_7_pro, and 20.0 has pixel_8. The job now installs
        tools 20.0 as `cmdline-tools/latest` before the emulator, from
        `commandlinetools-linux-14742923_latest.zip`. That archive's size and
        SHA-1 match Google's `repository2-3.xml` (172789259 bytes,
        `48833c34…1b27`), and its SHA-256
        `04453066b540409d975c676d781da1477479dde3761310f1a7eb92a1dfb15af7`
        is checked before unpacking. It is covered by the Android SDK licence
        above. (Tools 20.0 print the "SDK XML versions up to 3" warning too,
        so a claim here that 20.0 ends it was wrong, and has been removed. It
        is harmless, because the version-3 index lists every package the job
        needs.)
      - **Run 5** (36306264081):
        - tools 20.0 installed (`Pkg.Revision=20.0`), and the Pixel 8 device
          was created;
        - KVM passed with `--settle` for the third time in a row;
        - the emulator booted in 63.8 s, and `e2e:android` got as far as its
          locale preflight, which stopped it: `The device's language is
          "en-US"`.
        The emulator applies `-change-locale` asynchronously, after
        `sys.boot_completed`. A fresh CI-identical device on the Mac showed
        `persist.sys.locale` empty and `am get-config` `en-rUS` straight after
        boot, then `nb-NO` and `nb-rNO` about 20 s later. The Mac's own
        Pixel_8 only looked right because the setting had persisted from an
        earlier boot. `e2e:android` now waits, with a deadline, for the
        device to report bokmål before the check fails.
      - **Run 6** (36309631129). The cold build took 15 min 26 s and the
        boot 91 s. The locale check passed (`The device's language is
        nb-NO`), and 0.16 s later `adb install` failed: `cmd: Can't find
        service: package`. Recorded twice on the Mac, on a fresh
        CI-identical device: `persist.sys.locale` turns `nb-NO` about 1–2 s
        before Android restarts its framework to apply it. For about 4 s
        `system_server` is gone and the package service is missing, while
        `sys.boot_completed` stays 1. `am get-config` reports `nb-rNO` only
        once the new framework is up. So the wait now ends only when
        `am get-config` reports bokmål and `service check package` finds the
        service.
      - **Run 7, the first green run** (36323061166, 2026-09-27): `e2e:android:
        1 of 1 flow passed.` It printed `The device's language is nb-rNO, and
        its package service is up`, then `[Passed] app-starts (24s)`. The
        cold job took 20 min 27 s:
        - the release build, 14 min 35 s;
        - the boot, 89.6 s;
        - the Maestro download, 16 s;
        - the install, 22 s;
        - the flow, 24 s.
        KVM passed with `--settle` on all five runs since the change.
      - **Run 8** (36324362689, the same code as run 7) failed. Its locale
        check passed, and then `adb install` threw `NullPointerException:
        … PackageManagerInternal.freeStorage …`. So run 7's green was partly
        timing. Tested on the Mac, on fresh CI-identical devices:
        - on the first boot in bokmål, installs fail for a while after the
          device reports ready (17 s after it failed, 80 s after it worked);
        - a reboot after the switch did not help;
        - later boots installed straight away, 6 of 6;
        - with no language switch, the install after the first boot worked;
        - `-prop persist.sys.locale` is refused ("only 'qemu.*' properties
          are supported").
        So `adb install` now waits, for up to 120 s, while it fails with one
        of the two not-ready errors seen: `Can't find service: package`, or a
        `NullPointerException` in `PackageManagerInternal`. Any other install
        error fails at once. This is a readiness wait on the install, and D-060
        still holds: a failed flow is never retried.
        **Amended 2026-09-29 (BUG-9):** a third not-ready error, a
        `SecurityException: Caller has no access to session <n>` line. The
        first `ubuntu-26.04` run (run 36569778633, D-085) hit it 17 s after the
        framework restart. AOSP's `PackageInstallerService` throws it when the
        session is missing from its table or not the caller's, and here the
        shell had just created that session itself. A broken APK fails with
        `INSTALL_FAILED_*` instead. The match is the whole line, so a refusal
        of a *package*, or the same words in another exception or in a
        `Failure […]` line, still fails at once.
      - **Run 9** (36409755274, the install wait): green; the install
        succeeded on attempt 1.
      - **BUG-6** (#37) gave the emulator 4 cores. It is a public repository
        since 2026-09-28, so `ubuntu-latest` has 4 CPUs and 16 GB. This
        followed a `main` run that failed on a "System UI isn't responding"
        dialog on 2 cores. The snapshot key gained `-4cores`.
      - **Warm durations**, with the Gradle cache and the 4-core snapshot both
        restored, on `main`:
        - 10 min 17 s (run for `8c62af9`): build 6 min, boot 33 s, flow 15 s;
        - 9 min 25 s (run for `627a4b5`): boot 31 s, flow 11 s.
        A cold run on 4 cores took 12 min 14 s (#37). This is at the low end
        of the spec's 10–16 min warm estimate, and on a public repository
        the minutes are free.
  13. **Follow-up, a precondition for the first safety-core code: mutation
      testing of app code.** Stryker runs Vitest only. It mutates folder
      safety paths as `**/*.ts` only (`stryker.config.mjs`), so a `.tsx` file
      there is never mutated. Safety-core also shares the pooled
      `whole-suite` run (`gate-decisions.mjs`), whose `break: 80` applies to
      the combined score. So a safety-core change could leave `mutation`
      green without testing it. The folder is empty today, so nothing is
      exposed. The task that first adds safety-core code must first make
      Stryker run jest on it, as its own run with a `{ts,tsx}` glob, so its
      score stands alone (spec risk R16).
- **Consequences:** Items 1–4 and 6–11 are recorded so that a later session
  does not "clean up" what looks like an odd version pin or an unused-looking
  environment variable without first reading why it is there — several of
  them (item 3 especially) fail silently or expensively if quietly removed.
  Item 12 is a standing to-do on this same decision, not a separate task.

## D-082 — Gate drills: offline now, live later; three gates tightened first
- **Date:** 2026-09-28 · **Status:** Accepted (owner, 2026-09-28 and
  2026-09-29: seven questions asked in session, each with Claude's
  recommendation, and each answered with it) · **Section:** 6/8 (M0, INF-10)
- **Context:** INF-10 is M0's last task: the roadmap's nine gate drills. Each
  is a scripted attempt that must be blocked, and a drill that gets through
  means M0 is not done. Writing the spec (`docs/specs/INF-10.md`) showed that
  three of the drills that can run offline would get through today. In each
  case the gap is in the gate, not the drill:
  - **RG-01.** `req:coverage` counts a requirement as covered once any test
    names it. So a new acceptance criterion with no test passes whenever its
    requirement already has one.
  - **CI-06.** Nothing installs oasdiff. Once a version is released, `api:diff`
    can only refuse to run ("compatibility was NOT checked"), and nobody has
    seen it detect a break.
  - **RG-03.** The skip check in `scripts/lib/test-strength.mjs` is shared by
    HK-05 and `tests:changes`. It misses `describe.skipIf(true)`,
    `describe.runIf(false)`, a skip behind another modifier such as
    `describe.concurrent.skip`, and a test that calls its context's `skip()`
    from its body. Each switches tests off with every count unchanged. Checked
    by running the pattern on those lines.
- **Decision:**
  1. **Offline now, live later.** Seven drills become tests that run in CI:
     RG-03, CI-03, RG-01, CI-06, HK-02, HK-07 and CI-11.
     - The two that only GitHub can enforce are a push to `main` (D-029) and a
       merge without code-owner approval. They stay covered by `gate:integrity`
       reading the live rules. The drill report shows them as not run here,
       never as passed.
     - One live attempt at those two follows later, as its own task, with the
       owner watching. D-071's question, whether code-owner review is
       enforced, stays open until then. That attempt must allow for
       `urso-agent`'s automatic approval (D-072).
  2. **RG-01 checks acceptance criteria.** This amends RG-01, which D-040 makes
     binding.
     - With `--fail-on-uncovered-changed`, `req:coverage` also fails when a
       changed spec names `<ID>-ACn` for a tracked requirement and no test
       names that exact criterion.
     - Untracked IDs (INF, CI, HK, AR and the like) stay out (D-074), and
       parked requirements never block, as today.
     - The way out, for a criterion that truly cannot be automated, is a spec
       line `req-coverage: not automated <ID>-ACn: <reason>`. The gate prints
       every such line on every run and refuses an empty reason.
  3. **oasdiff is installed now.**
     - Version 1.32.1, Apache-2.0.
     - It runs in CI's `unit` job for the drill and in the `contract` job for
       the gate.
     - It is installed like gitleaks: downloaded from the release and checked
       against the SHA-256 the release publishes in `checksums.txt`:
       `7c8939fc49b75ee11fec66a5b83b37a2fca6aee109fed85013b1ba2ac2a1ee7f` for
       `oasdiff_1.32.1_linux_amd64.tar.gz`.
     - The version and hash are written once. Dependabot cannot see the pin, so
       it is raised by hand.
  4. **RG-03's skip check is widened.** It now counts:
     - `skipIf` and `runIf`;
     - a skip, focus or todo behind another modifier;
     - any call to `skip(` in a test file, whatever the test context is
       named: `ctx.skip()`, `t.skip()`, or a `skip()` taken from the context.

     Names such as `skipIfMissing` do not count. Other ways to hollow out a
     test, such as an early return, stay with `test-auditor`: no text pattern
     catches them all.
  5. **RG-03 widened further** (2026-09-29), after `code-reviewer` found more
     forms. Nothing in the repository uses them today.
     - The same forms count on `suite`, and on any test object, such as one
       made with `test.extend`, including bracket access.
     - `.fails` and `.failing` count too, on their own and with their own
       message. They turn a failing test into a passing one, and the run
       reports it as passed.
  6. **The files that decide which tests CI runs need the owner**
     (2026-09-29). `vitest.config.mjs`, `vitest.shared.mjs` and
     `vitest.coverage.config.mjs` join CODEOWNERS and `OWNER_APPROVAL_PATHS`.
     Otherwise, a change that stopped the drills from running would be caught
     only by the AI reviewers. `code-reviewer` and `privacy-security-reviewer`
     each found this; INF-06 had raised it earlier.
- **Checked before deciding (2026-09-28, in session):**
  - The release archive passed `sha256sum -c` against the published
    `checksums.txt`, and printed `oasdiff version 1.32.1`.
  - Run the way `api:diff` runs it (`breaking <released> <current> --fail-on
    ERR`) on `packages/contracts/openapi.json`, which is OpenAPI 3.1.1:
    - unchanged: `No changes detected`, exit 0;
    - with `GET /health` removed: `error
      [api-path-removed-without-deprecation] … in API GET /health`, exit 1.
  - The licence is the Apache-2.0 `LICENSE` of the module source at v1.32.1.
  - The same method reproduces the gitleaks hash already pinned in `ci.yml`.
- **Consequences:**
  - A conditional test is refused like a skip, so one that is needed must say
    why, as any RG-03 change does. No test in the repository uses these forms
    today, so nothing existing breaks.
  - Every tracked criterion that a changed spec names needs a test that names
    it, or a visible not-automated line. That matters from M2 on, where one
    alert story carries several criteria.
  - Every CI run of `unit` and `contract` downloads oasdiff. INF-10 measures
    the cost.
  - How the drills are built is Claude's choice (D-031): one Vitest file, a
    `gate:drills` report, CI's existing `unit` job, and no new required check.
    It is recorded in the spec's Approach and summarised here when INF-10 is
    done.

## D-083 — M0 closes; the live gate drills move to the go-live checklist
- **Date:** 2026-09-29 · **Status:** Accepted (owner, 2026-09-29). Asked in
  session with Claude's recommendation, which was to plan the live attempt now;
  the owner chose "close M0, and do it before go-live" · **Section:** 10 (M0)
- **Context:** M0's exit criteria in `10-roadmap.md` are "all INF tasks done;
  gate drills pass; CI green on `main`".
  - **All INF tasks:** INF-00 to INF-10 are done. INF-10 merged on 2026-09-29
    as #42.
  - **CI green on `main`:** `ci` and `deploy-staging` passed on #42's merge
    commit (`c24d725`) and on #41's after it (`cb9109d`).
  - **Gate drills:** seven pass offline on every pull request that can change a
    gate (D-082). The two that only GitHub can enforce, a push to `main` and a
    merge without code-owner approval, are covered by `gate:integrity` reading
    the live rules (5 of 5 in CI), not by an attempt.
- **Decision:** M0 is closed. Its criterion "gate drills pass" counts drills 6
  and 8 as covered by `gate:integrity`'s live read, until their live attempt.
  That attempt becomes an M5 go-live gate item. It runs once, from the Mac as
  `urso-agent`, never from a session acting as the owner, with the owner
  watching.
- **What stays open:**
  - D-071's question, whether GitHub enforces code-owner review, is not
    answered until then.
  - `gate:integrity` checks what the rules say, not that GitHub enforces them,
    and #6 once merged with no standing approval (D-072).
- **Consequences:**
  - `10-roadmap.md`'s M0 exit carries this exception, and its "owner actions by
    milestone" table gains the M5 item.
  - The next milestone is M1, the spike.

## D-084 — The remaining gate files need the owner (BUG-8)
- **Date:** 2026-09-29 · **Status:** Accepted (owner, 2026-09-29). Asked in
  session with Claude's recommendation, and answered with it · **Section:** 6/8
- **Context:** INF-10 made the three root Vitest configurations owner-approved
  (D-082 item 6). `code-reviewer` and `privacy-security-reviewer`, and before
  them INF-06's follow-up 2, found more files that shape a gate and need no
  owner:
  - `eslint.config.mjs` and `.dependency-cruiser.cjs`;
  - `stryker.config.mjs` and `coverage-baseline.json`;
  - `packages/config/` and `apps/mobile/app.config.ts`.

  A change to one could loosen a lint rule, an import rule, the mutation setup
  or the coverage baseline, with only the AI reviewers to notice.
- **Decision:** they join CODEOWNERS and `OWNER_APPROVAL_PATHS`, held by
  `gate:integrity` and a test, as the Vitest files are. It is its own small
  task, BUG-8, after the M0 records. The owner took the ID suggested with the
  option.
- **Consequences:**
  - More pull requests wait for an owner's approval. `urso-agent` approves
    automatically (D-072), so this adds a named owner, not human judgement.
  - A related gap stays separate: `reviewCodeowners` ignores GitHub's
    last-match rule for CODEOWNERS (`test-author`, during INF-10). It bears on
    how far `gate:integrity`'s ownership check can be trusted, and is a
    `/bugfix` candidate.
- **Update 2026-09-29:** done in two pull requests.
  - **#45 put `apps/mobile/app.config.ts` into ai-review's safety filter
    first.** A test requires every owner-approval path under `apps/` to call
    safety-reviewer. The owner chose this and merged #45 by hand (D-075).
  - **#46 adds the six paths** to CODEOWNERS and `OWNER_APPROVAL_PATHS`,
    test-first. Its test also checks GitHub's last-match rule, for these
    files and for each file in `packages/config`. So for them, a test now
    covers the last-match gap above. Everywhere else it stays a `/bugfix`
    candidate.

## D-085 — CI names its Ubuntu release, `ubuntu-26.04`, not `ubuntu-latest`
- **Date:** 2026-09-29 · **Status:** Accepted (owner asked; the label is
  Claude's choice, D-031) · **Section:** 8
- **Context:** GitHub announced that `ubuntu-latest` moves from Ubuntu 24.04 to
  26.04 "over a period of several weeks beginning October 19, 2026", to be
  complete "by November 19, 2026" (actions/runner-images#14748). The owner
  asked to move first, so that we see the new image working before GitHub
  moves us.
- **Decision:**
  1. **Every job in `ci.yml`, `deploy-staging.yml`, `infra-staging.yml` and
     `daily-status.yml` runs on `ubuntu-26.04`.** That is 15 jobs.
  2. **`ai-review.yml` stays on `ubuntu-latest` for now.** A change to it is
     merged by hand (D-075). Putting it in this pull request would take the
     reviewers off the other four files too. #45, a D-075 change that merged
     while this pull request was open, did not carry it. So it moves in a
     one-line pull request of its own, merged by hand, after this one
     merges. Until then it follows GitHub's rollout.
  3. **The next release is a pull request of its own**, made by hand, like
     the oasdiff and gitleaks pins: Dependabot does not raise runner labels.
- **Why a named release, not `ubuntu-latest`:**
  - **GitHub's rollout is gradual.** For about a month some runs would get
    24.04 and some 26.04. A red that comes and goes with the release reads
    as a flaky test, and this repository treats "flake" as never a root
    cause.
  - **A new release is then a change we make**, on a branch, with its CI to
    show what broke.
  - **The label is not a pinned image.** It names the Ubuntu release, and
    GitHub still updates the image under it. Each job's "Set up job" step
    prints the Image Version (the first 26.04 run had 20260920.143.1), which
    is where to look when a red comes and goes.
  - **The pull request tests itself.** `ci.yml` is in `touchesApp` and is
    not inert (`scripts/lib/affected.mjs`), so every `ci.yml` job does its
    full work on the new image, `android-e2e` included.
- **Checked before deciding (2026-09-29, in session):**
  - runner-images' `README.md` lists `ubuntu-26.04` as GA, and
    `ubuntu-latest` as still 24.04.
  - `Ubuntu2604-Readme.md` (image 20260920.143.1) against
    `Ubuntu2404-Readme.md`, for what the jobs rely on:
    - **Android:** the same `ANDROID_HOME` (`/usr/local/lib/android/sdk`), the
      same default NDK (27.3.13750724) and the same platforms, `android-37.2`
      among them. The command-line tools are 20.0 where 24.04 has 12.0.
      `android-e2e` still puts its own pinned, hash-checked 20.0 in
      `cmdline-tools/latest`, so the image's version does not matter.
    - **Java:** the default is 25, where 24.04's is 17. `android-e2e` sets 17
      itself with `actions/setup-java`.
    - **Node:** the default is 24.21.0. Every job sets its own from `.nvmrc`.
    - **Docker:** 29.4.2, where 24.04 has 28.0.4. `test:integration` reaches
      it through testcontainers 12.1.0.
    - **Swift is gone.** `android-e2e`'s clean-up step deletes it with
      `rm -rf`, which does not fail on a missing path. .NET, Haskell and
      CodeQL, which it also deletes, are still there.
    - **Kernel:** 7.0, where 24.04 has 6.17.
- **The CI result on 26.04** (read from the job logs):
  - **Run 36569778633**, the first: 9 of 10 `ci` jobs green. `android-e2e`'s
    install was refused with `SecurityException: Caller has no access to
    session`, a not-ready error nothing knew yet (BUG-9).
  - **Run 36579467633**, with BUG-9 (`11efded`): all 10 `ci` jobs green,
    and `ai-review`'s 6 too. `android-e2e`'s install succeeded on attempt 1,
    and `[Passed] app-starts (14s)`. So 26.04 can pass the whole gate.
  - **Run 36581002792** (`5d614c1`): green. Attempt 1 of the install was
    refused with run 8's `NullPointerException … PackageManagerInternal.
    freeStorage`. The existing wait tried again 5 s later, and attempt 2
    succeeded.
  - **The run for `f22d5ee`** (after #46): all 10 `ci` jobs green; the
    install succeeded on attempt 1.
  - **So, four runs on 26.04:** the install was refused on attempt 1 in two,
    each time straight after the device reported bokmål with its package
    service up. Once with BUG-9's session error, and once with a signature
    already known.
    That fits D-081's window, and the wait is doing real work on this image.
    BUG-9's own signature has not come back yet, so its wait is proven by
    its tests, not yet by a run.
- **Not verified yet:**
  - **Three workflows cannot run from a pull request.** `deploy-staging` runs
    on a push to `main`, so this pull request's merge is its first run on
    26.04. `daily-status` runs the morning after. `infra-staging` runs when
    the owner next starts a `plan`.
- **Consequences:**
  - The way back, if 26.04 breaks something that cannot be fixed at once, is
    `ubuntu-24.04` in the same lines. That label keeps working after the
    rollout. It is not `ubuntu-latest`, which by then is 26.04 anyway.
  - The Gradle and emulator caches are keyed without the image, so what
    24.04 saved is restored on 26.04. Nothing in Gradle's cache is built
    against the image: it holds Java libraries and the Android build's own
    tools, such as `aapt2`, fetched for Linux. The first 26.04 build
    succeeded with the restored cache.
  - **Neither of the two runs compared loaded the emulator's snapshot.** The
    first run on 26.04 (job 109410598303) and the newest green one on `main`
    on 24.04 (job 109379152187) both restored the AVD cache under the same
    key. Then both logged `Feature QuickbootFileBacked is disabled due to
    stability issues` and `Emulator is performing a full startup`, and
    neither has a line about loading a snapshot. Both then restarted the
    framework for bokmål (`Changing locale to nb-NO`, `Restarting
    framework.`), the window in which D-081 saw installs refused. The
    restored AVD still carries its data image, so what the AVD cache saves
    is not measured. Neither log says why the snapshot is not loaded. The
    comment on "Create the virtual device and its snapshot" in `ci.yml`
    ("a clean snapshot for later runs to start from") is therefore not borne
    out, and is left for a follow-up.
  - The fake runner in `scripts/gate.test.mjs` is written from 24.04's
    layout. Its Android paths are the same on 26.04, by the readme. Its home,
    tool-cache and `PATH` folders are not in either readme, so they were not
    checked; `android-e2e` passing on 26.04 is what shows they still hold.
- **Update 2026-09-30:** #43 merged on 2026-09-29 at 19:42:58 UTC as
  `0637482`. One of the three "not verified yet" items is now verified, and
  the CI record has a fifth `android-e2e` run.
  - **`deploy-staging` on 26.04: verified.** The post-merge run (36621209842,
    for `0637482`) completed with success on `ubuntu-26.04`. Its Deploy step,
    which runs the pinned clever-tools binary, and its smoke test both
    passed. `ci` on `main` for the same commit (run 36621209674) passed all
    10 jobs on 26.04 as well.
  - **Still not verified:** `daily-status` (the morning after; at 05:47 UTC
    on 2026-09-30 its 26.04 run had not started, and earlier runs started at
    06:29 to 06:46) and `infra-staging` (the owner's next `plan`).
  - **The fifth 26.04 `android-e2e` run** (`9f1d1ad`, run 36594992491, job
    109497479165) was green, and its install was refused on attempt 1 with
    run 8's `NullPointerException … PackageManagerInternal.freeStorage`. The
    wait tried again, and attempt 2 succeeded.
  - **The sixth**, on `main` for `0637482` (job 109586777108), was green;
    its install succeeded on attempt 1.
  - **So, six runs on 26.04:** the install was refused on attempt 1 in 3 of
    6. BUG-9's session error was one of them, and run 8's NPE the other two.
    The wait got past the NPE both times. BUG-9's own signature has not come
    back, so its wait is still proven by its tests and not by a run.
  - **`ai-review.yml` still names `ubuntu-latest`.** It moves in its own
    hand-merged pull request (D-075), which has not been opened yet.
- **Update 2026-09-30, later:**
  - **`daily-status` on 26.04: verified.** Its scheduled run for `0637482`
    (06:34 UTC) succeeded, both jobs, `report` and `post`, on
    `ubuntu-26.04`. Only `infra-staging` is left, on the owner's next
    `plan`.
  - **`ai-review.yml` moves to `ubuntu-26.04`** in a D-075 batch, merged by
    hand, together with the three Dependabot bumps that also edit it (the
    owner's choice): `actions/setup-node` 7.0.0, `actions/checkout` 7.0.1 and
    `anthropics/claude-code-action` 1.0.235, in all five workflows. Each
    commit was checked against its release tag with `git ls-remote` before
    it went in. #4, #5 and #36 close when the batch merges.

## D-086 — SPIKE-01: conditional GO for the location SDK; Section 4 closes
- **Date:** 2026-10-01 · **Status:** Accepted (owner, 2026-10-01; the rule's
  recommendation and the spike's tool choices are Claude's, D-031) ·
  **Section:** 4
- **Context:** SPIKE-01 ran S1–S8 on the Android emulator and the iOS
  simulator (D-037). Full results: [`04b-spike-results.md`](04b-spike-results.md).
  The go/no-go rule's recommendation was **NO-GO**: S1 iOS failed and stayed
  deciding (a static simulated position never leaves the SDK's "moving"
  state, so no documented setting fixes it on a simulator), and the Android
  capture showed an unattributed Firebase Installations TLS session. S1
  Android and S7 Android also show "failed" in the rule's own table, but the
  rule does not count either against the SDK: S1 Android passed with the
  battery-optimisation exemption (a condition, not a fix), and S7 Android's
  failure is excused by the rule's own exception for a platform that ends
  the process.
- **Decision:** The SDK is accepted, as a **conditional GO**, over the
  rule's NO-GO, with four conditions:
  1. **Android:** the app's setup asks the user for the battery-optimisation
     exemption, and the app checks and reports whether it was granted,
     failing loudly when it is missing. S1 passed only with the exemption
     granted (109 s against the 120 s limit, an 11 s margin, on emulator
     evidence).
  2. **iOS:** journeys run with `activity.disableStopDetection: true` (the
     SDK's own documentation: "With it off, location services run
     continuously"). This setting was not tried in the spike. M3 configures
     it, and verifies it on a real phone.
  3. **L9:** a stop of 5 minutes or more on a real iPhone, unplugged with
     the screen off, must pass before the group relies on the app (D-041).
     **If it fails, this decision is reopened**, and D-023's fallback
     (native modules for the background part) is decided on.
  4. **The Firebase Installations session** found in the night's S1 capture
     is counted as Google Play Services' own traffic, not the SDK's: the
     app's process cannot start Firebase itself (no `google-services.json`,
     no Google Services Gradle plugin, no `google_app_id`), other processes
     on the same device image run Firebase, and the exempt runs' own
     captures were clean. AC12's "nothing goes to the SDK's vendor" held in
     every capture.

  **The SDK, pinned:** `react-native-background-geolocation` **5.7.0**, with
  its engines pinned exactly: Android `com.transistorsoft:tslocationmanager`
  **4.6.1**, iOS `TSLocationManager` **4.7.1**.

  **Its licence, read 2026-09-30** (full dated copies, with checksums, kept
  outside the repository, `~/spike-runs/licence/`). The npm wrapper is MIT;
  the two native engines are commercial (`TSLocationManager`'s podspec and
  `tslocationmanager`'s Maven POM both say "Commercial"). Quoted:
  - **3.5:** "The Software is fully functional in DEBUG builds without a
    License Key; the license-validation warning shown in DEBUG builds does
    not restrict functionality. DEBUG builds may be used for development
    and testing only and may not be distributed to End Users."
  - **3.6:** "Licensor may issue Trial Keys valid for thirty days from issue.
    A Trial Key may be used only to evaluate the Software in RELEASE builds
    and not for production use or distribution to End Users. Trial Keys
    expire automatically and may not be renewed except at Licensor's
    discretion." This is the clause the 30-day trial key below relies on.
    Quoted from the copy read at 19:21 on 2026-09-30, unchanged by the
    vendor's edit to 9.5.
  - **7.1:** "It transmits location and related data only to the server
    endpoints that Licensee configures in its Application. Licensor
    operates no server that receives that data."
  - **7.2:** the licence check itself "involves no network request to
    Licensor and transmits no data."
  - **9.5, as rewritten by the vendor on 2026-09-30** ("Safety-related
    applications"): "Licensee may use the Software in Applications intended
    to help keep people safe, such as personal-safety, lone-worker, family
    location-sharing and check-in Applications." The Software "is not
    designed, tested or certified as a safety-critical system", and the
    Licensee is solely responsible "for designing the Application to allow
    for delayed, missing or inaccurate location data, and for anything the
    Application tells End Users about its reliability or about how to
    obtain emergency assistance."

  **Price:** Starter, **$399**, for one app on both platforms.

  **Licence timing:** the $399 licence is bought in **M5**, after L9 passes
  (A-13 stays in M5; the roadmap is unchanged). M3's demo (showing the app
  through internal TestFlight and Google Play internal testing) uses a
  **30-day trial key, on the owner's own phones only**; no group member gets
  a testing build with the SDK before M5. The app must say loudly if the
  SDK's licence check ever stops tracking. At purchase, a dated copy of the
  licence text is kept with the order (fees are non-refundable, clause 5.4).
  **Owner to-do A-29:** request a 30-day trial key shortly before M3's demo
  (transistorsoft.com/shop/trials/new), owner's own phones only. Due: M3.

  **MapLibre:** `@maplibre/maplibre-react-native` **11.4.0** (MIT); native
  **13.6.1** on Android and **6.31.0** on iOS (both BSD-2-Clause). S8 passed
  on both devices, with the Android build working on the 16 KB-page image.

  **Kartverket:** tiles are CC BY 4.0, credited "©Kartverket". The Geovekst
  clause on zoom levels 12–20 (special permission needed for anything beyond
  direct display) goes to D-026's tile proxy, not to this decision.

  **The spike's tool choices (D-031):** the throwaway loopback receiver, not
  staging and not `apps/server` run locally; `node:test` for the analysis;
  Maestro 2.10.0; EAS simulator builds for iOS (the spec's Q2), with eas-cli
  24.8.0, `DISABLE_EAS_ANALYTICS` and `EXPO_NO_TELEMETRY` set; Expo pinned to
  57.0.25.

  **Section 4's five proposed defaults are accepted as written:** SMS via
  LINK Mobility; push straight to APNs and FCM; SMS-code login with
  device-bound sessions and an admin passkey; self-hosted EEA crash
  reporting; no over-the-air updates. **Note:** FCM push brings Firebase
  into the Android app itself (a Google Services configuration, and
  Firebase Installations). That is push plumbing, not analytics, but it is
  still a data flow to Google, for the privacy assessment (PRIV-06, D-016).
  SPIKE-01's own network-capture classifier, which flags Firebase hosts as
  analytics, describes the spike's own evidence only, not the product's FCM
  integration.
- **Consequences:**
  - **M3 must:**
    - post the alert with `CATEGORY_ALARM` set (S5's "heard" failed on
      Android; the likely cause, not independently verified);
    - decide what the app does when Android's precise location is reduced
      and the process never comes back (S7's "fine" case): the server's
      5-minute silence becomes the only signal;
    - set, record and test the SDK's on-device retention
      (`persistence.maxDaysToPersist`, `persistence.maxRecordsToPersist`,
      `persistence.persistMode`, `logger.logMaxDays`), and empty its queue
      when a journey ends;
    - review the merged manifest of the **release** build (the debug
      manifest showed background location and `ACTIVITY_RECOGNITION` from
      the SDK's own engine, FCM receive and badge permissions from
      `expo-notifications`, and the Install Referrer permission from
      `expo-application`; `SYSTEM_ALERT_WINDOW` was a debug-only artefact);
    - handle the native engines' and MapLibre's native libraries' licences
      explicitly, since `licenses:check` cannot see them;
    - consider a timer-driven upload: the SDK's own documentation describes
      iOS throttling background heartbeats to about 2 minutes after
      entering the background, unplugged with the screen off — documented,
      not observed on a real phone in this spike.
  - **L9 must show:** the iPhone stop above, and the Android exemption
    tested on a real Samsung, not only the emulator.
  - **The harness's known limits** (`04b-spike-results.md`, part 8) must be
    fixed before any future spike night runs.
  - **The raw capture files** (`~/spike-runs/`) are deleted once this
    decision merges.
  - **Section 4 closes.** `04-tech-stack.md`'s status moves to ✅; its stale
    "real phones" lines (superseded by D-037) and "tested on real walks"
    (against D-035) are corrected; the Summary is filled in; and
    `plan/README.md` shows Section 4 as ✅.

## D-087 — STORE-01: Critical Alerts request drafted; the alert-level rule's scope and the no-responder warning's level settled
- **Date:** 2026-10-01 · **Status:** Accepted (owner, 2026-10-01) ·
  **Section:** 4/M1
- **Context:** STORE-01 drafted the text of the Critical Alerts entitlement
  request and the owner's steps to send it
  ([`critical-alerts-request.md`](critical-alerts-request.md); spec:
  [`../specs/STORE-01.md`](../specs/STORE-01.md)). Writing it forced four
  questions the plan had left open: which notifications the alert-level rule's
  "SOS-related" half covers, which apps the request names, when the bundle
  identifiers are fixed, and whether the last-responder rule's warning should
  join the lost-contact alert at the critical level. The owner answered Q1 to
  Q3 on 2026-10-01, and Q4 the same day, after step 5's safety review.
- **Decision:**
  1. **Only the lost-contact alert uses Critical Alerts (Q1).** The MVP has no
     SOS story — discreet triggers are parked, and CALL-02's 112 story calls
     112 through the phone's own calling path without alerting the group — so
     REL-06's "Lost-contact and SOS-related alerts" reads, for the MVP, as the
     lost-contact alert (LOST-02) alone. The call notice to #1 (CALL-03,
     "<name> is calling you and sharing their location") stays at Time
     Sensitive.
  2. **SM-02's no-responder warning to the walker stays non-critical (Q4).**
     It is the one walker-facing notice where missing it means a later
     silence alerts nobody, so SM-02's own spec must make the no-responder
     state loud on the walker's journey screen itself, not rely on a
     notification alone.
  3. **The request names the production app and one test build (Q2).** The
     test build is for automated, real-iPhone tests of the lost-contact alert
     before the group relies on the app (L9, D-041) — not a demo. The owner
     chose this over the drafting session's recommendation (production only),
     a known trade-off recorded as R13 in STORE-01's spec.
  4. **Both bundle identifiers are fixed at sending, name-neutral (Q3):**
     production is the AS's own domain, reversed, plus a neutral word; the
     test build is the same plus `.test` (the location SDK's licence, clause
     1.9, covers development suffixes including `.test`, read 2026-09-30,
     D-086). Neither value is fixed today. They are recorded with `/decision`
     when the owner fixes them, at sending, and they are **public**: first in
     `docs/plan/decisions.md`, later in `apps/mobile/app.config.ts`.

  **The tests M3 owes these promises,** written in M3 whatever Apple answers
  (`docs/plan/critical-alerts-request.md`, Part E, item 6, which this decision
  points to so M3 finds them):
  - only the lost-contact message carries the critical level — L6, with the
    recording push fake, over **every** outbox message type, plus L2 for the
    pure rule;
  - no notification the app schedules itself uses the critical level — an L1
    rule, or an L2 test on the safety core's reminder builder;
  - exactly one lost-contact message per responder per event, across the SMS
    escalation, SM-10's resumed escalation and the watchdog run twice — L6,
    with an opaque, per-message collapse ID, never a walker, user or journey
    ID;
  - no further critical push follows the SMS — the same L6 test, running time
    past the 2-minute SMS;
  - the critical permission is requested only in responder setup (GRP-04) —
    an L1 import rule, plus L5 that setup asks;
  - readiness follows the granted level, re-read at app start and in the
    foreground — L6;
  - no push carries personal details in its payload or its request headers,
    over every push message type, with the collapse ID checked too — L6;
  - no FCM and no Expo push token on iOS — an L1 rule, plus L5 or L6 that the
    iOS path registers the native APNs device token.

  **Tracked carriers:** REL-06, CALL-03, REL-04, LOST-02, REL-07, LOST-07,
  SM-10, GRP-04. **Not tracked, and no gate enforces them:** AR-05 (the
  outbox), AR-06 (the watchdog), and the content-free payload rule (sourced
  from D-086 and `04-tech-stack.md` finding 4) — `req:coverage` asks for a
  test only against tracked requirements, and for an untracked one the
  test-name prefix is practice, not an obligation (D-074).
- **Consequences:**
  - The owner sends the request once A-02 exists, by M4 at the latest
    (**A-30**, added to `plan/README.md`), and records only the outcome:
    approved, refused or partial for each identifier, the date, and any
    condition Apple sets — never Apple's message itself, or any name, email
    address or case number from it.
  - The app is never transferred to another account or team (D-027; finding
    10 of `04-tech-stack.md`: a transfer would probably need a new request).
  - Time Sensitive stays the fallback on every path a refusal, a decline or an
    unnamed build leaves open (D-020).
  - Four flags go to other requirements' own specs, to be picked up when each
    is written: **REL-10** (the canary never uses the critical level);
    **SM-02** (the no-responder state loud on the walker's journey screen,
    point 2 above); **GRP-04** (readiness can go stale while a responder does
    not open the app); **CALL-03** (the call notice to #1 carries a name,
    filled in on the phone, never sent in clear).
  - Supersedes nothing. It settles how D-020 and REL-06 read for the MVP,
    within what they already say.

## D-088 — M1 closes
- **Date:** 2026-10-01 · **Status:** Accepted (owner, 2026-10-01). Asked in
  session with Claude's recommendation, which was "close M1, record (e)
  too"; the owner chose it · **Section:** 10 (M1)
- **Context:** M1's exit criteria in `10-roadmap.md` are "Spike results
  recorded; SDK go/no-go decision; Section 4 closed". The roadmap's M1 row
  also lists the Critical Alerts request drafted.
  - **Spike results recorded:** `docs/plan/04b-spike-results.md`, merged in
    #49 (`d6a2dff`, 2026-10-01).
  - **SDK go/no-go decision:** D-086, conditional GO (#49).
  - **Section 4 closed:** in #49 (`04-tech-stack.md` ✅).
  - **Critical Alerts request drafted:** STORE-01, D-087, merged in #51
    (`881c780`, 2026-10-01).
  - **CI green on `main`:** `ci` and `deploy-staging` passed on `881c780`,
    and on `d6a2dff` and `f46660c` before it.
- **Decision:** M1 is closed.
- **What stays open** (none of it blocks M2):
  - **D-086's conditions:** L9 must show a 5-minute stop on a real iPhone,
    and the Android exemption on a real Samsung; plus the M3 items it
    lists.
  - **A-30:** send the Critical Alerts request, which needs A-02, by M4 at
    the latest.
  - **The spike harness's known limits:** fixed only if more nights are
    ever run (`04b-spike-results.md`, part 8).
  - **`.claude/` configuration gaps,** each needing the owner's approval
    and an ID:
    - `planner`'s and `test-author`'s path guards block their own agent
      memory (fired five times over SPIKE-01 and STORE-01);
    - the write-time privacy hook only catches `+47`/`0047` numbers;
    - `plan-keeper`'s brief, `/status` and `/bugfix` still name
      `docs/progress/m0.md`.
- **Consequences:**
  - `10-roadmap.md`'s M1 row is marked done (D-088);
  - the next milestone is M2, the core safety loop on the server.

## D-089 — The repository is public
- **Date:** 2026-10-01 · **Status:** Accepted (owner, 2026-10-01). Asked in
  session with Claude's recommendation; the owner chose "close M1, record
  (e) too" (the recommendation) · **Section:** 5 (amends D-029)
- **Context:**
  - D-029 says: "The private repository lives on the owner's paid personal
    account". Its reason was that paid plans enforce rulesets on private
    repositories.
  - **The repository has been public since 2026-09-28.** That was the
    owner's change, recorded in `docs/progress/m0.md`'s INF-06 entry
    (2026-09-28). It quotes GitHub's docs: standard Linux runners for
    public repositories "are free and unlimited", with "4 CPUs, 16 GB RAM
    and 14 GB SSD". The owner also set **"Require approval for all
    external contributors"** (Settings → Actions → General).
  - No decision recorded it until now. Open item (e) in `m1.md` has the
    details.
- **Decision:** the repository is public. This amends D-029's "private";
  the rest of D-029 stands. Checked against D-029's own text: its Decision
  names "the owner's paid personal account" (unchanged) and allows a later
  transfer to an AS organisation (unchanged); its Consequences — merge
  rules apply to admins with no bypass, and the first CI setup task checks
  through GitHub's API that the rules are enforced — do not name
  visibility and hold regardless of it. Only D-029's *Context*, the reason
  given at the time ("paid plans enforce rulesets on private repositories"),
  is superseded: GitHub enforces rulesets on public repositories on the
  free plan too, which is moot now the repository is public either way.
- **What it costs, and the rules that follow:**
  - every file is world-readable: no personal data, and synthetic test
    data only (RG-07);
  - results documents hold no coordinates, no phone number and nothing
    about a real person, as SPIKE-01 practised (AC14);
  - secrets are never committed: gitleaks runs in CI's `security` job
    (`.github/workflows/ci.yml`, "Secret scan (gitleaks)");
  - the merge rules still apply. **Checked, not assumed:** `gate:integrity`
    reported "gate:integrity: 5 of 5 checks passed." on commit `881c780`
    (job run 36901149291, read 2026-10-01T17:41:28Z) — it is checked on
    every pull request in CI, not a one-time claim.
- **Consequences:**
  - A-05 in `docs/plan/README.md`, and A-05 in the roadmap's
    owner-actions table, stop saying "private";
  - open item (e) is answered.

## D-090 — M2's order: eight tasks, SM-01 first
- **Date:** 2026-10-01 · **Status:** Accepted (owner, 2026-10-01). Asked in
  session with Claude's recommendation, "8 tasks, SM-01 first"; the
  alternative offered was 7 tasks with LOST-01 first (journey start and
  heartbeat in one task) · **Section:** 10 (M2)
- **Context:**
  - M2's roadmap row lists its requirements (LOST-01 to LOST-03, LOST-06 to
    LOST-08, SM-01 to SM-10, REL-10) and its exit criteria. Unlike M0, it has
    no order and no task table.
  - One task per pull request (D-052).
  - Logins arrive with GRP-01 in M3.
- **Decision:** eight tasks, one pull request each, each through
  `/feature <ID>`:
  1. **SM-01 — Start a journey.** The base tables starting needs; every
     request authenticated per device (SEC-07); the journey state machine
     module (AR-04); one active journey per walker (SM-01); at least one
     responder to start (SM-02's start rule).
  2. **LOST-01 — Heartbeat,** with or without position (SM-03); duplicates
     have no effect (SM-08); database-time order (SM-09); events after ENDED
     ignored and logged without location (SM-07); location kept out of logs
     before the first task that binds one ships (PRIV-07, D-077 item 14).
     Inputs: `04b-spike-results.md` §4.5, including never echoing a
     `background_geolocation` key.
  3. **LOST-02 — Lost-contact alert.** Watchdog every 10–15 s (AR-06, REL-01);
     alert and push in one transaction (AR-05); a recording push fake; "the
     most important test" at L6; D-079's watchdog check-in follow-ups and
     D-068's pool-lifecycle revisit.
  4. **LOST-03 — Back in contact;** SM-04.
  5. **LOST-06 — "I'm on it".**
  6. **LOST-07 — SMS escalation** at 2 minutes (REL-07); a recording SMS fake;
     a failed SMS pages the owner; SM-10; SM-02's last-responder warning
     (with D-087's flag).
  7. **LOST-08 — "They're safe";** SM-06; SM-05.
  8. **REL-10 — The staging canary** every ⚙️ 15 minutes, paging the owner if
     late; D-087's flag (the canary never uses the critical level); D-077's
     note (Nano's reduced CPU priority).
- **Logins before GRP-01:** device sessions come only from tests and, on
  staging, from the canary. Staging's journey API admits nobody else. The
  mechanism is D-091.
- **Exit criteria unchanged:** L6 green; mutation ≥ 80 %; the staging canary
  on time for 24 hours.
- **Consequences:**
  - The roadmap gains "M2 — Core safety loop in detail", and its M2 row is
    marked in progress.
  - A change to the order or the split goes back to the owner.
  - A bug fix (BUG-10, D-092) may run between tasks.
  - Supersedes nothing.

## D-091 — Devices authenticate with a hashed per-device credential until login arrives
- **Date:** 2026-10-01 · **Status:** Accepted (delegated to Claude, D-031) ·
  **Section:** 5. D-032 (Better Auth) stands. Source: `docs/specs/SM-01.md`,
  approach items 5 and 6.
- **Context:** every route but health needs a known device (SEC-07), and
  nothing can sign in until GRP-01 (M3). SM-01 is the first task to ship a
  route that needs it.
- **Decision:**
  - A random 32-byte secret per device, base64url, sent as
    `Authorization: Bearer`.
  - Only its SHA-256 hash is stored, in `devices.credential_hash` (unique),
    and the device is looked up by that hash.
  - One oRPC middleware on every route but `GET /v1/health`. It is closed by
    default: SM-01-AC9 enumerates the contract's routes, and since review
    loop 1 a test also pins that the app registers no route outside the
    contract.
  - The same 401 for every cause. A store failure while checking is a 500,
    never a 401. The raw header is not passed on to handlers.
  - All of it sits behind a `DeviceAuthenticator` port.
  - No route, seed or insert function creates a credential before GRP-01
    (spec item 6).
- **Why not Better Auth's sessions now:**
  - Nothing can sign in until GRP-01.
  - Its schema would fix the shape of personal data before the login task
    designs the people tables.
  - Native heartbeat uploads need a plain header.
  - Fewer dependencies (SEC-06).
- **Why plain SHA-256:** a 256-bit random secret cannot be guessed offline, so
  a slow hash would only slow every request (privacy-security-reviewer,
  SM-01, 2026-10-01).
- **Fallback:** Better Auth's sessions through its bearer plugin, behind the
  same port. Routes do not change either way.
- **What GRP-01 inherits and decides:**
  - It inherits `users`, `devices`, the port, the middleware, the
    public-route tests and the 401 contract.
  - It decides issuance, expiry, rotation, revocation, the new-device notice,
    and Better Auth's use of UUID user IDs.
  - **The issuer must use `crypto.randomBytes(32)`, with a test asserting
    it.** The plain-SHA-256 premise rests on 256 bits.
- **Consequences:** task 8's canary credential never expires and is revoked
  only by deleting its row. It goes in the secrets inventory and in the
  `staging` environment. Supersedes nothing.

## D-092 — The journey files become safety paths
- **Date:** 2026-10-02 · **Status:** Accepted (owner, 2026-10-02). Asked in
  session with Claude's recommendation, "Yes, all of them"; the alternatives
  offered were "only the database parts" and "not now" · **Section:** 6/8
  (extends D-042's owner-approval paths, as D-079 and D-084 did)
- **Context:**
  - safety-reviewer (SM-01, PASS, 2026-10-01) found that SM-01's journey
    guarantees live partly outside every safety list: `SAFETY_PATHS` in
    `scripts/lib/gate-decisions.mjs`, `.github/CODEOWNERS`, the `safety`
    filter in `.github/workflows/ai-review.yml`, and `CLOCK_FREE_PATHS` in
    `packages/config/eslint/index.mjs`.
  - **Checked** by the orchestrating session on 2026-10-02, by reading those
    four files: none lists `adapters/journeys.ts`,
    `adapters/device-credentials.ts`, `db/schema.ts`, `db/migrations/` or
    `modules/journeys/`. The ai-review filter already lists `api.ts` and
    `packages/contracts/**`. `CLOCK_FREE_PATHS` holds only `domain/` and
    `safety-core`.
  - **Failure scenario:** a later change moves the responder insert out of its
    transaction, rewrites the one-unended index, or makes the credential check
    accept anything (from task 2 it guards heartbeats). It gets no safety
    review, no mutation run and no owner approval. Only the L3 tests stand in
    the way.
- **Decision:**
  - `apps/server/src/adapters/journeys.ts`,
    `apps/server/src/adapters/device-credentials.ts`,
    `apps/server/src/db/schema.ts`, `apps/server/src/db/migrations/` and
    `apps/server/src/modules/journeys/` become safety paths: in
    `SAFETY_PATHS`, in CODEOWNERS (owner approval) and in the ai-review
    `safety` filter.
  - `apps/server/src/modules/**/*.ts` joins `CLOCK_FREE_PATHS`.
  - **Done as BUG-10,** its own small pull request right after SM-01 merges
    and before task 3 (the watchdog).
  - Its `ai-review.yml` part is merged by hand (D-075).
- **Cost:** more pull requests wait for the owner's approval.
- **Not in the question, so not decided:** safety-reviewer also named
  `api-process.ts`, which wires the database clock. BUG-10's spec asks about
  it.
- **Consequences:** supersedes the question SM-01's spec sent to task 2
  (whether the credential adapter becomes a safety path). It is answered here.

## D-093 — The dependency audit accepts one advisory: node-forge's signature check (BUG-11)
- **Date:** 2026-10-02 · **Status:** Accepted (owner, 2026-10-02). Asked in
  session with Claude's recommendation, "Accept this one, recorded"; the
  alternative offered was "wait for upstream" · **Section:** 8 (SEC-06).
  D-090 to D-092 are taken by the open SM-01 pull request (#53), so this is
  D-093.
- **Context:**
  - CI's required `security` job runs `pnpm audit --audit-level high`. On
    2026-10-02 it failed on SM-01's pull request with one high advisory,
    [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
    (CVE-2026-85393, CVSS 8.7): "node-forge RSA PKCS#1 v1.5 signature
    verification accepts extra nested DigestAlgorithm elements". The
    advisory page, read 2026-10-02, says published 2026-09-03, affected
    "through 1.4.0", and patched versions "None available". An attacker can
    forge signatures that verify, for low-exponent RSA keys.
  - **Not that pull request's failure.** It changes no `package.json` and no
    lockfile; the lockfile last changed on 2026-09-28. The same command on
    `main`'s own checkout fails the same way: "7 vulnerabilities found ·
    Severity: 6 moderate | 1 high", exit 1. `main`'s `security` job passed
    on 2026-10-01 (D-088), so the advisory reached npm's audit data after
    that. Every pull request fails the check until it is handled.
  - **Where `node-forge` is used, and what it does there** (read in
    `@expo/cli` 57.0.27 on 2026-10-02, and confirmed by
    `privacy-security-reviewer`). The audit's only path is
    `apps__mobile>expo>@expo/cli>node-forge`: Expo's command-line tool, and
    `@expo/code-signing-certificates`, which only it uses.
    - `run/ios/codeSigning/Security.js`, reached only from a local
      `expo run:ios`, parses a certificate from the Mac's keychain. It
      verifies nothing.
    - `utils/codesigning.ts` signs the development server's manifests in
      `expo start`, through `@expo/code-signing-certificates`. Its two
      checks are of a local certificate's own signature and of the tool's
      fresh signature, never of a signature an attacker supplies. In this
      project neither branch even loads `node-forge`: the resolved
      configuration has no `updates` and no EAS project ID, and the app
      installs no over-the-air updates (D-023).
    - The Android build CI runs (`android-e2e`) reaches none of this.
    - `pnpm why` finds no path from the server, `packages/` or the app's
      runtime code, and `expo`'s runtime entry does not import the tool.
- **Decision:** the audit ignores this one advisory, by its GHSA ID, in the
  root `package.json` (`pnpm.auditConfig.ignoreGhsas`). Everything else stays
  at `--audit-level high`. `scripts/dependency-audit.test.mjs` (BUG-11)
  pins:
  - that every ignored advisory is named by an owner's accepted decision,
    and that nothing is ignored by CVE;
  - that every audit line in the workflows is exactly
    `pnpm audit --audit-level high`, and that no other route sets audit
    or hook settings (`pnpm-workspace.yaml`, a root `.pnpmfile.cjs`, a
    `pnpmfile` setting);
  - **D-093's premise, from the lockfile:** `node-forge` is depended on only
    by Expo's tool and its signing package, by no workspace package, and only
    in a version the advisory covers.
- **Remove the ignore** when a patched `node-forge` exists or Expo stops
  depending on it. Either change to the lockfile fails the premise test
  with "decide again, or remove the ignore", so the moment is not left to
  memory. The same test fails if anything else, such as a server
  dependency, starts pulling `node-forge` in: the accepted risk is Expo's
  tool only, and a new path needs a new decision.
- **Risk, stated plainly:** no flow this project runs uses `node-forge` to
  verify a signature from an untrusted source. The ignore accepts that a
  future flow could, and the premise test is what would say so.
- **Not covered:** `spikes/background-safety/app/` has its own lockfile, with
  `eas-cli` and `node-forge`. Neither CI's audit nor Dependabot reads it. That
  predates this decision; the spike code is throwaway and never imported.
- **Consequences:** BUG-11 is its own small pull request to `main`, and the
  same change is ported into #53 so SM-01 can merge. Supersedes nothing.

## D-094 — BUG-10's scope: `api-process.ts` joins D-092; the pnpm settings files and the contracts source stay unowned
- **Date:** 2026-10-02 · **Status:** Accepted (owner, 2026-10-02). Two answers
  in session · **Section:** 6/8 (amends D-092's list)
- **Context:**
  - D-092 named five journey files to become safety paths. `safety-reviewer`
    had also named `apps/server/src/api-process.ts`, which wires the database
    clock into the journey service; D-092 left it for BUG-10's spec to ask.
  - On SM-01 (#53) and BUG-11 (#54), `privacy-security-reviewer`,
    `test-auditor` and `code-reviewer` suggested putting `/pnpm-workspace.yaml`,
    `/.npmrc` and `packages/contracts/src/` under the owner's approval too.
- **Decision:**
  1. **`apps/server/src/api-process.ts` becomes a safety path with D-092's
     five** (asked with Claude's recommendation, "Yes, add it"; the owner
     chose it). It is the one file that wires the database clock into the
     journey service: a process clock there would move every safety decision
     off database time (REL-01) unnoticed. The cost is small, because every
     M2 task already needs the owner's approval through `domain/`.
  2. **`/pnpm-workspace.yaml`, `/.npmrc` and `packages/contracts/src/` stay
     without a code owner** ("it's fine as is", the owner, 2026-10-02,
     declining the optional suggestion). What already guards them:
     `scripts/dependency-audit.test.mjs` (owned, in `/scripts/`) fails if
     either pnpm file sets any audit or hook setting (D-093), and the
     ai-review `safety` filter already lists `packages/contracts/**`, so a
     contract change gets the safety review.
- **Consequences:** BUG-10 makes six paths safety paths. Reviewers who
  suggest owning the pnpm files or the contracts source again can be pointed
  here. Supersedes nothing; amends D-092's list.
