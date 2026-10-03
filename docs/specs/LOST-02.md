# LOST-02 · Lost-contact alert: every responder told once, five minutes into a silence, by a watchdog that cannot stop unnoticed

**Milestone:** M2, task 3 of 8 (D-090) · **Delivers:** LOST-02 (its server
half); AR-05 and AR-06, untracked; the bound on LOST-01's row lock; D-079's
two watchdog follow-ups; D-068's pool revisit · **Decisions:** D-007, D-019,
D-021, D-031, D-032, D-033, D-036, D-042, D-065, D-068, D-075, D-079, D-086,
D-087, D-089, D-090, D-091, D-092, D-095, D-098, D-099, D-100, D-101, D-102,
D-105, D-106, D-107, D-108 · **Written:** 2026-10-03, on `main` at `fe384c5`
(LOST-01 merged) · **Finalised:** 2026-10-03, with the owner's answers: D-106,
D-107, and BUG-18's D-105 for `adapters/db.ts` ("Answered by the owner", at
the end of this file) · **Status:** 📝 Spec, settled. **Merges only after
BUG-18** (D-105: `adapters/db.ts` under the owner and the safety review).

## Requirement

### The rule this task delivers

**LOST-02** (`docs/plan/01b-mvp-scope.md`, LOST section, Must):

> - If the server gets no heartbeat for 5 minutes (D-021), every responder on
>   the journey is alerted with the last known position, time and battery
>   level, plus the guidance in [the what-to-do story].
> - It works even if the phone is off, broken or out of coverage, because the
>   server decides, not the phone.
> - **The most important test in the project:** start a journey, silence the
>   simulated phone, advance time, and assert that every responder was
>   alerted.

The story's text names the what-to-do story by its ID. It is replaced by a
name here, for the reason under "How this spec names requirements".

### The owner's scope (D-090, item 3, and the roadmap)

D-090, item 3 (accepted by the owner, 2026-10-01):

> **LOST-02 — Lost-contact alert.** Watchdog every 10–15 s (AR-06, REL-01);
> alert and push in one transaction (AR-05); a recording push fake; "the most
> important test" at L6; D-079's watchdog check-in follow-ups and D-068's
> pool-lifecycle revisit.

`docs/plan/10-roadmap.md`, "M2 — Core safety loop in detail", row 3, **done
when:**

> "The most important test" passes at L6 against a recording push fake

### What D-033 and the design principles fixed

The transition (`05-architecture.md`, journey state machine, binding under
D-033):

> | ACTIVE | Watchdog: no heartbeat for 5 min (D-021) | LOST_CONTACT | Open an
> alert; push to responders (LOST-02) |

Alert states (same section): `OPEN` → `ESCALATED` → `ACKNOWLEDGED` →
`RESOLVED`. This task opens alerts in `OPEN` only. The other three belong to
tasks 4 to 7.

**AR-05:** "**Transactional outbox:** a state change and the messages it
causes (push, SMS) are saved in the same database transaction. A sender
process delivers them with retries. *Why:* A crash or restart can never lose
an alert."

**AR-06:** "**Idempotent, lock-safe watchdog:** it runs every ⚙️ 10–15
seconds and locks the overdue journeys it picks, skipping rows another worker
already holds. *Why:* Running it twice, or on two workers, is harmless."

### Inputs this spec builds on

- **D-021:** "Responders are alerted when the server has heard nothing from a
  journey for 5 minutes." Changing it needs the owner.
- **D-007:** "The lost-contact end-to-end test is the most important test in
  the project."
- **D-019:** the alert "goes out as a push notification". SMS after 2 minutes
  without an acknowledgement is task 6's.
- **REL-01** (binding, D-022): "The lost-contact decision is made by the
  server, using the server's clock, never the phone's." **AR-03:** domain code
  never reads the clock.
- **The reliability target** (`03-safety-reliability-security.md`, binding
  under D-022): "responders alerted within the lost-contact threshold plus 60
  seconds in at least 99 % of cases, measured by the canary ([the canary
  rule])". That 60 s is the budget the watchdog's timing must fit (approach
  item 7).
- **REL-08** (binding): "External uptime monitoring checks the API and the
  watchdog every minute and alerts the owner within ⚙️ 5 minutes of a
  failure."
- **Content-free push** (`04-tech-stack.md`, finding 4, accepted under D-086:
  "straight from our server to APNs and FCM, with content-free payloads"):
  "Push messages carry no personal data: 'Safety alert — open the app'. The
  app fetches the details from our EEA server."
- **D-087** settled that only the lost-contact alert uses the critical level,
  and listed tests M3 owes. Two of them start here, for this first message
  type: "exactly one lost-contact message per responder per event, across …
  the watchdog run twice … with an opaque, per-message collapse ID, never a
  walker, user or journey ID", and "no push carries personal details in its
  payload".
- **D-065, item 4:** the worker proves it is alive by writing one row,
  `worker_heartbeat`, "the row the watchdog keeps" (`db/schema.ts`). Today a
  minute cron task writes it, whatever any sweep does.
- **D-079's follow-ups, quoted** ("for M2, where the watchdog task will find
  them"):
  > - The check-in follows the **heartbeat**, not the watchdog's sweep. Once
  >   the watchdog runs in the worker, a broken sweep beside a healthy
  >   heartbeat is a ping saying a dead watchdog is alive. The watchdog's task
  >   must decide whether it checks in, or feeds the beat.
  > - A slow Healthchecks.io holds one of the worker's two concurrency slots
  >   for up to 10 seconds a minute, and delays a stop by as much (measured by
  >   `safety-reviewer`: exit 6.8 s after SIGTERM during a hung check-in).
  >   Graphile's `helpers.abortSignal` could cancel the ping on stop.
- **D-068, quoted:** "Whoever writes that handler logs a chosen message, never
  the error object, and a test should assert the connection string does not
  appear in what is logged." And: "revisit this before the worker carries
  journey state, not merely if churn is observed." From this task it does.
- **SM-01's spec, risks:** "a responder who exists but cannot be reached — no
  device, no push token — still counts. … task 3 must make a push with no
  target fail loudly, not count it as sent."

### Inherited from LOST-01, binding on this task

From LOST-01's `safety-reviewer` and `docs/progress/m2.md` ("Left for later
tasks"). Each is met here, and the criterion that proves it is named.

1. **The heartbeat's row lock is bounded before this task merges.** Met by
   approach item 7: `idle_in_transaction_session_timeout` of 10 s on the API's
   pool and the worker's, and `lock_timeout` of 5 s on the API's. A journey
   that something else holds anyway is reported, and stops the beat (approach
   item 6). Proved by LOST-02-AC17 and LOST-02-AC20 (L3). The limits are
   wired in `adapters/db.ts`, which BUG-18 puts under the owner and the
   safety review first (D-105).
2. **An L3 race that proves the lock's effect** (a heartbeat waits for an
   uncommitted ENDED, then answers `ended` and stores nothing). No code ends a
   journey before task 4, but the test needs none: it ends the journey itself,
   in a transaction of its own that it holds open, as LOST-01-AC7 already puts
   `ENDED` in directly. Proved by LOST-02-AC11.
3. **A pool `error` listener (D-068).** Checked where pools are made:
   `createPool` in `adapters/db.ts` is called by `api-process.ts` (the API's
   pool), `worker.ts` (the worker's), `adapters/migrations.ts` (the deploy's
   one-connection pool) and the L3 tests. Neither process pool has a listener
   today. The worker's warning is graphile-worker's: read, not run, in
   `graphile-worker` 0.18.0, `dist/lib.js` lines 197–205: a pool handed in
   with no `error` listener gets "Your pool doesn't have error handlers!" on
   `console.warn`, and a second warning for no `connect` listener. It then
   installs its own handlers, which log the error's message (lines 232–270),
   which is what D-068 forbids. Met by approach item 8: both process pools get
   `error` and `connect` listeners at creation, before graphile-worker sees
   the pool. Proved by LOST-02-AC18.
4. **The clock and the log.** The silence is measured with the database's
   `now()`, taken in the statement that reads it (approach item 11). The
   modules read no clock (lint, since D-092). Five new closed log events, and
   no free field (approach item 10). Proved by LOST-02-AC4 and LOST-02-AC22.

### What the reviewers left for this task (`docs/progress/m2.md`)

From SM-01's reviews, "Task 3 — LOST-02, the lost-contact alert":

| Left for task 3 | Where it is met |
|---|---|
| Count silence from `coalesce(last_heartbeat_at, started_at)`, with tests for a journey that never sent a heartbeat | Approach item 3; LOST-02-AC3 |
| Put the from-state in the `WHERE`, check the row count, write the outbox rows only when a row changed | Approach item 3; LOST-02-AC9 |
| Use `FOR UPDATE SKIP LOCKED` | Approach item 3; LOST-02-AC8 |
| Compare against `now()` in the same statement (AR-03) | Approach item 11; LOST-02-AC4 |
| D-079's watchdog check-in follow-ups, D-068's pool-lifecycle revisit | Approach items 6, 8 and 9; LOST-02-AC18, AC19 and AC21 |

From LOST-01's spec, approach item 9, ready for this task: `last_heartbeat_at`
in database time, the row lock every heartbeat takes, `latestHeartbeatOf`, the
`Log` port, and the `LOST_CONTACT` heartbeat row (task 4 changes it).

### Readings this spec makes

Each is stated so the reviewers can check it, not assumed quietly.

1. **"No heartbeat for 5 minutes"** means: by the database clock, at least
   5 minutes have passed since the journey's last contact, or since its start
   if it has none. Last contact is `last_heartbeat_at`, which LOST-01 moves
   only for a stored heartbeat. A duplicate, a refused heartbeat (400, 403,
   404, 409) and a request that never arrived do not move it. "At least" is
   the rule: exactly 5:00 alerts, 4:59.999 does not (`06-testing-strategy.md`
   calls the correct rule "silent for 5 minutes **or more**").
2. **"Every responder on the journey is alerted"** means, in this task: one
   lost-contact message for each responder stored with the journey
   (`journey_responders`), written in the same transaction as the move to
   `LOST_CONTACT`, and handed to the push port until the port accepts it.
   Nobody else gets one, the walker included.
3. **"Alerted" ends at the push port.** The recording fake stands in for
   APNs and FCM. The real adapter is M3's (A-11 brings the Firebase project and
   Apple's push key). Until then the worker's push answers "not configured" to
   every message, and no message counts as sent (approach item 5).
4. **"With the last known position, time and battery level."** The push
   carries none of them: it is content-free (D-086). The app reads them over
   the API. This task stores what that read needs: the alert's `silent_since`
   is the time of last contact, and the heartbeat received then (LOST-01's
   `heartbeats` and `positions`) holds the battery level and the position, if
   there is one. **The route a responder's app reads them through is built
   in M3, with the alert screen (D-106, the owner's answer).** This spec
   builds no route.
5. **"Plus the guidance"** is app text, in translation files, bokmål first
   (D-014). Its story is in M3's roadmap row. The server sends no text at all.
6. **"Works even if the phone is off"** is what the watchdog is: it runs in
   the worker, on the database's clock, and needs nothing from the phone. The
   most important test (LOST-02-AC1) silences the phone completely: no
   request of any kind after the last heartbeat.
7. **Once per silence.** A journey moves `ACTIVE` → `LOST_CONTACT` once, and
   opens one alert. A journey already in `LOST_CONTACT` is never alerted again
   by the watchdog, and a heartbeat does not move it back (LOST-01's reading 7;
   task 4 does).
8. **The notification level** (critical on iOS where Apple allows it, the
   high-priority channel on Android) is the push adapter's mapping from the
   message's kind, in M3 (D-087). The server says what kind of message it is,
   not how loud.

### How this spec names requirements, and why

The `traceability` job runs `req:coverage --fail-on-uncovered-changed`. It
fails if a changed spec names a tracked requirement that no test names, or an
acceptance criterion that no test names (`scripts/lib/requirements.mjs`:
`mentions`, `uncoveredInChanges`, `uncoveredCriteria`). Read in the code on
2026-10-03; not run, because this session writes one file only.
`docs/requirements-status.md` was read at `fe384c5`: 13 of 63 live
requirements have a test.

- **Delivered here, and must be named by a test:** LOST-02 (⚪ today).
- **Cited, already covered, and not claimed:** LOST-01 (13 tests), SM-01 (9),
  SM-02 (4), SM-03 (2), SM-07 (3), SM-08 (2), SM-09 (2), REL-01 (7), REL-08
  (4), SEC-03 (5), SEC-06 (1), SEC-07 (7), PRIV-07 (5). Naming them cannot
  fail the gate. Several criteria here strengthen them, and their tests name
  them too (test plan).
- **Untracked, named freely:** AR-, D-, F-, RG-, INF-, BUG-, A- and L- IDs
  (D-074).
- **Every other tracked requirement is named in words.** None has a test, so
  naming one would read to RG-01 as a claim to deliver it (the live gotcha in
  `docs/progress.md`). The same rule binds product code and its comments.

| Name used here | Where it lives |
|---|---|
| the what-to-do story (the guidance) | `01b-mvp-scope.md`, HELP section, 1st story (M3) |
| the back-in-contact story | LOST section, 3rd story (task 4) |
| the low-battery story | LOST section, 4th story (M3) |
| "I'm on it", escalation to SMS, "They're safe" | LOST section, 6th, 7th and 8th stories (tasks 5, 6 and 7) |
| the start-and-end story | JRN section, 4th story (M3) |
| the login task | GRP section, 1st story (M3) |
| the responder-setup story | GRP section, 4th story (M3) |
| the canary rule | `03-safety-reliability-security.md`, reliability table, 10th row (task 8) |
| the responders-only rule, the retention rule | `02-norway-law-privacy.md`, privacy table, 3rd and 4th rows |
| the two-hour rule, the 24-hour rule, the resumed-escalation rule | `05-architecture.md`, edge-case rules, 5th, 6th and 10th rows |

**Partial delivery shows as full.** Once a test names LOST-02, its row turns
🟢. These halves remain, and "Out of scope" lists each: the read of the last
known position, time and battery (M3, D-106); the guidance; the real push
and its level (M3); acknowledgement and SMS (tasks 5 and 6); back in contact
(task 4).

## Approach (technical choices delegated to Claude, D-031)

1. **Where the code goes, and why there.**
   - **The rule:** `domain/journey.ts` gains the `silence` event. A new
     `domain/watchdog.ts` holds the watchdog's timing and the budget it must
     fit. Both are owned, filtered and mutation-tested (`domain`).
   - **The sweep and the sender:** two new files in `modules/alerts/`.
     That folder has waited for them since M0: it is already in CODEOWNERS,
     `OWNER_APPROVAL_PATHS`, the ai-review `safety` filter, `SAFETY_PATHS` and
     `CLOCK_FREE_PATHS`. Its first file makes
     `scripts/lib/gate-decisions.test.mjs` ("no safety file that exists today
     falls to the whole-suite run", line 623) fail until it has a mutation
     group. That is D-098's design. So this task adds an `alerts` group (the
     Mutation section).
   - **The SQL:** `adapters/journeys.ts`. The move to `LOST_CONTACT`, the
     alert and its messages are one transaction over `journeys`, so they
     belong with the journey store. A new adapter file would need no owner.
     Owning it would need the `safety` filter too (`scripts/gate.test.mjs`,
     D-102's amendment), and so an `ai-review.yml` edit and a hand merge
     (D-075). `adapters/journeys.ts` already has both.
   - **The loops, the beat and the default push:** `worker.ts` (owned,
     filtered, mutation group `process`). The loops keep time with
     `setTimeout`. The lint rule forbids that in `modules/` and `domain/`,
     and not in `worker.ts`. Every due time stays in the database, so a
     restart loses nothing.
   - **Pool settings and listeners:** `adapters/db.ts`, with the values
     taken from `domain/watchdog.ts`. `api-process.ts` and `worker.ts` pass
     them in. `db.ts` will hold the lock bound, a safety control, so the
     owner made it owned and safety-reviewed (D-105). That is done in its own
     pull request, BUG-18, which edits `ai-review.yml` and is merged by hand
     (D-075). **This pull request must not merge before BUG-18 does.** If
     BUG-18 is still open when this one is ready, this one waits.

2. **The rule (`domain/journey.ts`).**
   - `LOST_CONTACT_AFTER_MS = 300_000` (D-021).
   - `JOURNEY_EVENTS` becomes `['start', 'heartbeat', 'silence']`. The
     silence event is `{ type: 'silence', silentSince, now }`, both database
     times read by the store.
   - The outcome for an `ACTIVE` journey, when `now − silentSince ≥
     LOST_CONTACT_AFTER_MS`, is `{ type: 'lost_contact', state:
     'LOST_CONTACT', alert: 'OPEN' }`. Every other situation answers `{ type:
     'unchanged' }`: `ACTIVE` under the threshold, `LOST_CONTACT`, `ENDED`
     and no journey.
   - `ALERT_STATES = ['OPEN', 'ESCALATED', 'ACKNOWLEDGED', 'RESOLVED']`
     (D-033), as `JOURNEY_STATES` lists the journey states. The database's
     enum must equal it (LOST-02-AC23).
   - Pure, total, and no clock. The `switch` and its `never` default, which
     LOST-01 restored, make a missing case a type error.

3. **The sweep (`modules/alerts/watchdog.ts`, SQL in `adapters/journeys.ts`).**
   One sweep:
   1. **Read the overdue journeys, without locking.** One statement returns
      the `ACTIVE` journeys whose `coalesce(last_heartbeat_at, started_at)`
      is at or before `now() − LOST_CONTACT_AFTER_MS`, with each one's
      `silent_since` and the database's `now()` from that same statement.
      `now()` comes back even when no journey is overdue, because the beat
      needs it.
   2. **Ask the domain about each one.** Only a `lost_contact` outcome goes
      on.
   3. **Open each journey's alert in its own transaction**, so one journey's
      failure holds up no other:
      1. `select … where id = $1 and state = 'ACTIVE' and coalesce(…) <=
         now() − threshold for update skip locked`. No row means **skipped**:
         another transaction holds it (a heartbeat being written, another
         worker's sweep, anything else), or it is no longer overdue (contact
         arrived, or its state changed). The silence is checked again under
         the lock, so a heartbeat committed after step 1 wins.
      2. `update journeys set state = 'LOST_CONTACT' where id = $1 and state
         = 'ACTIVE'`. It must change exactly one row, or the transaction is
         rolled back.
      3. Insert the alert: `OPEN`, `opened_at = now()`, and `silent_since`
         from step 3.1.
      4. Insert one outbox row per row of `journey_responders`, each with a
         new random UUID as its message ID. **At least one row, or the
         transaction is rolled back.** A journey with nobody to tell is never
         moved quietly. The start rule makes this unreachable today; if it
         ever happens, the journey stays `ACTIVE` and overdue, and item 6
         turns it into a page.
      5. Commit.
   4. **Record the beat, if the sweep succeeded** (item 6).
   - Any database error is logged as `watchdog_failed`, with the stage and
     the SQLSTATE only. The sweep carries on with the next journey and counts
     as failed.
   - **Row locking:** a heartbeat in flight holds the row for milliseconds,
     so the sweep skips it, and the heartbeat moves last contact forward. A
     sweep that holds the row makes a heartbeat wait, and the heartbeat is
     then stored against `LOST_CONTACT` (LOST-01-AC8).

4. **The tables** (migration `0003_*.sql`, generated by `drizzle-kit` and
   committed; additive):

   | Table | Columns | Constraints |
   |---|---|---|
   | `alerts` (new) | `id` (uuid), `journey_id`, `state` (enum `alert_state`, exactly `ALERT_STATES`), `opened_at` and `silent_since` (database time) | `journey_id` references `journeys`; **one alert per journey that is not `RESOLVED`** (a partial unique index on `journey_id`, predicate `state <> 'RESOLVED'`, written once as SM-01's `unended` is) |
   | `outbox` (new) | `id` (uuid: the message ID, opaque), `alert_id`, `recipient_id`, `kind` (enum, `LOST_CONTACT` only for now), `created_at`, `attempts`, `next_attempt_at` (database time), `sent_at` (null until accepted), `last_failure` (null, or one of the push port's reasons) | `alert_id` references `alerts`; `recipient_id` references `users`; **unique (`alert_id`, `recipient_id`, `kind`)**; `attempts ≥ 0`; `last_failure` in the closed set |

   - **No location, no phone number, no name** in either table. Coordinates
     stay in `positions` alone (LOST-01-AC18's scan covers the new tables).
   - **No index for the watchdog's read.** At the private group's scale, a
     dozen or so journeys at most, a scan is cheaper than an index to keep.
     Revisit with L10's numbers.
   - The migration changes no existing row and is safe with journeys present.
     Unlike `0002`, it has nothing to guess.

5. **Delivery (`modules/alerts/outbox.ts`, the `Push` port).**
   - **The port:** `send({ messageId, recipientId, kind })` answers `{
     outcome: 'accepted' }` or `{ outcome: 'failed', reason }`, where
     `reason` is `NO_TARGET`, `REFUSED`, `UNAVAILABLE` or `NOT_CONFIGURED`. A
     thrown error counts as `UNAVAILABLE`. `recipientId` is for the adapter to
     find the device; it is never sent to Apple or Google. **The message
     carries no personal detail**: no name, journey, position, battery or
     time (D-086). `messageId` is a fresh random UUID per message, never a
     user's, walker's, journey's or alert's ID (D-087). M3's adapter uses it
     as the collapse ID, which makes a resend show once.
   - **Claim, send, mark,** with no network call inside a transaction:
     1. **Claim** in one statement: the due messages (`sent_at is null and
        next_attempt_at <= now()`), `for update skip locked`, at most ⚙️ 50.
        Add one to `attempts`, and set `next_attempt_at = now() +` a lease of
        ⚙️ 30 s.
     2. **Send** each, outside any transaction.
     3. **Mark** it: `sent_at = now()` when accepted. Otherwise set
        `last_failure` to the reason and `next_attempt_at = now() +
        retryDelayMs(attempts)`, which is ⚙️ 10 s, doubling, capped at 60 s.
        Write one `push_failed` line.
   - **At least once.** A sender that stops between send and mark sends
     again once the lease has passed, with the same message ID. The platform
     collapses the repeat. A message is never counted as sent unless the port
     accepted it (SM-01's note).
   - **No push in a transaction.** That is also what keeps the idle limit
     (item 7) from ending a delivery, whatever a provider's latency.
   - **Retries go on while the alert is open.** Stopping them when an alert
     resolves is task 4's.
   - **The worker's push, until M3:** a constant in `worker.ts`, not a new
     adapter file, that answers `NOT_CONFIGURED` to every message. The worker
     says once at start, on stderr as it says the Healthchecks.io setting,
     that no push provider is configured. A default that answered `accepted`
     would be the silent miss SM-01's spec warned of. In `worker.ts` that
     default is owned and mutation-tested. In a new file it would be neither.

6. **The beat, and a journey the watchdog cannot move** (D-079's first
   follow-up; REL-08; F7).
   - **The watchdog feeds the beat.** This is the second of D-079's two
     options. A sweep that succeeds records the worker beat, at the `now()`
     its read returned. A sweep fails when any of these happens:
     - its read fails;
     - an alert fails to open;
     - it finds a stuck journey (below).
   - **A failed sweep records no beat.** The minute cron task no longer
     writes the beat. It checks in with Healthchecks.io only when the beat is
     at most ⚙️ 30 s old (`BEAT_FRESH_MS`, three sweeps) by the database
     clock. Otherwise it writes one line saying it did not check in, and why.
     `/v1/health` keeps its rule: degraded after 3 minutes without a beat
     (D-065). So a watchdog that cannot sweep pages the owner through the
     monitors that exist now (D-079).
   - **A stuck journey** is an `ACTIVE` journey still overdue ⚙️ 30 s past
     the 5 minutes (`STUCK_AFTER_MS`) that this sweep did not move: it was
     skipped, or opening it failed. Each one gets a `watchdog_overdue` line
     naming its ID. So `skip locked` can skip a journey, but **not
     silently**: a lock this code does not control has the same effect. Two
     examples are a person's `psql` session and a frozen process with no
     limit. The sweep counts as failed, the beat stops, and the owner is
     paged.
   - **Why 30 s:** it is more than one interval plus the idle limit (10 +
     10 s), so a stall the limit already ends never pages anyone. And it is
     well inside the 60 s budget.

7. **The lock is bounded** (inherited item 1).
   - **Settings, values and pools:**

     | Pool | `idle_in_transaction_session_timeout` | `lock_timeout` |
     |---|---|---|
     | API (`api-process.ts`) | ⚙️ 10 s | ⚙️ 5 s |
     | Worker (`worker.ts`) | ⚙️ 10 s | none |
     | Migrations (`adapters/migrations.ts`) | unchanged | unchanged |

   - **Both process pools take the journey row's lock.** The API takes it for
     every heartbeat; the worker takes it for every alert it opens. A frozen
     holder on either would hide that journey from every other sweeper.
   - **Why 10 s idle.** Inside this code's transactions nothing waits but the
     database. There is no clock read and no network call, and pushes are sent
     outside (item 5). So a healthy gap between two statements is milliseconds,
     and 10 s is three orders of magnitude above it. A frozen holder then costs
     an alert at most one limit plus one interval: 20 s, inside the 60 s
     budget. PostgreSQL ends the session with SQLSTATE 25P03 and frees the
     row.
   - **Why the API's 5 s lock wait.** Without it, a heartbeat waits as long as
     the holder lives, and the API's pool has two connections (`POOL_SIZE`),
     so two such waits stall every route, health included. A refused wait is
     55P03: a `HeartbeatStoreError`, a 500, one `heartbeat_failed` line, and a
     resend from the phone. That is loud, and nothing is lost. 5 s is above
     any wait this code causes, which is milliseconds, or the 10 s limit for a
     frozen holder.
   - **Why none on the worker.** The sweep and the claim take rows with `skip
     locked`, so they never wait for a row. Graphile Worker's own statements
     share this pool, and a lock limit there could fail its start-up for
     reasons this task cannot see.
   - **Why not the migrations' pool.** A deploy that waits is visible in its
     own job. A lock limit there could fail a deploy, and that is a choice for
     the task that brings expand-then-contract migrations (M5).
   - **How they are set** is the implementer's choice: node-postgres's own
     connection options (read in `pg` 8.23.0, `connection-parameters.js` lines
     121–123 and `client.js` lines 558–566, which send them at startup), or a
     `SET` on connect. Either way the values come from `domain/watchdog.ts`,
     whose L2 test holds the budget (LOST-02-AC17).
   - **The limit makes a new error path, so it lands with item 8.** Read in
     `pg-pool` 3.14.0, `index.js` line 344: a client handed out loses the
     pool's `error` listener. A session that PostgreSQL ends while it is
     checked out then emits `error` with nobody listening, and that would end
     the process.

8. **The pool listeners** (inherited item 3, D-068).
   - `createPool` attaches, when it is given a `log` and a name, both of
     these before returning:
     - an `error` listener (an idle client);
     - a `connect` listener that gives every client its own `error` listener
       (a client that is checked out).
   - Each writes one `database_error` event: the pool's name (`api` or
     `worker`) and the SQLSTATE, or null. It never writes the message, the
     error object or the connection string, which carries the password
     (D-068).
   - Then it carries on. pg drops the dead client. A query on a checked-out
     one rejects, and its caller fails loudly: a 500, or a failed sweep, which
     stops the beat.
   - **Why carry on, and not crash.** A crash restarts the process, and a
     worker that restarts stops sweeping. The loud channels stay as they are:
     a failed request, a stopped beat, `/v1/health`.
   - Both listeners exist before `run()` sees the worker's pool, so
     graphile-worker neither warns nor installs its own handlers. They stay
     until `pool.end()`, so there is no gap after `runner.stop()`.
   - The migrations' pool gets none: a crash there fails the deploy loudly,
     which is right.

9. **The loops, and stopping** (D-079's second follow-up).
   - **Two loops in `worker.ts`,** each running again 10 s after its
     previous run finished (`WATCHDOG_INTERVAL_MS`; the owner chose 10 s
     within AR-06's 10–15 s, D-107), so a run never overlaps itself:
     - the **sweep loop** runs `watchdog.sweep()`;
     - the **delivery loop** runs `sender.deliverDue()`.
   - Both run once at start.
   - **A sweep that opened an alert wakes the delivery loop at once.** The
     first push does not wait for the interval.
   - **Two loops, not one.** A provider that never answers stalls delivery
     only, and no sweep waits behind it. A send that hangs is the adapter's
     to time out (M3; Healthchecks.io's adapter already has 10 s).
   - **A run that throws is logged, and the next run happens.** Nothing that
     goes wrong in a run can stop a loop. The beat shows a loop that has
     stopped.
   - **The worker pool's budget.** graphile-worker keeps one of the worker's
     two connections for `LISTEN` (read in `dist/main.js`: `pgPool.connect`
     for "a client dedicated to listening", line 367). The two loops and
     Graphile's job fetching share the other one, one statement at a time.
     That is enough at this scale, and `POOL_SIZE` is unchanged.
   - **`stop()`, in this order:**
     1. no new run starts;
     2. a running one is awaited;
     3. the runner stops, which aborts the check-in through Graphile's
        `helpers.abortSignal`, now handed to `CheckIn.checkIn(signal)`, so a
        hung Healthchecks.io no longer delays a stop;
     4. the pool is ended.
   - **On Clever Cloud's build machine nothing starts,** loops included, as
     BUG-3 has it.
   - **Why not Graphile jobs for the sweep.** Its cron is minute-granular
     (`worker.ts`), so a 10 s cadence would mean jobs that reschedule
     themselves. Those share two job slots with the check-in, and they would
     log every run. Their failures would also put error text into
     `graphile_worker.jobs.last_error`, a table nobody cleans.

10. **The log** (PRIV-07; `log.ts`, owned under D-102). `LogEvent` gains five
    closed events, and nothing free-form:

    ```ts
    | { event: 'watchdog_failed'; stage: 'read' | 'open' | 'beat'; code: string | null }
    | { event: 'watchdog_overdue'; journeyId: string }
    | { event: 'push_failed'; reason: 'NO_TARGET' | 'REFUSED' | 'UNAVAILABLE' | 'NOT_CONFIGURED'; messageId: string }
    | { event: 'delivery_failed'; stage: 'claim' | 'mark'; code: string | null }
    | { event: 'database_error'; pool: 'api' | 'worker'; code: string | null }
    ```

    - `createLog` checks each field as it already does:
      - `journeyId` and `messageId` only as canonical UUIDs;
      - `stage`, `reason` and `pool` only from their sets;
      - `code` only as a SQLSTATE.
    - An unlisted event still throws.
    - **The worker binds no location and no phone number in this task.** It
      reads journeys, alerts, outbox rows and user IDs. So no worker error can
      carry one, and its failures are logged as stage and SQLSTATE all the
      same.
    - **`worker.ts` must import `log.ts`.** The import rule
      `only-the-process-wires-the-log` (`packages/config/dependency-cruiser.cjs`)
      admits only `api-process.ts` today. It admits `worker.ts` too: the
      worker is the other process that wires the real log.

11. **Database time** (REL-01, AR-03).
    - The overdue read compares with `now()` in its own statement, and
      returns that `now()`. The lock step checks again with the
      transaction's `now()`.
    - `opened_at`, `next_attempt_at` and `sent_at` are all `now()`.
    - The module and the domain take the time from what the store returns.
      Neither reads a clock (lint).
    - The fake store emulates `now()` with the fake clock it is given. A fake
      store given no clock throws if asked about silence. A fake that guessed
      the time would prove nothing.

12. **No new dependency** (SEC-06). Drizzle, pg, graphile-worker and pino are
    already in `apps/server/package.json`. `gen_random_uuid()` is built into
    PostgreSQL 13 and later; staging runs 15.

13. **Import boundaries** (AR-10).
    - `modules/alerts/` gets ports only.
    - `worker.ts` and `api-process.ts` wire the adapters and the log.
    - The dependency-cruiser rule above is the one change.

14. **A decision to record: D-108** (delegated, D-031). `plan-keeper` writes
    it in this pull request. The owner's answers are D-106 and D-107, and
    BUG-18's D-105 for `adapters/db.ts` (the end of this file). It covers:
    - **The outbox is a table of our own, delivered by the worker's loop.**
      It is not Graphile jobs. D-032 named Graphile Worker for "jobs and
      outbox", and its consequences say "any swap is recorded as a new
      decision". Graphile Worker keeps the minute check-in.
    - **The watchdog feeds the beat.** This answers D-079's first follow-up,
      which leaves that choice to this task, and changes how D-065 item 4 is
      met.
    - **The two session limits,** their values, and the pools they are on.

    The interval is the owner's (D-107), not part of D-108. D-108 was given
    to this task by the coordinating session; as the live gotcha says,
    confirm before each push that no open pull request has used it.

### Interfaces the tests are written against (RG-02: tests first)

The implementer may refine a name only with `test-author`, and only before
the tests are written.

- **`domain/journey.ts`:**
  - `JOURNEY_EVENTS` is exactly `['start', 'heartbeat', 'silence']`;
  - `LOST_CONTACT_AFTER_MS`, `ALERT_STATES`, `SilenceEvent`;
  - the outcomes `{ type: 'lost_contact', state: 'LOST_CONTACT', alert: 'OPEN' }`
    and `{ type: 'unchanged' }`.
- **`domain/watchdog.ts` (new):**
  - `WATCHDOG_INTERVAL_MS` (10 s, D-107), `STUCK_AFTER_MS`, `BEAT_FRESH_MS`,
    `IDLE_IN_TRANSACTION_LIMIT_MS`, `LOCK_WAIT_LIMIT_MS`, `CLAIM_LEASE_MS`,
    `CLAIM_BATCH`, `ALERT_TIME_SLACK_MS` (60 s);
  - `retryDelayMs(attempts)` and `isStuck({ silentSince, now })`.
- **`ports.ts`:**
  - `WatchdogStore`:
    - `overdueJourneys(afterMs)` → `{ now, journeys: { id, state, silentSince }[] }`;
    - `openLostContactAlert({ journeyId, afterMs })` → `{ outcome: 'opened', alertId, messages } | { outcome: 'skipped' }`.
  - `OutboxStore`:
    - `claimDue({ limit, leaseMs })` → `{ now, messages: { messageId, recipientId, kind, attempts }[] }`;
    - `markSent(messageId)`;
    - `markFailed({ messageId, reason, retryAfterMs })`.
  - `Push`, `PushMessage`, `PushResult`, `PushFailure`.
  - `CheckIn.checkIn(signal?)`.
  - The five `LogEvent` members.
- **`modules/alerts/`:**
  - `createWatchdog({ journeys, beats, log })` → `sweep(): Promise<{ ok, opened, stuck }>`;
  - `createPushSender({ outbox, push, log })` → `deliverDue(): Promise<{ sent, failed }>`.
- **`adapters/db.ts`:** `createPool(connectionString, max, { name?, log?,
  idleInTransactionMs?, lockTimeoutMs? })`.
- **`worker.ts`:**
  - `startWorker(…, { checkIn, write, push, log })`;
  - the two loops, injectable for tests;
  - the default push.
- **The test kit** (owned, D-100):
  - `fakePush()`, which records every message in order. It can be told to
    answer a reason for one recipient or for all, to throw, or to recover. It
    answers a turn later, as the other fakes do.
  - `fakeJourneyStore({ clock })` gains the watchdog and outbox methods,
    with:
    - inspection: `alerts()`, `outbox()`;
    - `hold(journeyId)` and `release(journeyId)`, which stand in for a row
      another transaction holds;
    - `failWith` and `beforeNext` for the new calls.
  - The shared behaviour suite gains the watchdog and outbox behaviours, run
    against the fake (L2) and the adapter (L3).
  - `fakeCheckIn` records the signal it was given.
  - `fakePostgres` records each connection's startup parameters, and can end
    a connection with a fatal error carrying a SQLSTATE and a message.

## Acceptance criteria

### The alert

**LOST-02-AC1 — The most important test: every responder is alerted after
5 minutes of silence.** *(LOST-02)*
- **Given** walker W, with device D, starts journey J through the API. It
  names responders R1, R2 and R3, and D sends a heartbeat every 60 s for 10
  minutes, on the fake clock.
- **When** D goes silent, sending nothing at all, and the clock reaches
  exactly 5 minutes after the last heartbeat's receive time
- **And** the watchdog sweeps and the sender delivers
- **Then** J is `LOST_CONTACT`, and J has exactly one alert, `OPEN`
- **And** the recording push fake holds exactly one `LOST_CONTACT` message for
  each of R1, R2 and R3, and none for W or anyone else
- **And** one millisecond earlier, a sweep and a delivery change nothing and
  send nothing
- **And** the same holds with a single responder
- **And** at L3, the same flow runs through the real adapter, the real
  modules and the recording push. The journey's start and last contact are
  written relative to the database's `now()`.

**LOST-02-AC2 — At five minutes, never before, whatever happened earlier.**
*(LOST-02)*
- **Given** any `ACTIVE` journey, whose last contact is L, or its start S when
  it has none, and a sweep at database time T
- **Then** after the sweep it is `LOST_CONTACT` exactly when `T −
  coalesce(L, S) ≥ 5 min`
- **And** for any sequence of heartbeats and sweeps (fast-check), a journey
  silent for 5 minutes is `LOST_CONTACT` after the next sweep, and one never
  silent that long never is. This is `06-testing-strategy.md`'s L2 example.
- **And** the property runs in the shared behaviour suite: against the fake
  (L2), and against the real tables with fewer runs (L3).

**LOST-02-AC3 — A journey that never sent a heartbeat is timed from its
start.** *(LOST-02)*
- **Given** J started at S and has no heartbeat
- **When** the watchdog sweeps at S + 4:59.999, then at S + 5:00
- **Then** the first sweep changes nothing, and the second opens J's alert,
  with `silent_since` equal to S.

**LOST-02-AC4 — The server decides on the database's clock.** *(LOST-02,
REL-01)*
- **Given** a real PostgreSQL
- **When** J's last contact is written as `now() − 5 min − 1 s`, and K's as
  `now() − 5 min + 1 s`
- **Then** one sweep opens J's alert and leaves K `ACTIVE`
- **And** the alert's `opened_at` lies between two `select now()` readings
  taken before and after the sweep
- **And** a position whose phone time is hours behind or ahead changes
  neither outcome
- **And** the watchdog module and the domain read no clock. The lint rule
  holds this (L1). In-process, the beat's time is exactly the `now()` the
  store's read returned.

**LOST-02-AC5 — Only an `ACTIVE` journey is alerted, and once per silence.**
*(LOST-02, SM-03)*
- **Given** J is `LOST_CONTACT` with its one alert, and E is `ENDED`, both
  silent for an hour
- **When** the watchdog sweeps again and again, and D sends J a heartbeat in
  between
- **Then** J keeps its one alert and gets no further message, and E never
  gets an alert
- **And** J stays `LOST_CONTACT` after the heartbeat. Moving it back is task
  4's.

**LOST-02-AC6 — Every (situation, event) pair has a tested outcome, silence
included.** *(LOST-02; extends LOST-01-AC17)*
- **Given** `JOURNEY_EVENTS` is exactly `start`, `heartbeat` and `silence`
- **Then** the transition table holds an expectation for every pair:
  - none, `ACTIVE`, `LOST_CONTACT` and `ENDED`, each with `silence`;
  - `ACTIVE` with `silence` both under and at the threshold.

  Each returns exactly that outcome.
- **And** a pair the lists create but the table lacks fails, naming the pair
- **And** `transition` never throws, and never returns `undefined`, for any
  generated situation and event (fast-check)
- **And** typecheck fails if an event has no case.

### Once, and lock-safe (AR-06)

**LOST-02-AC7 — Swept twice, or by two workers at once: one alert, one
message per responder.** *(LOST-02)*
- **When** the watchdog sweeps twice in a row (L6), or at least two sweepers
  sweep at once on separate connections, at least 5 rounds (L3)
- **Then** each overdue journey has exactly one alert, and exactly one message
  per responder
- **And** no sweep fails. The losers skip, or find nothing overdue.

**LOST-02-AC8 — A held row is skipped, not waited for, and alerted once it is
free.** *(LOST-02)*
- **Given** overdue journeys J and K, and another transaction holding J's
  row `for update`
- **When** the watchdog sweeps
- **Then** the sweep finishes without waiting, K's alert is opened, and J is
  untouched
- **And** after the holder commits without changing J, the next sweep opens
  J's alert
- **And** at L6 the fake's `hold` gives the same outcome.

**LOST-02-AC9 — Contact that arrives during the sweep wins.** *(LOST-02,
SM-09)*
- **Given** J was overdue when the sweep read it
- **When**, before J's alert is opened, a heartbeat for J is stored (L2: the
  fake's `beforeNext`; L3: committed on another connection between the read
  and the lock), or J's state is changed
- **Then** J is not alerted, has no alert and no message, and the sweep counts
  J as skipped
- **And** the move to `LOST_CONTACT` changes exactly one row, or the
  transaction writes nothing. An update planted to change none fails the
  open, rolled back whole (L3).

**LOST-02-AC10 — A heartbeat and the watchdog meet on the row.** *(LOST-02,
SM-03, SM-09)*
- **Given** a real PostgreSQL and an overdue J
- **When** a heartbeat's transaction holds J's row as a sweep runs, and then
  commits
- **Then** the sweep skips J, J is no longer overdue, and the next sweep opens
  nothing
- **And when** a sweep's transaction holds J's row, before commit, as a
  heartbeat for J arrives
- **Then** the heartbeat waits, then is stored, and last contact advances
- **And** J stays `LOST_CONTACT`, with its one alert unchanged.

**LOST-02-AC11 — A heartbeat waits for an uncommitted `ENDED`, then answers
`ended` and stores nothing.** *(LOST-02, SM-07; inherited from LOST-01)*
- **Given** a real PostgreSQL, and J `ACTIVE`
- **When** one connection opens a transaction, sets J to `ENDED` and does not
  commit
- **And** `recordHeartbeat` for J starts on another connection
- **Then** it does not answer while the first transaction is open. The test
  checks that it is waiting on J's row lock (`pg_stat_activity`), not merely
  slow.
- **And** once the first transaction commits, it answers `{ outcome: 'ended'
  }`
- **And** no heartbeat and no position are stored, and J's last contact is
  unchanged
- **And** the same with the first transaction rolled back gives `recorded`,
  as the control.

### All or nothing (AR-05)

**LOST-02-AC12 — The move, the alert and every message are one
transaction.** *(LOST-02)*
- **Given** a real PostgreSQL, where a test-only trigger makes inserting the
  second responder's outbox row fail
- **When** the watchdog sweeps an overdue J
- **Then** J is still `ACTIVE`, and has no alert and no message
- **And** one `watchdog_failed` line is written, with stage `open` and the
  SQLSTATE
- **And** once the trigger is removed, the next sweep opens J's alert, with
  every message
- **And** at L6, with the fake failing `openLostContactAlert`, the same holds
- **And** a journey with no responder rows (put there directly, L3) is never
  moved. It stays `ACTIVE`, and the open fails.

**LOST-02-AC13 — The alert records what it was raised for, and copies no
position.** *(LOST-02)*
- **Then** a new alert is `OPEN`, its `opened_at` is the database time of the
  sweep that opened it, and its `silent_since` equals the journey's last
  contact, or its start when it has none
- **And** the heartbeat received at `silent_since` is the journey's latest
  (`latestHeartbeatOf` reads it)
- **And** no column of `alerts` or `outbox` holds a coordinate, an accuracy,
  a phone time or a battery level (L3, `information_schema`).

### Delivery

**LOST-02-AC14 — Each message reaches the push port once, content-free, with
its own opaque ID.** *(LOST-02)*
- **Given** J's alert has opened with three messages
- **When** the sender delivers, and the fake accepts each one
- **Then** the fake holds three messages, one per responder. Each has exactly
  the keys `messageId`, `recipientId` and `kind`, and `kind` is
  `LOST_CONTACT`.
- **And** each `messageId` is a UUID, the three are distinct, and none equals
  the walker's, any user's, the journey's, the alert's or any device's ID
- **And** each message is then marked sent, and later deliveries send none of
  them again.

**LOST-02-AC15 — A message the port did not accept is never counted as
sent.** *(LOST-02)*
- **Given** the fake answers `NO_TARGET` for R2, `REFUSED`, `UNAVAILABLE` or
  `NOT_CONFIGURED` in other cases, and throws in another
- **When** the sender delivers
- **Then** R1's and R3's messages are sent, and R2's stays unsent
- **And** one `push_failed` line is written per failed attempt, with the
  reason and the message ID only
- **And** R2's message is due again after 10, 20, 40, 60 and 60 s of database
  time, with the same message ID each time
- **And** once the fake accepts, it is marked sent, and nothing more is sent
- **And** the worker's default push answers `NOT_CONFIGURED` to every message,
  and the worker says at start that no push provider is configured
  (in-process).

**LOST-02-AC16 — A sender that stops mid-send loses nothing, and no push is
made inside a transaction.** *(LOST-02)*
- **Given** a message claimed by a sender that never reports back
- **When** the lease (30 s) passes
- **Then** the message is claimed and sent again, with the same message ID
  (L6)
- **And** at L3, with the pool's idle limit set short for the test, a push
  that answers after longer than the limit is still marked sent. No
  session is ended, and no `database_error` line is written.

### The lock is bounded (inherited from LOST-01)

**LOST-02-AC17 — A stalled transaction is ended, its journey is then
alerted, and a heartbeat never waits for long.** *(LOST-02)*
- **Given** a real PostgreSQL, and a pool created as each process creates it,
  with the limits set short for the test
- **When** a transaction on that pool locks overdue J's row, then sends
  nothing more
- **Then** PostgreSQL ends that session within the idle limit plus a margin.
  The client's next query rejects, and `pg_stat_activity` no longer shows the
  session.
- **And** one `database_error` line carries SQLSTATE 25P03
- **And** J's row is free, and the next sweep opens J's alert
- **And** while a session outside the pools holds J's row, `recordHeartbeat`
  through the API's pool rejects within the lock limit plus a margin. It
  rejects with a `HeartbeatStoreError` whose code is 55P03, and stores
  nothing.
- **And** in-process, the API's pool asks for
  `idle_in_transaction_session_timeout` 10 000 and `lock_timeout` 5 000 at
  startup. The worker's asks for the first and not the second (the fake
  PostgreSQL server's startup parameters).
- **And** at L2, the budget holds: `WATCHDOG_INTERVAL_MS +
  IDLE_IN_TRANSACTION_LIMIT_MS < STUCK_AFTER_MS`, and `STUCK_AFTER_MS +
  WATCHDOG_INTERVAL_MS ≤ ALERT_TIME_SLACK_MS`. The values are pinned,
  `WATCHDOG_INTERVAL_MS` at 10 000 (D-107).

### Loud when the watchdog cannot work (F7)

**LOST-02-AC18 — A connection's error is one line, never a crash, and never
the credential.** *(LOST-02, SEC-03; D-068)*
- **Given** each process pool, in-process against the fake PostgreSQL
  server, whose connection URL holds a synthetic marker password
- **When** an idle connection is ended with a fatal error whose message holds
  the marker
- **And when** a checked-out connection is ended between two queries
- **Then** each writes exactly one `database_error` event, with the pool's
  name and the SQLSTATE
- **And** nothing written holds the marker, the URL or the error's message
- **And** no uncaught error is raised, and the pool serves the next query
- **And** at L3, `pg_terminate_backend` on a pooled connection gives one line
  with 57P01
- **And** starting the real Graphile runner on the worker's pool (L3) writes
  no "error handlers" warning, and the pool's `error` listeners are ours
  alone.

**LOST-02-AC19 — The watchdog feeds the beat.** *(LOST-02, REL-08; D-079)*
- **When** a sweep succeeds
- **Then** the worker beat is recorded at the `now()` the sweep read
- **And when** a sweep's read fails, an open fails, or the beat cannot be
  written
- **Then** no beat is recorded, and one `watchdog_failed` line is written
- **And** the minute check-in checks in exactly once when the beat is at most
  30 s old by the database clock. It does not check in when the beat is older,
  or missing, and then writes one line saying so.
- **And** with every sweep failing, `/v1/health` reports `degraded` 3 minutes
  after the last good sweep, as for a stopped worker (L6, with the health
  service reading the same fake beats).

**LOST-02-AC20 — A journey the watchdog cannot move is reported, and stops
the beat.** *(LOST-02, REL-08)*
- **Given** J `ACTIVE`, with its row held by a session outside both pools
  (L3), or by the fake's `hold` (L6)
- **When** the watchdog sweeps at 5 min + 29.999 s of silence
- **Then** J is skipped, nothing is written, and the beat is recorded
- **And when** it sweeps at 5 min + 30 s and later
- **Then** each sweep writes one `watchdog_overdue` line naming J, and records
  no beat
- **And** the first sweep after the hold ends opens J's alert, and records the
  beat again.

**LOST-02-AC21 — The loops run, keep running and stop cleanly.** *(LOST-02,
REL-08; D-079)*
- **Given** fake timers, and a stub watchdog and sender (in-process)
- **Then** a sweep and a delivery run at start, and again 10 s after each
  previous run finished. A run that takes longer is never overlapped.
- **And** a run that throws is logged, and the next run still happens
- **And** a sweep that opened an alert starts a delivery at once
- **And** a delivery that never settles delays no sweep
- **And** `stop()` starts no further run, waits for one in flight, aborts the
  check-in's signal, and only then ends the pool
- **And** a check-in that hangs no longer delays the exit after SIGTERM
- **And** on the build machine (`INSTANCE_TYPE=build`) no loop runs (BUG-3).

### Nothing personal in a log (PRIV-07)

**LOST-02-AC22 — The new events are closed, and failures carry a stage and
a SQLSTATE only.** *(LOST-02, PRIV-07)*
- **Then** typecheck (L1) fails for any of the five events holding another
  field. A `@ts-expect-error` test holds this, a latitude and a message
  among the fields it tries.
- **And** `createLog` writes each as one JSON line holding exactly its fields.
  It writes a `journeyId` or `messageId` that is not a canonical UUID, a
  `stage`, `reason` or `pool` outside its set, and a `code` that is not a
  SQLSTATE, each as null (L2).
- **And** when the fake store and the fake push fail with errors whose
  messages hold markers, nothing written to stdout, stderr or the console holds
  a marker (L6). The markers are a synthetic coordinate, a credential-like
  string and a responder's ID.
- **And** as controls, the capture sees a line written through the production
  `createLog`, and the thrown errors do hold the markers.

### The database

**LOST-02-AC23 — The database agrees.** *(LOST-02)*
- **Given** a freshly migrated database
- **Then** `alert_state`'s values equal `ALERT_STATES`, in order
  (`pg_enum`)
- **And** a second alert for a journey that already has one not `RESOLVED`
  is refused by the database itself. Its index predicate reads `<>
  'RESOLVED'` (`pg_get_indexdef`).
- **And** a second outbox row for the same (alert, recipient, kind) is
  refused by the database itself
- **And** an outbox row naming no alert, or no user, is refused
- **And** the only columns named like a coordinate, in every table, are still
  `positions.latitude` and `positions.longitude`
- **And** on PostgreSQL 15, migration `0003` runs over a database holding
  journeys in every state with heartbeats and positions, and changes none of
  their rows (`deploy.integration.test.ts`).

## Test plan

| AC | Level | Where | How |
|----|-------|-------|-----|
| AC1 | L6, L3 | `apps/server/src/alerts.system.test.ts` (new); `apps/server/src/alerts.integration.test.ts` (new) | L6: `createApi` with the journey service, plus `createWatchdog` and `createPushSender`, all over one `fakeJourneyStore({ clock })`, with `fakePush()`, `fakeLog()` and `fakeWorkerHeartbeats()`. L3: the real adapter and modules, and `fakePush()` |
| AC2 | L2, L3 | `domain/journey.test.ts`; behaviour suite, run by `fake-journey-store.test.ts` and `journeys.integration.test.ts` | fast-check over heartbeat schedules and sweep times |
| AC3 | L2, L6, L3 | domain test; system test; behaviour suite | |
| AC4 | L3, L1, L6 | integration test; lint in `gate:static`; system test | Timestamps relative to `now()`; brackets. **Names REL-01** |
| AC5 | L2, L6, L3 | domain test; system test; behaviour suite | **Names SM-03** |
| AC6 | L1, L2 | `tsc`; domain test | `satisfies` over the lists, and a run-time check |
| AC7 | L6, L3 | system test; integration test | At least 2 sweepers on separate pool connections, at least 5 rounds |
| AC8 | L3, L6 | integration test; system test (`hold`) | |
| AC9 | L2, L3 | behaviour suite (`beforeNext`); integration test | **Names SM-09** |
| AC10 | L3 | integration test | Two connections; the order forced by holding transactions open. **Names SM-03, SM-09** |
| AC11 | L3 | `journeys.integration.test.ts` | Waiting proved through `pg_stat_activity.wait_event_type = 'Lock'`. **Names SM-07** |
| AC12 | L3, L6 | integration test (a trigger the test creates and removes, as SM-01-AC8's does); system test (`failWith`) | |
| AC13 | L3, L6 | integration test; system test | |
| AC14 | L6 | system test | |
| AC15 | L6, L2 | system test; `worker.test.ts` | The fake clock moved across each retry |
| AC16 | L6, L3 | system test; integration test | A push that resolves after the idle limit |
| AC17 | L3, L2, in-process | `database.integration.test.ts`; `domain/watchdog.test.ts` (new); `api-process.test.ts` and `worker.test.ts` with `fakePostgres` | Limits set short for the test; the production values read from the startup parameters |
| AC18 | In-process, L3 | `api-process.test.ts`, `worker.test.ts`; `database.integration.test.ts` | Marker password in the URL; `console.warn` captured. **Names SEC-03** |
| AC19 | L6, L2 | system test; `worker.test.ts` | **Names REL-08** |
| AC20 | L3, L6 | integration test (an unbounded `psql`-like session from the test's own client); system test | **Names REL-08** |
| AC21 | L2 | `worker.test.ts`, `healthchecks.test.ts` | Fake timers; stub loops; the abort signal observed. **Names REL-08** |
| AC22 | L1, L2, L6 | `tsc`; `log.test.ts`; system test (`captured()`) | **Names PRIV-07** |
| AC23 | L3 | `journeys.integration.test.ts`; `deploy.integration.test.ts` (PostgreSQL 15) | |

### Notes

- **Not used:** L4 compares nothing, because no contract changes. L5 and L7
  are not used, because the app is not touched. L8 is task 8; L9 and L10 are
  not used.
- **L3 needs Docker.** It runs in CI and on the Mac, not in a cloud session.
  `gate:full` names it as not run, and the `integration` job's log is the
  evidence.
- **One behaviour, two implementations.** The watchdog and outbox behaviours
  join `JOURNEY_STORE_BEHAVIOUR`, and `fake-journey-store.test.ts` pins their
  names. A fake more lenient than the adapter would make the L6 tests prove
  the fake (D-100).
- **Test names** start with `LOST-02-ACn:`. Files holding the criteria above
  also name the covered IDs the table marks. The criteria do not need those
  names, because those IDs are already covered.
- **Synthetic data only** (RG-07, D-089): IDs and credentials from the
  existing builders, positions from `syntheticPosition()`, the marker
  password generated at run time.
- **Before pushing:** run `test:coverage`, then `coverage:ratchet` (live
  gotcha). `modules/alerts/` and `domain/` keep RG-04's 95 % branch floor.
- **`docs/requirements-status.md`** is regenerated with `pnpm run
  req:coverage`. LOST-02 goes from ⚪ to 📝 with this spec, and to 🟢 with the
  tests.

### Existing assertions that change by design (RG-03)

`test-author` changes each, with the written reason RG-03 asks for in the
pull request. None loosens what a test proves.
- `domain/journey.test.ts`: `JOURNEY_EVENTS` gains `silence`, and the
  transition table gains its rows (LOST-01-AC17's pin).
- `fake-journey-store.test.ts`: the pinned behaviour names grow. The fake
  takes an optional `clock`, so existing callers are unchanged.
- `worker.test.ts`: the INF-08 and REL-08 tests of the minute task. The beat
  moves from that task to the sweep, and "a check-in only follows a recorded
  beat" becomes "only follows a beat at most 30 s old". The REL-01 test of
  the beat's time moves to the sweep. Every property they held is held
  again: the beat is database time, and there is no check-in without a fresh
  beat.
- `scripts/lib/gate-decisions.test.mjs`, lines 514–544: the
  `MUTATION_GROUPS` pin gains `alerts`.
- `scripts/stryker-config.test.mjs`, about line 277: the whole-suite run's
  paths become `['apps/mobile/src/safety-core/']`. Also `scripts/mutation.test.mjs`,
  where its fixtures describe "the whole-suite run as it is today" (lines
  69–72 and 396–409). `test-author` says which of them are sample data.
- `packages/config/dependency-cruiser.test.mjs`: the log-import rule admits
  `worker.ts`.
- `log.test.ts`, `healthchecks.test.ts`, `fake-check-in.test.ts`,
  `fake-postgres.test.ts` and `db.test.ts`: where they pin the event list,
  the check-in's signature, the fakes' abilities, or `createPool`'s
  signature.

## Mutation (D-036, D-095, D-098, D-099)

Read in `scripts/lib/gate-decisions.mjs` on 2026-10-03.

| New or changed code | Group | Tests the group runs | Configuration |
|---|---|---|---|
| `domain/journey.ts`, `domain/watchdog.ts` | `domain` | `apps/server/src/domain` | root |
| `modules/alerts/` (new) | **`alerts` (new)** | `apps/server/src/alerts.system.test.ts` | `vitest.system.config.mjs` |
| `worker.ts` | `process` | `bin/bin.test.ts`, `worker.test.ts`, `process.test.ts` | root |
| `api-process.ts` | `api-process` | `api-process.test.ts` | root |
| `adapters/healthchecks.ts` (the signal) | `healthchecks` | `healthchecks.test.ts`, `worker.test.ts` | root |

- **The `alerts` group** goes in `MUTATION_GROUPS`, in
  `scripts/lib/gate-decisions.mjs`. That file is owned, and in the ai-review
  `safety` filter since D-100, so no `ai-review.yml` edit is needed.
- **Its tests are one file, `alerts.system.test.ts`, kept apart from
  `journeys.system.test.ts`.** The journey file runs per mutant in the
  `journeys` group, and LOST-01 roughly doubled it. A second, smaller file
  keeps each alerts mutant cheap.
- **Each file must reach 80 % killed on its own** (D-098). Every run is fresh
  (D-099).
- **Not mutated on a pull request:**
  - `adapters/journeys.ts`, `adapters/db.ts`, `db/schema.ts` and the
    migration: D-095 leaves them to L3 and to D-036's nightly run, which does
    not exist yet;
  - `log.ts`: whether it should be mutated is CI `test-auditor`'s open
    question to the owner from #60. This task adds five events to it, which
    raises the stake.
- **Cost.** D-098 keeps the 25-minute budget. If an honest run does not fit,
  the owner decides (cost). The job's log says how long it took. Read it; do
  not estimate.

## Modules and files affected

Owner approval and the safety filter were read on 2026-10-03, at `fe384c5`,
in `.github/CODEOWNERS`, `scripts/lib/merge-rules.mjs`
(`OWNER_APPROVAL_PATHS`) and `.github/workflows/ai-review.yml` (the `safety`
filter, lines 54–80). `adapters/db.ts`'s row shows the state after BUG-18
(D-105), which this pull request waits for.

| File | Change | Owner approval | Safety filter | Mutation |
|------|--------|:--:|:--:|:--:|
| `apps/server/src/domain/journey.ts` | `silence`, `ALERT_STATES`, the threshold | **yes** | **yes** | `domain` |
| `apps/server/src/domain/watchdog.ts` (new) | Timing, budget, backoff | **yes** | **yes** | `domain` |
| `apps/server/src/domain/*.test.ts` | L2 (test-author) | **yes** | **yes** | (its tests) |
| `apps/server/src/modules/alerts/watchdog.ts`, `outbox.ts` (new) | The sweep, the sender | **yes** | **yes** | `alerts` |
| `apps/server/src/ports.ts` | Two store ports, `Push`, `CheckIn`'s signal, five `LogEvent`s | no | no | — |
| `apps/server/src/adapters/journeys.ts` | The sweep's and the outbox's SQL | **yes** | **yes** | no (D-095) |
| `apps/server/src/adapters/db.ts` | Session limits and listeners in `createPool` | **yes**, through BUG-18 (D-105) | **yes**, through BUG-18 (D-105) | no |
| `apps/server/src/adapters/healthchecks.ts` | Takes the abort signal | **yes** | **yes** | `healthchecks` |
| `apps/server/src/db/schema.ts` | `alerts`, `outbox`, two enums | **yes** | **yes** | no |
| `apps/server/src/db/migrations/0003_*.sql`, `meta/*` | Generated with `pnpm --filter @trygghverdag/server db:generate` | **yes** | **yes** | no |
| `apps/server/src/worker.ts` | The loops, the beat, the check-in rule, the default push, the pool's options | **yes** | **yes** | `process` |
| `apps/server/src/api-process.ts` | The pool's options and log | **yes** | **yes** | `api-process` |
| `apps/server/src/log.ts` | Five events | **yes** (D-102) | no (D-102) | no |
| `packages/config/dependency-cruiser.cjs`, its test | `worker.ts` may import `log.ts` | **yes** | no | — |
| `scripts/lib/gate-decisions.mjs` | The `alerts` group | **yes** | **yes** | input (D-098) |
| `scripts/lib/gate-decisions.test.mjs`, `scripts/stryker-config.test.mjs`, `scripts/mutation.test.mjs` | Pins (test-author) | **yes** | no | — |
| `packages/test-kit/src/` (`fakePush`, the store's new methods, the behaviour suite, `fakeCheckIn`, `fakePostgres`, their tests, `index.ts`) | Fakes (test-author) | **yes** (D-100) | **yes** | input (D-098) |
| `packages/contracts/src/health.ts` | The comment above `WORKER_STALE_AFTER_MS` only: the beat now follows each good sweep. No schema or description change, so `openapi.json` is unchanged | no (D-094) | **yes** | — |
| `apps/server/src/alerts.system.test.ts` (new) | L6 (test-author) | no | no | the `alerts` group's tests |
| `apps/server/src/alerts.integration.test.ts` (new), `adapters/journeys.integration.test.ts`, `adapters/database.integration.test.ts`, `deploy.integration.test.ts` | L3 (test-author) | no | no | — |
| `apps/server/src/worker.test.ts`, `api-process.test.ts`, `log.test.ts`, `adapters/healthchecks.test.ts` | L2 and in-process (test-author) | no | no | groups' tests |
| `docs/plan/decisions.md` | D-108, the delegated decision (approach item 14; plan-keeper). D-105 is BUG-18's; D-106 and D-107 record the owner's answers | **yes** | no | — |
| `docs/requirements-status.md` | Regenerated | no | no | — |
| `docs/progress.md`, `docs/progress/m2.md` | Status (plan-keeper) | no | no | — |

- **Files needing the owner's approval:** every row marked **yes** above.
  The pull request needs it in any case, as every M2 task does through
  `domain/`.
- **`.github/workflows/ai-review.yml` is not edited by this pull request.**
  CI's AI reviewers can run on it, and no hand merge is needed (D-075).
- **`adapters/db.ts` is owned and safety-reviewed through BUG-18** (D-105,
  branch `fix/BUG-18-db-owned`). BUG-18 adds it to `.github/CODEOWNERS`, to
  `OWNER_APPROVAL_PATHS` and to the ai-review `safety` filter, so it edits
  `ai-review.yml` and the owner merges it by hand. This pull request changes
  none of those files for `db.ts`, and leaves `scripts/gate.test.mjs`'s D-102
  exception as it is.
- **This pull request must not merge before BUG-18.** Otherwise `db.ts`
  would hold the lock bound with nobody's approval and no safety review. If
  BUG-18 is still open when this one is ready, this one waits.
- **Expected unchanged:**
  - `.github/` (CODEOWNERS and `ai-review.yml` included),
    `scripts/lib/merge-rules.mjs` and `scripts/gate.test.mjs`;
  - `api.ts`, `http.ts`, `modules/journeys/` and `modules/health/`;
  - `adapters/clock.ts`, `adapters/device-credentials.ts`,
    `adapters/migrations.ts` and `adapters/worker-heartbeats.ts`;
  - `bin/*`, `process.ts` and `config.ts`;
  - the contracts' schemas and `openapi.json`;
  - `stryker.config.mjs` and the Vitest configurations;
  - `infra/` and `apps/mobile/`.
- **Reviewers.** `safety-reviewer` runs because `domain/`, `modules/alerts/`,
  `worker.ts`, the adapter, the schema, the test kit and
  `gate-decisions.mjs` change, and, once BUG-18 has merged, `adapters/db.ts`. `privacy-security-reviewer` and `test-auditor`
  always run.

## Contract changes

**None.** The route that reads an alert's details is M3's (D-106). No route
is added and no schema changes. Only a comment in
`packages/contracts/src/health.ts` changes, so `openapi.json` stays as it is.
`api:diff` compares nothing, since `released/` is empty; record that as "not
compared", never as "passed".

## Risks and failure modes

- **[F1](../plan/03-safety-reliability-security.md#failure-modes) and
  [F6](../plan/03-safety-reliability-security.md#failure-modes), the missed
  alert.** Every way this task could miss one has a criterion:
  - five minutes passing unnoticed: AC1 to AC4;
  - a journey that never sent a heartbeat: AC3;
  - a sweep that fails halfway: AC12;
  - a row held for ever: AC17 and AC20;
  - a crash between sending and marking: AC16;
  - a push counted as sent when it was not: AC15;
  - a dead watchdog beside a healthy cron: AC19 and AC21.

  **Still open:**
  - Push is best effort (`03-safety-reliability-security.md`, finding 4).
    Acknowledgement and SMS are tasks 5 and 6.
  - Until M3 nothing is really sent: staging's push answers
    `NOT_CONFIGURED`. No journey can exist on staging before the login task
    (D-091), except task 8's canary, which needs a push target of its own.
- **[F7](../plan/03-safety-reliability-security.md#failure-modes), the server
  or watchdog down.**
  - The beat now means "the watchdog swept", which is what REL-08 asks
    the monitors to watch (AC19). A journey left unmoved stops it too (AC20).
  - **A new page cause, stated plainly:** a lock this code does not control,
    held past 5 min + 30 s on a silent journey, now pages the owner through
    Healthchecks.io and `/v1/health`. That is intended. Before, it was a
    silent miss.
  - The worker's two connections, one held by Graphile's `LISTEN`, carry
    both loops. A query that hangs stops sweeps, then the beat, then pages.
    That is loud, not silent.
- **[F8](../plan/03-safety-reliability-security.md#failure-modes), a bad
  release breaks alerts.**
  - The most important test runs at L6 on every pull request, under the new
    `alerts` mutation group, and at L3 in CI.
  - The canary (task 8) watches the path for real.
- **[F2](../plan/03-safety-reliability-security.md#failure-modes), no
  coverage, which becomes a false alarm.**
  - Five minutes in a tunnel alerts, as designed. The back-in-contact story
    (task 4) closes it; until then the alert stays open, which is the safe
    direction.
  - **The five-minute race.** A heartbeat is timed when it arrives, before it
    takes the row (LOST-01: "a slow read must not make a heartbeat look later
    than it came"). One that arrives in the last milliseconds before 5:00 and
    is committed just after a sweep opened the alert is stored against
    `LOST_CONTACT`. That is applied after the alert, although it was received
    first, a strict reading of SM-09. The result is a false alarm that stays
    loud, inside a window of milliseconds, and task 4 then sends "back in
    contact". It is accepted and stated here, not hidden.
- **[F3](../plan/03-safety-reliability-security.md#failure-modes) and
  [F4](../plan/03-safety-reliability-security.md#failure-modes):** the server
  sees silence and alerts. That is the point, and their false alarms are
  measured in M6.
- **[F5](../plan/03-safety-reliability-security.md#failure-modes):** a
  heartbeat without a position keeps contact (LOST-01), so it never alerts.
  The responders' "location unavailable" is M3's.
- **[F9](../plan/03-safety-reliability-security.md#failure-modes) and
  [F10](../plan/03-safety-reliability-security.md#failure-modes):** not
  touched.
- **The platform may refuse the startup parameters.** A connection pooler in
  front of Clever Cloud's PostgreSQL could reject them, and then every
  connection would fail. That would show at once: the deploy's smoke test and
  `/v1/health` go red. Whether there is one was **not checked**: sessions never
  reach `api.clever-cloud.com`. The first deploy's job log is the evidence. A
  `SET` on connect is the fallback (approach item 7).
- **A legitimate transaction ended by the limit** on a starved instance (D-077
  notes reduced CPU on small plans). A heartbeat gets a 500 and the phone
  resends; a sweep is retried in 10 s. Loud, and nothing is lost.
- **Duplicate pushes.** Delivery is at least once. The per-message ID makes a
  resend collapse on the phone, but only once M3's adapter sets it as the
  collapse ID. That is a flag for M3's adapter (D-087).
- **The fake can drift from the adapter.** The shared behaviour suite holds
  them together.
- **Personal data in new tables.** `alerts` and `outbox` hold who was alerted
  and when: the "alert records" of the retention rule (30 days, M4). They
  hold no location and no phone number.
- **`ports.ts` has no owner and holds `LogEvent`** (left open by LOST-01's
  review). `log.ts` checks every field itself, so the five new events cannot
  carry a free field whatever `ports.ts` says.
- **A coverage report that reads as done.** LOST-02 turns 🟢 while the halves
  under "How this spec names requirements" remain.

### Flags from other decisions, checked

- **D-086:**
  - The push is content-free (AC14), and sent straight to APNs and FCM in M3.
  - `CATEGORY_ALARM` and the Android channel are M3's.
  - Its "the server's 5-minute silence becomes the only signal" case is this
    task.
- **D-087:**
  - Started here, for the first message type: exactly one message per
    responder when swept twice, with an opaque per-message ID (AC7, AC14);
    no personal detail in the message (AC14).
  - Left for M3:
    - the critical level, mapped from the kind;
    - the request headers;
    - every later message type;
    - the "no FCM token on iOS" rule.
  - The canary's flag is task 8's.
- **D-079:** both follow-ups are met (AC19, AC21). UptimeRobot Solo stays an
  M5 gate item.
- **D-068:** the listener (AC18). Its second half, closing the pool on
  shutdown, was done in INF-07. `stop()` keeps the order (AC21).
- **D-065:** the beat's meaning changes from "the worker's cron ran" to "the
  watchdog swept". `WORKER_STALE_AFTER_MS` (3 min) is unchanged.
- **D-032:** the outbox is our own table (approach item 14).
- **D-089:** synthetic data only. No secret is committed: the marker password
  is generated at run time.
- **D-091:** no responder device has a credential outside tests before the
  login task. That is one reason the read route waits for M3 (D-106).
- **D-102:** its named exception in `scripts/gate.test.mjs` stays pinned to
  `log.ts` alone. `adapters/db.ts` takes the filter instead (D-105, BUG-18).

## Out of scope

- **The read of the alert's details by a responder's app**: the last known
  position, time and battery, behind the responders-only rule's access check.
  M3, with the alert screen (D-106).
- **Making `adapters/db.ts` owned and safety-reviewed.** That is BUG-18
  (D-105), its own pull request, which must merge first.
- **Everything the app shows or sounds:**
  - the guidance (the what-to-do story);
  - the notification's visible text and its language;
  - the level (D-087);
  - the real APNs and FCM adapter, and device push tokens (A-11);
  - responder readiness (the responder-setup story).

  All of it is M3.
- **Back in contact and resolving the alert** (task 4), including stopping
  retries for a resolved alert.
- **"I'm on it"** (task 5).
- **Escalation to SMS** (task 6), with:
  - paging the owner when an SMS fails;
  - the resumed-escalation rule;
  - the last-responder warning.
- **"They're safe", the 24-hour rule and the two-hour rule** (task 7).
- **The canary** (task 8).
- **Notices other than this alert**: "journey started" (the start-and-end
  story), low battery (the low-battery story). They will use this outbox.
- **Retention of `alerts` and `outbox` rows** (the retention rule, M4), and
  the DPIA.
- **Lock limits on the migrations' pool**, `statement_timeout`, and an index
  for the watchdog's read.
- **Changing `WORKER_STALE_AFTER_MS`, or the monitors' own settings.**
- **Mutation testing of `log.ts`.** It is the owner's open question from CI's
  `test-auditor` on #60.
- **Telling the walker that their group was alerted.** It is not in the
  story.

## Settled by the plan, so not asked

- **The threshold:** 5 minutes (D-021), counted "or more" (approach item 2).
- **Silence counts from last contact, or from the start** (`docs/progress/m2.md`).
- **Who is alerted:** every responder stored with the journey. Not the
  walker, and nobody else.
- **What the push says, and through whom:** nothing personal, sent straight
  to APNs and FCM (D-086). The words are app text (D-014).
- **Push first, SMS later** (D-019, task 6). Critical level for this alert
  alone (D-087), set in M3.
- **The watchdog's cadence is within 10 to 15 s** (AR-06). The owner chose
  the value (D-107, below).

## Answered by the owner (2026-10-03)

Each was asked with Claude's recommendation and two or more options.

1. **Where is the route built that lets a responder's app read the alert's
   last known position, time and battery?** The push can carry none of it
   (D-086). **Answer: in M3, with the alert screen** (the recommendation).
   **D-106.** This task stores what the read needs: the alert's
   `silent_since`, and the heartbeat received then.
2. **Should a change to `adapters/db.ts` need the owner's approval, now that
   it holds the lock bound and the pool listeners?** **Answer: yes, owned and
   in the ai-review `safety` filter, in a small separate pull request first**
   (option (b), not the recommended (c)). **D-105, BUG-18,** branch
   `fix/BUG-18-db-owned`.
   - D-102's reason for leaving `log.ts` out of the filter does not carry
     over. Logging's reviewer runs on every pull request, but
     `safety-reviewer` runs only when the filter matches, and `db.ts` holds a
     safety control.
   - BUG-18 adds `db.ts` to CODEOWNERS, `OWNER_APPROVAL_PATHS` and the
     `safety` filter. It edits `ai-review.yml`, so the owner merges it by
     hand (D-075).
   - This pull request changes none of those files, and must not merge
     before BUG-18 does.
3. **The watchdog's interval, within AR-06's 10–15 s?** **Answer: 10 s** (the
   recommendation). **D-107.** A silent journey's alert waits at most 10 s
   past the 5 minutes, or 20 s if a frozen process held its row, which leaves
   40 s of the 60 s target for the push.

Claude's own technical choices in this spec are recorded as D-108
(delegated, D-031; approach item 14).
