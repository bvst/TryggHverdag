---
name: spec-promises-vs-head
description: Verify at HEAD that the decision (D-0xx), owner action (A-xx) and baseline changes a spec or progress entry claims actually exist; INF-06 claimed D-080/A-27 that were absent
metadata:
  type: project
---

When a spec says "recorded as D-0xx" or "owner action A-xx", check it with `git show HEAD:docs/plan/decisions.md | grep D-0xx` and `git show HEAD:docs/plan/README.md | grep A-xx`. In the INF-06 review (2026-09-26), both D-080 and A-27 were missing, although the spec, progress.md and a commit message named them. An implementer memory also said a `pnpm.packageExtensions` reason "lives in D-079", but D-079 is INF-08's decision. So the root package.json override had no recorded reason anywhere in the repository.

Also diff `coverage-baseline.json`. `coverage:ratchet --update` absorbs drops silently. In INF-06, `scripts/lib/pinned-binary.mjs` went from 84.61 to 78.78 % lines and from 75 to 66.66 % branches on a changed file (RG-04), because its new branch had no success-path test.

**Why:** D-031 says Claude records why for every library and tool choice. A-xx items in docs/plan/README.md are the owner's only to-do list. The ratchet only protects what `--update` did not already lower.

**How to apply:** in every review of a feature branch, grep HEAD for each D-/A- number the spec promises, and look for decreases in the baseline diff on changed files. A missing decision for new dependencies, actions or overrides is a real finding under D-031/SEC-06, not a style issue. Related: [[unowned-gate-config]].
