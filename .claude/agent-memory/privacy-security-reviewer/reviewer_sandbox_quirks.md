---
name: reviewer-sandbox-quirks
description: What the read-only Bash guard blocks for this reviewer on the Mac, that a block ends the review, and the workarounds to plan in up front
metadata:
  type: reference
---

The guard hook (`guard-bash.mjs --readonly`) matches on the command's text, not on what the command does:
- Any `>` counts as a redirect: `2>/dev/null`, a JS arrow `=>` inside `node -e`, `->` inside an `echo` string, **and a `>` inside a grep regex** (`[^>]*`, `<application[^>]*>`; blocked on SPIKE-01, 2026-09-30). Pipe to `grep`/`sed` instead, write JS with `function(){}`, and for XML use patterns such as `android:name="[^"]*"` that need no `>`.
- The text "expo install" (even inside a grep regex) counts as a dependency change. Rephrase the pattern.
- macOS has no `timeout`; use the Bash tool's own timeout.
- `gh api` and `gh release view` work, which is enough to check action tag SHAs (dereference annotated tags through `git/tags/<sha>`), repository licences (`repos/<o>/<r>/license`) and release asset digests.

**A block ends the review.** Briefs say a guard block means stop and report, never rephrase and retry. So a careless `>` costs every check still to come. Before each command, scan it for `>`. Run the checks most likely to decide the verdict first.

Related: [[mobile-release-review]], [[tooling-scripts-review]], [[device-harness-review]]
