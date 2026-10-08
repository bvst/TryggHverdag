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
