---
name: gate-integrity-local
description: Locally, pnpm run gate:integrity reports 3 of 5 because main's rulesets cannot be read without a token, so "required check" premises stay unverified
metadata:
  type: project
---

On the Mac (claude-dev, 2026-09-25) `pnpm run gate:integrity` lists `mutation`, `traceability`, `unit` and the other
checks as "required today", but that list comes from the repository's own expectations. The two checks that read
the live ruleset ("main requires review, the checks…" and "nobody can bypass") fail with "main's rules could not
be read from the GitHub API". Result: 3 of 5, red.

**Why:** the brief says that if gate:integrity is red, the "CI gates it anyway" reasoning does not hold, so run the
relevant gates directly.
**How to apply:** report plainly that the premise was not verified against the live rules. Then run whichever
gates actually bear on the diff. For scripts/-only changes that means the unit tests, plus the baseline and
mutation-path reasoning; `scripts/` is not in SAFETY_PATHS (scripts/lib/gate-decisions.mjs), so mutation does not
mutate it. Check again each time: CI with RULES_READ_TOKEN may give 5 of 5.
