---
name: test-harness-async-spawn-review
description: Reviewing test-only changes that move a script-under-test from spawnSync to async spawn, preload modules (--import), or shell stand-ins - kill timers vs vitest's testTimeout, leftover mkdtemp dirs, env, injection
metadata:
  type: feedback
---

First seen on BUG-21 (e5c6d2e, scripts/e2e-android.test.mjs, 2026-10-14). PASS, Notes only.

**Frame:** test-only harness changes have no PRIV surface if the data is synthetic (serials,
locales, adb answers). The SEC questions: child env set in full (not ...process.env), no
shell string-building with untrusted input, no network, children cannot outlive the test.

**What changes when spawnSync becomes async spawn:**
- spawnSync blocks the event loop, so vitest's testTimeout can never fire mid-run and the
  spawn's own timeout always cleans up. With async spawn, vitest's timeout CAN fire first.
  Compare the harness's default kill timeout with vitest.config.mjs testTimeout (here both
  60_000: the kill comes a few ms after vitest gives up; the finally's rmSync runs only if the
  worker survives). Suggest a default kill below testTimeout.
- No SIGKILL escalation after SIGTERM: fine for a node child with no SIGTERM handler.
- Kill hits only the direct child; grandchildren (stand-ins under spawnSync with piped stdio)
  orphan briefly. Check their stdio is a pipe to the child, not inherited from the test, or
  'close' waits on them.
- Unbounded stdout/stderr accumulation replaces spawnSync's 1 MB maxBuffer (trivial).

**Probe recipe (1 call):** cut the helper out of the test file by indexOf("function X(") to
the next "\n}\n", write it plus imports into a scratchpad .mjs, run it against /bin/sleep 5
with a 300 ms timeout, a stopAfter fired by writing the log file, and `sh -c env` with a
one-variable env. Time the whole process: if it exits at once despite 60 s timers, they are
cleared.

**Leftover dirs:** /tmp/e2e-android-past-preflight-* with only a counter file in it is an
interrupted run (finally never ran), not a race: a race after rmSync would write count 1.
Count the dirs before and after your own run.

**--import preload:** check the script forks no node children (fork copies execArgv) and that
NODE_OPTIONS is not set; the observer's output path goes in through JSON.stringify.

Related: [[tooling-scripts-review]], [[reviewer-sandbox-quirks]]
