---
name: lost03-review
description: LOST-03 review 2026-10-06 (PASS, advisory) — a domain decision computed and tested but never read; "ended" meaning opposite things across layers; L3 without Docker; a test-kit copy of a server constant
metadata:
  type: project
---

Reviewed origin/main 5cd5d24 to 3471859 (code 6add162, tests 2bbf05c). PASS, three should-fixes.
Saved by the orchestrating session: this session had no Write or Edit tool.

1. **A domain field computed and tested but never read.** Grep the non-test code for `decision\.`
   reads. When an adapter re-decides on the locked row, the rule exists twice, and the tested copy is
   not the one production follows. LOST-03's `resolvesAlert` (and `state`/`reason` from `home()`)
   was the example: `recordHome` wrote ENDED/HOME as literals. The contact path shows the right
   shape: call `transition` while holding the row lock.
2. **One word, opposite meanings across layers.** In LOST-03, "ended" meant "ends now" in the domain
   and service, but "had already ended" in the store, inside the same `home()` function. Read each
   module function's branches against the meaning of each literal at its own layer.
3. **L3 without Docker.** PostgreSQL 16 binaries are at `/usr/lib/postgresql/16/bin`.
   `scratchpad/l3/vitest.l3.config.mjs` plus `fake-testcontainers.mjs` run the repository's L3 files
   unmodified against 127.0.0.1:55432. For a cluster of your own: `su postgres` for initdb and
   pg_ctl, `chmod o+x /tmp/claude-0` before each call (it reverts to 700) and back to 700 after;
   listen on TCP 127.0.0.1, since the scratchpad's socket path is over 107 bytes. Write and Edit can
   be off for a session, so there may be no probe files.
4. **The test kit copying a server constant it used to receive as a parameter.** LOST-03's fake store
   held D-021's 300 000 itself, where on main it took `afterMs`. Check main's version of the fake for
   how the value used to arrive.

Notes left as notes: `lockedStateOf` helper for D-112's lock-first rule (prelude duplicated, the
guarded move three times); `alertMissing` helper better inlined; oRPC 1.15.3 detailed input ignores an
unknown query string (outer `z.object`); `ports.ts` and `packages/contracts/src/home.ts` unowned.
