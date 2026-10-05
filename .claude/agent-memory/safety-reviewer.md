# safety-reviewer — notes

Recurring problems, so the next review starts where the last one ended.
Newest first.

## Patterns worth checking every time

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
