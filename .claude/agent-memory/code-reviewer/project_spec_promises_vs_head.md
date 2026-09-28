---
name: spec-promises-vs-head
description: Verify at HEAD that the decision (D-0xx), owner action (A-xx), "recorded in the decision" follow-ups and baseline changes a spec claims actually exist; also diff coverage-baseline.json for drops absorbed by --update
metadata:
  type: project
---

When a spec says "recorded as D-0xx" or "owner action A-xx", check it with `git show HEAD:docs/plan/decisions.md | grep D-0xx` and `git show HEAD:docs/plan/README.md | grep A-xx`. Numbers get taken on main while a branch is open: INF-06 promised D-080/A-27, main took both with #32, and the branch renumbered to D-081/A-28 (resolved 2026-09-26). Also grep the spec for "in the decision" or "recorded as a follow-up". INF-06's R16 said the Stryker-cannot-see-jest follow-up was "recorded in the decision", but D-081 did not mention it.

Also diff `coverage-baseline.json` against main. `coverage:ratchet --update` absorbs drops silently. In INF-06, `pinned-binary.mjs` dropped and was later restored. `scripts/lib/affected.mjs` went from 100/100 (5 lines) to 94.64/76.59 on the change classifier's new code, and the baseline kept the lower figure. The uncovered lines were the loud refusal for an unreadable workspace glob.

**Why:** D-031 says Claude records why for every library and tool choice. A-xx items in docs/plan/README.md are the owner's only to-do list. The ratchet only protects what `--update` did not already lower.

**How to apply:** in every review of a feature branch, grep HEAD for each D-/A- number and each "in the decision" promise the spec makes. Look for decreases in the baseline diff on changed files. Measure one file with `pnpm exec vitest run scripts --coverage --coverage.include=<file> --coverage.reporter=text --coverage.reportsDirectory=<scratchpad>`. Run the whole `scripts` folder, because a subset under-reports shared helpers. A missing reason for new dependencies, actions or overrides is a real finding under D-031/SEC-06. A missing follow-up line or a percentage drop on grown code is a Should fix. Related: [[unowned-gate-config]], [[stale-prose-after-amendment]].
