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

