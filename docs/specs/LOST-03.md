# LOST-03 · Back in contact: a heartbeat, or a queued "I'm home", after an alert resolves it and stands every responder down

**Milestone:** M2, task 4 of 8 (D-090) · **Delivers:** LOST-03 (its server
half); SM-04 (its server half), with the server's "I'm home" route; stopping
a resolved alert's retries, left here by LOST-02 · **Decisions:** D-011,
D-014, D-021, D-031, D-033, D-036, D-042, D-074, D-075, D-086, D-087, D-090,
D-091, D-092, D-095, D-097, D-098, D-099, D-100, D-101, D-102, D-103, D-105,
D-106, D-107, D-108, D-109, D-110, D-111, D-112 · **Written:** 2026-10-06,
against `main` at `5cd5d24` (LOST-02 merged) plus the record commit `33bdf1c`
on this branch, as the coordinating session reported them. This session has
no shell, so the commits were not checked; every file named below was read
at the state the branch holds · **Finalised:** 2026-10-06, with the owner's
answers to Q1 and Q2 (D-110, D-111; "Answered by the owner", at the end of
this file), as the coordinating session relayed them · **Status:** 📝 Spec,
settled; red phase and review loop 1 applied (2026-10-06).

## Requirement

### The rules this task delivers

**LOST-03** (`docs/plan/01b-mvp-scope.md`, LOST section, Must):

> When heartbeats resume, responders get "<name> is back in contact" with the
> current position.

**SM-04** (`docs/plan/05-architecture.md`, edge-case rules, binding under
D-033):

> LOST_CONTACT → ENDED (home) is allowed, e.g. when a queued "I'm home"
> arrives after reconnecting. The alert is resolved and responders get
> "<name> is home".

### The owner's scope (D-090, item 4, and the roadmap)

D-090, item 4 (accepted by the owner, 2026-10-01):

> **LOST-03 — Back in contact;** SM-04.

`docs/plan/10-roadmap.md`, "M2 — Core safety loop in detail", row 4, **done
when:**

> A heartbeat, or a queued "I'm home", after an alert resolves it and tells
> the responders, at L6

L6 is "complete flows through the real API with recording fakes for push and
SMS and a controlled clock" (`06-testing-strategy.md`, the levels table).

### What D-033 fixed

The two rows of the journey state machine this task meets
(`05-architecture.md`, binding under D-033). The second names the I'm-home
story by its ID in the original; it is replaced by a name here, for the
reason under "How this spec names requirements":

> | LOST_CONTACT | Heartbeat | ACTIVE | Resolve the alert; "back in contact" (LOST-03) |
> | ACTIVE | "I'm home" | ENDED (home) | "<name> is home" ([the I'm-home story]) |

The alert states (same section, with the same replacement):

> `OPEN` → `ESCALATED` (no acknowledgement within 2 minutes; SMS sent,
> [escalation to SMS]) → `ACKNOWLEDGED` → `RESOLVED` (for example "They're
> safe", ["They're safe"]). An `OPEN` alert can also go straight to
> `ACKNOWLEDGED` (other responders see who is on it) or `RESOLVED` (the phone
> is back in contact, or the journey ended).

The 24-hour rule (edge-case rules, 6th row) begins: "A LOST_CONTACT journey
ends when the phone reconnects and the walker ends it". That clause is SM-04's
case; the rest of the row is task 7's.

### Inputs this spec builds on

- **D-021:** "Responders are alerted when the server has heard nothing from a
  journey for 5 minutes." **REL-01** (binding, D-022): "The lost-contact
  decision is made by the server, using the server's clock, never the
  phone's." **AR-03:** domain code never reads the clock.
- **F2** (`03-safety-reliability-security.md`, failure modes): "No coverage
  (tunnel, basement, lift, cabin) | False alarm | Phone queues positions and
  sends them on reconnect; 'back in contact' message; threshold tuned for
  this". This task is F2's server half.
- **The offline-queue rule** (reliability table, 2nd row): positions recorded
  offline are queued on the phone and sent in order when the connection
  returns. So after a silence the server meets queued heartbeats, and, from
  M3, a queued "I'm home".
- **D-011:** "A journey ends when the walker taps 'I'm home' or when the
  automatic stop … kicks in."
- **D-086** (content-free push): "Push messages carry no personal data … The
  app fetches the details from our EEA server." **D-087**, item 1: only the
  lost-contact alert uses Critical Alerts; and its owed tests ask for "an
  opaque, per-message collapse ID, never a walker, user or journey ID".
- **D-101:** a journey's heartbeats come only from the device that started it.
  **D-103:** "Each later event (LOST-03, [task 5], [task 7]) decides in its
  own task whether it needs an ID", and SM-08 reads as "every event must be
  safe to receive twice".
- **D-106:** the route that reads an alert's details comes with the alert
  screen in M3. **D-108:** the outbox is our own table, delivered by the
  worker's loop: claim, send outside any transaction, mark; retries from
  10 s, doubling, capped at 60 s.
- **The threat model** (`03-safety-reliability-security.md`): "What we
  protect: … the ability to end journeys and to silence alerts." **F10:**
  "Someone else taps 'I'm home' on an unlocked phone | False reassurance |
  **Known limitation in the MVP**, documented."
- **AR-05:** a state change and the messages it causes are saved in one
  transaction. **AR-06:** the watchdog is idempotent and lock-safe.

### What earlier tasks left for this one

Each is met here, and the criterion that proves it is named.

| Left for task 4 | Where it was left | Where it is met |
|---|---|---|
| "A journey in `LOST_CONTACT` takes a heartbeat and stays in `LOST_CONTACT` … That move … is the back-in-contact story (task 4)" | LOST-01's spec, reading 7 | Approach items 2 and 3; AC1, AC2 |
| "Retries go on while the alert is open. Stopping them when an alert resolves is task 4's." | LOST-02's spec, approach item 5 | Approach item 4; AC7 |
| The five-minute race: a heartbeat received just before 5:00 and committed just after the open "is stored against `LOST_CONTACT` … and task 4 then sends 'back in contact'" | LOST-02's spec, risks (F2) | Approach item 3; AC11 |
| "Back in contact and resolving the alert (task 4), including stopping retries for a resolved alert" | LOST-02's spec, out of scope | The whole task |
| "Ending a journey for any reason: the back-in-contact end rule (task 4) … and the end time and reason columns" | SM-01's spec, out of scope | Approach items 5 and 6; AC14 to AC17, AC20 (D-110) |
| "Nothing in M2 ends a journey until task 4 or 7 … the canary (task 8) will need an end" | SM-01's spec, risks | Approach item 5 (D-110) |
| Whether this task's events need an event ID | D-103 | Reading 10 |
| `insertStarted`'s comment: once a journey can end, "it may end between the conflict and this read; then the start should retry the insert once rather than answer 500" | `adapters/journeys.ts` | "Left for later tasks", with the reason |

`docs/progress/m2.md`'s "Left for later tasks" lists were read for anything
sent to task 4: LOST-01's (task 3, the login task, M4, M5 and the owner) and
LOST-02's (task 8, M3, M4 and the owner) name none. SM-01's sections name
tasks 2 and 3 only.

### What exists today, and what does not

Read on 2026-10-06, in the files themselves:

- **No route ends a journey.** `packages/contracts/src/contract.ts` is `{
  health, startJourney, recordHeartbeat }`, and `api.ts` registers exactly
  those three. Nothing in the code can set `ENDED`; the tests put it in
  directly (`endJourney` in the shared behaviour suite: "nothing in the code
  can end one yet").
- **The domain:** `JOURNEY_EVENTS` is `['start', 'heartbeat', 'silence']`;
  `MESSAGE_KINDS` is `['LOST_CONTACT']`; `ALERT_STATES` holds all four
  states, and only `OPEN` is ever written. The heartbeat rule records a
  `LOST_CONTACT` journey's heartbeat and leaves it `LOST_CONTACT`.
- **The heartbeat's store** (`recordHeartbeat`): one transaction that locks
  the journey's row, answers `ended` for `ENDED`, inserts the heartbeat once
  per event ID (else `duplicate`), its position, and moves last contact with
  `greatest`.
- **The outbox:** `alert_id` is not null; one row per (alert, recipient,
  kind); the claim takes `sent_at is null and next_attempt_at <= now()`,
  `for update skip locked`, at most 50, leased 30 s; the partial index
  `outbox_unsent_due_index` is `(next_attempt_at, id) where sent_at is null`.
- **`alerts`** has no resolution time; **`journeys`** has no end time or end
  reason.
- **The log** has seven closed events.
- **The worker's delivery loop** runs every 10 s, and is woken at once only by
  a sweep that opened an alert (`worker.ts`).

So "a queued 'I'm home'" could not arrive. The owner chose, on 2026-10-06,
to build the server half of the "I'm home" route in this task (Q1, **D-110**):
`POST /v1/journeys/{journeyId}/home`. From `ACTIVE` it tells nobody until M3.

### Readings this spec makes

Each is stated so the reviewers can check it, not assumed quietly.

1. **"When heartbeats resume"** means: a heartbeat is stored for a
   `LOST_CONTACT` journey (from its own device, D-101; not a duplicate,
   SM-08), and, counted with it, the journey's silence is **under five
   minutes** by the database clock. The silence is measured exactly as the
   watchdog measures it, from `coalesce(last_heartbeat_at, started_at)` to the
   transaction's `now()`.
   - It is the watchdog's rule asked the other way, at the same threshold:
     silent five minutes or more is lost; under five minutes is in contact.
     Two rules at one boundary cannot disagree, so a journey moved back is
     never already overdue, and none flaps between the two in one sweep.
   - **A heartbeat whose own silence is already five minutes or more brings
     nothing back.** That needs a heartbeat received at least five minutes
     before it is stored: an API process that froze between reading the time
     and taking the row. It is stored and moves last contact (LOST-01), and
     the alert stays open. Without this rule it would send "back in contact"
     for a phone that has been silent ever since, and the next sweep, 10 s
     later, would alert again.
   - **The five-minute race resolves.** A heartbeat received at 4:59.999 and
     stored just after the open leaves a silence of milliseconds, so it
     brings the journey back at once. That is the nearest the server can get
     to SM-09's receive order, in which the alert would never have opened.
2. **"Resolves"** means the alert moves to `RESOLVED` from whichever state it
   is in (`OPEN` today; `ESCALATED` and `ACKNOWLEDGED` once tasks 5 and 6
   write them), with `resolved_at`, the database time, and a resolution:
   `BACK_IN_CONTACT` or `HOME`. Exactly the journey's one unresolved alert
   (LOST-02's index holds at most one). Older resolved alerts are untouched.
3. **The journey afterwards:** `ACTIVE` after a heartbeat (D-033's row), and
   watched again as any journey is: a new silence opens a new alert.
   `ENDED`, end reason `HOME`, with `ended_at`, after "I'm home" (D-110).
4. **"Responders get"** means: every responder stored with the journey
   (`journey_responders`) gets one stand-down message for that alert,
   `BACK_IN_CONTACT` or `HOME`, written in the same transaction, **whether or
   not their own lost-contact push went out** (the owner's answer to Q2,
   **D-111**). These are exactly the people the open told: it wrote one
   `LOST_CONTACT` message per responder row, and nothing in the code changes
   that list during a journey yet.
5. **"<name> is back in contact" with the current position** is app text and
   an app read. The push is content-free (D-086): it carries the message's
   ID, its recipient and its kind, and nothing else. The name is filled in on
   the phone, in bokmål first (D-014). The current position is the journey's
   latest heartbeat (LOST-01's `latestHeartbeatOf`), read through M3's
   access-checked route (D-106). This task stores what that read needs: the
   alert's `resolved_at` and resolution; the heartbeats are already stored.
6. **A lost-contact push not yet accepted when contact comes back is never
   sent again** (D-111). It is withdrawn in the transaction that resolves the
   alert. A critical, break-through alert about a silence that is already
   over is a false alarm (F2), and every false alarm teaches a responder to
   trust the next one less (F6). One that is already in the push port's
   hands cannot be recalled: its send finishes, its mark records what the
   port said, and it is never retried.
7. **A stand-down never overtakes its alert at the push port.** The server
   never hands a responder's stand-down to the port while that responder's
   lost-contact push for the same alert may still be in the port's hands
   (approach item 4, "the hold"). Past the port, APNs and FCM promise no
   order, so the app must show the alert's current state when opened, never
   infer it from the order notifications arrived in. That is M3's.
8. **Once.** One resolution per alert, and one stand-down per responder per
   alert. The database holds the second: the alert's `state <> 'RESOLVED'`
   in the resolve's `WHERE`, and the existing unique (alert, recipient,
   kind).
9. **A heartbeat after the alert resolved** is ordinary contact: recorded,
   nothing else. After "I'm home" it is SM-07's: answered 409
   `JOURNEY_ENDED`, nothing stored, one line without location.
10. **Duplicates.** A heartbeat already has an event ID (LOST-01), and a
    duplicate changes nothing, so it never brings contact back (LOST-01,
    reading 3). **"I'm home" needs no event ID** (D-110), by D-103's reading:
    a second one finds the journey `ENDED`, is answered 409, and changes
    nothing, as a second start finds the first journey.
11. **Two states the code never makes are met in the safe direction.**
    - A `LOST_CONTACT` journey with no unresolved alert (only a hand edit or
      a test makes one) still moves back on fresh contact, with no message,
      and the module writes one `alert_missing` line naming it. Refusing
      would leave it `LOST_CONTACT` for good, and the watchdog never sweeps a
      `LOST_CONTACT` journey: nobody would watch it again.
    - **"I'm home" on such a journey** ends it, `ENDED` with reason `HOME`,
      writes no message, and writes the same one `alert_missing` line. It
      goes through the same resolving helper, so it meets the same missing
      alert, and says so rather than ending quietly (fail loudly). Refusing
      would leave the walker unable to end a journey nobody watches.
    - A journey with no responder rows left still moves back and resolves
      its alert, writing no stand-down. Nothing in the code removes a
      responder yet. The open refuses a journey with nobody to tell, because
      moving it would hide the silence; the resolve does not refuse, because
      refusing would hide the journey.
12. **A queued "I'm home"** (D-110) arrives as any "I'm home" does, through
    the route built here: the server cannot tell a queued one from a fresh
    one, and need not. From `LOST_CONTACT` it ends the journey, resolves the
    alert and tells every responder "is home" (SM-04). From `ACTIVE` it ends
    the journey and tells nobody yet: that end notice is the start-and-end
    story's, in M3. Only the journey's own device may send it (D-101's
    reasoning, applied to the threat model's "ability to end journeys and to
    silence alerts").

### How this spec names requirements, and why

The `traceability` job runs `req:coverage --fail-on-uncovered-changed`. It
fails if a changed spec names a tracked requirement, or an acceptance
criterion, that no test names (`scripts/lib/requirements.mjs`:
`uncoveredInChanges`, `uncoveredCriteria`; `mentions` matches an ID anywhere
in the text, so a range written with IDs names both of its ends).
Read in the code on 2026-10-06, not run: this session writes one file.
`docs/requirements-status.md` was read the same day: 14 of 63 live
requirements have a test.

- **Delivered here, and must be named by a test:** LOST-03 and SM-04, both ⚪
  today.
- **Cited, already covered, and not claimed:** LOST-01 (13 tests), LOST-02
  (13), SM-01 (9), SM-02 (4), SM-03 (4), SM-07 (3), SM-08 (2), SM-09 (3),
  REL-01 (9), REL-08 (6), SEC-03 (7), SEC-06 (1), SEC-07 (7), PRIV-07 (6).
  Several criteria here strengthen them, and their tests name them too (test
  plan).
- **Untracked, named freely:** AR-, D-, F-, RG-, INF-, BUG-, A-, HK- and L-
  IDs (D-074).
- **Every other tracked requirement is named in words**, in this spec, in
  product code and in its comments (the live gotcha in `docs/progress.md`).
  The implementer names later tasks in words too.

| Name used here | Where it lives |
|---|---|
| the I'm-home story | `01b-mvp-scope.md`, JRN section, 5th story (M3) |
| the start-and-end story | JRN section, 4th story (M3) |
| the what-responders-see story | JRN section, 3rd story (M3) |
| the two-hour story | JRN section, 6th story (M3) |
| "I'm on it", escalation to SMS, "They're safe" | LOST section, 6th, 7th and 8th stories (tasks 5, 6 and 7) |
| the low-battery story | LOST section, 4th story (M3) |
| the what-to-do story | HELP section, 1st story (M3) |
| the login task | GRP section, 1st story (M3) |
| the call-sharing story | CALL section, 3rd story (M3) |
| the offline-queue rule, the alert-level rule, the canary rule, the accuracy-and-age rule | `03-safety-reliability-security.md`, reliability table, 2nd, 6th, 10th and 11th rows |
| the abusive-member threat | same file, threat model, 2nd row |
| the responders-only rule, the retention rule | `02-norway-law-privacy.md`, privacy table, 3rd and 4th rows |
| the two-hour rule, the 24-hour rule, the resumed-escalation rule | `05-architecture.md`, edge-case rules, 5th, 6th and 10th rows |

**Partial delivery shows as full.** Once tests name them, LOST-03 and SM-04
turn 🟢. These halves remain, and "Out of scope" lists each: the name and
the current position on the responder's screen (M3, D-106); the text and its
language; the notification level of the new kinds (M3, D-087); the app's
"I'm home" button and its queue (the I'm-home story, M3).

## Approach (technical choices delegated to Claude, D-031)

1. **Where the code goes, and why there.**
   - **The rules:** `domain/journey.ts` gains the `contact` event, the
     `home` event, and three lists. Owned, filtered and mutation-tested
     (`domain`).
   - **The SQL:** `adapters/journeys.ts`. The back-in-contact path lives
     inside `recordHeartbeat`'s transaction, because it must be one
     transaction with the heartbeat (item 3). "I'm home" is a new method of
     the same store. Both use one internal helper that resolves an alert
     (item 4), so later tasks that resolve alerts (5 to 7) have one place to
     call. The file is owned and filtered (D-092).
   - **The module:** `modules/journeys/service.ts` gains `home()`, and
     `heartbeat()` maps the store's new answer. Owned, filtered,
     mutation-tested (`journeys`).
   - **The route** (D-110): `api.ts` (owned, filtered, D-097) and
     `packages/contracts` (filtered).
   - **Unchanged:** `modules/alerts/` (the watchdog and the sender),
     `worker.ts`, `api-process.ts`, `adapters/db.ts`, `domain/watchdog.ts`.
     The sender hands any kind to the port as it is; what changes for
     delivery is the claim's SQL, in the adapter (item 7).

2. **The rules (`domain/journey.ts`).**
   - `JOURNEY_EVENTS` becomes `['start', 'heartbeat', 'silence', 'contact',
     'home']`.
   - **The heartbeat rule is unchanged.** It decides, on a read without a
     lock, whether this device may be heard: not found, ended, not the
     journey's device, or recorded. Its `LOST_CONTACT` row stays `{ type:
     'recorded', state: 'LOST_CONTACT' }`.
   - **`contact` is the store's question, under the row lock, after it
     stored a heartbeat:** `{ type: 'contact', silentSince, now }`, both
     database times. For a `LOST_CONTACT` journey, when `now − silentSince <
     LOST_CONTACT_AFTER_MS`, the outcome is `{ type: 'back_in_contact',
     state: 'ACTIVE', alert: 'RESOLVED' }`. Every other situation is `{ type:
     'unchanged' }`: `ACTIVE`, `ENDED`, no journey, a `LOST_CONTACT` journey
     still silent five minutes or more, and a time that is not one (no
     comparison with an invalid `Date` holds, so the alert stays open).
   - **Why an event of its own.** Whether contact is back depends on two
     times that exist only inside the store's transaction: the journey's
     silence once this heartbeat is counted, and that transaction's `now()`.
     The heartbeat rule runs before the store, on a read without a lock.
     `contact` is `silence` asked the other way, so the boundary is written
     once (`LOST_CONTACT_AFTER_MS`) and the transition table holds both
     sides.
   - **`home`** (D-110): `{ type: 'home', walkerId, deviceId }` on the journey
     it names (`JourneyForHeartbeat`), in the heartbeat rule's order, which
     is part of the rule:
     1. no journey, or another walker's → refused, `JOURNEY_NOT_FOUND`;
     2. `ENDED` → ignored, `JOURNEY_ENDED` (SM-07);
     3. not the journey's device → refused, `NOT_THE_JOURNEYS_DEVICE`;
     4. `ACTIVE` → `{ type: 'ended', state: 'ENDED', reason: 'HOME',
        resolvesAlert: false }`;
     5. `LOST_CONTACT` → the same with `resolvesAlert: true` (SM-04).
   - **The lists, each the one source for the table, the type and the
     database's enum (D-108's "one list"):**
     - `MESSAGE_KINDS = ['LOST_CONTACT', 'BACK_IN_CONTACT', 'HOME']`;
     - `ALERT_RESOLUTIONS = ['BACK_IN_CONTACT', 'HOME']`. A stand-down's kind
       is its resolution's own name, held at typecheck (`satisfies` against
       `MessageKind`);
     - `JOURNEY_END_REASONS = ['HOME']`. The automatic stop, "They're
       safe" and the 24-hour rule add theirs in their own tasks.
   - Pure, total, and no clock. The `switch` and its `never` default make a
     missing case a type error, as today.

3. **Back in contact, inside `recordHeartbeat`'s one transaction.** Steps 1
   to 3 are LOST-01's, unchanged:
   1. Lock the journey's row (`for update`). `ENDED` → answer `ended`.
   2. Insert the heartbeat once per event ID. A duplicate → answer
      `duplicate`, and nothing else: the journey stays as it is.
   3. Insert its position, if any; move last contact with `greatest`.
   4. **If the locked state was `LOST_CONTACT`:** read the journey's silence
      start after step 3 and the transaction's `now()` (one statement, or the
      update's `returning`), and ask the domain's `contact` rule. `unchanged`
      → answer `recorded`.
   5. `back_in_contact` → `update journeys set state = 'ACTIVE' where id = $1
      and state = 'LOST_CONTACT'`. It must change exactly one row, or the
      transaction is rolled back. Then resolve the alert (item 4) with
      resolution `BACK_IN_CONTACT`.
   6. Commit, and answer `{ outcome: 'back_in_contact', alertId, messages }`;
      `alertId` is null when there was no unresolved alert (reading 11).
   - **Any error rolls back all of it**, the heartbeat included, and is
     replaced by LOST-01's `HeartbeatStoreError` (SQLSTATE only, no cause).
     The module writes one `heartbeat_failed` line, stage `store`, and the API
     answers 500. The phone resends with the same event ID, which is then not
     a duplicate, because nothing was stored. One transaction is AR-05's
     rule: no `ACTIVE` journey with an open alert, no resolved alert without
     its stand-downs.
   - **The module** maps `back_in_contact` to `{ type: 'recorded' }`, so the
     API answers 200 `RECORDED`, as for any stored heartbeat. The phone has no
     use for the difference, and the heartbeat's contract does not change.
     With `alertId` null it writes one `alert_missing` line.

4. **Resolving an alert: one helper, inside the transaction that moved the
   journey** (both paths; tasks 5 to 7 call it too).
   1. **Resolve.** `update alerts set state = 'RESOLVED', resolved_at =
      now(), resolution = $r where journey_id = $j and state <> 'RESOLVED'
      returning id`. At most one row, by LOST-02's index. None → no
      withdrawal and no stand-down; the move stands (reading 11).
   2. **Withdraw** (D-111). `update outbox set withdrawn_at = now() where
      alert_id = $a and kind = 'LOST_CONTACT' and sent_at is null and
      withdrawn_at is null returning recipient_id, attempts,
      next_attempt_at`.
      - The update takes each row's lock, so a claim in progress (one
        statement) finishes first. PostgreSQL then checks the `WHERE` again
        against the row the claim or a mark committed: a message a mark has
        just sent is not withdrawn; one a claim has just taken comes back
        with its new attempt count and lease.
      - Sent messages are untouched. A withdrawn message keeps its attempts
        and last failure: the alert record says what happened.
   3. **Stand down.** One outbox row per row of `journey_responders` for the
      journey: `alert_id` the resolved alert, `kind` the resolution's name, a
      new random UUID, `created_at = now()`, `attempts = 0`, and
      `next_attempt_at` as the hold says (below). None when there is no
      responder row; no rollback (reading 11). The unique (alert, recipient,
      kind) makes a second one impossible.
   4. **The hold** (reading 7). A responder's stand-down is due at `now()`,
      unless their lost-contact message was withdrawn in step 2 having been
      handed to the port at least once (`attempts ≥ 1`) and its
      `next_attempt_at` is still after `now()`. Then the stand-down is due at
      that `next_attempt_at`:
      - the end of the claim's lease (30 s after it was claimed) when it may
        be being sent now;
      - its retry time (10 to 60 s) when its last attempt failed. It will
        not be retried, so this wait is caution, not need: the two cases
        cannot be told apart from the row.

      So a stand-down waits **at most 60 s**, the larger of the lease and
      the retry cap, and only for a responder whose lost-contact push was
      handed over and not yet accepted. A sent one, or one never handed
      over, costs no wait.
      - **Why a due time, and not a check in the claim.** The claim would
        have to look at another row (the lost-contact message) when
        deciding. Under READ COMMITTED, a statement that waited for a row's
        lock checks that row's own columns again, but not, reliably, another
        row it joined to (recalled from PostgreSQL's documentation, not
        checked here). A due time written on the stand-down's own row needs
        no such check. AC7's and AC8's L3 tests are the evidence for the
        withdrawal's side.
      - **The order holds only while a send ends within its lease.** M3's
        push adapter must bound every send under `CLAIM_LEASE_MS` (LOST-02
        already asks it to bound each send).
   5. **A new alert withdraws the earlier alerts' unsent stand-downs**
      (review loop 1, `safety-reviewer`). A stand-down that cannot be
      delivered is retried for ever (item 7). Without this, an earlier
      alert's "back in contact" could reach a responder after a later
      alert's lost-contact push, while the later alert is open: a false
      all-clear in the middle of a real alert. `safety-reviewer` reproduced
      it in-process: a failing push, alert A1 opens, a heartbeat resolves
      A1, about seven minutes of silence, A2 opens, the push recovers. The
      port then got `LOST_CONTACT` for A2 and then `BACK_IN_CONTACT` for A1.
      - **The fix is in the open's transaction** (`openInside`, LOST-02's
        code): `update outbox set withdrawn_at = now()` on every message of
        an earlier alert of the same journey whose kind is not
        `LOST_CONTACT`, still unsent and not yet withdrawn. The earlier
        alerts' unsent lost-contact messages were already withdrawn when
        those alerts resolved (step 2).
      - It runs before the new alert's messages are written, in the same
        transaction, so it is all or nothing with them (LOST-02-AC12): an
        open that rolls back withdraws nothing.
      - One already in the port's hands was handed over before the new
        alert opened, so it reaches the port before the new lost-contact
        push, from one sender. Two senders at once are the deploy overlap
        ("Left for later tasks").
      - It extends what LOST-02-AC9 says an open writes; the criterion that
        proves it is AC8, and its tests are in "Tests added in review loop
        1".
   - **Why withdraw, and why every responder, sent or not** (D-111): a
     critical alert about a silence that is already over is a false alarm,
     and nobody who may have heard of the loss is left un-told. The
     reasons are in "Answered by the owner", Q2, at the end of this file.

5. **"I'm home"** (D-110).
   - **The route:** `POST /v1/journeys/{journeyId}/home` (contract path
     `/journeys/{journeyId}/home`), built on `deviceRoute`. The journey is in
     the path, and the request holds nothing else; a body with any key is
     refused with the fixed 400 (SEC-07: strict).
   - **The input is detailed, not compact** (`inputStructure: 'detailed'`):
     `params` is a strict object holding `journeyId` alone, and `body` is an
     empty strict object, optional. The journey's ID therefore comes from the
     path and nowhere else, and any key in the body is a 400. **Why:** oRPC's
     default, compact input merges the path's parameters with the body, and
     the body wins, so with one strict object `{ journeyId }` a body naming
     another journey would pass validation and override the path.
   - **The answers.** Each is a fixed shape; none carries anything of the
     request.

     | Status | Code / body | When |
     |---|---|---|
     | 200 | `{ "outcome": "ENDED" }` | Ended now, from `ACTIVE` or `LOST_CONTACT` |
     | 400 | `BAD_REQUEST`, fixed, no `data` | A journey ID that is not a UUID, or a body with any key |
     | 401 | `UNAUTHORIZED` (unchanged, D-091) | No valid device credential |
     | 403 | `NOT_THE_JOURNEYS_DEVICE` | Another device of the same walker. Nothing changes |
     | 404 | `JOURNEY_NOT_FOUND` | No such journey, or another walker's: one body for both |
     | 409 | `JOURNEY_ENDED` | Already ended, whatever ended it; a repeat "I'm home" included. Nothing changes |
     | 500 | unchanged | The read or the write failed. Nothing changes |

     The route's description says a 200 and a 409 both mean the journey is
     over: the app stops tracking and drops anything queued for it (M3).
   - **The module:** `home({ walkerId, deviceId, journeyId })` reads the
     journey (`journeyForHeartbeat`, which already returns its walker, device
     and state), asks the `home` rule, returns a refusal as it is, and
     otherwise calls `recordHome` with the journey, the walker and the
     device. A store answer `already_ended` (the journey ended after the
     read) is the same refusal, `JOURNEY_ENDED`. Each
     `JOURNEY_ENDED` writes one `home_ignored` line (SM-07). A store answer
     `home` from `LOST_CONTACT` with `alertId` null (no unresolved alert was
     found) writes one `alert_missing` line naming the journey, as the
     heartbeat's path does (reading 11). It reads no clock: the end time is
     the transaction's `now()`.
   - **The store:** `recordHome({ journeyId, walkerId, deviceId })`, one
     transaction. **It asks the domain under the lock** (AR-04; review loop
     1, `code-reviewer`), so the `home` rule's decision is the one written,
     not a copy of it:
     1. lock the journey's row, reading its `walkerId`, `deviceId` and
        `state` (`for update`; the API's 5 s lock limit bounds the wait);
     2. ask `transition(locked, { type: 'home', walkerId, deviceId })`:
        - `ignored` (`JOURNEY_ENDED`) → answer `{ outcome: 'already_ended' }`
          and write nothing;
        - `refused` cannot happen under the lock (the module asked the same
          rule about the same journey, and neither its walker nor its device
          changes), so it throws: a 500 and one `home_failed` line, never a
          guess;
        - `ended` → go on;
     3. `update journeys set state = <decision.state>, ended_at = now(),
        end_reason = <decision.reason> where id = $1 and state = <the locked
        state>`, exactly one row or roll back;
     4. resolve the alert (item 4) with resolution `HOME` **only when
        `decision.resolvesAlert`**;
     5. answer `{ outcome: 'home', from: <the locked state>, alertId,
        messages }`.

     The store applies the locked state, not the module's read: a journey
     the watchdog moved to `LOST_CONTACT` after the read is ended as SM-04
     says, and one a heartbeat brought back is ended from `ACTIVE`, its
     alert already resolved.
   - **`already_ended`, not `ended`** (review loop 1, `code-reviewer`). The
     store's answer for a journey already ended is named for what it means.
     In the domain and the module, `ended` means "ended now"; one word for
     both would read the wrong way in one of the layers.
     `RecordHeartbeatResult` keeps its `ended`, which LOST-01 named and which
     means the same there as `already_ended` here.
   - **A 400's error object holds the request's headers** (review loop 1,
     `privacy-security-reviewer`). With detailed input, oRPC puts
     `request.headers`, the device credential among them, into the
     validation error's `cause.data` on any 400. Nothing prints that object
     today: the answer is the one fixed body (`BAD_REQUEST_BODY` in
     `api.ts`), and no log event has a field for it. A comment beside
     `BAD_REQUEST_BODY` says so, so a later change that logs or echoes the
     error knows what it would leak; a capture test (AC19) holds it.
   - **Failures:** one `home_failed` line, stage `read` or `store`, with the
     SQLSTATE, then a 500. `recordHome` binds no location and no phone
     number, so no error of its can carry one; its errors are not rewritten
     as the heartbeat's are, and the module still writes only the stage and
     the SQLSTATE.
   - **What ending does not do here:** tell responders of an end from
     `ACTIVE` (the start-and-end story, M3), stop the phone's sharing or
     hide the live position (the I'm-home story, M3: no route reads a
     position yet, D-106).
   - **The canary** (task 8) ends its journeys through this route; SM-01's
     spec noted it would need one.

6. **The tables** (migration `0004_*.sql`, generated by `pnpm --filter
   @trygghverdag/server db:generate` and committed; additive):

   | Table | Change | Constraints |
   |---|---|---|
   | enum `message_kind` | + `BACK_IN_CONTACT`, `HOME` | Equals `MESSAGE_KINDS`, in order |
   | enum `alert_resolution` (new) | `BACK_IN_CONTACT`, `HOME` | Equals `ALERT_RESOLUTIONS` |
   | `alerts` | + `resolved_at` (database time), + `resolution` | Both null, or both set (a check) |
   | enum `journey_end_reason` (new) | `HOME` | Equals `JOURNEY_END_REASONS` |
   | `journeys` | + `ended_at` (database time), + `end_reason` | Both null, or both set (a check) |
   | `outbox` | + `withdrawn_at` (database time) | — |

   - **Adding enum values inside the migration's transaction.** drizzle-orm
     applies every pending migration in one transaction (LOST-01's spec,
     read in drizzle-orm 0.45.3). PostgreSQL 12 and later accept `ALTER TYPE
     … ADD VALUE` there, but the new value cannot be used until the
     transaction commits. So `0004` must not use either new value: in no
     check, default or index predicate. The same two strings are also the
     values of the two new types, `alert_resolution` and
     `journey_end_reason`; their `create type` statements are the only other
     place `0004` names them, and those are values of other types, not a use
     of `message_kind`'s (AC20). On an empty database every
     migration runs in that one transaction, so `0003` creates
     `message_kind` and `0004` adds to it before either commits. This is
     recalled from PostgreSQL's documentation and **not checked here**; the
     L3 runs on PostgreSQL 15 (`deploy.integration.test.ts`: the empty
     database, and the database at `0003` holding rows) are the evidence.
   - **No check ties a state to its time** (`RESOLVED` to `resolved_at`,
     `ENDED` to `ended_at`). Existing rows put in directly, by tests and by
     hand, have the state without the time, and a database holding one
     would refuse the migration. The code sets them together; L3 asserts it.
   - **The claim's partial index is unchanged** (`where sent_at is null`).
     Withdrawn rows stay in it, unsent, until the retention work (M4)
     removes them. At the private group's scale that is nothing; revisit
     with L10's numbers. Changing its predicate would drop and recreate an
     index for no gain now.
   - **No location, no phone number, no name** in any new column.
   - The migration changes no existing row; every new column is null on
     them.

7. **Delivery.**
   - **The claim gains one condition: `and withdrawn_at is null`.** A
     withdrawn message is never handed out again, whatever its due time or
     what its last mark wrote. The marks are unchanged: a withdrawn message
     that was in the port's hands is marked sent, or failed, as the port
     answered.
   - **The sender is unchanged.** It hands each message to the port with its
     ID, recipient and kind, and nothing else (D-086). Each message has its
     own random ID (D-087).
   - **Stand-downs are written by the API process, and delivered by the
     worker's next delivery run,** at most 10 s later (plus the hold). No
     cross-process wake: the plan sets no time for a stand-down, and a wake
     would mean `LISTEN`/`NOTIFY` on the worker's second connection for
     seconds nobody would notice.
   - **Retries are LOST-02's** (10 s, doubling, capped at 60 s), for as long
     as a message is unsent and not withdrawn. For a stand-down that is for
     ever. "Left for later tasks" names who decides when one is given up.

8. **The lock order, and the watchdog (AR-06).**
   - **The journey's row first, always.** The heartbeat, "I'm home" and the
     watchdog's open each take it before touching an alert or an outbox row.
     The claim never waits (`skip locked`), and a mark holds one outbox row
     for one statement. So no two of them can wait for each other in a
     cycle.
   - **Every wait is bounded.** On the API's pool, `lock_timeout` (5 s)
     bounds the waits for the journey's row, for the alert's and the
     outbox's rows (a claim's one statement), and for the `users` rows each
     new outbox row's foreign key locks. A wait that runs out is 55P03: a
     500, one failure line, and the phone resends. A frozen holder on either
     pool is ended by the 10 s idle limit (D-108).
   - **The worker's marks can now wait on the API** (review loop 1,
     `safety-reviewer`). A mark updates one outbox row, and the API's
     withdrawal (item 4, step 2) may hold that row; the worker's pool has no
     lock limit of its own. The wait is bounded all the same, by the API's
     limits: each of the API transaction's statements waits at most 5 s for
     a lock, and a frozen API transaction is ended after 10 s idle. The
     same holds for the open's withdrawal of earlier stand-downs (item 4,
     step 5), on the worker's own pool, under the open's transaction-local
     5 s lock limit and the 10 s idle limit. A mark that waits stalls
     delivery only, as LOST-02 said of its marks; it is never part of a
     cycle, because a mark holds one row for one statement and waits for
     nothing else. The adapter's header comment says this too.
   - **The watchdog is unchanged.** A heartbeat or an "I'm home" holding the
     row makes a sweep skip it. When they commit, the journey is `ACTIVE`
     and no longer overdue, or `ENDED`, so the sweep's check under the lock
     never opens it. Past the stuck threshold, the waiting attempt waits for
     them (milliseconds), finds the journey no longer matching, and skips it
     (LOST-02's AC20 rule).
   - The heartbeat's transaction is longer by a few statements: still no
     clock read and no network call, so still milliseconds.

9. **Database time (REL-01, AR-03).** Whether contact is back is decided on
   the journey's silence and the transaction's `now()`. `resolved_at`,
   `withdrawn_at`, `ended_at`, `created_at` and `next_attempt_at` are all
   `now()`. The domain is handed its times; the module reads no clock for
   "I'm home"; the phone's position time decides nothing. The fake store
   emulates `now()` with the fake clock it is given, and **throws when it has
   none and is asked whether contact is back, or to end a journey**, as it
   throws when asked about silence: a fake that guessed the time would prove
   nothing.

10. **The log** (PRIV-07; `log.ts`, owned under D-102). `LogEvent` gains three
    closed events, and nothing free-form:

    ```ts
    | { event: 'home_ignored'; reason: 'JOURNEY_ENDED'; journeyId: string }
    | { event: 'home_failed'; stage: 'read' | 'store'; code: string | null }
    | { event: 'alert_missing'; journeyId: string }
    ```

    - `createLog` checks each field as it does today: `journeyId` only as a
      canonical UUID, `reason` and `stage` only from their sets, `code` only
      as a SQLSTATE. An unlisted event still throws.
    - A back-in-contact writes no line. The alert's row is its record.

11. **No new dependency** (SEC-06), and **no new import route** (AR-10).
    `api.ts` wires the new route to the module; the module gets ports only.
    `packages/config/dependency-cruiser.cjs` is unchanged.

12. **Decisions recorded** (in `docs/plan/decisions.md`, 2026-10-06):
    - **D-110** (owner): the server half of the "I'm home" route is built in
      this task (Q1);
    - **D-111** (owner): unsent lost-contact pushes are withdrawn, and every
      responder is stood down (Q2);
    - **D-112** (delegated, D-031): the two new message kinds and the
      resolutions; the contact rule at the threshold (reading 1); no
      overtaking at the push port, with `withdrawn_at`, the claim's
      condition and the hold's 60 s bound; the route's detailed input
      (the journey's ID from the path only) and its 409 for any ended
      journey, a repeat included; the lock order; `alert_missing` and the
      safe direction for the two states the code never makes, on fresh
      contact and on "I'm home" alike (reading 11); no check tying a state
      to its time; the `journeys` mutation group running
      `journeys.system.test.ts`, then `contact.system.test.ts`. Amended in
      review loop 1: a new alert withdraws the earlier alerts' unsent
      stand-downs; "I'm home" asks the domain under the lock; the store's
      already-ended answer is `already_ended`.

    D-110 was the next free number in `decisions.md` when they were written.
    As the live gotcha says, check the open pull requests' `decisions.md`
    again before each push.

### Interfaces the tests are written against (RG-02: tests first)

The implementer may refine a name only with `test-author`, and only before
the tests are written.

- **`domain/journey.ts`:**
  - `JOURNEY_EVENTS` is exactly `['start', 'heartbeat', 'silence', 'contact',
    'home']`;
  - `MESSAGE_KINDS`, `ALERT_RESOLUTIONS`, `JOURNEY_END_REASONS`, and their
    types `MessageKind`, `AlertResolution`, `JourneyEndReason`;
  - `ContactEvent` and its outcomes `{ type: 'back_in_contact', state:
    'ACTIVE', alert: 'RESOLVED' }` and `{ type: 'unchanged' }`;
  - `HomeEvent` and its outcomes `{ type: 'ended', state: 'ENDED', reason:
    'HOME', resolvesAlert: boolean }`, `{ type: 'ignored', reason:
    'JOURNEY_ENDED' }`, `{ type: 'refused', reason: 'JOURNEY_NOT_FOUND' |
    'NOT_THE_JOURNEYS_DEVICE' }`.
- **`domain/watchdog.ts`:** unchanged. Its test pins the hold's bound from
  `CLAIM_LEASE_MS` and `retryDelayMs`.
- **`ports.ts`:**
  - `RecordHeartbeatResult` becomes `{ outcome: 'recorded' | 'duplicate' |
    'ended' } | { outcome: 'back_in_contact'; alertId: string | null;
    messages: AlertMessage[] }`;
  - `JourneyStore.recordHome({ journeyId, walkerId, deviceId })` → `{
    outcome: 'home'; from: 'ACTIVE' | 'LOST_CONTACT'; alertId: string |
    null; messages: AlertMessage[] } | { outcome: 'already_ended' }`
    (`RecordHomeResult`). The walker and the device are what the domain's
    `home` rule is asked with under the lock (approach item 5); the store
    rejects when the rule refuses there;
  - the three `LogEvent` members.
- **`modules/journeys/`:** `JourneyService.home({ walkerId, deviceId,
  journeyId })` → `{ type: 'ended' } | HeartbeatRefusal`. `heartbeat()`'s
  result type is unchanged.
- **`@trygghverdag/contracts`**: `reportHome` (the route, in
  `contract`), `homeRequestSchema`, `homeResponseSchema`, `homeErrors`, and
  the types `HomeResponse` and `HomeErrorCode`.
  - **The route's input is detailed:** `inputStructure: 'detailed'`, and
    `homeRequestSchema` is `{ params: z.strictObject({ journeyId }), body:
    <an empty strict object>, optional }`, with `journeyId` a UUID,
    lower-cased at the contract as the other routes' IDs are.
  - So the journey's ID comes from the path only, and any key in the body,
    a `journeyId` included, is the fixed 400 (AC16). With oRPC's default
    compact input, the path's parameters and the body are merged and the
    body wins, so a body naming another journey would override the path
    (approach item 5).
- **The test kit** (owned, D-100):
  - `fakeJourneyStore({ clock })`:
    - `recordHeartbeat` brings a `LOST_CONTACT` journey back as approach
      items 3 and 4 say, with the clock's now as the transaction's;
    - `recordHome({ journeyId, walkerId, deviceId })`, deciding by the
      same rule under its own "lock", as the adapter does;
    - an open withdraws the journey's earlier alerts' unsent stand-downs
      (approach item 4, step 5);
    - the claim skips withdrawn messages;
    - inspection: alerts with `resolvedAt` and `resolution`, and messages
      with `withdrawnAt` (today's tests read alerts and messages field by
      field, or compare one reading with another, so the new fields break
      none of them);
    - a journey's end, `endedAt` and `endReason`, read through an
      inspection of its own. `StoredJourney` (`journeys()`) and the suite's
      `JourneyAsStored` keep their shape: several tests compare them with
      exact literals (`journeys.system.test.ts`,
      `fake-journey-store.test.ts`), and a new field would fail them for no
      reason;
    - `failWith` and `beforeNext` for `recordHome`;
    - without a clock, it throws when asked whether contact is back or to
      end a journey.
  - `fakePush()`: `MessageKind` gains the two kinds, and the test kit's
    `MESSAGE_KINDS` (`fake-push.ts`) is held equal to the domain's by one
    test (review loop 1), since the test kit cannot import the server.
  - `fakeLog()`: the three events.
  - **The shared behaviour suite** gains the store's side of every criterion
    marked "behaviour suite" below, run against the fake (L2) and the
    adapter (L3). `JourneyStoreUnderTest` gains whatever reading back needs
    (an alert's resolution, a message's `withdrawnAt`, a journey's end, the
    last through a reader of its own, as above); the names are
    `test-author`'s.

## Acceptance criteria

### Back in contact (LOST-03)

**LOST-03-AC1 — After an alert, the phone's next heartbeat brings the journey
back, resolves the alert, and stands every responder down.** *(LOST-03)*
- **Given** walker W, with device D, starts journey J through the API,
  naming responders R1, R2 and R3, and D sends a heartbeat every 60 s for 10
  minutes, on the fake clock
- **And** D goes silent; at five minutes the watchdog sweeps and the sender
  delivers, so the recording push fake holds one `LOST_CONTACT` message for
  each of R1, R2 and R3
- **When** a minute later D sends a heartbeat with a new event ID through
  the API
- **Then** it is answered 200 `RECORDED`, and J is `ACTIVE`
- **And** J's one alert is `RESOLVED`, its `resolved_at` the store's now and
  its resolution `BACK_IN_CONTACT`, and J has no other alert
- **And** when the sender delivers, the fake holds exactly one
  `BACK_IN_CONTACT` message for each of R1, R2 and R3, each after that
  responder's `LOST_CONTACT` message, and none for W or anyone else
- **And** while D keeps sending, later deliveries send nothing more and later
  sweeps open nothing
- **And** the same holds with a single responder
- **And** at L3 the same flow runs through the real adapter, the real modules
  and the recording push, with times written relative to the database's
  `now()`.

**LOST-03-AC2 — Contact is back only when the heartbeat leaves the silence
under five minutes, by the database clock.** *(LOST-03, REL-01)*
- **Given** J is `LOST_CONTACT` with its open alert
- **When** a heartbeat is stored such that, counted with it, J's silence (its
  last contact, or its start if it has none, to the store's now) is 4 min
  59.999 s
- **Then** J is back in contact, as in AC1
- **When** instead that silence is exactly five minutes, or more, as for a
  heartbeat received long before it is stored
- **Then** the heartbeat is stored and answered `RECORDED`, last contact
  moves forward as LOST-01 has it, and J stays `LOST_CONTACT` with its alert
  open, no message withdrawn and none written
- **And** in the domain (L2), for any silence start and any now (fast-check),
  the `contact` rule moves a `LOST_CONTACT` journey back exactly when the
  silence is under `LOST_CONTACT_AFTER_MS`, which is exactly when the
  `silence` rule would not alert an `ACTIVE` one; an invalid time moves
  nothing
- **And** the shared behaviour suite holds the same boundary: against the
  fake at the threshold itself (L2), against the adapter `timeMarginMs` either
  side of it (L3)
- **And** at L6 the stale case is made by moving the fake clock past five
  minutes between the module's time read and the store's write
  (`beforeNext`).

**LOST-03-AC3 — Every (situation, event) pair has a tested outcome, contact
and "I'm home" included.** *(LOST-03, SM-04; extends LOST-02-AC6)*
- **Given** `JOURNEY_EVENTS` is exactly `start`, `heartbeat`, `silence`,
  `contact` and `home`
- **Then** the transition table holds an expectation for every pair: none,
  `ACTIVE`, `LOST_CONTACT` and `ENDED`, with `contact` at the threshold and
  one millisecond under it, and with `home` from the walker's own device,
  from another walker's, and from another device of the walker's
- **And** the heartbeat's own rows are unchanged: under the `heartbeat` event
  a `LOST_CONTACT` journey is recorded and stays `LOST_CONTACT`; the move back
  is the `contact` event's
- **And** `MESSAGE_KINDS` is exactly `LOST_CONTACT`, `BACK_IN_CONTACT`, `HOME`;
  `ALERT_RESOLUTIONS` exactly `BACK_IN_CONTACT`, `HOME`, each of them a
  message kind (typecheck); `JOURNEY_END_REASONS` exactly `HOME`
- **And** a pair the lists create but the table lacks fails, naming the pair;
  `transition` never throws and never returns `undefined` for any generated
  situation and event (fast-check); typecheck fails if an event has no case.

**LOST-03-AC4 — The journey's one unresolved alert is resolved, whatever its
state, and nothing else is.** *(LOST-03, SM-04; D-112)*
- **Given** J `LOST_CONTACT`, its unresolved alert put in as `OPEN`,
  `ESCALATED` or `ACKNOWLEDGED` in turn, an older alert of J's already
  `RESOLVED` from an earlier silence, and another journey with an open alert
- **When** fresh contact for J is stored
- **Then** exactly J's unresolved alert is `RESOLVED`, with `resolved_at` and
  its resolution set together; the older alert, its times and its messages
  are untouched, and so is the other journey's
- **And given** J `LOST_CONTACT` with no unresolved alert at all (put in
  directly; nothing in the code makes one), fresh contact still moves J back
  to `ACTIVE` and writes no message, and the module writes one
  `alert_missing` line naming J
- **And given** the same J, "I'm home" from its device instead is answered
  200 `ENDED`: J is `ENDED` with end reason `HOME`, no message is written,
  and the module writes the same one `alert_missing` line naming J. The
  store answers `home`, from `LOST_CONTACT`, with no alert and no messages
- **And given** J's responder rows are gone (removed directly; nothing in the
  code removes one yet), fresh contact still moves J back and resolves its
  alert, and writes no stand-down. A journey is never left `LOST_CONTACT`
  because nobody is left to stand down.

**LOST-03-AC5 — After the alert resolved, the journey is watched like any
other, and a new silence is a new alert.** *(LOST-03, LOST-02)*
- **Given** J came back in contact, as in AC1
- **When** D sends more heartbeats
- **Then** each is answered `RECORDED` and writes nothing else
- **When** D goes silent again for five minutes
- **Then** the next sweep opens a new alert for J (another ID, `OPEN`, silent
  since the last heartbeat), with one new `LOST_CONTACT` message per
  responder, and the first alert stays `RESOLVED` with its messages
- **And** for any sequence of heartbeats, fresh or stale, received in any
  order, and sweeps between them (fast-check, in the shared behaviour suite:
  the fake at L2, the adapter at L3 with fewer runs), after every step the
  store agrees with the domain's rules applied step by step:
  - the journey's state;
  - exactly one unresolved alert when it is `LOST_CONTACT`, and none when it
    is `ACTIVE`;
  - one stand-down per responder for each resolved alert, and none for an
    unresolved one.

  This replaces the end of LOST-02-AC2's property, "a heartbeat after that
  does not move it back" (RG-03, below).

### The messages

**LOST-03-AC6 — Every responder on the journey is stood down once, whether or
not their lost-contact push went out.** *(LOST-03; D-111)*
- **Given** J's alert opened with a message for each of R1, R2 and R3; the
  fake push accepted R1's, answered `NO_TARGET` for R2's, and R3's was never
  claimed (contact comes back before the next delivery)
- **When** contact comes back, the fake recovers, and the sender delivers
  until nothing is due
- **Then** the outbox holds exactly one `BACK_IN_CONTACT` message for that
  alert for each of R1, R2 and R3, and the fake accepted each; W has none
- **And** a second heartbeat, another sweep or another delivery adds none,
  and the database refuses a second message of the same kind for the same
  alert and recipient (L3).

**LOST-03-AC7 — A lost-contact push not yet accepted when contact comes back
is never sent again.** *(LOST-03; D-111)*
- **Given** J's alert, with R1's lost-contact message accepted, R2's failed
  (`NO_TARGET`, due again in 10 s) and R3's never claimed
- **When** contact comes back, the fake push recovers, and the clock runs on
  ten minutes with a delivery every 10 s
- **Then** neither R2's nor R3's lost-contact message is handed to the port
  again; each keeps its attempts and its last failure, and has
  `withdrawn_at` equal to the store's now at the moment contact came back;
  R1's is unchanged, sent and not withdrawn
- **And** a claim never hands out a withdrawn message, whatever its due time
  (behaviour suite, L2 and L3)
- **And** a lost-contact message the port was holding when contact came back
  (the fake's `holdAnswers`) is marked as the port then answers: sent at the
  store's now if it was accepted, or with its reason if not. Either way it is
  never handed out again
- **And** at L3, while another session holds R2's row as a claim in progress
  would (one more attempt, leased 30 s, not yet committed, and committing
  within the API's 5 s lock limit), the withdrawal waits for it, then
  withdraws R2's message with the attempt the claim counted; and a message
  that a mark committed as sent meanwhile is not withdrawn.

**LOST-03-AC8 — At the push port, a stand-down never overtakes the
lost-contact push it stands down.** *(LOST-03)*
- **Given** R1's lost-contact message was claimed and handed to the port,
  which holds its answer (the fake's `holdAnswers`), and R2's and R3's were
  accepted
- **When** contact comes back, and the sender delivers every 10 s
- **Then** R2's and R3's `BACK_IN_CONTACT` messages go at the first delivery
- **And** R1's is not handed to the port before the lease of R1's
  lost-contact claim has run out (30 s after that claim), whatever the port
  answers meanwhile, and is handed over at the first delivery after
- **And** in the fake's record, for every responder whose lost-contact
  message was handed over, it comes before their stand-down
- **And** a responder whose lost-contact message failed and was due again
  later gets the stand-down no later than that due time; one whose message
  was sent, or never handed over, gets it at the first delivery. One whose
  failed message's retry time had already passed when contact came back is
  not held at all: the stand-down is due at the alert's `resolved_at`
- **And** across alerts (review loop 1): once a later alert opens on the
  same journey, an earlier alert's stand-down that has not been accepted is
  never handed to the port again. With a failing push, alert A1 opens, a
  heartbeat resolves it, the journey goes silent about seven minutes, A2
  opens, and the push recovers: the port never accepts A1's
  `BACK_IN_CONTACT` after A2's `LOST_CONTACT`. The open withdraws it, in the
  open's own transaction (approach item 4, step 5, extending what
  LOST-02-AC9 says an open writes); a stand-down already sent is left as it
  was
- **And** at L2 (`domain/watchdog.test.ts`), the longest hold, the larger of
  `CLAIM_LEASE_MS` and the longest retry delay, is 60 s, pinned so a change
  to either shows
- **And** at L3 the stand-down's `next_attempt_at` equals the lease end the
  withdrawal returned for a message claimed and not marked.

**LOST-03-AC9 — Every message is content-free, with an opaque ID of its
own.** *(LOST-03, SM-04; D-086, D-087)*
- **Given** J's alert with its lost-contact messages, and its stand-downs of
  each kind, `BACK_IN_CONTACT` and `HOME`
- **When** the sender delivers them
- **Then** every message the fake receives has exactly the keys `messageId`,
  `recipientId` and `kind`, and `kind` is one of `MESSAGE_KINDS`
- **And** every `messageId` is a UUID, distinct from every other message's,
  the lost-contact ones included, and equal to no user's, walker's,
  journey's, alert's or device's ID
- **And** no column of `alerts`, `outbox` or `journeys` holds a coordinate,
  an accuracy, a phone time, a battery level or a name; the only columns
  named like a coordinate, in every table, are still `positions.latitude` and
  `positions.longitude` (L3, `information_schema`).

### All or nothing, and the races

**LOST-03-AC10 — The heartbeat, the move, the resolution, the withdrawals and
every stand-down are one transaction.** *(LOST-03; AR-05)*
- **Given** a real PostgreSQL, where a test-only trigger makes inserting the
  second responder's stand-down fail
- **When** a fresh heartbeat for `LOST_CONTACT` J arrives through the module
- **Then** the module fails, writing one `heartbeat_failed` line with stage
  `store` and the SQLSTATE, so the API answers 500
- **And** nothing changed: no heartbeat or position stored, last contact as
  it was, J `LOST_CONTACT`, its alert `OPEN`, no message withdrawn and no
  stand-down
- **And** once the trigger is removed, the same heartbeat (the same event ID)
  is recorded, not a duplicate, and does all of AC1's work
- **And** at L6 the same holds with the fake failing `recordHeartbeat`.

**LOST-03-AC11 — A heartbeat and the watchdog's open meet on the row:
whichever comes first, the outcome is one of two, and never an alert left
open on a journey in contact.** *(LOST-03, SM-09)*
- **Given** a real PostgreSQL, and J `ACTIVE` and silent five minutes
- **When** a heartbeat's transaction holds J's row as a sweep runs, and then
  commits
- **Then** the sweep skips J; J is `ACTIVE` and not overdue, with no alert and
  no message; the next sweep opens nothing
- **When** the sweep's open holds J's row, before commit, as a heartbeat for
  J arrives
- **Then** the heartbeat waits for the row (`pg_stat_activity` shows it
  waiting on a lock), then brings J back: the alert `RESOLVED`, the
  lost-contact messages withdrawn (or sent, if a delivery got there first),
  one `BACK_IN_CONTACT` per responder; J is `ACTIVE` and not overdue, and the
  next sweep opens nothing
- **When** a heartbeat and two sweepers start at the same moment on separate
  connections, for at least `RACE_ROUNDS` rounds
- **Then** every round ends in one of those two outcomes, and never with J
  `LOST_CONTACT`, never with J `ACTIVE` beside an unresolved alert, never with
  more than one alert, and with stand-downs exactly when the alert is
  resolved
- **And** at L6 the fake's `hold` gives the first two orders.

  This replaces LOST-02-AC10's "J stays `LOST_CONTACT`, with its one alert
  unchanged" (RG-03, below).

**LOST-03-AC12 — Duplicates change nothing, and heartbeats that race resolve
the alert once.** *(LOST-03, SM-08)*
- **Given** J `LOST_CONTACT` with its alert
- **When** D resends a heartbeat J already has: one from before the silence,
  whose answer was lost
- **Then** it is answered 200 `DUPLICATE`, and nothing changes: J
  `LOST_CONTACT`, its alert open, last contact as it was, no message
- **When** at least `RACERS` different fresh heartbeats for J are stored at
  once on separate connections, for `RACE_ROUNDS` rounds (L3), or one after
  another (L6)
- **Then** every one is stored; exactly one finds J `LOST_CONTACT` and brings
  it back, and the rest are recorded; there is one resolution and one
  stand-down per responder
- **And** the heartbeat that brought J back, sent again, is `DUPLICATE` and
  writes nothing.

**LOST-03-AC13 — Resolved on the database's clock.** *(LOST-03, REL-01)*
- **Given** a real PostgreSQL
- **Then** `resolved_at`, every `withdrawn_at`, every stand-down's
  `created_at`, and `ended_at` lie between two `select now()` readings
  taken before and after the call
- **And** a position whose phone time is hours behind or ahead changes
  neither whether contact is back nor any of those times
- **And** the module and the domain read no clock (the lint rule, L1); the
  "I'm home" path reads none at all: its time is the transaction's `now()`.

### "I'm home" after an alert (SM-04)

The owner chose to build the server half of the "I'm home" route in this
task (Q1, D-110). These criteria prove it.

**LOST-03-AC14 — A queued "I'm home" after an alert ends the journey,
resolves the alert and tells every responder.** *(SM-04, LOST-03; D-110)*
- **Given** J's alert opened at five minutes of silence, and the sender has
  delivered a `LOST_CONTACT` message to each of R1, R2 and R3
- **When** D, reconnecting, sends its queued "I'm home" through the API
  before any heartbeat
- **Then** it is answered 200 `ENDED`, and J is `ENDED`, end reason `HOME`,
  `ended_at` the store's now
- **And** J's alert is `RESOLVED` with resolution `HOME`, and any of its
  lost-contact messages still unsent is withdrawn (AC7, D-111)
- **And** the sender delivers exactly one `HOME` message to each of R1, R2
  and R3, each after their `LOST_CONTACT` message (AC8), and none to W
- **And** D's queued heartbeats that follow are answered 409 `JOURNEY_ENDED`,
  store nothing, and write one `heartbeat_ignored` line each (SM-07)
- **And** in the other order, a queued heartbeat first: J comes back in
  contact (AC1, a `BACK_IN_CONTACT` message to each), and the "I'm home" that
  follows ends J from `ACTIVE` with no further message (AC15)
- **And** in both orders the watchdog never alerts J again, and W can start a
  new journey (201)
- **And** at L3 the same flow runs through the real adapter.

**LOST-03-AC15 — "I'm home" on an `ACTIVE` journey ends it, and tells nobody
yet.** *(SM-04; D-110)*
- **Given** J `ACTIVE`, with no alert, or with only resolved ones
- **When** D sends "I'm home"
- **Then** it is answered 200 `ENDED`; J is `ENDED`, end reason `HOME`,
  `ended_at` the store's now
- **And** no alert is touched and no message is written. Telling responders
  of the end is the start-and-end story's, in M3
- **And** later sweeps never alert J, and W can start again.

**LOST-03-AC16 — Only the journey's own device ends it, and every other
answer changes nothing.** *(SM-04, SM-07, SM-08, SEC-07; D-110, D-112)*
- **Given** J, `ACTIVE` in one run and `LOST_CONTACT` with its open alert in
  another
- **Then** "I'm home" is answered, and in each case J, its alert and its
  messages are exactly as they were:
  - from another device of W's: 403 `NOT_THE_JOURNEYS_DEVICE`;
  - for another walker's journey, or an ID no journey has: 404
    `JOURNEY_NOT_FOUND`, the two bodies identical;
  - with no credential, or an unknown one: 401 (the existing test that calls
    every route in the contract covers the new one);
  - with a journey ID that is not a UUID, or a body holding any key, a
    `journeyId` naming another journey included: the fixed 400, with no
    `data` (the detailed input of approach item 5)
- **And** for an `ENDED` journey, whatever ended it, the answer is 409
  `JOURNEY_ENDED`, nothing changes, and one `home_ignored` line names the
  journey and the reason (SM-07)
- **And** a repeat "I'm home" after the first succeeded, its answer lost, is
  409 `JOURNEY_ENDED` and changes nothing (SM-08, with no event ID: reading
  10)
- **And** the journey's ID in upper case names the same journey: "I'm home"
  with it is 200 `ENDED`, and sent again it is 409 `JOURNEY_ENDED`, with a
  `home_ignored` line naming the ID in lower case
- **And** when the store fails, the answer is 500, nothing changes, and one
  `home_failed` line carries the stage and the SQLSTATE; never a 2xx, never a
  401
- **And** no answer carries anything of the request.

**LOST-03-AC17 — "I'm home" is all or nothing, and meets the watchdog and the
heartbeat on the row.** *(SM-04, SM-09; AR-05; D-110)*
- **Given** a real PostgreSQL, where a test-only trigger makes inserting the
  second `HOME` message fail
- **When** "I'm home" arrives for `LOST_CONTACT` J
- **Then** nothing changes (J `LOST_CONTACT`, its alert `OPEN`, nothing
  withdrawn, no `HOME` message), the answer is 500 with one `home_failed`
  line, and once the trigger is removed the same request does all of AC14's
  work
- **And when** "I'm home" holds J's row as a sweep runs: the sweep skips J,
  and J is `ENDED` with no alert
- **And when** the sweep's open holds J's row as "I'm home" arrives: "I'm
  home" waits, then does SM-04's work: J `ENDED`, the alert `RESOLVED` with
  resolution `HOME`, a `HOME` message per responder, the unsent lost-contact
  messages withdrawn
- **And when** "I'm home" and a fresh heartbeat meet on `LOST_CONTACT` J, in
  either order: heartbeat first gives `BACK_IN_CONTACT` to each, then `ENDED`
  with no `HOME`; "I'm home" first gives `HOME` to each, and the heartbeat is
  answered 409 `JOURNEY_ENDED` and stores nothing. Either way there is one
  resolution and one stand-down per responder
- **And when** two "I'm home" requests for J arrive at once: one is 200 and
  the other 409, with one resolution.

**LOST-03-AC18 — The contract describes the route.** *(SM-04; AR-07; D-110)*
- **Given** the generated OpenAPI document
- **Then** it has `POST /journeys/{journeyId}/home` under the `/v1` server,
  with responses 200, 400, 401, 403, 404 and 409, and requires the bearer
  scheme
- **And** its 200 body is exactly `{ "outcome": "ENDED" }`
- **And** the committed `openapi.json` equals what the contract generates
- **And** the heartbeat and start routes are unchanged: each path item's
  JSON is byte-identical, pinned by its sha256
- **And** the route's only parameter is `journeyId`, in the path, required,
  a UUID; nothing is in the query or a header
- **And** the request schema lower-cases the journey's ID, as the other
  routes' IDs are
- **And** `pnpm run api:diff` is run. With `packages/contracts/released/`
  empty it compares nothing, and the pull request records that as "not
  compared", never as "passed".

### The log and the database

**LOST-03-AC19 — The new events are closed, and nothing personal reaches a
log.** *(LOST-03, PRIV-07)*
- **Then** typecheck (L1) fails for any of the three new events holding
  another field; a `@ts-expect-error` test holds this, a latitude and a
  message among the fields it tries
- **And** `createLog` writes each as one JSON line holding exactly its
  fields; a `journeyId` that is not a canonical UUID, a `reason` or `stage`
  outside its set, and a `code` that is not a SQLSTATE are each written as
  null (L2)
- **And** when the fake store fails `recordHeartbeat` and `recordHome` with
  errors whose messages hold markers (a synthetic coordinate, a
  credential-like string and a responder's ID), nothing written to stdout,
  stderr or the console holds a marker (L6)
- **And** a request to the "I'm home" route that is refused with the fixed
  400, carrying a synthetic marker as its device credential, writes nothing
  to stdout, stderr or the console that holds the marker (L6; review loop
  1). oRPC keeps the request's headers in the validation error
  (approach item 5); nothing may print them
- **And** as controls, the capture sees a line written through the
  production `createLog`, and the thrown errors do hold the markers.

**LOST-03-AC20 — The database agrees, and migration `0004` changes no
existing row.** *(LOST-03, SM-04)*
- **Given** a freshly migrated database
- **Then** `message_kind`'s values equal `MESSAGE_KINDS`, `alert_resolution`'s
  equal `ALERT_RESOLUTIONS`, and `journey_end_reason`'s equal
  `JOURNEY_END_REASONS`, each in order (`pg_enum`)
- **And** the database itself refuses an alert with `resolved_at` and no
  resolution, or a resolution and no `resolved_at`; and the same for a
  journey's `ended_at` and `end_reason`
- **And** the claim's partial index still reads `(next_attempt_at, id)` with
  the predicate `sent_at IS NULL` (`pg_get_indexdef`)
- **And** on PostgreSQL 15, a database at `0003` holding journeys in every
  state, alerts in every state, and outbox messages sent and unsent migrates
  through `0004` as the pre-run hook runs it; every existing row is
  unchanged, and every new column is null on them
- **And** the committed `0004_*.sql` holds no `update`, `delete` or
  `truncate`. The strings `BACK_IN_CONTACT` and `HOME` appear in it only in
  `message_kind`'s two `add value` statements and in the two `create type`
  statements that make `alert_resolution` and `journey_end_reason`, and
  nowhere else: in no check, default or index predicate (read from the
  file; approach item 6).

## Test plan

| AC | Level | Where | How |
|----|-------|-------|-----|
| AC1 | L6, L3 | `apps/server/src/contact.system.test.ts` (new); `apps/server/src/contact.integration.test.ts` (new) | L6: `createApi` with the journey service, `createWatchdog` and `createPushSender`, over one `fakeJourneyStore({ clock })`, with `fakePush()`, `fakeLog()` and `fakeWorkerHeartbeats()`. L3: the real adapter and modules with `fakePush()` |
| AC2 | L2, L6, L3 | `domain/journey.test.ts`; behaviour suite (`fake-journey-store.test.ts`, `journeys.integration.test.ts`); system test | fast-check over silence starts and nows; `beforeNext` moves the clock. **Names REL-01** |
| AC3 | L1, L2 | `tsc`; `domain/journey.test.ts` | The table over the lists, `satisfies` and a run-time check |
| AC4 | L2, L3, L6 | behaviour suite; system test (the `alert_missing` lines, for contact and for "I'm home") | Alerts put in directly in each unresolved state. **Names SM-04** |
| AC5 | L6, L2, L3 | system test; behaviour suite | fast-check: the store follows the domain's rules step by step |
| AC6 | L6, L3 | system test; behaviour suite; integration test (the unique constraint) | |
| AC7 | L6, L2, L3 | system test (`holdAnswers`); behaviour suite; integration test (a claim in progress held open on another connection) | |
| AC8 | L6, L2, L3 | system test; `domain/watchdog.test.ts`; integration test | The fake clock across the lease |
| AC9 | L6, L3 | system test; integration test (`information_schema`) | |
| AC10 | L3, L6 | integration test (a trigger the test creates and removes, as LOST-02's does); system test (`failWith`) | |
| AC11 | L3, L6 | integration test (two connections, order forced by holding transactions open; then the same-moment rounds); system test (`hold`) | **Names SM-09** |
| AC12 | L6, L3 | system test; integration test (`RACERS`, `RACE_ROUNDS`) | **Names SM-08** |
| AC13 | L3, L1 | integration test; lint in `gate:static` | Times bracketed by `select now()`. **Names REL-01** |
| AC14 | L6, L3 | system test; integration test | Both orders. **Names SM-04, SM-07** |
| AC15 | L6, L2, L3 | system test; behaviour suite | **Names SM-04** |
| AC16 | L6, L2 | system test; behaviour suite (`recordHome` on an `ENDED` journey) | **Names SM-04, SM-07, SM-08, SEC-07** |
| AC17 | L3, L6 | integration test; system test (`hold`, `beforeNext`) | **Names SM-04, SM-09** |
| AC18 | L2, L4 | `packages/contracts/src/home.test.ts` (new), `openapi.test.ts`; `api:diff` | L4 compares nothing while `released/` is empty |
| AC19 | L1, L2, L6 | `tsc`; `log.test.ts`; system test (`captured()`) | **Names PRIV-07** |
| AC20 | L3 | `journeys.integration.test.ts`; `deploy.integration.test.ts` (PostgreSQL 15) | **Names SM-04** |

### Notes

- **Not used:** L5 and L7, because the app is not touched; L8 is task 8; L9
  and L10 are not used.
- **L3 needs Docker.** It runs in CI and on the Mac, not in a cloud session.
  `gate:full` names it as not run, and the `integration` job's log is the
  evidence.
- **One behaviour, two implementations.** The store's side of AC2, AC4 to
  AC8, AC12 and AC14 to AC16 joins `JOURNEY_STORE_BEHAVIOUR`, and
  `fake-journey-store.test.ts` pins the names. A fake more lenient than the
  adapter would make the L6 tests prove the fake (D-100).
- **Why a new L6 file, and why in the `journeys` group.** The code these
  criteria prove lives in `modules/journeys/` (the `journeys` mutation
  group), not in `modules/alerts/`, which this task does not change. A
  mutant there is caught only by a test the group runs, so
  `contact.system.test.ts` joins the group's tests, after
  `journeys.system.test.ts` (Mutation, below). It is a
  file of its own, not a part of `journeys.system.test.ts`, so its setup (the
  watchdog, the sender and the push fake) stays out of the start and
  heartbeat tests.
- **Test names** start with `LOST-03-ACn:`. Tests of the "I'm home" criteria
  also name SM-04, so it is counted, and the files holding the criteria above
  name the covered IDs the table marks.
- **Synthetic data only** (RG-07, D-089): IDs and credentials from the
  existing builders, positions from `syntheticPosition()`, markers generated
  at run time.
- **Before pushing:** run `test:coverage`, then `coverage:ratchet` (the live
  gotcha). `domain/` keeps RG-04's 95 % branch floor.
- **`docs/requirements-status.md`** is regenerated with `pnpm run
  req:coverage`: LOST-03 and SM-04 go from ⚪ to 📝 with this spec, and to 🟢
  with the tests.

### Tests added after the red phase (settled 2026-10-06)

`test-author`'s red phase found five things to settle. Four changed this
spec's text only: AC20's wording, the route's detailed input (approach item
5, Interfaces, AC16), the `journeys` group's order, and the RG-03 list
below. One adds tests. The names are exact; `test-author` may adjust wording
only, keeping the criterion and the assertions.

**"I'm home" on a `LOST_CONTACT` journey with no unresolved alert** (reading
11, approach item 5; AC4; D-112):
1. L6, `apps/server/src/contact.system.test.ts`: `LOST-03-AC4: "I'm home" on
   a LOST_CONTACT journey with no unresolved alert, put there directly, is
   200 ENDED: the journey is ENDED with end reason HOME, no message is
   written, and one alert_missing line names it`. The test also names
   SM-04.
2. The shared behaviour suite (`journey-store-behaviour.ts`, run by
   `fake-journey-store.test.ts` at L2 and `journeys.integration.test.ts` at
   L3): `LOST-03-AC4: recordHome on a LOST_CONTACT journey with no
   unresolved alert ends it ENDED with end reason HOME, and answers home,
   from LOST_CONTACT, with no alert and no messages`. The log line is the
   module's, so the store's test checks only the store's answer and what it
   wrote. The pinned list of behaviour names grows with it, by design.

### Tests added in review loop 1 (settled 2026-10-06)

All four reviewers passed the first round: `safety-reviewer`,
`privacy-security-reviewer`, `code-reviewer` (advisory) and `test-auditor`.
Their should-fixes and notes go into this one loop. The names are exact;
`test-author` may adjust wording only, keeping the criterion and the
assertions. The numbers follow the coordinator's list of findings.

**Code changes, each with the test that proves it:**

**1. No overtaking across alerts** (`safety-reviewer`, should-fix; approach
item 4, step 5; AC8; D-112). The open (`openInside`, LOST-02's code) also
withdraws the journey's earlier alerts' unsent stand-downs, in its own
transaction. This extends what LOST-02-AC9 says an open writes, and stays
inside LOST-02-AC12's all or nothing.
- 1a. L6, `apps/server/src/contact.system.test.ts`: `LOST-03-AC8: with a
  failing push, alert A1 opens, a heartbeat resolves it, the journey stays
  silent until A2 opens, and then the push recovers: the port never accepts
  A1’s BACK_IN_CONTACT after A2’s LOST_CONTACT, because A2’s open withdrew
  it`. The scenario `safety-reviewer` reproduced. It also names LOST-02.
- 1b. The shared behaviour suite (`journey-store-behaviour.ts`, at L2 and
  L3): `LOST-03-AC8: an open withdraws the journey’s earlier alerts’ unsent
  stand-downs at the store’s now, and leaves alone those already sent, every
  other journey’s messages and its own new ones; an open that skips
  withdraws nothing`.
- 1c. L3, `apps/server/src/contact.integration.test.ts`: `LOST-03-AC8: an
  open rolled back by a test-only trigger on its second message withdraws
  no earlier stand-down`.

**2. "I'm home" asks the domain under the lock** (`code-reviewer`,
should-fix; AR-04; approach item 5; D-112). Today `recordHome` writes
`ENDED` and `HOME` as literals and branches on its own reading of the state,
so the `home` rule's decision is computed and tested but never read in
production. `recordHome({ journeyId, walkerId, deviceId })` now reads the
walker, the device and the state under the lock, asks `transition`, writes
`decision.state` and `decision.reason`, and resolves only when
`decision.resolvesAlert`.
- 2a. The shared behaviour suite: `LOST-03-AC16: recordHome decides by the
  home rule under the lock: a walker or a device that is not the journey’s
  makes it reject and write nothing; an ENDED journey answers
  already_ended and writes nothing; an ACTIVE one is ended without
  resolving anything; a LOST_CONTACT one is ended and its alert resolved
  with resolution HOME`. It also names SM-04.

**3. `already_ended`, not `ended`** (`code-reviewer`, should-fix; approach
item 5). `RecordHomeResult`'s answer for a journey already ended is renamed.
`RecordHeartbeatResult` keeps `ended`. Held by typecheck (L1) and by test
2a.

**4. A 400's error object holds the credential** (`privacy-security-reviewer`,
note; approach item 5; AC19). A comment in `api.ts` beside
`BAD_REQUEST_BODY` says that oRPC keeps `request.headers`, the device
credential included, in the validation error's `cause.data`, and that
nothing may print it.
- 4a. L6, `apps/server/src/contact.system.test.ts`: `LOST-03-AC19: a 400
  from the “I’m home” route, for a known device whose credential is a
  run-time marker and a body holding a key, writes nothing to stdout,
  stderr or the console that holds the credential; the capture sees the
  production log’s lines`. It also names PRIV-07.

**5. The worker's marks can wait on the API** (`safety-reviewer`, note;
approach item 8). One sentence in the adapter's header comment, and the
same in approach item 8. No test: it describes a bound the existing limits
already set.

**6. Coverage baseline** (`test-auditor`, RG-04). `coverage-baseline.json`
gains entries, written by hand and not with `--update` (so no other entry
moves), for `packages/contracts/src/home.ts` and for LOST-02's
`apps/server/src/modules/alerts/watchdog.ts` and `outbox.ts`, each at the
value `test:coverage` measures on this branch. The file needs the owner's
approval (CODEOWNERS).

**Test-only changes (`test-author`):**

**7. The home route lower-cases the journey's ID** (`test-auditor`,
should-fix; AC16, AC18):
- 7a. `packages/contracts/src/home.test.ts`: `LOST-03-AC18: the request
  schema lower-cases a journey ID given in upper case`. It asserts
  `homeRequestSchema.parse({ params: { journeyId: <upper case> } }).params.journeyId`
  equals the ID in lower case.
- 7b. L6, `apps/server/src/contact.system.test.ts`: `LOST-03-AC16: “I’m
  home” with the journey’s ID in upper case is 200 ENDED; sent again it is
  409 JOURNEY_ENDED, and the home_ignored line names the ID in lower case`.

**8. The model property must reach the move back at L3** (`test-auditor`,
note; AC5). The behaviour "LOST-02-AC2 and LOST-03-AC5: for any sequence of
heartbeats, fresh or stale, … one stand-down per responder for each
resolved alert, and none for an unresolved one" passed at L3 against an
adapter that never brought a journey back. Its 2 s margin filters out the
silences near the threshold, and few runs are drawn there.
- `silences` gains a third branch, below `LOST_CONTACT_AFTER_MS` minus the
  margin, so heartbeats that bring a journey back are drawn at L3 too.
- The property's `examples` gain one fixed sequence that brings a journey
  back, so even the L3 run's few runs exercise the move.
- The name stays. `test-author` checks once, by hand, that the property
  now fails against an adapter with the move back removed, and says so in
  the pull request.

This is preferred to raising the L3 runs, which costs every run of the
integration job and still only makes the case likely.

**9. A retry time already passed holds nothing back** (`test-auditor`,
note; AC8). The hold's `next_attempt_at > now()` condition survived in both
the adapter and the fake.
- 9a. The shared behaviour suite: `LOST-03-AC8: a responder whose
  lost-contact message failed and whose retry time had already passed when
  contact came back is not held: their stand-down is due at the alert’s
  resolved_at`.

**10. Stale prose in tests** (`code-reviewer`, should-fix). Comments and one
title still say that no journey can end, or that moving back is a later
task's. Lines as the review gives them:
- `packages/test-kit/src/journey-store-behaviour.ts`, line 179, and
  `apps/server/src/adapters/journeys.integration.test.ts`, line 245: the
  `endJourney` helpers' comments ("nothing in the code can end one yet")
  say instead that they end a journey directly, as a test's own setup,
  without the route or any rule;
- `apps/server/src/domain/journey.test.ts`, lines 30–31 and 254–257: the
  comments that leave moving back to a later task say it is the `contact`
  rule's;
- the same file's title at line 1297, "LOST-02-AC5: a heartbeat for a
  journey in LOST_CONTACT is recorded and leaves it LOST_CONTACT, and the
  next silence alerts it no more: moving it back is the back-in-contact
  task’s", becomes `LOST-02-AC5: a heartbeat for a journey in LOST_CONTACT
  is recorded and leaves it LOST_CONTACT under the heartbeat rule, and the
  next silence alerts it no more; moving it back is the contact rule’s`.
  RG-03 for the title: no assertion changes.

**11. The test kit's message kinds are the domain's** (`code-reviewer`,
note; AC3):
- 11a. `apps/server/src/domain/journey.test.ts`: `LOST-03-AC3: the test
  kit’s MESSAGE_KINDS equals the domain’s, in order`. One `toEqual`, since
  the test kit cannot import the server.

**Docs, in this pull request:**

**12. Retention, for M4** (`privacy-security-reviewer`, should-fix).
`docs/plan/README.md`'s "Open for M4" paragraph says that `journeys.ended_at`
is what the retention rule's 24-hour positions clock counts from; that an
`ENDED` journey with a null `ended_at` (put in directly) must be handled
loudly by the retention job; and that stand-downs, withdrawn messages and
`alerts.resolved_at` and `resolution` are alert records under the 30-day
rule. Written with this loop.

**13. The state table points at the contact rule** (`safety-reviewer`,
note). `docs/plan/05-architecture.md`'s row "LOST_CONTACT | Heartbeat |
ACTIVE" says that only a fresh heartbeat brings a journey back, and names
D-112. Written with this loop. The row stays binding under D-033; the note
says how D-112 reads it, and changes nothing it says.

### Tests added in review loop 2 (settled 2026-10-06)

All three blocking reviewers passed loop 1 (`safety-reviewer`,
`privacy-security-reviewer`, `test-auditor`). Their should-fixes and two notes
go into this loop. The names are exact; `test-author` may adjust wording only,
keeping the criterion and the assertions.

**14. No overtaking across a walker's journeys** (`safety-reviewer`,
should-fix; approach item 4, step 5; AC8; D-112, amended). The open's
withdrawal covered only this journey's earlier alerts. A walker's earlier
journey, ended by "I'm home" while the push failed, can still hold unsent
`HOME` or `BACK_IN_CONTACT` messages to the same responders, retried for
ever. The reviewer reproduced it in-process: with the push failing, J1's alert
opens, "I'm home" ends J1, the walker starts J2 with the same responders, J2
goes silent and its alert opens, the push recovers, and each responder's port
accepts J2's `LOST_CONTACT` and then J1's `HOME`, while J2 is `LOST_CONTACT`.
**The open now withdraws the unsent, not yet withdrawn stand-downs of every
alert of this walker's journeys**, in its own transaction. Another walker's
messages are left alone: a stand-down for another walker is no all-clear for
this one.
- 14a. L6, `apps/server/src/contact.system.test.ts`: `LOST-03-AC8: with a
  failing push, J1's alert opens and "I'm home" ends J1; the same walker
  starts J2 with the same responders, J2 goes silent until its alert opens,
  and then the push recovers: the port never accepts J1's HOME after J2's
  LOST_CONTACT`.
- 14b. The shared behaviour suite: `LOST-03-AC8: an open withdraws the unsent
  stand-downs of the walker's earlier journeys, and leaves another walker's
  alone`.

**15. The fake compares the walker and the device exactly** (`safety-reviewer`
and `test-auditor`, should-fix; D-100). The fake's `recordHome` lower-cased
the walker's and the device's IDs before comparing them; the adapter hands
them to the domain's rule, which compares them exactly, and refuses. The fake
now compares them as given. The fake's own test that pinned the lower-casing
changes with it (RG-03), and the case moves into the shared suite so both
stores answer it.
- 15a. The shared behaviour suite: `LOST-03-AC16: recordHome with the walker's
  or the device's ID in another case than the stored one is refused by the
  rule under the lock, and changes nothing`.

**16. The walker check under the lock, on its own** (`test-auditor`,
should-fix; AC16). Test 2a's "another walker" case sent the stranger's own
device, which the device check refuses anyway, so an adapter that asked the
rule with the locked row's own walker survived at L3.
- 2a gains two cases: `recordHome` with a stranger's walker ID and the
  journey's own device rejects; and a stranger on an `ENDED` journey rejects
  rather than answering `already_ended`, which holds the rule's order (the
  walker before `ENDED`) at both stores.

**17. The open leaves lost-contact messages alone, at L3** (`safety-reviewer`
and `test-auditor`, notes). The open's `kind <> 'LOST_CONTACT'` clause was
held by the fake's own test only.
- 17a. The shared behaviour suite: `LOST-03-AC8: an open leaves an earlier
  alert's unsent LOST_CONTACT message alone`. The message is put there
  directly; nothing in the code leaves one unsent past its resolution.

**18. The adapter header names both withdrawals** (`safety-reviewer`, note).
The header's sentence on the worker's marks waiting names the API's
withdrawal; the open's own withdrawal, on the worker's pool, is the second.
A comment only; approach item 8 already says both.

### Existing assertions that change by design (RG-03)

`test-author` changes each, with the written reason RG-03 asks for in the
pull request. None loosens what a test proves; each says what this task now
does instead.

- **`packages/test-kit/src/journey-store-behaviour.ts`**, "LOST-01-AC8: a
  heartbeat for a journey in LOST_CONTACT is recorded and advances last
  contact, and the journey stays LOST_CONTACT". The first half still holds.
  The second holds only for a stale heartbeat (AC2); a fresh one now brings
  the journey back. The pinned name in `fake-journey-store.test.ts` changes
  with it.
- **The same file**, "LOST-02-AC2: … and a heartbeat after that does not move
  it back". AC5's property replaces that clause; the rest of the property
  stands.
- **`apps/server/src/journeys.system.test.ts`**, "LOST-01-AC8: a heartbeat for
  a journey in LOST_CONTACT, put there directly, is 200 RECORDED, stored, and
  advances last contact; the journey stays LOST_CONTACT". **It becomes the
  stale variant:** the heartbeat is received, then the store's clock moves
  five minutes on before it is written, so the journey stays `LOST_CONTACT`
  (AC2) and the test keeps every assertion it had. Its world's fake store is
  given a clock, because a fake with none now throws when asked whether
  contact is back (approach item 9). A fresh heartbeat for the same journey,
  which has no alert, is AC4's case (one `alert_missing` line).
- **`apps/server/src/alerts.system.test.ts`**, "LOST-02-AC5: swept every 10 s
  for an hour, with a heartbeat from its phone in between, … stays
  LOST_CONTACT …". The heartbeat in between is fresh, so it now resolves the
  alert and stands the responders down. What the test is for, one alert per
  silence however often the watchdog sweeps, is still held without that
  heartbeat; the move back is AC1's and AC5's.
- **`apps/server/src/alerts.integration.test.ts`**, "LOST-02-AC10: while a
  sweep's transaction holds J's row before commit, a heartbeat for J waits;
  then it is stored, last contact advances, and J stays LOST_CONTACT with its
  one alert unchanged". The wait and the store still hold; the end is AC11's
  second order.
- **`apps/server/src/domain/journey.test.ts`**: every test that pins
  `JOURNEY_EVENTS` gains `contact` and `home`, because the two events join
  the list (approach item 2). The heartbeat rows do not change.
  - SM-01-AC14's events test ("the states are exactly ACTIVE, LOST_CONTACT
    and ENDED, and the events exactly …");
  - SM-01-AC14's pairs test ("the pairs with an outcome are exactly …"),
    which gains eight pairs: `contact` and `home`, each with none, `ACTIVE`,
    `LOST_CONTACT` and `ENDED`;
  - LOST-01-AC17's "JOURNEY_EVENTS is exactly start and heartbeat, and then
    …";
  - LOST-02-AC6's "JOURNEY_EVENTS is exactly …, and ALERT_STATES exactly …";
  - and the table, `EVENT_FOR` and `ROW_ID`, which gain the two events'
    rows.
- **`apps/server/src/adapters/journeys.integration.test.ts`**,
  "LOST-02-AC23: outbox has a partial index … created by migration 0003
  itself, and no migration 0004 exists". `0004` now exists for other
  reasons. The test's point, that the index is created by `0003` and by no
  separate migration, is kept by checking that no later migration creates
  or drops it.
- **The same file**, "LOST-02-AC13: alerts and outbox hold exactly the
  spec's columns, and none holds a coordinate, …": the exact lists gain
  `resolved_at` and `resolution` (alerts) and `withdrawn_at` (outbox). Its
  scan for a coordinate, an accuracy, a phone time, a battery level, a name
  or a phone number covers the new columns as it stands, and none of their
  names matches it.
- **`apps/server/src/deploy.integration.test.ts`**, "LOST-02-AC23: a
  PostgreSQL 15 database at 0002, holding journeys in every state …,
  migrates through 0003 …; every existing row is unchanged". It runs every
  migration (`migrateDatabase`), so it now runs `0004` too. Its
  `row_to_json` of each journey then holds `ended_at` and `end_reason`, both
  null, and the before-and-after comparison fails, though no row changed.
  The test keeps its point by migrating only through `0003` (a copy of the
  folder up to `0003`, as `migrationsUpTo0002()` already does for `0002`),
  or by comparing the columns that existed before. AC20's test for `0004`
  is a new one.
- **`packages/contracts/src/openapi.test.ts`**, "describes the health route
  as a GET, where the contract puts it": the exact path list `['/health',
  '/heartbeats', '/journeys']` gains `/journeys/{journeyId}/home`. Its own
  comment asks for exactly this: "a route added later has to be named here
  on purpose".
- **`scripts/lib/gate-decisions.test.mjs`**, in two tests, because the
  `journeys` group's tests become `[journeys.system.test.ts,
  contact.system.test.ts]`, in that order (Mutation, below):
  - the `MUTATION_GROUPS` pin;
  - BUG-10's "modules/journeys/ is mutated in one run, its own, against the
    journey system tests", which pins the same group's run.
- **`scripts/stryker-config.test.mjs`**, BUG-10's "the journeys run mutates
  modules/journeys/ and runs the journey system tests, under the system
  tests' configuration": the files the run's command runs (`filesRunWith`)
  are now both files, compared sorted, because `vitest list` reports files
  in an order of its own. The files it mutates and its configuration do not
  change.
- **`packages/test-kit/src/fake-journey-store.test.ts`**: the pinned list of
  behaviour names. The two behaviours renamed above change their names, and
  the new behaviours of this task join the list, as each task's do.
- **Added to, not changed:** `log.test.ts`'s `EVENTS` list, `fake-log.test.ts`
  and `fake-push.test.ts` gain the new events and kinds; nothing they assert
  today changes.

- **`apps/server/src/api.system.test.ts`** (`noJourneys()`) **and
  `apps/server/src/http.test.ts`**: their `JourneyService` stand-ins gain a
  `home` stub that rejects, as LOST-01 gave them a `heartbeat` one. The
  service now has `home`, so a stand-in without it no longer type-checks.
  These tests call neither, so nothing they assert changes (found by
  `implementer`'s typecheck, 2026-10-06).

- **Review loop 1:** the shared behaviour LOST-03-AC16 for an ENDED journey
  is renamed "… is answered already_ended", and its assertion reads
  `already_ended` instead of `ended`, as approach item 5 renames the store's
  answer (D-112, amended). Its pinned name in `fake-journey-store.test.ts`
  changes with it.
- **Review loop 1:** every `recordHome` call in the shared behaviour suite
  and in `fake-journey-store.test.ts` now passes the walker and the device
  beside the journey ID, as `recordHome` asks the domain under the lock. The
  assertions are unchanged.

- **Review loop 1:** the fake's own no-clock test in
  `fake-journey-store.test.ts` reads `already_ended` instead of `ended`,
  with the rename (item 3). Equally strict.
- **Review loop 2:** the fake's own test "… with the walker's ID in any case
  read as the stored one" is reversed: the fake now compares as the domain
  does (item 15), and the case moves into the shared suite (15a).
- **Review loop 2:** the fake's own test "an open withdraws only the
  journey's earlier stand-downs" is renamed "an open withdraws only
  stand-downs: …", since the withdrawal now reaches the walker's other
  journeys (item 14). Its assertions are unchanged.

**Read and found unchanged** (2026-10-06), so nobody has to wonder:
- `domain/journey.test.ts`, "LOST-01-AC8: a journey in LOST_CONTACT takes the
  heartbeat and stays LOST_CONTACT …" and "LOST-02-AC5: a heartbeat for a
  journey in LOST_CONTACT is recorded and leaves it LOST_CONTACT …". The
  heartbeat event's rule is unchanged, and the move back is the `contact`
  event's (approach item 2), so both assertions hold. The second's title is
  brought up to date in review loop 1 (item 10, RG-03 for the title); no
  assertion changes.
- `alerts.integration.test.ts`'s other LOST-02-AC10 test (a heartbeat holding
  the row as a sweep runs): the journey is `ACTIVE` there.
- The tests that compare stored alerts and messages: each reads them field
  by field, or compares one reading with another, so the new fields break
  none of them. The tests that compare `journeys()` and `journeysOf` with
  exact literals are protected by keeping the journey's end out of those
  shapes (Interfaces, above).
- `deploy.integration.test.ts`'s LOST-01-AC20 pair: the refusal rolls back
  every pending migration, `0004` included, and the control counts the
  journal's entries from the file.

## Mutation (D-036, D-095, D-098, D-099)

Read in `scripts/lib/gate-decisions.mjs` on 2026-10-06.

| New or changed code | Group | Tests the group runs | Configuration |
|---|---|---|---|
| `domain/journey.ts` | `domain` | `apps/server/src/domain` | root |
| `modules/journeys/service.ts` | `journeys` | `journeys.system.test.ts`, then `contact.system.test.ts` (new) | `vitest.system.config.mjs` |

- **`MUTATION_GROUPS`' `journeys` group gains `contact.system.test.ts`.** Its
  `tests` become exactly `['apps/server/src/journeys.system.test.ts',
  'apps/server/src/contact.system.test.ts']`, in that order: the existing
  file first, the new one after it. `gate-decisions.mjs` is owned and in the
  ai-review `safety` filter (D-100), so no `ai-review.yml` edit is needed.
- **Each file must reach 80 % killed on its own** (D-098). Every run is fresh
  (D-099).
- **Not mutated on a pull request:**
  - `adapters/journeys.ts`, `db/schema.ts` and the migration: D-095 leaves
    them to L3 and to D-036's nightly run, which does not exist yet. The
    contact rule's boundary is in the domain, where it is mutated; the
    adapter asks it (approach item 3);
  - `api.ts`: owned and safety-reviewed (D-097), not a safety path; its new
    route is proven at L6;
  - `log.ts`: whether it should be mutated is still the owner's open
    question from CI's `test-auditor` on #60.
- **Not run, because unchanged:** `alerts`, `process`, `api-process`,
  `healthchecks`.
- **Cost.** The `journeys` group now runs two files per mutant. D-098 keeps
  the 25-minute budget; if an honest run does not fit, the owner decides
  (cost). Read the job's log for the time it took; do not estimate.

## Modules and files affected

Owner approval and the safety filter were read on 2026-10-06 in
`.github/CODEOWNERS`, `scripts/lib/merge-rules.mjs` (`OWNER_APPROVAL_PATHS`,
which lists the same paths) and `.github/workflows/ai-review.yml` (the
`safety` filter, lines 54–89).

| File | Change | Owner approval | Safety filter | Mutation |
|------|--------|:--:|:--:|:--:|
| `apps/server/src/domain/journey.ts` | `contact` and `home` events, three lists | **yes** | **yes** | `domain` |
| `apps/server/src/domain/*.test.ts` | L2 (test-author) | **yes** | **yes** | (its tests) |
| `apps/server/src/modules/journeys/service.ts` | `home()`; `heartbeat()` maps `back_in_contact`; `alert_missing` | **yes** | **yes** | `journeys` |
| `apps/server/src/ports.ts` | `RecordHeartbeatResult`, `recordHome`, three `LogEvent`s | no | no | — |
| `apps/server/src/adapters/journeys.ts` | Back in contact in `recordHeartbeat`; `recordHome`, asking the domain under the lock; the resolve helper; the open withdraws earlier alerts' unsent stand-downs; the claim skips withdrawn messages; the header comment on the marks' bounded wait; `insertStarted`'s comment updated (reachable now, left for task 7) | **yes** | **yes** | no (D-095) |
| `apps/server/src/api.ts` | The "I'm home" route (D-110); the comment beside `BAD_REQUEST_BODY` on the headers a 400's error holds | **yes** (D-097) | **yes** | no |
| `coverage-baseline.json` | Entries for `home.ts`, `modules/alerts/watchdog.ts` and `outbox.ts`, by hand, at their measured values (review loop 1, item 6) | **yes** | no | — |
| `apps/server/src/db/schema.ts` | Two enums, the new columns and checks, `message_kind`'s values | **yes** | **yes** | no |
| `apps/server/src/db/migrations/0004_*.sql`, `meta/*` | Generated with `db:generate` | **yes** | **yes** | no |
| `apps/server/src/log.ts` | Three events | **yes** (D-102) | no (D-102) | no |
| `packages/contracts/src/home.ts` (new), `contract.ts`, `index.ts`, `openapi.json` | The route (D-110); `openapi.json` regenerated with `api:spec` | no (D-094) | **yes** | — |
| `packages/contracts/src/home.test.ts` (new), `openapi.test.ts`, `index.test.ts` | L2 (test-author) | no | **yes** | — |
| `packages/test-kit/src/` (the store, the behaviour suite, `fakePush`, `fakeLog`, their tests, `index.ts`) | Fakes (test-author) | **yes** (D-100) | **yes** | input (D-098) |
| `scripts/lib/gate-decisions.mjs` | The `journeys` group's tests become `journeys.system.test.ts`, then `contact.system.test.ts` | **yes** | **yes** | input (D-098) |
| `scripts/lib/gate-decisions.test.mjs`, `scripts/stryker-config.test.mjs` | The group's pins: two tests in the first, one in the second (test-author) | **yes** | no | — |
| `apps/server/src/contact.system.test.ts` (new) | L6 (test-author) | no | no | the `journeys` group's tests |
| `apps/server/src/contact.integration.test.ts` (new); `adapters/journeys.integration.test.ts`, `deploy.integration.test.ts`, `alerts.integration.test.ts` | L3 (test-author) | no | no | — |
| `apps/server/src/journeys.system.test.ts`, `alerts.system.test.ts`, `log.test.ts` | RG-03 changes and L2 (test-author) | no | no | groups' tests |
| `docs/plan/decisions.md` | D-110 to D-112 (approach item 12), written with this spec on 2026-10-06 | **yes** | no | — |
| `docs/requirements-status.md` | Regenerated | no | no | — |
| `docs/plan/README.md`, `docs/plan/05-architecture.md` | "Open for M4" on retention; the state table's contact row points at D-112 (review loop 1, items 12 and 13) | no | no | — |
| `docs/progress.md`, `docs/progress/m2.md` | Status (plan-keeper) | no | no | — |

- **Files needing the owner's approval:** every row marked **yes**. The pull
  request needs it in any case, through `domain/`.
- **`.github/workflows/ai-review.yml` is not edited.** CI's AI reviewers can
  run, and no hand merge is needed (D-075).
- **Expected unchanged:** `.github/`, `scripts/lib/merge-rules.mjs`,
  `scripts/gate.test.mjs`; `modules/alerts/`, `modules/health/`, `worker.ts`,
  `api-process.ts`, `http.ts`; `adapters/db.ts`, `adapters/clock.ts`,
  `adapters/device-credentials.ts`, `adapters/migrations.ts`,
  `adapters/worker-heartbeats.ts`, `adapters/healthchecks.ts`;
  `domain/watchdog.ts`; `bin/*`, `process.ts`, `config.ts`;
  `packages/config/`; `stryker.config.mjs` and the Vitest configurations;
  `infra/` and `apps/mobile/`.
- **Reviewers.** `safety-reviewer` runs (the filter matches `domain/`,
  `modules/journeys/`, the adapter, the schema, the migration, `api.ts`, the
  contracts, the test kit and `gate-decisions.mjs`).
  `privacy-security-reviewer` and `test-auditor` always run.

## Contract changes

**One route, additive** (D-110).
`packages/contracts/released/` is empty, so nothing on a phone can break, and
nothing is added there: that is `release-engineer`'s alone. The shape can
still change before the first app release (M3) at no compatibility cost.

- **New:** `POST /v1/journeys/{journeyId}/home` (contract path
  `/journeys/{journeyId}/home`, route `reportHome`), with the answers of
  approach item 5 and its detailed input: the journey in the path, an empty
  body or none. Its description says: it needs a device credential; only the
  device that started the journey may end it; a 200 `ENDED` and a 409
  `JOURNEY_ENDED` both mean the journey is over.
- **Unchanged:** `/v1/health`, `POST /v1/journeys` and `POST /v1/heartbeats`.
  A heartbeat that brings a journey back is answered `RECORDED`, as any
  stored heartbeat is.
- **`openapi.json` is regenerated with the code** (`pnpm run api:spec`), not
  by hand. The test that the committed file is what the contract generates
  holds it to the code.
- **The start and heartbeat path items stay byte-identical.** Test-author's
  AC18 test "the heartbeat and start routes are published exactly as
  before" pins each one's JSON by its sha256 (`openapi.test.ts`, read
  2026-10-06). So adding the route cannot quietly change a published route.

## Risks and failure modes

- **[F2](../plan/03-safety-reliability-security.md#failure-modes), the false
  alarm from no coverage.** This task is F2's server half: a phone back from
  a tunnel stands its responders down (AC1), and an "I'm home" queued in a
  basement does too (AC14). **Still open:** a phone with patchy coverage
  (one heartbeat every six minutes, say) alerts, stands down and alerts
  again, a critical push each time. That is D-021 working as decided, and
  tuning it (a threshold, or a wait before standing down) is M6's, with the
  owner (D-021: a change needs the owner).
- **[F1](../plan/03-safety-reliability-security.md#failure-modes) and
  [F6](../plan/03-safety-reliability-security.md#failure-modes), the missed
  alert. The new danger is a real alert stood down.** Only two things can
  resolve one, and each is narrow:
  - a heartbeat that is stored (not a duplicate), from the journey's own
    device (D-101), with a per-device credential (SEC-07), that leaves the
    silence under five minutes by the database clock (AC2, AC12);
  - an "I'm home" from the journey's own device (AC16).

  A stale heartbeat resolves nothing (AC2). Anything that fails rolls back
  whole, leaving the alert open (AC10, AC17). **Not covered, and stated:**
  the phone itself, in someone else's hands (next item).
- **[F10](../plan/03-safety-reliability-security.md#failure-modes), someone
  else taps "I'm home"** (D-110). With this route, an "I'm home" from the
  walker's unlocked phone, during an alert, ends the journey and tells the
  responders the walker is home. That is F10's case exactly: a known
  limitation of the MVP, documented, and now reachable on the server. It was
  always the I'm-home story's; building the route here does not change it.
- **[F7](../plan/03-safety-reliability-security.md#failure-modes), the
  watchdog.** Unchanged in code. The heartbeat's transaction holds the
  journey's row a few statements longer; the session limits still bound it
  (AC11, approach item 8). A held `users` row (an outbox insert's foreign
  key) now also makes a heartbeat wait up to 5 s and fail with 55P03: a 500,
  a line, and a resend. Loud, and nothing is lost.
- **[F8](../plan/03-safety-reliability-security.md#failure-modes), a bad
  release.** The L6 flows run on every pull request under the `journeys`
  mutation group, and L3 in CI. The canary (task 8) watches the path for
  real.
- **[F3](../plan/03-safety-reliability-security.md#failure-modes),
  [F4](../plan/03-safety-reliability-security.md#failure-modes) and
  [F5](../plan/03-safety-reliability-security.md#failure-modes):** a phone
  whose app the system killed, or swiped away, comes back as any phone does.
  A heartbeat without a position brings contact back (SM-03): the responders'
  "location unavailable" is M3's.
- **[F9](../plan/03-safety-reliability-security.md#failure-modes):** not
  touched. "The current position" read in M3 carries its accuracy and age
  (the accuracy-and-age rule).
- **The order on the phone.** The server never hands a stand-down over before
  its alert (AC8). APNs and FCM promise no order after that, and a send
  slower than the 30 s lease would break the server's half too. **For M3:**
  the app shows the alert's current state when opened, never the order
  notifications came in; and the push adapter bounds every send under the
  lease.
- **Stand-downs to someone who cannot be reached are retried for ever,**
  every 60 s, each a `push_failed` line. Until M3 every message on staging is
  `NOT_CONFIGURED` (and no journey exists there before the canary). At scale
  they would also share each claim's 50 places with fresh alerts. "Left for
  later tasks" sends both to M3.
- **A stand-down for a silence nobody heard of** (D-111). In the five-minute
  race, contact can come back before any lost-contact push went out; every
  responder then gets "back in contact" for an alert they never saw. It is a
  non-critical notice, and the app shows what happened. The owner accepted
  this cost over standing down only those whose push was handed over.
- **Adding enum values inside the migration's transaction** (approach item
  6). Recalled, not checked here: the L3 run on PostgreSQL 15 is the
  evidence (AC20). If PostgreSQL refused it, the deploy's pre-run hook would
  fail and the `deploy-staging` job would go red: loud, and the old version
  keeps running.
- **A start racing an end** (`insertStarted`'s comment). Reachable from this
  task now that a journey can end: a walker's start that conflicts with their own journey as it
  ends answers 500, and the app's retry then starts. Loud, nothing is lost,
  and no journey goes unwatched. Left for task 7, whose ends come from a
  responder or the worker rather than the walker's own phone, so a walker's
  start can meet one by chance.
- **The fake can drift from the adapter.** The shared behaviour suite holds
  them together (AC2, AC4 to AC8, AC12, AC14 to AC16).
- **Personal data in new columns.** Times and enums only: when an alert
  resolved and how, when a journey ended and why, when a message was
  withdrawn. They are alert and journey records under the retention rule
  (M4). No location, no phone number, no name.
- **A coverage report that reads as done.** LOST-03 and SM-04 turn 🟢 while
  the halves under "How this spec names requirements" remain.

### Flags from other decisions, checked

- **D-086:** every message stays content-free, of every kind (AC9). The name
  and the current position come from the app's read (D-106).
- **D-087:** only the lost-contact alert uses the critical level. The two new
  kinds never do; M3's adapter maps the level from the kind, and D-087's owed
  test "over every outbox message type" now has three types to cover. Each
  message keeps its own opaque ID. Whether a stand-down should replace the
  lost-contact notification on the phone (a shared collapse ID or a thread)
  is M3's adapter design, against D-087's per-message rule.
- **D-101:** extended to ending a journey, by the owner's answer (D-110).
- **D-103:** "I'm home" needs no event ID (D-110); the heartbeat has one.
- **D-106:** no read route here.
- **D-108:** the outbox stays our own table; retries unchanged; LOST-02's
  "stopping them when an alert resolves" is met by withdrawal.
- **D-091:** no responder or walker device has a credential outside tests
  before the login task. Task 8's canary will be the first to call the new
  route.
- **D-014:** no text is sent; the app's words come in M3, bokmål first.

## Out of scope

- **What the responder sees:** the name, the current position and its age,
  and the words "is back in contact" or "is home", in bokmål first. M3, with
  the alert screen and its read route (D-106, D-014).
- **The notification level and the real push adapter** (M3, D-087, A-11).
- **The app's "I'm home" button, its offline queue, stopping the phone's
  sharing, and what the app does with a 409** (the I'm-home story, M3).
- **Telling responders that an `ACTIVE` journey ended** (the start-and-end
  story, M3; D-110).
- **Telling the walker that their group was alerted, or stood down.** Not in
  any story.
- **"I'm on it", escalation to SMS, "They're safe", the 24-hour rule and the
  two-hour rule** (tasks 5 to 7). They resolve alerts through approach item
  4's helper.
- **The canary** (task 8).
- **Retention** of ended journeys, resolved alerts and withdrawn messages
  (the retention rule, M4), and the DPIA.
- **Moving a journey to another device** (D-101's consequences).

### Left for later tasks

Each is named here so the task that owns it finds it. None blocks this task.

- **Task 5 ("I'm on it"):** an acknowledgement for an alert already
  `RESOLVED` must be refused or answered plainly; this task resolves
  `ACKNOWLEDGED` alerts as any other (AC4).
- **Task 6 (escalation to SMS, the resumed-escalation rule, the
  last-responder warning):**
  - no SMS for a `RESOLVED` alert. Unsent SMS messages are withdrawn as the
    lost-contact ones are: the resolve helper's step 2 gains that kind;
  - whichever task first lets a responder be removed from, or added to, a
    running journey (the resumed-escalation rule here; the abusive-member
    threat and the call-sharing story in M3) decides who gets the
    stand-down then. Today the journey's responders and the people the
    alert told are the same list. Claude's view: someone still a responder
    and written a lost-contact message, so a removed responder hears
    nothing more, and one added after the loss is not told of an alert they
    never had.
- **Task 7 ("They're safe", the 24-hour rule):**
  - resolve through approach item 4's helper, with resolutions and end
    reasons of their own;
  - the start that races an end (`insertStarted`'s comment): retry the
    insert once, as the comment says.
- **Task 8 (the canary):** end its journeys through the "I'm home" route
  (D-110), and go red if a stand-down is never delivered, as LOST-02 asked of
  lost-contact messages.
- **M3, the push adapter:** bound every send under `CLAIM_LEASE_MS` (the
  order of AC8 rests on it); decide when an undeliverable message is given
  up, a stand-down first; consider whether the claim should take alerts
  before stand-downs; map the two new kinds to a non-critical level (D-087).
- **M3, the app:** show the alert's current state on open, never the order
  notifications arrived in; treat a 200 `ENDED` and a 409 `JOURNEY_ENDED`
  from "I'm home" alike; read "the current position" as the latest
  heartbeat's, with its age and accuracy.
- **M4, retention:** when an ended journey's rows go (the "Open for M4"
  question in `plan/README.md` now has an `ended_at` to count from), and
  whether withdrawn messages are alert records like any other.
- **M6 / L10:** flapping alerts for patchy coverage (F2, above); the claim's
  partial index holding withdrawn rows.

From review loop 1 (2026-10-06). None blocks this task:
- **M3's push task: the deploy overlap.** While a deploy overlaps, the old
  worker still runs its old claim, which has no `withdrawn_at` condition.
  So a withdrawn message, a stale lost-contact alert among them, could be
  sent by the old worker during a zero-downtime overlap. Today nothing is
  really sent (`UNCONFIGURED_PUSH`), so the harm starts with M3's push
  adapter, which must close it: an expand-then-contract change to the
  claim, or a deploy that stops the old worker first (`safety-reviewer`).
- **Task 6: nothing pins that the withdrawal leaves other kinds alone.** The
  resolve's withdrawal (approach item 4, step 2) touches `LOST_CONTACT`
  messages only, and no test holds that a message of another kind is left
  as it was. Once task 6 adds its SMS kind, its tests should pin which kinds
  each withdrawal touches (`test-auditor`).
- **A code note: the fake store's threshold.** `fakeJourneyStore` keeps its
  own copy of D-021's 300 000 ms instead of being given it, because the test
  kit cannot import the domain. A change to the threshold would need both
  changed; the behaviour suite runs against both stores, so a mismatch would
  fail, but only at the boundary it tests (`code-reviewer`).
- **A code note: `lockedStateOf`.** A helper that takes a journey's row and
  returns its state, for D-112's "the journey's row first" rule, would keep
  the three paths that lock it (heartbeat, "I'm home", the open) from
  drifting apart (`code-reviewer`).
- **The owner's call: three files with no code owner.** `ports.ts`,
  `packages/contracts/src/home.ts` and `contact.system.test.ts` need no
  owner's approval to change. `ports.ts` was raised after LOST-01 and
  LOST-02 too. The review list ties the last to an existing item from
  BUG-14's reviews; that was not re-read here (`code-reviewer`).

## Settled by the plan, so not asked

- **A heartbeat moves a `LOST_CONTACT` journey back to `ACTIVE` and resolves
  the alert** (D-033, the state table).
- **"I'm home" from `LOST_CONTACT` ends the journey (home), resolves the
  alert, and tells responders "is home"** (SM-04). That the route is built in
  this task is the owner's answer (D-110, below).
- **The alert goes to `RESOLVED`, from `OPEN` or any later state** (D-033,
  the alert states).
- **Contact is decided on the database's clock** (REL-01), at D-021's
  threshold.
- **A duplicate heartbeat has no effect** (SM-08; LOST-01, reading 3), so it
  never brings contact back.
- **Events after `ENDED` are ignored and logged without location** (SM-07).
- **Push is content-free** (D-086); **only the lost-contact alert is
  critical** (D-087).
- **The state change and every message it causes in one transaction**
  (AR-05); **the watchdog lock-safe** (AR-06).

## Answered by the owner (2026-10-06)

Each was asked with Claude's recommendation and two or more options, and the
owner chose the recommendation both times. The answers were relayed to this
session by the coordinating session; they are recorded as D-110 and D-111.
Claude's own technical choices in this spec are D-112 (delegated, D-031;
approach item 12).

### Q1 — How does a queued "I'm home" reach the server in this task?

**Why it is asked.** The roadmap says this task is done when "a heartbeat,
or a queued 'I'm home', after an alert resolves it and tells the responders,
at L6", and L6 runs through the real API. No route ends a journey today
(`contract.ts`: health, start, heartbeat). The "I'm home" story itself, the
app's button and its queue, is M3's. So SM-04 cannot be tested at L6 without
a route, and building one means choosing what it does for an `ACTIVE`
journey too.

**Options:**
- **(a) Build the server's "I'm home" route now, its server half only.**
  `POST /v1/journeys/{journeyId}/home` ends an `ACTIVE` or `LOST_CONTACT`
  journey (end reason `HOME`, with its time). From `LOST_CONTACT` it resolves
  the alert and tells every responder "is home" (SM-04). From `ACTIVE` it
  tells nobody until M3's start-and-end story adds the end notice. Only the
  device that started the journey may send it, as for heartbeats (D-101),
  because ending a journey stops all protection and the threat model lists
  "the ability to end journeys" as something to protect. It takes no event
  ID: a repeat finds the journey ended and gets 409, changing nothing (D-103's
  reading). It also gives task 8's canary a way to end its journeys, which
  SM-01's spec said it would need.
- **(b) As (a), and tell responders of an `ACTIVE` journey's end too.** That
  pulls the start-and-end story's end notice into M2. The outbox would then
  need messages with no alert (a journey column, `alert_id` made optional),
  which is the design M3's journey notices need anyway, made early.
- **(c) Build only the heartbeat half now.** SM-04 and the queued "I'm home"
  move to M3, with the I'm-home story. The roadmap's "done when" and D-090's
  item 4 change, and task 8's canary needs an end some other way.

**Recommendation: (a).** It delivers what D-090 and the roadmap ask, at L6,
with the smallest server surface that makes sense: a route that refused
`ACTIVE` journeys would be nonsense to any caller. It leaves the end notice
and everything on the phone to M3, where they are planned.

**Answer: (a)**, the recommendation. Build the server half of the "I'm home"
route now, `POST /v1/journeys/{journeyId}/home`, as specified; from `ACTIVE`
it tells nobody until M3. **D-110.** AC14 to AC18, and the "I'm home" parts
of AC3, AC9, AC13 and AC20, prove it.

### Q2 — Once contact is back, what happens to lost-contact pushes that have not gone out, and who gets the stand-down?

**Why it is asked.** When contact comes back seconds after an alert opened,
some lost-contact pushes may not have been sent yet: never tried, or failed
and waiting to retry. LOST-02 left "stopping them when an alert resolves" to
this task. What a responder's phone does at night is a safety choice, so it
is the owner's.

**Options:**
- **(a) Never send them; stand down every responder.** Every unsent
  lost-contact push of the alert is withdrawn. Every responder on the
  journey gets "back in contact" (or "is home"), whether or not their alert
  went out.
- **(b) Never send them; stand down only those who may have been alerted.**
  As (a), but the stand-down goes only to responders whose lost-contact push
  was handed to the push service at least once.
- **(c) Send them anyway, then stand everyone down.** Every lost-contact push
  still goes out, at the critical level, followed by the stand-down.

**Recommendation: (a).**
- Withdrawing is right because a critical, break-through alert about a
  silence that is already over is a false alarm, and false alarms teach
  responders to ignore the real one. (c) sends exactly that.
- Everyone gets the stand-down because "may have been alerted" cannot be
  known for sure: a push the service reported as failed may still have
  reached the phone, and once SMS escalation exists (task 6), people are
  told by SMS too. A responder who heard of the loss and is never stood
  down might still be calling 112 or out looking; that is the harm to avoid.
- The cost of (a) is small and rare. A stand-down reaches someone who never
  saw the alert only when contact came back before their alert was even
  tried, which in practice means within a second or so of the alert opening.
  They get one non-critical notice, and the app shows what happened.
- (b) avoids that notice, but leaves a gap that task 6's SMS would have to
  close again.

**Answer: (a)**, the recommendation. Withdraw every unsent lost-contact push
for the alert, and send the stand-down to every responder. **D-111.** AC6
and AC7 prove it, and AC14 holds it for "I'm home".
