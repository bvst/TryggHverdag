# LOST-07 · SMS escalation: an alert nobody acknowledges within two minutes reaches every responder by SMS, and a failed SMS pages the owner

**Milestone:** M2, task 6 of 9 (D-090; D-115 added task 7, the resumed-escalation rule's task) · **Delivers:** LOST-07 and REL-07,
their server half, against a recording SMS fake · **Decisions:** D-013,
D-014, D-016, D-019, D-021, D-022, D-024, D-031, D-033, D-036, D-052, D-074,
D-075, D-079, D-086, D-087, D-090, D-091, D-095, D-098, D-099, D-100, D-102,
D-103, D-106, D-107, D-108, D-109, D-111, D-112, D-113, D-114 · **Written:** 2026-10-07 by `planner`,
outside the repository, against LOST-06's branch
(`claude/busy-faraday-40n2zl` at `5925938`, pull request #66). #66 was
squash-merged unchanged as `e695e8a`, whose tree is identical, so every file
named below reads the same on `main` · **Status:** Spec,
settled. The owner answered Q1 to Q5 on 2026-10-07, each with the
recommended answer (D-115), so the criteria stand as written.

## Requirement

### The rule this task delivers

**LOST-07** (`docs/plan/01b-mvp-scope.md`, LOST section, 7th story, Must). Its
second bullet names the no-location rule by its ID in the original; here it is
replaced by a name, for the reason under "How this spec names requirements":

> **LOST-07 · SMS escalation** (Must — D-019)
> - If no responder acknowledges a lost-contact alert within 2 minutes, every
>   responder on the journey gets an SMS.
> - The SMS says who and what happened and asks the responder to open the app.
>   It contains no location ([the no-location-in-SMS rule]).
> - Escalation stops as soon as anyone acknowledges.
> - If an SMS can't be sent, the owner is alerted.
> - Tests: with no acknowledgement, an SMS goes to every responder after
>   2 minutes; with an acknowledgement at 1 minute, no SMS is sent.

**REL-07** (`03-safety-reliability-security.md`, reliability table, 7th row;
binding under D-022). LOST-06 delivered its first sentence and left the rule
unclaimed: "D-090 gives it to task 6, whose SMS is its second sentence". This
task claims it:

> Alerts need acknowledgement ("I'm on it", LOST-06). If no responder
> acknowledges within 2 minutes, every responder on the journey gets an SMS
> (LOST-07, D-019).

### The owner's scope (D-090, item 6, and the roadmap)

D-090, item 6 (accepted by the owner, 2026-10-01), with one ID replaced by its
name:

> **LOST-07 — SMS escalation** at 2 minutes (REL-07); a recording SMS fake;
> a failed SMS pages the owner; [the resumed-escalation rule]; SM-02's
> last-responder warning (with D-087's flag).

`docs/plan/10-roadmap.md`, "M2 — Core safety loop in detail", row 6, **done
when:**

> The escalation and the page pass at L6 against a recording SMS fake

L6 is "Complete flows through the real API with recording fakes for push and
SMS and a controlled clock: LOST-02, LOST-07, SM rules"
(`06-testing-strategy.md`, the levels table).

**Two items of D-090's list have no trigger in M2** (the resumed-escalation
rule and SM-02's last-responder warning: both start when a responder leaves or
is removed during a journey, and nothing in M2 can do that). Where they go is
**Q1**. The criteria below are written on its recommended answer, (b): this
task is the escalation, the SMS fake and the page, and the two rules follow as
their own M2 task.

### What the plan fixed around it

- **D-019** (owner): "A lost-contact alert goes out as a push notification. If
  no responder taps 'I'm on it' within 2 minutes, every responder on the
  journey gets an SMS." Consequences: "An SMS provider inside the EEA with a
  data processing agreement (Section 4). A small per-message cost. SMS messages
  carry no location".
- **The no-location-in-SMS rule** (`03-safety-reliability-security.md`,
  reliability table, 12th row; binding under D-022): "Escalation SMS messages
  contain no location, because SMS is not encrypted. They say who and what
  happened, and point to the app."
- **The provider** (D-086, accepting Section 4's five proposed defaults as
  written; `04-tech-stack.md`, finding 8): "SMS via LINK Mobility, with an
  alphanumeric sender name". Wholesale price about €0.05 per SMS.
- **When the real SMS comes** (`10-roadmap.md`): M2 is "fake push and SMS"; M3
  is "real push to the owner's phone; SMS to the owner's own number only", with
  the owner action "SMS provider account (LINK Mobility)", A-12, in M3.
- **The alert states** (`05-architecture.md`, binding under D-033): "`OPEN` →
  `ESCALATED` (no acknowledgement within 2 minutes; SMS sent, LOST-07) →
  `ACKNOWLEDGED` → `RESOLVED` … An `OPEN` alert can also go straight to
  `ACKNOWLEDGED` … or `RESOLVED`".
- **The data model sketch** (`05-architecture.md`): `alerts` holds "State,
  opened, escalated, acknowledged by, resolved"; `outbox` holds "Push and SMS
  messages waiting to be sent, attempts, next try"; `devices` holds "Platform,
  push token, alert readiness". No table in the sketch holds a phone number.
- **AR-02:** "The database, clock, push, SMS and map tiles sit behind
  interfaces, and each has an in-memory fake in the test kit." **AR-05:** "a
  state change and the messages it causes (push, SMS) are saved in the same
  database transaction."
- **Responder setup** (GRP section, 4th story; M3): "The responder confirms
  the phone number used for SMS escalation."
- **F6** (`03-safety-reliability-security.md`): "Alert not noticed (push
  delayed, phone on silent, responder asleep) | **Missed alert — the core
  promise fails silently** | Break-through notifications, acknowledgement,
  escalation". Research finding 4: "a lost-contact alert that relies on one
  push message alone can fail silently."
- **The threat model:** "What we protect: … group membership and phone
  numbers; the ability to end journeys and to silence alerts."
- **PRIV-07:** "Logs and error reports never contain precise locations or
  phone numbers." **D-016:** personal data stored and processed inside the
  EEA, with a data processing agreement for every provider.
- **D-024:** running costs, SMS included, between €30 and €100 a month in the
  private phase.

### Inputs this spec builds on

- **D-079:** Healthchecks.io watches the worker (Hobbyist, $0; Period 1 min,
  Grace 2 min); a monitoring setting never stops the worker; the ping URL is a
  secret, `https:` only, redirects not followed, never written. Both monitors
  alert the owner by email (A-08, accepted "for now"). Healthchecks.io Business
  ($20 a month, SMS and phone-call alerts) is a go-live question.
- **D-086:** push messages carry no personal data. **D-087:** only the
  lost-contact alert uses the critical level; among the tests M3 owes, "exactly
  one lost-contact message per responder per event, across the SMS escalation
  … and the watchdog run twice" and "no further critical push follows the SMS
  — the same L6 test, running time past the 2-minute SMS".
- **D-091:** before the login task, device credentials come only from tests
  and, on staging, the canary; no people data is stored before that task
  designs the people tables.
- **D-107:** the sweep runs every 10 s. **D-108:** the outbox is our own table;
  claim with a 30 s lease, send outside any transaction, mark; retries from
  10 s, doubling, capped at 60 s; the watchdog feeds the beat, so a sweep that
  fails pages the owner; "only the sweep loop is watched. A wedged or
  always-failing delivery pages nobody." **D-109:** a process starts anyway,
  loudly, when its limits are not in force.
- **D-111:** when an alert resolves, its unsent lost-contact messages are
  withdrawn, every responder is stood down, and "Task 6's SMS messages are
  withdrawn the same way when an alert resolves."
- **D-112:** one helper resolves an alert, whatever its state; the journey's
  row first, always; the open withdraws `ALERT_RESOLUTIONS`' kinds, and "a
  future stand-down kind that is not a resolution (an SMS stand-down in task 6,
  say) must opt in deliberately: task 6 decides."
- **D-113, D-114:** "I'm on it" is recorded on the alert (`acknowledged_by`,
  `acknowledged_at`); every other responder gets an `ACKNOWLEDGED` notice; two
  withdrawal lists, every kind in exactly one; the resolve helper holds each
  responder's stand-down behind that responder's withdrawn messages still in a
  port's hands. D-114's consequences, for this task: "Task 6 reads
  `alerts.state`, `acknowledged_at` and `acknowledged_by`, and adds the
  withdrawal of an acknowledged alert's unsent SMS and its own kinds to the
  withdrawal lists. It escalates an unresolved alert unless `state =
  'ACKNOWLEDGED'` and `acknowledged_by is not null` … It also decides the
  outbox's unique key for a second acknowledgement after the resumed-escalation
  rule."
- **AR-03** (no clock in domain or module code), **AR-04** (one state machine
  module; the domain decides under the lock), **AR-05**, **AR-06** (an
  idempotent, lock-safe watchdog).

### What earlier tasks left for this one

| Left for task 6 | Where it was left | Where it is met |
|---|---|---|
| Escalate unless `state = 'ACKNOWLEDGED'` **and** `acknowledged_by is not null`, so a missing half sends the SMS | D-114; LOST-06's spec, "What escalation to SMS (task 6) will read" | Approach item 2; AC3 |
| The acknowledgement withdraws the alert's unsent SMS (LOST-06's approach item 4, step 4) | LOST-06's spec | Approach item 5; AC6 |
| Place the SMS kind in a withdrawal list; pin which kinds each withdrawal touches | LOST-06's AC13; LOST-03's review loop 1 | AC14 |
| "The open's withdrawal list is the resolution enum, so an SMS stand-down needs its own list" (`WITHDRAWN_WHEN_OPENED`) | LOST-06's spec, from `code-reviewer`; D-112, loop 3 | No SMS stand-down (**Q5**, recommended (a)), so the open's list stays `ALERT_RESOLUTIONS` and nothing new joins it. The escalation SMS is an alert's message, not a stand-down: it goes in `WITHDRAWN_WHEN_RESOLVED` (AC14). Under Q5 (b) the domain gains `WITHDRAWN_WHEN_OPENED` (Q5's "If answered otherwise") |
| "The stand-down's hold sees only what the resolution withdraws": an SMS the acknowledgement withdrew earlier, still in a port's hands, does not hold a later stand-down | LOST-06's spec, from `code-reviewer` | Decided: it stays that way. The hold still covers every SMS the resolution itself withdraws. Past either port, no order across two providers is promised, and the app shows the alert's current state (M3). Approach item 6; Risks |
| `alertTransition` returns to a `switch` with a second event | LOST-06's spec | Approach item 2; AC13 |
| The outbox's unique (alert, recipient, kind) meets a second acknowledgement after the resumed-escalation rule's reset | LOST-06's spec; D-114 | With that rule (**Q1**). Recommended design, recorded for its task: a round number on the alert, copied onto each message, in the unique key ("Left for later tasks") |
| D-033 draws no edge back from `ACKNOWLEDGED`, nor from `ESCALATED` or `ACKNOWLEDGED` to `RESOLVED` | LOST-06's spec; D-114 | `ESCALATED` → `RESOLVED` becomes real here (contact back after the SMS). The edge back from `ACKNOWLEDGED` is the resumed-escalation rule's (Q1). "Where the plan disagrees with itself", item 1; a delegated decision records the reading (approach item 14) |
| No SMS for a `RESOLVED` alert; unsent SMS withdrawn as the lost-contact ones are | LOST-03's spec; D-111 | AC7 |
| The SMS insert uses `resolveInside`'s typed kind cast, not a literal | LOST-06's spec | Approach item 4 |
| Who gets the stand-down once a responder can be removed; the store's `ALERT_NOT_FOUND` under the lock once a responder can be removed | LOST-03's spec; LOST-06's spec | With the removal (**Q1**) |
| "No further critical push follows the SMS"; "exactly one lost-contact message per responder per event, across the SMS escalation" | D-087 (tests M3 owes) | The server half here: the escalation writes no push message (AC1, AC4, AC8). M3's tests, with the critical level and the collapse ID, stay M3's |
| "Only the sweep loop is watched" | D-108's amendment | SMS delivery is watched from here (the page, AC10 and AC11). Push delivery stays the canary's (task 9) |

`docs/progress/m2.md`'s "Left for later tasks" lists for LOST-01, LOST-02,
LOST-03 and LOST-06 were read for anything sent to task 6. Each item is in the
table.

### What exists today, and what does not

Read on 2026-10-07, in the files themselves:

- **Nothing writes `ESCALATED`.** `ALERT_STATES` lists it; the code writes
  `OPEN`, `ACKNOWLEDGED` and `RESOLVED`. `alerts` has no escalation time.
- **The domain's lists:** `MESSAGE_KINDS` is `LOST_CONTACT`,
  `BACK_IN_CONTACT`, `HOME`, `ACKNOWLEDGED`; `WITHDRAWN_WHEN_RESOLVED` is
  `LOST_CONTACT`, `ACKNOWLEDGED`; the open withdraws `ALERT_RESOLUTIONS`;
  `ALERT_EVENTS` is `['acknowledge']`, and `alertTransition` is a table of
  rules (`ALERT_RULES`) with an `Object.hasOwn` guard, not a `switch`.
- **No SMS port, no SMS fake, no alarm port.** `ports.ts` has `Push` and
  `CheckIn`. The test kit has `fakePush()` and `fakeCheckIn()`.
- **One claim, every kind.** `claimDue` takes every due message, whatever its
  kind, and the one sender hands each to the push port.
- **The worker** has two loops (sweep, delivery), `UNCONFIGURED_PUSH`
  (`NOT_CONFIGURED` for every message), one minute task on Graphile's cron
  (`HEARTBEAT_CRONTAB`, the Healthchecks.io check-in), and the start lines its
  tests count: one line containing "Healthchecks.io", one saying no push
  provider is configured.
- **No phone number anywhere.** `users` holds an ID and a creation time
  (`schema.ts`: "nothing in this table says who anyone is"). LOST-06-AC10's L3
  test holds that no column of `alerts` or `outbox` is named like a phone
  number or a name.
- **Nothing removes a responder from a journey.** No route, module or store
  method; the test kit's `removeResponders` is test setup ("nothing in the code
  removes one").
- **The log** has twelve closed events. **Migrations** `0000` to `0005`.
- **Coverage** (`docs/requirements-status.md`, regenerated on this branch):
  LOST-07 and REL-07 have no test.

### Readings this spec makes

Each is stated so the reviewers can check it, not assumed quietly.

1. **"A lost-contact alert"** is a row of `alerts` (one per silence, LOST-02).
2. **"Within 2 minutes"** counts from the alert's `opened_at`, the database's
   `now()` in the transaction that opened it, on the database's clock (REL-01,
   AR-03). Not from the push's delivery: a push that is slow, refused or not
   configured must never delay the SMS, which exists for exactly that case.
   Counted "or more", as D-021 counts five minutes: an alert unacknowledged
   for 120 000 ms is escalated; at 119 999 ms it is not. Changing the two
   minutes needs the owner (D-019), as changing the five does (D-021).
3. **"Acknowledges"** is D-114's: `state = 'ACKNOWLEDGED'` and
   `acknowledged_by is not null`. Any other unresolved alert is escalated: a
   missing half fails toward sending the SMS.
4. **"Every responder on the journey"** is every `journey_responders` row of
   the alert's journey when the escalation is written, whatever their push
   did, the ones whose push was accepted included (D-019). Never the walker,
   who is never a responder. Once per alert.
5. **"Gets an SMS"**, in M2: one message of a new kind, `LOST_CONTACT_SMS`,
   per responder, written in the transaction that moves the alert to
   `ESCALATED` (AR-05), and delivered to the SMS port by a sender of its own.
   It counts as sent only when the port accepted it, as a push does (D-108).
   So `ESCALATED` means "escalated: its SMS written", not "delivered"
   ("Where the plan disagrees with itself", item 2).
6. **"Escalation stops as soon as anyone acknowledges."** Before the two
   minutes, the alert is never escalated. After them, the acknowledgement
   withdraws every SMS of the alert not yet accepted by the port, in its own
   transaction. An SMS already in the provider's hands cannot be recalled: it
   finishes, is marked as the port answers, and is never retried.
7. **A resolved alert is over.** It is never escalated, and its resolution
   withdraws its unsent SMS with its unsent lost-contact pushes (D-111).
8. **"If an SMS can't be sent, the owner is alerted."** An SMS that is still
   unsent and not withdrawn 60 s after it was written counts as failing,
   whatever the cause: the port refused it, has no number for the recipient,
   threw, never answered, is not configured, or the SMS loop has stalled.
   While any is failing, the worker tells the owner's monitor so once a
   minute; when none is, it says so. A failure that a retry fixes within 60 s
   is not a page: that SMS was sent.
9. **"The SMS says who and what happened … contains no location"**, in M2:
   nothing composes text. The SMS port is handed the message's opaque ID, the
   recipient's user ID and the kind, as the push port is (D-086), so no
   location, name or number can reach it. The text, the name in it and the
   number it goes to are the M3 adapter's (Q3, Q4).
10. **The SMS goes even when the push cannot.** In M2's real worker every push
    is `NOT_CONFIGURED`; the SMS is written all the same.
11. **The resumed-escalation rule and SM-02's last-responder warning:** Q1.

### How this spec names requirements, and why

The `traceability` job runs `req:coverage --fail-on-uncovered-changed`, which
fails if a changed spec names a tracked requirement, or an acceptance
criterion, that no test names; `mentions` matches an ID anywhere in the text
(LOST-06's spec; the live gotcha in `docs/progress.md`). `req:coverage` was not
run here.

- **Delivered here, and must be named by a test:** LOST-07 and REL-07, both
  uncovered today.
- **Cited, already covered, and not claimed:** LOST-01, LOST-02, LOST-03,
  LOST-06, REL-01, REL-08, SEC-07, PRIV-07, SM-02, SM-04, SM-07, SM-08, SM-09.
  Some criteria strengthen them, and their tests name them (test plan).
- **Not claimed: the no-location-in-SMS rule.** Its first half holds here by
  construction (no text reaches the port); its second half, what the SMS
  says, is M3's adapter. Claimed now, it would show as covered with its text
  untested.
- **Not claimed: the resumed-escalation rule** (Q1).
- **Untracked, named freely:** AR-, D-, F-, RG-, INF-, BUG-, A-, HK-, CI-
  and L- IDs (D-074).
- **Every other tracked requirement is named in words**, here, in product
  code and in its comments.

| Name used here | Where it lives |
|---|---|
| the no-location-in-SMS rule, the alert-level rule, the canary rule | `03-safety-reliability-security.md`, reliability table, 12th, 6th and 10th rows |
| the abusive-member threat | same file, threat model, 2nd row |
| the resumed-escalation rule, the 24-hour rule, the two-hour stop | `05-architecture.md`, edge-case rules, 10th, 6th and 5th rows |
| "They're safe" | `01b-mvp-scope.md`, LOST section, 8th story (task 8) |
| the login task, responder setup | GRP section, 1st and 4th stories (M3) |
| the retention rule, the export rule, the DPIA rule | `02-norway-law-privacy.md`, privacy table, 4th, 9th and 11th rows |

**Partial delivery shows as full.** Once tests name them, LOST-07 and REL-07
show as covered. These halves remain, and "Out of scope" lists each: the real
SMS adapter, its text and its number (M3); the provider's data processing
agreement (M3); the resumed-escalation rule and SM-02's last-responder warning
(Q1); D-087's tests owed in M3, which list LOST-07 and REL-07 among their
carriers; and the canary's use of all this (task 9).

## Approach (technical choices delegated to Claude, D-031)

1. **Where the code goes, and why there.**
   - **The rule:** `domain/journey.ts` gains the second alert event, its rule,
     the new kind and its lists. AR-04 keeps every transition in one module.
     Owned, filtered, mutated (`domain`).
   - **The sweep's escalation:** `modules/alerts/escalation.ts` (new), called
     by the sweep in `modules/alerts/watchdog.ts`. The escalation is the
     watchdog's second job: a sweep that cannot escalate must fail and stop the
     beat, which is what makes it loud (D-108). The folder is owned, filtered
     and in `SAFETY_PATHS`; a new folder would mean editing `ai-review.yml`,
     which only a hand merge can carry (D-075).
   - **The SMS sender:** `modules/alerts/outbox.ts` gains `createSmsSender`,
     sharing claim, send and mark with the push sender.
   - **The page:** `modules/alerts/sms-check.ts` (new), the minute check; the
     Healthchecks.io report in `adapters/healthchecks.ts` (owned, safety path,
     its own mutation group); the setting in `config.ts` (unowned, as D-079
     left it: a monitoring setting must never stop the worker).
   - **The SQL:** `adapters/journeys.ts`: the escalation's read and write, the
     SMS claim and the failing-SMS count, and the acknowledgement's withdrawal.
     Owned, filtered, proven at L3 (D-095).
   - **The wiring:** `worker.ts` (the SMS loop, `UNCONFIGURED_SMS`, the minute
     task, the start lines) and `bin/worker.ts` (the setting).
   - **Infrastructure:** `infra/staging/variables.tf` and `main.tf`, and
     `.github/workflows/infra-staging.yml`, as INF-08 did for the worker's
     check (Q2 (a)).
   - **Unchanged:** `api.ts`, `api-process.ts`, `http.ts`, the contracts,
     `modules/journeys/`, `modules/health/`, `modules/alerts/acknowledgement.ts`,
     `domain/` apart from the two files above, the open (`openInside`),
     `adapters/db.ts`.

2. **The rule (`domain/journey.ts`).**
   - **The lists:**
     - `MESSAGE_KINDS` gains `LOST_CONTACT_SMS`, last;
     - `SMS_KINDS = ['LOST_CONTACT_SMS']` and `PUSH_KINDS = ['LOST_CONTACT',
       'BACK_IN_CONTACT', 'HOME', 'ACKNOWLEDGED']`, each `satisfies readonly
       MessageKind[]`; every kind is in exactly one of the two, held by a test
       that names a kind placed in neither or both. The kind names its channel
       because the unique (alert, recipient, kind) must allow one push and one
       SMS per responder per alert, and because the push claim must never be
       able to hand an SMS to the push port;
     - `WITHDRAWN_WHEN_RESOLVED` gains `LOST_CONTACT_SMS` (D-111);
     - `WITHDRAWN_WHEN_ACKNOWLEDGED = ['LOST_CONTACT_SMS']`, a subset of
       `WITHDRAWN_WHEN_RESOLVED`, held by a test;
     - the open's list stays `ALERT_RESOLUTIONS` (Q5 (a));
     - `ESCALATE_AFTER_MS = 120_000`, beside `LOST_CONTACT_AFTER_MS`,
       "changing it needs the owner" (D-019);
     - `ALERT_EVENTS = ['acknowledge', 'escalate']`.
   - **`alertTransition` returns to a `switch` with a `never` default**, as
     `transition` has, now that two cases exist (LOST-06's approach item 2).
     Overloads as `transition` has them: each event with the situation it
     needs, and one general overload the table test reads.
   - **The escalation's situation and event:** `AlertForEscalation { id,
     state, acknowledgedBy, smsRaisedAt }`; `EscalateEvent { type: 'escalate',
     openedAt, now }`, both database times handed in, as the silence event
     carries its two.
   - **The rule, in its order:**
     1. no alert → unchanged;
     2. `RESOLVED` → unchanged;
     3. `state === 'ACKNOWLEDGED'` and `acknowledgedBy !== null` → unchanged;
     4. `smsRaisedAt !== null` → unchanged (already escalated);
     5. `now − openedAt ≥ ESCALATE_AFTER_MS` → `{ type: 'escalated', state:
        'ESCALATED' }`;
     6. otherwise unchanged.
     A comparison with a time that is not one never holds, so an invalid moment
     escalates nothing, as the silence rule's never alerts (the adapter's
     `databaseTime` throws before one could arrive, which fails the sweep).
   - **What it escalates, by state:** `OPEN`; `ESCALATED` with no escalation
     time (put in directly, as from before migration `0006`); `ACKNOWLEDGED`
     with nobody recorded (a state the code never makes); and `OPEN` or
     `ESCALATED` with someone recorded (a half-done reset). Each goes to
     `ESCALATED`. The acknowledgement rule is unchanged: an `ESCALATED` alert
     can be acknowledged, as LOST-06 built.
   - Pure, total over its lists, and no clock.

3. **The sweep (`modules/alerts/watchdog.ts`, `escalation.ts`).** After the
   opens, before the beat:
   1. read the alerts due (`alertsDueForEscalation(ESCALATE_AFTER_MS)`): every
      unresolved alert with no escalation time, not acknowledged in D-114's
      sense, opened `ESCALATE_AFTER_MS` or more before the database's now(),
      without locking, with that now() from the same statement;
   2. ask the rule about each, and go on only for one it escalates
      (defence in depth, as the open's read is checked again);
   3. escalate each in a transaction of its own (`escalateAlert`); a row
      someone holds is skipped, never waited for;
   4. for each alert skipped there whose two minutes passed `STUCK_AFTER_MS`
      ago or more, try once more, waiting at most `LOCK_WAIT_LIMIT_MS`; held
      through the wait, or failed, it is stuck: one `escalation_overdue` line
      naming it, and the sweep fails;
   5. a read or an escalation that fails is one `escalation_failed` line with
      its stage and SQLSTATE, and fails the sweep.
   - A failed sweep records no beat (D-108): a watchdog that cannot escalate
     pages the owner through the worker's existing check, as one that cannot
     open does.
   - `SweepResult` becomes `{ ok, opened, escalated, stuck }`; `stuck` counts
     journeys and alerts.
   - It reads no clock (AR-03).

4. **The store's escalation (`escalateAlert`), one transaction,** as the open
   is written:
   1. `set_config('lock_timeout', …, true)`: `lockWaitMs`, or
      `LOCK_WAIT_LIMIT_MS` without it (every open bounds its own waits, D-108;
      the worker's pool has no lock limit);
   2. **the journey's row first** (D-112): `select … from journeys where id =
      (select journey_id from alerts where id = $a) for update`, with `skip
      locked` unless `lockWaitMs` is given; no row → `skipped`;
   3. **under that lock**, read the alert's state, acknowledger, escalation
      time and opened time, with this transaction's now(), and ask the rule
      (AR-04); anything but `escalated` → `skipped`, writing nothing;
   4. `update alerts set state = 'ESCALATED', sms_raised_at = now() where id =
      $a and state <> 'RESOLVED' and sms_raised_at is null and not (state =
      'ACKNOWLEDGED' and acknowledged_by is not null)`: exactly one row, or the
      transaction is rolled back;
   5. one `LOST_CONTACT_SMS` per `journey_responders` row, a new random ID,
      `created_at = now()`, `attempts = 0`, `next_attempt_at = now()`, the kind
      written with the typed cast `resolveInside` uses (`::message_kind`), not
      a literal; none written → throw (a journey with no responder: the open
      refuses one, LOST-02-AC12; nothing in M2 removes a responder);
   6. answer `{ outcome: 'escalated', messages }`.
   - A waiting attempt whose wait for the journey's row ran out answers
     `held`; any other failure is thrown, having written nothing, as the open
     does.
   - **It never holds an `ACTIVE` journey's row** for longer than it takes to
     find the alert resolved: an unresolved alert's journey is
     `LOST_CONTACT` (D-112), which the watchdog's open never takes.

5. **The acknowledgement withdraws the unsent SMS** (`recordAcknowledgement`,
   LOST-06's step 4). After the alert's update, in the same transaction:
   `update outbox set withdrawn_at = now() where alert_id = $a and kind in
   (WITHDRAWN_WHEN_ACKNOWLEDGED) and sent_at is null and withdrawn_at is
   null`. Attempts and the last failure are kept. Every push message is left
   as it was (LOST-06's reading 7). The notices are unchanged. Nothing else in
   `acknowledgement.ts`, the route or the contract changes.

6. **Resolving an escalated alert** (`resolveInside`, unchanged in code). Its
   withdrawal takes `WITHDRAWN_WHEN_RESOLVED`, which now holds the SMS kind;
   its per-responder hold covers every message it withdrew, an SMS in the SMS
   port's hands included, so a responder's push stand-down waits behind it, at
   most 60 s. **An SMS the acknowledgement withdrew earlier does not hold it**
   (the item LOST-06 left): the two ports reach two providers, neither
   promises an order past itself, and the app shows the alert's current state
   (M3). The alert keeps `sms_raised_at`. Every responder gets one push
   stand-down and no SMS (Q5 (a)).

7. **Delivery: a claim, a sender and a loop of its own.**
   - `claimDue` claims the push kinds only (`PUSH_KINDS`); `claimDueSms`
     claims `SMS_KINDS` only, with the same limit, lease, attempt count and
     retry rules. Two methods rather than a `kinds` argument, so that no
     caller of the push claim can be handed an SMS by an argument left out,
     and no existing call changes meaning.
   - `createSmsSender({ outbox, sms, log })`: claim, send outside any
     transaction, mark, as the push sender; a throw counts as `UNAVAILABLE`;
     one `sms_failed` line per message not accepted.
   - **A third loop in the worker**, apart from the push loop, so a push
     provider that never answers never delays an SMS, and the reverse. The
     SMS is the backstop for exactly the night when push is not working. A
     sweep that escalated wakes it at once, as one that opened wakes the push
     loop.
   - **`UNCONFIGURED_SMS`**: every SMS answered `NOT_CONFIGURED` until M3
     brings a provider, and the worker says so once at start. A default that
     answered `accepted` would be a silent miss.
   - **The SMS port is content-free**, as the push port is: `{ messageId,
     recipientId, kind }`. The failure reasons are the push port's four
     (`PUSH_FAILURE_REASONS`), so the outbox's check and the log take one
     list: `NO_TARGET` is "no confirmed number" for SMS. The list keeps its
     name; renaming it would touch every port, test and the table's check for
     no behaviour.

8. **The page** (Q2 (a)).
   - **A port of its own**, `SmsAlarm.report(status: 'ok' | 'failing',
     signal?)`, resolving when the monitor accepted it and rejecting on
     anything else. Not `CheckIn`: that port's only message is "alive".
   - **The adapter** (`adapters/healthchecks.ts`): `ok` is a HEAD to the
     check's ping URL, `failing` a HEAD to the same URL with `/fail` appended,
     Healthchecks.io's documented failure signal (recalled from its
     documentation, not checked here). No body; only a 2xx counts; redirects
     are not followed; its own timeout and the caller's signal; no error
     carries the URL. Everything else as D-079's check-in.
   - **The check** (`createSmsCheck({ outbox, alarm, log })`, run by a second
     minute task on Graphile's cron): reads how many SMS messages are unsent,
     not withdrawn, and were written `SMS_UNSENT_LIMIT_MS` (60 000) or more
     before the database's now() (`unsentSmsCount`); reports `failing` with
     one `sms_unsent` line holding the count when any is, and `ok` when none
     is. A read that fails reports nothing (one `sms_check_failed` line,
     stage `read`), so the check's own silence pages; a report that fails is
     one line (stage `report`), never a thrown task. It does not depend on the
     watchdog's beat: the two say different things.
   - **Why the database's state, each minute, rather than a ping from the
     sender on each failure:** it survives a restart, it repeats until it is
     true, it clears itself, and it also catches the failures the sender
     never sees: a port that never answers, or an SMS loop that stopped.
   - **Why 60 s:** a healthy SMS loop sends within one run (at most 10 s after
     the escalation, less when woken), and one failed attempt is retried after
     10 s and then 20 s. It is a monitoring threshold, delegated; in
     `domain/watchdog.ts`, beside the budget it belongs to.
   - **The setting:** `HEALTHCHECKS_SMS_URL`, read by
     `readHealthchecksSmsSetting`, with the same rules as the worker's URL
     (unset, not a URL, not `https:` → a reason, said once at start, never the
     URL; the worker runs). **The start line does not contain the words
     "Healthchecks.io"**, so INF-08's tests, which count the lines that do,
     keep their meaning; it says "the SMS check".
   - **Infrastructure**, as INF-08's: a Terraform variable
     `healthchecks_sms_url`, required, sensitive, validated as a
     `https://hc-ping.com/` URL; the app's `HEALTHCHECKS_SMS_URL` from it and
     from nowhere else; `TF_VAR_healthchecks_sms_url` from the `staging`
     environment's secret in the plan and the apply jobs, and nowhere else.
     Owner to-dos A-32 and A-33 (Modules and files affected).

9. **The tables** (migration `0006_*.sql`, generated with `pnpm --filter
   @trygghverdag/server db:generate` and committed; additive):

   | Table | Change | Constraints |
   |---|---|---|
   | enum `message_kind` | + `LOST_CONTACT_SMS` | Equals `MESSAGE_KINDS`, in order |
   | `alerts` | + `sms_raised_at` (database time) | None |

   - **Named `sms_raised_at`, not `escalated_at`** (found in the red phase).
     Every form of "escalate" contains "lat", and the privacy scans of the
     tables' column names (LOST-01-AC18, LOST-02-AC13 and AC23, LOST-03-AC9,
     LOST-06-AC10) match "lat" anywhere in a name, as a coordinate. The new
     name passes every scan as it stands, so no privacy test changes. The
     state stays `ESCALATED`; enum labels are not scanned.

   - **The value is added inside the migration's transaction**, as `0004` and
     `0005` add theirs, so `0006` must not use it: `'LOST_CONTACT_SMS'`
     appears only in its `add value` statement. The L3 runs on PostgreSQL 15
     are the evidence (AC19).
   - **No check ties `ESCALATED` to `sms_raised_at`**: rows put in directly
     have the state without the time (D-112's reasoning), and the
     resumed-escalation rule will move a state back.
   - **No index.** The escalation's read filters unresolved alerts, a handful
     at the private group's scale; the failing-SMS count reads the claim's
     partial index (`sent_at is null`). M6 revisits both.
   - **No location, no phone number, no name.** The migration changes no
     existing row; `sms_raised_at` is null on all of them.

10. **The lock order, and every wait bounded (AR-06).** The escalation takes
    the journey's row first, then the alert's row (the update), then the new
    outbox rows, whose foreign keys take key-share locks on the alert's and
    the responders' `users` rows: the order the acknowledgement takes. The
    escalation and the acknowledgement meet on the journey's row, and
    whichever commits first wins (LOST-06's "What escalation to SMS will
    read"). Every wait is bounded by the escalation's own 5 s lock limit and
    the worker's 10 s idle limit (D-108). The SMS claim never waits (`skip
    locked`); its marks hold one row for one statement.

11. **Database time** (AR-03, REL-01). `sms_raised_at`, every SMS's
    `created_at` and `next_attempt_at`, and the failing-SMS count's "60 s
    ago" are the database's `now()`. The fake store emulates `now()` with the
    fake clock it is given, and throws when asked to escalate, claim or count
    without one.

12. **The log** (PRIV-07; `log.ts`, owned under D-102). `LogEvent` gains six
    closed events, and nothing free-form:

    ```ts
    | { event: 'escalation_failed'; stage: 'read' | 'escalate'; code: string | null }
    | { event: 'escalation_overdue'; alertId: string }
    | { event: 'sms_failed'; reason: PushFailureReason; messageId: string }
    | { event: 'sms_delivery_failed'; stage: 'claim' | 'mark'; code: string | null }
    | { event: 'sms_unsent'; count: number }
    | { event: 'sms_check_failed'; stage: 'read' | 'report'; code: string | null }
    ```

    - `createLog` writes `alertId` and `messageId` only as canonical UUIDs,
      `reason` and `stage` only from their sets, `code` only as a SQLSTATE,
      and `count` only as a non-negative safe integer; anything else as null.
    - No event has a field a phone number, a name or a location could travel
      in. No user ID is logged. A successful escalation writes no line: the
      alert's row is its record.

13. **No new dependency** (SEC-06), **no new import route** (AR-10).
    `worker.ts` wires the new modules; the modules get ports only.
    `packages/config/dependency-cruiser.cjs` is unchanged.

14. **Decisions to record** in `docs/plan/decisions.md`, with the next free
    numbers (D-115 on at the time of writing; check the open pull requests'
    `decisions.md` before taking them, as the live gotcha says):
    - **the owner's answers to Q1 to Q5**, one decision or one each;
    - **one delegated decision (D-031)** for the rest: the kind's name and the
      two channel lists; `WITHDRAWN_WHEN_ACKNOWLEDGED`; the escalation in the
      sweep, feeding the beat, with its stuck check; the rule and its order;
      `sms_raised_at` with no state check; the escalation's transaction and
      lock order; the separate claim and loop; the content-free SMS port and
      the shared reasons; `UNCONFIGURED_SMS`; the hold left as it is (approach
      item 6); the page's definition (60 s) and its check; the six log events;
      the `alerts` group's third test file; and **how D-033's alert states are
      read**: `ESCALATED` → `RESOLVED` and `ACKNOWLEDGED` → `RESOLVED` exist
      (D-112, "whatever its state"), and an `ACKNOWLEDGED` alert with nobody
      recorded is escalated. D-033 is itself delegated, so this is Claude's to
      record and the owner's to reopen. The sentence in `05-architecture.md`
      is updated to draw those edges (a docs change; the binding rules are
      unchanged).

### Interfaces the tests are written against (RG-02: tests first)

The implementer may refine a name only with `test-author`, and only before
the tests are written.

- **`domain/journey.ts`:**
  - `MESSAGE_KINDS` exactly `['LOST_CONTACT', 'BACK_IN_CONTACT', 'HOME',
    'ACKNOWLEDGED', 'LOST_CONTACT_SMS']`;
  - `SMS_KINDS` exactly `['LOST_CONTACT_SMS']`; `PUSH_KINDS` exactly the
    other four, in `MESSAGE_KINDS`' order;
  - `WITHDRAWN_WHEN_RESOLVED` exactly `['LOST_CONTACT', 'ACKNOWLEDGED',
    'LOST_CONTACT_SMS']`; `WITHDRAWN_WHEN_ACKNOWLEDGED` exactly
    `['LOST_CONTACT_SMS']`;
  - `ALERT_EVENTS` exactly `['acknowledge', 'escalate']`;
    `ESCALATE_AFTER_MS` = 120 000;
  - `AlertForEscalation`, `EscalateEvent`, `EscalateOutcome` (`{ type:
    'escalated'; state: 'ESCALATED' } | { type: 'unchanged' }`), and
    `alertTransition`'s overloads; the acknowledgement's types unchanged.
- **`domain/watchdog.ts`:** `SMS_UNSENT_LIMIT_MS` = 60 000.
- **`ports.ts`:**
  - `WatchdogStore` gains `alertsDueForEscalation(afterMs)` → `{ now: Date;
    alerts: DueAlert[] }` (`DueAlert`: `id`, `journeyId`, `state`,
    `acknowledgedBy`, `smsRaisedAt`, `openedAt`) and `escalateAlert({ alertId,
    afterMs, lockWaitMs? })` → `{ outcome: 'escalated'; messages:
    AlertMessage[] } | { outcome: 'skipped' } | { outcome: 'held' }`, with
    `lockWaitMs` checked as the open checks it;
  - `OutboxStore`: `claimDue` claims push kinds only; gains
    `claimDueSms({ limit, leaseMs })` → `ClaimedMessages`, and
    `unsentSmsCount(olderThanMs)` → `{ now: Date; count: number }`;
  - `Sms` (`send(message: SmsMessage): Promise<SmsResult>`, `SmsMessage =
    AlertMessage`, `SmsResult = PushResult`) and `SmsAlarm` (`report(status:
    'ok' | 'failing', signal?: AbortSignal): Promise<void>`);
  - the six `LogEvent` members.
- **`modules/alerts/`:** `createWatchdog({ journeys, beats, log }).sweep()` →
  `{ ok, opened, escalated, stuck }`; `createSmsSender({ outbox, sms, log
  }).deliverDue()` → `{ sent, failed }`; `createSmsCheck({ outbox, alarm, log
  }).check(signal?)` → `'ok' | 'failing' | 'unread'`.
- **`worker.ts`:** `UNCONFIGURED_SMS`; `WorkerOptions` gains `sms`,
  `smsSender` and `smsAlarm`; `runWorkerProcess` gains the SMS check's
  setting and its `createSmsAlarm`, as it has `healthchecks` and
  `createCheckIn`.
- **`adapters/healthchecks.ts`:** `healthchecksAlarm({ url, fetch?,
  timeoutMs? })` → `SmsAlarm`. **`config.ts`:**
  `readHealthchecksSmsSetting(env)` → `HealthchecksSetting`.
- **The test kit** (owned, D-100):
  - `fakeSms()`, as `fakePush()`: records every message as given, accepts
    unless told otherwise, `failFor`, `failAll`, `throwWith`, `recover`,
    `holdAnswers`, `releaseAnswers`;
  - a recording alarm fake (its name is `test-author`'s): every report in
    order with its signal, `failWith`, `hang`, `recover`, an `events` list it
    can share;
  - `fakeJourneyStore({ clock })`: the four new store methods, deciding by the
    same rule under its own "lock" (`hold` and `holdUntilWaited` as the open
    meets them); `claimDue` takes push kinds only; `alerts()` and `seedAlert`
    gain `smsRaisedAt`, null until set; its resolution and its
    acknowledgement withdraw their lists; `failWith` and `beforeNext` for the
    new methods; without a clock, it throws when asked to escalate, claim or
    count;
  - its copies of `MESSAGE_KINDS`, `SMS_KINDS`, `PUSH_KINDS`,
    `WITHDRAWN_WHEN_RESOLVED` and `WITHDRAWN_WHEN_ACKNOWLEDGED`, exported so
    the domain's test ties them;
  - `fakeLog()`: the six events;
  - **the shared behaviour suite:** `JourneyStoreUnderTest.store` gains the
    four methods; a reader of its own, `escalationsOf(journeyId)` (alert,
    `smsRaisedAt`), keeps `AlertAsStored`'s shape; `seedAlert` gains
    `smsRaisedAt`, optionally.

## Acceptance criteria

### Escalating (LOST-07, REL-07)

**LOST-07-AC1 — With no acknowledgement, every responder gets an SMS at two
minutes, and nobody else: the story's first test and the roadmap's "the
escalation … at L6".** *(LOST-07, REL-07, LOST-02)*
- **Given** walker W, with device D, starts journey J through the API, naming
  responders R1, R2 and R3, and D sends a heartbeat every 60 s for 10 minutes
  and then nothing, on the fake clock, the loops running every 10 s
- **And** at five minutes the alert opens and the push fake accepts one
  `LOST_CONTACT` for each responder, except R2, whose push fails with
  `NO_TARGET` throughout
- **When** the loops run to 119 999 ms after the alert's `opened_at`
- **Then** the alert is still `OPEN`, with no escalation time, and the SMS
  fake holds nothing
- **When** the clock reaches exactly 120 000 ms after `opened_at` and the loops
  run
- **Then** the alert is `ESCALATED`, `sms_raised_at` the store's now; J is still
  `LOST_CONTACT`, with one alert
- **And** the SMS fake holds exactly one `LOST_CONTACT_SMS` for each of R1, R2
  and R3, R2 included, and none for W or anyone else
- **And** the push fake holds no message the escalation caused: no second
  `LOST_CONTACT`, and no SMS kind
- **And** while the clock runs on ten more minutes, later sweeps escalate
  nothing more and later deliveries send nothing more, by SMS or by push
- **And** at L3 the same flow runs through the real adapter, the real modules
  and both recording fakes
- **And** the worker's own wiring (`worker.test.ts`, over the test kit's fake
  PostgreSQL server): its default sweep reads and escalates through the
  database store, its SMS loop claims SMS kinds only and hands them to its
  SMS port, and a sweep that escalated wakes the SMS loop at once.

**LOST-07-AC2 — With an acknowledgement at one minute, no SMS is sent: the
story's second test.** *(LOST-07, REL-07, LOST-06)*
- **Given** AC1's journey and alert
- **When** R1 says "I'm on it" through the API one minute after `opened_at`,
  and the loops run to ten minutes after it
- **Then** no SMS is written or handed to the SMS fake, the alert stays
  `ACKNOWLEDGED` by R1, and its `sms_raised_at` stays null
- **And** the same with the acknowledgement at 119 999 ms
- **And** at 120 000 ms with the sweep run first, the alert escalates, and the
  acknowledgement then meets AC6.

**LOST-07-AC3 — The escalation reads both halves of an acknowledgement, and a
missing half sends the SMS.** *(LOST-07, REL-07)*
- **Given** J `LOST_CONTACT` and its one unresolved alert, opened more than
  two minutes before the store's now, put in directly in each of these runs
- **Then** it is escalated, to `ESCALATED` with the SMS written, when it is:
  `OPEN`; `ESCALATED` with no escalation time; `ACKNOWLEDGED` with nobody
  recorded; `OPEN` or `ESCALATED` with someone recorded
- **And** it is not escalated, and nothing is written, when it is:
  `ACKNOWLEDGED` with someone recorded; `RESOLVED`, whatever else it holds;
  any state with an escalation time already set; opened 119 999 ms before
  the store's now
- **And** an `ESCALATED` alert can still be acknowledged, as LOST-06 built
  (the acknowledgement rule's rows are unchanged).

**LOST-07-AC4 — An alert is escalated once, whoever sweeps.** *(LOST-07;
AR-06)*
- **When** a due alert is escalated by `RACERS` sweeps at once, on separate
  connections, for `RACE_ROUNDS` rounds (L3), or by two sweeps one after the
  other (L6)
- **Then** exactly one escalates and every other skips, none an error; there
  is exactly one `LOST_CONTACT_SMS` per responder and one escalation time
- **And** the database itself refuses a second `LOST_CONTACT_SMS` for the
  same alert and recipient (L3)
- **And** across the open, the escalation and every later sweep, each
  responder has exactly one `LOST_CONTACT` push and one `LOST_CONTACT_SMS`
  for the alert (the server half of D-087's owed test).

**LOST-07-AC5 — The escalation and "I'm on it" meet on the journey's row.**
*(LOST-07, LOST-06, SM-09)*
- **Given** a real PostgreSQL, and J's alert due for escalation
- **When** an acknowledgement's transaction holds J's row before commit, and
  the sweep runs with a wait
- **Then** the escalation waits for the row (`pg_stat_activity`), then finds
  the alert acknowledged and writes nothing
- **When** the escalation's transaction holds J's row, and an acknowledgement
  past its read arrives
- **Then** the acknowledgement waits, then records R1, and withdraws every SMS
  the escalation wrote and no port has accepted
- **When** an acknowledgement and a sweep start at the same moment on separate
  connections, for at least `RACE_ROUNDS` rounds
- **Then** every round ends in one of those two outcomes, never with an SMS
  unsent and unwithdrawn on an alert acknowledged by someone
- **And** at L6 the fake's `hold` gives the first two orders.

### Stopping, resolving and the messages

**LOST-07-AC6 — "I'm on it" stops the escalation: the alert's unsent SMS are
withdrawn, and nothing else is.** *(LOST-07, LOST-06)*
- **Given** J's alert `ESCALATED`, with R1's SMS accepted, R2's failed
  (`NO_TARGET`, due again in 10 s), and R3's never claimed; in another run,
  R3's handed to the SMS port and not yet answered (the fake's
  `holdAnswers`)
- **When** R2 says "I'm on it"
- **Then** the alert is `ACKNOWLEDGED` by R2, and keeps its `sms_raised_at`
- **And** R2's and R3's SMS are withdrawn at the store's now, keep their
  attempts and last failure, and are never handed to the SMS port again,
  whatever their due time; R1's is as it was
- **And** an SMS in the port's hands finishes: it is marked as the port
  answers, and is never retried
- **And** every push message of the alert, sent or not, is as it was, and the
  `ACKNOWLEDGED` notices are written as LOST-06 built
- **And** an acknowledgement of an alert never escalated withdraws nothing.

**LOST-07-AC7 — A resolved alert never escalates, and an escalated alert's
resolution withdraws its unsent SMS and stands every responder down by push
only.** *(LOST-07, LOST-03, SM-04)*
- **Given** J's alert opened, and a fresh heartbeat 119 999 ms later; in
  another run, "I'm home"
- **Then** the alert is `RESOLVED`, and no sweep after it escalates it
- **Given** J's alert `ESCALATED`, R2's SMS failed and due again, R3's handed
  to the SMS port and due later
- **When** contact comes back by a fresh heartbeat; in another run, by "I'm
  home"
- **Then** the alert is `RESOLVED` with its resolution, and keeps
  `sms_raised_at`
- **And** R2's and R3's SMS are withdrawn at the store's now, keep their
  attempts and last failure, and are never handed to the SMS port again; sent
  ones are as they were
- **And** every responder gets exactly one stand-down, by push, and no SMS
  (Q5 (a)); R3's is not handed to the push port before R3's SMS's due time;
  no hold is longer than 60 s
- **And** for any sequence of acknowledgements by any of J's responders or by
  others, heartbeats fresh or stale, sweeps, the passing of time and "I'm
  home" (fast-check, in the shared behaviour suite: the fake at L2, the
  adapter at L3 with fewer runs), after every step:
  - an alert has an escalation time exactly when a sweep found it unresolved,
    unacknowledged in D-114's sense and two minutes old or more;
  - an alert with an escalation time has exactly one `LOST_CONTACT_SMS` per
    responder, and one without has none;
  - no alert acknowledged by someone before its two minutes ever has an SMS;
  - no `RESOLVED` alert, and no alert acknowledged by someone, has an SMS
    that is neither sent nor withdrawn.

**LOST-07-AC8 — Each message reaches its own port, and every message stays
content-free.** *(LOST-07, LOST-02; D-086)*
- **Given** an alert's lost-contact pushes, its SMS, its notices and its
  stand-downs
- **When** both senders deliver
- **Then** the SMS fake receives only `LOST_CONTACT_SMS`, and the push fake
  never receives it
- **And** every message either fake receives has exactly the keys
  `messageId`, `recipientId` and `kind`, `kind` one of `MESSAGE_KINDS`;
  every `messageId` is a UUID, distinct from every other message's and from
  every user's, walker's, journey's, alert's and device's ID
- **And** in the shared behaviour suite, the push claim never hands out an
  SMS kind and the SMS claim never a push kind, each with its lease, attempt
  count and order unchanged
- **And** no column of `alerts` or `outbox` holds a coordinate, an accuracy, a
  phone time, a battery level, a name or a phone number; the only columns
  named like a coordinate, in every table, are still `positions.latitude` and
  `positions.longitude` (L3, `information_schema`).

**LOST-07-AC9 — The SMS sender delivers at least once, with retries, on a
loop of its own.** *(LOST-07; AR-05)*
- **Given** escalated SMS for R1, R2 and R3
- **When** the SMS fake accepts R1's, refuses R2's (`NO_TARGET`) and throws for
  R3's
- **Then** the delivery counts one sent and two failed; R1's is marked sent;
  R2's has last failure `NO_TARGET` and R3's `UNAVAILABLE`, each due again
  10 s later, then 20, 40, 60 and 60 s, never a millisecond sooner, with the
  same message ID; one `sms_failed` line per failure, holding the reason and
  the message's ID only
- **And** once the fake recovers, each is sent once and never again
- **And** with the push fake holding its answers for ever, the SMS sender
  still delivers every due SMS, and the reverse (L6, the two senders)
- **And** in the worker, a push delivery that never settles leaves the SMS
  loop running every 10 s, and an SMS delivery that never settles leaves the
  push loop running (L2, `worker.test.ts`, with stand-in senders)
- **And** a claim or a mark that fails is one `sms_delivery_failed` line with
  its stage and SQLSTATE; the lease brings the message back.

### The page (LOST-07)

**LOST-07-AC10 — A failed SMS pages the owner: the roadmap's "the page … at
L6".** *(LOST-07)*
- **Given** AC1's escalation, with the SMS fake failing every SMS: with
  `NO_TARGET`; in other runs with `NOT_CONFIGURED`, by throwing, and by holding
  its answers for ever
- **When** the SMS check runs 59 999 ms after the SMS were written
- **Then** it reports `ok`, and writes no line
- **When** it runs at 60 000 ms, and every minute after
- **Then** each run reports `failing` to the recording alarm, with one
  `sms_unsent` line holding the count of failing SMS, 3
- **When** the SMS fake recovers and the SMS are sent; in another run, when
  R1 acknowledges; in another, when contact comes back
- **Then** the next check reports `ok`
- **And** an SMS refused once and accepted on its retry within 60 s is never
  reported as failing
- **And** with no SMS at all, every check reports `ok`
- **And** at L3 the count reads exactly the SMS messages unsent, not
  withdrawn, and written 60 s or more before the database's now(), and none
  of another kind.

**LOST-07-AC11 — The page fails toward paging, and its URL stays a secret.**
*(LOST-07; D-079)*
- **When** the check cannot read the database
- **Then** it reports nothing, writes one `sms_check_failed` line with stage
  `read` and the SQLSTATE, and completes; the monitor's silence pages
- **When** the report fails (a non-2xx answer, no connection, a timeout)
- **Then** it writes one `sms_check_failed` line with stage `report`, and the
  task completes: never a thrown task that Graphile retries in a loop
- **And** the check runs whether or not the watchdog's beat is fresh, and the
  existing check-in still follows the beat alone
- **And** the adapter sends `ok` as a HEAD to the URL and `failing` as a HEAD
  to the URL with `/fail` appended, no body, redirects not followed, and only
  a 2xx counts; a stop aborts a report in flight; no error it throws or line
  it writes holds the URL
- **And** with `HEALTHCHECKS_SMS_URL` unset, not a URL, or not `https:`, the
  worker says once at start why it is not reporting, never the value, and
  runs; with a valid one, it says once that it reports; neither line contains
  "Healthchecks.io".

**LOST-07-AC12 — In M2 no SMS can be sent, and the worker says so.**
*(LOST-07)*
- **Then** `UNCONFIGURED_SMS` answers `NOT_CONFIGURED` to every message, for
  any message (fast-check), and the worker process uses it
- **And** the worker says once at start, through the write it was given and
  by default on stderr, that no SMS provider is configured
- **And** so an escalation on the real worker is reported as failing once its
  SMS have waited 60 s (AC10): loud, never a quiet success.

### The rules, the database, the log and the infrastructure

**LOST-07-AC13 — Every (alert situation, event) pair has a tested outcome,
the escalation's included.** *(LOST-07, REL-07, LOST-06)*
- **Given** `ALERT_EVENTS` is exactly `acknowledge`, `escalate`
- **Then** the rule's table holds an expectation for every pair: for
  `escalate`, no alert, and each of the four states, with nobody and someone
  recorded, with and without an escalation time, under and at two minutes;
  the acknowledgement's rows are unchanged; a pair the lists create but the
  table lacks fails, naming the pair
- **And** for any alert and any two times (fast-check), the escalation's
  outcome is the rule's, in its order; a time that is not one never
  escalates; never a throw, never `undefined`
- **And** typecheck fails for an event with no `case` (the `never` default);
  an event of a type the module does not list is thrown on, with the rule's
  own message, `Object.prototype`'s names included; deciding changes neither
  the alert nor the event handed in
- **And** `ESCALATE_AFTER_MS` is exactly 120 000, and `JOURNEY_EVENTS` and the
  journey's transition table are unchanged.

**LOST-07-AC14 — Every kind has one channel and one withdrawal, decided in one
place.** *(LOST-07, LOST-06, LOST-03)*
- **Then** `MESSAGE_KINDS` is exactly `LOST_CONTACT`, `BACK_IN_CONTACT`,
  `HOME`, `ACKNOWLEDGED`, `LOST_CONTACT_SMS`, in order
- **And** every kind is in exactly one of `SMS_KINDS` and `PUSH_KINDS`, and in
  exactly one of `WITHDRAWN_WHEN_RESOLVED` and the open's list
  (`ALERT_RESOLUTIONS`); a kind placed in neither or both fails the test,
  naming it, until someone places it
- **And** `WITHDRAWN_WHEN_ACKNOWLEDGED` is exactly `LOST_CONTACT_SMS`, and
  every kind in it is in `WITHDRAWN_WHEN_RESOLVED`
- **And** the test kit's copies equal the domain's
- **And** in the shared behaviour suite, each of the three withdrawals (the
  resolution, the acknowledgement, the open) withdraws exactly its own
  kinds' unsent messages of the alerts it names, and leaves every other
  message alone.

**LOST-07-AC15 — An escalation is all or nothing.** *(LOST-07; AR-05)*
- **Given** a real PostgreSQL, where a test-only trigger makes inserting the
  second `LOST_CONTACT_SMS` fail
- **When** the sweep runs
- **Then** the escalation fails: the alert is as it was, with no escalation
  time, and no SMS exists; one `escalation_failed` line with stage `escalate`
  and the SQLSTATE; the sweep fails and records no beat
- **And** once the trigger is removed, the next sweep escalates and does all
  of AC1's work
- **And** an alert whose journey has no responder row is not escalated: the
  escalation is refused whole and the sweep fails, saying so
- **And** at L6, with the fake failing the escalation's read and then its
  write, each is a failed sweep with one line naming its stage, and no beat.

**LOST-07-AC16 — A held row never hides an escalation.** *(LOST-07; AR-06,
D-108)*
- **Given** J's alert due, and J's row held by another transaction
- **Then** the sweep skips it without waiting, and the sweep is ok
- **When** the alert's two minutes passed 30 s ago or more, and the row is
  still held
- **Then** the sweep tries once more, waiting at most 5 s; held through the
  wait, one `escalation_overdue` line names the alert, the sweep fails and
  records no beat, so the worker's check stops and the owner is paged
- **And** when the holder lets go within the wait (an acknowledgement, or a
  heartbeat that brings contact back, committing), the waiting attempt finds
  the alert as the holder left it: acknowledged or resolved, and writes
  nothing; or still due, and escalates
- **And** at L3 the waiting attempt waits for the row (`pg_stat_activity`),
  and a 55P03 on any other lock is a failed escalation, not `held`.

**LOST-07-AC17 — The escalation's time is the database's.** *(LOST-07,
REL-01)*
- **Given** a real PostgreSQL
- **Then** `sms_raised_at` lies between two `select now()` readings taken
  before and after the sweep, never before `opened_at` plus 120 s, and each
  SMS's `created_at` and `next_attempt_at` equal it to the microsecond, in
  the same transaction (`xmin`)
- **And** a resolution and an acknowledgement keep `sms_raised_at`
- **And** the modules and the domain read no clock (the lint rule, L1)
- **And** at L6, swept exactly two minutes after the alert opened on the fake
  clock, `sms_raised_at` minus `opened_at` is exactly 120 s.

**LOST-07-AC18 — The new log events are closed, and nothing personal reaches
a log.** *(LOST-07, PRIV-07)*
- **Then** typecheck (L1) fails for any new event holding another field; a
  `@ts-expect-error` test holds this, a phone number, a latitude and a message
  among the fields it tries
- **And** `createLog` writes each as one JSON line holding exactly its
  fields; an ID that is not a canonical UUID, a `reason` or `stage` outside
  its set, a `code` that is not a SQLSTATE, and a `count` that is not a
  non-negative safe integer are each written as null (L2)
- **And** when the fake store fails the escalation's read and write, the SMS
  claim and mark and the count, and the SMS fake and the alarm fake fail,
  each with an error whose message holds markers (a synthetic coordinate, a
  phone-number-shaped string, a credential-like string and a responder's ID),
  nothing written to stdout, stderr or the console holds a marker (L6)
- **And** as controls, the capture sees a line written through the production
  `createLog`, and the thrown errors do hold the markers.

**LOST-07-AC19 — The database agrees, and migration `0006` changes no
existing row.** *(LOST-07)*
- **Given** a freshly migrated database
- **Then** `message_kind`'s values equal `MESSAGE_KINDS`, in order
  (`pg_enum`)
- **And** `alerts.sms_raised_at` is a database time (timestamp with time zone),
  nullable; the database takes an `ESCALATED` alert without it
- **And** the claim's partial index still reads `(next_attempt_at, id)` with
  the predicate `sent_at IS NULL`
- **And** on PostgreSQL 15, a database at `0005` holding journeys in every
  state, alerts in every state with and without a resolution and an
  acknowledgement, and outbox messages of every kind, sent, unsent and
  withdrawn, migrates through `0006` as the pre-run hook runs it; every
  existing row is unchanged, `sms_raised_at` is null on them, and
  `LOST_CONTACT_SMS` can be used once the migration has committed
- **And** there is exactly one committed `0006_*.sql`, in the journal, with no
  `update`, `delete` or `truncate`, which names `'LOST_CONTACT_SMS'` only in
  `message_kind`'s `add value` statement.

**LOST-07-AC20 — The SMS check's ping URL reaches the worker from the staging
environment's secret, and from nowhere else.** *(LOST-07; D-079)*
- **Then** `infra/staging/variables.tf` declares `healthchecks_sms_url`,
  sensitive, required, and validated as a `https://hc-ping.com/` URL, with an
  error message that says where to set it
- **And** `main.tf` gives the app `HEALTHCHECKS_SMS_URL` from that variable,
  and names the variable nowhere else
- **And** `infra-staging.yml`'s plan and apply jobs each set
  `TF_VAR_healthchecks_sms_url` from the `staging` environment's secret
  `HEALTHCHECKS_SMS_URL` in their own `env`, and no other line of any
  workflow reads that secret, by name, by index or through `toJSON(secrets)`.

## Test plan

| AC | Level | Where | How |
|----|-------|-------|-----|
| AC1 | L6, L3, L2 | `apps/server/src/escalation.system.test.ts` (new); `apps/server/src/escalation.integration.test.ts` (new); `worker.test.ts` | L6: `createApi` with the journey service and the acknowledgement service, `createWatchdog`, `createPushSender` and `createSmsSender` over one `fakeJourneyStore({ clock })`, with `fakePush()`, `fakeSms()`, the alarm fake, `fakeLog()` and `fakeDeviceAuthenticator()`. L3: the real adapter and modules with both fakes. The worker test reads the SQL the fake PostgreSQL server receives. **Names REL-07, LOST-02** |
| AC2 | L6, L3 | escalation system and integration tests | Acknowledgements at 60 s and 119 999 ms. **Names REL-07, LOST-06** |
| AC3 | L2, L3, L6 | behaviour suite (`fake-journey-store.test.ts`, `journeys.integration.test.ts`); system test | Alerts put in directly in each state. **Names REL-07** |
| AC4 | L3, L2, L6 | integration test (`RACERS`, `RACE_ROUNDS`); behaviour suite; system test | |
| AC5 | L3, L6 | integration test (two connections, order forced by transactions held open, then same-moment rounds); system test (`hold`) | **Names LOST-06, SM-09** |
| AC6 | L2, L3, L6 | behaviour suite; system test (`holdAnswers`, `failFor`) | **Names LOST-06** |
| AC7 | L6, L2, L3 | system test; behaviour suite, the property included | fast-check. **Names LOST-03, SM-04** |
| AC8 | L6, L2, L3 | system test; behaviour suite (the two claims); `journeys.integration.test.ts` (`information_schema`) | **Names LOST-02** |
| AC9 | L6, L2 | system test; `worker.test.ts` | `holdAnswers` on one fake while the other answers; stand-in senders for the loops |
| AC10 | L6, L2, L3 | system test (the check run on the fake clock); behaviour suite (the count) | |
| AC11 | L2, L6 | `healthchecks.test.ts`, `config.test.ts`, `worker.test.ts`; system test | A fetch stand-in, as INF-08's tests use |
| AC12 | L2 | `worker.test.ts` | fast-check over messages |
| AC13 | L1, L2 | `tsc`; `domain/journey.test.ts` | The table over the lists; fast-check over times. **Names REL-07, LOST-06** |
| AC14 | L2, L3 | `domain/journey.test.ts`; behaviour suite | **Names LOST-06, LOST-03** |
| AC15 | L3, L6 | integration test (a trigger the test creates and removes, as LOST-02's and LOST-03's do); system test (`failWith`) | |
| AC16 | L6, L3 | system test (`hold`, `holdUntilWaited`); integration test | |
| AC17 | L3, L6, L1 | integration test; system test; lint in `gate:static` | Times bracketed by `select now()`. **Names REL-01** |
| AC18 | L1, L2, L6 | `tsc`; `log.test.ts`, `fake-log.test.ts`; system test (`captured()`) | **Names PRIV-07** |
| AC19 | L3 | `journeys.integration.test.ts`; `deploy.integration.test.ts` (PostgreSQL 15) | |
| AC20 | L2 | `scripts/infra.test.mjs`, `scripts/staging-workflows.test.mjs` | As INF-08-AC8 and AC9 do for the worker's URL |

### The shared behaviour suite (D-100)

The fake (L2, `fake-journey-store.test.ts`) and the adapter (L3,
`journeys.integration.test.ts`) must both pass each of these, and
`fake-journey-store.test.ts` pins the names. `test-author` may adjust the
wording, keeping the criterion and the assertions.

1. `LOST-07-AC3: alertsDueForEscalation reads exactly the unresolved alerts with no escalation time, not acknowledged by someone, opened two minutes or more before the store’s now, with that now; none other, for any alerts in any state (fast-check)`
2. `LOST-07-AC1: escalateAlert moves a due alert to ESCALATED at the store’s now and writes one LOST_CONTACT_SMS per responder row, each with an ID of its own and due at that now; the journey, its other alerts, another journey’s alert and every push message are untouched`
3. `LOST-07-AC3: escalateAlert decides again under the journey’s row, and writes nothing for an alert no longer due there: acknowledged by someone, RESOLVED, already escalated, or under two minutes`
4. `LOST-07-AC16: escalateAlert skips a held row without waiting; told to wait, it answers held when the row stays held, and otherwise decides as the holder left it`
5. `LOST-07-AC15: escalateAlert refuses an alert whose journey has no responder row, writing nothing`
6. `LOST-07-AC4: RACERS escalations of one alert at once, RACE_ROUNDS times over: exactly one escalates, every other skips, none an error, with one set of SMS`
7. `LOST-07-AC6: recordAcknowledgement of an escalated alert withdraws its SMS not yet sent at the store’s now, keeping attempts and last failure, and leaves sent SMS and every push message alone; of an alert never escalated it withdraws nothing`
8. `LOST-07-AC7: when contact comes back, or "I’m home" ends the journey, an escalated alert is resolved keeping its escalation time; its SMS not yet sent are withdrawn with its lost-contact pushes; every responder gets one stand-down, held behind an SMS handed over and due later`
9. `LOST-07-AC8: the push claim hands out push kinds only and the SMS claim SMS kinds only, each one claimer per message, leased, with its attempts counted`
10. `LOST-07-AC10: unsentSmsCount counts exactly the SMS messages unsent, not withdrawn and written 60 s or more before the store’s now, with that now`
11. `LOST-07-AC7: for any sequence of acknowledgements, heartbeats fresh or stale, sweeps, time passing and "I’m home", after every step an alert is escalated exactly when a sweep found it due, holds one SMS per responder exactly when escalated, never has one when acknowledged before its two minutes, and no resolved or acknowledged alert has an SMS neither sent nor withdrawn`
12. `LOST-07-AC14: each withdrawal — the resolution, the acknowledgement, the open — withdraws exactly its own kinds’ unsent messages of the alerts it names, and leaves every other message alone`

The property (11) follows LOST-03's lesson from its review loop 1: its
generators must draw sweeps far enough apart in time to escalate, and
acknowledgements that are recorded, and its `examples` hold one fixed
sequence that escalates, then acknowledges, then resolves, so the L3 run's few
runs reach all three. Against the adapter, "the passing of time" is the
database's own (`letTimePass`), so the L3 property needs alerts seeded with
`opened_at` in the past rather than waits of two minutes.

### Notes

- **Not used:** L5 and L7 (the app is not touched); L8 is task 9; L9 and L10
  are not used.
- **L3 needs Docker.** It runs in CI and on the Mac, not in a cloud session.
  `gate:full` names it as not run, and the `integration` job's log is the
  evidence.
- **One behaviour, two implementations.** The fake must decide the escalation
  by the same rule, under the same "lock", and claim by the same kinds, or the
  L6 tests prove the fake (D-100).
- **Why a new L6 file, in the `alerts` group.** The escalation, the SMS sender
  and the check live in `modules/alerts/`, whose mutants are killed only by
  tests the `alerts` group runs. `escalation.system.test.ts` joins the group
  after the two files it runs today. A file of its own keeps its setup (both
  fakes, the alarm, the check) out of the watchdog's and the acknowledgement's
  tests.
- **Test names** start with `LOST-07-ACn:`, and the files holding the criteria
  name the covered IDs the table marks.
- **Synthetic data only** (RG-07, D-089): IDs and credentials from the
  existing builders, positions from `syntheticPosition()`, markers generated
  at run time. **No phone number appears in any test**, synthetic or not,
  apart from AC18's phone-number-shaped marker, generated at run time and
  never in `+47` form (the write-time hook refuses that form).
- **Before pushing:** run `test:coverage`, then `coverage:ratchet` (the live
  gotcha). `domain/` keeps RG-04's 95 % branch floor.
- **`docs/requirements-status.md`** is regenerated with `pnpm run
  req:coverage`: LOST-07 and REL-07 go from uncovered to "spec" with this spec,
  and to covered with the tests.

### Existing assertions that change by design (RG-03)

`test-author` changes each, with the written reason RG-03 asks for in the pull
request. None loosens what a test proves; each says what this task now does
instead. Searched on 2026-10-07 for exact pins of `MESSAGE_KINDS`,
`ALERT_EVENTS`, the withdrawal lists, the contract's keys, the migration lists,
the sweep's result and the `alerts` mutation group.

- **`apps/server/src/domain/journey.test.ts`:**
  - "LOST-03-AC3: MESSAGE_KINDS is exactly LOST_CONTACT, BACK_IN_CONTACT, HOME
    and ACKNOWLEDGED, in order" (line 1687) and "LOST-06-AC13: MESSAGE_KINDS
    is exactly …" (line 2008): the list gains `LOST_CONTACT_SMS`, and both
    titles with it. Still exact.
  - "LOST-06-AC13: WITHDRAWN_WHEN_RESOLVED is exactly LOST_CONTACT and
    ACKNOWLEDGED; …" (line 2012): the list gains `LOST_CONTACT_SMS`, and the
    title with it. Its "every kind in exactly one of the two" check is
    unchanged and covers the new kind.
  - "LOST-06-AC14: ALERT_EVENTS is exactly acknowledge; …" (line 1896): it is
    exactly `acknowledge`, `escalate`. The `JOURNEY_EVENTS` half is unchanged.
  - The table `ALERT_TRANSITIONS` (lines 1765 to 1799) is typed over
    `ALERT_EVENTS`, so it must gain the `escalate` rows (AC13); "every pair …
    has a row here" (line 1902) counts `1 + states × recorded × senders`
    pairs, an acknowledgement's situations only, and counts the escalation's
    too. The acknowledgement's rows and their outcomes do not change.
  - "LOST-06-AC14: an event of a type the module does not list is thrown on
    …" (line 1957): `'escalate'` is one of the types it calls unlisted, and is
    now listed; it is replaced by another unlisted name. The rest, and the
    rule's own message, are unchanged.
  - "LOST-06-AC13: the test kit's copies equal the domain's" (line 2033):
    added to, with the kit's new copies.
- **`packages/test-kit/src/fake-push.test.ts`**, line 169, the kit's
  `MESSAGE_KINDS`: gains `LOST_CONTACT_SMS`. The test at line 160 that sends
  one message of every kind then sends the SMS kind to the push fake too,
  which records whatever it is given; the assertion is unchanged.
- **`packages/test-kit/src/fake-journey-store.test.ts`:** line 1640 (the kit's
  `MESSAGE_KINDS`) and line 2020 (the kit's `WITHDRAWN_WHEN_RESOLVED`) gain the
  SMS kind; line 2021 (`WITHDRAWN_WHEN_OPENED`) is unchanged; the pinned list
  of behaviour names gains this task's.
- **`apps/server/src/adapters/journeys.integration.test.ts`:**
  - "LOST-03-AC20: message_kind's values are exactly MESSAGE_KINDS, …" (line
    2202) and "LOST-06-AC17: message_kind's values equal MESSAGE_KINDS, in
    order, ACKNOWLEDGED last" (line 2390): the literal lists gain
    `LOST_CONTACT_SMS`; the second's title no longer says "ACKNOWLEDGED last".
    The assertions against the domain's list are unchanged.
  - "LOST-02-AC13: alerts and outbox hold exactly the spec's columns, …" (line
    2075): the `alerts` list gains `sms_raised_at`. Still exact; its scan for
    a coordinate, an accuracy, a phone time, a battery level, a name or a
    phone number covers it as it stands.
- **`apps/server/src/deploy.integration.test.ts`**, "LOST-06-AC17: a
  PostgreSQL 15 database at 0004, … migrates through 0005 …" (line 880): it
  runs every migration (`migrateDatabase`), so it would now run `0006` too;
  each alert row would hold one more null column and `message_kind` a fifth
  label, and its applied count (line 954) would be `0006`'s journal's. It
  keeps its point by migrating only through `0005` (a copy of the folder up to
  `0005`, as `migrationsUpTo0004()` does for LOST-03-AC20), and counts that
  copy's journal. AC19's test for `0006` is a new one.
- **`scripts/lib/gate-decisions.test.mjs`**, the `MUTATION_GROUPS` pin (lines
  546 to 553): the `alerts` group's tests become `[alerts.system.test.ts,
  acknowledgement.system.test.ts, escalation.system.test.ts]`, in that order.
- **`scripts/stryker-config.test.mjs`**, "LOST-02: the alerts run mutates
  modules/alerts/ and runs alerts.system.test.ts, …" (line 239): the files
  the run's command runs gain `escalation.system.test.ts`, compared sorted.
  What it mutates and its configuration do not change.
- **Every exact sweep result.** `SweepResult` gains `escalated`, so the 43
  assertions of the form `toEqual({ ok, opened, stuck })` gain `escalated`: 19
  in `alerts.system.test.ts`, 15 in `alerts.integration.test.ts`, 5 in
  `contact.integration.test.ts`, 4 in `contact.system.test.ts` (counted with a
  search, not read one by one). Each gains `escalated: 0`, or the number the
  test now causes (next item).
- **`apps/server/src/worker.test.ts`'s `quietLoops()`** (lines 119 to 129): its
  sweep stand-in's result gains `escalated: 0`, and it gains quiet stand-ins
  for the SMS sender and the alarm, so that no test's worker runs a real SMS
  loop against a database that does not exist (the reason LOST-02's review
  loop 1 gave for the quiet loops).
- **Tests that sweep two minutes or more after an alert opened, without
  acknowledging or resolving it, now escalate it.** Their assertions on the
  alert's state (`OPEN`), on the store's exact outbox, on the sweep's result,
  or on "nothing more is written" change to include the escalation; where the
  escalation is not the test's subject, the test may instead acknowledge or
  resolve first, with the reason written. **Not enumerated here.** The search
  for `test-author`'s red phase: every call of `sweep()`, directly, through
  `sweepAndDeliver()` or through `runUntil()`, at a fake-clock time at least
  120 s after an alert's `opened_at`, in `alerts.system.test.ts`,
  `contact.system.test.ts`, `acknowledgement.system.test.ts` and their three
  integration files. `contact.system.test.ts` alone calls them 48 times and
  `acknowledgement.system.test.ts` 10 times.
- **Added to, not changed:** `log.test.ts`'s `EVENTS` list and
  `fake-log.test.ts` gain the six events; the behaviour suite gains its
  behaviours; `config.test.ts`, `healthchecks.test.ts`, `scripts/infra.test.mjs`
  and `scripts/staging-workflows.test.mjs` gain tests beside INF-08's.

**Read and found unchanged** (2026-10-07), so nobody has to wonder:
- "LOST-02-AC1: the most important test" (`alerts.system.test.ts`, lines 243
  to 307): its last sweep is at exactly five minutes, before any escalation.
- "LOST-06-AC1" (`acknowledgement.system.test.ts`, line 384): it acknowledges
  one minute after the open, then runs ten minutes; the alert is acknowledged,
  so nothing escalates, and no push is added.
- The LOST-06-AC13 behaviour (`journey-store-behaviour.ts`, line 4891): it
  seeds one message of every kind in `MESSAGE_KINDS` and expects the
  resolution to withdraw `WITHDRAWN_WHEN_RESOLVED`'s; it covers the SMS kind
  as it stands.
- `contact.system.test.ts` "LOST-03-AC9: every message the push port receives
  …" and `acknowledgement.system.test.ts` "LOST-06-AC10: …": the push claim
  takes push kinds only, so what the push port receives is unchanged.
- INF-08's worker tests that count the lines containing "Healthchecks.io":
  unchanged, because the SMS check's start line does not contain those words
  (approach item 8).
- `scripts/staging-workflows.test.mjs` "INF-08-AC9" (it reads
  `HEALTHCHECKS_WORKER_URL` only, with `toContain`) and `scripts/infra.test.mjs`
  "INF-08-AC8" (`var.healthchecks_worker_url` once in `main.tf`): a second
  variable and secret change neither.
- The contract's tests, `openapi.json`, `home.test.ts`'s contract keys and
  `openapi.test.ts`'s path list: no route is added.
- `domain/watchdog.test.ts`'s pin of the longest hold: unchanged, 60 s.

## Mutation (D-036, D-095, D-098, D-099)

Read in `scripts/lib/gate-decisions.mjs` on 2026-10-07.

| New or changed code | Group | Tests the group runs | Configuration |
|---|---|---|---|
| `domain/journey.ts`, `domain/watchdog.ts` | `domain` | `apps/server/src/domain` | root |
| `modules/alerts/watchdog.ts`, `outbox.ts`; `escalation.ts` and `sms-check.ts` (new) | `alerts` | `alerts.system.test.ts`, `acknowledgement.system.test.ts`, then `escalation.system.test.ts` (new) | `vitest.system.config.mjs` |
| `worker.ts`, `bin/worker.ts` | `process` | `bin/bin.test.ts`, `worker.test.ts`, `process.test.ts` | root |
| `adapters/healthchecks.ts` | `healthchecks` | `healthchecks.test.ts`, `worker.test.ts` | root |

- **The new files need no new safety path or group**: both are inside
  `apps/server/src/modules/alerts/`, which `SAFETY_PATHS`, CODEOWNERS and the
  ai-review `safety` filter already list, and a group can only claim a safety
  path exactly as it is listed. `MUTATION_GROUPS`' `alerts` group gains the
  test file; `gate-decisions.mjs` is owned and in the `safety` filter (D-100),
  so `ai-review.yml` is not edited.
- **Each file must reach 80 % killed on its own** (D-098). Every run is fresh
  (D-099). `worker.ts`'s new wiring (the third loop, its wake, the minute
  task, the start lines) must be killed by `worker.test.ts`.
- **Not mutated on a pull request:** `adapters/journeys.ts`, `db/schema.ts` and
  the migration (D-095: L3, and D-036's nightly run, which does not exist
  yet); `log.ts` (the owner's open question from #60); `config.ts` and
  `ports.ts` (not safety paths; D-079 kept `config.ts` out on purpose).
- **Not run, because unchanged:** `journeys`, `api-process`.
- **Cost.** The `alerts` group's mutants each run three files from here. D-098
  keeps the 25-minute budget; if an honest run does not fit, the owner decides
  (cost). Read the job's log for the time it took; do not estimate.

## Modules and files affected

Owner approval and the safety filter were read on 2026-10-07 in
`.github/CODEOWNERS` and `.github/workflows/ai-review.yml` (the `safety`
filter, lines 54 to 80). `OWNER_APPROVAL_PATHS` in `scripts/lib/merge-rules.mjs`
was not read here; LOST-03's and LOST-06's specs say it lists the same paths.

| File | Change | Owner approval | Safety filter | Mutation |
|------|--------|:--:|:--:|:--:|
| `apps/server/src/domain/journey.ts` | The `escalate` rule, `switch`, `ESCALATE_AFTER_MS`, the kind and its four lists | **yes** | **yes** | `domain` |
| `apps/server/src/domain/watchdog.ts` | `SMS_UNSENT_LIMIT_MS`; the escalation's stuck check | **yes** | **yes** | `domain` |
| `apps/server/src/domain/*.test.ts` | L2 (test-author) | **yes** | **yes** | (its tests) |
| `apps/server/src/modules/alerts/watchdog.ts`, `outbox.ts`; `escalation.ts`, `sms-check.ts` (new) | The sweep's escalation, the SMS sender, the check | **yes** | **yes** | `alerts` |
| `apps/server/src/ports.ts` | The store methods, `Sms`, `SmsAlarm`, six `LogEvent`s | no | no | — |
| `apps/server/src/adapters/journeys.ts` | `alertsDueForEscalation`, `escalateAlert`, `claimDueSms`, `unsentSmsCount`, `claimDue`'s kinds, the acknowledgement's withdrawal, the header comment | **yes** | **yes** | no (D-095) |
| `apps/server/src/adapters/healthchecks.ts` | `healthchecksAlarm` | **yes** | **yes** | `healthchecks` |
| `apps/server/src/worker.ts`, `bin/worker.ts` | The SMS loop, `UNCONFIGURED_SMS`, the minute task, the start lines; the setting | **yes** | **yes** | `process` |
| `apps/server/src/config.ts` | `readHealthchecksSmsSetting` | no (D-079) | no | — |
| `apps/server/src/db/schema.ts` | `sms_raised_at`, `message_kind`'s value | **yes** | **yes** | no |
| `apps/server/src/db/migrations/0006_*.sql`, `meta/*` | Generated with `db:generate` | **yes** | **yes** | no |
| `apps/server/src/log.ts` | Six events | **yes** (D-102) | no (D-102) | no |
| `packages/test-kit/src/` (the store, the behaviour suite, `fakeSms`, the alarm fake, `fakePush`'s kinds, `fakeLog`, their tests, `index.ts`) | Fakes (test-author) | **yes** (D-100) | **yes** | input (D-098) |
| `scripts/lib/gate-decisions.mjs` | The `alerts` group's tests | **yes** | **yes** | input (D-098) |
| `scripts/lib/gate-decisions.test.mjs`, `scripts/stryker-config.test.mjs`, `scripts/infra.test.mjs`, `scripts/staging-workflows.test.mjs` | Pins and AC20 (test-author) | **yes** | no | — |
| `infra/staging/variables.tf`, `main.tf` | `healthchecks_sms_url`, `HEALTHCHECKS_SMS_URL` | **yes** | no | — |
| `.github/workflows/infra-staging.yml` | `TF_VAR_healthchecks_sms_url` in plan and apply | **yes** | no | — |
| `apps/server/src/escalation.system.test.ts`, `escalation.integration.test.ts` (new) | L6, L3 (test-author) | no | no | the `alerts` group's tests |
| `alerts.system.test.ts`, `contact.system.test.ts`, `acknowledgement.system.test.ts`, their integration files, `journeys.integration.test.ts`, `deploy.integration.test.ts`, `worker.test.ts`, `healthchecks.test.ts`, `config.test.ts`, `log.test.ts` | RG-03 items and additions (test-author) | no | no | groups' tests |
| `coverage-baseline.json` | Entries for `escalation.ts` and `sms-check.ts`, by hand, at their measured values (not `--update`) | **yes** | no | — |
| `docs/plan/decisions.md` | Approach item 14 | **yes** | no | — |
| `docs/plan/05-architecture.md` | The alert-state sentence draws the edges approach item 14 records | no | no | — |
| `docs/plan/monitoring-setup.md`, `docs/plan/README.md` | A-32 and A-33; "Open for M4": `sms_raised_at` and the SMS rows are alert records | no | no | — |
| `docs/requirements-status.md` | Regenerated | no | no | — |
| `docs/progress.md`, `docs/progress/m2.md` | Status (plan-keeper) | no | no | — |

- **`.github/workflows/ai-review.yml` is not edited.** CI's AI reviewers can
  run, and no hand merge is needed (D-075). `infra-staging.yml` is owned under
  `/.github/` but is not `ai-review.yml`.
- **Owner to-dos** (Q2 (a)), mirroring A-23 and A-24:
  - **A-32**, before the next `infra-staging` plan: in Healthchecks.io, add a
    check named `staging-sms`, Period 1 minute, Grace 2 minutes, alerts to the
    same place as the others; save its ping URL as the `staging` environment
    secret `HEALTHCHECKS_SMS_URL`. A plan without it stops with "Invalid value
    for variable", as INF-08's did.
  - **A-33**, after this task merges: run `infra-staging` with `plan`, then
    `apply`, and confirm within about 3 minutes that the check has left `new`
    and shows a ping every minute. **There is no live drill of a failing SMS
    in M2**: staging has no journeys before task 9 (D-091), so nothing can
    escalate there. The `/fail` path is proven at L2 and L6; its first live
    use is task 9's.
- **Expected unchanged:** `api.ts`, `api-process.ts`, `http.ts`; the contracts;
  `modules/journeys/`, `modules/health/`, `modules/alerts/acknowledgement.ts`;
  `adapters/db.ts`, `clock.ts`, `device-credentials.ts`, `migrations.ts`,
  `worker-heartbeats.ts`; `packages/config/`; `stryker.config.mjs` and the
  Vitest configurations; `apps/mobile/`.
- **Reviewers.** `safety-reviewer` runs (the filter matches `domain/`,
  `modules/alerts/`, `worker.ts`, `bin/worker.ts`, `healthchecks.ts`, the
  adapter, the schema, the migration, the test kit and `gate-decisions.mjs`).
  `privacy-security-reviewer` and `test-auditor` always run.

## Contract changes

**None.** No route is added or changed; `openapi.json` is unchanged, each
path item pinned by its sha256 as today. `pnpm run api:diff` is run; with
`packages/contracts/released/` empty it compares nothing, and the pull
request records that as "not compared", never as "passed".

The SMS port is an internal port, not an API contract. Its shape, `{
messageId, recipientId, kind }`, is what M3's adapter receives.

## Risks and failure modes

- **[F6](../plan/03-safety-reliability-security.md#failure-modes), the
  missed alert.** This task is F6's escalation. Its new dangers, and what
  holds each:
  - **An SMS that silently never goes.** The port refuses it, has no number,
    hangs, is not configured, or the SMS loop stalls. The page (AC10) reads
    the database's state each minute, so every one of these shows as an SMS
    unsent after 60 s, and the monitor's own silence pages when the check
    cannot run (AC11).
  - **An SMS stalled behind push.** A push provider that never answers would
    hold one shared loop. The SMS has a claim and a loop of its own (AC9).
  - **An escalation silenced by half an acknowledgement.** The rule reads
    the state and who (D-114; AC3).
  - **An escalation that never runs.** A held row is skipped, waited for once
    past 2 min 30 s, and reported (AC16); a failed escalation fails the sweep
    (AC15); either stops the beat, and the owner is paged through the
    existing check (D-108).
  - **The page by email, at night.** Healthchecks.io alerts the owner by email
    (A-08, accepted "for now"); a page at 03:00 may wait until morning. That
    is D-079's go-live question (Healthchecks.io Business, SMS and phone-call
    alerts), not this task's; stated so it is not assumed away.
  - **An SMS sent twice.** Delivery is at least once (D-108): a sender that
    stops between the provider's acceptance and the mark sends it again after
    the lease. Push collapses a resend by its message ID; SMS does not, unless
    the provider de-duplicates by a client reference (M3: LINK's API, not
    checked here). Two identical SMS is the safe direction.
  - **One acknowledgement silences the SMS for everyone**, by the plan's
    choice (D-019, REL-07, the story). A responder who taps and does
    nothing leaves the others with the critical push and the notice. LOST-06
    named the backstops (the 24-hour rule, task 8; M6's tuning); unchanged.
- **[F7](../plan/03-safety-reliability-security.md#failure-modes), the
  watchdog.** The sweep now does two jobs; either failing fails the sweep and
  stops the beat, which is the loud direction. The escalation takes only
  `LOST_CONTACT` journeys' rows, which the open never takes, and holds each
  for milliseconds; every wait is bounded (5 s, 10 s idle).
- **[F2](../plan/03-safety-reliability-security.md#failure-modes), false
  alarms.** A false lost-contact alert that nobody acknowledges within two
  minutes now also reaches every responder by SMS, which costs money and
  attention. Contact back before the SMS goes withdraws it (AC7). How often
  this happens is measured in the private test (M6).
- **[F8](../plan/03-safety-reliability-security.md#failure-modes), a bad
  release.** The L6 flows run on every pull request under the `alerts`
  mutation group, and L3 in CI. **The deploy overlap:** while a deploy
  overlaps, the old worker's claim takes every kind, so it could hand an SMS
  row to the push port once. In M2 that port is unconfigured, so the SMS is
  only delayed by one retry; from M3 it must be closed with LOST-03's open
  deploy-overlap item (an expand-then-contract change to the claim, or a
  deploy that stops the old worker first).
- **[F10](../plan/03-safety-reliability-security.md#failure-modes) and the
  abusive-member threat, on the responder's side.** LOST-06 noted that a
  responder's tap stops the SMS to everyone. Unchanged here; still a known
  limitation for the owner to see.
- **[F1](../plan/03-safety-reliability-security.md#failure-modes),
  [F3](../plan/03-safety-reliability-security.md#failure-modes),
  [F4](../plan/03-safety-reliability-security.md#failure-modes),
  [F5](../plan/03-safety-reliability-security.md#failure-modes) and
  [F9](../plan/03-safety-reliability-security.md#failure-modes):** not
  touched.
- **Staging will page once the canary runs.** On staging the SMS is
  `NOT_CONFIGURED`, so from task 9, a canary alert nobody acknowledges within
  two minutes pages the owner through the SMS check every cycle. Task 9
  decides ("Left for later tasks").
- **The fake can drift from the adapter.** The shared behaviour suite holds
  them together (AC3 to AC8, AC10, AC14 to AC16).
- **Personal data.** M2 stores no phone number, no name and no text. An SMS
  row links a responder to an alert, "who was alerted, when": an alert record
  under the retention rule (30 days, M4), as the push rows are. From M3 the
  SMS carries the walker's name and that they lost contact, unencrypted, to a
  provider and the networks: Q4, the DPIA rule (M4) and D-016 (LINK's data
  processing agreement and where it processes, M3; not checked here).
- **Healthchecks.io** receives no personal data: a HEAD with no body. Where
  it hosts the pings was not checked here.
- **Adding an enum value inside the migration's transaction.** As `0004` and
  `0005` did; if PostgreSQL refused it, the deploy's pre-run hook would fail
  and `deploy-staging` would go red: loud, and the old version keeps running.
- **A coverage report that reads as done.** LOST-07 and REL-07 show as covered
  while the halves under "How this spec names requirements" remain.

### Flags from other decisions, checked

- **D-086:** the SMS port is content-free, as the push port is (AC8).
- **D-087:** the SMS has no notification level; the push claim never takes
  its kind, so M3's push adapter never maps it. The escalation writes no push,
  so "no further critical push follows the SMS" holds at the server (AC1).
  The owed L6 test with the critical level and the collapse ID stays M3's.
- **D-091:** no credential, no person and no number is created.
- **D-103:** the escalation is the watchdog's, not an event a phone sends; it
  is made idempotent by the alert's escalation time under the journey's lock
  (AC4), as the open is by the journey's state.
- **D-106:** no read route; the app reads the alert's state in M3.
- **D-108:** the outbox stays our own table; retries unchanged; SMS delivery
  is now watched, push delivery still is not.
- **D-111, D-112, D-114:** unsent SMS withdrawn on resolution; every responder
  still stood down; the journey's row first; the hold per responder.
- **D-014:** no text is sent; the SMS's words come in M3, bokmål first.

## Out of scope

- **The real SMS adapter** (LINK Mobility), its account (A-12), its data
  processing agreement, its text, its sender name, and its tests of the
  no-location-in-SMS rule (M3).
- **Phone numbers:** storing, confirming (responder setup) and reading them
  (M3, Q3).
- **The resumed-escalation rule and SM-02's last-responder warning** (Q1, on
  its recommended answer: the next M2 task).
- **An SMS stand-down** (Q5).
- **Escalating again after an acknowledgement nobody follows up** (M6, the
  owner; LOST-06).
- **Watching push delivery** (task 9's canary, D-108).
- **Retention** of `sms_raised_at` and the SMS rows (the retention rule, M4),
  and the DPIA.
- **Any route or contract change.**

### Left for later tasks

Each is named here so the task that owns it finds it. None blocks this task.

- **Task 7 (D-115): the resumed-escalation rule and SM-02's
  last-responder warning**, with the server half of "a responder leaves the
  journey" (a store operation and module, no route). It must decide, and ask
  the owner where it is theirs:
  - **the reset:** the alert goes back to unacknowledged, `acknowledged_by`
    and `acknowledged_at` cleared together; to `ESCALATED` if it has an
    escalation time, else to `OPEN`. The escalation rule here already escalates
    a reset alert that was never escalated, at once if its two minutes have
    passed;
  - **an alert already escalated (the owner's):** whether "escalation
    resumes" means a second SMS to every remaining responder, at once or after
    a fresh two minutes. Claude leans to "at once": the others were told
    someone was on it, and nobody now is;
  - **the outbox's unique key:** a second acknowledgement's notices, and a
    second SMS, meet (alert, recipient, kind). Recommended: a round number on
    the alert, raised by each reset and copied onto each message, in the
    unique key, so every message stays on record. Rejected: re-arming the
    old row (it loses who was told when) and dropping the key (it guards the
    races);
  - **who gets the stand-down** after a removal (LOST-03's open item; its
    leaning: a removed responder hears nothing more), and whether the removed
    responder's unsent messages are withdrawn;
  - **the walker's warning:** a non-critical message to the walker (D-087),
    which the outbox cannot hold today (`alert_id` is not null, and an
    `ACTIVE` journey has no alert); the journey screen's loud state is M3's
    (D-087's flag);
  - **a journey left with no responder that goes silent (the owner's):**
    today the open refuses it and the sweep reports it stuck, which holds the
    worker's check down and so hides any later watchdog failure;
  - **`recordAcknowledgement`'s `ALERT_NOT_FOUND` under the lock** gets its
    test once a responder can be removed (LOST-06).
- **Task 8 ("They're safe", the 24-hour rule):** resolve through
  `resolveInside`, which then withdraws unsent SMS too; a closed alert is never
  escalated.
- **Task 9 (the canary):** a canary alert escalates at two minutes unless the
  canary acknowledges it. On staging the SMS is `NOT_CONFIGURED`, so an
  escalation pages the owner through the SMS check every cycle: the canary
  acknowledges within two minutes, or the owner decides. The canary also
  watches push delivery (D-108). The SMS check's first live `/fail` is the
  canary's to show, if it ever escalates.
- **M3, the SMS adapter:** LINK Mobility; the number read at send time from
  responder setup, `NO_TARGET` when there is none; no number in any log line
  or thrown error (as `healthchecks.ts` keeps its URL out); every send bounded
  under `CLAIM_LEASE_MS`; the message ID as the provider's client reference,
  if LINK de-duplicates by one; the text (Q4) in translation files, bokmål
  first (D-014), with the tests of the no-location-in-SMS rule on the composed
  text; D-087's owed tests; the deploy overlap (Risks, F8); a push adapter
  that refuses a kind it does not map.
- **M3, responder setup:** readiness shows a responder with no confirmed
  number, so the walker sees who would get no SMS.
- **M4:** retention of `sms_raised_at` and the SMS rows (alert records); the
  export rule's export of what a member was sent; the DPIA's SMS data flow.
- **Go-live:** D-079's question, whether the owner's pages reach a phone at
  night (Healthchecks.io Business).
- **M6:** SMS volume and false alarms (F2); the indexes the escalation's read
  and the count may need.

## Settled by the plan, so not asked

- **The provider:** LINK Mobility, with an alphanumeric sender name (D-086,
  accepting Section 4's defaults; `04-tech-stack.md`, finding 8). Its account
  is A-12, in M3.
- **A recording SMS fake in M2, the real adapter in M3** (the roadmap: M2
  "fake push and SMS"; M3 "SMS to the owner's own number only"), as push was
  handled.
- **Every responder gets the SMS**, whatever their push did (D-019).
- **One acknowledgement stops the SMS for everyone** (REL-07, D-019, the
  story).
- **No location in the SMS** (D-019, the no-location-in-SMS rule).
- **Two minutes** (D-019), on the database's clock (REL-01, AR-03).
- **Escalate unless acknowledged and someone recorded** (D-114).
- **Unsent SMS withdrawn when the alert resolves** (D-111).
- **The journey's row first** (D-112); **the change and its messages in one
  transaction** (AR-05).

## Where the plan disagrees with itself

Said here rather than chosen silently.

1. **D-033's alert states draw no edge from `ESCALATED` (or `ACKNOWLEDGED`)
   to `RESOLVED`, and none back from `ACKNOWLEDGED`.** From this task,
   `ESCALATED` → `RESOLVED` is real: contact comes back after the SMS. D-112
   already resolves an alert "whatever its state", and SM-04 needs it. This
   task also escalates an `ACKNOWLEDGED` alert with nobody recorded, a state
   the code never makes. The edge back is the resumed-escalation rule's (Q1).
   Approach item 14 records the reading and redraws the sentence.
2. **"`ESCALATED` (… SMS sent …)".** The state is written with the SMS, in
   one transaction, not when the provider accepts it; in M2 no SMS is ever
   sent. Read as "escalated, its SMS written"; whether each was sent is the
   outbox's `sent_at`.
3. **D-090's item 6 bundles two rules whose trigger no M2 task builds.** Q1.
4. **D-087 lists LOST-07 and REL-07 among the carriers of tests M3 owes.**
   Once this task's tests name them, both show as covered while those tests
   are not written. Partial delivery shows as full; M3's push task must find
   them on D-087's list, not in the coverage report.
5. **D-108's amendment says "only the sweep loop is watched".** From here SMS
   delivery is watched and push delivery is not. Asymmetric, not
   contradictory; the canary (task 9) remains push's watch.

No other contradiction with a decision was found: D-019, D-079, D-086, D-087,
D-091, D-103, D-106, D-108, D-111, D-112, D-113 and D-114 were each read
against this design.

## Questions for the owner

### Q1 — Where do the resumed-escalation rule and SM-02's last-responder warning go?

**Why it is asked.** You put both in this task (D-090, item 6). Both start
when a responder leaves or is removed during a journey, and nothing in M2 can
do that: there is no route, no module and no store method for it. Removing a
member comes with the login task in M3; the walker removing a responder is the
abusive-member threat's mitigation; a responder leaving on their own is in no
story. The roadmap's "done when" for this task names the escalation and the
page only. A change to D-090's split is yours.

**Options:**
- **(a) All in this task.** It also builds the server half of "a responder
  leaves the journey": a store operation and module with no route, carrying
  both rules, tested at L2, L3 and L6 (through the module, as the watchdog is
  tested). Before its criteria can be written, two more answers are needed
  (below), and it must decide what a removed responder stops receiving.
- **(b) Two pull requests in M2.** This task is the escalation, the SMS fake
  and the page. The two rules follow as their own task and spec, before
  "They're safe", building the same server half. M2's content and exit are
  unchanged.
- **(c) Move both to M3**, to the task that first removes a responder, so they
  are built with their route and its access rules. D-090 and the roadmap's M2
  row change.

**The owner's answer (2026-10-07): (b), the recommendation (D-115).**

**Recommendation: (b).**
- Neither rule can be triggered in M2, so nothing is unprotected while they
  wait one task.
- The removal brings questions of its own (the two below; what a removed
  responder stops receiving; how the walker is warned, which the outbox
  cannot hold today). Bundled, they would hold up the escalation, which is
  the safety net for every alert.
- This task alone already touches the domain, the adapter, the worker, the
  schema, the log, monitoring and Terraform. Recent tasks each needed two or
  three review loops; one feature at a time (D-052).
- It keeps everything in M2, unlike (c).

**If answered otherwise:**
- **(a):** this spec gains criteria for the reset, the resumed escalation,
  the outbox's round number, the walker's warning and the removal, as "Left
  for later tasks" sketches them, and claims the resumed-escalation rule.
  Two questions first: **for an alert already escalated, does "escalation
  resumes" send every remaining responder a second SMS, and when** (Claude:
  at once); and **what happens when a journey left with no responder goes
  silent** (Claude: the alert opens with nobody to tell, and the owner is
  paged through the SMS check, without failing the sweep).
- **(c):** this spec is unchanged; the "next M2 task" items under "Left for
  later tasks" move to M3's list, and D-090 and the roadmap are amended.

### Q2 — How does a failed SMS page you?

**Why it is asked.** LOST-07 says "If an SMS can't be sent, the owner is
alerted", and you chose Healthchecks.io for the worker (D-079). How you are
paged, and what you set up, is yours.

**Options:**
- **(a) A second Healthchecks.io check, `staging-sms`.** Each minute the worker
  tells it "ok", or "failing" while any SMS has waited 60 s or more without
  being accepted, whatever the cause. It clears itself when the SMS gets
  through or is withdrawn, and if the worker stops telling it anything, it
  pages too. Costs nothing (the free plan has 20 checks; this is the third).
  About five minutes of your time (A-32), then a plan and apply after the
  merge (A-33).
- **(b) The worker's existing check.** The worker withholds its minute
  check-in while an SMS is failing. Nothing to set up. But the page reads as
  "the worker is down", and while an SMS stays failing, a real watchdog
  failure pages you nothing new. On staging, once the canary escalates
  against the unconfigured SMS, that check would stay down for good.
- **(c) `/v1/health` turns `degraded`**, so UptimeRobot pages (every 5 minutes
  on the free plan). The same masking, on the API's side.

Whichever you choose, the page arrives by email, as your other monitors do
(A-08), until the go-live question about SMS and phone-call alerts (D-079).

**The owner's answer (2026-10-07): (a), the recommendation (D-115).**

**Recommendation: (a).** It is the only option where a failing SMS and a
dead watchdog stay two different pages, and neither can hide the other.

**If answered otherwise:**
- **(b):** no new port, adapter, setting or infrastructure: the check-in task
  also reads the failing count and skips its ping while it is above zero.
  AC10 and AC11 are rewritten around the check-in; AC20 goes; INF-08's tests
  about when the check-in pings change by design.
- **(c):** the same, through `modules/health/` (owned, D-105) and
  `/v1/health`'s answer.

### Q3 — In M2 no phone number exists. Where does the SMS's number come from?

**Why it is asked.** Responder setup (M3) is where a responder confirms the
number for SMS escalation, and before the login task nothing stores anything
about a person (D-091). Phone numbers are among what the threat model
protects, and PRIV-07 keeps them out of every log.

**Options:**
- **(a) None in M2.** The SMS port is handed the recipient's user ID only, as
  the push port is. M3's adapter reads the number confirmed in responder setup
  when it sends, and a responder without one is `NO_TARGET`, which pages you
  after 60 s. Nothing in M2 stores a number.
- **(b) A phone number column on `users` now**, filled only by tests until M3.
  It fixes the shape of personal data before the login task designs the
  people tables.
- **(c) Copy the number into the outbox row** when the escalation is written.
  A second copy of every responder's number, kept with alert records for 30
  days.

**The owner's answer (2026-10-07): (a), the recommendation (D-115).**

**Recommendation: (a).** The number stays in one place, chosen by the task
that collects it; nothing in M2 needs it; and a responder with no number fails
loudly.

**If answered otherwise:** (b) adds a column, a migration and a builder, and
AC8's "no column … holds a phone number" is rewritten for `users`; (c)
contradicts LOST-06-AC10's test, which holds that no `outbox` column is named
like a phone number, and would need its own decision.

### Q4 — What does the SMS say? (Built in M3; not blocking)

**Why it is asked.** LOST-07 says the SMS "says who and what happened and asks
the responder to open the app", with no location. SMS is not encrypted, so
whatever it says reaches the provider and the networks in clear. In M2 nothing
composes text, so this can be answered now or in M3.

**Options:**
- **(a) The walker's name as the group knows them, that they have lost
  contact on their way home, and "open the app"**, in bokmål first (English
  for a responder whose app is in English). No location, no time, no link.
- **(b) No name** ("someone you follow has lost contact"). Less personal data
  in clear, but a responder who follows several people must open the app to
  learn who, and LOST-07 asks for "who".
- **(c) As (a), with the time of last contact.** More to act on; more in
  clear.

**The owner's answer (2026-10-07): (a), the recommendation (D-115).**

**Recommendation: (a).** It is what LOST-07 asks for, and nothing more. No
link, because a link in an SMS is what phishing looks like, and the app is
already on every responder's phone (D-013).

**If answered otherwise:** nothing in M2 changes; M3's adapter composes
differently.

### Q5 — When an alert resolves after its SMS went out, is anyone told by SMS?

**Why it is asked.** Every responder is stood down by push when contact comes
back or the walker is home (D-111). A responder who got the SMS because push
was not reaching them may not get the push stand-down either. An SMS
stand-down costs money and is in no story. D-112 named it as the kind of
stand-down that would have to opt in to the open's withdrawal, and left that
to this task; whether to have one at all is a cost and safety choice.

**Options:**
- **(a) No.** The push stand-down only. The SMS asked them to open the app,
  and the app shows the alert's current state (M3). A responder who cannot
  open it calls the walker, as the what-to-do guidance says.
- **(b) Yes:** an SMS stand-down ("back in contact", "is home") to every
  responder whose escalation SMS was accepted.

**The owner's answer (2026-10-07): (a), the recommendation (D-115).**

**Recommendation: (a).** The SMS already sends them to the app, which shows
the truth; (b) adds SMS cost and a second message kind per resolution for a
case the app covers.

**If answered otherwise:** (b) adds two kinds (`BACK_IN_CONTACT_SMS`,
`HOME_SMS`) in `SMS_KINDS`, written by the resolve helper for the responders
whose escalation SMS was sent; the domain gains `WITHDRAWN_WHEN_OPENED`
(`ALERT_RESOLUTIONS` plus those two), so a later alert's open withdraws an
unsent SMS stand-down as it withdraws a push one, with `openInside` and
AC14's test changed to it; AC7 gains the SMS stand-down; the migration adds
two values.
