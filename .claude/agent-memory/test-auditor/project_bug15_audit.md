---
name: bug15-audit
description: BUG-15 / D-104 (braces GHSA-vfj7-8cjw-p6xm audit ignore) test audit, PASS at 0ccd0f5; 58 in-memory faults; survivors are the supersession gap (BUG-11's), a server path through micromatch, and by-design cases
metadata:
  type: project
---

Audited 2026-10-03 (cloud session), worktree scratchpad/bug15, branch fix/BUG-15-braces-advisory, base main 34bc460.
Commits: 0d331f6 D-104, 1bfaa23 tests, 0ccd0f5 fix (one ID in package.json, made by the orchestrator, not implementer;
disclosed in the commit). PASS.

- RG-02 replay (tests at 1bfaa23, package.json/decisions/lockfile at 0d331f6): exactly 2 red, the reproduction and the
  exact pin, both on "ignoreGhsas ... [ 'GHSA-86w9-cpqp-85rv' ]"; 13 green. Against HEAD: 15 green.
- RG-03: comment-stripped diff main..HEAD of dependency-audit.test.mjs has zero deleted/changed lines, five pure
  insertions between top-level declarations/tests. Every removed line in the raw diff is a comment.
- Faults (harness scratchpad/ta-bug15/ta-harness.mjs + mutants.mjs): all package.json faults killed (third ID with or
  without a decision, GHSA or CVE in ignoreCves, case change, ghsa- prefix, trailing space, duplicate, in-alphabet typo,
  key typo, forge removed); decisions faults killed (delegated, Proposed, partial, bare Accepted, renumbered, heading
  demoted into D-100, ID removed, entry deleted, ID moved to another owner-accepted decision); lockfile faults killed
  (3.0.4 in place or beside, 3.1.0, tarball, new dependent direct/alias/optional, micromatch drops braces, workspace
  direct dep plain/alias, lockfileVersion 10); helper weakenings killed by the synthetic-lockfile test (10/10).
- SURVIVED: ID order swap (equivalent); a later owner-accepted decision superseding D-104, or "superseded" after the
  owner's acceptance in D-104's status (BUG-11's supersession gap, still open); braces 3.0.2, peer-only and
  transitivePeer-only (correct); a second micromatch version (by design); **apps/server depending on micromatch** (the
  gap test-author declared in "Not pinned").
- Gap answer: pin D-104's own Context fact "pnpm why braces --prod in @trygghverdag/server finds no path" in this PR
  (no new decision; Should fix). Verified offline with the test's reader + a closure walk: apps/server reaches 461
  packages (dev included), none braces/micromatch; root, contracts, test-kit and config do not reach it either; only
  apps/mobile does. Pinning micromatch's dependents as such would fire on routine jest/metro/expo updates: owner's cost
  call, not recommended. App bundling cannot be read from the lockfile.
- Closure-walk trap: strip the peer suffix `(…)` before the alias check, or `0.86.3(@babel/core@7.29.7)` reads as an
  alias. readLockfile merges dependencies/devDependencies/optionalDependencies, so a --prod walk needs the field kept.
- RG-05/ratchet: decideMutation on the three files says skip; coverage-baseline.json untouched. Branch pushed, no PR,
  check-runs total_count 0. Real `pnpm audit --audit-level high`: "2 high (2 ignored)", exit 0 (run here, seconds).
- IDs: D-101..D-103 are LOST-01's (claude/busy-faraday-40n2zl); D-104 free; LOST-01's m2.md names BUG-15 as this PR and
  says it will be "ported here" (not yet at 7311e81). Both append after D-100 in decisions.md: a trivial order conflict.
Related: [[config-pinning-tests]], [[in-memory-mutation]], [[gate-integrity-local]]
