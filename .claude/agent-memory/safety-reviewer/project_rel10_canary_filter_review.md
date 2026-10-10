---
name: rel10-canary-filter-review
description: REL-10 step 1 (PR #76, side branch claude/busy-faraday-40n2zl-ai-review) — PASS 934b475; canary paths owned and in the safety filter before REL-10's own PR; open items for REL-10
metadata:
  type: project
---

PASS at 934b475 (2026-10-10). Saved by the main session: the reviewer's own write was refused by the
D-120 guard.

- 0 of 632 tracked files change owner; `modules/canary/` and `adapters/canary.ts` go from no owner and
  no filter to owned and filtered; `domain/canary.ts` was already covered. Filter 29 -> 31 entries.
- Batched Dependabot #62: claude-code-action 1.0.242 installs Claude Code 2.1.290, while ai-review.yml
  said 2.1.283 (fixed in a827713). The same number in the header comments of `scripts/ci-models.test.mjs`
  and `scripts/ai-review.test.mjs` is left for REL-10's test-author.
- Open for REL-10's own pull request:
  - a line in `.claude/agents/safety-reviewer.md` for the canary, with a `scripts/ai-review.test.mjs` pin
    like BUG-18's: ok only after ON_TIME on database times; every other reported outcome failing; nothing
    after INTERRUPTED or a skip; a failed report is a `canary_report_failed` line, never silence or a
    throw; NOT_CONFIGURED pages; the journey ends before escalation; the responder has no device; only
    worker.ts imports adapters/canary.ts; registration refuses a canary device ID owned by anyone else;
  - `adapters/canary.ts` is a single-file owner entry: a split or rename leaves new files unowned and no
    test compares the lists with the tree, so AC18 should assert git tracks both owned canary paths;
  - `apps/server/src/config.ts` (unowned) decides whether the canary is scheduled at all; loud only once
    `staging-canary` has left `new` (A-35's first-start check).
