# safety-reviewer — notes

Recurring problems, so the next review starts where the last one ended.
Newest first.

## Patterns worth checking every time

### A mutation group narrowed for time: prove "that test kills none on its own" yourself (BUG-29)
The claim rests on one machine's run. Map each assertion of the dropped test onto the mutated file, plant the mutants
only a real process would show, run them without it, and compare survivor sets in a ranged Stryker run. Then check
the budget margin on CI, not locally (local 4-core times ran 1.04-1.32x faster than CI's), and that the older
decision naming the old command or grouping is pointed at the new one.

### A guard moved into the adapter leaves its old reason behind (LOST-07 loop 3)
When a later loop makes the adapter itself safe (e.g. /fail built on the URL's path), the earlier "why we refuse it"
survives in TF error messages, test titles/comments, the PR body and decisions. Grep the old phrase across *.tf, tests,
scripts and the PR draft, not just the file the implementer fixed. And for a runbook that quotes a start-up line: list
every refusal the OLD rule let through and check the quote matches each one's actual line (quote the common prefix).

### A stricter check of an existing secret ships with the deploy, before the plan that validates it (LOST-07 loop 2)
deploy-staging runs on every merge; infra-staging (which re-validates TF variables and re-sets the app env) is a
later manual owner step. So when config.ts starts refusing spellings an earlier, looser TF rule let through, the
merged code reads the OLD applied value first. Ask: what rule applied the value now in the app env (git show
origin/main:infra/...), what does the new code do with each spelling that rule took, and does the smoke test notice?
(It reads /v1/health, never Healthchecks.io.) Usually a call-out in the PR body + owner to-do, not a code fix.
I missed this in loop 1 (trailing slash, ?, #) and caught it in loop 2.

### A second monitor URL: can it stand in for the first, and is its derived address built safely? (LOST-07)
When a task adds a second ping URL beside the worker check, check (a) nothing refuses the same value for both (an ok
ping each minute from the new check keeps the old check green while the beat is stale), and (b) any derived address
(Healthchecks.io /fail) is built from the URL path, not appended to the string: a ?query URL turns failing into an ok
ping. Prove it in-process: readXSetting + adapter with a stub fetch; the TF regex is usually prefix-only.

### test.each titles from $name are truncated (~40 chars), so -t with a later phrase matches nothing
The shared behaviour suite runs as test.each(...)('$name'): "-t <words from the middle>" gave 172 skipped, 0 run.
Filter by the ID prefix ("LOST-07-AC3: alertsDue"). A "skipped" count is not a pass; read it.

### Adapter SQL is not mutated on a PR (D-095): a 15-run L3 property may be its only guard
Plant mutants at L3 for the safety corners of each new read; a property without examples can miss one (~1 in 7 here).
Ask for fc examples that pin the corners (D-114 missing-half states).


### A later non-critical push can replace a stored critical one at the provider (LOST-06)
APNs stores only ONE notification per bundle ID for an offline device, "in most cases the latest" (Apple,
"Sending notification requests to APNs"; apns-expiration 0 means delivered once and not stored). So any
non-critical message sent to a responder WHILE an alert is open (a notice, a reminder) can evict the critical
alert waiting for that offline phone. Stand-downs are fine (the alert is over); a later alert is fine (it is the
latest). Ask, for every new kind: is it sent while an alert is open, to someone already sent the critical push?
Server-side order cannot fix it; the push adapter (M3) and an L9 real-device test must. Spec claims like "the
others still get the critical push" are true only at our port.
More of Apple's page (fetched 2026-10-07): "isn't always guaranteed when multiple notifications are stored in a
short duration" and "APNs may reorder notifications you send to the same device token", so "the later one is
kept" is NOT a certainty either way, and any port-side ordering promise (holds, withdrawals) stops at our port.
FCM (firebase.google.com/docs/cloud-messaging/customize-messages/collapsible-message-types): "By default, the
collapse key is the app package name"; "Notification messages are always collapsible and will ignore the
collapse_key parameter"; at most 4 collapse keys stored per device, "no determining factor on which keys are
kept"; non-collapsible: 100 stored, then all discarded. So Android notification messages likely displace too
(inference). Ask that any displacement gate covers BOTH platforms, and both send orders.

### Allowlist or denylist of message kinds: ask which way a forgotten kind fails (LOST-03 loop 3)
For a withdrawal or suppression keyed on kind, a kind nobody classified either gets withdrawn (denylist) or
sent (allowlist). Sending a stale all-clear after a new alert is the dangerous direction; withdrawing a
resolved alert's message from someone about to get a fresh alert is mild. Prefer a list derived from the one
producer of those kinds (resolveInside writes kind = resolution, so ALERT_RESOLUTIONS is self-maintaining), and
ask for a tripwire test that makes every new kind be classified. Check the fake's copy of the list too (D-100).
Also: when a fix widens what is withdrawn, list every recipient who loses a message and confirm each gets a
superseding one (my loop-1 advice missed the recipient axis; loop 3 closed it).


### "No overtaking" inside one alert says nothing about the NEXT alert (LOST-03)
A per-alert ordering rule (hold the stand-down behind its own alert's push) leaves an earlier alert's retrying
stand-down free to reach the port after a newer alert's LOST_CONTACT on the same journey: false reassurance while an
alert is open. Probe: provider failing for a responder across resolve -> new open -> recover; read push.accepted order.
Ask who withdraws or orders messages of an older alert when a new one opens.

### Once the API writes outbox rows, the worker's marks can wait on the API
The worker pool has no lock_timeout; a mark on a row the API's transaction holds waits until the API's idle/lock
limits end it. Check every new cross-process row lock against the pool that has no lock limit.

### A liveness signal covers only the loop that feeds it (LOST-02)
When a beat is fed by one loop (the sweep), every other loop or consumer beside it (the outbox sender) is
unmonitored: a hung or always-failing run there leaves the beat fresh and every monitor green. Prove it
in-process with the real modules and a fake that never answers (fakePush.holdAnswers), and check comments that
claim "a stopped loop shows as a stopped beat". Ask which monitor (canary, REL-10) covers each other loop.

### Startup parameters: a deploy log shows refusal, not application
A pooler can refuse an unknown startup parameter (loud) or silently ignore it (connections fine, limit absent).
Only a read-back (show <setting>) proves a session limit is in force. Also pg 8.x: URL query fields override
Pool options (connection-parameters.js Object.assign order).

### skip locked on the parent row does not make a transaction wait-free
Inserting a child row runs the FK check as SELECT ... FOR KEY SHARE on the referenced row, which waits on
FOR UPDATE / DELETE holders. A pool with no lock_timeout can wedge there; check every FK the transaction writes.

### An unset GitHub secret is an empty TF_VAR, not a missing one (INF-08)
`${{ secrets.X }}` for a secret that does not exist is `""`, and Terraform takes
`TF_VAR_x=""` as a value: the plan fails on the variable's *validation*
("Invalid value for variable"), not with "No value for required variable".
Verified with the pinned Terraform 1.16.4 on a provider-free copy of the block.
Check any doc that quotes which error the owner will see.

### Graphile's graceful stop waits for a task that ignores its abort signal
`runner.stop()` (0.18, `main.js` gracefulShutdown) waits for in-flight jobs; the
5 s `gracefulShutdownAbortTimeout` only aborts `helpers.abortSignal`. A task
doing its own I/O (INF-08's check-in, 10 s timeout) delays exit until that I/O
ends: measured 6.8 s after SIGTERM with a hung stand-in. Bounded is fine; an
unbounded await in a task is a stop that never finishes.

### A monitor drill measured from the stop time passes on luck
With a 1-minute beat, "stopped at T, alert by T+5" includes a random 0-60 s
head start (the last ping can be up to a minute before T). Ask for the last
ping's time L to be recorded, or the stop to be made right after a ping, so the
drill tests the worst case (INF-08 A-26).

### The ping/liveness contract keeps spreading past the safety paths
INF-07 moved it into `bin/worker.ts` and `process.ts`; INF-08 moved "ping only
after a recorded beat" partly into `adapters/healthchecks.ts` (it holds the URL
and fetch, so it *can* ping without being asked) and "never throws at start-up"
into `config.ts#readHealthchecksSetting`. Neither is in SAFETY_PATHS, CODEOWNERS
or the ai-review filter. Each review: list every file the worker's start-up and
check-in depend on, and compare with the three lists.

### Graphile Worker owns the worker's signals unless told not to
`run()` without `noHandleSignals: true` installs its own handlers for SIGTERM,
SIGINT, SIGHUP, SIGUSR2 and SIGABRT (graphile-worker `dist/main.js`), drains the
pool, removes its handler and re-raises the signal with `process.kill`. Any
`process.once('SIGTERM', …)` of our own runs too, but loses the race: verified
on INF-07 with a real PostgreSQL, the worker process died by SIGTERM 15 ms after
the signal, before our `stop()` could end the pool or `exit(0)`. Whatever we put
in a shutdown path is cut off silently. Check: who owns the signals, and is
there a test that sends one to the real process and asserts the exit?

### `runner.promise` never rejects (graphile-worker 0.18)
`runner.js` wraps both the worker pool's and cron's promises in `.catch(noop)`
before `Promise.all`, so a crashed pool *resolves* the runner's promise. Liveness
must be decided by "did we ask it to stop?", not by rejection. `startWorker`'s
`untilStopped()` does this correctly (INF-07). A fake runner that rejects tests
a path the real one never takes.

### Graphile Worker installs its own pool `error` handler
When given a `pgPool` with no `error` listener it warns ("Your pool doesn't have
error handlers!") and installs a handler that logs `err.message` and carries on
(`dist/lib.js`, `assertPool`). So the worker's pool does not crash on an idle
client error — verified by `pg_terminate_backend` on every backend: it logged
and reconnected. D-068's "the crash stands" is true of the API's pool only.
The log line bypasses `redactCredentials`.

### Graphile's logger prints failed-task messages, and Drizzle's carry params
`Failed task … with error '<message>'` (graphile `dist/worker.js`), and
`DrizzleQueryError`'s message is `Failed query: …\nparams: …`. Once a task binds
a location or phone number (M2), a failing query logs it (PRIV-07). Hand to
privacy-security-reviewer when a task touches personal data.

### Clever Cloud workers are systemd services
`CC_WORKER_RESTART=on-failure` maps to systemd, which does not restart a
process ended by SIGTERM/SIGINT/SIGHUP/SIGPIPE — and graphile ends the worker by
re-raising exactly those. Keep `always`. `CC_WORKER_RESTART_DELAY` must keep a
crash loop under systemd's start burst limit, or the worker stays down.

### "Exactly one worker" is not true during a deploy
One instance is not one worker while Clever Cloud overlaps old and new
instances (the per-app `zero-downtime` setting; default unverified). The
watchdog must stay lock-safe (AR-06) regardless, and the DEV plan's five
connections are budgeted for one instance only.

### The worker is more files than `worker.ts`
Since INF-07 the worker's liveness contract spans `apps/server/src/worker.ts`,
`apps/server/src/bin/worker.ts` and `apps/server/src/process.ts`; only the first
is in SAFETY_PATHS / CODEOWNERS / the ai-review `safety` filter. Check each
review whether the lists have caught up (D-042 names "worker" as a safety path).
**Caught up in INF-07** (#21 for the filter, #22 for the other three).

### Your working tree's `.claude/**` is main's, not the pull request's
The environment you run in puts back `main`'s `.claude/**` and `CLAUDE.md`
before you read them. So a plain `git diff` (working tree against `HEAD`) shows
every `.claude/` change the pull request makes as *uncommitted and reverted*.
They are not. On #22 this was read as "uncommitted changes strip the D-077
guardrails" and became a BLOCK, while the committed head had every guardrail.
Read the pull request's version with `git show HEAD:<path>`, and its change
with `git diff origin/main...HEAD -- <path>`. Only a difference *there* is a
finding.

## How to verify here
A PostgreSQL 16 binary is installed (`/usr/lib/postgresql/16/bin`) even though
Docker is not usable: `initdb`/`pg_ctl` as user `postgres` in the scratchpad
gives a real database to run the entry points under plain node. The harness
resets `/tmp/claude-0` to 0700 *between calls*: put `chmod 755 /tmp/claude-0` in
the same command as anything run as `postgres`. The scratchpad path is too long
for a Unix socket (107 bytes): start with `-c unix_socket_directories=''` and
`-c listen_addresses=127.0.0.1`. Stop with `pg_ctl stop -m fast` (or
`kill -INT <pid>`). `pkill -f <pattern>` matches the calling shell too — track
child PIDs instead. For an outside HTTPS service (hc-ping.com), a self-signed
cert for IP 127.0.0.1 plus `NODE_EXTRA_CA_CERTS` lets the real worker ping a
local stand-in; Graphile's cron fires at second 0, so allow ~2.5 minutes.
