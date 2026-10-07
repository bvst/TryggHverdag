# 5 · Architecture & code structure

**Status:** ✅ Done (one scope question, LOST-08, carried to Section 6) · **Last updated:** 2026-09-20

## Summary
- A modular monolith with pure domain logic, ports and adapters, an injected
  clock, an explicit journey state machine, a transactional outbox and a
  lock-safe watchdog (AR-01 to AR-12).
- REST + OpenAPI, contract-first, with an automatic breaking-change check in CI
  (D-030).
- Library choices are delegated to Claude (D-031). Set v1 is D-032, shown in
  the table below.
- The state machine and its edge-case rules SM-01 to SM-10 are binding (D-033).
- Code lives in a repository on the owner's paid GitHub account, public since
  2026-09-28 (D-089), with merge rules that also apply to admins (D-029).
- **Open:** LOST-08 ("responder closes an alert") is a scope question, asked in
  Section 6, round 1.
- **Follow-up:** draft the DPIA (PRIV-11) before the private group starts;
  scheduled in Section 10.

## Goal of this section
A structure where changes are easy and safe:
- clear boundaries between parts of the system;
- safety-critical logic isolated and exhaustively tested;
- architecture rules enforced by tools, not by anyone's memory — including
  Claude's.

## Research findings — round 1

### 1. Clever Cloud features that shape the design
- Clever Cloud's documentation covers workers, scheduled jobs (CRON),
  deployment health checks, blue/green deployments, encryption at rest, and a
  Terraform provider.
  Source: https://clever.cloud/developers
- Its command-line tool can deploy from CI pipelines.
  Source: https://github.com/CleverCloud/clever-tools
- **Implication:** Run the API and the worker as two Clever Cloud apps built
  from the same repository. Health checks gate every deploy. The infrastructure
  is described in Terraform files in the repository, so every change to it is
  reviewed like code.

### 2. Old app versions stay in use
- **Known practice (hypothesis):** People don't update apps immediately, so
  several app versions talk to the server at the same time. A server change
  that breaks an older app is a regression that no single-version test catches.
- **Implication:** The server must stay compatible with the oldest supported
  app version, and tests must prove it (AR-08).

## Research findings — round 2

### 3. The location SDK talks to our server directly, from native code
- The location SDK uploads positions itself, with its own HTTP POST from native
  code, only to the server we configure. It keeps them in an on-device database
  until our server confirms receipt.
  Source: https://www.github.com/transistorsoft/react-native-background-geolocation/blob/master/help/PRIVACY_POLICY.md
- **Implication:** Our most important endpoint (heartbeats and positions) is
  called by code that is not our TypeScript. It must be plain HTTP with a
  documented format, whatever API style we choose.

### 4. Breaking API changes can be caught automatically
- oasdiff is an open-source tool, with a GitHub Action, that compares two
  OpenAPI descriptions and fails the build when a change would break existing
  clients.
  Sources: https://github.com/oasdiff/oasdiff · https://github.com/oasdiff/oasdiff-action
- **Implication:** With an OpenAPI description saved for every released app
  version, CI can prove that a new server still serves every supported app
  version (AR-08).

### 5. Enforced checks on GitHub need a paid plan for private repositories
- GitHub's rulesets, which can block merging until tests pass, work in public
  repositories on the free plan, but in private repositories only on paid plans
  (Pro, Team, Enterprise).
  Source: https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
- GitHub Team costs about $4 per user per month.
  Source: https://github.com/DevToolie/.github/pull/3/files
- **Implication:** Without a paid plan, a private repository has no enforced
  "tests must pass before merge" rule. It would fail quietly, which is exactly
  what this project must avoid.
- **Since 2026-09-28 the repository is public (D-089),** so rulesets apply on
  any plan. This finding is kept as the reason D-029 chose a paid plan.

## API style — pros and cons

The owner asked (round 1) for the trade-offs, noting that Claude writes both
sides, and that external systems would change the answer.

| | Typed RPC (e.g. tRPC) | REST + OpenAPI from shared schemas |
|---|---|---|
| Speed to build | Fastest, with little route design | A bit more ceremony — but Claude writes it, so the cost falls on Claude, not the owner |
| Type safety between app and server | Automatic, end to end — for the **current** code | Also end to end, through a typed client built from the same schemas |
| Old app versions still on phones | The type checker can't see them; breaking changes show up in production | Each release's OpenAPI file is saved, and CI fails on changes that would break a supported version (finding 4) |
| Versioning | No built-in versioning | Standard (`/v1`, `/v2`) with deprecation |
| Non-TypeScript callers | Awkward: its own URL and batching conventions | Plain HTTP and JSON; works for anything |
| Callers we already have | The location SDK's native upload (finding 3) and the iOS notification extension would need a second, plain API | The same API serves everyone |
| External systems later (partners, a web dashboard, SMS delivery reports) | Needs a second API | Same API, already documented |

**Conclusion.** The owner is right: if only our current TypeScript code called
the server, typed RPC would be fine. But three callers we don't fully control
exist from day one: older app versions on phones, native code in the location
SDK, and incoming webhooks from providers. REST with OpenAPI covers all of them
with one API style, and a typed client keeps the compile-time safety of RPC.

**Recommendation:** REST + OpenAPI, contract-first. Schemas are defined once in
`packages/contracts`, the typed client and the OpenAPI file are generated from
them, and oasdiff runs in CI. Candidate libraries are compared in round 3.

## Design principles (binding — D-030 to D-033 build on these)

| ID | Principle | Why |
|----|-----------|-----|
| AR-01 | **Modular monolith:** one codebase, two processes (API and worker). No microservices. | Simple to run, test and change. Modules give structure without network boundaries. |
| AR-02 | **Ports and adapters:** domain logic is pure TypeScript with no input/output. The database, clock, push, SMS and map tiles sit behind interfaces, and each has an in-memory fake in the test kit. | Safety rules can be tested in milliseconds without a network or a real phone. |
| AR-03 | **Time is injected.** Domain code never reads the clock itself. Safety decisions use the database clock (REL-01). A lint rule enforces this. | Tests control time exactly ("advance 5 minutes"), so time-based bugs can't hide. |
| AR-04 | **Journeys are an explicit state machine.** All states and transitions live in one module, illegal transitions are impossible, and every transition has a test. | A new feature can't silently add an unhandled state. |
| AR-05 | **Transactional outbox:** a state change and the messages it causes (push, SMS) are saved in the same database transaction. A sender process delivers them with retries. | A crash or restart can never lose an alert. |
| AR-06 | **Idempotent, lock-safe watchdog:** it runs every ⚙️ 10–15 seconds and locks the overdue journeys it picks, skipping rows another worker already holds. | Running it twice, or on two workers, is harmless. |
| AR-07 | **One shared contract:** API request and response schemas are defined once and used for server validation, the app's API client, API docs and contract tests. | App and server can't drift apart unnoticed. |
| AR-08 | **Backward-compatible API:** the server supports the oldest supported app version. Breaking changes need a new API version. Contract tests replay old app versions' requests against the new server. | Protects people who haven't updated yet. |
| AR-09 | **Isolated safety core in the app:** background location, heartbeats, the REL-04 reminder and the permission checks sit behind one narrow interface. The UI can't reach the location SDK directly. | UI work can't break safety, and the SDK can be replaced (D-023 fallback). |
| AR-10 | **Boundaries enforced by tooling:** import rules (for example "domain can't import adapters", "a feature can't import another feature's internals") are checked in CI. | The structure can't erode as code is added. |
| AR-11 | **Privacy by construction:** one logging module scrubs locations and phone numbers (PRIV-07). Retention jobs run in the worker (PRIV-04). Location data can only be read through a module that checks journey access (PRIV-03). | Privacy rules live in one place and are tested once. |
| AR-12 | **Infrastructure as code:** Clever Cloud resources are defined in Terraform in the repository. | Infrastructure changes are reviewed, repeatable and reversible. |

## Proposed repository layout

```
/
├── CLAUDE.md
├── docs/                 plan/, specs/, dpia/, progress.md
├── apps/
│   ├── mobile/           Expo app
│   │   └── src/
│   │       ├── safety-core/   background location, heartbeats, reminder (AR-09)
│   │       ├── features/      grp/, call/, jrn/, lost/, help/  ← match story IDs
│   │       └── shared/        UI kit, translations (nb, en), API client
│   └── server/
│       └── src/
│           ├── domain/        pure rules: journey state machine, alert rules
│           ├── modules/       identity, groups, journeys, alerts,
│           │                  notifications, maps, privacy
│           ├── adapters/      postgres, apns, fcm, sms, clock, tiles
│           ├── api.ts         entry point: HTTP API
│           └── worker.ts      entry point: watchdog, outbox sender,
│                              retention, canary
├── packages/
│   ├── contracts/        API schemas and types (AR-07)
│   ├── test-kit/         fakes for every adapter, data builders, fake clock
│   └── config/           shared TypeScript, lint and import-rule settings
├── infra/                Terraform for Clever Cloud (AR-12)
└── spikes/               throwaway experiments, never imported
```

Feature folders use the same prefixes as the story IDs, so a spec, its code and
its tests are always easy to find together.

## Journey state machine — first draft

**Journey states:** `ACTIVE`, `LOST_CONTACT`, `ENDED` (reason: `home` or
`auto`). "Location unavailable" (REL-05) is a flag on `ACTIVE`, not a separate
state.

| From | Event | To | Messages written to the outbox |
|------|-------|----|--------------------------------|
| — | Walker starts a journey, or calls #1 (CALL-03) | ACTIVE | "Journey started" to responders (JRN-04) |
| ACTIVE | Heartbeat | ACTIVE | — |
| ACTIVE | Watchdog: no heartbeat for 5 min (D-021) | LOST_CONTACT | Open an alert; push to responders (LOST-02) |
| LOST_CONTACT | Heartbeat | ACTIVE | Resolve the alert; "back in contact" (LOST-03). Only a fresh heartbeat: one that, counted, leaves the silence under 5 min by the database clock (D-112) |
| ACTIVE | "I'm home" | ENDED (home) | "<name> is home" (JRN-05) |
| ACTIVE | 2 h reached and no answer for 10 min | ENDED (auto) | "Ended without confirmation" (JRN-06) |

**Alert states:** `OPEN` → `ESCALATED` (no acknowledgement within 2 minutes;
SMS sent, LOST-07) → `ACKNOWLEDGED` → `RESOLVED` (for example "They're safe",
LOST-08). An `OPEN` alert can also go
straight to `ACKNOWLEDGED` (other responders see who is on it) or `RESOLVED`
(the phone is back in contact, or the journey ended). An `ESCALATED` or
`ACKNOWLEDGED` alert also goes to `RESOLVED` when the phone is back in contact
or the journey ends (D-112 resolves an alert whatever its state). An alert
reads as acknowledged only when it is `ACKNOWLEDGED` and someone is recorded on
it; one marked `ACKNOWLEDGED` with nobody recorded is escalated (D-114,
D-116). The edge back from `ACKNOWLEDGED`, when the acknowledging responder
is removed, comes with SM-10's task (D-115).

### Edge-case rules (binding — D-033)

| ID | Rule |
|----|------|
| SM-01 | One active journey per walker. Calling #1 during a journey adds #1 to it (CALL-03). |
| SM-02 | A journey needs at least one responder to start. If the last responder leaves or is removed during a journey, the walker is warned at once. |
| SM-03 | Heartbeats keep a journey ACTIVE even without a position; "location unavailable" is a flag (REL-05). |
| SM-04 | LOST_CONTACT → ENDED (home) is allowed, e.g. when a queued "I'm home" arrives after reconnecting. The alert is resolved and responders get "<name> is home". |
| SM-05 | The 2-hour automatic stop (JRN-06) **never** ends a journey that is in LOST_CONTACT. Safety comes before tidiness. |
| SM-06 | A LOST_CONTACT journey ends when the phone reconnects and the walker ends it, or when the acknowledging responder closes it (LOST-08, D-034), or automatically 24 hours after the alert opened, with responders told. Retention (PRIV-04) counts from the end. |
| SM-07 | Events that arrive after ENDED are ignored and logged without location; late positions are discarded. |
| SM-08 | Every event carries an ID. Duplicates have no effect. |
| SM-09 | Events are applied in the order the server receives them, using database time. |
| SM-10 | If the responder who acknowledged an alert is removed, the alert goes back to unacknowledged and escalation resumes. |

## Library choices — set v1 (delegated to Claude, D-031 → D-032)

| Concern | Choice | Why | Fallback |
|---------|--------|-----|----------|
| API contract and handler | **oRPC**, contract-first, with its OpenAPI handler (REST routes) and zod schemas | Built-in OpenAPI support, a typed client and typed errors. Actively developed, and positioned for teams that want RPC ergonomics without giving up OpenAPI. Source: https://www.pkgpulse.com/guides/orpc-vs-trpc-v11-vs-ts-rest-2026 | ts-rest |
| HTTP layer | **Hono** on Node.js LTS | Small and built on the standard Fetch API; also hosts health checks and the tile proxy | Fastify |
| Database access | **Drizzle ORM**, with generated SQL migrations committed and reviewed | Schema in TypeScript and readable SQL migrations; raw SQL for the watchdog's row-locking queries (verify at setup) | Kysely |
| Jobs and outbox | **Graphile Worker** for jobs (the minute check-in). **Since D-108 (LOST-02), the outbox is a table of our own**, written in the alert's transaction and delivered by the worker's own loop; the watchdog runs on the same loop, not as a Graphile job | Jobs are added through a SQL function, so they can be written in the same transaction as the state change (AR-05); scheduling can use database time. Source: https://worker.graphile.org/docs/sql-add-job | pg-boss |
| Login | **Better Auth**, self-hosted in our backend: SMS codes via our SMS provider; passkey plugin for the admin | Maintained and widely used; sessions stay in our own database, so no third-party login provider. Source: https://mcp.depscope.dev/pkg/npm/@better-auth/passkey | A TOTP second factor for the admin, if native passkeys prove fragile |
| State machine | **Hand-written** pure transition function | Three states; TypeScript checks every case is handled. A library would add more than it saves | XState |
| Import rules | **dependency-cruiser** | Mature and runs in CI | eslint-plugin-boundaries |
| Validation | **zod** | One schema language for the contract, server and app | — |
| Logging | **pino** with its built-in redaction | Supports PRIV-07 | — |
| Monorepo | **pnpm workspaces + Turborepo** | Runs only the tasks affected by a change, which keeps hooks fast (Section 7). Expo compatibility verified at setup | npm workspaces |
| App navigation, data, text, maps | **Expo Router**, **TanStack Query** (via oRPC), **react-i18next**, **MapLibre React Native** | Standard Expo stack. MapLibre supports raster tile sources and has an Expo config plugin. Source: https://maplibre.org/maplibre-react-native/docs/setup/expo | — |

Test tools are chosen in Section 6.

## Data model — first sketch

| Table | Holds | Notes |
|-------|-------|-------|
| users, groups, memberships | People and the group; age band and role per membership | PRIV-12 |
| devices | Platform, push token, alert readiness | GRP-04 |
| journeys | Walker, state, start time, last heartbeat (database time), location status, end time and reason | AR-04 |
| journey_responders | Who follows which journey | PRIV-03 |
| positions | Time, latitude, longitude, accuracy, battery | Deleted 24 h after the journey ends (PRIV-04) |
| alerts | State, opened, escalated, acknowledged by, resolved | LOST-02, LOST-06, LOST-07 |
| outbox | Push and SMS messages waiting to be sent, attempts, next try | AR-05 |
| audit_log | Admin actions | SEC-03 |

## How this structure protects against regressions
- **Pure domain plus fakes:** the whole lost-contact flow runs in milliseconds
  with time under test control, so it can run on every change.
- **State machine:** tests can go through every transition, so a new state or
  event can't slip in untested.
- **Shared contracts and compatibility tests:** server changes can't break
  older apps.
- **Import rules in CI:** the structure can't erode as agents add code.
- **Outbox:** whether an alert gets sent doesn't depend on process timing or
  crashes.

## Open questions for the owner

**Round 2 (asked 2026-09-20, answered):**
1. API style, now that the pros and cons are laid out? (Recommendation: REST +
   OpenAPI, contract-first.)
2. How should library-level choices be decided? (Recommendation: Claude
   decides, and records each choice with its reasons in `decisions.md` as
   "Accepted (delegated)". The owner can reopen any of them.)
3. Which GitHub plan? (Recommendation: GitHub Team for the AS, about $4 per
   month for one user, so "tests must pass before merge" is actually enforced.)

**Round 3 (planned):** library choices — HTTP and contract library, database
access, outbox and job handling, login library, import-rule tool, and a state
machine library versus a small hand-written one — plus the final state
machine.

**Round 1 (asked 2026-09-20, answered):**
1. Use the AS for the Apple and Google developer accounts?
2. Where should the code live?
3. API style?

## Rounds

### Round 1 — 2026-09-20
- **Questions:** AS for developer accounts · code hosting · API style.
- **Answers (owner):** yes, use the AS · GitHub · "What are the pros and cons?
  For internal code it is you who will create and integrate it. But if
  externals need to connect, the option will be different."
- **Outcome:** D-027 (AS) and D-028 (GitHub) recorded. The API style trade-offs
  are written up above, with research findings 3–5. The API style goes to
  round 2 for confirmation.

### Round 2 — 2026-09-20
- **Questions:** API style · who decides libraries · GitHub plan.
- **Answers (owner):** REST + OpenAPI, contract-first · Claude decides and
  records the reasons · "I have a paid GitHub private account."
- **Outcome:** D-029 to D-033 recorded. The library set, the final state
  machine and the edge-case rules are written above. Round 3 was not needed
  because library choices are delegated. The LOST-08 scope question goes to the
  owner in Section 6. Section 5 closed.

## Next steps
Section closed. Continue in [06-testing-strategy.md](06-testing-strategy.md).
