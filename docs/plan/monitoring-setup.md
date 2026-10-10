# Monitoring setup — the owner's steps (INF-08)

**Last updated:** 2026-10-10 · Decisions: D-065, D-077, D-079, D-127, D-128 · Specs: [`../specs/INF-08.md`](../specs/INF-08.md), [`../specs/REL-10.md`](../specs/REL-10.md)

**Status: done.** A-23 to A-26 are complete. The drill ran on 2026-09-26, and
the owner accepted it on 2026-09-28. Two things differ from the steps below:
- Both monitors alert by email, and UptimeRobot's app was not installed ("it is
  enough for now").
- UptimeRobot's recovery and its keyword rule were not checked.

**Added with REL-10 (2026-10-10):** A-34 and A-35, the staging canary's check,
and "When `staging-canary` pages you". Both steps are still open.

The times, and what is still unverified, are in the owner to-do list in
[`README.md`](README.md).

Everything here is something only the owner can do: it handles a key, starts a
workflow run, or looks at the phone. About 15 minutes of clicking, plus the
drill, which is mostly waiting.

**What is being set up.** Two monitors that do not depend on each other:

- **Healthchecks.io watches the worker.** Once a minute, after it has recorded
  its heartbeat in the database, the worker pings a Healthchecks.io check. If
  the pings stop for 3 minutes, Healthchecks.io pages you. The worker is what
  will run the watchdog, so this is the monitor that says "nobody is watching
  the walkers".
- **UptimeRobot watches the API from outside.** Every 5 minutes it fetches
  `/v1/health` and pages you if the answer does not say `"status":"ok"`. That
  catches a dead API and also a worker that has gone quiet, since the health
  answer turns `degraded` after 3 minutes without a heartbeat.

UptimeRobot's free plan checks every 5 minutes. REL-08 asks for every minute.
You chose "free now, Solo at go-live" (D-079), so the API's own check is slower
than REL-08 until go-live. The worker is covered every minute either way.

## A-23 — The worker's check in Healthchecks.io, and its secret

Do this before the next `infra-staging` plan. From INF-08 on, a plan without
the secret stops with "Invalid value for variable" and a message saying where
to set it: GitHub hands a missing secret to Terraform as an empty value, and
the variable refuses anything that is not a Healthchecks.io ping URL.

1. In Healthchecks.io, **add a check** named `staging-worker`:
   - **Period 1 minute**, **Grace 2 minutes**. The check goes down 3 minutes
     after the last ping, and the alert has 2 more minutes to reach you inside
     REL-08's 5.
   - Send its alerts to the same place as the `daily-status` check (A-16), so
     they reach your phone.
2. Copy the check's **ping URL** (`https://hc-ping.com/…`). **Treat it as a
   password**: anyone who has it can keep the check green while the worker is
   dead. Use the form with the check's UUID, which Healthchecks.io shows by
   default, not the slug form: since LOST-07, the variable takes only
   `https://hc-ping.com/<uuid>` (D-116).
3. In GitHub: repository **Settings → Environments → `staging` → Add
   environment secret** (not a repository secret), named
   `HEALTHCHECKS_WORKER_URL`, with that ping URL as its value.

## A-24 — After the INF-08 pull request merges: plan, apply, and check it is alive

1. Wait until the merge's `deploy-staging` run is green.
2. Actions → `infra-staging` → Run workflow with action `plan`. The summary
   shows the app's `environment` changing, with the values hidden. That change
   is this task and nothing else should be listed.
3. Run it again with action `apply`, giving it the plan run's ID, as in A-22.
   Clever Cloud restarts staging with the new setting.
4. **Within about 3 minutes, open the check in Healthchecks.io.** It must have
   left `new` and show a ping every minute. **If it stays `new`, stop and tell
   Claude**: a check that has never been pinged never pages, whatever happens.
   (In the app's log on Clever Cloud, the worker's first line says either
   `worker: checking in with Healthchecks.io …` or
   `worker: not checking in with Healthchecks.io …` with the reason.)

## A-25 — The UptimeRobot monitor (finishes A-08)

1. Install UptimeRobot's mobile app, sign in, and allow its notifications.
2. **Add a monitor** of type **Keyword**:
   - URL: `https://trygg-hverdag-staging.cleverapps.io/v1/health`
   - Keyword: `"status":"ok"` — the quotes are part of it.
   - Alert when the keyword **does not exist**.
   - Interval: 5 minutes (the free plan's shortest).
   - Alerts go to the mobile app.
3. Check that it shows **Up**.

The exact wording of UptimeRobot's and Healthchecks.io's settings screens was
not checked from a session; the names above are the ones in their
documentation.

## A-26 — The drill: a stopped worker pages you within 5 minutes

This is INF-08's done-criterion. Do it after A-23 to A-25, when the check shows
a ping every minute and the monitor shows Up. Staging has no users, so
stopping it harms nothing.

The worker pings at the start of every minute, and the check goes down 3
minutes after the **last ping**, not after the moment you stop the app. So the
5 minutes are measured from the last ping: timed from the stop, a drill could
pass with up to a minute of luck.

1. **Wait for a ping to show in the check's log in Healthchecks.io, then stop
   the app straight away.** Note the time you stop it: T.
2. **Stop the app `trygg-hverdag-staging`** in the Clever Cloud console (the
   button's wording was not checked from a session), or with `clever stop` on
   your own computer. That stops the worker and the API together. The pings
   come only from the worker, so this is exactly what a worker that stops on
   its own looks like to Healthchecks.io.
3. **Write down when each alert reaches your phone**: Healthchecks.io's, and
   UptimeRobot's. Keep the app stopped until UptimeRobot has alerted, or for 10
   minutes: its free plan checks every 5, so it can take longer than
   Healthchecks.io.
4. **Read the last ping's time, L,** from the check's log in Healthchecks.io.
5. **Start the app again** from the console, or by running `deploy-staging` by
   hand: its deploy restarts the app when the commit is already there
   (`--same-commit-policy restart`). That a restart also starts a *stopped* app
   was not checked from a session; the console is the sure route. Write down
   when both monitors show up again.
6. **Send Claude the six times**: L, T, the two alert times, and the two
   recovery times.

**Pass:** Healthchecks.io's alert reached the phone within 5 minutes of L, the
last ping (which is never later than T), UptimeRobot alerted (its time is
recorded, not held to 5 minutes, D-079), and both recovered. A miss is a bug,
and INF-08 is not done until it passes.

## A-34 — The staging canary's check in Healthchecks.io, and its secret

Do this before REL-10's `infra-staging` plan. A plan without the secret stops
with "Invalid value for variable" and a message naming the secret, as for A-23.
About 3 minutes.

1. In Healthchecks.io, **add a check** named `staging-canary`:
   - **Period 15 minutes**, **Grace 20 minutes** (D-127, Q3). The canary
     reports once per run, every 15 minutes. A failing run sends the failure
     signal and pages at once. A canary that stops running pages about 35
     minutes after its last success, so one lost run, from a deploy in the
     middle of one, pages nothing.
   - Send its alerts to the same place as the other checks.
2. Copy the check's **ping URL**, in the form with the check's UUID that
   Healthchecks.io shows by default (`https://hc-ping.com/<uuid>`), not the slug
   form. **Treat it as a password**: anyone who has it can keep the check green
   while every alert is missed. **Never use another check's URL**: the worker's
   ping every minute would keep this check green while the canary is dead.
   Terraform refuses a URL equal to the worker's or the SMS check's, and so does
   the worker at start.
3. In GitHub: repository **Settings → Environments → `staging` → Add
   environment secret** (not a repository secret), named
   `HEALTHCHECKS_CANARY_URL`, with that ping URL as its value.

## A-35 — After REL-10 merges: plan, apply, and watch the canary for 24 hours

1. Wait until the merge's `deploy-staging` run is green. Until the apply, the
   deployed worker says at start that the canary is not running: expected.
2. Actions → `infra-staging` → Run workflow with action `plan`. The summary shows
   the app's `environment` changing and a new `random_password`, with the values
   hidden. Nothing else should be listed.
3. Run it again with action `apply`, giving it the plan run's ID, as in A-22.
   Clever Cloud restarts staging; the worker registers the canary's identities
   on its first canary run, at the next quarter of an hour.
4. **Within about 21 minutes, open the check in Healthchecks.io.** It must have
   left `new` and show a success ping. **If it stays `new`, stop and tell
   Claude**: a check that has never been pinged never pages, whatever happens.
   The worker's start lines in the app's log on Clever Cloud say either `worker:
   the canary runs every 15 minutes and reports to a check of its own …` or
   `worker: the canary is not running: …` with the reason.
5. **24 hours later, report** the window, the number of success and failure
   pings in the check's log, any down event, and the largest `alertMs` among the
   worker's `canary_run` lines in the same log. M2's exit is 24 hours with no
   failure signal and no down event (REL-10-AC19).

## When `staging-sms` pages you

The worker reports the SMS check each minute, and it reports failing for
either of two reasons. The worker's line in the app's log on Clever Cloud says
which, with a count and nothing personal:
- **`sms_unsent`:** an SMS is still unsent 60 s after it was written (LOST-07,
  D-115). Until M3 brings the SMS provider, every escalation on staging ends
  here, so a page after a staging alert's two minutes is expected.
- **`unheard_alerts`:** an alert is open on a journey that has no responder
  left, so nobody can be told (SM-10, D-122). The walker was warned when the
  last responder went. It lasts until contact comes back, "I'm home", or the
  24-hour rule (SM-06, built in M2's task 8) ends the journey.

While either holds the check stays failing, so the other adds no new page.
Read the log for the second reason before deciding the first explains it.

## When `staging-canary` pages you

Every 15 minutes the canary (REL-10) starts a test journey on staging, goes
silent, and checks that the watchdog opens the alert and that the push port
answers the test responder's lost-contact message within 5 minutes plus 60
seconds of the walker's last contact. Staging has no push or SMS provider, so
"answers" means the port said `NOT_CONFIGURED`: a green canary shows that the
server half of the alert path works, **not that a phone is alerted** (D-127,
Q1).

It pages you in one of two ways. The check's log in Healthchecks.io says which.
- **A failure signal:** a run came to an outcome other than `ON_TIME` and sent
  `/fail`. It pages at once. The worker's `canary_run` line for that run says
  which outcome.
- **No failure signal, only the check going down:** nothing pinged for about 35
  minutes (Period 15, Grace 20). The canary stopped running, so there is no
  line to read for the missing run; see "A page with no failing ping" below.

**Where to read.** The worker's lines in the app's log on Clever Cloud. A run
writes one JSON line with `"event":"canary_run"` and these fields, and no name,
phone number, position or address (PRIV-07):
- `outcome`: one of the names below;
- `status`: the HTTP status of the call that failed, or null (null also means
  the call got no answer within 10 seconds, or the network failed);
- `code`: the SQLSTATE of the database call that failed, or null;
- `alertMs`: milliseconds from the walker's last contact until the push port's
  answer was first seen. Set only for `ON_TIME`;
- `openedAfterMs`: milliseconds from last contact until the alert opened. Set
  for `ON_TIME`, `OPENED_EARLY` and `NOT_HANDED_OVER`, null otherwise.

The same log holds three other lines: `canary_skipped` (the run found another
run in flight and did nothing), `canary_leftover_ended` (the run ended the
journey of an earlier run that never finished) and `canary_report_failed` (the
run could not reach Healthchecks.io).

### What each outcome means

**Missed alerts** are `NOT_OPENED` and `NOT_HANDED_OVER` (D-127, Q2). Each
**stops feature work** until it is fixed and covered by a test (D-022), and gets
a BUG. Every other failing outcome pages and gets a BUG, but does not stop the
line by itself.

| Outcome | What happened |
|---------|---------------|
| `NOT_OPENED` | **Missed alert.** No alert had opened 360 seconds after last contact: the watchdog is not opening alerts. Look first at the sweep: stopped, or failing every time. |
| `NOT_HANDED_OVER` | **Missed alert.** The alert opened (`openedAfterMs` is set) but the push port had not answered the responder's lost-contact message by 360 seconds: the delivery loop is stopped, wedged or failing to claim. In M2 each delivery writes a `push_failed` line, so none for that message points at the loop. |
| `OPENED_EARLY` | The alert opened less than 5 minutes after last contact (`openedAfterMs` says when): a false alarm, a defect of its own. |
| `NOT_CONFIGURED` | The canary's own settings are unusable (`CANARY_API_URL` or `CANARY_CREDENTIAL`). The worker's start line names which, never the value. A half-configured canary pages rather than sit quiet. |
| `REGISTER_FAILED` | Registering the canary's identities in the database failed. A `code` is the database's; with `code` null, the registration refused itself, for example because a device with the canary's ID belongs to another user. |
| `START_FAILED` | The start call failed. `status` is the API's answer (401: the credential is not accepted; 5xx: the API is failing), or null for no answer. Also this: an earlier journey of the canary could not be ended (`status` is that answer's), or a 409 named a journey that is not the canary's (`status` 409). |
| `HEARTBEAT_FAILED` | The heartbeat call failed (`status`), or it answered and the journey still shows no last contact. |
| `READ_FAILED` | A database read failed (`code`), or the canary's journey could not be read as its own. |
| `HOME_FAILED` | The "I'm home" call failed (`status`). A 409 means something else ended the journey first. |
| `NOT_RESOLVED` | After "I'm home" the journey was not `ENDED` with reason `HOME`, or its alert not `RESOLVED` with resolution `HOME`: the end did not take effect. |
| `ESCALATED` | An escalation SMS was written for the canary's alert. The run ends its journey at least about 55 seconds before an alert could escalate, so either the run was held up past that margin or the escalation no longer waits as long as the canary assumes. `staging-sms` may page too; ending the journey withdraws the unsent SMS and clears that page (D-116). |
| `STAND_DOWN_NOT_HANDED_OVER` | The alert was answered and the journey ended, but the push port had not answered the responder's stand-down within 90 seconds of the alert's resolution. A stand-down first seen later than that fails. |
| `RUN_LIMIT` | The run was still going 10 minutes after it began: something held it, such as a call that never answers. Only the run limit is `RUN_LIMIT`. |
| `RUN_FAILED` | An error in the canary itself: neither one of its steps failing nor its limit. It pages and gets a BUG. It is **not a missed alert**: the canary could not look, so it does not know that one was missed. The line carries no detail by design; read the worker's other lines around it. The run still sends "I'm home" once, waiting at most 5 seconds. |
| `INTERRUPTED` | **Not a failure and not reported.** The worker was stopped during a run (a deploy or a restart). The run ends its journey and writes the line; the next run ends anything it left. One lost run is inside the grace. |

An `ON_TIME` run is normal at about 300 to 320 seconds of `alertMs` against the
360-second deadline. If it creeps toward 360, the Nano's reduced CPU (D-077) is
the suspect; the instance size is a cost, so it goes to you with the numbers.

### A page with no failing ping

The check went down with no failure signal before it, so the canary did not
finish a run for 35 minutes. Go in this order:
1. **Is the worker alive?** If not, `staging-worker` pages within about 3
   minutes, long before this one. Deal with it first.
2. **Are there `canary_run` lines for the last hour?** None: the canary did not
   run. The worker's start lines say `worker: the canary is not running: …`
   with the reason, or the schedule is not firing.
3. **Lines, but a `canary_report_failed` beside them:** the run finished but
   could not reach Healthchecks.io, and the `canary_run` line has the true
   outcome. `ON_TIME` means the page is false: the success ping did not get
   through. Any other outcome is a real failure whose failure signal did not
   get through, so the grace paged it late. One such case is a `RUN_LIMIT` line
   with a `canary_report_failed` line around a restart: the worker was stopped
   while the run was ending.
4. **Only `canary_skipped` or `INTERRUPTED` lines:** every run found another in
   flight or was stopped. Look for a restart loop or a run that never ends.

## If the ping URL ever leaks

Add a new check in Healthchecks.io with the same settings, replace the
`HEALTHCHECKS_WORKER_URL` secret, run `infra-staging` plan and apply, confirm
the new check leaves `new`, then delete the old check.

The same steps apply to the `staging-sms` check (A-32, LOST-07) and its
`HEALTHCHECKS_SMS_URL` secret: Period 1 minute, Grace 2 minutes. Never give it
the worker's URL: then the SMS check's ping every minute would keep the
worker's check green while the watchdog is stopped. Give each secret the
UUID form, exactly as Healthchecks.io shows it; the slug form of the same check
would get past the "must differ" check (D-116). After the apply, confirm that
each check shows one ping a minute, not two.

The same steps apply to the `staging-canary` check (A-34, REL-10) and its
`HEALTHCHECKS_CANARY_URL` secret: Period 15 minutes, Grace 20 minutes. Never
give it the worker's or the SMS check's URL: their pings every minute would keep
the canary's check green while the canary is dead. After the apply, the new
check leaves `new` after the next run, within about 21 minutes, and shows one
ping per run, not more; the other two checks are unchanged.

## If `CANARY_CREDENTIAL` leaks

Anyone who holds it can start, beat and end the canary's journeys on staging,
naming only the canary's own test responder. That is synthetic and alerts no
one, and it would show as failing or skipped runs, but the credential never
expires (D-091), so it is replaced and not left. It is made by Terraform
(`random_password.canary_credential`) and lives only in Terraform's state in
Cellar and the staging app's environment on Clever Cloud, so there is no GitHub
secret to change. **Rotate it by raising its generation:**
1. A pull request raises `canary_credential_generation` in the `locals` of
   `infra/staging/main.tf` by one (from `"1"` to `"2"`, and so on). It is the
   resource's only `keepers` value, and the random provider replaces the
   resource when a `keepers` value changes (read from `hashicorp/random`
   3.9.1's own schema, D-128's loop-1 amendment). `infra/` needs your approval,
   so it is a normal pull request; ask Claude for it.
2. After it merges, run `infra-staging` plan and read it before applying. It
   must show `random_password.canary_credential` replaced and the app's
   environment changing, values hidden, and nothing else. The one value it
   shows in clear is the generation itself (`"generation" = "1" -> "2"`,
   "forces replacement"), which is not a secret.
3. Apply. The apply restarts the app; the worker registers the new
   credential's hash on its first canary run, within 15 minutes of starting
   (D-128), so the old credential gets 401 from then on. A run the old worker still had in flight then fails, so one
   `staging-canary` page around the restart is expected, and a second only if
   its journey, left unended, escalates and pages `staging-sms`. Both come
   once and stop.
4. Confirm that the next run is `ON_TIME` and the check shows a success ping,
   within about 21 minutes. This step is what ends the old credential: the
   worker replaces the hash on its first canary run, so until then the old
   one still works, and if the canary is not scheduled at all (no usable
   `HEALTHCHECKS_CANARY_URL`), the old credential is never replaced. No
   success ping means the rotation has not taken effect.

`infra-staging.yml` runs `terraform plan` and then applies that plan, with no
input for `-replace` (read in the workflow file on 2026-10-10), which is why
rotation goes through the generation and not through a replace. Not yet tried
on staging: the first rotation is the first proof.
