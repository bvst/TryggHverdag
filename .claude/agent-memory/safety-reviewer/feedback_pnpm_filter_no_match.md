---
name: pnpm-filter-no-match-exits-zero
description: pnpm 10.33.0 `--filter <x> run <script>` with no matching package prints "No projects matched" and exits 0; `--fail-if-no-match` exits 1. Check every gate script that hands over with --filter
metadata:
  type: feedback
---

Measured 2026-09-26 on pnpm 10.33.0: `pnpm --filter @trygghverdag/does-not-exist run test` exits 0;
adding `--fail-if-no-match` makes it exit 1, and a matching filter still exits 0.

INF-06's root `test:unit` and `test:coverage` hand over to the app with `pnpm --filter @trygghverdag/mobile
run ...` without that flag. scripts/gate.test.mjs `scriptChain` follows any filter containing "mobile" by
*script name*, so a wrong package name that still contains "mobile" passes the tests while jest never runs.
In CI only `traceability`'s coverage:ratchet then fails (jest-expo summary missing); `unit` and the local
stop gate (gate:quick → test:unit) stay green.

**Why:** "a gate that ran nothing and exited 0" is the silent pass this project forbids (D-060).

**How to apply:** in any review, grep changed package.json scripts and workflows for `--filter`/`-F`
without `--fail-if-no-match` and report it. See [[changed-files-rename-blind-spot]].
