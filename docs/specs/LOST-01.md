# LOST-01 · Heartbeat: stored once, in database-time order, with or without a position, and none of it in a log

**Milestone:** M2, task 2 of 8 (D-090) · **Delivers:** LOST-01 (its server
half), SM-03, SM-07 (for heartbeats), SM-08 (for heartbeats), SM-09 (for
heartbeats), PRIV-07 (for locations in the API process); SEC-07's heartbeat half
· **Decisions:** D-021, D-030, D-031, D-032, D-033, D-036, D-042, D-068, D-075,
D-077, D-086, D-089, D-090, D-091, D-092, D-094, D-095, D-096, D-097, D-098,
D-099, D-100, D-101, D-102, D-103 · **Written:** 2026-10-02 · **Finalised:**
2026-10-03, with the owner's answers (D-101, D-102 and its amendment, D-103)
· **Status:** 📝 Spec, settled; review loop 1 applied (2026-10-03).

*Task numbers (noted 2026-10-10):* written when M2 had eight tasks (D-090);
since D-115 it has nine. This spec's "task 8" is the staging canary, task 9
today, and its "of 8" is "of 9" (D-128).

## Requirement

### The rules this task delivers

**LOST-01** (`docs/plan/01b-mvp-scope.md`, LOST section, Must):

> During a journey the phone sends position and battery level at least every
> ⚙️ 60 seconds.

**SM-03** (`docs/plan/05-architecture.md`, edge-case rules, binding under D-033):

> Heartbeats keep a journey ACTIVE even without a position; "location
> unavailable" is a flag ([the location-loss rule]).

**SM-07** (same table):

> Events that arrive after ENDED are ignored and logged without location; late
> positions are discarded.

**SM-08** (same table):

> Every event carries an ID. Duplicates have no effect.

**SM-09** (same table):

> Events are applied in the order the server receives them, using database time.

**PRIV-07** (`docs/plan/02-norway-law-privacy.md`, privacy table, binding under
D-018):

> Logs and error reports never contain precise locations or phone numbers.

The rules' texts name other requirements by ID. They are replaced by names here,
for the reason under "How this spec names requirements".

### The owner's scope (D-090, item 2, and the roadmap)

D-090, item 2 (accepted by the owner, 2026-10-01):

> **LOST-01 — Heartbeat,** with or without position (SM-03); duplicates have no
> effect (SM-08); database-time order (SM-09); events after ENDED ignored and
> logged without location (SM-07); location kept out of logs before the first
> task that binds one ships (PRIV-07, D-077 item 14). Inputs:
> `04b-spike-results.md` §4.5, including never echoing a
> `background_geolocation` key.

`docs/plan/10-roadmap.md`, "M2 — Core safety loop in detail", row 2, **done
when:**

> A heartbeat is stored once, in database-time order, and none of it reaches a
> log

### Inputs this spec builds on

- **D-021:** "Responders are alerted when the server has heard nothing from a
  journey for 5 minutes." Its consequence: the ⚙️ 60 s interval must leave
  several chances to report inside those 5 minutes. That is the phone's
  cadence. This task stores what arrives; the 5-minute decision is task 3's.
- **REL-01** (binding, D-022): "The lost-contact decision is made by the
  server, using the server's clock, never the phone's." AR-03: domain code
  never reads the clock.
- **SEC-07** (binding): "Every request is authenticated per device, and the
  server validates what it receives." SM-01's spec, reading 4, left
  "validating heartbeats" to this task.
- **§4.5 of the spike results** ("The shape of the upload, field names only
  (for M2)"): the platform, the SDK's record ID, the phone's recorded time,
  whether a position was carried, `moving`, and the status fields in
  `http.params.app`. `moving` "is behavioural data: M2 should keep it only
  where a rule actually needs it, not by default". And the warning, quoted:

  > The SDK can run remote commands that arrive in its own HTTP response body.
  > M2's heartbeat endpoint must never echo or return a
  > `background_geolocation` key, or anything that looks like one, in its
  > response — and it must use TLS with per-device authentication (the
  > faked-heartbeats threat), which this spike's cleartext loopback
  > deliberately does not have.
- **D-077, item 14:** process failures are redacted for passwords only. Graphile
  Worker's logger, Hono's and `@hono/node-server`'s error printing, and Node's
  uncaught-exception printer are not. "Drizzle's query errors put the query's
  parameters in the message … the first M2 task that binds a location or a
  phone number meets this before it ships." This is that task.
- **What the reviewers left for task 2** (`docs/progress/m2.md`, "What the
  reviewers left for later tasks"):
  - "Log an error's class and code, never its raw message." Adopted
    (approach item 8).
  - "**A heartbeat for an ended journey gets a distinct non-2xx answer** that
    the app shows the walker. Never a quiet `200`." Adopted (item 2).
  - Checking the bearer value's shape before the lookup ("optionally") and the
    dependency-cruiser import rule: not taken up (see "Out of scope").
- **SM-01's spec**, "Out of scope", sent four items here: validating
  heartbeats, the duplicate-event and arrival-order rules, the after-ended rule,
  and "whether a journey accepts heartbeats only from the device that started
  it. Task 2 adds a column if so." **D-101 answers it: yes,** only the device
  that started the journey.

### Readings this spec makes

Each is stated so the reviewers can check it, not assumed quietly.

1. **LOST-01 has a phone half and a server half. This task delivers the server
   half.** Sending at least every 60 seconds is the phone's job: the safety
   core and the SDK's settings (§4.6, M3). Here the server accepts,
   authenticates, validates and stores what arrives. The server does not
   enforce the cadence. The only server rule that depends on it is the
   5-minute silence (task 3).
2. **A heartbeat is one upload.** It carries:
   - an event ID;
   - the journey it belongs to;
   - the battery level, or "unknown";
   - a position, or none.

   A position is a latitude, a longitude, an accuracy, and the time the phone
   recorded it. That matches the positions row the data model already plans
   ("Time, latitude, longitude, accuracy, battery", Section 5).
3. **"No effect" (SM-08) includes not advancing last contact.** A resent event
   proves the phone can reach the server. It still changes nothing: SM-08 says
   no effect, and that is also what stops a replayed request from faking
   contact (SEC-07). The cost is under "Risks". D-103 reads SM-08 as "every
   event must be safe to receive twice"; for a heartbeat, which has no
   natural key, the event ID is how it gets there.
4. **"Database-time order" (SM-09) means three things:**
   - the receive time comes from the injected clock, which in the API is the
     database's;
   - a journey's last contact never moves backwards;
   - the latest heartbeat is the one with the greatest receive time. Ties go
     to the order of arrival.

   The phone's recorded time decides nothing. It is kept beside the position
   only as that position's label (REL-01).
5. **"None of it reaches a log" covers every field of the heartbeat, not only
   the location.** No coordinate, accuracy, phone time, battery level or event
   ID reaches stdout, stderr or the console, on any path. That holds for
   successes and failures alike. The one line SM-07 asks for names only the
   journey's ID and the reason. This is stricter than PRIV-07 (locations and
   phone numbers) on purpose: the roadmap says "none of it".
6. **"Location unavailable" is derived, not stored.** It is true when the
   journey's latest heartbeat (reading 4) has no position. A stored column
   would need its own ordering rule for heartbeats that commit out of order. A
   derived value has one source of truth: the heartbeats themselves.
7. **A journey in `LOST_CONTACT` takes a heartbeat and stays in
   `LOST_CONTACT`.** D-033's table moves it to `ACTIVE`. That move resolves
   the alert and tells the responders, which is the back-in-contact story
   (task 4). Until task 4:
   - the heartbeat is stored and last contact advances;
   - the open alert stays open. That is the safe direction: a false alarm
     that stays loud, not an alert closed silently.

   Nothing reaches `LOST_CONTACT` before task 3, so this row is only reached
   by tests here.
8. **SEC-07's heartbeat half:**
   - the existing credential middleware covers the new route;
   - the walker is always the device's own user;
   - a device can only report on its own walker's journey, and only if it is
     the device that started that journey (D-101);
   - the body is validated strictly.

   SM-01-AC9's test reads routes from the contract, so it calls the new route
   with no change.

### How this spec names requirements, and why

The `traceability` job runs `req:coverage --fail-on-uncovered-changed`. It fails
if a changed spec names a tracked requirement, or an acceptance criterion, that
no test names (`scripts/lib/requirements.mjs`: `uncoveredInChanges`,
`uncoveredCriteria`). This was read in the code, not run: this planning session
writes one file only. `docs/requirements-status.md` was read on 2026-10-02.

- **Delivered here, and each must be named by a test:** LOST-01, SM-03, SM-07,
  SM-08, SM-09 and PRIV-07. All six are ⚪ today.
- **Cited, already covered, and not claimed:** SM-01 (7 tests), SM-02 (4),
  SEC-03 (5), SEC-06 (1), SEC-07 (4), REL-01 (4), REL-08 (4). Naming them cannot
  fail the gate. SEC-07's heartbeat half is delivered here, and the tests that
  prove it name SEC-07 too.
- **Untracked, named freely:** AR-, D-, F-, RG-, HK- and CI- IDs (D-074).
- **Every other tracked requirement is named in words**, as SM-01's spec did:

| Name used here | Where it lives |
|---|---|
| the lost-contact story | `01b-mvp-scope.md`, LOST section, 2nd story (task 3) |
| the back-in-contact story | LOST section, 3rd story (task 4) |
| the low-battery story | LOST section, 4th story (M3) |
| the offline story | LOST section, 5th story (M3) |
| the "They're safe" story | LOST section, 8th story (task 7) |
| the what-responders-see story | JRN section, 3rd story (M3) |
| the login task | GRP section, 1st story (M3) |
| the permission-check story | GRP section, 3rd story (M3) |
| the location-loss rule | `03-safety-reliability-security.md`, reliability table, 5th row |
| the offline-queue rule | same table, 2nd row |
| the accuracy-and-age rule | same table, 11th row |
| the canary rule | same table, 10th row (task 8) |
| the journey-only rule, the walker-only rule, the responders-only rule, the retention rule | `02-norway-law-privacy.md`, privacy table, 1st to 4th rows |
| the encryption rule, the DPIA rule | same table, 8th and 11th rows |
| the back-in-contact end rule, the two-hour rule, the 24-hour rule, the resumed-escalation rule | `05-architecture.md`, edge-case rules, 4th, 5th, 6th and 10th rows |

**Partial delivery shows as full.** Once tests name them, the six rows turn 🟢.
These halves remain:
- LOST-01's phone half (M3);
- PRIV-07's phone-number half (the login task) and its worker half (the first
  task whose worker binds a location);
- SM-07 and SM-08 for events other than the heartbeat ("I'm home", "I'm on
  it", "They're safe");
- the walker's warning and the responders' view under the location-loss rule
  (M3).

"Out of scope" lists each one.

## Approach (technical choices delegated to Claude, D-031)

1. **The route: `POST /v1/heartbeats`, contract path `/heartbeats`, built on
   `deviceRoute`.** The journey is named **in the body**, not in the path.
   - The location SDK posts to one URL it holds at sync time (§4.6:
     `http.url`).
   - A record queued during one journey and sent after the next one started
     would reach the next journey's path. It would then be counted there, as
     contact for a journey it does not belong to.
   - A journey ID that travels inside the record is bound when the record is
     made. How the app binds it (the SDK's per-record extras, or its body
     template) is M3's to set and verify.
   - No heartbeat value is ever in a URL or a header. Access logs, Clever
     Cloud's own included, therefore see none of it.

2. **The answers.** Every one of them is a fixed shape. None carries a key or
   a value from the request.

   | Status | Code / body | When |
   |---|---|---|
   | 200 | `{ "outcome": "RECORDED" }` | Stored |
   | 200 | `{ "outcome": "DUPLICATE" }` | This journey already has this event ID; nothing changed (SM-08) |
   | 400 | `BAD_REQUEST`, fixed message, **no `data`** | The body fails the schema |
   | 401 | `UNAUTHORIZED` (unchanged, D-091) | No valid device credential |
   | 403 | `NOT_THE_JOURNEYS_DEVICE` | Another device of the same walker (D-101). Nothing stored |
   | 404 | `JOURNEY_NOT_FOUND` | No such journey, or another walker's. One body for both, so it says nothing about other walkers |
   | 409 | `JOURNEY_ENDED` | The journey has ended (SM-07). Nothing stored |
   | 500 | unchanged | The clock, the read or the write failed. Nothing stored |

   - **Why a duplicate is 200:** the phone must drop a record the server
     already has. Otherwise the SDK keeps it and resends it for ever.
   - **Why an ended journey is 409, not 200:** the reviewers' note above. A
     quiet 200 would let an app, or the SDK, carry on as though someone were
     watching. The cost is that the SDK keeps the refused record until the app
     acts. On a `JOURNEY_ENDED` the app must stop tracking, empty the queue
     and tell the walker. That is M3's (§4.6 already asks M3 to empty the
     queue when a journey ends).
   - **Why 400 has no `data`:** read in
     `node_modules/.pnpm/@orpc+server@1.15.3…/dist/shared/server.DEBcqOjg.mjs`,
     lines 162–171. oRPC 1.15.3 puts the validator's issues into
     `BAD_REQUEST`'s `data.issues`. zod's unknown-key issue names the key. So
     today a body holding a `background_geolocation` key would get a 400 that
     names it, which is the echo §4.5 forbids. The heartbeat route's 400
     carries the code and a fixed message only. The mechanism is the
     implementer's: an interceptor on this procedure, or validation inside the
     handler against the contract's schema. If it is applied to every route,
     SM-01's tests must still pass, and the pull request says so.

3. **The request (strict, SEC-07):**

   | Field | Rule |
   |---|---|
   | `journeyId` | A UUID, lower-cased at the contract (as SM-01's `responderIds`) |
   | `eventId` | 1 to `MAX_EVENT_ID_LENGTH` (64) characters, each `A–Z`, `a–z`, `0–9` or `-`; compared exactly, case and all |
   | `batteryLevel` | A number from 0 to 1, or `null` for unknown. Required |
   | `position` | An object, or `null` for none. Required |
   | `position.latitude` | Finite, −90 to 90 |
   | `position.longitude` | Finite, −180 to 180 |
   | `position.accuracyMeters` | Finite, ≥ 0 |
   | `position.recordedAt` | RFC 3339 with an offset, whose instant in UTC falls in the years 0001 to 9999. Any such time is accepted, however far it is from the database clock. Outside that range PostgreSQL's `timestamptz` refuses it (22008 for year 0; 22009, "time zone displacement out of range", for year 10000, read on PostgreSQL 16.13 by `test-author`), so the contract refuses it first, with a 400 (review loop 1). What that gains is a truthful contract, which M3's L5 check of the real upload can test against, and no database error in the path. It does **not** stop the resending: the SDK keeps a refused record and resends it whatever the status (risk F8), so a 400 blocks that phone's queue until the M3 app acts on it, and it leaves no server log line where the 500 left `heartbeat_failed`. No realistic phone clock reaches year 0 or 10000, and from task 3 a blocked queue is a loud false alarm, which is the safe direction (`safety-reviewer`, loop 1 re-check) |

   - **Why that event-ID pattern:** it is the spike receiver's `RECORD_ID`
     (`spikes/background-safety/receiver/receiver.mjs`). Every SDK record in
     40 runs passed it: the receiver would have refused the rest, and S4 lost
     none. It also has no `.` or `_`, so neither a coordinate nor the text
     `background_geolocation` can travel as an event ID.
   - **Why no bound on the phone's time:** refusing a wrong phone clock would
     be a decision made on the phone's clock (REL-01). It would also wedge the
     phone's queue (Risks).
   - **Not accepted** (data minimisation, §4.5's own advice): the platform,
     `moving`, the queue count, the location permission and the
     battery-optimisation exemption. No rule in this task needs any of them. A
     later task that needs one adds it as an optional field, which is
     additive.
   - Example, all synthetic (RG-07). The position is open sea in the Gulf of
     Guinea, near 0° 0′:

     ```json
     {
       "journeyId": "<the journey's ID>",
       "eventId": "synthetic-event-0001",
       "batteryLevel": 0.5,
       "position": {
         "latitude": 0.1234567,
         "longitude": -0.7654321,
         "accuracyMeters": 12.5,
         "recordedAt": "2026-10-01T21:41:00.000Z"
       }
     }
     ```

4. **The state machine: `heartbeat` joins `JOURNEY_EVENTS`**
   (`domain/journey.ts`).
   - `transition` gets back the `switch` SM-01 left a note for: one case per
     event, and a default holding `const unhandled: never = event;` that
     **throws**, never returns.
   - The heartbeat's situation is the journey it names (`id`, `state`,
     `walkerId`, `deviceId`), or `null`. Its event is `{ type: 'heartbeat',
     walkerId, deviceId }`, the device's own user and device.
   - The rule, in its order. The order is part of the rule:
     1. No journey, or another walker's → refused, `JOURNEY_NOT_FOUND`.
     2. `ENDED` → ignored, `JOURNEY_ENDED` (SM-07). An ended journey is
        reported before anything else the heartbeat holds, as SM-01 reports an
        unended journey first.
     3. `deviceId` is not the journey's starting device → refused,
        `NOT_THE_JOURNEYS_DEVICE` (D-101).
     4. Otherwise → recorded. The state is unchanged: `ACTIVE` stays `ACTIVE`
        (SM-03), and `LOST_CONTACT` stays `LOST_CONTACT` until task 4
        (reading 7).
   - The domain does not see the position, the battery or the event ID, and
     takes no time. Whether a heartbeat has a position changes no outcome.
     That is SM-03, held by construction.
   - Every outcome is a value. No input makes `transition` throw or return
     `undefined`.

5. **The module (`modules/journeys/`, clock-free by lint since D-092):**
   `JourneyService.heartbeat({ walkerId, deviceId, heartbeat })`.
   1. Read `receivedAt` once, from the injected `Clock`, **first**: the moment
      it arrived. The process clock is never used (AR-03, REL-01).
   2. Read the journey it names (`journeyForHeartbeat`).
   3. Ask `transition`. A refusal is returned. `JOURNEY_ENDED` also writes the
      SM-07 log line (item 8).
   4. Store it (`recordHeartbeat`). The answer is `recorded`, `duplicate`, or
      `ended`. `ended` means the journey ended between steps 2 and 4. It is
      treated exactly like step 3's `JOURNEY_ENDED`, log line included.
   5. If step 1, 2 or 4 fails: write one `heartbeat_failed` line (item 8),
      then fail. The API answers 500. Never a 2xx, and never a 401.

6. **The store: three methods on `JourneyStore`, in
   `adapters/journeys.ts`.** Not a new adapter file: this one is already
   owner-approved and in the safety filter (D-092). A new file would be
   neither (see "Owner approval").
   - `journeyForHeartbeat(journeyId)` → `{ id, walkerId, deviceId, state } |
     null`. Any state, `ENDED` included.
   - `recordHeartbeat({ journeyId, eventId, receivedAt, batteryLevel,
     position })` → `{ outcome: 'recorded' | 'duplicate' | 'ended' }`, in
     **one transaction**:
     1. `select … from journeys where id = $1 for update`. This locks the
        journey's row. If it is `ENDED`, answer `ended` and write nothing. A
        row that has vanished is an error, not a guess: nothing deletes
        journeys before the retention work in M4.
     2. Insert the heartbeat with `on conflict (journey_id, event_id) do
        nothing`. If nothing was inserted, answer `duplicate` and write
        nothing else. A duplicate does not even advance last contact (reading
        3).
     3. Insert the position, if there is one.
     4. `update journeys set last_heartbeat_at = greatest(last_heartbeat_at, $t)
        where id = $1` (PostgreSQL's GREATEST ignores NULLs, so the first
        heartbeat sets it; review loop 1). Last contact never moves backwards, even when
        two heartbeats take the lock in the reverse order of their receive
        times (SM-09).
   - `latestHeartbeatOf(journeyId)` → `{ receivedAt, hasPosition, batteryLevel }
     | null`. Ordered by `received_at desc, id desc`. **It returns no
     coordinates.** The location-unavailable flag is `!hasPosition` (reading
     6). Reading a position back is for the module that checks journey access
     (the responders-only rule, AR-11), which is not built here.
   - **Any database error inside `recordHeartbeat` is replaced** by a
     `HeartbeatStoreError`. That error has:
     - a fixed message;
     - `code`: PostgreSQL's SQLSTATE when it is exactly five of `0–9A–Z`, and
       `null` otherwise;
     - **no `cause`** and no other property.

     Why: PostgreSQL's own error for a failed insert can hold the row
     ("Failing row contains (…)"), and Drizzle's names the parameters. Either
     would carry the coordinates into whatever prints the error. Cleaning the
     error where it starts covers every place it could be printed at once:
     Hono's default error handler, Node's uncaught-exception printer,
     `describeFailure`. No list of those places has to be complete.
   - **The row lock is the point where task 3 meets this task.** Every
     heartbeat locks its journey's row. The watchdog's `for update skip
     locked` will then skip a journey whose heartbeat is being written. That
     is correct only while the transaction is short. The code keeps it short
     (no clock read inside it), but nothing yet *bounds* it: the API's pool
     sets no `idle_in_transaction_session_timeout` or `lock_timeout`. An API
     instance that froze mid-transaction would hold the row until PostgreSQL
     noticed the dead connection, and the watchdog would skip that journey
     the whole time: a missed alert that shows up nowhere. Nothing goes wrong
     in this task, which has no watchdog. **Task 3, the lost-contact watchdog, must bound the
     lock before it merges**, with an L3 test that a stalled heartbeat
     transaction is ended and the row freed, or must not let `skip locked`
     skip a journey indefinitely (`safety-reviewer`, review loop 1; AR-06).
     Its from-state `where` meets the same row.

7. **The tables** (migration `0002_*.sql`, generated by `drizzle-kit` and
   committed):

   | Table | Columns | Constraints |
   |---|---|---|
   | `journeys` (changed) | + `last_heartbeat_at` (database time, null until the first heartbeat); + `device_id`, the device that started the journey (D-101) | `device_id` not null, no default, references `devices` |
   | `heartbeats` (new) | `id` (bigint identity: the arrival order), `journey_id`, `event_id`, `received_at` (database time), `battery_level` (null = unknown) | `journey_id` references `journeys`; **unique (`journey_id`, `event_id`)**; `event_id` matches the contract's pattern; `battery_level` from 0 to 1; an index on (`journey_id`, `received_at` desc, `id` desc) for the latest |
   | `positions` (new) | `heartbeat_id`, `latitude`, `longitude` (double precision), `accuracy_m`, `recorded_at` (**the phone's clock**, a label only) | `heartbeat_id` is the primary key and references `heartbeats`; latitude, longitude and accuracy are bounded as in the contract |

   - **Coordinates live in one table, `positions`, and nowhere else.**
     LOST-01-AC18 checks it, so the retention rule's 24-hour deletion (M4) has
     one target.
   - **The rest of a heartbeat (times, battery) holds no location.** It can
     outlive the position, and the heartbeat-gap measurement (L10) needs
     exactly that.
   - **Battery is on `heartbeats`, not `positions` (as the data-model sketch
     has it).** A heartbeat without a position still reports its battery.
   - **The start path records its device (D-101).** `api.ts` hands the
     module `context.device.deviceId` beside the walker, and
     `JourneyService.start` hands it to `insertStarted`, which writes it in the
     same transaction as the journey and its responders. SM-01's request,
     answers and contract do not change (D-103). The device is never read from
     the body.

   **What the migration does with journeys that already exist (D-101: "the
   migration must be safe with journeys that already exist").** It refuses to
   run. Nothing is backfilled, ended or deleted:
   - `device_id` is added `not null`, with **no default and no `update`**.
     PostgreSQL then refuses the `alter` if any journey row exists
     (`not_null_violation`, SQLSTATE 23502, naming `device_id`).
   - **Read, not run:** drizzle-orm 0.45.3 applies every pending migration in
     one transaction (`pg-core/dialect.js`, line 60, `session.transaction`).
     So the refusal rolls back the whole of `0002`: no `device_id`, no
     `heartbeats`, no `positions`, and the migrations journal still ends at
     `0001`. The database is left exactly as it was.
   - On Clever Cloud the migration is the pre-run hook, so the deploy stops
     there (D-077, item 12) and the `deploy-staging` job goes red. New code
     never starts against the old schema.

   **Why refuse rather than fill in.** No record says which device started an
   existing journey: SM-01 stores the walker, not the device. Any value written
   in would be a guess, and a wrong guess is exactly D-101's failure:
   - a device that is not walking would be accepted, and could hide the
     walking phone's silence (a missed alert);
   - or the walking phone would be refused, and its journey would go silent (a
     false alarm).

   Even "the walker's only device" is a guess: rows put in by hand or by a
   test cannot be told apart from rows the API wrote. The other two ways out
   are worse:
   - **ending** existing journeys would silently stop protection for someone
     who believes they are being watched;
   - **deleting** them would destroy records without anyone deciding to.

   **What is expected, and what is not known.** No journey can exist on
   staging: nobody can hold a credential before the login task (D-091), the
   migrations create empty tables (SM-01-AC13), and staging's only caller is
   the health smoke test. So the migration is expected to pass there. That
   cannot be checked from a session (sessions never reach
   `api.clever-cloud.com`); the first deploy's job log is the evidence.
   Production does not exist yet (M5). If the migration ever does refuse,
   what to do with those journeys is a decision for the owner, not a default
   in the code.

   LOST-01-AC20 proves both halves: the refusal, whole, with a journey present,
   and a clean run without one.

8. **The log: the first log lines this server writes about a request.**
   - **A `Log` port** (`ports.ts`) takes a **closed union of events**, and
     nothing free-form:

     ```ts
     type LogEvent =
       | { event: 'heartbeat_ignored'; reason: 'JOURNEY_ENDED'; journeyId: string }
       | { event: 'heartbeat_failed'; stage: 'clock' | 'read' | 'store'; code: string | null };
     ```

     `code` is a SQLSTATE or null, never a message. That follows the
     reviewers' note: "log an error's class and code, never its raw message".
   - **Its adapter, `apps/server/src/log.ts`**, uses pino (D-032), one JSON
     line per event.
     - **Its destination is an injected writer that defaults to
       `process.stdout.write`.** pino's default destination writes to file
       descriptor 1 directly. That would bypass the output capture the tests
       rely on (SM-01-AC11's `captured()` spies on `process.stdout.write`), and
       a capture that cannot see the log would pass every "nothing written"
       test without proving anything. LOST-01-AC14 includes a control that the
       capture sees this adapter's line.
     - pino's `redact` may be set for location key names as a second line of
       defence. Nothing relies on it: the event type is closed.
     - It lives at `src/` beside `redact.ts`, not in `adapters/`. That way
       `vitest.coverage.config.mjs` measures it; it excludes `adapters/` by
       design.
     - **It needs the owner's approval (D-102).** This pull request adds
       `/apps/server/src/log.ts` to `.github/CODEOWNERS` and to
       `OWNER_APPROVAL_PATHS` in `scripts/lib/merge-rules.mjs`. It does
       **not** add it to the ai-review `safety` filter, so `ai-review.yml` is
       not edited. See "Owner approval for the log adapter" in the test plan.
   - **A recording `fakeLog()`** goes in the test kit.
   - **The module** takes `log` from `createJourneyService({ clock, journeys,
     log })`. `api-process.ts` wires the real one. `createApi`'s dependencies
     are unchanged.
   - **AR-11** says one logging module "scrubs" locations. This one has
     nothing to scrub, by construction: no event can hold a location, and the
     one place a location could ride an error is cleaned at the source (item
     6). That meets AR-11's purpose, privacy kept in one place. It is stated
     here so the privacy review can check it.
   - **New dependency:** `pino`, in `apps/server/package.json`. It was chosen
     in D-032. `licenses:check` and the `security` job's audit check it
     (SEC-06).

9. **What this task leaves ready for the lost-contact story (task 3), without
   building any of it:**
   - `journeys.last_heartbeat_at`: database time, never backwards, null until
     the first heartbeat. Count silence from `coalesce(last_heartbeat_at,
     started_at)`, which m2.md already sends to task 3.
   - The journey row lock every heartbeat takes (item 6).
   - `latestHeartbeatOf`: the last time, battery and whether it carried a
     position, for the alert's content. The last position itself is read
     through the access-checked module, when that exists.
   - The `Log` port, for D-068's pool handler, which is task 3's (D-090).
   - The `LOST_CONTACT` heartbeat row that task 4 changes (reading 7).

10. **No other dependency** (SEC-06). Drizzle, zod, oRPC and `node:crypto` are
    already in `apps/server/package.json`.

11. **Import boundaries** (AR-10): only `api-process.ts` and tests import
    `adapters/` and `log.ts`. Modules get the `Log` port. Nothing enforces
    this yet (D-077's follow-up).

### Interfaces the tests are written against (RG-02: tests first)

Named so `test-author` can write the failing tests first. `implementer` may
refine a name only with `test-author`, before the tests are written.

- **`@trygghverdag/contracts`:** `recordHeartbeat` (the route, in `contract`),
  `heartbeatRequestSchema`, `heartbeatResponseSchema`, `heartbeatErrors`,
  `MAX_EVENT_ID_LENGTH`, `EVENT_ID_PATTERN`, and the types `HeartbeatRequest`,
  `HeartbeatResponse` and `HeartbeatErrorCode`.
- **`domain/journey.ts`:**
  - `JOURNEY_EVENTS` is exactly `['start', 'heartbeat']`;
  - `HeartbeatEvent` and `JourneyForHeartbeat`;
  - the outcomes `{ type: 'recorded', state }`, `{ type: 'ignored', reason:
    'JOURNEY_ENDED' }`, and `{ type: 'refused', reason: 'JOURNEY_NOT_FOUND' |
    'NOT_THE_JOURNEYS_DEVICE' }`.
- **`ports.ts`:** `JourneyStore` gains `journeyForHeartbeat`, `recordHeartbeat`
  and `latestHeartbeatOf`. `insertStarted` gains `deviceId` (D-101). `Log`
  and `LogEvent` are new.
- **`modules/journeys/`:** `createJourneyService({ clock, journeys, log })`,
  with `heartbeat({ walkerId, deviceId, heartbeat })`, and `start({ walkerId,
  deviceId, responderIds })` (D-101).
- **`adapters/journeys.ts`:** `HeartbeatStoreError`.
- **`log.ts`:** `createLog({ write? })`.
- **The test kit:**
  - `fakeLog()`, recording the events in order;
  - the fake store's new methods, plus inspection of stored heartbeats and
    positions;
  - `seed()` taking `deviceId` and `lastHeartbeatAt`;
  - builders: `syntheticEventId()`, `syntheticHeartbeat()`, and
    `syntheticPosition()`. Positions are always inside 1° of 0° 0′, which is
    open sea, with seven decimals and generated at run time. No test ever
    holds a plausible address (RG-07);
  - the shared behaviour suite's new heartbeat behaviours, run by the fake's
    tests (L2) and by the adapter's integration test (L3).

## Acceptance criteria

### Stored, with or without a position (LOST-01, SM-03)

**LOST-01-AC1 — A heartbeat with a position is stored once, timed by the
database.** *(LOST-01)*
- **Given** walker W's journey J is `ACTIVE`, started from W's device D
- **When** D sends `POST /v1/heartbeats` with J, event ID E, a synthetic
  position P and battery level B
- **Then** the answer is 200 `{ "outcome": "RECORDED" }`, and it parses with
  the contract's response schema
- **And** J has exactly one heartbeat with E, received at the injected clock's
  reading, with battery B, and exactly one position equal to P, holding P's
  phone time as given
- **And** J's last contact is that same reading, and J is still `ACTIVE`
- **And** the clock is exact at L6 (the fake clock's reading). At L3 it is
  bracketed by two `select now()` readings taken before and after.

**LOST-01-AC2 — A heartbeat without a position counts the same, and the
journey reads "location unavailable" until a position comes.** *(SM-03)*
- **Given** J is `ACTIVE`
- **When** D sends a heartbeat with `"position": null`
- **Then** the answer is 200 `RECORDED`, the heartbeat is stored with no
  position row, last contact advances exactly as for a heartbeat with a
  position, and J stays `ACTIVE`
- **And** `latestHeartbeatOf(J)` reads `hasPosition: false`
- **And when** a later heartbeat with a position arrives, it reads `true`
  again
- **And** for any sequence of heartbeats with and without positions, the
  domain's outcome is the same as if all had positions (fast-check, L2).

### Stored once (SM-08)

**LOST-01-AC3 — A duplicate has no effect.** *(SM-08)*
- **Given** J holds a heartbeat with event ID E
- **When** E is sent again, with the same content or different content,
  after the clock has moved on
- **Then** the answer is 200 `{ "outcome": "DUPLICATE" }`
- **And** J still has exactly one heartbeat with E and its first content, and
  no further position
- **And** J's last contact has **not** moved (reading 3)
- **And** E sent for another journey is a new event there: the event ID is
  scoped to its journey.

**LOST-01-AC4 — Duplicates that race leave exactly one.** *(SM-08)*
- **Given** a real PostgreSQL and an `ACTIVE` journey
- **When** at least 10 copies of one heartbeat are sent at once, on separate
  connections
- **Then** exactly one heartbeat and at most one position are stored
- **And** exactly one answer is `recorded` and every other is `duplicate`.
  None is an error
- **And** this holds on every repetition (at least 5).

### Database-time order (SM-09, REL-01)

**LOST-01-AC5 — Last contact is the latest database time, whatever order the
heartbeats are written in.** *(SM-09)*
- **Given** any set of heartbeats for one journey, each with its own receive
  time
- **When** they are stored in any order: generated permutations at L2, and
  concurrently on separate connections at L3
- **Then** last contact equals the greatest receive time, and never at any
  point moves backwards
- **And** `latestHeartbeatOf` returns the heartbeat with the greatest receive
  time. A tie goes to the one stored last
- **And** every heartbeat is stored exactly once
- **And** this is a fast-check property in the shared behaviour suite. It runs
  against the fake (L2) and against the real tables (L3, with fewer runs).

**LOST-01-AC6 — The phone's clock decides nothing.** *(SM-09, REL-01)*
- **Given** J is `ACTIVE`
- **When** heartbeats arrive whose positions' phone times are hours ahead of
  the database clock, hours behind it, or earlier than the heartbeat before
  them (a queue flushed late)
- **Then** each is stored, received at the injected clock's reading
- **And** last contact and the latest heartbeat follow the receive times only
- **And** the phone's time is stored unchanged, beside its position only
- **And** an end-to-end walk at L6 holds all of it together:
  - **Given** the fake clock, a heartbeat every 60 s for 45 minutes, and every
    fifth one without a position;
  - and a 3-minute gap, then a burst of queued heartbeats whose phone times
    fall inside the gap and whose receive times fall after it;
  - and one resend of an event already stored;
  - **Then** every distinct event is stored exactly once, last contact is the
    last receive time, and the location-unavailable flag matches the last
    heartbeat received.

### Journeys that cannot take the heartbeat

**LOST-01-AC7 — After `ENDED`: refused, nothing stored, logged without
location, and reported first.** *(SM-07)*
- **Given** J is `ENDED`. Nothing in this task ends a journey, so the test puts
  it there directly: in the fake at L6, and as a row at L3.
- **When** D sends a heartbeat for J, with a position or without
- **Then** the answer is 409 `JOURNEY_ENDED`
- **And** no heartbeat and no position are stored, and J's last contact is
  unchanged
- **And** exactly one log event is written:
  `{ event: 'heartbeat_ignored', reason: 'JOURNEY_ENDED', journeyId: J }`. It
  holds nothing of the heartbeat (LOST-01-AC14)
- **And** the answer is the same whatever else the heartbeat holds: an event ID
  J already has, or another device of W's (D-101)
- **And when** J ends between the module's read and the store's write (L3: the
  store is called directly with J `ENDED` in the table; L2: the fake answers
  `ended`), the outcome, the log line and "nothing stored" are the same.

**LOST-01-AC8 — A journey in `LOST_CONTACT` takes the heartbeat and stays in
`LOST_CONTACT`.** *(SM-03)*
- **Given** J is `LOST_CONTACT`, put there directly
- **When** D sends a heartbeat
- **Then** the answer is 200 `RECORDED`, the heartbeat is stored and last
  contact advances
- **And** J is still `LOST_CONTACT`. The move back to `ACTIVE`, and what it
  tells the responders, is task 4's (reading 7).

**LOST-01-AC9 — Only the walker's own journey.** *(SEC-07)*
- **Given** walker V ≠ W with an unended journey K, and an ID no journey has
- **When** D sends a heartbeat naming K, or naming that unknown ID
- **Then** each answer is 404 `JOURNEY_NOT_FOUND`, and the two bodies are
  identical
- **And** nothing is stored, and K's heartbeats and last contact are unchanged.

**LOST-01-AC10 — Only from the device that started the journey.** *(SEC-07;
D-101)*
- **Given** W has a second device D2, and J was started from D
- **When** D2 sends a heartbeat for J
- **Then** the answer is 403 `NOT_THE_JOURNEYS_DEVICE`, and nothing is stored
- **And** J's last contact is unchanged, so a device that is not the walking
  phone can never hide that phone's silence
- **And** a journey started through the API records the device that sent the
  start, and no other: at L6 in the fake store, and at L3 in
  `journeys.device_id`
- **And** D2's refusal holds whatever D2's heartbeat holds, while D's next
  heartbeat for J is `RECORDED`.

### Validated, and nothing echoed (SEC-07, §4.5)

**LOST-01-AC11 — The body is checked, and a refused body stores nothing.**
*(SEC-07)*
- **When** the body:
  - has a field beyond the four, at the top or inside `position`;
  - misses `journeyId`, `eventId`, `batteryLevel` or `position`;
  - has a `journeyId` that is not a UUID;
  - has an `eventId` that is empty, longer than 64 characters, or holds any
    character outside the pattern (`_`, `.`, a space, a non-ASCII letter);
  - has a latitude or longitude out of range, or not finite;
  - has a negative accuracy;
  - has a battery level outside 0 to 1;
  - has a `recordedAt` with no offset;
  - has a `position` missing any of its four fields;
  - or is not JSON at all
- **Then** each is 400, and nothing is stored
- **And** the schema accepts the boundary values: latitude ±90, longitude
  ±180, accuracy 0, battery 0 and 1, a 64-character event ID, and phone times
  far in the past and the future (L2, in the contract package).

**LOST-01-AC12 — No answer carries a `background_geolocation` key, or any key
or value from the request.** *(LOST-01, §4.5's warning)*
- **Given** requests that hold `background_geolocation`:
  - as a top-level key;
  - as a key inside `position`;
  - as a string value;
  - inside a body that is not JSON;
  - in its spelling variants (`backgroundGeolocation`,
    `BACKGROUND-GEOLOCATION`)
- **When** each is sent, and when the route answers 200, 400, 401, 403, 404,
  409 and 500
- **Then** no answer's headers or body match `/background[_-]?geolocation/i`
- **And** every 400 body is exactly the fixed `BAD_REQUEST` body, with no
  `data`, whatever the request held
- **And** every 200 body is exactly `{ "outcome": … }`, with no other key.

### All or nothing, and loud

**LOST-01-AC13 — A heartbeat is stored whole or not at all, and a failure is
a 500, never a 2xx, reported in one line.** *(LOST-01)*
- **Given** a real PostgreSQL in which a test-only trigger, or a check
  constraint, makes inserting a `positions` row fail
- **When** D sends a heartbeat with a position
- **Then** the answer is 500
- **And** no heartbeat row is left, and J's last contact is unchanged
- **And** once the trigger is removed, the same event sent again is
  `RECORDED`, not `DUPLICATE`. Nothing half-written blocks it
- **And** at L6, with the fake clock or the fake store made to fail, the answer
  is 500, nothing is stored, and exactly one `heartbeat_failed` event is
  written, naming the stage (`clock`, `read` or `store`)
- **And** no failure is ever answered 401 or 2xx.

### None of it reaches a log (PRIV-07)

**LOST-01-AC14 — Nothing of a heartbeat is written, whatever the outcome.**
*(PRIV-07)*
- **Given** heartbeats holding synthetic markers:
  - every coordinate, written in full and rounded to 3, 4, 5, 6 and 7
    decimals;
  - the accuracy;
  - the battery level;
  - the phone's time;
  - the event ID
- **When** each outcome happens, with stdout, stderr and the console captured
  as SM-01-AC11's `captured()` does:
  - recorded, with a position and without;
  - duplicate;
  - ended;
  - not found;
  - another device's 403;
  - each 400 of LOST-01-AC11;
  - 401;
  - a store failure whose error message holds the markers;
  - a clock failure
- **Then** nothing captured contains any marker
- **And** the response bodies contain none either
- **And** as controls, so that "nothing" means something:
  - the capture sees a line written through the production `createLog`
    wired as `api-process.ts` wires it;
  - in the store-failure case, the error the fake store threw does contain
    the markers.

**LOST-01-AC15 — Not even when the database's own error holds the
position.** *(PRIV-07)*
- **Given** a real PostgreSQL with a test-only check constraint that every
  `positions` insert breaks
- **When** `recordHeartbeat` runs with a synthetic position, directly and
  through the API
- **Then**, first as controls: the same insert made through Drizzle without
  the adapter fails with an error whose message, or whose cause's `detail`,
  holds the coordinates
- **And** the adapter's rejection is a `HeartbeatStoreError` with a SQLSTATE
  `code`. Its message, its properties and its cause chain, inspected in depth,
  hold no coordinate, accuracy, phone time, battery level or event ID
- **And** through the API, the 500's body and everything captured hold none of
  them either, and the one `heartbeat_failed` line carries the SQLSTATE.

**LOST-01-AC16 — The log takes closed events only.** *(PRIV-07)*
- **Then** typecheck (L1) fails for a `LogEvent` holding any other field. A
  `@ts-expect-error` test holds this, a latitude among the fields it tries
- **And** `createLog` writes each event as one JSON line, holding exactly that
  event's fields
- **And** a `code` that is not five of `0–9A–Z` is written as `null`, so no
  message can travel as a code (L2).

### The state machine and the database

**LOST-01-AC17 — Every (situation, event) pair has a tested outcome, the
heartbeat included.** *(SM-03, SM-07; extends SM-01-AC14)*
- **Given** `JOURNEY_EVENTS` is exactly `start` and `heartbeat`
- **Then** the transition table holds an expectation for each pair:
  - none, `ACTIVE`, `LOST_CONTACT` and `ENDED`, each with `heartbeat`;
  - another walker's journey;
  - another device of the same walker (D-101).

  Each pair returns exactly that outcome, with the order of approach item 4
- **And** a pair the lists create but the table lacks fails, naming the pair
- **And** `transition` never throws and never returns `undefined` for any
  generated situation and event (fast-check)
- **And** typecheck fails if an event type has no case.

**LOST-01-AC18 — The database agrees: one place for coordinates, and the
rules held by constraints.** *(SM-08, SM-09, PRIV-07)*
- **Given** a freshly migrated database
- **Then** the only columns named like a coordinate (`lat`, `latitude`, `lng`,
  `lon`, `longitude`, `coords`, `position`, `location`) are
  `positions.latitude` and `positions.longitude`, in every table, by
  `information_schema`
- **And** a second heartbeat with the same (`journey_id`, `event_id`) is
  refused by the database itself
- **And** a latitude, longitude, accuracy, battery level or event ID outside
  the contract's rules is refused by the database itself
- **And** `journeys.last_heartbeat_at` exists and is null for a new journey
- **And** the migration runs on PostgreSQL 15 (`deploy.integration.test.ts`
  already runs every migration there).

### The contract (AR-07, D-030)

**LOST-01-AC19 — The contract describes the route, its answers and its
authentication.** *(LOST-01)*
- **Given** the generated OpenAPI document
- **Then** it has `POST /heartbeats` under the `/v1` server, with responses
  200, 400, 401, 403, 404 and 409
- **And** it requires the bearer scheme on the route
- **And** the committed `openapi.json` equals what the contract generates
- **And** `pnpm run api:diff` is run. With `packages/contracts/released/` empty
  it compares nothing, and the pull request records that as "not compared",
  never as "passed".

### The migration (D-101)

**LOST-01-AC20 — A database that already holds a journey refuses the
migration, whole, rather than guess its device.** *(LOST-01; D-101)*
- **Given** a PostgreSQL 15 database (staging's version) migrated up to
  `0001` only, holding one synthetic user, one device and one journey
- **When** the migrations are run, as the pre-run hook runs them
- **Then** they reject, and the error, or the PostgreSQL error in its cause
  chain, carries SQLSTATE 23502 and names `device_id`
- **And** the database is exactly as it was: the journey row unchanged, no
  `journeys.device_id`, no `heartbeats` or `positions` table, and the
  migrations journal still ending at `0001`
- **And** no journey has been ended, deleted or given a device
- **And**, as the control: the same database without the journey migrates
  cleanly, and `journeys.device_id` is then `not null` and references
  `devices`
- **And** the committed `0002_*.sql` adds `device_id` with no `default` and
  holds no `update` of `journeys` (read from the file, so a backfill added
  later fails here).

## Test plan

| AC | Level | Where | How |
|----|-------|-------|-----|
| AC1 | L6, L3 | `apps/server/src/journeys.system.test.ts`; `apps/server/src/adapters/journeys.integration.test.ts` | L6: the fake clock and fake store. L3: the real adapter, with the time bracketed by `select now()` |
| AC2 | L2, L6, L3 | `domain/journey.test.ts`; system test; behaviour suite | fast-check: having a position never changes the outcome. **Names SM-03** |
| AC3 | L6, L2, L3 | system test; behaviour suite (fake and real) | Same and different content; the clock advanced between. **Names SM-08** |
| AC4 | L3 | integration test | ≥ 10 at once on separate pool connections, ≥ 5 rounds. **Names SM-08** |
| AC5 | L2, L3 | behaviour suite (fast-check), run by `packages/test-kit/src/fake-journey-store.test.ts` and the integration test; plus an L3 concurrency test | Permutations of receive times, and concurrent writes. **Names SM-09** |
| AC6 | L6, L3 | system test (the walk); integration test (phone times stored as given) | **Names SM-09 and REL-01** |
| AC7 | L2, L6, L3 | domain test; system test with `fakeLog()`; behaviour suite | `ENDED` seeded; the race through the store directly. **Names SM-07** |
| AC8 | L2, L6 | domain test; system test | `LOST_CONTACT` seeded. **Names SM-03** |
| AC9 | L2, L6 | domain test; system test | **Names SEC-07** |
| AC10 | L2, L6, L3 | domain test; system test; integration test | A second device registered for the same walker; the starting device read back. **Names SEC-07** |
| AC11 | L2, L6 | `packages/contracts/src/heartbeats.test.ts` (new); system test | Each refused form and each boundary. **Names SEC-07** |
| AC12 | L6 | system test | Every outcome, with the marker in each position |
| AC13 | L3, L6 | integration test (a trigger the test creates and removes, as SM-01-AC8's does); system test (`failWith`) | |
| AC14 | L6 | system test (`captured()` plus `fakeLog()`), and the control through the production log | **Names PRIV-07** |
| AC15 | L3 | integration test | Controls first, then the adapter, then the API. **Names PRIV-07** |
| AC16 | L1, L2 | `tsc` in `gate:static`; `apps/server/src/log.test.ts` (new) | **Names PRIV-07** |
| AC17 | L1, L2 | `tsc`; domain test | Table typed with `satisfies` over the lists, plus a run-time check over them |
| AC18 | L3 | integration test | `information_schema` and inserts that break each constraint |
| AC19 | L2, L4 | `packages/contracts/src/openapi.test.ts`; `pnpm run api:diff` | L4 compares nothing today and says so |
| AC20 | L3 | `apps/server/src/deploy.integration.test.ts` (PostgreSQL 15) | Migrate a copy of the migrations folder trimmed to `0000`–`0001`, insert the journey directly, then run the real folder. The SQL check reads `0002_*.sql` |

**The process wiring** (no separate criterion). `api-process.test.ts` gains a
heartbeat through `startApiProcess` against the test kit's fake PostgreSQL
server. It shows three things:
- the heartbeat is timed by the database's `now()`;
- it is written by the database store, in one `begin`…`commit` with the
  journey's `for update`;
- an ignored heartbeat's line reaches the process's real stdout.

That is what kills the mutants of the new wiring in `api-process.ts` (BUG-12's
lesson: an empty service fails with the same 500 as a missing database).

### Owner approval for the log adapter (D-102): in the test plan, not an AC

**Decided: not an acceptance criterion.** It is a rule about who approves a
change, not a behaviour of the heartbeat. The tests that hold it are gate tests
in `scripts/`, which `.claude/rules/tests.md` exempts from naming a
requirement. A `LOST-01-ACn` for it would make `req:coverage` count a
CODEOWNERS line as heartbeat coverage, which is the decorative traceability
D-074 warns against. BUG-10 and BUG-14 held D-092 to D-100 the same way. So
the count stays at twenty.

**What changes:**
- `.github/CODEOWNERS`: a line `/apps/server/src/log.ts @bvst @urso-agent`,
  with a comment citing D-102.
- `scripts/lib/merge-rules.mjs`: `'/apps/server/src/log.ts'` in
  `OWNER_APPROVAL_PATHS`, with the same comment.
- `scripts/gate.test.mjs` (test-author), following BUG-10's `D097_FILES`
  tests:
  - `log.ts` is tracked by git and is in `OWNER_APPROVAL_PATHS`;
  - under GitHub's last-match rule, the line of `.github/CODEOWNERS` that
    matches it names `@bvst @urso-agent`, and `reviewCodeowners` finds every
    owner-approval path owned (`gate:integrity`'s check, CI-01);
  - it is **not** in the ai-review `safety` filter, which pins D-102's choice
    so a later change has to show itself in a test.
- **Not changed:** `.github/workflows/ai-review.yml`. CI's reviewers can run on
  this pull request, and no hand merge is needed (D-075).

**An existing gate test conflicted with D-102 as first written; D-102's
amendment settles it.** `scripts/gate.test.mjs`, "the safety filter in
ai-review.yml matches the paths the owner must approve" (lines 503–521, read
2026-10-03), requires every `/apps/` entry of `OWNER_APPROVAL_PATHS` to be in
the `safety` filter. With `log.ts` owned and left out of the filter, that test
would fail. The owner chose a named exception, pinned exactly to
`['/apps/server/src/log.ts']` (D-102, amended 2026-10-03; "Settled by the
owner", item 4).

### How "none of it reaches a log" is proven

1. **By construction:**
   - the `Log` event type is closed (AC16, L1);
   - the adapter cleans database errors where they start (AC15, L3);
   - the 400 body is fixed (AC12, L6);
   - no heartbeat value is ever in a URL or a header (approach item 1).
2. **By observation:**
   - every outcome is run with stdout, stderr and the console captured;
   - the markers are every value of the heartbeat, in the renderings a careless
     line could use (AC14 at L6, AC15 at L3 with PostgreSQL's real error).
3. **By controls, so that a pass means something:**
   - the capture provably sees the production log adapter's output;
   - the raw errors provably do hold the markers.

   Without both, an empty capture would prove only that the capture was blind.
   With pino's default destination, writing straight to file descriptor 1, it
   would have been (approach item 8).
4. **Not proven here, and said so:**
   - **Clever Cloud's own platform output.** It sees no heartbeat value,
     because none is in a URL or a header.
   - **The worker's output** (Graphile Worker's logger). The worker binds no
     location in this task.
   - **The SDK's log on the phone**, which is M3's (§4.6, `logger.logLevel`).

### Notes

- **Not used:** L5 and L7, because the app is not touched; L8 to L10.
- **L3 needs Docker,** so it runs in CI, not in a cloud session. `gate:full`
  names it as not run, and the `integration` job's log is the evidence.
- **One behaviour, two implementations.** The heartbeat behaviours join
  `JOURNEY_STORE_BEHAVIOUR`, and `fake-journey-store.test.ts` pins their names.
  A fake more lenient than the adapter would make the L6 tests prove the fake.
  The test kit needs the owner's approval for exactly that reason (D-100).
- **Test names** start with `LOST-01-ACn:`. The files holding them also name
  SM-03, SM-07, SM-08, SM-09 and PRIV-07 as the table says. Otherwise RG-01
  fails, because this spec names all six.
- **Existing assertions that change by design.** `test-author` changes each
  one, with the written reason RG-03 asks for in the pull request:
  - `openapi.test.ts`'s pinned path list, `['/health', '/journeys']`;
  - the domain test's `JOURNEY_EVENTS` (exactly `start`), which SM-01-AC14
    holds;
  - the behaviour-name pin in `fake-journey-store.test.ts`;
  - **D-101's device on the start path:** `insertStarted` gains `deviceId`.
    The SM-01 tests that call it or seed a journey give it one: the behaviour
    suite, the fake's tests, and the L3 tests that insert journey rows
    directly, which now need a `devices` row too. SM-01's HTTP-level tests
    keep their requests and their assertions (D-103: the start route is
    unchanged). One SM-01 test gains a check: the stored device is the one
    that sent the start (LOST-01-AC10);
  - **D-102's exception** in `scripts/gate.test.mjs`, lines 503–521, pinned
    exactly to `['/apps/server/src/log.ts']` (D-102, amended 2026-10-03).

  None of these changes loosens what a test proves, except the last, which
  narrows one gate test by one named file. The owner decided that in D-102's
  amendment.
- **Synthetic data only** (RG-07, D-089):
  - positions come from `syntheticPosition()`, open sea near 0° 0′;
  - IDs and credentials come from the existing builders;
  - event IDs come from `syntheticEventId()`.

  No real-looking coordinate is written in any file.
- **Before pushing:** run `test:coverage` and then `coverage:ratchet` (live
  gotcha). `log.ts` is new and measured. The module and `domain/` keep RG-04's
  95 % branch floor.
- **`docs/requirements-status.md`** is regenerated with `pnpm run
  req:coverage`. The six IDs go from ⚪ to 📝 with this spec, and to 🟢 with the
  tests.

## Mutation (D-036, D-095, D-098, D-099)

Read in `scripts/lib/gate-decisions.mjs` on 2026-10-02.

| New or changed code | Group | Tests the group runs | Configuration |
|---|---|---|---|
| `domain/journey.ts` | `domain` | `apps/server/src/domain` | root |
| `modules/journeys/` (any file in the folder; the group claims the folder) | `journeys` | `apps/server/src/journeys.system.test.ts` only | `vitest.system.config.mjs` |
| `api-process.ts` (wiring the log and the store) | `api-process` | `apps/server/src/api-process.test.ts` | root |

- **Each file must reach 80 % killed on its own** (D-098). Every run is fresh
  (D-099).
- **No group's test list needs to grow, if the heartbeat's L6 tests go in
  `journeys.system.test.ts`.** This spec says they do.
  - A separate file, such as `heartbeats.system.test.ts`, would leave every
    mutant of the new module code alive. Its tests would not be in the group,
    so the `mutation` check would go red. It would fail loudly, not silently.
  - To use a separate file, `MUTATION_GROUPS` in `scripts/lib/gate-decisions.mjs`
    must list it. That file is under `/scripts/` (the owner's approval) and in
    the ai-review `safety` filter (D-100). Three pins would change with it:
    `gate-decisions.test.mjs` (the `journeys` entries at about lines 521–525
    and 761–766) and `stryker-config.test.mjs` (about line 229).
  - Not recommended: one file keeps the journey events together, and the
    gate's own files stay untouched.
- **Not mutated on a pull request:**
  - `adapters/journeys.ts`, `db/schema.ts` and the migration: D-095 leaves
    them to their L3 tests and D-036's nightly run, which does not exist yet;
  - `api.ts`: D-097 decided no in-process mutation for it;
  - `log.ts`, the contracts and the test kit: not safety paths.
- **Cost.** The `journeys` group runs the whole system test file for each
  mutant, and both the file and the module roughly double. D-098 keeps the
  25-minute budget. If an honest run does not fit, the owner decides (cost).
  The job's log says how long it took. Read it, do not estimate.

## Modules and files affected

Owner approval and the safety filter were read in `.github/CODEOWNERS`,
`scripts/lib/merge-rules.mjs` (`OWNER_APPROVAL_PATHS`) and
`.github/workflows/ai-review.yml` on 2026-10-02, at `main` after BUG-14. The
"Owner approval" column is the state after this pull request: `log.ts` is
owned by D-102.

| File | Change | Owner approval | Safety filter | Mutation |
|------|--------|:--:|:--:|:--:|
| `apps/server/src/domain/journey.ts` | `heartbeat` event, its rule, the `switch` | **yes** | **yes** | `domain` |
| `apps/server/src/domain/journey.test.ts` | L2 (test-author) | **yes** | **yes** | (its tests) |
| `apps/server/src/modules/journeys/service.ts` (or a new file there) | `heartbeat`; `start` passes the device on (D-101) | **yes** | **yes** | `journeys` |
| `apps/server/src/ports.ts` | `JourneyStore` methods; `Log`, `LogEvent` | no | no | — |
| `apps/server/src/adapters/journeys.ts` | Three methods, `HeartbeatStoreError`; `insertStarted` writes the device (D-101) | **yes** | **yes** | no (D-095) |
| `apps/server/src/db/schema.ts` | Two tables, two columns | **yes** | **yes** | no |
| `apps/server/src/db/migrations/0002_*.sql`, `meta/*` | Generated with `pnpm --filter @trygghverdag/server db:generate`; `device_id` with no default and no backfill (LOST-01-AC20) | **yes** | **yes** | no |
| `apps/server/src/api.ts` | The heartbeat handler; the fixed 400; the start hands on the device (D-101) | **yes** | **yes** | no (D-097) |
| `apps/server/src/api-process.ts` | Wires `createLog()` | **yes** | **yes** | `api-process` |
| `apps/server/src/log.ts` (new) | The log adapter | **yes** (D-102) | no (D-102) | no |
| `apps/server/src/log.test.ts` (new) | L2 (test-author) | no | no | — |
| `.github/CODEOWNERS` | `/apps/server/src/log.ts @bvst @urso-agent` (D-102) | **yes** | — | — |
| `scripts/lib/merge-rules.mjs` | `/apps/server/src/log.ts` in `OWNER_APPROVAL_PATHS` (D-102) | **yes** | no | — |
| `scripts/gate.test.mjs` | D-102's ownership pinned; the filter test's named exception, pinned to `log.ts` (D-102, amended; test-author) | **yes** | no | — |
| `apps/server/src/deploy.integration.test.ts` | LOST-01-AC20 (test-author) | no | no | — |
| `apps/server/package.json`, `pnpm-lock.yaml` | `pino` | no | no | — |
| `apps/server/src/journeys.system.test.ts` | L6 (test-author) | no | no | the `journeys` group's tests |
| `apps/server/src/adapters/journeys.integration.test.ts` | L3 (test-author) | no | no | — |
| `apps/server/src/api-process.test.ts` | The wiring (test-author) | no | no | the `api-process` group's tests |
| `packages/contracts/src/heartbeats.ts` (new), `contract.ts`, `index.ts` | The route, schemas, errors, constants | no (D-094) | **yes** | — |
| `packages/contracts/openapi.json` | Regenerated with `pnpm run api:spec` | no | **yes** | — |
| `packages/contracts/src/heartbeats.test.ts` (new), `openapi.test.ts` | L2, L4 (test-author) | no | **yes** | — |
| `packages/test-kit/src/` (fake store, `fakeLog`, builders, behaviour suite, their tests), `index.ts` | Fakes and builders (test-author) | **yes** (D-100) | **yes** | input (D-098) |
| `docs/requirements-status.md` | Regenerated | no | no | — |
| `docs/progress.md`, `docs/progress/m2.md` | Status (plan-keeper) | no | no | — |

- **Expected unchanged:**
  - `worker.ts`, `bin/*`, `process.ts`, `redact.ts`;
  - `adapters/clock.ts`, `db.ts`, `device-credentials.ts`, `healthchecks.ts`,
    `migrations.ts`;
  - `.github/workflows/`, `ai-review.yml` included (D-102), and every file
    under `scripts/` but the three in the table;
  - `stryker.config.mjs`, the Vitest configurations and `packages/config`;
  - `infra/` and `apps/mobile/`.
- **No edit to `ai-review.yml`,** so CI's AI reviewers can run on this pull
  request, and no merge by hand is needed (D-075).
- **Reviewers:** `safety-reviewer` runs because `domain/`, `modules/journeys/`,
  the adapter, the schema, `api.ts`, the contracts and the test kit change.
  `privacy-security-reviewer` and `test-auditor` always run.
- **The pull request needs the owner's approval** (D-042), as every M2 task
  does through `domain/`.
- **The owner's answers are D-101, D-102 (with its amendment) and D-103.**
  No further decision is needed. If one becomes needed, check the open pull
  requests' `decisions.md` first, and again before each push (live gotcha).

## Contract changes

All additive. `packages/contracts/released/` is empty (checked 2026-10-02), so
nothing on a phone can break, and nothing is added there: that is
`release-engineer`'s alone. **The shape can still change before the first app
release** (M3) at no compatibility cost. From the first release, `api:diff`
holds it.

- **New:** `POST /v1/heartbeats` (contract path `/heartbeats`). Request, answers
  and constants as in approach items 2 and 3.
  - The route's description states three things: it needs a device
    credential; it answers only for the device user's own journeys; and a
    200 means the server has the event, so the phone may drop it.
  - `receivedAt` is not returned. The phone has no use for it, and returning
    it would only invite the app to compute with it.
- **Exports from `@trygghverdag/contracts`:** the schemas, their types,
  `MAX_EVENT_ID_LENGTH`, `EVENT_ID_PATTERN` and the error codes. The app (M3)
  reads them from here, never from a copy.
- **Unchanged:** `/v1/health` and `POST /v1/journeys`. The start route's
  request, answers and contract stay as they are, with no event ID (D-103).
  Only what the server stores changes: the starting device (D-101).
- **Not checked in this session, for M3, before `released/` holds anything:**
  - **whether the SDK's native uploader sends `Authorization: Bearer`;**
  - **whether it can produce this body**: its body template or per-record
    extras, and a battery level of −1 for "unknown" (recalled, not checked).

  SM-01's spec sent the first of these to this task. Neither can be checked
  here: 5.7.0's type declarations are not in this checkout
  (`spikes/background-safety/app/` has no `node_modules`). If either fails in
  M3, the contract changes then, and it costs nothing while nothing is
  released.

## Risks and failure modes

- **[F6](../plan/03-safety-reliability-security.md#failure-modes) and
  [F1](../plan/03-safety-reliability-security.md#failure-modes), a missed
  alert.** The worst failure here is contact counted when the phone is
  silent. Every way this task could count it is closed:
  - **another walker's journey:** LOST-01-AC9;
  - **another device of the walker**, such as a tablet left at home: D-101
    and LOST-01-AC10;
  - **a replayed or resent request:** duplicates never advance contact
    (LOST-01-AC3);
  - **a phone clock running ahead:** if the phone's time ever became last
    contact, a phone an hour fast would hold back the watchdog for an hour.
    It never does (LOST-01-AC6, REL-01).
- **[F2](../plan/03-safety-reliability-security.md#failure-modes), no
  coverage, which becomes a false alarm.**
  - Queued heartbeats flushed after a tunnel are stored with their receive
    time. That is right: the phone is back now.
  - Their positions keep the phone's time as a label, so the
    what-responders-see story (M3) can show the real age (the
    accuracy-and-age rule).
  - S4's worst case leaves about 50 s of margin to the 5 minutes. That margin
    is the phone's, and nothing here narrows it.
  - **The cost of reading 3:** a phone whose answers are lost while its
    requests arrive keeps resending one record, and after 5 minutes it
    raises a false alarm. That alarm is loud, which is the safe direction.
- **[F5](../plan/03-safety-reliability-security.md#failure-modes), location
  permission lost.** A heartbeat without a position keeps contact exactly as
  one with a position does (LOST-01-AC2), and the flag shows it.
- **[F7](../plan/03-safety-reliability-security.md#failure-modes), the server
  down.**
  - Every heartbeat is now a database write, and §4.6 says an iPhone may
    upload continuously while moving.
  - A database that cannot answer gives a 500 and one `heartbeat_failed` line
    with its SQLSTATE (LOST-01-AC13). The phone keeps the record and retries.
  - D-068's API pool still has no `error` listener. That is loud, and it is
    task 3's to revisit (D-090).
- **[F8](../plan/03-safety-reliability-security.md#failure-modes), a bad
  release breaks alerts.**
  - **The SDK keeps a refused record and resends it.** A contract that refuses
    something a correct phone sends would therefore stop every later upload
    from that phone, and 5 minutes later every journey would alert.
  - That is loud, not silent, but it would be a mass false alarm. M3 checks
    the app's real upload against `heartbeatRequestSchema` at L5 before it
    ships.
  - Every 4xx (400, 403, 404, 409) is one the app must act on, not retry for
    ever: drop the record and tell the walker. That is M3's.
  - **A deploy to a database that holds journeys stops at the migration**
    (LOST-01-AC20). That is loud and leaves the database as it was, by
    design: no journey's device is guessed. None is expected on staging, and
    that cannot be checked from a session.
- **D-101's own cost.** A walker whose phone is swapped mid-journey cannot
  carry on from the new one. The journey goes quiet and, from task 3, alerts.
  That is the safe direction, and D-101 accepts it. Moving a journey to
  another device would need its own decision.
- **[F9](../plan/03-safety-reliability-security.md#failure-modes), an
  inaccurate position.** Accuracy is stored with every position, ready for the
  accuracy-and-age rule.
- **[F10](../plan/03-safety-reliability-security.md#failure-modes):**
  unchanged. Per-device authentication cannot tell who holds the phone.
- **F3 and F4:** not touched. They concern the phone.
- **A position in a log** (PRIV-07). Guarded at the source (LOST-01-AC15), by
  the closed log type (LOST-01-AC16) and by observation (LOST-01-AC14).
  **Still open:**
  - Graphile Worker's logger, for the first task whose worker binds a
    location. Task 3, if its alert carries the last position;
  - `describeFailure` would print a Drizzle error's parameters if one ever
    reached it. Only start-up failures reach it today, and the heartbeat
    path's errors are cleaned before they could.
- **Positions are stored from this task on:**
  - the retention rule's 24-hour deletion is M4's job (roadmap);
  - before the login task nobody can hold a credential (D-091), so staging
    holds no position, and test data is synthetic (D-089);
  - the encryption rule's open item, encryption in transit to PostgreSQL
    (D-077), now covers positions. It is settled before any real data.
- **The fake can drift from the adapter.** The shared behaviour suite runs
  every heartbeat rule against both.
- **Row-lock contention.** One walker's heartbeats are serialised on the
  journey's row. That is intended (approach item 6), and the transaction is
  kept short.
- **A coverage report that reads as done.** Six rows turn 🟢 while the halves
  listed under "How this spec names requirements" remain.

### Flags from other decisions, checked

- **D-086:**
  - its conditions are M3's and L9's;
  - §4.5's echo warning is met here (LOST-01-AC12);
  - its TLS half is the platform's and the app's ("the client must use
    `https://`", m2.md). That Clever Cloud ends TLS for staging's
    `cleverapps.io` address was not checked in this session.
- **D-087's flags:** none applies to the heartbeat.
- **D-089:** synthetic data only, and no secret committed.
- **D-091:** unchanged. The heartbeat uses the same middleware and the same
  401.

## Out of scope

- **The lost-contact alert (task 3) and everything after it:** the watchdog,
  `LOST_CONTACT`, alerts, the outbox, push and SMS. Approach item 9 lists what
  this task leaves ready.
- **The move from `LOST_CONTACT` back to `ACTIVE`**, and "back in contact"
  (the back-in-contact story, task 4; reading 7).
- **The phone half:**
  - the 60 s cadence and the SDK's settings;
  - binding the journey ID to each record, and the `Authorization` header;
  - emptying the queue and telling the walker on `JOURNEY_ENDED`;
  - the offline story (M3).
- **Showing positions:** reading them back through an access check (the
  responders-only rule), the location-unavailable view and the
  location-loss rule's walker warning (the what-responders-see and
  permission-check stories, M3).
- **The retention job** (M4). The open question on how long journey records
  are kept (`plan/README.md`, "Open for M4") now also covers the `heartbeats`
  rows, which hold no location.
- **The low-battery story** (M3). Battery is stored here, and its rule is not
  built.
- **The status fields of §4.5** (`moving`, the queue count, the permission, the
  exemption) and the platform: not accepted (approach item 3).
- **Event IDs for other events.** The start route needs none (D-103). "I'm
  home", "I'm on it" and "They're safe" each decide in their own task whether
  they need one, to be safe to receive twice (D-103).
- **Moving a journey to another device** (D-101: it would need its own
  decision).
- **Rate limiting and a body-size limit;** checking the bearer value's shape
  before the lookup (the reviewers' optional idea).
- **The dependency-cruiser import rule** (needs the owner; it lives in
  `packages/config`).
- **D-068's pool handler** (task 3) and **heartbeat-gap monitoring** (L10).
- **Ending a journey for any reason.** Tests put `ENDED` in directly.

## Settled by the owner

Already settled by the plan and the decisions, so never asked:
- **How long heartbeat positions are kept:** the retention rule, 24 hours
  after the journey ends. The job is M4's.
- **Whether to store the battery level:** yes. The heartbeat story's own text
  says "position and battery level", and the lost-contact story's alert
  carries it.
- **Phone time against the database clock:** SM-09 and REL-01. The database
  clock decides; the phone's time is a label (reading 4).
- **What a heartbeat for an ended journey gets:** a distinct non-2xx, per the
  reviewers' note in `progress/m2.md` and SM-07's "ignored".

Answered by the owner on 2026-10-03, each with Claude's recommendation:
1. **D-101: only the device that started a journey may send its
   heartbeats.** The journey stores `device_id`. Another device of the same
   walker gets 403 `NOT_THE_JOURNEYS_DEVICE` and changes nothing. Another
   walker's journey stays 404. The migration refuses to guess the device of
   journeys that already exist (approach item 7). Held by LOST-01-AC10 and
   LOST-01-AC20.
2. **D-102: `apps/server/src/log.ts` needs the owner's approval.** It joins
   CODEOWNERS and `OWNER_APPROVAL_PATHS`, but not the ai-review `safety`
   filter, so `ai-review.yml` is not edited and no hand merge is needed. Held
   by gate tests in the test plan, not by an acceptance criterion.
3. **D-103: the start request needs no event ID.** SM-08 is read as "every
   event must be safe to receive twice", and a repeated start already is.
   SM-01's route and contract are unchanged.

Found while finalising, and answered by the owner on 2026-10-03 with
Claude's recommendation:

4. **D-102, amended: a named exception in the gate test that ties owner paths
   to the safety filter.** `scripts/gate.test.mjs`, "the safety filter in
   ai-review.yml matches the paths the owner must approve" (lines 503–521),
   requires every `/apps/` path in `OWNER_APPROVAL_PATHS` to be in the
   `safety` filter. That test gets one exception, pinned exactly to
   `['/apps/server/src/log.ts']` and citing D-102. `test-author` writes it
   with its reason (RG-03), and `test-auditor` reviews it. Every other path
   still has to be in the filter, and a second exception would have to show
   itself in a test. Rejected: adding `log.ts` to the filter (an
   `ai-review.yml` edit, so no CI review of LOST-01 and a hand merge), and
   owning it later.
