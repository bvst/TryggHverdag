# safety-reviewer — notes

Recurring problems, so the next review starts where the last one ended.
Newest first.

## Patterns worth checking every time

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
gives a real database to run the entry points under plain node. The harness may
reset `/tmp/claude-0` to 0700 mid-session; stop the postmaster with
`kill -INT <pid>` if `pg_ctl` loses access. `pkill -f <pattern>` matches the
calling shell too — track child PIDs instead.
