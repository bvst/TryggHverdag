# LOST-08 · "They're safe": the acknowledging responder closes the alert and the journey ends; the 24-hour end; the two-hour stop never ends a lost-contact journey

**Milestone:** M2, task 8 of 9 (D-090; D-115 added task 7) · **Delivers:**
LOST-08, SM-06 and SM-05, their server half: a route for "They're safe", the
24-hour end in the watchdog's sweep, and SM-05's guard · **Decisions:** D-019,
D-021, D-031, D-033, D-034, D-036, D-074, D-086, D-087, D-090, D-091, D-095,
D-097, D-098, D-099, D-100, D-102, D-103, D-106, D-108, D-110 to D-117,
D-122 to D-124 · **Written:** 2026-10-09 by `planner`, for
`claude/busy-faraday-40n2zl`, which the coordinating session says is at
`1ee2079`, level with `main`'s `f4ded6d` plus SM-10's merge record. This
session had no shell: the branch and commit were not checked, `pnpm run
decision` and `req:coverage` were not run, and the open pull requests'
`decisions.md` could not be read. The decisions were read in
`docs/plan/decisions.md` itself, whose last heading here is D-124 ·
**Status:** Spec, settled. The owner answered Q1 and Q2 on 2026-10-09 with
the recommended answer each time, (a) (D-125); the delegated choices are
D-126. The coordinating session checked on settling: the open pull requests
take no decision number (only Dependabot's #62 is open), and D-090's item 7
reads "LOST-08 — 'They're safe'; SM-06; SM-05". The criteria stand as
written.

## Requirement

### The story and the rules this task delivers

**LOST-08** (`docs/plan/01b-mvp-scope.md`, LOST section, 8th story; Must,
D-034):

> As the responder who tapped "I'm on it", I can close a lost-contact alert
> once I know the walker is safe.
> - Only the responder who acknowledged can close the alert.
> - Closing ends the journey (SM-06) and tells the other responders who closed
>   it.
> - If the walker's phone reconnects later, the walker sees that the journey
>   was closed by that responder.

**SM-06** (`docs/plan/05-architecture.md`, edge-case rules, 6th row; binding
under D-033). Quoted with one ID replaced by its name, for the reason under
"How this spec names requirements":

> A LOST_CONTACT journey ends when the phone reconnects and the walker ends it,
> or when the acknowledging responder closes it (LOST-08, D-034), or
> automatically 24 hours after the alert opened, with responders told.
> Retention ([the retention rule]) counts from the end.

**SM-05** (same table, 5th row; binding under D-033), quoted the same way:

> The 2-hour automatic stop ([the two-hour story]) **never** ends a journey
> that is in LOST_CONTACT. Safety comes before tidiness.

**D-034** (the owner, 2026-09-20): "The responder who tapped 'I'm on it' can
close a lost-contact alert ('They're safe'). This ends the journey and
informs the other responders. Amends D-012 (MVP scope) and completes SM-06
(D-033)."

### The owner's scope (D-090, and the roadmap)

D-090, item 7 (the owner, 2026-10-01; task 8 since D-115): "**LOST-08 —
'They're safe';** SM-06; SM-05."

`docs/plan/10-roadmap.md`, "M2 — Core safety loop in detail", row 8:

> | 8 | LOST-08 | "They're safe" (SM-06, SM-05) | The acknowledging responder
> closes the alert, the journey ends and the others are told; the 2-hour stop
> never ends a lost-contact journey; both at L6 |

L6 is "Complete flows through the real API with recording fakes for push and
SMS and a controlled clock: LOST-02, LOST-07, SM rules"
(`06-testing-strategy.md`, the levels table).

### How this spec reads its scope

1. **The 24-hour end is in this task.** The roadmap's "done when" names only
   the close and SM-05, but D-090 gives this task SM-06 whole, and the owner's
   D-122 item 3 says an unheard alert lasts "until contact comes back, 'I'm
   home', or SM-06's 24-hour rule (task 8) resolves it". SM-10's spec reads it
   the same way. So the 24-hour end is built and tested here, at L6 like the
   rest (Where the plan disagrees with itself, item 1).
2. **SM-06's first clause is already built.** "The phone reconnects and the
   walker ends it" is the "I'm home" route on a `LOST_CONTACT` journey
   (LOST-03, SM-04, D-110). No test names SM-06 yet (`requirements-status.md`:
   0), so this task adds one L6 test that names it (AC13). Nothing about that
   path changes.
3. **SM-05 names a stop that does not exist in M2.** The two-hour story
   (journeys never run forever: ask the walker at two hours, end after ten
   minutes with no answer) is M3's, with the app (roadmap M3 row). Nothing in
   the server ends a journey automatically today: `JOURNEY_END_REASONS` is
   `['HOME']`. How SM-05 is delivered "at L6" with no stop to test is **Q1**.
4. **"The walker sees"** is a screen in M3. Its server half is that what the
   walker's app will need is recorded: the journey's end, how, when, and who
   closed it. Whether the walker is also told now, by push, is **Q2**.

### What the plan fixed around it

- **D-114** (delegated): "A responder" is a user with a row in
  `journey_responders` for the alert's journey, from any of their devices; the
  alert is named by its ID, never "the journey's current alert"; one 404
  `ALERT_NOT_FOUND` for no such alert and for an alert of a journey the caller
  does not follow, the walker included; "the journey's row first".
- **D-111** (owner): when an alert resolves, its unsent lost-contact messages
  are withdrawn and every responder gets one stand-down. **D-113** (owner):
  unsent notices are withdrawn with them. **D-116** (delegated): unsent SMS
  too (`WITHDRAWN_WHEN_RESOLVED`).
- **D-115, item 5** (owner): "No stand-down SMS. When an escalated alert
  resolves, responders get the push stand-down as today, and unsent
  escalation SMS are withdrawn."
- **D-086 and D-087** (owner): every push is content-free (message ID,
  recipient, kind); only the lost-contact alert is critical.
- **D-106:** the route that reads an alert, and with it the name of who did
  what, is M3's.
- **D-110 and D-112:** the "I'm home" route's shape (detailed input, an empty
  body, the fixed 400), its end time `ended_at` at the database's `now()`,
  and "a 200 and a 409 both mean the journey is over". The resolve helper,
  `resolveInside`, is the one path that resolves an alert.
- **D-122 and D-123** (SM-10): a reset clears `acknowledged_by`; a resolved
  alert keeps who acknowledged it; the walker's warning is a journey's message;
  an unheard alert pages through the SMS check until something resolves it.
- **AR-03 to AR-06, AR-11** (`05-architecture.md`): no clock in domain or
  module code; every transition in one module, decided under the lock; a
  change and its messages in one transaction; a lock-safe watchdog; privacy by
  construction.

### What earlier tasks left for this one

| Left for task 8 | Where it was left | Where it is met |
|---|---|---|
| Only the current acknowledger may close; after a reset nobody can until someone acknowledges again; read `acknowledged_by` under the journey's lock | SM-10's spec; `progress/m2.md`; LOST-06's spec ("task 7") | Approach items 2 and 4; AC2, AC3, AC4 |
| The 24-hour rule resolves an unheard alert, which clears the SMS check's page | SM-10's spec; D-122 item 3 | Approach item 6; AC9 |
| Decide the mutation budget question first | SM-10's spec | Mutation, below: settled without the owner (D-124 left 11 to 13 minutes) |
| Resolve through `resolveInside`, which then withdraws unsent SMS and notices too; a closed alert is never escalated | LOST-07's and LOST-06's specs | Approach items 4 and 6; AC1, AC5, AC7 |
| Resolutions and end reasons of their own | LOST-03's spec ("task 7") | Approach item 3 |
| The start that races an end: retry the insert once, as `insertStarted`'s comment says | LOST-03's spec; `adapters/journeys.ts`, lines 951 to 957 | Approach item 9; AC21 |

`docs/progress/m2.md`'s "Left for later tasks" for SM-10 (lines 2511 to
2518) was read; its task 8 items are in the table.

### What exists today, and what does not

Read on 2026-10-09, in the files themselves:

- **No route closes an alert.** The contract (`packages/contracts/src/contract.ts`)
  holds `health`, `startJourney`, `recordHeartbeat`, `reportHome`,
  `acknowledgeAlert`.
- **The alert rule** (`alertTransition`, `domain/journey.ts`) has three events:
  `acknowledge`, `escalate`, `acknowledger_removed`. **The journey rule**
  (`transition`) has six: `start`, `heartbeat`, `silence`, `contact`, `home`,
  `remove`.
- **`ALERT_RESOLUTIONS`** is `BACK_IN_CONTACT`, `HOME`; **`JOURNEY_END_REASONS`**
  is `HOME`; **`MESSAGE_KINDS`** ends with `NO_RESPONDER`.
- **`resolveInside`** (`adapters/journeys.ts`, lines 656 to 696) resolves the
  journey's one unresolved alert, withdraws its unsent
  `WITHDRAWN_WHEN_RESOLVED` kinds and writes one stand-down per responder row,
  every row, held per responder behind any withdrawn message still in a
  port's hands.
- **Nothing ends a journey but "I'm home".** No sweep reads an alert's age
  past its escalation. An alert nobody resolves stays open for ever, and an
  unheard one pages each minute for ever.
- **The sweep's result** (`SweepResult`: `ok`, `opened`, `escalated`,
  `stuck`) is pinned whole by 54 assertions in five test files.
- **Migrations** `0000` to `0007`. **Log:** 21 closed events.

### How this spec names requirements, and why

The `traceability` job runs `req:coverage --fail-on-uncovered-changed`. It
fails when a changed spec names a tracked requirement, or a criterion in the
form ID, "-AC", number, that no test names; `mentions` matches an ID anywhere
in a file, comments included (BUG-16). It was not run here.

- **Delivered here, and must be named by a test:** LOST-08, SM-05, SM-06.
- **SM-05 and SM-06 are delivered as LOST-08 criteria**, whose test files
  name them too, as SM-10's spec delivered SM-02's last-responder half: one
  numbering per spec file. AC12 carries SM-05; AC8 to AC13 carry SM-06.
- **Cited, already covered, and not claimed:** LOST-01, LOST-02, LOST-03,
  LOST-06, LOST-07, REL-01, REL-07, REL-08, SEC-07, PRIV-07, SM-01, SM-02,
  SM-04, SM-07, SM-08, SM-09, SM-10 (each 🟢 in `requirements-status.md`,
  read 2026-10-09). Some criteria strengthen them, and their tests name them
  (test plan).
- **Untracked, named freely:** AR-, D-, F-, RG-, INF-, BUG-, A-, HK-, CI- and
  L- IDs (D-074).
- **Every other tracked requirement is named in words**, here, in product
  code and in its comments:

| Name used here | Where it lives |
|---|---|
| the two-hour story, the two-hour stop | `01b-mvp-scope.md`, JRN section, 6th story (M3) |
| the start-and-end notifications story | JRN section, 4th story (M3) |
| the "I'm home" story | JRN section, 5th story (M3) |
| the remove-a-member rule | GRP section, 1st story, third bullet (M3) |
| guidance for responders | HELP section, 1st story (M3) |
| the abusive-member threat | `03-safety-reliability-security.md`, threat model, 2nd row |
| the force-quit reminder, the alert-level rule, the canary rule | same file, reliability table, 4th, 6th and 10th rows |
| the responders-only rule, the retention rule, the DPIA rule | `02-norway-law-privacy.md`, privacy table, 3rd, 4th and 11th rows |

**Partial delivery shows as full.** Once tests name them, LOST-08, SM-05 and
SM-06 show as covered. These halves remain, and "Out of scope" lists each:
the app's "They're safe" button and its confirmation (M3); the walker's
screen after a close (M3); the words of the new messages (M3, D-014); the
two-hour stop itself, and SM-05's test against it (M3, Q1).

## Approach (technical choices delegated to Claude, D-031)

1. **Where the code goes, and why there.**
   - **The rules:** `domain/journey.ts` gains an alert event, `close`, with
     its rule; a journey event, `expire`, with its rule; two resolutions and
     two kinds, `SAFE` and `EXPIRED`; two end reasons of the same names; the
     constant `ALERT_EXPIRES_AFTER_MS`. AR-04 keeps every transition in one
     module. Owned, in the safety filter, mutated (`domain`).
   - **"They're safe":** `modules/alerts/closure.ts` (new), written as
     `acknowledgement.ts` is, because a close is an alert's event named by
     the alert's ID. Owned, filtered, mutated in the `alerts` group.
   - **The 24-hour end:** `modules/alerts/expiry.ts` (new), run by the
     watchdog's sweep after the escalation, written as `escalation.ts` is.
     Same folder, same group. `watchdog.ts` calls it.
   - **The SQL:** `adapters/journeys.ts`: the close's read and transaction,
     the expiry's read and transaction, `resolveInside` taking a recipient to
     leave out, and `insertStarted`'s one retry (item 9). Owned and filtered;
     proven at L3 (D-095).
   - **The route:** `packages/contracts/src/alerts.ts` and `contract.ts`;
     `api.ts` (owned, D-097) and `api-process.ts` (owned, D-094) wire the
     service as they wire "I'm on it".
   - **Unchanged:** `worker.ts` and `bin/worker.ts` (`createWatchdog` builds
     the expiry inside, as it builds the escalation), `modules/journeys/`,
     `outbox.ts`, `sms-check.ts`, `acknowledgement.ts`, `escalation.ts`,
     `adapters/db.ts`, `healthchecks.ts`, `config.ts`, Terraform, the
     workflows.

2. **The close rule** (`alertTransition`, a fourth alert event). Its
   situation is `AlertForClosure { id, state, acknowledgedBy, responderIds }`,
   the same read as "I'm on it"'s, and its event is
   `CloseEvent { type: 'close', responderId }`. In its order:
   1. no alert, or the sender not among `responderIds` → refused,
      `ALERT_NOT_FOUND`: one answer for both, the walker included (D-114);
   2. `RESOLVED` → ignored, `ALERT_RESOLVED`, whatever resolved it, the
      sender's own earlier close included;
   3. not (`state` is `ACKNOWLEDGED` **and** `acknowledgedBy` is the sender)
      → refused, `NOT_THE_ACKNOWLEDGER`;
   4. otherwise → `{ type: 'closed', state: 'RESOLVED', resolution: 'SAFE',
      journey: 'ENDED' }`.
   - **Both halves are read, the other way round from the escalation.** The
     escalation sends the SMS on a missing half (D-114, D-116), because
     sending is the safe direction there. Here closing silences everyone, so
     a missing half refuses: an `OPEN` or `ESCALATED` alert with the sender
     recorded (put in directly), or an `ACKNOWLEDGED` one with nobody, cannot
     be closed.
   - **After a reset** (SM-10) `acknowledgedBy` is null, so step 3 refuses
     everyone until someone acknowledges again; the removed responder is no
     longer among `responderIds`, so step 1 refuses them first.
   - **A repeat is a 409**, as "I'm home"'s is (D-110, D-112: "a 200 and a 409
     both mean the journey is over"), not a second 200 as "I'm on it"'s is.
     So the rule needs no record of who closed beyond what exists (item 3),
     and has one branch fewer. Safe twice with no event ID (D-103's reading):
     the second finds the alert resolved and writes nothing.
   - IDs compared exactly; pure, total, no clock.

3. **Who closed it, and how a journey ended** (the story's third bullet,
   server half).
   - `ALERT_RESOLUTIONS` gains `SAFE` and `EXPIRED`, appended in that order;
     each is also the kind of the stand-down it sends, by its own name (D-112),
     so `MESSAGE_KINDS` and `PUSH_KINDS` gain them too, after `NO_RESPONDER`.
     Both are in the open's withdrawal list by being resolutions (D-112, loop
     3), so a later journey's open withdraws an unsent one for its own
     responders. Both join `WITHDRAWN_WHEN_REMOVED` (every kind that is not a
     journey's).
   - `JOURNEY_END_REASONS` becomes `HOME`, `SAFE`, `EXPIRED`.
   - **Who closed it is `acknowledged_by` of the alert resolved `SAFE`.** Only
     the recorded acknowledger can close (item 2), and nothing clears
     `acknowledged_by` on a resolved alert (D-123: "a `RESOLVED` alert's
     record included"). So the closer is on record with no new column, which
     keeps less about people. A test holds the invariant at L2 and L3: every
     alert resolved `SAFE` has `acknowledged_by` set, and its journey ended
     `SAFE` at the same `now()`.
     - Rejected: a `resolved_by` column. It duplicates `acknowledged_by` for
       one resolution and is null for the rest. A database check tying `SAFE`
       to `acknowledged_by` is not possible in the migration that adds `SAFE`
       (an enum value cannot be used in the transaction that adds it); a later
       migration can add one.

4. **The close in the store** (`recordClosure`), one transaction, written as
   `recordAcknowledgement` is:
   1. **the journey's row first** (D-112), found through the alert, `for
      update`, waiting (a person's action); the API pool's 5 s lock limit
      bounds it;
   2. **under that lock,** the alert read again with its journey's responders
      (`alertForAcknowledgement`'s read, reused), and the close rule (AR-04).
      Anything but `closed` is answered `{ outcome: 'not_closed', decision }`,
      writing nothing;
   3. the journey `ENDED`, `end_reason = 'SAFE'`, `ended_at = now()`, guarded
      by `state = 'LOST_CONTACT'`, which must change exactly one row. An
      unresolved alert's journey is always `LOST_CONTACT`; if it is not, the
      read is not what this code thinks, and it throws;
   4. `resolveInside(tx, journeyId, 'SAFE', { except: responderId })`: the
      alert `RESOLVED`, `SAFE`, at `now()`; its unsent
      `WITHDRAWN_WHEN_RESOLVED` kinds withdrawn; one `SAFE` stand-down per
      responder row **but the closer's** ("tells the other responders"), each
      held per responder as today. The alert it resolved must be the one the
      call named, or it throws;
   5. answer `{ outcome: 'closed', messages }`.
   - `except` is the one change to `resolveInside`: every other caller passes
     none, and its statement is unchanged for them.
   - Lock order: the journey's row, the alert's, then outbox rows, as every
     path takes them.
   - **The module** (`createClosureService({ alerts, log }).close({
     responderId, alertId })`): read the alert without a lock, ask the rule;
     answer a refusal or an ignore from that read; for `closed`, call the
     store, and map its answer as the read's would have been. An alert
     already over gets one `closure_ignored` line (alert ID and reason). A
     failed read or store writes one `closure_failed` line (stage and
     SQLSTATE) and throws on, so the route answers 500, never a 2xx. No line
     for a close or a refusal; no user ID in any line (PRIV-07).

5. **The route** (`POST /v1/alerts/{alertId}/closure`, procedure
   `closeAlert`), on the device credential (D-091), shaped as "I'm on it"'s
   (D-114):
   - detailed input: `params` holds `alertId` alone, a UUID lower-cased at the
     edge; `body` an empty strict object, optional. Any key in the body, an
     `alertId` included, is the fixed 400;
   - the responder is the device's own user, from any of their devices;
   - **answers:** 200 `{ outcome: 'CLOSED' }`; 403 `NOT_THE_ACKNOWLEDGER`;
     404 `ALERT_NOT_FOUND`; 409 `ALERT_RESOLVED`; the fixed 400; the 401 every
     device route has. None carries data or says who is on the alert or who
     closed it;
   - **why a 403 and not a 404 for another responder:** they follow the
     journey, so the alert's existence is theirs to know (LOST-06 already
     answers them 409 `ALREADY_ACKNOWLEDGED`). The one-404 rule protects
     people who do not follow it, and they still get the 404.
   - Additive: `openapi.json` regenerated; `released/` is empty, so
     `api:diff` compares nothing and the pull request says "not compared".

6. **The 24-hour end** (SM-06's third clause).
   - **The constant:** `ALERT_EXPIRES_AFTER_MS = 86_400_000`, counted "or
     more" by the database's clock, from the alert's `opened_at`. Not from the
     journey's first loss, and not moved by a reset: SM-06 says "24 hours
     after the alert opened". A journey that lost contact, came back and lost
     it again counts from its current alert's opening. Changing it needs the
     owner.
   - **The rule** (`transition`, a seventh journey event,
     `ExpireEvent { type: 'expire', alertOpenedAt, now }`), on the journey's
     `{ id, state }`: `LOST_CONTACT` and `now - alertOpenedAt >=
     ALERT_EXPIRES_AFTER_MS` → `{ type: 'expired', state: 'ENDED', reason:
     'EXPIRED', alert: 'RESOLVED' }`; everything else, no journey included,
     → unchanged. A time that is not one cannot reach it (`databaseTime`
     throws first, as for the escalation).
   - **The read** (`alertsDueForExpiry()`): one statement, no lock, the
     database's `now()` and every unresolved alert opened
     `ALERT_EXPIRES_AFTER_MS` or more before it, with its journey. No
     threshold is passed in, so a caller cannot choose another (D-116, loop
     1).
   - **The write** (`expireAlert({ alertId, lockWaitMs })`), through
     `takingTheRow` as the escalation is: its own lock limit; the alert's
     journey's row first, skipped when held unless told to wait; under it,
     the journey's state, its one unresolved alert, that alert's `opened_at`
     and `now()`. Skipped, writing nothing, when the unresolved alert is not
     the one named (resolved since the read) or the rule says unchanged.
     Otherwise the journey `ENDED`, `EXPIRED`, at `now()`, guarded by
     `LOST_CONTACT` and exactly one row, then
     `resolveInside(tx, journeyId, 'EXPIRED')`: every responder row gets one
     `EXPIRED` stand-down, the acknowledger included ("with responders told";
     D-111). A journey with no responder row gets none, and its unheard alert
     is resolved, so the SMS check's next report is `ok` if nothing else
     fails (D-122 item 3).
   - **The run** (`createExpiry({ journeys, log }).expireDue()`), as the
     escalation's: read; ask the rule of each (defence in depth); a
     transaction per alert, so one alert's failure stops no other; for one
     skipped and past its 24 hours by `STUCK_AFTER_MS` or more
     (`isStuckPast`), one more attempt waiting `LOCK_WAIT_LIMIT_MS`; held
     through it, or failed, it is stuck: one `expiry_overdue` line. A read
     that fails, an expiry that fails, or a stuck alert fails the run. No
     line for a success: the rows are the record.
   - **In the sweep, after the escalation, whatever the opens and the
     escalation came to,** and feeding its beat: a run that fails fails the
     sweep, so the beat stops and the owner is paged, as for the escalation
     (D-116). Its stuck alerts add to the sweep's `stuck`. **`SweepResult`
     keeps its four fields:** how many expired is read from the store, so the
     54 exact assertions on the sweep's result stand unchanged.
   - Rejected: a cron task of its own. It would need its own monitor, or
     would fail quietly; the sweep is already watched.

7. **SM-05's guard** (on Q1 (a)).
   - In M2 the only automatic end is the 24-hour end, which by its rule ends
     only a `LOST_CONTACT` journey and only at 24 hours. Nothing else the
     worker runs ends a journey.
   - **The guard is a pinned list.** A domain test named for SM-05 holds
     `JOURNEY_END_REASONS` to exactly `HOME`, `SAFE`, `EXPIRED`, and a table
     beside it says, for each reason, which states it may end and whether it
     is automatic: `HOME` from `ACTIVE` or `LOST_CONTACT`, by the walker;
     `SAFE` from `LOST_CONTACT`, by the acknowledger; `EXPIRED` from
     `LOST_CONTACT` at 24 hours, automatic. The table is typed over the list,
     so the task that adds the two-hour stop's reason meets a type error and
     a failing test named SM-05, and must state that its reason ends
     `ACTIVE` only, with its own L6 test, under RG-03's written reason.
   - **And it is held as behaviour:** at L2, for any time under 24 hours
     after the alert opened (fast-check), the `expire` rule leaves a
     `LOST_CONTACT` journey as it is; at L6, a lost-contact journey swept at
     two hours, two hours ten minutes and onwards to one millisecond short
     of 24 hours after its alert opened is still `LOST_CONTACT`, its alert
     unresolved (AC12).

8. **The tables** (migration `0008_*.sql`, generated with `pnpm --filter
   @trygghverdag/server db:generate` and committed):

   | Enum | Change | Order |
   |---|---|---|
   | `alert_resolution` | + `SAFE`, + `EXPIRED` | Equals `ALERT_RESOLUTIONS` |
   | `message_kind` | + `SAFE`, + `EXPIRED` | Equals `MESSAGE_KINDS` |
   | `journey_end_reason` | + `SAFE`, + `EXPIRED` | Equals `JOURNEY_END_REASONS` |

   - No column, no check, no index changes. Every existing row keeps its
     meaning.
   - The new values are added inside the migration's transaction, as `0004`
     to `0007` add theirs, so `0008` must not use them: each label appears
     only in its `add value` statements.
   - No location, phone number or name.

9. **The start that races an end** (LOST-03's left item). A walker's start
   that meets the one-unended-journey index can now find, on its read after
   the conflict, that the conflicting journey ended meanwhile, by a close or
   the 24-hour end, which come from outside the walker's phone.
   `insertStarted` then retries its insert once, in a new transaction. A
   second conflict whose read again finds no unended journey throws, as
   today, so the API answers 500. The comment at lines 951 to 957 is replaced
   to say so. This lives in `adapters/journeys.ts`; `modules/journeys/` does
   not change.

10. **Database time** (AR-03, REL-01). `ended_at`, `resolved_at`, every
    withdrawal and every stand-down's `created_at` are the closing or expiring
    transaction's `now()`, the same value. The 24 hours are counted by that
    `now()`. The fake store emulates `now()` with its fake clock and throws
    when asked to close or expire without one.

11. **The log** (PRIV-07; `log.ts`, owned under D-102). `LogEvent` gains four
    closed events, and nothing free-form:

    ```ts
    | { event: 'closure_ignored'; reason: 'ALERT_RESOLVED'; alertId: string }
    | { event: 'closure_failed'; stage: 'read' | 'store'; code: string | null }
    | { event: 'expiry_failed'; stage: 'read' | 'expire'; code: string | null }
    | { event: 'expiry_overdue'; alertId: string }
    ```

    `createLog` writes `alertId` only as a canonical UUID, `reason` and
    `stage` only from their sets, `code` only as a SQLSTATE; anything else as
    null. No event names a user.

12. **No new dependency** (SEC-06), **no new import route** (AR-10).

13. **Decisions to record** in `docs/plan/decisions.md`. D-124 is the last
    read here, so D-125 and D-126 are the likely numbers; check the open pull
    requests' `decisions.md` before taking them, and again before each push
    (the live gotcha). This session could not.
    - **The owner's answers to Q1 and Q2**, in one decision.
    - **One delegated decision (D-031)** for the rest: the close rule, its
      order and its both-halves reading; the 403; a repeat as a 409; who
      closed it as `acknowledged_by`; `SAFE` and `EXPIRED` as resolutions,
      kinds and end reasons; `resolveInside`'s `except`; the 24-hour end in the
      sweep, its constant, its rule and its stuck handling; `SweepResult`
      unchanged; SM-05's pinned table; the four log events; the route; the
      retry in `insertStarted`; the two new L6 files in the `alerts` group;
      and **how D-033's journey table is read now**: `LOST_CONTACT` →
      `ENDED` (`SAFE`) and `LOST_CONTACT` → `ENDED` (`EXPIRED`) exist, and
      `05-architecture.md`'s table gains the two rows and the reasons line.

### Interfaces the tests are written against (RG-02: tests first)

The implementer may refine a name only with `test-author`, and only before
the tests are written.

- **`domain/journey.ts`:**
  - `JOURNEY_EVENTS` exactly `['start', 'heartbeat', 'silence', 'contact',
    'home', 'remove', 'expire']`;
  - `ALERT_EVENTS` exactly `['acknowledge', 'escalate',
    'acknowledger_removed', 'close']`;
  - `MESSAGE_KINDS` exactly `['LOST_CONTACT', 'BACK_IN_CONTACT', 'HOME',
    'ACKNOWLEDGED', 'LOST_CONTACT_SMS', 'NO_RESPONDER', 'SAFE', 'EXPIRED']`;
  - `PUSH_KINDS` every kind but `LOST_CONTACT_SMS`, in that order;
    `SMS_KINDS`, `JOURNEY_MESSAGE_KINDS`, `WITHDRAWN_WHEN_RESOLVED`,
    `WITHDRAWN_WHEN_ACKNOWLEDGED` and `WITHDRAWN_WHEN_RESET` unchanged;
  - `WITHDRAWN_WHEN_REMOVED` every kind not in `JOURNEY_MESSAGE_KINDS`, in
    order;
  - `ALERT_RESOLUTIONS` exactly `['BACK_IN_CONTACT', 'HOME', 'SAFE',
    'EXPIRED']`; `JOURNEY_END_REASONS` exactly `['HOME', 'SAFE', 'EXPIRED']`;
  - `ALERT_EXPIRES_AFTER_MS = 86_400_000`;
  - `AlertForClosure { id: string; state: AlertState; acknowledgedBy: string |
    null; responderIds: readonly string[] }`; `CloseEvent { type: 'close';
    responderId: string }`; `CloseRefusal = { type: 'ignored'; reason:
    'ALERT_RESOLVED' } | { type: 'refused'; reason: 'ALERT_NOT_FOUND' |
    'NOT_THE_ACKNOWLEDGER' }`; `CloseOutcome = { type: 'closed'; state:
    'RESOLVED'; resolution: 'SAFE'; journey: 'ENDED' } | CloseRefusal`; and
    `alertTransition`'s overload for them;
  - `ExpireEvent { type: 'expire'; alertOpenedAt: Date; now: Date }`;
    `ExpireOutcome = { type: 'expired'; state: 'ENDED'; reason: 'EXPIRED';
    alert: 'RESOLVED' } | { type: 'unchanged' }`; and `transition`'s overload
    for them, on `WalkersJourney | null`;
  - every existing type, rule and outcome unchanged.
- **`ports.ts`:**
  - `ClosureStore { alertForClosure(alertId: string):
    Promise<AlertForClosure | null>; recordClosure(closure: ClosureToRecord):
    Promise<RecordClosureResult> }`; `ClosureToRecord { alertId: string;
    responderId: string }`; `RecordClosureResult = { outcome: 'closed';
    messages: AlertMessage[] } | { outcome: 'not_closed'; decision:
    CloseRefusal }`;
  - `WatchdogStore` gains `alertsDueForExpiry(): Promise<ExpiringAlerts>` and
    `expireAlert(request: ExpireRequest): Promise<ExpireAlertResult>`;
    `ExpiringAlerts { now: Date; alerts: { id: string; journeyId: string;
    journeyState: JourneyState; openedAt: Date }[] }`; `ExpireRequest {
    alertId: string; lockWaitMs?: number | undefined }`; `ExpireAlertResult =
    { outcome: 'expired'; messages: AlertMessage[] } | { outcome: 'skipped' }
    | { outcome: 'held' }`;
  - the four `LogEvent` members.
- **`modules/alerts/closure.ts`:** `createClosureService({ alerts:
  ClosureStore; log: Log })` → `{ close(call: CloseCall):
  Promise<CloseResult> }`; `CloseCall { responderId: string; alertId: string
  }`; `CloseResult = { type: 'closed' } | CloseRefusal`.
- **`modules/alerts/expiry.ts`:** `createExpiry({ journeys: WatchdogStore;
  log: Log })` → `{ expireDue(): Promise<{ ok: boolean; expired: number;
  stuck: number }> }`. `createWatchdog`'s signature and `SweepResult` are
  unchanged.
- **`api.ts`:** `ApiDependencies` gains `closures: ClosureService`.
- **Contracts** (`alerts.ts`): `closureRequestSchema`,
  `closureResponseSchema` (`{ outcome: 'CLOSED' }`), `closureErrors`
  (`BAD_REQUEST`, `NOT_THE_ACKNOWLEDGER` 403, `ALERT_NOT_FOUND` 404,
  `ALERT_RESOLVED` 409), `closeAlert`; `contract` gains `closeAlert` last.
- **The test kit** (owned, D-100):
  - `fakeJourneyStore({ clock })` gains `alertForClosure`, `recordClosure`,
    `alertsDueForExpiry` and `expireAlert`, deciding by the same rules under
    its own "lock" (`hold`, `beforeNext('recordClosure' | 'expireAlert', …)`,
    `failWith(…)`), and `resolveInside`'s `except`; its journeys gain the
    two end reasons; without a clock it throws when asked to close or expire;
  - its copies of `MESSAGE_KINDS`, `PUSH_KINDS`, `ALERT_RESOLUTIONS` (and its
    stand-down copy, which LOST-03's review asked to tie to it),
    `WITHDRAWN_WHEN_REMOVED` and `JOURNEY_END_REASONS`, exported so the
    domain's test ties them;
  - `fakeLog()`: the four events; `fakePush()`'s kinds gain `SAFE` and
    `EXPIRED`;
  - **the shared behaviour suite:** `JourneyStoreUnderTest.store` gains the
    four methods.

## Acceptance criteria

The journey J is started through the API by the walker W, from the device D,
naming the responders R1, R2 and R3; D then goes silent and the watchdog opens
J's alert A, unless a criterion says otherwise. "Closes" means `POST
/v1/alerts/{A}/closure` through the API from the named responder's device.

### "They're safe"

**LOST-08-AC1 — The acknowledger closes: the alert resolves, the journey ends,
and the others are told. The roadmap's first half at L6.** *(LOST-08, SM-06)*
- **Given** J `LOST_CONTACT`, A acknowledged by R1 through the API, R2's
  `ACKNOWLEDGED` notice sent and R3's not yet claimed
- **When** R1 closes A
- **Then** the answer is 200 `{ "outcome": "CLOSED" }`
- **And** A is `RESOLVED`, resolution `SAFE`, `acknowledged_by` still R1; J is
  `ENDED`, end reason `SAFE`, with `ended_at` equal to A's `resolved_at`
- **And** exactly one `SAFE` stand-down each for R2 and R3, in A's round,
  none for R1 or W; R3's unsent notice is withdrawn at the close's now
- **And** the push sender's next run hands each `SAFE` to the push fake with
  exactly `messageId`, `recipientId` and `kind`, the ID a UUID equal to no
  user's, journey's, alert's or device's; nothing reaches the SMS fake.

**LOST-08-AC2 — Only the current acknowledger may close; every other caller
is refused and nothing is written.** *(LOST-08, LOST-06, SEC-07)*
- **Given** A acknowledged by R1
- **When** R2 closes A
- **Then** 403 `NOT_THE_ACKNOWLEDGER`, with no data, and nothing is written
- **And** W, a user who follows only another journey, and any caller for an
  alert ID no alert has each get 404 `ALERT_NOT_FOUND`, one body for all
- **And** for A `OPEN` or `ESCALATED` with nobody recorded, every responder
  gets 403; for A put in directly as `OPEN` or `ESCALATED` with R1 recorded,
  or `ACKNOWLEDGED` with nobody recorded, R1 gets 403 (both halves are read)
- **And** for A `RESOLVED`, by contact, by "I'm home", by the 24-hour end or
  by an earlier close, R1 gets 409 `ALERT_RESOLVED` and one
  `closure_ignored` line naming A and the reason; a repeat of R1's own close
  included
- **And** with no credential, 401; with an alert ID that is not a UUID, or a
  body holding any key (an `alertId` included), the fixed 400
- **And** no answer says who is on A or who closed it.

**LOST-08-AC3 — After a reset, nobody can close until someone acknowledges
again.** *(LOST-08, SM-10)*
- **Given** A acknowledged by R1, and R1 removed (the removal module)
- **Then** R1's close is 404 `ALERT_NOT_FOUND`, and R2's and R3's are 403
- **When** R2 says "I'm on it" through the API, then closes A
- **Then** 200; A `RESOLVED`, `SAFE`, `acknowledged_by` R2; J `ENDED`,
  `SAFE`; one `SAFE` for R3 alone, none for R1 (removed) or R2.

**LOST-08-AC4 — The close decides under the journey's row.** *(LOST-08,
SM-09, SM-10, LOST-03)*
- **Given** a real PostgreSQL, and J's row held by another transaction
- **When** R1's close arrives
- **Then** it waits for the row (`pg_stat_activity`), then decides by what the
  holder left: closed; 404 if the holder removed R1; 409 if the holder
  brought J back in contact, ended it "I'm home" or expired it
- **And** with each of those against the close, in both orders (forced at L3
  by transactions held open; given at L2 and L6 by the fake's `beforeNext`),
  every run ends with exactly one resolution of A and one end of J, never
  two, and the stand-downs of that one resolution only
- **And** with `RACERS` closes by R1 at once on separate connections, for
  `RACE_ROUNDS` rounds, exactly one is 200 and every other 409, none an
  error
- **And** when R1's close has read A as closable and then waits while R1's
  removal holds J's row and commits, the close is 404 from the store's
  decision under the lock, and writes nothing.

**LOST-08-AC5 — After a close, the journey is over for everything that
follows, and the walker is free.** *(LOST-08, SM-07, LOST-01, LOST-02,
LOST-07, SM-01)*
- **Given** J closed by R1
- **Then** D's next heartbeat is 409 `JOURNEY_ENDED`, stores nothing, and
  writes one `heartbeat_ignored` line; D's "I'm home" is 409 `JOURNEY_ENDED`
- **And** no later sweep opens an alert for J or escalates A, and the SMS fake
  receives nothing for A, however far the clock runs
- **And** W starts a new journey J2 naming R2: 201; when J2's alert opens,
  R2's `SAFE` from J, if still unsent, is withdrawn, and R3's is not (R3 is
  not on J2) (D-112, loop 3).

**LOST-08-AC6 — What the walker will be shown is on record (Q2 (a)).**
*(LOST-08)*
- **Then** after a close, J's end reason is `SAFE` and A's `acknowledged_by`
  names the closer, readable together; after the 24-hour end, `EXPIRED`
- **And** for any sequence in the shared behaviour suite's property (AC14),
  every alert resolved `SAFE` has `acknowledged_by` set, its journey ended
  `SAFE`, and `ended_at` equal to `resolved_at` (L2, L3)
- **And** no message is written to W by a close or the 24-hour end.

**LOST-08-AC7 — A closed alert sends nothing more, and its stand-downs never
overtake what is in a port's hands.** *(LOST-08, LOST-03, LOST-07)*
- **Given** A escalated, R2's lost-contact push failing `NO_TARGET` and due
  again, R3's lost-contact push handed to the push port and not yet answered
  (the fake's `holdAnswers`), then acknowledged by R1
- **When** R1 closes A
- **Then** R2's unsent push is withdrawn at the close's now, keeping attempts
  and last failure, and never handed to a port again
- **And** R3's push finishes as the port answers and is never retried; R3's
  `SAFE` is due no earlier than that push's lease ends, at most 60 s on;
  R2's `SAFE` is due at once
- **And** no SMS is written by the close (no stand-down SMS, D-115 item 5).

### The 24-hour end

**LOST-08-AC8 — 24 hours after the alert opened, the journey ends and every
responder is told.** *(LOST-08, SM-06, REL-01)*
- **Given** A opened at five minutes on the fake clock, J `LOST_CONTACT`, the
  loops running
- **When** the sweep runs at 86 399 999 ms after A's opening
- **Then** nothing changes
- **When** it runs at exactly 86 400 000 ms
- **Then** J is `ENDED`, end reason `EXPIRED`, `ended_at` the sweep's now;
  A is `RESOLVED`, resolution `EXPIRED`, at the same now; one `EXPIRED` each
  for R1, R2 and R3, none for W; the push fake receives them; the sweep is ok
  and records its beat
- **And** the same for A `OPEN`, `ESCALATED`, `ACKNOWLEDGED` (its
  acknowledger told too), and reset into round 2 (counted from A's opening,
  not the reset)
- **And** for a journey that lost contact, came back and lost it again, the
  24 hours count from its current alert's opening.

**LOST-08-AC9 — The 24-hour end resolves an unheard alert, and the page
clears.** *(LOST-08, SM-06, SM-10, SM-02)*
- **Given** J with its last responder removed, silent, its alert unheard, the
  SMS check reporting `failing`
- **When** the sweep runs 24 hours after the alert opened
- **Then** J is `ENDED`, `EXPIRED`, the alert `RESOLVED`, `EXPIRED`, no
  message written; the next SMS check reports `ok` (nothing else failing),
  with no `unheard_alerts` line.

**LOST-08-AC10 — The 24-hour end is part of the watchdog's sweep, and a
failure there is loud.** *(LOST-08, SM-06, LOST-02, REL-08)*
- **Then** the expiry runs after the opens and the escalation, whatever they
  came to, its own read included
- **And** an expiry that fails, or a read of due alerts that fails, writes one
  `expiry_failed` line with its stage and SQLSTATE, fails the sweep, and the
  beat is not recorded
- **And** one alert's failed expiry stops no other's, in both orders
- **And** an alert whose journey row is held past its 24 hours by
  `STUCK_AFTER_MS` gets one waiting attempt; held through it, one
  `expiry_overdue` line naming it, the sweep fails and counts it in `stuck`;
  let go within it, it expires
- **And** with two such alerts, one held through the wait and one let go
  within it, in both orders, each meets its own outcome (BUG-28's lesson)
- **And** the sweep's result keeps exactly its fields `ok`, `opened`,
  `escalated`, `stuck`.

**LOST-08-AC11 — The 24-hour end decides under the journey's row.** *(LOST-08,
SM-06, SM-09)*
- **Given** a real PostgreSQL and an alert past 24 hours
- **When** contact comes back, "I'm home", a close or a removal holds J's row
  as the expiry arrives, in both orders
- **Then** exactly one of them decides the journey's end or return, the
  expiry skips when the alert was resolved since its read, and never two
  resolutions, two ends or two sets of stand-downs.

### SM-05 and SM-06 as a whole

**LOST-08-AC12 — Nothing automatic ends a lost-contact journey before 24 hours;
the two-hour stop never ends one. The roadmap's second half at L6 (Q1 (a)).**
*(SM-05, SM-06)*
- **Given** J `LOST_CONTACT` from five minutes, nobody acknowledging
- **When** the sweep runs at two hours, two hours ten minutes, every hour
  after, and one millisecond short of 24 hours after A's opening
- **Then** J is `LOST_CONTACT` every time, A unresolved, J's `ended_at` and
  end reason null; A escalated once, at two minutes
- **And** an `ACTIVE` journey with a heartbeat every minute for three hours
  is never ended by any sweep
- **And** for any time under `ALERT_EXPIRES_AFTER_MS` after the opening
  (fast-check), the `expire` rule leaves `LOST_CONTACT` as it is, and for
  any time it never ends `ACTIVE` or no journey (L2)
- **And** `JOURNEY_END_REASONS` is exactly `HOME`, `SAFE`, `EXPIRED`, and the
  table of which states each may end, typed over the list, says `SAFE` and
  `EXPIRED` end only `LOST_CONTACT` and only `EXPIRED` is automatic; a reason
  added without a row is a type error and a failing test naming SM-05.

**LOST-08-AC13 — SM-06's three ends, and the end the retention rule counts
from.** *(SM-06, SM-04, LOST-03)*
- **Then** a `LOST_CONTACT` journey ends in exactly three ways, each tested
  here end to end through the API or the sweep: D reconnects and sends "I'm
  home" (`HOME`); the acknowledger closes (`SAFE`); 24 hours pass (`EXPIRED`)
- **And** in each, `ended_at` is set at the transaction's now, equal to the
  alert's `resolved_at`, and the end reason is set with it
- **And** a fresh heartbeat brings J back to `ACTIVE` and ends nothing.

### The rules, the database, the route and the log

**LOST-08-AC14 — Every (situation, event) pair has a tested outcome, the
close's and the expiry's included.** *(LOST-08, SM-06)*
- **Then** the alert rule's table holds an expectation for `close` for no
  alert, and each of the four states with nobody, the sender and another
  responder recorded, with the sender a responder and not
- **And** the journey rule's table holds one for `expire` in every state,
  under and at 24 hours
- **And** for any situation (fast-check), the outcome is the rule's, in its
  order, never a throw or `undefined`, and deciding changes nothing handed in
- **And** typecheck fails for an event with no `case`; an unlisted event is
  thrown on with the rule's message
- **And** in the shared behaviour suite, a property over sequences of
  acknowledgements, closes, removals, sweeps, time passing (beyond 24 hours
  included), fresh and stale heartbeats and "I'm home" holds after every
  step: a journey is `ENDED` exactly when it has an end reason and an
  `ended_at`; an unresolved alert's journey is `LOST_CONTACT`; no unresolved
  alert is 24 hours old after the next sweep; no `SAFE` resolution without
  its acknowledger; no responder holds two stand-downs for one alert in one
  round.

**LOST-08-AC15 — Every kind has one channel and one place among the
withdrawals.** *(LOST-08, LOST-06, LOST-07, SM-10)*
- **Then** `MESSAGE_KINDS`, `ALERT_RESOLUTIONS`, `PUSH_KINDS` and
  `WITHDRAWN_WHEN_REMOVED` are exactly the interfaces' lists
- **And** every kind is in exactly one of `SMS_KINDS` and `PUSH_KINDS`, and
  in exactly one of `WITHDRAWN_WHEN_RESOLVED`, `ALERT_RESOLUTIONS` and
  `JOURNEY_MESSAGE_KINDS`; one in none or two is named
- **And** each resolution is a message kind of its own name (also held at
  typecheck), and the test kit's copies equal the domain's.

**LOST-08-AC16 — A close and an expiry are all or nothing, and a failure is
loud.** *(LOST-08, SM-06)*
- **Given** a real PostgreSQL, where a test-only trigger refuses, in turn,
  the journey's end, the alert's resolution, the withdrawal and a stand-down
- **When** a close, and in another run an expiry, runs
- **Then** it fails with J, A and every message as they were; the close
  writes one `closure_failed` line, stage `store`, with the SQLSTATE, and the
  route answers 500; the expiry writes one `expiry_failed` line, stage
  `expire`, and the sweep fails
- **And** once the trigger is removed, the same call does all of its work
- **And** a close whose wait for J's row passes the API's 5 s lock limit
  fails the same way, SQLSTATE 55P03
- **And** at L6, with the fake failing each read and write, each is one line
  naming its stage, a 500 for the route, and a failed sweep for the expiry.

**LOST-08-AC17 — The times are the database's.** *(LOST-08, SM-06, REL-01)*
- **Given** a real PostgreSQL
- **Then** `ended_at`, `resolved_at`, every withdrawal and every stand-down's
  `created_at` equal the closing or expiring transaction's `now()`, to the
  microsecond, in the same transaction (`xmin`), between two `select now()`
  readings
- **And** the 24 hours are counted by the expiring transaction's `now()`
  against `opened_at`: an alert seeded 24 hours less 1 s ago is not expired,
  and one seeded 24 hours ago is
- **And** the modules and the domain read no clock (the lint rule, L1).

**LOST-08-AC18 — The new log events are closed, and nothing personal reaches a
log.** *(LOST-08, PRIV-07)*
- **Then** typecheck fails for any new event holding another field; a
  `@ts-expect-error` test holds it, trying a phone number, a latitude, a
  user's ID and a message
- **And** `createLog` writes each as one JSON line holding exactly its fields;
  a non-canonical ID, a `reason` or `stage` outside its set and a `code` that
  is not a SQLSTATE are each written as null (L2)
- **And** when the fake store fails the close's read and store and the
  expiry's read and write, each with an error whose message holds markers (a
  synthetic coordinate, a phone-number-shaped string, a credential-like
  string, the closer's and the walker's IDs), nothing written to stdout,
  stderr or the console holds a marker; a 400 from the closure route for a
  known device whose credential is a marker writes nothing holding it (L6)
- **And** as controls, the capture sees a line written through the production
  `createLog`, and the thrown errors hold the markers.

**LOST-08-AC19 — The route is in the contract, additive, and shaped like its
neighbours.** *(LOST-08, SEC-07)*
- **Then** `closeAlert` is in the contract beside the five routes: `POST
  /alerts/{alertId}/closure`, answering 200, its input detailed
- **And** its 200 body is exactly `{ "outcome": "CLOSED" }`, no other outcome
  or field accepted; its refusals are the fixed 400, 403
  `NOT_THE_ACKNOWLEDGER`, 404 `ALERT_NOT_FOUND` and 409 `ALERT_RESOLVED`, each
  with no data, beside the 401
- **And** `openapi.json` publishes it, and the other five routes are
  published exactly as before, each pinned by its sha256
- **And** the route answers 401 without a credential, as every device route
  does (the system test that reads every route from the contract).

**LOST-08-AC20 — The database agrees, and migration `0008` keeps every
row.** *(LOST-08)*
- **Given** a freshly migrated database
- **Then** `alert_resolution`, `message_kind` and `journey_end_reason` hold
  exactly `ALERT_RESOLUTIONS`, `MESSAGE_KINDS` and `JOURNEY_END_REASONS`, in
  order (`pg_enum`); a resolution or end reason outside them is refused
- **And** on PostgreSQL 15, a database at `0007` holding journeys in every
  state and end reason, alerts in every state with and without a resolution,
  and outbox messages of every kind, sent, unsent and withdrawn, migrates
  through `0008` as the pre-run hook runs it; every row is unchanged, column
  for column; `SAFE` and `EXPIRED` can be used once it has committed
- **And** there is exactly one committed `0008_*.sql`, in the journal, with
  no `update`, `delete` or `truncate`, naming `'SAFE'` and `'EXPIRED'` only
  in `add value` statements.

**LOST-08-AC21 — A start that races an end from outside the walker's phone
retries once.** *(LOST-08, SM-01)*
- **Given** W's journey J, closed or expired between a start's conflict with
  it and the start's read of the winner (forced at L3 by a held transaction;
  given at L2 and L6 by the fake's `beforeNext`)
- **When** W starts a journey
- **Then** the start retries its insert once and answers 201 with a new
  journey, its responders stored; J unchanged
- **And** when the retry meets the same race again, the answer is 500 with
  nothing stored, as today.

## Test plan

| AC | Level | Where | Names |
|----|-------|-------|-------|
| AC1 | L6, L3, L2 | `apps/server/src/closure.system.test.ts` (new); `closure.integration.test.ts` (new); behaviour suite | SM-06 |
| AC2 | L6, L2 | `closure.system.test.ts`; `domain/journey.test.ts` | LOST-06, SEC-07 |
| AC3 | L6, L3, L2 | `closure.system.test.ts` (with the removal module); `closure.integration.test.ts`; behaviour suite | SM-10 |
| AC4 | L3, L2, L6 | `closure.integration.test.ts` (held rows, `pg_stat_activity`, `RACERS`); behaviour suite; `closure.system.test.ts` (`beforeNext`) | SM-09, SM-10, LOST-03 |
| AC5 | L6 | `closure.system.test.ts` | SM-07, LOST-01, LOST-02, LOST-07, SM-01 |
| AC6 | L2, L3, L6 | behaviour suite (property); `closure.integration.test.ts`; system test | |
| AC7 | L6, L2, L3 | `closure.system.test.ts` (`holdAnswers`, `failFor`); behaviour suite | LOST-03, LOST-07 |
| AC8 | L6, L3, L2 | `apps/server/src/expiry.system.test.ts` (new); `expiry.integration.test.ts` (new); behaviour suite | SM-06, REL-01 |
| AC9 | L6, L3 | `expiry.system.test.ts` (with the SMS check and its recording alarm); `expiry.integration.test.ts` | SM-06, SM-10, SM-02 |
| AC10 | L6 | `expiry.system.test.ts` (stub and fake stores, both orders) | SM-06, LOST-02, REL-08 |
| AC11 | L3, L2, L6 | `expiry.integration.test.ts`; behaviour suite; system test | SM-06, SM-09 |
| AC12 | L6, L2 | `expiry.system.test.ts`; `domain/journey.test.ts` (fast-check, the pinned table) | **SM-05**, SM-06 |
| AC13 | L6 | `expiry.system.test.ts` (one test per end, the "I'm home" one through the route as built) | SM-06, SM-04, LOST-03 |
| AC14 | L1, L2, L3 | `tsc`; `domain/journey.test.ts`; behaviour suite (property: the fake at L2, the adapter at L3 with fewer runs) | SM-06 |
| AC15 | L2, L3 | `domain/journey.test.ts`; behaviour suite | LOST-06, LOST-07, SM-10 |
| AC16 | L3, L6 | both integration files (a trigger the test creates and removes); both system files (`failWith`) | SM-06 |
| AC17 | L3, L6, L1 | both integration files; system tests; lint in `gate:static` | SM-06, REL-01 |
| AC18 | L1, L2, L6 | `tsc`; `log.test.ts`, `fake-log.test.ts`; both system files (`captured()`) | PRIV-07 |
| AC19 | L4, L6 | `packages/contracts/src/alerts.test.ts`, `openapi.test.ts`; `journeys.system.test.ts`'s every-route test (unchanged, it reads the contract) | SEC-07 |
| AC20 | L3 | `adapters/journeys.integration.test.ts`; `deploy.integration.test.ts` (PostgreSQL 15) | |
| AC21 | L3, L2, L6 | `adapters/journeys.integration.test.ts`; behaviour suite; `closure.system.test.ts` | SM-01 |

### The shared behaviour suite (D-100)

The fake (L2, `fake-journey-store.test.ts`) and the adapter (L3,
`journeys.integration.test.ts`) must both pass each of these;
`fake-journey-store.test.ts` pins the names. `test-author` may adjust the
wording, keeping the criterion and the assertions.

1. `LOST-08-AC1: recordClosure by the acknowledger ends the LOST_CONTACT journey SAFE and resolves its alert SAFE at the store’s now, withdraws the alert’s unsent WITHDRAWN_WHEN_RESOLVED kinds, and writes one SAFE per responder row but the closer’s, in the alert’s round`
2. `LOST-08-AC2: recordClosure decides by the close rule under the journey’s row and writes nothing for a stranger, another responder, a half record, or a resolved alert`
3. `LOST-08-AC3: after a reset recordClosure refuses everyone until a second acknowledgement, then closes for the new acknowledger, telling the remaining responders only`
4. `LOST-08-AC4: recordClosure decides again under the journey’s row, as its holder left it; RACERS closes at once, RACE_ROUNDS times over: one closes, every other is ignored, none an error`
5. `LOST-08-AC7: a closed alert’s stand-down to a responder whose withdrawn message is in a port’s hands is due at that message’s lease or retry time, at most 60 s on; others at once`
6. `LOST-08-AC8: alertsDueForExpiry reads exactly the unresolved alerts opened 24 hours or more before the store’s now; expireAlert ends the journey EXPIRED, resolves the alert EXPIRED and writes one EXPIRED per responder row, the acknowledger’s included`
7. `LOST-08-AC9: expireAlert on a journey with no responder row resolves its alert with no message, and unheardAlertCount no longer counts it`
8. `LOST-08-AC11: expireAlert skips, writing nothing, an alert resolved, or a journey ended or back in contact, since the read`
9. `LOST-08-AC6: for any sequence of acknowledgements, closes, removals, sweeps, time passing beyond 24 hours, heartbeats fresh or stale and "I’m home", after every step an ENDED journey has its end reason and ended_at, an unresolved alert’s journey is LOST_CONTACT, no unresolved alert is 24 hours old after a sweep, and every SAFE alert names its acknowledger`
10. `LOST-08-AC15: the open withdraws an earlier journey’s unsent SAFE and EXPIRED for its own responders only; the removal and the resolution leave them alone`
11. `LOST-08-AC21: insertStarted retries once when the journey it conflicted with ended before its read, and throws when the race comes again`

The property (9) follows the lesson of LOST-03's, LOST-07's and SM-10's
review loops: its generators must draw acknowledgements that are recorded,
closes by the acknowledger, and time jumps past 24 hours, and its `examples`
hold one fixed sequence that opens, escalates, acknowledges, removes the
acknowledger, acknowledges again and closes, and one that runs to the 24-hour
end, so the L3 run's few runs reach both ends. Against the adapter, time
passing is the database's own (`letTimePass`), so alerts are seeded with
`opened_at` in the past.

### Notes

- **Not used:** L5 and L7 (the app is not touched), L8 (task 9), L9 and L10.
- **L3 needs Docker.** It runs in CI and on the Mac, not in a cloud session;
  `gate:full` names it as not run, and the `integration` job's log is the
  evidence.
- **24 hours on a fake clock.** AC12's L6 test advances the clock in steps
  and runs a sweep at each named moment, not every 10 s for a day.
- **Test names** start with `LOST-08-ACn:`, and the files that hold the
  criteria name SM-05 and SM-06 in test names or titles, not only in
  comments (BUG-16).
- **Synthetic data only** (RG-07, D-089): IDs and credentials from the
  existing builders, markers generated at run time, no phone number apart
  from AC18's phone-number-shaped marker, never in `+47` form.
- **Before pushing:** `test:coverage`, then `coverage:ratchet`. `domain/`
  keeps RG-04's 95 % branch floor. `coverage-baseline.json` gains
  `closure.ts` and `expiry.ts` by hand, at their measured values.
- **`docs/requirements-status.md`** is regenerated with `pnpm run
  req:coverage`.

### Existing assertions that change by design (RG-03)

`test-author` changes each, with the written reason beside it and in the pull
request. None loosens what a test proves. Found by searching on 2026-10-09
for exact pins of the lists, the route list and the migration lists; line
numbers are from that search and may have moved. `test-author` searches again
before the red phase.

**BUG-22 applies:** `tests:changes` does not see
`packages/test-kit/src/journey-store-behaviour.ts`, so each change there
carries its reason by hand.

- **`apps/server/src/domain/journey.test.ts`:**
  - "LOST-03-AC3: ALERT_RESOLUTIONS is exactly BACK_IN_CONTACT and HOME …"
    (line 1894) and "LOST-03-AC3: JOURNEY_END_REASONS is exactly HOME" (line
    1906): gain `SAFE` and `EXPIRED`, and their titles. Still exact. The
    second becomes AC12's pinned table's companion.
  - "LOST-06-AC14: ALERT_EVENTS is exactly acknowledge, escalate and
    acknowledger_removed; JOURNEY_EVENTS is …" (line 2388) and "SM-10-AC16:
    JOURNEY_EVENTS is exactly … and ALERT_EVENTS exactly …" (line 3002): gain
    `close` and `expire`. Still exact.
  - The transition tables typed over `JOURNEY_EVENTS` and `ALERT_EVENTS`
    gain the `expire` and `close` rows, and their counts; every existing row
    keeps its outcome. The other exact event pins SM-10's spec listed
    (LOST-01-AC17, LOST-02-AC6, LOST-03-AC3, LOST-07-AC13) gain them too.
  - The `MESSAGE_KINDS` pins (LOST-03-AC3, LOST-06-AC13, LOST-07-AC14,
    SM-10-AC17) gain the two kinds; the partition tests (line 2559, line
    2881, line 3264) keep their three-way partition, with the new kinds in
    `ALERT_RESOLUTIONS`; "SM-10-AC17: PUSH_KINDS is exactly the five kinds …;
    … ALERT_RESOLUTIONS are unchanged" (line 3290) becomes the seven kinds,
    and `ALERT_RESOLUTIONS` its four.
  - The test kit's copies: added to.
- **`packages/test-kit/src/fake-journey-store.test.ts`:** the `MESSAGE_KINDS`
  (line 1810), `PUSH_KINDS` (line 2412) and `WITHDRAWN_WHEN_REMOVED` (line
  2706) pins gain the two kinds; the pinned list of behaviour names gains
  this task's.
- **`packages/test-kit/src/fake-push.test.ts`** (line 179): `MESSAGE_KINDS`
  gains them. The fake records what it is given, so the assertion is
  otherwise unchanged.
- **`apps/server/src/adapters/journeys.integration.test.ts`:** "LOST-03-AC20:
  message_kind’s values are exactly …, alert_resolution’s exactly …, and
  journey_end_reason’s exactly …" (line 2502) compares with the domain's
  lists, so it changes only where it spells labels literally;
  "LOST-03-AC20: a resolution or an end reason outside the lists is refused"
  (line 2609) must pick another outside value if it uses `SAFE` or `EXPIRED`.
  The other literal label lists SM-10's spec named (LOST-06-AC17,
  LOST-07-AC19, SM-10-AC21) gain the labels.
- **`apps/server/src/deploy.integration.test.ts`**, "SM-10-AC21: a PostgreSQL
  15 database at 0006 … migrates through 0007 …" (line 1304): it runs every
  migration, so it would now run `0008` too. It keeps its point by migrating
  a copy of the folder up to `0007`, as the earlier ones do. AC20's test for
  `0008` is a new one.
- **`packages/contracts/src/alerts.test.ts`**, "LOST-06-AC15: acknowledgeAlert
  is in the contract beside health, start, heartbeat and 'I’m home' …" (line
  50), and **`home.test.ts`**, "LOST-03-AC18: reportHome is in the contract
  beside health, start and heartbeat …" (line 47): if either pins the
  contract's keys exactly, it gains `closeAlert`. Their routes' own
  assertions do not change. `openapi.test.ts`'s "published exactly as
  before" tests (lines 307, 389) pin other routes by sha256 and are expected
  unchanged.
- **`resolveInside`'s `except`:** every behaviour and test of the three
  existing resolutions is expected unchanged, since they pass none.
- **`insertStarted`'s retry:** any test that pins today's 500 on the first
  race (LOST-03's, if one exists; the comment says "answered 500, loudly")
  changes to "retries once, then 500". `test-author` searches for it.
- **Added to, not changed:** `log.test.ts`'s `EVENTS` list and
  `fake-log.test.ts`; the behaviour suite; `api.system.test.ts` or
  `journeys.system.test.ts`'s route list where it is read from the contract.

**Read and expected unchanged**, so nobody has to wonder:
- The 54 exact assertions on the sweep's result, in
  `escalation.system.test.ts`, `contact.system.test.ts`,
  `alerts.system.test.ts`, `alerts.integration.test.ts` and
  `contact.integration.test.ts`: `SweepResult` keeps its four fields
  (approach item 6). A sweep with no alert past 24 hours behaves exactly as
  before.
- The LOST-07 and SM-10 properties draw no closes and no 24-hour jumps, so
  their invariants still hold.
- The acknowledgement route's contract and sha256.

## Mutation (D-036, D-095, D-098, D-099, D-117, D-124)

Read in `scripts/lib/gate-decisions.mjs` on 2026-10-09. Every group runs on
every mutation run once a safety file or input changes.

| New or changed code | Group | Tests the group runs | Configuration |
|---|---|---|---|
| `domain/journey.ts` | `domain` | `apps/server/src/domain` | root |
| `modules/alerts/closure.ts` (new), `expiry.ts` (new), `watchdog.ts` | `alerts` | `alerts.system`, `acknowledgement.system`, `escalation.system`, then `closure.system` (new) and `expiry.system` (new) | `vitest.system.config.mjs` |
| `api-process.ts` (one line of wiring) | `api-process` | unchanged | root |

- **No new safety path or group.** Both new modules are inside
  `modules/alerts/`, which `SAFETY_PATHS`, CODEOWNERS and the safety filter
  already list. `gate-decisions.mjs` gains the `alerts` group's two test
  files (owner approval).
- **Each file must reach 80 % killed on its own** (D-098); every run fresh
  (D-099).
- **Not mutated on a pull request:** `adapters/journeys.ts`, `db/schema.ts`,
  the migration (D-095); `api.ts` (owned and reviewed, proven at L6, not a
  safety path); `log.ts`; `ports.ts`; the contracts.

### The estimate, against 25 minutes

The last measures are CI's on SM-10's pull request (D-124): **12:15 and 13:48
of 25:00.** The local table in D-124 (16:11 in all, `alerts` 3:15, `domain`
3:25) is the only per-group measure. Estimate from the files, not a
measurement:

| Group | New mutants | Why | Added time, local |
|---|---|---|---|
| `domain` | about 40 to 55 | Two rules of three and four steps, five list literals, a constant | +0:20 to +0:30 |
| `alerts` | about 75 to 95 | `closure.ts` of `acknowledgement.ts`'s shape (37 there); `expiry.ts` of `escalation.ts`'s shape; a few in `watchdog.ts`. **And every `alerts` mutant can now run two more files**, though with `--bail=1` and one file at a time (D-124) a mutant killed by an earlier file never runs them | +1:45 to +3:15 |
| `api-process` | 1 to 3 | One argument | +0:05 |

**About 18:30 to 20:00 locally, about 14 to 16:30 on CI** by the CI-to-local
ratio of D-124's run (12:15 / 16:11 ≈ 0.76): **8:30 to 11 minutes to
spare.** So the budget question SM-10's spec raised does not need the owner
now. If CI leaves under about three minutes: give `closure.ts` and
`expiry.ts` a group of their own against their two files, listing the
`modules/alerts/` files in `SAFETY_PATHS` with a test that no `.ts` file there
escapes (SM-10's fallback, delegated); only then the owner's options
(budget, one job per group).

## Modules and files affected

Owner approval and the safety filter were read on 2026-10-09 in
`.github/CODEOWNERS` and `.github/workflows/ai-review.yml` (lines 54 to 80).
`OWNER_APPROVAL_PATHS` in `scripts/lib/merge-rules.mjs` was not read here;
earlier specs say it lists the same paths.

| File | Change | Owner approval | Safety filter | Mutation |
|------|--------|:--:|:--:|:--:|
| `apps/server/src/domain/journey.ts` | `close`, `expire`, two resolutions, kinds and end reasons, the constant, lists | **yes** | **yes** | `domain` |
| `apps/server/src/domain/*.test.ts` | L2 (test-author) | **yes** | **yes** | (its tests) |
| `apps/server/src/modules/alerts/closure.ts` (new) | "They're safe" | **yes** | **yes** | `alerts` |
| `apps/server/src/modules/alerts/expiry.ts` (new) | The 24-hour end | **yes** | **yes** | `alerts` |
| `apps/server/src/modules/alerts/watchdog.ts` | Runs the expiry after the escalation; its header | **yes** | **yes** | `alerts` |
| `apps/server/src/adapters/journeys.ts` | The close's and the expiry's reads and transactions, `resolveInside`'s `except`, `insertStarted`'s retry, the header | **yes** | **yes** | no (D-095) |
| `apps/server/src/db/schema.ts` | Enums follow the lists; comments | **yes** | **yes** | no |
| `apps/server/src/db/migrations/0008_*.sql`, `meta/*` | Generated | **yes** | **yes** | no |
| `apps/server/src/api.ts` | `closures`, the `closeAlert` handler | **yes** (D-097) | **yes** | no |
| `apps/server/src/api-process.ts` | Wires the closure service | **yes** (D-094) | **yes** | `api-process` |
| `apps/server/src/ports.ts` | `ClosureStore`, the expiry's methods and types, four `LogEvent`s | no | no | — |
| `apps/server/src/log.ts` | Four events | **yes** (D-102) | no | no |
| `packages/contracts/src/alerts.ts`, `contract.ts`, `index.ts`; `openapi.json` | The route, regenerated | no | no | — |
| `packages/contracts/src/*.test.ts` | L4 (test-author) | no | no | — |
| `packages/test-kit/src/` (the store, the behaviour suite, `fakePush`, `fakeLog`, their tests, `index.ts`) | Fakes (test-author) | **yes** (D-100) | **yes** | input (D-098) |
| `scripts/lib/gate-decisions.mjs` | The `alerts` group's two files | **yes** | **yes** | input |
| `scripts/lib/gate-decisions.test.mjs`, `scripts/stryker-config.test.mjs` | The group pins (test-author) | **yes** | no | — |
| `apps/server/src/closure.system.test.ts`, `expiry.system.test.ts`, `closure.integration.test.ts`, `expiry.integration.test.ts` (new) | L6, L3 (test-author) | no | no | `alerts`' tests |
| `journeys.integration.test.ts`, `deploy.integration.test.ts`, `log.test.ts` and the other RG-03 files | RG-03 items and additions (test-author) | no | no | — |
| `coverage-baseline.json` | Two files, by hand | **yes** | no | — |
| `docs/plan/decisions.md` | Approach item 13 | **yes** | no | — |
| `docs/plan/05-architecture.md` | The journey table's two rows and its reasons line | no | no | — |
| `docs/plan/README.md` | "Open for M4": the new resolutions, end reasons and stand-downs; who closed it as `acknowledged_by` | no | no | — |
| `docs/requirements-status.md`; `docs/progress.md`, `docs/progress/m2.md` | Regenerated; status (`plan-keeper`) | no | no | — |

- **`.github/workflows/ai-review.yml` is not edited** (D-075).
- **Expected unchanged:** `worker.ts`, `bin/worker.ts`, `process.ts`;
  `modules/journeys/`, `modules/health/`; `outbox.ts`, `sms-check.ts`,
  `acknowledgement.ts`, `escalation.ts`; `adapters/db.ts`, `healthchecks.ts`,
  `clock.ts`, `device-credentials.ts`, `migrations.ts`,
  `worker-heartbeats.ts`; `config.ts`; `stryker.config.mjs` and the Vitest
  configurations; `packages/config/`; `infra/`; `apps/mobile/`.
- **No owner to-do.** Staging has no journeys before task 9 (D-091); the
  route admits no device but tests' until the login task. The migration runs
  in the deploy's pre-run hook.
- **Reviewers.** `safety-reviewer` runs (the filter matches `domain/`,
  `modules/alerts/`, the adapter, the schema, the migration, `api.ts`,
  `api-process.ts`, the test kit and `gate-decisions.mjs`);
  `privacy-security-reviewer` and `test-auditor` always run.

## Contract changes

**One additive route:** `POST /v1/alerts/{alertId}/closure` (`closeAlert`),
on the device credential, detailed input, an empty body; 200 `{ "outcome":
"CLOSED" }`; 400 (fixed), 401, 403 `NOT_THE_ACKNOWLEDGER`, 404
`ALERT_NOT_FOUND`, 409 `ALERT_RESOLVED`. `openapi.json` is regenerated; every
existing path item keeps its sha256. `pnpm run api:diff` runs; with
`packages/contracts/released/` empty it compares nothing, and the pull request
records "not compared", never "passed".

The push port's message shape is unchanged: `{ messageId, recipientId, kind }`.
M3's push adapter receives `SAFE` and `EXPIRED` as new kinds.

## Risks and failure modes

- **[F6](../plan/03-safety-reliability-security.md#failure-modes), the
  missed alert, from the other side: a close that should not have
  happened.** "They're safe" ends the walker's protection and stands
  everyone down. A responder who is wrong, or whose unlocked phone someone
  else uses (the responder's F10), or an abusive responder who tapped "I'm on
  it" (the abusive-member threat), ends it for everyone. The owner accepted
  the capability (D-034). What holds it here: only the current, recorded
  acknowledger, both halves read (AC2); the others are told, and the app (M3)
  can say who; the walker sees it on reconnect (Q2). Nothing here lets
  another responder object or reopen: no story asks for it. The walker can
  start a new journey at once (AC5).
- **[F6], the 24-hour end.** An alert open for 24 hours is ended whether or
  not anyone acted, and an unheard one stops paging the owner (D-122 item 3
  accepted this). After 24 hours of silence the journey's monitoring has
  little left to add; the responders are told.
- **[F7](../plan/03-safety-reliability-security.md#failure-modes), the
  watchdog.** The expiry is in the sweep: a failing expiry stops the beat and
  pages, which is loud, but a persistent one holds the worker's check down
  and hides other watchdog failures while it lasts, as a persistently failing
  open or escalation does. Bounded to a state the code never makes (a
  constraint fault, or rows put in directly); the `expiry_failed` lines say
  which.
- **[F8](../plan/03-safety-reliability-security.md#failure-modes), a bad
  release.**
  - **The migration** adds six enum values. If PostgreSQL refused any, the
    pre-run hook would fail and `deploy-staging` would go red, the old
    version running: loud.
  - **The deploy overlap.** The old worker's push claim lists neither new
    kind, so a stand-down written in the overlap waits for the new worker:
    delayed, not lost. The old API has no closure route, so nothing is
    written by it. The old worker does not expire, so an alert crossing 24
    hours in the overlap expires one sweep after the new worker starts.
- **[F10](../plan/03-safety-reliability-security.md#failure-modes).** "I'm
  home" on the walker's unlocked phone is the documented limit; "They're
  safe" on a responder's unlocked phone is its twin, and is added to the same
  known limitation. M3's app should ask for confirmation (Left for later).
- **[F2](../plan/03-safety-reliability-security.md#failure-modes), false
  alarms and noise.** Two more non-critical pushes per alert at most; no SMS.
- **[F1], [F3], [F4], [F5], [F9]:** not touched.
- **A push that may displace a critical alert.** `SAFE` and `EXPIRED` are
  non-critical pushes, sent while the recipient may hold an undelivered
  critical alert for another walker's journey: D-113's amendment, written
  for the `ACKNOWLEDGED` notice, applies to every non-critical kind. M2
  sends no real push; M3's push task must cover these kinds in its real-phone
  test (Left for later).
- **"Who closed it" depends on `acknowledged_by` staying set.** A test holds
  the invariant (AC6). M4's member deletion, which must deal with that
  reference, must not quietly null it on a kept alert without saying so.
- **The fake can drift from the adapter.** The shared behaviour suite holds
  them together (AC1 to AC4, AC6 to AC9, AC11, AC14, AC15, AC21).

### Flags from other decisions, checked

- **D-086:** both new kinds are content-free at the push port (AC1).
- **D-087:** both are non-critical; M3's adapter maps the level from the
  kind.
- **D-091:** no credential is created; the route admits test devices only.
- **D-103:** the close needs no event ID: a repeat is a 409 and writes
  nothing.
- **D-106:** no read route; the walker's and the responders' screens read
  who closed it in M3.
- **D-108:** the outbox stays our own table; the expiry bounds its own waits.
- **D-111, D-113, D-116:** unsent lost-contact pushes, notices and SMS are
  withdrawn on both resolutions; every responder is stood down, but the
  closer (the story).
- **D-112, D-114:** the journey's row first; one acknowledger; one 404.
- **D-115, item 5:** no stand-down SMS for either resolution.
- **D-122, D-123:** a reset leaves nobody able to close; a resolved alert
  keeps its acknowledger; an unheard alert is resolved at 24 hours.
- **D-014:** no text is sent; the words come in M3, bokmål first.

## Out of scope

- **The app's "They're safe" button, its confirmation, and its words** (M3,
  D-014).
- **The walker's screen after a close or the 24-hour end**, and how the app
  learns who closed it (a read route, D-106). M3.
- **The responders' screens**, the closer's name in them (M3, D-106).
- **The two-hour stop itself** (the two-hour story, M3), with SM-05's test
  against it (Q1).
- **Telling the walker by push** (Q2 (a)); telling the owner at the 24-hour
  end.
- **Reopening a closed alert, or another responder objecting to a close:**
  in no story.
- **The notification level and the real push adapter** (M3).
- **Retention** of the new resolutions, end reasons and stand-downs (the
  retention rule, M4), and the DPIA.

### Left for later tasks

Each is named so the task that owns it finds it. None blocks this task.

- **Task 9 (the canary):** its journeys end through "I'm home" well within
  24 hours, so the 24-hour end never touches them. It does not close alerts.
- **M3, the two-hour stop:** its end reason joins `JOURNEY_END_REASONS`, which
  fails SM-05's pinned table until its row says it ends `ACTIVE` only; its
  own L6 test that a `LOST_CONTACT` journey past two hours and ten minutes is
  not ended; `05-architecture.md`'s "auto" row.
- **M3, the app:** a confirmation before "They're safe" (the F10 twin); the
  button only on the acknowledger's alert screen; 200 and 409
  `ALERT_RESOLVED` both meaning "over"; the walker's screen on reconnect
  (from the heartbeat's 409 and a read), saying who closed it or that it
  ended after 24 hours, and that they are no longer followed; the words of
  `SAFE` and `EXPIRED`, bokmål first.
- **M3, the push task:** `SAFE` and `EXPIRED` mapped non-critical; D-113's
  amendment's real-phone test covering every non-critical kind, these two
  included.
- **M4:** retention of the new rows and values; deleting a member who closed
  an alert that is still kept (`acknowledged_by`); the DPIA.
- **M6:** how often the 24-hour end triggers, and how often closes are
  followed by a new journey within minutes (a sign of mistaken closes).

## Settled by the plan, so not asked

- **Only the acknowledger may close** (the story, D-034), **the current one**
  (SM-10, D-123).
- **Closing ends the journey** (the story, SM-06).
- **The others are told, by a content-free push, and the closer is not**
  (the story: "tells the other responders"; D-086). Who closed it is read in
  the app (D-106).
- **The 24-hour end is in this task** (D-090 item 7, D-122 item 3), **counted
  from the alert's opening, with every responder told** (SM-06).
- **No stand-down SMS** (D-115 item 5), for both new resolutions. Read as
  covering every resolution: its reason, an SMS per responder for a message
  the app can carry, holds for both.
- **Non-critical** (D-087).
- **Unsent pushes, notices and SMS withdrawn on resolution** (D-111, D-113,
  D-116).
- **An unheard alert is resolved at 24 hours, and the page clears** (D-122
  item 3).
- **The route's answers** follow D-114's one-404 rule; the 403 is delegated
  (approach item 5), since it tells a responder nothing they cannot already
  learn from "I'm on it"'s 409.
- **A confirmation step** is the app's (M3): the server cannot tell a
  deliberate tap from an accidental one.
- **The journey's row first; one transaction; database time** (D-112, AR-05,
  REL-01).

## Where the plan disagrees with itself

Said here rather than chosen silently. How each was settled is at its end.

1. **The roadmap's row 8 does not name the 24-hour end; D-090 and D-122 put
   it here.** The "done when" lists the close and SM-05; D-090's item 7 gives
   the task SM-06 whole, and D-122 item 3, the owner's, says "SM-06's 24-hour
   rule (task 8)". This spec builds it, at L6. *Settled:* the roadmap row
   names it (D-125).
2. **SM-05 guards a stop M2 does not build.** The roadmap asks for "the 2-hour
   stop never ends a lost-contact journey … at L6", and the two-hour story is
   M3's. **Q1.** *Settled:* Q1 (a), D-125.
3. **D-033's journey table has no row for a journey ended by a responder or
   by time,** and its states line says "ENDED (reason: home or auto)", where
   "auto" is the two-hour stop's (M3) and the code has `HOME` only. This task
   adds `SAFE` and `EXPIRED`. D-033 is delegated, so the reading is Claude's
   to record (approach item 13). *Settled:* D-126; `05-architecture.md`
   draws the two rows.
4. **D-111 stands down "every responder"; the story tells "the other
   responders".** Read with the story: the closer, who has the 200, gets no
   stand-down; every other responder does. The 24-hour end tells every
   responder, the acknowledger included. *Settled:* D-126.
5. **D-115 item 5 speaks of "an escalated alert" resolving.** Read as every
   resolution (Settled, above). *Settled:* D-126.
6. **D-114 reads a missing half toward sending; this task reads it toward
   refusing.** Not a contradiction: each reads it toward the safe direction
   of its own action (approach item 2). Stated so a reviewer does not take
   one for a slip.
7. **Task numbers drift.** LOST-03's and LOST-06's specs call this "task 7";
   it is task 8 since D-115 (D-122's consequences note it). *Settled:* each
   spec carries a dated note.
8. **SM-06's first clause was delivered by LOST-03 under SM-04**, but no test
   names SM-06. AC13 names it; nothing about the path changes.

No other contradiction with a decision was found: D-019, D-033, D-034, D-086,
D-087, D-090, D-091, D-103, D-106, D-108, D-110 to D-116, D-122 and D-123 were
each read against this design.

## Questions for the owner

**Answered (the owner, 2026-10-09, D-125):** Q1 (a), SM-05 guarded now; Q2
(a), recorded now and shown on reconnect, with no push to the walker. Each was
the recommendation, so no criterion changes. The questions stay below as they
were asked.

Two questions, each scope or safety. The criteria are written on each
recommended answer.

### Q1 — How is SM-05 ("the two-hour stop never ends a lost-contact journey") delivered in M2, when the two-hour stop is built in M3?

**Why it is asked.** The roadmap's "done when" for this task asks for SM-05
"at L6". The stop it guards (ask the walker at two hours, end after ten
minutes with no answer) is the two-hour story, an app story in M3. In M2
nothing ends a journey automatically, so there is nothing for SM-05 to stop.
What M2 delivers for it is a scope choice.

**Options:**
- **(a) Guard it now; the stop's own test comes with the stop.** This task
  holds, at L2 and L6, that nothing automatic ends a lost-contact journey
  before 24 hours: swept at two hours, two hours ten minutes and onwards, it
  stays lost, its alert open. A pinned table of end reasons makes the task
  that adds the stop fail a test named SM-05 until its reason says it ends
  `ACTIVE` journeys only, with its own L6 test. SM-05 shows as covered from
  this task.
- **(b) Build the server half of the two-hour stop now:** a two-hour check
  in the sweep, an end reason, a message to responders, and the ten-minute
  answer window, with no app to ask the walker. It brings questions of its
  own (what "no answer" means with no app, what the responders are told) and
  a task's worth of work.
- **(c) Move SM-05 to M3**, to the two-hour story's task. D-090's item 7 and
  the roadmap's row 8 change; M2's exit loses it.

**Recommendation: (a).**
- It proves what can be proved in M2: the only automatic end there is never
  reaches a lost-contact journey early.
- It makes forgetting impossible: the stop cannot be added without meeting
  SM-05's test.
- (b) builds a walker-facing feature without the walker's side; (c) leaves
  M2 without the rule the roadmap names.
- Its cost: SM-05 reads as covered before the stop exists. The coverage
  report cannot say "guarded, not yet tested against its trigger"; the spec
  and "Left for later tasks" say it.

**If answered otherwise:**
- **(b):** a new journey event, end reason and message kind; a walker
  answer route or a fixed ten minutes; AC12 becomes the stop's own test; two
  more questions before the criteria; the `domain` and `alerts` mutants
  grow.
- **(c):** AC12 keeps only its L2 property and the 24-hour boundary, names
  SM-06 and not SM-05; the roadmap row and D-090 are amended.

### Q2 — When a responder closes the alert, or the 24-hour end ends the journey, is the walker told by push now?

**Why it is asked.** The story says that when the walker's phone reconnects,
the walker "sees that the journey was closed by that responder". A walker who
was not safe, and whose journey was closed, must learn they are no longer
followed. How they learn it is a safety and scope choice.

**Options:**
- **(a) Recorded now; the app shows it on reconnect (M3).** The server keeps
  how and when the journey ended and who closed it (approach item 3). The
  walker's phone, on reconnecting, gets 409 `JOURNEY_ENDED` for its next
  heartbeat, and the app (M3) reads and shows what happened. No message to
  the walker.
- **(b) Also a non-critical push to the walker now,** written with the
  close or the 24-hour end, delivered when the phone is back. It is held back
  in M3 on each platform until D-113's real-phone test passes, since the
  walker's phone may hold an undelivered critical alert for someone else's
  journey.
- **(c) As (a), and the heartbeat's 409 carries how the journey ended**, so
  the app needs no read. A contract change on the heartbeat route.

**Recommendation: (a).**
- The story asks for what the walker sees on reconnecting, and a
  reconnecting phone is talking to the server: the heartbeat's 409 is the
  moment, and the app is where it is shown.
- A phone that stays dead cannot be told anything; one whose app was killed
  has the force-quit reminder telling the walker protection stopped.
- (b) adds a kind and a journey message the M3 push task would gate anyway;
  it can be added then if the real-phone tests show a gap.
- (c) is M3's to choose, with the screen that uses it.

**If answered otherwise:**
- **(b):** a new journey message kind to the walker (as `NO_RESPONDER`), in
  `JOURNEY_MESSAGE_KINDS` and `PUSH_KINDS`; AC6's "no message to W" inverts;
  AC1 and AC8 gain the walker's message; the migration gains one more value.
- **(c):** the heartbeat contract's 409 gains a field; its sha256 pin and
  LOST-01's contract tests change under RG-03; AC5 gains it.
