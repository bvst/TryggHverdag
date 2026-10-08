---
name: bug36-39-audit
description: BUG-36..39 (D-120 guard on the local-settings file and the hooks' state folder, briefs' verdict paragraph, memory folders, pnpm run decision) audit, PASS at 019e941/9191d49; 43 faults, 4 survivors all Notes; affected.mjs INERT gap queued
metadata:
  type: project
---
Audited 2026-10-08 (cloud), branch fix/BUG-36-39-claude-follow-ups, head 019e941 (then 9191d49, docs+memory only). PASS.
- Replays (git archive of each commit into scratchpad, node_modules symlinked): 4d290dd 41 red, right reasons; 4504d95 191/191
  (drill AC10 red by design: Edit got [SETTINGS x2, IMPLEMENTER]); c220904 22 red + 1 EPIPE flake; d1d646a 1 EPIPE flake only;
  6508e8a 17 red; 019e941 green. The EPIPE (stdin to a stand-in `node` that never reads it) reproduced pre-fix, 0 in ~37 runs after.
- Drill change (INF-10-AC10): still exact per tool; dropped guard-paths line and an added `true` hook line both killed.
- 43 faults plus 2 no-op controls: guards 17 (15 killed), settings.json and drill 11 (all killed, unquoted globs killed only by the argv wiring test),
  decision.mjs 15 (13 killed). Survivors: empty agent_id read as main session (comment claims otherwise), repoRelPath
  fallback `|| cwd` dropped (unreachable: hook path itself needs CLAUDE_PROJECT_DIR), `^` dropped from the ID regex
  (still exits 1 loudly), join('\n') vs '\n\n'.
- Queued, not fixed here: scripts/lib/affected.mjs INERT treats .claude/agent-memory/** (now read by agent-memory.test.mjs)
  and docs/plan/decisions.md (read by dependency-audit.test.mjs since BUG-15, and decision.test.mjs) as inert;
  affected.test.mjs pins both, so the fix is an RG-03 change in its own PR. Push to main runs everything (backstop).
- privacy-security-reviewer's root mismatch: stop-gate roots records at input.cwd (apps/server has package.json), the guard
  at CLAUDE_PROJECT_DIR; the subfolder tests pin the guard's root only.
Related: [[in-memory-mutation]], [[readonly-guard]], [[entry-script-wiring]], [[bug30-31-audit]]

**Loop 1 (2026-10-08, cloud), 813a476 red / 1f7ce47 green (HEAD later 980318b, memory only). PASS.**
- Replay: t-813a476 tree (the red commit touches tests only, so it is "813a476's tests on 813a476^'s hooks"): 47 red, all verdict or
  message mismatches (46 "review loop 1" tests + the RG-03 wiring test); 21 new tests pass on purpose, each commented so. Tree copies need
  `git init` + commit, else BUG-31's ls-files test fails (env, not a finding). test:hooks 6/6 green in the checkout (36 s each), 320/320.
- 56 faults (+ a no-op that survived and one invalid paren drop): 42 killed, 14 survived. Killed: split whitespace-only and each of ; & | ) < backtick, WRITE_OPS backtick, DENY_WRITE_OPS unused and each of
  ln/install/dd, every ignoreCase off, --allow made case-blind (journey.TEST.ts test), lib flag never/always, folder glob dropped, with a
  trailing slash or with /**, refusal sentence dropped, empty agent_id (A1, my earlier survivor), both gates back to input.cwd, env/input
  order swapped, process.cwd fallback, RAW_BYTES emptied or dropped per call, per-use input.cwd for git/phase/raw/passed/pnpm/marker/changed.
- Survivors (all Notes or low should-fix): split without the gt, open-paren and dollar chars (near-equivalent except `path$(cmd)`),
  DENY_WRITE_OPS backtick prefix, ln/install/dd leaking into --readonly (commit claims `rg install docs` stays allowed; no test), redirect
  class lt/backtick and quote strip (message naming only), ignoreCase leak into role guards (stricter only: deny side), main session's
  case-blind phase exemption (tests say "not what this is about"; D-120 claims it), stop-gate package.json check and gate-failed path from
  input.cwd (S8, S13: from docs/ the pre-fix gate exited 0 without running; unpinned).
- Found by probing: an ampersand right after the gt (`>& file`, `1>&file`) writes the file in bash but redirectTargets skips it; not in
  D-120's known limits. D-120's known limits still list the cd-then-rm form and removing the dot-claude folder as getting past; both are
  refused now (the new folder glob).
