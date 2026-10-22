---
name: call01-step1-review
description: CALL-01-AC9 step 1 (side branch claude/busy-faraday-40n2zl-ai-review, D-141 item 7) — PASS cb9fbd3; features/call/ owned + safety filter; open: shared/ui Screen (carries the 112 bar) and features/grp home/first-contact unowned, Claude Code version comment stale
metadata:
  type: project
---

PASS at cb9fbd3 (2026-10-22), session review (D-075, edits ai-review.yml).
Verified: worktree of the branch in scratchpad (node_modules symlinked): gate/merge-rules/ai-review tests
334/334; at d308a4c 5 red + 2 guards green. GitHub `codeowners/errors?ref=<branch>` = []. Last match for
features/call/** is CODEOWNERS L84 (nothing later matches). Action SHA = refs/tags/v1.0.254^{} (ls-remote);
`git fetch --depth 1` of both action SHAs: v1.0.254 installs Claude Code 2.1.304 (was 2.1.301), the only change.
Should-fix given:
- ai-review.yml ~L208 and header comments in scripts/ai-review.test.mjs, scripts/ci-models.test.mjs still say
  "2.1.301 at v1.0.251" (same pattern as REL-10 step 1's Dependabot #62).
- CALL-02 spec: `Screen` in src/shared/ui/ renders EmergencyBar unconditionally (the "every screen" guarantee)
  -> unowned, not in safety filter. no-circular (depcruise) + shared/ui <-> call/index cycle may push the bar into
  shared/ui. features/grp/first-contact.ts (normaliser feeding phone.ts's 110/112/113 guard), home-screen.tsx
  (no-wait-for-server) unowned. Owning them later needs the safety filter (BUG-10 general test) -> another
  hand-merged PR (D-075), so the owner should decide before task 2. phone.ts guard should normalise itself.
- SAFETY_PATHS exclusion correct: an app path there today would run Vitest whole-suite Stryker (no jest runner)
  -> nothing killed / measured nothing (D-099). Spec cites F6 for "call not placed"; F6 is "alert not noticed".
Related: [[rel10-canary-filter-review]], [[grp01-review]], [[unowned-gate-configs]].
