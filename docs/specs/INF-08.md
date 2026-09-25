# INF-08 · Monitoring

**Milestone:** M0 · **Serves:** REL-08 and failure mode F7 · **Decisions:** D-065,
D-076, D-077, D-079 (to be recorded by plan-keeper) · **Written:** 2026-09-25

## Requirement

From `docs/plan/10-roadmap.md`, the M0 table:

> INF-08 | Monitoring: the worker checks in with Healthchecks.io; UptimeRobot
> watches the API; owner paging tested | **Done when:** A deliberately stopped
> worker pages the owner within 5 minutes

It serves REL-08 (`docs/plan/03-safety-reliability-security.md`, binding under D-022):

> External uptime monitoring checks the API and the watchdog every minute and
> alerts the owner within ⚙️ 5 minutes of a failure.

It also delivers the owner-alert half of [F7](../plan/03-safety-reliability-security.md#failure-modes)
("Server or watchdog down → no alerts at all → owner alerted by external
monitoring"). F7's other half, telling walkers the service is unavailable, is not
this task.

## The owner's decision (asked 2026-09-25) — D-079

**UptimeRobot: "Free now, Solo at go-live"** (Claude's recommendation, accepted).

- UptimeRobot Free checks every **5 minutes**. So REL-08's "checks the API every
  minute" is **not met on staging**. This is a known and recorded gap, and it lasts
  until go-live.
- Paying for Solo (60-second checks) becomes an **M5 go-live gate item**.
- The **watchdog/worker** half of REL-08 is met every minute, at no cost, by
  Healthchecks.io.
- This changes how REL-08 is met on staging. plan-keeper records it as **D-079**.

## Facts verified on 2026-09-25 (and where from)

- **UptimeRobot** ([uptimerobot.com/pricing](https://uptimerobot.com/pricing)):
  - Free has 50 monitors, a "5 min. monitoring interval", and includes "Keyword
    monitor". SMS and voice alerts are not included.
  - Solo has a "60-second monitoring interval" for $12 a month billed yearly
    ($144 a year), or $13 billed monthly.
  - The mobile app (Android and iOS) is listed for all plans.
  - Terms ([uptimerobot.com/terms](https://uptimerobot.com/terms)): "available for any
    use, including commercial and business use".
- **Healthchecks.io plans** ([healthchecks.io/pricing](https://healthchecks.io/pricing)):
  - Hobbyist is $0, with 20 checks and 100 log entries per check, and no
    SMS or phone-call credits. Business ($20 a month) adds those credits.
- **Healthchecks.io pinging API** ([healthchecks.io/docs/http_api](https://healthchecks.io/docs/http_api)):
  - The ping URL is `https://hc-ping.com/<uuid>`, and HEAD, GET and POST are all
    accepted.
  - A successful ping gets `200` with the body `OK`.
  - More than 5 pings a minute may be rate-limited.
- **Healthchecks.io behaviour** ([healthchecks.io/docs](https://healthchecks.io/docs)):
  - A check goes **down** once Period + Grace Time have passed since its last
    successful ping, and alerts go out on that change.
  - "Treat check UUIDs and project Ping keys as secrets. If you make them public,
    anybody can send telemetry signals to your checks and mess with your
    monitoring."
- **A check that has never been pinged stays `new` and never alerts.**
  `docs/progress.md` records this under A-16, from Healthchecks.io's source
  (`hc/api/models.py`, `get_status`).
- **Clever Cloud Terraform provider 2.2.1**, the locked version
  (`pkg/resources/application/update.go`):
  - Our app has no `deployment` block. So when its `environment` differs
    between the plan and the state, apply calls `RestartApp`.
  - That means an apply that adds a variable restarts staging with it.
- **Clever Cloud CLI:** `clever stop` exists (Clever Cloud CLI docs).
- **Not verified from a session:**
  - the wording of the Clever Cloud Console's stop and start buttons;
  - the wording of UptimeRobot's and Healthchecks.io's settings screens.

## Approach (technical choices delegated to Claude, D-031)

1. **A new port, `CheckIn`, in `ports.ts`** (`checkIn(): Promise<void>`).
   - Its adapter in `adapters/` uses Node's built-in `fetch`, so there is no new
     dependency.
   - It sends one request to the ping URL, with no body and a 10-second timeout,
     and no retry loop: the next minute is the retry.
   - Anything that is not a 2xx answer, a network error, or a timeout counts as a
     failure.
   - A recording fake goes in `packages/test-kit`, as AR-02 requires.
2. **The heartbeat task records the database beat first. It checks in only if
   that succeeds.**
   - If recording throws, there is no check-in, and the task fails exactly as it
     does today.
   - A worker that cannot record its beat cannot run a watchdog, so Healthchecks.io
     should page.
3. **A failed check-in does not fail the task.**
   - The worker writes one line, `worker: Healthchecks.io check-in failed: <reason>`,
     and returns.
   - Graphile Worker therefore never retries a heartbeat job and never stamps the
     database twice.
   - The line never contains the ping URL. The adapter owns the URL, so the
     adapter guarantees that none of its errors carries it. Node's `fetch` can
     put the URL in an error message, for example when it cannot parse the URL.
   - The loud channel is Healthchecks.io's own alert for missing pings.
4. **Configuration: `HEALTHCHECKS_WORKER_URL`, read only by the worker process.**
   - If it is unset, empty or not an `https:` URL, the worker runs normally and
     writes one line at start saying it is not checking in, and why.
   - A monitoring setting must never stop the watchdog it watches, or put it in a
     crash loop.
   - *Refinement by this spec:* "not an `https:` URL" is added to "unset or empty".
     This way the secret is never sent in clear text.
   - *Correction to the brief:* missing pings make a wrong value loud **only once
     the check has received at least one ping**. A check whose URL was wrong from
     the start stays `new` and stays silent. Owner step 4 closes that gap before
     the drill.
5. **The build machine never checks in (BUG-3).** On `INSTANCE_TYPE=build`,
   `runWorkerProcess` starts nothing, so no heartbeat runs. A test keeps holding
   this.
6. **Terraform:**
   - A required, `sensitive` variable `healthchecks_worker_url` with no default,
     validated against `^https://hc-ping\.com/`.
   - It is mapped to `HEALTHCHECKS_WORKER_URL` in the app's `environment`.
   - `infra-staging.yml` passes `TF_VAR_healthchecks_worker_url` from the `staging`
     environment secret `HEALTHCHECKS_WORKER_URL`. It does so in **both** the plan
     job and the apply job, because the apply plans again and compares
     fingerprints.
7. **UptimeRobot** is set up by the owner by hand. No UptimeRobot key goes into CI.
   - It is a **keyword** monitor on `https://trygg-hverdag-staging.cleverapps.io/v1/health`.
   - It alerts when the keyword `"status":"ok"` is **missing**.
   - That catches both a dead API and a degraded system (API up, worker silent,
     D-065 items 2 and 5).
8. **The Healthchecks.io check has Period 1 minute and Grace 2 minutes.**
   - It goes down at most 3 minutes after the last ping. With alert delivery, that
     fits inside 5 minutes.
   - One late beat is tolerated.

Rules checked against this approach, with no conflict found: AR-02 (port, adapter,
fake), AR-03 (no clock read; the database beat keeps using database time, REL-01),
AR-10 (only `worker.ts`, `bin/` and tests import the adapter), D-016 (no new SDK,
and no personal data sent), and D-023.

## Acceptance criteria

**INF-08-AC1 — One check-in request, and only a 2xx counts.**
- **Given** the check-in adapter is set up with a ping URL, and a stand-in
  Healthchecks.io server is running
- **When** `checkIn()` is called
- **Then** it sends exactly one request, with no body, to that URL
- **And** it resolves when the answer is 2xx
- **And** it rejects, without retrying, when the answer is not 2xx (for example
  404, 429 or 500), when the connection fails, or when no answer arrives within
  10 seconds.

**INF-08-AC2 — A check-in only ever follows a recorded beat.**
- **Given** the worker is set up to check in
- **When** the heartbeat task runs and the database records the beat
- **Then** exactly one check-in is sent, after the beat has been recorded
- **And**, for any sequence of heartbeat runs, the number of check-ins equals the
  number of beats recorded, and each check-in follows its own beat.

**INF-08-AC3 — No beat, no check-in.**
- **Given** the worker is set up to check in
- **When** the heartbeat task runs and either reading the database time or
  recording the beat fails
- **Then** no check-in is sent
- **And** the task fails as it does today.

**INF-08-AC4 — A failed check-in does not fail the beat.**
- **Given** the worker is set up to check in, and the check-in fails (any failure
  in AC1)
- **When** the heartbeat task runs
- **Then** the beat is recorded exactly once
- **And** the task completes without an error
- **And** the worker writes exactly one line starting with
  `worker: Healthchecks.io check-in failed:`, followed by the reason.

**INF-08-AC5 — The ping URL is never written anywhere.**
- **Given** `HEALTHCHECKS_WORKER_URL` holds a synthetic ping URL
- **When** the worker starts, checks in, or fails to check in (including when the
  underlying error message contains the URL)
- **Then** nothing the worker writes contains the URL or its path.

**INF-08-AC6 — A missing or unusable setting never stops the worker.**
- **Given** `HEALTHCHECKS_WORKER_URL` is unset, empty or not an `https:` URL
- **When** the worker process starts on the machine that runs the app
- **Then** the runner starts and records the heartbeat every minute, as it does
  today
- **And** no check-in is ever sent
- **And** at start the worker writes exactly one line saying it is not checking in
  with Healthchecks.io and why. The line names the variable and never repeats its
  value.
- **And** the process does not exit or fail because of the setting.
- **Given** the value is a usable `https:` URL instead
- **Then** the start line says the worker is checking in, without the URL.

**INF-08-AC7 — The build machine never checks in (BUG-3).**
- **Given** `INSTANCE_TYPE=build` and a usable `HEALTHCHECKS_WORKER_URL`
- **When** the worker process starts
- **Then** no runner starts
- **And** no check-in is ever sent.

**INF-08-AC8 — Terraform requires the URL and keeps it secret.**
- **Given** the Terraform in `infra/staging`
- **When** `infra:check` runs and the infra tests read the files
- **Then** they find a variable `healthchecks_worker_url` with no default,
  `sensitive = true`, and a validation that refuses any value not starting with
  `https://hc-ping.com/`
- **And** the staging app's `environment` sets `HEALTHCHECKS_WORKER_URL` from that
  variable
- **And** `infra:check` passes (fmt, lock file, validate).

**INF-08-AC9 — Both staging workflow runs pass the URL, and nothing else reads it.**
- **Given** `.github/workflows/infra-staging.yml`
- **When** its `plan` job or its `apply` job runs
- **Then** each job sets `TF_VAR_healthchecks_worker_url` from the `staging`
  environment secret `HEALTHCHECKS_WORKER_URL`, in that job's own `env`
- **And** no other job or workflow reads that secret.

**INF-08-AC10 — The health body has UptimeRobot's keyword only when the system is healthy.**
- **Given** the API, and a worker that beat within `WORKER_STALE_AFTER_MS`
- **When** `GET /v1/health` is called
- **Then** the raw response text contains exactly `"status":"ok"`
- **And** it does **not** contain that text in these cases:
  - the worker has been silent past the threshold;
  - the worker has never beaten;
  - the health check cannot run at all (the 500 answer).

**INF-08-AC11 — The drill: a stopped worker pages the owner within 5 minutes.**
This is the done-criterion. It is a manual acceptance step carried out by the owner.
- **Given** owner steps 1–5 are done, the worker check shows up with a ping every
  minute, and the UptimeRobot monitor shows Up
- **When** the owner stops the staging app at a noted time T
- **Then** Healthchecks.io's alert for the worker check reaches the owner's phone
  no later than T + 5 minutes
- **And** UptimeRobot's alert reaches the phone. Its time is recorded but not held
  to 5 minutes, because Free checks every 5 minutes (D-079).
- **And** when the app is started again, both monitors return to up
- **And** the times are recorded in `docs/progress.md`.

## Test plan

| AC | Level | Where | How |
|----|-------|-------|-----|
| AC1 | L2 | `apps/server/src/adapters/healthchecks.test.ts` (new) | A stand-in server on the loopback address, or an injected `fetch`. The timeout is injected short. |
| AC2 | L2 | `apps/server/src/worker.test.ts` | Recording fakes from the test kit record the order of events. A fast-check property runs over sequences of beat outcomes (an ordering rule). |
| AC3 | L2 | `worker.test.ts` | A failing clock and failing heartbeats fakes. Also, the existing test that wires the heartbeat to an unreachable database asserts zero check-ins. |
| AC4 | L2 | `worker.test.ts` | A failing check-in fake, with the written output captured. |
| AC5 | L2 | `healthchecks.test.ts`, `worker.test.ts` | An underlying error whose message contains the URL. The test asserts that neither the URL nor its path appears. |
| AC6 | L2 | `config.test.ts`, `worker.test.ts` (`runWorkerProcess`); optionally `bin/bin.test.ts` (real process) | Unset, empty, `http:` and non-URL values. Asserts the runner started and nothing exited. |
| AC7 | L2 | `worker.test.ts`, next to the BUG-3 tests | A recording check-in fake shows zero calls. |
| AC8 | L1 + L2 | `infra:check` in `gate:static`; `scripts/infra.test.mjs` | Reads `variables.tf` and `main.tf`. |
| AC9 | L2 | `scripts/staging-workflows.test.mjs` | Reads both jobs' `env` and scans every workflow for the secret. |
| AC10 | L6 | `apps/server/src/api.system.test.ts` | The real router and serialisation, a fake clock, and `response.text()`. |
| AC11 | Manual acceptance | Owner steps 6–7 | See below. |

- **No L3, L4, L5 or L7 tests.**
  - L3: there is no new SQL, and the task already has its real database wiring
    held at L2.
  - L4: `api:diff` runs as always and must show no difference.
  - L5 and L7: the app is not touched.
- **Why AC11 cannot be automated.** The drill needs three things no session or CI
  run has:
  - the Clever Cloud key, which is limited to `main` through the `staging`
    environment (D-077 item 7);
  - a started workflow run, and sessions may not start runs (D-077 item 6);
  - the owner's phone, which only the owner can see.
  Sessions also cannot reach `api.clever-cloud.com` or `hc-ping.com`
  (`docs/plan/cloud-environment.md`; for `hc-ping.com`, checked on 2026-09-25:
  the session's proxy refuses the connection with 403).
- **Test names** start with `INF-08-ACn:`.
  - `req:coverage` tracks REL-08, not INF-08. So the files holding AC1–AC5 and
    AC10 also name REL-08.
  - Without that, CI's RG-01 gate fails on this branch, because this spec names
    REL-08.
  - Committing this spec changes REL-08's row in `docs/requirements-status.md`;
    regenerate it with `pnpm run req:coverage`.
  - This spec deliberately names no other tracked requirement that has no test,
    because RG-01 reads a spec's text as a claim.
- **Test data is synthetic** (RG-07). Ping URLs use an all-zero UUID or the
  loopback address. **No test ever sends a request to `hc-ping.com`**: a ping from
  a test would tell a real check that the worker is alive.
- **Mutation.** `worker.ts` and `bin/worker.ts` are safety paths, so Stryker runs
  on them (D-036). The AC2–AC7 tests must kill the mutants there.

## Modules and files affected

| File | Change | Safety path | CODEOWNERS |
|------|--------|:-----------:|:----------:|
| `apps/server/src/worker.ts` | The heartbeat task checks in after a recorded beat; wiring; start line | **yes** | **yes** |
| `apps/server/src/bin/worker.ts` | Passes `HEALTHCHECKS_WORKER_URL` in | **yes** | **yes** |
| `apps/server/src/ports.ts` | New `CheckIn` port | no | no |
| `apps/server/src/adapters/healthchecks.ts` (new; the name is a suggestion) | The `fetch` adapter | no | no |
| `apps/server/src/config.ts` | Reads the setting. Never throws, unlike `readServerConfig` | no | no |
| `packages/test-kit/src/fake-check-in.ts` (new), `index.ts` | Recording fake | no | no |
| `apps/server/src/*.test.ts`, `bin/bin.test.ts`, `api.system.test.ts` | Tests (test-author) | — | no |
| `infra/staging/variables.tf`, `infra/staging/main.tf` | Variable and environment entry | no | **yes** (`/infra/`) |
| `.github/workflows/infra-staging.yml` | `TF_VAR_…` in both jobs | no | **yes** (`/.github/`) |
| `scripts/infra.test.mjs`, `scripts/staging-workflows.test.mjs` | Tests | no | **yes** (`/scripts/`) |
| `docs/plan/staging-setup.md`, `docs/plan/README.md`, `docs/progress.md`, `docs/requirements-status.md` | Owner steps, to-dos, drill result, regenerated report | no | no |
| `docs/plan/decisions.md` | D-079 (plan-keeper) | no | **yes** |

- **Expected to be unchanged:**
  - `process.ts` (a safety path), `redact.ts`, `api.ts`, `api-process.ts` and
    `bin/api.ts`. The API never reads the variable, even though Clever Cloud gives
    it to both processes.
  - `deploy-staging.yml`, and `ai-review.yml` (D-075).
  - `scripts/lib/gate-decisions.mjs`'s `SAFETY_PATHS`.
- **Why the adapter is not a safety path.** A broken adapter can only fail to
  ping, and a check that stops getting pings pages. The dangerous mistake would be
  a ping without a beat, and that ordering lives in `worker.ts`, which is already
  a safety path.

## Contract changes

**None.** `packages/contracts` is untouched, and the `/v1/health` schema and body
are unchanged. AC10 adds an assertion on the bytes the API already sends, not a
new field. `api:diff` must report no difference, and nothing is added under
`released/`.

## Risks and failure modes

- **F7, the server or watchdog is down.** This task is F7's owner alert.
  - Healthchecks.io covers the worker. UptimeRobot covers the API, plus the worker
    through `degraded`, as a second and slower path (up to 3 minutes stale plus up
    to 5 minutes between checks).
  - Stopping the whole app in the drill does **not** exercise UptimeRobot's
    `degraded` path live. AC10 holds that path, and so does the keyword the owner
    configures.
- **A check that has never been pinged stays `new` and never pages.** A wrong
  URL or UUID from day one is therefore silent.
  - Terraform catches a wrong host.
  - The worker writes a failure line every minute, but only into Clever Cloud's
    log.
  - **Owner step 4 is the real guard:** confirm pings are arriving before relying
    on the check. This is also true between merge and apply, while the variable
    is unset (AC6).
- **A leaked ping URL masks a failure.** Anyone holding it can keep the check
  green while the worker is dead. It is guarded as follows:
  - It lives only in the `staging` environment, which is limited to `main`, and
    in Clever Cloud's environment. It is `sensitive` in Terraform, and the
    provider hides `environment`.
  - The worker never writes it (AC5).
  - The deploy log carries variable names only (D-077, verified).
  - Sessions cannot reach `hc-ping.com`.
  - This is secret handling in the sense of SEC-03.
  - **If it leaks:** create a new check, replace the secret, run plan and apply,
    then delete the old check.
- **UptimeRobot's 5-minute gap (D-079).** On staging, a failure of the API alone
  may reach the owner later than 5 minutes. Buying Solo is the M5 gate that
  closes this.
- **Healthchecks.io itself is down, or its alert is lost.** Then a stopped worker
  does not page through Healthchecks.io. UptimeRobot's keyword is the backup.
  Nothing watches the two monitors themselves; that risk is accepted. The drill
  is also the first proof that a Healthchecks.io alert reaches the phone at all:
  A-16's check has been pinged but has never gone down.
- **Deploy or restart gap versus Grace.** Any window longer than 3 minutes with no
  worker pinging pages the owner **falsely**. Such windows come from a deploy, or
  from an apply that restarts staging.
  - The old instance's worker usually overlaps the new one (D-077 item 13), and
    the build machine never pings.
  - If a deploy ever pages, it is recorded as a bug. Grace is not widened past
    the 5-minute budget, and a monitor that cries wolf gets muted (D-065 item 5).
- **The keyword drifts.** If a serialisation change blinds UptimeRobot or trips it,
  AC10 catches it. A keyword that stops matching fails loudly (the monitor shows
  Down). The dangerous direction is a `degraded` body that still matches, and AC10
  holds that too.
- **A slow Healthchecks.io** holds one of the worker's two concurrency slots for
  up to 10 seconds a minute. That is fine today; revisit it when the watchdog
  shares the worker.
- **Rate limit.** One ping a minute, or two during a deploy overlap, stays under
  Healthchecks.io's five.
- **Data.** The ping carries no body, and the health body holds timestamps only.
  No personal data goes to either monitor, and both services are EU-based
  (Section 8, §4).
- **A green report is not a passed drill.** REL-08 shows as covered in
  `requirements-status.md` once a test names it. INF-08 is done only when the
  drill result is recorded.

## Owner steps

Only the owner can do these: they hold keys, start runs, or look at the phone.
plan-keeper will number them as to-dos next to A-08.

1. **Healthchecks.io.** Add a check for the staging worker (for example
   `staging-worker`) with **Period 1 minute** and **Grace 2 minutes**. Point its
   alerts at the same channel that pages you for `daily-status` (A-16). Copy its
   ping URL. About 2 minutes. Cost $0 (2 of 20 checks).
2. **GitHub.** Settings → Environments → `staging` → add an **environment secret**
   (not a repository secret) named `HEALTHCHECKS_WORKER_URL`, holding that ping URL.
   Do this before the next `infra-staging` plan: from this merge on, a plan without
   the secret fails.
3. **After the INF-08 pull request merges** and its deploy is green, run
   `infra-staging` with `plan`, then with `apply`.
   - The summary will show the app's `environment` changing, with its values
     hidden. That change is this task.
   - The apply restarts staging with the new setting (provider 2.2.1).
4. **Within about 2 minutes, confirm the check is alive.** In Healthchecks.io it
   should have left `new` and show a ping every minute. If it stays `new`, stop
   here and tell Claude: a `new` check never pages.
5. **UptimeRobot.**
   - Install the mobile app and turn its notifications on.
   - Add a **Keyword** monitor for
     `https://trygg-hverdag-staging.cleverapps.io/v1/health`, with the keyword
     `"status":"ok"` (quotes included). Set it to alert when the keyword is
     **missing**, with the 5-minute interval (Free).
   - Send its alerts to the mobile app. Confirm it shows **Up**.
   - Cost $0. The exact wording of UptimeRobot's options was not checked from a
     session.
6. **The drill (AC11).**
   - Note the time T.
   - Stop the staging app `trygg-hverdag-staging`: in the Clever Cloud Console
     (the button's wording is not verified), or with `clever stop` on your own
     computer.
   - Write down when each monitor's alert reaches your phone.
   - Start the app again, from the Console or by running `deploy-staging` by hand.
     Write down when both monitors show up again.
   - Stopping the app stops the worker. Pings come only from the worker, so this is
     exactly the path a stop of the worker alone would take.
7. **Send Claude the five times**: T, the two alert times and the two recovery
   times.
   - **Pass:** Healthchecks.io's alert came by T + 5 minutes, UptimeRobot alerted,
     and both recovered.
   - Claude records the result in `docs/progress.md`. A miss is a BUG, and INF-08
     is not done.

## Out of scope

- The canary journey and its own Healthchecks.io check (Section 8, §4; M2).
- Buying UptimeRobot Solo (the M5 go-live gate, D-079).
- Monitors managed by Terraform or by an API. There is no UptimeRobot or
  Healthchecks.io key in CI.
- The watchdog itself (M2), and whether its sweep, not just the beat, should
  decide the check-in.
- Telling walkers the safety service is unavailable (F7's other half).
- Production monitoring, which is created at go-live (D-046).
- SMS or phone-call alerts (Healthchecks.io Business), and monitoring the monitors.
- These D-077 follow-ups:
  - a heartbeat that names its worker;
  - redacting Graphile Worker's own log output.
- Deleting the old `trygghverdag-staging` app and database.

## Questions for the owner

None that block INF-08. One for go-live, recorded rather than asked now:

1. **Healthchecks.io's plan at go-live (cost).**
   - Section 8 recorded, from a secondary source, that Healthchecks.io is "free
     for hobby projects and paid for commercial use", and budgeted $0–20 a month.
   - Checked on 2026-09-25 against Healthchecks.io's own pages:
     - the terms (`healthchecks.io/terms`) say nothing about commercial use;
     - the FAQ (`healthchecks.io/docs/faq`) gives, as an allowed example, "a
       Hobbyist account with 20 checks for monitoring your company
       infrastructure";
     - the About page says it "is free for hobby use, for open source projects,
       and for non-profits" — a statement of intent, not a term.
   - So company use of Hobbyist within 20 checks is allowed by the FAQ, and
     nothing requires a paid plan for staging. Section 8's claim does not hold as
     written.
   - **Recommendation:** stay on Hobbyist. At go-live, decide whether the AS
     should pay for Business ($20 a month) for its SMS and phone-call alerts,
     which Hobbyist lacks, next to UptimeRobot Solo (D-079).
