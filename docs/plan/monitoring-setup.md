# Monitoring setup — the owner's steps (INF-08)

**Last updated:** 2026-09-28 · Decisions: D-065, D-077, D-079 · Spec: [`../specs/INF-08.md`](../specs/INF-08.md)

**Status: done.** A-23 to A-26 are complete. The drill ran on 2026-09-26, and
the owner accepted it on 2026-09-28. Two things differ from the steps below:
- Both monitors alert by email, and UptimeRobot's app was not installed ("it is
  enough for now").
- UptimeRobot's recovery and its keyword rule were not checked.

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
   dead.
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

## If the ping URL ever leaks

Add a new check in Healthchecks.io with the same settings, replace the
`HEALTHCHECKS_WORKER_URL` secret, run `infra-staging` plan and apply, confirm
the new check leaves `new`, then delete the old check.

The same steps apply to the `staging-sms` check (A-32, LOST-07) and its
`HEALTHCHECKS_SMS_URL` secret: Period 1 minute, Grace 2 minutes. Never give it
the worker's URL: then the SMS check's ping every minute would keep the
worker's check green while the watchdog is stopped. After the apply, confirm
that each check shows one ping a minute, not two.
