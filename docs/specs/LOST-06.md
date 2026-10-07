# LOST-06 · "I'm on it": a responder acknowledges an open alert, it is recorded on the alert, and every other responder is told

**Milestone:** M2, task 5 of 8 (D-090) · **Delivers:** LOST-06 (its server
half) · **Decisions:** D-014, D-019, D-022, D-031, D-033, D-036, D-074, D-075,
D-086, D-087, D-090, D-091, D-092, D-094, D-095, D-097, D-098, D-099, D-100,
D-101, D-102, D-103, D-106, D-107, D-108, D-110, D-111, D-112 · **Written:**
2026-10-06 by `planner`, outside the repository, against LOST-03's branch
(`claude/busy-faraday-40n2zl` at `53bf338`, pull request #64) as the working
tree held it. #64 was squash-merged as `57502b8`, whose tree is identical to
`53bf338`'s (`git diff 53bf338 57502b8` is empty), so every file named below
reads the same on `main` · **Status:** Spec, settled. The owner
answered Q1 on 2026-10-06 with the recommended answer, (a) (D-113), so the
criteria stand as written.

## Requirement

### The rule this task delivers

**LOST-06** (`docs/plan/01b-mvp-scope.md`, LOST section, Must). The second
bullet names the escalation story by its ID in the original; it is replaced
by a name here, for the reason under "How this spec names requirements":

> **LOST-06 · "I'm on it"** (Must — D-019)
> - A responder can mark an alert as "I'm on it", so other responders see
>   that someone is handling it. This reduces the "someone else will call"
>   effect.
> - Acknowledging stops the SMS escalation in [escalation to SMS].

### The owner's scope (D-090, item 5, and the roadmap)

D-090, item 5 (accepted by the owner, 2026-10-01):

> **LOST-06 — "I'm on it".**

`docs/plan/10-roadmap.md`, "M2 — Core safety loop in detail", row 5, **done
when:**

> A responder's answer is recorded and shown, at L6

L6 is "complete flows through the real API with recording fakes for push and
SMS and a controlled clock" (`06-testing-strategy.md`, the levels table).

### What the plan fixed around it

- **The acknowledgement rule** (`03-safety-reliability-security.md`,
  reliability table, 7th row; binding under D-022), with the same
  replacement:

  > Alerts need acknowledgement ("I'm on it", LOST-06). If no responder
  > acknowledges within 2 minutes, every responder on the journey gets an SMS
  > ([escalation to SMS], D-019).

- **D-019** (owner): "A lost-contact alert goes out as a push notification.
  If no responder taps 'I'm on it' within 2 minutes, every responder on the
  journey gets an SMS."
- **Escalation to SMS** (LOST section, 7th story; task 6): "Escalation stops
  as soon as anyone acknowledges", and its test: "with an acknowledgement at
  1 minute, no SMS is sent".
- **The alert states** (`05-architecture.md`, binding under D-033), with the
  story IDs replaced by names:

  > `OPEN` → `ESCALATED` (no acknowledgement within 2 minutes; SMS sent,
  > [escalation to SMS]) → `ACKNOWLEDGED` → `RESOLVED` (for example "They're
  > safe", ["They're safe"]). An `OPEN` alert can also go straight to
  > `ACKNOWLEDGED` (other responders see who is on it) or `RESOLVED` (the
  > phone is back in contact, or the journey ended).

- **The resumed-escalation rule** (`05-architecture.md`, edge-case rules,
  10th row): "If the responder who acknowledged an alert is removed, the
  alert goes back to unacknowledged and escalation resumes."
- **"They're safe"** (LOST section, 8th story; task 7): "As the responder who
  tapped 'I'm on it', I can close a lost-contact alert … Only the responder
  who acknowledged can close the alert."
- **The data model sketch** (`05-architecture.md`): `alerts` holds "State,
  opened, escalated, acknowledged by, resolved".
- **F6** (`03-safety-reliability-security.md`, failure modes): "Alert not
  noticed (push delayed, phone on silent, responder asleep) | **Missed alert
  — the core promise fails silently** | Break-through notifications,
  acknowledgement, escalation". Research finding 4 there: "For alerts, the
  system needs to know whether a human actually saw them. That means an
  acknowledgement, and escalation when nobody acknowledges."
- **The threat model:** "What we protect: … the ability to end journeys and
  to silence alerts." From task 6 an acknowledgement silences escalation, so
  it is one of those abilities.

### Inputs this spec builds on

- **D-086:** push messages carry no personal data; the app fetches the
  details from our server. **D-087:** only the lost-contact alert uses the
  critical level; every message has "an opaque, per-message collapse ID".
- **D-090 and D-091:** until the login task, device sessions come only from
  tests and, on staging, from the canary; a device authenticates with a
  hashed per-device credential; "no route, seed or insert function creates a
  credential" before the login task.
- **D-103:** SM-08 is read as "every event must be safe to receive twice",
  and each later event (back in contact, "I'm on it", "They're safe") decides
  in its own task whether it needs an event ID.
- **D-106:** the route that reads an alert's details comes with the alert
  screen in M3, with its access check. LOST-02 built no read route.
- **D-108:** the outbox is our own table, delivered by the worker's loop:
  claim (30 s lease), send outside any transaction, mark; retries from 10 s,
  doubling, capped at 60 s.
- **D-110 to D-112** (LOST-03): one helper resolves an alert, in the
  transaction that moved the journey; unsent lost-contact pushes are
  withdrawn and every responder is stood down (D-111); a stand-down waits
  behind a lost-contact push still in the port's hands, at most 60 s; a
  later open withdraws earlier stand-downs (`ALERT_RESOLUTIONS`' kinds, for
  responders of the new journey); **the journey's row first, always**.
- **AR-03** (no clock in domain or module code), **AR-04** (one state
  machine module; the domain decides under the lock), **AR-05** (a change and
  its messages in one transaction).

### What earlier tasks left for this one

| Left for task 5, or met here because this task adds the first new kind | Where it was left | Where it is met |
|---|---|---|
| "An acknowledgement for an alert already `RESOLVED` must be refused or answered plainly; this task resolves `ACKNOWLEDGED` alerts as any other" | LOST-03's spec, "Left for later tasks" | Reading 5; AC5, AC7 |
| "Nothing pins that the withdrawal leaves other kinds alone … once task 6 adds its SMS kind, its tests should pin which kinds each withdrawal touches" | LOST-03's spec, from review loop 1 | This task adds the first kind, so it pins it now: AC13 |
| "A stand-down kind that is not a resolution must opt in to the open's withdrawal … a domain test that pins `MESSAGE_KINDS` … would make every new kind fail until someone decides" | LOST-03's spec, loop 3 | AC13, for every kind and both withdrawals |
| "The fake's `STAND_DOWN_KINDS` is a copy of `ALERT_RESOLUTIONS` that nothing ties to it" | LOST-03's spec, loop 3 code note | AC13 |
| Whether this task's event needs an event ID | D-103 | Reading 9; AC4 |

`docs/progress/m2.md`'s "Left for later tasks" lists for LOST-01, LOST-02 and
LOST-03 were read for anything sent to task 5: none names it.

### What exists today, and what does not

Read on 2026-10-06, in the files themselves:

- **No route names an alert.** `packages/contracts/src/contract.ts` is
  `{ health, startJourney, recordHeartbeat, reportHome }`.
- **The domain** lists four alert states; the code writes only `OPEN` and
  `RESOLVED`. Nothing writes `ESCALATED` or `ACKNOWLEDGED`; LOST-03's tests
  put them in directly. There is no alert event: `transition` holds
  `start`, `heartbeat`, `silence`, `contact` and `home`.
  `MESSAGE_KINDS` is `LOST_CONTACT`, `BACK_IN_CONTACT`, `HOME`.
- **`alerts`** holds `id`, `journey_id`, `state`, `opened_at`,
  `silent_since`, `resolved_at`, `resolution`: no acknowledger and no
  acknowledgement time.
- **The resolve helper** (`resolveInside` in `adapters/journeys.ts`)
  withdraws `kind = 'LOST_CONTACT'` and holds a responder's stand-down behind
  their withdrawn message by a `left join withdrawn on recipient_id`. That
  join is right only while at most one row per recipient is withdrawn, which
  the unique (alert, recipient, kind) guarantees for one kind and not for
  two (approach item 5).
- **The open** withdraws earlier alerts' unsent messages whose kind is in
  `ALERT_RESOLUTIONS`, for recipients who are responders of the new journey.
- **`modules/alerts/`** holds the watchdog and the sender (the worker's
  side). `ApiDependencies` is `{ health, journeys, devices }`.
- **Any device authenticates as its own user, walker or responder alike.**
  In tests a responder gets a device as a walker does
  (`fakeDeviceAuthenticator().register()` at L6, a `devices` row through
  `hashCredential` at L3).
- **The log** has ten closed events.

### Readings this spec makes

Each is stated so the reviewers can check it, not assumed quietly.

1. **"A responder"** is a user with a row in `journey_responders` for the
   alert's journey, as read when the acknowledgement is decided. The walker
   is never one (the start rule refuses the walker as a responder). Any of
   that user's devices may send it: a responder is a person. D-101 binds a
   journey's heartbeats to the walking phone so that no other device can
   hide its silence; no silence is at stake here.
   - An alert ID no alert has, and an alert of a journey the caller does not
     follow, the walker's own included, get one answer, `ALERT_NOT_FOUND`,
     so the route says nothing about alerts the caller does not follow, as
     `JOURNEY_NOT_FOUND` does for journeys.
2. **"Mark an alert"** names one alert, by its ID, in the path; never "the
   journey's current alert". From task 6 an acknowledgement stops the SMS
   escalation. A late or retried acknowledgement of an earlier alert that
   reached a later one would silence an alert nobody acknowledged.
3. **Valid states.** An alert can be acknowledged while it is unresolved and
   nobody is recorded on it: `OPEN`, `ESCALATED` (written from task 6, put in
   directly here), and `ACKNOWLEDGED` with nobody recorded (a state the code
   never makes). It becomes `ACKNOWLEDGED`, with `acknowledged_by` the
   responder and `acknowledged_at` the transaction's `now()`.
   - The last case is met in the safe direction: a record that says
     "acknowledged" with nobody on it would stop task 6's escalation for
     nobody's sake.
   - The journey's state is not read. Every path that moves a journey out of
     `LOST_CONTACT` resolves its alert in the same transaction (LOST-03,
     D-112), so an unresolved alert's journey is `LOST_CONTACT`.
4. **One responder is on it.** The plan says it in the singular four times:
   the data model ("acknowledged by"), the alert states ("see who is on
   it"), the resumed-escalation rule ("the responder who acknowledged") and
   "They're safe" ("Only the responder who acknowledged can close the
   alert").
   - The same responder again: 200, and nothing changes;
     `acknowledged_at` keeps its first time.
   - Another responder: 409 `ALREADY_ACKNOWLEDGED`, and nothing changes.
5. **After the alert resolved** (contact back, "I'm home", or any later
   resolution): 409 `ALERT_RESOLVED`, nothing changes, and one
   `acknowledgement_ignored` line naming the alert and the reason.
   - For a journey that ended, that line is SM-07's "ignored and logged
     without location": every end resolves the journey's alert (LOST-03), so
     an acknowledgement after `ENDED` meets a `RESOLVED` alert.
   - The rule's order is part of the rule: not found before resolved, as a
     heartbeat's is not found before ended. Someone who does not follow the
     journey never learns whether its alert resolved.
6. **"Other responders see that someone is handling it" in M2** (Q1, on its
   recommended answer): the acknowledgement is recorded on the alert, for
   M3's read (D-106), and every other responder is told now, by one
   content-free push of a new kind, `ACKNOWLEDGED`, written in the
   acknowledgement's own transaction (AR-05).
   - Not the acknowledger, who has the answer, and not the walker: no story
     tells the walker.
   - Who is on it, by name, is the app's to read (D-086, D-106). LOST-06 says
     "see that someone is", the alert states "see who is on it"; the record
     keeps who, so M3 can show either.
7. **An acknowledgement withdraws nothing and stands nobody down.** The
   other responders' lost-contact pushes, sent or not, go on as they were:
   the alert is still open, and each of them must still hear of it. Stopping
   the SMS is task 6's, which reads this record. That holds at our push port;
   at Apple, a later notice can replace an undelivered critical push, which
   D-113's amendment gates in M3 (Risks, F6).
8. **A notice that has gone stale is withdrawn.** When the alert resolves,
   an `ACKNOWLEDGED` notice the port has not accepted is withdrawn with the
   alert's unsent lost-contact pushes, by D-111's reasoning.
   - "Someone is on it" after the all-clear is stale.
   - Retried past a later alert's lost-contact push, it would say "someone is
     on it" about an alert nobody acknowledged: the overtaking that D-112's
     review loop 1 closed for stand-downs.
   - Every responder, the acknowledger included, still gets the stand-down
     (D-111).
9. **No event ID** (D-103's reading). The natural key, (alert, responder),
   makes every repeat safe: the acknowledger's repeat finds itself recorded
   (200, nothing written); another responder's finds the alert taken (409,
   nothing written); after the resolution, 409 `ALERT_RESOLVED`, nothing
   written.
10. **Database time** (AR-03, SM-09). `acknowledged_at` is the transaction's
    `now()`. The module and the domain read no clock.

### What escalation to SMS (task 6) will read from this record

Written so that task 6 reads this record and does not change it.

- **`alerts.state`.** `ACKNOWLEDGED` means someone is on it. Task 6
  escalates an unresolved alert two minutes after `opened_at` unless
  `state = 'ACKNOWLEDGED'` **and** `acknowledged_by is not null`
  (`safety-reviewer`). A state alone is not enough: reading 3 lets an
  `ACKNOWLEDGED` alert with nobody recorded be acknowledged, because it
  would stop the SMS for nobody's sake, and a half-done reset by the
  resumed-escalation rule would do the same. A missing half fails toward
  sending the SMS.
- **`alerts.acknowledged_at`.** The first, and only, acknowledgement's time:
  the database's `now()` in the transaction that recorded it. A repeat does
  not move it. It is the record and the tests' evidence ("an acknowledgement
  at 1 minute", AC9). The decision is the state and who, read under the
  lock.
- **`alerts.acknowledged_by`.** Who. "They're safe" checks it. The
  resumed-escalation rule clears it, with `acknowledged_at` (the check takes
  both null), and moves the state back.
- **One responder's acknowledgement stops the SMS to everyone.** Yes: the
  acknowledgement rule ("If no responder acknowledges …"), D-019 ("If no
  responder taps … every responder") and the escalation story ("Escalation
  stops as soon as anyone acknowledges") all say so. Not asked.
- **Where the two meet: on the journey's row** (D-112's lock order). Task 6's
  escalation takes the journey's row and checks the alert's state under it,
  as the acknowledgement does (approach item 4). Whichever commits first
  wins:
  - the acknowledgement first: the escalation finds it acknowledged (the
    state and who) and sends nothing;
  - the escalation first: the alert is `ESCALATED` with its SMS written, and
    the acknowledgement then moves it to `ACKNOWLEDGED`. Task 6 adds the
    withdrawal of the alert's unsent SMS to the acknowledgement's write
    (approach item 4, step 4), and places its SMS kinds in the withdrawal
    lists, which AC13 makes it do.
- **What task 6 does change** is the outbox's unique (alert, recipient,
  kind) for a second acknowledgement after a reset ("Left for later
  tasks"). No column, type or check this task adds needs changing.

### How this spec names requirements, and why

The `traceability` job runs `req:coverage --fail-on-uncovered-changed`. It
fails if a changed spec names a tracked requirement, or an acceptance
criterion, that no test names; `mentions` matches an ID anywhere in the
text, so a range written with IDs names both its ends (LOST-03's spec,
read in `scripts/lib/requirements.mjs`; not run here). `docs/requirements-status.md`,
read 2026-10-06: 16 of 63 live requirements have a test.

- **Delivered here, and must be named by a test:** LOST-06, uncovered
  today.
- **Cited, already covered, and not claimed:** LOST-01 (13 tests), LOST-02
  (15), LOST-03 (14), SM-01 (9), SM-04 (7), SM-07 (4), SM-08 (4), SM-09 (5),
  SEC-06 (1), SEC-07 (8), PRIV-07 (7). Several criteria strengthen them, and
  their tests name them too (test plan).
- **Not claimed: the acknowledgement rule.** D-090 gives it to task 6, whose
  SMS is its second sentence. Claimed here, it would show as covered with
  its SMS half missing.
- **Untracked, named freely:** AR-, D-, F-, RG-, INF-, BUG-, A-, HK- and L-
  IDs (D-074).
- **Every other tracked requirement is named in words**, here, in product
  code and in its comments (the live gotcha in `docs/progress.md`).

| Name used here | Where it lives |
|---|---|
| escalation to SMS | `01b-mvp-scope.md`, LOST section, 7th story (task 6) |
| "They're safe" | LOST section, 8th story (task 7) |
| the login task | GRP section, 1st story (M3) |
| responder setup | GRP section, 4th story (M3) |
| the what-responders-see story, the I'm-home story | JRN section, 3rd and 5th stories (M3) |
| the what-to-do story | HELP section, 1st story (M3) |
| the acknowledgement rule, the alert-level rule, the canary rule, the no-location-in-SMS rule | `03-safety-reliability-security.md`, reliability table, 7th, 6th, 10th and 12th rows |
| the abusive-member threat | same file, threat model, 2nd row |
| the resumed-escalation rule, the 24-hour rule | `05-architecture.md`, edge-case rules, 10th and 6th rows |
| the responders-only rule, the retention rule | `02-norway-law-privacy.md`, privacy table, 3rd and 4th rows |

**Partial delivery shows as full.** Once tests name it, LOST-06 shows as
covered. These halves remain, and "Out of scope" lists each: the app's
button and alert screen (M3); the name of who is on it, and the words, in
bokmål first (M3, D-106, D-014); the notice's notification level (M3,
D-087); responder credentials (the login task); the L7 flow "responder
acknowledges" (M3); and the SMS it stops (task 6).

## Approach (technical choices delegated to Claude, D-031)

1. **Where the code goes, and why there.**
   - **The rule:** `domain/journey.ts` gains the alert's event list, its
     rule, a fourth message kind and one withdrawal list. AR-04 keeps every
     state and transition in one module, and the alert's states are listed
     there already. Owned, filtered, mutated (`domain`).
   - **The module:** `modules/alerts/acknowledgement.ts` (new). The action
     is on an alert. The folder is already owned, in the ai-review `safety`
     filter and in `SAFETY_PATHS`; a new folder would mean editing
     `ai-review.yml`, which only a hand merge can carry (D-075).
     Mutated in the `alerts` group (Mutation, below).
   - **The SQL:** `adapters/journeys.ts`: the read, the write (the
     transaction in `recordAcknowledgement`) and two changes to
     `resolveInside`. Owned,
     filtered, proven at L3 (D-095).
   - **The route:** `packages/contracts/src/alerts.ts` (new), `api.ts`
     (owned, D-097), and the wiring in `api-process.ts` (owned, mutated).
   - **Unchanged:** `worker.ts`, `modules/alerts/watchdog.ts` and
     `outbox.ts`, `modules/journeys/`, `domain/watchdog.ts`,
     `adapters/db.ts`, and the open (`openInside`).

2. **The rule (`domain/journey.ts`).**
   - `ALERT_EVENTS = ['acknowledge']`, with `alertTransition(alert, event)`.
     As built (green phase), it is a table of rules typed over
     `ALERT_EVENTS` (`satisfies Record<…>`, so an event listed without a
     rule is a type error), with a throw for an event type it does not
     list. It is not the `switch` with a `never` default that `transition`
     has: typescript-eslint's `no-unnecessary-condition` checks each `case`
     against the discriminant, and refuses a one-case `switch`. It becomes a
     `switch` with a `never` default once a second alert event exists.
   - The situation, `AlertForAcknowledgement`: the alert's `id`, `state`,
     `acknowledgedBy` (a user ID or null) and its journey's `responderIds`.
     The event: `{ type: 'acknowledge', responderId }`.
   - **The order, which is part of the rule:**
     1. no alert, or the sender is not among `responderIds` → refused,
        `ALERT_NOT_FOUND`;
     2. `RESOLVED` → ignored, `ALERT_RESOLVED`;
     3. `acknowledgedBy` is the sender → unchanged, `ALREADY_YOURS`;
     4. `acknowledgedBy` is someone else → refused, `ALREADY_ACKNOWLEDGED`;
     5. otherwise → `{ type: 'acknowledged', state: 'ACKNOWLEDGED' }`.
   - IDs are compared exactly, as the home rule compares them; the stores
     hand IDs back in lower case and the contract lower-cases the alert's.
   - **The lists:**
     - `MESSAGE_KINDS = ['LOST_CONTACT', 'BACK_IN_CONTACT', 'HOME',
       'ACKNOWLEDGED']`;
     - `WITHDRAWN_WHEN_RESOLVED = ['LOST_CONTACT', 'ACKNOWLEDGED']`: the
       kinds an alert's resolution withdraws from its own alert;
     - the open's list stays `ALERT_RESOLUTIONS` (D-112, loop 3);
     - every kind is in exactly one of the two lists, held by a test that
       names a kind placed in neither or both (AC13).
   - **Why an event list of its own, not a sixth journey event.** The
     journey's table is (journey situation × event); an acknowledgement's
     situation is an alert's. As a journey event it would add four rows for
     situations the rule never reads, and change every pin of
     `JOURNEY_EVENTS` for nothing.
   - Pure, total, and no clock.

3. **The module (`modules/alerts/acknowledgement.ts`).**
   - `createAcknowledgementService({ alerts, log })` gives
     `acknowledge({ responderId, alertId })`.
   - It reads the alert (`alertForAcknowledgement`, a plain read without a
     lock) and asks the rule:
     - `ALERT_NOT_FOUND` or `ALREADY_ACKNOWLEDGED`: returned as they are; no
       line;
     - `ALERT_RESOLVED`: one `acknowledgement_ignored` line; returned;
     - unchanged (`ALREADY_YOURS`): `{ type: 'acknowledged' }`; nothing
       written;
     - acknowledged: `recordAcknowledgement({ alertId, responderId })`, and
       its answer mapped the same way, the line for `ALERT_RESOLVED`
       included.
   - A failure is one `acknowledgement_failed` line, stage `read` or
     `store`, with the SQLSTATE, and is thrown on, so the API answers 500.
   - **Why read first.** A refusal that cannot change (`RESOLVED` is final,
     and nothing removes a responder yet) is answered without a lock. So
     neither a stranger nor a late acknowledgement of a resolved alert ever
     holds a journey's row.
   - It reads no clock.

4. **The store (`recordAcknowledgement`), one transaction,** written inline
   in the method.
   1. **The journey's row first** (D-112): `select … from journeys where id
      = (select journey_id from alerts where id = $a) for update`. No such
      alert: the rule's `ALERT_NOT_FOUND`.
   2. **Under that lock**, read the alert's state and acknowledger and the
      journey's responder rows, and ask `alertTransition` (AR-04).
   3. **Any decision but `acknowledged`** is answered as it is, writing
      nothing. Under the lock these can happen: another responder's
      acknowledgement, a copy of this one, or a resolution may commit between
      the module's read and the lock. When a later task can remove a
      responder, `ALERT_NOT_FOUND` can happen there too; it is answered, not
      thrown.
   4. **`acknowledged`:** `update alerts set state = 'ACKNOWLEDGED',
      acknowledged_by = $r, acknowledged_at = now() where id = $a and state
      <> 'RESOLVED' and acknowledged_by is null`. It must change exactly one
      row, or the transaction is rolled back. Task 6 adds the withdrawal of
      the alert's unsent SMS here.
   5. **One `ACKNOWLEDGED` message per responder row other than $r**: the
      alert's ID, a new random ID, `created_at = now()`, `attempts = 0`,
      `next_attempt_at = now()`. None when the acknowledger is the only
      responder. The unique (alert, recipient, kind) refuses a second one.
   6. Answer `{ outcome: 'acknowledged', messages }`.
   - Any error rolls back all of it. The errors are not rewritten as the
     heartbeat's are: nothing here binds a location or a phone number, and
     the module logs the SQLSTATE alone.

5. **Resolving an acknowledged alert: two changes to `resolveInside`
   (LOST-03's helper).**
   1. **Withdraw the kinds of `WITHDRAWN_WHEN_RESOLVED`** (was `kind =
      'LOST_CONTACT'`), so an unsent `ACKNOWLEDGED` notice is withdrawn
      with the lost-contact pushes (reading 8).
   2. **The hold, per responder, over everything withdrawn.** A responder's
      stand-down is due at the latest `next_attempt_at` among that
      responder's withdrawn messages that were handed over (`attempts ≥ 1`)
      and are due after `now()`; otherwise at `now()`. The bound stays
      60 s.
   - **Why the second change is not optional.** Today the withdrawn rows are
     left-joined to `journey_responders` by recipient. With two kinds
     withdrawn, a responder with an unsent lost-contact push and an unsent
     notice gets two stand-down rows. A phone with no push target is enough:
     both messages fail `NO_TARGET`. The unique (alert, recipient, kind)
     refuses the second row, and the whole transaction rolls back.
     - For a heartbeat that is a 500, which the phone resends, and which
       fails the same way every time. Contact could never come back, the
       alert would never resolve, and every heartbeat of that journey would
       be refused.
     - For "I'm home", the same, for ever.
     - The fake would not fail. Its `planResolution` takes each
       responder's withdrawn message with `withdrawn.find(…)`, the first
       one only (read 2026-10-06), so with two kinds withdrawn it writes one
       stand-down, held by whichever message it found first. The L6 tests
       would pass over a broken adapter. AC8 holds both stores to one
       answer in the shared behaviour suite, at L2 and L3, and the fake's
       hold becomes the latest of that responder's due times, as the
       adapter's does.
   - The alert keeps `acknowledged_by` and `acknowledged_at`.
   - **The open is unchanged**, and needs no `ACKNOWLEDGED` in its list. A
     notice exists only for an unresolved alert; the acknowledgement and the
     resolution meet on the journey's row; and the resolution withdraws
     every notice still unsent. So when a later alert opens, no earlier
     notice is both unsent and unwithdrawn. AC7's property and AC12's races
     hold it.

6. **The route.**
   - `POST /v1/alerts/{alertId}/acknowledgement` (contract path
     `/alerts/{alertId}/acknowledgement`, route `acknowledgeAlert`), built on
     `deviceRoute`.
   - **Detailed input, as the "I'm home" route's** (D-112): `params` is a
     strict object holding `alertId` alone, a UUID, lower-cased; `body` is
     an empty strict object, optional. So the alert comes from the path only,
     and any key in a body is the fixed 400.
   - **The answers.** Each is a fixed shape; none carries anything of the
     request, and none says who is on it.

     | Status | Code / body | When |
     |---|---|---|
     | 200 | `{ "outcome": "ACKNOWLEDGED" }` | Recorded now, or already the caller's |
     | 400 | `BAD_REQUEST`, fixed, no `data` | An alert ID that is not a UUID, or a body with any key |
     | 401 | `UNAUTHORIZED` (unchanged, D-091) | No valid device credential |
     | 404 | `ALERT_NOT_FOUND` | No such alert, or the caller does not follow its journey, the walker included: one body for all |
     | 409 | `ALREADY_ACKNOWLEDGED` | Another responder is on it. Nothing changes |
     | 409 | `ALERT_RESOLVED` | The alert is over. Nothing changes |
     | 500 | unchanged | The read or the write failed. Nothing changes |

   - **`api.ts`:** `ApiDependencies` gains `acknowledgements`. The responder
     is the device's own user; the alert is `input.params.alertId`. The
     comment beside `BAD_REQUEST_BODY` (a 400's error object holds the
     request's headers under detailed input) now covers two routes.
   - **`api-process.ts`:** wires `createAcknowledgementService` with the
     database store and the process's log.

7. **The tables** (migration `0005_*.sql`, generated by `pnpm --filter
   @trygghverdag/server db:generate` and committed; additive):

   | Table | Change | Constraints |
   |---|---|---|
   | enum `message_kind` | + `ACKNOWLEDGED` | Equals `MESSAGE_KINDS`, in order |
   | `alerts` | + `acknowledged_by` (uuid), + `acknowledged_at` (database time) | `acknowledged_by` references `users`; both null, or both set (a check) |

   - **The value is added inside the migration's transaction**, as `0004`
     adds two. `0005` must not use it: `'ACKNOWLEDGED'` appears only in its
     `add value` statement. The same word is an `alert_state` label since
     `0003`, which `0005` does not name either. Recalled from PostgreSQL's
     documentation, not checked here; the L3 runs on PostgreSQL 15 are the
     evidence (AC17), as they are for `0004`.
   - **No check ties `ACKNOWLEDGED` to the two columns.** LOST-03's tests put
     `ACKNOWLEDGED` alerts in with nobody recorded, and the
     resumed-escalation rule will move a state back (D-112's reasoning for
     `RESOLVED`).
   - **No index.** The read is by the alert's primary key; task 6 decides
     its own.
   - **No location, no phone number, no name.** The migration changes no
     existing row; both new columns are null on them.

8. **Delivery.**
   - **The sender is unchanged.** It hands each message to the port with
     its ID, recipient and kind (D-086). The claim already skips withdrawn
     messages (LOST-03).
   - **A notice is due at once, not held behind the recipient's
     lost-contact push.** It says someone is on an alert; it stands nobody
     down. A notice that reaches a phone before that phone's lost-contact
     alert tells it of the alert, and the app shows the alert's current
     state when opened (M3). Past the port, order is not promised anyway.
   - Written by the API process, delivered by the worker's next delivery
     run, at most 10 s later: `worker.ts` runs the delivery loop every
     `WATCHDOG_INTERVAL_MS`, D-107's 10 s (D-108). No cross-process wake, as
     LOST-03 decided for stand-downs.

9. **The lock order, and every wait bounded (AR-06).**
   - **The journey's row first** (D-112), then the alert's row (the
     update), then new outbox rows, whose foreign keys take key-share locks
     on the alert's and the responders' `users` rows.
   - **It never holds an `ACTIVE` journey's row**, except in the
     milliseconds when contact came back between its read and its lock; it
     then finds `RESOLVED` and writes nothing. The watchdog's open takes only
     `ACTIVE` journeys, so the acknowledgement cannot hide a journey from it.
   - **The API pool's limits bound every wait:** 5 s for a lock, then
     55P03, a 500 and one line; a frozen holder is ended after 10 s idle
     (D-108).
   - **The worker's marks do not wait on an acknowledgement**, which only
     inserts rows. They may wait on the resolution's withdrawal, now of two
     kinds, bounded as LOST-03 says.

10. **Database time** (AR-03, SM-09). `acknowledged_at` and every notice's
    `created_at` and `next_attempt_at` are the transaction's `now()`. The
    fake store emulates `now()` with the fake clock it is given, and throws
    when asked to record an acknowledgement without one, as it throws when
    asked about silence.

11. **The log** (PRIV-07; `log.ts`, owned under D-102). `LogEvent` gains two
    closed events, and nothing free-form:

    ```ts
    | { event: 'acknowledgement_ignored'; reason: 'ALERT_RESOLVED'; alertId: string }
    | { event: 'acknowledgement_failed'; stage: 'read' | 'store'; code: string | null }
    ```

    - `createLog` writes `alertId` only as a canonical UUID, `reason` and
      `stage` only from their sets, and `code` only as a SQLSTATE.
    - No user ID is logged. A refusal (`ALERT_NOT_FOUND`,
      `ALREADY_ACKNOWLEDGED`) writes no line, as a heartbeat's refusals
      write none. An acknowledgement writes none: the alert's row is its
      record.

12. **No new dependency** (SEC-06), and **no new import route** (AR-10).
    `api.ts` and `api-process.ts` wire the new module; the module gets
    ports only. `packages/config/dependency-cruiser.cjs` is unchanged.

13. **Decisions to record** in `docs/plan/decisions.md`, with the next free
    numbers (D-113 and D-114 at the time of writing, with #64 holding D-110
    to D-112; check the open pull requests' `decisions.md` before taking
    them, as the live gotcha says):
    - **D-113** (owner): the answer to Q1;
    - **D-114** (delegated, D-031): the route, its detailed input and its
      answers; reading 1 ("a responder", any of their devices); the alert
      rule and its order; one acknowledger; no event ID; the `ACKNOWLEDGED`
      kind, due at once and not held; `WITHDRAWN_WHEN_RESOLVED`, with every
      kind placed in one withdrawal; the per-responder hold; read first,
      then the journey's row; the two columns and no state check; the module
      in `modules/alerts/`, with the `alerts` group running
      `alerts.system.test.ts`, then `acknowledgement.system.test.ts`. It
      extends D-112's resolve helper (what it withdraws, and how it holds).

### Interfaces the tests are written against (RG-02: tests first)

The implementer may refine a name only with `test-author`, and only before
the tests are written.

- **`domain/journey.ts`:**
  - `MESSAGE_KINDS` exactly `['LOST_CONTACT', 'BACK_IN_CONTACT', 'HOME',
    'ACKNOWLEDGED']`;
  - `WITHDRAWN_WHEN_RESOLVED` exactly `['LOST_CONTACT', 'ACKNOWLEDGED']`,
    `satisfies readonly MessageKind[]`;
  - `ALERT_EVENTS` exactly `['acknowledge']`;
  - `AlertForAcknowledgement`, `AcknowledgeEvent`, `alertTransition`;
  - outcomes `{ type: 'acknowledged'; state: 'ACKNOWLEDGED' }`, `{ type:
    'unchanged'; reason: 'ALREADY_YOURS' }`, and `AcknowledgeRefusal`: `{
    type: 'ignored'; reason: 'ALERT_RESOLVED' } | { type: 'refused'; reason:
    'ALERT_NOT_FOUND' | 'ALREADY_ACKNOWLEDGED' }`.
- **`ports.ts`:**
  - `AlertStore` (implemented by `databaseJourneyStore` and the fake):
    `alertForAcknowledgement(alertId)` → `AlertForAcknowledgement | null`;
    `recordAcknowledgement({ alertId, responderId })` →
    `RecordAcknowledgementResult`: `{ outcome: 'acknowledged'; messages:
    AlertMessage[] }`, or `{ outcome: 'not_recorded'; decision }` with the
    rule's other outcome, having written nothing;
  - the two `LogEvent` members.
- **`modules/alerts/acknowledgement.ts`:** `createAcknowledgementService({
  alerts, log })` → `AcknowledgementService.acknowledge({ responderId,
  alertId })` → `{ type: 'acknowledged' } | AcknowledgeRefusal`.
- **`api.ts`:** `ApiDependencies.acknowledgements: AcknowledgementService`.
- **`@trygghverdag/contracts`:** `acknowledgeAlert` (in `contract`),
  `acknowledgementRequestSchema` (`{ params: z.strictObject({ alertId }),
  body: <an empty strict object>, optional }`, `alertId` a UUID,
  lower-cased), `acknowledgementResponseSchema`, `acknowledgementErrors`,
  and the types `AcknowledgementRequest`, `AcknowledgementResponse`,
  `AcknowledgementErrorCode`.
- **The test kit** (owned, D-100):
  - `fakeJourneyStore({ clock })`:
    - `alertForAcknowledgement` and `recordAcknowledgement`, deciding by the
      same rule under its own "lock", waiting while `hold` holds the
      journey, as `recordHeartbeat` waits;
    - `failWith` and `beforeNext` for both; `JourneyStoreCall` gains both;
    - `alerts()` gains `acknowledgedBy` and `acknowledgedAt`, null until
      set, as LOST-03 added `resolvedAt` (today's tests compare stored
      alerts with `[]`, with another reading, or by picked fields, so the new
      fields break none of them);
    - `seedAlert` takes the two, optionally;
    - its resolution withdraws the kinds of `WITHDRAWN_WHEN_RESOLVED` and
      holds per responder over all of them (approach item 5);
    - it exports its copies of both withdrawal lists, so the domain test
      ties them (AC13);
    - without a clock, it throws when asked to record an acknowledgement.
  - `fakePush()`: `MessageKind` and `MESSAGE_KINDS` gain `ACKNOWLEDGED`.
  - `fakeLog()`: the two events.
  - **The shared behaviour suite:** `JourneyStoreUnderTest.store` gains
    both methods; a reader of its own, `acknowledgementsOf(journeyId)`
    (alert, who, when), keeps `AlertAsStored`'s shape; `seedAlert` gains the
    two optional fields. The names are `test-author`'s.

## Acceptance criteria

### Acknowledging (LOST-06)

**LOST-06-AC1 — A responder's "I'm on it" is recorded on the alert, and
every other responder is told: the roadmap's "recorded and shown, at
L6".** *(LOST-06, LOST-02)*
- **Given** walker W, with device D, starts journey J through the API,
  naming responders R1, R2 and R3, each a user with a device of their own,
  and D sends a heartbeat every 60 s for 10 minutes, on the fake clock
- **And** D goes silent; at five minutes the watchdog sweeps and the sender
  delivers, so the recording push fake holds one `LOST_CONTACT` message for
  each of R1, R2 and R3
- **When** a minute later R1's device sends "I'm on it" for J's alert
  through the API, the alert's ID read from the store, as M3's read will
  give it to the app
- **Then** it is answered 200 `{ "outcome": "ACKNOWLEDGED" }`
- **And** J's alert is `ACKNOWLEDGED`, acknowledged by R1 at the store's
  now; J is still `LOST_CONTACT`, with no other alert
- **And** when the sender delivers, the fake holds exactly one
  `ACKNOWLEDGED` message for R2 and one for R3, and none for R1, W or anyone
  else
- **And** later sweeps open nothing, and later deliveries send nothing more
- **And** with R1 as the journey's only responder, "I'm on it" is 200 and
  the alert `ACKNOWLEDGED`, and no `ACKNOWLEDGED` message is written
- **And** at L3 the same flow runs through the real adapter, the real
  modules and the recording push
- **And** through the API process (`api-process.ts`, over the test kit's
  fake PostgreSQL server), "I'm on it" is read and written by the database
  store, in one begin…commit that takes the journey's row for update before
  it updates the alert; and an ignored one's `acknowledgement_ignored` line
  reaches the process's own stdout.

**LOST-06-AC2 — Acknowledging records exactly the acknowledgement, and
withdraws nothing.** *(LOST-06)*
- **Given** J `LOST_CONTACT`, with responders R1, R2 and R3, its unresolved
  alert put in as `OPEN`; in another run as `ESCALATED` (nothing writes it
  before escalation to SMS); in a third as `ACKNOWLEDGED` with nobody
  recorded (nothing in the code makes one)
- **And** an older `RESOLVED` alert of J's, another journey's open alert,
  and lost-contact messages of J's alert: one accepted, one failed and due
  again, one never claimed
- **When** R1's acknowledgement is recorded
- **Then** the alert is `ACKNOWLEDGED`, with `acknowledged_by` R1 and
  `acknowledged_at` the store's now, set together
- **And** there is one `ACKNOWLEDGED` message per responder row other than
  R1, each with an ID of its own, due at that now, with no attempts, not
  sent and not withdrawn
- **And** J's state and last contact, the older alert, the other journey's
  alert, and every lost-contact message are exactly as they were: none
  withdrawn, none re-timed
- **And** at L6, R2's failing lost-contact push is retried after the
  acknowledgement, and accepted once the fake recovers: the others still
  hear of the alert.

**LOST-06-AC3 — Only a responder of the alert's journey can acknowledge it,
and nobody else learns that it exists.** *(LOST-06, SEC-07)*
- **Given** J's open alert A
- **Then** "I'm on it" for A is 404 `ALERT_NOT_FOUND`, with one and the same
  body, from the walker W's own device, from another walker, and from a
  responder of another journey only; and from R1 for an alert ID no alert
  has
- **And** with no credential, or an unknown one, it is 401 (the existing
  test that calls every route in the contract covers this one)
- **And** with an alert ID that is not a UUID, or a body holding any key,
  an `alertId` naming another alert included, it is the fixed 400, with no
  `data`
- **And** in each of these, A, its messages and J are exactly as they were,
  and no line is written
- **And** any of R1's devices can acknowledge: from R1's second device, A is
  acknowledged by R1; the same from the first device afterwards is 200 and
  changes nothing
- **And** A's ID in upper case names the same alert
- **And** no answer carries anything of the request
- **And** at L3, while another connection holds J's row, the 404s and an
  acknowledgement of a resolved alert are answered without waiting, and one
  that would record waits for the row (`pg_stat_activity`): nothing that
  refuses takes a lock.

**LOST-06-AC4 — One responder is on it, and every repeat is safe without an
event ID.** *(LOST-06, SM-08)*
- **Given** R1 has acknowledged A
- **When** R1 sends it again, its first answer lost, after the clock has
  moved on
- **Then** it is 200 `ACKNOWLEDGED`, and nothing changes: `acknowledged_at`
  keeps its first time, and no message is added
- **When** R2 sends it
- **Then** it is 409 `ALREADY_ACKNOWLEDGED`, with the fixed body and no
  `data`; nothing changes, and no line is written
- **And** the database refuses a second `ACKNOWLEDGED` message for the same
  alert and recipient (L3).

**LOST-06-AC5 — A resolved alert cannot be acknowledged, and an
acknowledgement never reaches another alert.** *(LOST-06, SM-07, SM-04,
LOST-03)*
- **Given** A resolved by a fresh heartbeat (`BACK_IN_CONTACT`); in another
  run, by "I'm home" (J `ENDED`, `HOME`)
- **When** R1 sends "I'm on it" for A
- **Then** it is 409 `ALERT_RESOLVED`; A, its resolution and its messages
  are exactly as they were; and one `acknowledgement_ignored` line names A
  and `ALERT_RESOLVED`, and nothing else
- **And** the same holds for R1's repeat when R1 had acknowledged A before
  it resolved
- **And given** J back in contact, silent again, and its second alert A2
  `OPEN`: R1's late "I'm on it" for A is 409 `ALERT_RESOLVED`, and A2 stays
  `OPEN`, with nobody recorded and no `ACKNOWLEDGED` message.

**LOST-06-AC6 — Acknowledgements that race leave one acknowledger and one
set of notices.** *(LOST-06, SM-08, SM-09)*
- **When** at least `RACERS` different responders of J acknowledge A at once,
  on separate connections, for `RACE_ROUNDS` rounds (L3), or one after
  another (L6)
- **Then** exactly one is answered as recorded and every other
  `ALREADY_ACKNOWLEDGED`, none an error; `acknowledged_by` is the one
  recorded; and there is one `ACKNOWLEDGED` message per other responder
- **When** `RACERS` copies of R1's acknowledgement arrive at once
- **Then** every one is 200, A is acknowledged once, and there is one set of
  messages.

### The messages

**LOST-06-AC7 — When an acknowledged alert resolves, its unsent notices are
withdrawn and every responder is stood down.** *(LOST-06, LOST-03, SM-04;
D-111)*
- **Given** R1 acknowledged A; R2's `ACKNOWLEDGED` message was accepted,
  R3's failed (`NO_TARGET`, due again in 10 s); in another run R3's was never
  claimed
- **When** contact comes back, by a fresh heartbeat; in another run, by "I'm
  home"
- **Then** A is `RESOLVED`, resolution `BACK_IN_CONTACT` (or `HOME`), and
  keeps `acknowledged_by` R1 and its `acknowledged_at`
- **And** R3's `ACKNOWLEDGED` message is withdrawn at the store's now,
  keeps its attempts and last failure, and is never handed to the port
  again, whatever its due time; R2's is as it was
- **And** every responder, R1 included, gets exactly one stand-down
- **And** in the fake's record, no responder is handed an `ACKNOWLEDGED`
  message after their stand-down
- **And** for any sequence of acknowledgements by any of J's responders or by
  others, heartbeats fresh or stale in any order, sweeps and "I'm home"
  (fast-check, in the shared behaviour suite: the fake at L2, the adapter at
  L3 with fewer runs), after every step:
  - an alert is `ACKNOWLEDGED` exactly when it is unresolved and someone is
    recorded on it;
  - at most one responder is ever recorded on an alert;
  - an acknowledged alert has one `ACKNOWLEDGED` message per responder
    other than the acknowledger, and an alert never acknowledged has none;
  - no `RESOLVED` alert has an `ACKNOWLEDGED` message that is neither sent
    nor withdrawn.

**LOST-06-AC8 — Resolving never writes two stand-downs for one responder,
and a stand-down never overtakes a notice in the port's hands.** *(LOST-06,
LOST-03)*
- **Given** R1 acknowledged A, and R2's phone has no push target: R2's
  `LOST_CONTACT` message and R2's `ACKNOWLEDGED` message both failed with
  `NO_TARGET` and are due again
- **When** a fresh heartbeat arrives
- **Then** it is answered 200 `RECORDED`, not 500: J is `ACTIVE`, A
  `RESOLVED`, both of R2's messages withdrawn, and R1, R2 and R3 each get
  exactly one `BACK_IN_CONTACT`
- **And** the same with "I'm home": 200 `ENDED`, and exactly one `HOME` each
- **And given** R2's lost-contact message and R2's notice each handed to the
  port and not accepted (the fake's `holdAnswers`, or failed and due later),
  R2's stand-down is due at the later of their two due times, and is not
  handed to the port before it; a responder whose messages were sent, or
  never handed over, gets it at once; no hold is longer than 60 s
- **And** at L3 the stand-down's `next_attempt_at` equals the later of the
  two due times the withdrawal returned.

**LOST-06-AC9 — The record escalation to SMS will read, on the database's
clock.** *(LOST-06, SM-09)*
- **Given** a real PostgreSQL
- **Then** `acknowledged_at` lies between two `select now()` readings taken
  before and after the call, and is never before the alert's `opened_at`
- **And** a repeat moves neither `acknowledged_by` nor `acknowledged_at`, a
  refusal touches neither, and a resolution keeps both
- **And** the module and the domain read no clock (the lint rule, L1)
- **And** at L6, acknowledged one minute after the alert opened on the fake
  clock, `acknowledged_at` minus `opened_at` is exactly 60 s: the escalation
  story's "acknowledgement at 1 minute", readable from the record.

**LOST-06-AC10 — Every message stays content-free, the notice included.**
*(LOST-06; D-086, D-087)*
- **Given** A's lost-contact messages, its `ACKNOWLEDGED` messages and its
  stand-downs
- **When** the sender delivers them
- **Then** every message the fake receives has exactly the keys
  `messageId`, `recipientId` and `kind`, and `kind` is one of
  `MESSAGE_KINDS`
- **And** every `messageId` is a UUID, distinct from every other message's,
  and equal to no user's, walker's, journey's, alert's or device's ID: not
  the acknowledger's, and not the alert's
- **And** no column of `alerts` or `outbox` holds a coordinate, an
  accuracy, a phone time, a battery level, a name or a phone number;
  `acknowledged_by` is a UUID referencing `users`; and the only columns
  named like a coordinate, in every table, are still `positions.latitude`
  and `positions.longitude` (L3, `information_schema`).

### All or nothing, and the races

**LOST-06-AC11 — The acknowledgement and its notices are one transaction.**
*(LOST-06; AR-05)*
- **Given** a real PostgreSQL, where a test-only trigger makes inserting the
  second `ACKNOWLEDGED` message fail
- **When** R1's "I'm on it" arrives through the module
- **Then** the module fails, writing one `acknowledgement_failed` line with
  stage `store` and the SQLSTATE, so the API answers 500
- **And** nothing changed: A is `OPEN`, with nobody recorded, and no
  `ACKNOWLEDGED` message exists
- **And** once the trigger is removed, the same request is 200 and does all
  of AC1's work
- **And** at L6, with the fake failing the read and then the write, each is
  a 500 with one line naming its stage; never a 2xx, never a 401; nothing
  changed.

**LOST-06-AC12 — "I'm on it" meets back in contact, "I'm home" and the
watchdog on the journey's row.** *(LOST-06, LOST-03, SM-04, SM-09)*
- **Given** a real PostgreSQL, and J `LOST_CONTACT` with its open alert A
- **When** an acknowledgement's transaction holds J's row before commit, and
  a fresh heartbeat for J arrives
- **Then** the heartbeat waits for the row (`pg_stat_activity`), then brings
  J back: A `RESOLVED`, keeping R1 as its acknowledger; the unsent
  `ACKNOWLEDGED` messages withdrawn; one `BACK_IN_CONTACT` per responder
- **When** the heartbeat's transaction holds J's row, and an acknowledgement
  past its read arrives
- **Then** the acknowledgement waits, then is 409 `ALERT_RESOLVED` and
  writes nothing
- **And** the same two orders hold with "I'm home"
- **When** an acknowledgement, a fresh heartbeat and a sweep start at the
  same moment on separate connections, for at least `RACE_ROUNDS` rounds
- **Then** every round ends in one of those two outcomes, never with an
  `ACKNOWLEDGED` message unsent and unwithdrawn on a `RESOLVED` alert,
  never with more than one alert, and with one stand-down per responder
- **And** at L6 the fake's `hold` gives the first two orders.

### The rules, the contract, the log and the database

**LOST-06-AC13 — Every message kind is withdrawn by exactly one rule,
decided in one place.** *(LOST-06, LOST-03)*
- **Then** `MESSAGE_KINDS` is exactly `LOST_CONTACT`, `BACK_IN_CONTACT`,
  `HOME`, `ACKNOWLEDGED`, in order
- **And** `WITHDRAWN_WHEN_RESOLVED` is exactly `LOST_CONTACT`,
  `ACKNOWLEDGED`; the open's list is `ALERT_RESOLUTIONS`; and every kind is
  in exactly one of the two, so a kind added later fails this test, naming
  it, until someone places it
- **And** the test kit's copies (its `MESSAGE_KINDS`, the kinds its
  resolution withdraws, the kinds its open withdraws) equal the domain's
- **And** in the shared behaviour suite, a resolution withdraws exactly its
  own alert's unsent messages of those kinds, and leaves every other message
  alone, an earlier alert's included.

**LOST-06-AC14 — Every (alert situation, event) pair has a tested
outcome.** *(LOST-06)*
- **Given** `ALERT_EVENTS` is exactly `acknowledge`
- **Then** the rule's table holds an expectation for every pair: no alert,
  and each of the four states with nobody recorded, the sender recorded and
  another recorded, from a sender who is a responder and from one who is
  not; a pair the lists create but the table lacks fails, naming the pair
- **And** for any situation and any sender (fast-check), the outcome is the
  rule's, in its order: not found, then resolved, then the sender's own,
  then taken, then acknowledged; never a throw, never `undefined`
- **And** typecheck fails if an event has no case; an event of a type the
  module does not list is thrown on; deciding changes neither the alert nor
  the event handed in
- **And** `JOURNEY_EVENTS` and the journey's transition table are unchanged.

**LOST-06-AC15 — The contract describes the route.** *(LOST-06, SEC-07;
AR-07)*
- **Given** the generated OpenAPI document
- **Then** it has `POST /alerts/{alertId}/acknowledgement` under the `/v1`
  server, with responses 200, 400, 401, 404 and 409, and requires the bearer
  scheme
- **And** its 200 body is exactly `{ "outcome": "ACKNOWLEDGED" }`
- **And** its only parameter is `alertId`, in the path, required, a UUID;
  nothing is in the query or a header; and the request schema lower-cases it
- **And** the committed `openapi.json` equals what the contract generates
- **And** the start, heartbeat and "I'm home" path items are byte-identical,
  each pinned by its sha256
- **And** `pnpm run api:diff` is run. With `packages/contracts/released/`
  empty it compares nothing, and the pull request records that as "not
  compared", never as "passed".

**LOST-06-AC16 — The new log events are closed, and nothing personal reaches
a log.** *(LOST-06, PRIV-07)*
- **Then** typecheck (L1) fails for either new event holding another field;
  a `@ts-expect-error` test holds this, a latitude and a message among the
  fields it tries
- **And** `createLog` writes each as one JSON line holding exactly its
  fields; an `alertId` that is not a canonical UUID, a `reason` or `stage`
  outside its set, and a `code` that is not a SQLSTATE are each written as
  null (L2)
- **And** when the fake store fails the read and the write with errors
  whose messages hold markers (a synthetic coordinate, a credential-like
  string and a responder's ID), nothing written to stdout, stderr or the
  console holds a marker (L6)
- **And** a 400 from the route, for a known responder's device whose
  credential is a run-time marker and a body holding a key, writes nothing
  that holds the credential (L6)
- **And** as controls, the capture sees a line written through the
  production `createLog`, and the thrown errors do hold the markers.

**LOST-06-AC17 — The database agrees, and migration `0005` changes no
existing row.** *(LOST-06)*
- **Given** a freshly migrated database
- **Then** `message_kind`'s values equal `MESSAGE_KINDS`, in order
  (`pg_enum`)
- **And** `alerts.acknowledged_by` is a UUID referencing `users`, and
  `alerts.acknowledged_at` a database time (timestamp with time zone)
- **And** the database refuses an alert with `acknowledged_by` and no
  `acknowledged_at`, or the reverse; it takes both, or neither; and it takes
  an `ACKNOWLEDGED` alert with neither
- **And** the claim's partial index still reads `(next_attempt_at, id)`
  with the predicate `sent_at IS NULL`
- **And** on PostgreSQL 15, a database at `0004` holding journeys in every
  state, alerts in every state with and without a resolution, and outbox
  messages sent, unsent and withdrawn migrates through `0005` as the pre-run
  hook runs it; every existing row is unchanged, both new columns are null
  on them, and `ACKNOWLEDGED` can be used once the migration has committed
- **And** there is exactly one committed `0005_*.sql`, in the journal, with
  no `update`, `delete` or `truncate`, which names `'ACKNOWLEDGED'` only in
  `message_kind`'s `add value` statement.

## Test plan

| AC | Level | Where | How |
|----|-------|-------|-----|
| AC1 | L6, L3, L2 | `apps/server/src/acknowledgement.system.test.ts` (new); `apps/server/src/acknowledgement.integration.test.ts` (new); `apps/server/src/api-process.test.ts` | L6: `createApi` with the journey service, the acknowledgement service, `createWatchdog` and `createPushSender` over one `fakeJourneyStore({ clock })`, with `fakePush()`, `fakeLog()`, `fakeDeviceAuthenticator()` (a device for each responder). L3: the real adapter and modules with `fakePush()`. The process test reads the SQL the fake PostgreSQL server receives. **Names LOST-02** |
| AC2 | L2, L3, L6 | behaviour suite (`fake-journey-store.test.ts`, `journeys.integration.test.ts`); system test | Alerts put in directly in each state |
| AC3 | L6, L2, L3 | system test; behaviour suite; integration test (a row held on another connection) | **Names SEC-07** |
| AC4 | L6, L2, L3 | system test; behaviour suite; integration test (the unique constraint) | **Names SM-08** |
| AC5 | L6, L2, L3 | system test; behaviour suite | Both resolutions; a second alert. **Names SM-07, SM-04, LOST-03** |
| AC6 | L3, L6, L2 | integration test (`RACERS`, `RACE_ROUNDS`); system test; behaviour suite | **Names SM-08, SM-09** |
| AC7 | L6, L2, L3 | system test (`holdAnswers`, `failFor`); behaviour suite, the property included | fast-check. **Names LOST-03, SM-04** |
| AC8 | L6, L2, L3 | system test; behaviour suite; integration test | `failFor(R2, 'NO_TARGET')`. **Names LOST-03** |
| AC9 | L3, L6, L1 | integration test; system test; lint in `gate:static` | Times bracketed by `select now()`. **Names SM-09** |
| AC10 | L6, L3 | system test; `journeys.integration.test.ts` (`information_schema`) | |
| AC11 | L3, L6 | integration test (a trigger the test creates and removes, as LOST-02's and LOST-03's do); system test (`failWith`) | |
| AC12 | L3, L6 | integration test (two connections, order forced by holding transactions open; then the same-moment rounds); system test (`hold`) | **Names LOST-03, SM-04, SM-09** |
| AC13 | L2 | `domain/journey.test.ts`; behaviour suite | |
| AC14 | L1, L2 | `tsc`; `domain/journey.test.ts` | The table over the lists; fast-check |
| AC15 | L2, L4 | `packages/contracts/src/alerts.test.ts` (new), `openapi.test.ts`; `api:diff` | L4 compares nothing while `released/` is empty. **Names SEC-07** |
| AC16 | L1, L2, L6 | `tsc`; `log.test.ts`, `fake-log.test.ts`; system test (`captured()`) | **Names PRIV-07** |
| AC17 | L3 | `journeys.integration.test.ts`; `deploy.integration.test.ts` (PostgreSQL 15) | |

### The shared behaviour suite (D-100)

The fake (L2, `fake-journey-store.test.ts`) and the adapter (L3,
`journeys.integration.test.ts`) must both pass each of these, and
`fake-journey-store.test.ts` pins the names. `test-author` may adjust the
wording, keeping the criterion and the assertions.

1. `LOST-06-AC2: alertForAcknowledgement reads the alert’s state, who is recorded on it and its journey’s responders, and null for an ID no alert has`
2. `LOST-06-AC2: recordAcknowledgement by a responder of the journey moves its unresolved alert — OPEN, ESCALATED, or ACKNOWLEDGED with nobody recorded — to ACKNOWLEDGED, acknowledged by that responder at the store’s now, and writes one ACKNOWLEDGED message per other responder row, each with an ID of its own and due at that now; the journey, its other alerts, another journey’s alert and every lost-contact message are untouched`
3. `LOST-06-AC3: recordAcknowledgement from a user who is not a responder of the alert’s journey — the walker, another walker, a responder of another journey — or for an alert ID no alert has answers ALERT_NOT_FOUND and writes nothing`
4. `LOST-06-AC4: recordAcknowledgement by the responder already recorded answers ALREADY_YOURS and writes nothing: acknowledged_at keeps its first time`
5. `LOST-06-AC4: recordAcknowledgement by another responder, when someone is recorded, answers ALREADY_ACKNOWLEDGED and writes nothing`
6. `LOST-06-AC5: recordAcknowledgement of a RESOLVED alert answers ALERT_RESOLVED and writes nothing, whatever resolved it`
7. `LOST-06-AC6: RACERS different responders acknowledging one alert at once, RACE_ROUNDS times over: exactly one is recorded and every other answers ALREADY_ACKNOWLEDGED, none an error, with one set of notices; and RACERS copies of one responder’s at once record it once`
8. `LOST-06-AC7: when contact comes back, or "I’m home" ends the journey, an ACKNOWLEDGED alert is resolved keeping who acknowledged it and when; its ACKNOWLEDGED messages not yet sent are withdrawn at the store’s now, keeping their attempts and last failure, and are never handed out again; sent ones are left as they were; every responder, the acknowledger included, gets one stand-down`
9. `LOST-06-AC7: for any sequence of acknowledgements, heartbeats fresh or stale, sweeps and "I’m home", after every step an alert is ACKNOWLEDGED exactly when it is unresolved and someone is recorded on it, nobody but one responder is ever recorded, the notices are one per other responder of an acknowledged alert, and no RESOLVED alert has an ACKNOWLEDGED message neither sent nor withdrawn`
10. `LOST-06-AC8: a responder whose lost-contact message and ACKNOWLEDGED message are both unsent when the alert resolves gets exactly one stand-down, and the resolution is not refused; held until the later of their due times when both were handed over and are due later, and due at once otherwise`
11. `LOST-06-AC13: a resolution withdraws exactly its own alert’s unsent messages of the kinds withdrawn on resolution, and leaves every other message alone`

The property (9) follows LOST-03's lesson from its review loop 1 (item 8):
its generators must draw acknowledgements that are recorded and heartbeats
that bring the journey back, and its `examples` hold one fixed sequence
that acknowledges, then resolves, so the L3 run's few runs reach both.

### Notes

- **Not used:** L5 and L7, because the app is not touched; L8 is task 8;
  L9 and L10 are not used.
- **L3 needs Docker.** It runs in CI and on the Mac, not in a cloud session.
  `gate:full` names it as not run, and the `integration` job's log is the
  evidence.
- **One behaviour, two implementations.** A fake more lenient than the
  adapter would make the L6 tests prove the fake (D-100). AC8 is the case
  where that matters most: today's fake looks each responder's withdrawn
  message up with `find`, so it would pass over an adapter that refuses the
  resolution (approach item 5).
- **Why a new L6 file, in the `alerts` group.** The module lives in
  `modules/alerts/`, whose mutants are killed only by tests the `alerts`
  group runs. `acknowledgement.system.test.ts` joins the group after
  `alerts.system.test.ts`. It is a file of its own so its setup (responders
  with devices, the acknowledgement service) stays out of the watchdog's and
  the sender's tests.
- **Test names** start with `LOST-06-ACn:`, and the files holding the
  criteria name the covered IDs the table marks.
- **Synthetic data only** (RG-07, D-089): IDs and credentials from the
  existing builders, positions from `syntheticPosition()`, markers generated
  at run time.
- **Before pushing:** run `test:coverage`, then `coverage:ratchet` (the live
  gotcha). `domain/` keeps RG-04's 95 % branch floor.
- **`docs/requirements-status.md`** is regenerated with `pnpm run
  req:coverage`: LOST-06 goes from uncovered to "spec" with this spec, and
  to covered with the tests.

### Existing assertions that change by design (RG-03)

`test-author` changes each, with the written reason RG-03 asks for in the
pull request. None loosens what a test proves; each says what this task now
does instead.

- **`apps/server/src/domain/journey.test.ts`**, "LOST-03-AC3: MESSAGE_KINDS
  is exactly LOST_CONTACT, BACK_IN_CONTACT and HOME, in order": the list
  gains `ACKNOWLEDGED`, and the title with it. Still exact.
- **`packages/test-kit/src/fake-push.test.ts`**, "records and accepts a
  message of every kind, the two stand-downs included, each exactly as given
  (LOST-03)": its exact list gains `ACKNOWLEDGED`.
- **`packages/test-kit/src/fake-journey-store.test.ts`**, "the test kit
  hands out the message kinds, in the server's order": the list gains
  `ACKNOWLEDGED`. The pinned list of behaviour names gains this task's
  behaviours, as each task's do.
- **`apps/server/src/adapters/journeys.integration.test.ts`**,
  "LOST-03-AC20: message_kind's values are exactly MESSAGE_KINDS, …": the
  literal list gains `ACKNOWLEDGED`; the assertion against the domain's list
  is unchanged.
- **The same file**, "LOST-02-AC13: alerts and outbox hold exactly the
  spec's columns, …": the `alerts` list gains `acknowledged_by` and
  `acknowledged_at`. Still exact; its scan for a coordinate, an accuracy, a
  phone time, a battery level, a name or a phone number covers both as it
  stands, and neither name matches it.
- **`apps/server/src/deploy.integration.test.ts`**, "LOST-03-AC20: a
  PostgreSQL 15 database at 0003, …, migrates through 0004 …": it runs every
  migration (`migrateDatabase`), so it would now run `0005` too. Each alert
  row would then hold two more null columns and `message_kind` a fourth
  label, and the test would fail though `0004` changed nothing. It keeps its
  point by migrating only through `0004` (a copy of the folder up to `0004`,
  as `migrationsUpTo0003()` does for LOST-02-AC23), and its count of applied
  migrations is that copy's journal's. AC17's test for `0005` is a new one.
- **`packages/contracts/src/openapi.test.ts`**, "describes the health route
  as a GET, where the contract puts it": the exact path list gains
  `/alerts/{alertId}/acknowledgement`. Its own comment asks for exactly
  this.
- **`packages/contracts/src/home.test.ts`**, "LOST-03-AC18: reportHome is in
  the contract beside health, start and heartbeat …": the exact list of the
  contract's keys gains `acknowledgeAlert`, the same set AC15 pins. Missed
  when this list was first written; `implementer` found it in the green
  phase, because no contract could pass both tests.
- **`scripts/lib/gate-decisions.test.mjs`**, the `MUTATION_GROUPS` pin: the
  `alerts` group's tests become `[alerts.system.test.ts,
  acknowledgement.system.test.ts]`, in that order.
- **`scripts/stryker-config.test.mjs`**, "LOST-02: the alerts run mutates
  modules/alerts/ and runs alerts.system.test.ts alone, under the system
  tests' configuration": the files the run's command runs are now both,
  compared sorted, because `vitest list` reports files in an order of its
  own; "alone" leaves the title. What it mutates and its configuration do
  not change.
- **Every test that builds `createApi`**, because `ApiDependencies` gains
  `acknowledgements` and a call without it no longer type-checks:
  `api.system.test.ts` (`noJourneys()`), `http.test.ts`,
  `journeys.system.test.ts`, `contact.system.test.ts`,
  `alerts.system.test.ts`, `adapters/device-credentials.integration.test.ts`,
  `adapters/journeys.integration.test.ts`, `alerts.integration.test.ts` and
  `contact.integration.test.ts`. Each gains a stand-in that rejects ("these
  tests acknowledge nothing"), as LOST-03 gave two of them a `home` stub.
  None calls the route; the test that calls every route without a
  credential gets its 401 before any handler runs. Nothing they assert
  changes.
- **Added to, not changed:** `log.test.ts`'s `EVENTS` list and
  `fake-log.test.ts` gain the two events; the behaviour suite gains its
  behaviours; `openapi.test.ts` gains a pin of the "I'm home" path item
  beside the two LOST-03 pins.

**Read and found unchanged** (2026-10-06), so nobody has to wonder:
- LOST-03's behaviour "LOST-03-AC8: a responder's stand-down waits for their
  lost-contact message …": with one kind withdrawn per responder, the
  per-responder hold is the hold it was.
- LOST-03's behaviours that put an `ACKNOWLEDGED` alert in with nobody
  recorded (LOST-03-AC4): the alert is still resolved, and both new columns
  stay null.
- "LOST-03-AC8: an open leaves an earlier alert's unsent LOST_CONTACT
  message alone": the open is unchanged.
- `contact.system.test.ts`, "LOST-03-AC9: every message the push port
  receives …": its scenario acknowledges nothing, so the kinds it sees are
  the same.
- The tests that compare `store.alerts()` with `[]`, with another reading
  (`contact.system.test.ts` line 1387), or by picked fields (line 540;
  `fake-journey-store.test.ts` line 1458, `toMatchObject`): the fake's two
  new fields break none of them.
- `domain/watchdog.test.ts`'s pin of the longest hold: unchanged, 60 s.

## Mutation (D-036, D-095, D-098, D-099)

Read in `scripts/lib/gate-decisions.mjs` on 2026-10-06.

| New or changed code | Group | Tests the group runs | Configuration |
|---|---|---|---|
| `domain/journey.ts` | `domain` | `apps/server/src/domain` | root |
| `modules/alerts/acknowledgement.ts` (new) | `alerts` | `alerts.system.test.ts`, then `acknowledgement.system.test.ts` (new) | `vitest.system.config.mjs` |
| `api-process.ts` (the wiring) | `api-process` | `api-process.test.ts` | root |

- **`MUTATION_GROUPS`' `alerts` group gains `acknowledgement.system.test.ts`.**
  Its tests become exactly `['apps/server/src/alerts.system.test.ts',
  'apps/server/src/acknowledgement.system.test.ts']`, in that order.
  `gate-decisions.mjs` is owned and in the ai-review `safety` filter
  (D-100), so no `ai-review.yml` edit is needed.
- **A group can only claim a safety path exactly as it is listed**, so the
  new file cannot have a group of its own inside `modules/alerts/`. The
  watchdog's and the sender's mutants now run two files each.
- **`api-process.ts`:** the new wiring line must be killed by
  `api-process.test.ts`. AC1's process test is the one that does.
- **Each file must reach 80 % killed on its own** (D-098). Every run is fresh
  (D-099).
- **Not mutated on a pull request:** `adapters/journeys.ts`, `db/schema.ts`
  and the migration (D-095: L3, and D-036's nightly run, which does not
  exist yet); `api.ts` (owned and safety-reviewed, D-097; proven at L6);
  `log.ts` (whether it should be is still the owner's open question from
  CI's `test-auditor` on #60).
- **Not run, because unchanged:** `journeys`, `process`, `healthchecks`.
- **Cost.** The `alerts` group's mutants run two files each. D-098 keeps the
  25-minute budget; if an honest run does not fit, the owner decides (cost).
  Read the job's log for the time it took; do not estimate.

## Modules and files affected

Owner approval and the safety filter were read on 2026-10-06 in
`.github/CODEOWNERS` and in `.github/workflows/ai-review.yml` (the `safety`
filter, lines 54–83; `scripts/lib/gate-decisions.mjs` is line 78). `OWNER_APPROVAL_PATHS` in `scripts/lib/merge-rules.mjs`
was not read here; LOST-03's spec says it lists the same paths.

| File | Change | Owner approval | Safety filter | Mutation |
|------|--------|:--:|:--:|:--:|
| `apps/server/src/domain/journey.ts` | The alert rule, `ALERT_EVENTS`, `MESSAGE_KINDS` + `ACKNOWLEDGED`, `WITHDRAWN_WHEN_RESOLVED` | **yes** | **yes** | `domain` |
| `apps/server/src/domain/*.test.ts` | L2 (test-author) | **yes** | **yes** | (its tests) |
| `apps/server/src/modules/alerts/acknowledgement.ts` (new) | The service | **yes** | **yes** | `alerts` |
| `apps/server/src/ports.ts` | `AlertStore`, its types, two `LogEvent`s | no | no | — |
| `apps/server/src/adapters/journeys.ts` | `alertForAcknowledgement`, `recordAcknowledgement` (one transaction, inline); `resolveInside` withdraws `WITHDRAWN_WHEN_RESOLVED` and holds per responder; the header comment | **yes** | **yes** | no (D-095) |
| `apps/server/src/api.ts` | The route; `ApiDependencies.acknowledgements` | **yes** (D-097) | **yes** | no |
| `apps/server/src/api-process.ts` | The wiring | **yes** | **yes** | `api-process` |
| `apps/server/src/db/schema.ts` | The two columns, their check, the reference, `message_kind`'s value | **yes** | **yes** | no |
| `apps/server/src/db/migrations/0005_*.sql`, `meta/*` | Generated with `db:generate` | **yes** | **yes** | no |
| `apps/server/src/log.ts` | Two events | **yes** (D-102) | no (D-102) | no |
| `packages/contracts/src/alerts.ts` (new), `contract.ts`, `index.ts`, `openapi.json` | The route; `openapi.json` regenerated with `api:spec` | no (D-094) | **yes** | — |
| `packages/contracts/src/alerts.test.ts` (new), `openapi.test.ts` | L2 (test-author) | no | **yes** | — |
| `packages/test-kit/src/` (the store, the behaviour suite, `fakePush`, `fakeLog`, their tests, `index.ts`) | Fakes (test-author) | **yes** (D-100) | **yes** | input (D-098) |
| `scripts/lib/gate-decisions.mjs` | The `alerts` group's tests | **yes** | **yes** | input (D-098) |
| `scripts/lib/gate-decisions.test.mjs`, `scripts/stryker-config.test.mjs` | The group's pins (test-author) | **yes** | no | — |
| `apps/server/src/acknowledgement.system.test.ts` (new) | L6 (test-author) | no | no | the `alerts` group's tests |
| `apps/server/src/api-process.test.ts` | AC1's process test (test-author) | no | no | the `api-process` group's tests |
| `apps/server/src/acknowledgement.integration.test.ts` (new); `adapters/journeys.integration.test.ts`, `deploy.integration.test.ts` | L3 (test-author) | no | no | — |
| The other `createApi` call sites, `log.test.ts` | The stand-in; L2 (test-author) | no | no | groups' tests |
| `coverage-baseline.json` | Entries for `packages/contracts/src/alerts.ts` and `modules/alerts/acknowledgement.ts`, by hand, at their measured values (not `--update`) | **yes** | no | — |
| `docs/plan/decisions.md` | D-113 and D-114 (approach item 13) | **yes** | no | — |
| `docs/plan/README.md` | "Open for M4": `acknowledged_by`, `acknowledged_at` and the notices are alert records | no | no | — |
| `docs/requirements-status.md` | Regenerated | no | no | — |
| `docs/progress.md`, `docs/progress/m2.md` | Status (plan-keeper) | no | no | — |

- **`.github/workflows/ai-review.yml` is not edited.** CI's AI reviewers can
  run, and no hand merge is needed (D-075).
- **Expected unchanged:** `.github/`, `scripts/lib/merge-rules.mjs`;
  `modules/journeys/`, `modules/health/`, `modules/alerts/watchdog.ts` and
  `outbox.ts`; `worker.ts`, `http.ts`; `adapters/db.ts`, `clock.ts`,
  `device-credentials.ts`, `migrations.ts`, `worker-heartbeats.ts`,
  `healthchecks.ts`; `domain/watchdog.ts`; `packages/config/`;
  `stryker.config.mjs` and the Vitest configurations; `infra/` and
  `apps/mobile/`.
- **Reviewers.** `safety-reviewer` runs (the filter matches `domain/`,
  `modules/alerts/`, the adapter, the schema, the migration, `api.ts`,
  `api-process.ts`, the contracts, the test kit and `gate-decisions.mjs`).
  `privacy-security-reviewer` and `test-auditor` always run.

## Contract changes

**One route, additive.** `packages/contracts/released/` is empty, so nothing
on a phone can break, and nothing is added there: that is
`release-engineer`'s alone. The shape can still change before the first app
release (M3) at no compatibility cost.

- **New:** `POST /v1/alerts/{alertId}/acknowledgement` (contract path
  `/alerts/{alertId}/acknowledgement`, route `acknowledgeAlert`), with the
  answers of approach item 6 and its detailed input. Its description says:
  it needs a device credential; only a responder of the alert's journey may
  acknowledge it; a 200 means the caller is the one on it; 409
  `ALREADY_ACKNOWLEDGED` means another responder is; 409 `ALERT_RESOLVED`
  means the alert is over.
- **Unchanged:** `/v1/health`, `POST /v1/journeys`, `POST /v1/heartbeats`
  and `POST /v1/journeys/{journeyId}/home`, each pinned by its sha256.
- **`openapi.json` is regenerated with the code** (`pnpm run api:spec`), not
  by hand.
- **How the app will know an alert's ID is M3's.** The push carries only
  its own opaque message ID (D-086, D-087). M3's read or list of a
  responder's alerts (D-106) hands the app the alert's ID. If M3 chooses to
  address alerts another way, this route can change before the first release
  at no cost.

## Risks and failure modes

- **[F6](../plan/03-safety-reliability-security.md#failure-modes), the
  missed alert.** This task is F6's acknowledgement. Its new dangers, and
  what holds each:
  - **An acknowledgement that silences the wrong alert.** From task 6 an
    acknowledgement stops the SMS. The route names one alert, and a resolved
    alert refuses it (AC5), so a late or retried acknowledgement can never
    silence a later alert.
  - **A false "someone is on it".** A notice withdrawn when its alert
    resolves (AC7) can never reach a responder during a later alert. The
    invariant that no resolved alert keeps an unsent notice is a property at
    L2 and L3 (AC7) and a race at L3 (AC12).
  - **Back in contact refused for ever** (approach item 5). Without the
    per-responder hold, one responder with no push target turns every
    heartbeat of the journey into a 500, and the alert never resolves. AC8,
    in the shared suite.
  - **Acknowledged, then nothing.** One acknowledgement stops the SMS for
    everyone (task 6), as the plan decides (D-019, the escalation story). A
    responder who taps "I'm on it" and then does nothing leaves the others
    with only the critical push they already had and the notice that names
    who is on it. The backstops are the 24-hour rule (task 7) and M6's
    tuning. Not changed here; the owner may revisit it.
  - **An acknowledgement withdraws nothing** (AC2): the other responders'
    critical pushes still reach our push port.
  - **At Apple, the notice can replace a critical push not yet delivered**
    (`safety-reviewer`; D-113's amendment, the owner, 2026-10-07). APNs
    stores one notification per app for an offline device, "in most cases
    the latest". A responder offline when their critical push is accepted
    could come back online to the non-critical notice instead, which does
    not break through silent mode; from task 6, no SMS follows if someone
    acknowledged. Sending the notice at once is still the safer order: a
    notice sent before a responder's critical push is, in most cases,
    replaced by it. Apple promises neither that ("in most cases", and not
    always when several are stored in a short time) nor the order ("APNs may
    reorder notifications"), and the reverse order is realistic: a critical
    push waiting on a retry when someone taps. Google's page on collapsible
    messages suggests the same on Android (an inference, not tested). Not
    live in M2, which sends no real pushes. M3's push task does not send the
    notice on either platform until an L9 test on a real phone of each shows
    it never displaces an undelivered critical alert, in either order
    (D-087's list; `critical-alerts-request.md`, Part E, item 6).
- **[F10](../plan/03-safety-reliability-security.md#failure-modes) and the
  abusive-member threat, on the responder's side.** Someone with a
  responder's unlocked phone, or a responder who means harm, can tap "I'm on
  it" and, from task 6, stop the SMS to everyone. F10 names only the
  walker's phone; this is its counterpart, and the threat model protects
  "the ability to … silence alerts". What limits it: only a responder of the
  journey, with a per-device credential (SEC-07), can; the walker picks the
  responders for each journey; and every other responder's critical push
  still reaches our push port, with a notice that someone is on it (at the
  provider, see F6 and D-113's amendment; who it is, M3 reads). **Not covered**, and stated: like
  F10, a known limitation for the owner to see.
- **[F7](../plan/03-safety-reliability-security.md#failure-modes), the
  watchdog.** Unchanged in code. The acknowledgement takes the journey's row
  only for an unresolved alert, whose journey is `LOST_CONTACT`, which the
  watchdog never opens (approach item 9). A responder repeating requests
  holds that row for milliseconds each; the waits are bounded (5 s, 10 s
  idle). A request-rate limit is the go-live item LOST-01's reviews raised.
- **[F8](../plan/03-safety-reliability-security.md#failure-modes), a bad
  release.** The L6 flows run on every pull request under the `alerts`
  mutation group, and L3 in CI. The canary does not acknowledge.
- **[F2](../plan/03-safety-reliability-security.md#failure-modes), false
  alarms.** No change to when an alert opens. Each acknowledgement adds one
  non-critical notice per other responder.
- **[F1](../plan/03-safety-reliability-security.md#failure-modes),
  [F3](../plan/03-safety-reliability-security.md#failure-modes),
  [F4](../plan/03-safety-reliability-security.md#failure-modes),
  [F5](../plan/03-safety-reliability-security.md#failure-modes) and
  [F9](../plan/03-safety-reliability-security.md#failure-modes):** not
  touched.
- **The fake can drift from the adapter.** The shared behaviour suite holds
  them together (AC2 to AC8, AC13).
- **Two times out of order.** `acknowledged_at` and `resolved_at` are each
  their transaction's `now()`, its start. When an acknowledgement and a
  resolution meet on the row, the later to commit can carry the earlier
  time, by up to the wait (at most 5 s). Nothing decides on their order;
  M3's read should show the state, not sort by these times.
- **Personal data in new columns.** `acknowledged_by` links a responder to
  an alert: who helped whom, and when. It is an alert record under the
  retention rule (30 days, M4). It references `users`, so deleting a member
  who acknowledged an alert still kept must deal with it first, as LOST-02
  found for outbox rows. No location, no phone number, no name.
- **The alert's ID in a URL.** It reaches the platform's access logs, as
  the journey's ID does in the "I'm home" route: an opaque ID, no location
  and no phone number (PRIV-07).
- **Adding an enum value inside the migration's transaction** (approach
  item 7). Recalled, not checked here. If PostgreSQL refused it, the
  deploy's pre-run hook would fail and `deploy-staging` would go red:
  loud, and the old version keeps running.
- **A coverage report that reads as done.** LOST-06 shows as covered while
  the halves under "How this spec names requirements" remain.

### Flags from other decisions, checked

- **D-086:** every message stays content-free, of every kind (AC10). Who is
  on it comes from the app's read (D-106).
- **D-087:** only the lost-contact alert uses the critical level. The notice
  never does; M3's adapter maps the level from the kind, and D-087's owed
  test "over every outbox message type" now has four types to cover.
- **D-091:** the route creates no credential. Before the login task only
  tests, and on staging only the canary, can hold one.
- **D-101:** about the walking phone; reading 1 says why any of a
  responder's devices may acknowledge.
- **D-103:** no event ID (reading 9).
- **D-106:** no read route here.
- **D-108:** the outbox stays our own table; retries unchanged.
- **D-111, D-112:** every responder is still stood down; the resolve helper
  withdraws one more kind and holds per responder; the lock order holds.
- **D-014:** no text is sent; the app's words come in M3, bokmål first.

## Out of scope

- **Escalation to SMS**, and stopping it (task 6). This task writes the
  record it reads.
- **"They're safe"** (task 7), and the resumed-escalation rule (task 6).
- **What the responders see:** who is on it by name, and the words, in
  bokmål first; the alert screen and its "I'm on it" button (M3, D-106,
  D-014). The notice's notification level and the real push adapter (M3,
  D-087).
- **Responder credentials** (the login task, M3), and **responder setup**.
- **Taking back an acknowledgement**, or handing it to another responder:
  in no story.
- **Telling the walker** that someone is on it: in no story. "They're safe"
  tells the walker who closed the alert, on reconnect.
- **A read route** (D-106).
- **Retention** of acknowledgements and notices (the retention rule, M4),
  and the DPIA.

### Left for later tasks

Each is named here so the task that owns it finds it. None blocks this task.

- **Task 6 (escalation to SMS, the resumed-escalation rule):**
  - read this record as "What escalation to SMS (task 6) will read" says,
    meeting the acknowledgement on the journey's row;
  - add the withdrawal of the alert's unsent SMS to the acknowledgement's
    write (approach item 4, step 4), and place every new kind in
    `WITHDRAWN_WHEN_RESOLVED` or the open's list, which AC13 makes a
    decision;
  - the resumed-escalation rule clears `acknowledged_by` and
    `acknowledged_at` and moves the state back, which D-033's alert states
    do not draw ("Where the plan disagrees with itself"). A second
    acknowledgement of the same alert then meets the outbox's unique
    (alert, recipient, kind) for every recipient already told: re-arm the
    row, or a notice kind of its own. AC4's "the database refuses a second
    `ACKNOWLEDGED` message" is the test that changes then;
  - once a responder can be removed, the store answers `ALERT_NOT_FOUND`
    under the lock (approach item 4, step 3), and that branch gets its test;
  - **the open's withdrawal list is `ALERT_RESOLUTIONS`, an enum of
    resolutions** (`code-reviewer`). An SMS stand-down that is not a
    resolution can't join it without becoming an `alert_resolution` value,
    so task 6 needs a domain list of its own (the fake already calls it
    `WITHDRAWN_WHEN_OPENED`), with `openInside` and AC13's test changed to
    match;
  - **the stand-down's hold sees only what the resolution withdraws.** An
    SMS the acknowledgement withdrew earlier (step 4), still in a port's
    hands, would not hold a later stand-down; task 6 decides whether that
    matters (`code-reviewer`);
  - with a second alert event (`escalate`), `alertTransition` takes a
    general alert situation and event, and returns to a `switch` with a
    `never` default;
  - `ACKNOWLEDGED` is now a label of both `alert_state` and `message_kind`.
    Renaming the kind would need the owner (D-113), and is cheap only before
    the first release. Task 6's SMS insert should use `resolveInside`'s
    typed kind cast, not a hard-coded literal as the notice insert has.
- **Task 7 ("They're safe"):** check `acknowledged_by` under the journey's
  lock (only the acknowledger may close); resolve through the resolve
  helper, which then withdraws unsent notices too.
- **Task 8 (the canary):** no change needed. If it ever acknowledges, its
  responder needs a credential (D-091).
- **M3, the push task, before the notice is pushed at all** (D-113's
  amendment, the owner, 2026-10-07, both platforms): an L9 test on a real phone of each platform (an iPhone, and an Android phone) that a
  non-critical push sent while an alert is open never displaces an
  undelivered critical one, in either order (the critical push accepted
  first, and the notice accepted seconds before it). Candidates: on iOS,
  `apns-expiration` 0; on Android, a critical message the notice cannot
  collapse. Until it passes on a platform, the notice is off there by
  default, and the app shows the acknowledgement when opened. Note that
  D-087's opaque, per-message collapse ID, if used as FCM's `collapse_key`,
  meets FCM's limit of four collapse keys per device.
- **M3:** how the app learns the alert's ID (the read or a list of a
  responder's alerts, D-106); the "I'm on it" button and the alert screen,
  showing the alert's current state on open; the name of who is on it; the
  notice's non-critical level (D-087); the L7 flow "responder acknowledges";
  whether the claim takes alerts before notices and stand-downs.
- **M4:** retention of `acknowledged_by`, `acknowledged_at` and the notices
  (alert records); deleting a member who acknowledged a kept alert.
- **Go-live:** request-rate limits on the device routes (LOST-01's reviews).
- **M6:** whether an acknowledgement nobody follows up should ever escalate
  again (owner).

## Settled by the plan, so not asked

- **A responder of the journey acknowledges** (LOST-06; "They're safe"; the
  resumed-escalation rule).
- **One acknowledger per alert** (reading 4).
- **`OPEN` and `ESCALATED` can be acknowledged, to `ACKNOWLEDGED`** (D-033,
  the alert states).
- **One acknowledgement stops the SMS for everyone** (the acknowledgement
  rule, D-019, the escalation story).
- **Push is content-free** (D-086); **only the lost-contact alert is
  critical** (D-087).
- **The state change and every message it causes in one transaction**
  (AR-05); **the journey's row first** (D-112).
- **Events after `ENDED` are ignored and logged without location** (SM-07).
- **Every event safe to receive twice; an event ID only where there is no
  natural key** (D-103).

## Where the plan disagrees with itself

Said here rather than chosen silently.

1. **D-033's alert states have no way back from `ACKNOWLEDGED`, and the
   resumed-escalation rule, also binding under D-033, needs one** ("goes back
   to unacknowledged"). Task 6 settles it. This task's rule is written so
   that an alert moved back, with nobody recorded, can be acknowledged
   again.
2. **D-033's alert states draw no edge from `ESCALATED` (or `ACKNOWLEDGED`)
   straight to `RESOLVED`**; only `OPEN` "can also go straight to …
   `RESOLVED`". Contact coming back after an SMS, or after an
   acknowledgement, needs it, and D-112 already resolves an alert "whatever
   its state". Not new here; this task relies on it (AC7).
3. **The roadmap asks for an answer "shown" at L6, and D-106 puts the alert's
   read in M3.** Q1.
4. **LOST-06 says other responders see "that someone" is handling it; the
   alert states say they "see who is on it".** The record keeps who, so
   either reading is met once M3 reads it. Not asked.

No other contradiction with a decision was found: D-091, D-100, D-101,
D-103, D-106, D-108 and D-110 to D-112 were each read against this design.

## Questions for the owner

### Q1 — In M2, how are the other responders shown that someone is on it?

**Why it is asked.** The roadmap's "done when" is "a responder's answer is
recorded and shown, at L6", and L6 runs through the real API with recording
fakes for push and SMS. You decided (D-106) that the route that reads an
alert comes with the alert screen in M3, so no responder can read anything
in M2. What remains is whether the other responders get a notification now.
What a responder's phone does at night is a safety choice, so it is yours.

**Options:**
- **(a) Record it on the alert, and tell every other responder now.** One
  content-free push of a new kind, "someone is on it", to every responder
  but the one who tapped, written with the acknowledgement. It is never at
  the critical level (D-087), and who it is, by name, is read by the app in
  M3. Like the unsent lost-contact pushes (D-111), a notice not yet sent
  when the alert resolves is withdrawn, so nobody hears "someone is on it"
  after the all-clear, or during a later alert. L6 shows it through the
  recording push fake.
- **(b) Record it only.** The alert stores who and when, and M3's alert
  screen shows it. Nobody is told until someone opens the app. L6 can show
  the record and the answer to the person who tapped, but nothing reaches
  the other responders, so the roadmap's "shown" would need rewording (a
  change to D-090's tasks goes back to you).
- **(c) As (a), and tell the walker too.** No story asks for it: "They're
  safe" tells the walker who closed the alert once the phone reconnects, and
  a phone that has lost contact cannot be told anything now.

**The owner's answer (2026-10-06): (a), the recommendation (D-113).**

**Recommendation: (a).**
- The story's point is that the others know someone is handling it, so
  that each does not assume someone else will call. A responder who has seen
  the critical alert and not yet opened the app learns it only from a
  notification.
- It costs nothing: push is free, and the notice is not critical, so it
  does not break through silent mode. (At our push port. At Apple, the
  review found it can replace an undelivered critical push; D-113's
  amendment gates it in M3.)
- It meets the roadmap at L6 as written.
- (b) leaves a responder who saw the alert unsure, which is the effect the
  story exists to reduce. (c) adds a story nobody asked for.

**If Q1 is answered otherwise:**
- **(b):** the `ACKNOWLEDGED` kind, the notices and everything about them
  go: AC1's and AC2's notice clauses, AC4's unique-constraint clause, AC7,
  AC8, AC10's notice, AC12's notice clauses, AC13's new kind and its list,
  and AC17's enum value. The resolve helper is then unchanged. The roadmap's
  row 5 needs rewording first.
- **(c):** AC1's "none for W" becomes "one for W", and AC7's withdrawal
  covers W's notice too.
