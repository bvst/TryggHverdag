---
name: call01-step1-audit
description: CALL-01-AC9 step 1 (features/call/ owner + safety filter, D-141 item 7; red d308a4c, green cb9fbd3 on claude/busy-faraday-40n2zl-ai-review), PASS; 13 probes, one guard gap (file inside folder as safety path)
metadata:
  type: project
---
Audited 2026-10-22 (cloud). Base origin/main 3d2255c. Spec and D-141 live only on the session branch claude/busy-faraday-40n2zl.
- RG-02 replay (git worktree at d308a4c + node_modules symlink, vitest on merge-rules.test + gate.test): 5 failed / 261 passed,
  all on assertions; HEAD 266/266. 7 tests = 5 red + 2 guards (by design).
- RG-01: req:coverage counts FILES not tests; gate.test.mjs has `req-coverage: fixtures-only`, so CALL-01 = 1 (merge-rules.test.mjs)
  is right. --fail-on-uncovered-changed exit 0: changed files are scripts/.github/docs (not apps/packages/docs/specs), so neither
  uncoveredInChanges nor uncoveredCriteria reads anything; CALL-01's AC1..AC8 will be demanded when the spec lands with task 2.
- RG-03: tests:changes 2 files none weakened; 0 removed lines in test files. Baseline untouched. decideMutation skip.
- Probes (edit/run/git checkout in own worktree): CODEOWNERS-only typo, filter-only typo, consistent typo in all three lists
  (caught because tests hardcode the path), filter entry commented / moved under ui (merge-rules toContain is whole-file text and
  PASSES both; gate.test filterEntries test catches), later ownerless nested line, single owner, `call/*`, no trailing slash,
  SAFETY_PATHS += folder / += features/ , D139_FILES += folder: all caught. SURVIVES: SAFETY_PATHS += a FILE inside the folder
  (guard checks CALL.startsWith(path) only) -> Note.
- gate:integrity without NODE_USE_ENV_PROXY (brief forbade it): 3 of 5; gh api rules/branches/main: 13 contexts incl.
  mutation/traceability/unit, code-owner true. No open PR for the branch (#21..#94 closed), check-runs total_count 0.
- gh api to anthropics/claude-code-action 403 (repo not attached); `git ls-remote` works for public tag SHA checks.
- Cleanup: `rm` with $VAR paths is refused by a safety check; use literal absolute paths.
Related: [[grp01-audit]], [[gate-integrity-local]], [[config-pinning-tests]]
