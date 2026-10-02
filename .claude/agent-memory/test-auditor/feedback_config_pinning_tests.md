---
name: config-pinning-tests
description: Tests that pin a security exception's config (BUG-11 audit ignore) - literal command scans miss global-option forms; "named by an Accepted decision" cannot see delegated status or supersession; path premises go unpinned
metadata:
  type: feedback
---

BUG-11 (2026-10-02, head 786a5e4, PASS): `scripts/dependency-audit.test.mjs` pins `pnpm.auditConfig.ignoreGhsas` instead of
running the network-bound `pnpm audit`. Read pnpm 10.33.0's bundle (/opt/node22/lib/node_modules/pnpm/dist/pnpm.cjs):
only `ignoreGhsas` (exact includes) and `ignoreCves` (all CVEs) are honoured; root package.json `pnpm` field first, then
pnpm-workspace.yaml settings assigned over it; `--ignore`/`--ignore-unfixable` call writeSettings (ignoreCves), so an
earlier step can seed ignores that a later exact `pnpm audit --audit-level high` honours.
Gaps found (Should fix): the workflow scan `/\bpnpm\s+audit\b/` misses `pnpm -C . audit`, `--dir .`, `-w`,
`--filter=.` (same class as HK-03's `terraform -chdir`); "Accepted" prefix accepts the 15 live "Accepted (delegated"
statuses; supersession is written only in the newer entry ("Supersedes D-060 point 4"), so the old one stays Accepted;
the acceptance's path premise (node-forge only via @expo/cli + @expo/code-signing-certificates) is unpinned although
pnpm-lock.yaml shows it offline. Backstop verified: ruleset require_code_owner_review true; /package.json, /scripts/,
/docs/plan/decisions.md, /.github/ owned. pnpm-workspace.yaml and .npmrc are NOT owned.
How to apply: for any exception/ignore list, probe the selector with global-option forms, list the status forms the
log actually holds (evaluate the test's helpers inline with `node --input-type=module -e "$(sed -n 'a,bp' file)"`,
which writes no file), and ask whether the decision's premise (who depends on it) is pinned.
Also: D-060 is used by two different decisions on main (lines 601 and 639), pre-existing.
Related: [[bug-test-patterns]], [[promised-future-tests]], [[gate-integrity-local]]
