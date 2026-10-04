# LOST-02 · Lost-contact alert: every responder told once, five minutes into a silence, by a watchdog that cannot stop unnoticed

**Milestone:** M2, task 3 of 8 (D-090) · **Delivers:** LOST-02 (its server
half); AR-05 and AR-06, untracked; the bound on LOST-01's row lock; D-079's
two watchdog follow-ups; D-068's pool revisit; one way to the database
(AR-10); import rules that see installed packages (AR-02, AR-09, AR-10) ·
**Decisions:** D-007, D-019,
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
      on. This is defence in depth. The read's SQL already filters, and the
      domain decides again with the `now()` and `silent_since` the read
      returned, so an SQL predicate that drifted toward alerting early is
      caught there. It is pinned at L2 by a stub store whose read returns a
      journey silent 4:59.999: no open is attempted (review loop 1,
      `test-auditor`).
   3. **Open each journey's alert in its own transaction**, so one journey's
      failure holds up no other. **Every open, the first attempt included,
      starts with a lock limit of its own, local to that transaction:**
      `select set_config('lock_timeout', <LOCK_WAIT_LIMIT_MS>, true)`, ⚙️ 5 s
      (review loop 1, `safety-reviewer`). `skip locked` covers only the
      journey's row, and the open takes other locks:
      - each new `outbox` row references its responder's `users` row, so the
        insert takes a key-share lock on that row;
      - the alert's insert can wait on the one-unresolved-alert index.

      Without a limit, one `users` row held by anything (an account change,
      a person's `psql` session) would stop the whole sweep, and every sweep
      after it, for ever. That is loud (the beat stops), but it alerts
      nobody.
      - **Why 5 s,** the same value as the API's lock limit
        (`LOCK_WAIT_LIMIT_MS`): it is above any wait this code causes
        (milliseconds), and it caps what one held row can cost a sweep.
      - **A 55P03 in the first attempt is a failed open.** The transaction
        rolls back, and the journey stays `ACTIVE`. One `watchdog_failed`
        line is written, with stage `open` and code `55P03`. The sweep carries
        on with the next journey and counts as failed. Past 5 min 30 s the
        journey also counts as stuck (item 6).

      The steps:
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
   4. **Try once more, waiting, for each journey that was skipped and is past
      the stuck threshold** (5 min + `STUCK_AFTER_MS`, item 6). This is step
      3 again, with the same transaction-local lock limit, and one
      difference: the `select` takes the journey's row with `for update`,
      without `skip locked`, so it waits for the holder, for at most the
      limit. The worker's pool keeps no lock limit of its own (item 7).
      There are three outcomes:
      - **opened:** the holder let go within the wait and the journey was
        still overdue;
      - **skipped:** the holder let go and the journey no longer matches. A
        concurrent sweeper had opened its alert, or contact arrived.
        PostgreSQL checks the `WHERE` again against the row the holder
        committed.
      - **held:** the wait for the journey's row ran out (SQLSTATE 55P03).
        The store answers `held` rather than throwing.

      A row whose committed version no longer matches the `WHERE` is not
      waited for. PostgreSQL never locks it, so the answer is `skipped` at
      once, even while another session holds the row (`test-author`'s probe,
      review loop 1). The fake answers the same.

      Journeys under the stuck threshold are not retried. The next sweep, 10
      s later, tries them again, as it always has.
   5. **Record the beat, if the sweep succeeded** (item 6).
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
   - **A partial index for the outbox claim:** `outbox (next_attempt_at, id)
     where sent_at is null` (review loop 1, `code-reviewer`).
     - The claim runs every 10 s against a table that only grows: sent rows
       stay until retention removes them (M4).
     - The index holds only the unsent rows, in the claim's own order.
     - It goes into migration `0003`, which has not merged, regenerated with
       `pnpm --filter @trygghverdag/server db:generate`. It is not a new
       `0004`.
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
   - **A stuck journey** is an `ACTIVE` journey silent ⚙️ 30 s or more past
     the 5 minutes (`STUCK_AFTER_MS`) that this sweep could not move. There
     are two ways that happens:
     - its waiting attempt (item 3, step 4) answered `held`;
     - opening it failed with an error, in either attempt.

     A failed open includes a 55P03 in the first attempt, from a lock other
     than the journey's row (item 3). A journey skipped only because it no
     longer matched is not stuck. Each
     stuck journey gets one `watchdog_overdue` line naming its ID. So `skip
     locked` can skip a journey, but **not silently**. A lock this code does
     not control causes the same: a person's `psql` session, or a frozen
     process with no limit. The sweep counts as failed, the beat stops, and
     the owner is paged.
   - **How it tells a healthy sweeper from a frozen holder: it waits for the
     holder, briefly.** Two sweepers can race on a journey already past the
     stuck threshold, as in a deploy overlap after the worker was down. The
     loser's `skip locked` skips the row the winner holds and has not yet
     committed.
     - Counted then and there, that journey would be "stuck", and the
       healthy race AC7 calls harmless would write a `watchdog_overdue` line
       and fail a sweep.
     - The waiting attempt asks the holder instead. A healthy sweeper commits
       within milliseconds, and the loser then finds the journey
       `LOST_CONTACT`: skipped, not stuck. A heartbeat in flight is the same:
       last contact has moved, so the journey is skipped.
     - A holder on one of this code's pools that has frozen is ended by the
       idle limit within 10 s. A wait that runs out first makes one sweep
       stuck. The beat tolerates that, because a page needs 30 s with no good
       sweep (`BEAT_FRESH_MS`). The next sweep after the session ends opens
       the alert, at most 10 s idle limit plus one interval past the
       threshold: 20 s, inside the 60 s budget.
     - A holder that no limit reaches holds through every wait. That is the
       case to page for, and it does. Every sweep is stuck, the beat goes
       stale, and the monitors page as for a stopped worker (REL-08, D-079).
       No watchdog can alert that journey while the row is held. The page
       is what turns it from silent to loud.
   - **Why waiting, and not "stuck in two consecutive sweeps".** Two sweeps
     would also let a healthy race pass, but they need memory across sweeps
     in each worker. Two workers would each keep their own. It would also
     delay the page by an interval for nothing gained. Waiting asks the one
     party that knows, the holder, and it settles within the sweep that
     asked.
   - **The cost:** a sweep spends at most `LOCK_WAIT_LIMIT_MS` (5 s) on each
     lock it cannot get. For the journey's own row, that happens only past
     the stuck threshold, after every other journey in the sweep has had its
     first attempt. For a held `users` row, it can happen in a first attempt.
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
   - **Why no pool-level limit on the worker.** Corrected in review loop 1
     (`code-reviewer`): the sweep's statements do wait. The waiting attempt
     waits for the journey's row, and an open can wait for a `users` row.
     Each open bounds its own waits with the transaction-local limit of item
     3, so the sweep never waits unbounded.
     - A pool-level limit would add nothing for the sweep.
     - It would reach Graphile Worker's own statements, which share this
       pool, and could fail its start-up for reasons this task cannot see.
     - The claim takes rows with `skip locked`. The delivery's marks set no
       limit; a mark that waits for ever stalls delivery only (item 9, which
       says that loop is not watched).
   - **Why not the migrations' pool.** A deploy that waits is visible in its
     own job. A lock limit there could fail a deploy, and that is a choice for
     the task that brings expand-then-contract migrations (M5).
   - **How they are set** is the implementer's choice: node-postgres's own
     connection options (read in `pg` 8.23.0, `connection-parameters.js` lines
     121–123 and `client.js` lines 558–566, which send them at startup), or a
     `SET` on connect. Either way the values come from `domain/watchdog.ts`,
     whose L2 test holds the budget (LOST-02-AC17).
   - **Each process reads its limits back once at start, and says what is in
     force** (review loop 1, `safety-reviewer`).
     - Asking is not the same as getting. A connection pooler that silently
       drops startup parameters would leave the limits absent with every
       check green.
     - "The first deploy's job log is the evidence" overstated what that log
       showed, until now.
     - **What is read:** once, at start, on one pooled connection, with
       `select name, setting, unit from pg_settings where name in (…)`. The
       API reads `idle_in_transaction_session_timeout` and `lock_timeout`;
       the worker reads `idle_in_transaction_session_timeout`.
     - **One line on stderr, of a fixed shape:**
       - `api: session limits in force: idle_in_transaction_session_timeout=10000ms lock_timeout=5000ms`
       - `worker: session limit in force: idle_in_transaction_session_timeout=10000ms`

       Each value is written only if it is digits with the unit `ms`, `s` or
       `min`; anything else is written as `unreadable`. The line holds no
       URL, host, user, password or error message.
     - **A value other than the one asked for** gives one fixed line instead,
       per setting. For example: `api: session limit idle_in_transaction_session_timeout is 0ms, not 10000ms: a stalled transaction will not be ended.`
       The lock limit's line ends `a heartbeat may wait for a lock without
       end`.
     - **A read that fails** gives `<process>: session limits could not be
       read (<SQLSTATE or none>).`
     - **The process starts anyway, in every case.**
       - A worker that refused to start would watch no journey at all,
         which is the worst failure. The stuck check (item 6) already turns
         a row held for ever into a page.
       - An API that refused to start would refuse every heartbeat. Five
         minutes later every journey would alert.
       - So the line is the evidence, and the stuck check is the alarm.
       - Refusing to start trades a missing safety limit for an outage. The
         owner chose to start anyway, loudly (D-109, 2026-10-04).
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
     goes wrong in a run can stop a loop.
   - **Only the sweep loop is watched** (corrected in review loop 1). A sweep
     loop that stopped anyway shows as a beat that stopped. The delivery loop
     has no such signal: a delivery that is wedged, or fails every time,
     pages nobody.
     - That is harmless until M3, because `UNCONFIGURED_PUSH` answers at once
       and nothing is delivered for real.
     - From M3 it is not harmless. "Left for later tasks" gives task 8 and M3
       the checks that close it.
   - **The worker pool's budget.** graphile-worker keeps one of the worker's
     two connections for `LISTEN` (read in `dist/main.js`: `pgPool.connect`
     for "a client dedicated to listening", line 367). The two loops and
     Graphile's job fetching share the other one, one statement at a time.
     That is enough at this scale, and `POOL_SIZE` is unchanged.
   - **`stop()`, in this order:**
     1. no new run starts, **of either loop, whichever loop is in flight**.
        `runNow` has its own stopping guard. A call to it after `stop()`
        began starts nothing: from a sweep that opened an alert, from an
        `again` left by a run in flight, or from a timer that had already
        fired (review loop 1, `test-auditor` and `safety-reviewer`);
     2. the runs in flight are awaited;
     3. the runner stops, which aborts the check-in through Graphile's
        `helpers.abortSignal`, now handed to `CheckIn.checkIn(signal)`, so a
        hung Healthchecks.io no longer delays a stop;
     4. the pool is ended.
   - **A check-in that the stop aborted fails with a fixed message of its
     own:** `Healthchecks.io check-in cancelled: the worker is stopping.`
     (review loop 1, `code-reviewer`). It is not "Healthchecks.io could not
     be reached.", which would send whoever reads the log looking for a
     network fault. A timeout keeps its own message, and so does an
     unreachable host.
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
    - The log-import rule admits `worker.ts` (item 10).
    - **One way to the database: a new rule in
      `packages/config/dependency-cruiser.cjs`** (LOST-02-AC24; from BUG-18's
      privacy and security review). The limits of item 7 and the listeners of
      item 8 hold only for pools made by `createPool`. Today nothing stops a new
      file from opening a pool of its own. Such a pool would sit outside the
      connection budget (`POOL_SIZE`), outside the session limits and outside
      the error listeners, so it could hold a journey's row for ever or print
      the connection string. In production code, `apps/` and `packages/`, test
      files exempt:
      - only `apps/server/src/adapters/db.ts` may import `pg` or
        `drizzle-orm/node-postgres`, any subpath included;
      - **one named exception:** `apps/server/src/adapters/migrations.ts` may
        import `drizzle-orm/node-postgres/migrator`, and nothing else from
        that list. It is the only production file that imports any of them
        today besides `db.ts` and `worker.ts` (checked by grep on 2026-10-04).
        The migrator takes the database `db.ts` built (`createPool`,
        `createDatabase`) and opens no connection of its own;
      - only `apps/server/src/worker.ts` may import `graphile-worker`. It is
        handed `db.ts`'s pool, and would otherwise build its own from a
        connection string;
      - **`drizzle-kit` is refused in production code** (review loop 1,
        `privacy-security-reviewer`). Its `api` entry builds a `pg.Pool`:
        read in `drizzle-kit` 0.31.11, `api.js` line 72389, `new
        pg.Pool({ connectionString: …, max: 1 })`. It is a dev dependency of
        the server, which pnpm still resolves from production files during
        development and testing.
        - **One named exception:** `apps/server/drizzle.config.ts` may import
          `drizzle-kit`. It is the only file that does today (grep,
          2026-10-04). It imports `defineConfig`, and the drizzle-kit command
          reads it to generate migrations; it opens no connection itself;
      - **production code may not import a file named like a test**
        (`\.(test|spec)\.[cm]?[jt]sx?$`; review loop 1,
        `privacy-security-reviewer`). Every rule that exempts tests would
        otherwise exempt that file's own imports too. A production file
        could reach `pg` through a helper it imports from a `.test.ts`. Today
        only test files import test-named files (grep, 2026-10-04).

      **Which packages can open a connection** (corrected in review loop 1).
      Of the server's declared packages (`apps/server/package.json`), these
      can:
      - `pg`;
      - `drizzle-orm`, through `node-postgres`;
      - `graphile-worker`, from a connection string;
      - `drizzle-kit`, through its `api` entry (a dev dependency).

      `@testcontainers/postgresql` (a dev dependency) starts a database for L3
      tests, and is imported only by test files. A general rule refusing every
      dev dependency in production code was considered and not taken: the
      configuration files and the test kit import dev dependencies by design,
      and would each need an exception. pnpm does not let a package import
      what it has not declared, so `pg-pool` is not reachable from the
      server.
    - **The import rules must see installed packages, and today they cannot**
      (found by `test-author` in the red phase; LOST-02-AC25). Read in
      `packages/config/dependency-cruiser.cjs` on 2026-10-04:
      - `options.exclude.path` holds
        `(^|/)(node_modules|dist|build|coverage|\.turbo|\.expo)/`.
        depcruise resolves an installed package to its real path under
        pnpm's store (`node_modules/.pnpm/<name>@<version>…/node_modules/<name>/…`).
        The `node_modules` segment excludes that path, and an excluded module
        is not a target any rule can match.
      - The `dist` segment hides some packages a second way. graphile-worker
        0.18.0 resolves to `dist/index.js` (its `package.json`: `"main":
        "dist/index.js"`).
      - So no rule fires on a package that resolves. AC24's rule could not
        work.
      - Neither can the npm half of `domain-has-no-io`. Its `node:` half still
        works, because built-ins are not under `node_modules`.
      - Neither can `location-sdk-only-in-the-safety-core` (AR-09). It matches
        only the bare name `^react-native-background-geolocation`. That
        matches today only because the SDK is not installed and nothing
        imports it. Once M3 installs it, the rule goes blind.

      The change:
      1. **`exclude` no longer matches anything inside `node_modules`.** The
         `node_modules` segment goes, and the build-output folders (`dist`,
         `build`, `coverage`, `.turbo`, `.expo`) match only in paths that do
         not run through `node_modules`. `^apps/mobile/(android|ios)/` stays.
         `doNotFollow: { path: 'node_modules' }` stays: a package is a target
         rules can match, and its own imports are not cruised.
      2. **Every rule that names a package matches it in both forms.** One is
         the bare name depcruise reports when it cannot resolve the import.
         The other is the path it resolves to in this repository, under
         pnpm's layout. That covers:
         - AC24's rule;
         - `location-sdk-only-in-the-safety-core`;
         - `domain-has-no-io`'s allow-list (`zod`, `@trygghverdag/contracts`),
           which today names bare forms only. Without the change, a domain
           file importing `zod`, which the rule's own comment allows, would be
           refused once packages are visible.

         Not checked here: the exact path depcruise resolves each name to
         under this configuration. Its `mainFields` put `types` first, so
         `pg` may resolve to `@types/pg`. A control test against the
         repository itself settles it (LOST-02-AC25).
      3. **Test-file exemptions** (`\.(test|spec)\.[cm]?[jt]sx?$` on `from`):
         - `domain-has-no-io` gains one. Domain tests import `vitest` and the
           test kit, and with packages visible the rule fires on them
           (`test-author` saw it fire). Domain test files are never shipped,
           so the exemption takes nothing from AR-02.
         - AC24's rule is written with one.
         - `only-the-process-wires-the-log` and `test-kit-belongs-in-tests`
           already have one.
         - `location-sdk-only-in-the-safety-core` gets none. Nothing imports
           the SDK today, and M3's tests of the safety core sit inside the
           safety core.
      4. **`pnpm run imports:check` stays clean over the repository**
         (`.claude/hooks apps packages scripts`).
         - Packages becoming visible may reveal violations no rule could see
           before. `no-undeclared-dependencies` is the likely one: a package
           importing what it never declared.
         - Each one is listed in the pull request and fixed where it starts.
           A missing dependency is declared.
         - A rule is never loosened, and no exemption is widened, to make the
           check pass. If a rule turns out to be wrong, it is changed with a
           test that shows why.

14. **A decision to record: D-108** (delegated, D-031). `plan-keeper` writes
    it in this pull request. The owner's answers are D-106 and D-107, and
    BUG-18's D-105 for `adapters/db.ts` (the end of this file). It covers:
    - **The outbox is a table of our own, delivered by the worker's loop.**
      It is not Graphile jobs. D-032 named Graphile Worker for "jobs and
      outbox", and its consequences say "any swap is recorded as a new
      decision". Graphile Worker keeps the minute check-in.
    - **The watchdog feeds the beat.** This answers D-079's first follow-up,
      which leaves that choice to this task, and changes how D-065 item 4 is
      met. A stuck journey stops the beat. A skipped journey past the stuck
      threshold gets one attempt that waits at most 5 s for its holder, so a
      healthy concurrent sweeper is never counted as stuck (item 6).
    - **The two session limits,** their values, and the pools they are on.
      Every open also sets a 5 s lock limit local to its transaction (item
      3). Each process reads its limits back at start, and starts with a loud
      line rather than refusing when they are not in force (item 7).
    - **One way to the database** (item 13, LOST-02-AC24): only `db.ts`
      imports `pg` and `drizzle-orm/node-postgres`, with `migrations.ts`'s
      migrator as the one exception, and only `worker.ts` imports
      `graphile-worker`, so every pool is made by `createPool`, with the
      limits and listeners on it. `drizzle-kit` is refused outside
      `drizzle.config.ts`, and production code imports no test-named file.
      The import check stops excluding `node_modules` so that rule, and every
      rule naming a package, can see an installed one (item 13,
      LOST-02-AC25).
    - **The outbox claim's partial index** (item 4).

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
    - `openLostContactAlert({ journeyId, afterMs, lockWaitMs? })` → `{ outcome: 'opened', alertId, messages } | { outcome: 'skipped' } | { outcome: 'held' }`.
      - Every call sets the transaction-local lock limit (item 3).
      - With no `lockWaitMs` it takes the journey's row with `skip locked`,
        and never answers `held`. A 55P03 from any other lock is thrown: a
        failed open.
      - With `lockWaitMs` it waits at most that long. It answers `held` when
        the wait for the journey's row runs out (55P03, mapped, not thrown).
      - A row whose committed version no longer matches is `skipped`, never
        `held`, held or not.
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
      another transaction holds. A held row is skipped by an attempt without
      a wait, and answers `held` to one with a wait. **The exception, as in
      PostgreSQL: a held row that no longer matches** (no longer `ACTIVE`, or
      no longer overdue) **answers `skipped` to both** (review loop 1).
    - A way to hold a row that lets go during a waiting attempt, running a
      test's action first, such as moving the journey to `LOST_CONTACT` as a
      concurrent sweeper would. Its name is test-author's.
    - `failWith` and `beforeNext` for the new calls.
  - The shared behaviour suite gains the watchdog and outbox behaviours, run
    against the fake (L2) and the adapter (L3).
  - `fakeCheckIn` records the signal it was given.
  - `fakePostgres` records each connection's startup parameters, and can end
    a connection with a fatal error carrying a SQLSTATE and a message.
    Review loop 1 adds one more thing: it answers the start-up read of
    `pg_settings` with values the test chooses. That covers values as
    asked, a pooler that dropped them, text that is not a duration, and a
    failure with a SQLSTATE.

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
- **And** the domain decides again, whatever the store's read says.
  - A stub store's read returns a journey silent 4:59.999, with the `now()`
    it read. The watchdog attempts no open for it, and the sweep is ok.
  - A journey silent exactly 5:00 is opened, as the control.

  This is approach item 3, step 2: defence in depth against an SQL
  predicate that drifts.

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
- **And** this holds for journeys silent past the stuck threshold too:
  5 min 30 s, 10 minutes and an hour, as after a worker that was down.
  - Every sweep reports `ok: true` and `stuck: 0`.
  - No sweeper writes `watchdog_overdue`.
  - The beat is recorded.

  A loser that skipped such a journey waits for the winner's commit, finds
  the journey `LOST_CONTACT`, and skips it (approach item 6).

**LOST-02-AC8 — A held row is skipped, not waited for, and alerted once it is
free.** *(LOST-02)*
- **Given** overdue journeys J and K, both silent less than 5 min 30 s, and
  another transaction holding J's row `for update`. Past 5 min 30 s a held
  row is waited for, briefly: that is AC20.
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
- **And** every open, the first attempt included, sets `lock_timeout` to
  `LOCK_WAIT_LIMIT_MS` local to its own transaction.
  - At L3: while a session outside the pools holds a responder's `users`
    row `for update`, a first-attempt open of that responder's journey
    rejects within the limit plus a margin with code 55P03, and writes
    nothing. It does not wait for ever.
  - Past the transaction, the worker connection's `lock_timeout` is still 0,
    so the limit was local (L3).
- **And** each process reads its limits back once at start, and writes one
  line of approach item 7's fixed shape on stderr (in-process, through the
  fake PostgreSQL server's answer to the `pg_settings` read):
  - with the values asked for, the API's line names both values, and the
    worker's names its idle limit;
  - with a value that differs, as a pooler that dropped the startup
    parameters would leave it, one fixed mismatch line names the setting,
    the value read and the value asked for. The process still starts and
    serves: the API answers `/v1/health`, and the worker sweeps;
  - a value that is not digits with a unit is written as `unreadable`,
    never echoed;
  - a read that fails gives one line with its SQLSTATE, or none, and the
    process still starts;
  - no line holds the connection URL, its password marker or an error's
    message.

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
- **Given** J `ACTIVE`, with its row held by a session that never lets go: a
  plain client outside both pools at L3, or the fake's `hold` at L6
- **When** the watchdog sweeps at 5 min + 29.999 s of silence
- **Then** J is skipped at once, with no waiting attempt, nothing is written,
  and the beat is recorded
- **And when** it sweeps at 5 min + 30 s and later
- **Then** each sweep waits for J's row at most the lock wait limit (5 s; at
  L3 the sweep takes at least that long, and finishes within it plus a
  margin)
- **And** each such sweep writes one `watchdog_overdue` line naming J, and
  records no beat
- **And** another overdue journey in the same sweep is still opened
- **And** the first sweep after the hold ends opens J's alert, and records the
  beat again
- **And when** J, silent 5 min 30 s or more, is held by a transaction that
  lets go within the wait, then J is not stuck. There are two cases:
  - the holder commits without changing J: the waiting attempt opens J's
    alert;
  - the holder moves J to `LOST_CONTACT` with its alert, as a concurrent
    sweeper does: the waiting attempt skips J.

  Either way the sweep reports `ok: true` and `stuck: 0`, writes no
  `watchdog_overdue`, and records the beat. In the second case J has exactly
  one alert.
- **And** a held row whose committed version no longer matches gets no
  wait: the open answers `skipped` at once, not `held`. Examples are a row
  already `LOST_CONTACT`, or one whose last contact has moved. This holds
  against the fake and the adapter alike (shared behaviour suite, D-100).
- **And** a journey whose open fails because a responder's `users` row is
  held for ever (55P03 in the first attempt; AC17):
  - under 5 min 30 s, the sweep fails, with one `watchdog_failed` line,
    stage `open`, code `55P03`, and no beat. Other journeys in the sweep
    are still opened.
  - from 5 min 30 s, the same, plus one `watchdog_overdue` line naming it.

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
- **And** "no further run" holds for both loops, whichever is in flight
  when `stop()` is called. `stop()` comes while a sweep that will open an
  alert is in flight, while a delivery with an `again` pending is in
  flight, and while both are in flight. In each case no run of either loop
  starts after `stop()` began, and no timer is left set.
- **And** a call to `runNow` after `stop()` began starts nothing, on either
  loop
- **And** a check-in that hangs no longer delays the exit after SIGTERM
- **And** a check-in aborted by the stop fails with exactly `Healthchecks.io
  check-in cancelled: the worker is stopping.`. A timeout still fails with
  its own message, and an unreachable host with "could not be reached".
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
- **And** `outbox` has the claim's partial index. `pg_get_indexdef` reads
  its columns as `(next_attempt_at, id)` and its predicate as `sent_at IS
  NULL`. It is created by `0003_*.sql` itself, and no `0004_*.sql` exists.
- **And** the only columns named like a coordinate, in every table, are still
  `positions.latitude` and `positions.longitude`
- **And** on PostgreSQL 15, migration `0003` runs over a database holding
  journeys in every state with heartbeats and positions, and changes none of
  their rows (`deploy.integration.test.ts`).

### One way to the database (AR-10)

**LOST-02-AC24 — Only `db.ts` opens the database, and only `worker.ts` uses
Graphile Worker.** *(LOST-02; D-108)*
- **Given** the repository's import rules, run as `pnpm run imports:check`
  runs them (the real depcruise binary, the repository's
  `.dependency-cruiser.cjs`), over a small server written for each case in a
  temporary folder. This is how LOST-01's log-import rule is tested
  (`b28d859`, tests `a00a309`).
- **When** a module (`modules/…`), a domain file (`domain/…`) and an adapter
  other than `db.ts` (`adapters/…`) each import `pg`, then
  `drizzle-orm/node-postgres`, then `graphile-worker`, with a static import
  and with `import()`
- **Then** each is refused, naming the new rule
- **And** a file only named like one of the allowed files, in another folder,
  is refused
- **And** `adapters/migrations.ts` importing `pg` or
  `drizzle-orm/node-postgres` itself is refused
- **And** these pass:
  - `adapters/db.ts` importing `pg` and `drizzle-orm/node-postgres`;
  - `adapters/migrations.ts` importing `drizzle-orm/node-postgres/migrator`;
  - `worker.ts` importing `graphile-worker`;
  - test files importing any of the three, an integration test and a system
    test among them.
- **And** the rule matches each package both as depcruise resolves it under
  pnpm's layout (`node_modules/.pnpm/<name>@<version>/node_modules/<name>/…`,
  written into the fixture) and as a name it cannot resolve. A rule that
  matched only one form would pass its fixture and miss the other in the
  repository. The resolved form can only fire once the configuration stops
  excluding `node_modules` (LOST-02-AC25).
- **And `drizzle-kit` is refused in production code** (review loop 1):
  - a module, a domain file and an adapter importing `drizzle-kit`, and
    `drizzle-kit/api`, are refused, installed and not installed, each naming
    the rule;
  - `apps/server/drizzle.config.ts` importing `drizzle-kit` passes;
  - a file only named `drizzle.config.ts` in another folder is refused;
  - test files importing it pass.
- **And production code imports no file named like a test** (review loop 1):
  - a module, a domain file, an adapter, `api-process.ts` and `worker.ts`
    importing `./helper.test.ts` are refused, by static import and by
    `import()`, each naming the rule;
  - so is `x.spec.ts`, and a `.test.mjs`;
  - a test file importing a test-named helper passes, as `capture.test.ts`
    and `fake-postgres-server.test.ts` are imported today;
  - the control: a production file that imports a test-named helper, which
    imports `pg`, is refused by this rule. Without it, the helper's own
    import of `pg` would escape AC24's rule, which exempts test files.
- **And** `pnpm run imports:check` passes on the repository itself (L1). That
  is the control that the rules leave today's importers alone: `db.ts`,
  `migrations.ts`, `worker.ts`, `drizzle.config.ts`, and the test files that
  import `capture.test.ts` and `fake-postgres-server.test.ts`.

**LOST-02-AC25 — Installed packages reach the import rules, the location
SDK's rule included.** *(LOST-02; D-108)*
- **Given** the repository's `.dependency-cruiser.cjs`, run with the real
  depcruise over a fixture, as in AC24
- **And** in the fixture, each package an import names is installed as pnpm
  installs it: its real folder at
  `node_modules/.pnpm/<name>@<version>/node_modules/<name>/` (a
  `package.json` with `main` under `dist/`, and that file), and
  `node_modules/<name>` as a link to it
- **And** the fixture's own `package.json` declares every package it
  installs. Then "passes" means no violation at all, and a refusal names only
  the rule under test. An import of a package that is not installed is also
  refused by `not-to-unresolvable`. The test checks that the rule under test
  fires beside it, not that it fires alone.
- **Then** these are refused, each naming its rule:
  - a file outside `apps/mobile/src/safety-core/` importing
    `react-native-background-geolocation`, when it is installed (resolved)
    and when it is not (unresolved). The control: a file inside the safety
    core importing it passes, in both forms.
  - a domain production file (`apps/server/src/domain/x.ts`) importing an
    installed package other than `zod`, through `domain-has-no-io`;
  - AC24's three packages, installed, from the files AC24 refuses.
- **And** these pass:
  - a domain test file (`apps/server/src/domain/x.test.ts`) importing
    installed `vitest`;
  - a domain production file importing installed `zod`.
- **And** a package whose entry point is under `dist/` is still a target
  rules can match. An `exclude` that still hid `node_modules` or a `dist/`
  inside it fails here.
- **And** run against the repository itself, with the repository's options
  and a probe rule using AC24's and the SDK rule's `to` patterns, the probe
  fires on:
  - `apps/server/src/adapters/db.ts`'s import of `pg`;
  - `apps/server/src/worker.ts`'s import of `graphile-worker`.

  This proves the patterns match what depcruise really resolves those
  packages to here, whether `@types/pg`, a `dist/` entry or another path.
  The probe is a configuration the test builds in its temporary folder. The
  repository's files are not touched.
- **And** `pnpm run imports:check` is clean over the repository (L1), with
  no new exemption beyond `domain-has-no-io`'s test files.

## Test plan

| AC | Level | Where | How |
|----|-------|-------|-----|
| AC1 | L6, L3 | `apps/server/src/alerts.system.test.ts` (new); `apps/server/src/alerts.integration.test.ts` (new) | L6: `createApi` with the journey service, plus `createWatchdog` and `createPushSender`, all over one `fakeJourneyStore({ clock })`, with `fakePush()`, `fakeLog()` and `fakeWorkerHeartbeats()`. L3: the real adapter and modules, and `fakePush()` |
| AC2 | L2, L3 | `domain/journey.test.ts`; behaviour suite, run by `fake-journey-store.test.ts` and `journeys.integration.test.ts`; `alerts.system.test.ts` (the stub-store case) | fast-check over heartbeat schedules and sweep times. The stub-store case is in the `alerts` group's own file, so the mutation run sees it |
| AC3 | L2, L6, L3 | domain test; system test; behaviour suite | |
| AC4 | L3, L1, L6 | integration test; lint in `gate:static`; system test | Timestamps relative to `now()`; brackets. **Names REL-01** |
| AC5 | L2, L6, L3 | domain test; system test; behaviour suite | **Names SM-03** |
| AC6 | L1, L2 | `tsc`; domain test | `satisfies` over the lists, and a run-time check |
| AC7 | L6, L3 | system test; integration test | At least 2 sweepers on separate pool connections, at least 5 rounds; silences under and past 5 min 30 s (the tests below) |
| AC8 | L3, L6 | integration test; system test (`hold`) | |
| AC9 | L2, L3 | behaviour suite (`beforeNext`); integration test | **Names SM-09** |
| AC10 | L3 | integration test | Two connections; the order forced by holding transactions open. **Names SM-03, SM-09** |
| AC11 | L3 | `journeys.integration.test.ts` | Waiting proved through `pg_stat_activity.wait_event_type = 'Lock'`. **Names SM-07** |
| AC12 | L3, L6 | integration test (a trigger the test creates and removes, as SM-01-AC8's does); system test (`failWith`) | |
| AC13 | L3, L6 | integration test; system test | |
| AC14 | L6 | system test | |
| AC15 | L6, L2 | system test; `worker.test.ts` | The fake clock moved across each retry |
| AC16 | L6, L3 | system test; integration test | A push that resolves after the idle limit |
| AC17 | L3, L2, in-process | `database.integration.test.ts`; `alerts.integration.test.ts` (an open's own lock limit); `domain/watchdog.test.ts` (new); `api-process.test.ts` and `worker.test.ts` with `fakePostgres` | Limits set short for the test; the production values read from the startup parameters; the read-back line, through the fake's answer to `pg_settings` |
| AC18 | In-process, L3 | `api-process.test.ts`, `worker.test.ts`; `database.integration.test.ts` | Marker password in the URL; `console.warn` captured. **Names SEC-03** |
| AC19 | L6, L2 | system test; `worker.test.ts` | **Names REL-08** |
| AC20 | L3, L6, L2 | integration test (an unbounded `psql`-like session from the test's own client, a holder that lets go within the wait, and a held `users` row); system test (the fake's two kinds of hold); behaviour suite (a held row that no longer matches) | **Names REL-08** |
| AC21 | L2 | `worker.test.ts`, `healthchecks.test.ts` | Fake timers; stub loops; stop with either or both loops in flight; the abort signal and its fixed message observed. **Names REL-08** |
| AC22 | L1, L2, L6 | `tsc`; `log.test.ts`; system test (`captured()`) | **Names PRIV-07** |
| AC23 | L3 | `journeys.integration.test.ts`; `deploy.integration.test.ts` (PostgreSQL 15) | The claim's partial index read with `pg_get_indexdef` |
| AC24 | L1, L2 | `imports:check` in `gate:static`; `packages/config/database-imports.test.mjs` (new) | The real depcruise over a fixture, as `dependency-cruiser.test.mjs` does; the `drizzle-kit` and test-named-file rules too. **Not in that file:** see the note below |
| AC25 | L1, L2 | `imports:check`; `packages/config/database-imports.test.mjs` | Packages installed in the fixture as pnpm installs them; a probe against the repository itself |

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
- **AC24's and AC25's tests go in a new, counted file,
  `packages/config/database-imports.test.mjs`, not in
  `dependency-cruiser.test.mjs`.**
  - That file opens with `// req-coverage: fixtures-only`, and `req:coverage`
    counts no test in a file marked so (`countedTests` in
    `scripts/lib/requirements.mjs`, read 2026-10-04).
  - A `LOST-02-AC24` named only there would leave the criterion uncounted,
    and the `traceability` job would refuse this pull request
    (`uncoveredCriteria`).
  - The marker is right for that file: its header says its tests "prove an
    import rule, not a LOST-01 criterion". AC24 is a criterion of this
    task, so its tests must count.
  - The new file reuses the same approach, the real depcruise over a
    temporary fixture, and carries no marker.
  - It must name no other tracked requirement as sample data, or that
    requirement would count too.
  - Where the shared fixture code lives, copied or moved into a helper both
    files import, is `test-author`'s choice.
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

### Tests added after the red phase (settled 2026-10-04)

Two findings from `test-author`'s red phase changed the spec. These are the
tests that pin each side. The names are exact, and `test-author` may adjust
wording only, keeping the criterion and the assertions.

**Two sweepers past the stuck threshold** (AC7 against AC20; approach item 6):
1. L3, `apps/server/src/alerts.integration.test.ts`: `LOST-02-AC7: watchdogs
   sweeping at once on separate connections, on journeys silent 5 min 30 s,
   10 min and an hour, 5 times over: one alert and one message per responder
   each, every sweep ok with nothing stuck, no watchdog_overdue line, and the
   beat recorded`. At least `RACERS` sweepers, at least `RACE_ROUNDS`
   rounds.
2. L3, the same file: `LOST-02-AC20: a journey silent 5 min 30 s whose row
   is held by a transaction that commits within the lock wait without
   changing it is not stuck: the waiting attempt opens its alert, the sweep
   is ok and the beat recorded`. The holder lets go about 1 s after the
   sweep starts.
3. L3, the same file: `LOST-02-AC20: a journey silent 5 min 30 s whose row
   is held by a transaction that moves it to LOST_CONTACT with its alert and
   commits within the lock wait, as a concurrent sweeper does, is skipped,
   not stuck: exactly one alert, the sweep ok, no watchdog_overdue line`.
4. L3, the same file: `LOST-02-AC20: a journey silent 5 min 30 s held by a
   session that never lets go is stuck after the lock wait: the sweep takes
   at least LOCK_WAIT_LIMIT_MS and less than it plus a margin, another
   overdue journey in the same sweep is opened, one watchdog_overdue line
   names it, and no beat is recorded`. test-author's red AC20 test in that
   file ("with J's row held by a session outside both pools …") may become
   this one, with the timing assertions added.
5. L6, `apps/server/src/alerts.system.test.ts`: the same three cases (2, 3
   and 4), using the fake's two kinds of hold. One more case pins that
   under 5 min 30 s a held journey gets no waiting attempt: the fake records
   no attempt with `lockWaitMs`.
6. The shared behaviour suite: `LOST-02-AC20: an open with a lock wait
   answers held when the row stays held, opened when it is let go
   unchanged, and skipped when it is let go no longer overdue`. It runs
   against the fake (L2) and the adapter (L3, with a short `lockWaitMs`).

**The import rules see installed packages** (AC25; approach item 13), all in
`packages/config/database-imports.test.mjs`:
7. `LOST-02-AC25: an installed package whose entry is under dist/ is still a
   target the rules match; the repository's exclude hides nothing inside
   node_modules`.
8. `LOST-02-AC25: the location SDK, installed and not installed, is refused
   outside the safety core and allowed inside it`. Four cases.
9. `LOST-02-AC25: a domain file importing an installed package other than
   zod is refused by domain-has-no-io; a domain file importing installed zod,
   and a domain test importing installed vitest, are not`.
10. `LOST-02-AC25: AC24's three packages, installed as pnpm installs them,
    are refused from a module, a domain file and another adapter`. AC24's
    existing cases, repeated with the packages installed.
11. `LOST-02-AC25: (control) against the repository itself, a probe rule with
    the real to-patterns fires on db.ts importing pg and on worker.ts
    importing graphile-worker`.
12. AC24's existing control (`imports:check` passes over the repository)
    stays as written, and now also proves that no new exemption was needed.

### Tests added in review loop 1 (settled 2026-10-04)

From `safety-reviewer`, `privacy-security-reviewer`, `code-reviewer` and
`test-auditor` on `d71feff`. The names are exact. `test-author` may adjust
wording only, keeping the criterion and the assertions. The numbers follow
the coordinator's list of review findings.

**1. Every open sets its own lock limit** (approach item 3; AC17, AC20):
- 1a. L3, `apps/server/src/alerts.integration.test.ts`: `LOST-02-AC17: with
  a responder’s users row held for update by a session outside both pools, a
  first-attempt open of that journey fails within LOCK_WAIT_LIMIT_MS plus a
  margin with code 55P03, writes nothing, and the worker connection’s own
  lock_timeout is still 0 afterwards`.
- 1b. L3, same file: `LOST-02-AC20: a journey whose responder’s users row is
  held for ever: under 5 min 30 s the sweep fails with one watchdog_failed
  line, stage open, code 55P03, still opens the other overdue journeys and
  records no beat; from 5 min 30 s it also writes one watchdog_overdue line
  naming the journey`.

**2. Each process reads its limits back at start** (approach item 7; AC17):
- 2a. In-process, `apps/server/src/api-process.test.ts`: `LOST-02-AC17: at
  start the API reads idle_in_transaction_session_timeout and lock_timeout
  back from pg_settings and writes exactly one line: api: session limits in
  force: idle_in_transaction_session_timeout=10000ms lock_timeout=5000ms`.
- 2b. Same file: `LOST-02-AC17: when the database reports a limit other than
  the one asked for, as a pooler that dropped the startup parameters would,
  the API writes the fixed mismatch line for each such setting, and still
  starts and answers /v1/health`.
- 2c. Same file: `LOST-02-AC17: a limit that is not digits and a unit is
  written as unreadable, a failed read gives one line with its SQLSTATE, and
  no start-up line holds the connection URL, its password marker or an error
  message`.
- 2d. In-process, `apps/server/src/worker.test.ts`: the same three for the
  worker's one setting. In 2b's case the worker still sweeps.

**3. The outbox claim's partial index** (approach item 4; AC23):
- 3a. L3, `apps/server/src/adapters/journeys.integration.test.ts`:
  `LOST-02-AC23: outbox has a partial index on (next_attempt_at, id) where
  sent_at is null, created by migration 0003 itself, and no migration 0004
  exists`.

**4. Two more import rules** (approach item 13; AC24), in
`packages/config/database-imports.test.mjs`:
- 4a. `LOST-02-AC24: drizzle-kit and drizzle-kit/api, installed and not
  installed, are refused from a module, a domain file and an adapter, naming
  the rule`.
- 4b. `LOST-02-AC24: apps/server/drizzle.config.ts may import drizzle-kit; a
  file only named drizzle.config.ts in another folder may not; test files
  may`.
- 4c. `LOST-02-AC24: production code importing a file named like a test
  (.test.ts, .spec.ts, .test.mjs), by static import or import(), is refused,
  naming the rule; a test file importing one is not`.
- 4d. `LOST-02-AC24: (control) a production file that imports a test-named
  helper which imports pg is refused by the test-file rule, so the helper’s
  pg cannot escape the database rule`.
- 4e. AC24's repository control (`imports:check` passes over the repository)
  now also covers `drizzle.config.ts` and today's test-named helpers.

**5. `stop()` starts no further run of either loop** (approach item 9;
AC21), in `apps/server/src/worker.test.ts`:
- 5a. `LOST-02-AC21: stop() while a sweep that will open an alert is in
  flight: no delivery starts after stop() began, and no timer is left set`.
- 5b. `LOST-02-AC21: stop() while a delivery is in flight with another run
  pending: it does not run again, and no timer is left set`.
- 5c. `LOST-02-AC21: stop() while both loops are in flight: neither starts
  another run`.
- 5d. `LOST-02-AC21: runNow on either loop after stop() began starts
  nothing`.

**7. A check-in aborted by the stop has its own message** (approach item 9;
AC21):
- 7a. `apps/server/src/adapters/healthchecks.test.ts`: `LOST-02-AC21: a
  check-in aborted through the caller’s signal fails with exactly
  “Healthchecks.io check-in cancelled: the worker is stopping.”; a timeout
  and an unreachable host keep their own messages`.
- 7b. `apps/server/src/worker.test.ts`: `LOST-02-AC21: stopping the worker
  during a hung check-in writes the cancelled message, not “could not be
  reached”`.

**8. A held row that no longer matches is `skipped`** (approach item 3;
AC20):
- 8a. The shared behaviour suite (`packages/test-kit/src/journey-store-behaviour.ts`,
  run by `fake-journey-store.test.ts` at L2 and `journeys.integration.test.ts`
  at L3): `LOST-02-AC20: a held row that no longer matches answers skipped at
  once to an open with a lock wait, never held: one already LOST_CONTACT, and
  one whose last contact has moved`. The pinned list of behaviour names in
  `fake-journey-store.test.ts` grows with it, by design.

**9. The domain filter is defence in depth** (approach item 3, step 2;
AC2):
- 9a. `apps/server/src/alerts.system.test.ts`: `LOST-02-AC2: with a stub
  store whose read returns a journey silent 4 min 59.999 s, the watchdog
  attempts no open and the sweep is ok; a journey silent exactly 5 min is
  opened`.
  - It lives in the `alerts` mutation group's own file: a test elsewhere
    would leave the mutant that drops the domain check alive.

Items 6 and 10 change no test in this task. They are corrections, and
entries under "Left for later tasks".

### Tests added in review loop 2 (settled 2026-10-04)

From `test-auditor`'s re-audit of `3539d4f` (its should-fix and the mutants
it found alive) and the safety and privacy re-checks' notes. The names are
exact. `test-author` may adjust wording only, keeping the criterion and the
assertions. Test 1a stays as it is: its last clause cannot fail after a
rollback, and 11a is what proves it.

**11. The lock limit is the transaction's own** (approach item 3; AC17):
- 11a. L3, `apps/server/src/alerts.integration.test.ts`: `LOST-02-AC17: a
  first-attempt open and a waiting open that each commit, on a pool of one
  connection, leave that connection’s lock_timeout at 0 afterwards`.

**12. The read-back** (approach item 7; AC17), in
`apps/server/src/api-process.test.ts` and `apps/server/src/worker.test.ts`,
each for its own process:
- 12a. `LOST-02-AC17: stop() waits for a read-back still in flight: its line
  is written before stop() resolves, and the pool ends after it`.
- 12b. `LOST-02-AC17: the read-back lines go to stderr and nothing goes to
  stdout`. For the worker, through the writer `bin/worker.ts` gives it.
- 12c. `LOST-02-AC17: a limit pg_settings returns no row for is written as
  unreadable, not in force`.
- 12d. `LOST-02-AC17: a setting with anything around its digits (10000x,
  x10000, 10 000) is written as unreadable`.
- 12e. `LOST-02-AC17: a unit other than ms, s and min, including names every
  object has (constructor, toString, __proto__), is written as unreadable`.
- The API tests that do not test the read-back no longer print its line:
  their database answers pg_settings, or their stderr is captured.

**13. A waiting open that took the row and then ran out of time on another
lock is a failed open** (approach item 3; AC20):
- 13a. L3, `apps/server/src/adapters/journeys.integration.test.ts`:
  `LOST-02-AC20: a waiting open that takes the journey’s row within the
  wait, then runs out of time on a responder’s users row, fails with 55P03
  and writes nothing; it never answers held`.

**14. A claim never waits for a held message** (approach item 4; AC14):
- 14a. L3, `apps/server/src/adapters/journeys.integration.test.ts`:
  `LOST-02-AC14: a due message whose row another session holds is passed
  over at once, not waited for, and the claim returns the other due
  messages`.

**15. A lock wait PostgreSQL would read as no limit is refused** (approach
item 3; D-100):
- 15a. The shared behaviour suite (`journey-store-behaviour.ts`, at L2 and
  L3): `LOST-02-AC20: an open given a lockWaitMs that is not a whole number
  from 1 to 2147483647 (0, -1, 0.5, 1.5, NaN, 2147483648) is refused,
  naming lockWaitMs, and writes nothing`. 1.5 is there for the whole-number
  rule alone: every other fraction is also below 1 (`test-auditor`, loop 2). PostgreSQL reads a `lock_timeout` of 0 as
  no limit at all. The pinned list of behaviour names in
  `fake-journey-store.test.ts` grows with it, by design.

**16. The exclude hides nothing in a nested node_modules** (approach item
13; AC25):
- 16a. `packages/config/database-imports.test.mjs`: `LOST-02-AC25: the
  repository’s exclude matches no path inside a node_modules folder further
  down (apps/server/node_modules/<package>/dist/), and still matches the
  repository’s own dist/`.

Two code changes go with them, in `apps/server/src/adapters/db.ts` (a unit
is looked up with `Object.hasOwn`) and `apps/server/src/adapters/journeys.ts`
(the lock wait is checked before the transaction starts).

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
  `worker.ts`. The configuration change of approach item 13 should change
  none of its other tests: its fixtures install no package, and
  `^apps/mobile/(android|ios)/` stays excluded (INF-06-AC1's case). If one
  does change, the reason is written down as RG-03 asks.
- `log.test.ts`, `healthchecks.test.ts`, `fake-check-in.test.ts`,
  `fake-postgres.test.ts` and `db.test.ts`: where they pin the event list,
  the check-in's signature, the fakes' abilities, or `createPool`'s
  signature.
- `api-process.test.ts`, BUG-12's "the health check reads the time from the
  database…" (review loop 1): the API now reads its limits back from
  `pg_settings` at start (approach item 7, D-109), and that read can be the
  first query. The test takes the first query other than that read, which
  must still be the health check's `now()`.

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
| `apps/server/src/adapters/healthchecks.ts` | Takes the abort signal; a check-in the signal aborts gets its own fixed message | **yes** | **yes** | `healthchecks` |
| `apps/server/src/db/schema.ts` | `alerts`, `outbox`, two enums; the claim's partial index on `outbox` | **yes** | **yes** | no |
| `apps/server/src/db/migrations/0003_*.sql`, `meta/*` | Generated with `pnpm --filter @trygghverdag/server db:generate`; regenerated in review loop 1 to hold the claim's partial index (no `0004`) | **yes** | **yes** | no |
| `apps/server/src/worker.ts` | The loops (with `runNow`'s stopping guard), the beat, the check-in rule, the default push, the pool's options, the start-up read-back line | **yes** | **yes** | `process` |
| `apps/server/src/api-process.ts` | The pool's options and log; the start-up read-back line | **yes** | **yes** | `api-process` |
| `apps/server/src/log.ts` | Five events | **yes** (D-102) | no (D-102) | no |
| `packages/config/dependency-cruiser.cjs` | `worker.ts` may import `log.ts`; the rules of LOST-02-AC24 (one way to the database; `drizzle-kit` only in `drizzle.config.ts`; no test-named file imported by production code); LOST-02-AC25: `exclude` hides nothing inside `node_modules`, the package rules match both forms, and `domain-has-no-io` exempts test files | **yes** | no | — |
| `packages/config/dependency-cruiser.test.mjs` | The log-import rule admits `worker.ts` (test-author) | **yes** | no | — |
| `packages/config/database-imports.test.mjs` (new) | LOST-02-AC24 and AC25, counted by `req:coverage` (test-author) | **yes** | no | — |
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
- **The platform may refuse the startup parameters, or drop them.** Whether
  a connection pooler sits in front of Clever Cloud's PostgreSQL was **not
  checked**: sessions never reach `api.clever-cloud.com`.
  - A pooler that rejected the parameters would fail every connection. The
    deploy's smoke test and `/v1/health` would go red at once.
  - One that silently dropped them would leave the limits absent, with every
    check green. Since review loop 1, each process reads its limits back at
    start and says what is in force, or that they differ (approach item 7).
    The processes write that line to their own log at start: Clever Cloud's
    application log, and the deploy job's log only if it streams the app's
    output, which is not verified. It is where the evidence is expected,
    not where it has been seen. **After the first staging deploy that
    carries LOST-02, the orchestrating session finds every line starting
    `api: session limit` or `worker: session limit` and quotes them in
    `docs/progress/m2.md`.** The search is for the singular prefix, which
    also finds the plural "limits in force" line. It expects exactly these
    two lines:
    - `api: session limits in force: idle_in_transaction_session_timeout=10000ms lock_timeout=5000ms`
    - `worker: session limit in force: idle_in_transaction_session_timeout=10000ms`

    Any other line, or no line at all, opens a bug (`safety-reviewer`,
    loop-1 and loop-2 re-checks).
  - A `SET` on connect is the fallback for a pooler that rejects the
    parameters.
- **A legitimate transaction ended by the limit** on a starved instance (D-077
  notes reduced CPU on small plans). A heartbeat gets a 500 and the phone
  resends; a sweep is retried in 10 s. Loud, and nothing is lost.
- **The import check sees more than it did** (approach item 13, AC25). Until
  now no rule could see an installed package, so
  `no-undeclared-dependencies` and `domain-has-no-io`'s npm half have
  checked nothing for installed packages since M0. Making them see may
  surface violations in code this task does not touch. Each is fixed at its
  cause and listed in the pull request. If there are many, that is reported
  to the owner, not silenced.
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

### Left for later tasks (from review loop 1)

Each is named here so the task that owns it finds it. None blocks this task.

- **Task 8, the canary, must go red when delivery is wedged or always
  failing** (`safety-reviewer`). The beat watches the sweep loop only.
  Nothing watches the delivery loop (approach item 9). An alert that opens
  and is never pushed pages nobody until the canary checks that its test
  responder was actually pushed to.
- **M3's push adapter must bound each send with a time limit of its own,**
  as the Healthchecks.io adapter does. A send that never answers would
  otherwise wedge the delivery loop, unseen until task 8's check exists.
- **M3's adapter test must check what reaches Apple and Google**
  (`privacy-security-reviewer`). For every message, the payload, the request
  headers and the collapse ID must carry neither `recipientId` nor any
  personal detail, and the collapse ID must be the `messageId`. This task
  checks the port's message (AC14). What the adapter sends from it is M3's.
- **M4, retention: account deletion and the outbox** (`privacy-security-reviewer`).
  - The new foreign keys are `on delete no action`, as SM-01's are.
  - So deleting a user is refused while any `outbox` row names them as
    recipient, and deleting a journey while an alert references it.
  - M4 decides the order of deletion, or a cascade, with the retention job
    (the M2 log already lists account deletion for the login task).
- **M4, retention: "last known position" in the alert record**
  (`privacy-security-reviewer`).
  - The retention rule lists "who was alerted, when, last known position"
    among alert records kept 30 days.
  - `alerts` copies no position: coordinates live in `positions` alone, by
    LOST-01's design.
  - Positions are deleted 24 hours after a journey ends, so from then on an
    alert record has no last known position.
  - M4 decides which way to go, and writes it into the DPIA:
    - keep a position with the alert for 30 days, which would mean a second
      place for coordinates;
    - or read the rule's "last known position" as lasting only as long as
      the positions do.
  - This is a privacy decision, so it is the owner's.
- **Settled by the owner (D-109, 2026-10-04): a process whose session limits
  are not in force starts anyway, with a loud line** (approach item 7). A
  worker that refused would watch nothing, and the stuck check pages for the
  one harm a missing limit can cause, a row held for ever.

From the loop-1 re-checks (`safety-reviewer` and `privacy-security-reviewer`
on `3539d4f`). Notes, not findings; none has a task yet, so each is the
owner's to schedule:
- **Two routes still get past AC24's rules** (`privacy-security-reviewer`,
  probed in a copy of the repository):
  - a production file may import `apps/server/drizzle.config.ts`, because
    the drizzle-kit exception covers that whole file, not only its config
    entry (the file is owned, by D-097);
  - a file in a folder outside `apps/` and `packages/`, such as `scripts/`,
    can import a package by a relative path into a workspace's
    `node_modules`, and a production file can import that file: every rule
    `from` production code skips those folders.
- **One held users row costs a sweep up to 5 s per overdue journey naming
  that responder** (`safety-reviewer`). The opens run one after another and
  the overdue read has no order, so the journeys behind them wait.
  - Each such open fails (AC19), and past 5 min 30 s the journey is stuck
    (AC20).
  - The owner is paged through the stopped beat. That journey's responders
    hear nothing until the row is free.
  - So it is loud, not silent. Ordering the read, or opening in parallel, is
    for a later task.
- **The pools' own limits would take 0 too** (`safety-reviewer`, loop 2).
  `createPool` would send a `lockTimeoutMs` or `idleInTransactionMs` of 0,
  and the read-back would call `lock_timeout=0ms` in force, though PostgreSQL
  reads 0 as no limit. Today's values (5000 and 10000) are pinned by the
  exact start-up lines, so this cannot happen without a red test. A later
  task should refuse anything outside 1 to 2147483647 in `createPool`, as the
  open now does.
- **graphile-worker's own LISTEN connection logs its error object**
  (`privacy-security-reviewer`, loops 1 and 2).
  - When that connection drops, or cannot connect (at start, and at every
    retry, backing off up to 60 s, for as long as the database is out of
    reach), Graphile's logger prints the message and the whole error object
    to the console.
  - That object can name the database's host and port, or, in PostgreSQL's
    login errors, the database user. It never holds personal data or the
    password: the reviewer checked with a marker password. The connection
    runs only `LISTEN` and `UNLISTEN`.
  - It was the same before this task. But for that connection, "one
    `database_error` line per lost connection" (AC18) is not the only line.
  - Passing Graphile a logger that writes closed events only would close
    both cases.
- **For the owner: should `adapters/db.ts` be mutation-tested?**
  (`safety-reviewer`). The read-back (`sessionLimitsLines`) lives there,
  and `db.ts` is not in `SAFETY_PATHS`, so no mutation run measures its
  tests. Test 2b and loop 2's tests 12a to 12e catch the harms named so
  far. The same question as `log.ts`'s, still open from LOST-01.

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
